---
name: rdc:release
description: "Promote develop→main and deploy to production for any LIFEAI repo (clauth, rdc-skills, regen-root, etc.), or promote a staged app with rdc:release promote <slug>. Requires dev verification first."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw git/npm/CI dumps.
> One checklist upfront, updated in place, shown again at end with 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag — checklist runs, each destructive step echoes `[RDC_TEST] skipping <step>` instead of mutating state.

# rdc:release — Atomic LIFEAI Release

## Purpose

One skill. All repos. No confusion about which release path to use.

When user says **"release"**, **"publish"**, **"promote"**, **"deploy to main"**, **"ship"**, or **"bump the version"** — this is the skill. Always. No exceptions.

Dave has Bash access. He should never be asked to run commands. This skill runs the complete loop and shows one checklist + one verdict.

## When to Use
- User says "release", "publish", "promote", "deploy to main", "ship", or "bump the version"
- A package, plugin, or app needs to be versioned and pushed to its distribution channel
- After landing significant changes that must be published (clauth, rdc-skills, regen-media, gws)
- After develop is verified and staging passes — promoting to main
- User says "promote studio", "release studio to production", "ship the app" — use `promote <slug>` mode

**Never release autonomously.** This skill ONLY runs when the user explicitly invokes it. Never push to main on your own initiative.

## Arguments

- `rdc:release <repo>` — patch bump (default), full loop
- `rdc:release <repo> <version>` — explicit version (e.g. `1.6.0`)
- `rdc:release <repo> --minor` | `--major` | `--patch` — semver bump
- `rdc:release <repo> --dry-run` — show checklist and planned version, do nothing
- `rdc:release promote <slug>` — promote a specific deployed app from staging → production
- `rdc:release promote <slug> --dry-run` — show what would happen, do nothing
- `rdc:release` (no args) — list known repos, ask which

## Known Repos — The Single Lookup Table

Resolve `<repo>` here. If not in this table, ask Dave for source path + deploy mechanism before proceeding.

| Repo | Type | Source path | Release mechanism | Post-release |
|------|------|-------------|-------------------|--------------|
| `clauth` | npm package | `C:/Dev/clauth` | bump + tag → GitHub Actions → npm publish | `npm install -g @lifeaitools/clauth@latest` → daemon restart |
| `rdc-skills` | local install | `C:/Dev/rdc-skills` | bump + tag → `install.sh` | copy to `~/.claude/skills/user/` + project |
| `regen-root` | monorepo | `C:/Dev/regen-root` | merge develop→main via GitHub PR → Coolify auto-deploys | run `rdc:deploy <affected-slug>` gate checks |
| `regen-media` | MCP server (in monorepo) | `C:/Dev/regen-root/mcp-servers/regen-media` | part of regen-root release — use `rdc:release regen-root` | Coolify redeploys `regen-media-mcp` from main |
| `gws` | MCP server (in monorepo) | `C:/Dev/regen-root/mcp-servers/gws` | part of regen-root release — use `rdc:release regen-root` | Coolify redeploys from main |

> **MCP servers inside the monorepo** (`regen-media`, `gws`) are released as part of `regen-root`. Coolify watches main and auto-deploys each app by its `watch_paths`. Don't release them separately.

---

## Checklists

### Package release checklist (clauth, rdc-skills)

```
rdc:release: <repo> vX.Y.Z → vA.B.C
[ ] Source path resolved
[ ] Working tree clean (git status)
[ ] Current version detected (package.json)
[ ] New version computed
[ ] Dry-run gate (if --dry-run, stop here and print planned commands)
[ ] package.json bumped
[ ] Commit created
[ ] Tag vA.B.C created + pushed
[ ] CI completion event received via clauth channel (mcp__claude_ai_clauth__channel_list)
[ ] CI concluded successfully (failure → pull logs via gh run view --log-failed)
[ ] npm registry shows vA.B.C (npm view @lifeaitools/<repo> version)
[ ] Local install executed
[ ] Installed version verified
[ ] Post-install action (daemon restart if clauth)
[ ] Smoke test passed
✅ rdc:release <repo>: vA.B.C live
```

### App promote checklist (promote <slug>)

This mode promotes a single deployed app. It does NOT push `git push origin main` directly — it uses the GitHub PR merge API, which bypasses the `block-main-push` hook by design. The hook blocks autonomous pushes; explicit promotion via this skill is authorized by the user invoking it.

```
rdc:release promote: <slug> → <domain>
[ ] Registry lookup (slug, coolify_uuid, domain, staging_slug, staging_domain, app_version)
[ ] Staging health gate (HTTP 200 on staging_domain)
[ ] Staging TLS valid
[ ] develop branch clean and pushed
[ ] Commits ahead of main: <N> commits
[ ] Dry-run gate (if --dry-run, stop here and print planned commands)
[ ] app package.json version bumped on develop
[ ] Version bump committed + pushed to develop
[ ] GitHub PR develop→main: created or located
[ ] PR merged via GitHub API (merge method: merge)
[ ] Coolify auto-deploy confirmed started (polling <slug> deployments)
[ ] Deployment reached "finished" state
[ ] Gate: HTTP 200 on <domain>
[ ] Gate: TLS valid on <domain>
[ ] deployment_registry updated (last_deploy_at, status='active')
✅ rdc:release promote <slug>: <domain> live
```

