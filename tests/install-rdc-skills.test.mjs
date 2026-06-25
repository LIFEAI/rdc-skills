#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const script = join(REPO_ROOT, 'scripts', 'install-rdc-skills.js');

const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);

const toml = spawnSync(process.execPath, [script, '--self-test-codex-mcp-toml'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
assert.equal(toml.status, 0, `${toml.stdout}\n${toml.stderr}`);
assert.match(toml.stdout, /PASS/);

console.log('install-rdc-skills tests — PASS');
