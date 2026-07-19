---
mdk_schema_version: "1.0"
doc_type: guide
system: claude-workflow
status: active
owner: infrastructure
created: 2026-06-08
last_reviewed: 2026-06-08
source_of_truth: true
supersedes: []
depends_on:
  - ".claude/rules/architectural-change-approval.md"
  - ".rdc/guides/output-contract.md"
tags: [rdc, lessons-learned, skills, housekeeping, adaptive]
---

# Lessons-Learned Capture & Triage — Spec

> Auto-referenced by long-running `rdc:*` skills at exit, and by `rdc:housekeeping` for triage.
> Goal: make the fleet an **interactive adaptive modeler** — every run that teaches us
> something writes it down, and the weekly housekeeping pass turns those lessons into
> actual fixes (rules, skill docs, work_items).

---

## Why this exists

Lessons learned during a run (a non-obvious infra trap, a wrong assumption, a missing
gate, a tooling gotcha) used to survive only if someone hand-wrote a memory. This system
makes capture a **routine exit step** of every long skill, and triage a **routine phase**
of the weekly housekeeping. Capture is cheap and append-only; triage is where fixes happen.

Precedent: brochurify's `rdc-extract-verifier-rules` already does read-log → cluster →
propose-rule for one domain. This generalizes that pattern fleet-wide.

---

## Storage — directory of per-lesson files

Lessons live in **`.rdc/lessons/`**, one markdown file per lesson:

```
.rdc/lessons/<YYYY-MM-DD>-<skill>-<short-slug>.md
```

- One file per lesson (NOT a single appended file) so parallel agents finishing at the
  same time never collide on one file in git.
- `<skill>` is the capturing skill (`build`, `deploy`, `overnight`, `fixit`, `plan`,
  `preplan`, `review`, `release`, `collab`).
- `<short-slug>` is 2–4 kebab words naming the lesson.

A run that taught nothing writes nothing — **absence is the default**. Only write a lesson
when something was genuinely learned (see § When to capture).

---

## Lesson file schema

```markdown
---
id: <YYYY-MM-DD>-<skill>-<short-slug>
date: "<YYYY-MM-DD>"
skill: build | deploy | overnight | fixit | plan | preplan | review | release | collab
session: <session-id or short ref>
scope: simple | architectural          # triage routing — see § Scope gate
lesson_status: open | triaged | applied | wont-fix
area: infra | skill | guide | rule | schema | ui | content | other
links:
  commits: []                          # SHAs that relate to the lesson
  memory: []                           # memory file slugs, if a memory was also written
  work_items: []                       # work_item UUIDs spawned during triage
---

## What happened
<one paragraph — the concrete situation, with evidence (exit code, file:line, command)>

## Root cause
<one paragraph — the evidenced cause, not a guess>

## The fix / rule
<what should change so this never recurs: a rule edit, skill-doc line, code change,
or a check. Cite a same-run related commit as context when useful, but keep
lesson_status: open until the weekly triage audit records the final outcome.>
```

`scope` is the single most important field — it routes triage:

- **`simple`** — a doc line, a one-file fix, a config tweak, a clarifying sentence in a
  skill, a missing grep guard. Housekeeping routes these through `rdc:fixit` or
  `rdc:plan` -> `rdc:build`; it never applies them outside an RDC work item.
- **`architectural`** — anything matching `.claude/rules/architectural-change-approval.md`
  (rule/CLAUDE.md/ARCHITECTURE.md edits, cross-cutting refactors, schema reshape, public
  API/MCP changes, skill-contract changes affecting multiple skills). Housekeeping does
  NOT apply these; it surfaces them via `AskUserQuestion` for explicit approval first.

When unsure, mark `architectural`.

### Legacy status migration

Older lesson files may use `status` instead of `lesson_status`. During weekly
intake, before filtering or clustering, normalize every lesson that has
`status` and no `lesson_status` by moving the unchanged value to
`lesson_status` and removing the legacy key. Record each migration in the
weekly report. Do not reinterpret a legacy value or create a work item merely
because it was migrated.

