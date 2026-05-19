#!/usr/bin/env node
/**
 * PreToolUse hook — hard-stop unsafe work item exit transitions.
 *
 * This gate runs before tool calls and blocks legacy or supervisor-mutated
 * CodeFlow/work-item close patterns before they reach Supabase. The database
 * remains the final authority; this hook gives agents an immediate stop sign.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const hookLog = require('./hook-logger');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DEFAULT_SUPABASE_URL = 'https://uvojezuorjgqzmhhgluu.supabase.co';
const EVENT_LOG = path.join(os.homedir(), '.claude', 'work-item-checklist-events.jsonl');

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.resume();
  });
}

function block(message, details = {}) {
  hookLog('work-item-exit-gate', 'PreToolUse', 'block', details);
  process.stdout.write(JSON.stringify({
    systemMessage: `HARD BLOCK — Work item exit gate rejected this tool call.\n\n${message}`,
  }));
  process.exit(1);
}

function pass(details = {}) {
  hookLog('work-item-exit-gate', 'PreToolUse', 'pass', details);
  process.exit(0);
}

function stringifyTool(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  try { return JSON.stringify(toolInput); } catch { return ''; }
}

function stripCasts(value) {
  return String(value || '')
    .replace(/::\s*[a-z_][\w.]*/gi, '')
    .trim();
}

function unquote(value) {
  const v = stripCasts(value);
  const m = v.match(/^'(.*)'$/s) || v.match(/^"(.*)"$/s);
  return (m ? m[1] : v).replace(/''/g, "'").trim();
}

function getNamedArg(text, name) {
  const re = new RegExp(`${name}\\s*:?=\\s*('(?:''|[^'])*'|"(?:\\\\"|[^"])*"|true|false|null|[0-9a-f-]{36})`, 'i');
  const m = text.match(re);
  return m ? unquote(m[1]) : null;
}

