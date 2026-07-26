#!/usr/bin/env node
/**
 * Prove the box-wide update is SINGLE-FLIGHT under concurrent session starts.
 *
 * The bug this guards: rdc-skills is one box-wide npm package and one PM2 process,
 * but every session/worktree runs the SessionStart hook. Without a lock, N sessions
 * each conclude "unhealthy" and each run `npm install -g` on the same directory.
 *
 * Imports the REAL implementation from hooks/lib/box-lock.js. An earlier version
 * kept its own copy of these functions, which drifted to the old algorithm — so it
 * reported PASS for code that was not shipping. A test that duplicates its subject
 * tests nothing.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HOOK_LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'lib', 'box-lock.js');
const { acquireBoxLock, releaseBoxLock, LOCK_PATH, LOCK_STALE_MS } = require(HOOK_LIB);

const release = () => { try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ } };

release(); // clean slate
let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fail++; };

// 1. Happy path. SEQUENTIAL and in-process, so it proves only that a held lock is
//    not handed out twice — it cannot exercise interleaving. Test 7 does that.
const winners = Array.from({ length: 10 }, () => acquireBoxLock()).filter(Boolean).length;
check(`sequential starts: exactly 1 updater of 10 (got ${winners})`, winners === 1);

// 2. A live holder is respected — a follower must NOT steal the lock.
check('live lock respected', acquireBoxLock() === false);

// 3. Release hands the box to the next session.
releaseBoxLock();
check('after release, next session leads', acquireBoxLock() === true);
releaseBoxLock();

// 4. A dead owner must not wedge every future session forever.
fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: 999999, ts: new Date().toISOString() }));
check('dead owner reclaimed', acquireBoxLock() === true);
releaseBoxLock();

// 5. A stale-but-live lock (crashed mid-install, PID reused) is reclaimed by age.
fs.writeFileSync(LOCK_PATH, JSON.stringify({
  pid: process.pid, ts: new Date(Date.now() - LOCK_STALE_MS - 1000).toISOString(),
}));
check('stale lock reclaimed by age', acquireBoxLock() === true);
releaseBoxLock();

// 6. Corrupt bodies must not wedge the box. `pid: 0` is the sharp one:
//    process.kill(0, 0) signals the CURRENT PROCESS GROUP and succeeds, so a naive
//    liveness check reads it as alive forever; paired with an unparseable ts, the
//    age check is NaN and never trips either.
for (const body of ['not json', '{"pid":0,"ts":"garbage"}', '{"pid":-1,"ts":null}', '{}']) {
  fs.writeFileSync(LOCK_PATH, body);
  check(`corrupt lock reclaimed: ${body.slice(0, 26)}`, acquireBoxLock() === true);
  releaseBoxLock();
}

// 7. REAL concurrency against a STALE lock — the reclaim TOCTOU.
//
//    The naive reclaim (read -> judge stale -> unlink -> open 'wx') lets two racers
//    both judge the lock stale, and the loser's unlink deletes the WINNER's fresh
//    lock, so both become leader and both run `npm install -g`. Sequential calls in
//    one process can never surface this; only real processes racing can.
{
  // A leader HOLDS the lock briefly before exiting. Without the hold, a winner
  // exits (releasing on 'exit') before the next racer even calls acquire, so every
  // racer wins in turn and the result looks like a race that never happened.
  const racer = `
    const { acquireBoxLock } = require(${JSON.stringify(HOOK_LIB)});
    const go = Number(process.argv[2]);
    while (Date.now() < go) { /* spin to a shared start instant */ }
    const won = acquireBoxLock();
    process.stdout.write(won ? 'LEADER' : 'follower');
    if (won) { const until = Date.now() + 600; while (Date.now() < until) {} }
  `;

  // spawn(), NOT spawnSync(): spawnSync BLOCKS until each child exits, so the
  // "racers" ran strictly one after another and never overlapped. That flaw made
  // this test report 12/12 double-leaders against correct code.
  const runRound = () => new Promise((resolve) => {
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: 999999, ts: new Date().toISOString() }));
    const go = Date.now() + 400;
    const out = [];
    let done = 0;
    for (let i = 0; i < 4; i++) {
      const kid = spawn(process.execPath, ['-e', racer, String(go)], { stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      kid.stdout.on('data', (d) => { buf += d; });
      kid.on('close', () => {
        out.push(buf);
        if (++done === 4) resolve(out.filter((o) => o.includes('LEADER')).length);
      });
    }
  });

  const ROUNDS = 12;
  let doubleLeader = 0;
  let noLeader = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const leaders = await runRound();
    if (leaders > 1) doubleLeader++;
    if (leaders === 0) noLeader++;
    release();
  }
  check(`concurrent reclaim: no round elected 2 leaders (${doubleLeader}/${ROUNDS} bad)`, doubleLeader === 0);
  // Every racer bailing would be "safe" but useless — nobody would repair the box.
  check(`concurrent reclaim: a leader was elected each round (${noLeader}/${ROUNDS} empty)`, noLeader === 0);
}
release();

// 8. NEGATIVE CONTROL — does test 7 actually have teeth?
//
// This suite has already produced two false verdicts: a copy of the implementation
// that drifted (reported PASS for code that was not shipping), and a spawnSync
// harness whose "racers" never overlapped (reported FAIL for code that was fine).
// A concurrency test that cannot fail is worse than no test, so run the SAME
// harness against a deliberately naive lock and require that it catches it.
{
  const naivePath = path.join(os.tmpdir(), `naive-box-lock-${process.pid}.js`);
  fs.writeFileSync(naivePath, `
    const fs = require('node:fs');
    const LOCK_PATH = ${JSON.stringify(`${LOCK_PATH}.naive`)};
    // The original algorithm: read -> judge stale -> unlink -> open('wx').
    // No rename, no identity check. This is what shipped before the fix.
    function acquireBoxLock() {
      for (let a = 0; a < 2; a++) {
        try { const fd = fs.openSync(LOCK_PATH, 'wx');
          fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
          fs.closeSync(fd); return true;
        } catch (err) {
          if (err.code !== 'EEXIST') return false;
          try { fs.unlinkSync(LOCK_PATH); } catch { return false; }
        }
      }
      return false;
    }
    module.exports = { acquireBoxLock, LOCK_PATH };
  `);
  const naiveLock = `${LOCK_PATH}.naive`;
  const naiveRacer = `
    const { acquireBoxLock } = require(${JSON.stringify(naivePath)});
    const go = Number(process.argv[2]);
    while (Date.now() < go) {}
    const won = acquireBoxLock();
    process.stdout.write(won ? 'LEADER' : 'follower');
    if (won) { const until = Date.now() + 600; while (Date.now() < until) {} }
  `;
  const naiveRound = () => new Promise((resolve) => {
    fs.writeFileSync(naiveLock, JSON.stringify({ pid: 999999, ts: new Date().toISOString() }));
    const go = Date.now() + 400;
    const out = []; let done = 0;
    for (let i = 0; i < 4; i++) {
      const kid = spawn(process.execPath, ['-e', naiveRacer, String(go)], { stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      kid.stdout.on('data', (d) => { buf += d; });
      kid.on('close', () => { out.push(buf); if (++done === 4) resolve(out.filter((o) => o.includes('LEADER')).length); });
    }
  });
  let caught = 0;
  const ROUNDS = 12;
  for (let r = 0; r < ROUNDS; r++) {
    if (await naiveRound() > 1) caught++;
    try { fs.unlinkSync(naiveLock); } catch { /* ignore */ }
  }
  check(`negative control: harness DETECTS the naive lock (${caught}/${ROUNDS} rounds caught)`, caught > 0);
  try { fs.unlinkSync(naivePath); } catch { /* ignore */ }
  try { fs.unlinkSync(naiveLock); } catch { /* ignore */ }
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall box-lock invariants hold');
process.exit(fail ? 1 : 0);
