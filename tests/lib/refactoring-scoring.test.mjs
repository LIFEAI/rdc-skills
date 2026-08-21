import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractMethodOpportunities, extractClassOpportunities,
  introduceParameterObjectOpportunities, replaceMagicNumberOpportunities,
  consolidateDuplicateCodeOpportunities, decomposeConditionalOpportunities,
  strategyTransformOpportunities, factoryTransformOpportunities,
  nullObjectTransformOpportunities, estimateEffort, refactoringScore,
} from '../../scripts/lib/refactoring-scoring.mjs';
import { makeMember, makeUnit } from './fixtures.mjs';

// ── empty / trivial input ───────────────────────────────────────────────

test('refactoringScore: zero members fires zero findings for all 9 rules, never throws', () => {
  const unit = makeUnit({ members: [] });
  const r = refactoringScore(unit);
  assert.equal(r.totalFindings, 0);
  assert.equal(Object.keys(r.rules).length, 9);
});

test('refactoringScore: a single trivial member with no smells fires nothing', () => {
  assert.equal(refactoringScore(makeUnit({ members: [makeMember()] })).totalFindings, 0);
});

// ── extract-method (statementCount > 25) ──────────────────────────────────

test('extract-method: 26 statements fires', () => {
  const unit = makeUnit({ members: [makeMember({ statementCount: 26 })] });
  assert.equal(extractMethodOpportunities(unit).findings.length, 1);
});

test('extract-method: boundary — exactly 25 statements does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ statementCount: 25 })] });
  assert.deepEqual(extractMethodOpportunities(unit).findings, []);
});

// ── extract-class (class with >15 members) ─────────────────────────────

test('extract-class: a class with 16 members fires', () => {
  const members = Array.from({ length: 16 }, (_, i) => makeMember({ name: `m${i}` }));
  const unit = makeUnit({ kind: 'class', members });
  assert.equal(extractClassOpportunities(unit).findings.length, 1);
});

test('extract-class: boundary — a class with exactly 15 members does not fire', () => {
  const members = Array.from({ length: 15 }, (_, i) => makeMember({ name: `m${i}` }));
  const unit = makeUnit({ kind: 'class', members });
  assert.deepEqual(extractClassOpportunities(unit).findings, []);
});

test('extract-class: a MODULE with 16 top-level functions does not fire (class-only rule)', () => {
  const members = Array.from({ length: 16 }, (_, i) => makeMember({ name: `m${i}` }));
  const unit = makeUnit({ kind: 'module', members });
  assert.deepEqual(extractClassOpportunities(unit).findings, []);
});

// ── introduce-parameter-object (paramCount > 4) ──────────────────────────

test('introduce-parameter-object: 5 params fires', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 5 })] });
  assert.equal(introduceParameterObjectOpportunities(unit).findings.length, 1);
});

test('introduce-parameter-object: boundary — exactly 4 params does not fire (differs from clean-code F2 at >3)', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 4 })] });
  assert.deepEqual(introduceParameterObjectOpportunities(unit).findings, []);
});

// ── replace-magic-number (unit-wide count > 5) ────────────────────────────

test('replace-magic-number: unit-wide total of 6 magic numbers fires, one finding per occurrence', () => {
  const unit = makeUnit({
    members: [makeMember({ magicNumbers: Array.from({ length: 6 }, (_, i) => ({ value: i + 10, line: i + 1 })) })],
  });
  const r = replaceMagicNumberOpportunities(unit);
  assert.equal(r.findings.length, 6);
});

test('replace-magic-number: boundary — unit-wide total of exactly 5 does not fire', () => {
  const unit = makeUnit({
    members: [makeMember({ magicNumbers: Array.from({ length: 5 }, (_, i) => ({ value: i + 10, line: i + 1 })) })],
  });
  assert.deepEqual(replaceMagicNumberOpportunities(unit).findings, []);
});

test('replace-magic-number: aggregates ACROSS members, not per-member', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', magicNumbers: [{ value: 1, line: 1 }, { value: 2, line: 2 }, { value: 3, line: 3 }] }),
      makeMember({ name: 'b', magicNumbers: [{ value: 4, line: 4 }, { value: 5, line: 5 }, { value: 6, line: 6 }] }),
    ],
  });
  assert.equal(replaceMagicNumberOpportunities(unit).findings.length, 6);
});

