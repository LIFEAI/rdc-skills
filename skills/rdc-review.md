---
name: rdc:review
description: >-
  Usage `rdc:review [--unattended]` — tests, typecheck, stale docs, export conflicts across modified packages. Fixes issues found. Use after a build session or before merging to main.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).


# rdc:review — Quality Gate

## When to Use
- After a build session (especially overnight builds)
- Before merging development → main/production
- Project lead asks "review the work", "is everything clean"
- Before any production deployment
- Called by `rdc:overnight` after each epic build completes

## Arguments
- `rdc:review` — interactive review, pauses on issues needing judgment
- `rdc:review --unattended` — silent mode, auto-fixes everything fixable

## Procedure

1. **Identify modified packages:**
   ```bash
   git diff --name-only origin/main...HEAD | grep "^packages/" | cut -d/ -f2 | sort -u
   ```

2. **Run tests for each modified package:**
   ```bash
   cd packages/<name> && npx vitest run 2>&1 | tail -10
   ```
   Report: package → test count → pass/fail → new tests added

   **IMPORTANT:** `pnpm build` must NEVER be run (crashes system). Use `npx tsc --noEmit --project <path>/tsconfig.json` for typecheck instead. For packages without tests, typecheck is the verification method. Do NOT run vitest across the entire monorepo — check only modified packages individually.

3. **Check test coverage delta:**
   ```bash
   git diff origin/main...HEAD -- packages/*/src/ | grep -c "^+" | head -5
   git diff origin/main...HEAD -- packages/*/test* packages/*/src/**/*.test.* packages/*/src/**/*.spec.* 2>/dev/null | grep -c "^+" || echo 0
   ```
   Flag any package where implementation lines added > 50 but test lines added = 0.

4. **Check for export conflicts:**
   - Read `packages/*/src/index.ts` for any package with new exports
   - Look for duplicate export names across the barrel
   - Verify aliased exports don't shadow each other

5. **Check for TODO/FIXME/HACK:**
   ```bash
   grep -rn "TODO\|FIXME\|HACK\|XXX" packages/*/src/ --include="*.ts" --include="*.tsx"
   ```

6. **Check package versions:**
   - Any package with significant new code should have a version bump
   - Compare package.json versions to what's in `docs/SYSTEM-STATE.md`

7. **Check for stale CLAUDE.md:**
   - If new modules were added to a package, does its CLAUDE.md mention them?
   - Flag any package where exports grew by >10 lines but CLAUDE.md wasn't updated

8. **Orphan work item audit:**
   ```sql
   SELECT id, title, item_type, status, source, created_at::date
   FROM work_items
   WHERE parent_id IS NULL
     AND item_type NOT IN ('epic', 'bug')
     AND status NOT IN ('done', 'archived')
   ORDER BY created_at DESC;
   ```
   For each orphaned task found:
   - If it clearly belongs to an open epic → attach it: `UPDATE work_items SET parent_id = '<epic-id>' WHERE id = '<task-id>'`
   - If unclear → report (interactive) or flag in REVIEW_STATUS (unattended)
   - Never silently leave orphaned tasks

9. **Verification gate — dispatch the verify agent:**
   After any fixes land, run the verify gate on every touched package. See `guides/agents/verify.md`.
   **Iron Law: no CLEAN verdict without fresh evidence.** Quote the vitest + tsc output in the report.
   If verify fails → do NOT emit CLEAN. Loop back, fix, re-run verify.

10. **Fix issues found:**
   - Failing tests → fix and commit
   - Export conflicts → resolve and commit
   - Missing version bumps → bump and commit
   - All fixes as separate commits with descriptive messages

   **Judgment calls:**
   - Interactive: report — don't guess
   - Unattended: escalate via advisor tool with: error message, surrounding context,
     two most likely fix paths. Resume with advisor's recommendation.
     If advisor unavailable: take the most conservative path, flag in status block.

11. **Report:**
    - Interactive:
      ```
      ## Review Results
      | Package | Tests | Pass/Fail | New Tests | Issues |
      ## Fixed
      ## Remaining Issues
      ## Verdict: CLEAN / HAS ISSUES
      ```
    - Unattended: emit status block only:
      ```
      REVIEW_STATUS: { verdict: "CLEAN|HAS_ISSUES", packages_checked, tests_passed, tests_failed, new_tests_added, fixes_applied, escalations }
      ```

## Rules
- Do NOT run `pnpm build` (crashes system) — vitest only
- Interactive: fix what you can, flag what needs decision
- Unattended: fix everything fixable; escalate judgment calls to advisor
- Each fix is a separate commit (not batched)
- Always push fixes to origin after committing
- Unattended: NEVER pause for input
