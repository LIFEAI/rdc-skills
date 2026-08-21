import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  walkSourceFiles, DEFAULT_LAYERS, classifyLayerByPath, classifyLayerByNameHint,
  classifyFile, classifyLayerBySpecifierKeyword, resolveRelativeImport,
  buildFileGraph, buildLayerEdges, dependencyDirectionFindings,
  frameworkCouplingFindings, missingAbstractionFindings, mixedConcernsFindings,
  uiBusinessLogicMixingFindings, mixedLayerImportsFindings,
  circularLayerDependencyFindings, architectureScoreFile, architectureScoreAll,
} from '../../scripts/lib/architecture-scoring.mjs';

function makeRecord(overrides = {}) {
  return {
    absPath: '/repo/src/file.ts',
    relPath: 'src/file.ts',
    text: '',
    layer: null,
    layerBasis: 'unclassified',
    imports: [],
    ...overrides,
  };
}

function withTmpRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'arch-score-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}

// ── empty / trivial input ───────────────────────────────────────────────

test('all rule functions on an unclassified, empty-text record return zero findings, never throw', () => {
  const r = makeRecord();
  assert.deepEqual(dependencyDirectionFindings(r, new Map(), DEFAULT_LAYERS).findings, []);
  assert.deepEqual(frameworkCouplingFindings(r).findings, []);
  assert.deepEqual(missingAbstractionFindings(r).findings, []);
  assert.deepEqual(mixedConcernsFindings(r).findings, []);
  assert.deepEqual(uiBusinessLogicMixingFindings(r).findings, []);
  assert.deepEqual(mixedLayerImportsFindings(r, DEFAULT_LAYERS).findings, []);
});

test('circularLayerDependencyFindings: an empty edge map produces zero findings', () => {
  assert.deepEqual(circularLayerDependencyFindings(new Map()).findings, []);
});

// ── dependency-direction ─────────────────────────────────────────────────

test('dependency-direction: known violation — an unresolved bare specifier keyword-matched to an outer layer fires at low confidence', () => {
  const r = makeRecord({ layer: { name: 'Entities', level: 4 }, imports: ['my-infra-client'] });
  const result = dependencyDirectionFindings(r, new Map(), DEFAULT_LAYERS);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].confidence, 'low');
});

test('dependency-direction: known-clean — an import that resolves to no known layer does not fire', () => {
  const r = makeRecord({ layer: { name: 'Entities', level: 4 }, imports: ['lodash'] });
  assert.deepEqual(dependencyDirectionFindings(r, new Map(), DEFAULT_LAYERS).findings, []);
});

test('dependency-direction: an unclassified record (layer null) never fires regardless of imports', () => {
  const r = makeRecord({ layer: null, imports: ['my-infra-client'] });
  assert.deepEqual(dependencyDirectionFindings(r, new Map(), DEFAULT_LAYERS).findings, []);
});

test('dependency-direction: known violation — a RESOLVED relative import to an outer layer fires at high confidence (real file graph)', (t) => {
  const root = withTmpRoot(t);
  writeFiles(root, {
    'frameworks/db-client.mjs': `export const db = {};`,
    'usecases/create-user.ts': `import { db } from '../frameworks/db-client';\nexport class CreateUserUseCase {}`,
  });
  const files = walkSourceFiles(root);
  const { records, byNoExt } = buildFileGraph(files, root, { layers: DEFAULT_LAYERS });
  const useCaseRecord = records.find((r) => r.relPath.includes('create-user'));
  assert.ok(useCaseRecord.layer, 'usecases/create-user.ts must classify to a real layer');
  const result = dependencyDirectionFindings(useCaseRecord, byNoExt, DEFAULT_LAYERS);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].confidence, 'high');
});

// ── framework-coupling ────────────────────────────────────────────────────

test('framework-coupling: known violation — Entities layer importing a framework is critical severity, high confidence', () => {
  const r = makeRecord({ layer: { name: 'Entities', level: 4 }, imports: ['express'] });
  const result = frameworkCouplingFindings(r);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'critical');
  assert.equal(result.findings[0].confidence, 'high');
});

