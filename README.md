# RDC Skills Library — Generic Version

This directory contains a generic, project-agnostic version of the RDC (Research, Design, Code) skill suite. All skills have been extracted from a reference implementation and genericized for use in any monorepo project.

## Install

RDC Skills is distributed as a Claude Code plugin. From any Claude Code session:

```
/plugin marketplace add LIFEAI/rdc-skills
/plugin install rdc-skills
```

That's it — all 16 user-invocable skills (rdc:build, rdc:plan, rdc:preplan, rdc:review, rdc:overnight, rdc:fixit, rdc:status, rdc:report, rdc:collab, rdc:handoff, rdc:prototype, rdc:workitems, rdc:help, rdc:deploy, rdc:release, rdc:self-test) become available as slash commands. Agent playbooks in `guides/agents/` are dispatched internally by `rdc:build` and are not user-invocable.

### Legacy install (deprecated)

The pre-v0.6.0 install path used PowerShell/Bash scripts that copied files into `~/.claude/skills/user/`:

```
scripts/install.ps1   # Windows
scripts/install.sh    # macOS / Linux
```

These scripts are **deprecated as of v0.6.0** and will be removed in v0.7.0. Migrate to the plugin install path above. Existing installs continue to work until you run the uninstall script or upgrade.

## Path Variables

Throughout the skills, the following substitutions have been made to make them portable:

| Original | Generic | Your Project |
|----------|---------|--------------|
| `/full/path/to/monorepo/` | `{PROJECT_ROOT}/` | Your monorepo root |
| `docs/guides/agent-bootstrap.md` | `{PROJECT_ROOT}/docs/guides/agent-bootstrap.md` | Your agent guide |
| `develop` branch | `{development-branch}` | Your development branch |
| `main` branch | `{production-branch}` | Your production branch |
| Specific apps | `your-app-name` | Your app names |

## Skills Overview

23 skills organized into 5 categories:

### Orchestration Skills (workflow drivers)
- rdc:build, rdc:plan, rdc:preplan, rdc:review, rdc:overnight, rdc:fixit, rdc:status, rdc:report

### Agent Guides (dispatched by rdc:build, not user-invocable)
Located in `guides/agents/` — plain markdown playbooks spawned as sub-agents:
- frontend, backend, data, design, infrastructure, content, cs2, viz, setup, verify

### Bridge Skills (Planning → CLI)
- rdc:handoff, rdc:prototype, rdc:workitems

### Utility Skills
- rdc:collab

### Reference
- rdc:help

## Key Features

### TDD Enforcement (Built In)

- `rdc:build` includes mandatory post-wave test gate via vitest
- `rdc:review` reports test coverage delta
- All agents write tests FIRST: red → implement → green
- Packages with implementation but 0 new tests are flagged

### Core Rules (Non-Negotiable)

1. NEVER run `pnpm build` — crashes the system. Use `npx tsc --noEmit` + vitest only
2. NEVER let agents overlap on the same files
3. ALWAYS create work items BEFORE starting work
4. ALWAYS read guide files before agent dispatch
5. ALWAYS update work items in real time
6. Tests FIRST, then implementation — red → green
7. Push after every logical block

## How to Adapt for Your Project

1. Replace path variables in all skills:
   - `{PROJECT_ROOT}` → your monorepo root
   - `{development-branch}` → your dev branch
   - `{production-branch}` → your production branch

2. Create project guides in `{PROJECT_ROOT}/docs/guides/`:
   - agent-bootstrap.md, frontend.md, backend.md, data.md, design.md, infrastructure.md, content.md

3. Set up database (Supabase or equivalent):
   - work_items table
   - RPC functions: get_open_epics, insert_work_item, update_work_item_status, get_work_items_by_epic, bump_epic_version
   - prototype_registry table
   - design_context table

4. Update database references from `work_items` to your actual table names

5. Configure credential daemon or update `http://127.0.0.1:52437` references

## File Structure

```
skills/
  rdc-build.md         (dispatch agents in waves)
  rdc-plan.md          (create architecture + tasks)
  rdc-preplan.md       (research before planning)
  rdc-review.md        (quality gate: tests, types, docs)
  rdc-overnight.md     (unattended multi-epic supervisor)
  rdc-fixit.md         (quick-fix bypass)
  rdc-status.md        (project dashboard)
  rdc-report.md        (nightly report)
  rdc-collab.md        (bidirectional claude.ai ↔ Claude Code relay)
  rdc-handoff.md       (planning → work items)
  rdc-prototype.md     (build JSX prototype)
  rdc-workitems.md     (work item management)
  rdc-help.md          (skill index)

guides/agents/         (agent-only playbooks — dispatched by rdc:build, not user-invocable)
  frontend.md          (React, UI, Tailwind)
  backend.md           (API routes, database, auth)
  data.md              (migrations, schema, RPC)
  design.md            (brand, tokens, design)
  infrastructure.md    (deployment, CI/CD, DNS)
  content.md           (copy, messaging, tone)
  cs2.md               (paradigm-level work)
  viz.md               (visualizations, charts, SVG)
  setup.md             (project scan + .rdc/config.json generation)
  verify.md            (evidence-before-claims verification gate)
```

## Quick Start

1. Copy this directory to your project
2. Update `{PROJECT_ROOT}` paths in all skills
3. Create the required project guides and database tables
4. Invoke skills via your agent framework:
   - `/rdc:build <epic-id>` — dispatch agents
   - `/rdc:overnight` — unattended multi-epic build
   - `/rdc:review` — quality gate
   - etc.

All skills follow the same patterns: check before acting, update work items in real time, push often, test first.
