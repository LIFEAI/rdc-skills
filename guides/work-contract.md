# Work Contract — truth at the start, Stop is the checklist

> The one home for how an `rdc:*` skill declares work, resolves its target, and
> proves it is finished. `rdc:open`, `rdc:fixit`, `rdc:build`, `rdc:plan`,
> `rdc:overnight` and `rdc:review` defer to this file rather than restating it.
> Runtime: `lifeai-env` ≥ 0.8.248 (`$LIFEAI_ENV/bin/rdc-work.mjs`), same command
> on Claude Code and Codex.

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
and prints the exact command, including this session's id.

## Tier — the agent picks

| `--type` | tier | also |
|---|---|---|
| `maintenance`, `hotfix`, `fixit`, `edit` | `todo` | rows only |
| `build`, `refactor`, `overnight` | `work-item` | `--work-item <uuid>` required; the item's database Definition of Done must close too |

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
node "$LIFEAI_ENV/bin/rdc-work.mjs" verify t2        # one row
node "$LIFEAI_ENV/bin/rdc-work.mjs" verify --all     # every row, against the code as it stands now
node "$LIFEAI_ENV/bin/rdc-work.mjs" drop t3 --reason "no dev target exists for this package"
node "$LIFEAI_ENV/bin/rdc-work.mjs" status           # the checklist Stop will judge
node "$LIFEAI_ENV/bin/rdc-work.mjs" check            # exit 0 when Stop would pass
```

A proof taken **before the session's last edit is stale** — the edit may have broken
it. Finish every piece of work with `verify --all`. A dropped row is resolved, not
passed, and stays visible with its reason.

## Stop

Stop is `rdc-work check`: every row proved after the last edit or dropped with a
reason, the target's tracked changes committed, and — for a work-item contract —
its database DoD closed. The block message is the checklist. Enforcement is
bounded: a Stop held identically three times, or six times in a row, releases,
and the unproved rows stay in the contract and in the compaction snapshot.

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
cannot flip it for itself.
