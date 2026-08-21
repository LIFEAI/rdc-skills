import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectFactoryMethod, detectBuilder, detectSingleton, detectDecorator,
  detectAdapter, detectFacade, detectStrategy, detectObserver,
  detectCommand, detectTemplateMethod, patternScore, PATTERN_NAMES,
} from '../../scripts/lib/pattern-scoring.mjs';
import { makeMember, makeUnit } from './fixtures.mjs';

// ── empty / trivial input ───────────────────────────────────────────────

test('patternScore: zero members fires zero findings across all 10 detectors, never throws', () => {
  const unit = makeUnit({ members: [] });
  const r = patternScore(unit);
  assert.equal(r.totalFindings, 0);
  assert.equal(Object.keys(r.patterns).length, PATTERN_NAMES.length);
  for (const p of Object.values(r.patterns)) assert.deepEqual(p.findings, []);
});

test('patternScore: a single trivial member with no signals fires nothing', () => {
  const r = patternScore(makeUnit({ members: [makeMember()] }));
  assert.equal(r.totalFindings, 0);
});

test('PATTERN_NAMES lists all 10 detected patterns', () => {
  assert.equal(PATTERN_NAMES.length, 10);
});

// ── Factory Method — two independent signals ─────────────────────────────

test('Factory Method (a): switch-on-type constructing via `new` fires', () => {
  const unit = makeUnit({ members: [makeMember({ switchStatements: [{ line: 5, hasBehaviorCall: false, hasTypeCreation: true }] })] });
  const r = detectFactoryMethod(unit);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].confidence, 90);
});

test('Factory Method (b): >5 total news with >3 unique targets fires', () => {
  const unit = makeUnit({ members: [makeMember({ constructorNewCallTargets: ['A', 'B', 'C', 'D', 'A', 'B'] })] }); // 6 total, 4 unique
  const r = detectFactoryMethod(unit);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].confidence, 75);
});

test('Factory Method: boundary — exactly 5 news does not fire (b)', () => {
  const unit = makeUnit({ members: [makeMember({ constructorNewCallTargets: ['A', 'B', 'C', 'D', 'A'] })] }); // 5 total, 4 unique
  assert.deepEqual(detectFactoryMethod(unit).findings, []);
});

test('Factory Method: boundary — 6 news but only 3 unique targets does not fire (b)', () => {
  const unit = makeUnit({ members: [makeMember({ constructorNewCallTargets: ['A', 'A', 'B', 'B', 'C', 'C'] })] }); // 6 total, 3 unique
  assert.deepEqual(detectFactoryMethod(unit).findings, []);
});

test('Factory Method: no type-switch and few/uniform news does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ switchStatements: [], constructorNewCallTargets: ['A'] })] });
  assert.deepEqual(detectFactoryMethod(unit).findings, []);
});

// ── Builder — telescoping constructor (>4 params) ────────────────────────

test('Builder: constructor with 5 params fires', () => {
  const unit = makeUnit({ members: [makeMember({ name: 'constructor', paramCount: 5 })] });
  assert.equal(detectBuilder(unit).findings.length, 1);
});

test('Builder: boundary — constructor with exactly 4 params does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ name: 'constructor', paramCount: 4 })] });
  assert.deepEqual(detectBuilder(unit).findings, []);
});

test('Builder: a non-constructor member with 5 params does not fire (constructor-only rule)', () => {
  const unit = makeUnit({ members: [makeMember({ name: 'setup', paramCount: 5 })] });
  assert.deepEqual(detectBuilder(unit).findings, []);
});

// ── Singleton — static instance field OR getInstance ─────────────────────

test('Singleton: hasGetInstanceMethod fires', () => {
  const unit = makeUnit({ hasGetInstanceMethod: true });
  assert.equal(detectSingleton(unit).findings.length, 1);
});

test('Singleton: a static property named "instance" (name match) fires', () => {
  const unit = makeUnit({ staticPropertyNames: ['_instance'] });
  assert.equal(detectSingleton(unit).findings.length, 1);
});

test('Singleton: a getInstance call-site fires', () => {
  const unit = makeUnit({ members: [makeMember({ calleeNames: ['getInstance'] })] });
  assert.equal(detectSingleton(unit).findings.length, 1);
});

test('Singleton: none of the three signals present does not fire', () => {
  const unit = makeUnit({ hasGetInstanceMethod: false, staticPropertyNames: ['config'], members: [makeMember({ calleeNames: ['build'] })] });
  assert.deepEqual(detectSingleton(unit).findings, []);
});

// ── Decorator — conditional feature-add call ──────────────────────────────

test('Decorator: conditionalFeatureCallLine present fires', () => {
  const unit = makeUnit({ members: [makeMember({ conditionalFeatureCallLine: 12 })] });
  assert.equal(detectDecorator(unit).findings.length, 1);
});

test('Decorator: conditionalFeatureCallLine null does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ conditionalFeatureCallLine: null })] });
  assert.deepEqual(detectDecorator(unit).findings, []);
});

// ── Adapter — name or call names an interface conversion ─────────────────

test('Adapter: member name matches convert/transform/adapt fires', () => {
  const unit = makeUnit({ members: [makeMember({ name: 'convertToDto' })] });
  assert.equal(detectAdapter(unit).findings.length, 1);
});

