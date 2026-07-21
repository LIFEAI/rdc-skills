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
| `--archetype` | **yes** (fresh) | — | Required on fresh enrollment — reject if absent. See `corpus/_shared/onramp/ARCHETYPES.md`. Valid: `land-regen`, `data-center`, `urban-renewal`, or custom slug. |
| `--owner` | no | `place-fund` | `place-fund` \| `rdc` \| `jv` \| `client` |
| `--history` | no | off | Scaffold `places/<slug>/HISTORY.md`. |
| `--dry-run` | no | off | Resolve drift + print plan; no writes. |
| `--skip-to` | no | — | Jump to a specific phase (1–7). |
| `--no-gate` | no | off | Skip human gates (brand review). |

## Master Checklist

```
rdc:onramp <slug> — full pipeline
Phase 1: Enrollment + RPMS Infrastructure Setup
  [ ] Preflight — validate slug + --name + --archetype (required on fresh); parse flags
  [ ] Resolve drift — classify: fresh | already-enrolled | spine-ahead | disk-ahead
  [ ] DB spine — enroll_place RPC → capture project_node_id
  [ ] DB spine completeness — project_nodes, project_places, prt_projects, regen_projects, place_phase_state
  [ ] Archetype stored — places.metadata.archetype set (not TBD)
  [ ] Enrollment epic — dup-guard + insert_work_item
  [ ] Disk tree — scaffold places/<slug>/ with ALL required files
  [ ] Directory verification — PLACE.md, PRODUCT.md, DESIGN.md, HANDOFF.md, RECONCILIATION.md, SCREENING.md, PROCESS-ARC.md, INTAKE-LOG.md, ONRAMP-REPORT.md, corpus/INDEX.md, arc/01-06, tracker/*
  [ ] Corpus setup — places.corpus_path set, $CORPUS_ROOT dir exists
  [ ] Process-state arc selection — PROCESS-ARC.md written (25 states, per-archetype)
  [ ] Screening stub — SCREENING.md written
  [ ] _context.md absence gate
  [ ] Phase 1 rubric gate — 15-row pass/fail table printed + ONRAMP-REPORT.md appended
Phase 2: Research — Full Regenerative Regional Deep Research
  [ ] Research prompts — load archetype template from corpus/_shared/onramp/research-prompts/
  [ ] Web research — structured per Five Capitals (Natural, Human, Social, Built, Financial)
  [ ] Read ALL incoming corpus documents ($CORPUS_ROOT/<corpus_path>/)
  [ ] Financial model — extract from docs OR construct from analysis (Tier 4, tagged)
  [ ] Integrate web + document data into 6 arc files (research layer)
  [ ] PRODUCT.md route registry — archetype-specific website routes (NOT fixed 6-arc)
  [ ] PLACE.md compiled from findings
  [ ] corpus/INDEX.md — all sources with tier + capital + arc file
  [ ] DOCUMENT GATE: every incoming doc read — no unread documents allowed
  [ ] Phase 2 rubric gate — 14-row pass/fail + ONRAMP-REPORT.md appended
Phase 2b: People, Organizations & Place Enrichment
  [ ] Extract all named people + organizations from project documents
  [ ] RocketReach lookup on each person + org — verify existence
  [ ] Write verified entities to tracker/STAKEHOLDERS.md (>10 lines floor)
  [ ] Flag unverified entities in RECONCILIATION.md
Phase 3: Conflict Resolution
  [ ] Cross-source verification — web vs document claims explicitly compared
  [ ] RECONCILIATION.md written — all facts verified | resolved | held
  [ ] Zero conflicted/unverified facts remaining
  [ ] Phase 3 rubric gate — 7-row pass/fail + ONRAMP-REPORT.md appended
Phase 4: Brand Book + Imagery — Full rdc:design Integration
  [ ] Invoke rdc:design with DESIGN.md brief + PRODUCT.md route registry
  [ ] DESIGN.md — 24-spread editorial brand book (not a stub)
  [ ] Palette — full Studio tokens (--<slug>-*) via RAMPA from ACTUAL place imagery
  [ ] Palette source proof — image filename(s) logged in DESIGN.md
  [ ] IMAGERY-PROMPTS.md — all slots declared; real search before AI gen
  [ ] Generate images via regen-media MCP or OpenAI local gpt-image-2
  [ ] Place images in apps/<slug>/public/images/ + wire imagery.ts
  [ ] Brand review gate (skip if --no-gate)
  [ ] Phase 4 rubric gate — 9-row pass/fail + ONRAMP-REPORT.md appended
Phase 5: Regen Score — Fit Function + Per-Model Benchmarks
  [ ] Load archetype benchmark set from corpus/_shared/onramp/benchmarks/
  [ ] 5 dimensions scored with evidence citation (arc file + source tier)
  [ ] Composite computed — GO ≥75 | NEEDS WORK 55-74 | NO-GO <55
  [ ] Process-state cross-check — no CORE state missing
  [ ] Score gate: composite ≥75 to proceed
  [ ] Phase 5 rubric gate — 6-row pass/fail + ONRAMP-REPORT.md appended
Phase 6: Site Build — Archetype Routes + RegenOps Integration
  [ ] Create apps/<slug>/ — archetype-specific routes from PRODUCT.md
  [ ] HISTORY as its own route (sourced from HISTORY.md, not folded into arc)
  [ ] All routes render real arc content + imagery (no placeholders)
  [ ] Image/video slots from IMAGERY-PROMPTS.md have placeholder components
  [ ] tsc clean, build clean
  [ ] PUBLISH.md + DEPLOY block generated
  [ ] RegenOps screens — report present/missing (advisory)
  [ ] Phase 6 rubric gate — 10-row pass/fail + ONRAMP-REPORT.md appended
Phase 7: Deploy Dev — Phase State + Epic Closure
  [ ] Register in apps + app_deployments (allocate next free port)
  [ ] Regenerate PM2 ecosystem config on Vultr (--write flag)
  [ ] PM2 start + HTTP 200 at <slug>.dev.place.fund
  [ ] place_phase_state advanced to phase 7, gate=passed
  [ ] Epic: implementation report submitted, transitioned to review
  [ ] INTAKE-LOG.md — all 7 phase rows present
  [ ] ONRAMP-REPORT.md — all 7 phase sections present
  [ ] Phase 7 rubric gate — 9-row pass/fail (final)
```