// ── consolidate-duplicate-code (>3 groups, each repeated >3x) ────────────

function repeatedStatementText(text, count, memberName = 'm') {
  return Array.from({ length: count }, (_, i) => ({ text, line: i + 1 }));
}

test('consolidate-duplicate-code: 4 distinct patterns each repeated 4x fires with 4 findings', () => {
  const unit = makeUnit({
    members: [makeMember({
      statementTexts: [
        ...repeatedStatementText('const a = doSomethingLong();', 4),
        ...repeatedStatementText('const b = doAnotherThingLong();', 4),
        ...repeatedStatementText('const c = doThirdThingLong();', 4),
        ...repeatedStatementText('const d = doFourthThingLong();', 4),
      ],
    })],
  });
  const r = consolidateDuplicateCodeOpportunities(unit);
  assert.equal(r.findings.length, 4);
});

test('consolidate-duplicate-code: boundary — exactly 3 distinct qualifying patterns does not fire', () => {
  const unit = makeUnit({
    members: [makeMember({
      statementTexts: [
        ...repeatedStatementText('const a = doSomethingLong();', 4),
        ...repeatedStatementText('const b = doAnotherThingLong();', 4),
        ...repeatedStatementText('const c = doThirdThingLong();', 4),
      ],
    })],
  });
  assert.deepEqual(consolidateDuplicateCodeOpportunities(unit).findings, []);
});

test('consolidate-duplicate-code: boundary — a pattern repeated exactly 3x (not >3) does not count toward a group', () => {
  const unit = makeUnit({
    members: [makeMember({
      statementTexts: [
        ...repeatedStatementText('const a = doSomethingLong();', 3),
        ...repeatedStatementText('const b = doAnotherThingLong();', 4),
        ...repeatedStatementText('const c = doThirdThingLong();', 4),
        ...repeatedStatementText('const d = doFourthThingLong();', 4),
      ],
    })],
  });
  // only 3 groups actually qualify (>3 repeats) despite 4 distinct texts present
  assert.deepEqual(consolidateDuplicateCodeOpportunities(unit).findings, []);
});

// ── decompose-conditional (>2 complex conditionals per unit) ─────────────

test('decompose-conditional: 3 complex conditionals (unit-wide) fires', () => {
  const unit = makeUnit({
    members: [makeMember({ complexConditionals: [{ line: 1, length: 60 }, { line: 2, length: 70 }, { line: 3, length: 55 }] })],
  });
  assert.equal(decomposeConditionalOpportunities(unit).findings.length, 3);
});

test('decompose-conditional: boundary — exactly 2 complex conditionals does not fire', () => {
  const unit = makeUnit({
    members: [makeMember({ complexConditionals: [{ line: 1, length: 60 }, { line: 2, length: 70 }] })],
  });
  assert.deepEqual(decomposeConditionalOpportunities(unit).findings, []);
});

// ── strategy-transform (switch dispatching behavior) ──────────────────────

test('strategy-transform: switchStatements.hasBehaviorCall fires', () => {
  const unit = makeUnit({ members: [makeMember({ switchStatements: [{ line: 4, hasBehaviorCall: true, hasTypeCreation: false }] })] });
  assert.equal(strategyTransformOpportunities(unit).findings.length, 1);
});

test('strategy-transform: hasBehaviorCall false does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ switchStatements: [{ line: 4, hasBehaviorCall: false, hasTypeCreation: false }] })] });
  assert.deepEqual(strategyTransformOpportunities(unit).findings, []);
});

// ── factory-transform (switch on type creating objects) ──────────────────

test('factory-transform: switchStatements.hasTypeCreation fires', () => {
  const unit = makeUnit({ members: [makeMember({ switchStatements: [{ line: 4, hasBehaviorCall: false, hasTypeCreation: true }] })] });
  assert.equal(factoryTransformOpportunities(unit).findings.length, 1);
});

test('factory-transform: hasTypeCreation false does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ switchStatements: [{ line: 4, hasBehaviorCall: false, hasTypeCreation: false }] })] });
  assert.deepEqual(factoryTransformOpportunities(unit).findings, []);
});

