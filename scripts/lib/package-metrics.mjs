/**
 * Package Design metrics — Robert C. Martin's package-level cohesion/coupling
 * suite, operating on PACKAGES (a directory with its own `package.json`, or
 * a declared module boundary passed in explicitly), not files/classes.
 *
 * `solid-validator`'s five scorers (SRP/OCP/LSP/ISP/DIP, driven by
 * `scripts/lib/language-plugin.mjs` + `scripts/lib/plugins/typescript.mjs`)
 * already cover the file/class level. This file is one level up: the
 * package-dependency GRAPH across a set of sibling packages.
 *
 * Deliberately independent of the ts-morph plugin (both being edited
 * concurrently by another agent tonight — no import from either file here).
 * Import extraction is a lightweight regex/text scan over plain source via
 * `node:fs`, not an AST. That is a real, disclosed limitation — see the
 * per-function notes below for exactly what it can and cannot see.
 *
 * ---- Reference check: OnSightTeam/architecture-toolkit (MIT) ----
 *
 * Per operator instruction, checked this implementation's formulas against
 * github.com/OnSightTeam/architecture-toolkit's
 * `src/agents/package-design/tools/{stability-metrics-calculator,
 * package-coupling-analyzer}.ts` (fetched via `gh api` / raw.githubusercontent,
 * MIT per its package.json `license` field and README `## License` section).
 *
 * Confirmed independently, not copied — both are short enough that there is
 * nothing to adapt, only to check against:
 *   - D = |A + I − 1| — stability-metrics-calculator.ts:29
 *     (`Math.abs(abstractness + stability - 1)`, where their local variable
 *     named `stability` is computed as efferent/(efferent+afferent), i.e.
 *     Martin's INSTABILITY, not stability — same formula as `distanceFromMainSequence`
 *     below, matches Martin's own definition).
 *   - Zone-of-Pain / Zone-of-Uselessness split at instability<0.5 && A<0.5 —
 *     stability-metrics-calculator.ts:94-96 and package-coupling-analyzer.ts:127
 *     — matches the `zone()` classification below.
 *
 * NOT reused — both are genuinely broken, confirmed by reading, not assumed:
 *   - Their `countAfferentCoupling` (stability-metrics-calculator.ts:60-75)
 *     `continue`s on every file whose path contains the target package name,
 *     then re-tests the identical condition on what's left — that branch is
 *     dead code. Ca is always 0 there, so I is always 1 whenever Ce>0. Not a
 *     real afferent count.
 *   - Their ADP cycle walk's `extractDependencies` (package-coupling-analyzer.ts:154-176)
 *     keys the whole dependency map off `this.getPackageName('')`, which
 *     always resolves to the literal string `'root'` (see its
 *     `getPackageName`, ...:149-152, on an empty path) — so cross-file cycle
 *     detection never actually walks a real multi-package graph; it only
 *     ever inspects the current file's own single-hop relative imports in
 *     isolation.
 *   - Their abstractness scan counts EVERY `class`/`interface` declaration in
 *     a file, exported or not, and has no notion of `type` aliases at all.
 *
 * `buildImportGraph` below resolves relative and bare-specifier imports to
 * actual sibling package directories across the WHOLE package tree (not one
 * file read in isolation), so Ca/Ce and `cycles` here are real multi-file,
 * multi-package graph facts, dogfooded against `rdc-harness/packages/*`
 * (21 packages, cross-checked by hand against
 * `grep -rn "from '\.\./\.\./"` — see the skill doc / task report for the
 * full positive-control table).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next']);
const SOURCE_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx']);

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

/** @returns {string[]} absolute paths of every source file under dir, recursively */
function walkSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkSourceFiles(full));
    } else if (entry.isFile() && SOURCE_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import/export extraction — plain regex, no AST.
//
// Deliberately misses: type-only imports written with unusual whitespace
// gymnastics, re-exports hidden behind a computed/template specifier,
// anything generated at runtime (`require(someVar)`). Good enough for the
// overwhelming majority of ESM/CJS import statements, which is the honest
// ceiling of a regex approach — this is disclosed, not hidden.
// ---------------------------------------------------------------------------

const IMPORT_FROM_RE = /\bimport\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
const IMPORT_BARE_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function stripComments(text) {
  // Block comments, then line comments. Simple on purpose: this only needs
  // to avoid matching an import specifier that appears inside a comment
  // (e.g. this file's own doc-comment above, which quotes real import
  // syntax) — it is not a tokenizer.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
}

/**
 * @param {string} sourceText
 * @returns {string[]} raw module specifiers this file imports/requires
 */
export function extractImportSpecifiers(sourceText) {
  const clean = stripComments(sourceText);
  const specs = new Set();
  for (const re of [IMPORT_FROM_RE, IMPORT_BARE_RE, EXPORT_FROM_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean))) specs.add(m[1]);
  }
  return [...specs];
}

