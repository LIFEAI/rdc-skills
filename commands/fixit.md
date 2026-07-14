---
name: rdc:fixit
description: >-
  Usage `rdc:fixit <description>` — sanctioned bypass for quick fixes under 5 files / 30 min. Creates minimal work item, makes fix, commits, DELIVERS it to where it is consumed (publish/deploy/land) and verifies, then closes. The ONLY alternative to rdc:build. For typos, config patches, hotfixes, dep bumps.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.


# rdc:fixit — Sanctioned Quick Fix

## When to Use
- Typo or single-line text correction
- Config value change (env vars, constants, feature flags)
- Emergency hotfix that cannot wait for a full build cycle
- Dependency version bump
- CSS/styling tweak on a single component
- Broken import or export fix
- Single-file logic correction

## When NOT to Use — escalate to rdc:build instead
- New feature of any size
- Refactor touching >5 files
- Anything requiring architecture decisions
- Work that will take longer than 30 minutes
- Schema changes or migrations

## Arguments
- `rdc:fixit <description>` — fix the described issue

## Procedure

### 1. Scope check (mandatory — do this before touching any file)

Will this fix touch more than **5 files** or take more than **30 minutes**?

- **YES** → Stop. Use `/rdc:build` instead. Explain to the user why.
- **NO** → Continue.

### 2. Create a minimal work item (before touching any code)

```sql
SELECT insert_work_item(
  p_title     := 'fixit: <description>',
  p_item_type := 'bug',
  p_priority  := 'urgent',
  p_status    := 'in_progress',
  p_source    := 'fixit'
);
```

Note the returned `id`.

### 3. Write the fixit session marker

Write to `{USER_HOME}/.claude/fixit.marker`:
```
<work_item_id>
<ISO timestamp>
<description>
```

This signals the Stop hook that fixit is handling its own documentation.

### 4. Make the fix

Do the minimal work. Scope creep rule: if you discover the fix requires more than originally scoped, **stop immediately**:
1. Close the work item: `update_work_item_status('<id>', 'blocked', '["Escalated — scope exceeded fixit threshold"]')`
2. Delete the marker file
3. Tell the user to use `/rdc:build` instead

### 5. Commit

```bash
git add <specific files only — never git add -A for a fixit>
git commit -m "fix(<scope>): <description>"
if [ "$RDC_TEST" != "1" ]; then
  git push origin {development-branch}
else
  echo "[RDC_TEST] skipping git push origin {development-branch}"
fi
```

### 5.5 Deliver to done (MANDATORY — a fixit is not done until the change is LIVE)

⛔ **"Committed and pushed" is NOT done.** Editing code and walking away is the exact
failure this step exists to prevent. Carry the change to where it is consumed and verify it:

| Target shape | "Done" = delivered means | How + structural proof |
|---|---|---|
| Published package (npm / PyPI) | new version live on the registry | `npm publish --access public` (or repo release path); verify `npm view <pkg> version` == new version |
| Deployed app (`apps/*`, sites) | change live on the running host | `/rdc:deploy <slug>` (dev) / `promote` (prod); verify HTTP 200 + content probe |
| Shared lib consumed in-repo | landed on the integration branch | `node scripts/land.mjs`; verify branch contains the SHA |
| Standalone repo | its own release ritual completed | repo release script/tag; verify the artifact/tag exists |
| Pure doc / internal-only change, NO consumer | committed + landed | no deploy; the ONLY case where commit == done |

- **A version bump obligates a release.** A bumped-but-unshipped version is an unfinished fixit.
- **Verify structurally** (registry version, HTTP status, tag presence), never by assumption.
- **If delivery can't complete in-session** (missing OTP/secret, human approval, denied
  command, manual prod promotion): set the work item `blocked` with the exact remaining
  command + reason and tell the user the one step to run — do NOT mark `done`.

Under `RDC_TEST=1`: echo `[RDC_TEST] skipping delivery (publish/deploy)` and proceed.

### 6. Report, review, close, and clean up

**Precondition: Step 5.5 delivery is verified.** If delivery is blocked, set `blocked` (not
`done`) with the remaining step — never mark an undelivered change `done`.

```sql
SELECT submit_implementation_report('<id>'::uuid,
  '{"tldr":"<one sentence>","assumptions":[],"deviations":[],"uncertainty":[],"detail":"<what was fixed>","flags":[],"transactional":false,"memory_records":[],"codeflow_post":{"agent_session_id":"<agent-session-id>","summary":"<what changed and why>","files_changed":["<path>"],"verification":["<command/evidence>"],"commit":"<hash optional>"}}'::jsonb
);

SELECT update_work_item_status('<id>'::uuid, 'review',
  '["Fixed via rdc:fixit; ready for validation"]'::jsonb,
  '<agent-session-id>',
  'agent'
);

SELECT update_work_item_status('<id>'::uuid, 'done',
  '["Validator verified rdc:fixit report, CodeFlow post, and checklist evidence"]'::jsonb,
  '<validator-session-id>',
  'validator'
);
```

```bash
rm {USER_HOME}/.claude/fixit.marker
```

### 7. Confirm to user

Report: what was fixed, file(s) changed, commit hash. One sentence.

## Rules
- Work item created BEFORE any code change — never after
- `git add` specific files only — never `-A` or `.` for a fixit
- Branch: development branch always
- Never run `pnpm build` — not needed for a fixit
- If scope expands mid-fix: stop, escalate to rdc:build, don't finish under fixit
- Marker file must be cleaned up whether fix succeeds or escalates
- **Done = delivered, not committed.** Live where consumed (published/deployed/landed) +
  verified. A version bump obligates a publish. Can't deliver in-session → `blocked`, never `done`.
