import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  extractImportSpecifiers, exportedDeclarationCounts, buildImportGraph,
  findCycles, packageMetrics, packageMetricsAll,
} from '../../scripts/lib/package-metrics.mjs';

/** Create a package dir under a fresh tmp root: package.json + files map (relPath -> content). */
function makePkg(root, name, files) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }), 'utf8');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

function withTmpRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'pkg-metrics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// ── empty / trivial input ───────────────────────────────────────────────

test('buildImportGraph: zero package dirs returns empty structures, never throws', () => {
  const g = buildImportGraph([]);
  assert.deepEqual(g.packages, []);
});

test('packageMetricsAll: zero package dirs returns an empty array', () => {
  assert.deepEqual(packageMetricsAll([]), []);
});

test('extractImportSpecifiers: empty source returns no specifiers', () => {
  assert.deepEqual(extractImportSpecifiers(''), []);
});

test('exportedDeclarationCounts: empty source returns zero/zero, not NaN', () => {
  assert.deepEqual(exportedDeclarationCounts(''), { abstract: 0, concrete: 0 });
});

// ── extractImportSpecifiers — every import shape it claims to handle ────

test('extractImportSpecifiers: static named import, bare import, export-from, require, dynamic import all extracted', () => {
  const src = `
    import { a } from 'pkg-static';
    import 'pkg-bare';
    export { b } from 'pkg-export-from';
    const c = require('pkg-require');
    const d = import('pkg-dynamic');
  `;
  const specs = extractImportSpecifiers(src).sort();
  assert.deepEqual(specs, ['pkg-bare', 'pkg-dynamic', 'pkg-export-from', 'pkg-require', 'pkg-static'].sort());
});

test('extractImportSpecifiers: a specifier that only appears inside a comment is NOT extracted', () => {
  const src = `
    // import { x } from 'pkg-in-line-comment';
    /* import { y } from 'pkg-in-block-comment'; */
    import { z } from 'pkg-real';
  `;
  assert.deepEqual(extractImportSpecifiers(src), ['pkg-real']);
});

test('extractImportSpecifiers: duplicate imports of the same specifier dedupe to one entry', () => {
  const src = `import { a } from 'dup'; import { b } from 'dup';`;
  assert.deepEqual(extractImportSpecifiers(src), ['dup']);
});

// ── exportedDeclarationCounts — abstract vs concrete classification ─────

test('exportedDeclarationCounts: interface and type count as abstract', () => {
  const src = `export interface Foo {} export type Bar = string;`;
  assert.deepEqual(exportedDeclarationCounts(src), { abstract: 2, concrete: 0 });
});

test('exportedDeclarationCounts: class, function, const, enum count as concrete', () => {
  const src = `
    export class Alpha {}
    export function beta() {}
    export const gamma = 1;
    export enum Delta { A }
  `;
  assert.deepEqual(exportedDeclarationCounts(src), { abstract: 0, concrete: 4 });
});

test('exportedDeclarationCounts: a declaration inside a comment is not counted', () => {
  const src = `// export interface Ghost {}\nexport const real = 1;`;
  assert.deepEqual(exportedDeclarationCounts(src), { abstract: 0, concrete: 1 });
});

// ── findCycles — pure graph walk, no fs ──────────────────────────────────

test('findCycles: a real 3-node cycle is found as a path back to the start', () => {
  const edges = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['c'])],
    ['c', new Set(['a'])],
  ]);
  const cycles = findCycles(edges, 'a');
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['a', 'b', 'c', 'a']);
});

test('findCycles: an acyclic graph returns no cycles', () => {
  const edges = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['c'])],
    ['c', new Set()],
  ]);
  assert.deepEqual(findCycles(edges, 'a'), []);
});

// ── buildImportGraph / packageMetrics — real tmp-file fixtures ──────────

test('packageMetrics: Ca/Ce reflect the real cross-package import graph, and a mutual import is a real detected cycle', (t) => {
  const root = withTmpRoot(t);
  const a = makePkg(root, 'pkg-a', { 'index.mjs': `import { b } from 'pkg-b';` });
  const b = makePkg(root, 'pkg-b', { 'index.mjs': `import { a } from 'pkg-a';` });
  const dirs = [a, b];

  const ma = packageMetrics({ packageDir: a, allPackageDirs: dirs });
  assert.equal(ma.ca, 1); // pkg-b imports pkg-a
  assert.equal(ma.ce, 1); // pkg-a imports pkg-b
  assert.equal(ma.instability, 0.5);
  assert.equal(ma.cycles.length, 1);
  assert.deepEqual(ma.cycles[0], ['pkg-a', 'pkg-b', 'pkg-a']);
});

test('packageMetrics: an isolated package (no imports, nothing imports it) has null instability and zone "unmeasurable"', (t) => {
  const root = withTmpRoot(t);
  const iso = makePkg(root, 'pkg-iso', { 'index.mjs': `export const x = 1;` });
  const m = packageMetrics({ packageDir: iso, allPackageDirs: [iso] });
  assert.equal(m.ca, 0);
  assert.equal(m.ce, 0);
  assert.equal(m.instability, null);
  assert.equal(m.zone, 'unmeasurable');
});

test('packageMetrics: abstractnessBasis "no-type-syntax" for a package with only .mjs source', (t) => {
  const root = withTmpRoot(t);
  const dir = makePkg(root, 'pkg-plain-js', { 'index.mjs': `export const x = 1;` });
  const m = packageMetrics({ packageDir: dir, allPackageDirs: [dir] });
  assert.equal(m.abstractnessBasis, 'no-type-syntax');
  assert.equal(m.abstractness, null);
});

