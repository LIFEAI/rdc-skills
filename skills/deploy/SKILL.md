---
name: rdc:deploy
description: "Usage `rdc:deploy <slug> [new|diagnose|audit|promote|convert] [--fix|--hotfix <sha>]` — Deploy an app to Coolify (production) or PM2 (staging), promote a verified dev change to production (one-command cherry-pick → PR → admin-merge → explicit Coolify trigger → verify), convert a prod app's runtime in place static→Next, add a new Coolify app, diagnose a failed deploy, or audit watch paths. Handles DNS, branch protection, health checks, and post-deploy verification."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.


# rdc:deploy — Coolify Operations

**READ FIRST:** `guides/output-contract.md`. Checklist-only output. No narration.
No raw MCP dumps. No UUIDs unless asked.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.
>
> *Under `$RDC_TEST=1`:* Modes 1 (deploy), 2 (new), and 5 (promote) are **entirely skipped** — echo `[RDC_TEST] skipping Coolify deploy/create/promote` and mark every `[ ]` line in those checklists as `[~]`. Modes 3 (diagnose) and 4 (audit without `--fix`) are **read-only and run normally**. Mode 4 with `--fix` skips all remediation — echo `[RDC_TEST] skipping audit --fix remediation` and report findings only. Registry SELECTs, Coolify status reads, HTTP gate probes, TLS checks, and DNS lookups are NOT destructive and run normally. Anything that writes (create app, set watch_paths, deploy trigger, **PR/admin-merge to main**, env var write, DNS write, CF cache purge, registry UPDATE/INSERT) is gated.

## When to Use
- Project lead says "deploy", "ship it", "push to production", "update the server"
- Project lead says "promote", "patch prod", "hotfix production", "push this fix live" — use `rdc:deploy <slug> promote`
- Dev is a Next.js app but prod is still a static site for the same slug ("dev is XJS, prod is static", "make prod Next") — use `rdc:deploy <slug> convert` (Mode 6)
- A new app needs to be registered and deployed for the first time (`rdc:deploy new`)
- A deployed app is behaving unexpectedly and needs diagnosis (`rdc:deploy diagnose`)
- Running a compliance/health audit of all deployed apps (`rdc:deploy audit`)

## Arguments

