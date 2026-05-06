---
name: rdc:plan
description: "No epic exists and you need architecture + task breakdown. Produces design decisions, tradeoffs, and Supabase epics/tasks with DoD checklists that feed rdc:build. Use after rdc:preplan or when given clear architectural direction."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag. Supabase epic/task writes and git push are skipped under `RDC_TEST=1`.


# rdc:plan — Architecture & Work Packages

## When to Use
- After `/rdc:preplan` produced research findings
- Project lead gives architectural direction ("build X with Y approach")
- An epic exists but needs breakdown into implementable tasks
- Before any large build session
- Called by `rdc:overnight` when an epic has no child tasks

## Arguments
- `rdc:plan <topic>` — interactive planning session
- `rdc:plan <epic-id> --unattended` — silent mode for overnight builds

## Procedure

1. **Gather inputs:**
   - Research doc from preplan (if exists): `.rdc/research/<topic>.md` (fallback: `.rdc/research/<topic>.md`)
   - Project lead's architectural direction from conversation
   - Relevant CLAUDE.md files from affected packages
   - Existing Supabase epics: `SELECT get_open_epics()`

2. **Read the codebase** — understand current state:
   - What packages are affected?
   - What types/interfaces already exist?
   - What tests exist?
   - What's the dependency graph?

3. **Make design decisions** — for each major choice:
   - State the decision clearly
   - Document what was chosen and what was rejected
   - Explain WHY (tradeoff rationale)
   - Note consequences and reversibility

4. **Define work packages** — break into agent-dispatchable units:
   - Each work package = one agent assignment
   - No file overlap between packages
   - Each package has: scope, files to create/modify, test plan
   - Assign an agent type to each work package from the typed dispatch table in rdc:build. Include the guide file path (from `.rdc/guides/`, fallback `.rdc/guides/`) in each work package description.
   - Estimate: small (1 agent, <500 LOC), medium (1 agent, 500-1500 LOC), large (needs splitting)

4b. **Build the checklist decomposition matrix (MANDATORY PRE-BUILD GATE):**

   Before writing Supabase work items, create a `## Checklist Decomposition Matrix`
   in the plan doc. This matrix is the source of truth for task checklists and
   build verification.

   Required columns:
   - Work item ID or placeholder
   - Atomic deliverable
   - Surface type: `screen`, `state`, `action`, `api`, `db`, `migration`, `component`, `asset`, `tool`, `test`, `doc`
   - Route or file path
   - Preconditions / fixture data
   - User or agent action
   - Expected UI/API/DB result
   - Verification artifact: test name, route probe, Playwright screenshot, SQL query, API response, type-check, migration proof, or CLI transcript
   - Owner work package
   - Status

   Atomicity rubric:
   - One observable behavior per row.
   - Each row names a concrete route or file path.
   - Each row names one concrete verification artifact.
   - Each row can independently pass or fail.
   - Each row is small enough for a worker to implement and tick without hidden intent.

   Required decomposition by surface:
   - UI screens: list empty, loading, loaded, error, create, edit, detail, delete/archive guard, mobile, and auth states where applicable.
   - UI actions: open, search, filter, select, duplicate, save, assign, activate, archive, delete, import, apply, cancel where applicable.
   - API routes: successful read/write, validation failure, unauthorized/forbidden, and side-effect verification where applicable.
   - DB/migrations: table/column/index/policy/trigger/function, FK/guard, rollback or smoke query, and type exposure.
   - CLI/sidebar/local tools: start, attach, enqueue, poll, reply, timeout/not-found, and live refresh where applicable.
   - Visual work: each named screenshot and visual checkpoint gets its own row.
   - Cross-system workflows: each handoff boundary gets its own row.

   Minimum row-count heuristics:
   - UI route: at least 4 rows.
   - CRUD surface: at least 6 rows.
   - API route: at least 3 rows.
   - DB work package: at least 5 rows.
   - Local editor/sidebar workflow: at least 5 rows.

   Reject these checklist items as too coarse:
   - "theme management works"
   - "build all screens"
   - "verify UI"
   - "integration complete"
   - "tests pass"

   Replace them with rows like:
   - `decomp-ui-theme-manager-loaded: /brands/[id]/theme shows owned theme rows with status, project usage, and actions; evidence: Playwright screenshot`
   - `decomp-action-duplicate-theme: duplicate submits source brand_theme_id and creates a new editable brand-owned copy; evidence: vitest + DB query`
   - `decomp-api-import-validation: POST /api/tools/theme-import rejects missing source URL with 400 JSON error; evidence: route probe`

   Add a `## Checklist Quality Gate` section with:
   - `verdict: PASS` only when every row passes the rubric.
   - `failures:` list any coarse, missing, duplicate, or unverifiable rows.
   - `deferred:` list any explicit out-of-scope rows.

   Do not create build-ready work items unless this gate is `PASS`.

