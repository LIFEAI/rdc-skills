#!/usr/bin/env node
/**
 * run-evidence-gate.mjs — Truth Gate 3.0 Layer 2, the FUSED evidence primitive.
 *
 * Nidus / D4 principle: "you cannot submit evidence without running the test."
 * This is ONE atomic call that (1) RUNS a verification command, (2) HASHES its
 * captured output server-side, and (3) records the verdict TOGETHER with the
 * hash and a timestamp. Evidence and execution are produced in the same call —
 * an agent can never hand the gate a hash for a run that never happened.
 *
 * The output of runEvidenceGate() is the only legitimate shape of a
 * machine-parseable `verification` artifact: it carries the exact command, the
 * exit code, an SHA-256 of stdout+stderr, and a pass/fail verdict the CALLER
 * did not author. The exit-gate's L2 verifier recognises this shape (and a few
 * other captured-artifact shapes) and rejects anything that is bare prose.
 *
 * Pure-ish: it shells out to run the command but has no DB or network side
 * effects, so it is unit-testable offline.
 */
'use strict';

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** Stable SHA-256 of a string (server-side hash — the caller cannot forge it). */
export function hashOutput(text) {
  return createHash('sha256').update(String(text == null ? '' : text), 'utf8').digest('hex');
}

/**
 * The discriminant marker stamped on every fused artifact. The exit-gate keys
 * on this to recognise a real run-and-attest result vs. an agent-typed string.
 */
export const EVIDENCE_KIND = 'run-evidence-gate/v1';

/**
 * Run a verification command and atomically produce a hashed, verdicted
 * evidence artifact. There is NO path to a verdict that skips the run: the
 * verdict is derived from the actual exit code of the actual spawn.
 *
 * @param {object} spec
 * @param {string}   spec.command       executable to run (e.g. "node", "npx")
 * @param {string[]} [spec.args]        argv for the command
 * @param {string}   [spec.cwd]         working directory
 * @param {object}   [spec.env]         extra env
 * @param {number}   [spec.timeoutMs]   hard timeout (default 120s)
 * @param {string}   [spec.label]       human label for the check
 * @param {(spec)=>{status:number,stdout:string,stderr:string}} [runner]
 *        injectable runner — defaults to spawnSync. Lets tests drive a fake
 *        process WITHOUT removing the "must run" property (the runner is still
 *        invoked exactly once and its result is what the verdict is built from).
 * @returns {object} a fused evidence artifact (see EVIDENCE_KIND).
 */
export function runEvidenceGate(spec, runner) {
  if (!spec || typeof spec !== 'object' || typeof spec.command !== 'string' || !spec.command) {
    // Fail-closed: a malformed request can never produce a "pass".
    return {
      kind: EVIDENCE_KIND,
      ran: false,
      verdict: 'error',
      reason: 'invalid-spec: command is required',
      ts: new Date().toISOString(),
    };
  }

  const exec = typeof runner === 'function' ? runner : defaultRunner;

  let result;
  try {
    result = exec(spec);
  } catch (e) {
    // Spawn itself threw — fail-closed.
    return {
      kind: EVIDENCE_KIND,
      ran: false,
      verdict: 'error',
      reason: `runner-threw: ${e && e.message ? e.message : String(e)}`,
      command: renderCommand(spec),
      ts: new Date().toISOString(),
    };
  }

  // The runner MUST return a numeric status for the verdict to exist. No status
  // (e.g. the process could not be spawned) => no run => fail-closed.
  const status = result && typeof result.status === 'number' ? result.status : null;
  const stdout = result && result.stdout != null ? String(result.stdout) : '';
  const stderr = result && result.stderr != null ? String(result.stderr) : '';

  if (status === null) {
    return {
      kind: EVIDENCE_KIND,
      ran: false,
      verdict: 'error',
      reason: 'runner-produced-no-exit-status (process did not run)',
      command: renderCommand(spec),
      ts: new Date().toISOString(),
    };
  }

  const combined = `EXIT:${status}\n--STDOUT--\n${stdout}\n--STDERR--\n${stderr}`;
  return {
    kind: EVIDENCE_KIND,
    ran: true,
    label: spec.label || null,
    command: renderCommand(spec),
    exit_code: status,
    verdict: status === 0 ? 'pass' : 'fail',
    output_sha256: hashOutput(combined),
    output_bytes: Buffer.byteLength(combined, 'utf8'),
    ts: new Date().toISOString(),
  };
}

function renderCommand(spec) {
  return [spec.command, ...(Array.isArray(spec.args) ? spec.args : [])].join(' ');
}

