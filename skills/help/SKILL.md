---
name: rdc:help
description: >-
  Usage `rdc:help` or `rdc` — selection menu of all rdc:* skills with their full argument syntax. Use when unsure which command to invoke or what args it takes.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:help — Command Reference

> **⚠️ HARD OUTPUT RULE:** Your ENTIRE response MUST be the block below, copied verbatim.
> No preamble. No follow-up question. No summary. No "what would you like to do?".
> Do NOT add any text before or after the block. Emit it exactly as written. This is non-negotiable.

## When to Use

- The project lead asks what RDC commands exist
- The active task is unclear and needs command selection
- A user needs syntax for planning, build, review, deployment, design, or release workflows

## Arguments

- `rdc:help` — print the full command reference menu
- `rdc` — alias; same as `rdc:help`

## Workflow — the RDC loop

| Command | Usage |
|---|---|
| `rdc:preplan` | `rdc:preplan <topic> [--unattended]` — research, no code |
| `rdc:plan` | `rdc:plan <topic> [--unattended]` — architecture + epic/tasks |
| `rdc:build` | `rdc:build <epic-id\|topic> [--unattended]` — dispatch agents, commit, close items |
| `rdc:review` | `rdc:review [--unattended]` — typecheck, tests, fix, commit |
| `rdc:report` | `rdc:report [--unattended]` — write `.rdc/reports/YYYY-MM-DD.md` |
| `rdc:overnight` | `rdc:overnight [epic-id\|label=X]` — chain preplan→plan→build→review→report |
| `rdc:status` | `rdc:status` — read-only dashboard |
| `rdc:fixit` | `rdc:fixit <description>` — bypass the loop, <5 files / <30 min |

## Ops

| Command | Usage |
|---|---|
| `rdc:deploy` | `rdc:deploy <slug> [build-id]` · `rdc:deploy new <slug>` · `rdc:deploy diagnose <slug>` · `rdc:deploy audit [--fix]` |
| `rdc:release` | `rdc:release <repo> [version]` · `rdc:release <repo> --patch\|--minor\|--major` · `rdc:release <repo> --dry-run` |

## Planning ↔ CLI bridge

| Command | Usage |
|---|---|
| `rdc:handoff` | `rdc:handoff <topic>` — finalize plan → work items for CLI |
| `rdc:prototype` | `rdc:prototype <description>` — JSX mock for review |
| `rdc:workitems` | `rdc:workitems <add\|update\|done\|list\|epics> [args]` |
| `rdc:collab` | `rdc:collab --session <id>` — claude.ai bidirectional relay |
| `rdc:design` | `rdc:design <command\|brief>` — RDC/Studio design, tokens, palettes, themes, Rampa CLI |

## Agent guides (dispatched by rdc:build, not user-invocable)

These live under `guides/agents/` — they are role playbooks the build skill spawns as sub-agents. You do NOT invoke them directly.

- `guides/agents/frontend.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/backend.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/data.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/design.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/infrastructure.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/content.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/cs2.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/viz.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/setup.md` — [agent-only — dispatched by rdc:build, not user-invocable]
- `guides/agents/verify.md` — [agent-only — dispatched by rdc:build, not user-invocable]

Each agent reads `.rdc/guides/agent-bootstrap.md` first, then its role guide.

## Decision tree

```
Project lead says → invoke
─────────────────────────────────────────────────
"research this" / "how do others do"    → rdc:preplan <topic>
"plan this out" / "architect"           → rdc:plan <topic>
"build it" / "go" / "execute"           → rdc:build <topic>
"run overnight" / "while I sleep"       → rdc:overnight
"quick fix" / "hotfix" / "typo"         → rdc:fixit <desc>
"review" / "is it clean"                → rdc:review
"report" / "summarize"                  → rdc:report
"status" / "where are we"               → rdc:status
"deploy" / "ship"                       → rdc:deploy <slug>
"release" / "publish"                   → rdc:release <repo>
"hand this off" / "give to agents"      → rdc:handoff
"show me what it looks like"            → rdc:prototype
"add to backlog" / "create a ticket"    → rdc:workitems
"design/tokens/palette/theme"           → rdc:design <command>
"what commands" / "what skills"         → rdc:help
```

## Hard rules (apply everywhere)

- NEVER `pnpm build` — crashes the machine. Typecheck with `npx tsc --noEmit`.
- NEVER commit to `main` without explicit approval. Default branch is `develop`.
- NEVER overlap agents on the same files.
- ALWAYS update work items in real time via RPCs (see `.claude/rules/work-items-rpc.md`).
- ALWAYS credentials via clauth daemon: `curl -s http://127.0.0.1:52437/get/<service>`.