5. **Write a test plan for each work package (MANDATORY):**

   Every work package MUST have a `test_plan` section with specific, concrete test items. Each item has a type:

   | Type | What it proves | How agent verifies | Example |
   |------|---------------|-------------------|---------|
   | `assert` | Logic is correct | Write a vitest test — input → expected output | `extractCode("```tsx\nfoo\n```") returns "foo"` |
   | `smoke` | It runs without crashing | Run command, check exit code / HTTP status | `tsc --noEmit passes`, `GET /api/layout/scan returns 200` |
   | `visual` | It looks right | Delegate to UI audit tool with specific checkpoints | `"/layout page renders container tree, not login screen"` |
   | `contract` | Interface matches spec | Check exports, prop types, response shape | `ScanResult has { roots: ContainerNode[] }` |

   **Rules for writing test plan items:**
   - Every item must be a specific, falsifiable assertion — not "write tests" or "verify it works"
   - Every item must map to one or more rows in the Checklist Decomposition Matrix.
   - A test plan item may summarize multiple checks only when the matrix still keeps those checks as separate atomic rows.
   - New functions/modules MUST have at least one `assert` item
   - API routes MUST have at least one `smoke` item
   - UI pages MUST have at least one `visual` item
   - New exports/types MUST have at least one `contract` item
   - `assert` and `smoke` are mandatory for every work package. `visual` and `contract` when applicable.

   **Example test plan in a plan doc:**
   ```markdown
   ### WP-2: AST Scanner
   **Test plan:**
   - assert: `scanFile` returns only Window/Frame/Pane/SubPane nodes, not Badge/Button
   - assert: SubPane nested directly in root produces a warning
   - assert: Valid Window > Frame > Pane > SubPane nesting produces no warnings
   - smoke: `GET /api/layout/scan?dir=apps/studio/src` returns 200 with JSON body
   - smoke: `npx tsc --noEmit` exits 0
   - contract: `ScanResult` has shape `{ filePath: string, roots: ContainerNode[], warnings: ScanWarning[] }`
   ```

6. **Write plan doc** to `.rdc/plans/<topic-slug>.md` (fallback: `.rdc/plans/<topic-slug>.md` if `.rdc/` does not exist):
   ```markdown
   # Plan: <Topic>
   > Generated: <date> | Epic: <id if exists>

   ## Goal
   ## Design Decisions
   ## Work Packages (each with test plan)
   ## Checklist Decomposition Matrix
   ## Checklist Quality Gate
   ## Sequencing (what can parallelize, what depends on what)
   ## Risks & Mitigations
   ```

7. **Create Supabase epic + child tasks:**
   - Epic via `insert_work_item(p_item_type := 'epic', p_definition_of_done := '[...]'::jsonb, ...)`
   - Epic DoD MUST include: `{"id":"test-plan-verified","text":"All test plan items implemented and passing","required":true,"checked":false}`
   - Set `p_definition_of_done` on the epic — child tasks inserted under it will auto-inherit it as their checklist
   - One task per work package via `insert_work_item(p_parent_id := <epic_id>, ...)` — checklist auto-hydrated from epic's DoD
   - **Additionally, write decomposition rows as checklist items** on each task, using id format `decomp-<surface>-<slug>`.
     The task checklist MUST include both the atomic `decomp-*` rows and the `test-*` verification rows.
     The `decomp-*` row text must include the route/file, action, expected result, and evidence artifact.
   - **Write test plan items as checklist items** on each task, using id format `test-<type>-<slug>`:
     ```sql
     SELECT insert_work_item(
       p_parent_id := '<epic_id>',
       p_title := 'WP-2: AST Scanner',
       p_checklist := '[
         {"id":"decomp-api-scan-success","text":"api: GET /api/layout/scan?dir=apps/studio/src returns 200 JSON with roots[] and warnings[]; evidence: route probe output","required":true,"checked":false},
         {"id":"test-assert-scanner-filters","text":"assert: scanFile returns only container components","required":true,"checked":false},
         {"id":"test-assert-nesting-warn","text":"assert: invalid nesting produces warnings","required":true,"checked":false},
         {"id":"test-smoke-scan-api","text":"smoke: GET /api/layout/scan returns 200","required":true,"checked":false},
         {"id":"test-contract-scanresult","text":"contract: ScanResult shape matches spec","required":true,"checked":false},
         {"id":"tsc-clean","text":"npx tsc --noEmit passes","required":true,"checked":false}
       ]'::jsonb
     );
     ```
   - Agents MUST tick each `decomp-*` and `test-*` checklist item as they implement/verify it (via `update_checklist_item`)
   - `update_work_item_status('done')` will REJECT if any `required: true` item is unchecked — this is the enforcement gate
   - Set priorities: urgent/high/normal based on sequencing

