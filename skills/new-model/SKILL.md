---
name: new-model
description: >
  Register a new Reference Model completely — the yes/no gate that prevents half-registered models.
  A reference model is DEFINED as registered in all four homes: (1) RPMS project_nodes row
  (node_type=reference_model), (2) apps/vlas route group /models/<slug>, (3) apps/vlas
  src/data/models/<slug> definitions, (4) global-corpus Drive directory. If ANY of the four is
  missing, the model does not exist yet — run this skill.
  TRIGGER: 'rdc:new-model', 'rdc new model', 'create model', 'new reference model', 'add a model',
  'register model', 'new model for', 'model for conservation easements', 'is this model registered',
  'model registration check'.
---

# rdc:new-model — Reference Model Registration (complete or not at all)

## When to run
- Creating any new reference model (conservation easement, regen data center, etc.)
- ANY time a model page/idea exists but you cannot confirm all four homes below
- Asked "is <model> registered?" → run the CHECK phase, report yes/no per home, offer to complete

## The four homes (a model exists ONLY when all four do)
1. **RPMS node** — `project_nodes` row: `node_type='reference_model'`, slug matches route slug exactly, status active, non-null description, metadata JSONB `{model_kind, capitals_profile, pathway_version, catalog_version, tabs}` when known.
2. **Routes** — `apps/vlas/src/app/models/<slug>/` (or `(library)/<slug>/` for library-page models) + entry on the models library index.
3. **Definitions** — `apps/vlas/src/data/models/<slug>/` (engine/constants/prompts as applicable; may start minimal).
4. **Corpus** — Google Drive `global-corpus/VLAS/models/<slug>/` with subdirs `_working, _archive, _originals, diagrams, docs`. Drive models root folder ID: `1ua4zXohgZeYsZZTb1kUdnPqfN4eQAHuU`; copy structure from `_template` (`1ZVeq7iycg-dzG_iAKXrbTqIFYa6E26bQ`). Access Drive ONLY via the Google Drive connector (claude.ai) — H:\My Drive is NOT under any FS mount. From the CLI, the local sync path `H:\My Drive\global-corpus\VLAS\models\` may be used directly.

## Procedure
### Phase 0 — CHECK (always first; idempotent)
For the given slug, verify each home. Output a 4-line yes/no table. If all yes → report "registered" and stop.
### Phase 1 — REGISTER (only the missing homes; never duplicate)
- RPMS: INSERT project_nodes with ON CONFLICT (slug) DO NOTHING; RETURNING id. Slug is kebab-case, matches route.
- Routes/definitions: scaffold minimal `/models/<slug>/page.tsx` + `src/data/models/<slug>/index.ts` if absent (full build is a separate plan/epic — this skill registers, it does not build the site).
- Corpus: create `<slug>/` + the five subdirs under the models root.
### Phase 2 — RECORD
- Add the model to the library index page if missing.
- If created from claude.ai: note node id + Drive folder id in the session; if a related epic exists, add a note via update_work_item_status.
- Commit any repo changes on develop with a Work-Item trailer.

## Rules
- NEVER create a model in fewer than four homes. Partial registration is the failure mode this skill exists to kill (it happened twice: regen-data-center shipped with a bare node; regenerative-development-and-design shipped with no node and no corpus dir).
- Slug is identical everywhere. No spaces, no case variants.
- Models NEVER live on place.fund, PRT, TPF, or RDC surfaces — VLAS only (models are teaching instruments of the standard).
- Catalog scoping: if the model needs interventions, decide model_slug scoping on stewardship_interventions BEFORE seeding (see library-conventions epic ba1b5d5d).

## Done means
- [ ] Four-home check table all YES
- [ ] Node id + Drive folder id reported
- [ ] Library index lists the model
- [ ] Repo changes committed (develop, trailer)
