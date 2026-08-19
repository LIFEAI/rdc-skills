#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const script = join(REPO_ROOT, 'scripts', 'install-rdc-skills.js');
const liveVerifier = join(REPO_ROOT, 'scripts', 'verify-live-install.mjs');
const require = createRequire(import.meta.url);

const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);

const toml = spawnSync(process.execPath, [script, '--self-test-codex-mcp-toml'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
assert.equal(toml.status, 0, `${toml.stdout}\n${toml.stderr}`);
assert.match(toml.stdout, /PASS/);

const source = readFileSync(script, 'utf8');
const plugin = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
assert.equal(
  plugin.version,
  packageJson.version,
  'plugin manifest version must match the published package version',
);
const packageLockPath = join(REPO_ROOT, 'package-lock.json');
assert.equal(existsSync(packageLockPath), true, 'systemd deployment requires a committed package-lock.json for npm ci');
const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
assert.equal(packageLock.version, packageJson.version, 'package-lock version must match package.json');
const systemdInstaller = readFileSync(join(REPO_ROOT, 'deploy', 'install-systemd.sh'), 'utf8');
assert.match(
  systemdInstaller,
  /npm ci --omit=dev --no-audit --no-fund/,
  'systemd installer must install the locked production dependency graph before starting the MCP',
);
const skillCount = Array.isArray(plugin.skills_meta)
  ? plugin.skills_meta.length
  : Object.keys(plugin.skills_meta || {}).length;
assert.equal(skillCount, 36, 'test fixture should expose all 36 MCP skills from plugin skills_meta');
assert.match(
  source,
  /Available MCP skills.*\/rdc:\* command shorthands/,
  'installer should distinguish the full MCP skill catalog from slash-command shorthands',
);
assert.match(
  source,
  /Object\.keys\(plugin\.skills_meta\)\.length/,
  'installer should count object-shaped skills_meta manifests',
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
assert.ok(
  source.indexOf('const mcpReg = registerMcpEndpoints();') < source.indexOf('const codexTargets = findCodexTargets();'),
  'installer must establish the Codex MCP endpoint before removing file-based skills',
);
assert.match(
  source,
  /if \(!mcpReg\.codexReady\)[\s\S]*retaining file-based skills/,
  'installer must fail closed and retain file-based skills when MCP registration fails',
);
assert.match(
  source,
  /const mode = fs\.existsSync\(codexToml\)[\s\S]*fs\.chmodSync\(tmp, mode\)[\s\S]*finally[\s\S]*fs\.unlinkSync\(tmp\)/,
  'Codex config replacement must preserve permissions and remove failed temporary copies',
);

const { registerCodexTarget } = require(script);
const codexSkills = mkdtempSync(join(tmpdir(), 'rdc-codex-skills-'));
try {
  mkdirSync(join(codexSkills, 'rdc-build'), { recursive: true });
  writeFileSync(join(codexSkills, 'rdc-build', 'SKILL.md'), '---\nname: rdc:build\n---\n');
  mkdirSync(join(codexSkills, 'legacy-name'), { recursive: true });
  writeFileSync(join(codexSkills, 'legacy-name', 'SKILL.md'), '---\nname: rdc:plan\n---\n');
  mkdirSync(join(codexSkills, 'keep-me'), { recursive: true });
  writeFileSync(join(codexSkills, 'keep-me', 'SKILL.md'), '---\nname: local:keep\n---\n');

  const migrated = registerCodexTarget(codexSkills);
  assert.deepEqual(migrated, { removed: 2, copied: 0 });
  assert.equal(readFileSync(join(codexSkills, 'keep-me', 'SKILL.md'), 'utf8').includes('local:keep'), true);
} finally {
  rmSync(codexSkills, { recursive: true, force: true });
}

const packagedRoot = mkdtempSync(join(tmpdir(), 'rdc-packaged-truth-'));
try {
  writeFileSync(join(packagedRoot, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  mkdirSync(join(packagedRoot, 'skills', 'first'), { recursive: true });
  writeFileSync(join(packagedRoot, 'skills', 'first', 'SKILL.md'), '---\nname: rdc:first\n---\n');
  mkdirSync(join(packagedRoot, 'skills', 'second'), { recursive: true });
  writeFileSync(join(packagedRoot, 'skills', 'second', 'SKILL.md'), '---\nname: rdc:second\n---\n');

  const packagedTruth = spawnSync(process.execPath, [liveVerifier, '--self-test-source-of-truth'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, RDC_SKILLS_ROOT: packagedRoot },
  });
  assert.equal(packagedTruth.status, 0, `${packagedTruth.stdout}\n${packagedTruth.stderr}`);
  assert.deepEqual(JSON.parse(packagedTruth.stdout), {
    sha: null,
    shortSha: 'package',
    version: '9.9.9',
    skillCount: 2,
    authority: 'installed npm package',
  });
} finally {
  rmSync(packagedRoot, { recursive: true, force: true });
}

console.log('install-rdc-skills tests — PASS');
