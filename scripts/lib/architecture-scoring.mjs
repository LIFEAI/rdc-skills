/**
 * Clean Architecture boundary / dependency-direction / layer-separation
 * scoring — self-contained, language-independent, same discipline as
 * `package-metrics.mjs` (plain `node:fs` + regex import/path parsing, NO
 * AST, NO ts-morph). Deliberately does not import `language-plugin.mjs` or
 * `plugins/typescript.mjs` — those are owned by parallel work tonight, and
 * Clean Architecture's boundary rule ("dependencies point inward only") is
 * fundamentally a FILE-PATH + IMPORT-TARGET question, which a regex/path
 * scan answers exactly as well as an AST would.
 *
 * Only cross-file import it takes is `extractImportSpecifiers` and
 * `findCycles` from `./package-metrics.mjs` (its own already-exported public
 * API, read-only reuse — no edit to that file) — same-tree specifier
 * extraction and the same real ADP cycle-walk algorithm, now applied to
 * LAYERS instead of PACKAGES.
 *
 * ---- Source: OnSightTeam/architecture-toolkit (MIT) ----
 *
 * Fetched in full via raw.githubusercontent.com 2026-08-20 (not summarized,
 * not guessed) and read end-to-end:
 *   - src/agents/architecture-reviewer/tools/dependency-rule-validator.ts   (213 lines)
 *   - src/agents/architecture-reviewer/tools/boundary-analysis-validator.ts (169 lines)
 *   - src/agents/architecture-reviewer/tools/layer-separation-validator.ts  (145 lines)
 *
 * architecture-toolkit's OWN `.claude/skills/review-arch.md` shells out to
 * `node dist/cli.js --agents=architecture <paths>` — a fully deterministic
 * CLI, no LLM judgment step at all for this domain in the source project.
 * This file mirrors that: every check below is a regex/path fact, not a
 * dispatched opinion.
 *
 * Every rule function cites the exact toolkit file:line(s) it ports or
 * adapts. Two things are DELIBERATELY NOT ported, because they are honestly
 * broken in the source, the same standard `package-metrics.mjs` already
 * applied to a different architecture-toolkit file:
 *   - `dependency-rule-validator.ts`'s own `checkCircularDependencies`
 *     (lines 119-146) is not a cycle walk at all — it flags "3+ levels of
 *     `../../..`" as a *proxy* for circularity, which is neither necessary
 *     nor sufficient (a deeply-relative import can be perfectly acyclic; a
 *     one-hop `./foo` can be one edge of a real 2-node cycle). This file's
 *     `circularLayerDependencyFindings` instead builds a REAL layer-level
 *     import graph from resolved imports and runs `findCycles` — an actual
 *     graph walk, not a path-depth guess.
 *   - Layer detection for an UNRESOLVED import (a bare specifier, or a
 *     relative import that doesn't resolve to any scanned file) falls back
 *     to `detectLayerFromImport`'s keyword-substring match
 *     (dependency-rule-validator.ts:177-193) — ported as-is, but flagged
 *     `confidence: 'low'` in the finding, never conflated with a RESOLVED
 *     file's real classified layer (`confidence: 'high'`). The toolkit does
 *     not make this distinction; this file does, because the two are very
 *     different strengths of evidence.
 *
 * ── Layer classification — configurable, not hardcoded ─────────────────
 * `DEFAULT_LAYERS` below encodes Clean Architecture's four rings
 * (Entities > UseCases > InterfaceAdapters > Frameworks, `level` descending
 * = more inner/protected) as a glob-per-layer list, exactly the shape
 * `solid-score.mjs`'s `boundaries` config already established for a
 * DIFFERENT check (`{orchestrator, requiredPorts}`) — same config-loading
 * discipline (`--config`, `configPath`/`configLoaded` reported in output),
 * separate config section (`layers:`) because it answers a different
 * question. A repo names its folders however it wants; `layers` in
 * `.architecture-score.yml` overrides `DEFAULT_LAYERS` entirely.
 *
 * Two classification passes, in order, cited separately in every finding:
 *   1. PATH match against the layer's `globs` — `confidence: 'high'` basis.
 *   2. Class/interface-NAME regex fallback (`nameHints`), ported near-
 *      verbatim from `detectLayer`'s code-regex half
 *      (dependency-rule-validator.ts:164-172) — `confidence: 'medium'`
 *      basis, since a name convention is a weaker signal than a declared
 *      folder boundary.
 * A file matching neither is `layer: null` — reported as unclassified, not
 * silently defaulted to "Frameworks" (the toolkit's own `detectLayer`
 * defaults unmatched files to `Frameworks` at line 174; this file does NOT
 * inherit that default, because "we don't know" and "this is definitely the
 * outermost ring" are different claims, and defaulting to a specific answer
 * would fabricate confidence a config-driven classifier does not have).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { extractImportSpecifiers, findCycles } from './package-metrics.mjs';

// ---------------------------------------------------------------------------
// File walking — sorted, for determinism (ATF golden-record requirement)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next']);
const SOURCE_EXT = ['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx'];
const SOURCE_EXT_SET = new Set(SOURCE_EXT);

/**
 * @returns {string[]} absolute paths of every source file under dir,
 *   recursively, in a STABLE sort order (directory entries sorted by name
 *   before recursing) — `readdirSync` order is not guaranteed identical
 *   across filesystems/OSes, and this scorer's JSON output must be
 *   byte-identical across two runs on the same unchanged input.
 */
