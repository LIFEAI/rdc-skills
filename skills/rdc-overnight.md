---
name: rdc:overnight
description: >-
  Unattended overnight build supervisor. Orchestrates the full rdc:* skill suite
  (preplan → plan → build → review → report) in --unattended mode across all
  high-priority epics. Uses the advisor tool for escalation when stuck.
  Use when the project lead says "run overnight", "start the overnight build",
  "build while I sleep", or wants to kick off an autonomous multi-epic build session.
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md` first.


# rdc:overnight — Overnight Build Supervisor

## When to Use
- Starting an unattended multi-hour build session
- Project lead says "run overnight", "build everything", "go while I sleep"
- Kicking off a full epic queue after scoping is agreed

## Arguments
- `/rdc:overnight` — work all urgent/high priority todo epics
- `/rdc:overnight <epic-id>` — work a specific epic only
- `/rdc:overnight label=<label>` — work epics matching label

## Phase 1 — Pre-flight

Before touching any code, verify the environment is safe:

1. **Clauth daemon alive:**
   ```bash
   curl -s http://127.0.0.1:52437/ping
   ```
   If not responding: report `BLOCKED: credential daemon offline` and exit. Do not proceed.

2. **Git state clean:**
   ```bash
   git status --short
   ```
   Must be on the development branch with no uncommitted changes. If dirty: commit or stash first.

3. **Baseline review:**
   Run `rdc:review --unattended`. If `REVIEW_STATUS.verdict = "HAS_ISSUES"` and
   issues cannot be auto-fixed: report `BLOCKED: codebase has pre-existing issues` and exit.
   A dirty baseline overnight compounds into a disaster by morning.

If all three pass: proceed to Phase 2.

## Phase 2 — Load Scope

Determine which epics to work:

- **Specific epic arg:** load that one epic via `get_work_items_by_epic()`
- **Label filter:** `SELECT get_open_epics(p_label_filter := '<label>')`
- **No arg (default):** `SELECT get_open_epics()` filtered to:
  - `priority IN ('urgent', 'high')`
  - `status IN ('todo', 'in_progress')`
  - Order: urgent first, then high, then by `created_at`

Log the epic queue at the start of `docs/reports/overnight-<YYYY-MM-DD>.md`.

## Phase 3 — Epic Loop

For each epic in the queue, run this sequence:

### 3a. Research (if needed)
Condition: epic has 0 child tasks AND no matching doc in `docs/plans/`

```
rdc:preplan <topic> --unattended
```

Check `PREPLAN_STATUS.recommendation_confidence`:
- `"high"` or `"medium"`: proceed
- `"low"`: escalate via advisor tool (see Escalation Protocol below)
  - If advisor gives direction: proceed with that direction
  - If advisor cannot resolve: skip this epic, log reason, move to next

### 3b. Plan (if no tasks exist)
Condition: epic has 0 child tasks after preplan

```
rdc:plan <epic-id> --unattended
```

Check `PLAN_STATUS.task_count > 0` before continuing.
If 0 tasks created: escalate via advisor, then skip if still unresolved.

### 3c. Build

This skill delegates to rdc:build which uses typed agent dispatch. See rdc:build for agent type classification.

```
rdc:build <epic-id> --unattended
```

Agents receive the relevant guide file from `docs/guides/` based on their work package type.

After each wave: check `BUILD_STATUS`. If `escalated: true`, log the escalation
in the overnight doc and continue — don't stop the loop.

### 3d. Review

```
rdc:review --unattended
```

Check `REVIEW_STATUS.verdict`:
- `"CLEAN"`: mark epic `done` in work_items, push, continue to next epic
- `"HAS_ISSUES"` with `escalations > 0`: log issues, push what's clean, continue
- `"HAS_ISSUES"` with `escalations = 0` (all auto-fixed): push, continue

### 3e. Commit checkpoint

After each epic (pass or fail):
```bash
git push origin {development-branch}
```

This ensures every epic's work is saved regardless of what comes next.

## Phase 4 — Exit

After all epics are processed:

1. Run `rdc:report --unattended`

2. Write session summary to `docs/reports/overnight-<YYYY-MM-DD>.md`:
   ```markdown
   # Overnight Session — YYYY-MM-DD

   ## Started
   <timestamp>

   ## Epics Attempted
   | Epic | Status | Tasks Done | Commits |

   ## Epics Completed
   <list with epic IDs>

   ## Escalations
   N advisor calls — details:
   - <epic>: <what was escalated> → <advisor response>

   ## Blockers Remaining
   <any epics skipped or partially done>

   ## Git Summary
   - Total commits: N
   - Push status: ✅

   ## Completed
   <timestamp>
   ```

3. Final push:
   ```bash
   git push origin {development-branch}
   ```

## Escalation Protocol

The advisor tool pairs this executor with a high-level model for high-stakes decisions.
Use it when genuinely stuck — not for every small uncertainty.

**Escalation triggers:**
- `PREPLAN_STATUS.recommendation_confidence = "low"` (too many unknowns)
- `PLAN_STATUS.task_count = 0` after planning (nothing actionable)
- Build agent fails twice on the same task
- `REVIEW_STATUS` has unfixable issues requiring architectural judgment
- Credential daemon goes down mid-session (escalate before exiting)

**How to escalate:**
Provide the advisor with:
1. What was attempted and what failed
2. The error or ambiguity in detail
3. Two most likely paths forward with tradeoffs
4. Which epic/task is blocked

**After advisor responds:**
- Log the guidance in the overnight doc
- Resume the loop from where it stopped
- If advisor cannot resolve: mark task/epic `blocked`, log reason, skip to next

**Max escalations:** 3 per epic. After 3, skip the epic and log.

## Safety Rules

- Branch: development branch always — NEVER touch main/production
- NEVER run `pnpm build` — use `npx tsc --noEmit` for typecheck, vitest for tests only on modified packages
- NEVER let agents overlap on the same files
- Push after every epic, not just at the end
- Update Supabase work items in real time throughout
- Max 2 hours per epic — if exceeded, skip and log `TIMEOUT`
- If credential daemon goes down mid-session: write current state to overnight doc, push, exit gracefully
- If git push fails: log the failure, attempt rebase, retry once — do not force push
