---
name: rdc:collab
description: "Usage `rdc:collab <collaborator> [mode] <topic>` — Structured collaboration with another agent: Codex, a local LLM, a Claude agent, or a claude.ai session. Modes: negotiate (converge on a decision), delegate (hand off work), listen (claude.ai relay). Every dispatch carries a response contract."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag. Chitchat relay writes (`chitchat_reply`), engine dispatch, and git push are skipped under `RDC_TEST=1`.

# /rdc:collab — Structured Agent-to-Agent Collaboration

> `rdc:collab <collaborator> [mode] <topic>`
> Collaborators: `codex` · `local-llm` · `claude-agent` · `claude-ai`
> Modes: `negotiate` (default for a decision) · `delegate` · `listen`

---

## The rule this skill exists to enforce

**Never dispatch to another agent without a response contract.**

An agent asked an open question answers in whatever shape is habitual to it — a
file write, a plan, a lesson, a wall of prose. It is not being unhelpful; you
did not tell it how to answer. A dispatch without a contract produces output you
then have to parse, argue with, or discard, and it costs a full round every time.

**Corollary: an agreement is a Decision, not an episode.** When collaboration
settles a question, the output belongs in the governing document (and therefore
in AKG) as a decision/constraint/policy — never filed as a lesson. Lessons are
for *episodes*: something was learned the hard way. A settled negotiation filed
as a lesson buries a queryable constraint in an append-only pile nobody
traverses.

---

## Two clocks: the reply drives, a watchdog bounds

Both are required, and they do different jobs. Running either alone is a known
failure:

| | Driver | Watchdog |
|---|---|---|
| What it is | the collaborator's reply | a `/loop` or `Monitor`, armed at dispatch |
| Fires on | completion | **silence past the expected envelope** |
| Job | advance the negotiation | **diagnose why nothing came back** |
| Cadence | none — event-driven | ~2–3× the peer's normal reply time |

**Driver alone → you wait forever.** A background dispatch with no timeout is
correct about not guessing a duration and wrong about liveness: if the peer dies,
is guard-blocked, or its session id has expired, nothing ever wakes you. This is
the failure the watchdog exists to catch.

**Watchdog alone → you fire on top of live calls.** A wall-clock cadence has no
relationship to the work: if the peer answers in 30s you idle the remainder, if
it takes 8 minutes you stack a second call onto the first.

### The watchdog does NOT retry. It investigates.

Re-dispatching a silent peer is the wrong reflex — it doubles the load on
something already failing and destroys the evidence of why. On wake, run the
diagnosis ladder in order and stop at the first hit:

1. **Is the process alive?** Check the background task's status. Still running is
   a legitimate answer — re-arm the watchdog with a longer envelope and stop.
2. **Did it exit, and with what?** A non-zero exit or exit 143 (killed) is a
   result, not silence. Read it.
3. **Was it guard-blocked?** Grep the output for a `deny`/`Blocked` line. The
   `CODEX MANAGED LANE` block is the common one and is a *dispatch* defect
   (wrong `-C`), not a peer failure — fix and re-dispatch once.
4. **Is the session still addressable?** A stale `resume <session-id>`, a stopped
   chitchat session, or a dead local-LLM endpoint all present as silence.
5. **Did it answer somewhere you are not reading?** A peer that cannot write its
   intended target often reports into stdout, a log, or an error body instead.
   The answer may already exist.
6. **None of the above** → the peer is genuinely stuck. Escalate per Step 6 with
   the ladder's findings attached. Do not silently retry.

Arm the watchdog **at dispatch**, disarm it **on reply**. An armed watchdog
outliving its dispatch is noise, and noise is how a real stall gets ignored.

---

## Step 0 — Parse arguments

```
rdc:collab <collaborator> [mode] <topic…>
rdc:collab --session <id>          ← legacy form, implies `claude-ai listen`
```

- No collaborator → list active chitchat sessions and available engines, then stop.
- No mode → `negotiate` if the topic names a document, decision, plan, or review;
  `delegate` if it names work to perform; `listen` for `claude-ai` with `--session`.

---

## Step 1 — Collaborator matrix

Resolve the transport BEFORE composing the message. Getting this wrong is the
most common failure and it fails at the guard layer, not the prompt layer.

