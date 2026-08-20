/**
 * Clean Code scoring — pure functions over a `NormalizedUnit`
 * (see language-plugin.mjs), same discipline as solid-scoring.mjs: no
 * ts-morph, no language-specific parser. Every fact these rules read was
 * computed once, in `lib/plugins/typescript.mjs`, from the real AST.
 *
 * Detection logic (thresholds, patterns, what counts as a violation) is
 * ported/adapted from architecture-toolkit's REAL implementation —
 * github.com/OnSightTeam/architecture-toolkit (MIT), specifically
 * `src/agents/clean-code-analyzer/tools/{naming,function,code-smell}-validator.ts`
 * — reuse of their real detection logic explicitly approved by the operator
 * mid-task, 2026-08-20. Their checks run whole-file text regexes with an
 * occurrence-count threshold to suppress false positives (e.g. "flag only if
 * more than 3 single-letter assignments appear"); ours walks the real AST
 * per declared binding, so context is known directly (a for-loop counter vs.
 * a badly-named field, a magic number vs. a named const) and no threshold is
 * needed to separate signal from regex noise — every real occurrence is its
 * own finding. Each rule function below cites the specific architecture-
 * toolkit file:line it corroborates or adapts.
 *
 * Rules NOT implemented here (N3, N5, N6, C1-C5, G5, G14, G16, G28) are
 * intentionally absent — see skills/clean-code-analyzer/SKILL.md for why
 * each one stays a dispatched-judgment call instead of a fake mechanical
 * check.
 */

export const NOT_IMPLEMENTED = ['N3', 'N5', 'N6', 'C1', 'C2', 'C3', 'C4', 'C5', 'G5', 'G14', 'G16', 'G28'];

function loc(unit, memberName, line) {
  return line === undefined ? `${unit.name}#${memberName}` : `${unit.name}#${memberName}:${line}`;
}

// ── N1 — single-letter / cryptic variable names ────────────────────────────
// architecture-toolkit's real check: naming-validator.ts:46-47 flags
// single-letter assignments (`\b[a-z]\s*=`) once there are MORE THAN 3 in
// the whole file, and naming-validator.ts:63-64 does the same for two-letter
// names at a threshold of 5 — both exist only to suppress the regex's own
// false-positive rate (any `x = 5` matches, including inside strings). Our
// AST version reads the real declared-binding name directly, so every
// genuine one-or-two-letter local (outside the loop-counter/well-known
// exceptions the task specifies) is reported on its own — no threshold.
const LOOP_COUNTER_WHITELIST = new Set(['i', 'j', 'k']);
const SHORT_NAME_WHITELIST = new Set(['fn', 'cb', 'ok', 'id', 'db', 'ui', 'io']);

export function n1CrypticNames(unit) {
  const findings = [];
  for (const m of unit.members) {
    for (const d of m.declaredNames ?? []) {
      if (d.name.length === 1 && !LOOP_COUNTER_WHITELIST.has(d.name)) {
        findings.push({ location: loc(unit, m.name, d.line), detail: `single-letter name '${d.name}' (not a conventional loop counter)` });
      } else if (d.name.length === 2 && !SHORT_NAME_WHITELIST.has(d.name.toLowerCase())) {
        findings.push({ location: loc(unit, m.name, d.line), detail: `cryptic two-letter name '${d.name}'` });
      }
    }
  }
  return { ruleId: 'N1', findings, confidence: 'high' };
}

// ── N2 — meaningless distinctions (heuristic, low confidence) ─────────────
// architecture-toolkit's real check at naming-validator.ts:98-99 flags
// number-suffixed names (`\w+\d+\s*=`, e.g. name1/name2) at a >2 occurrence
// threshold — that pattern (data1/data2) is adapted directly, per-occurrence,
// no threshold. Its co-located data/info regex (naming-validator.ts:82) is
// whole-file text co-occurrence and doesn't translate to a per-binding AST
// check, so it's replaced here with a small noise-word set applied to the
// SAME declared-binding facts N1 uses.
const NOISE_WORDS = new Set(['data', 'info', 'temp', 'tmp', 'foo', 'bar', 'val', 'obj', 'thing']);
const NUMERIC_SUFFIX_RE = /^[A-Za-z_$][A-Za-z0-9_$]*[0-9]+$/;

