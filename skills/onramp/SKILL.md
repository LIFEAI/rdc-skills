---
name: rdc:onramp
description: "Usage `rdc:onramp <slug> --name \"<Display Name>\"` — Full-pipeline enrollment orchestrator for a new Place Fund project. Runs all 8 phases: enroll → research → conflict resolution → brand → Regen Score gate → site build → deploy dev → deploy prod. Each phase is idempotent and resumable — re-invoke with the same slug to pick up where it stopped."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first, then `{PROJECT_ROOT}/.rdc/guides/engineering-behavior.md`.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. DB writes, deploys, and web searches short-circuit under the flag. Drift resolution, scoring, and file validation run normally.

> **RPMS compliance:** Encodes the Four Laws (One Home Per Fact · One Direction · One Door · One Spine). Each fact is written to its one home. **⛔ NEVER write `places/<slug>/_context.md`** — it is a generated projection owned by `apps/studio/src/lib/context-export-writer.ts`. A post-scaffold gate asserts its absence; the skill halts if found.

# rdc:onramp — Full Pipeline Enrollment

## When to Use

- Enrolling a new Place Fund project end-to-end (enrollment through deploy)
- Resuming an enrollment that stopped at any phase (idempotent re-invoke)
- Running research + scoring + build for a place already enrolled

## Argument Contract

```
rdc:onramp <slug> --name "<Display Name>" [--location <json>] [--archetype <archetype>]
                  [--owner <place-fund|rdc|jv|client>] [--history] [--dry-run]
                  [--skip-to <phase>] [--no-gate]
```

