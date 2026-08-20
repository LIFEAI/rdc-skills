/**
 * Test-smell scoring — T1/T2/T5/T6/T7/T8/T9 plus F.I.R.S.T "Independent",
 * operating on TEST FILES (`.test.mjs` / `.test.ts` / `*.spec.*`).
 *
 * Language-independent in shape, same discipline as language-plugin.mjs and
 * solid-scoring.mjs: every exported check here is a PURE function over TEXT
 * FACTS — a test file's source text, plus (for T1 only) an externally
 * supplied exported-member count. Nothing in this file imports ts-morph or
 * any language-specific parser. Where a check genuinely needs an AST fact
 * (T1's "N exported functions/methods" on the SOURCE file under test), the
 * caller supplies it via the SAME `NormalizedUnit` contract solid-score.mjs
 * already uses (see language-plugin.mjs) — never reimplemented in this file,
 * and typescript.mjs / language-plugin.mjs are untouched by this change.
 *
 * ── Reuse provenance ────────────────────────────────────────────────────
 * T1/T2/T5/T6/T7/T8/T9 rule IDs, names, and several thresholds are reused
 * from OnSightTeam/architecture-toolkit (MIT), commit `main` as fetched
 * 2026-08-20, `src/agents/testing-strategy/tools/test-quality-validator.ts`:
 *   - T1 Insufficient Tests   — checkInsufficientTests, lines 47-65
 *   - T2 Ignored Test         — checkIgnoredTests, lines 67-85 (`xit|it.skip|test.skip`)
 *   - T5 Exhaustive Testing   — checkExhaustiveTesting, lines 127-145 (threshold: 10)
 *   - T6 Long Tests           — checkLongTests, lines 147-171 (threshold: 30 lines)
 *   - T7 Slow Tests           — checkSlowTests, lines 173-190 (`setTimeout|sleep|delay`)
 *   - T8 Fragile Tests        — checkFragileTests, lines 192-219 (`new Date()|Math.random()|process.env`)
 *   - T9 Test Code Duplication— checkTestCodeDuplication, lines 221-240 (setup-duplication concept)
 * F.I.R.S.T "Independent" is reused from the same repo's
 * `first-principles-validator.ts` checkIndependent (lines 71-107, shared
 * mutable state as the Independent-violation signal) and
 * `test-independence-validator.ts` checkSharedMutableState (lines 42-70,
 * "top-level `let` = shared-state risk").
 *
 * Every reused check below is ADAPTED, not copied verbatim, because the
 * reference implementation's block/line extraction is a non-greedy regex
 * (`/\b(test|it)\s*\([^{]*{([^}]*)}/gs`) that cannot balance nested braces —
 * it breaks on the first `}` inside any if/for/object literal in a test
 * body, which is most real tests. This file replaces that with an actual
 * brace-balanced scanner (`scanBalanced`) that tracks string/template/
 * comment context, so line counts and assertion counts are measured against
 * the REAL test body, not a regex's best guess at one. Where a threshold
 * carries over unchanged (T5's 10, T6's 30), that is a deliberate reuse,
 * cited above; where the scope changed (T1 per-file→paired-file, T7/T8
 * file-wide-count→per-block presence, T9 same-file-literal→cross-file
 * structural), the deviation and reason are in each function's docstring.
 *
 * ── Skipped ─────────────────────────────────────────────────────────────
 * T3 (Test Per Class) and T4 (Untested Method) are the reference's weakest
 * checks even in their own repo — T3 keys off a `describe()` block count
 * that has no reliable meaning across test runners (node:test files in this
 * fleet mostly don't use `describe` at all; see dogfood evidence), and T4 is
 * a *coverage-gap* guess from a raw exported-vs-test ratio that duplicates
 * T1's actual measurement without adding a new fact. Faking either here
 * would be exactly the "weak check invented to fill a slot" this task said
 * to avoid. FIRST's Fast/Repeatable/SelfValidating/Timely are also skipped:
 * Fast and Repeatable are already fully covered by this file's T7 (slow
 * calls) and T8 (fragile/non-deterministic references) — a second AST-only
 * check would just re-flag the same regex hits under a different label.
 * SelfValidating ("has an assertion") and Timely ("has a paired test file")
 * are not test-SMELL checks at all in the sense this task asked for — they
 * are presence/absence checks with no meaningful mechanical signal beyond
 * "count is zero", which is already reported structurally by T1.
 */

import { relative } from 'node:path';

// ── text-fact primitives ────────────────────────────────────────────────

