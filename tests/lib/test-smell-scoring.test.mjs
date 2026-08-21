import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findTestBlocks, findSetupBlocks, checkInsufficientTests, checkIgnoredTests,
  checkExhaustiveTesting, checkLongTests, checkSlowTests, checkFragileTests,
  checkDuplicatedSetupAcrossFiles, checkIndependentSharedState,
  countExportedUnits, guessSourceFilePath, scoreTestFile,
} from '../../scripts/lib/test-smell-scoring.mjs';
import { makeMember, makeUnit } from './fixtures.mjs';

// ── empty / trivial input ───────────────────────────────────────────────

test('scoreTestFile: empty text produces zero test blocks and zero findings, never throws', () => {
  const r = scoreTestFile('');
  assert.equal(r.testBlockCount, 0);
  assert.deepEqual(r.findings, []);
});

test('scoreTestFile: a single-line file with no test() calls produces zero findings', () => {
  const r = scoreTestFile('const x = 1;');
  assert.equal(r.testBlockCount, 0);
  assert.deepEqual(r.findings, []);
});

test('findTestBlocks: a minimal single passing test is found with correct title/kind', () => {
  const blocks = findTestBlocks(`test('does a thing', () => { assert.ok(true); });`);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'test');
  assert.equal(blocks[0].title, 'does a thing');
  assert.equal(blocks[0].skipped, false);
});

// ── T1 — Insufficient Tests ────────────────────────────────────────────

test('T1: fewer test() blocks than exported units fires', () => {
  const blocks = findTestBlocks(`test('a', () => {});`);
  const r = checkInsufficientTests(blocks, 3);
  assert.ok(r);
  assert.equal(r.ruleId, 'T1');
});

test('T1: exportedUnitCount null is unmeasured, returns null (not a finding, not silence-as-clean)', () => {
  const blocks = findTestBlocks(`test('a', () => {});`);
  assert.equal(checkInsufficientTests(blocks, null), null);
});

test('T1: exportedUnitCount 0 (nothing exported) does not fire', () => {
  const blocks = findTestBlocks(`test('a', () => {});`);
  assert.equal(checkInsufficientTests(blocks, 0), null);
});

test('T1: boundary — test count equal to exported count does not fire', () => {
  const blocks = findTestBlocks(`test('a', () => {}); test('b', () => {});`);
  assert.equal(checkInsufficientTests(blocks, 2), null);
});

test('T1: boundary — one fewer test than exported count fires', () => {
  const blocks = findTestBlocks(`test('a', () => {}); test('b', () => {});`);
  assert.ok(checkInsufficientTests(blocks, 3));
});

test('countExportedUnits: sums isPublic members across units, null for empty/absent', () => {
  assert.equal(countExportedUnits([]), null);
  assert.equal(countExportedUnits(null), null);
  const units = [makeUnit({ members: [makeMember({ isPublic: true }), makeMember({ isPublic: false })] })];
  assert.equal(countExportedUnits(units), 1);
});

test('guessSourceFilePath: maps a .test.mjs path back to its source path', () => {
  assert.equal(guessSourceFilePath('foo.test.mjs'), 'foo.mjs');
  // the test-dir swap only fires when the segment is bracketed by separators
  // on both sides (`/test/`), not merely a leading path segment
  assert.equal(guessSourceFilePath('project/test/x.test.ts'), 'project/src/x.ts');
});

// ── T2 — Ignored Tests ─────────────────────────────────────────────────

test('T2: it.skip fires', () => {
  const text = `it.skip('broken', () => {});`;
  const blocks = findTestBlocks(text);
  const findings = checkIgnoredTests(text, blocks);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'T2');
});

test('T2: test.skip fires', () => {
  const text = `test.skip('broken', () => {});`;
  const blocks = findTestBlocks(text);
  assert.equal(checkIgnoredTests(text, blocks).length, 1);
});

test('T2: xdescribe fires (whole-suite disable)', () => {
  const text = `xdescribe('a suite', () => {});`;
  assert.equal(checkIgnoredTests(text, []).length, 1);
});