**Prod promotion is NOT part of onramp.** Once Phase 7 completes, the pipeline
is done. To promote to production later: `rdc:deploy <slug> promote`.

---

## INTAKE-LOG.md — Transaction Log

Every onramp run writes a timestamped transaction log at `places/<slug>/INTAKE-LOG.md`.
Each phase records its timestamp, operator, session ID, and notes. Intake #2+ appends
rows — the skill detects a prior intake and runs as an update (re-reads documents,
re-scores, rebuilds changed content).

```markdown
| # | Phase | Timestamp | Operator | Session | Notes |
|---|-------|-----------|----------|---------|-------|
| 1 | Enrollment | 2026-07-20T07:11Z | claude-5 | abc123 | fresh state |
| 1 | Research | 2026-07-20T07:20Z | claude-5 | abc123 | 14 web + 18 docs |
| 1 | People/Org | ... | ... | ... | N verified |
| 1 | Conflicts | ... | ... | ... | 2 resolved |
| 1 | Brand | ... | ... | ... | palette derived |
| 1 | Score | ... | ... | ... | composite 67 |
| 1 | Build | ... | ... | ... | tsc 0, build 0 |
| 1 | Deploy Dev | ... | ... | ... | HTTP 200 |
```

---

## Phase 1: Enrollment + RPMS Infrastructure Setup

### 1.0 Preflight

Validate before any external call:
- `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$` — reject if not
- `--name` is present and non-empty — reject if not
- `--archetype` is present and not `TBD` — **reject if not provided on fresh enrollment**
  (valid values: `land-regen`, `data-center`, `urban-renewal`, or a custom slug
  matching `^[a-z0-9]+(-[a-z0-9]+)*$`)
- `--dry-run` set → print plan and exit after drift resolution + rubric, no writes

### 1.1 Resolve Drift State

Read-only DB probe:
```sql
SELECT id, slug, name, status, corpus_path, metadata FROM places WHERE slug = '<slug>';
```

Check disk:
```bash
test -d "places/<slug>/" && echo "disk:present" || echo "disk:absent"
```

| State | Detection | Action |
|-------|-----------|--------|
| **fresh** | No DB row AND no disk dir | Run all enrollment steps |
| **already-enrolled** | DB row exists AND disk dir exists | Run verification rubric; fix gaps; continue to Phase 2. |
| **spine-ahead** | DB row exists, disk dir ABSENT | Run scaffolder; then verification rubric |
| **disk-ahead** | Disk dir exists, NO DB row | **⛔ STOP.** Open reconciliation work item; exit. |

### 1.2 DB Spine (`enroll_place`)

```sql
SELECT enroll_place('<slug>', '<Display Name>', '<location_json>'::jsonb, 'enrolling');
```
`project_id = uvojezuorjgqzmhhgluu` REQUIRED on every Supabase MCP call.

**GATE:** Capture `project_node_id` from the returned JSONB. If absent → BLOCKED template, stop.

### 1.3 DB Spine Completeness (NEW)

After `enroll_place`, verify ALL required DB rows exist — not just the `places` row:

```sql
-- project_nodes row
SELECT id, slug, node_type FROM project_nodes WHERE slug = 'prtnode-<slug>';

-- project_places join
SELECT * FROM project_places WHERE place_id = '<places.id>'::uuid;

-- prt_projects row (drives HISTORY.md gate)
SELECT id, slug, project_type FROM prt_projects WHERE slug = '<slug>';

-- regen_projects row (work_items FK)
SELECT id, slug FROM regen_projects WHERE slug ILIKE '%<slug>%';

-- place_phase_state
SELECT * FROM place_phase_state WHERE place_slug = '<slug>';
```

