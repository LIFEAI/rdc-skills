# Collaborator Contract — read this if you were dispatched by `rdc:collab`

> **You are the responder.** Another agent (Claude Code, Codex, a local LLM, or a
> claude.ai session) dispatched you under a structured collaboration protocol.
> This document is *your* half of it. The initiator's half is
> [`SKILL.md`](./SKILL.md) in this directory.
>
> Link to this file in the dispatch itself so the peer can read it. Do not
> assume it has been read.

---

## Why this exists

A collaboration fails in a specific, repeatable way: the initiator says **what to
discuss** and never **how to answer**, so the responder answers in whatever shape
is habitual to it — a file write, a plan document, a lesson, a wall of prose. A
full round is then spent parsing, arguing with, or discarding the reply.

Both halves carry a responsibility. The initiator owes you a format, numbered
points, and a named writer. You owe it a reply in that format, an honest
`BLOCKED`, and no unilateral writes.

---

## What you can expect FROM the initiator

If any of these is missing, say so in your reply — that is a legitimate answer,
not an evasion.

1. **A response contract** stated *before* the content — the exact format your
   answer must take.
2. **Numbered points.** Unnumbered points get answered in aggregate, which
   settles nothing.
3. **A named single writer** for the document or code under discussion, decided
   before round one.
4. **Settled points never re-sent.** Each round carries only what is still open,
   plus a one-line record of what was settled.
5. **A watchdog, not a nag.** If you go silent the initiator diagnoses first —
   process alive, exit code, guard block, session validity — before re-sending.
   It should not re-dispatch on top of a call you are still working.
6. **Escalation, not blame,** when you disagree. A stated disagreement with
   evidence is a valid terminal state.

---

## What you owe BACK — your responsibilities

### 1. Answer in the required format. Nothing outside it.

If the dispatch gives you a contract, use it verbatim. Prose around the blocks
is not helpful — it is what the format exists to remove.

**Negotiate — one block per point:**

```
POINT <n>: AGREE | AGREE-WITH-AMENDMENT | DISAGREE
EDIT: <the exact section and change you will make, or NONE>
REASON: <one sentence — only if AMENDMENT or DISAGREE>
```

**Delegate:**

```
STATUS: DONE | PARTIAL | BLOCKED
CHANGED: <file paths, or NONE>
EVIDENCE: <command run + literal result — exit code, row count, probe status>
BLOCKED: <what stopped you, or NONE>
```

**Always close with:**

```
OWNER: <who writes the change — exactly one agent>
BLOCKED: <what you cannot do from where you are, or NONE>
```

### 2. Declare `BLOCKED` loudly. Silence is the worst answer.

If you cannot write, cannot reach a service, or lack the credential — **say it in
the reply**. A blocked responder that goes quiet is indistinguishable from a dead
one, and it costs the initiator a full watchdog cycle to discover what you
already knew.

**Your completed reasoning still counts when your write is blocked.** Put the
answer in the reply body. Do not let it die inside a failed tool call.

### 3. Do not write outside your own lane or scope.

- **Codex:** you must be running in a Codex-owned lane (`x-codex-N`, `x-codex-sv`).
  If the initiator invoked you with its own cwd, every write will be refused with
  `CODEX MANAGED LANE: App Local must use an owned managed Codex lane`. That is a
  **dispatch defect, not your failure** — report it as `BLOCKED: wrong lane
  attachment, re-dispatch with -C <my-lane>` and do not attempt a workaround.
- **Claude agents:** if you will commit, you must have been given
  `isolation: "worktree"` as a real tool parameter. A sentence in your prompt
  claiming isolation is inert.
- **Everyone:** never `git stash` in a shared checkout, never force-push, never
  commit onto a branch you were not told to use. If the branch you land on is
  someone else's, say so rather than committing "just this once".

### 4. Do not take ownership you were not given.

Exactly one agent writes each artifact. If you were not named the writer, put
your change in the **reply**, not in the file. Two writers on one surface loses
work with no error.

If the named writer is you and you are blocked, say so — ownership transfers
explicitly, never by assumption.

### 5. An agreement is a Decision, not an episode.

When a negotiation settles, the outcome belongs in the **governing document** —
the plan, the ARCHITECTURE.md, the rule — where it becomes queryable
architecture. **Do not file a settled agreement as a lesson.** Lessons are for
episodes: a root-cause theory that proved wrong, a documented path that did not
work, a surprising tool behaviour. A settled negotiation filed as a lesson buries
a constraint in an append-only pile nobody traverses.

### 6. Answer the point that was asked.

If you disagree with the framing, say `DISAGREE` and give the reason in one
sentence — do not silently answer a different, easier question. If a point is
unanswerable without information you do not have, say that in `REASON` and name
what would settle it.

### 7. Do not restate what is already settled.

The initiator sends only open points. Re-litigating a settled one restarts a
negotiation that was converging.

---

## Terminal states — any of these is a complete, legitimate answer

| State | Meaning |
|---|---|
| All points `AGREE` | Converged. The named writer applies the edits. |
| Some `DISAGREE` with reasons | A real disagreement. Escalates as a packet, not a transcript. |
| `BLOCKED` on everything | You cannot act from where you are. Name the fix. |
| A point needs evidence neither side has | Name the measurement that would settle it. |

**"I could not do it and here is exactly why" outranks a plausible answer you are
not confident in.** The initiator can act on a precise blocker immediately; it
cannot act on a guess it has to verify.

---

## Anti-patterns — these each cost a full round

| Anti-pattern | Why |
|---|---|
| Answering in prose when a format was given | The initiator has to parse and may misread you |
| Writing a file instead of replying | Your answer may be guard-blocked and lost |
| Filing a settled agreement as a lesson | Buries a queryable Decision |
| Going silent when blocked | Indistinguishable from being dead |
| Editing a document you do not own | Lost work, no error, no trace |
| Committing to whatever branch you happen to be on | The change strands where nobody looks for it |
| Answering an easier adjacent question | The real point stays open and looks settled |
| Attempting a workaround for a guard block | The guard is usually right; the dispatch is usually wrong |
