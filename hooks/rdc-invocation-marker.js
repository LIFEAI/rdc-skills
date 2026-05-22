#!/usr/bin/env node
/**
 * UserPromptExpansion/UserPromptSubmit hook — mark active rdc:* invocations.
 *
 * This does not enforce compliance. It primes the turn with the RDC contract
 * and leaves a session marker for rdc-output-contract-gate.js to enforce at
 * Stop time.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const hookLog = require('./hook-logger');

const RDC_COMMANDS = new Set([
  'build',
  'co-develop',
  'collab',
  'deploy',
  'design',
  'fixit',
  'fs-mcp',
  'handoff',
  'help',
  'overnight',
  'plan',
  'preplan',
  'prototype',
  'release',
  'report',
  'review',
  'self-test',
  'status',
  'terminal-config',
  'watch',
  'workitems',
]);

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.resume();
  });
}

function markerDir() {
  return path.join(os.homedir(), '.claude', 'rdc-active');
}

function markerPath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(markerDir(), `${safe}.json`);
}

function normalizeCommandName(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^rdc[:-]/i, '')
    .toLowerCase();
}

function detectRdc(raw) {
  const event = raw.hook_event_name || '';
  if (event === 'UserPromptExpansion') {
    if (raw.command_source && raw.command_source !== 'plugin') return null;
    const command = normalizeCommandName(raw.command_name);
    if (command === 'help' && !/^\/rdc[:-]help\b/i.test(String(raw.prompt || ''))) return null;
    if (RDC_COMMANDS.has(command)) return command;
    return null;
  }

  if (event === 'UserPromptSubmit') {
    const prompt = String(raw.prompt || '').trim();
    const m = prompt.match(/^\/rdc[:-]([a-z][a-z0-9-]*)\b/i);
    if (!m) return null;
    const command = normalizeCommandName(m[1]);
    if (RDC_COMMANDS.has(command)) return command;
  }

  return null;
}

function writeMarker(raw, command) {
  fs.mkdirSync(markerDir(), { recursive: true });
  const p = markerPath(raw.session_id);
  if (fs.existsSync(p)) {
    try {
      const existing = JSON.parse(fs.readFileSync(p, 'utf8'));
      const started = Date.parse(existing.started_at || '');
      const isRecentDuplicate = Number.isFinite(started) &&
        Date.now() - started <= 1000 &&
        existing.session_id === (raw.session_id || null) &&
        existing.command === command;
      if (isRecentDuplicate) {
        return { ...existing, deduped: true };
      }
    } catch {}
  }
  const marker = {
    session_id: raw.session_id || null,
    command,
    command_name: raw.command_name || null,
    command_args: raw.command_args || null,
    prompt: raw.prompt || null,
    cwd: raw.cwd || null,
    transcript_path: raw.transcript_path || null,
    started_at: new Date().toISOString(),
    hook_event_name: raw.hook_event_name || null,
  };
  fs.writeFileSync(p, JSON.stringify(marker, null, 2));
  return marker;
}

function outputContext(eventName, command) {
  const additionalContext = [
    `RDC CONTRACT ACTIVE for /${command}.`,
    'Before responding, follow the project-local guide contracts:',
    '- .rdc/guides/output-contract.md: show one checklist for this invocation, update it as work progresses, and end with the required verdict line.',
    '- .rdc/guides/engineering-behavior.md: assumptions, scope, evidence, deviations, blockers, and verification must be explicit.',
    'Runtime enforcement is on emitted artifacts: the final assistant message must contain at least one checklist row and a verdict line.',
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  }));
}

async function main() {
  let raw;
  try { raw = JSON.parse(await readStdin()); } catch { process.exit(0); }
  const command = detectRdc(raw);
  if (!command) process.exit(0);

  try {
    const marker = writeMarker(raw, command);
    hookLog('rdc-invocation-marker', raw.hook_event_name || 'unknown', marker.deduped ? 'deduped' : 'marked', {
      command,
      session_id: marker.session_id,
    });
    outputContext(raw.hook_event_name || 'UserPromptExpansion', command);
  } catch (e) {
    hookLog('rdc-invocation-marker', raw.hook_event_name || 'unknown', 'error', {
      command,
      error: e.message,
    });
  }
}

main().catch(() => process.exit(0));
