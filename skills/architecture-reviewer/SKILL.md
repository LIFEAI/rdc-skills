---
name: architecture-reviewer
description: >-
  Usage `rdc:architecture-reviewer <path> [--config <file>] [--diff <ref>]` —
  Clean Architecture boundary/dependency-direction/layer-separation review.
  Runs TWO mechanical scorers first — `rdc-architecture-score` (layer
  classification, inward-dependency rule, framework coupling, missing
  repository/port abstractions, HTTP/DB leaks into Use Cases, circular
  layer dependencies) and `rdc-solid-score`'s orchestrator/port boundary
  check — then dispatches judgment-level review for the ONE thing neither
  can see: whether an abstraction boundary makes architectural SENSE for
  this domain, not just whether it has the right shape. Call from
  rdc:review step 8b+, or standalone before merging a new package/module.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# architecture-reviewer — Layering & Dependency-Direction Review

## Why this is now mostly mechanical, not judgment-dispatch

This skill used to run ONE mechanical check (`rdc-solid-score`'s named
orchestrator/port boundary rule) and push everything else — framework
imports leaking into inner layers, DB/HTTP access inside Use Cases, missing
repository interfaces, layer-mixing, circular layer dependencies — into a
dispatched judgment pass, on the theory that "mechanical facts don't exist
yet for this domain."

