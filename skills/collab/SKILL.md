---
name: rdc:collab
description: >-
  Usage `rdc:collab --session <id>` — bidirectional relay with claude.ai. Read inbox, do work, write outbox, loop. Dave watches terminal and can interject.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag. Chitchat relay writes (`chitchat_reply`) and git push are skipped under `RDC_TEST=1`.


# /rdc:collab — Claude Code Collab Session Listener
> Invoked as: `/rdc:collab --session <session_id>`
> You are the build/execute half of a live collab session with claude.ai.
> Transport: chitchat MCP tools (`chitchat_poll` / `chitchat_reply`) + SSE stream
> Dave is watching this terminal and can interject at any time.

---

## When to Use
- Project lead wants to delegate a task to a claude.ai session
- You need bidirectional relay between this CLI agent and a claude.ai coworker
- An async work handoff is in progress via the chitchat relay

## Arguments

- `rdc:collab --session <id>` — start or resume a collab relay with the given session ID

## What This Is

claude.ai writes tasks into your inbox via `chitchat_send`. The clauth daemon
queues them and — if you are connected to the SSE stream — pushes the event
immediately (zero-latency). You read, act, commit, reply via `chitchat_reply`,
and loop. Dave can watch everything in this terminal and interject by typing —
treat anything Dave types as a high-priority override.

---

## Step 1 — Parse session ID

Extract `--session <uuid>` from args.

If no `--session`, call `chitchat_list` and show all active sessions.

---

## Step 2 — Initialize (chitchat-native)

Call `chitchat_list` to verify the session exists in the daemon.

If the session is not found:
```
Session <id> not found in clauth daemon.
Start a session from claude.ai first:
  chitchat_start(name: "<session-slug>")
Then pass the returned session_id here.
```

Send the ready signal via MCP:
```
chitchat_reply(session_id, "Claude Code connected. Ready to receive tasks.\ncwd: <rootPath>")
```

Print to terminal:
```
[rdc:collab] Session <id> active (chitchat transport).
SSE stream: http://127.0.0.1:52437/chitchat/<id>/stream
Waiting for messages from claude.ai... (Ctrl+C to end)
```

Note: File relay at `.rdc/relay/sessions/` is kept for backwards compatibility
but is no longer the primary transport. Chitchat MCP + SSE is the default.

---

## Step 3 — Wait for message (SSE-first, poll-fallback)

### Primary path — SSE (zero-latency)

Connect to the SSE stream and wait for the daemon to push a message:

```bash
curl -s -N --max-time 30 http://127.0.0.1:52437/chitchat/<session_id>/stream
```

The stream emits:
- `event: message` lines with `data: <JSON>` when `chitchat_send` fires from claude.ai
- `: keepalive` comment lines every 15s (ignore these)

**When a `data:` event arrives:** parse the JSON directly — it contains the
message. The SSE stream drains the inbox as it delivers; do NOT call
`chitchat_poll` after receiving via SSE. Proceed directly to Step 4 with the
parsed message body.

**If 30s elapses with no message event (only keepalives or silence):**
Print `[rdc:collab] Still listening...` and retry SSE immediately. After 10
consecutive 30s timeouts (5 min idle), print a longer heartbeat but keep
looping.

**If curl fails (daemon restart, connection refused, non-200):** fall back to
polling path below.

### Fallback path — polling (2s interval)

Use this path only when SSE is unavailable:

```
loop:
  result = chitchat_poll(session_id)
  if result.status == "ready":
    → proceed to Step 4 with result.message
  else (status == "idle"):
    wait 2 seconds
    continue loop
```

**`chitchat_poll` return shapes:**
- `{ status: "idle" }` — inbox empty, keep polling
- `{ status: "ready", message: "..." }` — message waiting, consume it

---

## Step 4 — Process message

You now have the message body (from SSE `data:` JSON or `chitchat_poll` result).

Check if the message begins with `type: stop` (literal prefix) or contains a
`type` field equal to `"stop"` in the JSON.

**`type: stop`** → go to Step 7.

**Anything else (default: task/message):**

Print to terminal:
```
[rdc:collab] Turn <N> from claude.ai:
──────────────────────────────────────
<message body>
──────────────────────────────────────
```

---

## Step 5 — Do the work

Act on the message. Full Claude Code capabilities:
- File edits, git commits to `develop`
- Supabase RPC queries
- Type-checks: `npx tsc --noEmit` (never `pnpm build`)
- Run skills: `/rdc:plan`, `/rdc:fixit`, etc.
- Answer questions directly

Follow `.rdc/guides/agent-bootstrap.md` rules throughout.

For long tasks, stream progress updates mid-work:
```
chitchat_reply(session_id, "Turn <N> in progress: <what you've done so far>...")
```
This lets claude.ai see progress immediately rather than waiting for the full
response.

---

## Step 6 — Send response

When work is done, send the response via MCP:

```
chitchat_reply(session_id, "<response body>")
```

Response body format:
```
Turn <N> complete.
Commits: <sha1, sha2 or none>

<what you did, what you found, any questions or decisions needed from claude.ai>
```

Print to terminal:
```
[rdc:collab] Turn <N> done. Response sent via chitchat_reply.
Waiting for next message...
```

Return to Step 3.

---

## Step 7 — End session

Received `type: stop` message, or Dave pressed Ctrl+C.

Send final summary via MCP:
```
chitchat_reply(session_id, "Session complete.\nTurns: <N>\nCommits: <list or none>\nOpen items: <anything unresolved>")
```

Then call:
```
chitchat_stop(session_id)
```

Print:
```
[rdc:collab] Session ended.
```

---

## Dave Interjections

If Dave types in this terminal during a turn:
- Treat it as an override injected into the current task
- Acknowledge it in your `chitchat_reply` response
- If it changes direction mid-task, note what you stopped and why