// ── null-object-transform (>5 null checks per unit) ───────────────────────

test('null-object-transform: 6 null checks (unit-wide) fires', () => {
  const unit = makeUnit({
    members: [makeMember({ nullChecks: Array.from({ length: 6 }, (_, i) => ({ line: i + 1 })) })],
  });
  assert.equal(nullObjectTransformOpportunities(unit).findings.length, 6);
});

test('null-object-transform: boundary — exactly 5 null checks does not fire', () => {
  const unit = makeUnit({
    members: [makeMember({ nullChecks: Array.from({ length: 5 }, (_, i) => ({ line: i + 1 })) })],
  });
  assert.deepEqual(nullObjectTransformOpportunities(unit).findings, []);
});

// ── estimateEffort — unmeasured, boundary, package-crossing ──────────────

test('estimateEffort: no referenceSites is reported unmeasured, never as zero effort', () => {
  const r = estimateEffort({ unitPackage: 'packages/core', referenceSites: null });
  assert.equal(r.effort, null);
  assert.equal(r.confidence, 'unmeasured');
});

test('estimateEffort: referenceCount -1 is unmeasured', () => {
  const r = estimateEffort({ unitPackage: 'packages/core', referenceSites: { referenceCount: -1, files: [], kind: null } });
  assert.equal(r.effort, null);
});

test('estimateEffort: a reference site outside the unit package is "high" via package-boundary crossing', () => {
  const r = estimateEffort({
    unitPackage: 'packages/core',
    referenceSites: { referenceCount: 2, files: ['/repo/packages/other/consumer.mjs'], kind: 'FunctionDeclaration' },
  });
  assert.equal(r.effort, 'high');
  assert.equal(r.criterion, 'crosses a package boundary');
  assert.equal(r.invariantCheckRequired, true);
});

test('estimateEffort: boundary — 16 call sites, same package, is "high" via the >15 criterion', () => {
  const files = Array.from({ length: 16 }, (_, i) => `/repo/packages/core/consumer${i}.mjs`);
  const r = estimateEffort({ unitPackage: 'packages/core', referenceSites: { referenceCount: 16, files, kind: 'FunctionDeclaration' } });
  assert.equal(r.effort, 'high');
  assert.equal(r.criterion, '>15 call sites');
});

test('estimateEffort: boundary — exactly 15 call sites, same package, is "medium"', () => {
  const files = Array.from({ length: 15 }, (_, i) => `/repo/packages/core/consumer${i}.mjs`);
  const r = estimateEffort({ unitPackage: 'packages/core', referenceSites: { referenceCount: 15, files, kind: 'FunctionDeclaration' } });
  assert.equal(r.effort, 'medium');
});

test('estimateEffort: boundary — exactly 4 call sites is "medium"', () => {
  const files = Array.from({ length: 4 }, (_, i) => `/repo/packages/core/c${i}.mjs`);
  const r = estimateEffort({ unitPackage: 'packages/core', referenceSites: { referenceCount: 4, files, kind: 'FunctionDeclaration' } });
  assert.equal(r.effort, 'medium');
});

test('estimateEffort: boundary — exactly 3 call sites is "low"', () => {
  const files = Array.from({ length: 3 }, (_, i) => `/repo/packages/core/c${i}.mjs`);
  const r = estimateEffort({ unitPackage: 'packages/core', referenceSites: { referenceCount: 3, files, kind: 'FunctionDeclaration' } });
  assert.equal(r.effort, 'low');
});

// ── refactoringScore — full aggregate ──────────────────────────────────

test('refactoringScore: a unit tripping several rules sums totalFindings correctly', () => {
  const unit = makeUnit({
    kind: 'class',
    members: [
      makeMember({ name: 'longMethod', statementCount: 30 }),
      makeMember({ name: 'manyParams', paramCount: 6 }),
    ],
  });
  const r = refactoringScore(unit);
  assert.equal(r.rules['extract-method'].findings.length, 1);
  assert.equal(r.rules['introduce-parameter-object'].findings.length, 1);
  assert.equal(r.totalFindings, 2);
});