### Monorepo release checklist (regen-root)

```
rdc:release: regen-root — develop → main
[ ] Source path: C:/Dev/regen-root
[ ] develop branch clean and pushed (git status + git push)
[ ] Commits ahead of main summarised (git log main..develop --oneline)
[ ] Dry-run gate (if --dry-run, stop here)
[ ] Root package.json version bumped on develop
[ ] Version bump committed + pushed to develop
[ ] GitHub PR: develop → main created (or existing PR located)
[ ] PR merged via GitHub API (merge method: merge)
[ ] main pulled locally (git fetch origin main)
[ ] Coolify auto-deploy confirmed in progress (poll deployment status)
[ ] Affected apps gate-checked via rdc:deploy health probes
[ ] deployment_registry updated (last_deploy_at)
✅ rdc:release regen-root: main promoted, Coolify deployed
```

---

## Execution Details

> **Notification paths by repo type:**
> - **Public repos** (rdc-skills, clauth): GitHub Actions POSTs to clauth channel on publish — wait for `mcp__claude_ai_clauth__channel_list` event, not a polling loop
> - **Private repos** (regen-root): Coolify webhook is wired to Supabase — check `deployment_registry` for deploy completion, not the clauth channel

### Package repos (clauth, rdc-skills)

#### 1. Version bump
- Read `package.json`, parse `version`
- Apply: patch (default), minor, major, or explicit
- Rewrite all `version` fields (some packages have `claude.version` too)

#### 2. Commit + tag + push
```bash
cd <source_path>
git add package.json
git commit -m "chore(release): vA.B.C"
git tag vA.B.C
git push && git push --tags
```
Never `--no-verify`. Never `--force`. Fix pre-commit hook failures at root cause.

#### 3. Wait for CI via clauth channel (rdc-skills and clauth)

Both repos have a GitHub Actions workflow that POSTs to `https://clauth.prtrust.fund/channel` on publish completion. **Do not poll `gh run list` in a loop.** Use the Monitor tool or check the channel:

```
# Check clauth channel for the completion event:
mcp__claude_ai_clauth__channel_list (since: <tag-push-timestamp>)
# Wait for event with text containing "vA.B.C" and status "success" or "failure"
# If no event after 10 min → fallback: gh run list --repo LIFEAI/<repo> --limit 3
```

If the channel event shows failure, pull the run logs before proceeding:
```bash
gh run view <databaseId> --repo LIFEAI/<repo> --log-failed
```

#### 4. Verify npm registry

```bash
npm view @lifeaitools/<repo> version   # must equal vA.B.C
```

Only run this after the channel event confirms success — don't poll npm independently.

#### 5. Install
- **clauth:** `npm install -g @lifeaitools/clauth@latest`
- **rdc-skills:** `node C:/Dev/rdc-skills/scripts/install-rdc-skills.js`
  - If install script fails, fall back:
    `cp -r C:/Dev/rdc-skills/skills/* ~/.claude/plugins/cache/rdc-skills/rdc-skills/latest/skills/`

#### 6. Verify
- **clauth:** `curl -s http://127.0.0.1:52437/ping | python3 -c "import sys,json; print(json.load(sys.stdin)['app_version'])"` — must match vA.B.C
- **rdc-skills:** `ls ~/.claude/skills/user/rdc-release/SKILL.md` — must exist
- **npm:** `npm list -g --depth=0 @lifeaitools/clauth` — version matches

#### 7. Post-install
- **clauth:** `curl -s -X POST http://127.0.0.1:52437/restart` → wait 3s → ping again
- **rdc-skills:** none

#### 8. Smoke test
- **clauth:** `curl -s http://127.0.0.1:52437/get/supabase-anon | python3 -c "import sys,json; print('ok' if json.load(sys.stdin).get('value') else 'fail')"` — expect `ok`
- **rdc-skills:** read frontmatter of one new/updated SKILL.md — parse succeeds

---

### App promote (promote <slug>)

#### 1. Registry lookup
```sql
SELECT slug, display_name, domain, staging_slug, staging_domain, coolify_uuid, monorepo_path, environment
FROM deployment_registry
WHERE slug = '<slug>';
```
If no `staging_slug` or `staging_domain`, ask Dave before proceeding — don't assume.

#### 2. Staging health gate
```bash
curl -s -o /dev/null -w "%{http_code}" https://<staging_domain>/
# Must return 200. TLS must be valid (no -k flag).
```
If staging is not healthy, STOP with `[!]` — don't promote a broken staging.

#### 3. Git state check
```bash
cd C:/Dev/regen-root
git status          # must be clean on develop
git push origin develop
git log origin/main..develop --oneline   # show what's going to main
```