/**
 * True for a file whose declaration-site exports should NOT count toward
 * package abstractness. Test files routinely embed source-as-STRING fixtures
 * (`` `export interface Page { ... }` `` as a template-literal test input,
 * not a real declaration of the package under test) that a regex scanner
 * cannot distinguish from real code without a full lexer — confirmed live:
 * `rdc-harness/packages/e2e/test/breadth-lifecycle.test.mjs` embeds exactly
 * that fixture and was originally mis-measured as A=0.105 "measured" for a
 * plain-.mjs package with zero real type declarations. Test files also
 * aren't the package's public contract in Martin's sense regardless of the
 * string-literal risk, so excluding them from THIS scan (not from the
 * Ca/Ce import graph, which legitimately counts test-time coupling too) is
 * correct on both grounds, not just a patch for the false positive.
 */
function isTestFile(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  if (/\/(test|tests|__tests__)\//.test(norm)) return true;
  return /\.(test|spec)\.[a-z]+$/.test(norm);
}

// Declaration-site exports only (`export interface Foo`, `export const Foo = ...`).
// `export { a, b }` re-export lists are intentionally NOT counted here — they
// name existing declarations rather than introducing new ones, and counting
// both would double-count the same declaration under two different exports.
const EXPORT_DECL_RE =
  /\bexport\s+(?:default\s+)?(?:declare\s+)?(abstract\s+class|interface|type|class|function\s*\*?|const|let|var|enum)\s+([A-Za-z0-9_$]+)/g;

/**
 * @param {string} sourceText
 * @returns {{ abstract: number, concrete: number }}
 *
 * NOTE: this does NOT decide measurability. A `.ts` file with zero
 * interfaces/types (all classes/functions/consts) is a real, honest A=0 —
 * "fully concrete" is a legitimate measurement, not an absence of one.
 * Measurability is decided in `buildImportGraph` from the file EXTENSION
 * (does this package contain any `.ts`/`.tsx` source at all), never from
 * whether abstract-shaped keywords happen to appear in it. Gating on
 * keyword presence was tried first and was wrong: it reported a genuine
 * all-concrete TypeScript package (fixture `stable/src/index.ts`, three
 * exported classes/consts, zero interfaces) as "no-type-syntax"/null
 * instead of the correct A=0 — caught by the synthetic Zone-of-Pain/
 * Zone-of-Uselessness fixture run during dogfooding, see the task report.
 */
export function exportedDeclarationCounts(sourceText) {
  const clean = stripComments(sourceText);
  let abstract = 0;
  let concrete = 0;
  EXPORT_DECL_RE.lastIndex = 0;
  let m;
  while ((m = EXPORT_DECL_RE.exec(clean))) {
    const kind = m[1].trim().replace(/\s*\*$/, '');
    if (kind === 'interface' || kind === 'type') abstract++;
    else concrete++;
  }
  return { abstract, concrete };
}

// ---------------------------------------------------------------------------
// Package identity
// ---------------------------------------------------------------------------

/**
 * @param {string} dir absolute path to a package directory
 * @returns {{ dir: string, name: string, hasPackageJson: boolean }}
 */
function packageIdentity(dir) {
  const pkgJsonPath = path.join(dir, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.name) return { dir, name: pkg.name, hasPackageJson: true };
    } catch {
      // fall through to dirname
    }
  }
  return { dir, name: path.basename(dir), hasPackageJson: existsSync(pkgJsonPath) };
}

