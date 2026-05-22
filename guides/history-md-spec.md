---
type: spec
role: history-md
systems: [place-fund, prt, plan]
schema_version: "1.0"
tags: [history-md, spec, rdc-skills, place-fund]
---
# HISTORY.md — Authoritative Specification
> Version: 1.0 | Effective: 2026-05-22

Every land-based project in the Place Fund ecosystem that satisfies the trigger predicate below
MUST carry a `places/<prt_slug>/HISTORY.md` file in the regen-root monorepo.
Skills that plan, scaffold, and validate real-estate PRT projects read this file to verify
research provenance, lineage completeness, and research lifecycle status.

---

## Purpose

`HISTORY.md` is the **land lineage record** for a Place Fund project — the authoritative
document linking a `prt_projects` row to its physical, ecological, cultural, and regulatory
history. It is NOT a marketing document. It is a research-grade provenance record that:

- Provides due-diligence depth for regenerative land stewardship decisions
- Anchors the project's data to verifiable primary sources (county records, PLSS, BLM, state archives)
- Tracks research lifecycle from `draft` through `peer-reviewed` so consumers know what to trust
- Enables the Place Fund's ecological and conservation underwriting to be audited independently

A missing or stub `HISTORY.md` signals that research is pending. A `published` one signals
that the record has been reviewed and is fit for external use.

---

## Trigger Predicate

A `prt_projects` row **requires** a `places/<slug>/HISTORY.md` when ALL of:

1. `project_type IN ('ranch','eco-hospitality','mixed','conservation','regenerative-agriculture','real-estate','development')`
2. `name IS NOT NULL` (always true for active rows)
3. AT LEAST ONE OF:
   - `location_state IS NOT NULL`
   - `location_city IS NOT NULL`
   - `country IS NOT NULL`
   - `total_acres IS NOT NULL`
   - `lat IS NOT NULL`
   - `EXISTS (SELECT 1 FROM geo_parcels WHERE project_id = prt_projects.id)`

**Excluded by default:** `project_type IN ('credit','water','tech','regenerative-model')` — these
are credit instruments or abstract models, not physical land parcels. Individual rows may be
opted in manually by a supervisor if a composite history is warranted.

As a SQL check (used by the validator):

```sql
SELECT slug, name, project_type, location_state, location_city, country, total_acres, lat
FROM prt_projects
WHERE is_template IS NOT TRUE
  AND project_type IN ('ranch','eco-hospitality','mixed','conservation',
                       'regenerative-agriculture','real-estate','development')
  AND (
    location_state IS NOT NULL
    OR location_city IS NOT NULL
    OR country IS NOT NULL
    OR total_acres IS NOT NULL
    OR lat IS NOT NULL
    OR EXISTS (SELECT 1 FROM geo_parcels WHERE project_id = prt_projects.id)
  )
ORDER BY slug;
```

---

## Schema

### Frontmatter Fields

Every `HISTORY.md` begins with YAML frontmatter bounded by `---` delimiters.

```yaml
---
schema_version: "1.0"
prt_slug: SLUG
project_type: ranch
location:
  county: COUNTY
  state: STATE
  country: COUNTRY
  parcel_apn: APN
  area_acres: ACRES
  centroid: [LAT, LNG]
acquired: "YYYY-MM-DD"
steward: STEWARD_NAME
research_status: draft
last_reviewed: "YYYY-MM-DD"
contributors: []
---
```

### Field Reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schema_version` | string | yes | Always `"1.0"` for this revision |
| `prt_slug` | string | yes | Must match `prt_projects.slug` exactly (case-sensitive) |
| `project_type` | string | yes | Echo from `prt_projects.project_type` |
| `location` | object | yes | Nested block — see sub-fields below |
| `location.county` | string | no | County or district name |
| `location.state` | string | no | State or province name or abbreviation |
| `location.country` | string | no | Country name; omit if USA |
| `location.parcel_apn` | string | no | Assessor's Parcel Number (APN) or equivalent |
| `location.area_acres` | number | no | Total acreage from authoritative source |
| `location.centroid` | [lat, lng] | no | Decimal-degree centroid coordinates |
| `acquired` | ISO date | no | Acquisition date (`YYYY-MM-DD`); omit if unknown |
| `steward` | string | yes | Current stewarding entity or person |
| `research_status` | enum | yes | One of: `draft` · `in-research` · `peer-reviewed` · `published` |
| `last_reviewed` | ISO date | yes | Date this file was last substantively reviewed |
| `contributors` | string[] | yes | Array of contributor identifiers (may be empty `[]`) |

#### `research_status` semantics

| Value | Meaning |
|-------|---------|
| `draft` | Stub created; no primary-source research yet |
| `in-research` | Active research underway; primary sources being identified |
| `peer-reviewed` | Research complete; reviewed by at least one secondary reviewer |
| `published` | Record approved for external publication and citation |

The validator will warn (not fail) on `draft` rows — they are expected during initial rollout.
The validator will fail if `research_status` is not one of the four allowed values.

---

## Required Body Sections

The body of `HISTORY.md` must contain all five section headings in order. Each section may
contain a TODO marker during draft status; it must contain substantive prose at `published`.

### `## Land lineage`

