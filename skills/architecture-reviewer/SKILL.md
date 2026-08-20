---
name: architecture-reviewer
description: >-
  Usage `rdc:architecture-reviewer <path> [--diff <ref>]` — layering and
  dependency-direction review. Runs the mechanical Clean Architecture boundary
  check (rdc-solid-score) first, then dispatches judgment-level review for
  what the mechanical check can't see: layering choices that are technically
  legal but conceptually wrong. Call from rdc:review step 8b+, or standalone
  before merging a new package/module.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# architecture-reviewer — Layering & Dependency-Direction Review

## Why two passes, not one

A mechanical boundary check (`rdc-solid-score`'s Clean Architecture rule) can
only fail a check that was named in advance — "orchestrator X must import
port Y." It cannot judge a layering choice nobody wrote a rule for yet: a new
package importing three siblings when one delegate would do, a "shared"
utility module that has quietly become a second copy of business logic, a
port whose own shape leaks an implementation detail. That's a judgment call,
not a grep. This skill runs both, in order, because the mechanical pass is
cheap and exhaustive (never misses a NAMED rule) and the judgment pass is
expensive and irreplaceable (catches what nobody thought to name).

Dogfooded proof this distinction is real: `rdc-harness`'s `Harness` class
scores 68.5/100 on the plain weighted SOLID sum (mediocre, not damning) but
fails the mechanical boundary check outright — 6/6 required ports missing.
Neither number alone tells the whole story; both together do.

## When to Use

- Any PR that adds or restructures a package boundary
- Before merging a new orchestrator/use-case class
- Called from `rdc:review` step 8b+ alongside the SOLID score gate
- When a reviewer suspects "this could have just called the existing thing"

## Arguments

- `rdc:architecture-reviewer <path>` — full review of the target
- `rdc:architecture-reviewer <path> --diff <ref>` — new/changed code only

## Procedure

1. **Run the mechanical boundary check first — it is cheap, run it before
   dispatching anything expensive:**
   ```bash
   rdc-solid-score <path> --diff <ref> --config <repo>/.solid-score.yml --format json
   ```
   Read `boundaryFindings` from the JSON output. Any `satisfied: false` entry
   is a NAMED-RULE violation — report it directly, do not re-litigate it in
   the judgment pass below.

   If the target repo has no `.solid-score.yml` with a `boundaries` section,
   say so plainly rather than silently skipping this step — an architecture
   review with no boundary rules configured is an incomplete review, not a
   clean one.

2. **Dispatch the judgment pass — layering choices no rule was written for:**

   ```
   Agent({
     subagent_type: "pr-review-toolkit:code-reviewer",
     description: "architecture-reviewer judgment pass",
     prompt: "Review `git diff <ref>...HEAD` (or the full target if no --diff)
              for LAYERING and DEPENDENCY-DIRECTION issues the mechanical
              boundary check would not catch — it only fails rules that were
              named in advance. Look specifically for:
              (1) a module that reimplements logic a sibling package already
              owns, instead of importing and delegating to it — the
              `Harness`-shaped failure: a class with almost no dependencies of
              ANY kind can score fine on a generic DIP/coupling metric while
              still being the exact violation;
              (2) a 'shared'/'common'/'utils' module accumulating actual
              business logic rather than genuinely-shared primitives;
              (3) a port/interface whose own shape leaks a concrete
              implementation detail (a parameter that only makes sense for
              one adapter);
              (4) a new package importing more siblings than its stated
              responsibility justifies.
              Report each finding with severity (critical/high/medium/low),
              file:line, the concrete violation, and what delegation/
              boundary should exist instead. Return
              ARCHITECTURE_REVIEW_COMPLETE with:
              { critical_count, high_count, medium_count, low_count,
                findings: [{severity, file:line, issue, suggested_boundary}] }."
   })
   ```

3. **Merge both passes into one report.** The mechanical findings are
   certain (a named rule failed); the judgment findings carry the
   subagent's confidence and must be read that way — do not present them
   with equal certainty.

4. **Severity gate**, same shape as `rdc:review` step 8b:
   - Any mechanical boundary violation, or any `critical`/`high` judgment
     finding → verdict cannot be CLEAN.
   - `medium`/`low` judgment findings → recorded, verdict can still be CLEAN.
   - Zero findings on both passes → `ARCHITECTURE_REVIEW: CLEAN`.

5. **Report:**
   ```
   ## Architecture Review
   ### Mechanical (named-rule) violations
   | File | Required port | Satisfied |
   ### Judgment findings
   | Severity | File:Line | Issue | Suggested boundary |
   ## Verdict: CLEAN / HAS ISSUES
   ```

## Rules

- Never skip step 1 to save time — it is the cheap, certain half of the
  review, and it dogfooded a real violation this session.
- The judgment pass is advisory-plus-severity, not a rubber stamp on the
  mechanical pass; a clean mechanical result with high-severity judgment
  findings is still HAS ISSUES.
- If neither the target repo nor `--diff` is given, refuse rather than guess
  scope — an architecture review with an unstated scope is unfalsifiable.
