# RDC Skills Library — Generic Version

This directory contains a generic, project-agnostic version of the RDC (Research, Design, Code) skill suite. All skills have been extracted from a reference implementation and genericized for use in any monorepo project.

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

20 skills organized into 4 categories:

### Orchestration Skills (workflow drivers)
- rdc:build, rdc:plan, rdc:preplan, rdc:review, rdc:overnight, rdc:fixit, rdc:status, rdc:report

### Agent Type Skills (dispatched by rdc:build)
- rdc:frontend, rdc:backend, rdc:data, rdc:design, rdc:infra, rdc:content, rdc:cs2, rdc:viz

### Bridge Skills (Planning → CLI)
- rdc:handoff, rdc:prototype, rdc:workitems

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
  rdc-handoff.md       (planning → work items)
  rdc-prototype.md     (build JSX prototype)
  rdc-workitems.md     (work item management)
  rdc-help.md          (skill index)
  rdc-frontend.md      (React, UI, Tailwind)
  rdc-backend.md       (API routes, database, auth)
  rdc-data.md          (migrations, schema, RPC)
  rdc-design.md        (brand, tokens, design)
  rdc-infra.md         (deployment, CI/CD, DNS)
  rdc-content.md       (copy, messaging, tone)
  rdc-cs2.md           (paradigm-level work)
  rdc-viz.md           (visualizations, charts, SVG)
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
