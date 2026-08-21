# Validator — Architecture

## What it is

A deterministic code-analysis suite covering SOLID, Clean Code, Clean
Architecture, package design, testing strategy, design patterns, and
refactoring opportunities. Seven CLIs, zero LLM calls inside any of them.
Ported from [OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)
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

Every ts-morph-backed tool (SOLID, Clean Code, Patterns, Refactoring) reads
from one shape: `NormalizedUnit` / `NormalizedMember`, defined in
[`scripts/lib/language-plugin.mjs`](scripts/lib/language-plugin.mjs) and
produced, for TypeScript/JavaScript, by
[`scripts/lib/plugins/typescript.mjs`](scripts/lib/plugins/typescript.mjs)
— the ONE file in this repo allowed to import `ts-morph`. Every scoring file
downstream of it is pure functions over that shape; none of them touch an
AST directly. This is what "language independent" means in practice: adding
a Python or Go plugin that emits the same `NormalizedUnit` shape makes all
four of those tools work on that language with zero changes to the scoring
logic itself.

Two tools (Package Design, Architecture) are deliberately NOT built on this
contract — they operate on file paths and import statements, which a plain
text/regex scan answers as correctly as an AST would, so they carry no
`ts-morph` dependency at all and work on any language whose imports look
like ES/CJS syntax.

All 7 CLIs support `--format json`, are proven deterministic (identical
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
| **Source** | `src/agents/clean-code-analyzer/tools/{naming,function,code-smell}-validator.ts`, github.com/OnSightTeam/architecture-toolkit (MIT). Their checks are whole-file text regexes with an occurrence-count threshold to suppress false positives; this port reads the real AST per declared binding instead, so every occurrence is its own finding with no threshold needed. **Not ported**: N3, N5, N6, C1–C5, G5, G14, G16, G28 — named with reasons in `skills/clean-code-analyzer/SKILL.md`. |

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

## Known gaps (not yet closed)

- **G5 (duplication detection)** was incorrectly scoped as judgment-only in
  the original Clean Code port. It isn't — [jscpd](https://github.com/kucherenko/jscpd)
  and PMD's [CPD](https://pmd.github.io/pmd/pmd_userdocs_cpd.html) both solve
  this deterministically via the Rabin-Karp token-matching algorithm. Not
  yet built.
- **Cycle-detection algorithm** (used by Steps 3 and 5) is a hand-rolled
  graph walk. [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) and
  [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) are
  mature, widely-used tools for the same problem — not yet evaluated as a
  replacement.
- **Zero unit tests** exist for any of the seven scoring libraries. Every
  "done" claim above is backed by dogfooding against real code
  (`rdc-harness`, this repo's own `scripts/`) plus a positive-control
  fixture per rule family — real evidence the tools work on the cases fed to
  them, not a regression-test net against future edits.
