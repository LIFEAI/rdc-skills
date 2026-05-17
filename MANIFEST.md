# RDC Skills Library — Manifest

**Created:** 2026-04-13  
**Last updated:** 2026-05-01  
**Source:** Regen Root project `.claude/skills/user/`  
**Files:** 18+ skill files, 10 agent guides, command mirrors, and support scripts  
**Size:** ~480K  

## Generic Conversion Summary

All skills have been converted from project-specific to generic/portable:

### Path Replacements
- `C:/Dev/regen-root/` → `{PROJECT_ROOT}/`
- Hardcoded app names (rdc-marketing-engine, brand-studio, prt, etc.) → generic examples
- Specific Supabase project IDs → generic table references
- Developer-specific paths → variables

### TDD Enhancements
- Added mandatory post-wave test gate to rdc:build
- Updated rdc:review with test coverage delta reporting
- Added test-first requirement to all agent skills
- TDD enforcement: red → implement → green cycle

### Preserved Elements
- All logic and procedures (100%)
- All safety rules
- All RPC patterns
- Branch strategy (development → production)
- Work item lifecycle
- Escalation protocols
- Unattended mode patterns
- Status block format

## Files Created

```
/c/Dev/rdc-skills/
├── README.md
├── MANIFEST.md (this file)
└── skills/
    ├── build/SKILL.md        [+TDD enforcement, +verify gate]
    ├── plan/SKILL.md
    ├── preplan/SKILL.md
    ├── review/SKILL.md       [+test coverage delta, +verify gate]
    ├── overnight/SKILL.md
    ├── fixit/SKILL.md
    ├── status/SKILL.md
    ├── report/SKILL.md
    ├── co-develop/SKILL.md   [peer-aware Claude/Codex co-development]
    ├── collab/SKILL.md       [claude.ai ↔ Claude Code relay]
    ├── handoff/SKILL.md
    ├── prototype/SKILL.md
    ├── workitems/SKILL.md
    ├── design/SKILL.md       [RDC/Studio design, Palette Library, Rampa CLI]
    ├── help/SKILL.md
    ├── deploy/SKILL.md       [Coolify deployment ops]
    ├── release/SKILL.md      [atomic version release]
    ├── self-test/SKILL.md    [static lint + tier2 smoke tests]
    └── watch/SKILL.md        [session log + browser viewer]
└── guides/agents/     (agent-only playbooks — dispatched by rdc:build, not user-invocable)
    ├── frontend.md
    ├── backend.md
    ├── cs2.md
    ├── data.md
    ├── design.md
    ├── infrastructure.md
    ├── content.md
    ├── viz.md
    ├── setup.md
    └── verify.md
```

**Note (v0.7.9):** Skills migrated from flat `rdc-<name>.md` files to `<name>/SKILL.md` subdirectories. Plugin namespace is `rdc`, so composed skill names are `rdc:<name>` — matching the frontmatter. This eliminates the duplicate `rdc:rdc-*` registration that occurred when directories were named `rdc-<name>/`.

## Skill Categories

### Orchestration (8)
- rdc:build — dispatch typed agents in waves
- rdc:plan — architecture + epic/tasks
- rdc:preplan — research before planning
- rdc:review — quality gate
- rdc:overnight — unattended build supervisor
- rdc:fixit — quick-fix bypass
- rdc:status — project dashboard
- rdc:report — nightly report

### DevOps (3)
- rdc:deploy — Coolify deployment ops (deploy, new, diagnose, audit)
- rdc:release — atomic version release with git tag + changelog
- rdc:watch — session log + browser viewer for Claude activity

### Quality (1)
- rdc:self-test — static lint (tier1) + smoke tests (tier2)

### Collaboration (1)
- rdc:co-develop — peer-aware Claude/Codex co-development over clauth

### Agent Guides (10, in `guides/agents/`) — [agent-only — dispatched by rdc:build, not user-invocable]
- frontend — React, UI, Tailwind
- backend — API, database, auth
- data — migrations, schema
- design — brand, tokens
- infrastructure — deployment, CI/CD
- content — copy, messaging
- cs2 — paradigm-level work
- viz — visualizations
- setup — project scan + .rdc/config.json generation
- verify — evidence-before-claims verification gate

### Utility (1)
- rdc:collab — bidirectional claude.ai ↔ Claude Code relay via file transport

### Bridge (3)
- rdc:handoff — planning → work items
- rdc:prototype — JSX prototypes
- rdc:workitems — work item CRUD

### Design (1)
- rdc:design — Studio-aware design workflow with token, Palette Library, and Rampa CLI context

### Reference (1)
- rdc:help — skill index

## Usage Instructions

1. **Clone or reference** the `/c/Dev/rdc-skills/` directory
2. **Update path variables** in all skills for your project
3. **Create project guides** (agent-bootstrap.md, frontend.md, etc.)
4. **Set up database** (work_items RPC, prototype_registry, design_context)
5. **Invoke skills** via your agent framework
   - Interactive: `/rdc:build <epic-id>`
   - Unattended: `/rdc:overnight`
   - Quality: `/rdc:review --unattended`

## Key Differences from Source

### Added: TDD Enforcement

**rdc:build (Step 8):**
```bash
# Post-wave test gate (mandatory)
cd packages/<name> && npx vitest run 2>&1 | tail -20
```
All tests must pass before next wave.

**All agent skills:**
```
TDD REQUIREMENT: Write tests FIRST for new functions/modules.
Run: npx vitest run packages/<name>
```

**rdc:review (Step 3):**
```bash
# Check test coverage delta
git diff origin/main...HEAD -- packages/*/src/ | grep -c "^+"
git diff origin/main...HEAD -- packages/*/test* | grep -c "^+"
```
Flags any package with implementation added but 0 new tests.

**rdc:review report format:**
```
| Package | Tests | Pass/Fail | New Tests Added | Issues |
```

### Preserved: All Logic

- Work item RPC patterns (never raw SQL)
- Agent type classification
- Wave-based parallelization
- Escalation protocols
- Unattended mode patterns
- Status block formatting
- Safety rules (100%)
- Branch strategy

## Deployment

These skills are ready to use in any project that has:

1. A monorepo with `packages/`, `apps/`, or `sites/` structure
2. A database (Supabase, PostgreSQL, etc.) with work_items RPC functions
3. Capability to run agents (Claude Code, subagents, or CLI)
4. Git-based version control with at least 2 branches (dev + prod)
5. A credential management system (clauth daemon or equivalent)

## Questions?

- **Specific project integration:** Refer to your project's infrastructure documentation
- **Skill logic:** All skills are pure logic extracted from Regen Root; no project-specific magic
- **TDD requirements:** Built into every skill; red → implement → green is mandatory
- **Database schema:** You define; skills use generic `work_items` table and RPC patterns

---

**Manifest created:** 2026-04-13  
**Source project:** Regen Root (github.com/LIFEAI/regen-root)  
**Genericization:** Complete — all hardcoded references removed, all logic preserved
