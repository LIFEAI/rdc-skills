---
name: open
description: >-
  Usage `rdc:open [<slug>]` — orient before working. Answers where you are (repo, worktree, branch, dirty state) and what the target is (runtime, port, host, deploy path) from the registry, then names the harness shape to use. Run this first in any session that will change something.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.

# rdc:open — you are here, this is the thing, use this shape

## Why this exists

Orientation ran **3.4× production work** across a measured 36-hour window —
47.6% of tool calls establishing position and identity, 14.1% actually changing
something. `git rev-parse` alone was 316 calls, 6% of everything.

Cross-session rediscovery was **1.4%**. That number is the point: agents are not
forgetting what they learned, they are working new ground almost every time and
nothing tells them where they are. This is a surfacing problem, not a memory
problem, so caching buys nothing and an opening statement buys everything.

## When to Use

- **First call of any session that will change something.** Before the first
  read, not after the third `git status`.
- When you are handed a slug and do not know its runtime, port, or host.
- After a compaction, when position facts have aged out of context.
- Before any deploy — `rdc:deploy` assumes you already know the target's shape.

Not needed for a pure conversation turn.

## What it answers

| Question | Source | Never |
|---|---|---|
| which repo / worktree / branch am I in | `git rev-parse`, `git status` | assumed from a hardcoded path |
| is my tree clean, am I behind | `git status -sb` | inferred from elapsed time |
| what IS this slug | `get_deployment('<slug>')` | guessed from the directory name |
| runtime, port, PM2 name, host | the registry | inferred from files on disk |
| who depends on it | the registry | assumed to be nothing |

**Two guesses this replaces, both measured wrong in practice:** filesystem
inference said `node-build` where the registry says `ts-server`; and
directory-name-as-slug fails outright — `packages/codeflow` is `codeflow-mcp`,
`apps/admin` is `portal`.

## Steps

1. **Position.** `node scripts/orient.mjs` — repo, worktree, branch @ sha,
   upstream, dirty count. Relative paths from here are correct by construction;
   a hardcoded `C:/Dev/regen-root/...` from a lane points at a *different
   checkout*.
2. **Target.** `node scripts/orient.mjs <slug>` — resolves the slug through
   `get_deployment`, printing runtime, port, host, deploy path and dependents.
   `monorepo_path` NULL means a standalone repo, not in this tree.
3. **Harness.** Name the shape the target's class implies:

   | class | build | dev | prod |
   |---|---|---|---|
   | `apps/<name>` | `pnpm --filter @regen/<name> build` | PM2 @ Vultr | Coolify |
   | `packages/<name>` | `pnpm --filter @regen/<name> build` | imported | `npm publish` |
   | `sites/`, `models/` | static/vite | PM2 @ Vultr | Coolify |
   | standalone | its own tooling | — | Coolify |

4. **State the ground in one line** and start. Do not re-derive it later in the
   turn.

## Checklist

```
[ ] position resolved — repo, worktree, branch, dirty count
[ ] target resolved from the registry (or: no slug given, position only)
[ ] harness shape named for the target's class
[ ] blockers noted — behind upstream, dirty tree, service down
```

## Related

- `rdc:flow` — declares what KIND of work this is. `rdc:open` says where you are;
  `rdc:flow` says what you are doing. Both, in that order.
- `rdc:status` — open epics and queue. That is the work; this is the ground.
- `$LIFEAI_ENV/docs/GATES-GUARDS-DENIES.md` — when a guard stops you, that names
  the shape that works.
