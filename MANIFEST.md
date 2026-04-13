# RDC Skills Library — Manifest

**Created:** 2026-04-13  
**Source:** Regen Root project `.claude/skills/user/`  
**Files:** 20 skill files (2,167 lines total)  
**Size:** 420K  

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
├── README.md (this quick reference)
├── MANIFEST.md (this file)
└── skills/
    ├── rdc-build.md (161 lines) [+TDD enforcement]
    ├── rdc-plan.md (93 lines)
    ├── rdc-preplan.md (83 lines)
    ├── rdc-review.md (112 lines) [+test coverage delta]
    ├── rdc-overnight.md (195 lines)
    ├── rdc-fixit.md (105 lines)
    ├── rdc-status.md (82 lines)
    ├── rdc-report.md (97 lines)
    ├── rdc-handoff.md (171 lines)
    ├── rdc-prototype.md (144 lines)
    ├── rdc-workitems.md (129 lines)
    ├── rdc-help.md (91 lines)
    ├── rdc-frontend.md (92 lines)
    ├── rdc-backend.md (104 lines)
    ├── rdc-cs2.md (58 lines)
    ├── rdc-data.md (88 lines)
    ├── rdc-design.md (78 lines)
    ├── rdc-infra.md (80 lines)
    ├── rdc-content.md (95 lines)
    └── rdc-viz.md (109 lines)
```

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

### Agent Types (8)
- rdc:frontend — React, UI, Tailwind
- rdc:backend — API, database, auth
- rdc:data — migrations, schema
- rdc:design — brand, tokens
- rdc:infra — deployment, CI/CD
- rdc:content — copy, messaging
- rdc:cs2 — paradigm-level work
- rdc:viz — visualizations

### Bridge (3)
- rdc:handoff — planning → work items
- rdc:prototype — JSX prototypes
- rdc:workitems — work item CRUD

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
