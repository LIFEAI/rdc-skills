---
name: rdc:help
description: "Usage `rdc:help` — Show all rdc:* skills with usage, requirements, and codeflow status. Reads `.claude-plugin/plugin.json` skills_meta (single source of truth). Call when unsure which skill to use or what args it takes."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.

# rdc:help — Command Reference (manifest-driven)

> **⚠️ HARD OUTPUT RULE:** Read the plugin manifest, render the table, exit.
> No preamble. No follow-up question. No summary.

## Procedure

1. Resolve the plugin manifest path. Try in order, take the first that exists:
   - `{PLUGIN_ROOT}/.claude-plugin/plugin.json`  ← preferred when running from the published plugin
   - `C:/Dev/rdc-skills/.claude-plugin/plugin.json` ← source-checkout fallback
   - `~/.claude/plugins/cache/rdc-skills/rdc-skills/latest/.claude-plugin/plugin.json` ← installed cache
2. Read it. Parse JSON. Read `skills_meta`.
3. Group entries by `category` in this order: `planning, build, deploy, release, dev-loop, reporting, tooling, infra`.
4. For each entry render one row: `{slash}  —  {usage}  —  needs: {requires.join(',')}  —  cf: {codeflow_required ? 'yes' : 'no'}`.
5. Print a Decision Tree at the end that maps natural-language phrases to skills, derived from each entry's `triggers[]`.
6. Print the Direct MCP / curl Access block so non-Claude callers have the same entry point.
7. Hard rules section at the bottom (see below — verbatim).

## Required output format

```
RDC SKILLS — manifest: .claude-plugin/plugin.json @ v{version}

## planning
  /rdc:preplan <topic>      needs: codeflow                                                      cf: yes
  /rdc:plan <topic>         needs: supabase,clauth,codeflow,work-items-rpc                       cf: yes
  /rdc:handoff [--from-prototype <id>]  needs: supabase,clauth,codeflow,work-items-rpc,git       cf: yes

## build
  /rdc:build <epic-id>      needs: supabase,clauth,codeflow,agent-dispatch,work-items-rpc,git    cf: yes
  /rdc:design <topic>       needs: supabase,clauth,codeflow,git                                  cf: yes
  /rdc:prototype <desc>     needs: supabase,clauth,codeflow                                      cf: yes
  /rdc:overnight [scope]    needs: supabase,clauth,codeflow,agent-dispatch,work-items-rpc,git    cf: yes
  /rdc:review [--unattended] needs: supabase,clauth,codeflow,agent-dispatch,git                  cf: yes

## deploy
  /rdc:deploy <slug> [new|diagnose|audit] [--fix]   needs: clauth,coolify,pm2,supabase,codeflow  cf: yes

## release
  /rdc:release <repo> [version|--patch|--minor|--major|--dry-run]  needs: clauth,git,npm,coolify  cf: no
    ⚠ Production promotion requires explicit user go-ahead.

## dev-loop
  /rdc:fixit <description>  needs: supabase,clauth,codeflow,agent-dispatch,work-items-rpc,git    cf: yes
    constraint: < 5 files AND < 30 min — otherwise use /rdc:plan
  /rdc:collab --session <id>  needs: clauth,git                                                   cf: yes
  /rdc:co-develop <ask|reply|inbox|start|resume|status>  needs: clauth                            cf: no

## reporting
  /rdc:status               needs: supabase,clauth                                               cf: no
  /rdc:report               needs: supabase,clauth,codeflow                                      cf: yes
  /rdc:watch                needs: (none)                                                        cf: no
  /rdc:help                 needs: (none)                                                        cf: no

## tooling
  /rdc:workitems [add|done|status|list|query]  needs: supabase,clauth,work-items-rpc             cf: no
  /rdc:fs-mcp <task>        needs: clauth                                                        cf: no

## infra
  /rdc:self-test [--strict] needs: clauth                                                        cf: no
  /rdc:terminal-config <task>  needs: git                                                        cf: no

## Decision tree (derived from skills_meta[].triggers)

  "research before planning" / "what should we use"     → /rdc:preplan
  "plan this" / "architecture" / "epic breakdown"       → /rdc:plan
  "build the epic" / "execute the plan" / "go"          → /rdc:build
  "let claude run" / "overnight" / "drain queue"        → /rdc:overnight
  "quick fix" / "typo" / "<5 files"                     → /rdc:fixit
  "code review" / "audit" / "tsc check"                 → /rdc:review
  "session report" / "summarize"                        → /rdc:report
  "where are we" / "snapshot"                           → /rdc:status
  "deploy to dev" / "audit watch paths"                 → /rdc:deploy
  "promote" / "push to prod" / "ship"                   → /rdc:release
  "convert prototype" / "finalize plan"                 → /rdc:handoff
  "mock it up" / "show me"                              → /rdc:prototype
  "add work item" / "list epics"                        → /rdc:workitems
  "ask codex" / "peer-aware"                            → /rdc:co-develop
  "claude.ai relay" / "collab session"                  → /rdc:collab
  "palette" / "studio design" / "tokens"                → /rdc:design

## Direct MCP / curl Access

  MCP endpoint: https://rdc-skills.regendevcorp.com/mcp
  Health:       curl -s https://rdc-skills.regendevcorp.com/health
  Header:       Accept: application/json, text/event-stream
  Tools:        rdc_skill_list, rdc_skill_search, rdc_skill_get
  Variants:     cli for Claude Code/Codex/local terminal; cloud for claude.ai

  List skills:
  curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rdc_skill_list","arguments":{}}}'

  Search by intent:
  curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"rdc_skill_search","arguments":{"query":"turn this article into social posts"}}}'

  Fetch a skill:
  curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rdc_skill_get","arguments":{"name":"rdc:build","variant":"cli"}}}'

## Hard rules

- `cf: yes` skills MUST consult CodeFlow before acting. Hooks fail-closed on unreachable CodeFlow for these.
- NEVER `pnpm build` at monorepo level — single scoped builds only.
- NEVER commit to `main` without explicit approval. Default branch is `develop`.
- NEVER overlap agents on the same files.
- ALWAYS update work items in real time via RPCs (see `.claude/rules/work-items-rpc.md`).
- ALWAYS credentials via clauth daemon: `curl -s http://127.0.0.1:52437/v/<service>` (plain text).
```

> If the manifest file is unreachable, fall back to the static table above (the manifest values it was generated from). Tell the user the fallback was used so they know to investigate.
