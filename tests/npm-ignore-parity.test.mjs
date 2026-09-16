// .npmignore replaces .gitignore for npm. It must carry every .gitignore rule except
// git-sha.json — the pack-time commit stamp that is untracked in git and exists to be
// shipped — or the package either loses the stamp or starts shipping what git ignores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = (file) => new Set(fs.readFileSync(path.join(ROOT, file), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));

test('.npmignore is .gitignore without the commit stamp', () => {
  const git = rules('.gitignore');
  const npm = rules('.npmignore');
  assert.ok(git.has('git-sha.json'), 'the stamp stays out of git');
  assert.ok(!npm.has('git-sha.json'), 'and stays IN the package');
  const expected = [...git].filter((r) => r !== 'git-sha.json').sort();
  assert.deepEqual([...npm].sort(), expected);
});

test('the installer records the stamped commit when it runs from a package with no .git', () => {
  const installer = fs.readFileSync(path.join(ROOT, 'scripts', 'install-rdc-skills.js'), 'utf8');
  assert.match(installer, /git-sha\.json/);
});
