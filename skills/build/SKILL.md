---
name: rdc:build
description: "Usage `rdc:build <epic-id>` — Codex-native execution for a planned epic. Dispatches parallel typed Codex agents, each commits atomically to develop, runs a mandatory per-wave code-review gate (pr-review-toolkit:code-reviewer), closes work items, and runs the validator gate. Call after rdc:plan or when told to build."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.


# rdc:build — Typed Agent Dispatch Engine

## Execution Engine Contract

`rdc:*` skills are Codex skills. The supervisor and dispatched implementation,
review, and validator agents run through Codex's native agent/worktree
mechanisms. **Do not invoke Claude Code, `claude`, `mcp__clauth__call_agent`,
or a Claude-only model name to execute this skill.** An external dispatcher
outage is not a build result and must not be reported as the build being
complete.

Use the current Codex model configured by the environment (normally `gpt-5.5`)
and record the selected Codex model in the wave plan. If a Codex subagent cannot
be dispatched, the Codex supervisor may implement the scoped work directly in
the current leased worktree, preserving the same work-item checklist,
verification, review, and validator gates. Never stop merely because a Claude
backend is unavailable.

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
   Every `Agent()` call MUST include these parameters:
   ```
   model: <chosen per the routing table below>
   max_turns: 70
   ```
   Every dispatched agent that may edit or commit MUST receive a unique leased
   worktree. A non-isolated dispatched agent is read-only and may research,
   review, or validate merged source; it may not write.

   ### ⛔ Dispatch mode — writers are always isolated
   Isolation is an ownership boundary, not a concurrency optimization. The
   supervisor may implement directly as the sole writer, but once work is
   dispatched, each writer gets its own fresh leased worktree:

   | Wave shape | Dispatch mode | isolation |
   |---|---|---|
   | **Read-only research/review/validator** | shared merged source, no writes | omit `isolation` |
   | **Any dispatched writer** | unique leased worktree and branch | `isolation: "worktree"` |
   | **Cross-repository outcome** | one linked branch per repository | unique worktree in each repo |

   - One issue may touch multiple apps in one monorepo branch when the paths are
     explicitly attributed to that issue.
   - Crossing repositories always creates one branch per repository, linked by
     the collaboration manifest and work item.
   - Independent outcomes use independent worktrees.
   - The HARD GATE below applies before every writing dispatch.

   ### ⛔ Foreign concurrent session guard — `git status` BEFORE the build
   Worktree isolation protects against THIS build's own agents, not against a
   DIFFERENT session (another cell, a Codex run, a human) already committing on
   the same shared tree (lesson 2026-06-16-build-concurrent-session-shared-tree-commit-corruption:
   a foreign session's staged-but-uncommitted files were swept into this build's
   commit under the wrong message). Before dispatching any wave, run `git status`
   to detect foreign-dirty files you did not create. If foreign-dirty files are
   present: do NOT fan out concurrent committers — **serialize ALL committers to
   the supervisor** (agents return diffs/patches; the supervisor stages and
   commits each one alone). After every supervisor commit, assert the exact file
   set landed and nothing foreign leaked in:
   ```bash
   git show --stat <sha>   # confirm ONLY the files this commit owns are listed
   ```
   A `git show --stat` that lists a file the agent did not touch = a foreign file
   leaked into the commit; reset and re-stage by explicit path.

   **Agent model routing — pick per task, not per wave.** The supervisor session model does NOT cascade to agents; you must set `model` explicitly on every dispatch.

   | Task character | Model | When to pick it |
   |---|---|---|
   | Updates, edits, mechanical refactors, small fixes, content tweaks, config patches, doc/copy edits, straightforward API wiring | current Codex Sonnet-equivalent configured by the environment | Default for `frontend.md`/`content.md`/`infrastructure.md` work whose checklist is mostly "change X to Y" or "wire up endpoint Z". |
   | Harder coding tasks — non-trivial algorithm, migration with backfill, schema reshape, multi-file refactor with subtle invariants, performance-sensitive code, anything where correctness is the bar | `gpt-5.5` or the current Codex high-reasoning model | Default for `backend.md`/`data.md` work and any `frontend.md` task that involves state machines, race conditions, or cross-package contracts. |
   | Design or innovative thought — new component design, brand/UX work, CS 2.0 paradigm work (HAIL/Quad Pixel/AEMG/Virtue), grammar evolution, architecture-first design, anything where the *shape* of the solution is the deliverable rather than the implementation | `gpt-5.5` or the current Codex high-reasoning model | Default for `design.md`/`cs2.md` work. Also use for `backend.md`/`data.md` tasks tagged with `architecture` or `design-decision` in work item labels. |

   **How to choose when the task straddles categories:**
   - If the task's checklist contains the word "design", "decide", "propose", "evaluate alternatives", "novel", or any CS 2.0 primitive → **Codex high-reasoning model**.
   - If the task touches `packages/cs2*`, `packages/hail`, `packages/quad-pixel`, `packages/virtue-engine`, `packages/aemg`, `packages/planetary-ontology`, or `packages/being-state-processor` → **Codex high-reasoning model** (CS 2.0 paradigm requires innovative thought, not transcription).
   - If the task is a Supabase migration that drops/renames/reshapes anything, or a refactor across ≥5 files → **Codex high-reasoning model**.
   - Otherwise → the current Codex standard model.

   **State the choice in the wave plan.** Before dispatching a wave, the supervisor must log one line per agent in the form `[wave-N agent-K] role=<role> task=<id> model=<chosen> reason=<one phrase>`. This keeps routing decisions reviewable in the transcript and lets `rdc:report` summarize the fleet mix.

   **Cost guardrail.** If a single wave would dispatch more than 3 high-reasoning Codex agents in parallel, downshift the lowest-priority tasks to the current Codex standard model unless their work items are tagged `priority=urgent`.
   Without `max_turns: 70`, agents hit the default turn cap mid-task and stop.
   `isolation: "worktree"` gives each agent its own git worktree and branch — eliminates push race conditions and index lock contention when multiple agents commit in parallel. The supervisor merges worktree branches after each wave (Step 9).

   ### ✅ PREVENTION FIRST — create worktrees fresh off origin/develop (kills stale-base by construction)
   The repeated stale-base failures below come from creating worktrees off a
   local/old ref. Eliminate the failure mode at the source: ALWAYS create agent
   worktrees with a fresh fetch + `origin/develop` base, e.g.
   `git fetch origin develop && git worktree add <dir> -b <branch> origin/develop`
   — or use the canonical launcher `node scripts/wt.mjs add <name>`, which does
   exactly that. A worktree cut from `origin/develop` HEAD **cannot** be stale.
   The HARD GATE below remains as the blocking backstop (detection), but
   construction-from-`origin/develop` is the primary defense.

   ### ⛔ HARD GATE — Worktree base MUST equal develop HEAD (blocking, not advisory)
   The worktree-isolation harness has shipped worktrees pinned to a STALE base
   commit (lessons 2026-06-10-build-worktree-stale-base, 2026-06-11-build-worktree-stale-base,
   2026-06-15-build-worktree-stale-base, 2026-06-16-build-worktree-stale-base,
   2026-06-17-build-worktree-stale-base, 2026-06-23-build-worktree-stale-base:
   agents branched hundreds of commits / multiple days behind develop HEAD, on a
   tree where the target app did not yet exist — their diffs would have silently
   reverted merged work or operated on a deleted structure). This is a recurring
   harness defect, so the check is a **HARD BLOCKING GATE, not a suggestion.**

   **Before dispatching ANY `isolation:"worktree"` wave**, the supervisor MUST run
   the base==HEAD assertion and MUST abort isolation on any mismatch — there is no
   "proceed anyway" path:
   ```bash
   DEV_HEAD=$(git rev-parse develop)
   # After worktrees are created, for each agent worktree:
   git worktree list   # compare each agent worktree's SHA to $DEV_HEAD
   # If ANY worktree base != $DEV_HEAD (it is behind), the wave is UNSAFE — ABORT.
   ```
   - **MANDATORY ABORT:** if ANY worktree base != `$DEV_HEAD`, you MUST abort
     isolation for this wave. Do NOT merge stale worktree output. Do NOT "fast-forward
     and continue". Do NOT proceed with the isolated wave under any circumstance.
     Recreate the worktree from the current remote integration head. Do not pivot
     a dispatched writer into a shared checkout. A validator remains non-isolated
     only because it is read-only and must inspect merged source.
   - This gate is blocking by design: an isolated wave dispatched on a stale base
     is treated as a build failure, not a warning. Skipping or downgrading this
     assertion to advisory is a contract violation.
   - Also at every merge: `git show <branch>:<key-file> | grep -c <symbol-a-prior-wave-introduced>`
     — a 0 where there should be ≥1 means the branch is stale or deleted a shared
     export; resolve to `--ours` and re-apply that wave's real delta on current HEAD.
     esbuild/tsc PASS is necessary, not sufficient — pair it with a grep gate on
     the symbols a refactor must preserve.

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
   Read .rdc/guides/agent-bootstrap.md + .rdc/guides/engineering-behavior.md + .rdc/guides/frontend.md before starting.
   ```

   **When the supervisor has NOT read the plan** (e.g. dispatching from a fresh `rdc:build` call with
   only an epic ID), the agent has no plan context — write a full briefing prompt with all specs.

   ### ⛔ Reuse contract — when a WP builds on an existing subsystem
   When a work package extends an existing subsystem, "compose adapter + X"
   under-specifies reuse and lets an agent legitimately re-author markup/logic the
   subsystem already exposes (lesson 2026-06-11-build-reuse-existing-engine-prompt:
   an agent set up to reinvent a grid when the card engine already shipped four
   `CardLayout` display types + a full `parseCommand → CardSpec → adapter → CardModel[]`
   calling sequence). The dispatch prompt MUST:
   1. **Enumerate the existing public API the agent must reuse, BY FILE** — types/enums
      (`packages/.../types.ts:NN`), calling-sequence functions, AND the existing
      display/render components — not just the data adapter.
   2. **Mark which seams are extend/delegate-only.** State explicitly: "thread a
      pass-through prop (e.g. `layout`) to the existing components; do NOT
      reimplement layout/render." Verify at WP review that the agent reused the
      named parser/adapter/components and did not hand-roll a parallel implementation.

   ---

   ### Required agent prompt contents
   - Set work item to `in_progress` before dispatching
   - Each agent prompt MUST include:
     - `"Read {PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md first (fallback: .rdc/guides/agent-bootstrap.md), then {PROJECT_ROOT}/.rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md) before starting."`
     - Specific files to create/modify
     - Exact deliverables and commit message
     - `"NEVER run pnpm build/test. NEVER modify files outside your scope."`
     - **`"When done, set your work item to 'review' (NOT 'done') and return AGENT_COMPLETE with a verification field. The validator closes work items — you do not."`**
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

9. **As agents complete:**
   - Verify each worktree branch is merged to the development branch
   - Push to origin *(skip if `$RDC_TEST=1` — echo `[RDC_TEST] skipping git push` instead)*
   After all wave agents complete, merge worktrees and push:

   Each completed Codex agent returns a worktree branch (e.g. `codex/agent-frontend-abc123`). Merge them all to develop before running the test gate:

   ```bash
   # For each worktree branch returned by agents in this wave:
   git merge --no-ff <worktree-branch> -m "merge(<agent-type>): <task-title>"
   ```

   - Resolve any conflicts before proceeding — do not skip
   - Worker agents set items to `review` — **do NOT close to `done` yet**
   - Continue to next wave

   **If an agent fails:**
   - Interactive: diagnose before retrying
   - Unattended: retry once; on second failure escalate via advisor
     ```
     BUILD_STATUS: { wave, tasks_done, tasks_failed, commits, escalated: true }
     ```

10. **Mandatory validator gate (runs after ALL waves complete — before any work item closes):**

    ⛔ **NO work item may be set to `done` without the validator passing it.**

    Dispatch ONE validator agent with the complete list of `review` work items and the full git diff:

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
    - Sets passing items to `done`, failing items back to `todo` with failure detail
    - Returns `VALIDATOR_COMPLETE` report

    **If the validator finds failures:** fix them in a new wave, then re-run the validator. Do not skip.
    **File existence alone is NOT verification.** A route returning 500 is a failure regardless of tsc passing.

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
