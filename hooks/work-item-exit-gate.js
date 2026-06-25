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
const { execFileSync } = require('child_process');
const hookLog = require('./hook-logger');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
const DEFAULT_SUPABASE_URL = 'https://uvojezuorjgqzmhhgluu.supabase.co';
const EVENT_LOG = path.join(os.homedir(), '.claude', 'work-item-checklist-events.jsonl');

// Truth Gate 3.0 — Layer 2 (FUSED evidence gate).
//   Witness allow-list (D5 / SLSA: the doer cannot sign its own provenance).
const WITNESS_ALLOWLIST = new Set(['validator-rerun', 'ci', 'human-review']);
//   Repo the gate runs `git` against. The work tree under verification is
//   regen-root; overridable for tests via RDC_TRUTH_GATE_REPO.
const TRUTH_GATE_REPO = process.env.RDC_TRUTH_GATE_REPO || 'C:/Dev/regen-root';

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

// ===========================================================================
// Truth Gate 3.0 — Layer 2 (FUSED evidence gate / freeze-the-leak)
//
// Asserts, server-checkable and FAIL-CLOSED, that a `done` close corresponds to
// reality. Baru-trap hardening (from the auditors' OWN false positives):
//   - resolve commits by FULL 40-hex SHA only — never short-prefix compare
//     (prefix collisions falsely flagged real work as fabricated).
//   - locate claimed files WHOLE-REPO (`git log --all -- <path>`), never
//     cited-path-only (wrong-path lookups falsely cried "absent").
// ===========================================================================

/**
 * A Layer-2 denial. Thrown by `deny()` so verifyLayer2 short-circuits without
 * coupling to process.exit — production translates it to block(), tests assert
 * on `.reason`. This keeps the gate logic pure + unit-testable while staying
 * FAIL-CLOSED at the process boundary.
 */
class GateDenied extends Error {
  constructor(reason, details) {
    super(reason);
    this.name = 'GateDenied';
    this.reason = reason;
    this.details = details || {};
  }
}

function deny(reason, details) {
  throw new GateDenied(reason, details);
}

/** Run a git command in the truth-gate repo; returns trimmed stdout or null. */
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: TRUTH_GATE_REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

/**
 * Resolve a commit ref to its FULL 40-char SHA, or null if it does not exist.
 * Uses `rev-parse --verify <ref>^{commit}` so only real commit objects resolve.
 * NEVER does a prefix/substring compare — the returned value is the canonical
 * full SHA, and all equality downstream is full-SHA equality.
 */
function resolveFullSha(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const full = git(['rev-parse', '--verify', '--quiet', `${ref.trim()}^{commit}`], { allowFail: true });
  return full && FULL_SHA_RE.test(full) ? full.toLowerCase() : null;
}

/** Full set of file paths touched by a commit (`git show --stat`→ name-only). */
function filesInCommit(fullSha) {
  const out = git(['show', '--no-renames', '--name-only', '--pretty=format:', fullSha], { allowFail: true });
  if (out == null) return null;
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean).map(normalizeRepoPath));
}

function normalizeRepoPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

/**
 * Whole-repo existence check for a claimed file. A file "exists for this repo"
 * when EITHER it is tracked anywhere in history (`git log --all -- <path>`
 * returns a commit) OR it is present on disk. This is deliberately broad to
 * avoid the cited-path-only false "absent" verdict.
 */
function fileKnownToRepo(repoPath) {
  const p = normalizeRepoPath(repoPath);
  if (!p) return false;
  // On disk now?
  try {
    if (fs.existsSync(path.join(TRUTH_GATE_REPO, p))) return true;
  } catch (_) { /* fall through to history */ }
  // Tracked anywhere in history (whole-repo locator, never cited-path-only)?
  const log = git(['log', '--all', '--oneline', '-1', '--', p], { allowFail: true });
  return Boolean(log && log.length > 0);
}

