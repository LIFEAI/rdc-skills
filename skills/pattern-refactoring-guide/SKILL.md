---
name: pattern-refactoring-guide
description: >-
  Usage `rdc:pattern-refactoring-guide <path>` — turns a pattern-advisor
  recommendation (or a solid-validator/architecture-reviewer finding) into a
  concrete before/after refactor plan. Produces a plan, does not apply it.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# pattern-refactoring-guide — Concrete Refactor Plans

## Input contract

Takes a finding from one of the other five surfaces — a `pattern-advisor`
recommendation, a `solid-validator` low-score criterion, or an
`architecture-reviewer` boundary violation — and produces a step-ordered plan
a build agent can execute. It does not invent new findings; it does not
apply the refactor itself.

## Procedure

1. **Restate the finding** exactly as reported by the upstream skill —
   file:line, the score/violation, the evidence.

2. **Write the BEFORE** — the actual current code (a real excerpt, not a
   paraphrase).

3. **Write the AFTER** — the concrete target shape, real code, not a
   description of code.

4. **Order the steps** so each one leaves the codebase in a working state:
   - Extract the new shape ALONGSIDE the old one first (new class/module,
     unused by anything yet).
   - Migrate ONE call site, verify.
   - Migrate remaining call sites incrementally, verifying after each.
   - Delete the old shape only after zero call sites remain — verify with
     the same call-graph-with-positive-control method `clean-code-analyzer`
     uses for dead code, don't assume.

5. **Name the test that must go from red to green** (or the golden-capture
   delta that must appear) at each step — route through `testing-strategy`
   for the right level/shape if the finding doesn't already specify one.

6. **Report:**
   ```
   ## Refactor Plan — <finding source>: <file:line>
   ### Before
   ### After
   ### Steps (each leaves the tree working)
   ### Verification per step
   ```

## Rules

- Never skip straight from BEFORE to AFTER in one step for anything touching
  more than one call site — the incremental-migration order is the point;
  a plan that says "rewrite it" is not a plan.
- A plan with no verification step per stage is incomplete.
- This skill does not execute the plan — hand off to `rdc:build`/`rdc:fixit`.
