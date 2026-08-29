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
// A hardcoded magic number here (previously 36, silently stale against the
// real 43) rots the instant a skill is added or removed and stops proving
// anything — it only proves someone remembered to bump a number. Assert
// against the actual skills/ directory instead: every dir containing a
// SKILL.md must be represented in plugin.json's skills_meta, and vice versa.
const skillsDir = join(REPO_ROOT, 'skills');
const realSkillDirs = require('node:fs')
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
  .map((e) => e.name)
  .sort();
assert.equal(
  skillCount,
  realSkillDirs.length,
  `plugin.json skills_meta (${skillCount}) must match the actual skill directories on disk (${realSkillDirs.length}): ${realSkillDirs.join(', ')}`,
);
// The listing must report EVERY /rdc:* verb, and say which surface each comes
// from. It used to enumerate commands/ only, which was harmless while every verb
// shipped as both a command and a skill — and became actively misleading the
// moment the duplicates were removed (2026-08-29): the printed surface fell from
// 32 to 13 while the real surface was unchanged, because a skill provides the
// slash form on its own (verified live: commands/status.md deleted, rdc:status
// still resolved). A listing that under-reports by 43 verbs reads as "those
// commands are gone".
assert.match(
  source,
  /Available \/rdc:\* verbs/,
  'installer should list every /rdc:* verb, not only the command-backed ones',
);
assert.match(
  source,
  /command, \$\{[^}]*\} skill/,
  'installer should say how many verbs come from commands and how many from skills',
);
assert.match(
  source,
  /readdirSync\(skillDir, \{ withFileTypes: true \}\)/,
  'installer should enumerate the real skill directories, not a manifest count that can drift from disk',
);
assert.match(
  source,
  /SKILL\.md'\)\)\) continue/,
  'installer must skip a directory with no SKILL.md — tests/ is a fixture dir, not a skill',
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

// Regression for the 2026-08-23 incident: a marketplace clone with ZERO real
// local edits — only a stray untracked file — sat 39+ commits behind for over
// a week because `git status --porcelain` (which also reports untracked
// files) was treated as "has local changes, never touch it". `git reset
// --hard` never touches untracked files, so an untracked file is irrelevant
// to whether the sync is safe. This builds a real origin + clone pair,
// reproduces the exact scenario, and asserts the clone actually advances.
const { syncMarketplaceCheckout } = require(script);
const gitTestRoot = mkdtempSync(join(tmpdir(), 'rdc-marketplace-sync-'));
try {
  const originDir = join(gitTestRoot, 'origin');
  const cloneDir = join(gitTestRoot, 'clone');
  const runGit = (cwd, args) => {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
    return res.stdout.trim();
  };

  mkdirSync(originDir, { recursive: true });
  runGit(originDir, ['init', '--initial-branch=master']);
  runGit(originDir, ['config', 'user.email', 'test@example.com']);
  runGit(originDir, ['config', 'user.name', 'Test']);
  writeFileSync(join(originDir, 'file.txt'), 'v1\n');
  runGit(originDir, ['add', '.']);
  runGit(originDir, ['commit', '-m', 'v1']);

  runGit(gitTestRoot, ['clone', originDir, cloneDir]);

  // Advance origin so the clone is genuinely behind.
  writeFileSync(join(originDir, 'file.txt'), 'v2\n');
  runGit(originDir, ['add', '.']);
  runGit(originDir, ['commit', '-m', 'v2']);
  const originHead = runGit(originDir, ['rev-parse', 'HEAD']);

  // The exact reproduction: a stray UNTRACKED file, nothing modified/staged.
  writeFileSync(join(cloneDir, 'some-local-cruft.cjs'), 'module.exports = {};\n');
  assert.match(
    runGit(cloneDir, ['status', '--porcelain']),
    /^\?\? some-local-cruft\.cjs$/,
    'precondition: clone must show ONLY an untracked file, nothing modified',
  );

  syncMarketplaceCheckout(cloneDir);

  assert.equal(
    runGit(cloneDir, ['rev-parse', 'HEAD']),
    originHead,
    'a clone with only an untracked file must still advance to origin — untracked cruft is not a local edit',
  );
  assert.equal(
    existsSync(join(cloneDir, 'some-local-cruft.cjs')),
    true,
    'the untracked file itself must survive the sync — reset --hard never touches it',
  );

  // Genuine dirt — a MODIFIED tracked file — must still block the sync.
  writeFileSync(join(originDir, 'file.txt'), 'v3\n');
  runGit(originDir, ['add', '.']);
  runGit(originDir, ['commit', '-m', 'v3']);
  const originHeadV3 = runGit(originDir, ['rev-parse', 'HEAD']);
  writeFileSync(join(cloneDir, 'file.txt'), 'local edit, never committed\n');
  const beforeDirtySync = runGit(cloneDir, ['rev-parse', 'HEAD']);

  syncMarketplaceCheckout(cloneDir);

  assert.equal(
    runGit(cloneDir, ['rev-parse', 'HEAD']),
    beforeDirtySync,
    'a real local edit to a TRACKED file must still block the sync (PRESERVE-DIRTY)',
  );
  assert.notEqual(beforeDirtySync, originHeadV3, 'sanity: origin did advance further in this step');
} finally {
  rmSync(gitTestRoot, { recursive: true, force: true });
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