Deep time through present ownership. Cover:
- Pre-contact landscape and ecological baseline
- Indigenous stewardship, use patterns, and territorial context
- Spanish/Mexican land grants (if applicable)
- US government survey and PLSS reference (township, range, section)
- Homestead entry, patent, and early title chain
- Major ownership transitions to present

### `## Stewardship transitions`

Timeline of stewardship changes. Cover:
- Each major ownership or management transfer with approximate dates
- Conservation easements, deed restrictions, and encumbrances
- Use-change inflection points (e.g. dryland → irrigated, grazing → timber)
- Current stewardship entity and tenure

### `## Ecological context`

Physical and biological baseline. Cover:
- Ecoregion and watershed affiliation
- Soil classifications (NRCS Web Soil Survey references)
- Vegetation communities and cover types
- Water resources (streams, springs, riparian areas, aquifer)
- Wildlife corridors and listed species presence/absence
- Fire history and disturbance regime

### `## Cultural significance`

Human geography and intangible values. Cover:
- Indigenous place names and cultural associations (cite tribal consultation if any)
- Historic structures, archaeological sites, or cultural landscapes (Section 106 if applicable)
- Community significance — grazing allotments, water rights, access traditions
- Scenic and recreational values

### `## Regulatory record`

Legal, regulatory, and administrative context. Cover:
- Zoning and land use designations
- Conservation easements held by land trusts (ACE, TNC, CLT, etc.)
- Water rights adjudications
- Federal and state permits (grazing permits, NEPA actions, ESA consultations)
- Tax status (agricultural classification, conservation land designation)
- Open title or lien issues of record

---

## File Location Convention

```
C:/Dev/regen-root/places/<prt_slug>/HISTORY.md
```

The directory is named using the **sanitized slug** — lowercase, no special characters,
hyphens for separators. If `prt_projects.slug` contains uppercase letters (e.g. `Diamond`),
the filesystem path uses `diamond/HISTORY.md` while `prt_slug` in frontmatter preserves
the exact DB value (`Diamond`).

---

## Enforcement Layers

### Layer 1 — Workflow scaffold (`rdc:plan`)

When `rdc:plan` creates a new `prt_projects` row with a qualifying `project_type`, it reads
this spec and produces a stub `places/<slug>/HISTORY.md` from `scaffold/templates/HISTORY.md.template`.
The stub is committed alongside the epic creation commit so the file is never absent from day one.

### Layer 2 — Validator script

`C:/Dev/rdc-skills/scripts/validate-place-histories.js` runs in two modes:

| Mode | Behavior | Exit code |
|------|----------|-----------|
| `--mode warn` (default) | Missing or malformed HISTORY.md emits WARN; exits 0 | 0 |
| `--mode fail` | Missing or malformed HISTORY.md emits FAIL; exits 1 | 1 |

The validator is wired into the `rdc-skills` `prepack` step (warn mode) so it runs on every
package publish and surfaces gaps without blocking.

### Layer 3 — Optional DB gate (future)

A `history_md_status` column on `prt_projects` can mirror `research_status` from frontmatter
via a sync script. This enables Supabase-side filtering of projects by research completeness.
Not implemented in v1 — planned for a future epic.

---

## Consumer Integration

### `rdc:plan`

When scaffolding a new real-estate PRT project:
1. Check if `project_type` satisfies the trigger predicate.
2. If yes: hydrate `HISTORY.md.template` with DB row metadata and write `places/<slug>/HISTORY.md`.
3. Commit the stub alongside the epic creation commit.

### `rdc:review` / `rdc:build`

When the build scope touches `apps/prt/`:
1. Run `node C:/Dev/rdc-skills/scripts/validate-place-histories.js --mode warn`.
2. Surface any WARN lines in the review output.
3. Do not block on warn — block only on FAIL (malformed frontmatter).

---

## Example — Dos Pueblos Ranch (dp-phased-model)

```markdown
---
schema_version: "1.0"
prt_slug: dp-phased-model
project_type: ranch
location:
  county: Santa Barbara
  state: California
  country:
  parcel_apn:
  area_acres:
  centroid:
acquired:
steward: Dos Pueblos Ranch LLC
research_status: draft
last_reviewed: "2026-05-22"
contributors: []
---

> This is a draft stub. Research pending. Status will be promoted to in-research once primary sources are identified.

## Land lineage

TODO: Research land lineage of Dos Pueblos Ranch. Cover Chumash territory, Spanish rancho land grant (Rancho Dos Pueblos, c. 1842), Mexican land commission adjudication, US patent, and ownership chain to present.

## Stewardship transitions

TODO: Document major ownership and use transitions for Dos Pueblos Ranch from rancho era through current orchid and agricultural operations.

## Ecological context

TODO: Document ecoregion (Southern California Coast Ranges), chaparral and oak woodland communities, seasonal streams, and proximity to coastal wetlands.

## Cultural significance

TODO: Research Chumash place names and village associations. Note proximity to historic Chumash settlements along the Santa Barbara coast.

## Regulatory record

TODO: Document zoning (Santa Barbara County agricultural/rural zones), any conservation easements, and water rights in Goleta Water District service area.
```

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-05-22 | Initial spec — trigger predicate, schema, 5 required sections, 3-layer enforcement |