7. **Report results:**
   - Interactive: present the plan for approval before building
   - Unattended: skip approval, proceed immediately, emit status block:
     ```
     PLAN_STATUS: { epic_id, task_count, doc_path, waves }
     ```

## Unattended Escalation

When `--unattended` and genuine architectural ambiguity is detected — meaning multiple
valid approaches exist with significantly different tradeoffs (not just minor style choices)
— escalate via the advisor tool. Provide: the decision point, the options with tradeoffs,
and the project context. Resume with advisor's recommendation. If advisor is unavailable,
choose the most conservative/reversible approach and document the decision.

## Rules
- Interactive: ALWAYS get approval before proceeding to build
- Unattended: proceed immediately without approval
- Plan doc goes in `.rdc/plans/` (fallback: `.rdc/plans/` if `.rdc/` does not exist) — not `.planning/`
- Each work package must be independently executable by an agent
- No file overlap between work packages
- Include test requirements in every work package
- Reference affected CLAUDE.md files in each work package description
- Reference the relevant guide file from `.rdc/guides/` (fallback: `.rdc/guides/`) for agent context
- **If a work package involves creating a new deployed app:** the task description MUST say "Use `rdc:deploy new <slug>` — do NOT create the Coolify app manually. Read `docs/runbooks/coolify-app-templates.json` first." Assign it to an `infra` agent. This is a hard rule — manually created apps have consistently been misconfigured.

## New App Q&A (mandatory before writing any infra task that creates a Coolify app)

If the plan includes deploying a new app, these questions MUST be answered — in interactive mode, ask the user; in unattended mode, escalate via advisor. Do NOT write the infra task until all answers are locked in. Record answers in the plan doc and embed them directly in the task description.

**Never guess. Wrong project = delete and recreate. There is no move operation in Coolify.**

```
Q1. Which Coolify project does this app belong to?
    → Read docs/runbooks/coolify-app-templates.json → _infrastructure.projects
    → Match by area: design-system / prt / rdc / rdc-marketing / zoen / lifeai / place-fund / infrastructure / ai-platform
    → If unsure: ASK. Do not infer from app name alone.
    → Record: project_uuid + environment_uuid (staging or production)

Q2. What is the domain?
    → *.dev.place.fund subdomain? (staging / internal tools)
    → Custom subdomain on an existing zone? (e.g. app.regendevcorp.com)
    → Apex domain? (e.g. place.fund itself)
    → Domain on a different zone entirely? (e.g. skymesasouth.com)

Q3. Is this domain already in our Cloudflare account?
    → Yes, zone exists → which zone?
    → No → who controls the nameservers? Does the registrar point NS to Cloudflare?
    → If NS not delegated to Cloudflare: A record in Cloudflare does nothing — must go to registrar

Q4. Does this app need Cloudflare proxy (orange cloud)?
    → *.dev.place.fund: NEVER proxy — breaks Traefik Let's Encrypt HTTP-01 cert provisioning
    → Custom domain needing DDoS/CDN: proxy OK only if SSL mode = Full (strict) + origin cert provisioned
    → Any doubt: start unproxied, add proxy after confirming SSL works

Q5. What SSL path?
    → Traefik + Let's Encrypt (default for all unproxied): automatic, no action needed
    → Cloudflare proxy + Full (strict): need origin cert from Cloudflare dashboard first
    → Nixpacks build pack: DO NOT USE for any app that needs custom SSL setup — nixpacks
      containers have incompatible SSL configuration requirements. Use dockerfile build pack only.
```

Embed all five answers into the infra task description verbatim before handing to the agent.
