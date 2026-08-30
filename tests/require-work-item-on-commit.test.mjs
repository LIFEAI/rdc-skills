#!/usr/bin/env node
/**
 * Truth Gate L1 — commit-capture hook tests.
 *
 * Proves:
 *   1. parse: the work-item UUID is extracted from a commit message; absent UUID -> null.
 *   2. capture: on a PostToolUse(git commit), the captured `sha` EQUALS the real
 *      `git rev-parse HEAD` of the repo (verified against a throwaway git repo,
 *      via the RDC_COMMIT_CAPTURE_SINK file — no live DB required).
 *   3. no-item: capture NO-OPs (writes nothing) when the commit message carries
 *      no work-item UUID. No orphan row.
 *
 * Run: node tests/require-work-item-on-commit.test.mjs   (or `node --test tests/`)
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOK = join(REPO_ROOT, 'hooks', 'require-work-item-on-commit.js');

const require = createRequire(import.meta.url);
const failures = [];
function assert(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// 1. Pure parse assertions
// ---------------------------------------------------------------------------
const hook = require(HOOK);
const WI = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

assert('parse: extracts UUID from message',
  hook.parseCommitMessageWorkItem(`feat(x): do thing for ${WI}`) === WI);
assert('parse: null when no UUID',
  hook.parseCommitMessageWorkItem('feat(x): no work item here') === null);
assert('isGitCommit: true for real commit',
  hook.isGitCommit('git commit -m "feat: x"') === true);
assert('isGitCommit: false for --help',
  hook.isGitCommit('git commit --help') === false);
assert('isGitCommit: false for unrelated',
  hook.isGitCommit('git status') === false);
assert('commitSucceeded: false on nothing-to-commit',
  hook.commitSucceeded({ stdout: 'nothing to commit, working tree clean' }) === false);
assert('commitSucceeded: true on exit 0',
  hook.commitSucceeded({ exit_code: 0 }) === true);

// ---------------------------------------------------------------------------
// helper: build a throwaway git repo with one commit
// ---------------------------------------------------------------------------
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wic-repo-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  g('init', '-q');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'f.txt'), 'hello\n');
  g('add', 'f.txt');
  g('commit', '-q', '-m', `feat: seed for ${WI}`);
  const head = g('rev-parse', 'HEAD').trim();
  return { dir, head };
}

/**
 * Isolated block ledger — see the same note in foreground-process-gate.test.mjs.
 *
 * This hook records refusals through the guard mitigator, which keys on
 * (rule id, argv shape) and escalates once a shape repeats. Fixtures that
 * deliberately trigger a refusal would otherwise accumulate in the REAL session
 * ledger under %TEMP%/lifeai-guard-blocks and eventually make a genuine refusal
 * report "RULE DEFECT SUSPECTED" against a rule that is working.
 *
 * extraEnv still wins, so a case can override either value deliberately.
 */
const LEDGER = mkdtempSync(join(tmpdir(), 'rwi-ledger-'));

function runHook(payload, extraEnv = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, LIFEAI_GUARD_BLOCK_DIR: LEDGER, RDC_TEST: '1', ...extraEnv },
  });
}

// ---------------------------------------------------------------------------
// 2. Capture: sha == git rev-parse HEAD
// ---------------------------------------------------------------------------
{
  const { dir, head } = makeRepo();
  const sink = join(dir, 'sink.jsonl');
  // Point Supabase at an unreachable host so the test never touches a real DB;
  // capture still writes the sink, which is what we assert on.
  const res = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    session_id: 'sess-capture-1',
    cwd: dir,
    tool_input: { command: `git commit -m "feat: thing for ${WI}"` },
    tool_response: { exit_code: 0, stdout: '1 file changed' },
  }, {
    RDC_COMMIT_CAPTURE_SINK: sink,
    SUPABASE_URL: 'http://127.0.0.1:9',     // unreachable -> DB insert fails fast, capture still records sink
    SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real',
  });
  assert('capture: hook exits zero', res.status === 0, res.stderr);
  assert('capture: sink written', existsSync(sink), 'no sink file');
  if (existsSync(sink)) {
    const row = JSON.parse(readFileSync(sink, 'utf8').trim().split('\n')[0]);
    assert('capture: sha equals real HEAD', row.sha === head, `${row.sha} !== ${head}`);
    assert('capture: work_item_id parsed', row.work_item_id === WI, row.work_item_id);
    assert('capture: session_id recorded', row.session_id === 'sess-capture-1', row.session_id);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 3. No active work item -> NO-OP (no sink row)
// ---------------------------------------------------------------------------
{
  const { dir } = makeRepo();
  const sink = join(dir, 'sink.jsonl');
  const res = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    session_id: 'sess-no-item',
    cwd: dir,
    tool_input: { command: 'git commit -m "feat: no work item ref"' },
    tool_response: { exit_code: 0 },
  }, { RDC_COMMIT_CAPTURE_SINK: sink });
  assert('no-item: hook exits zero', res.status === 0, res.stderr);
  assert('no-item: no sink row written', !existsSync(sink), 'orphan capture written for no-item commit');
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 4. PreToolUse — flow-gated (2026-08-16): BLOCKS when the current flow
//    requires a work item, exempt SILENTLY when it doesn't. Uses a fresh temp
//    dir as HOME/USERPROFILE so no fixit.marker is visible regardless of real
//    machine state, and real RDC_FLOW_STATE/RDC_MODE_STATE temp files so the
//    test exercises the ACTUAL cross-repo dynamic-import path against
//    whatever $LIFEAI_ENV resolves to on this box — not a mock.
// ---------------------------------------------------------------------------
{
  const fakeHome = mkdtempSync(join(tmpdir(), 'wic-home-'));
  const flowState = join(fakeHome, 'flow.json');
  const modeState = join(fakeHome, 'mode.json');
  try {
    const preEnv = { HOME: fakeHome, USERPROFILE: fakeHome, RDC_FLOW_STATE: flowState, RDC_MODE_STATE: modeState };

    // No flow declared -> fail-closed default -> requires a work item -> BLOCK.
    const blocked = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "no convention and no uuid"' },
    }, preEnv);
    assert('pre: no-flow-declared BLOCKS (was: warn, never blocked)',
      JSON.parse(blocked.stdout || '{}').decision === 'block', blocked.stdout || blocked.stderr);

    // Conventional format still passes even when a work item IS required.
    const ok = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat(x): conventional"' },
    }, preEnv);
    assert('pre: conventional passes silently even when required', ok.status === 0 && ok.stdout.trim() === '', ok.stdout);

    // A conversational flow (plan) exempts — silently, no message at all.
    writeFileSync(flowState, JSON.stringify({ flow: 'plan', setBy: 'test', setAt: new Date().toISOString() }));
    const exempt = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "no convention and no uuid"' },
    }, preEnv);
    assert('pre: plan flow exempts silently', exempt.status === 0 && exempt.stdout.trim() === '', exempt.stdout);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 4. The message must be READ before it is judged.
