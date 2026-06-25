#!/usr/bin/env node
/**
 * Work-item commit hook — Truth Gate 3.0 Layer 1 (commit capture).
 *
 * Registered on BOTH:
 *   - PreToolUse(Bash):  intent check (preserved legacy behavior — WARN only,
 *                        never hard-blocks a commit).
 *   - PostToolUse(Bash): commit capture — after a `git commit` lands, the hook
 *                        runs `git rev-parse HEAD` and records the REAL SHA +
 *                        session against the active work item in the
 *                        `work_item_commits` side table.
 *
 * ⛔ THE AGENT NEVER WRITES THE COMMIT FIELD. The system does. The work item is
 * identified from the work-item UUID the agent referenced in the commit message
 * (its "active work-item ref"); the SHA is taken from `git rev-parse HEAD`, not
 * from anything the agent typed. This kills the "real-but-wrong commit SHA"
 * fabrication class (FMEA #1) at the source — WP-2's closure gate then asserts a
 * report's codeflow_post.commit is one of these captured, session-authored SHAs.
 *
 * PreToolUse (intent) behavior is unchanged:
 *   - fixit.marker present                  -> pass
 *   - conventional type / UUID / #issue ref -> pass
 *   - otherwise                             -> WARN (proceed anyway)
 *
 * PostToolUse (capture) behavior:
 *   - only fires on a `git commit` whose tool result indicates success
 *   - extracts the work-item UUID from the commit message (active ref)
 *   - no UUID -> NO-OP (no orphan row), logs `capture-no-item`
 *   - UUID    -> `git rev-parse HEAD` -> INSERT { work_item_id, sha, session_id }
 *
 * Capture sink (for tests / offline): if `RDC_COMMIT_CAPTURE_SINK` is set to a
 * file path, the capture payload is appended there as JSONL in addition to the
 * DB write. This lets the hook be verified deterministically without a live DB.
 */
'use strict';

const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { execFileSync } = require('child_process');
const hookLog   = require('./hook-logger');

const MARKER_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || os.homedir(),
  '.claude',
  'fixit.marker'
);

const CONVENTIONAL_TYPES = /^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)(\(.+\))?:/i;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISSUE_REF = /#[a-zA-Z0-9-]+/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

const DEFAULT_SUPABASE_URL = 'https://uvojezuorjgqzmhhgluu.supabase.co';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** True when the Bash command is a real `git commit` (not e.g. `git commit --help`). */
function isGitCommit(command) {
  if (typeof command !== 'string') return false;
  if (!/\bgit\b[^\n]*\bcommit\b/.test(command)) return false;
  if (/\bcommit\b[^\n]*--help/.test(command) || /\bcommit\b[^\n]*\s-h\b/.test(command)) return false;
  return true;
}

/** Extract the -m "..." message (or fall back to the whole command). */
function extractCommitMessage(command) {
  const cmd = String(command || '');
  const msgMatch = cmd.match(/-m\s+["']([^"']+)["']/s) ||
                   cmd.match(/-m\s+"([\s\S]+?)"\s*(?:&&|$)/);
  return msgMatch ? msgMatch[1] : cmd;
}

/**
 * Find the work-item UUID the agent referenced in the commit message — the
 * "active work-item ref". Returns the first UUID, or null when none is present.
 * A null result means "no active work item" -> capture must NO-OP.
 */
