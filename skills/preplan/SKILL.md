---
name: rdc:preplan
description: "Usage `rdc:preplan <topic>` — Before committing to an architecture, research unknowns first. Codebase scan + web search, no code written, no work items created. Output feeds rdc:plan. Use for open-ended approach questions."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. This skill is read-only and produces only local file writes — no destructive external calls to short-circuit.


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
   - Check `.rdc/research/` for prior research on this topic (fallback: `.rdc/research/`)
   - Check `docs/archive/` for historical work
   - Research agents should read relevant guides from `.rdc/guides/` (fallback: `.rdc/guides/`)
   - Check work items for related epics
   - Read relevant CLAUDE.md files

4. **Best-in-class comparison** — create a comparison table:
   | Approach | Pros | Cons | Fit for Us |

5. **Surface unknowns** — what questions remain unanswered?

6. **Write research doc** to `.rdc/research/<topic-slug>.md` (fallback: `.rdc/research/<topic-slug>.md` if `.rdc/` does not exist):
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
