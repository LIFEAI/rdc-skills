# Work Items RPC Reference

> Complete reference for work_items table operations via Supabase RPC functions.
> Use these functions for ALL CRUD operations. Never write raw INSERT/UPDATE/SELECT against work_items.

---

## Core Rule

**Always use RPC functions.** They handle defaults, check constraints, timestamps, sorting, and return structured JSONB.

Exception: Ad-hoc analytics queries (e.g., `SELECT count(*)`) are acceptable as raw SQL.

---

## Valid Enum Values

| Column | Allowed Values |
|--------|---|
| `status` | `todo` · `in_progress` · `blocked` · `review` · `done` · `archived` |
| `priority` | `urgent` · `high` · `normal` · `low` |
| `item_type` | `epic` · `task` · `subtask` · `bug` · `spike` |

---

## RPC Functions

### 1. get_open_epics — List open epics

Returns all non-done/archived epics sorted by priority, then created_at.

**Supabase SQL:**
```sql
SELECT get_open_epics();
SELECT get_open_epics('urgent');
SELECT get_open_epics(p_label_filter := 'feature-x');
SELECT get_open_epics('high', 'backend');
```

**Supabase JS Client:**
```ts
const { data } = await supabase.rpc('get_open_epics');
const { data } = await supabase.rpc('get_open_epics', {
  p_priority_filter: 'urgent'
});
const { data } = await supabase.rpc('get_open_epics', {
  p_label_filter: 'cs2'
});
```

**Parameters:**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `p_priority_filter` | text | no | NULL = all priorities. One of: `urgent`, `high`, `normal`, `low` |
| `p_label_filter` | text | no | NULL = all labels. Uses array containment (`@>`) for matching |

**Returns:**
- JSONB array of epic objects (sorted by priority then created_at)
- Empty `[]` if none found
- Each epic has: `id`, `title`, `status`, `priority`, `item_type`, `labels`, `created_at`, `updated_at`

---

### 2. insert_work_item — Create a work item

Create a new task, epic, subtask, bug, or spike.

**Supabase SQL:**
```sql
SELECT insert_work_item(
  p_title := 'Build user authentication',
  p_description := 'Implement OAuth2 flow...',
  p_status := 'todo',
  p_priority := 'high',
  p_item_type := 'task',
  p_parent_id := 'epic-uuid'::uuid,
  p_labels := ARRAY['backend', 'auth'],
  p_source := 'agent'
);
```

**Supabase JS Client:**
```ts
const { data } = await supabase.rpc('insert_work_item', {
  p_title: 'Build user authentication',
  p_description: 'Implement OAuth2 flow...',
  p_status: 'todo',
  p_priority: 'high',
  p_item_type: 'task',
  p_parent_id: epicId,
  p_labels: ['backend', 'auth'],
  p_source: 'agent'
});
```

**All Parameters:**

| Name | Type | Default | Notes |
|------|------|---------|-------|
| `p_title` | text | *required* | Work item name (max 255 chars) |
| `p_description` | text | NULL | Long-form description |
| `p_status` | text | `'todo'` | One of: `todo`, `in_progress`, `blocked`, `review`, `done`, `archived` |
| `p_priority` | text | `'normal'` | One of: `urgent`, `high`, `normal`, `low` |
| `p_item_type` | text | `'task'` | One of: `epic`, `task`, `subtask`, `bug`, `spike` |
| `p_parent_id` | uuid | NULL | Parent epic UUID for hierarchy (for subtasks) |
| `p_company_id` | uuid | NULL | Foreign key to companies table |
| `p_customer_id` | uuid | NULL | Foreign key to customers table |
| `p_campaign_id` | uuid | NULL | Foreign key to campaigns table |
| `p_contact_id` | uuid | NULL | Foreign key to contacts table |
| `p_project_id` | uuid | NULL | Project identifier (project-specific) |
| `p_assignee` | text | NULL | Assigned person name or email |
| `p_assigned_to` | text | NULL | Same as assignee (alternate field) |
| `p_due_date` | date | NULL | Due date for the task |
| `p_tags` | text[] | `'{}'` | Array of tags |
| `p_labels` | text[] | `'{}'` | Array of labels (used for filtering) |
| `p_linked_table` | text | NULL | Name of external table to link (if any) |
| `p_linked_id` | uuid | NULL | ID in linked_table |
| `p_created_by` | text | NULL | Who created this item |
| `p_estimated_hours` | numeric | NULL | Time estimate in hours |
| `p_notes` | jsonb | `'[]'` | Array of note objects `[{ text, author, timestamp }]` |
| `p_session_id` | text | NULL | Session UUID (for audit trail) |
| `p_package` | text | NULL | Package/module name (e.g., '@regen/ui') |
| `p_source` | text | `'manual'` | How was this created: `manual`, `agent`, `api`, `import` |

