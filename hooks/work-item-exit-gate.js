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
const crypto = require('crypto');
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

// Truth Gate 3.0 — Layer 3 (validator re-run receipt).
//   Ratified contract (c): "no done without a validator re-run receipt with a
//   matching live nonce + running git_sha." This layer is FLAG-GATED and
//   default-OFF so it does not break in-flight build closures; it activates at
//   deploy by flipping the flag ON. When ON it is FAIL-CLOSED.
//   Running-brain health endpoint — the source of the actually-running git_sha
//   to pin against (mirrors .claude/hooks/truth-gate.mjs ~line 112).
const BRAIN_HEALTH_URL = process.env.RDC_BRAIN_HEALTH_URL || 'http://127.0.0.1:3109/health';
//   Canonical signed field order for a VALIDATOR re-run receipt. MUST match
//   .claude/hooks/lib/receipt.mjs VALIDATOR_SIGNED_FIELDS exactly (the gate has
//   no access to that ESM lib, so the contract is mirrored here, byte-for-byte).
const VALIDATOR_SIGNED_FIELDS = [
  'claim', 'witness', 'git_sha', 'nonce', 'command', 'result', 'nonce_in_output', 'ts',
];

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

/**
 * Build the L1-captured SHA set bound to the item's ORIGINATING session, or
 * DENY (throw GateDenied) when there is no originating session to bind to.
 *
 * FAIL-CLOSED: a null/empty originating session must NOT disable the per-session
 * binding (the old `!originatingSession` short-circuit accepted ANY session's
 * captured SHA — a fail-open laundering hole). With no session, there is no
 * provenance to verify, so we DENY. Otherwise we keep ONLY rows whose
 * session_id exactly equals the originating session.
 *
 * @param originatingSession string|null  the item's session_id
 * @param capturedRows       Array<{sha, session_id}> from work_item_commits
 * @returns Set<string>      full-SHA (lowercased) set for this item+session
 */
function buildCapturedShaSet(originatingSession, capturedRows) {
  const sess = originatingSession || null;
  if (!sess) {
    deny(
      'L2: done rejected — cannot bind commit provenance: work item has no originating session. ' +
      'Without a session to bind captured SHAs to, the per-session commit binding cannot be verified; fail-closed.',
      { originatingSession },
    );
  }
  return new Set(
    (Array.isArray(capturedRows) ? capturedRows : [])
      .filter((r) => r && r.session_id === sess)
      .map((r) => String((r && r.sha) || '').toLowerCase())
      .filter((s) => FULL_SHA_RE.test(s)),
  );
}

/** Run a git command in the truth-gate repo; returns trimmed stdout or null.
 * stderr is captured (piped) so a failure carries a usable diagnostic instead
 * of being swallowed. On failure with allowFail, returns null; otherwise the
 * thrown error retains git's stderr in e.stderr / e.message. */
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: TRUTH_GATE_REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

/**
 * Verify, once at entry, that TRUTH_GATE_REPO is a real git work tree the gate
 * can interrogate. If git is missing or the path is not a work tree, every
 * downstream SHA/file check would silently mis-verify, so we fail-closed with a
 * clear `truth-gate repo unavailable` block — distinct from a `ref not found`.
 */
