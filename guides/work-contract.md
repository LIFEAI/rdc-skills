# Work Contract — truth at the start, Stop is the checklist

> The one home for how an `rdc:*` skill declares work, resolves its target, and
> proves it is finished. `rdc:open`, `rdc:fixit`, `rdc:build`, `rdc:plan`,
> `rdc:overnight` and `rdc:review` defer to this file rather than restating it.
> Runtime: `lifeai-env` ≥ 0.8.252 (`$LIFEAI_ENV/bin/rdc-work.mjs`), same command
> on Claude Code and Codex. When a gate prints an `rdc-work` line, run **that
> line**: it names the installed copy and carries `--session <id>`, which matters
> in a shell that holds both a Claude and a Codex session id.

## Why

Every gate this fleet had judged work at the end, by guessing — a regex over the
final message, a transcript scan for a todo list. A guess at the end cannot tell
half-built from finished. Operator, 2026-09-14/16:

- "the best truth is to start with a plan that has to be finished"
- "we should have a start gate is more important than the stop gate"
- "The agent can decide if the work is worth A To Do List or a work package"
- "hard undeniable proof of work"
- "move truth to the start so stop is a checklist"

## The contract

Before a session's first change — a file write in a git work tree, a `git commit`,
a `git push` — it declares:

| field | what it is |
|---|---|
| `goal` | one sentence: what done means |
| `rows` | each a step **and the command that proves it**: `"<step> :: <command that exits 0 when the step is true>"` |
| `type` | the kind of work; it picks the tier |

```bash
node "$LIFEAI_ENV/bin/rdc-work.mjs" start --type fixit \
  --goal "checkout page renders prices from the API again" \
  --row "unit tests pass :: pnpm --filter @lifeai/shop test" \
  --row "page shows a real price :: curl -sf https://dev.shop.example/checkout | grep -q 'data-price'" \
  --row "landed on develop :: git fetch -q origin && git merge-base --is-ancestor HEAD origin/develop"
```

A row passes only when its command ran and exited 0. **Nothing ticks a row by
saying so** — there is no free-text evidence path.

Without a contract the start gate (`work-contract-required`) refuses the change
and prints the exact command, including this session's id. Plans, reports and
other documents under `.rdc/`, engine memory and plan files, and anything outside
a git work tree need no contract; code does, wherever its checkout sits.

### A proof observes, and it can fail

A proof runs through `rdc-work`'s own process, outside the hooks that guard a
tool call, so `rdc-work` applies both checks itself — at `start`/`add` and again at
`verify`:

- **The proof policy.** A proof may not change anything: no commit, push, merge,
  rebase, reset, checkout, stash, tag or branch change; no publish, land, deploy,
  migration, PM2/Docker/Kubernetes lifecycle; no `rm`/`mv`/`cp`/`touch`/`mkdir`,
  `sed -i`, redirection into a file, or write request (`curl -X POST`, `-d`). The
  command is read the way the shell runs it, so wrapping an action does not hide it —
  `sh -c '…'`, `cmd /c …`, `npx …`, `node -e "…writeFileSync…"` are judged by what they
  carry. And it must be able to fail: `true`, `exit 0`, a bare `echo`, `… || true`,
  `test 1` are refused — and so is `x | tail`, because a pipeline exits with its LAST
  command (prove with `x` itself, or `x | grep -q <evidence>`).
- **The shared guard rules** — the same ones a Bash call meets. A proof they refuse
  is refused (`( cd dir && cmd )`, not `cd dir && cmd`).

A refused proof is recorded as exit 126 and **never runs**. Prove an action by
observing its result: a push with `git merge-base --is-ancestor HEAD origin/<branch>`,
a deploy with a read-only probe, a file with `test -f`.

## Tier — the agent picks

| `--type` | tier | also |
|---|---|---|
| `maintenance`, `hotfix`, `fixit`, `edit` | `todo` | rows only |
| `build`, `refactor`, `overnight` | `work-item` | `--work-item <uuid>` required |

Whatever the tier, a work item this session has **claimed** holds Stop until its
database Definition of Done closes — choosing `todo` does not drop a claimed item's DoD.

