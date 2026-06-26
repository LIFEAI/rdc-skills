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
  assert.match(text, /data:/, `${name} must explain Streamable HTTP SSE data lines`);
  assert.match(text, /result\.content\[0\]\.text/, `${name} must explain where tool text lives`);
  assert.match(text, /sed -n 's\/\^data: \/\/p'/, `${name} must include a plain curl SSE extraction example`);
  assert.match(text, /rdc_skill_list/, `${name} must mention rdc_skill_list`);
  assert.match(text, /rdc_skill_search/, `${name} must mention rdc_skill_search`);
  assert.match(text, /rdc_skill_get/, `${name} must mention rdc_skill_get`);
  assert.match(text, /turn this article into social posts/, `${name} must include a natural-language search example`);
  assert.match(text, /"name":"rdc:build"/, `${name} must show rdc_skill_get accepts visible slash names`);
  assert.doesNotMatch(text, /https:\/\/rdc-skills\.dev\.regendevcorp\.com\/mcp/, `${name} must not point callers at dev MCP`);
}

assert.match(docs.readme, /29 MCP skills organized into 8 manifest categories/, 'README should use manifest category count');
assert.match(docs.readme, /Eighteen[\s\S]*\/rdc:\*` command shorthands/i, 'README should distinguish slash-command shorthands from full MCP skills');
assert.match(docs.readme, /Use `rdc_skill_list` for the authoritative live catalog/, 'README should point callers to live MCP catalog');
assert.doesNotMatch(docs.readme, /All user-invocable skills become available as slash commands/, 'README must not imply all MCP skills are slash commands');
assert.doesNotMatch(docs.readme, /29 skills organized into 6 categories/, 'README must not carry stale category count');
assert.match(docs.commandHelp, /menu of all MCP skills/, 'command help should refer to MCP skill catalog');
assert.match(docs.skillHelp, /Show all MCP skills/, 'skill help should refer to MCP skill catalog');
assert.match(docs.skillHelp, /manifest-driven/i, 'skill help should be manifest-driven');
assert.match(docs.commandHelp, /manifest-driven/i, 'command help should be manifest-driven');
assert.doesNotMatch(docs.commandHelp, /Print the full usage menu below verbatim/, 'command help must not use stale static menu wording');
assert.doesNotMatch(docs.commandHelp, /get\/<service>/, 'command help must use current clauth /v/<service> wording');

console.log('help surface tests — PASS');