---

## When to capture (at skill exit)

Write a lesson when ANY of these were true during the run:

1. A root cause turned out to be different from the first theory (a wrong assumption).
2. The standard/documented path didn't work and you had to do something non-obvious.
3. A gate, check, or doc was missing and its absence cost a round.
4. A tool/infra behaved in a surprising way (exit codes, caching, serve/PM2/webhook quirks).
5. A hook blocked you and the block revealed a real gap (not just your mistake).

Do NOT capture: routine success, your own one-off typo, anything already fully documented
in a rule/guide. If a durable user preference or correction was involved, also write a
`memory` (this spec and memory are complementary — link them).

---

## Capture procedure (the exit step long skills call)

At the end of a long skill run, before the final verdict line:

1. Decide if anything qualifies (§ When to capture). If not, write nothing and move on.
2. For each lesson, write `.rdc/lessons/<date>-<skill>-<slug>.md` using the schema above.
   Set `lesson_status: open`; a captured lesson is never self-marked as applied.
3. Set `scope` honestly (`simple` vs `architectural`).
4. Commit the lesson file(s) on `develop` alongside the run's other commits.
5. Mention in the verdict/summary that N lessons were captured.

---

## Triage procedure (rdc:housekeeping, weekly)

`rdc:housekeeping` uses this strict order. It prevents duplicate plans and fixits, gathers every architectural answer before changes, and keeps each executable change inside an RDC work item.

1. Normalize legacy `status` fields as described above, then read all `.rdc/lessons/*.md` with `lesson_status: open` and cluster by `area` + root-cause similarity.
2. **Resolution audit before routing:** for every cluster, inspect the relevant code, rules, skills, guides, tests, recent commits, linked work items, and existing mitigations. Record what was inspected, the evidence, and one result: `already-fixed`, `sufficiently-mitigated`, or `still-open`. Do not create an `rdc:fixit`, `rdc:plan`, or `rdc:build` item before this audit.
3. Resolve no-work clusters from the audit: link the prior commit and set `lesson_status: applied` for `already-fixed`; set `lesson_status: wont-fix` for a sufficient mitigation with its remaining-risk reason. Leave partially mitigated clusters open.
4. **Architectural report and interview:** before any file changes, report every still-open architectural decision with options, tradeoffs, recommendation, risks, and audit evidence. Create the complete interview list, ask each required question in attended mode, and record every question, answer, decision, rationale, and affected cluster. Gather all answers before the first fix. In unattended mode, create deduplicated `human_items` decision records and defer unresolved choices.
5. **RDC routing:** route each approved still-open cluster through a complete work item and either `rdc:fixit` (only under its scope limit; it creates the sole work item) or `rdc:plan` -> `rdc:build`. Include cluster and lesson ids in the fixit description or planned task. No direct edits are allowed. Complete the required checklist, implementation report, review, validator closure, commit, and push. Deploy deployable targets to dev through RDC and record the evidence; record `not applicable` for non-deployable work.
6. Run `rdc:review` across each completed action batch. Mark lessons `lesson_status: applied` only after review passes and the linked commit is pushed; mark deferred and declined clusters `triaged` or `wont-fix` with their linked evidence.
7. Write the full weekly lessons report with cluster audit, architectural report, interview Q&A, RDC action register, deployment evidence, and counts for open, deduped, already fixed, mitigated, applied, triaged, wont-fix, deferred, fixits, builds, review passes, and dev deployments.

Lessons are never silently deleted — `applied` and `wont-fix` files stay as the audit trail.

---

## Skills that capture (the long-running set)

`build` · `deploy` · `overnight` · `fixit` · `plan` · `preplan` · `review` · `release` · `collab`

Each references this spec from a final "§ Capture lessons" step. A Stop-hook backstop warns
when one of these skills ends a run with findings but no new `.rdc/lessons/` file.