test('packageMetrics: abstractnessBasis "no-exported-declarations" for a .ts file with zero exports', (t) => {
  const root = withTmpRoot(t);
  const dir = makePkg(root, 'pkg-empty-ts', { 'src/index.ts': `const internal = 1;` });
  const m = packageMetrics({ packageDir: dir, allPackageDirs: [dir] });
  assert.equal(m.abstractnessBasis, 'no-exported-declarations');
  assert.equal(m.abstractness, null);
});

test('packageMetrics: abstractnessBasis "measured" computes a real interface/total ratio', (t) => {
  const root = withTmpRoot(t);
  const dir = makePkg(root, 'pkg-measured', {
    'src/index.ts': `export interface Foo {}\nexport class Bar {}\nexport const baz = 1;`,
  });
  const m = packageMetrics({ packageDir: dir, allPackageDirs: [dir] });
  assert.equal(m.abstractnessBasis, 'measured');
  assert.equal(m.abstractness, 1 / 3);
});

test('packageMetrics: a test file\'s embedded string-literal "export interface" fixture does NOT count toward abstractness', (t) => {
  const root = withTmpRoot(t);
  const dir = makePkg(root, 'pkg-with-test', {
    'src/index.mjs': `export const real = 1;`,
    'test/fixture.test.ts': `export interface Page {}`, // a real .ts declaration, but inside a test file
  });
  const m = packageMetrics({ packageDir: dir, allPackageDirs: [dir] });
  // the test .ts file must NOT flip hasTsFile / contribute declarations —
  // this package is genuinely all-.mjs source once test files are excluded
  assert.equal(m.abstractnessBasis, 'no-type-syntax');
  assert.equal(m.abstractness, null);
});

test('packageMetrics: zone "main-sequence" when instability and abstractness both sit at 0.5 (distance 0)', (t) => {
  const root = withTmpRoot(t);
  // pkg-g imports pkg-h (ce=1 for g); pkg-i imports pkg-g (ca=1 for g) -> instability(g) = 1/(1+1) = 0.5
  const g = makePkg(root, 'pkg-g', { 'src/index.ts': `import { h } from 'pkg-h';\nexport interface X {}\nexport class Y {}` }); // abstractness 0.5
  const h = makePkg(root, 'pkg-h', { 'index.mjs': `export const x = 1;` });
  const i = makePkg(root, 'pkg-i', { 'index.mjs': `import { g } from 'pkg-g';` });
  const dirs = [g, h, i];
  const m = packageMetrics({ packageDir: g, allPackageDirs: dirs });
  assert.equal(m.instability, 0.5);
  assert.equal(m.abstractness, 0.5);
  assert.equal(m.distanceFromMainSequence, 0);
  assert.equal(m.zone, 'main-sequence');
});

test('packageMetrics: zone "zone-of-pain" — low instability AND low abstractness, far off the main sequence', (t) => {
  const root = withTmpRoot(t);
  const k = makePkg(root, 'pkg-k', { 'src/index.ts': `export class OnlyConcrete {}` }); // abstractness 0
  const l = makePkg(root, 'pkg-l', { 'index.mjs': `import { k } from 'pkg-k';` }); // pkg-l imports pkg-k -> ca(k)=1, ce(k)=0
  const m = packageMetrics({ packageDir: k, allPackageDirs: [k, l] });
  assert.equal(m.instability, 0); // ce=0, ca=1 -> 0/1
  assert.equal(m.abstractness, 0);
  assert.equal(m.zone, 'zone-of-pain');
});

test('packageMetrics: zone "zone-of-uselessness" — high instability AND high abstractness, far off the main sequence', (t) => {
  const root = withTmpRoot(t);
  const n = makePkg(root, 'pkg-n', { 'index.mjs': `export const x = 1;` });
  const m2 = makePkg(root, 'pkg-m', { 'src/index.ts': `import { n } from 'pkg-n';\nexport interface OnlyAbstract {}` }); // abstractness 1, ce=1, ca=0
  const dirs = [n, m2];
  const m = packageMetrics({ packageDir: m2, allPackageDirs: dirs });
  assert.equal(m.instability, 1); // ce=1, ca=0 -> 1/1
  assert.equal(m.abstractness, 1);
  assert.equal(m.zone, 'zone-of-uselessness');
});

// Note: the fourth branch, "off-main-sequence", is unreachable within the
// valid metric domain. Both instability and abstractness are true ratios of
// non-negative counts and therefore always lie in [0,1]. distance = |A+I-1|
// exceeds 0.5 only when A+I < 0.5 or A+I > 1.5; given A,I in [0,1], the first
// forces BOTH A<0.5 and I<0.5 (zone-of-pain's own condition), and the second
// forces BOTH A>0.5 and I>0.5 (zone-of-uselessness's own condition) — so
// every input that clears the >0.5 distance gate necessarily also satisfies
// one of the two named zone conditions first. No literal fixture can reach
// the `else` branch; this is a structural proof, not a coverage gap.

test('packageMetricsAll: computes metrics for every sibling package in one graph build', (t) => {
  const root = withTmpRoot(t);
  const a = makePkg(root, 'pkg-all-a', { 'index.mjs': `import { b } from 'pkg-all-b';` });
  const b = makePkg(root, 'pkg-all-b', { 'index.mjs': `export const x = 1;` });
  const results = packageMetricsAll([a, b]);
  assert.equal(results.length, 2);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  assert.equal(byName['pkg-all-a'].ce, 1);
  assert.equal(byName['pkg-all-b'].ca, 1);
});
