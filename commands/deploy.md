---
name: deploy
description: >-
  Coolify ops. Usage `rdc:deploy <slug> [build-id]`, `rdc:deploy new <slug>`, `rdc:deploy maintenance <service>`, `rdc:deploy diagnose <slug>`, or `rdc:deploy audit [--fix]` — typed checklists, private-service controls, DNS decision tree, and mandatory post-deploy gates. Checklist-only output.
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

## Arguments

- `rdc:deploy <slug>` — deploy existing app (latest commit on its watched branch)
- `rdc:deploy <slug> <build-id>` — deploy specific commit/tag
- `rdc:deploy new <slug>` — create a new Coolify app from registry
- `rdc:deploy diagnose <slug>` — debug why an app is broken
- `rdc:deploy audit` — fleet-wide scan for missed failures
- `rdc:deploy audit --fix` — fleet scan + auto-remediate safe issues
- `rdc:deploy maintenance <service>` — create, update, or verify a template-declared private service; no public domain or host port
- `rdc:deploy dev <slug>` — deploy to PM2 dev (Vultr), not Coolify — see Mode 0
- `rdc:deploy` (no args) — print mode menu, ask which

## Modes

### Mode 0 — dev <slug> (PM2 development, not Coolify)

PM2 dev deploys route through the real, tested `rdc-harness` CLI instead of
raw PM2/curl — it already implements this path (`shipRoute: pm2-development`,
via `@lifeaitools/regen-deploy-mgr` on loopback :52438, never raw PM2):

```
rdc:deploy dev: <slug>
[ ] node C:/Dev/rdc-harness/bin/rdc-harness.mjs deploy <slug> --monorepo-root <caller's own worktree>
[ ] JSON receipt parsed — shipRoute confirmed "pm2-development" (else: not this product's route, see receipt.reason)
[ ] Receipt reports ok / the specific refusal, reported verbatim — not narrated
✅ rdc:deploy dev: <slug> — <receipt outcome in one line>
```

A receipt with `applicable: false, reason: 'not_pm2_shipped'` means this slug
ships a different way (registry, static, or Coolify) — report that plainly,
do not retry as Coolify without confirming that's actually the right route.

### Mode 1 — deploy <slug> [build-id] (Coolify — staging/production)

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
[ ] DNS path chosen (A: staging wildcard  B: apex  C: other zone)
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
[ ] DNS/proxy misconfigs on configured staging wildcard
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

### Mode 7 — maintenance <service> (private infrastructure)

Use maintenance only for a service declared in the `private-service` template.
It creates, updates, or verifies a Coolify-network service with no public
domain, no DNS route, and no host-port publication. Secret checks use key names
only; values are never retrieved or emitted. Retiring a service is outside this
mode and requires separate explicit approval.

```
rdc:deploy maintenance: <service>
[ ] Template and source/branch/Dockerfile/internal-port/health-path resolved
[ ] Private-only contract: domains empty, host port absent, network alias declared
[ ] Required secret keys confirmed by name only
[ ] Explicit deploy completed
[ ] Health gate passes inside the container
[ ] Existing Coolify-network workload reaches the alias and health path
[ ] No public domain, TLS route, DNS record, or host endpoint is present
✅ rdc:deploy maintenance: <service> healthy on the private network
```

For `clauth`, require `CLAUTH_MACHINE_ID` and `CLAUTH_MASTER_PASSWORD`, port
`52437`, and `/ping`. The container may bind `0.0.0.0` internally only;
consumers must use its Coolify network alias rather than `localhost`.

## Coolify Access — clauth + REST API

All Coolify operations use the clauth daemon and the Coolify REST API directly.
There is no Coolify MCP server — do not reference `@masonator/coolify-mcp`.

```bash
_COOLIFY=$(curl -s http://127.0.0.1:52437/v/coolify-api)
curl -s -H "Authorization: Bearer $_COOLIFY" "$DEPLOY_API_BASE/api/v1/applications"
```

**Triggering the actual deploy is different — use the wrapper, not raw curl.**
`hooks/lib/guard-rules.mjs`'s `coolify-direct` rule blocks a raw curl (or any command whose
TEXT contains the literal URL) to `/api/v1/deploy` — the deploy-trigger endpoint — on
purpose, so a production deploy is never one arbitrary curl an agent can fire silently. This
is NOT a bug to route around with SSH or a differently-worded command
(`.rdc/lessons/2026-08-07-deploy-coolify-direct-blocks-own-documented-step.md`). The
sanctioned way to actually trigger a deploy for Mode 1's "Deploy triggered" step is:

```bash
python3 scripts/coolify-deployments.py deploy <application-uuid>
```

Run from the regen-root repo root. Poll `status <deployment-uuid>` (the same script) or
`GET /api/v1/deployments/<deployment-uuid>` (read-only, not blocked) until `status` is
`finished`/`failed`/`cancelled` before moving to the gate checks.

If clauth daemon is not responding:
```
BLOCKED: clauth daemon not responding. Run scripts\restart-clauth.bat, unlock at http://127.0.0.1:52437
```

## References

- Type-specific checklists + DNS tree + gate commands: `docs/runbooks/coolify-deploy-checklist.md`
- Rules / registry RPCs / hard limits: `.claude/rules/coolify-deployment.md`
- Infrastructure constants:
  ```
  Server UUID:     ih386anenvvvn6fy1umtyow0
  Server IP:       64.237.54.189
  Dashboard:       <deployment-dashboard-url>
  GitHub App UUID: xdmcy60putp5h9j7k4kwg9c3
  ```

## Supersedes

`coolify-deploy` standalone skill (kept for back-compat; new work uses `rdc:deploy`).
