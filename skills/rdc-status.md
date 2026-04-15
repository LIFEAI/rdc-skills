---
name: rdc:status
description: >-
  Usage `rdc:status` — open epics, work items by project, Coolify health, blockers, next recommended action. Read-only situational awareness.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:status — Project Dashboard

## When to Use
- Start of any session
- Project lead asks "what's the status", "where are we", "what's open"
- Before deciding what to work on next

## Procedure

1. **Open epics:**
   ```sql
   SELECT get_open_epics();
   ```

2. **Work item counts by status:**
   ```sql
   SELECT status, count(*) FROM work_items 
   WHERE status != 'archived' 
   GROUP BY status ORDER BY status;
   ```

3. **Items by label/project (top 10 labels):**
   ```sql
   SELECT unnest(labels) as label, count(*), 
          count(*) FILTER (WHERE status = 'done') as done,
          count(*) FILTER (WHERE status = 'todo') as todo,
          count(*) FILTER (WHERE status = 'in_progress') as wip
   FROM work_items 
   GROUP BY label ORDER BY count DESC LIMIT 10;
   ```

4. **Recent activity (last 48 hours):**
   ```sql
   SELECT title, status, updated_at 
   FROM work_items 
   WHERE updated_at > now() - interval '48 hours'
   ORDER BY updated_at DESC LIMIT 15;
   ```

5. **Git status:**
   ```bash
   git log --oneline -10
   git status
   git branch -v
   ```

6. **Infrastructure health** (if MCP available):
   - Get infrastructure overview or diagnose issues
   - Report any apps with failed builds or down containers

7. **Present as a compact dashboard:**
   ```
   ## Open Epics (N)
   <table>
   
   ## Work Items: X done | Y todo | Z in_progress
   
   ## Recent (48h)
   <list>
   
   ## Deployments
   <green/red/yellow status>
   
   ## Recommended Next
   <highest priority unstarted epic>
   ```

## Rules
- Keep output concise — this is a glance, not a deep dive
- Always end with a recommendation for what to work on next
- After the Recommended Next section, suggest which guide file from `.rdc/guides/` (fallback: `.rdc/guides/`) the recommended work would need
- Use database MCP for queries (not raw curl)
- If infrastructure MCP is unavailable, skip deployment status and note it
