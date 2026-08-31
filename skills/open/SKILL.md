---
name: open
description: rdc:open ([slug]) — orient before working; answers where you are and what the target is from the registry, then names the harness shape
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:open — you are here, this is the thing, use this shape

## Run the script. Do not re-derive this by hand.

```bash
node C:/Dev/rdc-harness/bin/rdc-harness.mjs open <slug>
```

**This file used to describe what `open` answers without ever naming the tool
that answers it** — zero mentions of `rdc-harness` in 128 lines — so every agent
reading it re-implemented orientation with `git rev-parse` and `git status`,
which is precisely the 6%-of-all-tool-calls waste the next section measures. The
verb has existed the whole time. Corrected 2026-08-31 on operator instruction:
"open is supposed to be a script, the skill says call the script."

It returns one JSON object. Read it; do not reconstruct it:

```
opened: true
handle:  hnd_…            binding: bnd_…
permittedActions: ["read","write","edit","save"]
sourceBoundary:   C:/Dev/clauth
productClass: package     workModel: standalone
delivery: {production:"registry-release", deploy:false, release:true}
weDoNotHold: ["subtree","runtime_contract","deployment_record"]
boundaryNote: "C:/Dev/clauth is the SHARED checkout for a worktree-pooled repo
               — work belongs in a lane under C:/Dev/clauth.wt, not here"
```

That is a **scoped grant**, not a readout: `permittedActions` and
`sourceBoundary` say what you may touch and where. `boundaryNote` is the answer
to "which checkout do I work in" — it already knows pooled repos want a lane.

**Unresolved is a result, not an error.** `open regen-root` returns
`weDoNotHold: ["product_class"]`; `open fsm` returns `unknown_slug`. Register the
target, then open it again — never guess a default and never fall back to
hand-rolled git.

**Two targets at once is two calls.** Each returns its own `bindingId` and its
own `sourceBoundary`; nothing is exclusive. Working `clauth` and `rdc-harness`
together is two opens and two bindings.

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
| what IS this slug | the registry | guessed from the directory name |
| runtime, port, PM2 name, host | the registry | inferred from files on disk |
| who depends on it | the registry | assumed to be nothing |

**Two guesses this replaces, both measured wrong in practice:** filesystem
inference said `node-build` where the registry says `ts-server`; and
directory-name-as-slug fails outright — `packages/codeflow` is `codeflow-mcp`,
`apps/admin` is `portal`.

## The registry is the gate — no register, no go

`open` resolves a slug against the **database**, never a file. A target that is
not registered is not "probably fine to work on", it is **unresolved**, and the
correct output names what is missing rather than guessing a default.

This is why `projects.json` was demoted to a generated artifact and
`repo_registry` became source of truth: a file-based config is a side door
around the registration gate, and a side door means work can begin on something
the system never formally established.

`open` reports that state honestly rather than papering it:

```
weDoNotHold: ["product_class"]        # regen-root — repo shape known, class not
weDoNotHold: ["repository"]           # prt — slug not resolvable to a repo yet
status: "unresolved"                  # never a guessed default
```

An `unresolved` open is a finding, not a failure. Register the target, then open
it again.

## What open hands to land and deploy

`open` returns the **source key** every downstream verb dispatches on:

| field | meaning | example |
|---|---|---|
| `workModel` | repo shape | `standalone` · `mono` |
| `productClass` | what the deliverable is | `package` · `app` · `site` · `mcp` |
| `delivery` | resolved ship contract | `{production:"registry-release", deploy:false, release:true}` |
| `sourceBoundary` | where work is permitted | absolute path, or repo-relative subtree |
| `weDoNotHold` | what is NOT established | `["product_class"]` |

Together `workModel.productClass` is the source half of the routing key —
`standalone.package`, `mono.app`, `mono.site` — which pairs with a destination
type to select the router (`standalone.package.npm`, `mono.site.netlify`).

**Record only WHAT, never HOW.** Persist the slug set being worked on; do not
copy `delivery`, `productClass`, or boundary facts into a session file. Those
have exactly one home each, and a copy starts drifting the moment it is written.
Downstream verbs re-resolve from the registry by slug.

## Steps

0. **Call `rdc-harness open <slug>`.** Steps 1–2 are what it returns, not a
   procedure to perform. Only hand-resolve if the harness is genuinely
   unavailable, and say so explicitly when you do.
1. **Position.** Read `sourceBoundary` and `boundaryNote` from the result — they
   already account for pooled repos and lanes. Relative paths from there are
   correct by construction; a hardcoded `C:/Dev/regen-root/...` from a lane
   points at a *different checkout*.
2. **Target.** Read `productClass`, `workModel`, `delivery` and `weDoNotHold`
   from the same result. `monorepo_path` NULL means a standalone repo, not in
   this tree. Do not re-query the registry for facts the handle already carries.
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
[ ] unresolved fields named explicitly, never defaulted
[ ] harness shape named for the target's class
[ ] blockers noted — behind upstream, dirty tree, service down
```

## Related

- `rdc:flow` — declares what KIND of work this is. `rdc:open` says where you are;
  `rdc:flow` says what you are doing. Both, in that order.
- `rdc:status` — open epics and queue. That is the work; this is the ground.
- `rdc:deploy` — consumes the source key this skill resolves.
- `$LIFEAI_ENV/docs/GATES-GUARDS-DENIES.md` — when a guard stops you, that names
  the shape that works.