/**
 * Balanced-bracket scan from `openIdx` (where `text[openIdx] === openChar`)
 * to the matching close, skipping over string/template literals and
 * comments so brace/paren counting inside real code doesn't miscount on a
 * `'{'` or `'('` that appears inside a string. Returns the index of the
 * matching close char, or -1 if the text ends unbalanced.
 */
function scanBalanced(text, openIdx, openChar, closeChar) {
  let depth = 0;
  let i = openIdx;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i, ch); continue; }
    if (ch === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); if (nl === -1) return -1; i = nl + 1; continue; }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); if (end === -1) return -1; i = end + 2; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/** Skip a string/template literal starting at `i` (text[i] === quote). Handles `${...}` nesting in template literals. */
function skipString(text, i, quote) {
  i++;
  const n = text.length;
  while (i < n) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === quote) return i + 1;
    if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
      const close = scanBalanced(text, i + 1, '{', '}');
      i = close === -1 ? n : close + 1;
      continue;
    }
    i++;
  }
  return i;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Find every `test(...)` / `it(...)` call (optionally `.skip`/`.only`/`.todo`
 * modified) at any nesting depth, with its title, skip flag, and — if the
 * callback has a block body (`() => { ... }` or `function () { ... }`) —
 * that body's exact text span. A callback with an expression body (no `{}`,
 * e.g. `it('x', () => expect(f()).toBe(1))`) has `body: null`; T5/T6/T7/T8/
 * Independent all treat `body: null` as "nothing to measure", not a smell,
 * since there is no assertion/line/call count to read without a body.
 */
