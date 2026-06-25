#!/usr/bin/env node
/**
 * Truth Gate 3.0 — fused run-evidence-gate primitive tests.
 *
 * Proves the Nidus property: evidence cannot exist without a run.
 *   - a verdict is emitted ONLY after the command runs (no run => no pass).
 *   - the output hash is server-side and derived from the actual run.
 *   - isMachineArtifact rejects prose and accepts captured machine shapes.
 *
 * Run: node tests/run-evidence-gate.test.mjs
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = pathToFileURL(join(resolve(__dirname, '..'), 'hooks', 'lib', 'run-evidence-gate.mjs')).href;
const { runEvidenceGate, isMachineArtifact, hashOutput, EVIDENCE_KIND } = await import(LIB);

const failures = [];
function assert(name, cond, detail = '') {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  else process.stdout.write(`  ok  ${name}\n`);
}

// --- 1. A passing run produces verdict:'pass' WITH a hash, only after running.
let ranCount = 0;
const passArt = runEvidenceGate(
  { command: 'noop', args: ['x'], label: 'unit-pass' },
  () => { ranCount += 1; return { status: 0, stdout: 'ok', stderr: '' }; },
);
assert('runner invoked exactly once', ranCount === 1, String(ranCount));
assert('pass: kind stamped', passArt.kind === EVIDENCE_KIND);
assert('pass: ran=true', passArt.ran === true);
assert('pass: verdict=pass', passArt.verdict === 'pass', passArt.verdict);
assert('pass: output_sha256 present', typeof passArt.output_sha256 === 'string' && passArt.output_sha256.length === 64, passArt.output_sha256);

// --- 2. A failing run -> verdict:'fail', never silently pass.
const failArt = runEvidenceGate(
  { command: 'noop' },
  () => ({ status: 7, stdout: '', stderr: 'boom' }),
);
assert('fail: verdict=fail', failArt.verdict === 'fail', failArt.verdict);
assert('fail: exit_code preserved', failArt.exit_code === 7, String(failArt.exit_code));

// --- 3. NO RUN -> NO verdict (fail-closed). Invalid spec.
const noCmd = runEvidenceGate({});
assert('no-command: ran=false', noCmd.ran === false);
assert('no-command: verdict=error (never pass)', noCmd.verdict === 'error', noCmd.verdict);

// --- 4. Runner that yields no exit status -> cannot have run -> error.
const noStatus = runEvidenceGate({ command: 'noop' }, () => ({ status: null, stdout: '', stderr: '' }));
assert('no-status: ran=false', noStatus.ran === false);
assert('no-status: verdict=error', noStatus.verdict === 'error', noStatus.verdict);

// --- 5. Runner throws -> fail-closed error, never pass.
const threw = runEvidenceGate({ command: 'noop' }, () => { throw new Error('spawn failed'); });
assert('runner-throws: ran=false', threw.ran === false);
assert('runner-throws: verdict=error', threw.verdict === 'error', threw.verdict);

// --- 6. Hash is deterministic + derived from the captured combined output.
assert('hash deterministic', hashOutput('abc') === hashOutput('abc'));
assert('hash differs by content', hashOutput('abc') !== hashOutput('abd'));

// --- 7. isMachineArtifact discrimination.
assert('reject bare prose "HTTP 200"', isMachineArtifact('HTTP 200') === false);
assert('reject bare prose "works"', isMachineArtifact('works') === false);
assert('reject "107 nodes"', isMachineArtifact('107 nodes') === false);
assert('accept fused artifact', isMachineArtifact(passArt) === true);
assert('accept {exit_code}', isMachineArtifact({ exit_code: 0 }) === true);
assert('accept {http_status}', isMachineArtifact({ http_status: 200 }) === true);
assert('accept {rowcount}', isMachineArtifact({ rowcount: 12 }) === true);
assert('accept {passed,total}', isMachineArtifact({ passed: 5, total: 5 }) === true);
assert('accept JSON string of machine shape', isMachineArtifact('{"exit_code":0}') === true);
assert('reject plain object', isMachineArtifact({ note: 'done' }) === false);
assert('reject null', isMachineArtifact(null) === false);

if (failures.length > 0) {
  console.error('\nrun-evidence-gate tests — FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nrun-evidence-gate tests — PASS');
