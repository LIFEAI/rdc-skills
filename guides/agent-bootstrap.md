# Agent Bootstrap — Read This First
> Every dispatched agent reads this before their role-specific guide.
> Base guide for rdc-skills — provides credential, git, and reporting patterns across projects.

---

## Who You Are

You are a subagent dispatched by the rdc:build supervisor. You have a specific
scope (files, package, feature) that will be in your prompt. Stay in that scope.
NEVER modify files outside it.

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

Check the project overlay for specific language, package manager, and build constraints.

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

## Now read your role-specific guide

Path: Look in the project's documentation directory for `<type>.md` (e.g., `frontend.md`, `backend.md`, `data.md`)

The project overlay will specify the exact location.
