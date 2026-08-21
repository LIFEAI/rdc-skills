import assert from 'node:assert/strict';
import test from 'node:test';

import { srp, ocp, lsp, isp, dip, scoreUnit } from '../../scripts/lib/solid-scoring.mjs';
import { makeMember, makeUnit } from './fixtures.mjs';

// ── empty / trivial input ───────────────────────────────────────────────

test('srp: zero members returns unmeasured, not a fake clean 100', () => {
  const r = srp(makeUnit({ members: [] }));
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 'none');
});

test('ocp: zero members returns unmeasured', () => {
  const r = ocp(makeUnit({ members: [] }));
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 'none');
});

test('isp: zero members returns unmeasured', () => {
  const r = isp(makeUnit({ members: [] }));
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 'none');
});

test('lsp: no base class scores 100 at low-medium confidence (nothing to violate)', () => {
  const r = lsp(makeUnit({ hasBaseClass: false }));
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 'low-medium');
  assert.match(r.detail, /no base class/);
});

test('dip: zero total dependencies scores 100 (nothing to be concrete about)', () => {
  const r = dip(makeUnit({ totalDependencies: 0 }));
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 'high');
});

test('srp: exactly one member scores 100 at high confidence', () => {
  const r = srp(makeUnit({ members: [makeMember()] }));
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 'high');
});

// ── SRP — connected components ──────────────────────────────────────────

test('srp: two members with no shared field and no cross-calls are 2 components — score 70', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', fieldAccess: ['x'] }),
      makeMember({ name: 'b', fieldAccess: ['y'] }),
    ],
  });
  const r = srp(unit);
  assert.match(r.detail, /2 connected component/);
  assert.equal(r.score, 70);
});

test('srp: two members sharing a field collapse to 1 component — score 100 (clean)', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', fieldAccess: ['shared'] }),
      makeMember({ name: 'b', fieldAccess: ['shared'] }),
    ],
  });
  const r = srp(unit);
  assert.match(r.detail, /1 connected component/);
  assert.equal(r.score, 100);
});

test('srp: two members where one calls the other also collapse to 1 component', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', calls: ['b'] }),
      makeMember({ name: 'b' }),
    ],
  });
  const r = srp(unit);
  assert.equal(r.score, 100);
});

test('srp: three fully isolated members are 3 components — score 40', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', fieldAccess: ['x'] }),
      makeMember({ name: 'b', fieldAccess: ['y'] }),
      makeMember({ name: 'c', fieldAccess: ['z'] }),
    ],
  });
  assert.equal(srp(unit).score, 40);
});

test('srp: four or more fully isolated members floor at score 10', () => {
  const unit = makeUnit({
    members: [
      makeMember({ name: 'a', fieldAccess: ['w'] }),
      makeMember({ name: 'b', fieldAccess: ['x'] }),
      makeMember({ name: 'c', fieldAccess: ['y'] }),
      makeMember({ name: 'd', fieldAccess: ['z'] }),
    ],
  });
  assert.equal(srp(unit).score, 10);
});

// ── OCP — branch-hit density ────────────────────────────────────────────

test('ocp: known violation — high branch-hit density scores near/at 0', () => {
  const unit = makeUnit({ members: [makeMember({ branchHits: 8 })] });
  const r = ocp(unit);
  assert.equal(r.score, 0);
  assert.equal(r.confidence, 'low');
});

test('ocp: known-clean — zero branch hits scores 100', () => {
  const unit = makeUnit({ members: [makeMember({ branchHits: 0 })] });
  assert.equal(ocp(unit).score, 100);
});

test('ocp: density formula boundary — density=4 clips exactly to score 0', () => {
  const unit = makeUnit({ members: [makeMember({ branchHits: 4 })] });
  assert.equal(ocp(unit).score, 0);
});

test('ocp: density formula just below the clip — density=3 scores 25', () => {
  const unit = makeUnit({ members: [makeMember({ branchHits: 3 })] });
  assert.equal(ocp(unit).score, 25);
});

// ── LSP — override drift ────────────────────────────────────────────────

test('lsp: hasBaseClass true but no overridden members scores 100', () => {
  const unit = makeUnit({ hasBaseClass: true, members: [makeMember({ override: null })] });
  const r = lsp(unit);
  assert.equal(r.score, 100);
  assert.match(r.detail, /no overridden methods/);
});

test('lsp: known violation — full drift (param mismatch, no super call, return-type mismatch) scores 0', () => {
  const unit = makeUnit({
    hasBaseClass: true,
    members: [makeMember({
      paramCount: 3,
      override: { baseParamCount: 2, callsSuper: false, returnType: 'string', baseReturnType: 'number' },
    })],
  });
  assert.equal(lsp(unit).score, 0);
});

test('lsp: known-clean — override matches base exactly scores 100', () => {
  const unit = makeUnit({
    hasBaseClass: true,
    members: [makeMember({
      paramCount: 2,
      override: { baseParamCount: 2, callsSuper: true, returnType: 'number', baseReturnType: 'number' },
    })],
  });
  assert.equal(lsp(unit).score, 100);
});

test('lsp: boundary — exactly one of three drift signals scores 67', () => {
  const unit = makeUnit({
    hasBaseClass: true,
    members: [makeMember({
      paramCount: 2, // matches base -> no drift here
      override: { baseParamCount: 2, callsSuper: false, returnType: 'number', baseReturnType: 'number' },
    })],
  });
  assert.equal(lsp(unit).score, 67);
});

test('lsp: boundary — exactly two of three drift signals scores 33', () => {
  const unit = makeUnit({
    hasBaseClass: true,
    members: [makeMember({
      paramCount: 3, // mismatch -> drift
      override: { baseParamCount: 2, callsSuper: false, returnType: 'number', baseReturnType: 'number' },
    })],
  });
  assert.equal(lsp(unit).score, 33);
});

