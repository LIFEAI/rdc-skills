---
name: rdc:plan
description: >-
  Take research findings or an epic and produce an architecture document with
  design decisions, tradeoffs, and work packages. Creates Supabase epics/tasks.
  Use after rdc:preplan or when the project lead gives clear architectural direction.
  Accepts optional --unattended flag for overnight/automated runs (skips approval,
  creates tasks immediately, returns status block).
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md`).


# rdc:plan — Architecture & Work Packages

## When to Use
- After `/rdc:preplan` produced research findings
- Project lead gives architectural direction ("build X with Y approach")
- An epic exists but needs breakdown into implementable tasks
- Before any large build session
- Called by `rdc:overnight` when an epic has no child tasks

## Arguments
- `rdc:plan <topic>` — interactive planning session
- `rdc:plan <epic-id> --unattended` — silent mode for overnight builds

## Procedure

1. **Gather inputs:**
   - Research doc from preplan (if exists): `.rdc/research/<topic>.md` (fallback: `docs/research/<topic>.md`)
   - Project lead's architectural direction from conversation
   - Relevant CLAUDE.md files from affected packages
   - Existing Supabase epics: `SELECT get_open_epics()`

2. **Read the codebase** — understand current state:
   - What packages are affected?
   - What types/interfaces already exist?
   - What tests exist?
   - What's the dependency graph?

3. **Make design decisions** — for each major choice:
   - State the decision clearly
   - Document what was chosen and what was rejected
   - Explain WHY (tradeoff rationale)
   - Note consequences and reversibility

4. **Define work packages** — break into agent-dispatchable units:
   - Each work package = one agent assignment
   - No file overlap between packages
   - Each package has: scope, files to create/modify, test requirements
   - Assign an agent type to each work package from the typed dispatch table in rdc:build. Include the guide file path (from `.rdc/guides/`, fallback `docs/guides/`) in each work package description.
   - Estimate: small (1 agent, <500 LOC), medium (1 agent, 500-1500 LOC), large (needs splitting)

5. **Write plan doc** to `.rdc/plans/<topic-slug>.md` (fallback: `docs/plans/<topic-slug>.md` if `.rdc/` does not exist):
   ```markdown
   # Plan: <Topic>
   > Generated: <date> | Epic: <id if exists>

   ## Goal
   ## Design Decisions
   ## Work Packages
   ## Sequencing (what can parallelize, what depends on what)
   ## Risks & Mitigations
   ```

6. **Create Supabase epic + child tasks:**
   - Epic via `insert_work_item(p_item_type := 'epic', ...)`
   - One task per work package via `insert_work_item(p_parent_id := <epic_id>, ...)`
   - Set priorities: urgent/high/normal based on sequencing

7. **Report results:**
   - Interactive: present the plan for approval before building
   - Unattended: skip approval, proceed immediately, emit status block:
     ```
     PLAN_STATUS: { epic_id, task_count, doc_path, waves }
     ```

## Unattended Escalation

When `--unattended` and genuine architectural ambiguity is detected — meaning multiple
valid approaches exist with significantly different tradeoffs (not just minor style choices)
— escalate via the advisor tool. Provide: the decision point, the options with tradeoffs,
and the project context. Resume with advisor's recommendation. If advisor is unavailable,
choose the most conservative/reversible approach and document the decision.

## Rules
- Interactive: ALWAYS get approval before proceeding to build
- Unattended: proceed immediately without approval
- Plan doc goes in `.rdc/plans/` (fallback: `docs/plans/` if `.rdc/` does not exist) — not `.planning/`
- Each work package must be independently executable by an agent
- No file overlap between work packages
- Include test requirements in every work package
- Reference affected CLAUDE.md files in each work package description
- Reference the relevant guide file from `.rdc/guides/` (fallback: `docs/guides/`) for agent context