| Collaborator | Invocation | Isolation requirement | Known failure mode |
|---|---|---|---|
| **`codex`** | `codex exec -C <its-lane> "<msg>"` · resume: `codex exec -C <its-lane> resume <session-id> "<msg>"` | **MUST run with `-C` pointing at a Codex-owned lane** (`x-codex-N` or `x-codex-sv`) | Inheriting your cwd attaches Codex to *your* lane; `managedAppAttachmentDecision()` refuses every write with `CODEX MANAGED LANE: App Local must use an owned managed Codex lane`. The guard is correct — fix the `-C`, never the guard. |
| **`local-llm`** | local endpoint per `.claude/context/clauth.md`; credential via `curl -s http://127.0.0.1:52437/v/<service>` | none (no repo attachment) | Small context windows: send the contract and the open points, never the whole document. Link paths instead of pasting files. |
| **`claude-agent`** | `Agent` tool, or `claude -p --bare` / `claude --bg` | **`isolation: "worktree"` as an actual tool parameter** if it will commit — a prose claim of isolation is inert | Parallel agents on a shared checkout race on `git stash` and `.git/index`. See `.claude/rules/subagent-credentials.md`. |
| **`claude-ai`** | chitchat MCP (`chitchat_send` / `chitchat_poll` / `chitchat_reply`) + SSE | session-scoped | Messages evaporate when the session stops — export durable decisions to TinTin. |

**Dispatch is long-running.** Run engine dispatch as a **background task**, not
behind a `timeout` guess. A truncated call looks like a failure and is not one.

---

## Step 2 — Compose the response contract (mandatory)

Every dispatch in `negotiate` or `delegate` mode carries an explicit answer
format. The contract is not politeness — it is what makes the reply *checkable*.

**Negotiate contract — one block per open point:**

```
POINT <n>: AGREE | AGREE-WITH-AMENDMENT | DISAGREE
EDIT: <the exact section and change you will make, or NONE>
REASON: <one sentence — only if AMENDMENT or DISAGREE>
```

Plus one closing block, always:

```
OWNER: <who writes the change — exactly one agent>
BLOCKED: <what you cannot do from where you are, or NONE>
```

**Delegate contract:**

```
STATUS: DONE | PARTIAL | BLOCKED
CHANGED: <file paths, or NONE>
EVIDENCE: <command run + literal result — exit code, row count, probe status>
BLOCKED: <what stopped you, or NONE>
```

Rules that make the contract hold:

1. **State the format before the content.** Contract first, then the points.
2. **Say what NOT to produce** when the peer has a known default — e.g. *"do not
   write a lesson; this is a Decision and belongs in the plan."*
3. **Number the points.** Unnumbered points get answered in aggregate.
4. **Name the single writer before round 1** (see Step 4).
5. **Ask for `BLOCKED` explicitly.** Without it, a peer that cannot act reports
   success or silence.

---

## Step 3 — Converge (negotiate mode)

```
open_points = [all points]
round = 0
while open_points and round < MAX_ROUNDS (default 4):
    round += 1
    dispatch(open_points, contract)          ← background task, no timeout guess
    arm_watchdog(envelope = 2-3x expected reply time)
    reply = await completion                 ← OR watchdog fires first
    if watchdog fired: run the diagnosis ladder; do NOT re-dispatch blindly
    disarm_watchdog()
    if reply does not match the contract:
        re-dispatch ONCE restating the format only — never re-argue the content
    settle: AGREE and accepted AGREE-WITH-AMENDMENT leave open_points
    if open_points did not shrink this round:
        STOP — escalate (Step 6). A non-shrinking round means the disagreement
        is real, and further rounds spend tokens without moving it.
```

**Never re-send a settled point.** Each round carries only what is still open,
plus a one-line record of what was settled. Re-sending settled points is how a
negotiation becomes a loop that never terminates.

**Convergence is the termination condition, not a timer.**

---

## Step 4 — Single-writer rule

Before round 1, name **one** agent as the writer of the document or code under
discussion, and say so in the dispatch.

> Two active writers on one surface is forbidden — the same rule the fleet plans
> state as *"never run two active writers for one effect."*

