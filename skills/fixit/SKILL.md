---
name: rdc:fixit
description: "Usage `rdc:fixit <description>` — Quick fix under 5 files / 30 min that does not warrant a full plan→build cycle. Creates a minimal work item, makes the change, commits, runs a mandatory code-review pass (pr-review-toolkit:code-reviewer), DELIVERS the change to where it is consumed (publish/deploy/land) and verifies it, then closes. The only sanctioned bypass of rdc:build."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`), then `{PROJECT_ROOT}/.rdc/guides/engineering-behavior.md` (fallback: `{PROJECT_ROOT}/.rdc/guides/engineering-behavior.md`).

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

Apply `guides/engineering-behavior.md`: state material assumptions in the
implementation report, avoid speculative abstractions, touch only required
files, and verify behavior before moving the work item to `review`.

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

### 5.5 Mandatory code-review gate (before submitting implementation report)

⛔ **No fixit closes without a code-review pass.** Even single-file changes go through review.

Dispatch ONE `pr-review-toolkit:code-reviewer` agent on the fixit commit:

```
Agent({
  subagent_type: "pr-review-toolkit:code-reviewer",
  description: "fixit code review",
  prompt: "Review `git show HEAD` on the development branch. Focus on:
           bugs, logic errors, security, project-convention adherence (.claude/rules/*).
           Confidence-based filtering — high-confidence findings only.
           Return CODE_REVIEW_COMPLETE with: { critical_count, high_count, medium_count,
           low_count, findings: [{severity, file:line, issue, suggested_fix}] }."
})
```

**Severity gate:**
- `critical` or `high` findings → fix in this same fixit session (do not escalate to rdc:build for the fix itself; the original fixit owns the cleanup), re-commit, re-run review until clean
- `medium` or `low` findings → record in `implementation_report.flags`; proceed to close
- Zero findings → proceed to close

Under `RDC_TEST=1`: echo `[RDC_TEST] skipping code-review dispatch` and proceed.

### 5.7 Deliver to done (MANDATORY — a fixit is not done until the change is LIVE)

⛔ **"Committed and pushed" is NOT done.** Editing code and walking away is the exact
failure this step exists to prevent. A fixit closes only when the change has reached the
place it is actually consumed, verified with a structural probe.

Identify the target's delivery mechanism from its registry/manifest/`package.json` and
complete it:

| Target shape | "Done" = delivered means | How + structural proof |
|---|---|---|
| Published package (npm / PyPI) | new version live on the registry | run the repo's release/publish path (e.g. `npm publish --access public`); verify `npm view <pkg> version` == new version |
| Deployed app (`apps/*`, sites) | change live on the running host | `/rdc:deploy <slug>` (dev) / `promote` (prod); verify HTTP 200 + content probe |
| Shared lib consumed in-repo | landed on the integration branch | `node scripts/land.mjs` (or repo equivalent); verify branch contains the SHA |
| Standalone repo | its own release ritual completed | follow the repo's release script/tag; verify the artifact/tag exists |
| Pure doc / internal-only change, NO downstream consumer | committed + landed | no deploy; this is the ONLY case where commit == done |

Hard rules for this gate:
- **A version bump obligates a release.** If you bumped `package.json` / `__version__` /
  a lockfile version, you MUST publish/deploy it — a bumped-but-unshipped version is an
  unfinished fixit, not a done one.
- **Verify with a structural probe**, never an assumption: registry version string, HTTP
  status, tag/commit presence.
- **If delivery cannot complete in-session** (needs an OTP/secret you lack, a human
  approval, a denied command, or a manual prod promotion): DO NOT close `done`. Set the
  work item `blocked` with the exact remaining command + reason, and tell the user the one
  step to run (offer it as `! <command>` so it runs in-session). "Blocked on a named
  delivery step" is honest; "done" without delivery is the bug we are fixing.

Under `RDC_TEST=1`: echo `[RDC_TEST] skipping delivery (publish/deploy)` and proceed; the
gate is validated structurally, not executed.

### 6. Close and clean up

Submit implementation report first, move to review, then close as validator.
**Precondition: Step 5.7 delivery is verified.** If delivery is blocked, set status
`blocked` (not `done`) with the remaining step — never mark `done` on an undelivered change:

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

If the fix touched a transactional flow, API boundary, or package contract, set `"transactional": true` and populate `memory_records` (see `agent-bootstrap.md`), then run:
```bash
node scripts/work-item-memory.mjs <work-item-id>
# Note: verify script exists first: ls {PROJECT_ROOT}/scripts/work-item-memory.mjs
# If the script is absent, skip this step and note it in the implementation report.
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
- **Done = delivered, not committed.** A fixit is `done` only when the change is live where
  it is consumed (published / deployed / landed) AND verified structurally. A version bump
  obligates a publish. If delivery can't complete in-session, close `blocked` with the named
  step — never `done`.

## Capture lessons (exit step)

Before the final verdict line, follow `.rdc/guides/lessons-learned-spec.md` § Capture procedure. If this run taught something non-obvious — a first root-cause theory that turned out wrong, the documented/standard path not working, a missing gate or check that cost a round, or a surprising tool/infra behavior — write one `.rdc/lessons/<YYYY-MM-DD>-fixit-<short-slug>.md` per lesson using the schema in that spec. Set `scope` (`simple` | `architectural`) and `status` (`open`, or `applied` if you shipped the fix in this same run, with the commit linked). Commit the lesson file(s) on `develop` alongside the run's other commits, and note "N lessons captured" in your verdict/summary. A run that taught nothing writes nothing — absence is the default.
