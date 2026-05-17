---
name: rdc:deploy
description: "Usage `rdc:deploy <slug> [new|diagnose|audit] [--fix]` — Deploy an app to Coolify (production) or PM2 (staging), add a new Coolify app, diagnose a failed deploy, or audit watch paths. Handles DNS, health checks, and post-deploy verification."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.


# rdc:deploy — Coolify Operations

**READ FIRST:** `guides/output-contract.md`. Checklist-only output. No narration.
No raw MCP dumps. No UUIDs unless asked.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.
>
> *Under `$RDC_TEST=1`:* Modes 1 (deploy) and 2 (new) are **entirely skipped** — echo `[RDC_TEST] skipping Coolify deploy/create` and mark every `[ ]` line in those checklists as `[~]`. Modes 3 (diagnose) and 4 (audit without `--fix`) are **read-only and run normally**. Mode 4 with `--fix` skips all remediation — echo `[RDC_TEST] skipping audit --fix remediation` and report findings only. Registry SELECTs, Coolify status reads, HTTP gate probes, TLS checks, and DNS lookups are NOT destructive and run normally. Anything that writes (create app, set watch_paths, deploy trigger, env var write, DNS write, CF cache purge, registry UPDATE/INSERT) is gated.

## When to Use
- Project lead says "deploy", "ship it", "push to production", "update the server"
- A new app needs to be registered and deployed for the first time (`rdc:deploy new`)
- A deployed app is behaving unexpectedly and needs diagnosis (`rdc:deploy diagnose`)
- Running a compliance/health audit of all deployed apps (`rdc:deploy audit`)

## Arguments

- `rdc:deploy <slug>` — deploy existing app (latest commit on its watched branch)
- `rdc:deploy <slug> <build-id>` — deploy specific commit/tag
- `rdc:deploy new <slug>` — create a new Coolify app from registry
- `rdc:deploy diagnose <slug>` — debug why an app is broken
- `rdc:deploy audit` — fleet-wide scan for missed failures
- `rdc:deploy audit --fix` — fleet scan + auto-remediate safe issues
- `rdc:deploy` (no args) — print mode menu, ask which

## Modes

### Mode 1 — deploy <slug> [build-id]

```
rdc:deploy: <slug> → <domain>
[ ] Registry lookup (slug, uuid, branch, type, env_vars_needed)
[ ] Git state verified (branch matches Coolify, commit pushed)
[ ] Build-id resolved (default: HEAD of watched branch)
[ ] Env vars present in Coolify (compare to registry)
[ ] Type-specific preflight (see docs/runbooks/coolify-deploy-checklist.md)
[ ] Deploy triggered
[ ] Deployment reached "finished" state
[ ] Gate: HTTP 200
[ ] Gate: TLS valid (no SSL cipher mismatch)
[ ] Gate: cache headers correct on HTML
[ ] Gate: container running on declared port
[ ] Cloudflare cache purged (if proxied)
[ ] deployment_registry updated (last_deploy_at, status)
✅ rdc:deploy: <slug> deployed in Nm Ns
```

### Mode 2 — new <slug>

**MANDATORY:** All new apps are created from `docs/runbooks/coolify-app-templates.json`. Read that file first — pick the right template, substitute the required vars, POST the exact payload. No manual field configuration. No improvisation. The template encodes all learned lessons (base_directory, build_pack, watch_paths, health_check, ports). Deviating from it breaks things.

Template selection:
- `nextjs-app` — for `apps/<name>/` (Dockerfile, turbo filter, port 3000)
- `static-site` — for `sites/<name>/` (nixpacks, publish_directory=out, no packages)
- `mcp-server` — for `mcp-servers/<name>/` (Dockerfile, health check enabled, custom port)

```
rdc:deploy new: <slug>
[ ] .dockerignore present at regen-root root (ls C:/Dev/regen-root/.dockerignore — STOP if missing)
[ ] Template loaded from docs/runbooks/coolify-app-templates.json (pick nextjs-app / static-site / mcp-server)
[ ] Required vars substituted: NAME, APP_PATH, DOMAIN, BRANCH, PROJECT_UUID, ENVIRONMENT_UUID [+ TURBO_FILTER / PORT]
[ ] DNS path chosen (A: *.dev.place.fund  B: apex  C: other zone)
[ ] DNS record verified or wildcard confirmed
[ ] Cloudflare proxy setting correct for DNS path
[ ] Application created via POST /applications/private-github-app (template payload)
[ ] UUID recorded from response
[ ] watch_paths verified via GET /api/v1/applications/<uuid> — must match template
[ ] Env vars set in Coolify (from deployment_registry.env_vars_needed)
[ ] First deploy triggered
[ ] Deployment reached "finished" state
[ ] Gate: HTTP 200 on <domain>
[ ] Gate: TLS valid
[ ] deployment_registry row inserted
✅ rdc:deploy new: <slug> live at <domain>
```