test('framework-coupling: a non-Entities layer importing a framework is high severity, not critical', () => {
  const r = makeRecord({ layer: { name: 'UseCases', level: 3 }, imports: ['axios'] });
  const result = frameworkCouplingFindings(r);
  assert.equal(result.findings[0].severity, 'high');
});

test('framework-coupling: a generic indicator (http/fetch/request) is confidence medium, not high', () => {
  const r = makeRecord({ layer: { name: 'UseCases', level: 3 }, imports: ['http'] });
  const result = frameworkCouplingFindings(r);
  assert.equal(result.findings[0].confidence, 'medium');
});

test('framework-coupling: known-clean — the Frameworks layer itself is exempt regardless of imports', () => {
  const r = makeRecord({ layer: { name: 'Frameworks', level: 1 }, imports: ['express', 'mongoose'] });
  assert.deepEqual(frameworkCouplingFindings(r).findings, []);
});

test('framework-coupling: known-clean — no framework-indicator import does not fire', () => {
  const r = makeRecord({ layer: { name: 'UseCases', level: 3 }, imports: ['./local-module'] });
  assert.deepEqual(frameworkCouplingFindings(r).findings, []);
});

// ── missing-abstraction — five independent sub-checks ─────────────────────

test('missing-abstraction 3a: Use Case directly instantiating a concrete Repository fires', () => {
  const r = makeRecord({ text: `class OrderUseCase { run() { const repo = new OrderRepository(); } }` });
  const findings = missingAbstractionFindings(r).findings;
  assert.ok(findings.some((f) => f.kind === 'missing-repository-interface'));
});

test('missing-abstraction 3b: Controller instantiating a Use Case with no input-port interface fires', () => {
  const r = makeRecord({ text: `class OrderController { constructor() { this.uc = new OrderUseCase(); } }` });
  const findings = missingAbstractionFindings(r).findings;
  assert.ok(findings.some((f) => f.kind === 'missing-input-port'));
});

test('missing-abstraction 3b: known-clean — a declared input-port interface suppresses the finding', () => {
  const r = makeRecord({ text: `interface OrderUseCase {} class OrderController { constructor() { this.uc = new OrderUseCase(); } }` });
  const findings = missingAbstractionFindings(r).findings;
  assert.ok(!findings.some((f) => f.kind === 'missing-input-port'));
});

test('missing-abstraction 3c: an HTTP request object referenced inside a Use Case fires', () => {
  const r = makeRecord({ text: `class PayOrderUseCase { run(req) { return req.body; } }` });
  const findings = missingAbstractionFindings(r).findings;
  assert.ok(findings.some((f) => f.kind === 'http-request-in-usecase'));
});

test('missing-abstraction 3d: direct database access inside a Service fires', () => {
  const r = makeRecord({ text: `class ReportService { run() { return db.query('SELECT * FROM orders'); } }` });
  const findings = missingAbstractionFindings(r).findings;
  assert.ok(findings.some((f) => f.kind === 'direct-db-access-in-usecase'));
});

test('missing-abstraction 3e: a Controller returning a raw Entity fires', () => {
  const r = makeRecord({ text: `class UserController { get() { return userEntity; } }` });
  const findings = missingAbstractionFindings(r).findings;
  assert.ok(findings.some((f) => f.kind === 'data-structure-leak'));
});

test('missing-abstraction: known-clean — plain text with none of the five patterns fires nothing', () => {
  const r = makeRecord({ text: `export function add(a, b) { return a + b; }` });
  assert.deepEqual(missingAbstractionFindings(r).findings, []);
});

// ── mixed-concerns (business + infra vocabulary co-occurrence) ───────────

test('mixed-concerns: known violation — business and infrastructure vocabulary both present fires', () => {
  const r = makeRecord({ text: `function validateOrder(order) { database.save(order); }` });
  assert.equal(mixedConcernsFindings(r).findings.length, 1);
});