That premise was checked against the actual source it was adapted from and
found wrong. `architecture-toolkit`'s own
[`.claude/skills/review-arch.md`](https://github.com/OnSightTeam/architecture-toolkit)
does not dispatch judgment for any of this — it shells out to
`node dist/cli.js --agents=architecture <paths>`, a fully deterministic CLI.
There is no LLM judgment step in the source project for Clean Architecture
boundary/dependency/layer detection at all: it is glob-based layer
classification plus regex import/text matching, because that is what the
Dependency Rule actually needs — WHICH FILE, WHICH FOLDER, WHICH IMPORT
TARGET — not an AST, and not an opinion.

`scripts/lib/architecture-scoring.mjs` ports that detection logic (see its
header for full provenance — three files fetched and read in full from
`github.com/OnSightTeam/architecture-toolkit`, MIT). It runs as
`rdc-architecture-score` alongside the pre-existing `rdc-solid-score`
boundary check, which is a DIFFERENT, complementary mechanism (an
explicitly-declared `{orchestrator, requiredPorts}` rule per repo, not
layer classification) and stays exactly as it was.

What is genuinely LEFT as judgment — the one thing neither scorer can do —
is deciding whether an abstraction boundary makes architectural SENSE for
this specific domain: a `Harness`-shaped class that reimplements logic its
own sibling packages already own, a `shared`/`utils` module quietly
accumulating business logic, a port whose shape leaks an implementation
detail, a package importing more siblings than its stated job justifies.
None of those are a shape a glob/regex scanner can match — they require
reading INTENT against the code that implements it. That is Step 2 below,
and it is now the ONLY judgment step.

## When to Use

- Any PR that adds or restructures a package boundary
- Before merging a new orchestrator/use-case class
- Called from `rdc:review` step 8b+ alongside the SOLID score gate
- When a reviewer suspects "this could have just called the existing thing"

## Arguments

- `rdc:architecture-reviewer <path>` — full review of the target
- `rdc:architecture-reviewer <path> --config <file>` — non-default layer
  classification (see `lib/architecture-scoring.mjs`'s `DEFAULT_LAYERS` for
  the shape; a repo that doesn't name its folders `entities`/`use-cases`/
  `adapters`/`frameworks` needs its own `.architecture-score.yml`)
- `rdc:architecture-reviewer <path> --diff <ref>` — new/changed code only
  (scope the file list to the diff before invoking either scorer)

## Mechanical Rule Catalog — `rdc-architecture-score`

Every row cites the exact `architecture-toolkit` file:line it is ported or
adapted from (full citations live in `lib/architecture-scoring.mjs`'s
per-rule comments — read them before trusting a finding's severity).

| Rule ID | What it detects | Severity | Confidence basis |
|---|---|---|---|
| `dependency-direction` | An inner-layer file imports a more-outer layer (Entities importing UseCases, UseCases importing Frameworks, etc.) | Critical | `high` when the import RESOLVES to a real scanned file with a known layer; `low` when only the import specifier text is keyword-matched (the toolkit's own, weaker, method) |
| `framework-coupling` | A non-Frameworks-layer file imports a known framework/library (express, react, mongoose, prisma, aws-sdk, pg, …) | Critical (Entities) / High (everything else non-Frameworks) | `high`, except `medium` for the three generic-word indicators (`http`, `fetch`, `request`) the toolkit's own list carries, which real false-positive on an unrelated local variable or Node's builtin `node:http` |
| `missing-abstraction` (5 subtypes) | `missing-repository-interface` (UseCase `new`s a concrete Repository/Gateway/DataSource) · `missing-input-port` (Controller `new`s a concrete UseCase, no Port interface declared) · `http-request-in-usecase` (`request.`/`req.` referenced in a UseCase file) · `direct-db-access-in-usecase` (`db.`/raw SQL in a UseCase/Interactor/Service) · `data-structure-leak` (a Controller returns/types a value as an Entity) | High/Critical per subtype | `high` for the first three (unambiguous regex shape); `medium`/`low` for db-access and data-structure-leak (broader textual patterns, real false-positive risk — disclosed per-subtype) |
| `mixed-concerns` (bonus, beyond the task's 4 required categories) | Business-rule vocabulary and infrastructure vocabulary both appear in one file | High | `low` — whole-file word-list co-occurrence, same heuristic class as `clean-code-analyzer`'s N2 |
| `ui-business-logic-mixing` (bonus) | A 100+ char `calculate`/`validate`/`process` function body alongside UI indicators | Medium | `medium` |
| `mixed-layer-imports` (bonus) | A file imports from 3+ distinct layers | Medium | `medium` |
| `circular-layer-dependency` | A REAL cycle in the layer-import graph, built from RESOLVED file imports and walked with the SAME ADP algorithm `package-metrics.mjs` already uses for package-level cycles (`findCycles`, reused not reimplemented) — this is STRONGER than `architecture-toolkit`'s own circular check, which is a `"../../.."`-depth proxy that is neither necessary nor sufficient for an actual cycle (see `lib/architecture-scoring.mjs`'s header for why that half was deliberately NOT ported) | High | `high` — built only from resolved edges, not keyword guesses |

**Layer classification is config-driven, not hardcoded.** `DEFAULT_LAYERS`
covers the canonical four rings (`entities`/`domain`, `use-cases`/
`usecases`/`application`, `adapters`/`controllers`/`presenters`/`gateways`,
`frameworks`/`infrastructure`) by path glob, with a class/interface-name
regex fallback (ported from the toolkit's own `detectLayer`). A file
matching NEITHER is reported `layer: null` / unclassified — it is never
silently defaulted to any specific layer (the toolkit's own `detectLayer`
defaults an unmatched file to `Frameworks`; this port deliberately does
not, because "we don't know" and "this is definitely the outermost ring"
are different claims). A repo with different folder names supplies its own
`layers:` in `--config <file>`.

## Procedure

1. **Run both mechanical scorers first — cheap, exhaustive, never skip:**
   ```bash
   rdc-architecture-score <path> [--config <file>] --format json
   rdc-solid-score <path> --diff <ref> --config <repo>/.solid-score.yml --format json
   ```
   Read `results[].rules` from `rdc-architecture-score` for every finding
   above; read `boundaryFindings` from `rdc-solid-score` for the
   orchestrator/port rule — a DIFFERENT, complementary check (an
   explicitly-declared `{orchestrator, requiredPorts}` rule per repo, not
   layer classification). Report `unclassifiedFiles` honestly — a file
   with no glob/name-hint match got NO layer-aware findings run against it,
   which is not the same as "clean."

   If the target repo has no `.solid-score.yml` `boundaries` section, or no
   `.architecture-score.yml` `layers` override where the default four rings
   don't apply, say so plainly — a review that silently skipped a
   configurable check is incomplete, not clean.

2. **Dispatch the ONE remaining judgment step — architectural SENSE, not
   shape:**

   ```
   Agent({
     subagent_type: "pr-review-toolkit:code-reviewer",
     description: "architecture-reviewer judgment pass",
     prompt: "Review `git diff <ref>...HEAD` (or the full target if no
              --diff) for architectural boundary choices that are
              technically LEGAL — no mechanical rule catches them — but
              conceptually WRONG for this domain. The mechanical scorers
              (rdc-architecture-score, rdc-solid-score) already caught
              layer-direction violations, framework coupling, missing
              repository/port abstractions, HTTP/DB leaks into Use Cases,
              layer-mixing, and circular layer dependencies — do NOT
              re-litigate those. Check ONLY these four, which require
              reading INTENT against the implementation, not matching a
              shape:
              (1) a module that reimplements logic a sibling package
              already owns instead of importing and delegating to it — the
              `Harness`-shaped failure: a class with almost no external
              dependencies of ANY kind can score fine on a generic
              DIP/coupling metric while still being exactly this;
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

3. **Merge all three into one report.** The two mechanical scorers'
   findings are certain (a named rule failed, or a real graph cycle
   exists); the judgment findings carry the subagent's confidence — do
   not present them with equal certainty. Within the mechanical findings
   themselves, honor each finding's own `confidence` field (see the
   catalog table) — a `low`-confidence mechanical finding is real evidence
   worth a look, not a certainty either.

4. **Severity gate**, same shape as `rdc:review` step 8b:
   - Any `critical`/`high` mechanical finding, `rdc-solid-score` boundary
     violation, or `critical`/`high` judgment finding → verdict cannot be
     CLEAN.
   - `medium`/`low` findings from either source → recorded, verdict can
     still be CLEAN.
   - Zero findings across all three → `ARCHITECTURE_REVIEW: CLEAN`.

5. **Report:**
   ```
   ## Architecture Review
   ### Mechanical — rdc-architecture-score (layer/dependency/boundary)
   | Rule | File | Severity | Confidence | Detail |
   ### Mechanical — rdc-solid-score (orchestrator/port boundary)
   | File | Required port | Satisfied |
   ### Unclassified files (no layer-aware rule ran)
   ### Judgment findings — architectural sense
   | Severity | File:Line | Issue | Suggested boundary |
   ## Verdict: CLEAN / HAS ISSUES
   ```

## Rules

- Never skip step 1 to save time — both scorers are cheap and certain, and
  each has independently dogfooded a real finding (see below).
- The judgment pass is advisory-plus-severity, not a rubber stamp on the
  mechanical passes; a clean mechanical result with high-severity judgment
  findings is still HAS ISSUES.
- Do not report a mechanical finding without its `confidence` field — a
  `low`-confidence heuristic hit (e.g. `data-structure-leak`'s broad
  `Entity`-substring match) is worth a look, never a certainty.
- If neither the target repo nor `--diff` is given, refuse rather than
  guess scope — an architecture review with an unstated scope is
  unfalsifiable.

## Dogfood evidence — real, not hypothetical

Two DIFFERENT real targets confirm the mechanism works and is honest about
its own limits:

**A constructed positive-control fixture** (per
`.claude/rules/prove-absence-positive-control.md`) — a 4-file Clean
Architecture layout with a KNOWN violation of each required category —
correctly produced ALL of: 2 `dependency-direction` criticals (Entities and
UseCases each importing the Frameworks-layer file), 1 `framework-coupling`
critical (`express` imported into Entities), 5 `missing-abstraction`
findings across all 5 subtypes, and a real `circular-layer-dependency`
finding (`Frameworks -> UseCases -> Frameworks`, from two files that
genuinely import each other). This run also caught a real bug in the
scorer's own glob matcher — `**/frameworks/**` failed to match a TOP-LEVEL
`frameworks/db-client.mjs` path (no parent directory to supply the literal
slash the naive translation required) — fixed before ship, see
`lib/architecture-scoring.mjs`'s `globToRegExp` header for the full story.

**Two real fleets that do NOT use Clean-Architecture folder/class-naming
conventions** (`rdc-harness/packages`, 85 files; this repo's own `scripts/`,
36 files) correctly report ZERO `dependency-direction`/`framework-coupling`/
`missing-abstraction` findings — confirmed as a GENUINE absence, not a
broken scanner, by an independent `grep -rE 'class\s+\w+(UseCase|Interactor|
Controller)'` across both trees (zero hits, matching the scorer's own
report). Both correctly report every scanned file as `unclassified` — real
honesty, not a silent false-positive from defaulting to a layer. The
layer-independent `mixed-concerns` heuristic still fires (34/54 hits
respectively) at its disclosed `low` confidence, the same character as
`clean-code-analyzer`'s N2 — worth a look, not a certainty.

## Worked Example — `rdc-harness`'s `Harness` class, THREE sources now

Real target, read in full: [`C:/Dev/rdc-harness/packages/core/src/index.mjs`](file:///C:/Dev/rdc-harness/packages/core/src/index.mjs)
(398 lines, one exported class). This is now a THREE-source report, and it
is a genuinely instructive case: `Harness`'s failure is NOT a Clean
Architecture layer violation (the file uses no `entities`/`use-cases`/
`adapters`/`frameworks` folder or class-naming convention at all — that's
a different codebase style, package-oriented rather than layer-oriented),
so `rdc-architecture-score` correctly abstains rather than fabricating a
layer-based finding:

```
## Architecture Review — rdc-harness/packages/core/src/index.mjs

### Mechanical — rdc-architecture-score
UNCLASSIFIED (no layer glob or name-hint matched `index.mjs`) — zero
layer-aware findings ran. This is an honest abstention, not a clean result:
`Harness`'s failure mode is package-level (see below), not layer-level.

### Mechanical — rdc-solid-score (orchestrator/port boundary)
| File | Required port | Satisfied |
| index.mjs (Harness) | 6/6 ports (transaction, delivery, deploy, orchestration,
  boundary, work — one per sibling package) | false — 0/6 satisfied |

### Judgment findings — architectural sense
| Severity | File:Line | Issue | Suggested boundary |
| high (judgment #1) | index.mjs:49-394 (whole class) | `Harness` reimplements
  transaction handling (`#block`, `transaction.blocked` events), delivery
  (`shipDev`), deploy (`deploy`, `requestProduction`, `recordDecision`), and
  orchestration (`createRun`, `createTarget`) all in one class — the exact
  `Harness`-shaped failure: 21 sibling packages exist (`packages/transaction`,
  `packages/delivery`, `packages/deploy`, `packages/orchestration`,
  `packages/boundary`, …) and `Harness` currently imports from none of them;
  it reimplements their responsibilities inline instead of delegating. It
  would still pass a generic SOLID/coupling metric because its only external
  imports are `node:crypto` and `node:fs` — a narrow dependency *count*
  hiding a wide responsibility *surface*. | Split into a thin `Harness`
  facade that composes injected ports: `TransactionPort`, `DeliveryPort`,
  `DeployPort`, `OrchestrationPort`, each backed by its already-existing
  sibling package. |

## Verdict: HAS ISSUES (0/6 ports satisfied, 1 high judgment finding)
```

This is a real result, not a hypothetical: `Harness` genuinely has zero
imports from any of its 21 sibling packages (confirmed via
`grep -r "from '.*packages/(transaction|delivery|deploy|orchestration|boundary)"`
against `index.mjs` — zero hits), `rdc-solid-score` genuinely reports 0/6
ports satisfied, and `rdc-architecture-score` genuinely reports the file
unclassified — three independently-verified facts, not one narrative.
