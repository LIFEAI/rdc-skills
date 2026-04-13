# Backend Agent Guide — Base
> Role-based context for backend/API/data agents. Generic patterns across projects.

---

## Database Client Patterns

Every project specifies its database client library. Always use that instead of writing raw SQL.

Generic server component pattern:
```ts
// Server component / API route
const client = await createServerClient();
const { data, error } = await client.from("table").select("*");
```

Generic browser component pattern:
```ts
// Client component
const client = createBrowserClient();
const { data, error } = await client.from("table").select("*");
```

The project overlay specifies:
- Import path for server client
- Import path for browser client
- How to access non-public schemas
- Authentication requirements

---

## Environment Variables

```bash
# Required in every app
# (Project overlay specifies exact variable names and format)
SERVICE_URL=https://...
SERVICE_ANON_KEY=...

# Server-side only (never prefix with PUBLIC_)
SERVICE_ADMIN_KEY=...
```

The project overlay specifies:
- Exact variable names
- Which are public vs server-only
- Where to retrieve credentials

---

## Auth Patterns

Projects typically provide auth helpers. Check project overlay for:
- `getUser()` — nullable, server-side only
- `requireAuth()` — throws if unauthenticated
- Middleware patterns (public pass-through vs protected)
- Login method (magic link, OAuth, etc.)

---

## Work Items / Task Management

Most projects have a task/epic system. The project overlay specifies:
- Whether to use RPC functions or raw SQL
- Required fields and enums
- Relationship patterns (parent/child hierarchy)
- Which operations require special handling

Never guess at the implementation — read the project overlay.

---

## API Route Patterns

```ts
// app/api/example/route.ts
import { createServerClient } from "@project/db";
import { NextResponse } from "next/server";

export async function GET() {
  const client = await createServerClient();
  const { data, error } = await client.from("table").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const client = await createServerClient();
  const { data, error } = await client.from("table").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
```

---

## Schema-Driven Forms

Some projects use dynamic schema tables for form generation. The project overlay specifies:
- Table for field schema
- Components that read schema at runtime (DynamicForm, AdaptiveCrud, etc.)
- Never hardcode form columns

---

## Credential Safety

The project overlay specifies:
- Where credentials come from (MCP, daemon, env vars)
- Never print keys to stdout
- Never hardcode credentials in source
- Never ask the user for keys
- If daemon/service is down: report BLOCKED, do not work around

---

## Key Schema Domains (Check Project Overlay)

The project specifies its schema structure:
- Which tables exist in which schemas
- Primary keys and foreign relationships
- RLS policies and access rules
- Materialized views or special queries

Never assume schema structure — read the project overlay.

---

## Migration Patterns

The project overlay specifies:
- Where migration files live
- How to apply migrations
- How to verify migrations
- Which database service to use

---

## Specialist Context — Read Project Overlay

Your task may require reading additional project-specific guides for:
- Full DB schema with all columns
- Deployment registry patterns
- Brand token API
- Auth patterns beyond basics