function normalize(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * Resolve a module specifier found in `fromFile` to a sibling package, if it
 * points at one.
 *
 * @returns {string|null} the target package's declared name, or null if the
 *   specifier doesn't resolve to any of `packages` (npm dependency, node
 *   builtin, or an intra-package relative import).
 */
function resolveToPackage(specifier, fromFile, packages, nameToIndex, dirsSortedByLenDesc) {
  if (specifier.startsWith('.')) {
    const resolved = normalize(path.resolve(path.dirname(fromFile), specifier));
    for (const pkg of dirsSortedByLenDesc) {
      const pdir = normalize(pkg.dir);
      if (resolved === pdir || resolved.startsWith(pdir + '/')) return pkg.name;
    }
    return null;
  }
  // Bare specifier: exact package-name match (`@scope/name`) or, as a
  // fallback, a bare dirname match (`name`) — some monorepos import by
  // dirname via a workspace alias rather than the declared package.json name.
  if (nameToIndex.has(specifier)) return packages[nameToIndex.get(specifier)].name;
  const byDirname = packages.find((p) => path.basename(p.dir) === specifier);
  return byDirname ? byDirname.name : null;
}

// ---------------------------------------------------------------------------
// Import graph across the whole sibling set
// ---------------------------------------------------------------------------

/**
 * @param {string[]} packageDirs absolute paths
 * @returns {{
 *   packages: {dir:string,name:string,hasPackageJson:boolean}[],
 *   ceEdges: Map<string, Set<string>>,   // pkgName -> set of pkgNames it imports from
 *   caEdges: Map<string, Set<string>>,   // pkgName -> set of pkgNames that import it
 *   abstractness: Map<string, {abstract:number, concrete:number, hasTsFile:boolean}>,
 * }}
 */
export function buildImportGraph(packageDirs) {
  const packages = packageDirs.map(packageIdentity);
  const dirsSortedByLenDesc = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  const nameToIndex = new Map(packages.map((p, i) => [p.name, i]));

  const ceEdges = new Map(packages.map((p) => [p.name, new Set()]));
  const caEdges = new Map(packages.map((p) => [p.name, new Set()]));
  const abstractness = new Map(
    packages.map((p) => [p.name, { abstract: 0, concrete: 0, hasTsFile: false }]),
  );

  for (const pkg of packages) {
    const files = walkSourceFiles(pkg.dir);
    for (const file of files) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }

      const specs = extractImportSpecifiers(text);
      for (const spec of specs) {
        const targetName = resolveToPackage(spec, file, packages, nameToIndex, dirsSortedByLenDesc);
        if (!targetName || targetName === pkg.name) continue;
        ceEdges.get(pkg.name).add(targetName);
        caEdges.get(targetName).add(pkg.name);
      }

      if (isTestFile(file)) continue; // Ca/Ce above already counted this file's real edges

      const agg = abstractness.get(pkg.name);
      // Measurability is decided by EXTENSION — a `.ts`/`.tsx` file is real
      // TypeScript regardless of whether it happens to declare any
      // interfaces/types. See exportedDeclarationCounts' doc comment for why
      // keyword-sniffing was tried and rejected.
      if (/\.tsx?$/.test(file)) agg.hasTsFile = true;

      const decl = exportedDeclarationCounts(text);
      agg.abstract += decl.abstract;
      agg.concrete += decl.concrete;
    }
  }

  return { packages, ceEdges, caEdges, abstractness };
}

// ---------------------------------------------------------------------------
// ADP — Acyclic Dependencies Principle: real cycle detection over the graph
// ---------------------------------------------------------------------------

/**
 * Find every simple cycle that passes through `startName`, as an actual
 * package-name path (not just "a cycle exists").
 *
 * @param {Map<string, Set<string>>} ceEdges
 * @param {string} startName
 * @returns {string[][]} each entry is a cycle path, e.g. ['a','b','c','a']
 */
