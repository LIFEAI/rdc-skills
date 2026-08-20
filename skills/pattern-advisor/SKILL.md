---
name: pattern-advisor
description: >-
  Usage `rdc:pattern-advisor <path>` — suggests an applicable design pattern
  for a given code shape. Advisory only; never rewrites code itself.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# pattern-advisor — Design Pattern Suggestions

## The failure this guards against

A pattern applied because it's a pattern, not because the code needs it, is
the same kind of theater as a test written to make a claim go green. This
skill's first output for most inputs should be "no pattern needed" — that is
a valid, common, correct answer, not a non-answer.

## Procedure

1. **Name the actual shape present**, not the pattern you're about to
   recommend — e.g. "five branches switching on a type tag to pick behavior"
   is the shape; Strategy or a lookup table is the candidate pattern. Naming
   the shape first stops the recommendation from being pattern-first.

2. **Check whether `solid-validator`'s OCP finding already flagged this
   file** — a high branch-density score is the most common trigger for a
   real Strategy/Visitor/lookup-table recommendation. Reuse that evidence
   instead of re-deriving it.

3. **Recommend, with the concrete alternative named:**
   - Type-switch selecting behavior → Strategy, or a plain lookup object if
     the branches have no shared interface need.
   - Object constructed from a long, mostly-optional parameter list →
     Builder, or named-options object if the construction has no ordering
     constraints (don't reach for Builder when a plain object literal does
     the job).
   - A class whose subclasses override one method that changes only the
     "what," never the "how" → Template Method, or straight composition if
     there's no shared "how" worth abstracting.
   - Repeated `if (x) { A } else { B }` where A/B are chosen by an external
     flag threaded through many call sites → Strategy injected at
     construction, not a flag threaded through every call.

4. **State the "no pattern needed" case explicitly when it applies** — a
   small, stable branch count with no growth signal is not a pattern
   candidate; recommending one there is the failure this skill exists to
   prevent.

