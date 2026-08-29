---
name: testing-strategy
description: rdc:testing-strategy (path) — recommends the right TEST LEVEL and SHAPE for a surface (unit/integration/live tier, assertion vs golden-ca...
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# testing-strategy — Test Level & Shape Recommendation

## The distinction this exists to enforce

A test can be green and prove nothing — this session's own history: a
proof-ledger claimed 144/144 while grading each row against evidence weaker
than the row demanded, because the tests were written to make a NAMED CLAIM
go green rather than to capture real behavior. This skill's job is to say,
BEFORE a test is written, what level and shape it needs to be honest —
catching that failure at design time instead of at a review months later.

## Level — pick the lowest that can still prove the claim

| Level | Proves | Fixture allowed? |
|---|---|---|
| **Unit** | pure function, one input/output contract | yes — the function IS the boundary |
| **Integration** | real adapters composed across a package boundary | disposable repo/worktree/registry fixture, never a stub standing in for the boundary itself |
| **Live** | a real external outcome (real git, real process, real HTTP) through the authoritative source | no — a fixture at this level is a downgrade, not a shortcut |

A claim that says "delivers," "deploys," "persists," or "ships" needs live
tier. A claim about a pure calculation needs unit tier and nothing more —
forcing live tier on a pure function is not rigor, it's noise that hides the
real live-tier gaps under a pile of slow, brittle tests.

## Shape — assertion vs golden-capture

Ask: **can the author state, in one sentence, exactly what "correct" means
before running the code?**

- Yes → assertion-based test. Write the expectation, then the test.
- No (the correct shape is "whatever the real system currently does, until a
  human reviews a change") → golden-capture. Run the seam, record the FULL
  observable result (return value, thrown error, side-effect journal), diff
  future runs against it. A delta is a question for a human, never an
  auto-pass or auto-fail.

Golden-capture is not a lesser form of testing — it exists specifically
because assertion-writing failed on complex orchestration surfaces this same
session: the author cannot accidentally assert something weaker than the
truth when they are not choosing what to assert.

## Procedure

1. **Identify the surface's SEAM** — its real, production-called entry point.
   If nothing in production calls it, that is not a testing question, it's an
   `architecture-reviewer` finding (dead code / no production caller) —
   route it there first. A test cannot prove a surface has no reason to exist.

2. **Classify the claim** the surface makes (calculation / composition /
   external effect) and pick the LOWEST level from the table above that can
   prove it. State the level explicitly in the checklist row — not "tested",
   but "unit: pure function" / "integration: composed across guard+delivery
   against a disposable worktree" / "live: real git commit against a
   disposable repo".

3. **Pick assertion vs golden-capture** using the one-sentence test above.

4. **For a claim naming an outcome word** (delivers/deploys/persists/ships/
   writes) — require a positive control: the SAME test run against a target
   KNOWN to succeed, before trusting a negative result from it. A test that
   never proves it CAN detect failure proves nothing when it passes.

5. **Report:**
   ```
   ## Testing Strategy
   | Surface | Claim | Level | Shape | Positive control needed? |
   ```

## Rules

- Never recommend live tier for a pure function, or unit tier for an
  external-effect claim — matching level to claim is the whole point.
- A recommendation with no seam identified is incomplete — say so, don't
  guess a seam that doesn't exist in production.
- This skill recommends; it does not write the test. Pair with the actual
  build task.

## Mechanical test-smell scoring — a separate, lower layer

Everything above answers "what SHAPE should this test be" before it's
written. `scripts/lib/test-smell-scoring.mjs` answers a different question
once a test exists: does its own construction show a known smell? Same
distinction as `solid-validator`/`architecture-reviewer` — this is FORM
applied to test code, not FIT or FUNCTION, and it runs mechanically over
existing `.test.mjs`/`.test.ts`/`*.spec.*` files, not as a pre-write
recommendation.

Language-independent in shape (pure functions over text/AST facts, same
discipline as `language-plugin.mjs` — no ts-morph import in the scoring file
itself). Rule IDs and several thresholds are reused from
[OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)
(MIT) — see the file header for exact file:line citations and what was
adapted vs. reused verbatim.

| Rule | Detects | Threshold |
|---|---|---|
| T1 Insufficient Tests | fewer test() blocks than exported functions/methods in the paired source file | `testCount < exportedUnitCount` (source count via the `NormalizedUnit` plugin contract, not a regex) |
| T2 Ignored Tests | `test.skip`/`it.skip`/`xit`/`xdescribe` | any occurrence |
| T5 Exhaustive Testing | too many assertions in one test() block | >10 per block |
| T6 Long Tests | oversized test() block body | >30 lines |
| T7 Slow Tests | literal `setTimeout`/`setInterval`/`sleep`/`delay` calls INSIDE a test's own body | any occurrence in-block |
| T8 Fragile Tests | `Date.now()`, bare `new Date()`, `Math.random()`, `process.env.*` referenced directly inside a test body | any occurrence in-block |
| T9 Duplicated Setup | near-identical `beforeEach`/`beforeAll` bodies ACROSS test files | ≥0.75 Jaccard similarity over normalized 3-token shingles (literals collapsed, identifiers not — see file header) |
| FIRST-Independent | a `let` declared outside test() and mutated inside 2+ separate test() blocks | requires both the declaration site AND ≥2 distinct mutation sites, not presence alone |

T3 (Test Per Class) and T4 (Untested Method) are deliberately not
implemented — see the file header's "Skipped" section for why faking them
would have been a weak check invented to fill a slot. Fast/Repeatable/
SelfValidating/Timely are likewise skipped as either duplicating T7/T8 or
not being smell checks at all.

Dogfooded against `rdc-harness`'s 47 real `*.test.mjs` files (2026-08-20):
71 findings (T5/T6/T8), plus T1 flagged `packages/core` (28 exported
members, 16 tests — the same `Harness` god-object `solid-score.mjs` already
flags on SOLID grounds) and three other packages. T2/T7(in-block)/T9/
Independent had zero real hits in that corpus — confirmed as true negatives
via grep positive-control before trusting the absence, and each rule was
separately proven to fire against a synthetic fixture exercising it.