If the named writer turns out to be **structurally blocked** (wrong lane, no
credentials, read-only mount), ownership transfers to the other agent *for that
artifact only*, and the transfer is recorded in the change itself with
attribution. A blocked writer does not mean the agreed work is abandoned.

---

## Step 5 — Land the outcome

An agreement is a **Decision**. Route it by kind:

| Outcome | Home |
|---|---|
| Settled decision, constraint, or policy | The governing document — plan / ARCHITECTURE.md / rule. AKG ingests from there. |
| Work to perform | `insert_work_item` via RPC, per `.claude/rules/work-items-rpc.md` |
| A genuine hard-won episode (a wrong theory, a surprising infra behaviour) | `.rdc/lessons/` per `guides/lessons-learned-spec.md` |
| A stated, unresolved disagreement | Escalate — Step 6 |

**Do not file a settled agreement as a lesson.** That is the single most common
misroute this skill exists to prevent.

---

## Step 6 — Escalate (only after convergence fails)

Escalation is the last step, never the first. It happens when a round fails to
shrink the open set, the round cap is hit, or both agents are blocked.

Escalate as **one packet**, not a transcript:

```
UNRESOLVED: <the point, in one sentence>
POSITION A (<agent>): <claim + its evidence>
POSITION B (<agent>): <claim + its evidence>
WHAT WOULD SETTLE IT: <the measurement, probe, or decision needed>
COST OF EACH BRANCH: <one line each>
```

A transcript is not an escalation. If the human has to read the argument to find
the question, the packet was not written.

---

## `listen` mode — claude.ai relay

Legacy behaviour, unchanged and still correct for `claude-ai`. Transport is
chitchat MCP + SSE; you are the build half of a live session.

- `chitchat_list` to verify the session; `chitchat_reply` to signal ready.
- SSE first: `curl -s -N --max-time 30 http://127.0.0.1:52437/chitchat/<id>/stream`.
  **⛔ curl exit 28 is SUCCESS on an SSE read** — `--max-time` always exits 28 at
  the boundary. If a `data:` event arrived, process it. Only connection-refused
  or a non-200 is a real failure (lesson `2026-06-08-collab-sse-exit-28-is-success`).
- Poll fallback: `chitchat_poll` at 2s — `{status:"idle"}` keep polling,
  `{status:"ready", message}` consume.
- `type: stop` ends the session; send a final summary, then `chitchat_stop`.
- Stream progress mid-work with `chitchat_reply` on long tasks.

---

## Dave interjections

Anything Dave types is a high-priority override, in every mode.

⛔ **When an interjection appears to CONTRADICT the task premise, restate your
understanding in ONE sentence and confirm before branching into a wide
`AskUserQuestion` menu.** A tight "I read this as X — correct?" reconciles faster
and avoids acting on a misread premise (lesson
`2026-06-08-collab-premise-contradicting-interjection`).

---

## Anti-patterns

| Anti-pattern | Why it costs a round |
|---|---|
| Dispatching prose with no response contract | The peer answers in its habitual shape; you parse or discard it |
| Filing a settled agreement as a lesson | Buries a queryable Decision in an append-only pile |
| Driving a negotiation with `/loop` | The clock has no relationship to the reply |
| Dispatching with no watchdog armed | A dead peer is indistinguishable from a slow one; you wait forever |
| Watchdog re-dispatches instead of diagnosing | Doubles load on a failing peer and destroys the evidence of why |
| `codex exec` without `-C <its-lane>` | Codex inherits your lane; every write is guard-blocked |
| Re-sending settled points each round | The negotiation cannot terminate |
| Wrapping dispatch in a `timeout` guess | A still-running call reads as a failure |
| Escalating a transcript | The human has to find the question themselves |
| Two agents editing one document | Lost work, no error |

---

## Capture lessons (exit step)

Before the final verdict line, follow `guides/lessons-learned-spec.md` § Capture
procedure. Write a lesson only for a genuine **episode** — a first root-cause
theory that proved wrong, a documented path that did not work, a surprising
tool/infra behaviour. **A settled agreement is not a lesson** (see Step 5). Set
`scope` and `status`; commit alongside the run's other commits; note "N lessons
captured" in the verdict. A run that taught nothing writes nothing.