- `rdc:deploy <slug>` — deploy existing app (latest commit on its watched branch)
- `rdc:deploy <slug> <build-id>` — deploy specific commit/tag
- `rdc:deploy <slug> promote` — promote the verified `develop` change for this app to production (Mode 5)
- `rdc:deploy <slug> promote --hotfix <sha>` — promote a specific commit (cherry-pick just that sha to `main`)
- `rdc:deploy <slug> convert` — convert a prod app's runtime in place from static→Next (Mode 6); use when dev is Next but prod is still a static Coolify build
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
[ ] Runtime-source guard: if the source being deployed is static (`sites/<name>`, nixpacks/static) but the registry `runtime` for <slug> is `next`, BLOCK — never deploy a flat/static source over a Next app. A static prototype deploys only under its OWN slug (never an existing Next app's slug), dev only. Changing a slug's runtime is architectural. (`.claude/rules/production-stack-nextjs.md`)
[ ] Git state verified (branch matches Coolify, commit pushed)
[ ] Build-id resolved (default: HEAD of watched branch)
[ ] Env vars present in Coolify (compare to registry)
[ ] Type-specific preflight (see docs/runbooks/coolify-deploy-checklist.md)
[ ] Mandatory pre-deploy code-review (pr-review-toolkit:code-reviewer on `git diff <last-deployed-sha>..HEAD` for this app's paths). Block deploy on `critical`/`high` findings; record `medium`/`low` and proceed.
[ ] PUBLISH.md read from app root (warn if absent; fail if present but invalid)
[ ] watch_paths derived from PUBLISH.md surfaces (union of all surface watch_paths arrays) and updated in app_deployments
[ ] Deploy triggered
[ ] Deployment reached "finished" state
[ ] Gate: HTTP 200
[ ] Gate: TLS valid (no SSL cipher mismatch)
[ ] Gate: cache headers correct on HTML
[ ] Gate: container running on declared port
[ ] Gate: metadata audit (see § Metadata Audit below) — warn on gaps, do not block deploy
[ ] Cloudflare cache purged (if proxied)
[ ] artifact_registry INSERT per PUBLISH.md surface (if PUBLISH.md present)
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
[ ] .dockerignore present at project root (`ls {PROJECT_ROOT}/.dockerignore` — STOP if missing)
[ ] Template loaded from docs/runbooks/coolify-app-templates.json (pick nextjs-app / static-site / mcp-server)
[ ] Required vars substituted: NAME, APP_PATH, DOMAIN, BRANCH, PROJECT_UUID, ENVIRONMENT_UUID [+ TURBO_FILTER / PORT]
[ ] DNS path chosen (A: staging wildcard  B: apex  C: other zone)
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

### Mode 5 — promote <slug> [--hotfix <sha>]

Promote a **verified `develop` change** for one app to production. This is the sanctioned production-patch fast path — one command instead of fighting branch protection, the main-push hook, and a flaky Coolify webhook by hand.

**Authorization:** production promote requires explicit user go-ahead ("promote", "patch prod", "push live", "go"). A dev deploy does NOT. If the user has not given it for THIS promote, stop and ask first.

```
rdc:deploy promote: <slug> → <prod-domain>
[ ] Registry lookup: PROD row (uuid, prod branch=main, watch_paths, url)
[ ] PUBLISH.md status gate: status=active AND prod in environments (block if not)
[ ] Runtime-source guard: BLOCK promoting a static source to a prod row whose intended `runtime` is `next` — production apps are Next.js (DB-backed). (`.claude/rules/production-stack-nextjs.md`)
[ ] Scope resolved: --hotfix <sha> → that commit; else the app-path commits on develop not on main
[ ] Scope guard: promote ONLY this app's paths. NEVER merge develop→main wholesale (drags unrelated WIP to prod)
[ ] Clean worktree off origin/main (never switch the dirty working tree)
[ ] Apply change: cherry-pick <sha> (or `git checkout <develop-sha> -- <app-paths>`); confirm diff = expected files only
[ ] Mandatory pre-promote code-review (pr-review-toolkit:code-reviewer on the promote diff). Block on critical/high.
[ ] Commit on promote branch; push branch (NOT main directly — the main-push hook blocks raw main pushes)
[ ] Open PR base=main; merge with admin override (`gh pr merge --squash --admin --delete-branch`) — branch protection needs --admin
[ ] EXPLICITLY trigger Coolify deploy — NEVER rely on the GitHub→Coolify webhook (it silently no-ops on some merges even with auto-deploy ON)
[ ] Deployment reached "finished" state (poll coolify_events / deployment status)
[ ] Gate: HTTP 200 on prod domain
[ ] Gate: content-level check — assert the actual changed string is live (200 alone is NOT proof; origin may serve stale)
[ ] Gate: TLS valid
[ ] Gate: metadata audit (see § Metadata Audit below) — BLOCK promote on any missing required item
[ ] Cloudflare cache purged (if proxied)
[ ] deployment_registry updated (last_deploy_at, last_deploy_commit, status)
✅ rdc:deploy promote: <slug> live in prod — <changed-string> verified
```

**The explicit Coolify trigger (the whole point — do not skip):**
```bash
_COOLIFY=$(curl -s http://127.0.0.1:52437/v/coolify-api)
# Correct endpoint is GET /api/v1/deploy?uuid= — NOT POST /applications/<uuid>/deploy (that 404s)
curl -s -H "Authorization: Bearer $_COOLIFY" \
  "$DEPLOY_API_BASE/api/v1/deploy?uuid=<PROD_UUID>&force=true"
# → {"deployments":[{"deployment_uuid":"...","message":"...deployment queued."}]}
```

**Why each guard exists (lessons from 2026-06-05 EF Hooper promote):**
- `main` branch protection rejects PR merge without `--admin`; a raw `git push …:main` is blocked by the main-push hook → must go branch → PR → admin-merge.
- Coolify auto-deploy was **ON** for the app yet the merge did **not** auto-deploy — a webhook-delivery flake. A promote must ALWAYS trigger the deploy explicitly and verify; never hope the webhook fired.
- `develop` was 87 commits ahead of `main` (unrelated apps' WIP). Promoting must be surgical (this app's paths / one sha), never a develop→main merge.
- HTTP 200 was returned by the stale origin the whole time — only a content-level assertion (`curl … | grep '<new string>'`) proves the promote landed.

### Mode 6 — convert <slug> (prod runtime static→Next, in place)

One-time conversion of an existing **production** Coolify app from a static/nixpacks build to the Next.js (dockerfile) runtime, **in place** — same UUID, same fqdn, same DNS. After this, the slug is a normal Next app and every future ship is just `rdc:deploy <slug> promote`. This is the mode for "dev is Next, prod is still static" (the `vlas.earth` / `life.ai` class). `promote` alone CANNOT do this — it re-triggers the prod app's existing (static) build; only `convert` changes the build config.

**Authorization:** this changes a production app's runtime — **architectural** per `.claude/rules/production-stack-nextjs.md` + `.claude/rules/architectural-change-approval.md`. Requires explicit user go-ahead for THIS slug. Stop and ask if not given.

**Why in-place PATCH, not recreate:** keeps the application UUID, fqdn (apex + `www`), DNS binding, and project — zero DNS cutover, zero window where the domain is unbound. PATCH switches the build pack; the next deploy builds the Next app on the same application object.

```
rdc:deploy convert: <slug> → <prod-domain>  (static→Next, in place)
[ ] Go-ahead confirmed for THIS slug (production runtime change — architectural)
[ ] Registry lookup: PROD coolify_uuid, fqdn, project/env, current build_pack
[ ] Confirm it IS a convert: dev runtime=next AND prod build_pack ∈ {static, nixpacks}. If prod build_pack already `dockerfile` → already converted, fall through to Mode 5 promote.
[ ] Source Next-prod-readiness preflight (BLOCK on any miss):
      - apps/<name>/Dockerfile present (prod build) — BLOCK "source not Next-prod-ready: add Dockerfile" if missing
      - start/listen port reconciled with intended ports_exposes (no dev-only port like :3214 leaking to prod)
      - PUBLISH.md present, build_type=nextjs, status=active, prod in environments
[ ] Mandatory pre-convert code-review (pr-review-toolkit:code-reviewer on the apps/<name> diff being promoted). Block on critical/high.
[ ] Promote app code to main (Mode 5 path): clean worktree off origin/main → checkout apps/<name> paths (or cherry-pick) → confirm diff = expected files only → branch → PR base=main → `gh pr merge --squash --admin --delete-branch`
[ ] LOCKFILE IMPORTER (mandatory for an app NEW to main): if `git show origin/main:pnpm-lock.yaml | grep -c "apps/<name>:"` is 0, the Docker `pnpm install --frozen-lockfile` WILL fail. In the clean main worktree run `pnpm install --lockfile-only` (adds only the apps/<name> importer; verify the diff is minimal — do NOT promote develop's whole lockfile, it carries unrelated drift) and include `pnpm-lock.yaml` in the SAME promote PR.
[ ] In-place PATCH prod Coolify app <uuid> to nextjs-app template fields:
      build_pack=dockerfile · dockerfile_location=/apps/<name>/Dockerfile · base_directory=/ ·
      build_command="pnpm turbo run build --filter=<pkg>" · start_command="pnpm --filter=<pkg> start" ·
      install_command="pnpm install --frozen-lockfile" · ports_exposes=<port> ·
      watch_paths="apps/<name>/**\npackages/**"
      (clear publish_directory; static-only field)
[ ] PROXY LABELS (mandatory — the static-app `custom_labels` are read-only and do NOT auto-update on a build_pack PATCH): fetch `custom_labels`, base64-decode, rewrite `loadbalancer.server.port=80`→`=<port>` (all routers) AND `upstreams 80}}`→`upstreams <port>}}`, and STRIP the static `caddy_*.try_files=…/index.html /index.php` lines (wrong for a Next app), re-base64, PATCH `custom_labels`. Skipping this = container serves on :<port> but the proxy still routes :80 → **502** even though the build "finished" and the app logs "Ready". (Note: the API rejects `is_container_label_readonly_enabled` and a non-base64 `custom_labels` — you must hand-rewrite the base64.)
[ ] Env vars present in Coolify (compare registry.env_vars_needed); set any missing
[ ] EXPLICITLY trigger deploy: GET /api/v1/deploy?uuid=<PROD_UUID>&force=true — never rely on the webhook
[ ] Deployment reached "finished" state (poll coolify_events)
[ ] Gate: SSR proof — prod HTML now contains `/_next/static` (it is the Next app, not the old static build)
[ ] Gate: HTTP 200 + content-level assertion of a known string from the Next render
[ ] Gate: TLS valid; cache headers correct on HTML
[ ] Gate: metadata audit (see § Metadata Audit) — BLOCK on any required gap
[ ] Cloudflare cache purged (apex + www)
[ ] app_deployments updated: runtime intent → next, notes (converted static→Next <date>), last_deploy_at, last_deploy_commit, status=active
[ ] `apps` row runtime=next confirmed
✅ rdc:deploy convert: <slug> now Next.js in prod — SSR verified at <prod-domain>
```

