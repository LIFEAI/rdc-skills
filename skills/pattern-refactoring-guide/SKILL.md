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

5. **Estimate effort — low/medium/high — using named criteria, not a gut
   call.** Adapted from the `estimatedEffort` field actually shipped in
   [OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)'s
   `src/agents/pattern-refactoring-guide/tools/*.ts`, extended with the
   criterion its own examples expose a gap in (see below):

   | Effort | Criteria (any ONE qualifies) | toolkit precedent |
   |---|---|---|
   | **Low** | Single file, ≤3 call sites, no package-boundary crossing, mechanical (rename, extract-constant, extract-condition-to-named-method). | `introduce_parameter_object` (`refactoring-analyzer.ts:179`), `replace_magic_number` (`:234`), `decompose_conditional` (`code-smell-refactoring-guide.ts:121`) — all single-function, in-place edits. |
   | **Medium** | 4-15 call sites within the SAME package, OR a new abstraction introduced but consumed only inside the current package/module. | `extract_method` (`refactoring-analyzer.ts:57`) — "may need to pass many parameters" but stays in one file. `consolidate_duplicate_code` (`code-smell-refactoring-guide.ts:59`), Strategy/Factory/Null-Object pattern transforms (`pattern-transformation-guide.ts:52,109,169`) — new types, but all call sites are local. |
   | **High** | **Crosses a package boundary** (the extraction moves logic into or out of a different `packages/*`/`@regen/*` workspace), OR >15 call sites, OR — the criterion the toolkit's own field values don't cover — **the target carries a cross-cutting invariant that isn't locally checkable** (event ordering, transactional/append-only integrity, freeze-after-mutation semantics): call-site count alone UNDER-counts effort here, because migrating the invariant correctly matters more than how many call sites exist. | `extract_class` (`refactoring-analyzer.ts:116`) is the toolkit's own high-effort case — ">15 methods... requires careful dependency management" is the package-boundary risk stated in words even though the field only tracks method count. |

   **Call-site count is not sufficient on its own** — see the worked example
   below, where a target with *zero* external call sites is still HIGH
   effort because of the invariant clause.

6. **Name the test that must go from red to green** (or the golden-capture
   delta that must appear) at each step — route through `testing-strategy`
   for the right level/shape if the finding doesn't already specify one.

7. **Every step names what proves it succeeded — no exceptions, including
   intermediate steps.** This is stricter than the toolkit's own shipped
   examples: `refactoring-analyzer.ts`'s own `extract_method` plan has a
   `validation` field on steps 1, 3, 4 (`:69`, `:79`, `:84`) but step 2 — "extract
   each section into a separate method" (`:72-75`) — carries only a `code`
   field and NO validation, i.e. the toolkit's own reference plan has a step
   whose success is unstated. That gap is exactly what this rule closes: a
   step that only shows the code to write, with no stated proof it worked,
   is incomplete here even if the toolkit's own precedent shipped that way.
   Every step gets one of: a specific test name, a `tsc`/lint exit code, a
   call-site grep returning zero, or an explicit "no assertion possible,
   inspect manually" — never a bare code sample standing in for proof.

8. **Report:**
   ```
   ## Refactor Plan — <finding source>: <file:line>
   ### Before
   ### After
   ### Effort: low/medium/high — <which criterion triggered it>
   ### Steps (each leaves the tree working; each names its own proof)
   ### Verification per step
   ```

## Rules

- Never skip straight from BEFORE to AFTER in one step for anything touching
  more than one call site — the incremental-migration order is the point;
  a plan that says "rewrite it" is not a plan.
- A plan with no verification step per stage is incomplete — and "per
  stage" means literally every step, not just the final one; a step with a
  code sample and no proof is a rewrite instruction wearing a plan's
  clothing.
- Never report effort from call-site count alone — always check the
  package-boundary and cross-cutting-invariant criteria too; a low
  call-site count on an invariant-bearing target is still HIGH.
- This skill does not execute the plan — hand off to `rdc:build`/`rdc:fixit`.

## Worked Example — extracting `rdc-harness`'s `Harness` god-object

