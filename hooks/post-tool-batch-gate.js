#!/usr/bin/env node
/**
 * post-tool-batch-gate.js — Truth Gate 3.0 Layer 5 (per-wave batch gate).
 *
 * Registered on the `PostToolBatch` event — it fires after a full batch of
 * parallel tool calls resolves, BEFORE the next model call. Per the Claude Code
 * hooks reference, `PostToolBatch` CAN block (exit code 2 stops the agentic
 * loop). After a parallel build wave (multiple Agent dispatches into isolated
 * worktrees), this gate asserts the wave's worktree bases are sane — every agent
 * worktree must be based on the current `develop` HEAD — so a stale-base wave
 * cannot feed fabricated/diverged closures into the next model turn.
 *
 * ⛔ FLAG-GATED, DEFAULT OFF. Until the flag is flipped at deploy this hook is a
 * pure no-op (exit 0) so the in-flight build session is NOT disrupted. When the
 * flag is ON it is FAIL-CLOSED: an inability to confirm worktree-base sanity is
 * a BLOCK, never a silent pass.
 *
 * Flag (default OFF):
 *   - env RDC_TRUTHGATE_POSTTOOLBATCH in {1,true,on,yes}.
 *
 * Worktree-base sanity, per worktree:
 *   - resolve develop HEAD: `git rev-parse refs/heads/develop` in the main repo.
 *   - for each linked worktree (`git worktree list --porcelain`), its base must
 *     equal develop HEAD — i.e. develop is an ancestor of the worktree HEAD
 *     (`git merge-base --is-ancestor <developHead> <worktreeHead>`), OR the
 *     worktree HEAD already IS develop HEAD. A worktree whose base predates the
 *     current develop HEAD is STALE and the wave is flagged.
 *
 * Test seam: inject the git surface via the exported pure `evaluateWave({
 * developHead, worktrees, isAncestor })`, where `worktrees` is
 * [{ path, head }] and `isAncestor(a,b)` returns whether a is an ancestor of b.
 * The pure evaluator has no process/network dependency, so the flag-OFF no-op
 * and the stale-base FLAG branches are provable offline.
 */
'use strict';

const { execFileSync } = require('child_process');
const hookLog = require('./hook-logger');

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
const MAIN_REPO = process.env.RDC_TRUTH_GATE_REPO || 'C:/Dev/regen-root';

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.resume();
  });
}

/** Block the batch with exit code 2 (the blocking semantics for PostToolBatch). */
function block(reason, details = {}) {
  hookLog('post-tool-batch-gate', 'PostToolBatch', 'block', { reason, ...details });
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `BUILD WAVE FLAGGED — Truth Gate Layer 5 (PostToolBatch).\n\n${reason}`,
  }));
  process.stderr.write(`BUILD WAVE FLAGGED: ${reason}\n`);
  process.exit(2);
}

function pass(details = {}) {
  hookLog('post-tool-batch-gate', 'PostToolBatch', 'pass', details);
  process.exit(0);
}

/** Default OFF. Only the env switch enables it (test-stable, deploy-flippable). */
function flagEnabledEnv() {
  const v = String(process.env.RDC_TRUTHGATE_POSTTOOLBATCH || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function git(args, { cwd = MAIN_REPO, allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

/** Resolve develop's HEAD SHA in the main repo, or null. */
function developHead() {
  const sha = git(['rev-parse', '--verify', '--quiet', 'refs/heads/develop'], { allowFail: true });
  return sha && FULL_SHA_RE.test(sha) ? sha.toLowerCase() : null;
}

/** Parse `git worktree list --porcelain` into [{ path, head }] (linked only). */
function listWorktrees() {
  const out = git(['worktree', 'list', '--porcelain'], { allowFail: true });
  if (out == null) return null;
  const worktrees = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) worktrees.push(cur);
      cur = { path: line.slice('worktree '.length).trim(), head: null, bare: false };
    } else if (line.startsWith('HEAD ')) {
      if (cur) cur.head = line.slice('HEAD '.length).trim().toLowerCase();
    } else if (line.trim() === 'bare') {
      if (cur) cur.bare = true;
    }
  }
  if (cur) worktrees.push(cur);
  // Linked worktrees only: drop the bare entry and the primary checkout (== MAIN_REPO).
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const mainNorm = norm(MAIN_REPO);
  return worktrees.filter((w) => !w.bare && w.head && norm(w.path) !== mainNorm);
}

/** True when `git merge-base --is-ancestor a b` (a is an ancestor of b). */
function isAncestor(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // exit 0 = ancestor, exit 1 = not. allowFail captures the non-zero exit.
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], {
      cwd: MAIN_REPO,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Pure wave evaluator (unit-testable, no process/network). Returns
 * { stale: [{ path, head }], ok: boolean }. A worktree is STALE when develop
 * HEAD is NOT an ancestor of its HEAD (its base predates current develop), and
 * its HEAD is not develop HEAD itself.
 *
 * @param {object} surface
 * @param {string|null}            surface.developHead  develop HEAD SHA (null → cannot evaluate)
 * @param {Array<{path,head}>}     surface.worktrees    linked worktrees
 * @param {(a:string,b:string)=>boolean} surface.isAncestor
 */
function evaluateWave({ developHead, worktrees, isAncestor: anc }) {
  if (!developHead) {
    return { ok: false, cannotEvaluate: true, stale: [] };
  }
  const list = Array.isArray(worktrees) ? worktrees : [];
  const stale = [];
  for (const w of list) {
    if (!w || !w.head) continue;
    const based = w.head === developHead || anc(developHead, w.head);
    if (!based) stale.push({ path: w.path, head: w.head });
  }
  return { ok: stale.length === 0, cannotEvaluate: false, stale };
}

async function main() {
  // Drain stdin (PostToolBatch payload) — we don't need its body, but the event
  // delivers JSON on stdin and the process should consume it cleanly.
  try { await readStdin(); } catch (_) {}

  // Default-OFF: a no-op until the flag is flipped at deploy.
  if (!flagEnabledEnv()) return pass({ reason: 'flag-off' });

  // FAIL-CLOSED from here.
  const head = developHead();
  const worktrees = listWorktrees();
  if (head == null || worktrees == null) {
    block(
      `Could not read git state in ${MAIN_REPO} (develop HEAD or worktree list unavailable). ` +
      `Fail-closed: cannot confirm the build wave's worktree bases are current.`,
    );
  }

  const verdict = evaluateWave({ developHead: head, worktrees, isAncestor });
  if (verdict.cannotEvaluate) {
    block(`develop HEAD could not be resolved; fail-closed — cannot confirm worktree-base sanity for this wave.`);
  }
  if (!verdict.ok) {
    const lines = verdict.stale.map((s) => `  - ${s.path} @ ${s.head.slice(0, 9)} (base predates develop ${head.slice(0, 9)})`).join('\n');
    block(
      `One or more build-wave worktrees are NOT based on the current develop HEAD ${head.slice(0, 9)}:\n${lines}\n\n` +
      `A wave built on a stale base can feed diverged/fabricated closures into the next turn. ` +
      `Rebase each worktree onto develop (git fetch && git rebase origin/develop), re-run its verification, then continue.`,
      { developHead: head, stale: verdict.stale },
    );
  }

  pass({ developHead: head, worktreeCount: worktrees.length });
}

if (require.main === module) {
  main().catch((e) => block(`post-tool-batch-gate crashed: ${e.message}`));
} else {
  module.exports = {
    flagEnabledEnv,
    evaluateWave,
    listWorktrees,
    developHead,
  };
}
