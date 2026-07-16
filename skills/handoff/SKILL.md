---
name: rdc:handoff
description: "Usage `rdc:handoff [--from-prototype <id>]` — Convert a finalized plan or prototype into CLI-ready artifacts: writes .rdc/plans/, creates Supabase work items with DoD checklists, registers prototype if present. Bridge between planning session and rdc:build."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag. Supabase work item writes, prototype registry inserts, design context inserts, and git push are skipped under `RDC_TEST=1`.


# rdc:handoff — Planning → CLI Bridge

## When to Use

- A prototype has been built and needs production implementation
- A design decision has been made and needs to be executed
- Project lead says "hand this off", "give this to the CLI", "write it up"
- A plan exists in the conversation but hasn't been saved to disk or database yet

## What This Skill Produces

1. **Plan doc** → `.rdc/plans/<topic-slug>.md` (fallback: `.rdc/plans/<topic-slug>.md`)
2. **Database epic + child tasks** (with agent types and guide file refs)
3. **Prototype registry entry** (if a prototype was built)
4. **Design context entries** (for decisions made in the session)

## Procedure

### Step 1 — Extract the Plan

Identify from the conversation:
- What is the goal?
- What prototypes or designs were built? Where are they?
- What decisions were made? What was rejected and why?
- What is the sequencing (what depends on what)?
- Which agent types are needed?

### Step 2 — Write the Plan Doc

```
.rdc/plans/<topic-slug>.md
```
(fallback: `.rdc/plans/<topic-slug>.md` if `.rdc/` does not exist)

Template:
```markdown
# Plan: <Topic>
> Route: <app route or package>
> Status: Ready for CLI build
> Created: <date>
> Source: planning session

---

## What Already Exists (Do NOT Re-implement)

[List any existing components, database tables, or files
 that agents must use rather than recreate]

## What Was Built in Planning (Prototype)

[Describe the prototype — file location, key design decisions,
 what to preserve vs what to adapt]

## Work Packages

### Package 1 — <Name>
- Agent type: frontend | backend | data | design | infra | content | cs2 | viz
- Guide: .rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md)
- Files to create/modify: [list]
- Deliverables: [specific outputs]
- Depends on: [other packages if sequential]

### Package 2 — <Name>
[...]

## Sequencing

Wave 1 (parallel): Package 1, Package 2
Wave 2 (after Wave 1): Package 3

## Checklist Decomposition Matrix

| Work item | Atomic deliverable | Surface type | Route or file path | Preconditions / fixture data | Action | Expected result | Verification artifact | Owner package | Status |
|-----------|-------------------|--------------|--------------------|------------------------------|--------|-----------------|-----------------------|---------------|--------|
| WP-1 | decomp-<surface>-<slug> | screen | /route | seeded fixture | open / click / submit | observable result | Playwright screenshot / route probe / test name | Package 1 | todo |

Rules:
- One observable behavior per row.
- Each row must be independently pass/fail.
- Each implementation work item must have matching `decomp-*` checklist rows and `test-*` verification rows.
- UI routes list state rows separately: empty, loading, loaded, error, create/edit/detail/mobile where applicable.
- API and DB rows include success, failure/guard, and side-effect proof where applicable.

## Checklist Quality Gate

verdict: PASS | FAIL
failures:
- <missing/coarse row if any>
deferred:
- <explicitly out-of-scope row if any>

## Definition of Done

- [ ] [specific acceptance criterion]
- [ ] [build verification: zero new TS errors]
- [ ] [functional test]
```

### Step 3 — Create Database Epic + Tasks

```sql
-- Check for existing epics first
SELECT get_open_epics();

-- Create epic
SELECT insert_work_item(
  p_title       := 'EPIC: <Topic>',
  p_description := 'See .rdc/plans/<topic-slug>.md for full spec.',
  p_item_type   := 'epic',
  p_priority    := 'high',
  p_labels      := ARRAY['<system-label>'],
  p_source      := 'planning'
);

-- Create tasks (one per work package)
SELECT insert_work_item(
  p_title       := '<Package Name>',
  p_description := 'What: <deliverable>
Where: <files>
Agent type: <type>
Guide: .rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md)
Design doc: .rdc/plans/<topic-slug>.md (fallback: .rdc/plans/<topic-slug>.md)
Checklist: include required rows from the plan matrix:
- decomp-<surface>-<slug>: route/file=<path> | action=<action> | expect=<result> | evidence=<artifact>
- test-<type>-<slug>: <verification command or artifact>
Depends on: <other task if applicable>
Est: <hours>',
  p_parent_id   := '<epic-uuid>'::uuid,
  p_item_type   := 'task',
  p_priority    := 'high',
  p_labels      := ARRAY['<label>'],
  p_estimated_hours := 2,
  p_source      := 'planning'
);
```

