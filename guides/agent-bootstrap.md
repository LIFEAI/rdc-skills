# Agent Bootstrap — Read This First
> Every dispatched agent reads this before their role-specific guide.
> Base guide for rdc-skills — provides credential, git, and reporting patterns across projects.

---

## Who You Are

You are a subagent dispatched by the rdc:build supervisor. You have a specific
scope (files, package, feature) that will be in your prompt. Stay in that scope.
NEVER modify files outside it.

Read `guides/engineering-behavior.md` next when it is available. It defines the
RDC implementation posture for assumptions, minimal changes, surgical scope,
verification evidence, and escalation.

---

## Credentials — Daemon Access Pattern

You do NOT have access to cloud MCP connectors. Instead, all credentials
come from a daemon running locally (typically on localhost:52437).

**Ping first to confirm availability:**
```bash
curl -s http://127.0.0.1:52437/ping
```
If it doesn't respond — report BLOCKED, do not proceed.

**Get a credential:**
```bash
curl -s http://127.0.0.1:52437/get/<service>
```

**Pattern for extracting key/value without printing:**
```bash
# Correct pattern — never echo the key
KEY=$(curl -s http://127.0.0.1:52437/get/<service> | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")
curl -s -H "Authorization: Bearer $KEY" https://api.example.com/...
```

**Never print credentials to stdout.** Capture to a variable, use inline, discard.

---

## Project Directory Convention

This plugin uses the `.rdc/` directory convention. Check for it first:

```bash
# Check if .rdc/ exists at project root
ls {PROJECT_ROOT}/.rdc/config.json 2>/dev/null && echo "using .rdc/" || echo "using docs/ fallback"
```

**Path resolution rule:**
- Guides: `{PROJECT_ROOT}/.rdc/guides/` → fallback: `{PROJECT_ROOT}/docs/guides/`
- Plans: `{PROJECT_ROOT}/.rdc/plans/` → fallback: `{PROJECT_ROOT}/docs/plans/`
- Reports: `{PROJECT_ROOT}/.rdc/reports/` → fallback: `{PROJECT_ROOT}/docs/reports/`
- Research: `{PROJECT_ROOT}/.rdc/research/` → fallback: `{PROJECT_ROOT}/docs/research/`

If `.rdc/config.json` exists, read it for project metadata (name, description, conventions).

---

## Database Access — Check Project Overlay

The project overlay guide will specify:
- Database project reference / instance name
- Whether to use MCP connectors or daemon
- Available RPC functions
- Work item management patterns

Read the project-specific agent-bootstrap.md overlay for exact connection details.

---

## Git Rules

- Branch: Always use the project's primary development branch (typically `develop` or `main`)
- Auto-commit after completing your scope — no confirmation needed
- Commit message must use conventional format: `feat/fix/chore/refactor(<scope>): description`
- Push to origin after committing
- NEVER force-push

---

## Build Rules

Never run `pnpm build` or equivalent full builds locally — they consume excessive memory.
Type-check only: `npx tsc --noEmit --project <path>/tsconfig.json`
Run tests only for modified packages: modify tests in isolation, not whole suite.

### No Foreground Windows

Agent-launched processes must not steal focus. This is a hard local-operator
rule, not a preference.

- Playwright must run headless. Do not use `--headed`, `--ui`, `codegen`, `open`, `show-report`, or `PWDEBUG=1` in agent sessions.
- Use list/dot/json reporters and saved trace/report artifacts instead of opening the Playwright UI.
- PowerShell helpers must use `-WindowStyle Hidden -NonInteractive`, or a hidden wrapper.
- `Start-Process` must include `-WindowStyle Hidden` or `-WindowStyle Minimized`.
- `cmd /c start` must use `/min` for intentionally visible tools or `/b` for background work.
- Node/cmd/ps1 helpers launched by hooks must go through the RDC hidden hook runner.

Check the project overlay for specific language, package manager, and build constraints.

---

## RDC_TEST Sandbox Contract

When `RDC_TEST=1` is set, the skill is running inside the Tier 2 sandbox harness. Short-circuit all destructive external side effects.

**How to detect:** `process.env.RDC_TEST === '1'` (Node/JS) or `[ "$RDC_TEST" = "1" ]` (bash). The Tier 2 runner sets this before invoking `claude --print`.

**Allowed under RDC_TEST** — run normally, no guard:

| Operation | Why |
|-----------|-----|
| Local git commits | Commit to the worktree branch; never pushed |
| Local filesystem writes | Inside the sandbox worktree |
| Supabase reads | Assertions read prod DB; no writes |
| Service reads | Coolify status, CF DNS lookup, GitHub read — all safe |
| `clauth` credential reads | Read-only against the daemon |

**Short-circuit under RDC_TEST** — must be wrapped in a guard:

- Supabase INSERT/UPDATE/DELETE (work items, prototype_registry, design_context, etc.) — runner uses main-db mode, no test branch
- Coolify app deploys / restarts / config writes
- Cloudflare DNS writes / cache purges
- R2 object writes / deletes
- `git push` to any remote
- `gh pr create`, `gh release create`, tag pushes
- `npm publish`
- Any webhook fire, email send, Slack post
- MCP connector tools that mutate external state (e.g. `mcp__coolify__deploy`)

