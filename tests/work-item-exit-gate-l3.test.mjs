#!/usr/bin/env node
/**
 * Truth Gate 3.0 — Layer 3 (validator re-run receipt) tests for the closure gate.
 *
 * Exercises the FLAG-GATED Layer-3 check wired into work-item-exit-gate.js. The
 * receipt store, running-sha probe, and secret are injected via verifyLayer3's
 * `deps`, so the test runs fully offline (no DB, no brain, no clauth). The HMAC
 * is computed with a fixed secret using the SAME canonical field order the gate
 * mirrors from receipt.mjs.
 *
 * Branches proven:
 *   A. flag OFF → ALLOW as today (no-op, no receipt needed)
 *   B. flag ON + valid receipt (fresh nonce, pinned sha, unreplayed) → ALLOW
 *   C. flag ON + NO receipt → DENY
 *   D. flag ON + forged/tampered HMAC → DENY
 *   E. flag ON + stale-by-age receipt → DENY
 *   F. flag ON + replayed nonce (in durable seen-set) → DENY
 *   G. flag ON + wrong git_sha (not the running brain) → DENY
 *   H. flag ON + nonce_in_output:false (cached artifact) → DENY
 *   I. flag ON + witness:"agent" (self-witness) → DENY
 *   J. flag ON + INFRA: no secret → DENY ; no running sha → DENY
 *   K. truthGateFlagEnabled reads the env switch
 *
 * Run: node tests/work-item-exit-gate-l3.test.mjs
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOK = join(REPO_ROOT, 'hooks', 'work-item-exit-gate.js');

const require = createRequire(import.meta.url);
const gate = require(HOOK);

const failures = [];
function assert(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  else process.stdout.write(`  ok  ${name}\n`);
}

const SECRET = 'test-secret-not-real';
const SHA = 'c3189c9d58a37d648e9de4a6bcd7d46772053eea';
const NOW = Date.parse('2026-06-25T12:00:00Z');
const SIGNED_FIELDS = gate.VALIDATOR_SIGNED_FIELDS;

function signValidator(receipt, secret = SECRET) {
  const picked = {};
  for (const k of SIGNED_FIELDS) picked[k] = receipt[k] ?? null;
  return crypto.createHmac('sha256', secret).update(JSON.stringify(picked)).digest('hex');
}

/** A signed, otherwise-valid validator receipt; override fields to break it. */
function freshReceipt(over = {}) {
  const r = {
    claim: 'WP-4 validator re-run passes',
    witness: 'validator-rerun',
    git_sha: SHA,
    nonce: 'vrr-fresh-abc123',
    command: 'node scripts/needle-verify.mjs',
    result: { exit_code: 0 },
    nonce_in_output: true,
    ts: new Date(NOW - 60_000).toISOString(), // 1 min old
    ...over,
  };
  r.hmac = signValidator(r);
  return r;
}

const statusCall = { id: '11111111-2222-3333-4444-555555555555', actorSessionId: 'validator-x', actorRole: 'validator' };
const item = { id: statusCall.id, item_type: 'task', status: 'review', session_id: 'sess-origin' };

/** Build a deps object that drives verifyLayer3 fully offline. */
function deps({ flag = true, secret = SECRET, runningSha = SHA, receipts = [], seenNonces = [] } = {}) {
  return {
    flagEnabled: async () => flag,
    getSecret: async () => secret,
    getRunningSha: async () => runningSha,
    loadReceiptRows: async () => receipts.map((p) => ({ payload: p })),
    loadSeenNonces: async () => seenNonces,
  };
}

/** Run verifyLayer3 and return the GateDenied reason, or null if it allowed. */
async function runL3(d) {
  try {
    await gate.verifyLayer3(statusCall, item, d, NOW);
    return null; // ALLOW
  } catch (e) {
    if (e instanceof gate.GateDenied) return e.reason;
    throw e;
  }
}

