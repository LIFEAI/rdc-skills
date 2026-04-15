---
name: rdc:overnight
description: >-
  Usage `rdc:overnight [epic-id|label=X]` — unattended overnight supervisor, chains preplan → plan → build → review → report across all high-priority epics in --unattended mode. Use for "run overnight", "build while I sleep".
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


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

**First action — set the overnight sentinel** so the `no-stop-open-epics` Stop hook engages (interactive sessions are not gated by it):

```bash
mkdir -p C:/Dev/regen-root/.rdc && touch C:/Dev/regen-root/.rdc/overnight.lock
```

**Last action at end of run (success OR failure) — remove the sentinel:**

```bash
rm -f C:/Dev/regen-root/.rdc/overnight.lock
```

If the sentinel file does not exist, the Stop hook will NOT block — which means interactive sessions stop freely and only `rdc:overnight` is held to the "drain the queue" contract.

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

Log the epic queue at the start of `.rdc/reports/overnight-<YYYY-MM-DD>.md` (fallback: `.rdc/reports/overnight-<YYYY-MM-DD>.md` if `.rdc/` does not exist).

## Phase 3 — Epic Loop

For each epic in the queue, run this sequence:

### 3a. Research (if needed)
Condition: epic has 0 child tasks AND no matching doc in `.rdc/plans/` (or `.rdc/plans/` as fallback)

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

Agents receive the relevant guide file from `.rdc/guides/` (fallback: `.rdc/guides/`) based on their work package type.

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

2. Write session summary to `.rdc/reports/overnight-<YYYY-MM-DD>.md` (fallback: `.rdc/reports/overnight-<YYYY-MM-DD>.md`):
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
