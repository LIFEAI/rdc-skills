/**
 * Refactoring detection — pure functions over a `NormalizedUnit`
 * (see language-plugin.mjs), same discipline as clean-code-scoring.mjs and
 * solid-scoring.mjs: no ts-morph, no language-specific parser. Every fact
 * these rules read was computed once, in `lib/plugins/typescript.mjs`, from
 * the real AST.
 *
 * Detection thresholds are ported/corroborated from architecture-toolkit's
 * REAL implementation — github.com/OnSightTeam/architecture-toolkit (MIT),
 * `src/agents/pattern-refactoring-guide/tools/{refactoring-analyzer,
 * code-smell-refactoring-guide,pattern-transformation-guide}.ts` — reuse of
 * their real detection logic explicitly approved by the operator mid-task,
 * 2026-08-20. Their checks run whole-file text regexes (no AST); ours walk
 * the real AST per unit/member, so every finding carries a real file:line,
 * not a file-wide count.
 *
 * IMPORTANT — two thresholds here are DELIBERATELY DIFFERENT from this
 * repo's own clean-code-scoring.mjs, even though they measure the same
 * underlying fact. They are NOT merged/deduped with the clean-code rules:
 *   - extract-method here fires at statementCount > 25 (this file), vs.
 *     clean-code's F1 at statementCount > 20 (clean-code-scoring.mjs's
 *     f1LongMethods). architecture-toolkit's own real threshold
 *     (refactoring-analyzer.ts:49, `if (lines.length > 25)`) is lines-per-
 *     function, not statements — 25 is the toolkit's real number for THIS
 *     domain (a refactoring recommendation), 20 is this repo's own number
 *     for clean-code's F1. Both stay live, cited separately.
 *   - introduce-parameter-object here fires at paramCount > 4, vs.
 *     clean-code's F2 at paramCount > 3 (clean-code-scoring.mjs's
 *     f2TooManyParams). architecture-toolkit's real threshold
 *     (refactoring-analyzer.ts:171, `if (params.length > 4)`) is 4; F2's is
 *     the repo's own 3. A member can be flagged by clean-code's F2 (>3) and
 *     NOT yet reach the refactoring-actionable threshold (>4) — that gap is
 *     intentional, not an inconsistency to fix.
 *
 * replace-magic-number deliberately REUSES clean-code's N4 `magicNumbers`
 * fact rather than recomputing it — same underlying numbers, this domain
 * just reframes the OUTPUT as a refactoring recommendation (a concrete
 * "extract these into named constants" plan) instead of N4's per-occurrence
 * finding, once the unit's total count crosses architecture-toolkit's real
 * file-level threshold (refactoring-analyzer.ts:224-226, `magicNumbers.length
 * > 5`).
 */

// ── extract-method ──────────────────────────────────────────────────────
// architecture-toolkit's real threshold: refactoring-analyzer.ts:49
// (`if (lines.length > 25)`) — lines-per-function-body, whole-file regex
// match. Ours: statementCount (already on the contract, computed once for
// clean-code's F1 at a DIFFERENT threshold — see file header) > 25.
export function extractMethodOpportunities(unit) {
  const findings = [];
  for (const m of unit.members) {
    if ((m.statementCount ?? 0) > 25) {
      findings.push({
        type: 'extract-method',
        location: `${unit.name}#${m.name}`,
        detail: `${m.statementCount} statements (over 25) — candidate for Extract Method`,
        effortCriterion: 'single-file, mechanical extraction — Low unless call-site scan says otherwise',
      });
    }
  }
  return { refactoringType: 'extract-method', findings, confidence: 'high' };
}

// ── extract-class ───────────────────────────────────────────────────────
// architecture-toolkit's real threshold: refactoring-analyzer.ts:108
// (`if (methods > 15)`) — method count per class, whole-file regex match.
// Ours: unit.members.length (the same fact this repo's own SRP
// connected-component analysis in solid-scoring.mjs already reads) > 15,
// scoped to class units only (a module with >15 top-level functions is a
// different smell — god-module, not god-class — and is out of scope here).
export function extractClassOpportunities(unit) {
  const findings = [];
  if (unit.kind === 'class' && unit.members.length > 15) {
    findings.push({
      type: 'extract-class',
      location: unit.name,
      detail: `${unit.members.length} methods (over 15) — violates Single Responsibility, candidate for Extract Class`,
      effortCriterion: 'package-boundary crossing likely — check call-site scan; toolkit\'s own precedent is High',
    });
  }
  return { refactoringType: 'extract-class', findings, confidence: 'high' };
}

