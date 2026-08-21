import assert from 'node:assert/strict';
import test from 'node:test';

import {
  n1CrypticNames, n2MeaninglessNames, n4MagicNumbers, n7GenericNames,
  f1LongMethods, f2TooManyParams, e1EmptyCatchBlocks, g9DeadCode,
  cleanCodeScore, NOT_IMPLEMENTED,
} from '../../scripts/lib/clean-code-scoring.mjs';
import { makeMember, makeUnit } from './fixtures.mjs';

// ── empty / trivial input ───────────────────────────────────────────────

test('cleanCodeScore: zero members produces zero findings for every rule, never throws', () => {
  const unit = makeUnit({ members: [] });
  const r = cleanCodeScore(unit);
  assert.equal(r.totalFindings, 0);
  for (const rule of Object.values(r.rules)) assert.deepEqual(rule.findings, []);
});

test('cleanCodeScore: a single trivial member with no smells produces zero findings', () => {
  const unit = makeUnit({ members: [makeMember()] });
  const r = cleanCodeScore(unit);
  assert.equal(r.totalFindings, 0);
});

test('NOT_IMPLEMENTED lists the rules intentionally left as judgment calls', () => {
  assert.deepEqual(NOT_IMPLEMENTED, ['N3', 'N5', 'N6', 'C1', 'C2', 'C3', 'C4', 'C5', 'G5', 'G14', 'G16', 'G28']);
});

// ── N1 — cryptic names ──────────────────────────────────────────────────

test('N1: single-letter non-loop-counter name fires', () => {
  const unit = makeUnit({ members: [makeMember({ declaredNames: [{ name: 'x', line: 5 }] })] });
  const r = n1CrypticNames(unit);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].location, /:5$/);
});

test('N1: loop-counter whitelist (i/j/k) does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ declaredNames: [{ name: 'i', line: 5 }, { name: 'j', line: 6 }, { name: 'k', line: 7 }] })] });
  assert.deepEqual(n1CrypticNames(unit).findings, []);
});

test('N1: cryptic two-letter name fires; short-name whitelist (fn/cb/ok/id/db/ui/io) does not', () => {
  const unit = makeUnit({
    members: [makeMember({ declaredNames: [{ name: 'xy', line: 1 }, { name: 'fn', line: 2 }, { name: 'id', line: 3 }] })],
  });
  const r = n1CrypticNames(unit);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].detail, /xy/);
});

// ── N2 — meaningless / noise-word / numeric-suffix names ────────────────

test('N2: noise-word name (data/info/temp/...) fires', () => {
  const unit = makeUnit({ members: [makeMember({ declaredNames: [{ name: 'data', line: 1 }] })] });
  assert.equal(n2MeaninglessNames(unit).findings.length, 1);
});

test('N2: numeric-suffix name (data1/data2 pattern) fires', () => {
  const unit = makeUnit({ members: [makeMember({ declaredNames: [{ name: 'value2', line: 1 }] })] });
  const r = n2MeaninglessNames(unit);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].detail, /numeric-suffix/);
});

test('N2: a well-named binding does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ declaredNames: [{ name: 'customerId', line: 1 }] })] });
  assert.deepEqual(n2MeaninglessNames(unit).findings, []);
});

// ── N4 — magic numbers ───────────────────────────────────────────────────

test('N4: a magic-number fact fires one finding per occurrence', () => {
  const unit = makeUnit({ members: [makeMember({ magicNumbers: [{ value: 86400, line: 10 }, { value: 42, line: 12 }] })] });
  assert.equal(n4MagicNumbers(unit).findings.length, 2);
});

test('N4: no magic numbers does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ magicNumbers: [] })] });
  assert.deepEqual(n4MagicNumbers(unit).findings, []);
});

// ── N7 — generic class/function names ────────────────────────────────────

test('N7: generic class name (whole word) fires on the unit itself', () => {
  const unit = makeUnit({ name: 'Manager', kind: 'class', members: [] });
  const r = n7GenericNames(unit);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].location, 'Manager');
});

test('N7: generic suffix class name (UserDataManager) fires', () => {
  const unit = makeUnit({ name: 'UserDataManager', kind: 'class', members: [] });
  assert.equal(n7GenericNames(unit).findings.length, 1);
});

test('N7: generic member/function name fires independent of the unit name', () => {
  const unit = makeUnit({ name: 'Widget', members: [makeMember({ name: 'processHelper' })] });
  const r = n7GenericNames(unit);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].detail, /processHelper/);
});

test('N7: a descriptive, non-generic name does not fire', () => {
  const unit = makeUnit({ name: 'InvoiceReconciler', members: [makeMember({ name: 'calculateTotal' })] });
  assert.deepEqual(n7GenericNames(unit).findings, []);
});

