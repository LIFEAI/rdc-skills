---
name: rdc:onramp
description: "Usage `rdc:onramp <slug> --name \"<Display Name>\"` — Full-pipeline enrollment orchestrator for a new Place Fund project. Runs all 7 phases: enroll → research + document integration → conflict resolution → brand book + imagery → Regen Score gate → site build → deploy dev. Each phase is idempotent and resumable."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first, then `{PROJECT_ROOT}/.rdc/guides/engineering-behavior.md`.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. DB writes, deploys, and web searches short-circuit under the flag. Drift resolution, scoring, and file validation run normally.

> **RPMS compliance:** Encodes the Four Laws (One Home Per Fact · One Direction · One Door · One Spine). Each fact is written to its one home. **⛔ NEVER write `places/<slug>/_context.md`** — it is a generated projection owned by `apps/studio/src/lib/context-export-writer.ts`. A post-scaffold gate asserts its absence; the skill halts if found.

# rdc:onramp — Full Pipeline Enrollment

## When to Use

- Enrolling a new Place Fund project end-to-end (enrollment through dev deploy)
- Resuming an enrollment that stopped at any phase (idempotent re-invoke)
- Running research + scoring + build for a place already enrolled

**Prod promotion is NOT part of onramp.** Once Phase 7 completes, the pipeline
is done. To promote to production later: `rdc:deploy <slug> promote`.

## Argument Contract

```
rdc:onramp <slug> --name "<Display Name>" [--location <json>] [--archetype <archetype>]
                  [--owner <place-fund|rdc|jv|client>] [--history] [--dry-run]
                  [--skip-to <phase>] [--no-gate]
```

| Arg / Flag | Required | Default | Description |
|------------|----------|---------|-------------|
| `slug` | **yes** | — | kebab-case, place-anchored. Validated against `^[a-z0-9]+(-[a-z0-9]+)*$`. |
| `--name` | **yes** | — | Human display name. |
| `--location` | no | `{}` | JSON object for `enroll_place p_location`. Never guessed. |
| `--archetype` | no | `TBD` | See `corpus/_shared/onramp/ARCHETYPES.md`. |
| `--owner` | no | `place-fund` | `place-fund` \| `rdc` \| `jv` \| `client` |
| `--history` | no | off | Scaffold `places/<slug>/HISTORY.md`. |
| `--dry-run` | no | off | Resolve drift + print plan; no writes. |
| `--skip-to` | no | — | Jump to a specific phase (1–7). |
| `--no-gate` | no | off | Skip human gates (brand review). |

## Master Checklist

```
rdc:onramp <slug> — full pipeline
Phase 1: Enrollment
  [ ] Preflight — validate slug + --name; parse flags
  [ ] Resolve drift — classify: fresh | already-enrolled | spine-ahead | disk-ahead
  [ ] DB spine — enroll_place RPC
  [ ] Enrollment epic — dup-guard + insert_work_item
  [ ] Disk tree — scaffold places/<slug>/
  [ ] _context.md absence gate
Phase 2: Research + Document Integration
  [ ] Web search — land, ownership, ecology, culture, stewardship, finance, regulatory
  [ ] Read ALL incoming corpus documents ($CORPUS_ROOT or Google Drive incoming folder)
  [ ] Extract financial model, phased timeline, team, partners, revenue streams from docs
  [ ] Integrate web research + document data into 6 arc files (01-story through 06-model)
  [ ] PLACE.md compiled from findings
  [ ] corpus/INDEX.md updated with all sources (web + document)
  [ ] DOCUMENT GATE: every incoming doc read and referenced — no unread documents allowed
Phase 3: Conflict Resolution
  [ ] All facts reviewed for tier conflicts (web vs document)
  [ ] RECONCILIATION.md written
  [ ] All facts verified | resolved | held — zero conflicted/unverified
Phase 4: Brand Book + Imagery
  [ ] Search online for existing project imagery (previous names, partner sites, location photos)
  [ ] DESIGN.md — 24-page editorial brand book outline (see §4.1)
  [ ] Palette derived from ACTUAL place imagery via RAMPA/image tools — NOT generic green
  [ ] IMAGERY-PROMPTS.md — AI prompts per slot + found web imagery catalog
  [ ] Generate images via Codex — iterate until criteria met
  [ ] Place images in apps/<slug>/public/images/ + wire imagery.ts
  [ ] Brand review gate (skip if --no-gate)
Phase 5: Regen Score
  [ ] 5 dimensions scored from evidence (web + documents)
  [ ] Composite computed — GO ≥75 | NEEDS WORK 55-74 | NO-GO <55
  [ ] Score gate: composite ≥75 to proceed (advisory if --no-gate)
Phase 6: Site Build
  [ ] Create apps/<slug>/ (Next.js App Router, Baru model)
  [ ] All routes render real content from arc files + imagery
  [ ] tsc clean, build clean
Phase 7: Deploy Dev
  [ ] Register in apps + app_deployments (allocate next free port)
  [ ] Regenerate PM2 ecosystem config on Vultr (--write flag)
  [ ] PM2 start + HTTP 200 at <slug>.dev.place.fund
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
| **already-enrolled** | DB row exists AND disk dir exists | Continue to Phase 2. |
| **spine-ahead** | DB row exists, disk dir ABSENT | Run scaffolder |
| **disk-ahead** | Disk dir exists, NO DB row | **⛔ STOP.** Open reconciliation work item; exit. |

### 1.2 DB Spine (`enroll_place`)

```sql
SELECT enroll_place('<slug>', '<Display Name>', '<location_json>'::jsonb, 'enrolling');
```
`project_id = uvojezuorjgqzmhhgluu` REQUIRED on every Supabase MCP call.

### 1.3 Enrollment Epic (`insert_work_item`)

Dup-guard, then create if none exists:
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

```bash
node scripts/onramp-scaffold-place.mjs --slug <slug> --name "<Display Name>" \
  [--archetype <archetype>] [--owner <owner>] [--history]