// ── introduce-parameter-object ──────────────────────────────────────────
// architecture-toolkit's real threshold: refactoring-analyzer.ts:171
// (`if (params.length > 4)`). `paramCount` is already part of the base
// NormalizedMember contract (clean-code's F2 reads the same field at a
// DIFFERENT threshold, >3 — see file header).
export function introduceParameterObjectOpportunities(unit) {
  const findings = [];
  for (const m of unit.members) {
    if (m.paramCount > 4) {
      findings.push({
        type: 'introduce-parameter-object',
        location: `${unit.name}#${m.name}`,
        detail: `${m.paramCount} parameters (over 4) — candidate for Introduce Parameter Object`,
        effortCriterion: 'single-file, mechanical — Low unless call-site scan says otherwise',
      });
    }
  }
  return { refactoringType: 'introduce-parameter-object', findings, confidence: 'high' };
}

// ── replace-magic-number ────────────────────────────────────────────────
// architecture-toolkit's real threshold: refactoring-analyzer.ts:224-226
// (`magicNumbers.length > 5`, whole file). We reuse N4's `magicNumbers` fact
// (magic-number occurrences already excluding 0/1/-1 and const/enum
// initializers) but AGGREGATE PER UNIT — not per member, matching the
// toolkit's own whole-file scope — and only recommend the refactor once the
// unit's total crosses 5. Below that, N4 (clean-code-scoring.mjs) still
// flags each occurrence individually; this domain only fires once there are
// "enough" to justify a consolidation pass, per the toolkit's real number.
export function replaceMagicNumberOpportunities(unit) {
  const all = unit.members.flatMap((m) => (m.magicNumbers ?? []).map((n) => ({ member: m.name, ...n })));
  if (all.length <= 5) return { refactoringType: 'replace-magic-number', findings: [], confidence: 'high' };
  const findings = all.map((n) => ({
    type: 'replace-magic-number',
    location: `${unit.name}#${n.member}:${n.line}`,
    detail: `magic number ${n.value} — one of ${all.length} in this unit (over 5), candidate for a named constant`,
    effortCriterion: 'single-file, mechanical (extract-constant) — Low',
  }));
  return { refactoringType: 'replace-magic-number', findings, confidence: 'high' };
}

// ── consolidate-duplicate-code ──────────────────────────────────────────
// architecture-toolkit's real thresholds: code-smell-refactoring-guide.ts:41
// (lines trimmed to >10 chars), :49 (`count > 3` per pattern),
// :51 (`significantDuplication.length > 3` distinct patterns) — all
// whole-file line-text repetition. Ours: groups `statementTexts` (a new
// fact — normalized per-STATEMENT-NODE text, same >10-char filter) across
// ALL members of the unit, same two-level threshold (each group repeated
// >3 times, AND more than 3 such groups) before firing.
export function consolidateDuplicateCodeOpportunities(unit) {
  const byText = new Map();
  for (const m of unit.members) {
    for (const s of m.statementTexts ?? []) {
      if (!byText.has(s.text)) byText.set(s.text, []);
      byText.get(s.text).push({ member: m.name, line: s.line });
    }
  }
  const duplicateGroups = [...byText.entries()].filter(([, occurrences]) => occurrences.length > 3);
  if (duplicateGroups.length <= 3) return { refactoringType: 'consolidate-duplicate-code', findings: [], confidence: 'medium' };
  const findings = duplicateGroups.map(([text, occurrences]) => ({
    type: 'consolidate-duplicate-code',
    location: occurrences.map((o) => `${unit.name}#${o.member}:${o.line}`).join(', '),
    detail: `statement repeated ${occurrences.length}x (one of ${duplicateGroups.length} duplicate patterns, over 3) — candidate for Consolidate Duplicate Code: '${text.slice(0, 80)}${text.length > 80 ? '…' : ''}'`,
    effortCriterion: '4-15 call sites within the unit — Medium, unless the shared logic must also serve callers outside this package',
  }));
  return { refactoringType: 'consolidate-duplicate-code', findings, confidence: 'medium' };
}

