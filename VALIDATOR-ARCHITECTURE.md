# Validator — Architecture

## Third-party attribution

| Package | License (verified) | What we took from it |
|---|---|---|
| [OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit) | MIT (verified via its `package.json` `license` field + repo README `## License` section — the repo's root `LICENSE` file itself was not independently fetched this session) | Real detection logic, thresholds, and rule IDs for Steps 1–7 below, ported/adapted from its actual TypeScript source under `src/agents/*/tools/*.ts` (not reimplemented from a description) |
| [ts-morph](https://github.com/dsherret/ts-morph) `24.0.0` | MIT (verified: `node_modules/ts-morph/package.json`) | The AST layer for the TypeScript/JavaScript `LanguagePlugin` (`scripts/lib/plugins/typescript.mjs`) — still the backend for Clean Code, Patterns, and Refactoring this pass; see "AST parser — CLOSED" below for the SOLID swap to tree-sitter |
| [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) `0.24.7` | MIT (verified: `node_modules/web-tree-sitter/package.json`) | The tree-sitter WASM runtime bindings for `scripts/lib/plugins/treesitter.mjs` — SOLID's default AST layer as of this pass |
| [tree-sitter-wasms](https://www.npmjs.com/package/tree-sitter-wasms) `0.1.13` | **Unlicense** (verified: `node_modules/tree-sitter-wasms/package.json` — public domain, NOT MIT) | Pre-built WASM grammar assets (TypeScript, TSX, JavaScript) consumed by `treesitter.mjs` |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) `1.30.0` | MIT (verified: `node_modules/@modelcontextprotocol/sdk/package.json`) | MCP server transport, unrelated to the scoring logic itself |
| [zod](https://github.com/colinhacks/zod) `3.25.76` | MIT (verified) | Input validation elsewhere in this repo's skill tooling |
| [express](https://github.com/expressjs/express) `5.2.1` | MIT (verified) | HTTP transport for `rdc-skills-mcp`, unrelated to the scoring logic |
| [yaml](https://github.com/eemeli/yaml) `2.9.0` | **ISC** (verified — NOT MIT, corrected here) | YAML parsing elsewhere in this repo's skill tooling |

**Explicitly evaluated but NOT used** (their algorithms/prior-art informed design decisions below; no code or dependency taken):
[jscpd](https://github.com/kucherenko/jscpd), PMD [CPD](https://pmd.github.io/pmd/pmd_userdocs_cpd.html), [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser).

## What it is

A deterministic code-analysis suite covering SOLID, Clean Code, Clean
Architecture, package design, testing strategy, design patterns,
refactoring opportunities, and duplicate-code detection. Eight CLIs, zero
LLM calls inside any of them. Seven are ported from
[OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)
(MIT) — their own project structure is 7 top-level agent folders under
`src/agents/`, and their own `.claude/skills/*.md` are thin wrappers around
`node dist/cli.js --agents=<name>`, no LLM in their loop either. This suite
matches that shape: one folder of pure functions per domain, one CLI per
domain, real detection logic ported from their real TypeScript source (not
reimplemented from a description of it), each independently dogfooded
against real code before being called done.

Four judgment calls remain genuinely un-mechanizable and stay routed to an
LLM reviewer (`pr-review-toolkit:code-reviewer`, or a Codex peer via
`rdc:co-develop`) — listed at the bottom of this document, not hidden inside
the tool tables.

## Shared contract

Four tools (SOLID, Clean Code, Patterns, Refactoring) read from one shape:
`NormalizedUnit` / `NormalizedMember`, defined in
[`scripts/lib/language-plugin.mjs`](scripts/lib/language-plugin.mjs). Two
plugins produce that shape for TypeScript/JavaScript today:
[`scripts/lib/plugins/typescript.mjs`](scripts/lib/plugins/typescript.mjs)
(ts-morph — the ONE file in this repo allowed to import it) and
[`scripts/lib/plugins/treesitter.mjs`](scripts/lib/plugins/treesitter.mjs)
(the fleet's own tree-sitter parser, ported from CodeFlow's
`nativeParser.ts` — see "AST parser — CLOSED" below). SOLID defaults to the
tree-sitter plugin (`--parser` selects either); Clean Code, Patterns, and
Refactoring still default to ts-morph this pass. Every scoring file
downstream of either plugin is pure functions over the shared shape; none of
them touch an AST directly. This is what "language independent" means in
practice: adding a Python or Go plugin that emits the same `NormalizedUnit`
shape makes all four of those tools work on that language with zero changes
to the scoring logic itself.

Three tools (Package Design, Architecture, Duplicate Code) are deliberately
NOT built on this contract — they operate on file paths, import statements,
or raw token streams, which a plain text/regex scan answers as correctly as
an AST would, so they carry no `ts-morph` dependency at all and work on any
language whose imports look like ES/CJS syntax (Package Design, Architecture)
or whose source can be tokenized at all (Duplicate Code — see Step 8).

All 8 CLIs support `--format json`, are proven deterministic (identical
output across two runs on the same unchanged input — no timestamps, no
absolute paths, sorted finding arrays), and are registered as global bins in
`package.json`.

---

## Step 1 — SOLID

| | |
|---|---|
| **Call** | `rdc-solid-score <path> [--diff <ref>] [--config <file>]` |
| **Input** | file or directory path; optional git ref to score a diff; optional boundary-check config |
| **Script** | [`scripts/lib/solid-scoring.mjs`](scripts/lib/solid-scoring.mjs), CLI in [`scripts/solid-score.mjs`](scripts/solid-score.mjs) |
| **Algorithm** | SRP: union-find over shared `this.field`/method-to-method access, connected-component count. OCP: switch/instanceof/type-check density per member. LSP: override signature, super-call presence, return-type drift vs. base class. ISP: public-member count + average param count. DIP: ratio of concrete `new X()` instantiation vs. injected/abstract dependency. Plus a separate Clean Architecture boundary check (`{orchestrator, requiredPorts}` config-driven). |
| **Output** | JSON: per-unit `{srp, ocp, lsp, isp, dip}` scores 0–100 each with a confidence label (`high`/`medium`/`low`/`none`), a weighted `total` renormalized over only the measured criteria (weights: srp .20 / ocp .15 / lsp .15 / isp .20 / dip .30), plus boundary violations if configured. |
| **Source** | Original build, not ported — this repo's own design, informed by standard SOLID literature (Martin, *Agile Principles, Patterns, and Practices*). `confidence: 'none'` exists because a class with real constructor-injected deps and arrow methods was scoring a false 100 before the AST-completeness fix (2026-08-20) — see the file header. |

---

## Step 2 — Clean Code

| | |
|---|---|
| **Call** | `rdc-clean-code-score <path> [--project-root <dir>] [--no-dead-exports]` |
| **Input** | file or directory path; optional project root for cross-file resolution |
| **Script** | [`scripts/lib/clean-code-scoring.mjs`](scripts/lib/clean-code-scoring.mjs), CLI in [`scripts/clean-code-score.mjs`](scripts/clean-code-score.mjs) |
| **Algorithm** | N1/N2/N4/N7: per-declared-name checks (cryptic, noise-word, magic-number-outside-const, generic-suffix) walking the real AST, not a whole-file regex. F1/F2: statement count (>20) / param count (>3) per member. E1: empty catch-block scan. G9a: unreachable constant-conditional branch. G9b: cross-file unused-export scan via `findReferencesAsNodes()`, gated behind a positive-control check. |
| **Output** | JSON: findings list, each `{rule, file, line, message, confidence}`; G9 findings additionally carry `deadExportsScope.positiveControlOk` — G9b's export-usage findings are withheld entirely if the control fails. |
| **Source** | `src/agents/clean-code-analyzer/tools/{naming,function,code-smell}-validator.ts`, github.com/OnSightTeam/architecture-toolkit (MIT). Their checks are whole-file text regexes with an occurrence-count threshold to suppress false positives; this port reads the real AST per declared binding instead, so every occurrence is its own finding with no threshold needed. **Not ported**: N3, N5, N6, C1–C5, G14, G16, G28 — named with reasons in `skills/clean-code-analyzer/SKILL.md`. G5 (Duplicate Code) is real but lives in Step 8 below, not here — it's a cross-file, whole-corpus check, the wrong shape for this file's per-unit contract. |

---

## Step 3 — Package Design

| | |
|---|---|
| **Call** | `rdc-package-metrics <packagesRoot>` or `--dirs <d1,d2,...>` |
| **Input** | directory containing `packages/*`, or an explicit list of package dirs |
| **Script** | [`scripts/lib/package-metrics.mjs`](scripts/lib/package-metrics.mjs), CLI in [`scripts/package-metrics-cli.mjs`](scripts/package-metrics-cli.mjs) |
| **Algorithm** | Robert C. Martin's package-coupling metrics. Resolves every `import`/`export...from`/`require()`/dynamic `import()` across sibling packages via plain `node:fs` + regex (no AST — deliberately independent of the ts-morph plugin). Ca = distinct importing packages, Ce = distinct imported packages, Instability I = Ce/(Ca+Ce), Abstractness A = exported interface/type ÷ exported total (`.ts` files only), Distance D = \|A+I-1\|, real graph cycle-walk for ADP violations. |
| **Output** | JSON: per-package `{ca, ce, instability, abstractness, distanceFromMainSequence, zone}` (`zone` ∈ main-sequence / zone-of-pain / zone-of-uselessness / off-main-sequence / unmeasurable), plus named cycle paths (`a → b → c → a`), not just "a cycle exists." |
| **Source** | Formulas checked against `src/agents/package-design/tools/{stability-metrics-calculator,package-coupling-analyzer}.ts`, github.com/OnSightTeam/architecture-toolkit (MIT) — confirmed independently rather than copied (both short enough to derive from Martin's own published formulas and cross-check). The cycle-detection graph walk is this repo's own implementation, later reused by Step 5. |

---

## Step 4 — Testing Strategy

| | |
|---|---|
| **Call** | `rdc-test-smell-score <test-path> [--repo-root <dir>]` |
| **Input** | test file or directory (`.test.mjs`/`.test.ts`/`*.spec.*`) |
| **Script** | [`scripts/lib/test-smell-scoring.mjs`](scripts/lib/test-smell-scoring.mjs) (also its own CLI — has a runnable main-guard block) |
| **Algorithm** | T1: test-block count vs. exported-unit count of the paired source file (via the same `NormalizedUnit` contract, not a regex). T2: `.skip`/`xit`/`xdescribe` scan. T5/T6: assertions-per-block (>10) / lines-per-block (>30), via a brace-balanced block extractor (not a non-greedy regex, which breaks on nested `{}`). T7/T8: literal timer/`Date.now`/`Math.random`/`process.env` calls inside a test body. T9: Jaccard similarity (≥0.75) over normalized 3-token shingles of `beforeEach`/`beforeAll` bodies, across files. FIRST-Independent: a `let` declared outside test() and mutated in ≥2 separate test() blocks. |
| **Output** | JSON: findings list per rule with file:line and description; T9 findings span multiple files by design. |
| **Source** | `src/agents/testing-strategy/tools/test-quality-validator.ts`, github.com/OnSightTeam/architecture-toolkit (MIT), lines 47–240 (T1:47-65, T2:67-85, T5:127-145, T6:147-171, T7:173-190, T8:192-219, T9:221-240). The brace-balanced extractor replacing their non-greedy regex is this repo's own fix. **Not ported**: T3 (Test Per Class), T4 (Untested Method), and Fast/Repeatable/SelfValidating/Timely (FIRST's other 4 letters) — named with reasons in `skills/testing-strategy/SKILL.md`. |

---

## Step 5 — Architecture (Clean Architecture boundaries)

| | |
|---|---|
| **Call** | `rdc-architecture-score <path> [--config <file>]` |
| **Input** | directory path; optional layer-classification config (glob → layer name mapping) |
| **Script** | [`scripts/lib/architecture-scoring.mjs`](scripts/lib/architecture-scoring.mjs), CLI in [`scripts/architecture-score.mjs`](scripts/architecture-score.mjs) |
| **Algorithm** | Self-contained, no AST — file-path + import-target analysis, same shape as Step 3. Classifies each file into a Clean Architecture layer (Entities/UseCases/Adapters/Frameworks) by configurable path glob, then checks: dependency-direction (inner layer imports outer), framework-coupling (concrete framework import inside Entities/UseCases), missing-abstraction (5 subtypes — a UseCase file importing a concrete DB/HTTP client instead of a port/repository interface), circular-layer-dependency (reuses Step 3's `findCycles` graph walk, applied to layers instead of packages). |
| **Output** | JSON: findings by violation type, each citing the file(s) and layer(s) involved; low-confidence heuristic findings (mixed-concerns, UI-mixing, mixed-layer-imports) are labeled as such, not reported as certain. |
| **Source** | `src/agents/architecture-reviewer/tools/{dependency-rule-validator (213 lines), boundary-analysis-validator (169 lines), layer-separation-validator (145 lines)}.ts`, github.com/OnSightTeam/architecture-toolkit (MIT), fetched and read in full 2026-08-20. Their own circular-dependency check (a `"../../.."`-depth proxy) was deliberately NOT ported — replaced with a real graph cycle walk, which is strictly stronger. A real bug was caught by this tool's own positive-control fixture before ship: a `**`-glob-to-regex translation mismatched top-level paths with no parent directory segment — fixed same session. |

---

## Step 6 — Pattern Advisor

| | |
|---|---|
| **Call** | `rdc-pattern-score <path>` |
| **Input** | file or directory path |
| **Script** | [`scripts/lib/pattern-scoring.mjs`](scripts/lib/pattern-scoring.mjs), CLI in [`scripts/pattern-score.mjs`](scripts/pattern-score.mjs) |
| **Algorithm** | 10 structural detectors over `NormalizedUnit`/`NormalizedMember` facts (`switchStatements[].hasTypeCreation`, `switchBehaviorCallLine`, `constructorNewCallTargets`, `conditionalFeatureCallLine`, `deepChainCallCount`, `calleeNames`, `hasGetInstanceMethod`, field-access for Command): Factory Method (switch/if-else creating types via `new`), Builder (>4-param constructor), Singleton (`getInstance()` present), Decorator (conditional feature-wrapping call), Adapter (interface-conversion call pattern), Facade (deep call-chain into a subsystem), Strategy (switch/if-else selecting behavior), Observer (manual notify/listener pattern), Command (undo/redo/queue call OR field-access), Template Method (base method calling overridable hooks). |
| **Output** | JSON: per-pattern findings, each with confidence and the specific structural signal matched, attributed to a real member/unit and line. |
| **Source** | `src/agents/pattern-advisor/tools/{creational,structural,behavioral}-pattern-analyzer.ts`, github.com/OnSightTeam/architecture-toolkit (MIT), fetched and read in full 2026-08-20. Their checks are whole-file text regexes with zero scoping to which switch/if/call the signal actually came from (their own Factory regex matches if `new` appears anywhere after a type-switch's opening brace, even statements later) — this port walks the real AST per switch-case/if-block/call-expression, so every finding is real-line-attributable. A real undercount was found and fixed during build: Command's original port only scanned call names, missing field-access-only usage (`this.queue`/`this.history` read but never called). |

---

## Step 7 — Refactoring Guide

| | |
|---|---|
| **Call** | `rdc-refactoring-score <path> [--project-root <dir>] [--no-effort]` |
| **Input** | file or directory path; optional project root for cross-file call-site resolution |
| **Script** | [`scripts/lib/refactoring-scoring.mjs`](scripts/lib/refactoring-scoring.mjs), CLI in [`scripts/refactoring-score.mjs`](scripts/refactoring-score.mjs) |
| **Algorithm** | 9 rules over `NormalizedUnit`/`NormalizedMember` facts: extract-method (statementCount > 25), extract-class (method count > 15), introduce-parameter-object (params > 4), replace-magic-number (reuses Step 2's N4 signal, reframed as a fix recommendation), consolidate-duplicate-code (repeated statement text > 3× across > 3 patterns), decompose-conditional (> 2 conditions, each ≥ 50 chars), strategy/factory/null-object-transform candidates. `estimateEffort()` reuses the SAME cross-file `findReferencesAsNodes()` reference-graph walk as Step 2's G9 dead-export check to get a real call-site count, not a guess. |
| **Output** | JSON: findings with `{type, file, line, effort: low\|medium\|high\|null}` — `effort` is `null` for module-level (non-class) findings rather than a fabricated guess, since call-site resolution currently only covers exported class symbols. |
| **Source** | `src/agents/pattern-refactoring-guide/tools/{refactoring-analyzer, code-smell-refactoring-guide, pattern-transformation-guide}.ts`, github.com/OnSightTeam/architecture-toolkit (MIT), fetched and read in full 2026-08-20; two stale line-citations in the prior skill doc were corrected against the real source during this build (`pattern-transformation-guide.ts:109→110`, `:169→168`). **Deliberately not merged** with Step 2's thresholds even though both measure similar facts: extract-method here fires at statementCount > 25 (the toolkit's real refactoring-domain number, `refactoring-analyzer.ts:49`) vs. Clean Code's F1 at > 20 — same underlying fact, two different real thresholds for two different domains, kept separate on purpose. |

---

## Step 8 — Duplicate Code (G5)

| | |
|---|---|
| **Call** | `rdc-duplication-score <path> [--min-tokens <n>] [--format text\|json]` |
| **Input** | file or directory path; `--min-tokens` default 50 (matches PMD CPD's default token threshold) |
| **Script** | [`scripts/lib/duplication-scoring.mjs`](scripts/lib/duplication-scoring.mjs), CLI in [`scripts/duplication-score.mjs`](scripts/duplication-score.mjs) |
| **Algorithm** | Token-shingle Rabin-Karp rolling-hash matching — the same technique jscpd and PMD's CPD both use. Tokenizes each file (comments stripped by extension, string literals kept as real content since a repeated literal is real duplication), computes a rolling hash over every `minTokens`-length window in O(n), buckets windows by hash, then **merges consecutive matching window offsets into maximal contiguous blocks** — the merge step is the part that matters: without it, a single real 60-token duplicate reports as ~40 overlapping findings (one per window slide), which is exactly the bug this tool's own first draft shipped with and caught via its own positive-control test before this doc was written. |
| **Output** | JSON: `{duplicates: [{tokenCount, occurrences: [{file, startLine, endLine}, ...]}], filesScanned, minTokens}` — each `duplicates[]` entry is one real contiguous duplicate block, not one per window slide. |
| **Source** | Algorithm choice informed by [jscpd](https://github.com/kucherenko/jscpd) and PMD's [CPD](https://pmd.github.io/pmd/pmd_userdocs_cpd.html) (both real, mature, Rabin-Karp-based — see Research Bibliography below) — **no code taken from either**; this is an independent implementation of the published algorithm, not a port. **Verified against the real toolkit source** (`src/agents/clean-code-analyzer/tools/code-smell-validator.ts`, `checkDuplication()`): their G5 is a same-file repeated-line-text counter (flags a line if it appears >3 times in ONE file) — no cross-file matching, no minimum block length, a one-line coincidental repeat counts the same as a real duplicated block. This implementation is strictly stronger: real cross-file structural matching, a minimum contiguous-block length (not per-line), and reports the actual matched block range on both sides, not just a per-file count. |

---

## What's still judgment, not mechanical

Four questions no AST/regex fact can answer, still routed to an LLM
reviewer (`pr-review-toolkit:code-reviewer` via `Agent()`, or a Codex peer
via `rdc:co-develop`) — named here so nothing is silently hidden inside a
tool's own "done" claim:

| Skill | Judgment call | Why it can't be mechanical |
|---|---|---|
| `architecture-reviewer` | Is this abstraction boundary architecturally *right* for the domain, not just shaped right | Shape-correctness (Step 5) is a fact; domain-fit is a design opinion |
| `pattern-advisor` | Is the detected pattern actually the correct fit here, not just structurally similar | A switch-selecting-behavior IS a Strategy signal (Step 6) whether or not Strategy is the right call for this problem |
| `clean-code-analyzer` | Does a name lie about what the code does (semantic, not shape) | N1/N2/N7 (Step 2) catch shape; a name that's the right LENGTH and SPECIFICITY but describes the wrong behavior needs reading intent against implementation |
| `package-design` | Does a package's actual responsibility match its name/README | Ca/Ce/cohesion (Step 3) are structural; "does this package do what it claims" needs reading intent |

## Decisions closed this pass (not left open)

- **AST parser (SOLID) — closed.** Swapped `solid-score.mjs` from ts-morph
  to the fleet's own tree-sitter parser (`scripts/lib/plugins/treesitter.mjs`,
  ported from CodeFlow's `nativeParser.ts`), default `--parser tree-sitter`.
  Exact parity on `rdc-harness`'s `Harness` (68.5/100, both backends, every
  criterion). One real bug found and fixed (concise-arrow-body blindness);
  one real pre-existing ts-morph defect found and root-caused (shared-project
  degradation at 100+ files — not a tree-sitter issue). Clean Code, Patterns,
  and Refactoring stay on ts-morph this pass — see "AST parser — CLOSED"
  below for full detail.
- **G5 duplication detection** — closed. Built Step 8 above, real
  Rabin-Karp implementation, positive-control-verified, one real bug (window
  merge) caught and fixed before ship.
- **Cycle-detection algorithm (Steps 3 and 5) — evaluated, decision: KEEP
  the hand-rolled graph walk, do not adopt ArchUnitTS or dependency-cruiser.**
  Reasoning: (1) our walk is already proven correct — dogfooded against
  `rdc-harness` and this repo's own tree, zero cycles found, independently
  confirmed by hand-verification, not just trusted; (2) it's reused twice
  (Steps 3 and 5) with proven determinism, satisfying the ATF golden-capture
  requirement; (3) both external tools are designed as standalone CLI/CI
  linters with their own config/output format, not as an importable pure
  function returning JSON into another tool's pipeline — adopting either
  would mean wrapping a subprocess or forking their internals, a bigger
  footprint than the ~40-line graph walk already in `package-metrics.mjs`
  for a problem with no identified functional gap. Revisit only if a real
  case surfaces that the hand-rolled walk gets wrong.
- **Unit tests for all 8 scoring libraries** — closed. 243 tests under
  [`tests/lib/`](tests/lib/), Node's built-in `node:test` (no new
  dependency), one file per library plus a shared `fixtures.mjs`. Every
  rule/detector/threshold has a violation fixture; every numeric threshold
  (F1 >20, F2 >3, Builder >4 params, T5 >10, T6 >30, etc.) is tested at and
  just past the boundary. Re-run independently (`node --test
  tests/lib/*.test.mjs`), not just trusted from the build report: **243
  pass, 0 fail.** No bugs found in the libraries themselves. One real design
  finding, not a bug: `package-metrics.mjs`'s `zone` classifier has an
  `'off-main-sequence'` branch that is mathematically unreachable — since
  `instability`/`abstractness` are both bounded `[0,1]`, `distance > 0.5`
  can only happen when both values fall under 0.5 (zone-of-pain) or both
  over 0.5 (zone-of-uselessness); no input reaches the mixed quadrant with
  distance > 0.5. Left as-is (harmless dead branch, not incorrect output),
  documented in the test file with the proof rather than silently removed.

## AST parser — CLOSED (SOLID moved to tree-sitter; 3 tools stay on ts-morph)

**Previously disclosed here as an open finding, now closed by direct operator
instruction (Dave, 2026-08-20):** the AST layer (`scripts/lib/plugins/
typescript.mjs`) used `ts-morph` (TypeScript/JavaScript only) without first
checking for existing fleet infrastructure. The monorepo already owns
[`@regen/codeflow-parser`](https://github.com/LIFEAI/regen-root/tree/e018e119dd22c2b75c9cae243a79230b495c53c7/packages/codeflow-parser)
([`nativeParser.ts`](https://github.com/LIFEAI/regen-root/blob/e018e119dd22c2b75c9cae243a79230b495c53c7/packages/codeflow-parser/src/nativeParser.ts))
— a genuinely multi-language, standalone, in-process tree-sitter parser
(TypeScript, JavaScript, Python, C, C++, C#), confirmed callable in-process
as a library (`this.parser.parse(files)`, CodeFlow's own ingestion pipeline)
with the PM2 `server.ts` wrapper as an optional separate deployment this
validator does not depend on.

**Built:** [`scripts/lib/plugins/treesitter.mjs`](scripts/lib/plugins/treesitter.mjs)
— a new `LanguagePlugin` implementing the full `NormalizedUnit`/
`NormalizedMember` contract for TypeScript, TSX, and JavaScript on
`web-tree-sitter` + `tree-sitter-wasms` directly (no dependency on
`regen-root` at runtime — the port is textual, done once). Foundation ported
from `nativeParser.ts`'s `extractTsJsSymbols`/`extractCallsFromBody`/
`extractTsJsImports` (same node-type vocabulary, same top-level-declaration
walk shape), then extended with every fact `NormalizedUnit`/
`NormalizedMember` requires that `nativeParser.ts` does not compute
(statement counts, magic numbers, empty catches, dead conditionals,
switch-statement shapes, null checks, complex conditionals, callee names,
constructor `new` targets, deep-chain call counts, `getInstance` detection,
static property names, LSP override comparison against a resolved base
class, and cross-file `deadExportsOf`/`referenceSitesOf` via a real
identifier-text walk over every cached parsed file — tree-sitter has no
`findReferencesAsNodes()` language service). Every tree-sitter node type and
field name used (`public_field_definition`, `method_definition`'s
`parameters`/`body`/`return_type` fields, `if_statement`'s `condition`/
`consequence`/`alternative`, `else_clause` wrapping an `else if` as a nested
`if_statement`, `super()` vs `super.method()`'s different function-field
shapes, parenless single-param arrows exposing a bare `parameter` field, TS
`enum_assignment`) was verified empirically by parsing representative
TypeScript with the installed grammar and inspecting the resulting CST —
not assumed from memory of the grammar.

`scripts/solid-score.mjs` now takes `--parser tree-sitter|ts-morph`,
**defaulting to `tree-sitter`** per the operator's instruction to actually
use the new plugin, not just build it unused; `ts-morph` stays available as
an escape hatch/regression-comparison lever.

**Parity — real numbers, via the actual CLI, both flags, same target
(`rdc-harness`'s `Harness` god-object, `packages/core/src/index.mjs`):**

```
=== tree-sitter (default) ===
Harness (class)  total=68.5
  SRP:  40 [high]  3 connected component(s) across 24 member(s)
  OCP: 100 [low]   0 branch/type-check hit(s) across 24 member(s)
  LSP: 100 [low-medium]  no base class
  ISP:  73 [medium-high] 18 public member(s), avg 0.8 param(s)
  DIP:  53 [high]  15 concrete instantiation(s) of 32 total dependenc(y/ies)

=== ts-morph (--parser ts-morph) ===
Harness (class)  total=68.5     <- byte-identical, all 5 criteria, all details
```
Not just in-range: **exactly** `68.5/100` under both backends, every
per-criterion score and detail string identical. `RefusedError` (the file's
other class) also scored identically (100/100, both backends). Confirmed
with a member-level diff across every `NormalizedMember` field
(`paramCount`, `branchHits`, `statementCount`, `isPublic`, `fieldAccess`,
`calls`) before wiring the CLI — zero diffs.

**A real bug found and fixed during broader dogfooding (not on the Harness
target — found by scoring 130 files across `rdc-skills` + `rdc-harness`):**
a concise-body arrow class/module property — `model = () => new
PhaseModel({...})` (`rdc-harness/packages/phases/test/phase-model.test.mjs:21`)
— has its ENTIRE body AS the `new_expression`/`call_expression`/
`member_expression` node itself (an arrow function's concise body is the
expression directly, not a `statement_block` wrapping it). The self-
exclusive tree walk (`getDescendantsOfKind`-equivalent, visits children only)
only tested the body's CHILDREN, never the body node's own type — so
`new PhaseModel` itself was invisible to `constructorNewCallTargetsOf`/
`callsOf`/`fieldsOf`/`branchHitsOf`/`calleeNamesOf`/`deepChainCallCountOf`
for every concise-arrow member. Fixed by making the walk self-inclusive
(`walkSelfAndDescendants`) — verified safe everywhere else in the file
(every other target node type this plugin searches for can never
structurally BE the root node passed in) and confirmed fixed by re-running
the same 130-file dogfood pass.

**A second, larger divergence found and root-caused during the same
dogfooding — and it is NOT a tree-sitter defect:** scoring all 130 files in
one process, 9 files showed DIP-score gaps up to 24.3 points, `ts-morph`
consistently reporting FEWER concrete instantiations than tree-sitter (e.g.
`phase-model.test.mjs`: ts-morph 0, tree-sitter 7). Root-caused by hand: a
**fresh, independent ts-morph project** parsing that same file finds **7**
`new PhaseModel(...)` nodes — matching tree-sitter exactly — and `typescript.mjs`'s
own `sharedProject()`, warmed up with only the 2 files that actually matter
(the defining file + the test file), ALSO correctly returns **7**. Only the
`sharedProject()` instance that had accumulated 113+ prior files in one
long-running process returns 0. This is a **pre-existing correctness defect
in ts-morph's incremental shared-`Project` pattern at scale**, not something
this build introduced — and it is evidence FOR the swap, not against it:
tree-sitter's plugin holds no incremental language-service state to go
stale, so it does not reproduce this failure mode at all. `solid-score.mjs`'s
real invocation pattern (one target directory/file per process) rarely hits
the file count where ts-morph's degradation appears, but a long-running
multi-package sweep (exactly what dogfooding this pass did) will.

**Determinism** — same requirement as every other tool in this doc: ran
`solid-score.mjs` twice against the same target, `--format json`, both a
single-file target and a whole-directory target, diffed the output.
**Byte-identical both times**, both scopes.

**UPDATE (2026-08-20/21, same night) — `treesitter.mjs` now consumes
`nativeParser.ts`'s own `members[]`/`units[]` extraction directly, instead of
re-implementing it:** the parity numbers and bug writeups directly above
describe the FIRST build of `treesitter.mjs`, at a point where
`nativeParser.ts` only extracted `symbols`/`interfaces`/`calls`/`imports` at a
coarse, top-level-only granularity — it never walked class method bodies at
all, which is why this plugin had to independently re-derive every per-member
fact from scratch. Minutes after that first build shipped, `nativeParser.ts`
gained a real `members[]`/`units[]`/`references[]` surface (a new
`src/memberFacts.ts`, commit `1e4e4012b` on `regen-root`'s `develop`) that
walks EVERY callable body — not just top-level functions — and computes
almost exactly the same per-member/per-unit facts this plugin was
duplicating. This plugin was rewritten the same night to consume that surface
directly rather than continue re-deriving it.

**What changed, mechanically:** the compiled `nativeParser.js`/`grammars.js`/
`memberFacts.js`/`xmlParser.js` (plus `.d.ts`) were re-vendored into
`scripts/lib/vendor/codeflow-parser/` from `regen-root`'s freshly-built
`dist/`, and `.source-commit` bumped to `a354d5be2d1db865faea92c1013eb2a62981e271`
(the `x-claude-sv` worktree HEAD at vendor time). `treesitter.mjs` now imports
`extractMembers` from the vendored `memberFacts.js` and calls it directly and
SYNCHRONOUSLY against its own tree-sitter parse of each file — not through
`createNativeParser().parse()`'s `async` service wrapper, which cannot be
called from `extractUnits()` (the `LanguagePlugin` contract in
`../language-plugin.mjs` requires that method to stay synchronous, and
`parse()` is `async` end-to-end because it also fronts an XML branch and a
batch override/reference-resolution pass this plugin doesn't use).
`extractMembers` itself has no `await` in it anywhere — a plain, pure,
deterministic function of `(rootNode, language)` per its own header contract
— so calling it directly is the correct fix for the sync/async mismatch, not
a workaround.

**Field mapping — `NormalizedMember`/`NormalizedUnit` (this plugin's
contract) ← `ParsedMember`/`ParsedUnit` (the vendored extractor's):**

| NormalizedMember/Unit field | Source | Note |
|---|---|---|
| `paramCount` | `ParsedMember.paramCount` | direct |
| `fieldAccess` | `ParsedMember.fieldAccess` | direct — now deduped + lexicographically sorted (was unsorted, with duplicate occurrences, before) |
| `branchHits` | `ParsedMember.branchHits` | direct — semantics broadened: native counts a `switch`'s `default` arm as a branch and counts an if/else-if chain by its full arm count, where this plugin's own prior local walk counted only chain LINKS and never counted `default`. Real, verified difference — see parity re-run below |
| `statementCount` | `ParsedMember.statementCount` | direct — boundary differs: native's walk stops at a NESTED callable (a closure passed to `.map()` is its own member), where this plugin's prior local walk was self-inclusive across ALL nesting depths including nested closures. Deliberate design in `memberFacts.ts` ("a closure...is its own member...folding its statements into the enclosing method would inflate every complexity signal") |
| `declaredNames` | `ParsedMember.declaredNames`, filtered | destructured-pattern entries (`{ handle, target, snapshot }` as ONE combined name — verified empirically) are dropped; `kind` field stripped to match this plugin's existing shape |
| `magicNumbers` | `ParsedMember.magicNumbers`, mapped | `value` coerced `string→number` (native emits `value` as source text, e.g. `"-5"`); native's 0/1/-1 exclusion is a STRING comparison (`"1.0"` would NOT be excluded) where the prior local version excluded by NUMBER comparison — a real, disclosed edge-case difference, not hit in the Harness fixture |
| `constructorNewCallTargets` | `ParsedMember.constructorNewCallTargets` | direct |
| `deepChainCallCount` | `ParsedMember.deepChainCallCount` | direct |
| `calleeNames` | `ParsedMember.calleeNames` | direct |
| `concreteInstantiations`, `totalDependencies` (unit, class only) | `ParsedUnit.concreteInstantiations`/`.totalDependencies` | direct — `totalDependencies` uses a FUNDAMENTALLY DIFFERENT formula than this plugin's prior local one (native: distinct non-self call receivers + `new`-targets, minus own member names; prior local: concrete instantiations + import-specifier count + constructor-injected-typed-param count) — a real, measured difference, see parity re-run |
| `staticPropertyNames`, `hasGetInstanceMethod`, `hasBaseClass` (unit, class only) | `ParsedUnit.*` | direct — `hasGetInstanceMethod`/`hasBaseClass` both broaden slightly (more `getInstance`-family names; more heritage-clause node types recognized) |
| `calls` | **stays local** | this plugin's contract keeps a `this.`-stripped-only, receiver-otherwise-preserved form (`obj.method()` → `"obj.method"`) for `solid-scoring.mjs`'s SRP same-component test; native's `calleeNames` strips EVERY receiver, which is right for pattern-scoring.mjs's keyword scans but wrong for SRP's sibling-call detection — would have created spurious cross-member unions |
| `isPublic` | **stays local** | native's `ParsedMember.exported` is the OWNING CLASS's export flag propagated to every member — it has no `private`/`protected`/`#`-prefix accessibility signal at all |
| `override` | **stays local** | native's `resolveOverrideShapes` is BATCH-scoped across one `parse()` call over every file at once; this plugin's `extractUnits` is called per-file, incrementally — re-running a whole-project batch parse on every single-file call would be a real perf regression, so cross-file base-method resolution keeps using this plugin's existing `fileCache`-backed lookup, unchanged |
| `emptyCatches`, `deadConditionals`, `nullChecks` | **stay local** | native reports these as a bare COUNT (`number`), not an array — `clean-code-scoring.mjs`'s E1/G9 findings and `refactoring-scoring.mjs`'s null-object-transform read `.line` (and, for `deadConditionals`, `.kind`) per occurrence, which a count cannot supply |
| `statementTexts`, `complexConditionals` | **stay local** | native reports these as `string[]` (text only, no `line`) — `refactoring-scoring.mjs`'s consolidate-duplicate-code and decompose-conditional findings need `.line` (and, for `complexConditionals`, `.length`) to build a locatable finding |
| `switchStatements[].hasBehaviorCall/.hasTypeCreation`, `switchBehaviorCallLine`, `conditionalFeatureCallLine` | **stay local** | native's `SwitchFact.behaviorDispatch`/`.typeConstruction` use a DIFFERENT, broader test (any call-or-return in a case; any `new` inside a type-named discriminant switch) than this repo's specific architecture-toolkit word lists (calculate/process/validate/format for clean-code and refactoring; calculate/process/execute/validate/format for pattern-advisor's Strategy; wrap/add/extend/enhance for Decorator) — reusing native's flags would silently change which findings fire |
| `deadExportsOf`/`referenceSitesOf` | **unchanged, fully local** | cross-file identifier-text walk, as before this pass; SOLID never calls either, so this is orthogonal to the parity numbers below |

**Correlation.** `extractMembers` returns a FLAT `members[]` including every
nested closure as its own entry with `owner: null` (a callback is genuinely
its own member with its own facts, per `memberFacts.ts`'s own design). This
plugin still needs to decide what counts as a "member" under its OWN contract
(a class's own methods/arrow-fields, or a file's own top-level declarations —
never an inner closure folded into one of those), so it keeps its existing
identity walk (`memberEntriesOf` for a class body; the top-level declaration
scan for a module) and correlates each locally-identified entry to the
matching native entry by `` `${owner ?? ''}::${name}::${startLine}` `` (the
callable node's own start line — verified to match exactly between the two
walks for method/constructor/arrow-field/top-level-function/top-level-arrow
shapes). A correlation miss falls back to this plugin's ORIGINAL, fully local
computation for that one member — unchanged from before this pass — so a miss
degrades to old-but-correct, never to a dropped or wrong fact.

**Re-verified parity, same target (`rdc-harness`'s `Harness`,
`packages/core/src/index.mjs`), both flags, real CLI output:**

```
=== tree-sitter (post-native-consumption) ===
Harness (class)  total=66.9
  SRP:  40 [high]  3 connected component(s) across 24 member(s)
  OCP:  83 [low]   16 branch/type-check hit(s) across 24 member(s), density 0.67
  LSP: 100 [low-medium]  no base class
  ISP:  73 [medium-high] 18 public member(s), avg 0.8 param(s)
  DIP:  56 [high]  15 concrete instantiation(s) of 34 total dependenc(y/ies)

=== ts-morph (--parser ts-morph, unchanged) ===
Harness (class)  total=68.5
  OCP: 100 [low]   0 branch/type-check hit(s)
  DIP:  53 [high]  15 concrete instantiation(s) of 32 total dependenc(y/ies)
  (SRP/LSP/ISP unchanged, byte-identical to tree-sitter)
```

**66.9, not 68.5 — a real, explained difference, not a regression:**
`concreteInstantiations: 15` matches exactly (both backends, unchanged —
confirms the underlying `new PhaseModel(...)`-class detection is stable). The
two criteria that moved are exactly the two fields the mapping table above
flags as using DIFFERENT NATIVE FORMULAS, not local re-derivations:
- **OCP (83 vs 100, ts-morph's own 0):** `branchHits` rose from ts-morph's 0
  to tree-sitter's 16 because `memberFacts.ts` counts a `switch`'s `default`
  arm as a branch and counts a full if/else-if chain by arm count — both
  MORE COMPLETE than either prior implementation. This is the "real, positive
  finding" case the task called out: the native parser counts branches the
  duplicate logic undercounted (ts-morph's own branchHits equivalent reports
  0 for this same class — a pre-existing gap in the untouched ts-morph path,
  not introduced here).
- **DIP (56 vs 53):** `totalDependencies` is 34 (native) vs 32 (ts-morph) —
  a 2-dependency gap from two genuinely different counting methodologies
  (native: distinct call-receivers + `new`-targets; ts-morph/prior-local:
  import-specifier count + constructor-injected-typed-param count), not a
  bug in either.
`RefusedError` (the file's other class) still scores 100/100 identically.

**Determinism** — ran `solid-score.mjs --parser tree-sitter` twice against
the same target, `--format json`, diffed the output: **byte-identical.**

**Regression suite** — `node --test tests/lib/*.test.mjs`: **243/243**, no
change from before this pass (none of the 243 tests exercise the Harness
fixture's exact score, so the OCP/DIP formula changes above did not trip any
existing assertion; they are captured here as a disclosed finding instead).

**How much duplicate CST-walking code was actually removable — the honest
number is small, not large:** `treesitter.mjs` grew from 964 to 1,182 lines
(+218), not shrank. Nothing was DELETED from the local extractor block —
every local function (`fieldsOf`, `callsOf`, `branchHitsOf`,
`declaredNamesOf`, `magicNumbersOf`, `statementCountOf`,
`constructorNewCallTargetsOf`, `deepChainCallCountOf`, `calleeNamesOf`,
`concreteDependencyCounts`, plus all eleven residual-fact extractors) is
still present, because it is still needed as the correlation-miss fallback
path for the nine member fields and three unit fields now primarily sourced
from native output, in addition to being unconditionally needed for the
eleven fields that never had a native equivalent to begin with (`calls`,
`isPublic`, `override`, and the eight clean-code/refactoring/pattern-advisor
facts requiring per-item line/regex detail the native surface doesn't carry).
What changed is which VALUES are used at runtime, not which code exists: in
the common case (correlation succeeds — the normal case for real class/module
members), 9 of 19 `NormalizedMember` fields and 5 of 9 `NormalizedUnit`
fields now come from the vendored extractor instead of this plugin's own
walk, with the local computation demoted to a safety-net fallback rather
than deleted. The remaining ~10 member facts genuinely cannot be sourced
from `memberFacts.ts`'s current output shape (missing per-item line numbers,
different regex/keyword semantics, or a batch-scoping mismatch with this
plugin's incremental per-file API) and stay local, unconditionally, by
design — not by oversight.

**Scoped explicitly out of this pass:**
- **Only `solid-score.mjs` was swapped.** `clean-code-score.mjs`,
  `pattern-score.mjs`, and `refactoring-score.mjs` still default to
  `typescript.mjs`/ts-morph. Swapping SOLID first, with the new plugin
  built, dogfooded, and proven, de-risks the other three — a larger
  regression-proof job the operator can direct next.
- **Python is NOT implemented in `treesitter.mjs`.** `nativeParser.ts` has
  real, working Python extraction logic (`extractPythonSymbols`) that could
  be ported in a follow-up pass, but no scoring CLI in this repo has ever
  targeted Python — shipping an unproven, un-dogfooded third language in
  the same pass as the TS/JS swap is scope creep, not scope discipline.
  C/C++/C# are out of scope entirely for the same reason.
- **A minor, disclosed `.d.ts`-only gap:** two ambient-declaration-only
  files (`scripts/lib/vendor/codeflow-parser/{grammars,nativeParser}.d.ts`)
  score 1 unit under ts-morph (which recognizes `declare function ...;` as a
  `FunctionDeclaration` via its higher-level API) and 0 under tree-sitter
  (whose grammar wraps an ambient signature as `ambient_declaration`, a
  different node type than plain `function_declaration`, which this
  plugin's top-level walk does not yet match). Both sides of this gap are
  bodyless type declarations with zero SOLID-relevant content either way
  (no statements, no branches, no fields) — disclosed, not chased further
  this pass.

**Real dependency versions installed and verified this pass** (added to
`rdc-skills`' own `package.json` `dependencies` — not the codeflow-parser
package in the separate `regen-root` monorepo, which this plugin does not
import from at runtime):

| Package | Version installed | License (verified) |
|---|---|---|
| [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) | `0.24.7` (matches the version confirmed live in `regen-root`'s own `codeflow-parser`; npm `latest` is `0.26.12` — pinned to the version already proven working with this ported logic rather than chasing latest) | MIT (verified: `node_modules/web-tree-sitter/package.json`) |
| [tree-sitter-wasms](https://www.npmjs.com/package/tree-sitter-wasms) | `0.1.13` (matches npm `latest`) | **Unlicense** (verified: `node_modules/tree-sitter-wasms/package.json` — public domain, NOT MIT) |

## Research bibliography

Real URLs fetched/searched this session — for the next person picking this
up, not "I researched online":

**Source ported from:**
- [github.com/OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit) — root repo, `.claude/skills/`, `src/agents/` tree
- `src/agents/clean-code-analyzer/tools/{naming,function,code-smell}-validator.ts`
- `src/agents/package-design/tools/{stability-metrics-calculator,package-coupling-analyzer}.ts`
- `src/agents/testing-strategy/tools/test-quality-validator.ts`
- `src/agents/architecture-reviewer/tools/{dependency-rule-validator,boundary-analysis-validator,layer-separation-validator}.ts`
- `src/agents/pattern-advisor/tools/{creational,structural,behavioral}-pattern-analyzer.ts`
- `src/agents/pattern-refactoring-guide/tools/{refactoring-analyzer,code-smell-refactoring-guide,pattern-transformation-guide}.ts`
  (all fetched via `raw.githubusercontent.com/OnSightTeam/architecture-toolkit/main/<path>`)

**Web searches run (query → what it surfaced):**
- "static analysis tools SOLID principles violation detection without LLM AST-based" → [cycode.com](https://cycode.com/blog/static-code-analysis/), [Sorald (arXiv 2103.12033)](https://arxiv.org/pdf/2103.12033), [AVATAR (arXiv 1812.07270)](https://arxiv.org/pdf/1812.07270), [Mining Fix Patterns for FindBugs (arXiv 1712.03201)](https://arxiv.org/pdf/1712.03201), [datadoghq.com](https://www.datadoghq.com/knowledge-center/static-analysis/), [blog.codacy.com](https://blog.codacy.com/static-code-analysis), [oligo.security](https://www.oligo.security/academy/static-code-analysis)
- "ArchUnit dependency-cruiser layered architecture boundary enforcement rules" → [archunit.org/userguide](https://www.archunit.org/userguide/html/000_Index.html), [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS), [ArchUnitPython](https://github.com/LukasNiessen/ArchUnitPython), [Loiane Groner: Architecture Testing for Java with ArchUnit](https://loiane.com/2026/07/architecture-testing-java-archunit/), [thearchitectsnotebook.substack.com](https://thearchitectsnotebook.substack.com/p/ep-122-the-modular-monolith-part)
- "design pattern detection static analysis algorithm academic Factory Strategy Observer AST" → [Design pattern detection approaches: a systematic review (Springer, 10.1007/s10462-020-09834-5)](https://link.springer.com/article/10.1007/s10462-020-09834-5), [MARPLE (ScienceDirect S0020025510005955)](https://www.sciencedirect.com/science/article/abs/pii/S0020025510005955), [Identification and Assessment of Software Design Pattern Violations (arXiv 1906.01419)](https://arxiv.org/pdf/1906.01419), [Automatic Design Pattern Detection (Brown CS)](https://vis.cs.brown.edu/docs/pdf/Heuzeroth-2003-ADP.pdf)
- "jscpd PMD CPD code duplication detection algorithm Rabin-Karp token-based" → [jscpd](https://github.com/kucherenko/jscpd), [PMD CPD](https://pmd.github.io/pmd/pmd_userdocs_cpd.html), [aarongoldenthal.com: GitLab Code Quality with PMD CPD](https://aarongoldenthal.com/posts/gitlab-code-quality-duplication-analysis-with-pmd-cpd/), [dev.to duplicate-checker roundup](https://dev.to/rahulxsingh/13-best-duplicate-code-checker-tools-in-2026-1cnk)
