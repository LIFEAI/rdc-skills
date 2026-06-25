---
name: rdc:help
description: >-
  Usage `rdc:help` or `rdc` — manifest-driven menu of all rdc:* skills with
  argument syntax, requirements, decision hints, and direct MCP/curl access.
---

> **Output contract:** Checklist/table output only. No raw MCP/JSON/log dumps.

# rdc:help — Manifest-Driven Command Reference

Print a concise command reference from the plugin manifest, then stop. Do not
ask which command to run unless the user explicitly asks for a recommendation.

## Source Of Truth

Resolve the manifest in this order and use the first existing file:

1. `{PLUGIN_ROOT}/.claude-plugin/plugin.json`
2. `C:/Dev/rdc-skills/.claude-plugin/plugin.json`
3. `~/.claude/plugins/cache/rdc-skills/rdc-skills/latest/.claude-plugin/plugin.json`

Read `skills_meta` from the manifest. Group entries by `category` in this order:
`planning`, `build`, `deploy`, `release`, `dev-loop`, `reporting`, `tooling`,
`infra`.

For each row, show:

```text
{slash}  —  {usage}  —  needs: {requires or "(none)"}  —  cf: {yes|no}
```

At the end, render a short decision tree from `skills_meta[].triggers`.

If the manifest is unreachable, say `manifest fallback used` and render the
static fallback table from `skills/help/SKILL.md`.

## Direct MCP / curl Access

Show this block after the command table so non-Claude callers have the same
entry point:

```text
MCP endpoint: https://rdc-skills.regendevcorp.com/mcp
Health:       curl -s https://rdc-skills.regendevcorp.com/health
Header:       Accept: application/json, text/event-stream
Tools:        rdc_skill_list, rdc_skill_search, rdc_skill_get
Variants:     cli for Claude Code/Codex/local terminal; cloud for claude.ai
```

Minimal curl examples:

```bash
curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rdc_skill_list","arguments":{}}}'

curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"rdc_skill_get","arguments":{"name":"build","variant":"cli"}}}'
```

## Hard Rules

- `cf: yes` skills must consult CodeFlow before acting.
- Never run `pnpm build` at monorepo root. Use scoped typecheck/tests.
- Never commit to `main` without explicit approval.
- Never overlap agents on the same files.
- Update work items in real time for skills that require work-items RPCs.
- Credentials come from clauth: `curl -s http://127.0.0.1:52437/v/<service>`.