// ── decompose-conditional ───────────────────────────────────────────────
// architecture-toolkit's real threshold: code-smell-refactoring-guide.ts:111
// (`/if\s*\([^)]{50,}\)/g`, whole file), :113 (`.length > 2`). Ours:
// `complexConditionals` (a new fact — real `if`-condition text length),
// aggregated per unit, same >2-count threshold.
export function decomposeConditionalOpportunities(unit) {
  const all = unit.members.flatMap((m) => (m.complexConditionals ?? []).map((c) => ({ member: m.name, ...c })));
  if (all.length <= 2) return { refactoringType: 'decompose-conditional', findings: [], confidence: 'high' };
  const findings = all.map((c) => ({
    type: 'decompose-conditional',
    location: `${unit.name}#${c.member}:${c.line}`,
    detail: `complex conditional, ${c.length} chars (over 50) — one of ${all.length} in this unit (over 2), candidate for Decompose Conditional`,
    effortCriterion: 'single-file, mechanical (extract-condition-to-named-method) — Low',
  }));
  return { refactoringType: 'decompose-conditional', findings, confidence: 'high' };
}

// ── strategy-transform ──────────────────────────────────────────────────
// architecture-toolkit's real pattern: pattern-transformation-guide.ts:42
// (`switch(...)  { ... (calculate|process|validate|format) ... }`, whole
// file, boolean trigger — no count threshold). Ours: per real
// SwitchStatement (`switchStatements` fact), same word list.
export function strategyTransformOpportunities(unit) {
  const findings = [];
  for (const m of unit.members) {
    for (const sw of m.switchStatements ?? []) {
      if (sw.hasBehaviorCall) {
        findings.push({
          type: 'strategy-transform',
          location: `${unit.name}#${m.name}:${sw.line}`,
          detail: 'switch statement dispatches behavior (calculate/process/validate/format) — candidate for Strategy pattern',
          effortCriterion: 'new Strategy classes, call sites local to this unit — Medium',
        });
      }
    }
  }
  return { refactoringType: 'strategy-transform', findings, confidence: 'medium' };
}

// ── factory-transform ───────────────────────────────────────────────────
// architecture-toolkit's real pattern: pattern-transformation-guide.ts:100
// (`switch(...type...) { ... new ... }`, whole file, boolean trigger).
// Ours: per real SwitchStatement, discriminant text contains "type" AND the
// switch body contains a `new X()`.
export function factoryTransformOpportunities(unit) {
  const findings = [];
  for (const m of unit.members) {
    for (const sw of m.switchStatements ?? []) {
      if (sw.hasTypeCreation) {
        findings.push({
          type: 'factory-transform',
          location: `${unit.name}#${m.name}:${sw.line}`,
          detail: 'switch statement creates objects by type — candidate for Factory Method pattern',
          effortCriterion: 'new Factory class, call sites local to this unit — Medium',
        });
      }
    }
  }
  return { refactoringType: 'factory-transform', findings, confidence: 'medium' };
}

// ── null-object-transform ───────────────────────────────────────────────
// architecture-toolkit's real threshold: pattern-transformation-guide.ts:160
// (`nullChecks > 5`, whole file). Ours: `nullChecks` fact (real `if`
// conditions containing `=== null` / `!== null`), aggregated per unit, same
// threshold.
export function nullObjectTransformOpportunities(unit) {
  const all = unit.members.flatMap((m) => (m.nullChecks ?? []).map((n) => ({ member: m.name, ...n })));
  if (all.length <= 5) return { refactoringType: 'null-object-transform', findings: [], confidence: 'high' };
  const findings = all.map((n) => ({
    type: 'null-object-transform',
    location: `${unit.name}#${n.member}:${n.line}`,
    detail: `null check — one of ${all.length} in this unit (over 5), candidate for Null Object pattern`,
    effortCriterion: 'new Null Object class, call sites local to this unit — Medium',
  }));
  return { refactoringType: 'null-object-transform', findings, confidence: 'high' };
}

