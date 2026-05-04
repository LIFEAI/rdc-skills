---
name: rdc:report
description: "Write the nightly session summary to .rdc/reports/YYYY-MM-DD.md covering completed work, open items, per-project progress, and infra status. Call at session end."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag. Git push is skipped under `RDC_TEST=1`.


# rdc:report — Nightly Report

## When to Use
- End of a build session
- Project lead asks for a report or summary
- Nightly scheduled task
- Before handing off to another session
- Called by `rdc:overnight` at the end of every session

## Arguments
- `rdc:report` — interactive, prints summary to conversation
- `rdc:report --unattended` — silent mode, writes file only, returns status block

## Procedure

1. **Query completed work (last 24h or since last report):**
   ```sql
   SELECT title, labels, completed_at, notes
   FROM work_items
   WHERE completed_at > now() - interval '24 hours'
   ORDER BY completed_at;
   ```

2. **Query open work:**
   ```sql
   SELECT title, status, priority, labels
   FROM work_items
   WHERE status IN ('todo', 'in_progress', 'blocked')
   ORDER BY priority, created_at;
   ```

3. **Git stats (since last report or last 24h):**
   ```bash
   git log --since="24 hours ago" --shortstat --oneline
   git diff --shortstat HEAD~N  # where N = commits in window
   ```

4. **Infrastructure deployment snapshot** (if MCP available):
   - List all apps with current status
   - Flag any failures

5. **Write report** to `.rdc/reports/YYYY-MM-DD.md` (fallback: `.rdc/reports/YYYY-MM-DD.md` if `.rdc/` does not exist):
   ```markdown
   # Daily Report — YYYY-MM-DD

   ## Completed Today
   | Item | Project | Priority |

   ## Git Activity
   - Commits: N
   - Files changed: N
   - Lines: +N / -N

   ## Open Work
   ### Urgent (N)
   ### High (N)
   ### Normal (N)

   ## Deployment Status
   | App | Domain | Status |

   ## Blockers
   <any blocked items or failed deploys>

   ## Next Session Recommendation
   <highest priority unstarted work>
   ```

6. **Check if weekly rollup needed** (if today is Sunday):
   - Aggregate daily reports for the week
   - Write `.rdc/reports/week-YYYY-WNN.md` (fallback: `.rdc/reports/week-YYYY-WNN.md`)

7. **Report results:**
   - Interactive: print summary to conversation
   - Unattended: no interactive output, emit status block only:
     ```
     REPORT_STATUS: { report_path, completed_count, open_count, blockers_count }
     ```

## Rules
- Reports go in `.rdc/reports/` (fallback: `.rdc/reports/`) — create dir if missing
- One report per day — overwrite if re-run same day
- Keep under 100 lines — scannable, not exhaustive
- Include links to relevant CLAUDE.md files where helpful
- Always end with "Next Session Recommendation"
- Unattended: NEVER print to conversation — write file only
