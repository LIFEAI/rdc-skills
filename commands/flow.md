---
name: flow
description: "rdc:flow [status|<state> [\"<reason>\"]|normal] — show or set the flow state"
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:flow — the one FSM surface

## When to Use
- Starting a turn — declare what kind of work this is (`build` needs a work item, `plan`/`design`/`collab` don't)
- A production incident where process ceremony is costing minutes that matter (`hotfix`)
- Routine upkeep that needs the same relaxation, without calling it an incident (`maintenance`)
- Checking what's currently declared, and why

## The one thing to understand first

**There used to be two systems — mode (safety relaxation) and flow (work-shape declaration) — kept deliberately separate.** Operator instruction, 2026-08-25/26, direct and live: *"no special modes -- flow states only -- move hotfix to a flow state -- move env-bypass to a flow state -- the fsm will set what is enabled."*

`hotfix` and `maintenance` are now real flow values, carrying the exact same safety guarantee they always did as modes: a reason is required to enter either, and only the named ceremony allowlist (`HOTFIX_DISABLES`/`HOTFIX_RELAXES_GATES` in `$LIFEAI_ENV/hooks/lib/rdc-flow.mjs` and `C:/Dev/rdc-harness/fsm-daemon/src/matrix.js`) is ever relaxed — never a safety guard (`execution-scope`, `rm-rf-danger`, `push-force`, credential-exposure, etc.).

`rdc:mode` still exists for backward compatibility — the old mode axis is untouched, working code — but new work should use `rdc:flow` for everything, including what used to be a mode change.

## States

| State | Meaning | Requires a reason | Work item required |
|---|---|---|---|
| `plan` / `design` / `collab` | Conversational — nothing shipping | no | no |
| `build` / `refactor` / `overnight` | Shipping code | no | **yes** |
| `harness-testing` | Proving/testing rdc-harness's own binding guard | no | yes |
| `hotfix` | Incident — ceremony relaxed for a bounded reason | **yes** | no |
| `maintenance` | Routine upkeep — same relaxation power as hotfix, different label | **yes** | no |

## Usage

```
rdc:flow                          # status — the default
rdc:flow status
rdc:flow build                    # declare shipping work — no reason needed
rdc:flow hotfix "prod checkout 500s"   # relax ceremony — reason required
rdc:flow normal                   # clear — back to no flow declared
```

## Steps

### 1. Read the current state

```bash
node -e "import(require('url').pathToFileURL(process.env.LIFEAI_ENV + '/hooks/lib/rdc-flow.mjs').href).then(m=>console.log(JSON.stringify(m.currentState(),null,2)))"
```

`currentState()` reads BOTH axes at once — the declared flow AND any live `rdc-mode.mjs` hotfix/maintenance window — because a relaxed mode overrides a required flow (loosest state wins) and a status check that only showed flow would miss that override entirely. Report `flow` (or `null` if nothing declared — the fail-closed default), `flowReason`/`flowSetBy`/`flowSetAt` when set, and `mode` (`normal` unless a hotfix/maintenance window is open), with `modeReason`/`modeMinutesLeft` when it isn't.

### 2. Setting a plain work-shape flow — no reason required

```bash
node -e "import(require('url').pathToFileURL(process.env.LIFEAI_ENV + '/hooks/lib/rdc-flow.mjs').href).then(m=>console.log(JSON.stringify(m.setFlow(process.argv[1],{setBy:process.argv[2]}),null,2)))" "<flow>" "<session-id>"
```

### 3. Setting hotfix or maintenance — a reason is REQUIRED

Refuse to proceed without one — `setFlow` throws on an empty reason for these two values, by design, same as `setMode` always did: an unexplained disarm is how a temporary state becomes permanent.

```bash
node -e "import(require('url').pathToFileURL(process.env.LIFEAI_ENV + '/hooks/lib/rdc-flow.mjs').href).then(m=>console.log(JSON.stringify(m.setFlow('hotfix',{reason:process.argv[1],setBy:process.argv[2]}),null,2)))" "<reason>" "<session-id>"
```

Then state plainly, in the checklist: **which guards are now relaxed, that the safety set is still armed, and that this stays active until explicitly cleared (no TTL — active management, not a silent timer).**

### 4. Returning to normal

```bash
node -e "import(require('url').pathToFileURL(process.env.LIFEAI_ENV + '/hooks/lib/rdc-flow.mjs').href).then(m=>{m.clearFlow();console.log('cleared')})"
```

Do this **as soon as the incident is over**, or the moment the declared work-shape changes.

## Rules

- **A reason is mandatory for `hotfix`/`maintenance`.** Every other flow value is a plain, reason-free declaration.
- **No TTL, ever, by default.** A flow — including `hotfix`/`maintenance` — stays active until explicitly cleared or replaced. Never a silent expiry.
- **Fail-closed.** No flow declared, an unreadable daemon, or a malformed response all read as `{flow: null}` — same behavior a work-shipping turn always had before this mechanism existed.
- **Never widen the relaxation set to unblock yourself.** A guard blocking a hotfix flow is information. Editing the allowlist to get past a red guard is the same violation as editing code to satisfy a failing gate (`.claude/rules/debugging-protocol.md` Rule 10).
- **hotfix/maintenance flow is not a bypass of review.** Work done under it still needs its work item, its evidence, and its close.

## Verification

```bash
node --test $LIFEAI_ENV/tests/rdc-flow.test.mjs
node --test C:/Dev/rdc-harness/fsm-daemon/tests/matrix.test.js
```