await (async () => {
  // A. flag OFF → ALLOW as today (no receipt needed at all)
  {
    const r = await runL3(deps({ flag: false, receipts: [] }));
    assert('A. flag OFF → ALLOW (no-op, no receipt)', r === null, r || '');
  }

  // B. flag ON + valid receipt → ALLOW
  {
    const r = await runL3(deps({ receipts: [freshReceipt()] }));
    assert('B. flag ON + valid receipt → ALLOW', r === null, r || '');
  }

  // C. flag ON + NO receipt → DENY
  {
    const r = await runL3(deps({ receipts: [] }));
    assert('C. flag ON + no receipt → DENY', r && /no validator re-run receipt found/.test(r), r || 'no denial');
  }

  // D. flag ON + forged/tampered HMAC → DENY
  {
    const bad = freshReceipt();
    bad.claim = 'TAMPERED after signing'; // signature no longer matches
    const r = await runL3(deps({ receipts: [bad] }));
    assert('D. flag ON + forged HMAC → DENY', r && /HMAC invalid\/absent/.test(r), r || 'no denial');
  }

  // E. flag ON + stale-by-age receipt → DENY
  {
    const stale = freshReceipt({ ts: new Date(NOW - 60 * 60_000).toISOString() });
    const r = await runL3(deps({ receipts: [stale] }));
    assert('E. flag ON + stale receipt → DENY', r && /stale/.test(r), r || 'no denial');
  }

  // F. flag ON + replayed nonce (in durable seen-set) → DENY
  {
    const rec = freshReceipt();
    const r = await runL3(deps({ receipts: [rec], seenNonces: [rec.nonce] }));
    assert('F. flag ON + replayed nonce → DENY', r && /replayed|already consumed/.test(r), r || 'no denial');
  }

  // G. flag ON + wrong git_sha (not the running brain) → DENY
  {
    const r = await runL3(deps({ receipts: [freshReceipt()], runningSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }));
    assert('G. flag ON + wrong git_sha → DENY', r && /git_sha/.test(r), r || 'no denial');
  }

  // H. flag ON + nonce_in_output:false (cached artifact) → DENY
  {
    const r = await runL3(deps({ receipts: [freshReceipt({ nonce_in_output: false })] }));
    assert('H. flag ON + nonce_in_output:false → DENY', r && /nonce_in_output|cached|replay/.test(r), r || 'no denial');
  }

  // I. flag ON + witness:"agent" (self-witness) → DENY
  {
    const r = await runL3(deps({ receipts: [freshReceipt({ witness: 'agent' })] }));
    assert('I. flag ON + witness:agent → DENY', r && /witness/.test(r), r || 'no denial');
  }

  // I2. flag ON + result not a pass (exit_code:1) → DENY
  {
    const r = await runL3(deps({ receipts: [freshReceipt({ result: { exit_code: 1 } })] }));
    assert('I2. flag ON + failing result → DENY', r && /pass/.test(r), r || 'no denial');
  }

  // J. INFRA fail-closed: no secret → DENY ; no running sha → DENY
  {
    const r1 = await runL3(deps({ secret: null, receipts: [freshReceipt()] }));
    assert('J. flag ON + no secret → DENY (INFRA is a BLOCK)', r1 && /INFRA: no truth-gate HMAC secret/.test(r1), r1 || 'no denial');
    const r2 = await runL3(deps({ runningSha: null, receipts: [freshReceipt()] }));
    assert('J. flag ON + no running sha → DENY (INFRA is a BLOCK)', r2 && /INFRA: could not read the running brain git_sha/.test(r2), r2 || 'no denial');
  }

  // K. truthGateFlagEnabled reads the env switch (default OFF)
  {
    const prev = process.env.RDC_TRUTHGATE_REQUIRE_VALIDATOR_RECEIPT;
    delete process.env.RDC_TRUTHGATE_REQUIRE_VALIDATOR_RECEIPT;
    assert('K. flag default OFF', gate.truthGateFlagEnabled('require_validator_receipt') === false);
    process.env.RDC_TRUTHGATE_REQUIRE_VALIDATOR_RECEIPT = 'true';
    assert('K. flag ON via env', gate.truthGateFlagEnabled('require_validator_receipt') === true);
    process.env.RDC_TRUTHGATE_REQUIRE_VALIDATOR_RECEIPT = '0';
    assert('K. flag "0" is OFF', gate.truthGateFlagEnabled('require_validator_receipt') === false);
    if (prev === undefined) delete process.env.RDC_TRUTHGATE_REQUIRE_VALIDATOR_RECEIPT;
    else process.env.RDC_TRUTHGATE_REQUIRE_VALIDATOR_RECEIPT = prev;
  }

  // L. pickNewestValidatorReceipt picks the latest by ts
  {
    const older = freshReceipt({ nonce: 'older', ts: new Date(NOW - 10 * 60_000).toISOString() });
    const newer = freshReceipt({ nonce: 'newer', ts: new Date(NOW - 60_000).toISOString() });
    const picked = gate.pickNewestValidatorReceipt([{ payload: older }, { payload: newer }]);
    assert('L. picks newest receipt by ts', picked && picked.nonce === 'newer', picked ? picked.nonce : 'null');
  }
})();

if (failures.length > 0) {
  console.error('\nwork-item-exit-gate L3 tests — FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nwork-item-exit-gate L3 tests — PASS');