Chained input: the `architecture-reviewer` worked example (see that skill's
own SKILL.md) found `Harness` in
[`C:/Dev/rdc-harness/packages/core/src/index.mjs`](file:///C:/Dev/rdc-harness/packages/core/src/index.mjs)
reimplementing transaction/delivery/deploy/orchestration logic inline instead
of delegating to the sibling packages that already exist for each. This is
that finding turned into a plan.

```
## Refactor Plan — architecture-reviewer: packages/core/src/index.mjs:49-394 (Harness)

### Before
class Harness {
  deploy({ handleId }) {
    const { handle, target, snapshot } = this.#bind(handleId, 'deploy');
    const approved = Object.values(snapshot.decisions).some(...);
    if (!approved) throw new RefusedError(...);
    const to = join(this.#root, 'artifacts', 'production', ...);
    this.#adapters.writeArtifact({ from: src.path, to });   // inline delivery
    this.#emit({ type: 'deployed', ... });
  }
  // + 9 more methods, same shape: inline logic that belongs to a sibling package
}

### After
class Harness {
  constructor({ root, clock, adapters, deployPort } = {}) {
    ...
    this.#deployPort = deployPort ?? new DefaultDeployPort({ root, adapters });
  }
  deploy({ handleId }) {
    const { handle, target, snapshot } = this.#bind(handleId, 'deploy');
    const receipt = this.#deployPort.deploy({ handle, target, snapshot });
    this.#emit({ type: 'deployed', ...receipt });
  }
}
// packages/deploy/src/default-deploy-port.mjs — owns the artifact-path/approval logic

### Effort: HIGH — package-boundary crossing (criterion 3), not call-site
count (criterion 2 would say LOW: `grep -rn "new Harness(" packages/` outside
`packages/core/test/` returns ZERO hits today — `Harness` isn't consumed
anywhere else yet). The invariant clause is what actually drives this to
HIGH: every method must keep emitting to the same append-only event log with
the same monotonic `#seq`, and the file's own comments (`index.mjs:103-110`)
document a prior real bug where a spread copy silently defeated a freeze
invariant — this is exactly the "target carries a cross-cutting invariant
that isn't locally checkable" case a call-site count would miss entirely.

### Steps (each leaves the tree working; each names its own proof)
1. Define `DeployPort`/`DeliveryPort`/`TransactionPort`/`OrchestrationPort`
   interfaces (method signatures only, in `packages/deploy`, `packages/delivery`,
   `packages/transaction`, `packages/orchestration` respectively) — unused by
   `Harness` yet.
   Validation: `npx tsc --noEmit` (or the repo's JS-equivalent lint) passes
   with the new files added; zero import changes in `index.mjs` yet, so the
   existing test suite is still 100% green with zero deltas.
2. Implement `DefaultDeployPort` in `packages/deploy`, moving `deploy()`'s
   artifact-path + approval-check logic verbatim out of `Harness` into it.
   Validation: a new unit test in `packages/deploy/test/` exercises
   `DefaultDeployPort.deploy()` directly with a fixture snapshot/handle and
   asserts the same receipt shape `Harness.deploy()` used to return.
3. Wire `Harness`'s constructor to accept an injected `deployPort` (default:
   `new DefaultDeployPort(...)`), and change `deploy()` to call
   `this.#deployPort.deploy(...)` instead of inline logic.
   Validation: `packages/core/test/site-html-lifecycle.test.mjs` (the
   existing suite) passes unmodified — same assertions, same call signature,
   only the internal implementation moved.
4. Repeat steps 2-3 for `shipDev`→`DeliveryPort`, `requestProduction`/
   `recordDecision`→`TransactionPort`, `createRun`/`createRepository`/
   `createTarget`→`OrchestrationPort`, one method-group at a time.
   Validation per group: same pattern as step 3 — the existing lifecycle
   test suite passes unmodified after each group's swap, never after all
   four at once.
5. Once all four ports are wired, grep `index.mjs` for `node:fs` and
   `node:crypto` imports used OUTSIDE the four new ports.
   Validation: the grep returns zero matches outside `#emit`/`#load` (the
   event-log read/write, which is intentionally NOT extracted — it's the
   spine, not a layering violation per this skill's own header) — this is
   the positive-control check that no inline I/O was missed.
## Verdict: HIGH effort, 5 steps, each with a named proof; zero external
call sites means the migration is low-RISK to sequence but not low-EFFORT —
the two are different axes and this plan's Effort line says so explicitly.
```
