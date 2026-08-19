/**
 * Installing REBUILDS the plugin cache from scratch — a skill removed or renamed
 * upstream must not survive in it.
 *
 * Claude Code registers whatever sits in the plugin cache, so anything left behind
 * there keeps registering. A rename like `skills/rdc-brochurify/` ->
 * `skills/brochurify/` would otherwise leave the old folder in place and the box
 * would register BOTH `rdc:brochurify` and the double-namespaced
 * `rdc:rdc-brochurify` — the shape of the malformed registrations this branch fixes.
 *
 * The installer already gets this right: both call sites `fs.rmSync(latestDir, ...)`
 * immediately before `buildPluginCache(latestDir, ...)`. This test exists to keep it
 * that way, because the guarantee lives in two separate places and neither states
 * that it is load-bearing.
 *
 * WORTH RECORDING, because it nearly went the other way: the first version of this
 * file shipped alongside an "obvious" fix to buildPluginCache — clear each payload
 * directory before copying into it — on the theory that copy-over-merge was leaving
 * the stale folders. Reverting that fix and re-running left the test GREEN, which is
 * what exposed the diagnosis as wrong: the wipe already happens one level up, at the
 * caller. Without that control run, a redundant change and a test that could not
 * detect its own subject would both have shipped, and the real source of the stale
 * registrations would have stayed hidden behind an apparent fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = path.join(ROOT, 'scripts', 'install-rdc-skills.js');

function runInstaller(claudeHome) {
  try {
    return execFileSync(process.execPath, [INSTALLER, '--claude-home', claudeHome, '--skip-hooks'], {
      encoding: 'utf8', timeout: 300_000, cwd: ROOT,
    });
  } catch (err) {
    return `${err.stdout || ''}${err.stderr || ''}`;
  }
}

test('a stale skill directory in the plugin cache does not survive an install', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rdcskills-home-'));

  const first = runInstaller(home);
  // The cache carries a version segment: cache/<marketplace>/<plugin>/<version>/skills
  const cache = path.join(home, 'plugins', 'cache', 'rdc-skills', 'rdc-skills', 'latest', 'skills');
  assert.ok(fs.existsSync(cache), `expected a plugin skills cache — installer said:\n${first.slice(-800)}`);

  // Plant exactly the shape the defect produces: a skill folder that no longer exists
  // upstream, carrying the double-namespaced name.
  const stale = path.join(cache, 'rdc-brochurify');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'SKILL.md'), '---\nname: rdc-brochurify\n---\nstale\n');
  assert.ok(fs.existsSync(stale), 'precondition: decoy planted');

  runInstaller(home);
  assert.ok(!fs.existsSync(stale), 'a skill removed upstream must not survive in the cache');
  assert.ok(
    fs.readdirSync(cache).length > 0,
    'control: the cache must still hold real skills — an empty cache would satisfy the assertion above for the wrong reason',
  );
});

test('no rdc-prefixed skill directory ships in the repo', () => {
  // The plugin is already named `rdc`, so a directory named `rdc-x` registers as
  // `rdc:rdc-x`. This is the source-side half of the same defect, and it is the half
  // that actually produced the malformed names.
  const skills = path.join(ROOT, 'skills');
  const bad = fs.readdirSync(skills).filter((d) => /^rdc-/.test(d));
  assert.deepEqual(bad, [], `these register as rdc:rdc-*: ${bad.join(', ')}`);
});