test('T2: an un-skipped test does not fire', () => {
  const text = `it('works', () => { assert.ok(true); });`;
  const blocks = findTestBlocks(text);
  assert.deepEqual(checkIgnoredTests(text, blocks), []);
});

// ── T5 — Exhaustive Testing (>10 assertion calls per block) ──────────────

test('T5: 11 assertion calls in one test fires', () => {
  const asserts = Array.from({ length: 11 }, (_, i) => `expect(${i}).toBe(${i});`).join('\n');
  const text = `test('exhaustive', () => {\n${asserts}\n});`;
  const blocks = findTestBlocks(text);
  assert.equal(checkExhaustiveTesting(blocks).length, 1);
});

test('T5: boundary — exactly 10 assertion calls does not fire', () => {
  const asserts = Array.from({ length: 10 }, (_, i) => `expect(${i}).toBe(${i});`).join('\n');
  const text = `test('ok', () => {\n${asserts}\n});`;
  const blocks = findTestBlocks(text);
  assert.deepEqual(checkExhaustiveTesting(blocks), []);
});

test('T5: an expression-bodied test (no block, body: null) is not measured, not flagged', () => {
  const text = `it('x', () => expect(f()).toBe(1));`;
  const blocks = findTestBlocks(text);
  assert.equal(blocks[0].body, null);
  assert.deepEqual(checkExhaustiveTesting(blocks), []);
});

// ── T6 — Long Tests (>30 lines) ────────────────────────────────────────

test('T6: boundary — 29 content lines produces exactly 31 total lines and fires', () => {
  const body = Array.from({ length: 29 }, (_, i) => `line${i}();`).join('\n');
  const text = `test('long', () => {\n${body}\n});`;
  const blocks = findTestBlocks(text);
  assert.equal(blocks[0].body.text.split('\n').length, 31);
  assert.equal(checkLongTests(blocks).length, 1);
});

test('T6: boundary — exactly 30 lines does not fire', () => {
  // extractCallbackBody's body.text spans from just after the opening '{' to
  // just before the closing '}', i.e. `\n<content>\n` — splitting on '\n'
  // yields 2 extra (empty) lines beyond the content lines, so 28 content
  // lines here produces exactly 30 total lines, the documented threshold.
  const body = Array.from({ length: 28 }, (_, i) => `line${i}();`).join('\n');
  const text = `test('ok', () => {\n${body}\n});`;
  const blocks = findTestBlocks(text);
  assert.equal(blocks[0].body.text.split('\n').length, 30);
  assert.deepEqual(checkLongTests(blocks), []);
});

// ── T7 — Slow Tests (literal timer calls) ─────────────────────────────

test('T7: a literal setTimeout inside a test fires', () => {
  const text = `test('slow', () => { setTimeout(() => {}, 100); });`;
  const blocks = findTestBlocks(text);
  const findings = checkSlowTests(blocks);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'T7');
});

test('T7: sleep()/delay() calls also fire', () => {
  const text = `test('slow', () => { sleep(10); });`;
  const blocks = findTestBlocks(text);
  assert.equal(checkSlowTests(blocks).length, 1);
});

test('T7: a test with no timer calls does not fire', () => {
  const text = `test('fast', () => { assert.ok(true); });`;
  const blocks = findTestBlocks(text);
  assert.deepEqual(checkSlowTests(blocks), []);
});

// ── T8 — Fragile Tests (non-deterministic references) ─────────────────

test('T8: Date.now() fires', () => {
  const text = `test('fragile', () => { const t = Date.now(); assert.ok(t); });`;
  const blocks = findTestBlocks(text);
  assert.equal(checkFragileTests(blocks).length, 1);
});

test('T8: Math.random() fires', () => {
  const text = `test('fragile', () => { const r = Math.random(); assert.ok(r); });`;
  const blocks = findTestBlocks(text);
  assert.equal(checkFragileTests(blocks).length, 1);
});

test('T8: process.env.* fires', () => {
  const text = `test('fragile', () => { assert.ok(process.env.FOO); });`;
  const blocks = findTestBlocks(text);
  assert.equal(checkFragileTests(blocks).length, 1);
});

