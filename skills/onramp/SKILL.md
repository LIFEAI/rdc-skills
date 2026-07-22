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
  [ ] Web research on orgs — website, news, track record, regional presence
  [ ] Government registry verification for key entities
  [ ] Write verified entities to tracker/STAKEHOLDERS.md (>20 lines floor)
  [ ] Flag unverified entities in RECONCILIATION.md
Phase 3: Conflict Resolution
  [ ] Build fact inventory — extract every factual claim from all 6 arc files
  [ ] Cross-source verification — web vs document claims explicitly compared
  [ ] Cross-document verification — internal document consistency checked
  [ ] Financial figure verification — arc/05 + arc/06 internally consistent
  [ ] Stakeholder claim verification — arc/03 matches STAKEHOLDERS.md
  [ ] Timeline consistency check — dates coherent across all files
  [ ] Geographic/legal claim verification — boundaries, zoning, rights checked
  [ ] Resolve all conflicts — each claim verified | resolved | held
  [ ] RECONCILIATION.md written — structured ledger, zero conflicted remaining
  [ ] Arc files updated — resolved values written back with citations
  [ ] corpus/INDEX.md updated — new sources + tier reassessments
  [ ] Phase 3 rubric gate — 13-row pass/fail + ONRAMP-REPORT.md appended
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
Phase 5: Regen Score — Model-Driven Rubric Assessment
  [ ] Load model specification (VLAS 01 + 03 + archetype benchmarks)
  [ ] Regional comparable research — iterative gap fill
  [ ] SCARF×4Ps lattice assessment — 20 cells with evidence
  [ ] Five Capitals per-capital scoring with evidence citation
  [ ] Coverage spread gate — max-min <= 40
  [ ] Annihilator check — 8 binary pass/fail (any BLOCKED → NO-GO)
  [ ] Recognition formula readiness — 7 terms assessed
  [ ] Process state completion audit — required states per archetype
  [ ] Pathway ladder position — current + target rung
  [ ] Honesty audit — Tier 4 tagged, precedent tiers set
  [ ] Compose Regen Score from model rubric
  [ ] Score gate decision — GO/NEEDS WORK/NO-GO
  [ ] SCREENING.md written — lattice + score card + evidence
  [ ] Phase 5 rubric gate — 15-row pass/fail + ONRAMP-REPORT.md appended
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

### 2b.1 Extract People from All Sources

Scan ALL project documents + arc files for named people:
- Team members (founders, directors, managers)
- Partners and advisors (named individuals)
- Indigenous / First Nations contacts and elders
- Government officials and agency contacts
- Community leaders and stakeholders
- Historical figures (for HISTORY.md context)

Build a raw entity list: `name | mentioned_in | role_claimed | org_affiliation`.

### 2b.2 Extract Organizations from All Sources

Scan for named organizations:
- Project partners (development, construction, technology)
- First Nations bands, tribal councils, indigenous orgs
- Government agencies (federal, state/provincial, municipal)
- NGOs and conservation organizations
- Financial institutions, investors, fund managers
- Contractors, consultants, service providers

Build a raw org list: `org_name | mentioned_in | relationship | domain_claimed`.

### 2b.3 Categorize by Relationship Type

Assign each entity a relationship category from the VLAS stakeholder taxonomy:
- `core-team` — named on the project team
- `partner` — LOI or MOU holder
- `advisor` — advisory board or named advisor
- `indigenous-rights-holder` — FPIC counterparty (ANNIHILATOR — must be identified)
- `government` — regulatory or permitting authority
- `community` — local community stakeholder
- `investor` — capital provider or prospective
- `contractor` — service delivery
- `historical` — historical figure (HISTORY.md only, no verification needed)

### 2b.4 RocketReach Person Lookup

For each non-historical person, run verification:
```
mcp__claude_ai_RocketReach__rocketreach_lookup_person or rocketreach_search_people
```
Record: current_title, current_org, LinkedIn URL, email, verification_status.
If no match: mark `unverified` — DO NOT invent data.

### 2b.5 RocketReach Company Lookup

For each organization:
```
mcp__claude_ai_RocketReach__rocketreach_lookup_company
```
Record: domain, employee_count, industry, location, verification_status.
Cross-check claimed relationship against actual org profile.

### 2b.6 Web Research on Organizations