**Returns:**
- Full inserted work_item row as JSONB
- Includes auto-generated `id`, `created_at`, `updated_at`

---

### 3. update_work_item_status — Change status

Transition a work item's status. Auto-manages `completed_at`.

**Supabase SQL:**
```sql
SELECT update_work_item_status(
  'work-item-uuid'::uuid,
  'in_progress'
);

SELECT update_work_item_status(
  'work-item-uuid'::uuid,
  'done',
  '["Completed by agent session xyz"]'::jsonb
);
```

**Supabase JS Client:**
```ts
const { data } = await supabase.rpc('update_work_item_status', {
  p_id: itemId,
  p_status: 'in_progress'
});

const { data } = await supabase.rpc('update_work_item_status', {
  p_id: itemId,
  p_status: 'done',
  p_notes_append: ['Completed by agent session xyz']
});
```

**Parameters:**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `p_id` | uuid | yes | work_item ID |
| `p_status` | text | yes | One of: `todo`, `in_progress`, `blocked`, `review`, `done`, `archived` |
| `p_notes_append` | jsonb | no | Array of strings appended to existing notes |

**Behavior:**
- Setting `done` auto-sets `completed_at = now()`
- Setting `todo`, `in_progress`, `blocked`, or `review` clears `completed_at`
- `updated_at` always refreshed to current timestamp
- Raises exception if ID not found

**Returns:**
- Full updated work_item row as JSONB

---

### 4. get_work_items_by_epic — Fetch epic + children

Get an epic and all its child tasks/subtasks, sorted by priority.

**Supabase SQL:**
```sql
SELECT get_work_items_by_epic('epic-uuid'::uuid);
SELECT get_work_items_by_epic('epic-uuid'::uuid, 'todo');
```

**Supabase JS Client:**
```ts
const { data } = await supabase.rpc('get_work_items_by_epic', {
  p_epic_id: epicId
});

const { data } = await supabase.rpc('get_work_items_by_epic', {
  p_epic_id: epicId,
  p_status_filter: 'todo'
});
```

**Parameters:**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `p_epic_id` | uuid | yes | The epic's work_item ID |
| `p_status_filter` | text | no | NULL = all statuses. One of: `todo`, `in_progress`, `blocked`, `review`, `done`, `archived` |

**Returns:**
- JSONB array with parent epic first, then children
- Sorted by: priority (urgent > high > normal > low), then created_at
- Each item has same structure as returned from insert_work_item

---

### 5. bump_epic_version — Version with history

Snapshot an epic's current state and assign a version number.

**Supabase SQL:**
```sql
SELECT bump_epic_version(
  'epic-uuid'::uuid,
  '0.2.0',
  'Added async task execution',
  'agent'
);
```

**Supabase JS Client:**
```ts
const { data } = await supabase.rpc('bump_epic_version', {
  p_epic_id: epicId,
  p_version: '0.2.0',
  p_change_summary: 'Added async task execution',
  p_changed_by: 'agent'
});
```

