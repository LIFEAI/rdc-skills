---
name: rdc:housekeeping
description: "Usage `rdc:housekeeping [--fix]` — Weekly maintenance audit: directory structure verification, PUBLISH.md URL validation, CLAUDE.md freshness, orphan detection, places compliance, and stale version scan. Produces `.rdc/reports/YYYY-MM-DD-housekeeping.md`. With `--fix`, auto-remediate safe issues."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`), then `{PROJECT_ROOT}/.rdc/guides/engineering-behavior.md` (fallback: `{PROJECT_ROOT}/.rdc/guides/engineering-behavior.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.


# rdc:housekeeping — Weekly Maintenance Audit

## When to Use
- Weekly maintenance (Sunday or session start)
- After large batch of new apps/packages/sites added
- Before monthly `workspace-intelligence-audit`
- When disoriented about repo health
- Called by `rdc:overnight` as a pre-flight if `--housekeeping` flag set

## Arguments
- `rdc:housekeeping` — audit only, report issues
- `rdc:housekeeping --fix` — auto-remediate safe issues (scaffold missing CLAUDE.md, fix PUBLISH.md URLs, create missing tracker dirs)

## Procedure

### 1. Directory Structure Verification

Scan every deployable target for required files:

```
For each dir in apps/*, sites/*, models/*, workers/*, mcp-servers/*, packages/*:
```

| Target Type | Required Files |
|-------------|---------------|
| Next.js app (`apps/*` with next.config) | `package.json`, `CLAUDE.md`, `PUBLISH.md`, `tsconfig.json` |
| Vite SPA (`models/*`, `sites/*` with vite.config) | `package.json`, `CLAUDE.md`, `PUBLISH.md`, `vite.config.js` or `.ts`, `dist/` |
| Static site (`sites/*` no vite/next) | `index.html`, `CLAUDE.md`, `PUBLISH.md` |
| Worker (`workers/*`) | `package.json`, `CLAUDE.md`, `wrangler.toml`, `src/index.ts` |
| MCP server (`mcp-servers/*`) | `package.json`, `CLAUDE.md`, `ARCHITECTURE.md`, `PUBLISH.md` |
| Package (`packages/*`) | `package.json`, `CLAUDE.md`, `tsconfig.json`, `src/` |

Report: `PASS` / `MISSING: <file list>` per target.

**With `--fix`:** Scaffold missing CLAUDE.md files using package.json description + src/ inspection (same pattern as the 2026-06-08 audit). Do NOT auto-create PUBLISH.md (requires domain knowledge).

### 2. PUBLISH.md URL Validation

For every PUBLISH.md that exists:

1. Parse frontmatter: extract `entity_slug`, `environments`, `status`
2. Query `app_deployments` for the slug:
   ```sql
   SELECT app_slug, environment, url, host_type FROM app_deployments WHERE app_slug = '<slug>';
   ```
3. Cross-reference: any URL mentioned in the PUBLISH.md body/notes/SURFACE blocks must match the `app_deployments.url` for that environment
4. Check domain convention compliance (per `.claude/rules/domain-conventions.md`):
   - Real estate projects → `*.dev.place.fund` (dev) / `*.place.fund` (prod)
   - Class-A brands → `dev.<brand>` (dev) / `<brand>` (prod)
   - Internal tools → `*.dev.regendevcorp.com` (dev) / `*.regendevcorp.com` (prod)
5. Flag mismatches: `MISMATCH: PUBLISH.md says <X>, app_deployments says <Y>`

**With `--fix`:** Update PUBLISH.md URLs to match app_deployments (the DB is the source of truth).

### 3. CLAUDE.md Freshness Check

For each package with a CLAUDE.md:
1. Get CLAUDE.md last modified date
2. Get latest src/ modification date
3. If src/ changed after CLAUDE.md by >30 days, flag: `STALE: CLAUDE.md older than src/ by <N> days`
4. Check if new exports were added to `src/index.ts` that aren't mentioned in CLAUDE.md

**With `--fix`:** Re-scaffold CLAUDE.md from current src/ state.

### 4. Package.json Health

For each package:
1. Check `version` — flag `0.0.0` or `0.1.0` on packages with >5 src files as potentially stale
2. Check `exports` field exists (required for monorepo packages)
3. Check `name` matches `@regen/<dir-name>` or `@lifeai/<dir-name>` convention
4. Flag name mismatches between directory and package.json