**Rollback:** PATCH the app back to static (`build_pack=static`, `base_directory=/sites/<name>`, `publish_directory=/sites/<name>`, `ports_exposes=80`, `watch_paths=sites/<name>/**`) and redeploy. `sites/<name>` stays in the repo precisely so this rollback is always available.

**PATCH command (in-place build-pack switch):**
```bash
_COOLIFY=$(curl -s http://127.0.0.1:52437/v/coolify-api)
curl -s -X PATCH -H "Authorization: Bearer $_COOLIFY" -H "Content-Type: application/json" \
  -d '{"build_pack":"dockerfile","dockerfile_location":"/apps/<name>/Dockerfile","base_directory":"/","build_command":"pnpm turbo run build --filter=<pkg>","start_command":"pnpm --filter=<pkg> start","install_command":"pnpm install --frozen-lockfile","ports_exposes":"<port>","watch_paths":"apps/<name>/**\npackages/**"}' \
  "$DEPLOY_API_BASE/api/v1/applications/<PROD_UUID>"
```

## Metadata Audit

After a successful deploy or promote, audit the live site's `<head>` metadata. Run this against the deployed URL (not a local file).

**Check list** (curl the deployed URL, parse the HTML `<head>`):

| # | Item | How to check | Required | Severity |
|---|------|-------------|----------|----------|
| 1 | `<title>` | grep `<title>` — non-empty, not default/placeholder | yes | block |
| 2 | `<meta name="description">` | content attr ≥ 50 chars, ≤ 160 chars | yes | block on promote; warn on deploy |
| 3 | `<link rel="canonical">` | href present, starts with `https://`, matches the deployed domain | yes | block on promote; warn on deploy |
| 4 | `og:title` | `<meta property="og:title">` present | yes | block on promote; warn on deploy |
| 5 | `og:description` | `<meta property="og:description">` present, ≥ 50 chars | yes | block on promote; warn on deploy |
| 6 | `og:image` | `<meta property="og:image">` present, URL returns HTTP 200 | yes | block on promote; warn on deploy |
| 7 | `og:url` | present, matches canonical | recommended | warn |
| 8 | `twitter:card` | `summary_large_image` or `summary` | recommended | warn |
| 9 | `twitter:image` | present, URL returns HTTP 200 | recommended | warn |
| 10 | Favicon | `<link rel="icon">` present, href returns HTTP 200 | yes | block on promote; warn on deploy |
| 11 | `sitemap.xml` | `<domain>/sitemap.xml` returns HTTP 200 | recommended | warn |
| 12 | `robots.txt` | `<domain>/robots.txt` returns HTTP 200 | recommended | warn |
| 13 | Version | `<meta name="version">` or visible version string in page | yes (project rule) | warn |

