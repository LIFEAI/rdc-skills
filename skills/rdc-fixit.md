---
name: rdc:fixit
description: >-
  Sanctioned bypass for quick fixes that don't warrant a full epic. Creates a
  minimal work item, makes the fix, commits, and closes the item. The ONLY
  alternative to rdc:build. Use for typos, config patches, emergency hotfixes,
  single-component tweaks, dependency version bumps — anything under 5 files
  and 30 minutes. Anything larger must use rdc:build.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md`).


# rdc:fixit — Sanctioned Quick Fix

## When to Use
- Typo or single-line text correction
- Config value change (env vars, constants, feature flags)
- Emergency hotfix that cannot wait for a full build cycle
- Dependency version bump
- CSS/styling tweak on a single component
- Broken import or export fix
- Single-file logic correction

## When NOT to Use — escalate to rdc:build instead
- New feature of any size
- Refactor touching >5 files
- Anything requiring architecture decisions
- Work that will take longer than 30 minutes
- Schema changes or migrations

## Arguments
- `rdc:fixit <description>` — fix the described issue

## Procedure

### 1. Scope check (mandatory — do this before touching any file)

Will this fix touch more than **5 files** or take more than **30 minutes**?

- **YES** → Stop. Use `/rdc:build` instead. Explain to the user why.
- **NO** → Continue.

### 2. Create a minimal work item (before touching any code)

```sql
SELECT insert_work_item(
  p_title     := 'fixit: <description>',
  p_item_type := 'bug',
  p_priority  := 'urgent',
  p_status    := 'in_progress',
  p_source    := 'fixit'
);
```

Note the returned `id`.

### 3. Write the fixit session marker

Write to `{USER_HOME}/.claude/fixit.marker`:
```
<work_item_id>
<ISO timestamp>
<description>
```

This signals the Stop hook that fixit is handling its own documentation.

### 4. Make the fix

Do the minimal work. Scope creep rule: if you discover the fix requires more than originally scoped, **stop immediately**:
1. Close the work item: `update_work_item_status('<id>', 'blocked', '["Escalated — scope exceeded fixit threshold"]')`
2. Delete the marker file
3. Tell the user to use `/rdc:build` instead

### 5. Commit

```bash
git add <specific files only — never git add -A for a fixit>
git commit -m "fix(<scope>): <description>"
git push origin {development-branch}
```

### 6. Close and clean up

```sql
SELECT update_work_item_status('<id>'::uuid, 'done',
  '["Fixed via rdc:fixit"]'::jsonb
);
```

```bash
rm {USER_HOME}/.claude/fixit.marker
```

### 7. Confirm to user

Report: what was fixed, file(s) changed, commit hash. One sentence.

## Rules
- Work item created BEFORE any code change — never after
- `git add` specific files only — never `-A` or `.` for a fixit
- Branch: development branch always
- Never run `pnpm build` — not needed for a fixit
- If scope expands mid-fix: stop, escalate to rdc:build, don't finish under fixit
- Marker file must be cleaned up whether fix succeeds or escalates