RocketReach gives you the company card. **Web research gives you the story.** For each
significant org (core-team, partner, investor, indigenous-rights-holder), run targeted
web research:

1. **Website analysis:** find the org's website, read their about/mission/team pages.
   Does the org's stated mission align with the project's claims about them?
2. **News search:** search for recent news about the org. Any red flags (lawsuits,
   regulatory actions, financial trouble, controversy)?
3. **Social/community presence:** does the org have a real presence in the region?
   LinkedIn company page, social media, community references?
4. **Track record:** has this org done similar projects before? What was the outcome?
   Search for their name + the project type (e.g., "org-name conservation" or
   "org-name eco-tourism").
5. **Financial standing:** for investor/financial entities, any public filings,
   annual reports, or regulatory registrations (SEC, provincial securities)?

For each org, record: `org | website | mission_fit | news_flags | regional_presence |
track_record | verification_status`.

Update arc files with findings — especially arc/03-foundation.md (partner orgs) and
arc/05-investors.md (financial entities). **A partner org with no web presence is a
yellow flag; an investor entity with no regulatory registration is a red flag.**

### 2b.7 Government Registry Verification

For key entities (project company, First Nations band, conservation trust):
- Check government business registries (state/provincial)
- Verify First Nations band recognition (federal indigenous affairs)
- Confirm non-profit/charity status where claimed
- Record registration numbers where available

### 2b.8 Cross-Reference Against Arc Files

Verify consistency between entity claims and arc file content:
- Team bios in arc/03-foundation.md match RocketReach profiles
- Partner orgs in arc/04-process-outcomes.md exist and match claimed domain
- Investor entities in arc/05-investors.md are real institutions
- Flag any entity mentioned in arc files but NOT in the raw extraction (missed entity)

### 2b.9 Map Stakeholder Network

Build a relationship map: who connects to whom, through what mechanism.
- Direct relationships (employment, partnership, advisory)
- Indirect relationships (shared board membership, common investor)
- FPIC chain: which indigenous rights-holders must consent, and who is the contact
- Governance chain: project → trust → community → rights-holder

### 2b.10 Write STAKEHOLDERS.md

Write verified entities to `places/<slug>/tracker/STAKEHOLDERS.md`:
- **People section:** name, title, org, LinkedIn, verification status, relationship category
- **Organizations section:** name, domain, size, relationship, verification status
- **Network section:** key relationships mapped
- **FPIC counterparties:** explicitly listed (even if unverified — the gap is the finding)

**Content floor:** STAKEHOLDERS.md must have >20 lines of substantive content.
If fewer than 20 lines after enrichment, the rubric FAILs.

### 2b.11 Flag Unverified Entities

Write ALL unverified entities to RECONCILIATION.md under a `## Unverified Entities` section:
- Person: name, claimed role, what was searched, why no match
- Org: name, claimed relationship, what was searched, why no match
- Each flagged entity gets an escalation path: "verify via [specific next step]"

### 2b.12 Update Arc Files with Verified Data

Where RocketReach returned richer data than the arc files contain:
- Update arc/03-foundation.md with verified titles and org affiliations
- Update arc/05-investors.md with verified investor entity details
- Tag each update: `(Verified via RocketReach <date>)`

### 2b.13 Phase 2b Rubric Gate

```
PHASE 2b RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | People extracted               | all named people from all docs        | ?      |      |
| 2 | Orgs extracted                 | all named orgs from all docs          | ?      |      |
| 3 | Entities categorized           | relationship type assigned each       | ?      |      |
| 4 | RocketReach person lookups     | run on all non-historical people      | ?      |      |
| 5 | RocketReach company lookups    | run on all orgs                       | ?      |      |
| 6 | Web research on orgs           | website + news + track record checked | ?      |      |
| 7 | Government registry checks     | key entities verified                 | ?      |      |
| 8 | Arc file cross-reference       | no missed entities                    | ?      |      |
| 9 | Stakeholder network mapped     | relationships documented              | ?      |      |
| 10| STAKEHOLDERS.md                | >20 lines substantive content         | ?      |      |
| 11| FPIC counterparties identified | listed even if unverified             | ?      |      |
| 12| Unverified entities flagged    | in RECONCILIATION.md with next steps  | ?      |      |
| 13| Arc files updated              | verified data written back            | ?      |      |
```