export function n2MeaninglessNames(unit) {
  const findings = [];
  for (const m of unit.members) {
    for (const d of m.declaredNames ?? []) {
      if (NOISE_WORDS.has(d.name.toLowerCase())) {
        findings.push({ location: loc(unit, m.name, d.line), detail: `heuristic: noise-word name '${d.name}' carries no distinguishing meaning` });
      } else if (NUMERIC_SUFFIX_RE.test(d.name)) {
        findings.push({ location: loc(unit, m.name, d.line), detail: `heuristic: numeric-suffix name '${d.name}' (data1/data2 pattern) — name by role, not sequence` });
      }
    }
  }
  return { ruleId: 'N2', findings, confidence: 'low' };
}

// ── N4 — magic numbers ─────────────────────────────────────────────────────
// architecture-toolkit's real check (naming-validator.ts:139, `\b\d{2,}\b`
// at a >3-occurrence threshold) is whole-file text and blind to declaration
// context — it cannot tell a bare `86400` from a `const DAY_MS = 86400`.
// Our AST version reads `magicNumbers` computed in typescript.mjs, which
// already excludes 0/1/-1 and any literal that IS the direct initializer of
// a `const` or an enum member — the exact context distinction a regex can't
// make. Findings are the raw fact list; this function just packages them.
export function n4MagicNumbers(unit) {
  const findings = [];
  for (const m of unit.members) {
    for (const n of m.magicNumbers ?? []) {
      findings.push({ location: loc(unit, m.name, n.line), detail: `magic number ${n.value} used outside a const/enum declaration` });
    }
  }
  return { ruleId: 'N4', findings, confidence: 'high' };
}

// ── N7 — generic class/function names ──────────────────────────────────────
// architecture-toolkit's real check at naming-validator.ts:219
// (`/class\s+(Manager|Processor|Data|Info)\b/`) matches only the WHOLE class
// name, prefix position, and only 4 words. Our task spec's word list is
// {Manager, Handler, Processor, Helper, Util} and explicitly wants the SOLE
// SUFFIX form too (e.g. `UserDataManager`), so this extends their mechanism
// (name-against-known-set) rather than reusing the regex verbatim.
const GENERIC_NAME_WORDS = ['Manager', 'Handler', 'Processor', 'Helper', 'Util'];
function isGenericName(name) {
  return GENERIC_NAME_WORDS.some((w) => name === w || name.endsWith(w));
}

export function n7GenericNames(unit) {
  const findings = [];
  if (unit.kind === 'class' && isGenericName(unit.name)) {
    findings.push({ location: unit.name, detail: `generic class name '${unit.name}' (whole name or sole suffix is a generic word)` });
  }
  for (const m of unit.members) {
    if (isGenericName(m.name)) {
      findings.push({ location: loc(unit, m.name), detail: `generic function/method name '${m.name}' (whole name or sole suffix is a generic word)` });
    }
  }
  return { ruleId: 'N7', findings, confidence: 'high' };
}

// ── F1 — long methods (over 20 statements) ─────────────────────────────────
// Corroborated, not just copied: architecture-toolkit's real threshold at
// function-validator.ts:52 (`if (avgLinesPerFunction > 20)`) independently
// lands on the SAME number our task spec names, for lines-per-function
// rather than statement count. Their metric is an average over the whole
// file (blind to which specific function is long); ours is per-member and
// counts real statement nodes (flattened across nesting), so a 21-statement
// method is named directly instead of averaged away by short neighbors.
export function f1LongMethods(unit) {
  const findings = [];
  for (const m of unit.members) {
    if ((m.statementCount ?? 0) > 20) {
      findings.push({ location: loc(unit, m.name), detail: `${m.statementCount} statements (over 20)` });
    }
  }
  return { ruleId: 'F1', findings, confidence: 'high' };
}

// ── F2 — too many parameters (over 3) ──────────────────────────────────────
// Exact match to architecture-toolkit's real threshold at
// function-validator.ts:82 (`if (paramCount > 3)`). `paramCount` is already
// part of the base NormalizedMember contract (solid-scoring.mjs's ISP reads
// the same field) — no new fact needed here.
export function f2TooManyParams(unit) {
  const findings = [];
  for (const m of unit.members) {
    if (m.paramCount > 3) {
      findings.push({ location: loc(unit, m.name), detail: `${m.paramCount} parameters (over 3)` });
    }
  }
  return { ruleId: 'F2', findings, confidence: 'high' };
}

