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

## Agent Dispatch — Non-Negotiable Defaults

> These apply to EVERY Task call in this skill. No exceptions.

```
max_turns: 70          ← REQUIRED on every Task dispatch — never omit
model: claude-opus-4-7 ← REQUIRED — never let the model default or fall back
```

Setting `max_turns: 70` prevents early stopping under Anthropic's reduced effort defaults.
Setting `model: claude-opus-4-7` prevents silent fallback to Sonnet under usage caps.

If a task is simple (<5 files, no cross-package deps), `max_turns: 30` is acceptable.
Never go below 30. Never omit either parameter.

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
|-----------|-----------|------------------|
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

1. **Load the epic:**
   ```sql
   SELECT get_work_items_by_epic('<epic-id>', 'todo');
   ```
   - Interactive (no args): show open epics, ask which to build
   - Unattended (no tasks found): escalate via advisor tool

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

4. **Read CLAUDE.md files** for all affected packages.

5. **Classify each task** → assign agent type from the table above.

6. **Group tasks into waves** — parallelize tasks with no file overlap:
   - Wave 1: independent tasks (different packages/files)
   - Wave 2: tasks that depend on Wave 1 outputs
   - Wave 3: integration tasks

7. **For each wave — dispatch typed agents in parallel:**
   - Set work item to `in_progress` before dispatching
   - **MANDATORY Task parameters — set on EVERY dispatch:**
     - `max_turns: 70` (use `max_turns: 30` only for tasks touching <5 files with no cross-package deps)
     - `model: claude-opus-4-7`
   - Each agent prompt MUST include:
     - `"Read {PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md first (fallback: .rdc/guides/agent-bootstrap.md), then {PROJECT_ROOT}/.rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md) before starting."`
     - Specific files to create/modify
     - Exact deliverables and commit message
     - `"NEVER run pnpm build/test. NEVER modify files outside your scope."`
     - `"COMPLETION PROOF REQUIRED: Your AGENT_COMPLETE report must include the actual file paths written, the git commit hash, and the vitest output. Do not claim done without these three items."`
   - Use `run_in_background: true` for parallel execution
   - NEVER let agents overlap on the same files

8. **Post-wave test gate (mandatory):**
   After all agents in a wave complete, before marking tasks done:
   ```bash
   # For each package modified in this wave:
   cd packages/<n> && npx vitest run 2>&1 | tail -20
   ```
   - All tests must pass before proceeding to next wave
   - If tests fail: fix before marking the wave done
   - NEVER use `pnpm build` or `pnpm turbo test` — vitest only per package
   - New code must have tests: if a modified package shows 0 new test files, flag it

9. **As agents complete:**
   - Verify commit landed on the development branch
   - Push to origin *(skip if `$RDC_TEST=1` — echo `[RDC_TEST] skipping git push` instead)*
   - Set work item to `done` with notes
   - Continue to next wave

   **If an agent fails:**
   - Interactive: diagnose before retrying
   - Unattended: retry once; on second failure escalate via advisor
     ```
     BUILD_STATUS: { wave, tasks_done, tasks_failed, commits, escalated: true }
     ```

10. **Final verification gate (mandatory — before marking epic done):**
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
    - Update epic version: `bump_epic_version()`
    - Report summary with verification evidence quoted

## Agent TDD Requirements

When dispatching agents, include in every prompt:
```
TDD REQUIREMENT: Write tests FIRST for new functions/modules.
Run: npx vitest run packages/<n> to verify red → implement → verify green.
NEVER run pnpm build or pnpm turbo. Use npx vitest run only.
```

## Rules
- Branch: development branch only (auto-commit, no confirmation needed)
- NEVER let two agents edit the same file
- NEVER run `pnpm build` (crashes system) — code only
- Every agent reads its guide file — no exceptions
- Every Task dispatch sets `max_turns: 70` and `model: claude-opus-4-7` — no exceptions
- Update Supabase work items IN REAL TIME — not batch at end
- Push after each wave, not just at the end
- Unattended: NEVER pause — continue automatically
- Unattended: max 2 retries per task before escalating to advisor
