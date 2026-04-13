---
name: rdc:prototype
description: >-
  Build a JSX/TSX prototype for review before handing off to CLI
  for production implementation. Use when the project lead says "show me what it looks like",
  "mock this up", "build a prototype", or wants to see a design before committing
  to production code. Saves to docs/source/ and registers in prototype_registry.
  This produces reference material only — not production code.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md`).


# rdc:prototype — Prototype Builder

## When to Use

- Project lead wants to see a design before committing to implementation
- A new component or page needs visual review before wiring to database
- Testing a data layout or interaction pattern
- Building a visual mockup for approval

## What This Produces

- JSX/TSX prototype file → `docs/source/<ComponentName>.jsx`
- prototype_registry entry in database
- design_context entries for key decisions

## Prototype Rules

1. **Self-contained** — no real database calls. Mock data arrays only.
2. **Realistic data** — mock data must reflect actual schema field names
3. **Full fidelity** — looks exactly like the final product should look
4. **Annotated** — key design decisions commented at the top of the file
5. **Handoff-ready** — includes the spec block at the bottom

## Standard Mock Data Pattern

Use realistic field names from the actual database schema:

```tsx
// Mock data — mirrors your_table
const MOCK_DATA = [
  {
    id: "uuid-1",
    slug: "example-slug",
    name: "Example Name",
    description: "...",
    location_city: "City",
    location_state: "State",
    status: "active",
    category: "example-category",
    total_capital: 1000000,
    total_area: 2400,
    deploy_url: "https://...",
    tags: ["tag1", "tag2"],
    alignment: ["value1", "value2"],
    web_visible: true,
    ticker_label: "LABEL",
    ticker_capital: "$1M",
    scores: { field1: 82, field2: 71, field3: 68 },
  },
];
```

## File Header Template

```tsx
/**
 * <ComponentName>.jsx — PROTOTYPE
 * ─────────────────────────────────────────────
 * Status: Prototype — reference only, not production code
 * Created: <date>
 * Route (production target): <app-route>
 *
 * Key design decisions:
 * 1. <Decision and rationale>
 * 2. <Decision and rationale>
 *
 * What to preserve in production:
 * - <Design element>
 * - <Interaction pattern>
 *
 * What production implementation must do differently:
 * - Replace mock data with database query
 * - Import <Component> from @regen/ui instead of inline implementation
 * - Extract <Part> into shared component at src/components/<name>
 *
 * Production agent type: frontend | backend | data | viz
 * Production guide: .rdc/guides/<type>.md (fallback: docs/guides/<type>.md)
 */
```

## File Footer Template

```tsx
// ─── HANDOFF SPEC ─────────────────────────────
// Production files:
//   apps/<app>/src/app/<route>/page.tsx           (server component)
//   apps/<app>/src/app/<route>/<Name>Client.tsx   (client component)
//   apps/<app>/src/app/<route>/<Name>Wrapper.tsx  (modal/state shell, if needed)
//
// Design system components to use (do not re-implement):
//   <ComponentName> — <what it does>
//
// Database tables:
//   <table> — <what to query>
//
// Form field schema additions needed:
//   <table>.<column> — <input_type> — <label>
```

## After Building — Register and Record

```sql
-- Register prototype
INSERT INTO prototype_registry (name, component, source_path, notes, created_by)
VALUES (
  '<Name> Prototype v1',
  '<ComponentName>',
  'docs/source/<ComponentName>.jsx',
  '<One-line description of key design: layout, data shape, interactions>',
  'planning'
);

-- Record design decisions
INSERT INTO design_context (topic, context_type, summary, source, created_by)
VALUES
  ('<Topic>', 'prototype', 'Prototype built with <X> layout and <Y> interaction pattern', 'planning', 'planning'),
  ('<Topic>', 'decision',  '<Key decision made during prototyping and why>', 'planning', 'planning');
```

## Handoff

After prototype is approved, use `rdc:handoff` to create the plan doc and database work items.

Or tell the project lead:
```
Prototype complete.
File: docs/source/<ComponentName>.jsx
Registered: prototype_registry

To hand off to CLI build: use /rdc:handoff
To build immediately: use /rdc:build
```