```

Produces the **6-arc website model** (maps 1:1 to routes):
```
places/<slug>/
  PLACE.md · PRODUCT.md · DESIGN.md · HANDOFF.md
  corpus/INDEX.md
  arc/01-story.md · 02-place.md · 03-foundation.md · 04-process-outcomes.md · 05-investors.md · 06-model.md
  tracker/DECISIONS.md · DELIVERABLES.md · MILESTONES.md · RISKS.md · STAKEHOLDERS.md
```

**Post-scaffold gate:** `_context.md` must be ABSENT.

---

## Phase 2: Research + Document Integration

Research has TWO mandatory sources. Both must be completed before writing arc files.

### 2.1 Web Research

Run 4–6 parallel WebSearch calls covering land, ecology, history, culture, regulatory, finance. Target government databases, heritage registers, peer-reviewed studies.

### 2.2 Incoming Document Integration (MANDATORY)

**⛔ HARD GATE: Every document in the incoming corpus folder MUST be read before arc files are written.**

Locate the incoming corpus folder:
- Check `$CORPUS_ROOT` first (global corpus)
- Check Google Drive: `H:/My Drive/The Place Fund/Incoming/<folder>/`
- Check `places/<slug>/corpus/` for any pre-existing documents

For each document:
1. **PDFs**: Extract text via `pypdf` (`from pypdf import PdfReader`)
2. **Excel/XLSX**: Extract via `openpyxl` or `pandas`
3. **CSV**: Read directly
4. **Word/DOCX**: Convert to MD via pandoc if available, else extract via python-docx
5. **Images**: Catalog for Phase 4 imagery

**What to extract from project documents:**

| Document Type | Extract |
|--------------|---------|
| Business Plan | Mission, pillars, revenue streams, team bios, partners list |
| Pro Forma / Financials | CapEx total, phased investment, revenue projections, cost structure |
| Execution Proposal | Phased timeline (escrow → Phase 1 → Full Buildout), team roles, partner LOIs |
| Development Package | Property details, permits, water rights, hydro specs, marine operations |
| Due Diligence List | Regulatory requirements, title review, environmental assessments |
| Competitor Analysis | Market positioning, pricing, differentiators |

### 2.3 Write Arc Files

Integrate BOTH web research AND document data into the 6 arc files:

| Arc File | Web Research Feeds | Document Data Feeds |
|----------|-------------------|-------------------|
| `01-story.md` | Location context, ecology overview | Mission statement, vision, project pillars |
| `02-place.md` | GIS, ecology, heritage listings | Property specs, hydro details, marine rights |
| `03-foundation.md` | Indigenous territory, conservation context | Team bios, partner network, stewardship model |
| `04-process-outcomes.md` | Competitor landscape, regional context | Revenue streams, programs, phased timeline |
| `05-investors.md` | Market data, comparable properties | CapEx ($107M), existing infrastructure ($15M+), capital structure |
| `06-model.md` | Tax assessments, market comparables | Pro forma, Phase 1 financials, revenue projections |

**Every number in 05-investors and 06-model MUST cite its source document with page reference.** Tier 4 claims tagged `(Illustrative)`.

### 2.4 Document Gate

Before proceeding to Phase 3:
```
DOCUMENT GATE:
  [ ] N/M incoming documents read (list each with filename + page count)
  [ ] Financial model extracted: CapEx, revenue streams, phasing
  [ ] Team and partners extracted
  [ ] Timeline extracted: phases with dates
  [ ] All data integrated into arc files with source citations