function assertGitRepoAvailable() {
  let out;
  try {
    out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: TRUTH_GATE_REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch (e) {
    const detail = (e && (e.stderr || e.message)) ? String(e.stderr || e.message).trim().slice(0, 200) : 'git invocation failed';
    deny(
      'L2: done rejected — truth-gate repo unavailable: cannot run git in "' + TRUTH_GATE_REPO + '" (' + detail + '). ' +
      'The gate cannot verify commit/file provenance without a working git tree; fail-closed.',
      { repo: TRUTH_GATE_REPO },
    );
  }
  if (out !== 'true') {
    deny(
      'L2: done rejected — truth-gate repo unavailable: "' + TRUTH_GATE_REPO + '" is not a git work tree (rev-parse returned "' + out + '"). ' +
      'The gate cannot verify commit/file provenance; fail-closed.',
      { repo: TRUTH_GATE_REPO },
    );
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

let _evidenceLib = null;
/** Lazy-load the fused primitive's artifact discriminators (ESM from CJS).
 * Uses a file:// URL so the dynamic import works on Windows absolute paths.
 * Returns { isMachineArtifact, isPassingArtifact }. */
async function loadEvidenceLib() {
  if (_evidenceLib) return _evidenceLib;
  const { pathToFileURL } = require('url');
  const libPath = path.join(__dirname, 'lib', 'run-evidence-gate.mjs');
  const mod = await import(pathToFileURL(libPath).href);
  _evidenceLib = { isMachineArtifact: mod.isMachineArtifact, isPassingArtifact: mod.isPassingArtifact };
  return _evidenceLib;
}

// ===========================================================================
// Truth Gate 3.0 — Layer 3 (validator re-run receipt). FLAG-GATED, default-OFF.
//
// Ratified contract (c): a `done` close requires a chain-stored, HMAC-valid,
// fresh-nonce, running-sha-pinned validator receipt. Nothing consumed the
// receipt layer before this. To avoid breaking in-flight closures, the check is
// behind a flag (default OFF → behaves exactly as today). When the flag is ON it
// is FAIL-CLOSED: a missing / forged / stale / replayed / wrong-sha receipt, or
// an inability to evaluate, DENIES the close.
// ===========================================================================

/**
 * Is the Layer-3 validator-receipt requirement enabled?
 * Default OFF. Turned on at deploy via either:
 *   - env RDC_TRUTHGATE_REQUIRE_VALIDATOR_RECEIPT in {1,true,on,yes}, OR
 *   - a DB row in public.truthgate_flags(flag,enabled) with flag =
 *     'require_validator_receipt' and enabled = true (best-effort; a lookup
 *     failure does NOT enable the flag — absence is OFF).
 * The env is the authoritative, test-stable switch; the DB lookup is an optional
 * deploy-time toggle. Either being true enables it.
 */
function truthGateFlagEnabled(flag) {
  const envName = 'RDC_TRUTHGATE_' + String(flag || '').toUpperCase();
  const v = String(process.env[envName] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Best-effort DB toggle for the flag. Absence / error → false (stays OFF). */
async function truthGateFlagEnabledDb(flag) {
  try {
    const rows = await supabaseGet(
      `truthgate_flags?flag=eq.${encodeURIComponent(flag)}&select=enabled&limit=1`,
    );
    return Array.isArray(rows) && rows[0] && rows[0].enabled === true;
  } catch (_) {
    return false; // a missing table or a lookup failure must NOT enable the gate
  }
}

/** Canonical JSON the HMAC is computed over — mirrors receipt.mjs validatorCanonical(). */
function validatorCanonical(receipt) {
  const picked = {};
  for (const k of VALIDATOR_SIGNED_FIELDS) picked[k] = receipt[k] ?? null;
  return JSON.stringify(picked);
}

/** Verify the validator receipt HMAC with the truth-gate secret (constant-time). */
function verifyValidatorSig(receipt, secret) {
  if (!secret || !receipt || !receipt.hmac) return false;
  let expected;
  try {
    expected = crypto.createHmac('sha256', secret).update(validatorCanonical(receipt)).digest('hex');
  } catch (_) { return false; }
  let a, b;
  try {
    a = Buffer.from(expected, 'hex');
    b = Buffer.from(String(receipt.hmac), 'hex');
  } catch (_) { return false; }
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Does a re-run result object read as a PASS? Mirrors receipt.mjs resultIsPass(). */
function resultIsPass(result) {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.exit_code === 'number') return result.exit_code === 0;
  if (typeof result.exitCode === 'number') return result.exitCode === 0;
  if (typeof result.passed === 'number') {
    if (typeof result.failed === 'number') return result.failed === 0;
    if (typeof result.total === 'number') return result.passed === result.total;
  }
  if (typeof result.tsc_errors === 'number') return result.tsc_errors === 0;
  return false;
}

/**
 * Validate a VALIDATOR re-run receipt for a `done` close. Pure + unit-testable;
 * throws GateDenied on any failure so the caller fail-closes. ALL must hold:
 *   - a secret is available (else INFRA → DENY, never a silent pass)
 *   - HMAC valid (signed by the validator path, not hand-written)
 *   - witness ∈ allow-list (never 'agent' / self-witnessed)
 *   - git_sha === actualRunningSha (re-run pinned to the running brain HEAD)
 *   - nonce_in_output === true (fresh nonce surfaced in captured output)
 *   - result reads as a pass
 *   - nonce NOT in seenNonces (durable replay set, loaded from the chain store)
 *   - ts within maxAgeMin (fresh)
 *
 * @param {object}   receipt
 * @param {object}   opts
 * @param {string}   opts.secret           HMAC secret (truth-gate-secret)
 * @param {string}   opts.actualRunningSha live brain HEAD to pin against (required)
 * @param {string[]} [opts.seenNonces]     durable nonces already consumed
 * @param {number}   [opts.maxAgeMin=30]
 * @param {number}   [opts.nowMs]
 */
function assertValidatorReceipt(receipt, opts = {}) {
  const { secret, actualRunningSha, seenNonces = [], maxAgeMin = 30, nowMs } = opts;
  if (!secret) {
    deny(
      'L3: done rejected — INFRA: no truth-gate HMAC secret available to verify the validator receipt. ' +
      'Cannot evaluate the Layer-3 receipt; fail-closed (INFRA is a BLOCK, not an allow).',
      { layer: 3 },
    );
  }
  if (!receipt || typeof receipt !== 'object') {
    deny('L3: done rejected — no validator re-run receipt found for this work item (flag is ON).', { layer: 3 });
  }
  if (!verifyValidatorSig(receipt, secret)) {
    deny('L3: done rejected — validator receipt HMAC invalid/absent (hand-written or tampered receipt).', { layer: 3 });
  }
  if (!WITNESS_ALLOWLIST.has(String(receipt.witness || ''))) {
    deny(
      'L3: done rejected — validator receipt witness "' + (receipt.witness || '<missing>') +
      '" is not in {validator-rerun, ci, human-review} (the doer cannot self-witness).',
      { layer: 3, witness: receipt.witness },
    );
  }
  if (!receipt.git_sha) {
    deny('L3: done rejected — validator receipt git_sha missing.', { layer: 3 });
  }
  if (actualRunningSha && String(receipt.git_sha) !== String(actualRunningSha)) {
    deny(
      'L3: done rejected — validator receipt git_sha ' + receipt.git_sha +
      ' != the actually-running brain HEAD ' + actualRunningSha + ' (receipt not pinned to the live runtime).',
      { layer: 3, receiptSha: receipt.git_sha, runningSha: actualRunningSha },
    );
  }
  if (receipt.nonce_in_output !== true) {
    deny('L3: done rejected — validator receipt nonce_in_output != true (fresh nonce absent from captured output: cached/replayed artifact).', { layer: 3 });
  }
  if (!resultIsPass(receipt.result)) {
    deny('L3: done rejected — validator receipt result did not read as a pass (re-run failed or unparseable result).', { layer: 3 });
  }
  if (receipt.nonce && Array.isArray(seenNonces) && seenNonces.includes(receipt.nonce)) {
    deny('L3: done rejected — validator receipt nonce ' + receipt.nonce + ' already consumed in the chain (replayed) — stale.', { layer: 3, nonce: receipt.nonce });
  }
  const t = Date.parse(receipt.ts);
  if (Number.isNaN(t)) deny('L3: done rejected — validator receipt ts is unparseable.', { layer: 3 });
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (now - t > maxAgeMin * 60_000) {
    deny('L3: done rejected — validator receipt is stale (> ' + maxAgeMin + 'm old).', { layer: 3 });
  }
  // No denial → the Layer-3 receipt is valid, fresh, pinned, and unreplayed.
}

/** Read the truth-gate HMAC secret from clauth/env. null when unavailable. */
async function getTruthGateSecret() {
  if (process.env.TRUTH_GATE_SECRET) return process.env.TRUTH_GATE_SECRET;
  try {
    const res = await fetch('http://127.0.0.1:52437/v/truth-gate-secret', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text && !text.startsWith('{')) return text;
    }
  } catch (_) {}
  return null;
}

/** Pin against the running brain's /health git_sha (mirrors truth-gate.mjs). null on failure. */
async function getRunningBrainSha() {
  try {
    const res = await fetch(BRAIN_HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const j = await res.json();
    const sha = String(j && j.git_sha ? j.git_sha : '').trim();
    return sha || null;
  } catch (_) { return null; }
}

/** Newest validator receipt stored for this work item, or null. Loaded from the chain store. */
function pickNewestValidatorReceipt(receiptRows) {
  if (!Array.isArray(receiptRows) || receiptRows.length === 0) return null;
  let best = null;
  let bestT = -Infinity;
  for (const row of receiptRows) {
    const payload = row && row.payload;
    if (!payload || typeof payload !== 'object') continue;
    const t = Date.parse(payload.ts);
    const key = Number.isNaN(t) ? -Infinity : t;
    if (key >= bestT) { bestT = key; best = payload; }
  }
  return best;
}

/**
 * Layer-3 verification of a `done` close: require a chain-stored, HMAC-valid,
 * fresh-nonce, running-sha-pinned validator receipt for THIS work item. Only
 * runs when the flag is ON; otherwise it is a no-op (today's behaviour). When ON
 * it is FAIL-CLOSED — any inability to load/evaluate the receipt is a DENY.
 *
 * Dependencies are injectable for unit tests via `deps`:
 *   deps.flagEnabled()        → boolean
 *   deps.getSecret()          → Promise<string|null>
 *   deps.getRunningSha()      → Promise<string|null>
 *   deps.loadReceiptRows(id)  → Promise<rows for this work item>
 *   deps.loadSeenNonces()     → Promise<string[]> (durable consumed nonces)
 */
async function verifyLayer3(statusCall, item, deps = {}, nowMs) {
  const flagEnabled = deps.flagEnabled ? await deps.flagEnabled() : false;
  if (!flagEnabled) return; // default-OFF: behaves exactly as today

  const secret = deps.getSecret ? await deps.getSecret() : await getTruthGateSecret();
  const runningSha = deps.getRunningSha ? await deps.getRunningSha() : await getRunningBrainSha();
  if (!runningSha) {
    deny(
      'L3: done rejected — INFRA: could not read the running brain git_sha from ' + BRAIN_HEALTH_URL +
      '. Cannot pin the validator receipt to the live runtime; fail-closed (INFRA is a BLOCK).',
      { layer: 3 },
    );
  }

  let receiptRows;
  let seenNonces;
  try {
    receiptRows = deps.loadReceiptRows
      ? await deps.loadReceiptRows(statusCall.id)
      : await supabaseGet(`truth_gate_receipts?work_item_id=eq.${encodeURIComponent(statusCall.id)}&select=payload&order=id.desc&limit=50`);
    seenNonces = deps.loadSeenNonces
      ? await deps.loadSeenNonces(statusCall.id)
      : await loadSeenNonces(statusCall.id, pickNewestValidatorReceipt(receiptRows));
  } catch (e) {
    deny(
      'L3: done rejected — INFRA: could not load validator receipts/seen-nonces (' +
      (e && e.message ? e.message : String(e)) + '); fail-closed.',
      { layer: 3 },
    );
  }

  const receipt = pickNewestValidatorReceipt(receiptRows);
  assertValidatorReceipt(receipt, { secret, actualRunningSha: runningSha, seenNonces, nowMs });
}

/**
 * Durable replay set: every validator-receipt nonce already consumed in the
 * chain, EXCLUDING the candidate receipt's own nonce (so the candidate is not
 * spuriously flagged as a replay of itself). Replay rejection is therefore
 * durable (chain-backed), not in-memory-only.
 */
async function loadSeenNonces(workItemId, candidateReceipt) {
  const ownNonce = candidateReceipt && candidateReceipt.nonce ? String(candidateReceipt.nonce) : null;
  const rows = await supabaseGet(
    `truth_gate_receipts?select=payload&payload->>nonce=not.is.null&limit=1000`,
  );
  const seen = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = r && r.payload && r.payload.nonce ? String(r.payload.nonce) : null;
    if (n && n !== ownNonce) seen.push(n);
  }
  return seen;
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
  // Fail-closed: the gate's commit/file checks all shell out to git. If the
  // truth-gate repo is not a usable git work tree, verify nothing — DENY.
  assertGitRepoAvailable();

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

  // (4) Every verification entry is a machine-parseable artifact, not prose,
  //     AND its OUTCOME is a PASS — not merely that it RAN. A failing run
  //     (exit_code:1), an error HTTP status (500), a fused verdict:'fail', or a
  //     test artifact with failures must DENY: "ran" is not "passed".
  const { isMachineArtifact, isPassingArtifact } = await loadEvidenceLib();
  const verifications = Array.isArray(post.verification) ? post.verification : [];
  if (verifications.length === 0) {
    deny('L2: done rejected — codeflow_post.verification is empty; closure needs a captured verification artifact.', statusCall);
  }
  for (const v of verifications) {
    // 4a. Shape gate — it must be a captured machine artifact, not prose.
    if (!isMachineArtifact(v)) {
      const shown = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 80);
      deny(
        'L2: done rejected — verification entry is prose/proxy, not a captured artifact: "' + shown + '". ' +
        'Each verification must be a run-evidence-gate result or a machine shape ' +
        '({exit_code|http_status|rowcount|passed/total}). Strings like "HTTP 200" / "works" are rejected.',
        { ...statusCall, verification: shown },
      );
    }
    // 4b. Outcome gate — the captured artifact must read as a PASS.
    if (!isPassingArtifact(v)) {
      const shown = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 120);
      deny(
        'L2: done rejected — verification-not-passing: the captured artifact ran but did NOT pass: "' + shown + '". ' +
        'A closure requires a PASSING verification (fused verdict:"pass" / exit_code:0 / http 2xx-3xx / ' +
        'failed:0 / passed===total / tsc_errors:0). A failing or error run is not evidence of done.',
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
  // session against this item cannot launder a fabricated close. A null
  // originating session is fail-closed (DENY) inside buildCapturedShaSet.
  try {
    const capturedShas = buildCapturedShaSet(item.session_id || null, capturedRows);
    await verifyLayer2(statusCall, item, capturedShas);
  } catch (e) {
    if (e instanceof GateDenied) {
      block(e.reason, e.details);     // translate the L2 denial into a hard block
    }
    // Any OTHER error during L2 is an inability to verify => FAIL-CLOSED.
    block('L2: done rejected — Layer-2 verification could not complete (' + (e && e.message ? e.message : String(e)) + '). Fail-closed: not closing.', statusCall);
  }

  // --- Truth Gate 3.0 Layer 3 — validator re-run receipt (FLAG-GATED) ---------
  // Default-OFF: a no-op until the flag is flipped at deploy, so in-flight build
  // closures are unaffected. When ON it is FAIL-CLOSED: requires a chain-stored,
  // HMAC-valid, fresh-nonce, running-sha-pinned validator receipt.
  try {
    await verifyLayer3(statusCall, item, {
      flagEnabled: async () =>
        truthGateFlagEnabled('require_validator_receipt') ||
        (await truthGateFlagEnabledDb('require_validator_receipt')),
    });
  } catch (e) {
    if (e instanceof GateDenied) {
      block(e.reason, e.details);     // translate the L3 denial into a hard block
    }
    // Any OTHER error during L3 (flag ON) is an inability to verify => FAIL-CLOSED.
    block('L3: done rejected — Layer-3 verification could not complete (' + (e && e.message ? e.message : String(e)) + '). Fail-closed: not closing.', statusCall);
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

  // Ambiguous-parse fail-closed: the tool blob references update_work_item_status
  // AND contains a 'done' literal, but we could not extract a usable id/status.
  // A done-close we cannot parse must NOT slip through as a pass — block.
  if (/update_work_item_status/i.test(blob) && /\bdone\b/i.test(blob)) {
    if (!statusCall.id || !statusCall.status) {
      block(
        'Work item exit gate could not parse the `update_work_item_status` call that references `done` ' +
        '(missing ' + (!statusCall.id ? 'work item id' : 'status') + '). ' +
        'Ambiguous done-close parses are fail-closed; re-issue the call in the documented 5-argument RPC shape.',
        statusCall,
      );
    }
  }

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
    loadEvidenceLib,
    assertGitRepoAvailable,
    buildCapturedShaSet,
    WITNESS_ALLOWLIST,
    // Truth Gate 3.0 Layer 3 (validator re-run receipt) — exported for tests.
    verifyLayer3,
    assertValidatorReceipt,
    truthGateFlagEnabled,
    validatorCanonical,
    verifyValidatorSig,
    resultIsPass,
    pickNewestValidatorReceipt,
    VALIDATOR_SIGNED_FIELDS,
  };
}
