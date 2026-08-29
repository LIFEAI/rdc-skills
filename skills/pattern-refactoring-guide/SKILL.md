---
name: pattern-refactoring-guide
description: "rdc:get-refactoring-plan (finding) — turns a pattern-advisor recommendation (or a solid-validator/architecture-reviewer finding) into a concrete..."
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# pattern-refactoring-guide — Concrete Refactor Plans

## Input contract

Takes a finding from one of two sources — an upstream surface (a
`pattern-advisor` recommendation, a `solid-validator` low-score criterion, an
`architecture-reviewer` boundary violation), OR this skill's own mechanical
detection layer, `rdc-refactoring-score` (`scripts/refactoring-score.mjs`) —
and produces a step-ordered plan a build agent can execute. It does not
invent new findings beyond what a cited detector reported; it does not apply
the refactor itself.

## Procedure

1. **Find or receive the finding.** Two paths, either is a valid start:
   - **Upstream finding already exists** — an emitted `pattern-advisor` /
     `solid-validator` / `architecture-reviewer` result. Skip to step 2.
   - **No finding yet — detect candidates directly.** Run
     `node scripts/refactoring-score.mjs <path> --format json` (installed
     bin: `rdc-refactoring-score`). It is a real, deterministic, AST-based
     scanner — NOT this skill reasoning about the code — covering nine
     refactoring types: `extract-method`, `extract-class`,
     `introduce-parameter-object`, `replace-magic-number`,
     `consolidate-duplicate-code`, `decompose-conditional`,
     `strategy-transform`, `factory-transform`, `null-object-transform`.
     Detection logic: `scripts/lib/refactoring-scoring.mjs`. Every finding
     carries a real file:line and a mechanical effort signal (see step 5).
     A "zero findings" result on a real target is only trustworthy once the
     tool's own positive control passed (it runs one automatically and
     reports `effortScope.positiveControlOk` in JSON output / the "Effort
     scan" line in text output — per
     `.claude/rules/prove-absence-positive-control.md`, treat a failed
     control as "unmeasured", never as "clean").
     Two thresholds here are DELIBERATELY DIFFERENT from
     `clean-code-analyzer`'s mechanical rules even though they read the same
     underlying fact: `extract-method` fires at >25 statements (this tool)
     vs. clean-code's F1 at >20 statements; `introduce-parameter-object`
     fires at >4 params (this tool) vs. clean-code's F2 at >3 params. Both
     numbers are architecture-toolkit's own real thresholds for their
     respective domains (`refactoring-analyzer.ts:49,171`) — cite the
     difference, do not silently merge the two tools' output.

2. **Restate the finding** exactly as reported by the upstream skill or by
   `rdc-refactoring-score` — file:line, the score/violation, the evidence.

3. **Write the BEFORE** — the actual current code (a real excerpt, not a
   paraphrase).

4. **Write the AFTER** — the concrete target shape, real code, not a
   description of code.

5. **Order the steps** so each one leaves the codebase in a working state:
   - Extract the new shape ALONGSIDE the old one first (new class/module,
     unused by anything yet).
   - Migrate ONE call site, verify.
   - Migrate remaining call sites incrementally, verifying after each.
   - Delete the old shape only after zero call sites remain — verify with
     the same call-graph-with-positive-control method `clean-code-analyzer`
     uses for dead code, don't assume.

6. **Estimate effort — low/medium/high — using named criteria, not a gut
   call.** Adapted from the `estimatedEffort` field actually shipped in
   [OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)'s
   `src/agents/pattern-refactoring-guide/tools/*.ts`, extended with the
   criterion its own examples expose a gap in (see below). When the finding
   came from `rdc-refactoring-score` (step 1), don't re-derive this table by
   hand — the tool already computed the mechanical half of it: it re-walks
   the SAME cross-file reference-graph mechanism `clean-code-scoring.mjs`'s
   G9 dead-export check uses (`plugin.referenceSitesOf`, built on
   `findReferencesAsNodes`, gated behind its own positive control) and
   reports each unit's real call-site count and whether any reference
   crosses a `packages/*`/`apps/*` boundary. The one criterion below it
   CANNOT compute — a cross-cutting invariant that isn't locally checkable —
   is always a human judgment call; the tool flags `invariantCheckRequired:
   true` as a reminder wherever boundary-crossing or >15 call sites already
   pushed it to High, but never claims to have evaluated the invariant
   itself.

   | Effort | Criteria (any ONE qualifies) | toolkit precedent |
   |---|---|---|
   | **Low** | Single file, ≤3 call sites, no package-boundary crossing, mechanical (rename, extract-constant, extract-condition-to-named-method). | `introduce_parameter_object` (`refactoring-analyzer.ts:179`), `replace_magic_number` (`:234`), `decompose_conditional` (`code-smell-refactoring-guide.ts:121`) — all single-function, in-place edits. |
   | **Medium** | 4-15 call sites within the SAME package, OR a new abstraction introduced but consumed only inside the current package/module. | `extract_method` (`refactoring-analyzer.ts:57`) — "may need to pass many parameters" but stays in one file. `consolidate_duplicate_code` (`code-smell-refactoring-guide.ts:59`), Strategy/Factory/Null-Object pattern transforms (`pattern-transformation-guide.ts:52,110,168`) — new types, but all call sites are local. |
   | **High** | **Crosses a package boundary** (the extraction moves logic into or out of a different `packages/*`/`@regen/*` workspace), OR >15 call sites, OR — the criterion the toolkit's own field values don't cover — **the target carries a cross-cutting invariant that isn't locally checkable** (event ordering, transactional/append-only integrity, freeze-after-mutation semantics): call-site count alone UNDER-counts effort here, because migrating the invariant correctly matters more than how many call sites exist. | `extract_class` (`refactoring-analyzer.ts:116`) is the toolkit's own high-effort case — ">15 methods... requires careful dependency management" is the package-boundary risk stated in words even though the field only tracks method count. |

   **Call-site count is not sufficient on its own** — see the worked example
   below, where the real count (8) sits in the Medium range by call-site
   count alone, yet the target is still HIGH effort because of the
   package-boundary and invariant clauses.