Under `RDC_TEST=1`: skip RocketReach + registry lookups; write placeholder STAKEHOLDERS.md.

Append Phase 2b results to ONRAMP-REPORT.md + INTAKE-LOG.md.

---

## Phase 3: Conflict Resolution

Systematic fact verification across all sources — every factual claim in every arc file
must be cross-checked, classified, and resolved before scoring.

### 3.1 Build Fact Inventory

Scan all 6 arc files and extract every factual claim into a structured inventory:
- **Quantitative claims:** acreage, elevation, population, financial figures, dates
- **Entity claims:** people, orgs, roles, relationships
- **Legal claims:** title status, easements, zoning, permits, water rights
- **Ecological claims:** species presence, habitat type, soil classification, watershed
- **Historical claims:** dates, events, ownership transitions

Each claim gets a row: `claim | arc_file | source | tier | category`.

### 3.2 Cross-Source Verification — Web vs Documents

For each factual claim, explicitly compare web research sources (Tier 0-2) against
project-supplied documents (Tier 3-4):
- Same fact, different numbers → `conflicted`
- Web confirms document → `verified`
- Web contradicts document → `conflicted` with both values logged
- No web source found for document claim → `unverified`
- Web source found, no document mention → `web-only` (flag for arc update)

Log each comparison in RECONCILIATION.md: `claim | web_value | doc_value | status`.

### 3.3 Cross-Document Verification

Compare claims across incoming documents themselves:
- Business plan vs pro forma (financial figures consistent?)
- Execution proposal vs development package (timeline, team, scope consistent?)
- Due diligence list vs actual permits/rights in arc files
- Flag any internal document contradictions

### 3.4 Financial Figure Verification

Dedicated pass on all financial claims in arc/05-investors.md and arc/06-model.md:
- CapEx total: consistent across all mentions?
- Revenue projections: same base assumptions everywhere?
- Phased investment amounts: sum correctly?
- Pro forma: internally consistent (revenue - costs = margin)?
- All Tier 4 figures tagged `(Illustrative)` — verify none are presented as verified

### 3.5 Stakeholder Claim Verification

Cross-check STAKEHOLDERS.md against arc file claims:
- Every person mentioned in arc/03 appears in STAKEHOLDERS.md
- Titles/roles match between arc files and verified RocketReach data
- Partner orgs in arc/04 match STAKEHOLDERS.md org entries
- No phantom stakeholders (mentioned in arc files, not in STAKEHOLDERS.md)

### 3.6 Timeline Consistency Check

Verify all temporal claims are internally consistent:
- Project phases in arc/04 have realistic durations
- Milestone dates in tracker/MILESTONES.md align with arc file narratives
- Historical dates in HISTORY.md are chronologically valid
- Regulatory timeline (permits, approvals) is plausible for jurisdiction

### 3.7 Geographic and Legal Claim Verification

Verify location-specific claims:
- Property boundaries / APN match county records (Tier 0)
- Zoning classification matches municipal records
- Water rights claims match state/provincial records
- Conservation easement claims match land trust records
- Heritage/NHPA listings match federal/state registers

### 3.8 Resolve All Conflicts

For each `conflicted` or `unverified` claim, choose one resolution:
- **verified** — web + doc agree, or authoritative source confirms
- **resolved** — conflict existed, winner chosen with rationale documented
- **held** — cannot resolve now; escalation path documented (who to ask, what to check)

Update arc files with resolved values. Tag resolved claims:
`(Resolved: <winning_source>, see RECONCILIATION.md RC-NNN)`

### 3.9 Write RECONCILIATION.md

Structure as a ledger with sections:
1. **Verified Claims** — fact + sources that agree
2. **Resolved Conflicts** — fact + both values + winner + rationale
3. **Held Claims** — fact + why unresolvable + escalation path + impact if wrong
4. **Unverified Entities** (from Phase 2b)

Zero `conflicted` facts may remain. `held` facts must each have a documented escalation path
and an impact assessment (what breaks if this fact is wrong).

### 3.10 Update Arc Files with Corrections

Write resolved values back into the arc files:
- Replace conflicted figures with resolved values
- Add source citations for newly verified facts
- Remove or tag unverifiable claims
- Ensure arc/05 and arc/06 financial figures are internally consistent post-resolution

