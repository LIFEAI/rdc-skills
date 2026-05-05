---
name: rdc:build
description: "You have a planned epic with tasks ready to execute. Dispatches parallel typed agents, each commits atomically to develop, closes work items, and runs the validator gate. Call after rdc:plan or when told to build."
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

1. **Load the epic and run pre-flight gate:**
   ```sql
   SELECT get_work_items_by_epic('<epic-id>', 'todo');
   ```

   **Session lock — claim the epic immediately (before any agent dispatch):**

   After loading the epic, check its status:
   - If `status = 'in_progress'` → **ABORT** with:
     ```
     SKIP: epic <id> is already in_progress — claimed by another session. Pick a different epic.
     ```
     Do NOT proceed. Do NOT dispatch any agents.
   - If `status = 'todo'` or `status = 'blocked'` → immediately claim it:
     ```sql
     SELECT update_work_item_status('<epic-id>'::uuid, 'in_progress',
       '["Claimed by build session — dispatching agents"]'::jsonb
     );
     ```
     This is an atomic Supabase write. A concurrent session that loads the same epic after this point will see `in_progress` and abort. **Do this before any classification, planning, or agent dispatch.**

   **Pre-flight gate — run after claiming:**

   | Condition | Action |
   |-----------|--------|
   | No child tasks returned | → Invoke `rdc:plan` on this epic. Do NOT proceed with build. |
   | Tasks exist but all have empty `description` fields | → Invoke `rdc:plan` on this epic. Tasks without descriptions cannot be safely dispatched. |
   | Tasks exist and have descriptions | → Continue with build. |

   **Re-planning is not a failure — it is correct behavior.** The build skill is the last gate before agent dispatch; catching an under-specified epic here is cheaper than a wasted agent run.

   **How to re-plan:**
   - Interactive: tell the user — "Epic has no tasks / tasks lack descriptions — invoking rdc:plan first." Then invoke `rdc:plan <epic-id>`.
   - Unattended: invoke `rdc:plan <epic-id> --unattended` inline, wait for it to complete, then reload tasks and re-run this gate once. If tasks still missing after re-plan, escalate via advisor.

   **Interactive (no args):** show open epics, ask which to build.

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

5b. **Write a checklist into every work item before dispatching:**
    For each task, append a checklist to its notes BEFORE setting to `in_progress`:
    ```sql
    SELECT update_work_item_status('<id>'::uuid, 'in_progress',
      '["CHECKLIST: [ ] <deliverable 1>, [ ] <deliverable 2>, [ ] tsc clean, [ ] route 200, [ ] committed"]'::jsonb
    );
    ```
    The agent must complete every item on this checklist and return it checked off in AGENT_COMPLETE.
    A checklist with unchecked items = incomplete work. Do not proceed to next wave with unchecked items.

6. **Group tasks into waves** — parallelize tasks with no file overlap:
   - Wave 1: independent tasks (different packages/files)
   - Wave 2: tasks that depend on Wave 1 outputs
   - Wave 3: integration tasks

7. **For each wave — dispatch typed agents in parallel:**

   ### ⛔ Agent Dispatch Non-Negotiable Defaults
   Every `Agent()` call MUST include these parameters — no exceptions:
   ```
   model: "sonnet"
   max_turns: 70
   isolation: "worktree"
   ```
   Agents run Sonnet 4.6 — capable for implementation work, budget-safe for parallel dispatch. The supervisor session model does NOT cascade to agents; you must set it explicitly.
   Without `max_turns: 70`, agents hit the default turn cap mid-task and stop.
   `isolation: "worktree"` gives each agent its own git worktree and branch — eliminates push race conditions and index lock contention when multiple agents commit in parallel. The supervisor merges worktree branches after each wave (Step 9).

   ### Forked agents vs. standalone agents

   **When the supervisor has already read the plan** (via a prior `Read` tool call in the same session),
   dispatch **forked agents** with short prompts. Forked agents inherit the full conversation context —
   including every file the supervisor has read — so you do NOT need to copy plan sections, file specs,
   or architecture details into the prompt. The agent already sees them.

   Short forked prompt template:
   ```
   You are a frontend agent building <WP name>. Work item: <uuid>.
   Scope: <one sentence>. Files: <list>. Verification: tsc --noEmit.
   Set item to review when done, return AGENT_COMPLETE with verification evidence.
   Read .rdc/guides/agent-bootstrap.md + .rdc/guides/frontend.md before starting.
   ```

   **When the supervisor has NOT read the plan** (e.g. dispatching from a fresh `rdc:build` call with
   only an epic ID), the agent has no plan context — write a full briefing prompt with all specs.

   ---

   ### Required agent prompt contents
   - Set work item to `in_progress` before dispatching
   - Each agent prompt MUST include:
     - `"Read {PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md first (fallback: .rdc/guides/agent-bootstrap.md), then {PROJECT_ROOT}/.rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md) before starting."`
     - Specific files to create/modify (or omit if forked agent inherits plan context)
     - Exact deliverables and commit message
     - `"NEVER run pnpm build/test. NEVER modify files outside your scope."`
     - **`"You are running in an isolated git worktree. Commit your work normally. Do NOT push to origin — the supervisor merges your branch after the wave completes."`**
     - **`"When done, set your work item to 'review' (NOT 'done') and return AGENT_COMPLETE with a verification field. The validator closes work items — you do not."`**
     - **`"COMPLETION PROOF REQUIRED in AGENT_COMPLETE: list every file written, the exact commit hash, and paste the vitest/tsc output. A report without this evidence will be rejected."`**
     - **`"If you find that a file or feature already exists: you MUST still verify it satisfies the full task spec before marking review. Finding a file is not completion. Run verification, check every requirement, and report what you found vs. what was required."`**
     - **The test plan items from the work item's checklist** (all `test-*` prefixed items). Include them verbatim in the prompt and instruct the agent:
       ```
       TEST PLAN — you MUST implement/verify each of these and tick them off via update_checklist_item:
       - test-assert-xxx: <description> → write a vitest test that proves this
       - test-smoke-xxx: <description> → run the command and confirm the result
       - test-visual-xxx: <description> → note: delegate to UI audit (you cannot verify this yourself)
       - test-contract-xxx: <description> → verify the export/type/shape exists
       Tick each item as you complete it. Do NOT batch — tick immediately after each verification.
       ```
   - Use `run_in_background: true` for parallel execution
   - NEVER let agents overlap on the same files