// ── E1 — empty catch blocks ─────────────────────────────────────────────────
// Exact match to architecture-toolkit's real pattern at
// code-smell-validator.ts:160 (`/catch\s*\([^)]+\)\s*{\s*}/i`). AST form is
// strictly stronger: a comment-only catch block (`catch(e) { /* ignore */ }`)
// is exactly as silent as a truly empty one but does NOT match their regex
// (comment text isn't whitespace); the AST's statement count is 0 either way.
export function e1EmptyCatchBlocks(unit) {
  const findings = [];
  for (const m of unit.members) {
    for (const c of m.emptyCatches ?? []) {
      findings.push({ location: loc(unit, m.name, c.line), detail: 'empty catch block — exception swallowed silently' });
    }
  }
  return { ruleId: 'E1', findings, confidence: 'high' };
}

// ── G9 — dead code (two independent halves) ────────────────────────────────
// architecture-toolkit's ACTUAL G9 (code-smell-validator.ts:115,
// `/if\s*\(\s*false\s*\)|if\s*\(\s*true\s*\)/`) is constant-conditional
// UNREACHABLE code — a different sub-smell than the unused-EXPORT dead code
// this repo's own clean-code-analyzer/SKILL.md already specced under the
// same G9 id. Both are legitimate readings of Clean Code's G9 "Dead Code"
// chapter, so this ships BOTH:
//   - unreachable half: `deadConditionals` (if(true)/if(false)/while(false)),
//     computed per-member in typescript.mjs, always measured.
//   - unused-export half: `deadExportsFacts`, computed by the OPTIONAL
//     plugin.deadExportsOf(filePath, projectFilePaths) — a REAL cross-file
//     reference-graph walk (ts-morph findReferencesAsNodes), not a text grep.
//     Pass `[]` (the default) when that scan hasn't been run; this function
//     never treats "wasn't scanned" as "found nothing" — confidence drops to
//     'medium' and says so, rather than silently reporting zero findings for
//     unmeasured evidence.
//
// POSITIVE CONTROL is the caller's responsibility (see
// scripts/clean-code-score.mjs): before trusting any `referenceCount === 0`
// finding from a `deadExportsOf` scan, confirm a KNOWN-used export in the
// same scan comes back non-zero. A scan that returns zero for everything is
// broken, not a clean project.
export function g9DeadCode(unit, deadExportsFacts = []) {
  const findings = [];
  for (const m of unit.members) {
    for (const dc of m.deadConditionals ?? []) {
      findings.push({ location: loc(unit, m.name, dc.line), detail: `unreachable code — constant-conditional '${dc.kind}' never takes the live branch` });
    }
  }
  for (const f of deadExportsFacts) {
    if (f.referenceCount === 0) {
      findings.push({ location: loc(unit, f.name, f.line), detail: `exported '${f.name}' has zero reference sites anywhere in the scanned project — dead export` });
    }
    // referenceCount === -1 ("declaration kind unsupported by the reference
    // finder") is deliberately NOT reported as a finding — see DeadExportFact
    // in language-plugin.mjs. It is neither used nor unused; it is unmeasured.
  }
  return { ruleId: 'G9', findings, confidence: deadExportsFacts.length ? 'high' : 'medium' };
}

/**
 * @param {import('./language-plugin.mjs').NormalizedUnit} unit
 * @param {import('./language-plugin.mjs').DeadExportFact[]|null} deadExportsFacts
 *   Pass the result of `plugin.deadExportsOf(filePath, projectFilePaths)` when
 *   available; omit (or pass `null`) to score everything except G9's
 *   unused-export half, which then reports at 'medium' confidence using only
 *   its unreachable-code half.
 */
export function cleanCodeScore(unit, deadExportsFacts = null) {
  const rules = {
    n1: n1CrypticNames(unit),
    n2: n2MeaninglessNames(unit),
    n4: n4MagicNumbers(unit),
    n7: n7GenericNames(unit),
    f1: f1LongMethods(unit),
    f2: f2TooManyParams(unit),
    e1: e1EmptyCatchBlocks(unit),
    g9: g9DeadCode(unit, deadExportsFacts ?? []),
  };
  const totalFindings = Object.values(rules).reduce((n, r) => n + r.findings.length, 0);
  return { unit: unit.name, kind: unit.kind, rules, totalFindings, notImplemented: NOT_IMPLEMENTED };
}