### Mode 3 — diagnose <slug>

```
rdc:deploy diagnose: <slug>
[ ] App located (uuid, domain, last deploy)
[ ] Container state (running / restarting / stopped)
[ ] Last 100 log lines scanned for known error patterns
[ ] Port mismatch check (declared vs actual)
[ ] Env var drift check (registry vs Coolify)
[ ] watch_paths sanity check
[ ] HTTP / TLS reachability
[ ] Cloudflare proxy state check
[ ] Disk space on server
[ ] Branch mismatch check (Coolify git_branch vs expected)
⚠️ rdc:deploy diagnose: <root cause in one sentence> — fix: <one command>
```

### Mode 4 — audit

```
rdc:deploy audit: fleet scan
[ ] Inventory join: Coolify apps ⋈ deployment_registry
[ ] Orphans (in one but not the other)
[ ] Monorepo apps missing watch_paths
[ ] Stale deploys (>14 days since last success)
[ ] Registry rows with status='broken'
[ ] Failed deployments in last 7 days
[ ] HTTP gate sweep (non-200 per domain)
[ ] TLS cert expiry <30 days
[ ] Port mismatches (ports_exposes vs actual container port)
[ ] Env var drift (registry.env_vars_needed vs Coolify env)
[ ] Branch mismatches (Coolify git_branch ≠ expected)
[ ] Disk space on 64.237.54.189
[ ] CF proxy misconfigs on *.dev.place.fund
[ ] Duplicate apps (same repo, multiple UUIDs)

Findings:
| Severity | App | Issue | Fix |
|----------|-----|-------|-----|
| HIGH     | ... | ...   | ... |
⚠️ rdc:deploy audit: N HIGH · M MED · K LOW — run `rdc:deploy audit --fix` to auto-remediate safe issues
```

Severity rules:
- **HIGH** — user-facing down (HTTP non-200, TLS invalid, container not running)
- **MED** — degraded or drifting (watch_paths missing, env var drift, stale deploy, branch mismatch)
- **LOW** — cleanup (orphans, duplicates, registry status stale)

`--fix` auto-remediates only: missing watch_paths, registry row updates, CF cache purges. Never touches env vars, DNS, or container config without explicit confirmation.

## Coolify Access — clauth + REST API

All Coolify operations use the clauth daemon and the Coolify REST API directly.
There is no Coolify MCP server. Do not reference `@masonator/coolify-mcp`.

```bash
# Get token (plain text — no JSON parsing needed)
_COOLIFY=$(curl -s http://127.0.0.1:52437/v/coolify-api)

# List applications
curl -s -H "Authorization: Bearer $_COOLIFY" \
  https://deploy.regendevcorp.com/api/v1/applications

# Get application details
curl -s -H "Authorization: Bearer $_COOLIFY" \
  https://deploy.regendevcorp.com/api/v1/applications/<uuid>

# Deploy (trigger)
curl -s -X POST -H "Authorization: Bearer $_COOLIFY" \
  https://deploy.regendevcorp.com/api/v1/applications/<uuid>/deploy

# Get deployment logs
curl -s -H "Authorization: Bearer $_COOLIFY" \
  https://deploy.regendevcorp.com/api/v1/deployments/<deployment-id>

# Set env var
curl -s -X POST -H "Authorization: Bearer $_COOLIFY" \
  -H "Content-Type: application/json" \
  -d '{"key":"<KEY>","value":"<VALUE>"}' \
  https://deploy.regendevcorp.com/api/v1/applications/<uuid>/envs

# Set watch_paths
curl -s -X PATCH -H "Authorization: Bearer $_COOLIFY" \
  -H "Content-Type: application/json" \
  -d '{"watch_paths":"apps/<name>/**\npackages/**"}' \
  https://deploy.regendevcorp.com/api/v1/applications/<uuid>
```

**Never print `$_COOLIFY` to stdout.** Inline from clauth only — do not assign raw strings.

If clauth daemon is not responding (`curl -s http://127.0.0.1:52437/ping` fails):
```
BLOCKED: clauth daemon is not responding.
Fix: Run C:\Dev\regen-root\scripts\restart-clauth.bat, then unlock at http://127.0.0.1:52437
I cannot proceed until this is resolved.
```

## References

- Type-specific checklists + DNS tree + gate commands: `docs/runbooks/coolify-deploy-checklist.md`
- Rules / registry RPCs / hard limits: `.claude/context/coolify-deployment.md`
- Infrastructure constants:
  ```
  Server UUID:     ih386anenvvvn6fy1umtyow0
  Server IP:       64.237.54.189
  Dashboard:       https://deploy.regendevcorp.com
  GitHub App UUID: xdmcy60putp5h9j7k4kwg9c3
  ```

## Supersedes

`coolify-deploy` standalone skill (kept for back-compat; new work uses `rdc:deploy`).