#### 4. Version bump
- Read `apps/<app>/package.json` (use `monorepo_path` from registry), parse `version`
- Apply patch bump (default) or use explicit version if provided
- Commit: `chore(release): <slug> vA.B.C`
- Push to develop

#### 5. GitHub PR merge
```
# Check for existing open PR develop→main
mcp__claude_ai_Github_Proxy_MCP__list_pull_requests (base: main, head: develop)

# If none: create one
mcp__claude_ai_Github_Proxy_MCP__create_pull_request (base: main, head: develop, title: "chore(release): <slug> vA.B.C")

# Merge it
mcp__claude_ai_Github_Proxy_MCP__merge_pull_request (merge_method: merge)
```
**Note:** This uses the GitHub API — it does NOT run `git push origin main`. The `block-main-push` hook only blocks direct git push, not API merges.

#### 6. Coolify deploy poll
```bash
# Use clauth to get Coolify token, then poll the app's deployments
# Wait for status = "finished" — poll every 15s, 15min timeout
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "https://deploy.regendevcorp.com/api/v1/applications/<coolify_uuid>/deployments?per_page=1"
```

#### 7. Gate checks
```bash
curl -s -o /dev/null -w "%{http_code}" https://<domain>/   # must return 200
curl -s -I https://<domain>/ | grep -i "strict-transport"   # TLS
```

#### 8. Update registry
```sql
UPDATE deployment_registry SET last_deploy_at = now(), status = 'active' WHERE slug = '<slug>';
```

---

### Monorepo release (regen-root)

#### 1. Git state check
```bash
cd C:/Dev/regen-root
git status          # must be clean on develop
git push origin develop   # ensure latest is pushed
git log origin/main..develop --oneline   # summarise what's going to main
```

#### 2. Bump root version on develop
```bash
# Read current version from package.json, apply patch bump
# Commit: "chore(release): vA.B.C — promote develop → main"
git add package.json && git commit -m "chore(release): vA.B.C"
git push origin develop
```

#### 3. GitHub PR: develop → main
- Check for open PR from develop→main: `gh pr list --repo LIFEAI/regen-root --base main --head develop`
- If exists: use it. If not: create it via `mcp__claude_ai_Github_Proxy_MCP__create_pull_request`
- Merge via `mcp__claude_ai_Github_Proxy_MCP__merge_pull_request` with `merge_method: merge`

#### 4. Confirm Coolify auto-deploy

regen-root is a **private repo**. Coolify's webhook is wired to Supabase — deployment events land there automatically. Do NOT poll the Coolify REST API in a loop. Check Supabase:

```sql
-- Wait for the affected app's deployment to show status = 'finished'
SELECT slug, last_deploy_at, status, notes
FROM deployment_registry
WHERE slug IN (<affected slugs>)
ORDER BY last_deploy_at DESC;
```

If the registry hasn't updated within 2 minutes of the PR merge, check Coolify directly:
```bash
curl -s -H "Authorization: Bearer $(curl -s http://127.0.0.1:52437/v/coolify-api)" \
  "https://deploy.regendevcorp.com/api/v1/applications/<uuid>/deployments?per_page=1"
```

#### 5. Gate checks
For each affected app, verify: HTTP 200, TLS valid, container running.
Use `rdc:deploy diagnose <slug>` for any that fail.

#### 6. Update registry
```sql
UPDATE deployment_registry SET last_deploy_at = now() WHERE slug IN (<affected slugs>);
```

---

## Failure Modes

| Failure | Marker | Action |
|---------|--------|--------|
| Dirty working tree | `[!]` | Abort — show one-line diff summary, ask to commit or stash |
| Pre-commit hook fails | `[!]` | Fix root cause, re-stage, retry — NEVER `--no-verify` |
| CI fails | `[!]` | Print run URL + last 20 log lines |
| npm not registered | `[!]` | Check CI actually published — not a silent skip |
| PR merge blocked | `[!]` | Show blocker (branch protection, conflict) — resolve and retry |
| Coolify deploy failed | `[!]` | Run `rdc:deploy diagnose <slug>` — fix before declaring done |
| Gate non-200 | `[!]` | Don't update registry until fixed |

Show full checklist with `[!]` markers even on failure.

---

## Hard Rules

- **Never push directly to `main`** — always via GitHub PR merge (`mcp__claude_ai_Github_Proxy_MCP__merge_pull_request`)
- **Never `--force`, never `--no-verify`, never `--no-gpg-sign`**
- **Never declare success** without verified install or verified Coolify gate
- **Never release without an explicit `rdc:release` invocation** from the user
- **Monorepo MCP servers** (`regen-media`, `gws`) are released via `rdc:release regen-root` — not separately

---

## Related

- `.claude/context/clauth.md` — clauth release source of truth
- `.claude/context/coolify-deployment.md` — Coolify watch_paths, deploy rules
- `memory/feedback_version_bump_must_tag.md` — never bump without tagging
- `memory/feedback_use_rdc_release.md` — "promote/deploy to main" always triggers this skill