**Bash pattern:**
```bash
if [ "$RDC_TEST" != "1" ]; then
  curl -X POST "https://deploy.regendevcorp.com/api/v1/applications/$UUID/deploy" ...
else
  echo "[RDC_TEST] skipping Coolify deploy"
fi
```

**Node/JS pattern:**
```js
if (process.env.RDC_TEST !== '1') {
  await deployToCoolify(...);
} else {
  console.log('[RDC_TEST] skipping Coolify deploy');
}
```

**Why this matters:** Tier 2 runs every skill in a throwaway sandbox. If your skill fires a real deploy or DNS change under `RDC_TEST`, the test isn't a test — it's a production incident.

**New-skill contract:** every new `rdc:*` skill MUST honor `RDC_TEST` before shipping. Tier 2 manifests will fail any skill that writes to external state under the flag.

**Known blocker:** The `check-cwd.js` SessionStart hook hard-blocks Claude sessions launched from `C:/Dev/rdc-skills`. The hook must check `process.env.RDC_TEST === '1'` and call `process.exit(0)` early to allow Tier 2 sandbox runs. Without this bypass, all Tier 2 headless invocations fail with `exit_code: -1`. File: `~/.claude/hooks/check-cwd.js`.

---

## Completion Report

When your scope is done, return a structured report to the supervisor:

```
AGENT_COMPLETE: {
  scope: "<what you were assigned>",
  files_changed: ["path/to/file", ...],
  work_item_id: "<id if you had one>",
  commits: ["<hash> <message>"],
  blockers: ["<anything that needs supervisor attention>"]
}
```

If you hit a blocker mid-task: stop, report it, do not guess or work around it.

---

## Self-Check Rules — Prevent Getting Lost

### 10-Minute Rule
If you have been working on a **single step** for more than 10 minutes without measurable progress (no new files changed, no successful tool calls, no forward movement), **stop immediately**. Do not keep trying variations. Report it as a blocker.

### 2-Retry Rule
If the **same command or approach fails twice**, stop. Do not attempt a third variation or creative workaround. Report the failure with the exact error output.

### Scope Drift Rule
If you discover that fixing your assigned task would also require changing files **outside your scope**, stop. Do not fix them. Add them to `blockers` in your AGENT_COMPLETE report. The supervisor assigns them separately.

### What "measurable progress" means
- A file was created or modified ✅
- A tool call succeeded and returned useful data ✅
- A command ran without error ✅
- Trying the same thing with slightly different parameters ❌
- Reading the same file again hoping for different insight ❌
- Rephrasing a failing query ❌

---

## ⛔ Implementation Report + CodeFlow Exit Contract

Every implementation agent MUST follow this protocol before moving a work item
to `review`. Agents do not close non-epic work as `done`; validators close it
after fresh verification.

### Step 1 — Tick checklist items as you complete them

```sql
SELECT update_checklist_item(
  '<work-item-id>'::uuid,
  'item-id',
  true,
  '<agent-session-id>',
  'agent',
  'rpc'
);
```

Call this for each item AS you complete it — not all at once at the end. The
database records every tick in `work_item_checklist_events`. Supervisor and
validator re-ticks are rejected by the exit gate.

### Step 2 — Submit implementation report BEFORE marking done

```sql
SELECT submit_implementation_report(
  '<work-item-id>'::uuid,
  '{
    "tldr":"...",
    "assumptions":[],
    "deviations":[],
    "uncertainty":[],
    "detail":"...",
    "flags":[],
    "codeflow_post":{
      "agent_session_id":"<agent-session-id>",
      "summary":"...",
      "files_changed":["path/to/file"],
      "verification":["command or evidence"],
      "commit":"<optional commit hash>"
    }
  }'::jsonb
);
```

Returns `{ flags_count, deviations_count, has_deviations }`. Include this signal in your `AGENT_COMPLETE` report.

### Step 3 — Move to review

```sql
SELECT update_work_item_status(
  '<work-item-id>'::uuid,
  'review',
  '["Implementation complete; ready for validator"]'::jsonb,
  '<agent-session-id>',
  'agent'
);
```

If the report or `codeflow_post` is missing, the database raises EXCEPTION.

### Validator close — mark done only after fresh review

```sql
SELECT update_work_item_status(
  '<work-item-id>'::uuid,
  'done',
  '["Validator verified implementation report, CodeFlow post, and checklist evidence"]'::jsonb,
  '<validator-session-id>',
  'validator'
);
```

If any `required: true` checklist item is still unchecked, was re-ticked by a
supervisor/validator, or was ticked by a different session than the originating
agent, the DB and PreToolUse hook reject the close.

### Supervisor workflow

- All zeros → clean run, proceed
- `flags_count > 0` or `deviations_count > 0` → pull full report:
  ```sql
  SELECT implementation_report FROM work_items WHERE id = '<id>';
  ```

---

## Now read your role-specific guide

Path: `{PROJECT_ROOT}/.rdc/guides/<type>.md` (e.g., `frontend.md`, `backend.md`, `data.md`)
Fallback: `{PROJECT_ROOT}/docs/guides/<type>.md` if `.rdc/` does not exist.

The project overlay will specify the exact location if it differs from the convention above.
