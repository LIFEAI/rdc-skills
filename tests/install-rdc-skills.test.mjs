#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const source = readFileSync(script, 'utf8');
assert.match(
  source,
  /Available MCP skills.*\/rdc:\* command shorthands/,
  'installer should distinguish the full MCP skill catalog from slash-command shorthands',
);
assert.match(
  source,
  /rdc_skill_list, rdc_skill_search, and rdc_skill_get/,
  'installer should point raw callers at the MCP discovery tools',
);
assert.match(
  source,
  /no plugin upload needed for MCP/,
  'installer should not imply claude.ai MCP usage requires uploading an artifact',
);

console.log('install-rdc-skills tests — PASS');
