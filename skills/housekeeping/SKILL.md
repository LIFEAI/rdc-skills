---
name: rdc:housekeeping
description: "Usage `rdc:housekeeping [--fix|--lessons]` — Weekly maintenance audit and lessons-only triage with a prior-fix audit, architectural interview gate, RDC work routing, and a complete report. Produces `.rdc/reports/YYYY-MM-DD-housekeeping.md`."
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
- `rdc:housekeeping --lessons` — process only the weekly lessons triage workflow, including its audit, decision interview, routed work, and report

## Procedure

When invoked with `--lessons`, skip every non-lessons maintenance section below (including Directory Structure Verification) and begin directly at **Lessons triage (weekly)**. Produce the lessons report only.

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

Before filtering or clustering, read every candidate lesson **in full**. Normalize every
legacy lesson that has `status` but no `lesson_status` by moving its existing value to
`lesson_status` and record the migration in the report. Validate that each candidate has
exactly one frontmatter block, canonical `lesson_status`, and the required routing fields
(`id`, `date`, `skill`, `runtime`, `scope`, `area`, `needs_claude`, `links`); a malformed
record is itself a triage finding, never an invisible parser omission.

Before asking Dave a single question or routing any fix, write four synthesis artifacts in
the weekly report: (1) a correlation table accounting for **every** candidate lesson with its
remediation train, shared root cause, systemic fix, owner/lifecycle, and closure evidence;
(2) a remediation model that collapses recurring symptoms into the smallest control set and
execution order; (3) a resolution audit; and (4) one compact architectural-decision table
with options and a recommendation for each genuine trade-off. Do not make Dave reconstruct
the model from serial lesson prompts. This phase is a controlled weekly workflow: synthesize
first, then collect the complete architectural interview, then route approved work through
RDC. It must never create a duplicate plan or fixit for a lesson that is already fixed or
sufficiently mitigated.

### 1. Cluster

Cluster by `area` + root-cause similarity and dedupe repeats into one proposed outcome. Give every cluster a stable identifier and list its lesson ids, area, evidenced root cause, proposed change, scope, and linked commits/work items.

### 2. Resolution audit (mandatory before routing work)

For every cluster, inspect the relevant code, rules, skills, guides, tests, recent commits, linked work items, and existing mitigations before creating any `rdc:fixit`, `rdc:plan`, or `rdc:build` work.

Record auditable evidence and classify the cluster as exactly one of:

- `already-fixed` — the needed behavior is present and backed by a cited source location, test, or shipped commit; do not create new work.
- `sufficiently-mitigated` — an existing guard, process, or documentation reduces the risk enough that no additional change is justified; do not create new work and record the remaining risk.
- `still-open` — the evidence does not fully address the root cause; only this result may enter the routing phase.

The audit must name what was inspected, the evidence found or missing, the conclusion, and the reason no duplicate work was created. Mark an already-fixed lesson `lesson_status: applied` only when its prior commit is linked; mark a sufficiently-mitigated lesson `lesson_status: wont-fix` with the mitigation and remaining-risk reason. Keep partially mitigated clusters open for routing.

### 3. Architectural report and interview gate

After the synthesis artifacts are complete, write the full architectural report for every `still-open` architectural cluster. For each one include the decision to make, affected systems, options and tradeoffs, recommendation, unresolved risks, and the result of the resolution audit. This produces the complete decision table and is the required gate before every routed fix.

Create a complete interview list from that report before changing any file. In attended mode, ask every required architectural question via `AskUserQuestion`, one question at a time, and record the question, answer, decision, rationale, and affected cluster. Do not start simple or architectural fixes until all interview questions have answers or the corresponding cluster is explicitly deferred. Silence is not approval.

If there are no architectural decisions, record `Architectural interview: none required` in the report before continuing. In unattended mode, do not guess: create the equivalent `human_items` decision records for every unresolved architectural question, link a work item, and defer those clusters.

### 4. Route only still-open, approved work through RDC

After the resolution audit and the complete architectural interview, route every approved executable cluster through an RDC lifecycle with a complete work item, required checklist evidence, implementation report, review status, validator closure, commit, and push. Direct edits outside an RDC work item are forbidden.