function splitArgs(argsText) {
  const args = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    const next = argsText[i + 1];
    if (quote) {
      current += ch;
      if (ch === quote && !(quote === "'" && next === "'")) quote = null;
      else if (ch === "'" && next === "'") current += argsText[++i];
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function findCall(text, name) {
  const idx = text.toLowerCase().indexOf(name.toLowerCase());
  if (idx < 0) return null;
  const open = text.indexOf('(', idx + name.length);
  if (open < 0) return null;
  let quote = null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      if (ch === quote && !(quote === "'" && next === "'")) quote = null;
      else if (ch === "'" && next === "'") i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

function objectArg(blob, name) {
  const re = new RegExp(`"${name}"\\s*:\\s*("([^"]*)"|true|false|null)`, 'i');
  const m = blob.match(re);
  if (!m) return null;
  if (m[1] === 'true' || m[1] === 'false' || m[1] === 'null') return m[1];
  return m[2] || null;
}

function extractStatusCall(blob) {
  if (!/update_work_item_status/i.test(blob)) return null;
  const call = findCall(blob, 'update_work_item_status');
  const args = call ? splitArgs(call) : [];
  return {
    id: objectArg(blob, 'p_id') || getNamedArg(blob, 'p_id') || unquote(args[0] || '').match(UUID_RE)?.[0] || blob.match(UUID_RE)?.[0] || null,
    status: objectArg(blob, 'p_status') || getNamedArg(blob, 'p_status') || unquote(args[1] || ''),
    actorSessionId: objectArg(blob, 'p_actor_session_id') || getNamedArg(blob, 'p_actor_session_id') || unquote(args[3] || ''),
    actorRole: objectArg(blob, 'p_actor_role') || getNamedArg(blob, 'p_actor_role') || unquote(args[4] || ''),
  };
}

function extractTickCall(blob) {
  if (!/update_checklist_item/i.test(blob)) return null;
  const call = findCall(blob, 'update_checklist_item');
  const args = call ? splitArgs(call) : [];
  return {
    workItemId: objectArg(blob, 'p_work_item_id') || getNamedArg(blob, 'p_work_item_id') || unquote(args[0] || '').match(UUID_RE)?.[0] || blob.match(UUID_RE)?.[0] || null,
    itemId: objectArg(blob, 'p_item_id') || getNamedArg(blob, 'p_item_id') || unquote(args[1] || ''),
    checked: (objectArg(blob, 'p_checked') || getNamedArg(blob, 'p_checked') || unquote(args[2] || '')).toLowerCase() === 'true',
    actorSessionId: objectArg(blob, 'p_actor_session_id') || getNamedArg(blob, 'p_actor_session_id') || unquote(args[3] || ''),
    actorRole: objectArg(blob, 'p_actor_role') || getNamedArg(blob, 'p_actor_role') || unquote(args[4] || ''),
  };
}

function logTick(tick, rawTool) {
  try {
    fs.mkdirSync(path.dirname(EVENT_LOG), { recursive: true });
    fs.appendFileSync(EVENT_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      work_item_id: tick.workItemId || null,
      item_id: tick.itemId || null,
      checked: tick.checked,
      actor_session_id: tick.actorSessionId || null,
      actor_role: tick.actorRole || null,
      tool_name: rawTool.tool_name || null,
    }) + '\n');
  } catch (_) {}
}

async function getServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  for (const endpoint of ['supabase-service', 'supabase-service-role']) {
    try {
      const res = await fetch(`http://127.0.0.1:52437/v/${endpoint}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text && !text.startsWith('{')) return text;
      }
    } catch (_) {}
  }
  return null;
}

async function supabaseGet(pathname) {
  const key = await getServiceKey();
  if (!key) throw new Error('clauth/env did not provide a Supabase service key');
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/${pathname}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(3500),
  });
  if (!res.ok) throw new Error(`Supabase verification HTTP ${res.status}`);
  return res.json();
}

function requiredItems(checklist) {
  return Array.isArray(checklist)
    ? checklist.filter((item) => item && item.required === true)
    : [];
}

async function verifyDone(statusCall, blob) {
  if (!statusCall.id) block('`update_work_item_status(..., done)` must include a work item UUID.', statusCall);
  if (!statusCall.actorSessionId || !statusCall.actorRole) {
    block('`done` requires the 5-argument RPC shape with `p_actor_session_id` and `p_actor_role`.', statusCall);
  }
  if (statusCall.actorRole !== 'validator') {
    block('Only a validator may transition a non-epic work item to `done`; implementation agents move work to `review`.', statusCall);
  }
  if (/submit_implementation_report/i.test(blob)) {
    block('Submit the implementation report in a separate tool call before `done`; the gate verifies committed DB state.', statusCall);
  }

  let rows;
  let events;
  try {
    rows = await supabaseGet(`work_items?id=eq.${encodeURIComponent(statusCall.id)}&select=id,status,item_type,implementation_report,checklist`);
    events = await supabaseGet(`work_item_checklist_events?work_item_id=eq.${encodeURIComponent(statusCall.id)}&select=item_id,checked,actor_session_id,actor_role,created_at&order=created_at.desc&limit=200`);
  } catch (e) {
    block(`Cannot live-verify work item exit gate: ${e.message}. Do not close the item until clauth/Supabase verification is available.`, statusCall);
  }

  const item = rows && rows[0];
  if (!item) block(`Work item ${statusCall.id} was not found.`, statusCall);
  if (item.item_type === 'epic') return;
  if (item.status !== 'review') block('Non-epic work items must be in `review` before a validator may mark them `done`.', { ...statusCall, currentStatus: item.status });

  const report = item.implementation_report;
  if (!report || typeof report !== 'object') block('`done` rejected because `implementation_report` is null or not an object.', statusCall);
  if (!report.codeflow_post || typeof report.codeflow_post !== 'object') block('`done` rejected because `implementation_report.codeflow_post` is missing.', statusCall);

  const missing = requiredItems(item.checklist).filter((ci) => ci.checked !== true);
  if (missing.length > 0) {
    block(`Required checklist items are unchecked: ${missing.map((ci) => ci.id || ci.text || '<unknown>').join(', ')}`, statusCall);
  }

  const latestByItem = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!latestByItem.has(event.item_id)) latestByItem.set(event.item_id, event);
  }
  const supervisorReticks = requiredItems(item.checklist)
    .map((ci) => latestByItem.get(ci.id))
    .filter((event) => event && event.checked === true && event.actor_role !== 'agent');
  if (supervisorReticks.length > 0) {
    block(
      `Required checklist items were last ticked by a non-agent session: ${supervisorReticks.map((e) => e.item_id).join(', ')}`,
      { ...statusCall, supervisorReticks: supervisorReticks.map((e) => e.item_id) },
    );
  }
}

function validateTick(tick, rawTool) {
  logTick(tick, rawTool);
  if (!tick.checked) return;
  if (!tick.workItemId || !tick.itemId) {
    block('Checklist ticks must include `p_work_item_id` and `p_item_id`.', tick);
  }
  if (!tick.actorSessionId) {
    block('Checklist ticks must include `p_actor_session_id`; unaudited ticks are rejected.', tick);
  }
  if (tick.actorRole !== 'agent') {
    block('Only the originating implementation agent may tick required checklist evidence. Supervisors/validators reopen or review; they do not re-tick.', tick);
  }
}

async function main() {
  let raw;
  try { raw = JSON.parse(await readStdin()); } catch { process.exit(0); }

  const blob = stringifyTool(raw.tool_input || raw);
  const tick = extractTickCall(blob);
  if (tick) validateTick(tick, raw);

  const statusCall = extractStatusCall(blob);
  if (!statusCall) pass({ reason: 'no-status-call' });

  const status = String(statusCall.status || '').toLowerCase();
  if (status === 'review' && (!statusCall.actorSessionId || statusCall.actorRole !== 'agent')) {
    block('Implementation agents must move completed work to `review` with `p_actor_session_id` and `p_actor_role := agent`.', statusCall);
  }
  if (status === 'done') {
    await verifyDone(statusCall, blob);
  }

  pass({ status });
}

main().catch((e) => block(`Exit gate crashed: ${e.message}`));