**Behavior by mode:**
- **Mode 1 (deploy):** run the audit after HTTP/TLS gates. Print a table of results. **Warn** on gaps but do NOT block the deploy — dev deploys are iterative.
- **Mode 5 (promote):** run the audit after content-level check. **Block the promote** if any item marked "block on promote" is missing. Print the table and require the metadata to be fixed before re-attempting.
- **Mode 4 (audit):** include the metadata sweep in the fleet scan (one row per app per missing item in the findings table).

**Implementation — one-liner per check:**
```bash
URL="https://<domain>"
HEAD=$(curl -s "$URL" | sed -n '/<head/,/<\/head>/p')
echo "$HEAD" | grep -ioE '<title>[^<]+</title>'
echo "$HEAD" | grep -ioE 'name="description"[^>]*content="[^"]*"'
echo "$HEAD" | grep -ioE 'rel="canonical"[^>]*href="[^"]*"'
echo "$HEAD" | grep -ioE 'property="og:title"[^>]*content="[^"]*"'
echo "$HEAD" | grep -ioE 'property="og:image"[^>]*content="[^"]*"'
echo "$HEAD" | grep -ioE 'name="twitter:card"[^>]*content="[^"]*"'
echo "$HEAD" | grep -ioE 'rel="icon"[^>]*href="[^"]*"'
echo "$HEAD" | grep -ioE 'name="version"[^>]*content="[^"]*"'
curl -s -o /dev/null -w "%{http_code}" "$URL/sitemap.xml"
curl -s -o /dev/null -w "%{http_code}" "$URL/robots.txt"
OG_IMG=$(echo "$HEAD" | grep -ioE 'property="og:image"[^>]*content="([^"]*)"' | grep -ioE 'https://[^"]*')
[ -n "$OG_IMG" ] && curl -s -o /dev/null -w "%{http_code}" "$OG_IMG"
```

