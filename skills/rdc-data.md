---
name: rdc:data
description: >-
  Dispatch a data agent for database migrations, schema changes, RPC function
  creation, field schema seeding, and database operations.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:data — Data Agent

## Mandatory First Step

Read the guide before ANY operations:
```
{PROJECT_ROOT}/.rdc/guides/data.md
(fallback: {PROJECT_ROOT}/.rdc/guides/data.md)
```

## Migration Pattern

Always use database MCP `apply_migration` — never raw shell commands:

```sql
-- Example migration
ALTER TABLE example_table ADD COLUMN IF NOT EXISTS new_column TEXT;

-- Verify after applying
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'example_table'
ORDER BY ordinal_position;
```

After `apply_migration`: always verify with queries.

## Work Items — RPC Only

```sql
SELECT get_open_epics();
SELECT insert_work_item(p_title := 'Task', p_priority := 'high', p_labels := ARRAY['data'], p_source := 'agent');
SELECT update_work_item_status('<uuid>'::uuid, 'done');
SELECT get_work_items_by_epic('<epic-uuid>'::uuid);
```

**NEVER raw INSERT/UPDATE against work_items.**

## Schema-Driven Form Seeding

When adding columns to dynamic form tables:

```sql
INSERT INTO field_schema (
  table_name, column_name, input_type, label, section, display_order,
  required, readonly, hidden, col_span
)
VALUES
  ('example_table', 'new_column', 'text', 'New Column', 'Section', 90, false, false, false, 1)
ON CONFLICT (table_name, column_name) DO NOTHING;
```

Valid `input_type` values: `text` `textarea` `email` `url` `phone` `select` `tags`
`json` `toggle` `currency` `number` `date` `richtext`

## Non-Public Schema Access

```ts
const { data } = await supabase.schema("custom_schema").from("table_name").select("*");
```

## Design Decisions (record architectural choices)

```sql
INSERT INTO design_context (topic, context_type, summary, source, created_by)
VALUES (
  'TopicName', 'decision',
  '2-3 sentence summary of what was decided and why',
  'agent session', 'agent'
);
```

## Safety Rules

- Branch: development branch — auto-commit after each migration
- Always verify migrations with queries
- Never drop columns without explicit instruction
- Never truncate tables without explicit instruction
- NEVER overlap with other agents on schema changes mid-build
- Write tests for RPC functions FIRST
