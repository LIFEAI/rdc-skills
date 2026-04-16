---
name: rdc:deploy
description: >-
  Coolify ops. Usage `rdc:deploy <slug> [build-id]` or `rdc:deploy new <slug>` or `rdc:deploy diagnose <slug>` or `rdc:deploy audit [--fix]` — type checklists, DNS decision tree, mandatory post-deploy gate. Checklist-only output.
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

```
rdc:deploy new: <slug>
[ ] Registry entry loaded (or interactive create)
[ ] DNS path chosen (A: *.dev.place.fund  B: apex  C: other zone)
[ ] DNS record verified or wildcard confirmed
[ ] Cloudflare proxy setting correct for DNS path
[ ] server_uuid, project_uuid, environment_uuid, github_app_uuid resolved
[ ] Build type chosen (Next.js / Vite / static / standalone)
[ ] Type-specific fields filled (ports, build cmd, install cmd, start cmd)
[ ] Application created via /applications/private-github-app
[ ] watch_paths set and verified
[ ] Env vars set in Coolify
[ ] First deploy triggered
[ ] Gate passed (5 checks)
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

## References

- Type-specific checklists + DNS tree + gate commands: `docs/runbooks/coolify-deploy-checklist.md`
- Rules / registry RPCs / hard limits: `.claude/rules/coolify-deployment.md`
- MCP server: `@masonator/coolify-mcp` (38 tools)
- Infrastructure constants:
  ```
  Server UUID:     ih386anenvvvn6fy1umtyow0
  Server IP:       64.237.54.189
  Dashboard:       https://deploy.regendevcorp.com
  GitHub App UUID: xdmcy60putp5h9j7k4kwg9c3
  ```

## Supersedes

`coolify-deploy` standalone skill (kept for back-compat; new work uses `rdc:deploy`).
