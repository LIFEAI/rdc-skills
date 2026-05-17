---
name: rdc:self-test
description: "Usage `rdc:self-test [--strict]` — Validate all rdc:* skills, plugin manifest, and tooling consistency. Use after editing skills, upgrading the plugin, or when a skill behaves unexpectedly."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw runner dumps — summarize.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Tier 2 behavioral runs and any git push are skipped under `RDC_TEST=1`; Tier 1 static lint runs normally.


# rdc:self-test — Skill Library Self-Test (Tier 1)

## When to Use
- Before every `rdc:release rdc-skills` tag push
- After editing any skill description or frontmatter
- When a skill mysteriously disappears from the menu (backtick bug repro)
- In CI on every rdc-skills PR (once wired)

## Tiers

| Tier | What it checks | Status |
|------|----------------|--------|
| Tier 1 | Static lint — frontmatter, Usage line, referenced files, name match | ✅ live |
| Tier 2 | Behavioral — headless Claude runs each skill in sandbox, asserts artifacts | ✅ live — 13 manifests, blocked by check-cwd.js hook (see Rules) |
| Tier 3 | Golden checklists — snapshot output format, regress on drift | 🔒 future |

## Interactive UI

Launch the interactive menu — pick tier, pick skill, see live output:

```bash
node C:/Dev/rdc-skills/scripts/self-test-ui.mjs
```

Menu options:
- **1** — Full Tier 1 test (all skills)
- **2** — Pick a specific skill from a numbered list
- **3** — Choose tier (Tier 1 static lint | Tier 2 behavioral | Tier 3 🔒 future)

Test output streams live to the terminal. No server, no extra processes.

## Procedure (Tier 1)

1. **Run the linter (direct or via UI):**
   ```bash
   node C:/Dev/rdc-skills/scripts/self-test.mjs
   # or interactively:
   node C:/Dev/rdc-skills/scripts/self-test-ui.mjs
   ```

2. **Interpret exit codes:**
   - `0` = all skills pass
   - `1` = at least one FAIL or (in `--strict` mode) at least one WARN
   - `2` = runner itself crashed (e.g., skills dir unreadable)
   - `3` = `.claude-plugin/plugin.json` missing entirely (distinct from skill failures)

3. **Common findings and fixes:**

   | Finding code | Cause | Fix |
   |---|---|---|
   | `description-backtick-leading` | Folded YAML starts with `` ` `` — parser drops skill | Rewrite description to start with a word |
   | `usage-marker-missing` | No `` Usage `rdc:name <args>` `` in description | Front-load arg contract |
   | `usage-marker-mismatch` | `Usage` line references a different skill's name (copy-paste drift) | Fix the skill name in the Usage marker |
   | `name-filename-mismatch` | frontmatter `name:` ≠ filename | `--fix` auto-renames; or rewrite name |
   | `guide-not-found` / `rule-not-found` / `hook-not-found` | Dead reference in skill body | Create file or fix link |
   | `banner-missing` | Skill missing OUTPUT CONTRACT banner | `--fix` auto-inserts |
   | `manifest-missing` / `manifest-version-mismatch` | `.claude-plugin/plugin.json` missing or out-of-sync with `package.json` | Create/update manifest |
   | `duplicate-skill-name` / `skill-guide-filename-collision` | Two skills claim same name, or skill collides with agent guide | Rename one |
   | `orphan-hook` | File under `hooks/` isn't referenced by any skill, settings.json, or plugin.json | Wire it up or delete |

4. **Flags:**
   - `--strict` — promotes warnings to failures (use in CI and before release)
   - `--skill <name>` — run against a single skill (e.g. `--skill rdc:build`)
   - `--json` — machine-readable schema v2 (per-skill `findings[]` with `code` + `level`, plugin_manifest block, global_findings, summary.exit_code). Consumed by Tier 2 runner as pre-gate.
   - `--fix` — auto-repair fixable findings: insert missing OUTPUT CONTRACT banner, rename files to match frontmatter name. Prints `FIXED:` lines + touched file list so you can git diff + commit. Backtick-leading descriptions are NOT auto-fixed (need human rewrite).

5. **Report to the project lead:**
   ```
   Self-test: X/Y pass, Z warnings, W failures
   Failures: <list>
   Verdict: PASS | FAIL
   ```

## Procedure (Tier 2)

Tier 2 runs each skill end-to-end in an isolated sandbox and asserts on observed state (files touched, commits made, work items, exit code). Use it before shipping behavioral changes — Tier 1 alone can't catch runtime drift.

1. **Prerequisites:**
   - `claude` CLI on PATH (headless mode: `claude --print`)
   - clauth daemon unlocked (`curl -s http://127.0.0.1:52437/ping`)
   - Supabase MCP reachable (runner creates a throwaway test branch)
   - Clean git tree in `rdc-skills` (worktrees are added under `.rdc/sandbox/<run-id>/`)

2. **Run:**
   ```bash
   node scripts/self-test.mjs --tier2                    # all skills with manifests
   node scripts/self-test.mjs --tier2 --skill rdc:build  # single skill
   node scripts/self-test.mjs --tier2 --parallel 3       # up to 3 skills in parallel
   node scripts/self-test.mjs --tier2 --quick            # skip long-running assertions
   ```

3. **What it does:**
   - Runs Tier 1 as a pre-gate (fails fast if static lint fails)
   - Creates one Supabase test branch for the run
   - For each skill: `git worktree add` into `.rdc/sandbox/<run-id>/<skill>/`, sets `RDC_TEST=1`, invokes `claude --print` with the skill prompt, waits for exit
   - Asserts per the skill's manifest: exit code, files touched, commits made, stdout patterns
   - Cleans up worktrees + deletes the Supabase branch at the end (even on failure)

4. **Reports:**
   - `.rdc/reports/self-test-tier2-<iso>.json` — full per-skill result, findings, timings
   - Exit codes: `0` pass, `1` fail (one or more skills failed assertions), `2` runner error (couldn't set up sandbox / branch)

5. **Adding a new manifest:**
   - Create `skills/tests/<skill>.test.json` (one per skill, colocated)
   - Validate the shape against the schema at `scripts/lib/manifest-schema.mjs`
   - Test it in isolation: `node scripts/self-test.mjs --tier2 --skill rdc:name`
   - Commit the manifest alongside any skill body changes

## Rules
- Run Tier 1 **before every `rdc:release rdc-skills`** — it catches the backtick-drift class of bugs that break the skill menu silently.
- Use `--strict` in CI. Warnings matter in the release path.
- Do NOT skip findings by relaxing the linter. Fix the skill.
- Run Tier 2 before tagging a release. Gate the tag if any manifested skill fails.
- Tier 2 blocker: `check-cwd.js` SessionStart hook blocks headless sessions not launched from the monorepo root — runner uses `--dangerously-skip-permissions` to bypass. If tier2 tests fail with `exit_code: -1`, verify the flag is present in `scripts/lib/runner.mjs`.