export function walkSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkSourceFiles(full));
    } else if (entry.isFile() && SOURCE_EXT_SET.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layer classification
// ---------------------------------------------------------------------------

/**
 * Clean Architecture's four rings. `level` descending = more inner
 * (protected); the Dependency Rule violation test is
 * `targetLayer.level < currentLayer.level` — a current file depending on a
 * STRICTLY MORE OUTER layer — exact match to
 * `dependency-rule-validator.ts`'s `layerHierarchy` (lines 16-21) and its
 * `targetLayerLevel < currentLayerLevel` test (line 79).
 *
 * `nameHints` are the class/interface-name regex fallback, ported from
 * `detectLayer`'s code-regex half (dependency-rule-validator.ts:164-172).
 */
export const DEFAULT_LAYERS = [
  {
    name: 'Entities',
    level: 4,
    globs: ['**/entities/**', '**/entity/**', '**/domain/**'],
    nameHints: [/\bclass\s+\w+Entity\b/i, /\binterface\s+\w+Entity\b/i],
  },
  {
    name: 'UseCases',
    level: 3,
    globs: ['**/use-cases/**', '**/usecases/**', '**/use-case/**', '**/usecase/**', '**/application/**'],
    nameHints: [/\bclass\s+\w+UseCase\b/i, /\bclass\s+\w+Interactor\b/i],
  },
  {
    name: 'InterfaceAdapters',
    level: 2,
    globs: ['**/adapters/**', '**/adapter/**', '**/controllers/**', '**/controller/**', '**/presenters/**', '**/gateways/**'],
    nameHints: [/\bclass\s+\w+Controller\b/i, /\bclass\s+\w+Presenter\b/i],
  },
  {
    name: 'Frameworks',
    level: 1,
    globs: ['**/frameworks/**', '**/framework/**', '**/infrastructure/**', '**/infra/**'],
    nameHints: [],
  },
];

/**
 * Framework/library indicators. The first block (through `morgan`) is
 * `frameworkIndicators` VERBATIM from `dependency-rule-validator.ts:23-28`
 * — including its two generic-word entries (`http`, `fetch`, `request`),
 * which is exactly why THIS file labels findings from those three at
 * `confidence: 'medium'` rather than `'high'` (see
 * `frameworkCouplingFindings`) — a local variable literally named `request`
 * or an import of Node's builtin `node:http` both match, and the toolkit's
 * own substring check cannot tell the difference. The second block is a
 * disclosed EXTENSION, not part of the cited source — added per this task's
 * instruction to build "a real, cited list, not a guess."
 */
export const FRAMEWORK_INDICATORS_TOOLKIT = [
  'express', 'fastify', 'nest', 'react', 'vue', 'angular',
  'axios', 'fetch', 'http', 'request',
  'mongoose', 'typeorm', 'prisma', 'sequelize',
  'winston', 'pino', 'morgan',
];
export const FRAMEWORK_INDICATORS_EXTENDED = [
  'next', 'aws-sdk', '@aws-sdk/', 'pg', 'redis', 'ioredis', 'koa', 'graphql', 'apollo-server',
];
export const FRAMEWORK_INDICATORS_GENERIC = new Set(['http', 'fetch', 'request']);
export const FRAMEWORK_INDICATORS = [...FRAMEWORK_INDICATORS_TOOLKIT, ...FRAMEWORK_INDICATORS_EXTENDED];

const LEAD_STAR_TOKEN = 'LEADSTAR'; // '**/' — zero or more LEADING path segments
const TRAIL_STAR_TOKEN = 'TRAILSTAR'; // '/**' — zero or more TRAILING path segments
const MID_STAR_TOKEN = 'MIDSTAR'; // bare '**' elsewhere

/**
 * glob->RegExp, anchored on the FULL relative path (`^...$`).
 *
 * Started as a copy of `solid-score.mjs`'s `globToRegExp` (naive
 * `**` -> `.*` substitution, wrapped in `(^|/)...(/|$)`), and this file's
 * own POSITIVE CONTROL fixture (see task report) caught it as WRONG for a
 * layer glob like `**` + `/frameworks/` + `**` against a TOP-LEVEL scanned
 * path (`frameworks/db-client.mjs`, no parent directory): the naive
 * translation is `.*` + `/frameworks/` + `.*`, which requires a literal `/`
 * immediately before `frameworks` — a path with nothing before `frameworks`
 * at all has no such slash to match, so it silently misclassified a real
 * Frameworks-layer file as unclassified. `solid-score.mjs` never surfaced
 * this because every glob it evaluates (test dirs, `node_modules`, …) is an
 * EXCLUDE pattern normally matched against nested repo paths, not asserted
 * to match a bare top-level segment — this file's layer globs regularly are.
 *
 * Fix: a leading `**` + slash and a trailing slash + `**` are each their own
 * token, translated to an optional-leading-segments group and an
 * optional-trailing-segments group respectively (see LEAD_STAR_TOKEN /
 * TRAIL_STAR_TOKEN below) — instead of both collapsing through the same
 * bare wildcard-to-any-chars substitution. A bare `**` elsewhere still
 * becomes "match any characters."
 */
function globToRegExp(glob) {
  const specialChars = ['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']'];
  let escaped = glob;
  for (const ch of specialChars) escaped = escaped.split(ch).join(`\\${ch}`);
  let out = escaped
    .split('**/').join(LEAD_STAR_TOKEN)
    .split('/**').join(TRAIL_STAR_TOKEN)
    .split('**').join(MID_STAR_TOKEN)
    .split('*').join('[^/]*');
  out = out
    .split(LEAD_STAR_TOKEN).join('(?:.*/)?')
    .split(TRAIL_STAR_TOKEN).join('(?:/.*)?')
    .split(MID_STAR_TOKEN).join('.*');
  return new RegExp(`^${out}$`);
}

/** Bare keyword per glob (strip `**`, `*`, slashes) — for the unresolved-import fallback below. */
function layerKeywords(layer) {
  return layer.globs
    .map((g) => g.replace(/\*+/g, '').replace(/\//g, '').toLowerCase())
    .filter(Boolean);
}

/**
 * @param {string} relPath posix-slash relative path
 * @param {{name:string, level:number, globs:string[]}[]} layers
 * @returns {{name:string, level:number}|null}
 */
export function classifyLayerByPath(relPath, layers) {
  for (const layer of layers) {
    for (const glob of layer.globs) {
      if (globToRegExp(glob).test(relPath)) return { name: layer.name, level: layer.level };
    }
  }
  return null;
}

/**
 * @param {string} sourceText
 * @param {{name:string, level:number, nameHints?:RegExp[]}[]} layers
 * @returns {{name:string, level:number}|null}
 */
export function classifyLayerByNameHint(sourceText, layers) {
  for (const layer of layers) {
    for (const hint of layer.nameHints ?? []) {
      if (hint.test(sourceText)) return { name: layer.name, level: layer.level };
    }
  }
  return null;
}

/**
 * @returns {{layer:{name:string,level:number}|null, basis:'path'|'name-hint'|'unclassified'}}
 */
export function classifyFile(relPath, sourceText, layers) {
  const byPath = classifyLayerByPath(relPath, layers);
  if (byPath) return { layer: byPath, basis: 'path' };
  const byName = classifyLayerByNameHint(sourceText, layers);
  if (byName) return { layer: byName, basis: 'name-hint' };
  return { layer: null, basis: 'unclassified' };
}

/**
 * Keyword-substring layer guess for an import specifier that did NOT
 * resolve to any scanned file — ported from `detectLayerFromImport`
 * (dependency-rule-validator.ts:177-193). Always `confidence: 'low'` at the
 * call site; this is a weaker signal than a resolved file's real classified
 * layer and must never be reported with equal certainty.
 */
export function classifyLayerBySpecifierKeyword(specifier, layers) {
  const low = specifier.toLowerCase();
  for (const layer of layers) {
    for (const kw of layerKeywords(layer)) {
      if (kw && low.includes(kw)) return { name: layer.name, level: layer.level };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Import resolution to an actual scanned file
// ---------------------------------------------------------------------------

function normalize(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function stripExt(p) {
  const ext = path.extname(p);
  return SOURCE_EXT_SET.has(ext) ? p.slice(0, -ext.length) : p;
}

/**
 * Resolve a relative import specifier to a scanned file record, if any.
 * Tries the literal path, each source extension, and each extension under
 * an `/index` suffix — the standard Node/bundler resolution shape, done
 * against the KNOWN scanned-file set rather than the real filesystem (a
 * scan target is routinely a subtree, and imports legitimately point
 * outside it — those are correctly reported as "unresolved", not chased
 * onto disk).
 *
 * @param {string} specifier
 * @param {string} fromFile absolute path of the importing file
 * @param {Map<string, object>} byNoExt normalize(stripExt(absPath)) -> record
 * @returns {object|null} the target file record, or null if unresolved
 */
export function resolveRelativeImport(specifier, fromFile, byNoExt) {
  if (!specifier.startsWith('.')) return null;
  const resolvedBase = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [resolvedBase, path.join(resolvedBase, 'index')];
  for (const c of candidates) {
    const hit = byNoExt.get(normalize(stripExt(c)));
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/**
 * @typedef {object} FileRecord
 * @property {string} absPath
 * @property {string} relPath posix-slash, relative to scan root
 * @property {string} text
 * @property {{name:string, level:number}|null} layer
 * @property {'path'|'name-hint'|'unclassified'} layerBasis
 * @property {string[]} imports raw specifiers, in extraction order
 */

/**
 * @param {string[]} files absolute paths
 * @param {string} root absolute scan root (for relPath)
 * @param {{layers: object[]}} config
 * @returns {{records: FileRecord[], byNoExt: Map<string,FileRecord>}}
 */
export function buildFileGraph(files, root, config) {
  const layers = config.layers ?? DEFAULT_LAYERS;
  const records = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const relPath = path.relative(root, f).split(path.sep).join('/');
    const { layer, basis } = classifyFile(relPath, text, layers);
    records.push({ absPath: f, relPath, text, layer, layerBasis: basis, imports: extractImportSpecifiers(text) });
  }
  const byNoExt = new Map();
  for (const r of records) byNoExt.set(normalize(stripExt(r.absPath)), r);
  return { records, byNoExt };
}

/**
 * Layer-level edge set built ONLY from RESOLVED imports (a relative
 * specifier that lands on a real scanned file with a known layer) — the
 * high-confidence half of layer classification. This is deliberately a
 * narrower graph than "every import that looks like it points at a layer";
 * `circularLayerDependencyFindings` needs real edges to run a real cycle
 * walk on, not keyword guesses.
 *
 * @returns {Map<string, Set<string>>} layerName -> set of layerNames it depends on
 */
export function buildLayerEdges(records, byNoExt, layers) {
  const edges = new Map(layers.map((l) => [l.name, new Set()]));
  for (const r of records) {
    if (!r.layer) continue;
    for (const spec of r.imports) {
      const target = resolveRelativeImport(spec, r.absPath, byNoExt);
      if (!target || !target.layer) continue;
      if (target.layer.name === r.layer.name) continue; // intra-layer coupling is not a layer-graph edge
      edges.get(r.layer.name)?.add(target.layer.name);
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Rule 1 — Dependency direction (inward-only)
// Ported from dependency-rule-validator.ts:61-117 `checkDependencyDirection`
// ---------------------------------------------------------------------------

export function dependencyDirectionFindings(record, byNoExt, layers) {
  const findings = [];
  if (!record.layer) return { ruleId: 'dependency-direction', findings, source: 'dependency-rule-validator.ts:61-117' };
  for (const spec of record.imports) {
    const resolved = resolveRelativeImport(spec, record.absPath, byNoExt);
    let targetLayer = null;
    let confidence = null;
    if (resolved?.layer) {
      targetLayer = resolved.layer;
      confidence = 'high';
    } else if (!spec.startsWith('.')) {
      const guessed = classifyLayerBySpecifierKeyword(spec, layers);
      if (guessed) {
        targetLayer = guessed;
        confidence = 'low';
      }
    }
    if (!targetLayer) continue;
    if (targetLayer.level < record.layer.level) {
      findings.push({
        location: record.relPath,
        detail: `${record.layer.name} layer depends on outer ${targetLayer.name} layer via '${spec}' (violates the Dependency Rule — dependencies must point inward only)`,
        severity: 'critical',
        confidence,
      });
    }
  }
  return { ruleId: 'dependency-direction', findings, source: 'dependency-rule-validator.ts:61-117' };
}

// ---------------------------------------------------------------------------
// Rule 2 — Framework coupling
// Ported from dependency-rule-validator.ts:98-113
// ---------------------------------------------------------------------------

export function frameworkCouplingFindings(record) {
  const findings = [];
  if (!record.layer || record.layer.name === 'Frameworks') return { ruleId: 'framework-coupling', findings, source: 'dependency-rule-validator.ts:98-113' };
  for (const spec of record.imports) {
    const low = spec.toLowerCase();
    const hit = FRAMEWORK_INDICATORS.find((ind) => low.includes(ind));
    if (!hit) continue;
    findings.push({
      location: record.relPath,
      detail: `${record.layer.name} layer directly imports framework/library '${spec}' (matched indicator '${hit}')`,
      // Exact ternary from dependency-rule-validator.ts:105 — critical for
      // Entities, high for every other non-Frameworks layer.
      severity: record.layer.name === 'Entities' ? 'critical' : 'high',
      confidence: FRAMEWORK_INDICATORS_GENERIC.has(hit) ? 'medium' : 'high',
    });
  }
  return { ruleId: 'framework-coupling', findings, source: 'dependency-rule-validator.ts:98-113' };
}

// ---------------------------------------------------------------------------
// Rule 3 — Missing abstraction (five sub-checks, one ruleId, same pattern as
// clean-code-scoring.mjs's G9 "two independent halves")
// ---------------------------------------------------------------------------

const RE_USECASE_CLASS = /class\s+\w+(UseCase|Interactor)/i;
const RE_CONCRETE_REPO = /new\s+\w+(Repository|Gateway|DataSource)/i;
const RE_CONTROLLER_CLASS = /class\s+\w+Controller/i;
const RE_PORT_INTERFACE = /interface\s+\w+(UseCase|Port|Input)/i;
const RE_NEW_USECASE = /new\s+\w+UseCase/i;
const RE_HTTP_LEAK = /request\.|req\./i;
const RE_ENTITY_LEAK = /return\s+.*Entity|:\s+.*Entity\[|Promise<.*Entity>/i;
const DB_PATTERNS = [/\bdb\./i, /\bdatabase\./i, /\bmongodb\./i, /\bprisma\./i, /SELECT\s+.*\s+FROM/i, /INSERT\s+INTO/i, /UPDATE\s+.*\s+SET/i];
const RE_USECASE_SERVICE_CLASS = /class\s+\w+(UseCase|Interactor|Service)/i;

/**
 * @param {FileRecord} record
 */
export function missingAbstractionFindings(record) {
  const findings = [];
  const text = record.text;

  // 3a — boundary-analysis-validator.ts:44-63
  if (RE_USECASE_CLASS.test(text) && RE_CONCRETE_REPO.test(text)) {
    findings.push({
      location: record.relPath,
      kind: 'missing-repository-interface',
      detail: 'Use Case directly instantiates a concrete Repository/Gateway/DataSource (missing boundary interface)',
      severity: 'high',
      confidence: 'high',
    });
  }

  // 3b — boundary-analysis-validator.ts:65-82
  if (RE_CONTROLLER_CLASS.test(text) && !RE_PORT_INTERFACE.test(text) && RE_NEW_USECASE.test(text)) {
    findings.push({
      location: record.relPath,
      kind: 'missing-input-port',
      detail: 'Controller directly instantiates a Use Case with no input-port interface declared in this file',
      severity: 'medium',
      confidence: 'high',
    });
  }

  // 3c — boundary-analysis-validator.ts:108-124
  if (RE_HTTP_LEAK.test(text) && RE_USECASE_CLASS.test(text)) {
    findings.push({
      location: record.relPath,
      kind: 'http-request-in-usecase',
      detail: "HTTP request object ('request.'/'req.') referenced in a Use Case/Interactor file — framework detail leaked into the Use Case layer",
      severity: 'critical',
      confidence: 'medium', // whole-file text match, not scoped to the UseCase class body specifically
    });
  }

  // 3d — layer-separation-validator.ts:83-115
  const hasDb = DB_PATTERNS.some((re) => re.test(text));
  if (hasDb && RE_USECASE_SERVICE_CLASS.test(text)) {
    findings.push({
      location: record.relPath,
      kind: 'direct-db-access-in-usecase',
      detail: 'Use Case/Interactor/Service accesses the database directly (db./database./mongodb./prisma./raw SQL) instead of through a repository interface',
      severity: 'critical',
      confidence: 'medium',
    });
  }

  // 3e — boundary-analysis-validator.ts:87-106
  if (RE_ENTITY_LEAK.test(text) && RE_CONTROLLER_CLASS.test(text)) {
    findings.push({
      location: record.relPath,
      kind: 'data-structure-leak',
      detail: 'Controller returns/types a value as an Entity — an internal data structure crossing the boundary untranslated; map to a DTO at the boundary instead',
      severity: 'critical',
      confidence: 'low', // `return .*Entity` / `: .*Entity[` / `Promise<.*Entity>` is a broad textual pattern — real false-positive risk (e.g. an unrelated class literally named `...Entity` used only as a local value)
    });
  }

  return { ruleId: 'missing-abstraction', findings, source: 'boundary-analysis-validator.ts:44-124, layer-separation-validator.ts:83-115' };
}

// ---------------------------------------------------------------------------
// Rule 4 (bonus) — Mixed business/infrastructure concerns
// Ported from layer-separation-validator.ts:54-81
// ---------------------------------------------------------------------------

const BUSINESS_RULE_INDICATORS = ['validate', 'calculate', 'process', 'execute', 'apply', 'business', 'rule', 'policy', 'workflow'];
const INFRASTRUCTURE_CONCERNS = ['database', 'http', 'file', 'cache', 'queue', 'email', 'logger', 'metrics', 'config', 'environment'];

export function mixedConcernsFindings(record) {
  const findings = [];
  const text = record.text;
  const hasBusiness = BUSINESS_RULE_INDICATORS.some((w) => new RegExp(`\\b${w}\\w*\\b`, 'i').test(text));
  const hasInfra = INFRASTRUCTURE_CONCERNS.some((w) => new RegExp(`\\b${w}\\w*\\b`, 'i').test(text));
  if (hasBusiness && hasInfra) {
    findings.push({
      location: record.relPath,
      detail: 'Business-rule vocabulary (validate/calculate/process/…) and infrastructure vocabulary (database/http/cache/…) both appear in this file — likely business logic mixed with infrastructure concerns',
      severity: 'high',
      // whole-file word-list co-occurrence, same heuristic risk N2 already
      // discloses in clean-code-scoring.mjs — a file legitimately discussing
      // both (e.g. this very scorer's own doc comments) will false-positive.
      confidence: 'low',
    });
  }
  return { ruleId: 'mixed-concerns', findings, source: 'layer-separation-validator.ts:54-81' };
}

// ---------------------------------------------------------------------------
// Rule 5 (bonus) — UI/business-logic mixing
// Ported from layer-separation-validator.ts:117-143
// ---------------------------------------------------------------------------

const UI_INDICATORS = ['component', 'render', 'jsx', 'tsx', 'props', 'state', 'onclick'];
const RE_COMPLEX_BUSINESS_BODY = /\b(calculate|validate|process)\w*\([^)]*\)\s*{[^}]{100,}/i;

export function uiBusinessLogicMixingFindings(record) {
  const findings = [];
  const text = record.text;
  const hasUI = UI_INDICATORS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
  if (hasUI && RE_COMPLEX_BUSINESS_BODY.test(text)) {
    findings.push({
      location: record.relPath,
      detail: 'A calculate/validate/process function with a 100+ character body appears alongside UI indicators (component/render/jsx/props/…) — complex business logic embedded in a UI component',
      severity: 'medium',
      confidence: 'medium',
    });
  }
  return { ruleId: 'ui-business-logic-mixing', findings, source: 'layer-separation-validator.ts:117-143' };
}

// ---------------------------------------------------------------------------
// Rule 6 (bonus) — Mixed architectural layers in one file (3+)
// Ported from boundary-analysis-validator.ts:129-167
// ---------------------------------------------------------------------------

export function mixedLayerImportsFindings(record, layers) {
  const findings = [];
  const layersFound = new Set();
  for (const spec of record.imports) {
    const guess = classifyLayerBySpecifierKeyword(spec, layers);
    if (guess) layersFound.add(guess.name);
  }
  if (layersFound.size >= 3) {
    findings.push({
      location: record.relPath,
      detail: `File imports from ${layersFound.size} different architectural layers (${[...layersFound].sort().join(', ')}) — tight coupling across layer boundaries`,
      severity: 'medium',
      confidence: 'medium', // keyword-in-specifier layer guess, same basis as the low-confidence half of dependency-direction
    });
  }
  return { ruleId: 'mixed-layer-imports', findings, source: 'boundary-analysis-validator.ts:129-167' };
}

// ---------------------------------------------------------------------------
// Rule 7 — Circular layer dependencies (REAL cycle walk, not the toolkit's
// broken `../../..` depth proxy — see file header)
// ---------------------------------------------------------------------------

/**
 * Canonicalize a cycle path (array of layer names ending back at the start)
 * by rotating to start at the lexicographically smallest layer name, so the
 * same physical cycle discovered from two different `findCycles(start)`
 * calls dedupes to one entry — required for deterministic, non-duplicated
 * JSON output.
 */
function canonicalizeCycle(cyclePath) {
  const ring = cyclePath.slice(0, -1); // drop the repeated closing node
  let minIdx = 0;
  for (let i = 1; i < ring.length; i++) if (ring[i] < ring[minIdx]) minIdx = i;
  const rotated = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
  return [...rotated, rotated[0]];
}

export function circularLayerDependencyFindings(layerEdges) {
  const seen = new Set();
  const cycles = [];
  for (const layerName of [...layerEdges.keys()].sort()) {
    for (const c of findCycles(layerEdges, layerName)) {
      const canon = canonicalizeCycle(c);
      const key = canon.join('>');
      if (seen.has(key)) continue;
      seen.add(key);
      cycles.push(canon);
    }
  }
  cycles.sort((a, b) => a.join('>').localeCompare(b.join('>')));
  const findings = cycles.map((c) => ({
    location: c.join(' -> '),
    detail: `Real cycle in the layer-import graph: ${c.join(' -> ')} — built from RESOLVED file imports only (buildLayerEdges), then walked with package-metrics.mjs's findCycles (the same ADP algorithm, applied to layers instead of packages)`,
    severity: 'high',
    confidence: 'high',
  }));
  return { ruleId: 'circular-layer-dependency', findings, source: 'package-metrics.mjs findCycles, adapted to layers (dependency-rule-validator.ts:119-146 is NOT reused — see file header)' };
}

// ---------------------------------------------------------------------------
// Aggregate per-file score + whole-scan score
// ---------------------------------------------------------------------------

/**
 * @param {FileRecord} record
 * @param {Map<string,FileRecord>} byNoExt
 * @param {object[]} layers
 */
export function architectureScoreFile(record, byNoExt, layers) {
  const rules = {
    dependencyDirection: dependencyDirectionFindings(record, byNoExt, layers),
    frameworkCoupling: frameworkCouplingFindings(record),
    missingAbstraction: missingAbstractionFindings(record),
    mixedConcerns: mixedConcernsFindings(record),
    uiBusinessLogicMixing: uiBusinessLogicMixingFindings(record),
    mixedLayerImports: mixedLayerImportsFindings(record, layers),
  };
  const totalFindings = Object.values(rules).reduce((n, r) => n + r.findings.length, 0);
  return {
    file: record.relPath,
    layer: record.layer?.name ?? null,
    layerBasis: record.layerBasis,
    rules,
    totalFindings,
  };
}

/**
 * @param {string[]} files absolute paths
 * @param {string} root absolute scan root
 * @param {{layers?: object[]}} config
 */
export function architectureScoreAll(files, root, config = {}) {
  const layers = config.layers ?? DEFAULT_LAYERS;
  const { records, byNoExt } = buildFileGraph(files, root, { layers });
  const sortedRecords = [...records].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  const results = sortedRecords.map((r) => architectureScoreFile(r, byNoExt, layers));
  const layerEdges = buildLayerEdges(records, byNoExt, layers);
  const circular = circularLayerDependencyFindings(layerEdges);
  const unclassifiedFiles = sortedRecords.filter((r) => !r.layer).map((r) => r.relPath);
  return {
    results,
    circularLayerDependency: circular,
    unclassifiedFiles,
    layers: layers.map((l) => ({ name: l.name, level: l.level, globs: l.globs })),
  };
}
