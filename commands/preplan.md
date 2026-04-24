---
name: rdc:preplan
description: >-
  Usage `rdc:preplan <topic> [--unattended]` — research best practices, analyze codebase, compare approaches, surface unknowns before committing to a plan. Produces a research doc. No decisions, no code.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:preplan — Research Before Planning

## When to Use
- Starting a new feature area you haven't built before
- Need to understand how best-in-class projects solve a problem
- Codebase has unknowns that need mapping before planning
- Project lead says "research", "look into", "what's the best way to", "how do others do"
- Called by `rdc:overnight` before planning an epic with no existing tasks

## Arguments
- `rdc:preplan <topic>` — interactive research session
- `rdc:preplan <topic> --unattended` — silent mode for overnight builds

## Procedure

1. **Parse the topic** from user input or epic title/description.
   - Interactive: if vague, ask ONE clarifying question before proceeding
   - Unattended: infer from the epic title + description — never pause to ask

2. **Load source documents — MANDATORY before any analysis.**

   **Step 2a — Always load these regardless of topic:**
   ```
   .claude/rules/infrastructure-contract.md   — hard deployment + registry rules
   .claude/rules/work-items-rpc.md            — work item schema and RPC patterns
   .claude/rules/system-quick-links.md        — routing map to system architecture docs
   ```

   **Step 2b — Identify affected domains, then load the matching architecture doc:**

   | Domain keywords in topic | Architecture doc to read |
   |--------------------------|---------------------------|
   | PRT, trust, capital, NAV, investor, land, DST | `docs/systems/prt/ARCHITECTURE.md` |
   | CS 2.0, HAIL, PAL, virtue, quad-pixel, ontology, BPMN, cognitive | `docs/systems/cs2/ARCHITECTURE.md` |
   | marketing, CRM, campaign, contact, outreach, RDC app | `docs/systems/rdc/ARCHITECTURE.md` |
   | Claude workflow, skills, agents, dispatch, rdc:build | `docs/systems/claude-workflow/ARCHITECTURE.md` |
   | Life AI, LIFEAI platform, life.ai | `docs/systems/lifeai/ARCHITECTURE.md` |
   | media, R2, images, regen-media, MCP image | `docs/systems/media/ARCHITECTURE.md` |
   | UI, component, brand, design token, shared, OG image | `docs/systems/shared/ARCHITECTURE.md` |

   If topic spans multiple domains, read ALL matching architecture docs.
   If unsure which domain applies, read `docs/systems/claude-workflow/ARCHITECTURE.md` as the fallback.

   **Step 2c — Load domain-specific rules and context files:**

   | Domain | Additional files to read |
   |--------|---------------------------|
   | CS 2.0 / any CS2 paradigm work | `.claude/rules/cs2-architecture-first.md` |
   | Database, schema, migrations, RPC | `.claude/context/supabase-schema.md` |
   | UI, components, brand, tokens | `.claude/context/design-system-global.md` |
   | Deploy, infrastructure, DNS, SSL | `.claude/context/coolify-deployment.md` |
   | Credentials, MCP, clauth, subagents | `.claude/context/clauth.md` |
   | OG images, social meta, brand assets | `.claude/context/brand-gate.md` |
   | Cross-platform, Cowork, subagent MCP | `.claude/context/platform-cross-ref.md` |

   **Step 2d — Load CLAUDE.md for every affected package:**
   - Identify which packages in `packages/` are relevant to the topic
   - Read `packages/<name>/CLAUDE.md` for each one
   - At minimum read `packages/supabase/CLAUDE.md` if any DB work is involved
   - At minimum read `packages/ui/CLAUDE.md` if any UI work is involved

3. **Web research** — search for current (2025-2026) best practices:
   - How do major projects solve this?
   - What tools/libraries exist?
   - What are the common tradeoffs?

4. **Codebase analysis** — what do we already have?
   - Search relevant packages for existing code
   - Check `.rdc/research/` for prior research on this topic (fallback: `.rdc/research/`)
   - Check `docs/archive/` for historical work
   - Research agents should read relevant guides from `.rdc/guides/` (fallback: `.rdc/guides/`)
   - Check work items for related epics

5. **Best-in-class comparison** — create a comparison table:
   | Approach | Pros | Cons | Fit for Us |

6. **Surface unknowns** — what questions remain unanswered?

7. **Write research doc** to `.rdc/research/<topic-slug>.md` (fallback: `.rdc/research/<topic-slug>.md` if `.rdc/` does not exist):
   ```markdown
   # Research: <Topic>
   > Generated: <date> | Requested by: Project Lead

   ## Source Documents Read
   (list every architecture doc, rules file, context file, and package CLAUDE.md loaded in Step 2)

   ## Question
   ## What We Already Have
   ## Best-in-Class Analysis
   ## Comparison Table
   ## Unknowns & Open Questions
   ## Recommendation (preliminary — not a decision)
   ```

8. **Report results:**
   - Interactive: summarize findings. Do NOT create epics or write code.
   - Unattended: skip summary, emit status block only:
     ```
     PREPLAN_STATUS: { topic, doc_path, unknowns_count, recommendation_confidence: "high|medium|low", source_docs_read: [list] }
     ```

## Unattended Escalation

When `--unattended` and `recommendation_confidence` is `"low"` (≥5 unresolved unknowns,
or no clear best-fit approach exists), escalate via the advisor tool rather than stopping.
Provide the advisor with: topic, unknowns list, comparison table. Resume with advisor's
direction if given. If advisor cannot resolve, log and skip to next step.

## Rules
- **Source documents in Step 2 are MANDATORY — research without them is blind**
- Output is a RESEARCH DOC, not a plan
- Do not make architectural decisions — surface options with tradeoffs
- Do not create work items
- Do not write code
- Web search is mandatory — don't just analyze the codebase
- Keep the doc under 200 lines — concise, not exhaustive
- Unattended: NEVER pause for input; infer and proceed
- Always list source docs read in the output doc header
