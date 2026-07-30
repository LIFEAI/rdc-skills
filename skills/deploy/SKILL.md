---
name: rdc:deploy
description: >-
  Deployment control plane. Usage `rdc:deploy <slug>` for bearer-authenticated PM2 dev deployment, `rdc:deploy <slug> promote` for Coolify production promotion, or `rdc:deploy plugin <id>` for a governed clauth plugin lifecycle — registry-resolved jobs, status receipts, and mandatory content gates.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.


# rdc:deploy — Bearer Deployment Control Plane

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
- A LIFEAI plugin must be installed, rescanned, tested, or promoted (`rdc:deploy plugin`)

## Arguments

- `rdc:deploy <slug>` — deploy the registered `develop` ref to the PM2 dev target
- `rdc:deploy <slug> promote` — promote the registered production app through Coolify
- `rdc:deploy <slug> status <job-id>` — retrieve a submitted control-plane job
- `rdc:deploy new <slug>` — create a new Coolify app from registry
- `rdc:deploy diagnose <slug>` — debug why an app is broken
- `rdc:deploy audit` — fleet-wide scan for missed failures
- `rdc:deploy audit --fix` — fleet scan + auto-remediate safe issues
- `rdc:deploy plugin <id>` — validate a built `clauth-plugin.json`, install/rescan it through the Clauth supervisor, and verify its surface
- `rdc:deploy plugin <id> test` — run the isolated candidate lifecycle without changing the active version
- `rdc:deploy plugin <id> promote` — atomically promote a passing candidate through Clauth
- `rdc:deploy` (no args) — print mode menu, ask which

## Modes

### Mode 1 — deploy <slug> [ref]

```
rdc:deploy: <slug> → PM2 dev target
[ ] Registry lookup (slug, uuid, branch, type, env_vars_needed)
[ ] Git state verified (branch is registered; commit is on origin)
[ ] Deployment manifest resolved (application, fixed repo path, fixed build argv, PM2 name, allowed ref, health URL)
[ ] Local clauth retrieves `vultr-ops-api-token` without printing it
[ ] `clauth ops deploy --endpoint <control-plane> --application <slug> --ref <registered-ref>` submitted
[ ] Job polled at `GET /v1/ops/jobs/<id>` until a terminal phase
[ ] Job receipt includes checkout SHA, build, PM2 reload, and health-probe evidence
[ ] Gate: HTTP 200
[ ] Gate: TLS valid (no SSL cipher mismatch)
[ ] Gate: cache headers correct on HTML
[ ] Gate: PM2 process is online at its declared port
[ ] deployment_registry updated (last_deploy_at, status)
✅ rdc:deploy: <slug> deployed in Nm Ns
```

**Do not use SSH, raw PM2 commands, or a webhook as the agent-facing deployment interface.** SSH is only the bootstrap/recovery transport used to install or repair the clauth control-plane service. The server-side manifest owns repository path, build command, PM2 process, allowed ref, and health URL; callers supply only the registered application and ref.

### Mode 1b — promote <slug>

```
rdc:deploy: <slug> promote → Coolify production target
[ ] Registry lookup proves production Coolify UUID and domain
[ ] User approval for production promotion recorded
[ ] Scoped app change is landed on main
[ ] Local clauth retrieves `vultr-ops-api-token` without printing it
[ ] `clauth ops promote --endpoint <control-plane> --application <registered-uuid>` submitted
[ ] Job SSE (`GET /v1/ops/jobs/<id>/events`) or job polling reaches terminal phase
[ ] Coolify deployment UUID and terminal status are present in the redacted job receipt
[ ] Production HTTP, TLS, cache, and content gates pass
[ ] deployment_registry updated (last_deploy_at, status)
✅ rdc:deploy: <slug> promoted
```

Promotion is allowlisted by `CLAUTH_COOLIFY_PROMOTE_UUIDS`; agents cannot supply a Coolify bearer token or invoke the deploy-trigger endpoint directly.

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

### Mode 8 — plugin <id> [test|promote]

