---
name: rdc:backend
description: >-
  Dispatch a backend agent to build API routes, server components, database
  queries, auth flows, and data fetching. Use when work involves server-side
  logic, API routes, or database operations.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md` first.


# rdc:backend — Backend Agent

## Mandatory First Step

Read the guide before ANY code:
```
{PROJECT_ROOT}/docs/guides/backend.md
```

## Database Client — One Pattern Per Context

```ts
// Server component / API route
import { createServerClient } from "@regen/supabase";
const supabase = await createServerClient();

// Client component
import { createBrowserClient } from "@regen/supabase";
const supabase = createBrowserClient();
```

Non-public schemas:
```ts
const { data } = await supabase.schema("custom").from("table_name").select("*");
```

## Credentials — Daemon First

```bash
curl -s http://127.0.0.1:52437/get/<service>
```
- Never hardcode credentials
- Never print keys to stdout
- If daemon is down: report BLOCKED — do not work around it

## Work Items — RPC Only

```sql
-- Read epics
SELECT get_open_epics();

-- Create
SELECT insert_work_item(
  p_title := 'Task title',
  p_priority := 'high',
  p_parent_id := '<epic-uuid>'::uuid,
  p_source := 'agent'
);

-- Update
SELECT update_work_item_status('<uuid>'::uuid, 'done', '["What was done"]'::jsonb);
```

**NEVER write raw INSERT/UPDATE against work items.**

## API Route Pattern

```ts
import { createServerClient } from "@regen/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("table").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("table").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
```

## Auth

Use the auth helpers from your project's auth package for protected apps.

## Schema-Driven Forms

When working with schema-driven forms (common in dynamic CRUD), never hardcode columns.
Use the schema table to drive form rendering instead.

## Safety Rules

- Branch: development branch — auto-commit after logical blocks
- NEVER run `pnpm build`
- NEVER overlap with other agents on the same files
- Update work items in real time — not batch at end
- Push after each logical block
- Write tests FIRST — red → implement → green