function parseCommitMessageWorkItem(message) {
  const m = String(message || '').match(UUID_PATTERN);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Did the committed tool call actually succeed? PostToolUse provides the tool
 * result. A failed commit (nothing to commit / hook reject / non-zero exit)
 * must NOT capture a row. We treat it as success unless we have positive
 * evidence of failure, OR there is positive evidence of success in stdout.
 */
function commitSucceeded(toolResult) {
  if (!toolResult || typeof toolResult !== 'object') return true; // no signal -> trust HEAD check below
  const code = toolResult.exit_code ?? toolResult.exitCode ?? toolResult.code;
  if (typeof code === 'number') return code === 0;
  const out = `${toolResult.stdout || ''}\n${toolResult.stderr || ''}\n${toolResult.output || ''}`;
  if (/nothing to commit|no changes added|did not match any files|commit failed|error:/i.test(out)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Capture side effects
// ---------------------------------------------------------------------------

/** Real `git rev-parse HEAD` in the given cwd. Returns the SHA, or null on error. */
function gitHead(cwd) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return SHA_PATTERN.test(sha) ? sha : null;
  } catch {
    return null;
  }
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

/** Append the capture payload to the test/offline sink, if configured. */
function writeSink(payload) {
  const sink = process.env.RDC_COMMIT_CAPTURE_SINK;
  if (!sink) return;
  try {
    fs.mkdirSync(path.dirname(sink), { recursive: true });
    fs.appendFileSync(sink, JSON.stringify(payload) + '\n');
  } catch (_) {}
}

/**
 * INSERT the captured row into work_item_commits via the Supabase REST API
 * using the service-role key (bypasses RLS — capture is system-only). The SHA
 * is the live `git rev-parse HEAD`, never an agent-supplied value.
 */
async function insertCommitRow(payload) {
  const key = await getServiceKey();
  if (!key) return { ok: false, reason: 'no-service-key' };
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/rest/v1/work_item_commits`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        work_item_id: payload.work_item_id,
        sha: payload.sha,
        session_id: payload.session_id,
        source: 'commit-hook',
      }),
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Capture orchestration for a single PostToolUse(git commit) event.
 * Returns a result object (also used by tests). NEVER throws.
 */
async function captureCommit(raw) {
  const command = raw?.tool_input?.command || '';
  if (!isGitCommit(command)) return { captured: false, reason: 'not-git-commit' };

  const toolResult = raw.tool_response || raw.tool_result || raw.result || null;
  if (!commitSucceeded(toolResult)) {
    hookLog('require-work-item', 'PostToolUse', 'capture-skip-failed-commit', {});
    return { captured: false, reason: 'commit-not-successful' };
  }

  const message = extractCommitMessage(command);
  const workItemId = parseCommitMessageWorkItem(message);
  if (!workItemId) {
    // No active work item -> NO-OP. No orphan row is ever written.
    hookLog('require-work-item', 'PostToolUse', 'capture-no-item', { msg: String(message).slice(0, 80) });
    return { captured: false, reason: 'no-active-work-item' };
  }

  const cwd = raw.cwd || process.cwd();
  const sha = gitHead(cwd);
  if (!sha) {
    hookLog('require-work-item', 'PostToolUse', 'capture-no-head', { work_item_id: workItemId });
    return { captured: false, reason: 'no-head-sha', work_item_id: workItemId };
  }

  const payload = {
    work_item_id: workItemId,
    sha,                                   // <-- system-derived HEAD, never agent text
    session_id: raw.session_id || null,
  };

  writeSink(payload);
  const insert = await insertCommitRow(payload);
  hookLog('require-work-item', 'PostToolUse', insert.ok ? 'capture-recorded' : 'capture-deferred', {
    work_item_id: workItemId,
    sha,
    insert_reason: insert.reason || null,
  });
  return { captured: true, sha, work_item_id: workItemId, db: insert };
}

// ---------------------------------------------------------------------------
// PreToolUse intent check (unchanged legacy behavior)
// ---------------------------------------------------------------------------

function preToolUse(raw) {
  if (raw.tool_name !== 'Bash') return process.exit(0);
  const command = raw.tool_input?.command || '';
  if (!command.includes('git commit')) return process.exit(0);

  if (fs.existsSync(MARKER_FILE)) {
    hookLog('require-work-item', 'PreToolUse', 'pass-fixit', {});
    return process.exit(0);
  }

  const msg = extractCommitMessage(command);
  if (CONVENTIONAL_TYPES.test(msg.trim()) || UUID_PATTERN.test(msg) || ISSUE_REF.test(msg)) {
    hookLog('require-work-item', 'PreToolUse', 'pass', { msg: msg.slice(0, 80) });
    return process.exit(0);
  }

  hookLog('require-work-item', 'PreToolUse', 'warn', { msg: msg.slice(0, 80) });
  // Warn only — never hard-block commits. Conventional commit format is
  // sufficient self-documentation.
  process.stdout.write(JSON.stringify({
    systemMessage: `⚠️ Commit has no work item reference or conventional commit type.\n` +
      `Preferred format: fix(<scope>): <message> — proceeding anyway.`,
  }));
  return process.exit(0);
}

// ---------------------------------------------------------------------------
// Entry point — event-aware
// ---------------------------------------------------------------------------

async function main() {
  let input = '';
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', resolve);
  });

  let raw;
  try { raw = JSON.parse(input); } catch { return process.exit(0); }

  const event = raw.hook_event_name || raw.hookEventName || 'PreToolUse';

  if (event === 'PostToolUse') {
    if (raw.tool_name && raw.tool_name !== 'Bash') return process.exit(0);
    try { await captureCommit(raw); } catch (e) {
      hookLog('require-work-item', 'PostToolUse', 'capture-error', { error: e.message });
    }
    return process.exit(0); // capture is observe-only; never blocks the loop
  }

  // Default / PreToolUse intent path.
  preToolUse(raw);
}

// Run when executed as a hook; export pure pieces when required by a test.
if (require.main === module) {
  main();
} else {
  module.exports = {
    isGitCommit,
    extractCommitMessage,
    parseCommitMessageWorkItem,
    commitSucceeded,
    gitHead,
    captureCommit,
  };
}
