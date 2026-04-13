# Data Agent Guide — Base
> Role-based context for data, schema, and database agents. Generic patterns across projects.

---

## Database Instance

Check project overlay for:
- Database reference / instance identifier
- Available MCP servers and their capabilities
- RLS (Row-Level Security) status
- Schema organization

---

## Schema Organization

The project specifies schema structure. Check the overlay for:
- Public schema tables and purpose
- Additional named schemas (prt, rccs, etc.)
- Access patterns per schema
- RLS policies

Access non-public schemas with project-specific prefix:
```ts
const { data } = await client.schema("schema-name").from("table").select("*");
```

---

## Domains and Data Organization

The project overlay specifies all domains:
- Marketing/CRM tables
- Analytics/intelligence tables
- Product-specific tables
- Operational/system tables
- Archive tables

Check the overlay for:
- Tables per domain
- Foreign key relationships
- Materialized views or special queries
- Upsert patterns

---

## Work Items / Task Management

The project specifies task management patterns:
- Whether to use RPC functions or raw SQL
- Valid status/priority/type enums
- Hierarchy rules (parent/child)
- Lifecycle patterns

Never create-then-close in one operation. Always follow project rules.

---

## Migration Patterns

The project overlay specifies:
- Where migration files live (format: numbered SQL files)
- How to apply migrations (tool or CLI)
- How to verify migrations
- Version control strategy

Always verify with a follow-up query after applying.

---

## RLS (Row-Level Security)

The project specifies:
- Which tables have RLS enabled
- Which operations require service role key
- Which operations work with anon key
- Special policies or edge cases

Never bypass RLS rules. If needed for tests, use service role carefully.

---

## Foreign Key Map

The project overlay provides:
- All foreign relationships
- Which are enforced vs informational
- Cascade behavior (if any)

Use this to prevent orphaned records and maintain consistency.

---

## Common Query Patterns

The project overlay provides:
- Standard SELECT patterns per domain
- JOIN patterns
- Aggregation patterns
- Window function patterns

Check examples before writing queries.

---

## Type Generation

The project specifies:
- Type generation tool (TypeScript generation, type stubs, etc.)
- How to refresh types after schema changes
- Where generated types live
- Import patterns

---

## Specialist Context — Read Project Overlay

Your task may require reading additional project-specific guides for:
- Full DB schema with all column types
- Deployment registry schema
- Brand token/design token tables
- Work item RPC functions
