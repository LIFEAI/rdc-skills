#!/usr/bin/env node
/**
 * Contract/system test for rdc:channel-formatter content repurposing.
 *
 * This does not test LLM prose generation. rdc:channel-formatter is an
 * instruction skill served by the MCP, not an executable formatter function.
 * What this test proves is that local and live MCP discovery return the
 * expected skill and that the served skill body contains the required
 * social-pack, campaign-pack, and source-fidelity contracts an agent must obey.
 *
 * Every MCP call is written to a JSONL audit log under .rdc/reports/.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSkillBody, listSkills, searchSkills } from '../lib/catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'rdc-skills-mcp.mjs');
const TEST_PORT = parseInt(process.env.TEST_PORT || '3198', 10);
const LOCAL = `http://127.0.0.1:${TEST_PORT}/mcp`;
const LOCAL_HEALTH = `http://127.0.0.1:${TEST_PORT}/health`;
const REMOTE = 'https://rdc-skills.regendevcorp.com/mcp';
const REPORT_DIR = path.join(REPO_ROOT, '.rdc', 'reports');
const REPORT_FILE = path.join(
  REPORT_DIR,
  `channel-formatter-contract-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
);

fs.mkdirSync(REPORT_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];

function log(event) {
  fs.appendFileSync(REPORT_FILE, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    log({ kind: 'assertion', name, status: 'pass', detail });
  } else {
    fail++;
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
    log({ kind: 'assertion', name, status: 'fail', detail });
  }
}

function resultText(json) {
  return json?.result?.content?.[0]?.text || '';
}

function summarizeText(text) {
  return {
    length: text.length,
    hasChannelFormatter: text.includes('channel-formatter'),
    hasSocialPack: text.includes('social-pack'),
    hasCampaignPack: text.includes('campaign-pack'),
    hasStrictFormat: text.includes('strict-format'),
    hasSourceFidelity: text.includes('Source-Fidelity'),
    hasUnsupportedClaims: text.includes('unsupported claims') || text.includes('Do not invent statistics'),
    hasChannelPackUsage: text.includes('<channel|pack>'),
    hasLinkedIn: text.includes('LinkedIn'),
    hasTwitterThread: text.includes('Twitter/X thread'),
    hasSlack: text.includes('Slack/Teams'),
  };
}

async function mcp(url, label, body) {
  const request = {
    method: body.method,
    tool: body.params?.name || null,
    arguments: body.params?.arguments || null,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'rdc-channel-formatter-contract-test',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json = null;
  if (raw.includes('data:')) {
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) json = JSON.parse(line.slice(5).trim());
    }
  } else if (raw.trim()) {
    json = JSON.parse(raw);
  }
  const text = resultText(json);
  log({
    kind: 'mcp_call',
    label,
    url,
    request,
    status: res.status,
    response: {
      hasError: Boolean(json?.error),
      text: summarizeText(text),
      resultKeys: json?.result ? Object.keys(json.result) : [],
    },
  });
  return { status: res.status, json, text };
}

async function waitHealth(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`health check timed out: ${url}`);
}

function inspectFormatterBody(body, prefix) {
  const required = [
    ['usage <channel|pack>', '<channel|pack>'],
    ['social-pack mode', 'social-pack'],
    ['campaign-pack mode', 'campaign-pack'],
    ['exec-pack mode', 'exec-pack'],
    ['launch-pack mode', 'launch-pack'],
    ['strict-format mode', 'strict-format'],
    ['long-source extraction', 'Long-Source Extraction'],
    ['source-fidelity rules', 'Source-Fidelity'],
    ['unsupported-claims guard', 'unsupported claims'],
    ['LinkedIn pack output', 'LinkedIn thought-leadership post'],
    ['Twitter thread pack output', 'Twitter/X thread'],
    ['Slack pack output', 'Slack/Teams internal share'],
    ['convert delegate', 'rdc:convert'],
    ['brochure delegate', 'rdc:brochure'],
    ['brochurify delegate', 'rdc:brochurify'],
    ['brochure author delegate', 'lifeai-brochure-author'],
  ];
  for (const [name, needle] of required) {
    check(`${prefix}: body contains ${name}`, body.includes(needle), needle);
  }
}

function unitChecks() {
  const names = listSkills().map((skill) => skill.name);
  check('unit: channel-formatter in local catalog', names.includes('channel-formatter'));
  for (const specialist of ['convert', 'brochure', 'rdc-brochurify', 'lifeai-brochure-author']) {
    check(`unit: specialist present ${specialist}`, names.includes(specialist));
  }
  const results = searchSkills('turn this article into social posts');
  check('unit: search top hit is channel-formatter', results[0]?.name === 'channel-formatter', results[0]?.name || 'none');
  inspectFormatterBody(getSkillBody('channel-formatter') || '', 'unit');
}

async function endpointChecks(url, label) {
  await mcp(url, label, {
    jsonrpc: '2.0',
    id: `${label}-init`,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'rdc-channel-formatter-contract-test', version: '1' },
    },
  });

  const list = await mcp(url, label, {
    jsonrpc: '2.0',
    id: `${label}-list`,
    method: 'tools/call',
    params: { name: 'rdc_skill_list', arguments: {} },
  });
  const catalog = JSON.parse(list.text || '{"skills":[]}');
  const names = catalog.skills.map((skill) => skill.name);
  check(`${label}: list includes channel-formatter`, names.includes('channel-formatter'));
  for (const specialist of ['convert', 'brochure', 'rdc-brochurify', 'lifeai-brochure-author']) {
    check(`${label}: list includes ${specialist}`, names.includes(specialist));
  }

  const search = await mcp(url, label, {
    jsonrpc: '2.0',
    id: `${label}-search-social`,
    method: 'tools/call',
    params: { name: 'rdc_skill_search', arguments: { query: 'turn this article into social posts' } },
  });
  const searchPayload = JSON.parse(search.text || '{"results":[]}');
  check(
    `${label}: article-to-social search routes to channel-formatter`,
    searchPayload.results[0]?.name === 'channel-formatter',
    searchPayload.results[0]?.name || 'none',
  );

  const get = await mcp(url, label, {
    jsonrpc: '2.0',
    id: `${label}-get-formatter`,
    method: 'tools/call',
    params: { name: 'rdc_skill_get', arguments: { name: 'channel-formatter', variant: 'cli' } },
  });
  inspectFormatterBody(get.text, label);
}

async function main() {
  log({ kind: 'test_start', reportFile: REPORT_FILE });
  unitChecks();

  const proc = spawn('node', [BIN], {
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'ignore',
  });
  try {
    const health = await waitHealth(LOCAL_HEALTH);
    log({ kind: 'health', label: 'integration', health });
    check('integration: local test server healthy', health.status === 'ok');
    await endpointChecks(LOCAL, 'integration');
  } finally {
    proc.kill();
  }

  if (process.env.REMOTE || process.argv.includes('--remote')) {
    const health = await (await fetch('https://rdc-skills.regendevcorp.com/health')).json();
    log({ kind: 'health', label: 'systems', health });
    check('systems: remote version is at least 0.24.8', /^0\.(2[4-9]|[3-9]\d)\./.test(health.version), health.version);
    check('systems: remote skill count includes full catalog', health.skills >= 29, String(health.skills));
    await endpointChecks(REMOTE, 'systems');
  } else {
    log({ kind: 'systems_skipped', reason: 'set REMOTE=1 or pass --remote' });
  }

  log({ kind: 'test_end', pass, fail, failures });
  console.log(`channel-formatter contract: ${pass} passed, ${fail} failed`);
  console.log(`audit log: ${REPORT_FILE}`);
  if (fail) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  log({ kind: 'fatal', message: error?.message || String(error), stack: error?.stack || '' });
  console.error(error);
  process.exit(1);
});