// ── ISP — public member count + avg params ──────────────────────────────

test('isp: known-clean — no public members scores 100 at medium-high confidence', () => {
  const unit = makeUnit({ members: [makeMember({ isPublic: false })] });
  const r = isp(unit);
  assert.equal(r.score, 100);
  assert.equal(r.confidence, 'medium-high');
});

test('isp: known violation — many public members with high avg params scores low', () => {
  const members = Array.from({ length: 21 }, (_, i) => makeMember({ name: `m${i}`, paramCount: 5 }));
  const r = isp(makeUnit({ members }));
  assert.equal(r.score, 28); // countScore 15 (len>20), paramScore 40 (avg5>4) -> round((15+40)/2)
});

test('isp: boundary — publicMembers.length=5 (<=5) scores countScore 100', () => {
  const members = Array.from({ length: 5 }, (_, i) => makeMember({ name: `m${i}`, paramCount: 0 }));
  assert.equal(isp(makeUnit({ members })).score, 100);
});

test('isp: boundary — publicMembers.length=6 (>5) drops countScore to 75', () => {
  const members = Array.from({ length: 6 }, (_, i) => makeMember({ name: `m${i}`, paramCount: 0 }));
  assert.equal(isp(makeUnit({ members })).score, 88); // round((75+100)/2)
});

test('isp: boundary — publicMembers.length=10 (<=10) still countScore 75', () => {
  const members = Array.from({ length: 10 }, (_, i) => makeMember({ name: `m${i}`, paramCount: 0 }));
  assert.equal(isp(makeUnit({ members })).score, 88);
});

test('isp: boundary — publicMembers.length=11 (>10) drops countScore to 45', () => {
  const members = Array.from({ length: 11 }, (_, i) => makeMember({ name: `m${i}`, paramCount: 0 }));
  assert.equal(isp(makeUnit({ members })).score, 73); // round((45+100)/2)
});

test('isp: boundary — publicMembers.length=20 (<=20) still countScore 45', () => {
  const members = Array.from({ length: 20 }, (_, i) => makeMember({ name: `m${i}`, paramCount: 0 }));
  assert.equal(isp(makeUnit({ members })).score, 73);
});

test('isp: boundary — publicMembers.length=21 (>20) drops countScore to 15', () => {
  const members = Array.from({ length: 21 }, (_, i) => makeMember({ name: `m${i}`, paramCount: 0 }));
  assert.equal(isp(makeUnit({ members })).score, 58); // round((15+100)/2)
});

test('isp: boundary — avgParams=2 (<=2) scores paramScore 100', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 2 })] });
  assert.equal(isp(unit).score, 100); // countScore 100, paramScore 100
});

test('isp: boundary — avgParams=3 (>2) drops paramScore to 75', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 3 })] });
  assert.equal(isp(unit).score, 88); // round((100+75)/2)
});

test('isp: boundary — avgParams=4 (<=4) still paramScore 75', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 4 })] });
  assert.equal(isp(unit).score, 88);
});

test('isp: boundary — avgParams=5 (>4) drops paramScore to 40', () => {
  const unit = makeUnit({ members: [makeMember({ paramCount: 5 })] });
  assert.equal(isp(unit).score, 70); // round((100+40)/2)
});

// ── DIP — concrete-instantiation ratio ──────────────────────────────────

test('dip: known violation — every dependency is a concrete instantiation scores 0', () => {
  const unit = makeUnit({ concreteInstantiations: 5, totalDependencies: 5 });
  assert.equal(dip(unit).score, 0);
});

test('dip: known-clean — zero concrete instantiations of nonzero deps scores 100', () => {
  const unit = makeUnit({ concreteInstantiations: 0, totalDependencies: 5 });
  assert.equal(dip(unit).score, 100);
});

test('dip: boundary — half the dependencies concrete scores exactly 50', () => {
  const unit = makeUnit({ concreteInstantiations: 1, totalDependencies: 2 });
  assert.equal(dip(unit).score, 50);
});

// ── scoreUnit — weighted aggregate + unmeasured exclusion ──────────────

test('scoreUnit: unmeasured criteria (confidence "none") are excluded and renormalized, not zeroed', () => {
  const unit = makeUnit({ members: [] }); // srp/ocp/isp all 'none' on empty unit
  const r = scoreUnit(unit, { srp: 1, ocp: 1, lsp: 1, isp: 1, dip: 1 });
  assert.deepEqual(new Set(r.unmeasured), new Set(['srp', 'ocp', 'isp']));
  assert.equal(r.total, 100); // only lsp(100) + dip(100) measured
});

test('scoreUnit: total is null, not 0, when every weighted criterion is unmeasured', () => {
  const unit = makeUnit({ members: [] });
  const r = scoreUnit(unit, { srp: 1, ocp: 1, isp: 1 }); // omit lsp/dip, the only always-measured ones
  assert.equal(r.total, null);
  assert.deepEqual(new Set(r.unmeasured), new Set(['srp', 'ocp', 'isp']));
});

test('scoreUnit: a populated unit produces a real weighted average across all five criteria', () => {
  const unit = makeUnit({
    hasBaseClass: false,
    concreteInstantiations: 0,
    totalDependencies: 1,
    members: [makeMember({ branchHits: 0, paramCount: 1 })],
  });
  const r = scoreUnit(unit, { srp: 1, ocp: 1, lsp: 1, isp: 1, dip: 1 });
  assert.deepEqual(r.unmeasured, []);
  assert.equal(r.total, 100); // single member, everything clean
});
