---
mdk_schema_version: "1.0"
doc_type: guide
system: claude-workflow
status: active
owner: infrastructure
created: 2026-06-08
last_reviewed: 2026-09-16
source_of_truth: true
supersedes: []
depends_on:
  - ".claude/rules/architectural-change-approval.md"
  - ".rdc/guides/output-contract.md"
tags: [rdc, lessons-learned, skills, housekeeping, adaptive, github-issues]
---

# Lessons-Learned Capture & Triage — Spec

> Auto-referenced by long-running `rdc:*` skills at exit, and by `rdc:housekeeping` for triage.
> Goal: make the fleet an **interactive adaptive modeler** — every run that teaches us
> something records it where the fix belongs, and the weekly housekeeping pass turns those
> lessons into actual fixes (guards, tests, scripts, rule lines, work items).

---

## Why this exists

Lessons learned during a run (a non-obvious infra trap, a wrong assumption, a missing
gate, a tooling gotcha) used to survive only if someone hand-wrote a memory. This system
makes capture a **routine exit step** of every long skill, and triage a **routine phase**
of the weekly housekeeping. Capture is cheap; triage is where fixes happen.

Precedent: brochurify's `extract-verifier-rules` already does read-log → cluster →
propose-rule for one domain. This generalizes that pattern fleet-wide.

### Why lessons are not files any more

Until 2026-09 every lesson was a markdown file in the capturing repository's
`.rdc/lessons/`. A census of one repository found 315 of them: 157 already enforced in code,
where the file only repeated what a guard or test already guaranteed, and 32 enforced
nowhere, sitting in a directory the owner of the fix never reads. A lesson filed where it
was noticed, rather than where it is fixed, is a lesson nobody who can fix it sees.

So the record now follows the fix:

- **An encoded lesson needs no file.** The guard, test or script that enforces it is the
  record, and the commit that shipped it carries the narrative.
- **An unencoded lesson is a GitHub issue in the repository the fix belongs to**, labelled
  `lesson` + `proposal`. **An issue proposes; a work item commits.**

---

## When to capture (at skill exit)

A lesson exists when ANY of these were true during the run:

1. A root cause turned out to be different from the first theory (a wrong assumption).
2. The standard/documented path didn't work and you had to do something non-obvious.
3. A gate, check, or doc was missing and its absence cost a round.
4. A tool/infra behaved in a surprising way (exit codes, caching, serve/PM2/webhook quirks).
5. A hook blocked you and the block revealed a real gap (not just your mistake).

Do NOT capture: routine success, your own one-off typo, anything already fully documented
in a rule/guide, or a settled agreement (that is a Decision and belongs in the plan). If a
durable user preference or correction was involved, also write a `memory` (this spec and
memory are complementary — link them). A run that taught nothing records nothing —
**absence is the default**.

---

## The two outcomes

| The fix is… | Record | Where |
|---|---|---|
| **Encoded in this run** — a guard, test or script shipped, commit linked | the commit message | no file, no issue |
| **Not encoded** — a fix is known or needed but not shipped | one `lesson` + `proposal` issue | the repository the fix belongs to |

"Encoded" means something now **fails** when the lesson is violated: a guard rule blocks it,
a test goes red, a script refuses it. A sentence added to a rule or skill document is not
encoding — prose drifts from behaviour — so a doc-only fix is still an issue until a guard or
test carries it.

**The owning repository** is the one whose code or documents change to fix it, not the one
where the run happened. A clauth behaviour found during a regen-root build is a clauth lesson.

---

## Capture procedure (the exit step long skills call)

At the end of a long skill run, before the final verdict line:

1. Decide if anything qualifies (§ When to capture). If not, record nothing and move on.
2. For each lesson, name the owning repository's registry slug (a `projects.json` key:
   `lifeai-env`, `rdc-skills`, `clauth`, `regen-root`, `regen-deploy-mgr`, …).
3. **Encoded in this run** → record it in the commit message of the change that encodes it.
   `rdc-lesson` prints the record, opens nothing, and calls GitHub not at all:

   ```bash
   node "$LIFEAI_ENV/bin/rdc-lesson.mjs" submit --repo <owning slug> --encoded <guard/test/script path> \
     --title "<one line>" --what "<what happened, with evidence>" \
     --root-cause "<evidenced cause>" --fix "<what now enforces it>"
   ```

4. **Not encoded** → submit it. It opens ONE issue titled `[lesson] <title>`, labelled
   `lesson` + `proposal`, in the repository the slug resolves to. The same title again (any
   issue state) opens nothing and prints the existing URL, so a retry is safe:

   ```bash
   node "$LIFEAI_ENV/bin/rdc-lesson.mjs" submit --repo <owning slug> \
     --title "<one line>" --what "<what happened, with evidence: command, exit code, file:line>" \
     --root-cause "<evidenced cause, not a guess>" --fix "<the guard, test, script or rule that would stop it>" \
     [--area <area>] [--evidence <commit/log/work-item URL> ...]
   ```

   Add `--dry-run` to see the issue without opening it. An unregistered slug fails and names
   itself; do not file the lesson in a different repository to get past that — report it.