### 3.11 Update corpus/INDEX.md

Add any new sources discovered during verification. Update tier assignments where
a source's authority was re-assessed during conflict resolution.

### 3.12 Phase 3 Rubric Gate

```
PHASE 3 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | Fact inventory built           | every arc file scanned, claims listed | ?      |      |
| 2 | Web vs doc comparisons         | explicitly logged per claim            | ?      |      |
| 3 | Cross-document consistency     | internal doc contradictions resolved  | ?      |      |
| 4 | Financial figures verified     | arc/05 + arc/06 internally consistent | ?      |      |
| 5 | Stakeholder claims verified    | arc/03 matches STAKEHOLDERS.md        | ?      |      |
| 6 | Timeline consistency           | dates coherent across all files       | ?      |      |
| 7 | Geographic/legal verified      | boundaries, zoning, rights checked    | ?      |      |
| 8 | Zero conflicted facts          | 0 remaining                           | ?      |      |
| 9 | Zero unverified facts          | 0 remaining (or reclassified held)    | ?      |      |
| 10| Held facts documented          | each with escalation + impact         | ?      |      |
| 11| Arc files updated              | resolved values written back          | ?      |      |
| 12| corpus/INDEX.md updated        | new sources + tier reassessments      | ?      |      |
| 13| STAKEHOLDERS.md                | >20 lines substantive content         | ?      |      |
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

## Phase 5: Regen Score — Model-Driven Rubric Assessment

The Regen Score is **driven by the VLAS model specification** (corpus 01), not a standalone
scoring system. The archetype assigned in Phase 1 determines which model rubric applies,
which process states are required (corpus 03 §5), which Five Capitals are emphasized,
and which annihilators must be checked. **The model IS the rubric.**

Scoring is NOT a one-pass read-and-number exercise. Each dimension requires regional
research correlation — you look at the region, discover what comparables exist, check
how this place fits the regional pattern, and circle back for deeper evidence where the
first pass left gaps. Multiple research passes per dimension are expected.

### 5.1 Load Model Specification

Load the model's scoring context from the VLAS corpus and archetype templates:
- Read `$CORPUS_ROOT/VLAS/plans/01-model-spec.md` — the universal template (§6 SCARF×4Ps,
  §7 Five Capitals, §8 the arc, §12 recognition formula + annihilators)
- Read `$CORPUS_ROOT/VLAS/plans/03-process-states.md` — state library + §5 land-type
  selection matrix (Data Center / Land Regen / Urban Renewal)
- Read `corpus/_shared/onramp/benchmarks/<archetype>.md` — archetype-specific benchmarks
- Read `places/<slug>/PROCESS-ARC.md` — this place's state selection (from Phase 1)

The model spec defines **what gets scored and how**. If the archetype benchmark set does
not exist, the skill writes a default from the model spec §7 (Five Capitals) + §6
(SCARF×4Ps lattice) and flags it for review.

### 5.2 Regional Comparable Research — First Pass

Before scoring, establish the regional context this place sits within:
- **Comparable projects:** search for similar archetype projects in the same region
  (state/province, ecoregion, economic zone). What are they? What did they cost?
  What revenue do they generate? What regulatory path did they follow?
- **Regional economic indicators:** median land values, construction costs per sqft,
  tourism/hospitality revenue baselines, agricultural yields for the bioregion
- **Regulatory landscape:** what permits/approvals do comparable projects in this
  jurisdiction typically require? What are typical timelines?
- **Conservation/ecological benchmarks:** ecoregion health baselines, species
  inventories for the bioregion, watershed health metrics from regional agencies

This is research — use WebSearch, web-research MCP, or existing corpus. Log all
new sources in corpus/INDEX.md with tier assignments.

### 5.3 SCARF×4Ps Lattice Assessment

Fill the 5×4 grid from model spec §6 for this place. Each cell is a question the
model answers for a real project:

```
| SCARF \ 4P     | Place            | People           | Purpose          | Process          |
|----------------|------------------|------------------|------------------|------------------|
| Source          | ?                | ?                | ?                | ?                |
| Condition       | ?                | ?                | ?                | ?                |
| Appropriateness | ?                | ?                | ?                | ?                |
| Resilience      | ?                | ?                | ?                | ?                |
| Feedback        | ?                | ?                | ?                | ?                |
```

For each cell:
- Fill with evidence from arc files (cite arc file + source tier)
- Mark as **gate-generating** (produces a hard gate), **filter-generating** (produces
  a soft filter), or **neither**
- Cells that are gate-generating feed directly into the annihilator check (5.7)
- Empty cells are scoring gaps — flag for additional research or mark as
  `declared absence (reason)` (doc 01 §0.3: *a declared absence is an artifact*)

Write the filled lattice to `places/<slug>/SCREENING.md`.

### 5.4 Five Capitals Per-Capital Scoring

Score each capital per model spec §7 — canonical definitions, never redefined.
Each capital has: **definition** → **what it means for this archetype** → **patterns
that build it** (doc 04) → **indicators** → **evidence citation**.

| Capital   | Unit | Score 0-100 | Evidence | Source Tier | Arc File(s) |
|-----------|------|-------------|----------|-------------|-------------|
| Natural   | NCU  | ?           | ?        | ?           | arc/02      |
| Human     | HCU  | ?           | ?        | ?           | arc/03      |
| Social    | SCU  | ?           | ?        | ?           | arc/03, 04  |
| Built     | MCU  | ?           | ?        | ?           | arc/04      |
| Financial | FCU  | ?           | ?        | ?           | arc/05, 06  |

**Financial is a translation layer** — it captures monetized value from gains in the
other four (doc 01 §7). Score on whether the financial model supports the other capitals,
not as an independent measure of profitability.

**Coverage rule (doc 01 §5):** a plan that maxes one capital and starves another is
**visibly lopsided and fails.** No capital may score below 40 while another scores
above 80 (the coverage spread gate). Whole-place or nothing.

**Weighting honesty:** any weighting used is **pedagogical, not measured.** Label it
`Illustrative`. Measured outcomes come from verification (S20), never the planner.

Each per-capital score MUST cite: which arc file, which source (tier), what evidence
justifies the number. No bare scores. Tier 4 figures that are the SOLE evidence for a
sub-score → cap that sub-score at 50.

### 5.5 Annihilator Check — Binary Pass/Fail

The recognition formula is a **product** — any zeroed term collapses everything.
Gates are **annihilators, not low scores** (doc 01 §12.2, doc 03 §2).

Check each annihilator and record binary status:

| Annihilator | State | Check | Status | Evidence |
|-------------|-------|-------|--------|----------|
| FPIC        | S04   | Consent counterparties identified + pathway | ? | STAKEHOLDERS.md |
| Readiness   | S13   | Place ecology can hold development | ? | arc/02 |
| Baseline    | S08   | Five Capitals baseline captured or plan exists | ? | arc files |
| Covenant    | S14   | Legal pathway identified | ? | arc/05, tracker/ |
| Permanence  | S20   | π_legal × π_ecology both non-zero pathway | ? | HISTORY.md, arc/02 |
| Verification| S20   | Measurement plan for ΔI exists | ? | PROCESS-ARC.md |
| Offtake     | S21   | Revenue/offtake pathway identified | ? | arc/06 |
| Dividend    | S22   | ≥10% community, before investor allocation | ? | arc/05 |

At enrollment, most annihilators cannot be fully passed — but the **pathway to passing
them** MUST be identified. A place with no FPIC counterparty identified and no plan to
identify them is a NO-GO regardless of other scores.

Status per annihilator:
- **CLEAR** — evidence exists or a credible pathway is documented
- **AT RISK** — gap identified, pathway unclear but not impossible
- **BLOCKED** — no pathway visible → NO-GO signal

Any annihilator **BLOCKED** → composite capped at NO-GO (<55) regardless of capital scores.

### 5.6 Recognition Formula Readiness

Assess each term of the normative issuance kernel (doc 01 §12, doc 09 §2):

`Q = A_cap × ΔI_c × P × S × v^α × a^β × (1-U)`

At enrollment, this is a **readiness assessment**, not a computed Q:

| Term | Question | Evidence | Readiness |
|------|----------|----------|-----------|
| A_cap (scale) | Area/asset quantified? | Survey, title, GIS | ? |
| ΔI (integrity uplift) | Baseline plan + measurement methodology? | PROCESS-ARC.md | ? |
| P (permanence) | Legal + ecological durability pathway? | arc/05, HISTORY.md | ? |
| S (stewardship/FPIC) | Consent + governance quality? | STAKEHOLDERS.md | ? |
| v (velocity) | Time-series plan for improvement rate? | tracker/MILESTONES.md | ? |
| a (acceleration) | Sustained care plan beyond initial cycle? | arc/04 | ? |
| (1-U) (uncertainty) | Source quality + measurement confidence? | corpus/INDEX.md tiers | ? |

Each term: **Ready** / **Partially ready** / **Not ready** / **N/A (with reason)**.

### 5.7 Process State Completion Audit

Read `places/<slug>/PROCESS-ARC.md` (Phase 1) and check which states have evidence
of completion vs which are still required.

For each state S00–S24 marked `required`:
1. What evidence exists that this state has been addressed?
2. Is the evidence sufficient to pass the state's exit gate?
3. Which states are CORE vs CONDITIONAL for this archetype?

Cross-reference against the land-type selection matrix (doc 03 §5):
- Data Center: S05b site control, S11 N/A, S15 N/A
- Land Regen / Conservation: S05a LRLT, S11 core, S15 core
- Urban Renewal: S05c no land trust, S11 optional, S15 project-dependent
- Eco-hospitality / Coastal-watershed: map to closest column + archetype-specific overrides

**A composite ≥75 with a CORE state missing is invalid.**

ANNIHILATOR states (S04 FPIC, S08 Baseline, S13 Readiness, S14 Covenant, S20 Verification,
S21 Recognition, S22 Return Flow) with no evidence → composite invalid regardless of number.

### 5.8 Pathway Ladder Position

Determine current and target rung (doc 01 §9 — five rungs, ascending):
1. Where does this place sit today? (current rung, with evidence)
2. What is the target rung? (from PROCESS-ARC.md or project vision)
3. Is an operating example at the target rung known? If not, say so honestly.
4. What is the rising floor — the regulatory trajectory in this jurisdiction?
5. Is the project building above or at the current floor?

The aspirational rule: if no operating example exists at the top, **say so.** Building
to the current floor is building to be obsolete.

### 5.9 Regional Correlation — Second Pass (Gap Fill)

After first-pass scoring, identify capitals that scored below 75 individually:
- For each weak capital, do a targeted regional research pass:
  - What specific evidence is missing?
  - Can it be found via web research in the region?
  - Are there comparable projects whose public data fills the gap?
  - Correlate: does new regional data change the picture for other capitals too?
- Update arc files with newly found evidence
- Re-score the weak capital with new evidence
- Log the research cycle in ONRAMP-REPORT.md

This may require **multiple rounds** — you discover the region's shape, correlate what
matters for this place in this region, then circle back for deeper digs on topics that
emerged. Research is iterative. A gap that CANNOT be filled after targeted research
stays as-is and contributes to the NEEDS WORK or NO-GO verdict.

### 5.10 Honesty Audit

Verify all claims meet the honesty standard (doc 01 §11):
- Every Tier 4 figure tagged `(Illustrative)` — no unverified figure scored as fact
- Tier 4 figures that are the SOLE evidence for a capital score → cap at 50
- Every pattern, instrument, and rung carries a precedent tier
  (Operating · Pilot · Proposal · Standard · Regulatory)
- `announced-not-operating` flags on any case study cited
- Financial Verified Mode: no unsourced figure ships as fact
- The `[I]` register is identified — what is illustrative vs verified
- Log: "N of M scoring evidence points are Tier 4 — ceiling applied to [capitals]"

### 5.11 Compose Regen Score from Model Rubric

Aggregate all scoring components — NOT a simple 5-dimension mean. The model rubric
drives the structure:

```
REGEN SCORE — <slug> — <archetype>
Model: <archetype> (loaded from $CORPUS_ROOT/VLAS/plans/ + archetype benchmarks)

