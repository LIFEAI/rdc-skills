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
| `--history` | no | off | Opt-in: scaffold `places/<slug>/HISTORY.md`. See [`.claude/rules/history-md-convention.md`](file:///C:/Dev/regen-root/.claude/rules/history-md-convention.md). |
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
  [ ] Land identity — legal, parcels, GIS, acreage
  [ ] Ownership + title chain
  [ ] Ecological profile — ecoregion, soils, hydrology, vegetation
  [ ] Cultural + historical significance
  [ ] Stewardship + vision
  [ ] Finance + raise model
  [ ] Regulatory — zoning, water rights, easements, permits
  [ ] PLACE.md written from findings
Phase 3: Conflict Resolution
  [ ] All facts reviewed for tier conflicts
  [ ] RECONCILIATION.md written (if any conflicts)
  [ ] All facts verified | resolved | held — zero conflicted/unverified
Phase 4: Brand
  [ ] DESIGN.md generated from research
  [ ] Brand review gate (skip if --no-gate)
Phase 5: Regen Score
  [ ] 5 dimensions scored from evidence
  [ ] Composite computed — GO ≥75 | NEEDS WORK 55-74 | NO-GO <55
  [ ] Score gate: composite ≥75 to proceed (advisory if --no-gate)
Phase 6: Site Build
  [ ] rdc:build invoked for <slug>
Phase 7: Deploy Dev
  [ ] rdc:deploy <slug> to PM2 dev
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
  p_project_node_id := '<project_node_id>'::uuid
);
```

### 1.4 Disk Tree

If `scripts/onramp-scaffold-place.mjs` exists:
```bash
node scripts/onramp-scaffold-place.mjs --slug <slug> --name "<Display Name>" \
  [--archetype <archetype>] [--owner <owner>] [--history]
```

Otherwise, create the tree directly:
```
places/<slug>/
  PLACE.md          — identity stub (filled in Phase 2)
  PRODUCT.md        — regenerative model stub
  DESIGN.md         — brand brief stub (filled in Phase 4)
  HANDOFF.md        — build handoff stub
  RECONCILIATION.md — conflict log (filled in Phase 3)
  corpus/
    INDEX.md        — corpus file index
  arc/
    01-land/        — land identity research
    02-ownership/   — title and stewardship chain
    03-ecology/     — ecological profile
    04-culture/     — cultural and historical significance
    05-stewardship/ — steward vision and community
    06-finance/     — financial model and raise
    07-regulatory/  — zoning, water, permits
  tracker/
    ROADMAP.md      — project tracker
```

Each arc directory gets a `README.md` stub with its research scope.

**Post-scaffold gate (HARD):**
```bash
test ! -f "places/<slug>/_context.md" && echo "✓" || echo "FAIL: _context.md present"
```
If `_context.md` found: **STOP.** Projection-drift violation.

---

## Phase 2: Research

The research phase assembles a source-verified corpus for the place using web search. Dispatch **7 parallel research agents** — one per domain.

### Research Agent Dispatch

For each of the 7 research domains, dispatch a subagent:

```
Agent({
  description: "Research: <domain> for <slug>",
  prompt: "You are researching <domain> for the Place Fund project '<Display Name>' (<slug>).
    Location: <location>.
    Archetype: <archetype>.

    Read C:/Dev/regen-root/.rdc/guides/agent-bootstrap.md first.

    TASK: Use WebSearch and WebFetch to find authoritative, citable sources for:
    <domain-specific research questions — see below>

    OUTPUT FORMAT — write a single markdown file to places/<slug>/arc/<NN>-<domain>/findings.md:
    ```
    # <Domain> — <Display Name>

    ## Facts

    - **<claim>**
      - Tier: <0-4> (<tier label>)
      - Source: <citation with URL>
      - Confidence: <0-100>
      - Status: verified | unverified

    [repeat for each fact found]

    ## Sources Consulted
    - [<title>](<url>) — <what it provided>

    ## Gaps
    - <what could not be found — needs human input>
    ```

    RULES:
    - Every fact MUST have a real source URL. No AI-generated claims as sources.
    - Use source tiers: 0=Recorded legal, 1=Government/official, 2=Independent 3rd-party, 3=Project upload, 4=Stakeholder claim
    - Prefer government databases (county GIS, BLM, SSURGO, USGS, NVC, NHPA).
    - If nothing is found for a question, report it as a Gap — do not fabricate.
    - Write the file using the Write tool. Use relative paths from the repo root.
    - All URLs and file paths must be clickable markdown hyperlinks."
})
```

### Domain-Specific Research Questions

**01-land** — Land Identity:
- Legal description and parcel APN
- County GIS boundary data
- Total acreage (cross-reference sources)
- Topography, elevation range
- Access roads, easement access

**02-ownership** — Ownership + Title Chain:
- Current titleholder (county recorder)
- Title chain from original patent/deed
- Active encumbrances, liens, mortgages
- Conservation easements on title

**03-ecology** — Ecological Profile:
- EPA Level III/IV ecoregion classification
- SSURGO soil types and capabilities
- Hydrology: watersheds, streams, wetlands (NHD)
- Vegetation communities (USFS NVC / NatureServe)
- Listed species (USFWS IPaC, state databases)
- Fire history and risk (MTBS, Wildfire Risk to Communities)

**04-culture** — Cultural + Historical:
- Indigenous ancestral territory (Native Land Digital)
- NHPA/NRHP listed structures or sites
- Local historical significance
- Community cultural values

**05-stewardship** — Stewardship + Vision:
- Steward profile (if public information available)
- Stated regenerative intent
- Community relationships
- FPIC status with indigenous communities (if applicable)

**06-finance** — Finance + Raise:
- Property tax assessments (county assessor)
- Comparable sales / market value indicators
- Existing conservation easement valuations
- Known financial encumbrances

**07-regulatory** — Regulatory:
- Zoning classification (county planning)
- Water rights (state water board)
- Active permits
- Tax classification (agricultural, conservation, etc.)
- Wetland delineation requirements (Army Corps)

### Post-Research: Write PLACE.md

After all 7 agents return, read their findings files and compile `places/<slug>/PLACE.md`:

```markdown
# <Display Name>