8. **Post-wave test gate (mandatory):**
   After all agents in a wave complete, before proceeding:
   ```bash
   # For each package modified in this wave:
   cd packages/<name> && npx vitest run 2>&1 | tail -20
   ```
   - All tests must pass before proceeding to next wave
   - If tests fail: fix before proceeding
   - NEVER use `pnpm build` or `pnpm turbo test` — vitest only per package
   - New code must have tests: if a modified package shows 0 new test files, flag it

9. **After all wave agents complete — merge worktrees and push:**

   Each completed agent returns a worktree branch (e.g. `claude/agent-frontend-abc123`). Merge them all to develop before running the test gate:

   ```bash
   # For each worktree branch returned by agents in this wave:
   git merge --no-ff <worktree-branch> -m "merge(<agent-type>): <task-title>"
   ```

   - Resolve any conflicts before proceeding — do not skip
   - Worker agents set items to `review` — **do NOT close to `done` yet**
   - After all branches merged, push once:
     ```bash
     if [ "$RDC_TEST" != "1" ]; then
       git push origin develop
     else
       echo "[RDC_TEST] skipping git push"
     fi
     ```
   - Then run the post-wave test gate (Step 8) on the merged state
   - Continue to next wave

   **If an agent fails (returns no worktree branch):**
   - Interactive: diagnose before retrying
   - Unattended: retry once; on second failure escalate via advisor
     ```
     BUILD_STATUS: { wave, tasks_done, tasks_failed, commits, escalated: true }
     ```

10. **Mandatory validator gate (runs after ALL waves complete — before any work item closes):**

    ⛔ **NO work item may be set to `done` without the validator passing it.**

    Dispatch ONE validator agent with the complete list of `review` work items and the full git diff.
    ⚠️ The validator does NOT use `isolation: "worktree"` — it must read the fully merged develop branch. Omit the isolation parameter for this dispatch only.

    ```
    "Read C:/Dev/regen-root/.rdc/guides/agent-bootstrap.md then C:/Dev/regen-root/.rdc/guides/verify.md.
     Validate these work items: [list of IDs and titles].
     Apps touched: [list].
     Git diff since build start: [attach or reference].
     You are the ONLY agent that closes work items to done.
     Follow verify.md procedure exactly: tsc → vitest → dev server route probes → record result per item."
    ```

    The validator:
    - Runs `npx tsc --noEmit` for every touched app/package
    - Starts the dev server and probes every modified route (expects HTTP 200, not 500)
    - Runs vitest for every touched package
    - **Verifies test plan completion per work item:**
      - For each `test-assert-*` checklist item: confirm a corresponding vitest test exists and passes
      - For each `test-smoke-*` checklist item: run the command and confirm exit code / HTTP status
      - For each `test-visual-*` checklist item: note as "delegated to UI audit" (validator cannot verify visuals)
      - For each `test-contract-*` checklist item: verify the export/type/shape exists in the built code
      - Any unchecked `test-*` item with `required: true` = work item CANNOT be set to `done` (DB enforces this)
    - Sets passing items to `done`, failing items back to `todo` with failure detail
    - Returns `VALIDATOR_COMPLETE` report with test plan status per item

    **If the validator finds failures:** fix them in a new wave, then re-run the validator. Do not skip.
    **File existence alone is NOT verification.** A route returning 500 is a failure regardless of tsc passing.
    **Unchecked test plan items are a hard gate** — `update_work_item_status('done')` will raise an exception if any `required: true` checklist item is unchecked.

11. **After verification passes:**
    - All wave commits are already on develop and pushed (Step 9 pushes after each wave merge).
    - Update epic version: `bump_epic_version()`
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
- Push after each wave, not just at the end
- Unattended: NEVER pause — continue automatically
- Unattended: max 2 retries per task before escalating to advisor
- Every Agent() dispatch: `model: "sonnet"` + `max_turns: 70` + `isolation: "worktree"` — non-negotiable (Sonnet agents, Opus supervisor). Exception: validator agent in Step 10 omits isolation.
- Finding an existing file is NOT task completion — verify it satisfies the spec
