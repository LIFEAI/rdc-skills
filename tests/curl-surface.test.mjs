#!/usr/bin/env node
/**
 * Direct HTTP/curl contract for callers outside Claude/Codex.
 *
 * This test intentionally shells out to curl instead of using fetch so the
 * documented MCP entry point is exercised through the same path a raw caller
 * copies from README/help: POST /mcp, Streamable HTTP Accept header, SSE
 * response, JSON-RPC envelope on data:, tool text at result.content[0].text.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'rdc-skills-mcp.mjs');
const TEST_PORT = parseInt(process.env.TEST_PORT || '3199', 10);
const LOCAL = `http://127.0.0.1:${TEST_PORT}`;
const REMOTE = 'https://rdc-skills.regendevcorp.com';
const TARGET = process.env.REMOTE || process.argv.includes('--remote') ? REMOTE : LOCAL;
const REPORT_DIR = path.join(REPO_ROOT, '.rdc', 'reports');
const REPORT_FILE = path.join(
  REPORT_DIR,
  `curl-surface-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
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

function curl(args, label) {
  const res = spawnSync('curl', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  log({
    kind: 'curl_call',
    label,
    args,
    status: res.status,
    stdoutPrefix: stdout.slice(0, 500),
    stderrPrefix: stderr.slice(0, 500),
  });
  return { status: res.status, stdout, stderr };
}

function postMcp(payload, label) {
  return curl([
    '-s',
    '-X', 'POST',
    `${TARGET}/mcp`,
    '-H', 'Content-Type: application/json',
    '-H', 'Accept: application/json, text/event-stream',
    '-d', JSON.stringify(payload),
  ], label);
}

function parseSse(raw) {
  const envelopes = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const text = line.slice(5).trim();
    if (!text) continue;
    envelopes.push(JSON.parse(text));
  }
  return envelopes;
}

function latestEnvelope(raw) {
  const envelopes = parseSse(raw);
  return envelopes.at(-1) || null;
}

function resultText(json) {
  return json?.result?.content?.[0]?.text || '';
}

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    const res = curl(['-s', `${TARGET}/health`], 'health');
    if (res.status === 0) {
      try {
        const health = JSON.parse(res.stdout);
        if (health.status === 'ok') return health;
      } catch {
        // wait and retry
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`health check timed out: ${TARGET}/health`);
}

async function main() {
  const hasCurl = spawnSync('curl', ['--version'], { encoding: 'utf8', windowsHide: true });
  check('curl executable is available', hasCurl.status === 0, hasCurl.stderr || hasCurl.error?.message || '');
  if (hasCurl.status !== 0) throw new Error('curl is required for direct caller surface tests');

  let proc = null;
  if (TARGET === LOCAL) {
    proc = spawn('node', [BIN], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  try {
    const health = await waitHealth();
    check('health reports ok', health.status === 'ok');
    check('health reports 29 skills', health.skills === 29, `skills ${health.skills}`);

    const init = postMcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'curl', version: '1' },
      },
    }, 'initialize');
    check('initialize curl exits 0', init.status === 0, init.stderr);
    check('initialize returns SSE data line', /^data:/m.test(init.stdout));
    const initJson = latestEnvelope(init.stdout);
    check('initialize serverInfo name', initJson?.result?.serverInfo?.name === 'rdc-skills');

    const list = postMcp({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'rdc_skill_list', arguments: {} },
    }, 'rdc_skill_list');
    check('rdc_skill_list curl exits 0', list.status === 0, list.stderr);
    check('rdc_skill_list returns SSE data line', /^data:/m.test(list.stdout));
    const listed = JSON.parse(resultText(latestEnvelope(list.stdout)));
    check('rdc_skill_list exposes 29 skills', listed.count === 29, `count ${listed.count}`);
    check('rdc_skill_list includes visible slash name', listed.skills.some((s) => s.slash === 'rdc:build'));

    const search = postMcp({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'rdc_skill_search',
        arguments: { query: 'turn this article into social posts' },
      },
    }, 'rdc_skill_search');
    check('rdc_skill_search curl exits 0', search.status === 0, search.stderr);
    const searchBody = JSON.parse(resultText(latestEnvelope(search.stdout)));
    check(
      'natural language search finds channel formatter',
      searchBody.results?.some((s) => s.name === 'channel-formatter' || s.slash === 'rdc:channel-formatter'),
    );

    const get = postMcp({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'rdc_skill_get',
        arguments: { name: 'rdc:build', variant: 'cli' },
      },
    }, 'rdc_skill_get');
    check('rdc_skill_get curl exits 0', get.status === 0, get.stderr);
    const getText = resultText(latestEnvelope(get.stdout));
    check('rdc_skill_get returns tool text path', getText.length > 500, `length ${getText.length}`);
    check('rdc_skill_get accepts visible rdc:build alias', /rdc:build/i.test(getText));

    const badAccept = curl([
      '-s',
      '-X', 'POST',
      `${TARGET}/mcp`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
    ], 'missing_accept_header');
    check('missing Accept header still returns inspectable response', badAccept.status === 0, badAccept.stderr);
    check('missing Accept header mentions Accept or returns JSON/SSE', /Accept|data:|jsonrpc|result/i.test(badAccept.stdout));
  } finally {
    if (proc) proc.kill();
  }

  console.log(`curl surface: ${pass} passed, ${fail} failed`);
  console.log(`audit log: ${REPORT_FILE}`);
  if (fail) {
    console.log('FAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('curl surface test error:', err);
  process.exit(1);
});