/** Does the file exist on disk in the work tree right now? */
function fileOnDisk(repoPath) {
  const p = normalizeRepoPath(repoPath);
  if (!p) return false;
  try { return fs.existsSync(path.join(TRUTH_GATE_REPO, p)); } catch { return false; }
}

let _isMachineArtifact = null;
/** Lazy-load the fused primitive's artifact discriminator (ESM from CJS).
 * Uses a file:// URL so the dynamic import works on Windows absolute paths. */
async function loadIsMachineArtifact() {
  if (_isMachineArtifact) return _isMachineArtifact;
  const { pathToFileURL } = require('url');
  const libPath = path.join(__dirname, 'lib', 'run-evidence-gate.mjs');
  const mod = await import(pathToFileURL(libPath).href);
  _isMachineArtifact = mod.isMachineArtifact;
  return _isMachineArtifact;
}

/**
 * Layer-2 verification of a `done` close against the real repo. Throws (caught
 * by verifyDone → block) on any internal error so the gate is FAIL-CLOSED:
 * an inability to verify is a DENY, never a silent pass.
 *
 * @param statusCall parsed update_work_item_status args (has .id, .actorSessionId)
 * @param item       the work_items row (has implementation_report)
 * @param capturedShas Set<string> of FULL L1-captured SHAs for this item/session
 */
