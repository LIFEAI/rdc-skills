---
name: rdc:onramp
description: "Usage `rdc:onramp <slug> --name \"<Display Name>\"` — Idempotent Phase-1 enrollment orchestrator for a new Place Fund project. Resolves drift state, then runs three ordered steps in strict sequence: (1) `enroll_place` Supabase RPC → creates DB spine (places + project_nodes + project_places); (2) `insert_work_item` → opens enrollment epic bound to the project_node_id; (3) `scripts/onramp-scaffold-place.mjs` → writes `places/<slug>/` disk tree. Never reimplements any door. Four drift states: fresh | already-enrolled | spine-ahead | disk-ahead (disk-ahead STOPs and opens a reconciliation work item)."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first, then `{PROJECT_ROOT}/.rdc/guides/engineering-behavior.md`.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. All three external steps (enroll_place RPC, insert_work_item RPC, scaffolder) short-circuit under the flag. Drift resolution and arg validation run normally.

> **RPMS compliance:** Encodes the Four Laws (One Home Per Fact · One Direction · One Door · One Spine). Each fact is written to its one home. **⛔ NEVER write `places/<slug>/_context.md`** — it is a generated projection owned by `apps/studio/src/lib/context-export-writer.ts`. A post-scaffold gate asserts its absence; the skill halts if found.

> **Purely additive — no architectural-approval interview required** per plan D5 in `.rdc/plans/rdc-onramp-skill.md`: adds one new skill dir and one `skills_meta` key; changes no existing skill, schema, MCP tool, routing, or build/deploy config.

# rdc:onramp — Phase-1 Enrollment Orchestrator

## When to Use

- Enrolling a new Place Fund project for the first time (fresh state)
- Healing a spine-ahead state (DB row exists, disk tree missing)
- Checking current enrollment state without writing (`--dry-run`)
- Re-running enrollment to converge to a consistent state (idempotent)

## When NOT to Use — escalate to the right tool

