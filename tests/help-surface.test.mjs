#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/**
 * `help` has ONE surface now.
 *
 * It used to ship as both commands/help.md and skills/help/SKILL.md, which is
 * half of why a single verb appeared four times in the command list. The
 * command was removed on 2026-08-29 after checking substance rather than
 * counting lines: the skill already carried the manifest resolution order, the
 * plugin.json path and the slash forms.
 *
 * Kept as a map rather than collapsed to one constant so the loop below still
 * names which document failed — and so restoring a second surface, if that ever
 * becomes right, is one line.
 */
const files = {
  readme: join(root, 'README.md'),
  skillHelp: join(root, 'skills', 'help', 'SKILL.md'),
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
  assert.match(text, /output_contract/, `${name} must describe rdc_skill_list metadata fields`);
  assert.match(text, /codeflow_required/, `${name} must describe CodeFlow metadata`);
  assert.match(text, /variants/, `${name} must describe supported skill variants`);
  assert.match(text, /"format":"json"/, `${name} must show structured rdc_skill_get format=json`);
  assert.match(text, /turn this article into social posts/, `${name} must include a natural-language search example`);
  assert.match(text, /"name":"rdc:build"/, `${name} must show rdc_skill_get accepts visible slash names`);
  assert.doesNotMatch(text, /https:\/\/rdc-skills\.dev\.regendevcorp\.com\/mcp/, `${name} must not point callers at dev MCP`);
}

assert.match(docs.readme, /36 MCP skills organized into 8 manifest categories/, 'README should use manifest category count');
assert.match(docs.readme, /Nineteen[\s\S]*\/rdc:\*` command shorthands/i, 'README should distinguish slash-command shorthands from full MCP skills');
assert.match(docs.readme, /Use `rdc_skill_list` for the authoritative live catalog/, 'README should point callers to live MCP catalog');
assert.doesNotMatch(docs.readme, /All user-invocable skills become available as slash commands/, 'README must not imply all MCP skills are slash commands');
assert.doesNotMatch(docs.readme, /29 skills organized into 6 categories/, 'README must not carry stale category count');
// One surface, so these assert once. They were duplicated across commandHelp
// and skillHelp; the negative pair moves to the surviving document rather than
// being dropped — a stale-wording check is worth keeping regardless of which
// file carries the text.
assert.match(docs.skillHelp, /all MCP skills/, 'skill help should refer to MCP skill catalog');
assert.match(docs.skillHelp, /manifest-driven/i, 'skill help should be manifest-driven');
assert.doesNotMatch(docs.skillHelp, /Print the full usage menu below verbatim/, 'help must not use stale static menu wording');
assert.doesNotMatch(docs.skillHelp, /get\/<service>/, 'help must use current clauth /v/<service> wording');

const skillDirs = readdirSync(join(root, 'skills'))
  .filter((name) => {
    const dir = join(root, 'skills', name);
    return statSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'));
  })
  .sort();
const readmeSkillDirs = [...docs.readme.matchAll(/^\s{2}([A-Za-z0-9_-]+)\/SKILL\.md/gm)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(readmeSkillDirs, skillDirs, 'README File Structure must list every skill directory exactly once');

console.log('help surface tests — PASS');
