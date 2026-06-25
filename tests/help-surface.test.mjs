#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const files = {
  readme: join(root, 'README.md'),
  skillHelp: join(root, 'skills', 'help', 'SKILL.md'),
  commandHelp: join(root, 'commands', 'help.md'),
};

const docs = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, readFileSync(file, 'utf8')]),
);

for (const [name, text] of Object.entries(docs)) {
  assert.match(text, /https:\/\/rdc-skills\.regendevcorp\.com\/mcp/, `${name} must expose production MCP endpoint`);
  assert.match(text, /Accept: application\/json, text\/event-stream/, `${name} must show Streamable HTTP Accept header`);
  assert.match(text, /rdc_skill_list/, `${name} must mention rdc_skill_list`);
  assert.match(text, /rdc_skill_get/, `${name} must mention rdc_skill_get`);
  assert.doesNotMatch(text, /https:\/\/rdc-skills\.dev\.regendevcorp\.com\/mcp/, `${name} must not point callers at dev MCP`);
}

assert.match(docs.skillHelp, /manifest-driven/i, 'skill help should be manifest-driven');
assert.match(docs.commandHelp, /manifest-driven/i, 'command help should be manifest-driven');
assert.doesNotMatch(docs.commandHelp, /Print the full usage menu below verbatim/, 'command help must not use stale static menu wording');
assert.doesNotMatch(docs.commandHelp, /get\/<service>/, 'command help must use current clauth /v/<service> wording');

console.log('help surface tests — PASS');