```

If any incoming document was NOT read: **STOP and report which ones were skipped and why** (e.g. file format not supported, file too large). Never proceed with unread documents.

---

## Phase 3: Conflict Resolution

Scan all 6 arc files for conflicting facts — especially web research vs document claims (e.g. different acreage figures, conflicting dates, team discrepancies).

Write `places/<slug>/RECONCILIATION.md`. All facts must be `verified`, `resolved`, or `held`.

---

## Phase 4: Brand Book + Imagery

### 4.1 The 24-Page Brand Book (Baru Model)

The brand guide is a **24-page editorial brand book** — like Baru's 23-spread deck at `/brand/index.html`. It is a complete market positioning + communication + content management direction document, NOT a short DESIGN.md stub.

Write `places/<slug>/DESIGN.md` with this outline (each section = 1-2 spreads):

| Spread | Section | Content |
|--------|---------|---------|
| 1 | Cover | Project name + tagline + hero image |
| 2-3 | Story of Place | The narrative — who was here, what happened, what's next |
| 4-5 | Market Position | Competitor landscape, pricing tier, differentiation |
| 6-7 | Audience Segments | Primary + secondary audiences, psychographics |
| 8-9 | Voice + Tone | Register, rhythm, prohibitions, example copy |
| 10-11 | Color Palette | 10-12 tokens derived from ACTUAL place imagery, NOT generic green |
| 12-13 | Typography | Display + body families, hierarchy, specimen |
| 14-15 | Imagery Direction | Photography style, subject matter, treatment, existing imagery catalog |
| 16-17 | Mood + Materiality | Visual register, textures, physical materials, digital materiality |
| 18-19 | Content Architecture | Site map, route-to-arc mapping, content types per route |
| 20-21 | Communications | Social strategy, press approach, stakeholder communications |
| 22 | Token Reference | Full CSS custom property table with hex values |
| 23 | Pattern Reference | Component patterns, animation vocabulary, interaction model |
| 24 | Credits + Colophon | Contributors, sources, version |

### 4.2 Palette Derivation — NO Generic Green

**⛔ NEVER generate a generic dark green palette.** The palette MUST be derived from this specific place:

1. Search online for existing imagery of the project (previous names like "Kermode Park", "White Bear Park", partner websites, location photos)
2. Use RAMPA or image analysis tools to extract dominant colors from the actual place
3. Map colors to the place's identity: the Spirit Bear's white fur, the cannery's corrugated iron rust, the coastal slate, the cedar bark, the glacial water — whatever is SPECIFIC to THIS place
4. Generate the token system from those derived colors

### 4.3 Imagery — Search First, Generate Second

**Before generating ANY imagery with AI:**
1. Search the web for existing non-copyright imagery of the project
   - Search previous names: "Kermode Park Butedale", "White Bear Park BC"
   - Search the location: "Butedale Bay", "Princess Royal Island"
   - Search partners and operators (Spirit Bear Lodge has imagery of the same region)
2. Catalog found images in `IMAGERY-PROMPTS.md` with source URLs and license status
3. Only generate AI imagery for slots that have no real photography available

**Required image slots (minimum):**

| Slot | Aspect | Used in | Prefer real vs AI |
|------|--------|---------|------------------|
| `hero-main` | 16:9 wide | Hero section | REAL (location establishing shot) |
| `place-aerial` | 16:9 wide | /place header | REAL (aerial/drone of Butedale Bay) |
| `ecology-wildlife` | 4:3 | /place ecology | REAL (Spirit Bear, salmon, eagles) |
| `heritage-structure` | 4:3 | /foundation | REAL (cannery buildings, Pelton wheels) |
| `programs-activity` | 1:1 | /regeneration | AI OK (future programs concept) |
| `og-image` | 1200x630 | Social share | Composite from real + designed |

### 4.4 Image Generation via Codex

For slots needing AI imagery, write prompts in `IMAGERY-PROMPTS.md` that specify:
- Scene description specific to THIS place
- Lighting/weather matching the Mood (NOT golden hour unless the place warrants it)
- Color temperature matching the derived palette
- Composition for the target slot aspect ratio

Send to Codex for generation. Codex iterates until the image meets DESIGN.md criteria.

### 4.5 Brand Gate

If `--no-gate` is NOT set: stop and report. Re-invoke with `--skip-to 5`.

---

## Phase 5: Regen Score

Score dimensions from BOTH web research AND document evidence.

| Dimension | Key | Scoring Basis |
|-----------|-----|---------------|
| Owner / Steward | `owner` | Title clarity, team credentials, FPIC status |
| Project / Place | `place` | Archetype fit, ecology verified, heritage listed |
| Finance Model | `model` | CapEx defined, revenue streams documented, pro forma exists |
| Approach | `approach` | Integrative intent, partner LOIs, governance model |
| Timeline | `timeline` | Phases with dates, milestones defined, corpus complete |

**Composite:** unweighted mean of all 5, rounded. GO ≥75 / NEEDS WORK 55-74 / NO-GO <55.

---

## Phase 6: Site Build

Create `apps/<slug>/` following the Baru model (`apps/baru-website/`).

### App Structure

- 6+1 routes: `/`, `/place`, `/foundation`, `/regeneration`, `/investors`, `/financial-model`, `/brand-guide` (dev-only)
- Section components with REAL content from arc files — not placeholder text
- Financial model page with ACTUAL numbers from the pro forma (tagged Illustrative where Tier 4)
- Phased timeline with ACTUAL dates from the execution proposal
- Team and partners from the business plan
- Real imagery from Phase 4 (not placeholder gradients)

### Build + Commit Discipline

1. `pnpm --filter @regen/<slug> install`
2. `npx tsc --noEmit` — must pass
3. `pnpm --filter @regen/<slug> build` — must produce all routes
4. Commit: infra (lockfile) first with `RDC-Bypass:`, then product with `Work-Item:`

---

## Phase 7: Deploy Dev

### 7.1 Registry Setup

```sql
-- 1. apps table (parent)
INSERT INTO apps (slug, display_name, description, monorepo_path, github_org,
  github_repo, runtime, owner_slug, status, pnpm_filter) VALUES (...);

