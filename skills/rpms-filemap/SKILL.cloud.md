---
name: rpms-filemap
description: "Generated RPMS file map — RULE #1, canonical homes, and Context Export pointers served from regen-root manifest."
slash: "rdc:rpms-filemap"
category: "tooling"
usage: "rdc:rpms-filemap"
requires: []
triggers:
  - "rpms file map"
  - "rule #1"
  - "context export"
  - "where does this file belong"
  - "where should pm artifacts go"
---
# RPMS File Map
> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Return the requested file-map guidance directly; do not dump raw manifests or logs.

> GENERATED FILE - DO NOT HAND-EDIT.
> Source of truth: `docs/architecture/rpms.locations.json`
> Regenerate: `pnpm rpms:gen-filemap`

## RULE #1

**Name the entity -> read its `_context.md` -> you are oriented.**

The operational door is pinned in `docs/architecture/CONTEXT-EXPORT.md` and in RPMS section 8.1.
If you are touching an entity, read its generated `_context.md` before any local reasoning, and never hand-edit that projection.

## Pointers

- RPMS section 6a: Asset lens and branch-store split
- RPMS section 6b: Corpus disk layout
- RPMS section 8.1: Session-start ritual and locked-decision read order

## Canonical Map

### Canonical Sources

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `canon.rpms.architecture` | `docs/architecture/regenerative-project-management-system.md` | `read_only` | One Home Per Fact, One Door | `block_wrong_home`<br />`path_conformance` | docs/architecture/regenerative-project-management-system.md | `active` |
| `canon.context-export.single-door` | `docs/architecture/CONTEXT-EXPORT.md` | `read_only` | One Direction, One Door | `block_wrong_home`<br />`path_conformance` | docs/architecture/CONTEXT-EXPORT.md | `active` |

### Session Start

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `session-start.claude-ai.root` | `CLAUDE.ai.md` | `read_only` | One Door | `block_wrong_home`<br />`path_conformance` | repo-root | `active` |
| `session-start.claude.root` | `CLAUDE.md` | `read_only` | One Door | `block_wrong_home`<br />`path_conformance` | repo-root | `active` |
| `session-start.decision.spine-lock` | `.rdc/plans/project-relationship-graph-approval.md` | `read_only` | One Spine, One Door | `block_wrong_home`<br />`path_conformance` | .rdc/plans/project-relationship-graph-approval.md | `active` |
| `session-start.decision.cs2-lock` | `.rdc/plans/mdk-knowledge-decisions-and-workitems-2026-06-02.md` | `read_only` | One Direction, One Door | `block_wrong_home`<br />`path_conformance` | .rdc/plans/mdk-knowledge-decisions-and-workitems-2026-06-02.md | `active` |
| `session-start.glossary.layer-model` | `docs/systems/cs2/LAYER-MODEL-AND-VOCABULARY.md` | `read_only` | One Door | `block_wrong_home`<br />`path_conformance` | docs/systems/cs2/LAYER-MODEL-AND-VOCABULARY.md | `active` |

### Database Gates

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `session-start.work-items.queue` | `table:work_items via rpc:get_open_epics` | `rpc_only` | One Home Per Fact, One Door | `rpc_only`<br />`rpc_contract`<br />CRUD stays behind insert_work_item/update_work_item_status/update_checklist_item/submit_implementation_report. | public.work_items + RPC gate | `active` |

