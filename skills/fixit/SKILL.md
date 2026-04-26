---
name: rdc:fixit
description: >-
  Usage `rdc:fixit <description>` — sanctioned bypass for quick fixes under 5 files / 30 min. Creates minimal work item, makes fix, commits, closes. The ONLY alternative to rdc:build. For typos, config patches, hotfixes, dep bumps.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.


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
if [ "$RDC_TEST" != "1" ]; then
  git push origin {development-branch}
else
  echo "[RDC_TEST] skipping git push origin {development-branch}"
fi
```

### 6. Close and clean up

Submit implementation report first, then mark done:

```sql
SELECT submit_implementation_report('<id>'::uuid,
  '{"tldr":"<one sentence>","assumptions":[],"deviations":[],"uncertainty":[],"detail":"<what was fixed>","flags":[]}'::jsonb
);

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