-- 2. app_deployments (child — FK on app_slug)
-- Environment enum: 'dev' (NOT 'development')
-- Port: query max(pm2_port) + 1 from app_deployments
INSERT INTO app_deployments (app_slug, environment, host_type, url,
  pm2_name, pm2_port, branch, build_command, status) VALUES (...);
```

### 7.2 Deploy to Vultr PM2

```bash
export CI=true
git fetch -q origin develop && git reset -q --hard origin/develop
pnpm --filter @regen/<slug> install --frozen-lockfile
pnpm --filter @regen/<slug> build
node scripts/generate-dev-configs.mjs --write   # --write flag REQUIRED
pm2 start /srv/regen/ecosystem.config.js --only <slug>  # .js not .cjs
```

### 7.3 Verify

- `curl -s https://<slug>.dev.place.fund/` → HTTP 200 + correct `<title>`
- All routes return 200
- Content spot-check: financial figures match arc files

---

## Resumability

| Phase | Skip condition |
|-------|---------------|
| 1 — Enrollment | DB row + disk tree + epic all exist |
| 2 — Research | All 6 arc files have substantive content AND document gate passed |
| 3 — Conflicts | RECONCILIATION.md exists, all facts verified/resolved/held |
| 4 — Brand | DESIGN.md has full 24-spread outline + imagery placed |
| 5 — Score | Score computed in HANDOFF.md |
| 6 — Build | `apps/<slug>/` exists and builds cleanly |
| 7 — Deploy Dev | `<slug>.dev.place.fund` returns HTTP 200 |

---

## Rules

- `enroll_place` is the ONLY door for spine rows
- `insert_work_item` is the ONLY door for work items
- `_context.md` must be ABSENT after scaffolding
- disk-ahead → STOP, never proceed
- **Every incoming document MUST be read** — no unread docs allowed past Phase 2
- **Every financial number MUST cite its source document** — no invented figures
- **Palette MUST be derived from actual place imagery** — no generic dark green
- **Search for existing project imagery BEFORE generating AI images**
- Source tiers: 0=Recorded legal, 1=Government, 2=Independent, 3=Project upload, 4=Stakeholder claim
- Tier 4 claims tagged `(Illustrative)` on all public surfaces
- Split infra (lockfile) and product commits — scope guard enforces this
- Under `RDC_TEST=1`: DB writes, web searches, builds, and deploys short-circuit

## Capture Lessons

Before the final verdict, follow `.rdc/guides/lessons-learned-spec.md`. Write `.rdc/lessons/<YYYY-MM-DD>-onramp-<slug>.md` if the run taught something non-obvious.
