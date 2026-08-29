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
 * PreToolUse (intent) behavior (2026-08-16 — real teeth, flow-gated):
 *   - flow does NOT require a work item (rdc-flow.mjs: plan/design/collab,
 *     or a relaxed mode — hotfix/maintenance) -> pass silently, no nag
 *   - fixit.marker present                  -> pass
 *   - conventional type / UUID / #issue ref -> pass
 *   - otherwise, flow DOES require one (build/refactor/overnight, or no
 *     flow declared at all — fail-closed default)
 *                                            -> BLOCK (was: warn, proceed anyway)
 *
 * Was advisory-only unconditionally ("never hard-block commits... proceeding
 * anyway") — Dave, 2026-08-16, on seeing that exact text fire with no
 * enforcement behind it: the model declares its own flow (rdc-flow.mjs,
 * lifeai-env), and THIS is where that declaration gets teeth. A
 * conversational flow (plan/design/collab) never needed a work item and
 * still doesn't — silently, not even a warning. A code-shipping flow
 * (build/refactor/overnight) now actually stops the commit instead of
 * printing a sentence nobody reads.
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

/**
 * Extract the commit message from the command.
 *
 * Returns `{ message, readable }`. `readable:false` means the message is NOT
 * present in the command at all — the caller must not treat that as "the agent
 * wrote a bad message", because no message was ever offered to inspect.
 *
 * Three shapes carry a message, and only the first was ever read:
 *
 *   -m "subject"          -> in the command
 *   <<'EOF' … EOF         -> in the command, but AFTER the flags (heredoc body)
 *   -F <path>             -> in a FILE on disk
 *   -F -   (a real pipe)  -> nowhere we can see it
 *
 * The old fallback returned the WHOLE COMMAND as the message. CONVENTIONAL_TYPES
 * is anchored at ^, so a heredoc commit whose subject was a perfectly good
 * `fix(scope): …` could never match — the string being tested started with
 * `( cd … && git add … && git commit -q -F -`. Measured 2026-08-29: this hook
 * blocked a commit whose message did begin with `fix(guards):`, and told the
 * author there was "no conventional commit type", which was false.
 *
 * That is the recurring defect in one line: a checker that cannot read its
 * evidence reported ABSENCE instead of reporting that it could not read.
 * `git commit -F` is the sanctioned way to write a long message (a heredoc is
 * how every multi-paragraph commit in this fleet is authored), so the one path
 * the gate made unusable was the good one.
 */
function extractCommitMessage(command) {
  const cmd = String(command || '');

  const msgMatch = cmd.match(/-m\s+["']([^"']+)["']/s) ||
                   cmd.match(/-m\s+"([\s\S]+?)"\s*(?:&&|$)/);
  if (msgMatch) return { message: msgMatch[1], readable: true };

  // Heredoc: `<<'EOF' … EOF` / `<<"EOF"` / `<<EOF` / `<<-EOF`. The body IS in
  // the command; it just does not follow a -m. Take everything between the
  // delimiter line and its closing line.
  const hd = cmd.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n[ \t]*\2\b/);
  if (hd) return { message: hd[3], readable: true };

  // -F <path>: the message is on disk. `-F -` is stdin and is NOT a path.
  const fileMatch = cmd.match(/(?:^|\s)(?:-F|--file)[=\s]+(?!-\s|-$)(['"]?)([^'"\s]+)\1/);
  if (fileMatch) {
    try {
      return { message: fs.readFileSync(fileMatch[2], 'utf8'), readable: true };
    } catch {
      return { message: '', readable: false };
    }
  }

  // A real `-F -` pipe, or an editor-authored message: unreadable from here.
  if (/(?:^|\s)(?:-F|--file)[=\s]+-(?:\s|$)/.test(cmd)) return { message: '', readable: false };

  return { message: cmd, readable: true };
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

  const { message } = extractCommitMessage(command);
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
// PreToolUse intent check — flow-gated (2026-08-16)
// ---------------------------------------------------------------------------

/**
 * Does the CURRENT model-declared flow (rdc-flow.mjs, lifeai-env) require a
 * work item right now? Dynamic import because this file is CommonJS and
 * rdc-flow.mjs is ESM; resolved via $LIFEAI_ENV so this works identically on
 * whichever machine/lane the hook actually runs from.
 *
 * FAILS CLOSED: any error (lifeai-env not on this box, module not found,
 * whatever) returns true — "requires a work item" — the exact behavior this
 * file had before flow-state existed. Introducing this mechanism can only
 * EXEMPT a case that used to warn, never silently add a requirement that
 * was not already effectively there.
 */
async function requiresWorkItemNow() {
  const hub = process.env.LIFEAI_ENV || 'C:/Dev/lifeai-env';
  try {
    const mod = await import(`file://${path.join(hub, 'hooks', 'lib', 'rdc-flow.mjs').replace(/\\/g, '/')}`);
    return mod.requiresWorkItem();
  } catch (e) {
    hookLog('require-work-item', 'PreToolUse', 'flow-check-error-fail-closed', { error: e.message });
    return true;
  }
}

async function preToolUse(raw) {
  if (raw.tool_name !== 'Bash') return process.exit(0);
  const command = raw.tool_input?.command || '';
  if (!command.includes('git commit')) return process.exit(0);

  if (!(await requiresWorkItemNow())) {
    hookLog('require-work-item', 'PreToolUse', 'pass-flow-exempt', {});
    return process.exit(0);
  }

  if (fs.existsSync(MARKER_FILE)) {
    hookLog('require-work-item', 'PreToolUse', 'pass-fixit', {});
    return process.exit(0);
  }

  const { message: msg, readable } = extractCommitMessage(command);

  // The message is real but arrives on a pipe (`-F -` with no heredoc) or from
  // an editor. Say THAT, and name a runnable alternative — do not report it as
  // a missing work item, which is a different fact and sends the author looking
  // for the wrong thing.
  if (!readable) {
    hookLog('require-work-item', 'PreToolUse', 'block-unreadable', {});
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: '⛔ [require-work-item] The commit message arrives on stdin, so this check cannot read it '
        + 'and will not guess. Nothing is wrong with your message — it is unverifiable from here. '
        + 'Re-run with the message where the check can see it: `git commit -F <path>` (a file), '
        + 'a heredoc (`git commit -F - <<\'EOF\' … EOF`), or `-m "<type>(<scope>): …"`.',
    }));
    return process.exit(0);
  }

  if (CONVENTIONAL_TYPES.test(msg.trim()) || UUID_PATTERN.test(msg) || ISSUE_REF.test(msg)) {
    hookLog('require-work-item', 'PreToolUse', 'pass', { msg: msg.slice(0, 80) });
    return process.exit(0);
  }

  // BLOCK, not warn (2026-08-16). The current flow (build/refactor/overnight,
  // or none declared at all) requires a work item and none was referenced —
  // this used to print a sentence and let the commit through regardless.
  hookLog('require-work-item', 'PreToolUse', 'block', { msg: msg.slice(0, 80) });
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '⛔ [require-work-item] No work item reference or conventional commit type, and the current '
      + 'flow requires one (build/refactor/overnight, or no flow declared). Add a Work-Item UUID or '
      + '#issue ref to the message, use fix(<scope>): ..., or declare a flow that does not need one '
      + '(rdc-flow.mjs: plan/design/collab) if this genuinely ships no trackable work.',
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
  await preToolUse(raw);
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
