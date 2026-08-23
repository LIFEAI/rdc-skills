---
name: recover
description: >-
  Usage `rdc:recover [list|start]` — deterministic post-crash recovery: detect, repair (CodeFlow/PM2 only), verify, then find and resume abandoned Claude/Codex worktree-lane sessions.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` §
> RDC_TEST Sandbox Contract. Under `$RDC_TEST=1`, Phase 3 (REPAIR) is skipped —
> echo `[RDC_TEST] skipping CodeFlow/PM2 repair` and proceed. DETECT, DIAGNOSE, VERIFY,
> and SESSIONS are all read-only probes and run normally.

# rdc:recover — post-crash session recovery

## When to Use
- After a box crash, terminal-window crash, or unclean shutdown
- Checking whether any Claude/Codex worktree-lane session was mid-work when it happened
- Resuming a session that got abandoned, without hunting for its id by hand

## The one thing to understand first

**This is a script, not a hunt.** All the actual logic — crash detection, engine-specific
liveness, lane classification, self-elevation to a visible window — lives in the project's
own `scripts/box-recovery.ps1` / `scripts/recover-session.ps1` / `scripts/lib/session-detect.ps1`.
This skill is a thin, deterministic dispatcher onto those scripts. Do not reimplement any of
their classification logic here, and do not improvise an alternate repair path if a phase
fails — report the failure with its exact command + output instead.

**Both scripts self-elevate to a real, persistent, visible terminal window on their own** —
they detect a non-interactive invocation (`[Console]::IsOutputRedirected`, true when your
tool call captures/pipes their output) and relaunch themselves via `wt.exe new-tab`, then
exit immediately. Do NOT manually wrap them in your own `wt.exe` call — just invoke the
script directly. That used to be the caller's job and got done wrong repeatedly live; it's
the script's own job now.

## Usage

```
rdc:recover                # full pipeline — detect, repair, verify, report+offer sessions
rdc:recover list           # report only — no repair, no launch, no prompt
rdc:recover start          # skip detect/diagnose/repair/verify — just resume matched sessions
```

## Subcommands

### `rdc:recover` (no argument) — full pipeline

Resolve the caller's actual project root first (never assume it's this plugin's own repo):

```bash
ROOT=$(git rev-parse --show-toplevel)
pwsh -File "$ROOT/scripts/box-recovery.ps1"
```

Deterministic, five phases in order — do not skip ahead, do not improvise alternate repair
commands:

1. **DETECT** — was there actually an unclean shutdown (Kernel-Power Event 41), and is
   memory/commit charge under pressure right now.
2. **DIAGNOSE** — is CodeFlow's local gateway (`:3109`) up, is the local PM2 process table
   empty (nothing resurrected after reboot).
3. **REPAIR** — owner-sanctioned repair only: `node scripts/codeflow-repair.mjs` for
   CodeFlow, `pm2 resurrect` for the local PM2 fleet. **Never** auto-starts an app named
   `rtp` even if it's in the saved PM2 dump — see the script's own header for why. Do not
   override that by hand-invoking `pm2 start rtp`.
4. **VERIFY** — `pnpm agent:readiness` must report `ok:true`, plus a live probe of clauth
   (`:52437/ping`) and CodeFlow (`:3109/health`). Do not report recovery as complete on
   anything less than a live probe.
5. **SESSIONS** — reports every worktree lane that was mid-session at crash time and is not
   live right now (`aborted`), lanes with a crash-window transcript that have already
   reattached (`✅ Already recovered`), and general stale lanes unrelated to this crash
   (`orphan`). Prints exact resume commands for everything pending, then offers one
   interactive prompt to resume some/all of it. A lane whose session engine doesn't match
   its lane's owning engine (a Claude session in an `x-codex-*` lane, or vice versa) is
   reported as a `LANE MISMATCH` and is a HARD RULE never launched, under any flag.

Because this launches a real visible window and its own interactive prompt, when running as
an agent (no human at that window to answer it) do not rely on the bare form to resume
anything — the window opens, the prompt waits, nothing gets resumed until a human answers
it. Report that the window is open and stop there. To have the agent itself resume sessions
non-interactively, use `rdc:recover start` below instead.

### `rdc:recover list` — report only, no repair, no launch, no prompt

Skips the entire detect/diagnose/repair/verify stack entirely. Pure report:

```bash
ROOT=$(git rev-parse --show-toplevel)
pwsh -File "$ROOT/scripts/recover-session.ps1" -ListOnly
```

Add `-All` for the full inventory including `live` and `clean` lanes, not just
`aborted`/`orphan`.

### `rdc:recover start` — resume, skipping the whole recovery stack

Also skips detect/diagnose/repair/verify — this is the addressable primitive, not the
crash orchestrator. Since an agent invoking this has no human sitting at the window to
answer an interactive prompt, always pass `-Launch` explicitly to skip it:

```bash
ROOT=$(git rev-parse --show-toplevel)

# all matched (aborted + orphan by default; narrow with -Status/-Engine/-Role)
pwsh -File "$ROOT/scripts/recover-session.ps1" -Launch

# one specific session
pwsh -File "$ROOT/scripts/recover-session.ps1" -Id <sessionId> -Launch
```

## After launching, in every subcommand

Tell the user the window is open and to watch/answer it there — do not try to relay live
phase-by-phase output, you don't have it. If you need to verify the result yourself (e.g.
to answer a follow-up), read the run-record log the script writes on completion under
`C:\Dev\.logs\regen-root\<script-name>\<date>\` (newest file), rather than re-running the
script a second time in your own context.

## Rules

- **Never reimplement the classification logic in this skill.** Engine-specific liveness,
  crash-window matching, lane-mismatch detection, and orphan/aborted status all live in
  `scripts/lib/session-detect.ps1` — read it if you need to understand *why* a session was
  classified a certain way, never re-derive the answer independently.
- **Lane mismatch is never launched, under any flag or filter.** A Claude session found
  sitting in a Codex-owned lane (or vice versa) is a HARD RULE violation if resumed there —
  both scripts already enforce this; do not work around it.
- **If any phase fails, report exactly what failed and why** (cited command + output) — do
  not guess a cause or invent a fix outside the script's own repair paths. If CodeFlow
  repair itself fails, that is CodeFlow's own failure: report it, do not hand-patch
  `packages/codeflow`.
- **Do not disrupt what you're trying to recover.** Never restart clauth, CodeFlow, or PM2
  mid-diagnosis as a troubleshooting step — that can BE the reason a symptom changes.
- **-AutoRun's launch (if the caller wires this into logon) stays scoped to crash casualties
  only.** Orphan lanes are reported for visibility but never silently auto-launched on an
  unrelated crash's recovery run — see `box-recovery.ps1`'s own `$launchSet` handling.

## Verification

The scripts themselves are the source of truth; this skill does not carry its own test
suite. To verify a change to the underlying scripts, from the caller's project root:

```bash
pwsh -Command '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile("scripts/box-recovery.ps1", [ref]$null, [ref]$e); if ($e.Count -gt 0) { $e } else { "OK" }'
pwsh -File scripts/recover-session.ps1 -ListOnly -All -NoSelfElevate
```
