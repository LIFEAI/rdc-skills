#!/usr/bin/env node
/**
 * Stop hook — enforce visible RDC output contract artifacts.
 *
 * Triggered only when rdc-invocation-marker.js has marked the session. It checks
 * positive output patterns only: at least one checklist row and one verdict
 * line. It intentionally does not police forbidden phrases.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const hookLog = require('./hook-logger');

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.resume();
  });
}

function markerPath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(os.homedir(), '.claude', 'rdc-active', `${safe}.json`);
}

function readMarker(sessionId) {
  const p = markerPath(sessionId);
  if (!fs.existsSync(p)) return null;
  try {
    return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return { path: p, data: { command: 'unknown' } };
  }
}

function hasChecklist(text) {
  return /(?:^|\n)\s*(?:[-*]\s*)?\[(?: |x|X|~|!|-)\]\s+\S/m.test(text || '');
}

function hasVerdict(text) {
  return /(?:^|\n)\s*(?:✅|⚠️|❌)\s+\S/m.test(text || '');
}

function block(reason, details = {}) {
  hookLog('rdc-output-contract-gate', 'Stop', 'block', details);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function pass(marker) {
  try { fs.unlinkSync(marker.path); } catch {}
  hookLog('rdc-output-contract-gate', 'Stop', 'pass', {
    command: marker.data.command || null,
  });
  process.exit(0);
}

async function main() {
  let raw;
  try { raw = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const marker = readMarker(raw.session_id);
  if (!marker) process.exit(0);

  const message = String(raw.last_assistant_message || '');
  const checklist = hasChecklist(message);
  const verdict = hasVerdict(message);
  if (checklist && verdict) pass(marker);

  const command = marker.data.command || 'rdc';
  const missing = [];
  if (!checklist) missing.push('a visible checklist row like `[ ] Step` or `[x] Step`');
  if (!verdict) missing.push('a final verdict line beginning with ✅, ⚠️, or ❌');

  block(
    `RDC output contract incomplete for /${command}: missing ${missing.join(' and ')}. Continue the response by rendering the RDC checklist and verdict required by .rdc/guides/output-contract.md. Do not restart the task; correct the visible output contract.`,
    { command, checklist, verdict, stop_hook_active: raw.stop_hook_active === true },
  );
}

main().catch((e) => block(`RDC output contract gate crashed: ${e.message}`));
