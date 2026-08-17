---
id: 2026-08-17-fixit-codex-mcp-only-skills
date: "2026-08-17"
skill: fixit
session: codex-mcp-startup-20260817
scope: simple
status: applied
area: skill
links:
  commits:
    - 263231a
  memory: []
  work_items:
    - dc076f35-236b-4f8d-be3f-646a66514ba5
---

## What happened
Codex's real numbered-lane startup completed MCP initialization but emitted a red skill-budget error on every launch. The machine had 36 RDC skill directories in each of the global `.codex/skills` and `.agents/skills` roots while the same 36-skill catalog was already registered through the RDC-Skills MCP endpoint.

## Root cause
`scripts/install-rdc-skills.js` registered the MCP endpoint and then copied the full RDC catalog into every detected Codex skill directory. Codex loaded those duplicate surfaces together, inflating startup metadata to 113 skills. The same install also left a legacy RDC marketplace block that Codex rejected as an unsupported plugin source.

## The fix / rule
Codex receives RDC skills exclusively through MCP. The installer now verifies the MCP config before purging legacy file copies, fails closed if the replacement cannot be established, removes the obsolete marketplace/plugin blocks with CRLF coverage, and verifies that live Codex skill roots contain zero RDC duplicates. Implemented in commit `263231a`.
