# RDC Skills Library — Generic Version

This directory contains a generic, project-agnostic version of the RDC (Research, Design, Code) skill suite. All skills have been extracted from a reference implementation and genericized for use in any monorepo project.

## Install

### Option A — Plugin marketplace (recommended for new installs)

From any Claude Code session:

```
/plugin marketplace add LIFEAI/rdc-skills
/plugin install rdc-skills
```

All user-invocable skills become available as slash commands. Agent playbooks in `guides/agents/` are dispatched internally by `rdc:build` and are not user-invocable.

### Option B — Directory plugin (LIFEAI dev machines)

If you have the source repo locally, point the plugin directly at the directory in `~/.claude/settings.json`. Skills load live from disk — no install step needed, changes take effect on next session start:

```json
"extraKnownMarketplaces": {
  "rdc-skills": {
    "source": { "source": "directory", "path": "C:\\Dev\\rdc-skills" }
  }
},
"enabledPlugins": {
  "rdc-skills@rdc-skills": true
}
```

### ⚠️ DO NOT mix install methods — duplicates will occur

If `rdc-skills@rdc-skills` is enabled in your plugin settings AND you have manually installed files at `~/.claude/skills/user/rdc-*.md`, every skill loads twice (or more if stale plugin cache versions exist). Symptoms: each skill appears 2–3× in the skill list.

**Fix:**
```bash
# Remove manual install
rm ~/.claude/skills/user/rdc-*.md

# Remove stale plugin cache (keep only the current version)
rm -rf ~/.claude/plugins/cache/rdc-skills/rdc-skills/0.7.*
```

Use **one method only**: plugin (Option A or B) OR manual install — never both.

### Legacy install scripts (deprecated since v0.6.0)

`scripts/install.sh` and `scripts/install.ps1` copy files into `~/.claude/skills/user/`. These exist only for environments that cannot use the plugin system. Running them alongside the plugin creates duplicates. Do not use them if you have the plugin installed.

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

### Design Skills
- rdc:design — RDC/Studio design, tokens, palettes, themes, and Rampa CLI-assisted color systems

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
  build/SKILL.md       (dispatch agents in waves — mandatory validator gate)
  plan/SKILL.md        (create architecture + tasks)
  preplan/SKILL.md     (research before planning)
  review/SKILL.md      (quality gate: tests, types, docs)
  overnight/SKILL.md   (unattended multi-epic supervisor)
  fixit/SKILL.md       (quick-fix bypass)
  status/SKILL.md      (project dashboard)
  report/SKILL.md      (nightly report)
  collab/SKILL.md      (bidirectional claude.ai ↔ Claude Code relay)
  handoff/SKILL.md     (planning → work items)
  prototype/SKILL.md   (build JSX prototype)
  workitems/SKILL.md   (work item management)
  design/SKILL.md      (RDC/Studio design, Palette Library, Rampa CLI)
  help/SKILL.md        (skill index — shows current version)
  deploy/SKILL.md      (Coolify ops: deploy, new, diagnose, audit)
  release/SKILL.md     (atomic package/app release)
  self-test/SKILL.md   (skill suite health check)
  watch/SKILL.md       (session log watcher)

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
  verify.md            (evidence-before-claims verification gate — tsc + vitest + HTTP)

scripts/
  install.sh           (legacy only — do not use with plugin install)
  install.ps1          (legacy only — do not use with plugin install)
```

## Check installed version

```bash
# See version in rdc:help skill
head -4 ~/.claude/skills/user/rdc-help.md   # if using manual install

# Or check source directly
python3 -c "import json; print(json.load(open('package.json'))['version'])"

# Or invoke the skill
/rdc:help
```

Current version: **v0.9.24**

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