5. Mention in the verdict/summary: "N lessons captured (E encoded, S submitted: <issue URLs>)".

Without `$LIFEAI_ENV` (the `core` profile, or claude.ai), open the issue from the owning
repository's **Lesson learned** issue form (`.github/ISSUE_TEMPLATE/lesson.yml`); it applies
the same title prefix, labels and sections.

### What the issue carries

The form and the CLI produce the same sections, in this order:

- **What happened** — the concrete situation, with evidence (exit code, file:line, command).
- **Root cause** — the evidenced cause, not a guess.
- **The fix or rule** — what should change so this never recurs.
- **Repository / area** — the owning slug and the area inside it.
- **Encoded artifact** — anything that already enforces part of the fix.
- **Evidence** — commits, logs, transcripts, work items.

---

## Accepting a lesson (issue → work item)

An issue is a proposal. Work begins only when it is accepted:

1. Create the work item through the work-item RPCs, naming the issue URL in its description.
2. Relabel and link the issue:

   ```bash
   node "$LIFEAI_ENV/bin/rdc-lesson.mjs" accept <issue-number-or-url> --repo <owning slug> --work-item <uuid>
   ```

   This removes `proposal`, adds `accepted`, and comments `Accepted as work item <uuid>`. It
   refuses an issue that is not labelled `lesson`, and does not create the work item.
3. The fixing commit or PR closes the issue with `Fixes #N` (or `Fixes LIFEAI/<repo>#N` from
   another repository).

---

## Triage procedure (rdc:housekeeping, weekly)

`rdc:housekeeping` runs a **Lessons triage** phase over open lesson issues:

```bash
node "$LIFEAI_ENV/bin/rdc-lesson.mjs" list --state open          # every registered repository
node "$LIFEAI_ENV/bin/rdc-lesson.mjs" list --repo <slug> --json   # one repository, machine-readable
```

A repository that could not be listed is named on stderr and the command exits 1 — treat that
as an incomplete triage, never as "no lessons there".

1. Cluster open `proposal` issues by area + root-cause similarity (dedupe repeats into one fix;
   close the duplicates as duplicates, linking the survivor).
2. Decide each cluster's scope:
   - **simple** — a one-file fix, a config tweak, a missing grep guard, a test.
   - **architectural** — anything matching `.claude/rules/architectural-change-approval.md`
     (rule/CLAUDE.md/ARCHITECTURE.md edits, cross-cutting refactors, schema reshape, public
     API/MCP changes, skill-contract changes affecting multiple skills). When unsure, it is
     architectural.
3. Route per the mode below.
4. Summarize in the housekeeping report: open / accepted / closed-fixed / closed-won't-fix
   counts, with issue URLs.

### Attended mode (default — a human is present)

- **simple** → accept it (§ Accepting), apply the fix directly as a guard/test/script, commit
  with `Fixes #N`.
- **architectural** → do NOT edit. Present the issue + options via `AskUserQuestion` (per
  `architectural-change-approval.md`). On approval, accept it and apply via the correct
  lifecycle (rdc-skills tag/push for skills; cited commit for rules). If deferred, accept it so
  the work item carries it.
- **Not worth fixing** → close the issue as not planned with a one-line reason.

### Triage procedure — UNATTENDED weekly mode

No human present (overnight / cron / `rdc:overnight`) — never run `AskUserQuestion`:

- **Per-difficulty model routing** (reuses the `rdc:build` table): clustering and scope
  triage → `claude-sonnet-5`; mechanical apply → `claude-haiku-4-5`; harder multi-file or
  migration fix → `claude-sonnet-5`; design/architectural fix → `claude-opus-5`.
- **simple** → accept, apply directly or via `rdc:fixit`, commit with `Fixes #N`.
- **architectural with a single clear correct fix** (records an already-learned lesson —
  "add a gate", "encode X as a test") → accept, route through `rdc:plan` → `rdc:build` (or
  `rdc:fixit` if genuinely under 5 files).
- **architectural and genuinely ambiguous** (multiple valid approaches, real tradeoffs) → write
  a `human_items` row (`item_type='decision'`, options in `suggested_agent_prompt`,
  `source_type='lesson'`, `source_fingerprint` = the issue URL for dedupe), accept the issue
  against a linked work item, and leave the decision for the morning. This is the asynchronous
  equivalent of the attended interview.

Issues are closed, never deleted — a closed issue with its fixing commit, or its won't-fix
reason, is the audit trail.

---

## Existing `.rdc/lessons/` files

Files written under the old procedure are retired by state: an encoded lesson's file is
deleted and links to it point at the enforcing artifact; an unencoded one becomes an issue in
its owning repository; a doc-only one stays until a guard or test carries it. Do not add new
files there, and do not read that directory for triage.

---

## Skills that capture (the long-running set)

`build` · `overnight` · `fixit` · `plan` · `preplan` · `review` · `release` · `collab` ·
`onramp`

Each references this spec from a final "§ Capture lessons" step.
