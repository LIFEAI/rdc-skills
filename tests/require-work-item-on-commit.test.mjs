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

function runHook(payload, extraEnv = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
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
// 4. PreToolUse legacy behavior preserved (warn-only, never blocks)
// ---------------------------------------------------------------------------
{
  const res = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "no convention and no uuid"' },
  });
  assert('pre: warn exits zero (never blocks)', res.status === 0, res.stderr);
  assert('pre: emits warn systemMessage', /no work item reference/.test(res.stdout), res.stdout);

  const ok = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat(x): conventional"' },
  });
  assert('pre: conventional passes silently', ok.status === 0 && ok.stdout.trim() === '', ok.stdout);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error('\ncommit-capture hook tests — FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('commit-capture hook tests — PASS');
