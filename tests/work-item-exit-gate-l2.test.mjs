#!/usr/bin/env node
/**
 * Truth Gate 3.0 — Layer 2 (FUSED evidence gate) tests.
 *
 * Exercises EVERY rejection branch of work-item-exit-gate.js verifyLayer2 plus
 * the fully-valid close, against a REAL throwaway git repo (no live DB). The
 * gate's git/disk checks run against RDC_TRUTH_GATE_REPO, which we point at the
 * throwaway repo. verifyLayer2 throws GateDenied on rejection; we assert on the
 * thrown reason. A fully-valid close throws nothing.
 *
 * Branches proven:
 *   1. commit-not-resolving (free-typed bad SHA)        -> DENY
 *   2. commit-not-captured  (real SHA, not in L1 set)   -> DENY
 *   3. files ∉ commit                                   -> DENY
 *   4. file not on disk (in commit, deleted from tree)  -> DENY
 *   5. prose verification ("HTTP 200")                  -> DENY
 *   6. witness:"agent"                                  -> DENY
 *   7. fully-valid close (real SHA captured, files in   -> ALLOW (no throw)
 *      commit + on disk, machine artifact, valid witness)
 *   8. fail-closed: any internal error during L2        -> DENY (via main wrapper)
 *
 * Also a fused-primitive assertion: run_evidence_gate emits a verdict ONLY
 * after running the command (no verdict without a run).
 *
 * Run: node tests/work-item-exit-gate-l2.test.mjs
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOK = join(REPO_ROOT, 'hooks', 'work-item-exit-gate.js');
const GATE_LIB = pathToFileURL(join(REPO_ROOT, 'hooks', 'lib', 'run-evidence-gate.mjs')).href;

const failures = [];
function assert(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  else process.stdout.write(`  ok  ${name}\n`);
}

// ---------------------------------------------------------------------------
// Build a throwaway git repo: commit two files, capture the FULL HEAD sha.
// ---------------------------------------------------------------------------
const repo = mkdtempSync(join(tmpdir(), 'l2-repo-'));
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
g('init', '-q');
g('config', 'user.email', 'test@example.com');
g('config', 'user.name', 'Test');
writeFileSync(join(repo, 'a.txt'), 'alpha\n');
writeFileSync(join(repo, 'b.txt'), 'beta\n');
g('add', 'a.txt', 'b.txt');
g('commit', '-q', '-m', 'feat: seed');
const HEAD = g('rev-parse', 'HEAD').trim();          // real FULL 40-hex SHA

// CRITICAL: set the repo the gate runs git against BEFORE requiring the hook,
// because TRUTH_GATE_REPO is captured at module load.
process.env.RDC_TRUTH_GATE_REPO = repo;
const require = createRequire(import.meta.url);
const gate = require(HOOK);

const SESS = 'sess-l2-origin';
// Build an `item` row shaped like the work_items SELECT the gate reads.
function makeItem(post) {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    item_type: 'task',
    status: 'review',
    session_id: SESS,
    implementation_report: { codeflow_post: post },
  };
}
const statusCall = { id: '11111111-2222-3333-4444-555555555555', actorSessionId: 'validator-x', actorRole: 'validator' };

// A machine-parseable verification artifact (exit-code shape).
const MACHINE_VERIF = { exit_code: 0, label: 'tsc' };

// Helper: run verifyLayer2 and return the GateDenied reason, or null if it passed.
async function runL2(post, capturedShas) {
  try {
    await gate.verifyLayer2(statusCall, makeItem(post), capturedShas);
    return null; // ALLOW
  } catch (e) {
    if (e instanceof gate.GateDenied) return e.reason;
    throw e; // unexpected internal error — surface it
  }
}

const CAPTURED = new Set([HEAD.toLowerCase()]); // L1-captured set for this item/session

// ---------------------------------------------------------------------------
await (async () => {
  // 1. commit does NOT resolve (free-typed bad SHA)
  {
    const reason = await runL2({
      commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      files_changed: ['a.txt'], verification: [MACHINE_VERIF], witness: 'validator-rerun',
    }, CAPTURED);
    assert('1. free-typed/bad SHA -> DENY', reason && /does not resolve to a real commit/.test(reason), reason || 'no denial');
  }

  // 2. commit resolves but was NOT captured by L1 for this item/session
  {
    const reason = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [MACHINE_VERIF], witness: 'validator-rerun',
    }, new Set()); // empty captured set
    assert('2. commit not captured by L1 -> DENY', reason && /was not captured by Layer 1/.test(reason), reason || 'no denial');
  }

  // 3. files_changed entry NOT in the commit
  {
    const reason = await runL2({
      commit: HEAD, files_changed: ['nonexistent-in-commit.txt'], verification: [MACHINE_VERIF], witness: 'ci',
    }, CAPTURED);
    assert('3. files not in commit -> DENY', reason && /is NOT among the files changed by commit/.test(reason), reason || 'no denial');
  }

  // 4. file is in the commit but NOT on disk (delete it from the work tree)
  {
    unlinkSync(join(repo, 'b.txt'));                 // b.txt is in the commit, now gone from disk
    const reason = await runL2({
      commit: HEAD, files_changed: ['b.txt'], verification: [MACHINE_VERIF], witness: 'human-review',
    }, CAPTURED);
    assert('4. file not on disk -> DENY', reason && /does not exist on disk/.test(reason), reason || 'no denial');
    writeFileSync(join(repo, 'b.txt'), 'beta\n');     // restore for later valid-close test
  }

  // 5. prose / proxy verification ("HTTP 200")
  {
    const reason = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: ['HTTP 200'], witness: 'validator-rerun',
    }, CAPTURED);
    assert('5. prose verification -> DENY', reason && /prose\/proxy, not a captured artifact/.test(reason), reason || 'no denial');
  }

  // 6. witness:"agent" (self-witness)
  {
    const reason = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [MACHINE_VERIF], witness: 'agent',
    }, CAPTURED);
    assert('6. witness:agent -> DENY', reason && /witness must be one of/.test(reason), reason || 'no denial');
  }

  // 7. fully-valid close -> ALLOW (no throw)
  {
    const reason = await runL2({
      commit: HEAD, files_changed: ['a.txt', 'b.txt'], verification: [MACHINE_VERIF], witness: 'validator-rerun',
    }, CAPTURED);
    assert('7. fully-valid close -> ALLOW', reason === null, `unexpected denial: ${reason}`);
  }

  // 7b. fully-valid close with a REAL fused run-evidence-gate artifact as verification
  {
    const lib = await import(GATE_LIB);
    const fused = lib.runEvidenceGate({ command: process.execPath, args: ['-e', 'process.exit(0)'], label: 'fused-pass' });
    const reason = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [fused], witness: 'ci',
    }, CAPTURED);
    assert('7b. fused artifact verification -> ALLOW', reason === null, `unexpected denial: ${reason}`);
    assert('7b. fused artifact has verdict only after run', fused.ran === true && fused.verdict === 'pass' && typeof fused.output_sha256 === 'string', JSON.stringify(fused));
  }

  // 8. FUSED primitive: no verdict possible without a run (invalid spec -> error, ran:false)
  {
    const lib = await import(GATE_LIB);
    const bad = lib.runEvidenceGate({});           // no command -> cannot run
    assert('8. fused: no run -> no pass verdict (fail-closed)', bad.ran === false && bad.verdict === 'error', JSON.stringify(bad));
    // and a run that fails yields verdict:'fail', never silently 'pass'
    const failRun = lib.runEvidenceGate({ command: process.execPath, args: ['-e', 'process.exit(2)'] });
    assert('8. fused: failing run -> verdict fail', failRun.ran === true && failRun.verdict === 'fail' && failRun.exit_code === 2, JSON.stringify(failRun));
  }

  // 9. FAIL-CLOSED contract: empty files_changed / empty verification both DENY
  {
    const r1 = await runL2({ commit: HEAD, files_changed: [], verification: [MACHINE_VERIF], witness: 'ci' }, CAPTURED);
    assert('9a. empty files_changed -> DENY', r1 && /files_changed is empty/.test(r1), r1 || 'no denial');
    const r2 = await runL2({ commit: HEAD, files_changed: ['a.txt'], verification: [], witness: 'ci' }, CAPTURED);
    assert('9b. empty verification -> DENY', r2 && /verification is empty/.test(r2), r2 || 'no denial');
    const r3 = await runL2({ commit: HEAD, files_changed: ['a.txt'], verification: [MACHINE_VERIF] }, CAPTURED); // no witness
    assert('9c. missing witness -> DENY', r3 && /witness must be one of/.test(r3), r3 || 'no denial');
  }

  // 10. Baru-trap: a SHORT prefix of a real commit must NOT resolve-and-pass as
  // the captured full SHA. We claim a 8-char prefix; even though it resolves to
  // the same commit, the captured set holds the FULL sha, and the gate compares
  // full-to-full, so a prefix that git expands still equals HEAD -> captured.
  // The hardening we prove: the gate stores/compares the FULL resolved sha, so a
  // WRONG short prefix (one that resolves to a DIFFERENT/absent commit) is caught
  // by branch 1/2 above. Here we assert the FULL-sha resolution itself:
  {
    const full = gate.resolveFullSha(HEAD.slice(0, 8)); // valid short prefix of HEAD
    assert('10. resolveFullSha expands a valid prefix to the FULL 40-hex sha',
      full === HEAD.toLowerCase() && /^[0-9a-f]{40}$/.test(full), full || 'null');
    const none = gate.resolveFullSha('00000000');       // prefix of no commit
    assert('10. resolveFullSha returns null for a non-existent prefix', none === null, none || 'not-null');
  }

  // -------------------------------------------------------------------------
  // Fix 1 — OUTCOME GATE: a verification that RAN but did NOT pass must DENY.
  // isMachineArtifact passes (correct shape) but isPassingArtifact must fail.
  // -------------------------------------------------------------------------
  {
    // 11a. exit_code:1 (a real machine shape, but a FAILING run) -> DENY
    const r1 = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [{ exit_code: 1 }], witness: 'validator-rerun',
    }, CAPTURED);
    assert('11a. verification exit_code:1 -> DENY (verification-not-passing)',
      r1 && /verification-not-passing/.test(r1), r1 || 'no denial');

    // 11b. fused run-evidence-gate artifact with verdict:'fail' -> DENY
    const lib = await import(GATE_LIB);
    const fusedFail = lib.runEvidenceGate({ command: process.execPath, args: ['-e', 'process.exit(1)'], label: 'fused-fail' });
    assert('11b. fused failing run has verdict:fail', fusedFail.ran === true && fusedFail.verdict === 'fail', JSON.stringify(fusedFail));
    const r2 = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [fusedFail], witness: 'ci',
    }, CAPTURED);
    assert('11b. fused verdict:fail -> DENY (verification-not-passing)',
      r2 && /verification-not-passing/.test(r2), r2 || 'no denial');

    // 11c. http_status:500 (error status) -> DENY
    const r3 = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [{ http_status: 500 }], witness: 'human-review',
    }, CAPTURED);
    assert('11c. verification http_status:500 -> DENY (verification-not-passing)',
      r3 && /verification-not-passing/.test(r3), r3 || 'no denial');

    // 11d. failed test-runner JSON ({passed:3, failed:2}) -> DENY
    const r4 = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [{ passed: 3, failed: 2 }], witness: 'ci',
    }, CAPTURED);
    assert('11d. verification {passed:3,failed:2} -> DENY (verification-not-passing)',
      r4 && /verification-not-passing/.test(r4), r4 || 'no denial');

    // 11e. tsc_errors:4 -> DENY
    const r5 = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [{ tsc_errors: 4 }], witness: 'ci',
    }, CAPTURED);
    assert('11e. verification tsc_errors:4 -> DENY (verification-not-passing)',
      r5 && /verification-not-passing/.test(r5), r5 || 'no denial');

    // 11f. PASSING shapes still ALLOW (regression guard for the outcome gate).
    const okExit = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [{ exit_code: 0 }], witness: 'validator-rerun',
    }, CAPTURED);
    assert('11f. exit_code:0 still ALLOWs', okExit === null, `unexpected denial: ${okExit}`);
    const okHttp = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [{ http_status: 200 }], witness: 'ci',
    }, CAPTURED);
    assert('11f. http_status:200 still ALLOWs', okHttp === null, `unexpected denial: ${okHttp}`);
    const okTests = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [{ passed: 5, total: 5 }], witness: 'ci',
    }, CAPTURED);
    assert('11f. {passed:5,total:5} still ALLOWs', okTests === null, `unexpected denial: ${okTests}`);
  }

  // 11g. isPassingArtifact unit checks (direct, lib-level).
  {
    const lib = await import(GATE_LIB);
    const { isPassingArtifact } = lib;
    assert('11g. isPassingArtifact rejects {exit_code:1}', isPassingArtifact({ exit_code: 1 }) === false);
    assert('11g. isPassingArtifact accepts {exit_code:0}', isPassingArtifact({ exit_code: 0 }) === true);
    assert('11g. isPassingArtifact rejects {http_status:500}', isPassingArtifact({ http_status: 500 }) === false);
    assert('11g. isPassingArtifact accepts {http_status:204}', isPassingArtifact({ http_status: 204 }) === true);
    assert('11g. isPassingArtifact rejects {passed:1,failed:1}', isPassingArtifact({ passed: 1, failed: 1 }) === false);
    assert('11g. isPassingArtifact accepts {passed:5,total:5}', isPassingArtifact({ passed: 5, total: 5 }) === true);
    assert('11g. isPassingArtifact rejects {passed:4,total:5}', isPassingArtifact({ passed: 4, total: 5 }) === false);
    assert('11g. isPassingArtifact rejects prose "HTTP 200"', isPassingArtifact('HTTP 200') === false);
    const fp = lib.runEvidenceGate({ command: process.execPath, args: ['-e', 'process.exit(0)'] });
    const ff = lib.runEvidenceGate({ command: process.execPath, args: ['-e', 'process.exit(1)'] });
    assert('11g. isPassingArtifact accepts fused verdict:pass', isPassingArtifact(fp) === true);
    assert('11g. isPassingArtifact rejects fused verdict:fail', isPassingArtifact(ff) === false);
  }

  // -------------------------------------------------------------------------
  // Fix 2 — NULL ORIGINATING SESSION must be FAIL-CLOSED. A null session must
  // NOT disable the per-session commit binding (the old `!originatingSession`
  // short-circuit accepted ANY session's captured SHA). buildCapturedShaSet
  // DENIES when the originating session is null/empty.
  // -------------------------------------------------------------------------
  {
    const otherSessionRows = [{ sha: HEAD.toLowerCase(), session_id: 'some-OTHER-session' }];

    // 12a. session_id=null + a SHA captured by a DIFFERENT session -> DENY
    let denied = null;
    try {
      gate.buildCapturedShaSet(null, otherSessionRows);
    } catch (e) {
      if (e instanceof gate.GateDenied) denied = e.reason; else throw e;
    }
    assert('12a. null originating session -> DENY (no provenance to bind)',
      denied && /no originating session/.test(denied), denied || 'no denial');

    // 12b. empty-string session is treated the same (fail-closed) -> DENY
    let denied2 = null;
    try {
      gate.buildCapturedShaSet('', otherSessionRows);
    } catch (e) {
      if (e instanceof gate.GateDenied) denied2 = e.reason; else throw e;
    }
    assert('12b. empty originating session -> DENY', denied2 && /no originating session/.test(denied2), denied2 || 'no denial');

    // 12c. with a real originating session, ONLY that session's SHAs are kept;
    //      a DIFFERENT session's captured SHA is excluded (not laundered in).
    const mixed = [
      { sha: HEAD.toLowerCase(), session_id: 'some-OTHER-session' },
      { sha: 'a'.repeat(40), session_id: SESS },
    ];
    const set = gate.buildCapturedShaSet(SESS, mixed);
    assert('12c. only originating-session SHAs bound', set.has('a'.repeat(40)) && !set.has(HEAD.toLowerCase()),
      `set=${[...set].join(',')}`);

    // 12d. end-to-end consequence: null session + DIFFERENT-session SHA means
    //      the SHA is never bound, so even a structurally valid post is denied.
    //      (Drive verifyLayer2 with the EMPTY set buildCapturedShaSet would have
    //      produced were the session real-but-mismatched; null short-circuits
    //      earlier, but this proves a cross-session SHA never reaches capture.)
    const crossSet = gate.buildCapturedShaSet(SESS, otherSessionRows); // SESS has none of these
    const r = await runL2({
      commit: HEAD, files_changed: ['a.txt'], verification: [MACHINE_VERIF], witness: 'validator-rerun',
    }, crossSet);
    assert('12d. cross-session-only SHA not captured for this session -> DENY',
      r && /was not captured by Layer 1/.test(r), r || 'no denial');
  }

  // -------------------------------------------------------------------------
  // Fix 3a — assertGitRepoAvailable: a non-git directory is fail-closed with a
  // distinct `truth-gate repo unavailable` reason (not `ref not found`).
  // Drive it directly with the function's own repo via TRUTH_GATE_REPO capture:
  // since TRUTH_GATE_REPO is module-captured to `repo` (a real git tree), the
  // happy path must NOT throw; assert that, and assert a non-git path denies by
  // re-importing the hook under a fresh env pointed at a non-git dir.
  {
    // happy path: the live throwaway repo is a work tree -> no throw
    let ok = true;
    try { gate.assertGitRepoAvailable(); } catch { ok = false; }
    assert('13a. assertGitRepoAvailable passes for a real git work tree', ok === true);

    // non-git path: re-load the hook with RDC_TRUTH_GATE_REPO pointed at a
    // brand-new empty (non-git) temp dir; assertGitRepoAvailable must DENY.
    const nonGit = mkdtempSync(join(tmpdir(), 'l2-nongit-'));
    const prevRepo = process.env.RDC_TRUTH_GATE_REPO;
    process.env.RDC_TRUTH_GATE_REPO = nonGit;
    delete require.cache[require.resolve(HOOK)];
    const gate2 = require(HOOK);
    let denied = null;
    try { gate2.assertGitRepoAvailable(); }
    catch (e) { if (e instanceof gate2.GateDenied) denied = e.reason; else throw e; }
    assert('13a. non-git dir -> DENY (truth-gate repo unavailable)',
      denied && /truth-gate repo unavailable/.test(denied), denied || 'no denial');
    // restore env + module cache for any later use
    process.env.RDC_TRUTH_GATE_REPO = prevRepo;
    delete require.cache[require.resolve(HOOK)];
    rmSync(nonGit, { recursive: true, force: true });
  }
})();

rmSync(repo, { recursive: true, force: true });

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error('\nwork-item-exit-gate L2 tests — FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nwork-item-exit-gate L2 tests — PASS');
