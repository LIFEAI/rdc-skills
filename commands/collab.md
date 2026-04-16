---
name: rdc:collab
description: >-
  Usage `rdc:collab --session <id>` — bidirectional relay with claude.ai. Read inbox, do work, write outbox, loop. Dave watches terminal and can interject.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.


# /rdc:collab — Claude Code Collab Session Listener
> Invoked as: `/rdc:collab --session <session_id>`
> You are the build/execute half of a live collab session with claude.ai.
> Transport: file relay via `.rdc/relay/sessions/<id>/inbox/` + `outbox/`
> Dave is watching this terminal and can interject at any time.

---

## What This Is

claude.ai writes tasks into your inbox. You read, act, commit, write the response
to outbox, and loop. clauth relays messages between claude.ai and this session via
the `chitchat_*` MCP tools. Dave can watch everything in this terminal and interject
by typing — treat anything Dave types as a high-priority override.

---

## Step 1 — Parse session ID

Extract `--session <uuid>` from args.

If no `--session`, list `.rdc/relay/sessions/` and show available sessions.

---

## Step 2 — Initialize

```
sessionDir = .rdc/relay/sessions/<session_id>/
inbox      = sessionDir/inbox/
outbox     = sessionDir/outbox/
```

Verify both dirs exist. If not:
```
Session directory not found. Run chitchat_start from claude.ai first.
```

Update `sessionDir/status.json`:
```json
{ "status": "active", "cli_connected_at": "<iso>", "session_id": "<id>" }
```

Write a ready signal to outbox so claude.ai knows the CLI is connected:

```
outbox/<iso-ts>-ready.md
---
from: claude-code
to: claude-ai
session_id: <id>
type: ready
responded_at: <iso>
---
Claude Code connected. Ready to receive tasks.
cwd: <rootPath>
```

Print to terminal:
```
[rdc:collab] Session <id> active.
Inbox:  .rdc/relay/sessions/<id>/inbox/
Outbox: .rdc/relay/sessions/<id>/outbox/
Waiting for messages from claude.ai... (Ctrl+C to end)
```

---

## Step 3 — Poll inbox

Scan `inbox/` for `.md` files that do NOT end in `.processed`. Sort ascending by name.

- **No files:** wait 5 seconds, poll again.
- **After 10 min idle:** print `[rdc:collab] Still listening...` heartbeat, keep waiting.
- **Files found:** process the oldest one first (Step 4).

---

## Step 4 — Process message

Read the file. Parse frontmatter `type` field.

**`type: stop`** → go to Step 6.

**Anything else (default: task/message):**

Print to terminal:
```
[rdc:collab] Turn <N> from claude.ai:
──────────────────────────────────────
<message body>
──────────────────────────────────────
```

Rename the inbox file to `<filename>.processed`.

---

## Step 5 — Do the work

Act on the message. Full Claude Code capabilities:
- File edits, git commits to `develop`
- Supabase RPC queries
- Type-checks: `npx tsc --noEmit` (never `pnpm build`)
- Run skills: `/rdc:plan`, `/rdc:fixit`, etc.
- Answer questions directly

Follow `.rdc/guides/agent-bootstrap.md` rules throughout.

When done, write response to outbox:
```
outbox/<iso-ts>-turn<N>.md
---
from: claude-code
to: claude-ai
session_id: <session_id>
turn: <N>
responded_at: <iso>
commits: <sha1, sha2 or none>
---

<what you did, what you found, any questions or decisions needed from claude.ai>
```

Print to terminal:
```
[rdc:collab] Turn <N> done. Response written to outbox.
Waiting for next message...
```

Return to Step 3.

---

## Step 6 — End session

Received `type: stop` in inbox, or Dave pressed Ctrl+C.

Write final summary to outbox:
```
outbox/<iso-ts>-final.md
---
from: claude-code
to: claude-ai
session_id: <session_id>
type: final
responded_at: <iso>
---
Session complete.
Turns: <N>
Commits: <list or none>
Open items: <anything unresolved>
```

Update `status.json` → `{ "status": "done", "ended_at": "<iso>" }`

Print:
```
[rdc:collab] Session ended.
```

---

## Dave Interjections

If Dave types in this terminal during a turn:
- Treat it as an override injected into the current task
- Acknowledge it in your outbox response
- If it changes direction mid-task, note what you stopped and why
