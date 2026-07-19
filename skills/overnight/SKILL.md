---
name: rdc:overnight
description: "Usage `rdc:overnight [epic-id|label=<label>]` — Unattended end-to-end: drain the entire work queue autonomously (preplan → plan → build → review → report). Inherits mandatory per-wave code-review (pr-review-toolkit:code-reviewer) from rdc:build and rdc:review. Use when leaving Claude to run unsupervised for an extended session."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.


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
mkdir -p {PROJECT_ROOT}/.rdc && touch {PROJECT_ROOT}/.rdc/overnight.lock
```

**Last action at end of run (success OR failure) — remove the sentinel:**

```bash
rm -f {PROJECT_ROOT}/.rdc/overnight.lock
```

If the sentinel file does not exist, the Stop hook will NOT block — which means interactive sessions stop freely and only `rdc:overnight` is held to the "drain the queue" contract.

Before touching any code, verify the environment is safe:

1. **Clauth daemon alive AND unlocked:** `/ping` alive is NOT enough — a LOCKED
   vault answers `/ping` but every `/v/<service>` returns nothing, so credentials
   silently resolve empty and a long unattended run fails hours later
   (lesson 2026-06-16-overnight-preflight-clauth-locked-and-shared-develop-cells).
   Assert `locked:false` before proceeding:
   ```bash
   curl -s http://127.0.0.1:52437/ping
   curl -s http://127.0.0.1:52437/status | python3 -c "import sys,json; s=json.load(sys.stdin); print('locked:', s.get('locked')); sys.exit(1 if s.get('locked') else 0)"
   ```
   If not responding OR `locked:true`: report `BLOCKED: credential daemon offline or locked` and exit. Do not proceed.

2. **Git state clean AND no concurrent committer on shared develop:** Overnight
   shares the `develop` working tree with other cells/sessions. A second session
   committing concurrently can drop a just-committed file during a rebase
   (lessons 2026-06-16-overnight-preflight-clauth-locked-and-shared-develop-cells,
   2026-06-17-build-shared-develop-rebase-dropped-committed-file).
   ```bash
   git status --short
   git fetch -q origin && git log --oneline @..@{u}   # any rows = origin moved under you
   ```
   Must be on the development branch with no uncommitted changes. If dirty: commit
   or stash first. If `origin/develop` is ahead of local at preflight, another
   session is actively committing — enforce these rules for the whole run:
   - **Atomic stage+commit by explicit path** — `git add <paths>` then immediate
     `git commit`; never leave a wide `git add -A` window open while another
     session may stage.
   - **Post-push origin verification** — after every push, confirm each committed
     file actually reached origin (a rebase can silently drop it):
     ```bash
     git cat-file -e origin/develop:<path> && echo "OK: <path> on origin" || echo "DROPPED: <path> — re-apply and re-push"
     ```
     A `DROPPED` result means re-apply the file on fresh `origin/develop` HEAD and push again.

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

### Targeted vs. queue mode

- **Targeted (`rdc:overnight <epic-id>`):** work that one epic only. When it completes, remove the sentinel and exit — do NOT poll for more epics.
- **Queue mode (`rdc:overnight` no args or `label=X`):** drain all matching epics sequentially.

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

**Mandatory code-review gate inherited from rdc:build (Step 9b).** Every wave inside `rdc:build` runs a `pr-review-toolkit:code-reviewer` pass before the next wave dispatches. Critical/high findings reopen the affected work items to `todo` and the next wave fixes them. Overnight does not skip or weaken this gate. If a wave's code-review escalates twice, advisor decides; otherwise the loop continues.

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
if [ "$RDC_TEST" != "1" ]; then
  git push origin {development-branch}
else
  echo "[RDC_TEST] skipping git push origin {development-branch}"
fi
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
   if [ "$RDC_TEST" != "1" ]; then
     git push origin {development-branch}
   else
     echo "[RDC_TEST] skipping final git push origin {development-branch}"
   fi
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

## Capture lessons (exit step)

Before the final verdict line, follow `.rdc/guides/lessons-learned-spec.md` § Capture procedure. If this run taught something non-obvious — a first root-cause theory that turned out wrong, the documented/standard path not working, a missing gate or check that cost a round, or a surprising tool/infra behavior — write one `.rdc/lessons/<YYYY-MM-DD>-overnight-<short-slug>.md` per lesson using the schema in that spec. Set `scope` (`simple` | `architectural`) and `lesson_status: open`; weekly triage alone records a final lesson outcome. Commit the lesson file(s) on `develop` alongside the run's other commits, and note "N lessons captured" in your verdict/summary. A run that taught nothing writes nothing — absence is the default.