**Why this exists (2026-06-05):** life.ai deployed to production with zero social/SEO metadata — no description, no OG, no favicon, no sitemap. HTTP 200 + TLS + content passed; metadata was invisible to the existing gates. This audit catches that class of defect.

## PUBLISH.md Integration

Every deploy reads `PUBLISH.md` from the app's source root to derive `watch_paths` and to register surfaces in Studio `artifact_registry`.

### Step 6 — Read PUBLISH.md from the app root

```bash
MONOREPO_PATH=$(get_app_deployments_monorepo_path "$SLUG")
PUBLISH_MD="$MONOREPO_PATH/PUBLISH.md"

if [ ! -f "$PUBLISH_MD" ]; then
  echo "WARN: PUBLISH.md missing for $SLUG — using app_deployments.watch_paths only"
  # Deploy continues; watch_paths derivation and artifact_registry INSERT are skipped
fi
```

PUBLISH.md format: see `C:/Dev/rdc-skills/guides/publish-md-spec.md` (authoritative).

Required frontmatter fields: `schema_version`, `entity_slug`, `artifact_type`, `environments`, `status`.
One or more `<!-- SURFACE:<id> -->` … `<!-- /SURFACE:<id> -->` blocks per surface (each with `path`, `source_dir`, `build_type`, `visibility`, `cache`, `watch_paths`).

If PUBLISH.md is **present but invalid** (missing required field, bad enum, no surface blocks): abort deploy with `BLOCKED: PUBLISH.md parse error for <slug> — <reason>`.

### Step 7 — Derive watch_paths from PUBLISH.md surfaces

Union all `watch_paths` arrays across every surface section in PUBLISH.md. Update `app_deployments.watch_paths` for the app slug to this derived union before triggering the Coolify deploy.

```sql
UPDATE app_deployments
SET watch_paths = '<union-of-surface-watch_paths>'
WHERE app_slug = '<slug>';
```

Also PATCH the Coolify application's `watch_paths` field:

```bash
_COOLIFY=$(curl -s http://127.0.0.1:52437/v/coolify-api)
WATCH_PATHS_JSON=$(derive_watch_paths_union "$PUBLISH_MD")
curl -s -X PATCH -H "Authorization: Bearer $_COOLIFY" \
  -H "Content-Type: application/json" \
  -d "{\"watch_paths\":\"$WATCH_PATHS_JSON\"}" \
  "$DEPLOY_API_BASE/api/v1/applications/<uuid>"
```

### Step 15 — storeArtifact per surface (after successful deploy)

After the deployment reaches "finished" state, INSERT one row into Studio `artifact_registry` for each surface declared in PUBLISH.md:

| Column | Value |
|--------|-------|
| `entity_slug` | from PUBLISH.md frontmatter `entity_slug` |
| `artifact_type` | from PUBLISH.md frontmatter `artifact_type` |
| `canonical_url` | `https://<app_deployments.url><surface.path>` |
| `surface_id` | surface name from `<!-- SURFACE:<id> -->` marker |
| `commit_sha` | HEAD SHA of the deploy |
| `published_at` | `now()` |

Use the Supabase MCP (`mcp__claude_ai_Supabase__execute_sql`) from the supervisor session:

```sql
INSERT INTO artifact_registry (entity_slug, artifact_type, canonical_url, surface_id, commit_sha, published_at)
VALUES ('<entity_slug>', '<artifact_type>', 'https://<url><path>', '<surface_id>', '<commit_sha>', now())
ON CONFLICT (entity_slug, surface_id) DO UPDATE SET
  canonical_url = EXCLUDED.canonical_url,
  commit_sha = EXCLUDED.commit_sha,
  published_at = EXCLUDED.published_at;
```

If the INSERT fails, surface the failure in the deploy output but **do NOT roll back the deploy**. The artifact registry is a post-deploy record, not a deploy gate.

## Coolify Access — clauth + REST API

All Coolify operations use the clauth daemon and the Coolify REST API directly.
There is no Coolify MCP server. Do not reference `@masonator/coolify-mcp`.