SCARF×4Ps Lattice: NN/20 cells filled with evidence (gate-generating: N)

Five Capitals (per-capital, evidence-cited):
  Natural:   __/100  [arc/02, Tier _]
  Human:     __/100  [arc/03, Tier _]
  Social:    __/100  [arc/03-04, Tier _]
  Built:     __/100  [arc/04, Tier _]
  Financial: __/100  [arc/05-06, Tier _]
  Coverage spread: PASS/FAIL (max-min <= 40)

Annihilators (binary — any BLOCKED → NO-GO):
  FPIC:        CLEAR / AT RISK / BLOCKED
  Readiness:   CLEAR / AT RISK / BLOCKED
  Baseline:    CLEAR / AT RISK / BLOCKED
  Permanence:  CLEAR / AT RISK / BLOCKED
  Offtake:     CLEAR / AT RISK / BLOCKED
  Dividend:    CLEAR / AT RISK / BLOCKED

Recognition Formula: __/7 terms ready
Process States: __/__ required states addressed
Pathway: Rung __/5 current → Rung __/5 target
Research Passes: N rounds (gaps identified + re-researched)

Composite: __ — GO ≥75 | NEEDS WORK 55-74 | NO-GO <55
```

Write the full score card to `places/<slug>/SCREENING.md` (appending to the lattice
from 5.3). This is the durable scoring artifact.

### 5.12 Score Gate Decision

| Composite | Verdict | Action |
|-----------|---------|--------|
| ≥ 75 | **GO** | Proceed to Phase 6 (Build) |
| 55-74 | **NEEDS WORK** | List specific gaps; skill STOPS. Re-invoke after addressed. |
| < 55 | **NO-GO** | Project does not meet threshold. Skill STOPS. Escalate to Dave. |

If NEEDS WORK: list exactly what would move the score to GO — which capital needs
evidence, which annihilator needs a pathway, which process state needs attention.
A NO-GO is a success of the model if the place genuinely isn't ready.

Append the full scoring narrative to ONRAMP-REPORT.md:
```markdown
## Phase 5: Regen Score — <date>
### Model: <archetype> (benchmark set: loaded/generated)
### SCARF×4Ps: NN/20 cells filled (N gate-generating)
### Five Capitals:
| Capital   | Score | Evidence | Tier 4 count | Ceiling | Key citation |
|-----------|-------|----------|--------------|---------|-------------|
| Natural   | NN    | X        | Y            | yes/no  | arc/02:LNN  |
| Human     | NN    | X        | Y            | yes/no  | arc/03:LNN  |
| Social    | NN    | X        | Y            | yes/no  | arc/04:LNN  |
| Built     | NN    | X        | Y            | yes/no  | arc/04:LNN  |
| Financial | NN    | X        | Y            | yes/no  | arc/06:LNN  |
### Coverage spread: PASS/FAIL
### Annihilators: [list each with status]
### Recognition Formula Readiness: __/7 terms
### Process States: __/__ required addressed
### Pathway: Rung __→__ | Rising floor: [jurisdiction context]
### Composite: NN — [GO / NEEDS WORK / NO-GO]
### Gaps (if NEEDS WORK): [specific actionable items per capital]
```

### 5.13 Phase 5 Rubric Gate

```
PHASE 5 RUBRIC — <slug>
| # | Check                          | Expected                              | Actual | Pass |
|---|--------------------------------|---------------------------------------|--------|------|
| 1 | Model spec loaded              | VLAS 01 + 03 + archetype benchmarks   | ?      |      |
| 2 | Regional comparables researched| >= 2 comparable projects found        | ?      |      |
| 3 | SCARF×4Ps lattice filled       | 20 cells answered with evidence       | ?      |      |
| 4 | All 5 capitals scored          | 0-100 each with evidence citation     | ?      |      |
| 5 | Coverage spread gate           | max-min <= 40                         | ?      |      |
| 6 | Annihilators checked           | all 8 binary pass/fail recorded       | ?      |      |
| 7 | No BLOCKED annihilator         | all CLEAR or AT RISK                  | ?      |      |
| 8 | Recognition formula assessed   | all 7 terms readiness recorded        | ?      |      |
| 9 | Process states audited         | required states checked per archetype | ?      |      |
| 10| Pathway ladder position set    | current + target rung with evidence   | ?      |      |
| 11| Regional gap-fill pass done    | weak capitals re-researched           | ?      |      |
| 12| Honesty audit passed           | Tier 4 tagged, precedent tiers set    | ?      |      |
| 13| Composite >= 75                | GO                                    | ?      |      |
| 14| SCREENING.md written           | lattice + score card + evidence       | ?      |      |
| 15| Score in ONRAMP-REPORT.md      | Phase 5 section appended              | ?      |      |
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
