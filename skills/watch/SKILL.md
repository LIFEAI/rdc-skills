---
name: rdc:watch
description: "Open a live browser viewer tailing this session's activity. Zero infrastructure — pure filesystem + static HTML."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:watch — Session Log Watcher

## When to Use
- Start of any long-running session where Dave needs visibility into what you're doing
- Before `rdc:overnight`, `rdc:build` on a large epic, or any multi-hour grind
- Anytime the user asks for "a log", "a viewer", "tail", or "what are you doing right now"

## Procedure

1. **Initialize the log and viewer.** Run the helper script from the plugin directory in the user's current project:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/watch-init.mjs
   ```
   (If `CLAUDE_PLUGIN_ROOT` is not set, resolve the plugin path from your invocation context. On Windows it's typically `C:/Dev/rdc-skills`.)

2. **Parse the output.** The script prints `run_id`, `log_path`, `current`, `viewer`, and `open_hint`. Capture `log_path` and `viewer` for the rest of the session.

3. **Open the viewer in the browser.** Run the exact `open_hint` line from the script output. On Windows that's `start "" "<viewer-path>"`.

4. **Report to the user.** One line:
   ```
   watcher live at <viewer-path> — tailing <log-path>
   ```

5. **Append one line per substantive action for the rest of the session.** Use the documented format — one line, no multi-line payloads:
   ```
   [<ISO-timestamp>] [<kind>] <message>
   ```
   Append to BOTH `<log-path>` (the full history) AND `current.log` (what the viewer polls). The viewer diffs `current.log` by length and only appends new lines.

### Log format

- `ISO-timestamp` — `new Date().toISOString()`
- `kind` — one of: `dispatch`, `commit`, `test`, `error`, `note`, `banner`
- `message` — single line, no newlines. Keep under ~200 chars.

### Kinds

| Kind | When to append |
|------|----------------|
| `dispatch` | About to dispatch a subagent — include role + epic/task id |
| `commit` | After a git commit lands — include short sha + subject |
| `test` | Test run kicked off or result came back |
| `error` | Anything that failed — include what and why in one line |
| `note` | General progress ticks (reading files, analyzing, planning) |
| `banner` | Session start/end markers, major phase changes |

### Examples

```
[2026-04-15T23:14:02.318Z] [dispatch] frontend agent → epic abc123 task 4 (rebuild DynamicForm)
[2026-04-15T23:17:41.902Z] [commit] 3f2a1b9 feat(marketing-engine): DynamicForm rhf+zod
[2026-04-15T23:18:05.113Z] [test] pnpm --filter @regen/rdc-marketing-engine test
[2026-04-15T23:18:41.002Z] [error] tsc: src/components/Form.tsx:42 — Property 'foo' does not exist
[2026-04-15T23:19:00.000Z] [note] retrying with corrected type import
[2026-04-15T23:45:10.000Z] [banner] Phase 2 complete — moving to review
```

### Appending from bash (Windows-safe)

```bash
printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "dispatch" "your message" >> "$LOG_PATH"
printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "dispatch" "your message" >> "$CURRENT_PATH"
```

Or from Node:
```js
import { appendFileSync } from "node:fs";
const line = `[${new Date().toISOString()}] [note] ${msg}\n`;
appendFileSync(logPath, line);
appendFileSync(currentPath, line);
```

## Notes

- Log files live in the **user's project**, not the rdc-skills repo. Path: `<projectRoot>/.rdc/session-log/`
- Each invocation creates a **new run id** and overwrites `current.log`. Prior run logs remain on disk as `<runId>.log`.
- The viewer is a single static HTML file polling `current.log` via `fetch()` every 2s — no server, no deps.
- This skill does NOT replace `rdc:report` (the end-of-session Obsidian writeup). It's a live tail for attended or semi-attended sessions.