### 5. Places Compliance

For each directory under `places/`:
1. Check PLACE.md exists with valid frontmatter (`schema_version`, `prt_slug`, `project_type`, `research_status`)
2. Check HISTORY.md exists (required for real-estate project types per `.claude/rules/history-md-convention.md`)
3. Check `corpus/INDEX.md` exists
4. Check `tracker/` directory exists with DECISIONS.md + MILESTONES.md
5. Check `artifacts/` directory exists

**With `--fix`:** Scaffold missing PLACE.md from HISTORY.md frontmatter, create missing tracker/corpus dirs.

### 6. Orphan Detection

1. **Empty/stub directories:** Any target dir with <3 files and no package.json → flag for removal
2. **Standalone repo drift:** Check `C:/Dev/` for repos that have monorepo copies and compare versions
3. **Dead app_deployments rows:** Query for slugs with `status='down'` or `status='broken'`

### 7. Stale Coolify Apps on .dev URLs

Query Coolify API for apps serving `.dev.*` URLs — these should be on PM2 per domain conventions:
```bash
TOKEN=$(curl -s http://127.0.0.1:52437/v/coolify-api)
curl -s -H "Authorization: Bearer $TOKEN" "https://deploy.regendevcorp.com/api/v1/applications" | \
  python3 -c "import sys,json; [print(a['name'], a.get('fqdn','')) for a in json.load(sys.stdin) if '.dev.' in (a.get('fqdn',''))]"
```

Flag any .dev apps still on Coolify.

### 8. Media CDN Hotlink Allowlist

Read `workers/media-cdn/src/index.ts` ALLOWED_SUFFIXES. Cross-reference against all class-A brand domains from `app_deployments`:
```sql
SELECT DISTINCT url FROM app_deployments WHERE host_type = 'coolify' AND url NOT LIKE '%.place.fund' AND url NOT LIKE '%.regendevcorp.com';
```

Flag any class-A domain NOT in ALLOWED_SUFFIXES.

**With `--fix`:** Add missing suffixes to ALLOWED_SUFFIXES and redeploy the worker.

### 9. Report

Write to `.rdc/reports/YYYY-MM-DD-housekeeping.md`:

```markdown
# Housekeeping Report — YYYY-MM-DD

## Summary
| Check | Pass | Fail | Fixed |
|-------|------|------|-------|

## Directory Structure
<table of targets with issues>

## PUBLISH.md URL Validation
<table of mismatches>

## CLAUDE.md Freshness
<stale entries>

## Package Health
<version/exports/naming issues>

## Places Compliance
<incomplete places>

## Orphans
<empty dirs, dead deployments>

## Media CDN
<missing allowlist entries>

## Verdict: CLEAN / HAS_ISSUES
```

## Lessons triage (weekly)

Read all `.rdc/lessons/*.md` with `status: open` (schema + procedure: `.rdc/guides/lessons-learned-spec.md` § Triage procedure). Cluster by `area` + root-cause similarity (dedupe repeats into one fix). For each cluster:

- `scope: simple` → apply the fix directly (rule line, skill-doc edit, config, guard), commit it, set the lesson(s) `status: applied` with the commit linked.
- `scope: architectural` → do NOT edit. Present the issue + options via `AskUserQuestion` (per `.claude/rules/architectural-change-approval.md`). On approval, apply via the correct lifecycle (rdc-skills tag/push for skills; cited commit for rules) and set `status: applied`. If deferred, set `status: triaged` and spawn a `work_item`.
- Not worth fixing → `status: wont-fix` with a one-line reason.

Never delete lesson files — `applied` and `wont-fix` stay as the audit trail. Report captured / applied / escalated / deferred counts in the housekeeping report.

## Rules
- Never run `pnpm build` — not needed for this audit
- Never modify app_deployments — the DB is the source of truth; PUBLISH.md conforms to it
- The `--fix` flag only auto-remediates safe issues (CLAUDE.md scaffold, missing dirs, URL alignment)
- Architectural changes (name mismatches, dead package removal) are always flagged, never auto-fixed
- This skill is read-heavy, write-light — most runs are audit-only