test('T8: a deterministic test (fixed clock injected) does not fire', () => {
  const text = `test('deterministic', () => { const t = fixedClock.now(); assert.ok(t); });`;
  const blocks = findTestBlocks(text);
  assert.deepEqual(checkFragileTests(blocks), []);
});

// ── T9 — Duplicated Setup (cross-file, structural similarity) ────────────

test('T9: two near-identical beforeEach blocks in DIFFERENT files fire above the similarity threshold', () => {
  const setupA = `beforeEach(() => { const harness = new Harness('/tmp/a'); harness.start(); harness.seed(42); });`;
  const setupB = `beforeEach(() => { const harness = new Harness('/tmp/b'); harness.start(); harness.seed(99); });`;
  const files = [
    { file: 'a.test.mjs', setupBlocks: findSetupBlocks(setupA) },
    { file: 'b.test.mjs', setupBlocks: findSetupBlocks(setupB) },
  ];
  const findings = checkDuplicatedSetupAcrossFiles(files);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'T9');
});

test('T9: identical setup blocks in the SAME file do not fire (T9 is cross-file only)', () => {
  const text = `
    beforeEach(() => { const harness = new Harness('/tmp/a'); harness.start(); harness.seed(1); });
    beforeEach(() => { const harness = new Harness('/tmp/a'); harness.start(); harness.seed(1); });
  `;
  const files = [{ file: 'a.test.mjs', setupBlocks: findSetupBlocks(text) }];
  assert.deepEqual(checkDuplicatedSetupAcrossFiles(files), []);
});

test('T9: structurally unrelated setup blocks across files do not fire', () => {
  const files = [
    { file: 'a.test.mjs', setupBlocks: findSetupBlocks(`beforeEach(() => { db.connect(); db.migrate(); db.seedUsers(); });`) },
    { file: 'b.test.mjs', setupBlocks: findSetupBlocks(`beforeEach(() => { server.listen(); server.mockAuth(); server.warmCache(); });`) },
  ];
  assert.deepEqual(checkDuplicatedSetupAcrossFiles(files), []);
});

// ── FIRST-Independent — mutated shared top-level state ────────────────

test('FIRST-Independent: a top-level let mutated inside 2+ test() blocks fires', () => {
  const text = `
    let counter;
    test('a', () => { counter = 1; });
    test('b', () => { counter = 2; });
  `;
  const blocks = findTestBlocks(text);
  const findings = checkIndependentSharedState(text, blocks);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'FIRST-Independent');
});

test('FIRST-Independent: a top-level let read (never mutated) by multiple tests does not fire', () => {
  const text = `
    let config = { a: 1 };
    test('a', () => { assert.ok(config.a); });
    test('b', () => { assert.ok(config.a); });
  `;
  const blocks = findTestBlocks(text);
  assert.deepEqual(checkIndependentSharedState(text, blocks), []);
});

test('FIRST-Independent: a let mutated inside only ONE test does not fire', () => {
  const text = `
    let counter;
    test('a', () => { counter = 1; });
  `;
  const blocks = findTestBlocks(text);
  assert.deepEqual(checkIndependentSharedState(text, blocks), []);
});

test('FIRST-Independent: a let declared and mutated entirely INSIDE a single test is local, not shared state', () => {
  const text = `
    test('a', () => { let counter = 1; counter = 2; });
  `;
  const blocks = findTestBlocks(text);
  assert.deepEqual(checkIndependentSharedState(text, blocks), []);
});

// ── scoreTestFile — full per-file aggregate ────────────────────────────

test('scoreTestFile: a file tripping several single-file smells sums findings correctly', () => {
  const text = `
    it.skip('broken', () => {});
    test('fragile', () => { const t = Date.now(); assert.ok(t); });
  `;
  const r = scoreTestFile(text, { exportedUnitCount: null });
  assert.equal(r.testBlockCount, 2);
  assert.equal(r.skippedCount, 1);
  const ruleIds = r.findings.map((f) => f.ruleId).sort();
  assert.deepEqual(ruleIds, ['T2', 'T8']);
});
