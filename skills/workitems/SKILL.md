---
name: rdc:workitems
description: "Manual work item CRUD outside the normal build flow: add to backlog, mark done, update status, list open epics, query by label."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag. Supabase work item writes (`insert_work_item`, `update_work_item_status`, `bump_epic_version`) are skipped under `RDC_TEST=1`.


# rdc:workitems — Work Item Management

## When to Use
- Project lead says "create a ticket", "add to backlog", "log this bug", "update status"
- An agent needs to create or update epics/tasks during a build session
- Checking what work is open before starting a new epic

## Arguments

- `rdc:workitems epics` — list open epics
- `rdc:workitems add <title> --epic <id>` — create a task under an epic
- `rdc:workitems update <id> --status <status>` — update a work item's status
- `rdc:workitems done <id>` — mark a task complete
- `rdc:workitems list <epic-id>` — list tasks in an epic

## Rules

1. **Epic first, always.** Never create a task without a parent epic.
2. **Label everything.** Minimum one system label per item.
3. **Check first.** `get_open_epics()` before creating anything new.
4. **Link design docs.** Put `.rdc/plans/` or `.rdc/research/` paths in descriptions (fallback: `.rdc/plans/` / `.rdc/research/`).

## Read Epics

```sql
SELECT get_open_epics();
SELECT get_open_epics('urgent');
SELECT get_open_epics(p_label_filter := 'custom-label');
```

## Create Epic

```sql
SELECT insert_work_item(
  p_title       := 'EPIC: Clear descriptive title',
  p_description := 'What and why. Reference .rdc/plans/<n>.md if applicable.',
  p_item_type   := 'epic',
  p_priority    := 'high',
  p_labels      := ARRAY['system-label'],
  p_source      := 'planning'
);
```

## Create Task

```sql
SELECT insert_work_item(
  p_title       := 'Specific actionable task title',
  p_description := 'What: <deliverable>
Where: <files to create/modify>
Agent type: frontend | backend | data | design | infra | content | cs2
Guide: .rdc/guides/<type>.md (fallback: .rdc/guides/<type>.md)
Design doc: .rdc/plans/<n>.md (fallback: .rdc/plans/<n>.md, if exists)
Depends on: <other task title if sequential>
Est: <hours>',
  p_parent_id   := '<epic-uuid>'::uuid,
  p_item_type   := 'task',
  p_priority    := 'high',
  p_labels      := ARRAY['system-label'],
  p_estimated_hours := 2,
  p_source      := 'planning'
);
```

## Update Status

```sql
SELECT update_work_item_status('<uuid>'::uuid, 'in_progress');
SELECT update_work_item_status('<uuid>'::uuid, 'done', '["What was completed"]'::jsonb);
SELECT update_work_item_status('<uuid>'::uuid, 'blocked', '["Why it is blocked"]'::jsonb);
```

## Read Tasks in an Epic

```sql
SELECT get_work_items_by_epic('<epic-uuid>'::uuid);
SELECT get_work_items_by_epic('<epic-uuid>'::uuid, 'todo');
```

## Bump Epic Version

```sql
SELECT bump_epic_version('<epic-uuid>'::uuid, '0.2.0', 'What changed', 'planning');
```

## Valid Values

| Field | Values |
|-------|--------|
| status | `todo` `in_progress` `blocked` `review` `done` `archived` |
| priority | `urgent` `high` `normal` `low` |
| item_type | `epic` `task` `subtask` `bug` `spike` |

## System Labels

| Label | When |
|-------|------|
| `project-a` | Your-app-specific work |
| `project-b` | Another app work |
| `cs2` | Core paradigm packages |
| `hail` | Grammar, DSL compiler |
| `pal` | Moment windows, memory |
| `virtue` | Virtue engine, coherence |
| `marketing` | Outreach, campaigns |
| `media` | Assets, R2, image pipeline |
| `infrastructure` | CI/CD, deployment |
| `ui` | Component library |
| `data` | Schema, migrations |
| `content` | Copy, messaging |
| `website` | Public-facing sites |

## Agent Type → Guide File Reference

| Type | Guide | Use For |
|------|-------|---------|
| `frontend` | .rdc/guides/frontend.md | React, pages, UI, Tailwind |
| `backend` | .rdc/guides/backend.md | API routes, database, auth |
| `data` | .rdc/guides/data.md | Migrations, schema, RPC |
| `design` | .rdc/guides/design.md | Brand, palette, OG images |
| `infra` | .rdc/guides/infrastructure.md | CI/CD, deploy, DNS |
| `content` | .rdc/guides/content.md | Copy, messaging, tone |
| `cs2` | .rdc/guides/cs2.md | CS 2.0 paradigm |
| `hail` | .rdc/guides/cs2.md + packages/hail/CLAUDE.md | Grammar, DSL |
| `viz` | .rdc/guides/frontend.md + design.md | Custom visualizations |

## What NOT to Do

- Never raw INSERT/UPDATE against work items — RPC functions only
- Never create tasks without a parent epic
- Never leave labels empty
- Never write vague titles ("Fix stuff") — be specific
- Never put design intention in the task — put it in `.rdc/research/` (fallback: `.rdc/research/`) and link