export function findTestBlocks(text) {
  const blocks = [];
  const callRe = /\b(test|it)(\.\w+)?\s*\(/g;
  let m;
  while ((m = callRe.exec(text))) {
    const kind = m[1];
    const modifier = m[2] ? m[2].slice(1) : null;
    const openParen = m.index + m[0].length - 1;
    const closeParen = scanBalanced(text, openParen, '(', ')');
    if (closeParen === -1) continue;
    const callText = text.slice(m.index, closeParen + 1);

    const titleMatch = /^\s*['"`]([^'"`]*)['"`]/.exec(callText.slice(m[0].length));
    const title = titleMatch ? titleMatch[1] : null;

    const body = extractCallbackBody(callText);
    blocks.push({
      kind, modifier, title,
      skipped: modifier === 'skip' || modifier === 'todo',
      start: m.index, end: closeParen + 1,
      startLine: lineOf(text, m.index), endLine: lineOf(text, closeParen),
      body: body ? {
        text: body.text,
        // absolute offsets back in the ORIGINAL text, not callText
        start: m.index + body.start + 1,
        end: m.index + body.end,
      } : null,
    });
    callRe.lastIndex = closeParen + 1;
  }
  return blocks;
}

/** Locate the callback's block body `{...}` inside one `test(...)`/`it(...)` call's full text. */
function extractCallbackBody(callText) {
  const arrowIdx = callText.indexOf('=>');
  const funcMatch = /\bfunction\b/.exec(callText);
  const funcIdx = funcMatch ? funcMatch.index : -1;
  let searchFrom;
  if (arrowIdx !== -1 && (funcIdx === -1 || arrowIdx < funcIdx)) searchFrom = arrowIdx + 2;
  else if (funcIdx !== -1) searchFrom = funcIdx;
  else return null;

  const braceIdx = callText.indexOf('{', searchFrom);
  if (braceIdx === -1) return null;
  // Reject a `{` that belongs to an object literal before any `{` truly
  // opens the block — e.g. `() => ({ ok: true })`. A block body's `{` is
  // never preceded by `(` with no intervening non-whitespace back to `=>`.
  const between = callText.slice(searchFrom, braceIdx);
  if (/\(\s*$/.test(between)) return null;
  const closeIdx = scanBalanced(callText, braceIdx, '{', '}');
  if (closeIdx === -1) return null;
  return { start: braceIdx, end: closeIdx, text: callText.slice(braceIdx + 1, closeIdx) };
}

// ── T1 — Insufficient Tests ─────────────────────────────────────────────
// Reused: test-quality-validator.ts:47-65 (checkInsufficientTests). The
// reference compares testCount to `publicMethods * 0.5` using a Java/C#-
// shaped `\bpublic\s+\w+\s*\(` regex that matches nothing in JS/TS. This
// task's spec is explicit and stricter: "fewer than N corresponding test()
// blocks" for N exported functions/methods — so the multiplier is dropped
// and the comparison is a direct testCount < exportedUnitCount, sourced from
// the SAME NormalizedUnit contract solid-score.mjs already uses (never a
// hand-rolled `public` regex).
/**
 * @param {ReturnType<typeof findTestBlocks>} testBlocks
 * @param {number|null} exportedUnitCount - public member/function count from
 *   the paired SOURCE file's NormalizedUnit[] (see countExportedUnits below).
 *   null means "no source file could be paired" — T1 is unmeasured, not clean.
 */
export function checkInsufficientTests(testBlocks, exportedUnitCount) {
  if (exportedUnitCount == null) return null;
  const measured = testBlocks.filter((b) => !b.skipped).length;
  if (exportedUnitCount === 0) return null; // nothing exported to require coverage for
  if (measured < exportedUnitCount) {
    return {
      ruleId: 'T1', severity: 'high',
      description: `T1 Insufficient Tests — ${measured} test() block(s) for ${exportedUnitCount} exported function(s)/method(s) in the paired source file`,
      recommendation: 'Add tests until every exported function/method has at least one corresponding test() block.',
      line: 1,
    };
  }
  return null;
}

// ── T2 — Ignored Tests ──────────────────────────────────────────────────
// Reused: test-quality-validator.ts:67-85. Reference pattern
// `xit|it\.skip|test\.skip|@Ignore` (the `@Ignore` decorator is a JUnit
// idiom, dropped as not applicable to JS/TS). Spec adds `xdescribe`.
export function checkIgnoredTests(text, testBlocks) {
  const findings = [];
  for (const b of testBlocks) {
    if (b.skipped) {
      findings.push({
        ruleId: 'T2', severity: 'medium', line: b.startLine,
        description: `T2 Ignored Test — ${b.kind}.${b.modifier}('${b.title ?? '?'}')`,
        recommendation: 'Either fix and enable the skipped test or delete it — a skipped test provides no coverage but reads as if it does.',
      });
    }
  }
  const xdescribeRe = /\bxdescribe\s*\(\s*['"`]([^'"`]*)['"`]/g;
  let m;
  while ((m = xdescribeRe.exec(text))) {
    findings.push({
      ruleId: 'T2', severity: 'medium', line: lineOf(text, m.index),
      description: `T2 Ignored Test — xdescribe('${m[1]}') disables its entire suite`,
      recommendation: 'Either fix and enable the suite or delete it.',
    });
  }
  return findings;
}

// ── T5 — Exhaustive Testing ─────────────────────────────────────────────
// Reused: test-quality-validator.ts:127-145, threshold 10 kept as-is (it's
// the same number Robert C. Martin's original T5 write-up in "Clean Code"
// uses for "too many assert calls in one test" — a single test asserting
// more than ~10 distinct facts is usually testing more than one behavior).
// Reference measures the FILE-WIDE average (expectCount/testCount); this
// measures PER-BLOCK count, because a file average of 10 hides one 40-
// assertion test sitting next to nine 1-assertion tests — the actual T5
// smell is about ONE test doing too much, not the file's mean.
const ASSERT_CALL_RE = /\b(?:assert(?:\.\w+)?|expect|should)\s*\(/g;
export function checkExhaustiveTesting(testBlocks, threshold = 10) {
  const findings = [];
  for (const b of testBlocks) {
    if (!b.body) continue;
    const count = (b.body.text.match(ASSERT_CALL_RE) ?? []).length;
    if (count > threshold) {
      findings.push({
        ruleId: 'T5', severity: 'medium', line: b.startLine,
        description: `T5 Exhaustive Testing — ${b.kind}('${b.title ?? '?'}') has ${count} assertion calls (threshold: >${threshold})`,
        recommendation: 'Split this test into focused tests, one behavior each.',
      });
    }
  }
  return findings;
}

// ── T6 — Long Tests ──────────────────────────────────────────────────────
// Reused: test-quality-validator.ts:147-171, threshold 30 lines kept as-is.
export function checkLongTests(testBlocks, threshold = 30) {
  const findings = [];
  for (const b of testBlocks) {
    if (!b.body) continue;
    const lines = b.body.text.split('\n').length;
    if (lines > threshold) {
      findings.push({
        ruleId: 'T6', severity: 'medium', line: b.startLine,
        description: `T6 Long Tests — ${b.kind}('${b.title ?? '?'}') body is ${lines} lines (threshold: >${threshold})`,
        recommendation: 'Extract setup to beforeEach/helper functions; keep the test body to the behavior under test.',
      });
    }
  }
  return findings;
}

// ── T7 — Slow Tests ──────────────────────────────────────────────────────
// Reused: test-quality-validator.ts:173-190 (`setTimeout|sleep|delay`
// indicator names). Reference flags the FILE when count > 2; this task asks
// for "literal setTimeout/sleep/hardcoded delay calls inside a test" with
// no stated minimum, so it is adapted to per-block presence (>=1) — any
// literal timer call inside a unit test body is a real smell regardless of
// how many others are in the file.
const SLOW_CALL_RE = /\b(setTimeout|setInterval|sleep|delay)\s*\(/g;
export function checkSlowTests(testBlocks) {
  const findings = [];
  for (const b of testBlocks) {
    if (!b.body) continue;
    const hits = b.body.text.match(SLOW_CALL_RE);
    if (hits && hits.length) {
      findings.push({
        ruleId: 'T7', severity: 'high', line: b.startLine,
        description: `T7 Slow Tests — ${b.kind}('${b.title ?? '?'}') calls ${[...new Set(hits.map((h) => h.replace(/\s*\($/, '')))].join(', ')} directly`,
        recommendation: 'Use a fake/mocked clock or an event-driven wait instead of a literal timer/delay call.',
      });
    }
  }
  return findings;
}

// ── T8 — Fragile Tests ───────────────────────────────────────────────────
// Reused: test-quality-validator.ts:192-219 (`new Date()|Math.random()|
// process.env`), also cross-referenced against first-principles-validator's
// checkRepeatable (lines 109-133), same pattern family. Reference flags the
// FILE when total count > 3; adapted to per-block presence (>=1) for the
// same reason as T7 — a single `Date.now()` inside one test is already
// non-deterministic, no threshold needed. `Date.now()` is added per this
// task's spec (the reference only checks bare `new Date()`).
const FRAGILE_PATTERNS = [
  { re: /\bDate\.now\s*\(\s*\)/g, label: 'Date.now()' },
  { re: /\bnew\s+Date\s*\(\s*\)/g, label: 'new Date() with no args' },
  { re: /\bMath\.random\s*\(\s*\)/g, label: 'Math.random()' },
  { re: /\bprocess\.env\.\w+/g, label: 'process.env.*' },
];
export function checkFragileTests(testBlocks) {
  const findings = [];
  for (const b of testBlocks) {
    if (!b.body) continue;
    const hitLabels = [];
    for (const { re, label } of FRAGILE_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(b.body.text)) hitLabels.push(label);
    }
    if (hitLabels.length) {
      findings.push({
        ruleId: 'T8', severity: 'high', line: b.startLine,
        description: `T8 Fragile Tests — ${b.kind}('${b.title ?? '?'}') references ${hitLabels.join(', ')} directly`,
        recommendation: 'Inject a fixed clock/seeded RNG/explicit config instead of reading real time, randomness, or env vars inside a test.',
      });
    }
  }
  return findings;
}

// ── T9 — Duplicated Setup (cross-file) ──────────────────────────────────
// Reused CONCEPT only: test-quality-validator.ts:221-240 checks literal
// `const x = new Y` duplication WITHIN one file via exact-string Set dedup.
// This task's spec is explicitly a different, harder check: near-identical
// beforeEach/setup blocks ACROSS MULTIPLE test files, "structural
// similarity, not exact string match". The reference's exact-match approach
// cannot do that at all (two setups differing only by a variable name or a
// literal value are, structurally, the same duplication and would be missed
// by exact string comparison) — so the comparator below is new, built to
// satisfy the spec's explicit requirement, not adapted from their code.
//
// Similarity heuristic: normalize each candidate block by stripping
// comments, collapsing every string/template literal to `STR` and every
// numeric literal to `NUM` (so two setups differing only in a fixture path
// or a port number still compare equal), then compare as a SET of
// contiguous 3-token shingles (Jaccard index). Token-set shingling is
// chosen over a raw string/Levenshtein diff because it is order-tolerant
// for small local reorderings (e.g. two `beforeEach`s that create the same
// three fixtures in a different order) while still requiring genuine
// structural overlap — a shuffled-but-unrelated block scores low because
// its 3-grams don't line up. Threshold 0.75 chosen so accidental overlap
// (e.g. two setups that both just do `const h = new Harness(...)`) doesn't
// swamp real duplication; the reference's own bar for "smell" (ratio > 2 in
// their file-local check) was structurally different so does not transfer.

function normalizeForStructuralCompare(codeText) {
  return codeText
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, 'STR')
    .replace(/\b\d+(\.\d+)?\b/g, 'NUM');
}

function tokenize(text) {
  return (text.match(/[A-Za-z_$][\w$]*|[^\sA-Za-z_$]/g) ?? []);
}

function shingles(tokens, n = 3) {
  const set = new Set();
  for (let i = 0; i + n <= tokens.length; i++) set.add(tokens.slice(i, i + n).join('\u0001'));
  return set;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Every `beforeEach(...)` / `beforeAll(...)` call's block body in one file, as setup candidates for T9. */
export function findSetupBlocks(text) {
  const out = [];
  const re = /\b(beforeEach|beforeAll)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = scanBalanced(text, openParen, '(', ')');
    if (closeParen === -1) continue;
    const callText = text.slice(m.index, closeParen + 1);
    const body = extractCallbackBody(callText);
    if (body && body.text.trim()) {
      out.push({ kind: m[1], startLine: lineOf(text, m.index), text: body.text });
    }
    re.lastIndex = closeParen + 1;
  }
  return out;
}

/**
 * @param {{file: string, setupBlocks: ReturnType<typeof findSetupBlocks>}[]} files
 * @returns findings for every cross-file setup-block pair scoring >= threshold
 */
export function checkDuplicatedSetupAcrossFiles(files, threshold = 0.75) {
  const findings = [];
  const candidates = [];
  for (const f of files) {
    for (const s of f.setupBlocks) {
      const tokens = tokenize(normalizeForStructuralCompare(s.text));
      if (tokens.length < 6) continue; // too small to compare meaningfully
      candidates.push({ file: f.file, startLine: s.startLine, shingleSet: shingles(tokens) });
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (a.file === b.file) continue; // same-file duplication is a different, T9-adjacent question the reference already covers within one file
      const sim = jaccard(a.shingleSet, b.shingleSet);
      if (sim >= threshold) {
        findings.push({
          ruleId: 'T9', severity: 'medium',
          description: `T9 Duplicated Setup — beforeEach/beforeAll at ${a.file}:${a.startLine} and ${b.file}:${b.startLine} are ${(sim * 100).toFixed(0)}% structurally similar`,
          recommendation: 'Extract the shared setup into one factory/helper both test files import.',
          locations: [{ file: a.file, line: a.startLine }, { file: b.file, line: b.startLine }],
          similarity: sim,
        });
      }
    }
  }
  return findings;
}

// ── FIRST — Independent ──────────────────────────────────────────────────
// Reused CONCEPT: first-principles-validator.ts:71-107 checkIndependent
// (shared mutable state → Independent violation) and
// test-independence-validator.ts:42-70 checkSharedMutableState ("top-level
// `let` = shared-state risk"). Both reference checks stop at PRESENCE —
// "there exist > N top-level `let`s" or "a `let`-with-comment-'shared'" —
// which flags files with harmless outer `let`s that are declared once and
// read, never mutated, by more than one test (a false positive the spec's
// exact wording avoids: "declared outside test() AND mutated inside more
// than one test() block"). This implementation requires BOTH halves: the
// declaration site is outside every test() body span, AND an assignment
// (not just a read) to that name is found inside 2+ DISTINCT test() bodies.
const MUTATION_RE_FOR = (name) => new RegExp(
  `\\b${name}\\s*(?:=[^=]|\\+\\+|--|\\+=|-=|\\*=|\\/=|%=)`,
);

export function checkIndependentSharedState(text, testBlocks) {
  const findings = [];
  const letRe = /\blet\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/g;
  let m;
  const seen = new Set();
  while ((m = letRe.exec(text))) {
    const name = m[1];
    if (seen.has(name)) continue;
    // Declared inside some test() body — that's fine, local to one test.
    const insideATest = testBlocks.some((b) => b.body && m.index >= b.body.start && m.index < b.body.end);
    if (insideATest) continue;
    seen.add(name);

    const mutRe = MUTATION_RE_FOR(name);
    const mutatingBlocks = testBlocks.filter((b) => b.body && mutRe.test(b.body.text));
    if (mutatingBlocks.length > 1) {
      findings.push({
        ruleId: 'FIRST-Independent', severity: 'critical', line: lineOf(text, m.index),
        description: `FIRST Independent — '${name}' is declared outside test() and mutated inside ${mutatingBlocks.length} separate test() blocks (${mutatingBlocks.map((b) => `'${b.title ?? '?'}'`).join(', ')})`,
        recommendation: `Move '${name}' into a beforeEach() reset or declare it fresh inside each test — a variable mutated by one test and read by the next makes execution order load-bearing.`,
      });
    }
  }
  return findings;
}

// ── source-file pairing for T1 ──────────────────────────────────────────

/**
 * Sum of `isPublic` members across a source file's NormalizedUnit[] — "N
 * exported functions/methods" per the language-plugin.mjs contract. Callers
 * supply `units` (already extracted via whatever LanguagePlugin claimed the
 * source file) rather than this file resolving a plugin itself, so this
 * module never needs to import language-plugin.mjs's registry machinery —
 * it only needs the shape, keeping the "no language-specific parser here"
 * invariant intact even for this one AST-sourced fact.
 * @param {import('./language-plugin.mjs').NormalizedUnit[]} units
 */
export function countExportedUnits(units) {
  if (!units || !units.length) return null;
  return units.reduce((sum, u) => sum + u.members.filter((m) => m.isPublic).length, 0);
}

/** Guess a source file path from a test file path: `foo.test.mjs` → `foo.mjs`, `test/x.test.ts` → `src/x.ts`, etc. Best-effort; callers may override. */
export function guessSourceFilePath(testFilePath) {
  const stripped = testFilePath.replace(/\.(test|spec)\.(m?[jt]sx?)$/, '.$2');
  return stripped.replace(/[\\/](test|tests|__tests__|spec)[\\/]/, (m) => m.replace(/test|tests|__tests__|spec/, 'src'));
}

// ── per-file orchestration ───────────────────────────────────────────────

/**
 * Extract every text fact one test file needs for T1-T9/Independent, ONCE,
 * so scoring a file never re-scans it per rule.
 */
export function extractTestFileFacts(text) {
  const testBlocks = findTestBlocks(text);
  const setupBlocks = findSetupBlocks(text);
  return { testBlocks, setupBlocks };
}

/**
 * Score a single test file's single-file-scope smells (everything except
 * T9, which is inherently cross-file — see checkDuplicatedSetupAcrossFiles).
 * @param {string} text - the test file's source text
 * @param {object} [opts]
 * @param {number|null} [opts.exportedUnitCount] - see checkInsufficientTests
 */
export function scoreTestFile(text, opts = {}) {
  const facts = extractTestFileFacts(text);
  const findings = [
    ...(checkInsufficientTests(facts.testBlocks, opts.exportedUnitCount ?? null) ? [checkInsufficientTests(facts.testBlocks, opts.exportedUnitCount ?? null)] : []),
    ...checkIgnoredTests(text, facts.testBlocks),
    ...checkExhaustiveTesting(facts.testBlocks),
    ...checkLongTests(facts.testBlocks),
    ...checkSlowTests(facts.testBlocks),
    ...checkFragileTests(facts.testBlocks),
    ...checkIndependentSharedState(text, facts.testBlocks),
  ];
  return { testBlockCount: facts.testBlocks.length, skippedCount: facts.testBlocks.filter((b) => b.skipped).length, findings };
}

// ── CLI (dogfooding entry point) ─────────────────────────────────────────
// Usage: node test-smell-scoring.mjs <file-or-dir> [--repo-root <dir>]

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, resolve } = await import('node:path');

  function walkTestFiles(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkTestFiles(full, out);
      else if (/\.(test|spec)\.(m?[jt]sx?)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const target = resolve(process.cwd(), process.argv[2] ?? '.');
  const repoRootArgIdx = process.argv.indexOf('--repo-root');
  const repoRoot = repoRootArgIdx !== -1 ? resolve(process.cwd(), process.argv[repoRootArgIdx + 1]) : process.cwd();

  const files = statSync(target).isDirectory() ? walkTestFiles(target) : [target];
  const perFile = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const result = scoreTestFile(text);
    const setupBlocks = findSetupBlocks(text);
    perFile.push({ file: relative(repoRoot, f).split('\\').join('/'), text, ...result, setupBlocks });
  }

  let totalFindings = 0;
  for (const pf of perFile) {
    for (const f of pf.findings) {
      totalFindings++;
      console.log(`${pf.file}:${f.line}  ${f.description}`);
    }
  }
  const t9 = checkDuplicatedSetupAcrossFiles(perFile.map((pf) => ({ file: pf.file, setupBlocks: pf.setupBlocks })));
  for (const f of t9) {
    totalFindings++;
    console.log(`${f.description}`);
  }
  console.log(`\n${files.length} test file(s) scanned, ${totalFindings} finding(s).`);
  process.exit(0);
}
