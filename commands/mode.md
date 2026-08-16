---
name: mode
description: >-
  Usage `rdc:mode [status|hotfix "<reason>" [minutes]|normal]` — show or set the operating mode. HotFix relaxes ceremony gates for a bounded window; it never relaxes a safety guard.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:mode — operating mode

## When to Use
- A production incident where process ceremony is costing minutes that matter
- Checking whether a permissive window is currently open (and when it closes)
- Closing one early, the moment the incident is over

## The one thing to understand first

**HotFix relaxes CEREMONY. It cannot relax SAFETY.**

That is enforced in code as an allowlist, not a promise in a doc: only the eight
ceremony rules named in `$LIFEAI_ENV/hooks/lib/rdc-mode.mjs` (`HOTFIX_DISABLES`)
can ever be skipped, and the filtering happens at one place —
`ALL_RULES()` in `guard-rules.mjs` — which all four of `evaluateGuard`'s passes
iterate. A guard added tomorrow is **essential by default**.

| relaxed in HotFix | never relaxed, in any mode |
|---|---|
| `full-build` · `polling-loops` · `persistent-cd` · `powershell-5.1` · `build-shortcircuit` · `codex-work-item-wrapper` · `codex-supabase-rpc-wrapper` · `codex-ssh-preflight` | `push-main` · `push-force` · `no-verify` · `rm-rf-danger` · `remove-item-danger` · `reset-hard-pool` · `clauth-exposure` · `ssh-key-raw-fetch` · `cross-tree-bash` · `lane-push-develop` · `git-add-all-standalone` · `coolify-direct` · `execution-scope` · `env-repo-maintainer-only` · `settings-json-direct-edit` · `node-modules-write` · `neo4j-outside-codeflow` · `resurrect-deleted-path` · `onramp-*` · `terminal-window-mutation` |

Everything in the left column costs **time or tidiness**, and fails immediately,
locally and visibly. Everything in the right column is irreversible, destroys
another session's work, leaks a secret into a transcript forever, or fabricates
governance evidence.

Ceremony **gates** are relaxed alongside the guards: `truth-gate`,
`completion-gate`, `stop-test-nudge`, `rdc-commit-gate`.

## Why this exists

Five unrelated escape hatches had already accumulated — `ALLOW_RESURRECT`,
`LIFEAI_ENV_MAINTAINER`, `RDC_TEST`, the `RDC-Bypass:` commit trailer, and a
CodeFlow break-glass file. Each was added when one guard got in the way, each has
its own spelling, **none expires**, and none is audited with the others. Somebody
in a hurry cannot find the right one, so they reach for the one they remember —
usually the biggest.

One named state, with a reason and a deadline, is easier to find *and* smaller in
blast radius than any of them.

## Usage

```
rdc:mode                              # status — the default
rdc:mode status
rdc:mode hotfix "prod checkout 500s"  # open a 60-minute window
rdc:mode hotfix "prod down" 120       # explicit minutes, capped at 240
rdc:mode normal                       # close it early
```

## Steps

### 1. Read the current mode

```bash
node -e "import('file:///C:/Dev/lifeai-env/hooks/lib/rdc-mode.mjs').then(m=>console.log(JSON.stringify(m.currentMode(),null,2)))"
```

Report `mode`, and when not normal also `reason`, `setBy`, and `minutesLeft`.
A mode with no minutes left is already normal — the state expires on read, not on
a timer, so there is nothing to clean up.

### 2. Setting hotfix — a reason is REQUIRED

Refuse to proceed without one. `setMode` throws on an empty reason by design: an
unexplained disarm is how a temporary state becomes permanent, and the reason is
the entire content of the audit line.

```bash
node -e "import('file:///C:/Dev/lifeai-env/hooks/lib/rdc-mode.mjs').then(m=>console.log(JSON.stringify(m.setMode('hotfix',{reason:process.argv[1],minutes:Number(process.argv[2]||60),setBy:process.argv[3]}),null,2)))" "<reason>" "<minutes>" "<session-id>"
```

Then state plainly, in the checklist: **which guards are now off, that the safety
set is still armed, and the exact wall-clock time the window closes.**

### 3. Returning to normal

```bash
node -e "import('file:///C:/Dev/lifeai-env/hooks/lib/rdc-mode.mjs').then(m=>{m.clearMode();console.log('normal')})"
```

Do this **as soon as the incident is over**. The window expiring on its own is
the backstop, not the plan.

## Rules

- **A reason is mandatory.** No reason, no mode change.
- **Bounded.** Default 60 minutes, hard cap 240. A hotfix is an incident, not a
  working style. If the work needs longer than 240 minutes it is not a hotfix and
  wants `rdc:fixit` or `rdc:build`.
- **Fail-closed.** Absent, malformed, unknown-mode or expired state all read as
  `normal`. The hurry that motivates a hotfix is exactly the state in which a
  silently-stuck permissive mode does the most damage.
- **Never widen the disable set to unblock yourself.** A guard blocking a hotfix
  is information. If it is genuinely wrong, that is its own change with its own
  review — editing `HOTFIX_DISABLES` to get past a red guard is the same
  violation as editing code to satisfy a failing gate
  (`.claude/rules/debugging-protocol.md` Rule 10). The safety list is asserted by
  name in `tests/rdc-mode.test.mjs`, so that edit fails a test.
- **HotFix is not a bypass of review.** Work done in a hotfix window still needs
  its work item, its evidence, and its close. The window buys speed on ceremony,
  not permission to skip the record.

## Verification

```bash
node --test $LIFEAI_ENV/tests/rdc-mode.test.mjs
```

Seven cases, including the load-bearing one: every safety guard is asserted **by
name** to remain armed while a hotfix window is open.
