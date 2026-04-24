---
name: rdc:plan
description: >-
  Usage `rdc:plan <topic> [--unattended]` — architecture doc with design decisions, tradeoffs, work packages. Creates Supabase epics/tasks. Use after rdc:preplan or when given clear architectural direction.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


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

1. **Load source documents — MANDATORY before any planning decisions.**

   **Step 1a — Always load these regardless of topic:**
   ```
   .claude/rules/infrastructure-contract.md   — hard deployment + registry rules
   .claude/rules/work-items-rpc.md            — work item schema, RPC, status enums
   .claude/rules/system-quick-links.md        — routing map to all system architecture docs
   .claude/rules/version-numbering.md         — version bump rules for affected packages
   ```

   **Step 1b — Identify affected domains, then load the matching architecture doc:**

   | Domain keywords in topic | Architecture doc to read |
   |--------------------------|---------------------------|
   | PRT, trust, capital, NAV, investor, land, DST | `docs/systems/prt/ARCHITECTURE.md` |
   | CS 2.0, HAIL, PAL, virtue, quad-pixel, ontology, BPMN, cognitive | `docs/systems/cs2/ARCHITECTURE.md` |
   | marketing, CRM, campaign, contact, outreach, RDC app | `docs/systems/rdc/ARCHITECTURE.md` |
   | Claude workflow, skills, agents, dispatch, rdc:build | `docs/systems/claude-workflow/ARCHITECTURE.md` |
   | Life AI, LIFEAI platform, life.ai | `docs/systems/lifeai/ARCHITECTURE.md` |
   | media, R2, images, regen-media, MCP image | `docs/systems/media/ARCHITECTURE.md` |
   | UI, component, brand, design token, shared, OG image | `docs/systems/shared/ARCHITECTURE.md` |

   If the topic spans multiple domains: read ALL matching architecture docs before proceeding.
   A plan that contradicts an existing architecture doc is invalid — load them first.

   **Step 1c — Load domain-specific rules and context files:**

   | Domain | Additional files to read |
   |--------|---------------------------|
   | CS 2.0 / any CS2 paradigm work | `.claude/rules/cs2-architecture-first.md` |
   | Database, schema, migrations, RPC | `.claude/context/supabase-schema.md` |
   | UI, components, brand, tokens | `.claude/context/design-system-global.md` |
   | Deploy, infrastructure, DNS, SSL | `.claude/context/coolify-deployment.md` |
   | Credentials, MCP, clauth, subagents | `.claude/context/clauth.md` |
   | OG images, social meta, brand assets | `.claude/context/brand-gate.md` |
   | Cross-platform, Cowork, subagent MCP | `.claude/context/platform-cross-ref.md` |
   | MCP server development | `.claude/context/mcp-server-auth.md` |

   **Step 1d — Load CLAUDE.md for every affected package:**
   - Identify which packages in `packages/` will be created or modified
   - Read `packages/<name>/CLAUDE.md` for each one that has one
   - Mandatory: `packages/supabase/CLAUDE.md` if any DB work is involved
   - Mandatory: `packages/ui/CLAUDE.md` if any UI work is involved
   - Read `packages/<name>/package.json` to understand current exports and dependencies

2. **Gather additional inputs:**
   - Research doc from preplan (if exists): `.rdc/research/<topic>.md` (fallback: `.rdc/research/<topic>.md`)
   - Project lead's architectural direction from conversation
   - Existing Supabase epics: `SELECT get_open_epics()`
   - Check `prototype_registry` for any existing prototypes on this topic:
     ```sql
     SELECT name, component, source_path, status FROM prototype_registry
     WHERE status IN ('prototype', 'converting') ORDER BY created_at DESC;
     ```
   - Check `design_context` for prior design decisions:
     ```sql
     SELECT topic, context_type, summary FROM design_context
     WHERE topic ILIKE '%<topic>%' ORDER BY created_at DESC;
     ```

3. **Read the codebase** — understand current state:
   - What packages are affected?
   - What types/interfaces already exist?
   - What tests exist?
   - What's the dependency graph?

4. **Make design decisions** — for each major choice:
   - State the decision clearly
   - Document what was chosen and what was rejected
   - Explain WHY (tradeoff rationale)
   - Note consequences and reversibility
   - **Verify the decision does not contradict any loaded architecture doc** — if it does, flag the conflict before proceeding

5. **Define work packages** — break into agent-dispatchable units:
   - Each work package = one agent assignment
   - No file overlap between packages
   - Each package has: scope, files to create/modify, test requirements
   - Assign an agent type to each work package from the typed dispatch table in rdc:build
   - Include the guide file path (from `.rdc/guides/`, fallback `.rdc/guides/`) in each work package description
   - Include any relevant architecture doc, context file, or package CLAUDE.md the agent must read
   - Estimate: small (1 agent, <500 LOC), medium (1 agent, 500-1500 LOC), large (needs splitting)

6. **Write plan doc** to `.rdc/plans/<topic-slug>.md` (fallback: `.rdc/plans/<topic-slug>.md` if `.rdc/` does not exist):
   ```markdown
   # Plan: <Topic>
   > Generated: <date> | Epic: <id if exists>

   ## Source Documents Read
   (list every architecture doc, rules file, context file, and package CLAUDE.md loaded in Step 1)

   ## Goal
   ## Design Decisions
   ## Work Packages
   (each package must include: agent type, guide file, architecture docs agent must read, files to create/modify, test requirements)
   ## Sequencing (what can parallelize, what depends on what)
   ## Risks & Mitigations
   ## Architecture Doc Conflicts (if any)
   ```

7. **Create Supabase epic + child tasks:**
   - Epic via `insert_work_item(p_item_type := 'epic', ...)`
   - One task per work package via `insert_work_item(p_parent_id := <epic_id>, ...)`
   - Set priorities: urgent/high/normal based on sequencing

8. **Report results:**
   - Interactive: present the plan for approval before building
   - Unattended: skip approval, proceed immediately, emit status block:
     ```
     PLAN_STATUS: { epic_id, task_count, doc_path, waves, source_docs_read: [list], architecture_conflicts: [] }
     ```

## Unattended Escalation

When `--unattended` and genuine architectural ambiguity is detected — meaning multiple
valid approaches exist with significantly different tradeoffs (not just minor style choices)
— escalate via the advisor tool. Provide: the decision point, the options with tradeoffs,
and the project context. Resume with advisor's recommendation. If advisor is unavailable,
choose the most conservative/reversible approach and document the decision.

## Rules
- **Source documents in Step 1 are MANDATORY — a plan that hasn't read the architecture docs is invalid**
- Interactive: ALWAYS get approval before proceeding to build
- Unattended: proceed immediately without approval
- Plan doc goes in `.rdc/plans/` (fallback: `.rdc/plans/` if `.rdc/` does not exist) — not `.planning/`
- Each work package must be independently executable by an agent
- No file overlap between work packages
- Include test requirements in every work package
- Reference affected CLAUDE.md files and architecture docs in each work package description
- Reference the relevant guide file from `.rdc/guides/` (fallback: `.rdc/guides/`) for agent context
- Always list source docs read in the output doc header and status block