test('mixed-concerns: known-clean — only business vocabulary present does not fire', () => {
  const r = makeRecord({ text: `function validateOrder(order) { return order.total > 0; }` });
  assert.deepEqual(mixedConcernsFindings(r).findings, []);
});

// ── ui-business-logic-mixing (UI indicator + 100+ char business body) ────

test('ui-business-logic-mixing: known violation — a UI indicator plus a 100+ char calculate/validate/process body fires', () => {
  const longBody = 'x'.repeat(120);
  const r = makeRecord({ text: `function Component() { function calculateFoo() { ${longBody} } }` });
  assert.equal(uiBusinessLogicMixingFindings(r).findings.length, 1);
});

test('ui-business-logic-mixing: boundary — a short (<100 char) business body with a UI indicator does not fire', () => {
  const r = makeRecord({ text: `function Component() { function calculateFoo() { return 1; } }` });
  assert.deepEqual(uiBusinessLogicMixingFindings(r).findings, []);
});

test('ui-business-logic-mixing: known-clean — a long business body with NO UI indicator does not fire', () => {
  const longBody = 'x'.repeat(120);
  const r = makeRecord({ text: `function calculateFoo() { ${longBody} }` });
  assert.deepEqual(uiBusinessLogicMixingFindings(r).findings, []);
});

// ── mixed-layer-imports (3+ distinct layers guessed from bare specifiers) ─

test('mixed-layer-imports: known violation — imports keyword-matching 3 distinct layers fires', () => {
  const r = makeRecord({ imports: ['my-domain-thing', 'my-usecases-thing', 'my-controllers-thing'] });
  assert.equal(mixedLayerImportsFindings(r, DEFAULT_LAYERS).findings.length, 1);
});

test('mixed-layer-imports: boundary — exactly 2 distinct layers does not fire', () => {
  const r = makeRecord({ imports: ['my-domain-thing', 'my-usecases-thing'] });
  assert.deepEqual(mixedLayerImportsFindings(r, DEFAULT_LAYERS).findings, []);
});

// ── circular-layer-dependency — real cycle walk over layer edges ─────────

test('circularLayerDependencyFindings: a real 2-layer cycle is found and canonicalized', () => {
  const edges = new Map([
    ['Entities', new Set(['UseCases'])],
    ['UseCases', new Set(['Entities'])],
  ]);
  const result = circularLayerDependencyFindings(edges);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].location, 'Entities -> UseCases -> Entities');
});

test('circularLayerDependencyFindings: an acyclic layer graph fires nothing', () => {
  const edges = new Map([
    ['UseCases', new Set(['Entities'])],
    ['Entities', new Set()],
  ]);
  assert.deepEqual(circularLayerDependencyFindings(edges).findings, []);
});

// ── layer classification — path glob, name-hint fallback, unclassified ───

test('classifyLayerByPath: a TOP-LEVEL frameworks/ path (no parent directory) still classifies as Frameworks', () => {
  // Regression fixture for the documented globToRegExp fix: the naive
  // '**' -> '.*' translation required a literal '/' before 'frameworks',
  // which a top-level scanned path has none of.
  const layer = classifyLayerByPath('frameworks/db-client.mjs', DEFAULT_LAYERS);
  assert.equal(layer.name, 'Frameworks');
});

test('classifyLayerByPath: a nested entities/ path classifies as Entities', () => {
  const layer = classifyLayerByPath('src/domain/entities/user.ts', DEFAULT_LAYERS);
  assert.equal(layer.name, 'Entities');
});

test('classifyLayerByPath: a path matching no glob returns null', () => {
  assert.equal(classifyLayerByPath('random/unrelated.ts', DEFAULT_LAYERS), null);
});

test('classifyLayerByNameHint: a UseCase-suffixed class name classifies as UseCases via name-hint', () => {
  const layer = classifyLayerByNameHint('export class CreateOrderUseCase {}', DEFAULT_LAYERS);
  assert.equal(layer.name, 'UseCases');
});

test('classifyFile: path match takes precedence over a name-hint (basis "path")', () => {
  const r = classifyFile('entities/user.ts', 'export class CreateOrderUseCase {}', DEFAULT_LAYERS);
  assert.equal(r.basis, 'path');
  assert.equal(r.layer.name, 'Entities');
});

