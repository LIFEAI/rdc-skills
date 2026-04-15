---
name: rdc:self-test
description: >-
  Usage `rdc:self-test [--strict] [--skill <name>] [--json]` — validates every rdc-*.md skill: frontmatter, Usage marker, name↔filename match, referenced guides/rules exist, output contract banner. Tier 1 static lint. Run before every release.
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

3. **Common findings and fixes:**

   | Finding | Cause | Fix |
   |---------|-------|-----|
   | `description starts with backtick` | Folded scalar YAML starts with `` ` `` — Claude Code parser drops it | Rewrite description to start with a word. See `rdc-deploy.md`, `rdc-release.md` for examples. |
   | `description missing Usage marker` | Skill lacks `` Usage `rdc:name <args>` `` in description | Front-load the arg contract in the description. |
   | `name mismatch` | frontmatter `name:` doesn't match filename | Rename one to match the other. |
   | `referenced guide not found` | Skill body links to a guide that doesn't exist in `guides/` | Create the guide or fix the link. |
   | `referenced rule not found in regen-root` | Skill links to a rule file that isn't present | Verify the rule name; usually a typo. |
   | `body missing OUTPUT CONTRACT banner` | Skill skipped the standard banner | Add the banner from `guides/output-contract.md`. |

4. **Flags:**
   - `--strict` — promotes warnings to failures (use in CI and before release)
   - `--skill <name>` — run against a single skill (e.g. `--skill rdc:build`)
   - `--json` — machine-readable output, for piping into CI reporting

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
