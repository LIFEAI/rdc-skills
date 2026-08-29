---
name: pattern-advisor
description: rdc:suggest-patterns (path) — suggests an applicable design pattern for a given code shape
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# pattern-advisor — Design Pattern Suggestions

## The failure this guards against

A pattern applied because it's a pattern, not because the code needs it, is
the same kind of theater as a test written to make a claim go green. This
skill's first output for most inputs should be "no pattern needed" — that is
a valid, common, correct answer, not a non-answer.

## Why 9 of these are mechanical, not a dispatched agent

Same reasoning as `solid-validator` and `clean-code-analyzer`: a rule that
names a real, AST-visible structural shape (a switch statement's
discriminant and case bodies, a constructor's parameter count, an
if-block's calls, a call chain's depth, a static property's name) does not
need LLM judgment to detect. All 9 live in `scripts/lib/pattern-scoring.mjs`
as pure functions over a `NormalizedUnit` (same `lib/language-plugin.mjs`
contract every other mechanical scorer in this repo shares), fed by facts
computed once in `lib/plugins/typescript.mjs`.

Detection heuristics (thresholds, word lists, structural shapes) are ported
from architecture-toolkit's REAL implementation —
[OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)
(MIT), `src/agents/pattern-advisor/tools/{creational,structural,behavioral}-
pattern-analyzer.ts` — fetched from raw.githubusercontent.com and read in
full, per-detector citations in `pattern-scoring.mjs`'s own comments. Their
own checks are whole-file text regexes with zero scoping to which
switch/if/call the signal actually came from (e.g. a type-switch's `new`
check matches if "new" appears anywhere before the switch's closing brace,
even in an unrelated statement three lines later). Ours walks the real AST
per switch-case / if-block / call-expression, so every finding is
attributable to the real member and — for the three patterns whose toolkit
signal is inherently node-scoped (Factory Method's switch+new, Strategy's
switch+behavior-call, Decorator's conditional-feature-call) — the real line
it was found on.

Confidence and priority numbers are the LITERAL values architecture-
toolkit's own analyzers return, hard-coded per detector (not computed). The
calibration table below (unchanged from before this scorer existed) was
checked against every one of them: **no discrepancy found.**

Dogfooded live (2026-08-20):
- **This repo's own `scripts/` tree** (36 JS/TS files scanned, 8 non-JS
  skipped and reported, not silently passed): Decorator fired 20 times,
  Adapter 4, Facade 1, Observer 1, Template Method 1 — 12 files carried a
  finding. **Factory Method, Builder, Singleton, Strategy, and Command all
  scored ZERO on real code.** Per
  `.claude/rules/prove-absence-positive-control.md`, a zero is not reported
  as a finding until the scanner is proven to work: a constructed positive-
  control fixture (a type-switch factory, a 6-param constructor, a
  `getInstance()` singleton, a calculate/tax switch, and an undo/redo/
  queue/execute command-history class) scored 2/1/1/1/1 findings
  respectively across those same 5 detectors — the zero on real code is a
  genuine absence, not a broken scanner.
- **`rdc-harness/packages`** (a different, larger real corpus, 87 JS/TS
  files scanned, 17 carried a finding): Factory Method fired once — a real Redux-style event reducer
  switching on `type` and constructing via `new` (`core/src/events.mjs`,
  `reduce()`) — Decorator once, Adapter 13 times (this package genuinely has
  an `adapters.mjs` module), Facade twice, including a 19-call chain in
  `transaction/src/index.mjs`'s `SaveTransaction##drive`.
- **ATF-compatibility**: `--format json` run twice on each of the two
  corpora above produced byte-identical output both times (`diff` empty) —
  no timestamps, file paths relative to the scanned root, and every
  results/finding array explicitly sorted.

## Confidence calibration

Adapted from the confidence values actually shipped in architecture-
toolkit's `src/agents/pattern-advisor/tools/*.ts` — every detector there
returns a confidence in exactly the 70-90 band, never higher, never lower —
and now hard-coded verbatim in `pattern-scoring.mjs`:

| Pattern | Confidence | Priority | Toolkit citation |
|---|---|---|---|
| Factory Method (switch-on-type + `new`) | 90% | high | `creational-pattern-analyzer.ts:43-53` |
| Factory Method (scattered `new`, >5 total >3 unique) | 75% | medium | `creational-pattern-analyzer.ts:68-83` |
| Builder (constructor >4 params) | 85% | high | `creational-pattern-analyzer.ts:98-108` |
| Singleton (`private static instance` \| `getInstance()`) | 70% | medium | `creational-pattern-analyzer.ts:128-138` |
| Strategy (switch + calculate/process/execute/validate/format) | 90% | high | `behavioral-pattern-analyzer.ts:44-54` |
| Command (undo/redo/history/queue/execute, >4) | 80% | high | `behavioral-pattern-analyzer.ts:107-119` |
| Observer (notify/update/inform/broadcast, >3) | 75% | medium | `behavioral-pattern-analyzer.ts:74-86` |
| Adapter (convert/transform/adapt) | 80% | medium | `structural-pattern-analyzer.ts:74-84` |
| Decorator (conditional wrap/add/extend/enhance) | 75% | medium | `structural-pattern-analyzer.ts:43-53` |
| Facade (>5 `a.b.c(...)` calls) | 70% | medium | `structural-pattern-analyzer.ts:104-114` |
| Template Method (>2 members call initialize/process/cleanup) | 70% | medium | `behavioral-pattern-analyzer.ts:139-150` |

Never report a confidence outside 70-90% for a *heuristic* pattern match —
below 70 the finding isn't worth surfacing; above 90 claims a certainty
static analysis of a live codebase cannot honestly produce.

## Procedure

1. **Run the mechanical scorer:**
   ```bash
   rdc-pattern-score <path> --format json
   ```
   (installed globally via `npm link`/publish — see `package.json`'s
   `bin.rdc-pattern-score`; falls back to
   `node <rdc-skills-install-path>/scripts/pattern-score.mjs`.)

2. **Read `results`** — per-file, per-unit, per-pattern findings. Each
   finding carries `location` (unit#member[:line] where a line is known),
   `problem` (the shape observed, named first — never lead with the
   recommendation), `solution`, `reasoning`, `confidence`, `priority`,
   `alternatives`, `tradeoffs: {pros, cons}`, and `source` (the exact
   toolkit file:line it was ported from).

3. **A file/unit with zero findings across all 9 patterns is "no pattern
   needed" — report it as plainly as a positive recommendation.** It
   carries no confidence/priority scoring (there is nothing being
   recommended to score). This is the expected, common, correct answer for
   most code — the dogfooding numbers above show 5 of 9 detectors scoring
   zero on this repo's own real source.

4. **Domain-fit judgment pass — this stays a dispatched agent, on
   purpose.** The mechanical scorer can prove a shape exists (a type-switch
   constructing via `new`, a 6-parameter constructor) but cannot judge
   whether the recommended pattern is actually the RIGHT fit for THIS
   domain, or merely structurally similar to one that would be — e.g. a
   6-param constructor on a one-off internal test fixture that's called
   exactly once is not a real Builder candidate even though it trips the
   mechanical threshold; a type-switch in a state-machine reducer may be
   the CORRECT idiom for that domain (Redux-shaped code), not a Factory
   Method smell. That needs reading intent and call-site context against
   structure, which is judgment:
   ```
   Agent({
     subagent_type: "pr-review-toolkit:code-reviewer",
     description: "pattern-advisor domain-fit pass",
     prompt: "Given these mechanical pattern-advisor findings (paste the
              JSON), judge for EACH finding whether the recommended pattern
              is actually the right fit for this code's domain and call-site
              context, or whether the shape is structurally similar but the
              recommendation doesn't actually help here (a one-off fixture,
              a legitimate domain idiom like a reducer's type-switch, a
              constructor called from exactly one call site). Return
              PATTERN_ADVISOR_DOMAIN_FIT_COMPLETE with
              { findings: [{location, pattern, verdict: apply|skip, reason}] }."
   })
   ```

5. **Every recommendation carries trade-offs — pros AND cons, never pros
   alone** — the scorer's own `tradeoffs` field already supplies both; do
   not drop the cons when reporting. **At least one alternative pattern is
   named where the toolkit source names one** (`alternatives` field) — do
   not invent a generic "or don't" alternative where the source gives none.

6. **Report:**
   ```
   ## Pattern Advice
   | File:Line | Shape observed | Recommendation | Confidence | Priority | Why now |
   ### Trade-offs & alternative (per recommendation)
   ### Domain-fit verdicts (dispatched judgment, step 4)
   ### No pattern needed (files/units with zero mechanical findings)
   ```

## Rules

- Never recommend a pattern without naming the shape it responds to
  (`problem` field) — the mechanical scorer already does this; do not strip
  it when reporting.
- Never recommend a pattern without its confidence score, priority, both
  pros AND cons, and its named alternative(s) if the toolkit source has any.
- "No pattern needed" is a first-class, expected verdict — report it as
  plainly as a positive recommendation.
- A mechanical finding is a structural fact, not a final verdict — run the
  domain-fit judgment pass (step 4) before telling Dave to actually apply a
  recommendation; do not present a raw mechanical hit as settled advice.
- Do not write the refactor here — hand off to
  `pattern-refactoring-guide` for the concrete before/after.
- A zero-finding pattern on a real scan is not reported as "clean" without
  having proven the detector fires on a positive-control fixture first (see
  the dogfooding section above) — same discipline as
  `.claude/rules/prove-absence-positive-control.md`.

## Not implemented — named, not faked

Everything the toolkit's own 9 detectors check is now mechanical (see
above). What's left is genuinely NOT a shape a regex or an AST walk can
settle:

| Question | Why it stays judgment |
|----------|------------------------|
| Is the recommended pattern actually the right fit for this domain, or just structurally similar? | Needs reading intent against call-site context — a type-switch in a reducer may be the correct domain idiom, not a smell; a 6-param constructor called once is not a real Builder candidate even though it trips the mechanical threshold. Routed through the domain-fit judgment pass (step 4). |
| Would applying this pattern actually improve the code, given its growth trajectory? | "Small, stable branch count with no growth signal" is a trend judgment a single-snapshot AST scan cannot make — the mechanical scorer reports the shape at THIS commit; whether it is worth refactoring is a maintainer call. |

## Worked Example — this repo's own dogfood run

Real target, scanned in full during this scorer's build:
[`C:/Dev/rdc-skills/scripts/lib/plugins/typescript.mjs`](file:///C:/Dev/rdc-skills/scripts/lib/plugins/typescript.mjs)
— 4 real mechanical findings, real `rdc-pattern-score` output:

```
## Pattern Advice — scripts/lib/plugins/typescript.mjs
| File:Line | Shape observed | Recommendation | Confidence | Priority | Why now |
| unitsFromSourceFile:435 | if-block calls a function whose name matches
  wrap/add/extend/enhance | Decorator | 75% | medium | Single structural
  signal, no growth trend evidence in a snapshot scan — flagged, not settled. |
| deadExportsOf:552 | same shape, different member | Decorator | 75% | medium | ditto |
| referenceSitesOf:590 | same shape, different member | Decorator | 75% | medium | ditto |
| (unit-wide) | 3 members each call an initialize/process/cleanup-named
  function | Template Method | 70% | medium | Lowest band — pure keyword
  frequency, no shared-"how" evidence beyond the name match. |

### Domain-fit verdict (dispatched judgment)
All 3 Decorator findings: SKIP — each if-block is a real conditional
branch (class-vs-module dispatch, a missing-file guard, a found/not-found
check), not feature decoration; the wrap/add/extend/enhance substring match
is a false positive on ordinary control flow in all three cases, not a
Decorator candidate.
Template Method finding: SKIP — the three "process"-adjacent calls are
three distinct, unrelated cross-file reference-graph walks, not a shared
algorithm skeleton with varying steps; there is no "how" worth abstracting.

## Verdict: 4 mechanical findings, all 4 correctly downgraded to SKIP by
the domain-fit pass — a worked example of why step 4 exists: the mechanical
scorer's job is to surface the shape, not to be the final word.
```

This is the calibration this skill exists to enforce: a real structural hit
is not the same as a real recommendation. The mechanical scorer's honest job
is surfacing candidates at the stated confidence; the domain-fit pass is
what turns a candidate into advice.
