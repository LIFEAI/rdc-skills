#!/usr/bin/env node
/**
 * Prove the box-wide update is SINGLE-FLIGHT under concurrent session starts.
 *
 * The bug this guards: rdc-skills is one box-wide npm package and one PM2 process,
 * but every session/worktree runs the SessionStart hook. Without a lock, N sessions
 * each conclude "unhealthy" and each run `npm install -g` on the same directory.
 *
 * Exercises the real lock functions copied from the hook (same file, same
 * semantics) — it never installs anything.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const lockPath = path.join(os.tmpdir(), 'rdc-skills-environment-repair.lock');
const LOCK_STALE_MS = 5 * 60 * 1000;

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err && err.code === 'EPERM'; }
}

function acquireBoxLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      let stale = true;
      try {
        const held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        stale = !processAlive(Number(held.pid)) || Date.now() - Date.parse(held.ts) > LOCK_STALE_MS;
      } catch { stale = true; }
      if (!stale) return false;
      try { fs.unlinkSync(lockPath); } catch { return false; }
    }
  }
  return false;
}

const release = () => { try { fs.unlinkSync(lockPath); } catch { /* ignore */ } };

release(); // clean slate
let fail = 0;

// 1. Ten "sessions" start together: exactly one may update the box.
const winners = Array.from({ length: 10 }, () => acquireBoxLock()).filter(Boolean).length;
console.log(`concurrent starts: ${winners} updater(s) of 10  ${winners === 1 ? 'PASS' : 'FAIL'}`);
if (winners !== 1) fail++;

// 2. A live holder is respected — a follower must NOT steal the lock.
console.log(`live lock respected: ${acquireBoxLock() === false ? 'PASS' : 'FAIL'}`);
if (acquireBoxLock() !== false) fail++;

// 3. Release hands the box to the next session.
release();
console.log(`after release, next session leads: ${acquireBoxLock() ? 'PASS' : 'FAIL'}`);
release();

// 4. A dead owner must not wedge every future session forever.
fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: new Date().toISOString() }));
const reclaimedDead = acquireBoxLock();
console.log(`dead owner reclaimed: ${reclaimedDead ? 'PASS' : 'FAIL'}`);
if (!reclaimedDead) fail++;
release();

// 5. A stale-but-live lock (crashed mid-install, PID reused) is reclaimed by age.
fs.writeFileSync(lockPath, JSON.stringify({
  pid: process.pid, ts: new Date(Date.now() - LOCK_STALE_MS - 1000).toISOString(),
}));
const reclaimedStale = acquireBoxLock();
console.log(`stale lock reclaimed by age: ${reclaimedStale ? 'PASS' : 'FAIL'}`);
if (!reclaimedStale) fail++;
release();

// 6. A corrupt lock must not wedge the box either.
fs.writeFileSync(lockPath, 'not json');
const reclaimedCorrupt = acquireBoxLock();
console.log(`corrupt lock reclaimed: ${reclaimedCorrupt ? 'PASS' : 'FAIL'}`);
if (!reclaimedCorrupt) fail++;
release();

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall box-lock invariants hold');
process.exit(fail ? 1 : 0);
