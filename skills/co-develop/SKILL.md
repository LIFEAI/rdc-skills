---
name: rdc:co-develop
description: "Usage `rdc:co-develop <ask|reply|inbox|start|resume|status>` — peer-aware Claude/Codex co-development over clauth, with ask --wait as the default delegation pattern."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:co-develop — Peer-Aware Co-Development

Use this skill when an RDC workflow needs Claude and Codex to work together in
one governed session. This skill uses the clauth `codevelop_*` route only. Do
not use `chitchat_*` for this workflow.

## Arguments

Use the high-level delegation commands by default:

- `rdc:co-develop ask <peer> "<task>"` — delegate to partner and wait for the reply
- `rdc:co-develop reply <turn-id> "<summary>"` — reply to a partner request with evidence
- `rdc:co-develop inbox` — drain your inbox when you are explicitly acting as the worker

- `rdc:co-develop start <name>` — create a session and return startup details
- `rdc:co-develop resume <session-id> --peer <peer-id>` — join as a peer
- `rdc:co-develop send --session <id> --from <peer> --to <peer> <task>` — send a turn
- `rdc:co-develop poll --session <id> --peer <peer>` — drain messages for a peer
- `rdc:co-develop status [session-id]` — show session status and queues
- `rdc:co-develop stop <session-id>` — stop the session

## Default Delegation Pattern

When you need partner help, do not hand-write `/codevelop/send` JSON unless the
CLI fails. Call the partner like a subagent:

```powershell
clauth codevelop ask --to codex --wait --task "Review this plan and identify blockers."
clauth codevelop ask --to claude --wait --task "Review this implementation and advise."
```

`ask --wait` sends the request, captures the `turn_id`, polls the sender inbox,
and returns the matching partner reply to the current live agent. This preserves
the sender's active conversation context.

When you receive a partner request, complete the bounded task and reply with:

```powershell
clauth codevelop reply --turn turn-0001 --verdict pass --summary "Reviewed plan." --evidence "Checked files X and Y" --files-changed ""
```

For manual worker intake:

```powershell
clauth codevelop inbox --peer codex
clauth codevelop inbox --peer claude
```

## Required Transport

HTTP routes:

```text
POST /codevelop/start
POST /codevelop/join
POST /codevelop/send
POST /codevelop/poll
GET  /codevelop/<session-id>/<peer-id>/stream
GET  /codevelop/<session-id>/status
GET  /codevelop
POST /codevelop/stop
```

MCP tools:

```text
codevelop_start
codevelop_join
codevelop_send
codevelop_poll
codevelop_stream
codevelop_status
codevelop_stop
```

## Session Roles

Default peers:

| Peer | Role | Responsibility |
|---|---|---|
| `claude` | `supervisor` | RDC loop, work items, validation, integration |
| `codex` | `implementation_partner` | implementation, focused audit, repair, evidence |

Other valid turn roles: `planner`, `builder`, `reviewer`, `validator`,
`advisor`, `release_guard`, `infra_operator`.

## Message Envelope

Always send structured JSON. The receiving peer must treat the JSON object as
the source of truth.

```json
{
  "session_id": "<session-id>",
  "turn_id": "turn-0001",
  "from": "claude",
  "to": "codex",
  "type": "audit_request",
  "role": "reviewer",
  "skill": "rdc:review",
  "task": "Audit the current diff for regressions before merge.",
  "context": {
    "repo": "C:\\Dev\\regen-root",
    "work_item_id": "<optional-uuid>",
    "branch": "develop",
    "owned_files": []
  },
  "expect": {
    "response_format": "CO_DEVELOP_REPLY",
    "evidence_required": true,
    "commit_allowed": false
  }
}
```

Required reply shape:

```json
{
  "session_id": "<session-id>",
  "turn_id": "turn-0001",
  "from": "codex",
  "to": "claude",
  "type": "reply",
  "verdict": "pass",
  "summary": "One paragraph.",
  "evidence": [],
  "files_changed": [],
  "commits": [],
  "blockers": [],
  "next": []
}
```

## Escalation Rules

Invoke co-development when:

- Dave asks for partner review, audit, second opinion, or co-development
- a task crosses multiple apps, packages, repos, APIs, database surfaces, or deployment surfaces
- `rdc:plan` creates 5 or more work packages, or 3 or more work packages with integration risk
- `rdc:build` has file overlap or integration risk
- `rdc:review` finds failures that need judgment
- the same implementation, test, build, deploy, or migration path fails twice
- architecture, auth, deployment, schema, source-of-truth, or bridge-mode interpretation is uncertain
- a production-facing release path is about to proceed

Do not invoke by default for simple read-only explanations, one-line command
output, one-file typo fixes, or already decomposed low-risk work.

## Workflow

1. Start or resume a session with `codevelop_start` / `codevelop_join`.
2. Join the local peer with a stable `peer_id`.
3. Delegate with `clauth codevelop ask --to <partner> --wait --task "<task>"`.
4. Treat the returned JSON as the partner result and continue your active work.
5. If acting as the worker, drain inbox with `clauth codevelop inbox --peer <you>`.
6. Reply with `clauth codevelop reply --turn <turn-id> ...`.
7. Record evidence in the calling RDC skill report or work-item implementation report.
8. Stop the session with `codevelop_stop` when the work is done.

## Completion Evidence

Every co-development turn must report:

- session ID and turn ID
- peer IDs
- files changed
- commands/tests/routes checked
- commits, if any
- blockers or decisions needed
- next action