5. **Score confidence, 70-90%, and assign a priority (high/medium/low).**
   Every recommendation carries both, never a bare "recommend X." Calibration
   (adapted from the confidence values actually shipped in
   [OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)'s
   `src/agents/pattern-advisor/tools/*.ts` — every detector there returns a
   confidence in exactly the 70-90 band, never higher, never lower):

   | Band | What earns it | toolkit precedent |
   |---|---|---|
   | **85-90%** | **Two or more independent structural signals** corroborate the same pattern, AND the shape is syntactically unambiguous — no keyword-frequency guessing. | Factory Method: switch-on-type *and* an immediate `new` inside the case body, both required (`creational-pattern-analyzer.ts:43-44`) → 90. Builder: constructor param count is a hard, countable threshold (`>4`), no interpretation needed (`creational-pattern-analyzer.ts:98`) → 85. |
   | **75-84%** | **One clear structural signal**, but reading it as "this pattern is needed" requires assuming intent — the same code could have an innocent explanation. | Command: `undo/redo/history/queue/execute` keyword count `>4` (`behavioral-pattern-analyzer.ts:107,110`) → 80. Observer: `notify/update/inform/broadcast` call count `>3` (`behavioral-pattern-analyzer.ts:74,77`) → 75 — three manual calls could just as easily be three legitimate distinct actions, not tight coupling. |
   | **70-74%** | **Pure keyword/frequency heuristic**, no structural corroboration at all — the signal is a regex match, not a shape. | Singleton: `private static instance|getInstance()` regex with no evidence the singleton is actually causing test/coupling pain (`creational-pattern-analyzer.ts:128`) → 70. Template Method: three `function` bodies sharing an `initialize/process/cleanup` substring (`behavioral-pattern-analyzer.ts:139,142`) → 70. |

   Never report a confidence outside 70-90% for a *heuristic* pattern match —
   below 70 the finding isn't worth surfacing (fold it into "no pattern
   needed"); above 90 claims a certainty static analysis of a live codebase
   cannot honestly produce (that's the mechanical `solid-validator`'s job,
   not this skill's).

   Priority follows severity of the underlying shape, independent of
   confidence: **high** when the shape actively violates Open/Closed today
   (a switch that will need a new case soon) or is a documented anti-pattern
   (Singleton, telescoping constructor); **medium** when the shape is a
   maintainability smell without an active OCP violation (Observer's manual
   notification, Facade's subsystem sprawl); **low** when the pattern would
   be correct but the code is small/stable enough that applying it is
   optional polish.

6. **Every recommendation carries trade-offs — pros AND cons, never pros
   alone** — and **at least one alternative pattern considered and
   rejected, with the specific reason it loses to the primary
   recommendation.** A recommendation with only upsides is advertising, not
   advice. Minimum shape:
   ```
   Trade-offs: pros: [...], cons: [...]
   Alternative considered: <pattern> — rejected because <specific reason
     tied to this code, not a generic pattern-vs-pattern comparison>
   ```
   Worked instances of both fields already exist in the toolkit source and
   should be adapted, not reinvented: Strategy's pros/cons at
   `behavioral-pattern-analyzer.ts:60-63`; Observer's alternatives (`Event
   Bus`, `Pub/Sub`) at `:92`; Factory Method's alternatives (`Abstract
   Factory` if multiple product families, `Strategy` if behavior varies, each
   with the specific condition that would make it the better choice) at
   `creational-pattern-analyzer.ts:59`; Singleton's alternatives
   (`Dependency Injection`, `Monostate`) at `:140`; Decorator's alternative
   (`Chain of Responsibility`) at `structural-pattern-analyzer.ts:59`.

7. **Report:**
   ```
   ## Pattern Advice
   | File:Line | Shape observed | Recommendation | Confidence | Priority | Why now (not speculative) |
   ### Trade-offs & alternative (per recommendation)
   ```

## Rules

- Never recommend a pattern without naming the shape it responds to.
- Never recommend a pattern without a confidence score (70-90%, per the
  calibration table above), a priority, at least one pro AND one con, and
  one named alternative rejected with a reason.
- "No pattern needed" is a first-class, expected verdict — report it as
  plainly as a positive recommendation. It carries no confidence/priority
  scoring (there is nothing being recommended to score).
- Do not write the refactor here — hand off to
  `pattern-refactoring-guide` for the concrete before/after.

## Worked Example — `rdc-skills`'s `solid-scoring.mjs`

Real target, read in full:
[`C:/Dev/rdc-skills/scripts/lib/solid-scoring.mjs`](file:///C:/Dev/rdc-skills/scripts/lib/solid-scoring.mjs)
(102 lines, five pure scoring functions: `srp`, `ocp`, `lsp`, `isp`, `dip`).
Running the updated procedure against all five:

```
## Pattern Advice — scripts/lib/solid-scoring.mjs
| File:Line | Shape observed | Recommendation | Confidence | Priority | Why now |
| srp() L35 & isp() L69-70 | Two functions independently map a discrete
  count/component-number to a score bucket via a 3-4-way nested ternary
  chain (`components === 1 ? 100 : components === 2 ? 70 : ...`; `publicMembers.length
  <= 5 ? 100 : ... <= 20 ? 45 : 15`) — a value lookup, not a behavior
  dispatch. | Extract to a shared `scoreBucket(value, thresholds)` lookup
  table | 72% | low | Two independent occurrences of the identical shape is
  the corroborating signal, but it's a pure value→value map with no varying
  "how" — see rejected alternative below, which is why this lands at the low
  end of the band and priority low, not high. |
| ocp() L44, lsp() L60, dip() L78 | Each computes a score via one continuous
  formula (`100 - density*25`, `100 - (drift/n)*100`, `100 - ratio*100`) —
  no branching on type, no switch, no repeated shape across functions. | No
  pattern needed | — | — | A formula is not a dispatch; there is nothing to
  select between at runtime. Recommending Strategy here would be exactly the
  pattern-first failure this skill exists to prevent. |

### Trade-offs & alternative — scoreBucket() recommendation
Trade-offs:
  pros: ["Named thresholds instead of unlabeled ternary literals — 100/70/40/10
         and the ISP 5/10/20 breakpoints become one readable table",
         "One place to tune bucket edges if scoring calibration changes",
         "Each bucket becomes independently unit-testable by input value"]
  cons: ["Each site is one line today — the table adds a level of indirection
         for something already legible in place",
         "srp's and isp's bucket counts differ (4 buckets vs. 2-stage
         count+param blend) — a shared table either forces a common shape
         onto two different scoring semantics, or ships two near-duplicate
         tables and gains nothing over the status quo",
         "The file's own header states its contract as 'pure functions...
         never a language-specific parser' — a shared lookup helper is a new
         shared surface every plugin-facing scoring change now has to reason
         about"]
Alternative considered: Strategy (one Strategy object per scoring criterion,
  selected by criterion name) — rejected because there is no runtime
  selection happening: `scoreUnit()` (L93-100) always evaluates all five
  criteria unconditionally and reduces them by weight. Strategy solves "pick
  one behavior among several at runtime"; this file's actual need, if any, is
  "de-duplicate two literal value tables," which a lookup table (or, given
  the cons above, doing nothing) answers directly without introducing
  polymorphism that has no caller to select it.
## Verdict: 1 low-priority optional recommendation (72% confidence), 3
functions correctly need no pattern.
```

This is the calibration this skill exists to enforce: the honest answer for
3 of 5 functions is "no pattern needed" (pure formulas), and the one real
finding is deliberately scored at the *low* end of the band with *low*
priority and an explicit "this might not be worth doing" cons list — not
inflated into a confident Strategy recommendation just because a repeated
shape was found.