/**
 * Effort estimation — low/medium/high, per the criteria table in
 * skills/pattern-refactoring-guide/SKILL.md (adapted from architecture-
 * toolkit's own `estimatedEffort` field values, corroborated file:line in
 * that SKILL.md). Requires a real cross-file reference-graph walk for the
 * call-site-count and package-boundary criteria — reuses the SAME mechanism
 * clean-code-scoring.mjs's G9 dead-export check already uses
 * (`plugin.referenceSitesOf`, built on the identical `findReferencesAsNodes`
 * walk as `deadExportsOf`), gated behind the same positive-control
 * discipline the caller (refactoring-score.mjs) is responsible for running
 * BEFORE trusting any referenceCount from it — see
 * .claude/rules/prove-absence-positive-control.md.
 *
 * The "cross-cutting invariant" criterion from the SKILL.md table (event
 * ordering, transactional/append-only integrity, freeze-after-mutation
 * semantics) is NOT mechanically detectable from AST facts alone — it stays
 * a human judgment call. This function reports `invariantCheckRequired:
 * true` on every HIGH-adjacent (package-boundary-crossing OR >15-call-site)
 * result as a reminder, but never claims to have evaluated it.
 *
 * @param {object} params
 * @param {string} params.unitPackage - the target unit's own top-level
 *   package/app segment (e.g. `packages/core`, `apps/prt`), used to test
 *   package-boundary crossing against each reference site's file path.
 * @param {{referenceCount: number, files: string[], kind: string|null}|null} params.referenceSites -
 *   result of `plugin.referenceSitesOf(filePath, unitName, projectFilePaths)`,
 *   or `null` if the scan was skipped/unavailable/failed its positive control.
 */
export function estimateEffort({ unitPackage, referenceSites }) {
  if (!referenceSites || referenceSites.referenceCount < 0) {
    return { effort: null, confidence: 'unmeasured', criterion: 'call-site scan unavailable or unit not found in it — effort cannot be estimated mechanically' };
  }
  const { referenceCount, files } = referenceSites;
  const crossesBoundary = unitPackage ? files.some((f) => !topLevelPackageOf(f, unitPackage)) : false;
  if (crossesBoundary) {
    return { effort: 'high', confidence: 'high', criterion: 'crosses a package boundary', callSites: referenceCount, invariantCheckRequired: true };
  }
  if (referenceCount > 15) {
    return { effort: 'high', confidence: 'high', criterion: '>15 call sites', callSites: referenceCount, invariantCheckRequired: true };
  }
  if (referenceCount >= 4) {
    return { effort: 'medium', confidence: 'high', criterion: '4-15 call sites, same package', callSites: referenceCount };
  }
  return { effort: 'low', confidence: 'high', criterion: '≤3 call sites, no package-boundary crossing', callSites: referenceCount };
}

// True when `filePath` shares `unitPackage`'s top-level package/app segment
// (e.g. unitPackage = "packages/core" matches any filePath containing
// "/packages/core/").
function topLevelPackageOf(filePath, unitPackage) {
  const norm = filePath.replace(/\\/g, '/');
  return norm.includes(`/${unitPackage}/`);
}

const ALL_RULES = [
  extractMethodOpportunities,
  extractClassOpportunities,
  introduceParameterObjectOpportunities,
  replaceMagicNumberOpportunities,
  consolidateDuplicateCodeOpportunities,
  decomposeConditionalOpportunities,
  strategyTransformOpportunities,
  factoryTransformOpportunities,
  nullObjectTransformOpportunities,
];

/**
 * @param {import('./language-plugin.mjs').NormalizedUnit} unit
 */
export function refactoringScore(unit) {
  const rules = {};
  for (const fn of ALL_RULES) {
    const result = fn(unit);
    rules[result.refactoringType] = result;
  }
  const totalFindings = Object.values(rules).reduce((n, r) => n + r.findings.length, 0);
  return { unit: unit.name, kind: unit.kind, rules, totalFindings };
}