`rdc:deploy plugin` is the deploy path for a LIFEAI plugin surface. It does not
start PM2 or invoke a plugin process directly; Clauth remains the lifecycle
authority and Dev Center remains the cockpit.

```
rdc:deploy plugin: <id>
[ ] Build completed in the current isolated lane
[ ] Build artifact contains clauth-plugin.json (schema lifeai.plugin.v1)
[ ] Manifest id, version, publisher, surfaces, routes, credentials, and test contract validated
[ ] Every declared start/stop/health/selfTest command resolves to a file or installed executable
[ ] Relative script paths are inside the plugin artifact; traversal and shell interpolation rejected
[ ] Destination and lifecycle_owner are valid (CodeFlow remains plugin-owned)
[ ] Managed/user origin is explicit; managed IDs cannot be silently shadowed
[ ] Credential records are created by discovery without assigning secret values
[ ] Manifest is installed through $LIFEAI_ENV/services/install-clauth-plugins.ps1
[ ] Clauth supervisor rescan receipt recorded (52439)
[ ] Surface state, port lease, health, MCP initialization, and contract tests verified
[ ] Test candidates use an isolated localhost port and cannot create public routes
[ ] Candidate failure preserves logs and leaves the active version unchanged
[ ] Promotion (only when requested) is atomic and records rollback metadata
[ ] Dev Center displays origin, version, drift, lifecycle owner, route, and operation receipt
✅ rdc:deploy plugin: <id> installed/tested/promoted with Clauth evidence
```

Build contract:

1. The plugin build must write `clauth-plugin.json` into its publish artifact;
   hand-authored runtime state is not accepted as a substitute.
2. The deploy gate fails before installation when a declared script, health path,
   test command, or self-test is missing. The gate never invents a command.
3. Use `pwsh $env:LIFEAI_ENV/services/install-clauth-plugins.ps1 -Fix` for the
   managed catalog, then `POST http://127.0.0.1:52439/v1/plugins/rescan` only
   through the governed supervisor operation. Do not call PM2 directly.
4. A user plugin belongs under `%APPDATA%/LifeAI/clauth/plugins/<id>`; it may
   not replace a managed ID without an explicit governed takeover.
5. `test` allocates a separate port and state namespace; `promote` requires the
   successful candidate receipt. Cloudflare routes are never created for tests.

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

## Control-plane API

All operations use `Authorization: Bearer <local clauth:vultr-ops-api-token>`; the fixed local client obtains that bearer internally and never prints it.

| Intent | Client command | API |
|---|---|---|
| Catalog | `clauth ops catalog --endpoint <url>` | `GET /v1/ops/catalog` |
| PM2 status | `clauth ops list --endpoint <url>` | `GET /v1/ops/processes` |
| One process | `clauth ops describe --endpoint <url> --target <name>` | `GET /v1/ops/processes/:target` |
| Explicit PM2 operation | `clauth ops run ...` | `POST /v1/ops/operations` |
| Dev deployment | `clauth ops deploy ...` | `POST /v1/ops/deployments` |
| Production promotion | `clauth ops promote ...` | `POST /v1/ops/promotions` |
| Job status | `clauth ops job --job <id>` | `GET /v1/ops/jobs/:id` |

Calls return `202` for accepted asynchronous work; terminal states are `succeeded`, `failed`, `timed_out`, or `rejected`. All actions are logged as redacted persisted job events.

## References

- Type-specific checklists + DNS tree + gate commands: `docs/runbooks/coolify-deploy-checklist.md`
- Rules / registry RPCs / hard limits: `.claude/rules/coolify-deployment.md`
- Coolify production adapter: clauth-owned bearer interface (no Coolify MCP)
- Infrastructure constants:
  ```
  Server UUID:     ih386anenvvvn6fy1umtyow0
  Server IP:       64.237.54.189
  Dashboard:       https://deploy.regendevcorp.com
  GitHub App UUID: xdmcy60putp5h9j7k4kwg9c3
  ```

## Supersedes

`coolify-deploy` standalone skill (kept for back-compat; new work uses `rdc:deploy`).
