---
name: rdc:self-test
description: >-
  Usage `rdc:self-test [--strict] [--skill <name>] [--json] [--fix]` — validates every rdc-*.md skill: frontmatter, Usage marker, name↔filename match, referenced guides/rules/hooks exist, output contract banner, plugin manifest, duplicate-name + collision checks. Tier 1 static lint. Run before every release.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw runner dumps — summarize.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.


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
| Tier 2 | Behavioral — headless Claude runs each skill in sandbox, asserts artifacts | 📋 planned, see `.rdc/plans/skill-self-test-tier-2.md` |
| Tier 3 | Golden checklists — snapshot output format, regress on drift | 🔒 future |

## Procedure (Tier 1)

1. **Run the linter:**
   ```bash
   node C:/Dev/rdc-skills/scripts/self-test.mjs
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

## Rules
- Run Tier 1 **before every `rdc:release rdc-skills`** — it catches the backtick-drift class of bugs that break the skill menu silently.
- Use `--strict` in CI. Warnings matter in the release path.
- Do NOT skip findings by relaxing the linter. Fix the skill.
- Tier 2 is in planning — see epic `462b3e0a-37dd-4c9d-bed7-a1ad260b8bc1`.