test('classifyFile: falls back to name-hint when the path matches no glob (basis "name-hint")', () => {
  const r = classifyFile('random/order.ts', 'export class CreateOrderUseCase {}', DEFAULT_LAYERS);
  assert.equal(r.basis, 'name-hint');
  assert.equal(r.layer.name, 'UseCases');
});

test('classifyFile: neither path nor name-hint match returns unclassified, not a fabricated default layer', () => {
  const r = classifyFile('random/misc.ts', 'export function helper() {}', DEFAULT_LAYERS);
  assert.equal(r.basis, 'unclassified');
  assert.equal(r.layer, null);
});

test('classifyLayerBySpecifierKeyword: a keyword-matching bare specifier resolves at low confidence (caller responsibility)', () => {
  const layer = classifyLayerBySpecifierKeyword('some-domain-lib', DEFAULT_LAYERS);
  assert.equal(layer.name, 'Entities');
});

test('classifyLayerBySpecifierKeyword: a non-matching specifier returns null', () => {
  assert.equal(classifyLayerBySpecifierKeyword('lodash', DEFAULT_LAYERS), null);
});

// ── real-file integration: walkSourceFiles, buildFileGraph, resolveRelativeImport, architectureScoreAll ──

test('walkSourceFiles: an empty directory returns zero files, never throws', (t) => {
  const root = withTmpRoot(t);
  assert.deepEqual(walkSourceFiles(root), []);
});

test('walkSourceFiles: skips node_modules and non-source extensions, includes real source files, sorted', (t) => {
  const root = withTmpRoot(t);
  writeFiles(root, {
    'a.mjs': '',
    'b.ts': '',
    'README.md': '',
    'node_modules/dep/index.mjs': '',
  });
  const files = walkSourceFiles(root).map((f) => path.relative(root, f).split(path.sep).join('/'));
  assert.deepEqual(files.sort(), ['a.mjs', 'b.ts']);
});

test('resolveRelativeImport: resolves a relative specifier to its extension-bearing target file record', (t) => {
  const root = withTmpRoot(t);
  writeFiles(root, {
    'a/index.ts': `import { b } from '../b/thing';`,
    'b/thing.ts': `export const b = 1;`,
  });
  const files = walkSourceFiles(root);
  const { byNoExt } = buildFileGraph(files, root, { layers: DEFAULT_LAYERS });
  const fromFile = path.join(root, 'a/index.ts');
  const resolved = resolveRelativeImport('../b/thing', fromFile, byNoExt);
  assert.ok(resolved);
  assert.match(resolved.relPath.replace(/\\/g, '/'), /b\/thing\.ts$/);
});

test('resolveRelativeImport: a specifier that resolves to nothing scanned returns null', (t) => {
  const root = withTmpRoot(t);
  writeFiles(root, { 'a/index.ts': '' });
  const files = walkSourceFiles(root);
  const { byNoExt } = buildFileGraph(files, root, { layers: DEFAULT_LAYERS });
  const fromFile = path.join(root, 'a/index.ts');
  assert.equal(resolveRelativeImport('../nowhere', fromFile, byNoExt), null);
});

test('architectureScoreAll: end-to-end — surfaces a real dependency-direction violation and reports unclassifiedFiles', (t) => {
  const root = withTmpRoot(t);
  writeFiles(root, {
    'frameworks/db-client.mjs': `export const db = {};`,
    'usecases/create-user.ts': `import { db } from '../frameworks/db-client';\nexport class CreateUserUseCase {}`,
    'misc/unrelated.mjs': `export const noop = () => {};`,
  });
  const files = walkSourceFiles(root);
  const result = architectureScoreAll(files, root, { layers: DEFAULT_LAYERS });
  const useCaseResult = result.results.find((r) => r.file.includes('create-user'));
  assert.equal(useCaseResult.rules.dependencyDirection.findings.length, 1);
  assert.ok(result.unclassifiedFiles.some((f) => f.includes('unrelated')));
});