//
// extractCommitMessage used to fall back to the WHOLE COMMAND when there was no
// -m. CONVENTIONAL_TYPES is anchored at ^, so a heredoc commit whose subject was
// a valid `fix(scope): …` could never match — the tested string began with
// `( cd … && git add … && git commit -q -F -`. Measured 2026-08-29: this hook
// blocked a commit whose message DID begin with `fix(guards):` and reported
// "no conventional commit type", which was false.
//
// A heredoc is how every multi-paragraph commit in this fleet is authored, so
// the single path the gate made unusable was the correct one. The load-bearing
// half of this test is the NEGATIVE cases: reading the message must not become
// a way to pass without one.
{
  const { extractCommitMessage } = require(HOOK);
  const CONVENTIONAL = /^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)(\(.+\))?:/i;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const verdict = (cmd) => {
    const { message, readable } = extractCommitMessage(cmd);
    if (!readable) return 'unreadable';
    return CONVENTIONAL.test(message.trim()) || UUID.test(message) ? 'pass' : 'block';
  };

  const realBlockedCommand = `( cd "C:/Dev/lifeai-env.wt/guard-remedy" && git add hooks/lib/guard-rules.mjs && git commit -q -F - <<'EOF'
fix(guards): rtp-steering-grep counted the pipeline next command as a search path

A multi-paragraph body, which is the entire reason -F is being used.
EOF
)`;

  for (const [name, cmd, want] of [
    ['heredoc with a conventional subject passes', realBlockedCommand, 'pass'],
    ['heredoc <<-EOF passes', "git commit -F - <<-EOF\nfix(a): b\nEOF", 'pass'],
    ['heredoc with a quoted delimiter passes', 'git commit -F - <<"MSG"\nfix(a): b\nMSG', 'pass'],
    ['heredoc carrying only a UUID passes', "git commit -F - <<'EOF'\nwip\n\nWork-Item: f27ff5fa-0000-4000-8000-000000000000\nEOF", 'pass'],
    ['-m still passes', 'git commit -m "fix(x): y"', 'pass'],
    // Negative controls — reading the message is not a bypass.
    ['heredoc without a type or UUID still blocks', "git commit -F - <<'EOF'\nrandom words\nEOF", 'block'],
    ['a bare commit still blocks', 'git commit', 'block'],
    // Honest about what it cannot see, rather than calling it absent.
    ['a real stdin pipe reports unreadable', 'cat msg.txt | git commit -q -F -', 'unreadable'],
  ]) {
    assert(`extract: ${name}`, verdict(cmd) === want, `got ${verdict(cmd)}, want ${want}`);
  }

  // -F <path> reads the message off disk.
  const msgFile = join(mkdtempSync(join(tmpdir(), 'wi-msg-')), 'COMMIT_EDITMSG');
  writeFileSync(msgFile, 'refactor(core): tidy\n\nbody\n');
  assert('extract: -F <file> with a type passes', verdict(`git commit -F ${msgFile}`) === 'pass');
  writeFileSync(msgFile, 'no type here\n');
  assert('extract: -F <file> without a type still blocks', verdict(`git commit -F ${msgFile}`) === 'block');
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error('\ncommit-capture hook tests — FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('commit-capture hook tests — PASS');