- Research phase → paste [`corpus/_shared/onramp/STARTUP.md`](file:///C:/Dev/regen-root/corpus/_shared/onramp/STARTUP.md) into a claude.ai studio project
- Brand/design → `rdc:design`
- Site build → `rdc:build` (after research is complete)
- Any architectural change → `rdc:plan` + approval interview

## Argument Contract

```
rdc:onramp <slug> --name "<Display Name>" [--location <json>] [--archetype <archetype>]
                  [--owner <place-fund|rdc|jv|client>] [--history] [--dry-run]
```

| Arg / Flag | Required | Default | Description |
|------------|----------|---------|-------------|
| `slug` | **yes** | — | kebab-case, place-anchored (e.g. `spirit-bear-village`). Validated against `^[a-z0-9]+(-[a-z0-9]+)*$`. |
| `--name` | **yes** | — | Human display name. Passed verbatim to `enroll_place` and the scaffolder. |
| `--location` | no | `{}` | JSON object for `enroll_place p_location` (e.g. `{"state":"BC","country":"Canada"}`). Never guessed — omit entirely if unknown. |
| `--archetype` | no | `TBD` | Base-arc archetype. See [`corpus/_shared/onramp/ARCHETYPES.md`](file:///C:/Dev/regen-root/corpus/_shared/onramp/ARCHETYPES.md). |
| `--owner` | no | `place-fund` | `place-fund` \| `rdc` \| `jv` \| `client` |
| `--history` | no | off | Opt-in: also scaffold `places/<slug>/HISTORY.md`. See D4 in the plan for when to use. |
| `--dry-run` | no | off | Resolve drift + print plan; perform NO writes (no RPC, no scaffold, no work item). |

`--status` is not exposed — always `enrolling` (Phase-1 invariant; the Studio promotes to `active` later).

## Procedure

### 0. Preflight

Emit the full checklist below before any further action:

```
- [ ] Preflight — validate slug + --name; parse flags
- [ ] Resolve drift — classify: fresh | already-enrolled | spine-ahead | disk-ahead
- [ ] Spine — enroll_place RPC (Step 1)
- [ ] Epic — dup-guard + insert_work_item (Step 2)
- [ ] Disk tree — onramp-scaffold-place.mjs (Step 3)
- [ ] HISTORY advisory
- [ ] Report — structural facts + ONE next action
```

Validate before any external call:
- `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$` — reject if not
- `--name` is present and non-empty — reject if not
- `--dry-run` set → print plan and exit after drift resolution, no writes

### 1. Resolve Drift State

Read-only DB probe (analytics SELECT is allowed per `.claude/rules/work-items-rpc.md`):
```sql
SELECT id, slug, name, status FROM places WHERE slug = '<slug>';
```

Check disk:
```bash
test -d "places/<slug>/" && echo "disk:present" || echo "disk:absent"
```

| State | Detection | Action |
|-------|-----------|--------|
| **fresh** | No DB row AND no disk dir | Run all three steps in order |
| **already-enrolled** | DB row exists AND disk dir exists | `enroll_place` (idempotent, returns existing node); scaffolder skips existing files; epic dup-guarded. Report "already enrolled — no new writes." |
| **spine-ahead** | DB row exists, disk dir ABSENT | Re-call `enroll_place` (returns existing `project_node_id`); run scaffolder to create missing disk tree |
| **disk-ahead** | Disk dir exists, NO DB row | **⛔ STOP — colliding identity.** Open reconciliation work item; report; exit. Never proceed. |

**disk-ahead STOP protocol — run this, then exit:**
```sql
SELECT insert_work_item(
  p_title       := 'reconcile: disk-ahead conflict for <slug>',
  p_item_type   := 'bug',
  p_priority    := 'urgent',
  p_source      := 'onramp',
  p_description := 'places/<slug>/ exists on disk but has no places DB row. A disk tree with no spine row is an unreconciled state. Manual reconciliation needed before enrollment can proceed — this may describe a different place. Do not auto-enroll.'
);
```

Report the work-item id and the disk-ahead explanation, then exit. Never proceed to Step 1.

### 2. Step 1 — DB Spine (`enroll_place`)

This RPC is idempotent: calling it for an already-enrolled place returns the existing `project_node_id` without creating duplicate rows.

**Supabase MCP (preferred):**
```sql
SELECT enroll_place('<slug>', '<Display Name>', '<location_json>'::jsonb, 'enrolling');
```

`project_id = uvojezuorjgqzmhhgluu` is REQUIRED on every MCP call. An `InputValidationError` means it was omitted — pass it and retry; do not fall back to raw credentials.

**Subagent fallback** (if Supabase MCP is unavailable in this context):
```
Agent({
  prompt: "Call Supabase RPC with Supabase MCP tool (mcp__claude_ai_Supabase__execute_sql).
           project_id: uvojezuorjgqzmhhgluu
           query: SELECT enroll_place('<slug>', '<name>', '{}'::jsonb, 'enrolling');
           Return the project_node_id from the result JSON.
           Never raw curl to *.supabase.co — hookify-blocked."
})
```

**GATE:** Capture `project_node_id` from the returned JSONB. If absent → emit the `BLOCKED:` template from `.claude/rules/infrastructure-contract.md`, stop. Never proceed without a `project_node_id`.

Under `RDC_TEST=1`:
```
[RDC_TEST] skipping enroll_place RPC — using placeholder project_node_id
```

### 3. Step 2 — Enrollment Epic (`insert_work_item`)

**Dup-guard first** (raw SELECT allowed for analytics):
```sql
SELECT id, title FROM work_items
WHERE title = 'epic: enroll <slug>'
  AND project_node_id = '<project_node_id>'::uuid
  AND item_type = 'epic'
  AND status NOT IN ('done', 'archived')
LIMIT 1;
```

If a row is returned: reuse the existing id — do NOT insert a duplicate.

If no row: create the epic:
```sql
SELECT insert_work_item(
  p_title           := 'epic: enroll <slug>',
  p_item_type       := 'epic',
  p_priority        := 'high',
  p_source          := 'onramp',
  p_project_node_id := '<project_node_id>'::uuid
);
```

**GATE:** The epic id (new or reused) must be captured before proceeding to Step 3.

Under `RDC_TEST=1`:
```
[RDC_TEST] skipping insert_work_item — using placeholder epic id
```

### 4. Step 3 — Disk Tree (`onramp-scaffold-place.mjs`)

```bash
node scripts/onramp-scaffold-place.mjs --slug <slug> --name "<Display Name>" \
  [--archetype <archetype>] [--owner <owner>] [--history (if --history flag was passed)]
```

The script is DB-free, idempotent (skips existing files), and writes NO `_context.md`. It produces:
`places/<slug>/PLACE.md · corpus/INDEX.md · arc/01–06/ · PRODUCT.md · DESIGN.md · HANDOFF.md · tracker/*`

**Post-run invariant gate (HARD — halt if violated):**
```bash
test ! -f "places/<slug>/_context.md" \
  && echo "_context.md absent: ✓" \
  || echo "FAIL: _context.md present — projection-drift violation"
```

If `_context.md` is found: **STOP immediately** and report a FAIL. The projection is owned by `context-export-writer.ts` — any hand-authored copy is a Law 3 violation. Do not proceed.

Under `RDC_TEST=1`:
```
[RDC_TEST] skipping onramp-scaffold-place.mjs
[RDC_TEST] skipping _context.md gate (no scaffold ran)
```

### 5. HISTORY Advisory

Always print:

```
ℹ️  HISTORY.md advisory
   places/<slug>/HISTORY.md may be required once prt_projects.project_type is known.
   Qualifying types: ranch · eco-hospitality · mixed · conservation · regenerative-agriculture · real-estate · development
   Excluded types:   credit · water · tech · regenerative-model
   To scaffold now: pass --history on this run or re-run with it.
```

If `--history` was passed: the scaffolder above already included the flag. Confirm in output.

### 6. Report

Print the completed checklist (all rows checked), then a single verdict line:

```
✅ rdc:onramp — <slug> [<drift-state>]

  DB spine:     places.slug=<slug>
                project_nodes.slug=prtnode-<slug>
                project_node_id=<uuid>
  Epic:         <work-item-id> (<new|reused>)
  Disk tree:    places/<slug>/  (created=N  skipped=M)
  _context.md:  absent ✓

  ─────────────────────────────────────────────
  NEXT ACTION — RESEARCH PHASE:
  Paste corpus/_shared/onramp/STARTUP.md
  into a new claude.ai studio project
  (PROJECT NAME = <slug>) to begin research.
  ─────────────────────────────────────────────
```

Every file path and URL must be a clickable markdown hyperlink per [`.claude/rules/clickable-output.md`](file:///C:/Dev/regen-root/.claude/rules/clickable-output.md).

## Convergence Guarantee

Every step is idempotent. Re-running `rdc:onramp <slug>` for an already-enrolled place performs zero new writes and reports "already enrolled." It never duplicates a spine row, an epic, or a disk file.

## Rules

- Validate `slug` and `--name` before any external call — reject invalid slugs immediately
- `enroll_place` is the ONLY door for spine rows — never raw INSERT into `places`, `project_nodes`, or `project_places`
- `insert_work_item` is the ONLY door for work items — never raw INSERT into `work_items`
- `onramp-scaffold-place.mjs` is the ONLY door for the disk tree — never hand-write `places/<slug>/` files outside the script
- Dup-guard the epic before inserting — one analytics SELECT, never two insert calls
- Assert `_context.md` ABSENT after scaffolding — hard stop if present
- disk-ahead → STOP, open reconciliation work item, never call `enroll_place` over an unknown disk tree
- `--status` is always `enrolling` — never exposed as a flag
- Under `RDC_TEST=1`: arg validation + drift resolution run; all three external steps short-circuit

## Capture Lessons

Before the final verdict, follow `.rdc/guides/lessons-learned-spec.md` § Capture procedure. If this run exposed a non-obvious gap — unexpected DB state, scaffolder behavior, drift edge case, RPC shape change — write one `.rdc/lessons/<YYYY-MM-DD>-onramp-<slug>.md`. Commit alongside the run's other commits. A run that taught nothing writes nothing.
