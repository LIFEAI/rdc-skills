'use strict';
/**
 * Box-wide single-flight lock — ONE home for the rule.
 *
 * The global rdc-skills package and rdc-skills-mcp are BOX-WIDE (one per machine),
 * but the SessionStart hook runs per session and per worktree. Without
 * coordination, N sessions each conclude "unhealthy" and each run
 * `npm install -g` against the same directory — and on Windows, against a
 * directory a live process is sitting in.
 *
 * This lives in its own module because the verification probe MUST exercise the
 * real implementation. It previously kept a private copy of these functions, and
 * that copy silently drifted to the old algorithm — so the probe reported PASS for
 * code that was not shipping, and later FAIL for code that was already fixed. A
 * test that duplicates its subject tests nothing.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOCK_PATH = path.join(os.tmpdir(), 'rdc-skills-environment-repair.lock');
const LOCK_STALE_MS = 5 * 60 * 1000;

let lockHeld = false;

/**
 * Is `pid` a live process?
 *
 * PID 0 is NOT a probe: process.kill(0, 0) signals the CURRENT PROCESS GROUP and
 * succeeds, so a truncated lock written as {"pid":0} would read as alive forever.
 * Reject non-positive/non-integer pids before asking the OS.
 */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM'); // exists, not ours to signal
  }
}

/**
 * A lock we cannot reason about is stale.
 *
 * A parseable-but-corrupt body ({"pid":0,"ts":"garbage"}) threw nothing, so
 * `NaN > LOCK_STALE_MS` was false and the lock was judged live FOREVER — wedging
 * every session onto the follower path until the tmpdir file was deleted by hand.
 */
function lockIsStale(held) {
  const pid = Number(held && held.pid);
  const age = Date.now() - Date.parse(held && held.ts);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(age)) return true;
  return !processAlive(pid) || age > LOCK_STALE_MS;
}

/**
 * Become the box's updater, or report that someone else already is.
 *
 * Stale locks are reclaimed by RENAME, never unlink-then-create. The naive
 * sequence (read → judge stale → unlink → open 'wx') is a TOCTOU: two sessions can
 * both read the same stale lock, both judge it stale, and the second's unlink can
 * delete the FIRST's freshly created lock — leaving both convinced they own the
 * box-wide update, which is the exact race this module exists to prevent.
 * rename() is atomic, so only one racer can win, and only the winner proceeds.
 */
function acquireBoxLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      fs.closeSync(fd);
      lockHeld = true;
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;

      let heldRaw = null;
      let held = null;
      try {
        heldRaw = fs.readFileSync(LOCK_PATH, 'utf8');
        held = JSON.parse(heldRaw);
      } catch {
        held = null; // unreadable/corrupt → stale
      }
      if (!lockIsStale(held)) return false;

      // Claim the RIGHT to reclaim. Losing this rename means another session got
      // there first and now owns the update, so we are a follower.
      const claim = `${LOCK_PATH}.${process.pid}.${attempt}.reclaim`;
      try {
        fs.renameSync(LOCK_PATH, claim);
      } catch {
        return false;
      }

      // VERIFY WE TOOK THE FILE WE JUDGED. rename() moves whatever is at the path,
      // not the bytes we inspected. Without this check a slow racer renames away
      // the WINNER'S BRAND-NEW lock — it judged the old stale body, then moved the
      // fresh one — and both processes become leader. Measured: 12/12 rounds
      // elected two leaders before this check existed (scripts/probe-box-lock.mjs).
      if (heldRaw !== null) {
        let claimRaw = null;
        try { claimRaw = fs.readFileSync(claim, 'utf8'); } catch { claimRaw = null; }
        if (claimRaw !== heldRaw) {
          // Not ours to take — put it back and stand down.
          try { fs.renameSync(claim, LOCK_PATH); } catch { /* owner will re-create */ }
          return false;
        }
      }
      try { fs.unlinkSync(claim); } catch { /* already gone */ }
    }
  }
  return false;
}

function releaseBoxLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try { fs.unlinkSync(LOCK_PATH); } catch { /* best effort */ }
}

function holdsBoxLock() {
  return lockHeld;
}

// Safety net. The hook's block() calls process.exit(1), which terminates
// IMMEDIATELY and does NOT unwind pending finally blocks — so the failure path (the
// one most likely to run) leaked the lock. A leaked lock usually self-heals via the
// dead-PID check, but Windows recycles PIDs aggressively: if a live process inherits
// the dead owner's PID inside the 5-minute window, the lock reads as live and every
// concurrent session waits then hard-blocks. 'exit' handlers DO run on
// process.exit(), so this covers exit paths we did not anticipate.
process.on('exit', releaseBoxLock);

module.exports = {
  LOCK_PATH,
  LOCK_STALE_MS,
  acquireBoxLock,
  releaseBoxLock,
  holdsBoxLock,
  lockIsStale,
  processAlive,
};
