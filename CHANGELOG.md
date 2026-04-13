# Changelog — @lifeai/rdc-skills

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-04-13

### Added

#### `.rdc/` Project Directory Convention
- **`.rdc/config.json` schema** — project metadata: name, hook_scope, git config, Supabase ref, credential provider, repo list, path overrides, constraints
- **Standardised paths**: `.rdc/guides/`, `.rdc/plans/`, `.rdc/reports/`, `.rdc/research/`, `.rdc/state/`
- All 20 skills updated to read from `.rdc/` with fallback to legacy `docs/` structure for existing projects
- `guides/agent-bootstrap.md` updated to instruct agents to check `.rdc/config.json` for project metadata

#### Installer (`scripts/install.js`)
- **`--migrate <path>` flag** — interactive wizard: scans for `docs/guides/`, `docs/plans/`, `docs/reports/`, `docs/research/`; offers to move each to `.rdc/`; merges files if destination already exists; auto-detects GitHub org/repo from git remote
- **`--setup` generates `.rdc/config.json`** from interview answers in addition to `docs/guides/agent-bootstrap.md`
- **Preflight checks** — Node ≥ 18 (hard error), clauth daemon ping (warn), `.rdc/config.json` presence check (suggest `--setup`)
- **Multi-project support** — each project carries its own `.rdc/` committed to git; skills are global, intelligence travels with the repo

#### Multi-Repo Support
- `config.json` `repos[]` array — primary + satellite repos listed with roles
- One project, many repos: monorepo root holds `.rdc/config.json`, lists satellite repo paths

---

## [0.1.0] — 2026-04-13

### Added

#### Core Architecture

- **Plugin scaffold** — Complete rdc-skills plugin repo structure extracted from regen-root monorepo
- **Two-layer guide system** — Plugin base guides + project overlay guides enabling skill portability across codebases
  - Plugin base covers generic patterns (work items RPC, git workflow, standard builds)
  - Project overlays (frontend.md, backend.md, data.md, etc.) inject stack-specific conventions
  - Agent receives merged context — project layer wins on conflicts
- **Skill dispatch system** — Twelve skill commands integrated with Supabase work_items RPC
  - `/rdc:status` — Show open epics, kanban, Coolify health, next action
  - `/rdc:plan <topic>` — Architecture planning, create epic + child tasks
  - `/rdc:preplan <topic>` — Research phase before planning
  - `/rdc:build <epic-id>` — Execute epic tasks in parallel with typed agents
  - `/rdc:review` — Quality gate: tests, types, stale docs, exports
  - `/rdc:overnight` — Unattended full pipeline (chains all skills across queue)
  - `/rdc:fixit <description>` — Sanctioned bypass for <5 files, <30 min hotfixes
  - `/rdc:report` — Generate nightly markdown report to docs/reports/YYYY-MM-DD.md
  - Plus agent bootstrap guide + domain-specific agent guides (frontend, backend, data, design, infrastructure, content, cs2)

#### TDD Enforcement (Option B)

- **Wave-based test-first builds** — rdc:build now requires tests-first per build wave
  - npx vitest run per package before proceeding to next wave
  - `pnpm build` NEVER invoked (memory constraints on dev machine)
  - Allows async test runs in subagent while supervisor waits
- **Test harness integration** — skills coordinate with tsconfig paths, jest/vitest configs, test result tracking
- **Coverage reporting** — per-wave coverage aggregation, integration with GitHub PR checks

#### Stop Hook

- **no-stop-open-epics.js** — Blocks Claude from stopping when `get_open_epics()` returns todo items
  - Only blocks when todo-status epics exist (in_progress = another session owns them)
  - Project scope guard — only fires in sessions where cwd contains PROJECT_SCOPE folder
  - Integrates with Supabase REST API (project-ref from env vars)
  - Exit code 2 = block, 0 = allow
  - Silent pass if Supabase credentials unavailable

#### Installation & Management

- **Windows installer** (scripts/install.ps1) — CLAUDE_HOME detection, symlink skills + hooks, summary report
- **Unix installer** (scripts/install.sh) — Bash equivalent for macOS/Linux
- **Update scripts** — git pull + reinstall (version bump reporting)
- **Uninstall scripts** — Safe removal of rdc-skills files only (never touches user files)
- **Validation test** (tests/validate-skills.js) — YAML frontmatter check, required sections, exit 1 on failure

#### Documentation

- **Plugin README** — Architecture diagram, quick start, skill reference table, guide types, Option B explanation
- **Generic work-items-rpc.md** — Complete RPC reference (generic, no hardcoded project IDs)
  - get_open_epics, insert_work_item, update_work_item_status, get_work_items_by_epic, bump_epic_version
  - Valid enum values, JS client patterns, direct SQL patterns
- **Project setup guide** — Two required files per project (agent-bootstrap.md, project overlay guides)
- **Contributing guide** — Fork → branch → PR workflow, validate before submit

#### Settings & Configuration

- **.claude/settings.json** — Plugin harness permissions, nodeID detection
- **.gitignore** — Standard Node.js + git exclusions

### Changed

- N/A (initial release)

### Deprecated

- N/A

### Removed

- N/A

### Fixed

- N/A

### Security

- Credential handling via environment variables only (no hardcoded keys)
- clauth daemon tunnel for all sensitive operations
- Project scope guard prevents stop hook from firing in wrong context

---

## Installation & Setup

### For end users

```bash
# Windows
git clone https://github.com/LIFEAI/rdc-skills.git
npm run install:win

# macOS / Linux
git clone https://github.com/LIFEAI/rdc-skills.git
npm run install:unix
```

Then configure your project:
1. Create `docs/guides/agent-bootstrap.md` with credentials
2. Create per-role overlay guides in `docs/guides/` (frontend.md, backend.md, etc.)
3. Run `/rdc:status` to verify setup

### For contributors

```bash
git clone https://github.com/LIFEAI/rdc-skills.git
cd rdc-skills
npm run validate    # Check all skills
npm run test        # (future: comprehensive test suite)
```

---

## Known Issues & Roadmap

### Current Limitations

- Stop hook requires Supabase access (silent pass if unavailable)
- No built-in skill/guide templating yet (manual creation)
- Validation test basic (could extend to markdown lint, frontmatter schema, etc.)

### Phase 2 (Future)

- Skill generator (`rdc:newskill`) for rapid skill creation
- Guide templating system
- Agent role auto-detection from codebase structure
- Integration with GitHub Actions CI
- Skill marketplace / package distribution
- TDD enforcement integration for all major test frameworks (Vitest, Jest, pytest, Gotest)

---

## License

MIT — See LICENSE file for details.