| Arg / Flag | Required | Default | Description |
|------------|----------|---------|-------------|
| `slug` | **yes** | — | kebab-case, place-anchored (e.g. `spirit-bear-village`). Validated against `^[a-z0-9]+(-[a-z0-9]+)*$`. |
| `--name` | **yes** | — | Human display name. Passed to `enroll_place` and used in all generated content. |
| `--location` | no | `{}` | JSON object for `enroll_place p_location` (e.g. `{"state":"BC","country":"Canada"}`). Never guessed — omit if unknown. |
| `--archetype` | no | `TBD` | Base-arc archetype. See [`corpus/_shared/onramp/ARCHETYPES.md`](file:///C:/Dev/regen-root/corpus/_shared/onramp/ARCHETYPES.md). |
| `--owner` | no | `place-fund` | `place-fund` \| `rdc` \| `jv` \| `client` |
| `--history` | no | off | Opt-in: scaffold `places/<slug>/HISTORY.md`. |
| `--dry-run` | no | off | Resolve drift + print plan; perform NO writes. |
| `--skip-to` | no | — | Jump to a specific phase (1–8). Phases before it are assumed complete. |
| `--no-gate` | no | off | Run all phases without pausing for human approval (prod deploy ALWAYS gates regardless). |

## Master Checklist

Emit this at the start. Update in place as phases complete.

```
rdc:onramp <slug> — full pipeline
Phase 1: Enrollment
  [ ] Preflight — validate slug + --name; parse flags
  [ ] Resolve drift — classify: fresh | already-enrolled | spine-ahead | disk-ahead
  [ ] DB spine — enroll_place RPC
  [ ] Enrollment epic — dup-guard + insert_work_item
  [ ] Disk tree — scaffold places/<slug>/
  [ ] _context.md absence gate
Phase 2: Research
  [ ] Web search — land, ownership, ecology, culture, stewardship, finance, regulatory
  [ ] Write findings into 6 arc files (01-story through 06-model)
  [ ] PLACE.md compiled from findings
  [ ] corpus/INDEX.md updated with all sources
Phase 3: Conflict Resolution
  [ ] All facts reviewed for tier conflicts
  [ ] RECONCILIATION.md written
  [ ] All facts verified | resolved | held — zero conflicted/unverified
Phase 4: Brand
  [ ] DESIGN.md — full brand guide (palette, typography, voice, imagery, content map)
  [ ] Brand review gate (skip if --no-gate)
Phase 5: Regen Score
  [ ] 5 dimensions scored from evidence
  [ ] Composite computed — GO ≥75 | NEEDS WORK 55-74 | NO-GO <55
  [ ] Score gate: composite ≥75 to proceed (advisory if --no-gate)
Phase 6: Site Build
  [ ] Create apps/<slug>/ (Next.js App Router, Baru model)
  [ ] tsc clean, build clean
Phase 7: Deploy Dev
  [ ] Register in apps + app_deployments (allocate next free port)
  [ ] Regenerate PM2 ecosystem config on Vultr
  [ ] PM2 start + HTTP 200 at <slug>.dev.place.fund
Phase 8: Deploy Prod
  [ ] Dave approval (ALWAYS gates)
  [ ] rdc:deploy <slug> promote
```

---

## Phase 1: Enrollment

### 1.0 Preflight

Validate before any external call:
- `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$` — reject if not
- `--name` is present and non-empty — reject if not
- `--dry-run` set → print plan and exit after drift resolution, no writes

### 1.1 Resolve Drift State

Read-only DB probe:
```sql
SELECT id, slug, name, status FROM places WHERE slug = '<slug>';
```

Check disk:
```bash
test -d "places/<slug>/" && echo "disk:present" || echo "disk:absent"
```

| State | Detection | Action |
|-------|-----------|--------|
| **fresh** | No DB row AND no disk dir | Run all enrollment steps |
| **already-enrolled** | DB row exists AND disk dir exists | `enroll_place` returns existing node; scaffolder skips existing files; epic dup-guarded. Continue to Phase 2. |
| **spine-ahead** | DB row exists, disk dir ABSENT | Re-call `enroll_place` (returns existing `project_node_id`); run scaffolder |
| **disk-ahead** | Disk dir exists, NO DB row | **⛔ STOP — colliding identity.** Open reconciliation work item; exit. |

**disk-ahead STOP protocol:**
```sql
SELECT insert_work_item(
  p_title       := 'reconcile: disk-ahead conflict for <slug>',
  p_item_type   := 'bug',
  p_priority    := 'urgent',
  p_source      := 'onramp',
  p_description := 'places/<slug>/ exists on disk but has no places DB row. Manual reconciliation needed.'
);
```
Report the work-item id, then exit. Never proceed to Step 1.

### 1.2 DB Spine (`enroll_place`)

Idempotent — returns existing `project_node_id` without duplicate rows.

```sql
SELECT enroll_place('<slug>', '<Display Name>', '<location_json>'::jsonb, 'enrolling');
```

`project_id = uvojezuorjgqzmhhgluu` REQUIRED on every Supabase MCP call.

**Subagent fallback** (if Supabase MCP unavailable in this context):
```
Agent({
  prompt: "Call mcp__claude_ai_Supabase__execute_sql.
           project_id: uvojezuorjgqzmhhgluu
           query: SELECT enroll_place('<slug>', '<name>', '{}'::jsonb, 'enrolling');
           Return the project_node_id from the result JSON."
})
```

**GATE:** Capture `project_node_id`. If absent → BLOCKED, stop.

### 1.3 Enrollment Epic (`insert_work_item`)

**Dup-guard first:**
```sql
SELECT id, title FROM work_items
WHERE title = 'epic: enroll <slug>'
  AND item_type = 'epic'
  AND status NOT IN ('done', 'archived')
LIMIT 1;
```

If a row exists: reuse the id. If not:
```sql
SELECT insert_work_item(
  p_title           := 'epic: enroll <slug>',
  p_item_type       := 'epic',
  p_priority        := 'high',
  p_source          := 'onramp',
  p_project_node_id := '<project_node_id>'::uuid,
  p_labels          := ARRAY['onramp','<archetype>']
);
```

### 1.4 Disk Tree

The scaffolder creates the **6-arc website model** (not 7 research subdirectories):

```bash
node scripts/onramp-scaffold-place.mjs --slug <slug> --name "<Display Name>" \
  [--archetype <archetype>] [--owner <owner>] [--history]
```

This produces:
```
places/<slug>/
  PLACE.md              — identity anchor (filled in Phase 2)
  PRODUCT.md            — route registry + site model
  DESIGN.md             — brand brief stub (filled in Phase 4)
  HANDOFF.md            — build handoff stub (filled in Phase 6)
  corpus/
    INDEX.md            — source index
  arc/
    01-story.md         — hero + concept (→ / route)
    02-place.md         — land, ecology, timeline, stewards (→ /place route)
    03-foundation.md    — the why, Five Capitals profile (→ /foundation route)
    04-process-outcomes.md — programs + intended outcomes (→ /regeneration route)
    05-investors.md     — investment thesis + assets (→ /investors route)
    06-model.md         — financial architecture + phasing (→ /financial-model route)
  tracker/
    DECISIONS.md
    DELIVERABLES.md
    MILESTONES.md
    RISKS.md
    STAKEHOLDERS.md
```

**The 6 arc files map 1:1 to website routes.** Research findings from all 7 domains (land, ownership, ecology, culture, stewardship, finance, regulatory) are distributed across these 6 files according to which route they serve.

**Post-scaffold gate (HARD):**
```bash
test ! -f "places/<slug>/_context.md" && echo "✓" || echo "FAIL: _context.md present"
```
If `_context.md` found: **STOP.** Projection-drift violation.

---

## Phase 2: Research

The research phase assembles a source-verified corpus using web search. Run searches directly from the main context (not subagents — the main context can cross-reference findings across domains, which subagents cannot).

### Research Approach

Run 4–6 parallel WebSearch calls covering all 7 research domains:
- Land identity + ownership (parcel data, title, encumbrances)
- Ecology + environmental (ecoregion, species, hydrology, soils)
- History + culture (Indigenous territory, heritage listings, community)
- Regulatory + finance (zoning, permits, water rights, tax assessments)

**Source databases to target:** government databases (county GIS, BLM, SSURGO, USGS, NVC, NHPA, Native Land Digital, state water boards), heritage registers (Canada's Register of Historic Places, NRHP), peer-reviewed studies, independent reports.

### Writing Findings into Arc Files

Distribute research findings across the 6 arc files by route relevance:

| Arc File | Research Domains | Route |
|----------|-----------------|-------|
| `01-story.md` | Distilled narrative from ALL domains — the hook | `/` |
| `02-place.md` | Land identity, ecology, timeline, stewardship | `/place` |
| `03-foundation.md` | Why this place, Five Capitals profile, RCCS potential | `/foundation` |
| `04-process-outcomes.md` | Programs, intended outcomes, metrics | `/regeneration` |
| `05-investors.md` | Investment thesis, asset summary, capital structure | `/investors` |
| `06-model.md` | Revenue streams, cost drivers, phasing | `/financial-model` |

Each arc file must include a `## Sources` section listing every source used with its tier rating and a clickable URL.

### Post-Research

1. Compile `places/<slug>/PLACE.md` — the one-paragraph identity distilled from all findings
2. Update `places/<slug>/corpus/INDEX.md` — table of all sources with tier, type, and verification status
3. Write `01-story.md` LAST — it is the thesis distilled from the whole

Under `RDC_TEST=1`: skip web searches; write stub content with `[RDC_TEST] placeholder`.

---

## Phase 3: Conflict Resolution

Scan all 6 arc files for conflicting facts (same claim, different values or sources).

### Procedure

1. Read all arc files from Phase 2
2. For each pair of conflicting facts:
   - Record both claims with tiers and provenance
   - The higher-tier source governs
   - Write the resolution to `places/<slug>/RECONCILIATION.md`
3. Update fact statuses:
   - Winning claim → `status: resolved` (or stays `verified`)
   - Losing claim → demoted to a note
   - Unresolvable → `status: held` with reason
4. **Gate:** all facts must be `verified`, `resolved`, or `held`. Zero `conflicted` or `unverified` facts may remain.

If zero conflicts found: write RECONCILIATION.md with "No conflicts detected."

**COLLISION RULE:** If two conflicting PLACE identities are found (slug refers to two different physical locations), **STOP immediately** — disk-ahead-class collision.

---

## Phase 4: Brand

### 4.1 Generate Full DESIGN.md (Brand Guide)

Read PLACE.md and all arc files. Write a **complete brand guide** to `places/<slug>/DESIGN.md` with ALL of:

- **Story of Place** — one-paragraph narrative distilled from research
- **Voice** — tone, register, rhythm, prohibitions
- **Mood** — primary mood, visual register, color temperature
- **Color Palette** — 10–12 CSS custom property tokens with hex values, roles, and natural source references (e.g. `--sbv-cream: #e8e0d4 — Spirit Bear fur`). Token namespace: `--<slug-prefix>-*`
- **Typography** — display + body font families, weights, tracking. Cormorant Garamond / Inter is the default pairing.
- **Imagery Direction** — photography style, image treatment, what to avoid
- **Materiality** — physical materials (from the place), digital materiality (textures, borders, animation)
- **Content Map** — table mapping each route to its arc file and hero element

### 4.2 Model: Baru (`apps/baru-website`)

The structural model for every Place Fund project site is Baru:
- 6+1 route architecture (6 public + /brand-guide dev-only)
- Section component pattern (Hero, Concept cards, Stats grid, Timeline, Partner CTA)
- framer-motion animation vocabulary (fade-up, stagger, scroll-parallax)
- `@regen/ui` shared components (SectionLabel, H2, Body)

Adapt Baru's structure. Never copy its tokens, imagery, or voice.

### 4.3 Brand Gate

If `--no-gate` is NOT set:
```
⏸️  BRAND GATE — Phase 4 complete.
   DESIGN.md written. Review and re-invoke: rdc:onramp <slug> --skip-to 5
```
If `--no-gate` IS set: proceed to Phase 5.

---

## Phase 5: Regen Score

Score each of the 5 intake-readiness dimensions based on evidence in the arc files. See [`docs/systems/regenops/BENCHMARKING.md`](file:///C:/Dev/regen-root/docs/systems/regenops/BENCHMARKING.md).

### Scoring Procedure

| Dimension | Key | Evidence Sources | Scoring Basis |
|-----------|-----|-----------------|---------------|
| Owner / Steward | `owner` | 02-place (stewards), 03-foundation | Title clarity, steward alignment, FPIC |
| Project / Place | `place` | 02-place (ecology, stats) | Archetype fit, ecoregion mapped, features verified |
| Finance Model | `model` | 05-investors, 06-model | Raise clarity, valuations, encumbrances |
| Approach | `approach` | 03-foundation, 04-process-outcomes | Integrative intent, rubric applied, co-governance |
| Timeline | `timeline` | all arc files | Phase targets, corpus completeness, gaps remaining |

**Score formula per dimension:**
- Base: 20 points (enrolled)
- +10 per verified/resolved fact in the dimension (capped at 50)
- +10 if ≥3 facts are tier 0-1 (government/legal sources)
- +10 if zero gaps remain in the dimension
- +10 if zero held/unverified facts remain
- Maximum: 100

**Composite:** unweighted mean of all 5, rounded.

### Score Gate

- **GO (≥75):** proceed to Phase 6.
- **NEEDS WORK (55-74):** report weakest dimension. If `--no-gate`: proceed anyway (dev is iterative). If gated: stop.
- **NO-GO (<55):** always stop and escalate.

---

## Phase 6: Site Build

Create a Next.js App Router site at `apps/<slug>/` following the Baru model.

### App Structure

```
apps/<slug>/
  package.json           — @regen/<slug>, port from registry
  next.config.mjs        — transpilePackages: ["@regen/ui"]
  tailwind.config.ts     — custom token colors from DESIGN.md palette
  tsconfig.json          — standard Next.js config
  postcss.config.mjs     — tailwind + autoprefixer
  src/
    app/
      globals.css        — :root CSS custom properties from DESIGN.md
      layout.tsx         — fonts, metadata, Nav + Footer
      page.tsx           — homepage (Hero + Concept + Partner)
      place/page.tsx     — Origin + PlaceStats + Ecology + Timeline
      foundation/page.tsx
      regeneration/page.tsx — Programs
      investors/page.tsx  — InvestorHero + AssetTable
      financial-model/page.tsx — ModelOverview
      brand-guide/page.tsx — BrandGuide (DEV-ONLY)
      sitemap.ts
    components/
      nav.tsx            — fixed header with route links
      footer.tsx         — site map + PRT framework link + version
      sections/          — one component per page section
```

### Build Process

1. Create all files (adapt from Baru, never copy tokens/content)
2. `pnpm --filter @regen/<slug> install`
3. `npx tsc --noEmit` — must pass
4. `pnpm --filter @regen/<slug> build` — must produce all routes
5. Update HANDOFF.md with epic id, project_node_id, Regen Score, and build scope
6. Commit: **infra (pnpm-lock.yaml) first**, then product files — the scope guard requires split commits

### Commit Discipline

The monorepo's scope guard blocks commits that mix infrastructure files (pnpm-lock.yaml) with product files. For a new app:
1. Commit lockfile first: `chore(infra): add @regen/<slug> to pnpm lockfile` with `RDC-Bypass: new app lockfile importer`
2. Commit product files: `feat(<slug>): Next.js site — ...` with `Work-Item: <epic-id>`

---

## Phase 7: Deploy Dev

### 7.1 Registry Setup

Register the app in Supabase (both tables, in order):

```sql
-- 1. apps table (parent)
INSERT INTO apps (slug, display_name, description, monorepo_path, github_org,
  github_repo, runtime, owner_slug, status, pnpm_filter)
VALUES ('<slug>', '<Display Name>', '<description>',
  'apps/<slug>', 'LIFEAI', 'regen-root', 'next', '<owner>',
  'active', '@regen/<slug>');

-- 2. app_deployments table (child — FK on app_slug)
-- IMPORTANT: environment enum is 'dev' not 'development'
-- IMPORTANT: allocate next free port — query first:
SELECT pm2_port FROM app_deployments
WHERE host_type = 'pm2' AND pm2_port IS NOT NULL
ORDER BY pm2_port DESC LIMIT 1;
-- Use max + 1 as the new port

INSERT INTO app_deployments (app_slug, environment, host_type, url,
  pm2_name, pm2_port, branch, build_command, status, notes)
VALUES ('<slug>', 'dev', 'pm2', '<slug>.dev.place.fund',
  '<slug>', <next_port>, 'develop',
  'pnpm --filter @regen/<slug> build', 'active', '<notes>');
```

Update package.json dev/start scripts to use the allocated port.

### 7.2 Deploy to Vultr PM2

SSH to Vultr and run:
```bash
# 1. Pull latest develop
git fetch -q origin develop && git reset -q --hard origin/develop

# 2. Install + build (CI=true required for non-TTY frozen install)
export CI=true
pnpm --filter @regen/<slug> install --frozen-lockfile
pnpm --filter @regen/<slug> build

# 3. Regenerate ecosystem config (--write flag required!)
node scripts/generate-dev-configs.mjs --write

# 4. Start via PM2 (file is .js not .cjs, at /srv/regen/ecosystem.config.js)
pm2 start /srv/regen/ecosystem.config.js --only <slug>
```

### 7.3 Verify

```bash
# Local on Vultr
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/
# → must be 200

# Public through Traefik (wildcard *.dev.place.fund already routes)
curl -s -o /dev/null -w "%{http_code}" https://<slug>.dev.place.fund/
# → must be 200

# Content check
curl -s https://<slug>.dev.place.fund/ | grep -oE '<title>[^<]+</title>'
# → must contain the place name
```

---

## Phase 8: Deploy Prod

**ALWAYS gates for Dave's approval, regardless of --no-gate.**

```
⏸️  PROD GATE — dev verified at <slug>.dev.place.fund
   To promote: provide explicit approval, then: rdc:deploy <slug> promote
```

Production deployment requires Dave's explicit approval in the session.

---

## Resumability

Every phase checks whether its outputs already exist before running:

| Phase | Skip condition |
|-------|---------------|
| 1 — Enrollment | `places` DB row exists AND disk tree exists AND epic exists |
| 2 — Research | All 6 arc files have substantive content (not just TODO stubs) |
| 3 — Conflicts | RECONCILIATION.md exists and all facts are verified/resolved/held |
| 4 — Brand | DESIGN.md has full palette + typography + voice (not just the stub) |
| 5 — Score | Score computed and recorded in HANDOFF.md |
| 6 — Build | `apps/<slug>/` exists and `pnpm --filter @regen/<slug> build` succeeds |
| 7 — Deploy Dev | `<slug>.dev.place.fund` returns HTTP 200 with correct `<title>` |
| 8 — Deploy Prod | Prod URL returns HTTP 200 |

Re-invoking `rdc:onramp <slug>` skips completed phases. Use `--skip-to <phase>` to force a jump.

---

## Rules

- Validate `slug` and `--name` before any external call
- `enroll_place` is the ONLY door for spine rows — never raw INSERT into `places`, `project_nodes`, or `project_places`
- `insert_work_item` is the ONLY door for work items — never raw INSERT into `work_items`
- Assert `_context.md` ABSENT after scaffolding — hard stop if present
- disk-ahead → STOP, open reconciliation work item, never proceed
- Every research fact MUST have a real source URL — no AI-generated claims as sources
- Source tiers: 0=Recorded legal, 1=Government/official, 2=Independent 3rd-party, 3=Project upload, 4=Stakeholder claim
- Tier 4 claims tagged `(Illustrative)` on all public surfaces
- Corpus → arc is append-only: never delete arc entries
- Prod deploy ALWAYS gates for Dave regardless of --no-gate
- Split infra (lockfile) and product commits — scope guard enforces this
- Under `RDC_TEST=1`: DB writes, web searches, builds, and deploys short-circuit; drift resolution, scoring, and file validation run normally

## Capture Lessons

Before the final verdict, follow `.rdc/guides/lessons-learned-spec.md` § Capture procedure. If this run exposed a non-obvious gap, write one `.rdc/lessons/<YYYY-MM-DD>-onramp-<slug>.md`. A run that taught nothing writes nothing.
