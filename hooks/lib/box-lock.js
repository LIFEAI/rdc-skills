'use strict';
/**
 * Box-wide single-flight lock — ONE home for the rule.
 *
 * The global rdc-skills package is BOX-WIDE (one per machine), but the
 * SessionStart hook runs per session and per worktree. Without coordination,
 * N sessions can each conclude "missing" and run `npm install -g` against the
 * same directory.
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

// How long to let a fresh acquisition settle before trusting it. Long enough to
// cover the remove-then-create gap of a concurrent reclaim, short enough to be
// invisible on a SessionStart path that already budgets minutes for repair.
const SETTLE_MS = 60;

/** Synchronous sleep — this module runs in a hook with no event loop to yield to. */
function settle(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const body = JSON.stringify({ pid: process.pid, ts: new Date().toISOString() });
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(fd, body);
      fs.closeSync(fd);

      // POST-ACQUIRE VERIFICATION — the part that actually makes this single-flight.
      //
      // O_EXCL guarantees only one process can CREATE the file, but not one OWNER
      // across a delete-and-recreate: reclaiming a stale lock necessarily leaves the
      // path empty for an instant, and a racer arriving in that gap creates it
      // legitimately. Both then believe they lead. No amount of care in the reclaim
      // path closes that window — it is inherent to remove-then-create.
      //
      // So settle briefly and re-read: whoever's bytes are still there owns the box,
      // and everyone else stands down. This converges on exactly one leader instead
      // of trying to make the gap not exist. Without it the race was intermittent —
      // 0/12, 1/12, 2/12 double-leader rounds across runs, which is the worst kind
      // of bug to ship: it passes CI and fails on a busy machine.
      settle(SETTLE_MS);
      // Distinguish "someone else took it" from "the read failed". Standing down on
      // a transient read error can elect ZERO leaders — nobody repairs the box while
      // every session waits and then hard-blocks. Only a genuine byte MISMATCH means
      // another session leads.
      let observed = null;
      let readOk = false;
      for (let r = 0; r < 2 && !readOk; r++) {
        try { observed = fs.readFileSync(LOCK_PATH, 'utf8'); readOk = true; } catch { settle(20); }
      }
      if (!readOk) continue;              // could not verify — retry the create
      if (observed !== body) return false; // someone reclaimed it; they lead

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

      // Could not READ the file we are about to judge — it vanished (the winner is
      // mid-reclaim, between its rename and its re-create) or is unreadable. We
      // have no identity to verify against, so reclaiming here would rename away
      // the winner's brand-new lock unverified and elect a second leader. Measured:
      // this window alone produced 2/12 double-leader rounds. Retry the create
      // instead; if the winner has re-created by then we will see a fresh, live
      // lock and correctly stand down.
      //
      // A corrupt-but-readable body (e.g. "not json") still reclaims normally —
      // heldRaw is non-null there, so this does not wedge a genuinely bad lock.
      if (heldRaw === null) continue;

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
          // Not ours to take — DISCARD the claim and stand down.
          //
          // Do NOT rename it back. renameSync silently OVERWRITES an existing
          // destination, and the bytes we hold are the STALE ones (that is why we
          // judged them reclaimable). Restoring them clobbers the live leader's
          // fresh lock with a stale body, so the next session judges it
          // reclaimable and becomes a SECOND LEADER while the true leader is
          // mid `npm install -g` — the exact race this module exists to prevent,
          // arriving through the restore path. Measured, and invisible to the
          // concurrency probe because it seeds a dead-PID lock, so claimRaw
          // always equals heldRaw and this branch never runs there.
          //
          // Whoever owns the path already owns the box. Losing the stale bytes
          // costs nothing; putting them back can only mislead.
          try { fs.unlinkSync(claim); } catch { /* already gone */ }
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