Do not create build-ready tasks unless the plan has `## Checklist Decomposition Matrix` and `## Checklist Quality Gate` with `verdict: PASS`. If the matrix fails, save the plan as `Status: Needs checklist repair` and return the failure list instead of creating dispatchable implementation tasks.

### Step 4 — Register Prototype (if one was built)

```sql
INSERT INTO prototype_registry (name, component, source_path, notes, created_by)
VALUES (
  '<Component Name> v1',
  '<ComponentName>',
  'docs/source/<filename>.jsx',
  '<Key design decisions, data shapes, what to preserve>',
  'planning'
)
ON CONFLICT DO NOTHING;
```

### Step 5 — Record Design Decisions

```sql
INSERT INTO design_context (topic, context_type, summary, source, created_by)
VALUES
  ('<Topic>', 'decision', '<What was decided and why>', 'planning session', 'planning'),
  ('<Topic>', 'rejected', '<What was considered but not chosen, and why>', 'planning session', 'planning');
```

### Step 6 — Dispatch to CLI (worktree-isolated) — the ONLY sanctioned spawn

If you are handing this off to a CLI worker **now** (e.g. from a claude.ai session), do
**NOT** improvise a CLI spawn. Two spawn paths exist and they land in different trees:

| Dispatch path | Where the session runs | Use for handoff? |
|---------------|------------------------|------------------|
| **TinTin dispatch** — `tintin_dispatch` MCP tool, or `POST http://127.0.0.1:52437/tintin/dispatch`, `agent: "claude"` | A **fresh isolated worktree** `C:\Dev\regen-root.wt\tintin-claude-<sid>` on `develop` — `isolation: "worktree"` is the **default** (it runs `git worktree add -b wt/tintin/claude/<sid> <lane> develop`) | ✅ **YES** |
| `call_agent` / a supervisor-run / a bare `claude` in `C:\Dev\regen-root` | The **shared SV / main tree** — `resolveDispatchCwd` falls back to the main tree when no cwd is given | ❌ **NEVER** — this dumps a new-app build onto the integration tree as Supervisor |

**Recipe:**

1. **Commit the plan doc (and any handoff artifacts) to `develop` first.** The dispatch
   branches the new lane from `develop`, so the fresh worktree only contains what is on
   `develop`. Commit `.rdc/plans/<topic-slug>.md` so the dispatched session finds the
   **handoff file present in its own lane**.
2. **Dispatch via TinTin, leaving `isolation` at its default (`"worktree"`).** Do **NOT**
   pass `cwd: C:\Dev\regen-root` and do **NOT** pass `isolation: "cwd"` — either forces the
   shared main tree. Put the epic id + plan path in the prompt:
   ```json
   {
     "agent": "claude",
     "app_slug": "<app>",
     "prompt": "Build epic <epic-uuid>. Plan: .rdc/plans/<topic-slug>.md (already on develop, so it is present in your lane). Operate ONLY in this worktree; never cd to C:\\Dev\\regen-root."
   }
   ```
   MCP: `mcp__<clauth-connector>__tintin_dispatch`. HTTP: `POST http://127.0.0.1:52437/tintin/dispatch`.
3. The dispatch returns `cwd` (the lane), `branch` (`wt/tintin/claude/<sid>`), and
   `worktree_path`. Confirm the session is in `...regen-root.wt\...`, not `C:\Dev\regen-root`.

**Why:** the SV/main tree is the shared integration checkout used for merges and landing.
A new-app build there is not crash-isolated and collides with coordination — the exact
failure a handoff-spawned SV session causes.

## System Labels Reference

| Label | When |
|-------|------|
| `project-a` | Your-app-specific label |
| `marketing` | Marketing / outreach work |
| `ui` | Component library work |
| `data` | Schema, migrations |
| `infrastructure` | CI/CD, deployment |
| `cs2` | Core paradigm packages |
| `website` | Public-facing sites |
| `media` | Media/asset work |

## Output

When complete, tell the project lead:
```
Handoff complete:
- Plan: .rdc/plans/<topic-slug>.md
- Epic: <epic-id> ("<title>")
- Tasks: <N> tasks created, wave structure: [Wave 1: X, Y | Wave 2: Z]
- Prototype: registered at docs/source/<file> (if applicable)
- Dispatch (Step 6): if handing to a CLI worker now, dispatch worktree-isolated via TinTin
  (isolation=worktree → a fresh wt/tintin/claude/<sid> lane on develop), NEVER a
  supervisor / main-tree spawn. Otherwise CLI agents pick this up from the epic on next run.
```
