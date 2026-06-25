#!/usr/bin/env node
/**
 * task-completed-gate.js — Truth Gate 3.0 Layer 5 (harness completion gate).
 *
 * Registered on the `TaskCompleted` event. Per the Claude Code hooks reference,
 * `TaskCompleted` CAN block (exit code 2 / decision "block" prevents the task
 * from being marked completed). This hook makes a task completion structurally
 * dependent on a SOUND work-item closure: a task cannot complete unless the
 * work item it references is `done` AND that `done` was admitted by Layers 2–3
 * (the FUSED evidence gate + the validator re-run receipt) — i.e. the work item
 * carries an HMAC-valid, witnessed `implementation_report.codeflow_post` and is
 * in status `done`. The exit gate (work-item-exit-gate.js) is what proves
 * Layers 2–3 at `done` time; this gate refuses to let a TASK finish on a work
 * item that never reached that sound `done` state.
 *
 * ⛔ FLAG-GATED, DEFAULT OFF. Until the flag is flipped at deploy this hook is a
 * pure no-op (exit 0) so the in-flight build session is NOT disrupted — the
 * blocking Stop/SubagentStop truth-gate is already live and gating capability
 * claims; this layer is dormant until activation. When the flag is ON it is
 * FAIL-CLOSED: an inability to verify a sound closure is a BLOCK, never a pass.
 *
 * Flag (default OFF), either enables it:
 *   - env  RDC_TRUTHGATE_TASKCOMPLETED in {1,true,on,yes}, OR
 *   - DB   public.truthgate_flags(flag='taskcompleted', enabled=true) — but the
 *          DB check is OPT-IN: it only runs when RDC_TRUTHGATE_TASKCOMPLETED_DB
 *          is in {1,true,on,yes}. This keeps the default-OFF path ZERO-COST: an
 *          unset env flag returns false with NO Supabase/clauth round-trip, so a
 *          dormant gate never makes a network call on every TaskCompleted.
 *
 * Offline test seam: when RDC_TASKCOMPLETED_CLOSURE_SINK points at a JSON file,
 * the hook reads the closure row from that file instead of Supabase. This lets
 * the gate be proven without a live DB. The sink shape is a single work_items
 * row: { id, status, item_type, implementation_report }.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const hookLog = require('./hook-logger');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const WITNESS_ALLOWLIST = new Set(['validator-rerun', 'ci', 'human-review']);
const DEFAULT_SUPABASE_URL = 'https://uvojezuorjgqzmhhgluu.supabase.co';

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.resume();
  });
}

/** Block the TaskCompleted with exit code 2 (the blocking semantics for this event). */
function block(reason, details = {}) {
  hookLog('task-completed-gate', 'TaskCompleted', 'block', { reason, ...details });
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `TASK COMPLETION BLOCKED — Truth Gate Layer 5 (TaskCompleted).\n\n${reason}`,
  }));
  process.stderr.write(`TASK COMPLETION BLOCKED: ${reason}\n`);
  process.exit(2);
}

function pass(details = {}) {
  hookLog('task-completed-gate', 'TaskCompleted', 'pass', details);
  process.exit(0);
}

/**
 * Is the Layer-5 TaskCompleted gate enabled? Default OFF (returns false).
 * Mirrors work-item-exit-gate.js truthGateFlagEnabled — env is the authoritative,
 * test-stable switch; a DB toggle is an optional deploy-time enable.
 */