// ── F1 — long methods (>20 statements) ───────────────────────────────────

test('F1: known violation — 21 statements fires', () => {
  const unit = makeUnit({ members: [makeMember({ statementCount: 21 })] });
  assert.equal(f1LongMethods(unit).findings.length, 1);
});

test('F1: boundary — exactly 20 statements does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ statementCount: 20 })] });
  assert.deepEqual(f1LongMethods(unit).findings, []);
});

test('F1: boundary — 21 is the first statement count that fires', () => {
  const at20 = f1LongMethods(makeUnit({ members: [makeMember({ statementCount: 20 })] }));
  const at21 = f1LongMethods(makeUnit({ members: [makeMember({ statementCount: 21 })] }));
  assert.equal(at20.findings.length, 0);
  assert.equal(at21.findings.length, 1);
});

// ── F2 — too many parameters (>3) ────────────────────────────────────────

test('F2: known violation — 4 parameters fires', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 4 })] });
  assert.equal(f2TooManyParams(unit).findings.length, 1);
});

test('F2: boundary — exactly 3 parameters does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 3 })] });
  assert.deepEqual(f2TooManyParams(unit).findings, []);
});

// ── E1 — empty catch blocks ───────────────────────────────────────────────

test('E1: an empty-catch fact fires', () => {
  const unit = makeUnit({ members: [makeMember({ emptyCatches: [{ line: 8 }] })] });
  const r = e1EmptyCatchBlocks(unit);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].location, /:8$/);
});

test('E1: no empty catches does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ emptyCatches: [] })] });
  assert.deepEqual(e1EmptyCatchBlocks(unit).findings, []);
});

// ── G9 — dead code (unreachable half + unused-export half) ───────────────

test('G9: unreachable-conditional half fires per dead-conditional fact', () => {
  const unit = makeUnit({ members: [makeMember({ deadConditionals: [{ line: 4, kind: 'if-false' }] })] });
  const r = g9DeadCode(unit);
  assert.equal(r.findings.length, 1);
  assert.equal(r.confidence, 'medium'); // no deadExportsFacts supplied
});

test('G9: unused-export half fires when referenceCount is exactly 0', () => {
  const unit = makeUnit({ members: [] });
  const r = g9DeadCode(unit, [{ name: 'unusedThing', line: 3, referenceCount: 0, kind: 'FunctionDeclaration' }]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.confidence, 'high'); // deadExportsFacts supplied
});

test('G9: referenceCount -1 (unsupported declaration kind) is unmeasured, never reported as a finding', () => {
  const unit = makeUnit({ members: [] });
  const r = g9DeadCode(unit, [{ name: 'thing', line: 3, referenceCount: -1, kind: 'WeirdKind' }]);
  assert.deepEqual(r.findings, []);
});

test('G9: a positively-referenced export does not fire (mirror of the dead-export case)', () => {
  const unit = makeUnit({ members: [] });
  const r = g9DeadCode(unit, [{ name: 'usedThing', line: 3, referenceCount: 5, kind: 'FunctionDeclaration' }]);
  assert.deepEqual(r.findings, []);
});

test('G9: no dead conditionals and no export facts does not fire, confidence stays medium', () => {
  const unit = makeUnit({ members: [makeMember({ deadConditionals: [] })] });
  const r = g9DeadCode(unit);
  assert.deepEqual(r.findings, []);
  assert.equal(r.confidence, 'medium');
});

// ── cleanCodeScore — full aggregate over all 8 rules at once ─────────────

test('cleanCodeScore: a unit with one violation per rule fires all 8 rules and totals correctly', () => {
  const unit = makeUnit({
    name: 'Manager',
    members: [makeMember({
      name: 'processHelper',
      declaredNames: [{ name: 'x', line: 1 }],
      magicNumbers: [{ value: 99, line: 2 }],
      statementCount: 21,
      paramCount: 4,
      emptyCatches: [{ line: 3 }],
      deadConditionals: [{ line: 4, kind: 'if-true' }],
    })],
  });
  const r = cleanCodeScore(unit);
  assert.equal(r.rules.n1.findings.length, 1);
  assert.equal(r.rules.n4.findings.length, 1);
  assert.equal(r.rules.n7.findings.length, 2); // both unit name AND member name are generic
  assert.equal(r.rules.f1.findings.length, 1);
  assert.equal(r.rules.f2.findings.length, 1);
  assert.equal(r.rules.e1.findings.length, 1);
  assert.equal(r.rules.g9.findings.length, 1);
  assert.equal(r.totalFindings, 8);
});
