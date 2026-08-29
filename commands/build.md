---
name: build
description: "rdc:build (epic-id) - [--no-review] — execute a planned epic: dispatch, gate, ship to dev"
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.


# rdc:build — Typed Agent Dispatch Engine

## When to Use
- Plan is approved and ready to execute
- Project lead says "build it", "go", "execute", "do not stop"
- An epic exists with child tasks ready for implementation
- Called by `rdc:overnight` as part of the automated build loop

## Arguments
- `rdc:build <epic-id>` — build from a specific Supabase epic
- `rdc:build <topic>` — find the epic by label/title match
- `rdc:build` (no args) — show open epics and ask which to build (interactive only)
- `rdc:build <epic-id> --unattended` — silent mode for overnight builds

## Agent Types & Guide Files

Every dispatched agent MUST read two files before starting — in this order:
1. `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` — credentials, git rules, completion report format
   (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` if `.rdc/` does not exist)
2. `{PROJECT_ROOT}/.rdc/guides/<type>.md` — role-specific guide
   (fallback: `{PROJECT_ROOT}/.rdc/guides/<type>.md`)

Include both lines in every agent prompt:
```
"Read {PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md first (fallback: .rdc/guides/agent-bootstrap.md), then {PROJECT_ROOT}/.rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md) before starting."
```

| Agent Type | Guide File | When to dispatch |
|-----------|-----------|-----------------|
| `frontend` | `.rdc/guides/frontend.md` | React components, pages, UI, Tailwind, animation |
| `backend` | `.rdc/guides/backend.md` | API routes, server components, database queries, auth |
| `data` | `.rdc/guides/data.md` | Migrations, schema changes, RPC functions |
| `design` | `.rdc/guides/design.md` | Visual design, brand palettes, OG images, token work |
| `infra` | `.rdc/guides/infrastructure.md` | CI/CD, deployment, DNS, SSL |
| `content` | `.rdc/guides/content.md` | Marketing copy, messaging, tone |
| `cs2` | `.rdc/guides/cs2.md` | CS 2.0 paradigm work (generic) |
| `hail` | `.rdc/guides/cs2.md` + `packages/hail/CLAUDE.md` | Grammar, DSL compiler, evolution |
| `pal` | `.rdc/guides/cs2.md` + `packages/pal/CLAUDE.md` | Sessions, moment windows, graph memory |
| `bpmn` | `.rdc/guides/cs2.md` + `docs/systems/<domain>/flowable-bpmn-architecture.md` | BPMN flows, governance |
| `virtue` | `.rdc/guides/cs2.md` + `packages/virtue-engine/CLAUDE.md` | Virtue weights, coherence, certification |
| `viz` | `.rdc/guides/frontend.md` + `.rdc/guides/design.md` | Custom viz components, charts, diagrams |

### How to classify a task → agent type

Read the task title and description, then:
- Mentions React, component, page, UI, Tailwind → `frontend`
- Mentions API route, server, database query, auth → `backend`
- Mentions migration, schema, table, RPC → `data`
- Mentions brand, palette, typography, OG image → `design`
- Mentions deploy, infrastructure, CI, DNS → `infra`
- Mentions copy, messaging, email template → `content`
- Mentions grammar, DSL, compiler → `hail`
- Mentions session, moment, memory graph → `pal`
- Mentions BPMN, flow, governance → `bpmn`
- Mentions virtue, coherence, certification → `virtue`
- Mentions visualization, chart, diagram, SVG → `viz`
- Multiple types? Dispatch multiple agents, each with its guide.

### Execution primitive for create/open/build/deploy checklist rows

When a dispatched agent's checklist row is to materialize a product shape,
open a signed edit session, run a target's declared build gates, or deploy
to dev-PM2/npm-registry, it uses the real, tested `rdc-harness` CLI instead
of hand-rolled bash/curl:

```bash
node C:/Dev/rdc-harness/bin/rdc-harness.mjs <create|open|edit|build|deploy> <slug> --monorepo-root <the dispatched agent's own worktree>
```

One JSON receipt per call, exit 0/1 — tick the checklist row with the parsed
receipt as evidence, not the raw dump. No Coolify awareness (production
deploy stays `/rdc:deploy`'s own path) and no live co-editing surface
outside `site-html`/`site-ts` (other classes get file-boundary save only —
real, currently-unbuilt gap for other product classes, not something to
paper over here). `open`/`edit` require `RDC_HARNESS_ISSUER_SECRET` set
explicitly per-session — never a default.

## Procedure

1. **Load the epic and its durable admission decisions:**
   ```sql
   SELECT get_work_items_by_epic('<epic-id>');
   ```
   - Read `design_review_state` and `status` for every executable child.
   - Only `automatic_approved`, `human_approved`, or legacy `not_required` rows may be considered for dispatch.
   - For `pending`, `needs_human`, or `rejected`, write an `admission_refocus` receipt, keep the child blocked, and route it to the reviewer/planner. **Do not dispatch it, retry it, or call the epic complete.**
   - Interactive (no args): show open epics, ask which to build
   - Unattended (no tasks found): escalate via advisor tool
   - **Read the epic's `plan_ref`, `spec_ref`, `architecture_ref`, and `scoping_statement` fields** (returned on the epic row itself). `scoping_statement` bounds what this build may touch — do not silently expand past it. If `architecture_ref` is set, this epic crosses an architectural boundary: read that doc now, before classifying or dispatching any task, and carry it into every agent prompt in step 7.

1a. **Run the durable CodeFlow supervisor before each wave and after every gate-changing action.**
   - Invoke `runOrchestrator()` with the project manifest, `SupabaseStateStore`, and the real phase dispatcher. It is the sole authority for resuming/refocusing a phase DAG; do not reconstruct waves by hand from task prose.
   - A returned `admission_refocus` or `pipeline_blocked` is a durable hold, not a failed attempt to work around. Preserve its task state and route the required Design Review or validator closure.
   - Only a returned `pipeline_complete` whose phase tasks are all design-review admitted **and** durably `done` permits an epic completion claim. If the project lacks a real dispatcher/manifest, report `BLOCKED: CodeFlow supervisor entrypoint unavailable` rather than emulating completion.

2. **CHECK FOR EXISTING WORK (mandatory — never skip):**
   ```sql
   -- Check if prototypes exist from earlier sessions
   SELECT name, component, source_path, status, notes
   FROM prototype_registry
   WHERE status IN ('prototype', 'converting')
   ORDER BY created_at DESC;

   -- Check for design decisions on this topic
   SELECT topic, context_type, summary, source
   FROM design_context
   WHERE topic ILIKE '%<epic-topic>%'
   ORDER BY created_at DESC;
   ```
   **If a prototype exists: ADAPT IT. Do not build from scratch.**
   Tell the agent: "Read <source_path> first and convert it to the production contract."
   
   **If design decisions exist: follow them.** Include the summary in the agent prompt.

3. **Load the plan** (if exists): check `.rdc/plans/` for matching topic (fallback: `.rdc/plans/`).

4. **Read CLAUDE.md files** for all affected packages, plus `docs/CODING-STANDARDS.md`
   (SOLID/Clean-Architecture standard — regen-root; skip if absent) — carry it into every
   dispatched agent prompt.

5. **Classify each task** → assign agent type from the table above.

6. **Use the supervisor-resolved waves** — parallelize only phases returned by `runOrchestrator()` after its durable admission check:
   - Wave 1: independent tasks (different packages/files)
   - Wave 2: tasks that depend on Wave 1 outputs
   - Wave 3: integration tasks

7. **For each wave — dispatch typed agents in parallel:**
   - Set work item to `in_progress` before dispatching
   - Each agent prompt MUST include:
     - `"Read {PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md first (fallback: .rdc/guides/agent-bootstrap.md), then {PROJECT_ROOT}/.rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md) before starting."`
     - Specific files to create/modify
     - Exact deliverables and commit message
     - The epic's `scoping_statement` — explicit boundary on what this task may and may not touch
     - `"NEVER run pnpm build/test. NEVER modify files outside your scope."`
   - **If the epic's `architecture_ref` is set:** include `"Read <architecture_ref> before implementing. Your task's checklist requires a checked architecture-fidelity-<slug> row before this item can close — when you tick it, its evidence must cite the specific section/boundary of <architecture_ref> your implementation conforms to, not just 'done'."` A task under an `architecture_ref` epic will hard-fail at the exit gate (step 9) without this row checked with real evidence.
   - Use `run_in_background: true` for parallel execution
   - NEVER let agents overlap on the same files

8. **Post-wave test gate (mandatory):**
   After all agents in a wave complete, before marking tasks done:
   ```bash
   # For each package modified in this wave:
   cd packages/<name> && npx vitest run 2>&1 | tail -20
   ```
   - All tests must pass before proceeding to next wave
   - If tests fail: fix before marking the wave done
   - NEVER use `pnpm build` or `pnpm turbo test` — vitest only per package
   - New code must have tests: if a modified package shows 0 new test files, flag it

9. **As agents complete:**
   - Verify commit landed on the development branch
   - Push to origin *(skip if `$RDC_TEST=1` — echo `[RDC_TEST] skipping git push` instead)*
   - Ensure the agent submitted `implementation_report.codeflow_post`, then set the work item to `review`; the validator closes `done`
   - Re-invoke `runOrchestrator()` after the durable status/gate update. A task in `review` remains incomplete even when its phase gate passed.
   - **If the epic's `architecture_ref` is set:** before the validator attempts `done`, confirm the task's checklist has a checked `architecture-fidelity-*` row with real evidence (a cited doc section, not a bare "matches"). `update_work_item_status(..., 'done')` will hard-reject otherwise — catching this here avoids a wasted validator round-trip.
   - Continue to next wave

   **If an agent fails:**
   - Interactive: diagnose before retrying
   - Unattended: retry once; on second failure escalate via advisor
     ```
     BUILD_STATUS: { wave, tasks_done, tasks_failed, commits, escalated: true }
     ```

10. **Final verification gate (mandatory — before marking work or epic done):**
    Dispatch the verify agent (see `guides/agents/verify.md`) across every package/app touched in this build.
    The Iron Law: **NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.**
    - Run `npx vitest run --dir <pkg>` fresh for each touched package
    - Run `npx tsc --noEmit --project <pkg>/tsconfig.json` for each
    - Read the full output — zero failures, zero type errors
    - If any step fails: fix and re-run the entire gate. Do not skip.
    - NEVER `pnpm build` / `pnpm test` / `pnpm -r` (crashes machine)
    - **ATF Test-Ladder / rdc-harness (WIP — best-effort, not a hard gate yet):** if a
      touched package/repo ships an ATF `STP-001.md` or an `rdc-harness`-style
      `tools/mutate-check.mjs`/`tools/proof-ledger.mjs` pair, run it and quote the result
      alongside vitest/tsc. A red mutation gate is a real finding — report it, do not
      silently drop it because it isn't wired into this checklist as required yet.
      Absence of either system in the target is not a failure; do not install one ad hoc.

11. **After verification passes:**
    - Push all commits:
      ```bash
      if [ "$RDC_TEST" != "1" ]; then
        git push origin {development-branch}
      else
        echo "[RDC_TEST] skipping git push origin {development-branch}"
      fi
      ```
    - Re-invoke `runOrchestrator()` and require its `pipeline_complete` receipt before `bump_epic_version()` or any epic completion claim. A clean code review or green test suite is not a substitute for admitted, validator-closed work items.
    - Report summary with verification evidence quoted

## Agent TDD Requirements

When dispatching agents, include in every prompt:
```
TDD REQUIREMENT: Write tests FIRST for new functions/modules.
Run: npx vitest run packages/<name> to verify red → implement → verify green.
NEVER run pnpm build or pnpm turbo. Use npx vitest run only.
```

## Rules
- Branch: development branch only (auto-commit, no confirmation needed)
- NEVER let two agents edit the same file
- NEVER run `pnpm build` (crashes system) — code only
- Every agent reads its guide file — no exceptions
- Update Supabase work items IN REAL TIME — not batch at end
- **Never dispatch, resume, or complete around `design_review_state`; the durable database result and `runOrchestrator()` receipt win over an agent's narrative**
- Push after each wave, not just at the end
- Unattended: NEVER pause — continue automatically
- Unattended: max 2 retries per task before escalating to advisor
