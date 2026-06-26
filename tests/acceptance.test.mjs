#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const script = join(REPO_ROOT, 'scripts', 'acceptance.mjs');

const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);

const missing = spawnSync(process.execPath, [script, '--skill', 'rdc:not-a-real-skill'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
assert.equal(missing.status, 1);
assert.match(missing.stderr, /missing acceptance manifest/);

const codex = spawnSync(process.execPath, [script, '--engine', 'codex', '--skill', 'rdc:not-a-real-skill'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
assert.equal(codex.status, 1);
assert.doesNotMatch(codex.stderr, /not wired/i);
assert.match(codex.stderr, /missing acceptance manifest/);

const emptyProject = mkdtempSync(join(tmpdir(), 'rdc-acceptance-empty-'));
try {
  const none = spawnSync(process.execPath, [script, '--changed', '--base', 'HEAD', '--project-root', emptyProject], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(none.status, 0);
} finally {
  rmSync(emptyProject, { recursive: true, force: true });
}

console.log('acceptance tests — PASS');