```bash
# Get token (plain text — no JSON parsing needed)
_COOLIFY=$(curl -s http://127.0.0.1:52437/v/coolify-api)

# List applications
curl -s -H "Authorization: Bearer $_COOLIFY" \
  "$DEPLOY_API_BASE/api/v1/applications"

# Get application details
curl -s -H "Authorization: Bearer $_COOLIFY" \
  "$DEPLOY_API_BASE/api/v1/applications/<uuid>"

# Deploy (trigger) — correct endpoint is GET /api/v1/deploy?uuid=
# (POST /applications/<uuid>/deploy returns {"message":"Not found."})
curl -s -H "Authorization: Bearer $_COOLIFY" \
  "$DEPLOY_API_BASE/api/v1/deploy?uuid=<uuid>&force=true"

# Get deployment logs
curl -s -H "Authorization: Bearer $_COOLIFY" \
  "$DEPLOY_API_BASE/api/v1/deployments/<deployment-id>"

# Set env var
curl -s -X POST -H "Authorization: Bearer $_COOLIFY" \
  -H "Content-Type: application/json" \
  -d '{"key":"<KEY>","value":"<VALUE>"}' \
  "$DEPLOY_API_BASE/api/v1/applications/<uuid>/envs"

# Set watch_paths
curl -s -X PATCH -H "Authorization: Bearer $_COOLIFY" \
  -H "Content-Type: application/json" \
  -d '{"watch_paths":"apps/<name>/**\npackages/**"}' \
  "$DEPLOY_API_BASE/api/v1/applications/<uuid>"
```

**Never print `$_COOLIFY` to stdout.** Inline from clauth only — do not assign raw strings.

If clauth daemon is not responding (`curl -s http://127.0.0.1:52437/ping` fails):
```
BLOCKED: credential provider is not responding.
Fix: start the project's credential provider or configure deployment credentials through env vars, then retry.
I cannot proceed until this is resolved.
```

## Deployment Event Log — `coolify_events`

Every Coolify deploy emits a webhook → `coolify_events` row. Use this for last-N-deploys queries, debugging failed deploys, and reconciling local state with Coolify state.

Query the last 5 events for an app:
```sql
SELECT created_at, event_type, status, branch, commit_hash, duration_seconds
FROM coolify_events
WHERE app_uuid = '<uuid>' OR app_name = '<slug>'
ORDER BY created_at DESC LIMIT 5;
```

Fields:
- `app_uuid` — Coolify application UUID (matches `app_deployments.coolify_uuid`)
- `event_type` — `started | succeeded | failed | cancelled` (canonical values; consult webhook receiver for full enum)
- `status` — overall deploy status
- `branch`, `commit_hash`, `commit_message` — git context
- `duration_seconds` — total deploy time
- `payload` — full webhook payload (jsonb) for forensic debugging

When diagnosing a broken deploy in Mode 3: query `coolify_events` FIRST before re-running the deploy — the most recent event row tells you whether the previous deploy actually triggered, whether it failed, and how long it ran. Faster than checking the Coolify UI.

## Capture lessons (exit step)

Before the final verdict line, follow `.rdc/guides/lessons-learned-spec.md` § Capture procedure. If this run taught something non-obvious — a first root-cause theory that turned out wrong, the documented/standard path not working, a missing gate or check that cost a round, or a surprising tool/infra behavior — write one `.rdc/lessons/<YYYY-MM-DD>-deploy-<short-slug>.md` per lesson using the schema in that spec. Set `scope` (`simple` | `architectural`) and `status` (`open`, or `applied` if you shipped the fix in this same run, with the commit linked). Commit the lesson file(s) on `develop` alongside the run's other commits, and note "N lessons captured" in your verdict/summary. A run that taught nothing writes nothing — absence is the default.

## References

- Type-specific checklists + DNS tree + gate commands: `docs/runbooks/coolify-deploy-checklist.md`
- Rules / registry RPCs / hard limits: `.claude/context/coolify-deployment.md`
- Infrastructure constants:
  ```
  Server UUID:     ih386anenvvvn6fy1umtyow0
  Server IP:       64.237.54.189
  Dashboard:       <deployment-dashboard-url>
  GitHub App UUID: xdmcy60putp5h9j7k4kwg9c3
  ```

## Supersedes

`coolify-deploy` standalone skill (kept for back-compat; new work uses `rdc:deploy`).
