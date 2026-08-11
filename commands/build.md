---
name: rdc:build
description: >-
  Usage `rdc:build <epic-id|topic> [--unattended]` — dispatch typed agents from an epic, commit, push, update work items. The build engine. Use after rdc:plan or when the project lead says "build it".
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

2b. **PROVE IT ISN'T ALREADY BUILT (mandatory, mechanical — never skip):**
   Work items and plans are claims about the code, not state. A stale title,
   a stale plan, or an un-updated checklist is the default drift state, not
   an exception — nobody updates a work-item title when the thing it
   describes gets built. Before dispatching ANY agent, run all four checks
   below for every task in the wave. Never dispatch an agent to build
   something you have not just proven absent.

   | Check | Command | What a positive hit means |
   |---|---|---|
   | CodeFlow | `mcp__codeflow__codeflow query <topic/identifiers>` (or `node packages/codeflow/bin/codeflow.mjs context <topic>`) | The capability may already be indexed as built — read the returned symbols/files before assuming greenfield |
   | Identifier grep | `grep -rn "<key identifier from the task title>" apps/ packages/ sites/ models/` | A hit means the named thing exists somewhere — go read it before writing a new one |
   | Path history | `git log --all --diff-filter=A -- "**/<file-fragment>*"` | A hit means the file was already created — possibly at a DIFFERENT path than the task names. Check out that commit and read it |
   | Test names | Run the package's test suite and read the **test names**, not the pass count | Named tests are what say which behaviours are already proven — a passing suite with the target behaviour named means it's done |

   **Stop rule:** if any check returns a hit, correct the work item / plan
   status FIRST (this correction is part of the build, not follow-up work),
   then re-scope the dispatch to what's actually missing — a delta, not a
   rebuild. Only dispatch a full build when all four checks come back empty.

2c. **Route to the template epic, with an explicit checklist.** When work
   spawned from 2b needs its own work item, insert it under the correct
   template epic and pass an explicit `p_checklist` on `insert_work_item` —
   do not rely on inheritance. `insert_work_item` auto-inherits the parent
   epic's `definition_of_done` as the child's checklist, and a template
   epic's DoD produces required rows an unrelated task can never tick,
   silently blocking `done` at close time.

3. **Load the plan** (if exists): check `.rdc/plans/` for matching topic
   (fallback: `.rdc/plans/`). **A plan is evidence of intent, not evidence of
   state** — it tells you what was supposed to happen, never what actually
   happened to the code. Step 2b's checks are what tell you what's real;
   never dispatch an agent off a plan's task list alone.

4. **Read CLAUDE.md files** for all affected packages.

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
     - `"NEVER run pnpm build/test. NEVER modify files outside your scope."`
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