**Fix missing rows:**
- `prt_projects` absent → create via RPC or flag as a required manual step
- `regen_projects` absent → create (needed for epic's `project_id` FK)
- `place_phase_state` stuck at phase 0 with gate `open` on a re-run → leave as-is
  (phase advancement happens at end of each subsequent phase)
- Archetype → store in `places.metadata` as `{"archetype": "<value>"}`:
  ```sql
  UPDATE places SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{archetype}', '"<archetype>"')
  WHERE slug = '<slug>';
  ```

### 1.4 Enrollment Epic (`insert_work_item`)

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

### 1.5 Disk Tree + Directory Verification

```bash
node scripts/onramp-scaffold-place.mjs --slug <slug> --name "<Display Name>" \
  [--archetype <archetype>] [--owner <owner>] [--history]
```

After scaffold, verify the **full RPMS-compliant tree** — not just "disk present":
```
places/<slug>/
  PLACE.md              — authored identity (One Home)
  PRODUCT.md            — route registry + model definition (archetype-specific routes)
  DESIGN.md             — brand brief (input to rdc:design)
  HANDOFF.md            — build contract
  RECONCILIATION.md     — conflict ledger
  SCREENING.md          — mission fit + RCL eligibility (NEW)
  PROCESS-ARC.md        — 25-state selection matrix for this land type (NEW)
  INTAKE-LOG.md         — transaction log (NEW)
  ONRAMP-REPORT.md      — per-phase accumulating report (NEW)
  corpus/INDEX.md       — source index
  corpus/               — source documents
  arc/01-story.md · 02-place.md · 03-foundation.md · 04-process-outcomes.md · 05-investors.md · 06-model.md
  tracker/DECISIONS.md · DELIVERABLES.md · MILESTONES.md · RISKS.md · STAKEHOLDERS.md
```

If the scaffolder does not create `SCREENING.md`, `PROCESS-ARC.md`, `INTAKE-LOG.md`,
or `ONRAMP-REPORT.md`, the skill writes them directly (stub templates).

**Post-scaffold gate:** `_context.md` must be ABSENT.

### 1.6 Corpus Setup (NEW)

- Set `places.corpus_path` in DB:
  ```sql
  UPDATE places SET corpus_path = 'TPF/<slug>' WHERE slug = '<slug>' AND corpus_path IS NULL;
  ```
  (Adjust the prefix per project — `TPF/` for Place Fund, `RDC/` for internal, etc.)
- Verify or create the corpus directory at `$CORPUS_ROOT/<corpus_path>/`
- Wire `places/<slug>/corpus/INDEX.md` header to reference the global corpus path

### 1.7 Process-State Arc Selection (NEW)

Write `places/<slug>/PROCESS-ARC.md` — the model definition.
Read the land-type selection matrix from `$CORPUS_ROOT/VLAS/plans/03-process-states.md` §5
and produce a table for THIS place:

```markdown
# <Display Name> — Process-State Arc Selection
> Archetype: <archetype> | Generated: <date>
> Canon: VLAS/plans/03-process-states.md §5

| State | Name | Class | Selection | Reason |
|-------|------|-------|-----------|--------|
| S00 | Inquiry | CORE | required | — |
| S01 | Screening | CORE | required | — |
| S02 | Regional Read | CORE | required | — |
| S03 | Stakeholder Convening | CORE | required | — |
| S04 | FPIC | CORE — ANNIHILATOR | required | S→0 if unmet |
| S05 | Asset Entry | CONDITIONAL | S05a LRLT | land-regen: trust entry |
| ... | ... | ... | ... | ... |
| S11 | Stewardship Active | CONDITIONAL | required | land-regen: enterprise models live here |
| S15 | Capital Formation | CONDITIONAL | required | land-regen: PRT/Place Fund raise |
| ... through S24 ... |
```

Every `not-applicable` entry MUST carry a reason. A dropped state without a stated
reason is a defect, not a design (03 §5 rule).

### 1.8 Screening Stub (NEW)

Write `places/<slug>/SCREENING.md` if absent:
```markdown
# <Display Name> — Screening (S01)
> Status: pending | Date: <date>

## Mission Fit
<!-- TODO: assess alignment with regenerative mission -->

## RCL Eligibility
- Filter 1 (entity form): <!-- TODO -->
- Filter 2 (field of use): <!-- TODO -->

## Red Lines
<!-- TODO: identify any hard stops (e.g. FPIC not obtainable) -->

## Decision
<!-- screening-pass | screening-decline (with reason) -->
```

### 1.9 Phase 1 Rubric Gate

Print this table with actual values filled in. **A FAIL on any row stops the phase.**

```
PHASE 1 RUBRIC — <slug>
| # | Check                    | Expected                          | Actual | Pass |
|---|--------------------------|-----------------------------------|--------|------|
| 1 | places row               | status=enrolling, corpus_path set | ?      |      |
| 2 | project_nodes row        | prtnode-<slug> exists             | ?      |      |
| 3 | project_places join      | links place to node               | ?      |      |
| 4 | prt_projects row         | project_type set (not null)       | ?      |      |
| 5 | regen_projects row       | exists (work_items FK)            | ?      |      |
| 6 | place_phase_state        | row exists, initialized           | ?      |      |
| 7 | archetype in metadata    | not TBD, matches --archetype      | ?      |      |
| 8 | epic                     | exists, not archived              | ?      |      |
| 9 | disk: places/<slug>/     | exists with all required files    | ?      |      |
| 10| disk: PROCESS-ARC.md     | state selection matrix, >20 rows  | ?      |      |
| 11| disk: SCREENING.md       | exists (stub OK for Phase 1)      | ?      |      |
| 12| disk: INTAKE-LOG.md      | exists, Phase 1 row written       | ?      |      |
| 13| disk: ONRAMP-REPORT.md   | exists, Phase 1 section written   | ?      |      |
| 14| corpus: $CORPUS_ROOT dir | dir exists or created             | ?      |      |
| 15| _context.md              | ABSENT                            | ?      |      |
```

Append Phase 1 results to `places/<slug>/ONRAMP-REPORT.md`:
```markdown
## Phase 1: Enrollment — <date>
### Drift state: <fresh|already-enrolled|spine-ahead>
### DB spine: places ✅ | project_nodes ✅ | project_places ✅ | prt_projects ⚠️ | regen_projects ✅
### Archetype: <archetype>
### Disk tree: N files created, M skipped (existing)
### Rubric: [full table above, filled in]
```

Append Phase 1 row to `places/<slug>/INTAKE-LOG.md`.

---

## Phase 2: Research — Full Regenerative Regional Deep Research

Research has THREE layers. All must complete before writing arc files.

### 2.1 Research Prompt Engineering — Stored with the Model

Each archetype has a **research prompt template** at
`corpus/_shared/onramp/research-prompts/<archetype>.md`. The template structures a
full Five Capitals regional deep research:

| Capital   | Research areas                                                        | Min sources |
|-----------|-----------------------------------------------------------------------|-------------|
| Natural   | Ecoregion, soils (SSURGO), hydrology, vegetation (NVC), wildlife,     | 3 Tier 0-2  |
|           | climate band, watershed, marine/tidal, habitat connectivity           |             |
| Human     | Indigenous territory, FPIC holders, community demographics,           | 2 Tier 0-2  |
|           | health/education infrastructure, cultural heritage (NHPA)             |             |
| Social    | Governance structure, co-governance pathway, community orgs,          | 2 Tier 0-2  |
|           | First Nations relationships, stakeholder network                      |             |
| Built     | Existing infrastructure, permitted structures, heritage listings,     | 2 Tier 0-2  |
|           | grid/energy, transport, marine access, communications                 |             |
| Financial | Title chain, encumbrances, easements, tax status, water rights,       | 2 Tier 0-2  |
|           | zoning, indicative raise, capital structure, comparable sales         |             |

If the template does not exist for this archetype, the skill writes a default based on
the Five Capitals table above and flags it in ONRAMP-REPORT.md.

Run structured WebSearch calls per capital (not generic 4-6 searches). Target government
databases, heritage registers, peer-reviewed studies. Use the web-research MCP for
deep research or built-in WebSearch for targeted queries.

### 2.2 Incoming Document Integration (MANDATORY)

**⛔ HARD GATE: Every document in the incoming corpus folder MUST be read before arc files are written.**

Locate the incoming corpus folder:
- Check `$CORPUS_ROOT/<corpus_path>/` first (set in Phase 1)
- Check Google Drive incoming folder
- Check `places/<slug>/corpus/` for pre-existing documents

For each document:
1. **PDFs**: Extract text via `pypdf` (`from pypdf import PdfReader`)
2. **Excel/XLSX**: Extract via `openpyxl` or `pandas`
3. **CSV**: Read directly
4. **Word/DOCX**: Convert to MD via `rdc:convert` or pandoc
5. **Images**: Catalog for Phase 4 imagery

**What to extract from project documents:**

| Document Type | Extract |
|--------------|---------|
| Business Plan | Mission, pillars, revenue streams, team bios, partners list |
| Pro Forma / Financials | CapEx total, phased investment, revenue projections, cost structure |
| Execution Proposal | Phased timeline, team roles, partner LOIs |
| Development Package | Property details, permits, water rights, infrastructure specs |
| Due Diligence List | Regulatory requirements, title review, environmental assessments |
| Competitor Analysis | Market positioning, pricing, differentiators |

### 2.3 Financial Model — Invent if Absent

If no financial model is provided in incoming documents:
1. **Analyze**: comparable properties/projects in the region, infrastructure replacement
   value, land value from tax assessments, revenue potential from archetype-typical
   enterprise models (VLAS doc 04 §7 — the 14 stewardship enterprises × primary capital)
2. **Build** an illustrative Tier-4 financial model: CapEx estimate, phased investment,
   revenue streams, cost structure, pro forma projection
3. **Tag EVERY figure** `(Illustrative — constructed from analysis, no project-supplied source)`
4. Write to `arc/06-model.md` with full methodology disclosure
5. Flag in ONRAMP-REPORT.md: `Financial model constructed from analysis — no incoming financials`

Use the financial model analysis template at `corpus/_shared/onramp/financial-model-template.md`
if available.

### 2.4 Write Arc Files (Research Layer)

The 6 arc files are the **research corpus** — organized by Five Capitals:

| Arc file              | Primary capital(s) | Research feeds                         |
|-----------------------|--------------------|----------------------------------------|
| `01-story.md`         | narrative spine    | Place identity + vision + mission      |
| `02-place.md`         | Natural, Built     | Ecoregion + infrastructure + heritage  |
| `03-foundation.md`    | Human, Social      | People + governance + FPIC context     |
| `04-process-outcomes.md`| Social, Built    | Programs + stewardship + enterprise models |
| `05-investors.md`     | Financial          | Capital structure + raise + title chain |
| `06-model.md`         | Financial          | Pro forma + revenue (supplied or constructed) |

**Every number in 05 and 06 MUST cite its source document with page reference.**
Tier 4 claims tagged `(Illustrative)`.

### 2.5 Website Route Registry — Archetype-Specific (NOT Fixed 6-Arc)

The arc files are research. The **website routes are a separate artifact** defined in
`places/<slug>/PRODUCT.md`, derived from the archetype's telling
(VLAS doc 02 — the six movements).

Each archetype has a route template at `corpus/_shared/onramp/routes/<archetype>.md`.
Different archetypes produce different site structures:

- **land-regen** routes: `/`, `/place`, `/story`, `/foundation`, `/stewardship`,
  `/invest`, `/history`, `/model`
- **data-center** routes: `/`, `/place-writes-the-spec`, `/library`, `/pathway`,
  `/civic-compute`, `/resources`
- **HISTORY** is always its own route/artifact (sourced from `HISTORY.md`),
  never folded into the generic 6-arc

`PRODUCT.md` declares: `route → arc-file(s) → content mapping → archetype`

If the route template does not exist, the skill writes a default land-regen route set
and flags it in ONRAMP-REPORT.md.

### 2.6 Source Tier Tracking

Every source gets a row in `corpus/INDEX.md`:
`| source | tier | capital | arc file | date accessed |`

### 2.7 Document Gate

Before proceeding to Phase 2b:
```
DOCUMENT GATE:
  [ ] N/M incoming documents read (list each with filename + page count)
  [ ] Financial model: supplied | constructed from analysis
  [ ] Team and partners extracted
  [ ] Timeline extracted: phases with dates
  [ ] All data integrated into arc files with source citations
  [ ] PRODUCT.md route registry written (archetype-specific)
```

If any incoming document was NOT read: **STOP and report which ones were skipped and why.**

### 2.8 Phase 2 Rubric Gate

```
PHASE 2 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | Natural capital sources        | >= 3 Tier 0-2                         | ?      |      |
| 2 | Human capital sources          | >= 2 Tier 0-2                         | ?      |      |
| 3 | Social capital sources         | >= 2 Tier 0-2                         | ?      |      |
| 4 | Built capital sources          | >= 2 Tier 0-2                         | ?      |      |
| 5 | Financial capital sources      | >= 2 Tier 0-2                         | ?      |      |
| 6 | All incoming docs read         | 0 unread                              | ?      |      |
| 7 | corpus/INDEX.md                | all sources with tier + capital        | ?      |      |
| 8 | arc/01-06 each > 40 lines      | substantive content, not stubs        | ?      |      |
| 9 | Every number in 05/06 cited    | source:page reference present         | ?      |      |
| 10| Tier 4 claims tagged           | (Illustrative) on all                 | ?      |      |
| 11| Financial model                | supplied or constructed + disclosed    | ?      |      |
| 12| PRODUCT.md route registry      | archetype-specific routes declared    | ?      |      |
| 13| places.corpus_path             | set in DB                             | ?      |      |
| 14| HISTORY.md                     | exists if prt_projects.project_type qualifies | ? |      |
```

Append Phase 2 results to `places/<slug>/ONRAMP-REPORT.md`:
```markdown
## Phase 2: Research — <date>
### Sources: N total (Tier 0: X, Tier 1: Y, Tier 2: Z, Tier 3: A, Tier 4: B)
### Per-capital: Natural ✅|⚠️ | Human ✅|⚠️ | Social ✅|⚠️ | Built ✅|⚠️ | Financial ✅|⚠️
### Financial model: supplied | constructed from analysis
### Documents read: N of M incoming
### Route registry: <archetype> — N routes declared
### Gaps: [list any research areas with insufficient sourcing]
### Rubric: [full table above, filled in]
```

Append Phase 2 row to INTAKE-LOG.md.

---

## Phase 2b: People, Organizations & Place Enrichment

After research, before conflict analysis. Enrich and verify all named entities.

### Procedure

1. **Extract** all named people from project documents (team, partners, advisors, stakeholders, First Nations contacts)
2. **Extract** all named organizations (partners, contractors, First Nations, government bodies, technology providers)
3. **RocketReach person lookup** on each person — verify existence, current title, LinkedIn, email. Use `mcp__claude_ai_RocketReach__rocketreach_lookup_person` or `rocketreach_search_people`.
4. **RocketReach company lookup** on each org — verify existence, size, domain. Use `mcp__claude_ai_RocketReach__rocketreach_lookup_company`.
5. **Write** verified entity data to `places/<slug>/tracker/STAKEHOLDERS.md`:
   - People: name, title, org, LinkedIn, verification status
   - Orgs: name, domain, size, relationship to project, verification status
6. **Flag** unverified entities (RocketReach returned nothing) in RECONCILIATION.md
7. **Record** entity count in INTAKE-LOG.md

**Content floor:** STAKEHOLDERS.md must have >10 lines of substantive content (not a 3-line
stub with just a header). If fewer than 10 lines after enrichment, the rubric FAILs.

Under `RDC_TEST=1`: skip RocketReach lookups; write placeholder STAKEHOLDERS.md.

Append Phase 2b row to INTAKE-LOG.md + ONRAMP-REPORT.md.

---

## Phase 3: Conflict Resolution

Scan all 6 arc files for conflicting facts — especially **web research vs document claims**
(e.g. different acreage figures, conflicting dates, team discrepancies).

### 3.1 Cross-Source Verification

For each factual claim in arc files, explicitly compare:
- Web sources (Tier 0-2) vs document sources (Tier 3-4)
- Log each comparison in RECONCILIATION.md with both sources cited

### 3.2 Write RECONCILIATION.md

All facts must be one of: `verified`, `resolved`, or `held`. Zero `conflicted` or
`unverified` facts may remain.

### 3.3 Phase 3 Rubric Gate

```
PHASE 3 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | All facts reviewed             | every arc file scanned                | ?      |      |
| 2 | Web vs doc comparisons         | explicitly logged per claim            | ?      |      |
| 3 | Zero conflicted facts          | 0 remaining                           | ?      |      |
| 4 | Zero unverified facts          | 0 remaining                           | ?      |      |
| 5 | Held facts listed              | each with reason + escalation path    | ?      |      |
| 6 | STAKEHOLDERS.md                | >10 lines substantive content         | ?      |      |
| 7 | Unverified entities flagged    | in RECONCILIATION.md                  | ?      |      |
```

Append Phase 3 results to ONRAMP-REPORT.md + INTAKE-LOG.md.

---

## Phase 4: Brand Book + Imagery — Full rdc:design Integration

Phase 4 **invokes `rdc:design`** — it does not duplicate design work. The skill prepares
inputs (DESIGN.md brief + PRODUCT.md route registry from Phases 2/3) and calls `rdc:design`
which produces the full brand system.

### 4.1 Inputs to rdc:design

- `places/<slug>/DESIGN.md` — the brief (identity, voice, audience, mood — written in Phase 2)
- `places/<slug>/PRODUCT.md` — route registry, content map, site IA (archetype-specific)
- `places/<slug>/arc/01-story.md` — narrative spine (Story of Place)

### 4.2 The 24-Page Brand Book (Baru Model)

`rdc:design` writes/updates `places/<slug>/DESIGN.md` as a **24-page editorial brand book**:

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

### 4.3 Palette — Full Studio Tokens via RAMPA

**⛔ NEVER generate a generic dark green palette.**

1. Search online for existing imagery of the project (previous names, partner sites, location photos)
2. Use RAMPA or image analysis tools to extract dominant colors from ACTUAL place imagery
3. Map colors to the place's identity — whatever is SPECIFIC to THIS place
4. Generate the full token system:
   - **Studio tokens** — CSS custom properties in the `--<slug>-*` namespace
   - **Color system** — primary, secondary, accent, neutral, semantic mapped to Five Capitals
5. Log which image(s) the palette was derived from (source proof in DESIGN.md)

### 4.4 Imagery — Search First, Generate Second, regen-media Pipeline

**Before generating ANY imagery with AI:**
1. Search the web for existing non-copyright imagery of the project
2. Catalog found images in `IMAGERY-PROMPTS.md` with source URLs and license status
3. Only generate AI imagery for slots that have no real photography available

**Required image slots (minimum per archetype — adjust per PRODUCT.md route set):**

| Slot | Aspect | Used in | Prefer real vs AI |
|------|--------|---------|------------------|
| `hero-main` | 16:9 wide | Hero section | REAL |
| `place-aerial` | 16:9 wide | /place header | REAL |
| `ecology-wildlife` | 4:3 | /place ecology | REAL |
| `heritage-structure` | 4:3 | /foundation or /story | REAL |
| `programs-activity` | 1:1 | /stewardship or /regeneration | AI OK |
| `og-image` | 1200x630 | Social share | Composite |

**Generation pipeline:**
- AI imagery: generate via regen-media MCP (`mcp__regen-media__generate_flux` or
  `generate_midjourney`) or OpenAI local (`gpt-image-2` via Codex built-in `image_gen`)
- Video placeholders: declare slots in IMAGERY-PROMPTS.md even if content isn't ready
- Place images in `apps/<slug>/public/images/` + wire `imagery.ts`
- Verify all `<Image>` src imports resolve after build

### 4.5 Brand Gate

If `--no-gate` is NOT set: stop and report. Re-invoke with `--skip-to 5`.

### 4.6 Phase 4 Rubric Gate

```
PHASE 4 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | DESIGN.md                      | 24-spread outline, not a stub         | ?      |      |
| 2 | Palette source                 | derived from THIS place's imagery     | ?      |      |
| 3 | Palette source proof           | image filename(s) logged in DESIGN.md | ?      |      |
| 4 | Studio tokens                  | --<slug>-* CSS properties defined     | ?      |      |
| 5 | IMAGERY-PROMPTS.md             | all slots declared with aspect+mood   | ?      |      |
| 6 | Image slots filled             | hero, aerial, ecology, heritage min   | ?      |      |
| 7 | Image sources                  | real search done before AI gen        | ?      |      |
| 8 | No generic dark green          | palette specific to THIS place        | ?      |      |
| 9 | Brand review gate              | passed (or --no-gate)                 | ?      |      |
```

Append Phase 4 results to ONRAMP-REPORT.md + INTAKE-LOG.md.

---

## Phase 5: Regen Score — Fit Function + Per-Model Benchmarks

### 5.1 Per-Model Benchmark Set

Each archetype has its own benchmark set at `corpus/_shared/onramp/benchmarks/<archetype>.md`
or wired to the benchmarking system (`docs/systems/regenops/BENCHMARKING.md`).

Each benchmark: dimension, metric, threshold, weight, source.
The fit function: takes the place's evidence, scores each benchmark, computes composite.
Links to the VLAS benchmark registry (epic `4e6e6084`) when available.

If the benchmark set does not exist for this archetype, the skill writes a default
based on the 5-dimension scoring table below and flags it.

### 5.2 Score Dimensions — Evidence-Cited

| Dimension | Key | Scoring Basis | Evidence required |
|-----------|-----|---------------|-------------------|
| Owner / Steward | `owner` | Title clarity, team credentials, FPIC status | arc/03 + STAKEHOLDERS.md + source tier |
| Project / Place | `place` | Archetype fit, ecology verified, heritage listed | arc/02 + corpus/INDEX.md + source tier |
| Finance Model | `model` | CapEx defined, revenue streams documented, pro forma | arc/05 + arc/06 + source tier |
| Approach | `approach` | Integrative intent, partner LOIs, governance model | arc/04 + PROCESS-ARC.md + source tier |
| Timeline | `timeline` | Phases with dates, milestones defined, corpus complete | PRODUCT.md + tracker/* + source tier |

**Each score MUST cite:** which arc file, which source (tier), what evidence justifies the
number. No bare scores.

**Composite:** unweighted mean of all 5, rounded. GO ≥75 / NEEDS WORK 55-74 / NO-GO <55.

### 5.3 Process-State Gate Cross-Check

The score gate also verifies which process states (from PROCESS-ARC.md) have been
completed vs required. **A composite ≥75 with a CORE state missing is invalid.**

### 5.4 Phase 5 Rubric Gate

```
PHASE 5 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | All 5 dimensions scored        | 0-100 each with evidence citation     | ?      |      |
| 2 | Composite >= 75                | GO                                    | ?      |      |
| 3 | Per-dimension evidence         | arc file + source tier cited each     | ?      |      |
| 4 | Model benchmarks applied       | archetype-specific benchmark set      | ?      |      |
| 5 | Process-state cross-check      | no CORE state missing                 | ?      |      |
| 6 | Tier 4 claims not inflating    | illustrative figs not scored as verified | ?   |      |
```

Append Phase 5 results to ONRAMP-REPORT.md + INTAKE-LOG.md.

---

## Phase 6: Site Build — Archetype Routes + RegenOps Integration

### 6.1 App Structure — Archetype-Specific Routes

Create `apps/<slug>/` following the Baru model (`apps/baru-website/`) but with
**archetype-specific routes** from `PRODUCT.md` (not a fixed 6+1).

- Routes declared in `PRODUCT.md` route registry (Phase 2.5)
- HISTORY is always its own route (sourced from `HISTORY.md`), never folded into the arc
- Section components with REAL content from arc files — not placeholder text
- Financial model page with ACTUAL numbers from the pro forma (tagged Illustrative where Tier 4)
- Real imagery from Phase 4 (not placeholder gradients)
- Every image/video slot from IMAGERY-PROMPTS.md has a placeholder component even if
  the asset isn't ready — the slot EXISTS in the route

### 6.2 RegenOps Screens — Same Flow, TinTin/AI at Every Step

The onramp pipeline runs IN regenops-app. Required screens (report missing, advisory not block):

- **Intake/Screening** — S00/S01: project arrives, mission fit, archetype selection
- **Research Dashboard** — S02/S07/S10: Five Capitals progress, source tier counts, gaps
- **Conflict Resolution** — fact-by-fact review, tier comparison, reconciliation log
- **Regen Score Card** — 5-dimension radar, composite, per-dimension evidence drill-down
- **Phase State Timeline** — visual arc showing S00–S24 progress for this place
- **Enrollment Overview** — place card, archetype, score, current phase, next action

**MD read/write file tree (REQUIRED in RegenOps project view):**
- Browsable tree of `places/<slug>/` markdown files
- Click to read any .md inline
- Edit and save .md files (PLACE.md, arc/*, tracker/*, DESIGN.md, PRODUCT.md)
- Read-only for generated files (`_context.md`)
- Uses FS MCP WebDAV bridge for cloud sessions; direct filesystem for CLI

**TinTin/AI at every step:**
- Each screen has a TinTin dispatch button (`POST /api/tintin/dispatch`)
- AI assist: "research this gap", "score this dimension", "draft this arc section",
  "generate image for this slot"
- Dave stays in the RegenOps flow; AI is the assistant, not the driver

### 6.3 PUBLISH.md + DEPLOY Block

Per `app-deploy-manifest.md`, generate `PUBLISH.md` with `<!-- DEPLOY -->` block
before deploy. Use `scripts/gen-deploy-blocks.mjs` or write manually.

### 6.4 Build + Commit Discipline

1. `pnpm --filter @regen/<slug> install`
2. `npx tsc --noEmit` — must pass
3. `pnpm --filter @regen/<slug> build` — must produce all routes
4. Commit: infra (lockfile) first with `RDC-Bypass:`, then product with `Work-Item:`

### 6.5 Route Content Verification

After build, verify each route renders REAL content:
- No placeholder text ("Lorem ipsum", "Coming soon", "TODO")
- Financial figures match arc/05-investors and arc/06-model
- Team/partner data matches tracker/STAKEHOLDERS.md
- All `<Image>` src imports resolve — no broken images

### 6.6 Phase 6 Rubric Gate

```
PHASE 6 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | apps/<slug>/ exists            | Next.js App Router                    | ?      |      |
| 2 | Routes match PRODUCT.md        | all declared routes present           | ?      |      |
| 3 | tsc --noEmit                   | exit 0                                | ?      |      |
| 4 | pnpm build                     | all routes built                      | ?      |      |
| 5 | Route content verification     | no placeholders, real arc content     | ?      |      |
| 6 | Financial figures match arc    | 05/06 cited figures rendered on site  | ?      |      |
| 7 | Image imports resolve          | no broken <Image> src                 | ?      |      |
| 8 | HISTORY route                  | own route, sourced from HISTORY.md    | ?      |      |
| 9 | PUBLISH.md + DEPLOY block      | exists, port: registry                | ?      |      |
| 10| RegenOps screens               | report present/missing (advisory)     | ?      |      |
```

Append Phase 6 results to ONRAMP-REPORT.md + INTAKE-LOG.md.

---

## Phase 7: Deploy Dev — Phase State + Epic Closure

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

### 7.3 Verify + Phase State Advance

- `curl -s https://<slug>.dev.place.fund/` → HTTP 200 + correct `<title>`
- All routes return 200
- Content spot-check: financial figures match arc files

After successful deploy:
```sql
UPDATE place_phase_state SET current_phase = 7, phase_name = 'Deploy Dev',
  gate_status = 'passed', updated_at = now()
WHERE place_slug = '<slug>';
```

### 7.4 Epic Closure

- Submit implementation report with `codeflow_post` via `submit_implementation_report`
- Tick all checklist items via `update_checklist_item`
- Transition epic to `review` via `update_work_item_status`
- Validator closes to `done`

### 7.5 INTAKE-LOG.md Finalization

All 7 phase rows written with timestamps, operator, session ID.

### 7.6 Phase 7 Rubric Gate

```
PHASE 7 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | app_deployments row            | exists with pm2_port allocated        | ?      |      |
| 2 | PM2 running                    | pm2 show <slug> = online              | ?      |      |
| 3 | HTTP 200                       | <slug>.dev.place.fund returns 200     | ?      |      |
| 4 | Content spot-check             | title correct, figures match arc      | ?      |      |
| 5 | place_phase_state              | advanced to phase 7, gate=passed      | ?      |      |
| 6 | Epic status                    | review or done                        | ?      |      |
| 7 | Implementation report          | submitted with codeflow_post          | ?      |      |
| 8 | INTAKE-LOG.md                  | all 7 phase rows present              | ?      |      |
| 9 | ONRAMP-REPORT.md               | all 7 phase sections present          | ?      |      |
```

Append Phase 7 results to ONRAMP-REPORT.md (final section).

---

## Resumability

| Phase | Skip condition |
|-------|---------------|
| 1 — Enrollment | DB row + disk tree + epic all exist + Phase 1 rubric gate all PASS (15 checks) |
| 2 — Research | Phase 2 rubric gate all PASS (14 checks) + ONRAMP-REPORT.md Phase 2 section |
| 2b — People/Org | STAKEHOLDERS.md >10 lines + unverified flagged in RECONCILIATION.md |
| 3 — Conflicts | Phase 3 rubric gate all PASS (7 checks) + zero conflicted/unverified |
| 4 — Brand | Phase 4 rubric gate all PASS (9 checks) + --<slug>-* tokens defined |
| 5 — Score | Phase 5 rubric gate all PASS (6 checks) + composite ≥75 |
| 6 — Build | Phase 6 rubric gate all PASS (10 checks) + tsc + build clean |
| 7 — Deploy Dev | Phase 7 rubric gate all PASS (9 checks) + HTTP 200 + phase_state advanced |

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
