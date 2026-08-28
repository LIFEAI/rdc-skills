---
name: env
description: "Usage `rdc:env [status|install|repair|update]` — Manage the LIFEAI environment harness: check status, install on a fresh box, repair broken services, or pull updates. Reads $LIFEAI_ENV/manifest.json as the source of truth. Use when: 'check the environment', 'install environment', 'repair environment', 'update environment', 'setup env', 'fix env', 'env status', or after a reboot/GPU crash."
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:env — Environment Harness Manager

## When to Use
- After a reboot or GPU crash — verify everything came back up
- Setting up a fresh box — install all tools and services
- Something is broken — repair services, MCPs, CodeFlow
- Routine update — bring the harness current and run a drift check
- "check the environment", "fix my setup", "install environment"

## The harness arrives by one of two channels — find out which BEFORE acting

`$LIFEAI_ENV` is **not** necessarily a git repo, and on a normal box it is not.

| channel | what `$LIFEAI_ENV` is | who owns freshness |
|---|---|---|
| **npm** (the normal box) | an installed package, e.g. `C:/Dev/lifeai/node_modules/@lifeai/lifeai-env` | `npm` — `env-boot` installs into the owning prefix at session start |
| **git** (the publishing box) | a checkout of `LIFEAI/environment` | `land.mjs` → fetch → `env-install` |

Every `git` command in this skill applies to the **git** channel only. Against an
npm install they fail outright — `fatal: not a git repository` — because there is
no `.git` there at all. Ask first:

```bash
node "$LIFEAI_ENV/machines/env-boot.mjs" check
```

It reports the installed version, the published version, and which channel this
box is on, and changes nothing. Do not infer the channel from the path: the git
tree at `C:/Dev/lifeai-env` still exists on the publishing box alongside the npm
install, so a path that looks familiar proves nothing.

## Subcommands

| Command | What it does |
|---------|-------------|
| `status` (default) | Read-only check: channel + harness version, tool versions, MCP health, shim integrity, CodeFlow brain |
| `install` | Full provision: install the harness if missing, set LIFEAI_ENV, install tools, configure MCPs |
| `repair` | Diagnose and fix: restart crashed services, rebuild stale dists, fix broken shims |
| `update` | Bring the harness current for its channel, re-run audit, report drift, refresh shims if new scripts added |

## Procedure

### Step 0: Resolve environment root

```bash
LIFEAI_ENV="${LIFEAI_ENV:-C:/Dev/lifeai-env}"
```

If `$LIFEAI_ENV` is not set AND the default path doesn't exist:
- For `install`: install the harness (see the channel table above — npm on a
  normal box) and set the env var. `provision.ps1` is self-locating
  (`$EnvRoot = $PSScriptRoot`), so running it *from* an install is what points
  `LIFEAI_ENV` at that install. Machine scope needs elevation; without it it
  falls back to User scope and says so.
- For all others: STOP with `BLOCKED: environment harness not found. Run: rdc:env install`

Read `$LIFEAI_ENV/manifest.json` — this is the harness inventory.

### Step 1: Harness state — channel first, then freshness

```bash
node "$LIFEAI_ENV/machines/env-boot.mjs" check
```

One command, both channels, no mutation. It prints the installed version, the
published version, and — on an npm hub outside `npm root -g` — the prefix an
update would target.

Report: version from manifest.json, the channel, and how far behind it is.

**For `update` and `repair`, bring it current by its own channel:**

```bash
# npm channel — env-boot derives the owning prefix itself. Do NOT hand-roll a
# prefix, and do NOT use a bare `npm install -g`: on a hub outside `npm root -g`
# that silently updates a DIFFERENT directory and the hub never moves.
node "$LIFEAI_ENV/machines/env-boot.mjs"

# git channel (publishing box only)
git -C "$LIFEAI_ENV" pull --ff-only origin main
```

> **Never report a version comparison as a freshness verdict without saying which
> channel produced it.** On a git hub `env-boot` deliberately does not ask npm at
> all — the two versions differing there is expected, not a broken publish.

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
| clauth | `curl -s http://127.0.0.1:52437/ping` | 1.30.0 |
| rdc-skills | `npm list -g @lifeaitools/rdc-skills` | 0.25.0 |
| gh | `gh --version` | 2.0.0 |

For `install` and `repair`: install or upgrade any tool below `min_version`
using the `install` command from the lock file. The local rdc-skills package
provides CLI/plugin skill files. Its public MCP is independently hosted and must
never be started, restarted, or treated as a Windows service by this workflow.

### Step 3: Service health

Check each service:

| Service | Health Check | Repair |
|---------|-------------|--------|
| clauth daemon | `curl -s http://127.0.0.1:52437/ping` | `$LIFEAI_ENV/services/restart-clauth.bat` |
| CodeFlow gateway | `curl -s http://127.0.0.1:3109/health` | **PROBE ONLY — never start/restart/recreate.** CodeFlow is blue-green-owned. If down, report `BLOCKED: CodeFlow gateway down — run: node scripts/codeflow-bluegreen.mjs recover` |
| CodeFlow brain | `/health` → `health.state` | **REPORT ONLY.** `degraded` = freshness drift (normal after pushes). `offline` = remote PM2 brain unreachable. Never start Docker Neo4j or local brain from this skill. |
| Dev Center | `http://127.0.0.1:3003/api/version` | `$LIFEAI_ENV/services/restart-dev-center.ps1` (standalone, optional) |
| public rdc-skills MCP | `https://rdc-skills.regendevcorp.com/health` | **REPORT ONLY.** Independently hosted standard MCP; never a Windows startup gate. |

For `status`: report only. For `repair`: fix clauth, the local rdc-skills
package/plugin install, and best-effort Dev Center. CodeFlow repair is
exclusively through `codeflow-bluegreen.mjs recover`; this skill never touches
CodeFlow lifecycle, Docker, Neo4j, or PM2.

### Step 4: MCP server verification

Run the MCP checker:
```bash
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$LIFEAI_ENV/services/install-mcps.ps1" -ProjectRoot "$PROJECT_ROOT"
```

For `repair`: add `-Fix` to repair eligible local MCP registration. This does
not start the public rdc-skills MCP.

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
| Harness | ✅ | v0.8.119, npm channel, current |
| LIFEAI_ENV | ✅ | C:/Dev/lifeai/node_modules/@lifeai/lifeai-env (Machine scope) |
| Node | ✅ | v22.14.0 (min 22.0.0) |
| pnpm | ✅ | 10.12.1 (min 10.0.0) |
| clauth | ✅ | v1.30.2, unlocked |
| CodeFlow | ✅ | v0.33.11, brain=dev, operational |
| rdc-skills package | ✅ | v0.25.0, installed |
| public rdc-skills MCP | ✅ | connector reachable |
| Shims | ✅ | 47/47 valid |
| Agent readiness | ✅ | 0 blockers |

**Verdict: environment healthy (10/10 checks pass)**
```

For `repair`, append:
```
## Repairs Applied
- [x] Restarted clauth daemon
- [ ] CodeFlow: observed healthy; lifecycle untouched
- [x] Refreshed local rdc-skills package/plugin
```