A todo contract that grows past ~5 changed files is reported at Stop ("usually
wants a work item") but never blocked on — the tier is the agent's call. Upgrade
with `rdc-work upgrade --work-item <uuid>`.

## Rows — proportional, not a quota

One row per **deliverable**, each with one proof. Decompose until every declared
surface (screen / api / db / tool) and every handoff has a row that can pass or fail
on its own. There is **no minimum row count**: a numeric floor produced 91 checks
before a runnable increment (Codex, building CDE Layer 0). Coverage is the rule;
count is not.

Coarse rows are still rejected, because they cannot fail: "works", "verified",
"integration complete", "tests pass" with no command.

## Proving, and staleness

```bash
node "$LIFEAI_ENV/bin/rdc-work.mjs" verify t2 --session <id>        # one row
node "$LIFEAI_ENV/bin/rdc-work.mjs" verify --all --session <id>     # every row, against the code as it stands now
node "$LIFEAI_ENV/bin/rdc-work.mjs" drop t3 --reason "no dev target exists for this package" --session <id>
node "$LIFEAI_ENV/bin/rdc-work.mjs" status --session <id>           # the checklist Stop will judge
node "$LIFEAI_ENV/bin/rdc-work.mjs" check --session <id>            # exit 0 when Stop would pass
```

`--session` is optional when the shell carries exactly one engine's session id;
every verb prints the id it resolved and where it came from. `--no-db` skips the
work-item DoD lookup for an offline check — Stop never skips it.

A proof goes **stale** when the session edits after it, or when the content it ran
against changes by any route — a shell edit, a formatter, a rebase, a pull, a new
file.
Committing exactly the proved content does not make it stale. Finish every piece of
work with `verify --all`. A dropped row is resolved, not passed, and stays visible
with its reason. Every row prints its proof command beside it, so a weak proof is as
visible as its claim.

## Stop

For a session **holding a contract**, Stop is `rdc-work check`: every row proved
against the current content or dropped with a reason; the target's changes committed —
including new files this session wrote; the changes it wrote in **any other
repository** committed too (a second repo, a subagent's worktree); and the database DoD
closed for every work item it claimed or declared. Dropping every row after making
changes is not a pass — a drop explains, it does not prove. The block message is the
checklist, with runnable `--session` commands. A database outage is reported, not held
against the work.

A session with **no contract** — one that only read, planned or answered — still
gets the evidence checks: tracked changes it left uncommitted, and a claimed work
item's open DoD. How its final message is worded is never judged.

Enforcement is bounded: a Stop held identically three times, or six times in a row,
releases, and the unproved rows stay in the contract and in the compaction snapshot.
A defect in the gate itself — an unreadable contract, an error — reports and never holds.

## Target resolution — never assume regen-root

`start` resolves the target from `projects.json` (generated from Supabase
`repo_registry`) and prints it:

```
target: C:/Dev/lifeai-env.wt/x · integration main · ship: node machines/land.mjs
```

Skill text written for regen-root names `develop`, `.rdc/guides`, `scripts/land.mjs`
and the CodeFlow phase orchestrator. **Those are regen-root's facts, not universal
ones.** Wherever a skill names them:

| skill says | use instead |
|---|---|
| `develop` / `origin/develop` | the contract's **integration** branch (`rdc-work status`). regen-root and rdc-harness: `develop`. lifeai-env, clauth, rdc-cde: `main`. rdc-skills: `master`. |
| `{PROJECT_ROOT}/.rdc/guides/<x>.md` | the contract's `guides_dir` if the target has one; otherwise the guides shipped with rdc-skills. **Never** a cwd-relative `.rdc/guides` from a different repository — that imports one repo's rules into another. |
| `node scripts/land.mjs` | the contract's **ship** route |
| `runOrchestrator()` with the phase manifest | only when the target contains `corpus/_shared/build/phase-manifest.json` (today: regen-root). Elsewhere the orchestrator does not apply: resolve waves from work-item dependencies and say so in one line. **An absent orchestrator is not a blocker.** |
| an undeclared target (`NOT in projects.json`) | work proceeds on rows; register the repository in `repo_registry` before relying on a ship route |

## Dispatching writers — engine-neutral

The skill's `Agent(…, isolation: "worktree", max_turns: 70)` is Claude Code's
interface. On an engine without it:

1. Create one worktree per writer from the **integration** branch:
   `git fetch origin <integration> && git worktree add <pool>/<name> -b <branch> origin/<integration>`
   (`<pool>` is the contract's `worktree_pool`).
2. Start the writer with that worktree as its working directory.
3. The writer is a subagent of this session only if the engine says so; a separately
   launched session needs its own contract.

Claude subagents share the parent's session id, so they inherit the parent's
contract; a SubagentStop is never held to the parent's whole checklist.

## Rollout switch

`~/.rdc/work-contract-mode`: `enforce` (default) · `shadow` (log would-blocks only)
· `off` (previous behaviour). A file, not an environment variable, so an agent
cannot flip it for itself — and `work-contract-tamper` refuses any agent tool call
that writes the mode file, a contract, or Stop's breaker state. The operator
switches the mode from their own terminal.

A worker launched by the Codex Development Environment (CDE) is admitted by CDE's
own manager and validator; the start gate stands down for it.