function flagEnabledEnv() {
  const v = String(process.env.RDC_TRUTHGATE_TASKCOMPLETED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Is the optional DB flag check opted into? Default OFF (returns false).
 * The DB check is a Supabase/clauth round-trip; gating it behind this explicit
 * env opt-in keeps the default-OFF path zero-cost (no network on every
 * TaskCompleted). Only when this is set do we consult truthgate_flags.
 */
function flagDbOptIn() {
  const v = String(process.env.RDC_TRUTHGATE_TASKCOMPLETED_DB || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
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
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(3500),
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
  return res.json();
}

/** Best-effort DB flag toggle. Absence/error → false (stays OFF). */
async function flagEnabledDb() {
  try {
    const rows = await supabaseGet('truthgate_flags?flag=eq.taskcompleted&select=enabled&limit=1');
    return Array.isArray(rows) && rows[0] && rows[0].enabled === true;
  } catch (_) {
    return false;
  }
}

/**
 * Extract the work-item UUID a task is bound to from the TaskCompleted payload.
 * Looks in the common task fields and falls back to the first UUID anywhere in
 * the serialized payload (the closure ref the agent recorded against the task).
 * Returns the lowercased UUID or null.
 */
function extractWorkItemId(raw) {
  const candidates = [
    raw && raw.work_item_id,
    raw && raw.task && raw.task.work_item_id,
    raw && raw.task && raw.task.metadata && raw.task.metadata.work_item_id,
    raw && raw.metadata && raw.metadata.work_item_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && UUID_RE.test(c)) return c.match(UUID_RE)[0].toLowerCase();
  }
  let blob = '';
  try { blob = JSON.stringify(raw); } catch (_) { blob = String(raw || ''); }
  const m = blob.match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Is the work-item closure SOUND for completion? Pure + unit-testable; returns
 * { ok:true } or { ok:false, reason } — never throws. A sound closure for an
 * implementation task requires (mirrors the L2/L3 contract the exit gate proves
 * at `done` time):
 *   - the row exists
 *   - status === 'done'   (the exit gate admitted it; epics are exempt below)
 *   - implementation_report.codeflow_post exists
 *   - codeflow_post.witness ∈ allow-list (never 'agent' / self-witness, D5)
 *   - codeflow_post.commit is present (a captured SHA the exit gate matched)
 *   - codeflow_post.files_changed is a non-empty array
 *   - codeflow_post.verification is a non-empty array
 * Epics are not implementation tasks — an epic row is considered sound on
 * status alone (the exit gate exempts epics from L2/L3).
 */
function closureIsSound(row) {
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'no work-item closure row found for this task — cannot confirm a sound, Layer 2–3-admitted `done`.' };
  }
  if (row.item_type === 'epic') {
    return row.status === 'done'
      ? { ok: true }
      : { ok: false, reason: `linked epic ${row.id} is status "${row.status}", not "done".` };
  }
  if (row.status !== 'done') {
    return { ok: false, reason: `linked work item ${row.id} is status "${row.status}", not "done" — the exit gate has not admitted a Layer 2–3 closure.` };
  }
  const report = row.implementation_report;
  if (!report || typeof report !== 'object') {
    return { ok: false, reason: `work item ${row.id} has no implementation_report — a sound closure must carry one.` };
  }
  const post = report.codeflow_post;
  if (!post || typeof post !== 'object') {
    return { ok: false, reason: `work item ${row.id} has no implementation_report.codeflow_post — Layer 2–3 evidence absent.` };
  }
  const witness = String(post.witness || '');
  if (!WITNESS_ALLOWLIST.has(witness)) {
    return { ok: false, reason: `closure witness "${witness || '<missing>'}" is not in {validator-rerun, ci, human-review} — the doer cannot self-witness (D5).` };
  }
  if (typeof post.commit !== 'string' || !post.commit.trim()) {
    return { ok: false, reason: `closure codeflow_post.commit is missing — no captured commit to bind the closure to.` };
  }
  if (!Array.isArray(post.files_changed) || post.files_changed.length === 0) {
    return { ok: false, reason: `closure codeflow_post.files_changed is empty — a sound closure names the files it changed.` };
  }
  if (!Array.isArray(post.verification) || post.verification.length === 0) {
    return { ok: false, reason: `closure codeflow_post.verification is empty — a sound closure carries a captured verification artifact.` };
  }
  return { ok: true };
}

/** Load the closure row: offline sink first (test seam), else Supabase. */
async function loadClosureRow(workItemId) {
  const sink = process.env.RDC_TASKCOMPLETED_CLOSURE_SINK;
  if (sink) {
    const txt = fs.readFileSync(sink, 'utf8');
    const parsed = JSON.parse(txt);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  }
  const rows = await supabaseGet(
    `work_items?id=eq.${encodeURIComponent(workItemId)}&select=id,status,item_type,implementation_report&limit=1`,
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function main() {
  let raw;
  try { raw = JSON.parse(await readStdin()); } catch { process.exit(0); }

  // Default-OFF: a no-op until the flag is flipped at deploy. The env flag is
  // checked first and short-circuits — when it is unset, the DB check runs ONLY
  // if explicitly opted in via RDC_TRUTHGATE_TASKCOMPLETED_DB, so the dormant
  // path is zero-cost (no Supabase/clauth round-trip on every TaskCompleted).
  let enabled = flagEnabledEnv();
  if (!enabled && flagDbOptIn()) {
    enabled = await flagEnabledDb().catch(() => false);
  }
  if (!enabled) return pass({ reason: 'flag-off' });

  // FAIL-CLOSED from here: any inability to confirm a sound closure is a BLOCK.
  const workItemId = extractWorkItemId(raw);
  if (!workItemId) {
    block(
      'This task completion carries no work-item reference, so its closure cannot be verified against the ' +
      'Layer 2–3 exit gate. Bind the task to its work item (record the work-item UUID on the task/closure) and retry.',
    );
  }

  let row;
  try {
    row = await loadClosureRow(workItemId);
  } catch (e) {
    block(
      `Could not load the work-item closure for ${workItemId} (${e && e.message ? e.message : String(e)}). ` +
      `Fail-closed: not completing the task until the closure can be verified.`,
      { workItemId },
    );
  }

  const verdict = closureIsSound(row);
  if (!verdict.ok) {
    block(
      `${verdict.reason}\n\n` +
      `A task may only complete once its work item has reached a sound, Layer 2–3-admitted \`done\` ` +
      `(HMAC-valid, witnessed codeflow_post via the validator path). Move the work item through review → validator ` +
      `\`done\` first, then complete the task.`,
      { workItemId },
    );
  }

  pass({ workItemId });
}

if (require.main === module) {
  main().catch((e) => block(`task-completed-gate crashed: ${e.message}`));
} else {
  module.exports = {
    flagEnabledEnv,
    flagDbOptIn,
    extractWorkItemId,
    closureIsSound,
    WITNESS_ALLOWLIST,
  };
}
