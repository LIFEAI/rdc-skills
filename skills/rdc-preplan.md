---
name: rdc:preplan
description: >-
  Research best practices, analyze codebase, compare approaches, surface unknowns
  BEFORE committing to a plan. Use when starting something new or unfamiliar.
  Produces a research doc — no decisions, no code. Accepts optional --unattended
  flag for overnight/automated runs (skips clarifying questions, returns status block).
---
> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md`).


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

2. **Web research** — search for current (2025-2026) best practices:
   - How do major projects solve this?
   - What tools/libraries exist?
   - What are the common tradeoffs?

3. **Codebase analysis** — what do we already have?
   - Search relevant packages for existing code
   - Check `.rdc/research/` for prior research on this topic (fallback: `docs/research/`)
   - Check `docs/archive/` for historical work
   - Research agents should read relevant guides from `.rdc/guides/` (fallback: `docs/guides/`)
   - Check work items for related epics
   - Read relevant CLAUDE.md files

4. **Best-in-class comparison** — create a comparison table:
   | Approach | Pros | Cons | Fit for Us |

5. **Surface unknowns** — what questions remain unanswered?

6. **Write research doc** to `.rdc/research/<topic-slug>.md` (fallback: `docs/research/<topic-slug>.md` if `.rdc/` does not exist):
   ```markdown
   # Research: <Topic>
   > Generated: <date> | Requested by: Project Lead

   ## Question
   ## What We Already Have
   ## Best-in-Class Analysis
   ## Comparison Table
   ## Unknowns & Open Questions
   ## Recommendation (preliminary — not a decision)
   ```

7. **Report results:**
   - Interactive: summarize findings. Do NOT create epics or write code.
   - Unattended: skip summary, emit status block only:
     ```
     PREPLAN_STATUS: { topic, doc_path, unknowns_count, recommendation_confidence: "high|medium|low" }
     ```

## Unattended Escalation

When `--unattended` and `recommendation_confidence` is `"low"` (≥5 unresolved unknowns,
or no clear best-fit approach exists), escalate via the advisor tool rather than stopping.
Provide the advisor with: topic, unknowns list, comparison table. Resume with advisor's
direction if given. If advisor cannot resolve, log and skip to next step.

## Rules
- Output is a RESEARCH DOC, not a plan
- Do not make architectural decisions — surface options with tradeoffs
- Do not create work items
- Do not write code
- Web search is mandatory — don't just analyze the codebase
- Keep the doc under 200 lines — concise, not exhaustive
- Unattended: NEVER pause for input; infer and proceed
