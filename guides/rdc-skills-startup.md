# RDC Skills Startup Contract
> Managed by `rdc-skills`. Keep local project-specific details in adjacent project guides.

## What RDC Skills Adds

- Slash commands for the RDC workflow: plan, build, review, report, design, deploy, release, status, and work item operations.
- Output-contract enforcement for active `/rdc:*` turns: visible checklist rows plus a final verdict line.
- Engineering behavior guidance: small scoped changes, explicit assumptions, evidence for completed work, and honest blockers.
- Optional project integrations for work items, credentials, deployments, and release automation.

## Agent Startup Rules

1. Read the active project instructions first (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex).
2. For any `/rdc:*` invocation, follow `.rdc/guides/output-contract.md` and `.rdc/guides/engineering-behavior.md`.
3. Do not treat skill prose as proof. Completed work needs evidence: command output, test result, route probe, screenshot, SQL result, or source citation.
4. If a project has its own approval gates, architecture rules, or credential model, those project rules override generic RDC defaults.
5. When an RDC skill cannot access the required project services, stop with a specific blocker instead of inventing a fallback.

## Profiles

- `core`: portable defaults for a clean machine. No regen-root cwd lock, clauth requirement, Supabase exit gate, or LIFEAI deployment assumption.
- `lifeai`: LIFEAI/regen-root defaults. Enables project-specific hooks and workflows for clauth, Supabase work items, deployment, and overnight queue behavior.

## Where To Look

- Skills: `skills/<name>/SKILL.md`
- Commands: `commands/<name>.md`
- Guides: `guides/*.md` and project copies under `.rdc/guides/`
- Hooks: `hooks/*.js`
- Installer: `scripts/install-rdc-skills.js`