**Parameters:**

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `p_epic_id` | uuid | yes | Must be item_type = `'epic'` |
| `p_version` | text | yes | Semantic version string (e.g., `'0.1.0'`, `'1.0.0'`) |
| `p_change_summary` | text | no | What changed in this version |
| `p_changed_by` | text | no | Who bumped the version |

**Behavior:**
- Snapshots the epic's current state into work_item_versions table
- Updates the epic's `version` column
- Raises exception if item is not an epic (item_type != 'epic')

**Returns:**
- JSONB object: `{ epic_id, version, version_record_id, change_summary, changed_by, bumped_at }`

---

## Common Patterns

### Create an Epic + Child Tasks

```ts
// 1. Create epic
const { data: epic } = await supabase.rpc('insert_work_item', {
  p_title: 'Implement feature X',
  p_item_type: 'epic',
  p_status: 'todo',
  p_priority: 'high',
  p_source: 'agent'
});
const epicId = epic[0].id;

// 2. Create child tasks
for (const task of tasks) {
  await supabase.rpc('insert_work_item', {
    p_title: task.title,
    p_item_type: 'task',
    p_priority: task.priority,
    p_parent_id: epicId,
    p_source: 'agent'
  });
}
```

### Fetch Epic Tree, Filter by Status, Update Each

```ts
const { data: tree } = await supabase.rpc('get_work_items_by_epic', {
  p_epic_id: epicId,
  p_status_filter: 'todo'
});

for (const item of tree) {
  if (item.item_type === 'epic') continue; // skip parent
  
  await supabase.rpc('update_work_item_status', {
    p_id: item.id,
    p_status: 'in_progress'
  });
}
```

### Mark Epic Done with Notes

```ts
const { data } = await supabase.rpc('update_work_item_status', {
  p_id: epicId,
  p_status: 'done',
  p_notes_append: [
    'All child tasks completed',
    'Code reviewed and merged to main',
    'Deployed to production'
  ]
});
```

### List All Open Work, Filter by Priority

```ts
const { data: epics } = await supabase.rpc('get_open_epics', {
  p_priority_filter: 'urgent'
});

for (const epic of epics) {
  const { data: items } = await supabase.rpc('get_work_items_by_epic', {
    p_epic_id: epic.id
  });
  // process items...
}
```

---

## Supabase Project Reference

In production, you'll need:

**Environment variables (in .env.local):**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # Server-side only
```

Replace `<project-ref>` with your actual Supabase project reference (e.g., `uvojezuorjgqzmhhgluu`).

**Project-specific data (from docs/guides/agent-bootstrap.md):**
- SUPABASE_PROJECT_ID (if required by your project)
- Any custom schema names (if work_items lives in non-public schema)
- Related table names (companies, customers, contacts, campaigns, etc.)

---

## Error Handling

### RPC Not Found
If `get_open_epics` returns a 404, the function doesn't exist on your Supabase instance.
Run migration to add the function, or contact your DBA.

### Invalid UUID
```ts
// Wrong — string passed directly
p_id: "item-id"

// Correct — cast to uuid
p_id: itemId
```

### Status Not in Enum
Check `p_status` against allowed values. Will raise a constraint error if invalid.

### Item Not Found
`update_work_item_status` and `bump_epic_version` will raise an exception if ID doesn't exist.
Always catch or check first:
```ts
const { data: items } = await supabase.rpc('get_work_items_by_epic', { p_epic_id: id });
if (!items || items.length === 0) {
  // Epic not found
}
```

---

## Analytics (Raw SQL)

Direct SELECT is acceptable for read-only analytics:

```sql
SELECT status, count(*) as cnt FROM work_items GROUP BY status;
SELECT priority, count(*) FROM work_items WHERE labels @> ARRAY['urgent'] GROUP BY priority;
SELECT avg(EXTRACT(EPOCH FROM (completed_at - created_at))/3600)::numeric(10,2) as avg_hours
  FROM work_items WHERE status = 'done' AND item_type = 'task';
```

For INSERT/UPDATE/DELETE: always use the RPC functions above.
