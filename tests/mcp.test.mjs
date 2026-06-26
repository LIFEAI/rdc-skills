#!/usr/bin/env node
/**
 * tests/mcp.test.mjs — layered test for the rdc-skills MCP server.
 *
 *   node tests/mcp.test.mjs            # unit + integration (spawns the server)
 *   REMOTE=1 node tests/mcp.test.mjs   # ALSO sweep the live tunnel endpoint
 *
 * Coverage is 100% of skills: every skill in the catalog is fetched through the
 * MCP in BOTH variants and asserted against its on-disk source, and the cloud
 * contract (no `127.0.0.1:52437` daemon URL) is checked for EVERY skill.
 *
 * Layers:
 *   1. unit        — catalog + cloud-rewrite pure functions.
 *   2. integration — spawn `bin/rdc-skills-mcp.mjs` on a test port; exercise
 *                    /health and the full MCP (initialize, tools/list, every
 *                    tool, every skill, error paths) over HTTP, comparing each
 *                    rendered body byte-for-byte to the library's own output.
 *   3. systems     — (REMOTE=1) the same cloud-contract sweep against
 *                    https://rdc-skills.regendevcorp.com/mcp through Cloudflare.
 *
 * Dependency-free: node builtins + the project's own lib + global fetch.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listSkills,
  getSkill,
  skillNames,
  getSkillBody,
  getCloudOverride,
  searchSkills,
  resolveSkillName,
} from '../lib/catalog.mjs';
import { toCloudBody } from '../lib/cloud-rewrite.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'rdc-skills-mcp.mjs');
const TEST_PORT = parseInt(process.env.TEST_PORT || '3197', 10);
const LOCAL = `http://127.0.0.1:${TEST_PORT}`;
const REMOTE_URL = 'https://rdc-skills.regendevcorp.com/mcp';
const UA = 'Mozilla/5.0 (rdc-skills-test)';
const DAEMON = '127.0.0.1:52437';

// ── tiny assert harness ──────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}
function strip(text) {
  // The server prepends `<!-- rdc-skills: ... -->\n\n` to a rendered body.
  return text.replace(/^<!--[^\n]*-->\n\n/, '');
}

// ── MCP-over-HTTP helper (stateless; SSE or JSON response) ───────────────────
async function mcp(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': UA,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (raw.includes('data:')) {
    let out = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) out = JSON.parse(line.slice(5).trim());
    }
    return { status: res.status, json: out };
  }
  return { status: res.status, json: raw ? JSON.parse(raw) : null };
}
function callText(json) {
  return json?.result?.content?.[0]?.text ?? '';
}

// ── 1. UNIT ──────────────────────────────────────────────────────────────────
function unitTests() {
  const cat = listSkills();
  check('unit: catalog non-empty', cat.length >= 20, `got ${cat.length}`);
  check('unit: every entry has name+slash+category+summary field',
    cat.every((s) => s.name && s.slash && s.category && 'summary' in s));
  check('unit: every entry exposes caller metadata fields',
    cat.every((s) => Array.isArray(s.aliases)
      && Array.isArray(s.produces)
      && Array.isArray(s.follows)
      && Array.isArray(s.leads_to)
      && Array.isArray(s.variants)
      && 'default_model' in s
      && 'sandbox_aware' in s
      && 'output_contract' in s
      && 'enabled_default' in s
      && 'codeflow_required' in s));
  check('unit: every entry exposes cli/cloud variants',
    cat.every((s) => JSON.stringify(s.variants) === JSON.stringify(['cli', 'cloud'])));
  check('unit: every rdc slash entry includes leading slash alias',
    cat.every((s) => !s.slash.startsWith('rdc:') || s.aliases.includes(`/${s.slash}`)));
  check('unit: every slash is explicit caller-facing shape',
    cat.every((s) => /^rdc:/.test(s.slash) || s.slash === s.name));
  check('unit: no synthesized duplicate rdc prefixes',
    cat.every((s) => !/^rdc:rdc-/.test(s.slash) && !/^rdc:lifeai-/.test(s.slash)));
  check('unit: getSkill(deploy) resolves', !!getSkill('deploy'));
  check('unit: getSkill(nonexistent) is null', getSkill('___nope___') === null);
  check('unit: search ranks exact name first', searchSkills('deploy')[0]?.name === 'deploy');
  check('unit: empty search returns []', searchSkills('').length === 0);
  check('unit: resolves bare skill name', resolveSkillName('build') === 'build');
  check('unit: resolves rdc slash skill name', resolveSkillName('rdc:build') === 'build');
  check('unit: resolves leading slash command form', resolveSkillName('/rdc:build') === 'build');
  check('unit: resolves specialist slash alias', resolveSkillName('rdc:brochurify') === 'rdc-brochurify');
  check('unit: resolves non-rdc specialist name', resolveSkillName('lifeai-brochure-author') === 'lifeai-brochure-author');

  // Searchability gate — the dimension the first "100% coverage" missed. Every
  // catalog entry MUST carry triggers + usage (frontmatter or skills_meta) so
  // rdc_skill_search can route to it. Caught by an audit: brochurify-suite skills
  // had frontmatter triggers the loader ignored → invisible to search.
  check('unit: every skill has non-empty triggers (searchable)',
    cat.every((s) => Array.isArray(s.when_to_use) && s.when_to_use.length > 0),
    cat.filter((s) => !s.when_to_use?.length).map((s) => s.name).join(',') || 'all good');
  check('unit: every skill has a non-empty usage string',
    cat.every((s) => s.usage && s.usage.length > 0),
    cat.filter((s) => !s.usage).map((s) => s.name).join(',') || 'all good');

  // cloud-rewrite contract
  const sample = '```bash\n_T=$(curl -s http://127.0.0.1:52437/v/coolify-api)\npm2 restart app\n```';
  const rw = toCloudBody(sample);
  check('unit: rewrite strips daemon URL', !rw.includes(DAEMON));
  check('unit: rewrite mentions clauth MCP', rw.includes('clauth MCP'));
  check('unit: rewrite flags CLI-only pm2', rw.includes('CLI-only'));
  check('unit: rewrite guards empty input', toCloudBody('') === '');
}

// ── 2 & 3. shared per-skill sweep over an MCP endpoint ───────────────────────
async function sweep(url, label, { compareSource }) {
  // initialize
  const init = await mcp(url, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rdc-skills-test', version: '1' } },
  });
  check(`${label}: initialize 200`, init.status === 200, `status ${init.status}`);
  check(`${label}: serverInfo name`, init.json?.result?.serverInfo?.name === 'rdc-skills');

  // tools/list
  const tl = await mcp(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const toolNames = (tl.json?.result?.tools || []).map((t) => t.name).sort();
  check(`${label}: exactly 3 expected tools`,
    JSON.stringify(toolNames) === JSON.stringify(['rdc_skill_get', 'rdc_skill_list', 'rdc_skill_search']),
    toolNames.join(','));

  // rdc_skill_list
  const sl = await mcp(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rdc_skill_list', arguments: {} } });
  let listed;
  try { listed = JSON.parse(callText(sl.json)); } catch { listed = { count: 0, skills: [] }; }
  const names = (listed.skills || []).map((s) => s.name);
  check(`${label}: rdc_skill_list count matches`, listed.count === names.length && names.length >= 20, `count ${listed.count}`);
  if (compareSource) {
    check(`${label}: list names == local catalog`, JSON.stringify([...names].sort()) === JSON.stringify(skillNames().sort()));
  }

  // EVERY skill: fetch both variants, assert correctness + cloud contract.
  let rewrittenCount = 0;
  for (const name of names) {
    const cloud = await mcp(url, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'rdc_skill_get', arguments: { name, variant: 'cloud' } } });
    const cloudBody = strip(callText(cloud.json));
    const cli = await mcp(url, { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'rdc_skill_get', arguments: { name, variant: 'cli' } } });
    const cliBody = strip(callText(cli.json));

    check(`${label}: [${name}] cloud body non-empty`, cloudBody.length > 0);
    check(`${label}: [${name}] cli body non-empty`, cliBody.length > 0);
    // CLOUD CONTRACT — no daemon URL, for EVERY skill.
    check(`${label}: [${name}] cloud has NO daemon URL`, !cloudBody.includes(DAEMON),
      cloudBody.includes(DAEMON) ? 'leaked 127.0.0.1:52437' : '');

    if (compareSource) {
      // Correctness: the rendered bodies must equal the library's own output.
      const expectedCli = getSkillBody(name);
      const expectedCloud = getCloudOverride(name) ?? toCloudBody(expectedCli);
      check(`${label}: [${name}] cli body == on-disk source`, cliBody === expectedCli);
      check(`${label}: [${name}] cloud body == toCloudBody(source)/override`, cloudBody === expectedCloud);
      if (expectedCli && expectedCli.includes(DAEMON)) rewrittenCount++;
    }
  }
  if (compareSource) {
    check(`${label}: at least one skill actually had a daemon URL rewritten`, rewrittenCount > 0, `rewritten ${rewrittenCount}`);
  }

  // error path
  const unk = await mcp(url, { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'rdc_skill_get', arguments: { name: '___nope___' } } });
  check(`${label}: unknown skill returns helpful error`, /unknown skill/i.test(callText(unk.json)));

  // Alias path: callers naturally copy the slash form from rdc_skill_list.
  const aliasGet = await mcp(url, { jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'rdc_skill_get', arguments: { name: 'rdc:brochurify', variant: 'cli' } } });
  const aliasBody = strip(callText(aliasGet.json));
  check(`${label}: rdc_skill_get accepts slash aliases`, /rdc:brochurify Orchestrator/.test(aliasBody));

  const jsonGet = await mcp(url, { jsonrpc: '2.0', id: 23, method: 'tools/call', params: { name: 'rdc_skill_get', arguments: { name: 'rdc:build', variant: 'cli', format: 'json' } } });
  let jsonBody; try { jsonBody = JSON.parse(callText(jsonGet.json)); } catch { jsonBody = {}; }
  check(`${label}: rdc_skill_get format=json returns resolved name`, jsonBody.resolved_name === 'build');
  check(`${label}: rdc_skill_get format=json returns metadata`, jsonBody.skill?.slash === 'rdc:build' && jsonBody.skill?.codeflow_required === true);
  check(`${label}: rdc_skill_get format=json returns rendered body`, typeof jsonBody.body === 'string' && jsonBody.body.includes('rdc:build'));

  // search
  const se = await mcp(url, { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'rdc_skill_search', arguments: { query: 'deploy' } } });
  let sr; try { sr = JSON.parse(callText(se.json)); } catch { sr = { results: [] }; }
  check(`${label}: search returns ranked results`, (sr.results || []).length > 0 && sr.results[0].name);
  check(`${label}: search result includes caller metadata`,
    Boolean(sr.results?.[0]?.usage && sr.results?.[0]?.category && Array.isArray(sr.results?.[0]?.variants)));

  return names.length;
}

// ── server lifecycle for integration ─────────────────────────────────────────
async function waitHealth(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.status === 200) return await r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy');
}

async function main() {
  console.log('── unit ──');
  unitTests();

  console.log('── integration (spawned server) ──');
  const proc = spawn('node', [BIN], { env: { ...process.env, PORT: String(TEST_PORT) }, stdio: 'ignore' });
  let swept = 0;
  try {
    const health = await waitHealth(LOCAL);
    check('integration: /health status ok', health.status === 'ok');
    check('integration: /health skill count == catalog', health.skills === listSkills().length, `health ${health.skills} vs ${listSkills().length}`);
    swept = await sweep(`${LOCAL}/mcp`, 'integration', { compareSource: true });
    console.log(`   swept ${swept} skills (both variants)`);
  } finally {
    proc.kill();
  }

  if (process.env.REMOTE || process.argv.includes('--remote')) {
    console.log('── systems (live tunnel) ──');
    const n = await sweep(REMOTE_URL, 'systems', { compareSource: false });
    console.log(`   swept ${n} skills over ${REMOTE_URL}`);
  } else {
    console.log('── systems skipped (set REMOTE=1 to sweep the live endpoint) ──');
  }

  console.log(`\nRESULTS: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('FAILURES:');
    for (const f of failures.slice(0, 40)) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('✓ all green');
  process.exit(0);
}

main().catch((e) => { console.error('test harness error:', e); process.exit(1); });
