#!/usr/bin/env node
/**
 * The duplicate-skill purge — the predicate, not the plumbing.
 *
 * cleanUserSkills() and cleanGlobalSkillsRoot() removed an entry only when its
 * frontmatter name startsWith('rdc:'). Skills were later renamed to bare names
 * (`name: build`), and measured 2026-08-30 exactly 0 of 44 shipped skills carry
 * an rdc: prefix. So the purge matched nothing and removed nothing, while
 * reporting 0 — indistinguishable from "there was nothing to remove".
 *
 * The first test below is the one that was failing in production and could not
 * fail here, because nothing asserted the bare-name case. The rest exist so the
 * fix cannot over-reach: a user's own skill must survive even when it shares a
 * name with one we ship.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { isRdcSkillDuplicate, cleanUserSkills, cleanGlobalSkillsRoot, shippedSkillNames } =
  require(join(REPO_ROOT, 'scripts', 'install-rdc-skills.js'));

const MARKER = 'guides/output-contract.md';
let sandbox;
function fresh() {
  sandbox = mkdtempSync(join(tmpdir(), 'rdc-purge-'));
  return sandbox;
}
function skillDir(root, name, body) {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), body);
  return d;
}
function fm(name, extra = '') {
  return `---\nname: ${name}\ndescription: test fixture\n---\n\n${extra}\n`;
}

// ── 0. the shipped set is real, not empty ────────────────────────────────────
// If this is empty every other assertion below passes vacuously.
const shipped = shippedSkillNames();
assert.ok(shipped.size > 10, `shippedSkillNames() returned ${shipped.size} — too few to be real`);
assert.ok(shipped.has('build'), 'expected "build" among shipped skill names');

// ── 1. THE REGRESSION: a bare-named copy of a skill we ship is a duplicate ───
// This is precisely what the old startsWith('rdc:') predicate could not see.
{
  const root = fresh();
  const d = skillDir(root, 'build', fm('build', `> OUTPUT CONTRACT: \`${MARKER}\``));
  assert.equal(isRdcSkillDuplicate(d, join(d, 'SKILL.md')), true,
    'a bare-named copy of a shipped skill must be detected as a duplicate');
  const removed = cleanUserSkills(root);
  assert.equal(removed, 1, 'cleanUserSkills should remove exactly the duplicate');
  assert.equal(existsSync(d), false, 'the duplicate directory should be gone');
  rmSync(root, { recursive: true, force: true });
}

// ── 2. legacy rdc:-prefixed entries still get cleaned ────────────────────────
// Pre-rename installs are the machines this function was originally written for.
{
  const root = fresh();
  const d = skillDir(root, 'rdc-build', fm('rdc:build'));
  assert.equal(isRdcSkillDuplicate(d, join(d, 'SKILL.md')), true, 'legacy rdc: prefix must still match');
  assert.equal(cleanUserSkills(root), 1);
  assert.equal(existsSync(d), false);
  rmSync(root, { recursive: true, force: true });
}

// ── 3. SAFETY: a user's own skill with an unrelated name survives ────────────
{
  const root = fresh();
  const d = skillDir(root, 'leaflet-maps', fm('leaflet-maps'));
  assert.equal(isRdcSkillDuplicate(d, join(d, 'SKILL.md')), false);
  assert.equal(cleanUserSkills(root), 0, 'must not touch a user skill');
  assert.equal(existsSync(d), true, "the user's own skill must survive");
  rmSync(root, { recursive: true, force: true });
}

// ── 4. SAFETY: a shipped NAME alone is not enough to delete ──────────────────
// Someone may legitimately write their own skill called "build". Name plus our
// marker is required; name alone must never be sufficient.
{
  const root = fresh();
  const d = skillDir(root, 'build', fm('build', 'my own build skill, nothing to do with rdc'));
  assert.equal(isRdcSkillDuplicate(d, join(d, 'SKILL.md')), false,
    'shipped name WITHOUT our marker must not be treated as ours');
  assert.equal(cleanUserSkills(root), 0);
  assert.equal(existsSync(d), true);
  rmSync(root, { recursive: true, force: true });
}

// ── 5. a symlink into our own skills/ tree is unambiguously ours ─────────────
// Skipped where the platform refuses symlink creation without privileges; the
// skip is loud, so it can never be mistaken for a pass.
{
  const root = fresh();
  const target = join(REPO_ROOT, 'skills', 'build');
  let made = true;
  try { symlinkSync(target, join(root, 'build'), 'junction'); }
  catch { made = false; }
  if (made) {
    assert.equal(isRdcSkillDuplicate(join(root, 'build'), join(root, 'build', 'SKILL.md')), true,
      'a symlink resolving inside our skills/ tree must be detected');
  } else {
    console.log('  SKIP symlink case — platform refused symlink creation');
  }
  rmSync(root, { recursive: true, force: true });
}

// ── 6. cleanGlobalSkillsRoot: flat .md orphans at the top level ─────────────
{
  const root = fresh();
  const flat = join(root, 'build.md');
  writeFileSync(flat, fm('build', `> OUTPUT CONTRACT: \`${MARKER}\``));
  const mine = join(root, 'coolify-verify.md');
  writeFileSync(mine, fm('coolify-verify'));
  const removed = cleanGlobalSkillsRoot(root);
  assert.equal(removed, 1, 'exactly the rdc orphan should go');
  assert.equal(existsSync(flat), false, 'flat rdc orphan should be removed');
  assert.equal(existsSync(mine), true, "the user's own flat skill must survive");
  rmSync(root, { recursive: true, force: true });
}

// ── 7. absent directory is not an error ──────────────────────────────────────
assert.equal(cleanUserSkills(join(tmpdir(), 'rdc-purge-does-not-exist')), 0);
assert.equal(cleanGlobalSkillsRoot(join(tmpdir(), 'rdc-purge-does-not-exist')), 0);

console.log('install-rdc-skills duplicate-purge test — PASS');
