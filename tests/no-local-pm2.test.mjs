import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('SessionStart verifies package files without a local MCP or PM2', () => {
  const hook = read('hooks/check-rdc-environment.js');
  assert.doesNotMatch(hook, /\bpm2\b/i);
  assert.doesNotMatch(hook, /127\.0\.0\.1:3110/);
  assert.doesNotMatch(hook, /rdc-skills-mcp/);
  assert.match(hook, /global package missing/);
  assert.match(hook, /rdc-skills-install/);
});

test('installer registers the public MCP and never launches a process manager', () => {
  const installer = read('scripts/install-rdc-skills.js');
  assert.match(installer, /https:\/\/rdc-skills\.regendevcorp\.com\/mcp/);
  assert.doesNotMatch(installer, /\bpm2\b/i);
  assert.doesNotMatch(installer, /127\.0\.0\.1:3110/);
});

test('environment skill and release contract preserve the runtime boundary', () => {
  for (const relative of ['skills/env/SKILL.md', 'RELEASE.md']) {
    const content = read(relative);
    assert.doesNotMatch(content, /\bpm2\s+(start|stop|restart|resurrect|jlist|list|ping)\b/i);
    assert.match(content, /public.*rdc-skills MCP/is);
  }
});

test('legacy local PM2 helpers are absent', () => {
  for (const relative of [
    'scripts/local-install-with-stop.sh',
    'scripts/probe-lock-holders.mjs',
    'scripts/rebuild-mcp.mjs',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, relative)), false, `${relative} still exists`);
  }

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['rebuild-mcp'], undefined);
});