export function findCycles(ceEdges, startName) {
  const cycles = [];
  const stack = [];
  const onStack = new Set();
  const seenCyclesKey = new Set();

  function dfs(node) {
    stack.push(node);
    onStack.add(node);
    for (const next of ceEdges.get(node) ?? []) {
      if (next === startName) {
        const path = [...stack, startName];
        const key = path.join('>');
        if (!seenCyclesKey.has(key)) {
          seenCyclesKey.add(key);
          cycles.push(path);
        }
      } else if (!onStack.has(next)) {
        dfs(next);
      }
      // if `next` is on the stack but isn't startName, that's a cycle NOT
      // involving startName — out of scope for "cycles involving this
      // package", left for a whole-graph sweep if ever needed.
    }
    stack.pop();
    onStack.delete(node);
  }

  dfs(startName);
  return cycles;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PackageMetricsResult
 * @property {string} name
 * @property {number} ca                        - count of OTHER packages that import from this one
 * @property {number} ce                        - count of OTHER packages this one imports from
 * @property {number|null} instability          - Ce/(Ca+Ce); null if Ca+Ce===0 (isolated, no coupling data)
 * @property {number|null} abstractness         - exported interface+type / exported total; null if unmeasurable
 * @property {'measured'|'no-type-syntax'|'no-exported-declarations'} abstractnessBasis
 * @property {number|null} distanceFromMainSequence  - |A+I-1|; null if either input is null
 * @property {string[][]} cycles                - real cycle paths through this package (ADP violations)
 * @property {'main-sequence'|'zone-of-pain'|'zone-of-uselessness'|'off-main-sequence'|'unmeasurable'} zone
 */

/**
 * @param {{ packageDir: string, allPackageDirs: string[] }} args
 * @returns {PackageMetricsResult}
 */
export function packageMetrics({ packageDir, allPackageDirs }) {
  const dirs = allPackageDirs.includes(packageDir) ? allPackageDirs : [...allPackageDirs, packageDir];
  const graph = graphCache(dirs);
  return metricsFor(graph, packageIdentity(packageDir).name);
}

// Cache the graph per unique dir-set within a process — the CLI computes
// metrics for every sibling package in one run and would otherwise rebuild
// the identical graph N times.
const _graphCacheStore = new Map();
function graphCache(dirs) {
  const key = [...dirs].map((d) => normalize(d)).sort().join('|');
  if (!_graphCacheStore.has(key)) _graphCacheStore.set(key, buildImportGraph(dirs));
  return _graphCacheStore.get(key);
}

function metricsFor(graph, pkgName) {
  const ce = graph.ceEdges.get(pkgName)?.size ?? 0;
  const ca = graph.caEdges.get(pkgName)?.size ?? 0;
  const total = ca + ce;
  const instability = total === 0 ? null : ce / total;

  const decl = graph.abstractness.get(pkgName) ?? { abstract: 0, concrete: 0, hasTsFile: false };
  let abstractness = null;
  let abstractnessBasis = 'no-type-syntax';
  if (decl.hasTsFile) {
    const declTotal = decl.abstract + decl.concrete;
    if (declTotal === 0) {
      abstractnessBasis = 'no-exported-declarations';
    } else {
      abstractness = decl.abstract / declTotal;
      abstractnessBasis = 'measured';
    }
  }

  const distanceFromMainSequence =
    instability === null || abstractness === null ? null : Math.abs(abstractness + instability - 1);

  const cycles = findCycles(graph.ceEdges, pkgName);

  let zone;
  if (distanceFromMainSequence === null) {
    zone = 'unmeasurable';
  } else if (distanceFromMainSequence <= 0.5) {
    zone = 'main-sequence';
  } else if (instability < 0.5 && abstractness < 0.5) {
    zone = 'zone-of-pain';
  } else if (instability > 0.5 && abstractness > 0.5) {
    zone = 'zone-of-uselessness';
  } else {
    zone = 'off-main-sequence';
  }

  return {
    name: pkgName,
    ca,
    ce,
    instability,
    abstractness,
    abstractnessBasis,
    distanceFromMainSequence,
    cycles,
    zone,
  };
}

/**
 * @param {string[]} packageDirs absolute paths to every sibling package
 * @returns {PackageMetricsResult[]}
 */
export function packageMetricsAll(packageDirs) {
  const graph = graphCache(packageDirs);
  return graph.packages.map((p) => metricsFor(graph, p.name));
}