function defaultRunner(spec) {
  const res = spawnSync(spec.command, Array.isArray(spec.args) ? spec.args : [], {
    cwd: spec.cwd || process.cwd(),
    env: { ...process.env, ...(spec.env || {}) },
    encoding: 'utf8',
    timeout: typeof spec.timeoutMs === 'number' ? spec.timeoutMs : 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * Is `v` a legitimate machine-parseable verification artifact (NOT prose)?
 *
 * Accepts, in order of strength:
 *   1. A fused run-evidence-gate artifact (object or its JSON string) — strongest.
 *   2. A captured-artifact OBJECT with a recognised machine shape:
 *        - { exit_code: <number> }            (tsc / test-runner exit)
 *        - { http_status: <number> }          (captured HTTP status)
 *        - { rowcount: <number> } / row_count (SQL rowcount)
 *        - { passed: <number>, ... }          (test-runner JSON, e.g. vitest)
 *      (a JSON string of any of these is also accepted)
 * REJECTS:
 *   - bare strings ("HTTP 200", "107 nodes", "works", "done") — proxy/prose.
 *   - objects with no machine field.
 */
export function isMachineArtifact(v) {
  if (v == null) return false;

  // String input: only accepted if it parses to a recognised JSON artifact.
  if (typeof v === 'string') {
    const s = v.trim();
    if (!(s.startsWith('{') || s.startsWith('['))) return false; // bare prose
    let parsed;
    try { parsed = JSON.parse(s); } catch { return false; }
    return isMachineArtifact(parsed);
  }

  if (typeof v !== 'object') return false;

  // 1. Fused artifact.
  if (v.kind === EVIDENCE_KIND && v.ran === true && typeof v.output_sha256 === 'string') {
    return true;
  }

  // 2. Recognised captured-artifact object shapes.
  if (typeof v.exit_code === 'number') return true;
  if (typeof v.http_status === 'number' || typeof v.httpStatus === 'number') return true;
  if (typeof v.status_code === 'number' || typeof v.statusCode === 'number') return true;
  if (typeof v.rowcount === 'number' || typeof v.row_count === 'number' || typeof v.rowCount === 'number') return true;
  if (typeof v.passed === 'number' && (typeof v.failed === 'number' || typeof v.total === 'number')) return true;
  if (typeof v.tsc_errors === 'number' || typeof v.tscErrors === 'number') return true;

  return false;
}

/**
 * Does `v` represent a verification whose OUTCOME is a PASS — not merely that it
 * ran? This is the outcome gate that complements isMachineArtifact (the shape
 * gate). A failing run (exit_code:1), an error HTTP status (500), a fused
 * artifact with verdict:'fail', or a test artifact with failures must NOT be
 * accepted as evidence of a passing verification.
 *
 * Returns true ONLY when the artifact is a recognised machine shape AND its
 * outcome reads as a pass. Anything ambiguous or non-passing returns false.
 *
 * Pass rules (mirrors isMachineArtifact's accepted shapes):
 *   - fused run-evidence-gate/v1 → ran===true && verdict==='pass'
 *   - { exit_code }              → exit_code === 0
 *   - { http_status|status_code }→ 200 <= s <= 399
 *   - { passed, failed }         → failed === 0
 *   - { passed, total }          → passed === total
 *   - { tsc_errors }             → tsc_errors === 0
 *   - { rowcount }               → a captured rowcount is presence-only evidence;
 *                                  any numeric rowcount counts as a pass.
 */
export function isPassingArtifact(v) {
  if (v == null) return false;

  // String input: only accepted if it parses to a recognised JSON artifact.
  if (typeof v === 'string') {
    const s = v.trim();
    if (!(s.startsWith('{') || s.startsWith('['))) return false; // bare prose
    let parsed;
    try { parsed = JSON.parse(s); } catch { return false; }
    return isPassingArtifact(parsed);
  }

  if (typeof v !== 'object') return false;

  // Must be a recognised machine shape first.
  if (!isMachineArtifact(v)) return false;

  // 1. Fused artifact — the verdict is authoritative.
  if (v.kind === EVIDENCE_KIND) {
    return v.ran === true && v.verdict === 'pass';
  }

  // 2. Captured-artifact shapes — read the outcome, not just the presence.
  //    A tsc/test error count is checked even alongside another field.
  if (typeof v.tsc_errors === 'number') return v.tsc_errors === 0;
  if (typeof v.tscErrors === 'number') return v.tscErrors === 0;

  if (typeof v.exit_code === 'number') return v.exit_code === 0;

  if (typeof v.http_status === 'number') return v.http_status >= 200 && v.http_status <= 399;
  if (typeof v.httpStatus === 'number') return v.httpStatus >= 200 && v.httpStatus <= 399;
  if (typeof v.status_code === 'number') return v.status_code >= 200 && v.status_code <= 399;
  if (typeof v.statusCode === 'number') return v.statusCode >= 200 && v.statusCode <= 399;

  if (typeof v.passed === 'number') {
    if (typeof v.failed === 'number') return v.failed === 0;
    if (typeof v.total === 'number') return v.passed === v.total;
  }

  if (typeof v.rowcount === 'number') return true;
  if (typeof v.row_count === 'number') return true;
  if (typeof v.rowCount === 'number') return true;

  // Recognised shape but no readable outcome → not a pass (fail-closed).
  return false;
}

export default { runEvidenceGate, hashOutput, isMachineArtifact, isPassingArtifact, EVIDENCE_KIND };