> Generated by rdc:onramp Phase 2 research. Source-cited.

## Identity
<from 01-land findings: location, acreage, legal description>

## Ecology
<from 03-ecology findings: ecoregion, soils, hydrology, vegetation>

## History + Culture
<from 04-culture findings>

## Stewardship
<from 05-stewardship findings>

## Regenerative Vision
<from PRODUCT.md stub + stewardship intent>
```

Also update `places/<slug>/corpus/INDEX.md` with links to all findings files.

Under `RDC_TEST=1`: skip web searches; write stub findings files with `[RDC_TEST] placeholder` content.

---

## Phase 3: Conflict Resolution

Scan all `arc/*/findings.md` files for conflicting facts (same claim, different values or sources).

### Procedure

1. Read all findings files from Phase 2
2. For each pair of conflicting facts:
   - Record both claims with tiers and provenance
   - The higher-tier source governs
   - Write the resolution to `places/<slug>/RECONCILIATION.md`
3. Update fact statuses in findings files:
   - Winning claim → `status: resolved` (or stays `verified`)
   - Losing claim → demoted to a note with `status: resolved` and provenance
   - Unresolvable → `status: held` with reason
4. **Gate:** all facts must be `verified`, `resolved`, or `held`. Zero `conflicted` or `unverified` facts may remain.

If zero conflicts found: write `places/<slug>/RECONCILIATION.md` with "No conflicts detected."

**COLLISION RULE:** If two conflicting PLACE identities are found (slug refers to two different physical locations), **STOP immediately** — this is a disk-ahead-class collision.

---

## Phase 4: Brand

### 4.1 Generate DESIGN.md

Read the compiled PLACE.md and research findings. Write `places/<slug>/DESIGN.md`:

```markdown
# <Display Name> — Design Brief

## Story of Place
<narrative distilled from research — the land's character, history, ecological identity>

## Archetype
<archetype> — <one-line why this archetype fits>

## Brand Direction
- Primary palette suggestion (earth tones derived from ecological character)
- Typography direction
- Photography/imagery guidance
- Tone of voice

## Content Map
- Homepage hero narrative
- Key sections: Land, Ecology, Vision, Finance, Team
- RCCS credit story (if applicable)
```

### 4.2 Brand Gate

If `--no-gate` is NOT set:
```
⏸️  BRAND GATE — Phase 4 complete.
   DESIGN.md written to places/<slug>/DESIGN.md
   Review the design brief and re-invoke to continue:
   rdc:onramp <slug> --name "<name>" --skip-to 5
```

If `--no-gate` IS set: proceed to Phase 5 with the generated design.

---

## Phase 5: Regen Score

Score each of the 5 intake-readiness dimensions based on evidence gathered in Phase 2. See [`docs/systems/regenops/BENCHMARKING.md`](file:///C:/Dev/regen-root/docs/systems/regenops/BENCHMARKING.md) for methodology.

### Scoring Procedure

For each dimension, count evidence items and assess quality:

| Dimension | Key | Evidence Sources | Scoring Basis |
|-----------|-----|-----------------|---------------|
| Owner / Steward | `owner` | 02-ownership, 05-stewardship | Title clarity, steward alignment, FPIC |
| Project / Place | `place` | 01-land, 03-ecology | Archetype fit, ecoregion mapped, features verified |
| Finance Model | `model` | 06-finance | Raise clarity, valuations, encumbrances |
| Approach | `approach` | 05-stewardship, 03-ecology | Integrative intent, rubric applied, co-governance |
| Timeline | `timeline` | all findings | Phase targets, corpus completeness, gaps remaining |

**Score formula per dimension:**
- Base: 20 points (enrolled)
- +10 per verified/resolved fact in the dimension (capped at 50)
- +10 if ≥3 facts are tier 0-1 (government/legal sources)
- +10 if zero gaps remain in the dimension
- +10 if zero held/unverified facts remain
- Maximum: 100

**Composite:** unweighted mean of all 5, rounded.

```
readinessSignal(composite):
  ≥75 → GO       — proceed to build
  ≥55 → NEEDS WORK — identify weakest dimension
  <55 → NO-GO    — escalate to Dave
```

### Score Report

```
REGEN SCORE: <composite> — <GO|NEEDS WORK|NO-GO>

  Owner / Steward:  <score>  <bar>
  Project / Place:  <score>  <bar>
  Finance Model:    <score>  <bar>
  Approach:         <score>  <bar>
  Timeline:         <score>  <bar>

  Data confidence: <N>% (<verified+resolved> / <total facts>)
```

### Score Gate

- **GO (≥75):** proceed to Phase 6.
- **NEEDS WORK (55-74):** report weakest dimension and what's needed. If `--no-gate`: proceed anyway (dev build is iterative). If gated: stop and report.
- **NO-GO (<55):** always stop and escalate. Report fundamental gaps.

---

## Phase 6: Site Build

Invoke `rdc:build` for the enrollment epic. The build skill reads `places/<slug>/HANDOFF.md` for context.

### Pre-build: Write HANDOFF.md

Compile the handoff from all prior phases:

```markdown
# <Display Name> — Build Handoff

## Identity
slug: <slug>
archetype: <archetype>
location: <location>
project_node_id: <uuid>
epic_id: <uuid>

## Research Summary
<one paragraph from PLACE.md>

## Regen Score
Composite: <score> (<signal>)
Weakest dimension: <key> (<score>)

## Design Brief
See places/<slug>/DESIGN.md

## Build Scope
- Project site at apps/<slug> or sites/<slug>
- Content from places/<slug>/PLACE.md
- Design from places/<slug>/DESIGN.md
- Data from corpus findings
```

### Invoke Build

```
/rdc:build <epic-id>
```

The build skill handles TSC gate, component assembly, and dev deployment.

If `rdc:build` is not available in this context (e.g. running from claude.ai), report:
```
⏸️  BUILD GATE — invoke from CLI:
   /rdc:build <epic-id>
```

Under `RDC_TEST=1`: skip build invocation.

---

## Phase 7: Deploy Dev

After successful build, deploy to PM2 dev.

```
/rdc:deploy <slug>
```

If the build skill already deployed (rdc:build deploys to dev by default per AGENTS.md), verify instead:
```bash
curl -s -o /dev/null -w "%{http_code}" https://<slug>.dev.place.fund/
```

Under `RDC_TEST=1`: skip deploy.

---

## Phase 8: Deploy Prod

**ALWAYS gates for Dave's approval, regardless of --no-gate.**

```
⏸️  PROD GATE — dev verified. To promote to production:
   Provide explicit approval, then:
   /rdc:deploy <slug> promote
```

Production deployment requires Dave's explicit approval in the session. No agent may promote without it.

---

## Resumability

Every phase checks whether its outputs already exist before running:

| Phase | Skip condition |
|-------|---------------|
| 1 — Enrollment | `places` DB row exists AND disk tree exists AND epic exists |
| 2 — Research | All 7 `arc/*/findings.md` files exist and are non-empty |
| 3 — Conflicts | `RECONCILIATION.md` exists and all facts are verified/resolved/held |
| 4 — Brand | `DESIGN.md` has substantive content (not just the stub) |
| 5 — Score | Score ≥75 and evidence hasn't changed since last score |
| 6 — Build | App exists and builds cleanly |
| 7 — Deploy Dev | Dev URL returns HTTP 200 with expected content |
| 8 — Deploy Prod | Prod URL returns HTTP 200 |

Re-invoking `rdc:onramp <slug>` skips completed phases and resumes from the first incomplete one. Use `--skip-to <phase>` to force a jump.

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
- Under `RDC_TEST=1`: DB writes, web searches, builds, and deploys short-circuit; drift resolution, scoring, and file validation run normally

## Capture Lessons

Before the final verdict, follow `.rdc/guides/lessons-learned-spec.md` § Capture procedure. If this run exposed a non-obvious gap, write one `.rdc/lessons/<YYYY-MM-DD>-onramp-<slug>.md`. A run that taught nothing writes nothing.