test('Adapter: a call to a convert/transform/adapt-named function fires', () => {
  const unit = makeUnit({ members: [makeMember({ name: 'run', calleeNames: ['transformPayload'] })] });
  assert.equal(detectAdapter(unit).findings.length, 1);
});

test('Adapter: no matching name or call does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ name: 'run', calleeNames: ['persist'] })] });
  assert.deepEqual(detectAdapter(unit).findings, []);
});

// ── Facade — >5 deep-chain calls ──────────────────────────────────────────

test('Facade: deepChainCallCount=6 fires', () => {
  const unit = makeUnit({ members: [makeMember({ deepChainCallCount: 6 })] });
  assert.equal(detectFacade(unit).findings.length, 1);
});

test('Facade: boundary — deepChainCallCount exactly 5 does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ deepChainCallCount: 5 })] });
  assert.deepEqual(detectFacade(unit).findings, []);
});

// ── Strategy — switch dispatching behavior ────────────────────────────────

test('Strategy: switchBehaviorCallLine present fires', () => {
  const unit = makeUnit({ members: [makeMember({ switchBehaviorCallLine: 9 })] });
  assert.equal(detectStrategy(unit).findings.length, 1);
});

test('Strategy: switchBehaviorCallLine null does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ switchBehaviorCallLine: null })] });
  assert.deepEqual(detectStrategy(unit).findings, []);
});

// ── Observer — >3 notify/update/inform/broadcast calls ────────────────────

test('Observer: 4 matching callee names (aggregated across unit) fires', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', calleeNames: ['notifyAll', 'update'] }),
      makeMember({ name: 'b', calleeNames: ['inform', 'broadcast'] }),
    ],
  });
  assert.equal(detectObserver(unit).findings.length, 1);
});

test('Observer: boundary — exactly 3 matching calls does not fire', () => {
  const unit = makeUnit({ members: [makeMember({ calleeNames: ['notify', 'update', 'inform'] })] });
  assert.deepEqual(detectObserver(unit).findings, []);
});

// ── Command — >4 occurrences of undo/redo/history/queue/execute ──────────

test('Command: >4 occurrences across name/callees/declaredNames/fieldAccess fires', () => {
  const unit = makeUnit({
    name: 'execute', // 1
    members: [makeMember({
      name: 'undo', // 2
      calleeNames: ['redo'], // 3
      declaredNames: [{ name: 'queue', line: 1 }], // 4
      fieldAccess: ['history'], // 5
    })],
  });
  const r = detectCommand(unit);
  assert.equal(r.findings.length, 1);
});

test('Command: boundary — exactly 4 occurrences does not fire', () => {
  const unit = makeUnit({
    name: 'Widget',
    members: [makeMember({
      name: 'undo', // 1
      calleeNames: ['redo'], // 2
      declaredNames: [{ name: 'queue', line: 1 }], // 3
      fieldAccess: ['history'], // 4
    })],
  });
  assert.deepEqual(detectCommand(unit).findings, []);
});

test('Command: a bare fieldAccess-only reference (this.queue, never called/declared) still counts toward the total', () => {
  const unit = makeUnit({
    name: 'undo', // 1
    members: [makeMember({
      name: 'redo', // 2
      calleeNames: ['execute'], // 3
      fieldAccess: ['queue', 'history'], // 4, 5
    })],
  });
  assert.equal(detectCommand(unit).findings.length, 1);
});

// ── Template Method — >2 members call initialize/process/cleanup ─────────

test('Template Method: 3 members each calling an initialize/process/cleanup-named function fires', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', calleeNames: ['initializeStep'] }),
      makeMember({ name: 'b', calleeNames: ['processStep'] }),
      makeMember({ name: 'c', calleeNames: ['cleanupStep'] }),
    ],
  });
  assert.equal(detectTemplateMethod(unit).findings.length, 1);
});

test('Template Method: boundary — exactly 2 matching members does not fire', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', calleeNames: ['initializeStep'] }),
      makeMember({ name: 'b', calleeNames: ['processStep'] }),
    ],
  });
  assert.deepEqual(detectTemplateMethod(unit).findings, []);
});

// ── patternScore — full aggregate, deterministic sort ─────────────────────

test('patternScore: a unit tripping multiple detectors sums totalFindings correctly and sorts findings by line', () => {
  const unit = makeUnit({
    hasGetInstanceMethod: true, // Singleton
    members: [
      makeMember({ name: 'constructor', paramCount: 5 }), // Builder
      makeMember({ name: 'a', switchStatements: [{ line: 20, hasBehaviorCall: false, hasTypeCreation: true }] }), // Factory Method
      makeMember({ name: 'b', switchBehaviorCallLine: 10 }), // Strategy
    ],
  });
  const r = patternScore(unit);
  assert.equal(r.patterns['Singleton'].findings.length, 1);
  assert.equal(r.patterns['Builder'].findings.length, 1);
  assert.equal(r.patterns['Factory Method'].findings.length, 1);
  assert.equal(r.patterns['Strategy'].findings.length, 1);
  assert.equal(r.totalFindings, 4);
});