- `scope: simple` — invoke `rdc:fixit` when the change is genuinely under five files and thirty minutes; `rdc:fixit` creates and completes the sole work item. Include the cluster and lesson ids in its description and action-register entry. Otherwise use `rdc:plan` followed by `rdc:build`.
- `scope: architectural` — use `rdc:plan` followed by `rdc:build` unless the approved change is genuinely within the `rdc:fixit` threshold. The plan must contain the approved interview decision and acceptance checks.
- Deferred or declined clusters — set `lesson_status: triaged` or `lesson_status: wont-fix`, link the work item or reason, and do not make an unapproved change.

Each routed wave must run the review gate: `rdc:fixit` performs its mandatory review and every batch also completes `rdc:review` before lessons are marked applied. Deploy a changed deployable target to dev through its normal RDC lifecycle and record the deployment evidence; document `not applicable` for documentation-only, rule-only, or skill-only work.

### 5. Complete weekly lessons report

Add a `## Weekly Lessons Triage` section to `.rdc/reports/YYYY-MM-DD-housekeeping.md` with:

1. `### Cluster and resolution audit` — cluster ids, lessons, area/cause, inspected evidence, `already-fixed` / `sufficiently-mitigated` / `still-open` result, and duplicate-work decision.
2. `### Architectural report` — each decision, options, tradeoffs, recommendation, risks, and audit result.
3. `### Architectural interview` — the complete question-and-answer list, decisions, deferrals, and clusters affected; explicitly state when none was required.
4. `### RDC action register` — work item, selected lifecycle (`rdc:fixit` or `rdc:plan` -> `rdc:build`), test/review evidence, commit/push, dev deployment or `not applicable`, and final lesson status.
5. `### Outcome counts` — open, deduped, already fixed, sufficiently mitigated, applied, triaged, wont-fix, deferred, fixits, builds, review passes, and dev deployments.

### Attended mode (default — a human is present)

The attended run follows sections 1 through 5 in order. The full interview list and all answers are collected before the first routed fix starts; then batch approved fixes by lifecycle and target. Set `lesson_status: applied` only after the routed work item has passed review, the commit is pushed, required dev deployment evidence is recorded, and the commit is linked.

### Unattended mode (no human — overnight / cron / `rdc:overnight`)

When the weekly triage runs unattended, perform the same cluster and resolution audit before any routing, then follow `.rdc/guides/lessons-learned-spec.md` § **Triage procedure — UNATTENDED weekly mode** — do not run `AskUserQuestion`. In brief (the spec is authoritative):

- **Per-difficulty model routing** (reuses the `rdc:build` table): the run is led by `claude-opus-4-8` for clustering + scope/difficulty triage; mechanical apply → `claude-sonnet-4-6`; harder multi-file/migration fix → `claude-opus-4-6`; design/architectural fix → `claude-opus-4-8`.
- `scope: simple` → create a complete work item and route via `rdc:fixit` or `rdc:plan` -> `rdc:build`; never apply directly.
- `scope: architectural` with a single clear correct fix (records an already-learned lesson — e.g. "document X", "add a gate", update a guide) → route through `rdc:plan` → `rdc:build` (or `rdc:fixit` if genuinely <5 files), update the documentation, set `lesson_status: applied`/`triaged`.
- `scope: architectural` **and genuinely ambiguous** (multiple valid approaches, real tradeoffs) → write a `human_items` row (`item_type='decision'`, with options in `suggested_agent_prompt`, `source_type='lesson'`, `source_fingerprint` for dedupe), set `lesson_status: triaged`, spawn + link a `work_item`. Decided in the morning. This is the asynchronous equivalent of the attended interview and honors `.claude/rules/architectural-change-approval.md`.

Never delete lesson files — `applied` and `wont-fix` stay as the audit trail.

## Rules
- Never run `pnpm build` — not needed for this audit
- Never modify app_deployments — the DB is the source of truth; PUBLISH.md conforms to it
- The `--fix` flag only auto-remediates safe issues (CLAUDE.md scaffold, missing dirs, URL alignment)
- Architectural changes (name mismatches, dead package removal) are always flagged, never auto-fixed
- This skill is read-heavy, write-light — most runs are audit-only
