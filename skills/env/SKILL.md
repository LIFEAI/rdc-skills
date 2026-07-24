---
name: rdc:env
description: "Usage `rdc:env [status|install|repair|update]` — Manage the LIFEAI environment harness: check status, install on a fresh box, repair broken services, or pull updates. Reads $LIFEAI_ENV/manifest.json as the source of truth. Use when: 'check the environment', 'install environment', 'repair environment', 'update environment', 'setup env', 'fix env', 'env status', or after a reboot/GPU crash."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:env — Environment Harness Manager

## When to Use
- After a reboot or GPU crash — verify everything came back up
- Setting up a fresh box — install all tools and services
- Something is broken — repair services, MCPs, CodeFlow
- Routine update — pull latest env repo and run drift check
- "check the environment", "fix my setup", "install environment"

## Subcommands

| Command | What it does |
|---------|-------------|
| `status` (default) | Read-only check: env repo version, tool versions, MCP health, shim integrity, CodeFlow brain |
| `install` | Full provision: clone env repo if missing, set LIFEAI_ENV, install tools, configure MCPs |
| `repair` | Diagnose and fix: restart crashed services, rebuild stale dists, fix broken shims |
| `update` | Pull latest env repo, re-run audit, report drift, refresh shims if new scripts added |

## Procedure

### Step 0: Resolve environment root

```bash
LIFEAI_ENV="${LIFEAI_ENV:-C:/Dev/lifeai-env}"
```

If `$LIFEAI_ENV` is not set AND the default path doesn't exist:
- For `install`: clone the repo and set the env var
- For all others: STOP with `BLOCKED: environment repo not found. Run: rdc:env install`

Read `$LIFEAI_ENV/manifest.json` — this is the harness inventory.

### Step 1: Environment repo state

```bash
git -C "$LIFEAI_ENV" fetch origin 2>/dev/null
git -C "$LIFEAI_ENV" rev-list --count HEAD..origin/main
```

Report: version from manifest.json, commits behind origin, last pull date.

For `update`: pull if behind. For `repair`: pull if behind (stale harness may be the cause).

### Step 2: Tool versions (audit)

Run the audit script:
```bash
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$LIFEAI_ENV/audit/audit.ps1" -ProjectRoot "$PROJECT_ROOT"
```

Or read `$PROJECT_ROOT/environment.lock.json` and check each tool:

| Tool | Check | Min Version |
|------|-------|-------------|
| node | `node --version` | 22.0.0 |
| pnpm | `pnpm --version` | 10.0.0 |
| pm2 | `pm2 --version` | 5.0.0 |
| clauth | `curl -s http://127.0.0.1:52437/ping` | 1.30.0 |
| rdc-skills | `npm list -g @lifeai/rdc-skills` | 0.25.0 |
| gh | `gh --version` | 2.0.0 |

For `install` and `repair`: install or upgrade any tool below min_version using the `install` command from the lock file. This includes rdc-skills itself — the environment repo is the orchestrator that keeps all tools current, including its own skill set. A `repair` or `install` that bumps rdc-skills will also restart the rdc-skills-mcp PM2 process so the new version is live immediately.

### Step 3: Service health

Check each service:

| Service | Health Check | Repair |
|---------|-------------|--------|
| clauth daemon | `curl -s http://127.0.0.1:52437/ping` | `$LIFEAI_ENV/services/restart-clauth.bat` |
| CodeFlow gateway | `curl -s http://127.0.0.1:3109/health` | `node $PROJECT_ROOT/scripts/codeflow-up.mjs` |
| CodeFlow brain | `/health` → `health.state` should be `operational` | `node $PROJECT_ROOT/scripts/codeflow-up.mjs --restart` |
| rdc-skills MCP | `pm2 list` shows rdc-skills-mcp online | `pm2 restart rdc-skills-mcp` |
| PM2 daemon | `pm2 ping` | `pm2 resurrect` |
| Docker | `docker info` | Start Docker Desktop |
| Neo4j | `docker inspect codeflow-neo4j` | `docker compose -f $LIFEAI_ENV/services/codeflow/docker-compose.yml up -d` |

For `status`: report only. For `repair`: fix each failing service in order (clauth first, then CodeFlow, then MCPs).

### Step 4: MCP server verification

Run the MCP checker:
```bash
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$LIFEAI_ENV/services/install-mcps.ps1" -ProjectRoot "$PROJECT_ROOT"
```

For `repair`: add `-Fix` flag to auto-start missing local MCPs.

### Step 5: Shim integrity

Check that all monorepo shims point at valid targets:
```bash
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$LIFEAI_ENV/provision.ps1" -ProjectRoot "$PROJECT_ROOT" -SkipTools -DryRun
```

Look for "broken shim" warnings. For `repair`: re-run provision.ps1 live.

### Step 6: Agent readiness (final gate)

```bash
pnpm --filter @regen/codeflow startup:readiness
```

This is the same check the startup guard runs. Zero blockers = environment healthy.

## Output Format

```
## rdc:env <command> — Environment Health

| Check | Status | Detail |
|-------|--------|--------|
| Env repo | ✅ | v0.2.0, 0 behind origin |
| LIFEAI_ENV | ✅ | C:/Dev/lifeai-env (Machine scope) |
| Node | ✅ | v22.14.0 (min 22.0.0) |
| pnpm | ✅ | 10.12.1 (min 10.0.0) |
| clauth | ✅ | v1.30.2, unlocked |
| CodeFlow | ✅ | v0.33.11, brain=dev, operational |
| rdc-skills MCP | ✅ | v0.25.0, online |
| Shims | ✅ | 47/47 valid |
| Agent readiness | ✅ | 0 blockers |

**Verdict: environment healthy (9/9 checks pass)**
```

For `repair`, append:
```
## Repairs Applied
- [x] Restarted clauth daemon
- [x] Rebuilt CodeFlow dist + restarted gateway
- [ ] rdc-skills: already running
```
