---
name: rdc:handoff
description: >-
  Create a structured handoff from a planning session to CLI agents. Use when
  the project lead says "hand this off", "give this to the CLI", "tell the CLI agents
  about this", or when a plan/prototype has been finalized and is ready for
  implementation. Produces: a plan doc in docs/plans/, work items in database,
  and a prototype registry entry if applicable.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md` first.


# rdc:handoff — Planning → CLI Bridge

## When to Use

- A prototype has been built and needs production implementation
- A design decision has been made and needs to be executed
- Project lead says "hand this off", "give this to the CLI", "write it up"
- A plan exists in the conversation but hasn't been saved to disk or database yet

## What This Skill Produces

1. **Plan doc** → `docs/plans/<topic-slug>.md`
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
docs/plans/<topic-slug>.md
```

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
- Guide: docs/guides/<type>.md
- Files to create/modify: [list]
- Deliverables: [specific outputs]
- Depends on: [other packages if sequential]

### Package 2 — <Name>
[...]

## Sequencing

Wave 1 (parallel): Package 1, Package 2
Wave 2 (after Wave 1): Package 3

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
  p_description := 'See docs/plans/<topic-slug>.md for full spec.',
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
Guide: docs/guides/<type>.md
Design doc: docs/plans/<topic-slug>.md
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
- Plan: docs/plans/<topic-slug>.md
- Epic: <epic-id> ("<title>")
- Tasks: <N> tasks created, wave structure: [Wave 1: X, Y | Wave 2: Z]
- Prototype: registered at docs/source/<file> (if applicable)
- CLI agents will pick this up on next run.
```