7. **Name the test that must go from red to green** (or the golden-capture
   delta that must appear) at each step — route through `testing-strategy`
   for the right level/shape if the finding doesn't already specify one.

8. **Every step names what proves it succeeded — no exceptions, including
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

9. **Report:**
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
of delegating to the sibling packages that already exist for each. `rdc-
refactoring-score` independently detects the SAME target via step 1's own
mechanical path — a real run (`node scripts/refactoring-score.mjs
C:/Dev/rdc-harness/packages/core/src/index.mjs`) reports:

```
[extract-class] [high] Harness — 24 methods (over 15) — violates Single
Responsibility, candidate for Extract Class
```

24 methods, not the loose "+ 9 more methods" this example previously said —
the real count once `memberEntries()` visits constructors, getters/setters,
and arrow-property methods too, not just `cls.getMethods()`. This is that
finding turned into a plan.

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
  // + 23 more methods, same shape: inline logic that belongs to a sibling package
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

### Effort: HIGH — package-boundary crossing and the invariant clause, NOT
call-site count. `rdc-refactoring-score`'s real reference-graph scan
(`plugin.referenceSitesOf('packages/core/src/index.mjs', 'Harness', ...)`,
positive control passed) reports **8 cross-file references**, all within
`packages/core` itself: `index.mjs:75`'s own internal factory call
(`new Harness(...)`), plus 7 in `packages/core/test/site-html-lifecycle.test.mjs`
— the `import { Harness, ... }` statement (line 20), 4 `new Harness(...)`
construction sites (lines 40/55/70/94), and 2 static-method calls,
`Harness.resume(...)` (line 142) and `Harness.replay(...)` (line 296). This
is a REAL demonstration of why the real reference-graph walk
(`findReferencesAsNodes`) is used here instead of a text grep: a naive
`grep -rn "new Harness(" --include="*.mjs"` finds only 5 of these 8 —
the import statement and both static-method calls are invisible to that
grep, and a `new Harness(...)` regex would silently undercount call sites on
any class whose API includes static factory/replay methods. By call-site
count alone (8, same package) criterion 2 says **Medium** — this example
previously speculated a call-site count of zero and a resulting "criterion 2
would say LOW", which the tool's real output does not bear out; correcting
that here matters because it is exactly the trap this rule exists to prevent
(see "Call-site count is not sufficient on its own" above). What actually drives
this to HIGH is criterion 3: the refactor's real target is package-boundary
crossing (the extraction moves deploy/delivery/transaction/orchestration
logic OUT of `packages/core` and INTO `packages/deploy`, `packages/delivery`,
etc. — those packages are not yet Harness's callers, but they become its
collaborators after the extract), plus the invariant clause — every method
must keep emitting to the same append-only event log with the same monotonic
`#seq`, and the file's own comments (`index.mjs:103-110`) document a prior
real bug where a spread copy silently defeated a freeze invariant. That
invariant is exactly the case a mechanical call-site count cannot see, which
is why `rdc-refactoring-score` reports `invariantCheckRequired: true`
whenever boundary-crossing or a >15-call-site result already pushes it to
High, but leaves the actual invariant judgment to this step.

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
## Verdict: HIGH effort, 5 steps, each with a named proof; 8 call sites, all
WITHIN `packages/core` (zero from any OTHER package today) means the
migration is low-RISK to sequence but not low-EFFORT — the two are different
axes and this plan's Effort line says so explicitly.
```