async function verifyLayer2(statusCall, item, capturedShas) {
  const post = item.implementation_report && item.implementation_report.codeflow_post;
  if (!post || typeof post !== 'object') {
    deny('L2: done rejected — implementation_report.codeflow_post is missing or not an object.', statusCall);
  }

  // (5) Witness allow-list — the doer cannot self-witness (D5 / SLSA).
  const witness = String(post.witness || '').trim();
  if (!WITNESS_ALLOWLIST.has(witness)) {
    deny(
      'L2: done rejected — codeflow_post.witness must be one of {validator-rerun, ci, human-review}; got "' +
      (witness || '<missing>') + '". ' +
      'The party that did the work cannot sign its own provenance (witness:"agent" is never accepted).',
      { ...statusCall, witness },
    );
  }

  // (1) Commit resolves (FULL SHA) AND was captured by L1 for this item/session.
  const claimedCommit = post.commit;
  const fullSha = resolveFullSha(claimedCommit);
  if (!fullSha) {
    deny(
      'L2: done rejected — codeflow_post.commit ("' + (claimedCommit || '<missing>') +
      '") does not resolve to a real commit (git cat-file/rev-parse). Free-typed or wrong SHAs are rejected.',
      { ...statusCall, claimedCommit },
    );
  }
  if (!capturedShas.has(fullSha)) {
    deny(
      'L2: done rejected — commit ' + fullSha + ' was not captured by Layer 1 for this work item + originating session. ' +
      'The exit gate only accepts a commit SHA the commit-hook recorded against this item (no agent-asserted SHAs). ' +
      'Captured SHAs for this item/session: ' + (capturedShas.size ? [...capturedShas].join(', ') : '(none)') + '.',
      { ...statusCall, fullSha, capturedCount: capturedShas.size },
    );
  }

  // (2)/(3) Every files_changed entry is in the commit AND exists on disk.
  const filesChanged = Array.isArray(post.files_changed) ? post.files_changed : [];
  if (filesChanged.length === 0) {
    deny('L2: done rejected — codeflow_post.files_changed is empty; a closure must name the files it changed.', statusCall);
  }
  const commitFiles = filesInCommit(fullSha);
  if (commitFiles == null) {
    deny('L2: done rejected — could not read the file list of commit ' + fullSha + ' (git show failed).', statusCall);
  }
  for (const raw of filesChanged) {
    const p = normalizeRepoPath(raw);
    if (!p) {
      deny('L2: done rejected — a files_changed entry is empty/blank.', { ...statusCall, raw });
    }
    // In the commit? (whole-repo lookup is implicit — commitFiles is the full
    // name-only set of the resolved commit, not a cited-path filter.)
    if (!commitFiles.has(p)) {
      deny(
        'L2: done rejected — file "' + p + '" is NOT among the files changed by commit ' + fullSha +
        ' (git show --stat). files_changed must match the commit\'s actual contents.',
        { ...statusCall, file: p, fullSha },
      );
    }
    // On disk now?
    if (!fileOnDisk(p)) {
      deny(
        'L2: done rejected — claimed file "' + p + '" does not exist on disk in the work tree. ' +
        'A deliverable that is not present is not done.',
        { ...statusCall, file: p },
      );
    }
    // Whole-repo sanity (defense in depth; should always hold if on disk).
    if (!fileKnownToRepo(p)) {
      deny(
        'L2: done rejected — claimed file "' + p + '" is unknown to the repo (not on disk and not in history).',
        { ...statusCall, file: p },
      );
    }
  }

  // (4) Every verification entry is a machine-parseable artifact, not prose.
  const isMachineArtifact = await loadIsMachineArtifact();
  const verifications = Array.isArray(post.verification) ? post.verification : [];
  if (verifications.length === 0) {
    deny('L2: done rejected — codeflow_post.verification is empty; closure needs a captured verification artifact.', statusCall);
  }
  for (const v of verifications) {
    if (!isMachineArtifact(v)) {
      const shown = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 80);
      deny(
        'L2: done rejected — verification entry is prose/proxy, not a captured artifact: "' + shown + '". ' +
        'Each verification must be a run-evidence-gate result or a machine shape ' +
        '({exit_code|http_status|rowcount|passed/total}). Strings like "HTTP 200" / "works" are rejected.',
        { ...statusCall, verification: shown },
      );
    }
  }
  // No denial thrown => Layer-2 verification PASSED.
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
  let capturedRows;
  try {
    rows = await supabaseGet(`work_items?id=eq.${encodeURIComponent(statusCall.id)}&select=id,status,item_type,session_id,implementation_report,checklist`);
    events = await supabaseGet(`work_item_checklist_events?work_item_id=eq.${encodeURIComponent(statusCall.id)}&select=item_id,checked,actor_session_id,actor_role,created_at&order=created_at.desc&limit=200`);
    capturedRows = await supabaseGet(`work_item_commits?work_item_id=eq.${encodeURIComponent(statusCall.id)}&select=sha,session_id`);
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

  // --- Truth Gate 3.0 Layer 2 — FUSED evidence gate (freeze-the-leak) ---------
  // The L1-captured SHA set is restricted to the item's ORIGINATING session
  // (the session that ticked the checklist) so a SHA captured by some other
  // session against this item cannot launder a fabricated close.
  const originatingSession = item.session_id || null;
  const capturedShas = new Set(
    (Array.isArray(capturedRows) ? capturedRows : [])
      .filter((r) => !originatingSession || r.session_id === originatingSession)
      .map((r) => String(r.sha || '').toLowerCase())
      .filter((s) => FULL_SHA_RE.test(s)),
  );
  try {
    await verifyLayer2(statusCall, item, capturedShas);
  } catch (e) {
    if (e instanceof GateDenied) {
      block(e.reason, e.details);     // translate the L2 denial into a hard block
    }
    // Any OTHER error during L2 is an inability to verify => FAIL-CLOSED.
    block('L2: done rejected — Layer-2 verification could not complete (' + (e && e.message ? e.message : String(e)) + '). Fail-closed: not closing.', statusCall);
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

// Run as a hook; export the Layer-2 internals when required by a test.
if (require.main === module) {
  main().catch((e) => block(`Exit gate crashed: ${e.message}`));
} else {
  module.exports = {
    GateDenied,
    deny,
    verifyLayer2,
    resolveFullSha,
    filesInCommit,
    fileOnDisk,
    fileKnownToRepo,
    normalizeRepoPath,
    loadIsMachineArtifact,
    WITNESS_ALLOWLIST,
  };
}
