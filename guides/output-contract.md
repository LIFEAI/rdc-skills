# RDC Skill Output Contract
> Every `rdc:*` skill MUST follow this contract. Non-negotiable.

## Why

The user has zero visibility when skills narrate tool calls and dump raw output.
A wall of JSON, MCP responses, and "let me check X..." chatter buries the one
thing they need: **is this working or not, and what step are we on?**

## The contract

1. **One checklist per invocation.** Show it upfront, update it in place as items
   progress, print it again at the end with a 1-line verdict.

2. **Checklist markers:**
   - `[ ]` pending
   - `[~]` in progress (currently executing)
   - `[x]` done
   - `[!]` failed
   - `[-]` skipped (with one-word reason in parens)

3. **NO narration of tool calls.** Forbidden phrases: "Let me...", "I'll check...",
   "Now reading...", "Let me fetch...", "Let me verify...". Tool calls happen
   silently. The checklist is the communication channel.

4. **NO raw tool output in chat.** No MCP JSON, no log dumps, no UUIDs, no
   SQL result tables, no curl bodies — unless a checklist item explicitly asks
   for one (e.g., "show HTTP status"). Everything else is consumed silently and
   folded into checklist state.

5. **Failures are one sentence.** When `[!]` fires, print ONE sentence on what
   failed and what you're doing about it. Stack traces, full error messages,
   and debug dumps go in memory, not in chat.

6. **Verdict line.** End every invocation with one line:
   - `✅ <skill>: <outcome> in Nm Ns`
   - `⚠️ <skill>: <N findings> — <next action>`
   - `❌ <skill>: <one-sentence reason>`

7. **Interactive checklists only when human input is required.** If the skill
   needs a decision (pick an epic, confirm a destructive op), ask ONE question,
   then resume.

8. **TaskCreate is internal.** If you use TaskCreate/TodoWrite for internal
   tracking, that's fine — but the checklist shown to the user is the one
   defined in the skill's markdown, not the raw task list.

## Template

Every skill invocation prints, in order:

```
<Skill Name>: <one-line subject>
[ ] Step 1
[ ] Step 2
[ ] Step 3
...
```

Then executes silently, re-rendering the checklist when state changes (tools
like CLI agents that stream output should refresh in place). At the end:

```
<Skill Name>: <one-line subject>
[x] Step 1
[x] Step 2
[x] Step 3
✅ <verdict>
```

## What the skill may additionally emit

- **One question at a time** when input is required
- **One-sentence status updates** at major state transitions (optional)
- **Final artifacts** if the skill's output is itself a file/report/diff — link,
  don't inline the full content

## What the skill MUST NOT emit

- Tool call narration
- Raw MCP responses
- JSON dumps
- Log tails
- SQL result grids
- UUIDs unless asked
- "I'm going to..." preambles
- "Let me now..." transitions
- Summaries of what just happened (the checklist shows it)
- Apologies for verbosity

## Enforcement

If a skill violates this contract, the user will say "squelch" — at which point
any in-flight narration stops, only the checklist + verdict is shown for the
remainder of the session.

Skills SHOULD self-enforce by treating every tool call as silent and every
user-facing emission as a deliberate checklist update.