### Place Corpus

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `session-start.entity-context.place` | `places/*/_context.md`<br />created_by: `apps/studio/src/lib/context-export-writer.ts` | `generated` | One Direction, One Door | `block_manual_edit`<br />`projection_drift` | context-export writer | `active` |
| `place.identity.place-md` | `places/*/PLACE.md` | `authored` | One Home Per Fact, One Door | `allow_declared_home`<br />`path_conformance` | place stewards | `active` |
| `place.history.history-md` | `places/*/HISTORY.md` | `append_only` | One Direction, One Home Per Fact | `allow_declared_home`<br />`path_conformance` | place stewards | `active` |
| `place.corpus.index` | `places/*/corpus/INDEX.md` | `authored` | One Home Per Fact, One Door | `allow_declared_home`<br />`path_conformance` | place corpus | `active` |
| `place.corpus.documents` | `places/*/corpus/**` | `authored` | One Home Per Fact | `block_binary_commit`<br />`binary_ban`<br />Text and markdown live here; binaries route to branch stores. | place corpus | `active` |
| `place.artifacts.outputs` | `places/*/artifacts/**` | `generated` | One Direction | `allow_declared_home`<br />`path_conformance` | render pipelines | `active` |
| `place.legacy.asset-bundles` | `places/*/*.assets/**` | `legacy_frozen` | One Direction, One Home Per Fact | `block_manual_edit`<br />`path_conformance`<br />Bridge-state allowlist for current repo reality; no new writes here. | legacy bridge until asset-lens migration | `active` |
| `place.tracker.pm-docs` | `places/*/tracker/**` | `authored` | One Home Per Fact | `block_binary_commit`<br />`binary_ban` | place operators | `active` |

### Shared Corpus

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `session-start.entity-context.project-node` | `corpus/_shared/*/_context.md`<br />created_by: `apps/studio/src/lib/context-export-writer.ts` | `generated` | One Direction, One Door | `block_manual_edit`<br />`projection_drift` | context-export writer | `active` |
| `shared.index` | `corpus/_shared/*/INDEX.md` | `authored` | One Home Per Fact, One Door | `allow_declared_home`<br />`path_conformance` | shared corpus | `active` |
| `shared.framework.documents` | `corpus/_shared/*/framework/**` | `authored` | One Home Per Fact | `block_binary_commit`<br />`binary_ban` | shared corpus | `active` |
| `shared.research.documents` | `corpus/_shared/*/research/**` | `authored` | One Home Per Fact | `block_binary_commit`<br />`binary_ban` | shared corpus | `active` |
| `shared.legacy.design-assets` | `corpus/_shared/*/design/**/assets/**` | `legacy_frozen` | One Direction, One Home Per Fact | `block_manual_edit`<br />`path_conformance`<br />Bridge-state allowlist for current repo reality; no new writes here. | legacy bridge until asset-lens migration | `active` |
| `shared.corpus.documents` | `corpus/_shared/` | `authored` | One Home Per Fact | `block_binary_commit`<br />`binary_ban`<br />Generated _context.md remains separately governed by projection drift. | shared corpus | `active` |

### Asset Lens

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `asset-lens.entity-assets.registry` | `table:entity_assets` | `deferred` | One Spine, One Home Per Fact | `deferred`<br />`deferred`<br />Manifest records the canonical home now; implementation remains deferred per plan section 6a E7. | RPMS E7 | `deferred` |

### Operational Door

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `operational-door.rdc.plans` | `.rdc/plans/**` | `authored` | One Home Per Fact, One Direction | `allow_declared_home`<br />`path_conformance` | RDC planning workflow | `active` |
| `operational-door.rdc.reports` | `.rdc/reports/**` | `generated` | One Direction | `allow_declared_home`<br />`path_conformance` | rdc:report | `active` |
| `operational-door.rdc.lessons` | `.rdc/lessons/**` | `append_only` | One Direction, One Home Per Fact | `allow_declared_home`<br />`path_conformance` | RDC lesson capture workflow | `active` |
| `operational-door.rpms-filemap.rule` | `.claude/rules/rpms-filemap.md`<br />created_by: `scripts/rpms/gen-filemap.ts` | `generated` | One Home Per Fact, One Direction, One Door | `block_manual_edit`<br />`projection_drift` | scripts/rpms/gen-filemap.ts | `active` |

### App Guides

| Artifact | Home | RW | Law | Enforcement | Owner | Status |
|----------|------|----|-----|-------------|-------|--------|
| `session-start.app-guide` | `apps/*/CLAUDE.md` | `read_only` | One Door | `block_wrong_home`<br />`path_conformance` | app-local architecture guides | `active` |

## Projection Contract

- Generated projections (`_context.md`, this rule) are never hand-edited.
- Authored markdown stays in its declared home; do not create second homes elsewhere.
- `work_items` stays RPC-only even when the location is documented here.
- Corpus homes are text-first; binaries route to branch stores, not git under `places/` or `corpus/`.
