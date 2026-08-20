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

## Named Violation Catalog

The judgment pass (step 2 below) checks this explicit list, not an open-ended
"look for layering issues." Each entry is adapted from a real, shipped
detector in [OnSightTeam/architecture-toolkit](https://github.com/OnSightTeam/architecture-toolkit)
(MIT) — the severities and structural shapes below are reused from its source,
not invented:

| # | Violation | Severity | Adapted from (architecture-toolkit, MIT) |
|---|---|---|---|
| 1 | **Framework imports in Entity/UseCase layers** — an inner layer directly imports a framework package (`express`, `react`, `mongoose`, `axios`, etc.) instead of depending on an abstraction it owns | **Critical** (Entities) / High (UseCases) | `src/agents/architecture-reviewer/tools/dependency-rule-validator.ts:98-113` — severity is literally `currentLayer === 'Entities' ? 'critical' : 'high'` (line 105) |
| 2 | **HTTP Request objects in Use Cases** — a `UseCase`/`Interactor` class touches `request.`/`req.` directly instead of receiving a plain DTO | **Critical** | `.../architecture-reviewer/tools/boundary-analysis-validator.ts:108-124` |
| 3 | **Direct database access in Use Cases** — a `UseCase`/`Interactor`/`Service` class calls `db.`, `database.`, `mongodb.`, `prisma.`, or raw `SELECT`/`INSERT`/`UPDATE` instead of going through a repository interface | **Critical** | `.../architecture-reviewer/tools/layer-separation-validator.ts:83-115` |
| 4 | **Business logic in Controllers/UI** — a file with UI indicators (`component`, `render`, `jsx`, `props`, `onclick`) also contains a long (100+ char body) `calculate`/`validate`/`process` function | **High** | `.../architecture-reviewer/tools/layer-separation-validator.ts:117-143` — the toolkit scores this **Medium** (line 134); this catalog escalates it to **High** because UI-embedded business logic is the shape most likely to silently duplicate a Use Case that already exists elsewhere, and it's the hardest of the six to unit-test in place |
| 5 | **Missing repository interfaces** — a `UseCase`/`Interactor` directly `new`s a concrete `Repository`/`Gateway`/`DataSource` instead of receiving an interface through its constructor; same shape one layer out: a `Controller` `new`s a concrete `UseCase` with no input-port interface | **High** | `.../architecture-reviewer/tools/boundary-analysis-validator.ts:44-63` |
| 6 | **Mixed architectural layers in a single file** — a file imports from 3+ of {entities, use-cases, controllers/adapters, frameworks/infrastructure} at once | **Medium** | `.../architecture-reviewer/tools/boundary-analysis-validator.ts:129-150` (`countLayerImports(code) >= 3`) |

These six are the NAMED checks. They sit alongside — not instead of — the four
harder-to-name judgment items already in the dispatch prompt below (the
`Harness`-shaped reimplementation, `shared`/`utils` scope creep, a leaking
port shape, and over-importing siblings): those four require reading intent,
not matching a shape, so they stay prose rather than a table row.

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
              named in advance. Check this NAMED list explicitly, each with
              its severity — do not substitute a vague 'look for layering
              issues' scan for it:
              (1) Framework imports in Entity/UseCase layers — CRITICAL if
              the file is an Entity, HIGH if it's a UseCase. An inner layer
              importing express/react/mongoose/axios/etc. directly instead of
              depending on an abstraction it owns.
              (2) HTTP Request objects in Use Cases — CRITICAL. A
              UseCase/Interactor touching `request.`/`req.` directly instead
              of a plain DTO.
              (3) Direct database access in Use Cases — CRITICAL. A
              UseCase/Interactor/Service calling `db.`/`database.`/ORM
              methods/raw SQL instead of a repository interface.
              (4) Business logic in Controllers/UI — HIGH. A UI-shaped file
              (component/render/jsx/props) containing a substantial
              calculate/validate/process function instead of delegating to a
              Use Case.
              (5) Missing repository interfaces — HIGH. A UseCase/Interactor
              `new`ing a concrete Repository/Gateway/DataSource, or a
              Controller `new`ing a concrete UseCase, with no interface at
              that boundary.
              (6) Mixed architectural layers in a single file — MEDIUM. A
              file importing from 3+ of {entities, use-cases,
              controllers/adapters, frameworks/infrastructure} at once.
              Also watch for the four judgment-only items no fixed rule can
              name: (7) a module that reimplements logic a sibling package
              already owns, instead of importing and delegating to it — the
              `Harness`-shaped failure: a class with almost no dependencies of
              ANY kind can score fine on a generic DIP/coupling metric while
              still being the exact violation;
              (8) a 'shared'/'common'/'utils' module accumulating actual
              business logic rather than genuinely-shared primitives;
              (9) a port/interface whose own shape leaks a concrete
              implementation detail (a parameter that only makes sense for
              one adapter);
              (10) a new package importing more siblings than its stated
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

## Worked Example — `rdc-harness`'s `Harness` class

Real target, read in full: [`C:/Dev/rdc-harness/packages/core/src/index.mjs`](file:///C:/Dev/rdc-harness/packages/core/src/index.mjs)
(398 lines, one exported class). What the updated judgment pass, checking the
named catalog above, actually produces against it:

```
## Architecture Review — rdc-harness/packages/core/src/index.mjs
### Mechanical (named-rule) violations
| File | Required port | Satisfied |
| index.mjs (Harness) | 6/6 ports (transaction, delivery, deploy, orchestration,
  boundary, work — one per sibling package) | false — 0/6 satisfied |

### Judgment findings
| Severity | File:Line | Issue | Suggested boundary |
| critical | index.mjs:18 | (1) Framework imports in Entity/UseCase layer — `Harness`'s
  methods are named like a UseCase/orchestrator (`createRun`, `deploy`,
  `recordDecision`) but the file imports `node:fs` (`appendFileSync`,
  `mkdirSync`, `readFileSync`, `writeFileSync`, `cpSync`) directly at module
  scope, not through an injected port. | Define a `Store` port
  (`appendEvent`, `readEvents`, `writeArtifact`) in the orchestration layer;
  implement the fs calls in an adapter under `packages/delivery` or
  `packages/deploy`, which already exist as sibling packages for exactly this. |
| critical | index.mjs:231-243 (`edit`), 245-264 (`save`) | (3) Direct
  filesystem access in Use-Case-shaped methods — `edit()` calls
  `writeFileSync(target.sourcePath, content)` and `save()` calls
  `readFileSync(target.sourcePath)` inline; this is the direct-I/O analogue of
  "direct database access in Use Cases" (the toolkit's own DB check is a
  proxy for exactly this shape — an inner-layer method reaching straight
  through to a storage primitive). | Route through the same `Store` port. |
| high (judgment #7) | index.mjs:49-394 (whole class) | `Harness` reimplements
  transaction handling (`#block`, `transaction.blocked` events), delivery
  (`shipDev`), deploy (`deploy`, `requestProduction`, `recordDecision`), and
  orchestration (`createRun`, `createTarget`) all in one class — the exact
  `Harness`-shaped failure this skill's own header names: 21 sibling packages
  exist (`packages/transaction`, `packages/delivery`, `packages/deploy`,
  `packages/orchestration`, `packages/boundary`, …) and `Harness` currently
  imports from none of them; it reimplements their responsibilities inline
  instead of delegating. It would still pass a generic SRP/coupling metric
  because its only external imports are `node:crypto` and `node:fs` — a
  narrow dependency *count* that hides a wide responsibility *surface*. |
  Split into a thin `Harness` facade that composes injected ports:
  `TransactionPort`, `DeliveryPort`, `DeployPort`, `OrchestrationPort`, each
  backed by its already-existing sibling package. |
| medium | index.mjs:1-24 (whole-file import block) | (6) Mixed layers — the
  file's own header explicitly enumerates three responsibilities it says it
  is "deliberately NOT" (session model, product catalog, scheduler) and then
  the class does all three anyway across its 10 public methods. | Same split
  as above; each extracted port owns exactly one of the header's three
  disclaimed responsibilities. |

## Verdict: HAS ISSUES (2 critical, 1 high, 1 medium)
```

This is a real result, not a hypothetical: `Harness` genuinely has zero
imports from any of its 21 sibling packages (confirmed via
`grep -r "from '.*packages/(transaction|delivery|deploy|orchestration|boundary)"`
against `index.mjs` — zero hits), and the mechanical boundary check already
dogfooded the "6/6 ports missing" finding referenced in this file's own
header above.
