# rdc-skills — Claude Code Skill Suite

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/LIFEAI/rdc-skills/releases/tag/v0.1.0)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-rdc--skills-333)](https://github.com/LIFEAI/rdc-skills)

**Typed-agent dispatch system for Claude Code.** Plan → Build → Review → Overnight. Works with any Supabase project using `work_items` RPC.

---

## What is rdc-skills?

rdc-skills is a **plugin system for Claude Code** that automates software development workflows through:

1. **Work Item Planning** — Create structured epics and tasks in Supabase `work_items` table
2. **Parallel Agent Dispatch** — Spawn typed agents (frontend, backend, data, design, infra, content, cs2) on disjoint codebases
3. **Quality Gates** — Automated tests, type checks, stale doc detection, export validation
4. **Unattended Execution** — Chain entire workflows (plan → build → review → report) overnight

Built for **monorepos with shared packages** — agents can execute in parallel without conflicts because they target different directories and packages.

---

## Architecture: Two-Layer Guide System

rdc-skills uses a **two-layer guide stack** where project conventions override generic patterns:

```
┌─────────────────────────────────────────────────────┐
│  Plugin Base Guides (rdc-skills repo)               │
│                                                      │
│  • work-items-rpc.md (RPC function reference)      │
│  • standard git workflow                           │
│  • generic build patterns                          │
└─────────────────┬───────────────────────────────────┘
                  │ (imported by agents)
┌─────────────────▼───────────────────────────────────┐
│  Project Overlay Guides (your codebase)            │
│                                                      │
│  docs/guides/agent-bootstrap.md                    │
│  docs/guides/frontend.md                           │
│  docs/guides/backend.md                            │
│  docs/guides/data.md                               │
│  ... (one per domain you use)                      │
└─────────────────────────────────────────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │  Agent Context │
         │  (merged view) │
         │ Project > Base │
         └────────────────┘
```

**What this means:**
- **Base guides** are generic (work with any Supabase project, any tech stack)
- **Project overlays** inject your specific imports, conventions, and constraints
- **Agents read both** — project layer overrides base layer on conflict
- **Easy to reuse** — Point rdc-skills at any Supabase project, add 1-2 project overlay files, ready to go

---

## Installation

### Prerequisites

- **Node.js 18+** (for running validation scripts)
- **Claude Code CLI** (latest version)
- **Git** (for cloning and version control)
- **Supabase project** with `work_items` RPC functions configured

### Windows

```bash
git clone https://github.com/LIFEAI/rdc-skills.git
cd rdc-skills
npm run install:win
```

### macOS / Linux

```bash
git clone https://github.com/LIFEAI/rdc-skills.git
cd rdc-skills
npm run install:unix
```

### What Gets Installed

- ✓ Skill files → `~/.claude/skills/user/`
- ✓ Stop hook → `~/.claude/hooks/`
- ✓ Rules (work-items-rpc.md) → `~/.claude/rules/` (manual copy required)

Run `npm run validate` to verify all skills and guides are well-formed.

---

## Quick Start

### 1. Verify Installation

```bash
# In Claude Code
/rdc:status
```

This should list open epics from your Supabase project. If empty, create one first:

```sql
SELECT insert_work_item(p_title := 'My first epic', p_item_type := 'epic', p_priority := 'high');
```

### 2. Plan a Feature

```bash
/rdc:plan Build user authentication
```

This skill will:
- Research best practices
- Ask clarifying questions
- Create an epic in Supabase with child tasks
- Generate docs/plans/{slug}.md with architecture

### 3. Execute the Plan

```bash
/rdc:build <epic-id>
```

Dispatches parallel agents (frontend, backend, data as needed). Each agent:
- Reads project guides (your tech stack, imports, conventions)
- Executes on its assigned wave (tasks grouped by type)
- Runs tests after each wave (Option B: test-first enforcement)
- Commits and pushes to `develop`

### 4. Quality Gate

```bash
/rdc:review
```

Automated checks:
- Run test suite (via npx vitest / npm test)
- Type check (npx tsc --noEmit)
- Scan for stale docs (references to deleted functions)
- Validate exports (re-exports match implementations)

### 5. Generate Report

```bash
/rdc:report
```

Creates `docs/reports/YYYY-MM-DD.md` with:
- Work items completed
- Commits pushed
- Tests passed
- Types checked
- Any failures/escalations

---

## Skill Reference

Twelve skills built into rdc-skills:

| Skill | Command | Use When |
|-------|---------|----------|
| Status | `/rdc:status` | See open epics, blockers, next action |
| Preplan | `/rdc:preplan <topic>` | Research before committing to design |
| Plan | `/rdc:plan <topic>` | Design + create epic + break into tasks |
| Build | `/rdc:build <epic-id>` | Execute tasks in parallel with agents |
| Review | `/rdc:review` | Quality gate — tests, types, docs |
| Overnight | `/rdc:overnight [<epic-id>]` | Unattended pipeline (all skills in sequence) |
| Fixit | `/rdc:fixit <description>` | Quick fix — <5 files, <30 min, skip plan |
| Report | `/rdc:report` | Generate markdown report → docs/reports/ |
| — | — | — |
| Agent: Frontend | (auto-dispatched) | React components, pages, UI, animations |
| Agent: Backend | (auto-dispatched) | API routes, database queries, auth |
| Agent: Data | (auto-dispatched) | Migrations, schema, RPC functions |
| Agent: Design | (auto-dispatched) | Brand tokens, typography, OG images |

---

## Guide Types

Every project uses a **plugin base guide** (rdc-skills) plus **project overlay guides** (your codebase):

| Guide | For | Location |
|-------|-----|----------|
| `agent-bootstrap.md` | **ALL agents** — credentials, git rules, Supabase project ref, completion format | `docs/guides/agent-bootstrap.md` |
| `frontend.md` | React, UI, components, styling, Tailwind | `docs/guides/frontend.md` |
| `backend.md` | API routes, server components, database queries, auth | `docs/guides/backend.md` |
| `data.md` | Migrations, schema design, RPC functions, types | `docs/guides/data.md` |
| `design.md` | Brand tokens, typography, OG images, design system | `docs/guides/design.md` |
| `infrastructure.md` | Coolify, deployment, CI/CD, DNS, SSL | `docs/guides/infrastructure.md` |
| `content.md` | Marketing copy, email templates, messaging | `docs/guides/content.md` |
| `cs2.md` | CS 2.0 packages (HAIL, PAL, virtue, quad-pixel, ontology) | `docs/guides/cs2.md` |

---

## Project Setup (Required)

Every project using rdc-skills needs **two files**:

### 1. `docs/guides/agent-bootstrap.md`

Loaded by **every agent** first. Template:

```markdown
# Agent Bootstrap

> Loaded by all agents. Credentials, git rules, Supabase config, completion format.

## Credentials

All via clauth daemon only:
```bash
curl -s http://127.0.0.1:52437/get/github-token
curl -s http://127.0.0.1:52437/get/cloudflare
```

## Supabase Project

- **Ref:** `uvojezuorjgqzmhhgluu`
- **URL:** https://uvojezuorjgqzmhhgluu.supabase.co
- **Anon Key:** [from .env.local]
- **Service Role Key:** [from .env.local]

## Git Rules

- Branch: `develop` (all work)
- Auto-commit after logical blocks
- Push before requesting review
- Never force-push main

## Work Items

Create before starting: `SELECT insert_work_item(...)`
Update as you go: `SELECT update_work_item_status(...)`
Close when done: mark status='done'

## Completion Format

```json
{
  "title": "Feature X completed",
  "work_items_closed": 5,
  "commits_pushed": 3,
  "files_changed": 12,
  "tests_passed": true,
  "key_changes": ["Change 1", "Change 2"]
}
```

## Stack

- **Monorepo:** pnpm + Turborepo
- **Framework:** Next.js 14
- **UI:** @regen/ui (4-tier architecture)
- **Database:** Supabase (project ref above)
- **Styling:** Tailwind CSS
```

### 2. `docs/guides/frontend.md` (and others as needed)

Domain-specific guide. Example:

```markdown
# frontend — Project Overrides

> Loaded by frontend agents. Overrides generic patterns for your stack.

## Component Library

All components from `@regen/ui`. Never import from shadcn/ui, framer-motion, or Aceternity UI directly.

```ts
// ✓ Correct
import { Button, Card } from "@regen/ui";

// ✗ Wrong
import { Button } from "shadcn/ui";
```

## Design Tokens

Use CSS variables. Never hardcode colors:

```tsx
<div className="bg-primary text-white">...</div>
<div style={{ color: 'var(--primary)' }}>...</div>
```

## Database

```ts
import { createBrowserClient } from "@regen/supabase";
const supabase = createBrowserClient();
const { data } = await supabase.from("table").select("*");
```

## Styling

- Tailwind only (no CSS-in-JS)
- responsive: use `md:`, `lg:` prefixes
- Custom: define in `globals.css`, reference via var()

## Testing

- vitest for unit/component tests
- React Testing Library for component queries
- 80%+ coverage target
```

---

## Option B: TDD Enforcement

By default, rdc:build executes tests **after** writing code. Option B enforces **tests-first** via wave-based execution:

### Wave 1: Write Tests
```bash
npx vitest run packages/my-package
```
Agent writes failing tests for each task.

### Wave 2: Implement Features
Agent implements code to pass tests.

### Wave 3: Run Full Suite
```bash
npx vitest run
```
All tests across all packages must pass before proceeding.

### Why?
- **Clarity** — Tests define acceptance criteria upfront
- **Confidence** — Code changes don't break unrelated systems
- **Parallelism** — Multiple agents can write tests simultaneously without conflicts

To enable Option B, add to project guide:

```markdown
## Build Enforcement

TDD (test-first) is REQUIRED. Each /rdc:build wave must:
1. Write failing tests (npx vitest run <package>)
2. Implement code to pass
3. Run full suite (npx vitest run) before next wave
```

---

## Updating

### Windows
```bash
npm run update:win
```

### macOS / Linux
```bash
npm run update:unix
```

Reports old and new versions. Reinstalls to CLAUDE_HOME.

---

## Uninstalling

### Windows
```bash
npm run uninstall:win
```

### macOS / Linux
```bash
npm run uninstall:unix
```

Removes skills and hooks only. Project guides in `docs/guides/` are left untouched.

---

## Contributing

### Development Setup

```bash
git clone https://github.com/LIFEAI/rdc-skills.git
cd rdc-skills
npm install
npm run validate
```

### Adding a New Skill

1. Create `skills/rdc-newskill.md` with YAML frontmatter:
   ```yaml
   ---
   name: newskill
   description: One sentence describing the skill
   ---
   ```

2. Add required sections:
   ```markdown
   ## When to Use
   Short paragraph explaining when to invoke this skill.

   ## Procedure
   Step-by-step instructions (or ## Arguments if it's a data transformation).
   ```

3. Run validation:
   ```bash
   npm run validate
   ```

4. Test in Claude Code:
   ```
   /rdc:newskill my test
   ```

### Making Changes

1. Branch: `git checkout -b feature/description`
2. Edit files in `skills/`, `guides/`, `hooks/`, `rules/`
3. Validate: `npm run validate`
4. Commit: `git commit -m "feat(skills): description"`
5. Push & PR: `git push origin feature/description`

### Code Quality

- **Markdown:** Check for broken links, valid frontmatter
- **JavaScript:** Use ESLint (future: add to validate script)
- **YAML:** Validate frontmatter syntax

---

## Troubleshooting

### Agents Not Dispatching

1. Check Supabase is reachable: `SELECT get_open_epics()`
2. Verify work item exists with correct epic_id
3. Check project guides exist in `docs/guides/`

### Tests Failing

1. Run `npx vitest run` locally to debug
2. Agent logs are in `.claude/hook-logs/`
3. Re-run `/rdc:review` for detailed output

### Stop Hook Blocking Incorrectly

Check `.claude/hooks/no-stop-open-epics.js`:
- Verify PROJECT_SCOPE matches your folder name
- Check `get_open_epics()` returns data from Supabase
- Confirm epics have status='todo' (not 'in_progress')

### Credentials Not Found

1. Start clauth daemon: `scripts/restart-clauth.bat` (Windows) or clauth service (Unix)
2. Unlock at http://127.0.0.1:52437
3. Verify services in vault: `clauth_list`

---

## Roadmap

### Phase 1 (Current — v0.1)
- Core 12 skills ✓
- Two-layer guide system ✓
- Stop hook for open epics ✓
- Install/uninstall scripts ✓

### Phase 2 (Future)
- Skill generator (`rdc:newskill`)
- Guide templating system
- Agent role auto-detection
- Skill marketplace
- GitHub Actions CI integration
- Extended TDD framework support (Jest, pytest, Gotest)

---

## License

MIT — See [LICENSE](./LICENSE) for details.

---

## Support

- **Issues:** https://github.com/LIFEAI/rdc-skills/issues
- **Discussions:** https://github.com/LIFEAI/rdc-skills/discussions
- **Docs:** https://github.com/LIFEAI/rdc-skills/wiki

**Built by LIFEAI** — Regenerative design automation for a living world.
