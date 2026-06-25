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

### Installer profiles

`scripts/install-rdc-skills.js` supports profiles:

```bash
node scripts/install-rdc-skills.js --profile core
node scripts/install-rdc-skills.js --profile lifeai
```

- `core` is safe for a clean machine with only rdc-skills installed. It wires portable hooks only: RDC output-contract enforcement, foreground-process policy, commit-message hygiene, and non-blocking work logging.
- `lifeai` is for the LIFEAI/regen-root workstation. It additionally wires the regen-root cwd lock, clauth/Supabase work-item gates, overnight queue guard, and LIFEAI session hooks.
- `auto` is the default. It chooses `lifeai` only when a sibling `regen-root` project is detected; otherwise it chooses `core`.

To add managed startup instructions to a project:

```bash
node scripts/install-rdc-skills.js --project-root /path/to/project --write-startup-blocks
```

This writes `.rdc/guides/rdc-skills-startup.md` and managed RDC sections in `CLAUDE.md` and `AGENTS.md`.

### MCP endpoint and direct curl access

The shared MCP endpoint is:

```text
https://rdc-skills.regendevcorp.com/mcp
```

Health check:

```bash
curl -s https://rdc-skills.regendevcorp.com/health
```

Streamable HTTP MCP calls must use `POST` and include the SSE-compatible
`Accept` header:

```bash
curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

List tools:

```bash
curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

List skills:

```bash
curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rdc_skill_list","arguments":{}}}'
```

Fetch a skill body for a specific caller surface:

```bash
curl -s -X POST https://rdc-skills.regendevcorp.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"rdc_skill_get","arguments":{"name":"build","variant":"cli"}}}'
```

Use `variant:"cli"` for Claude Code/Codex/local terminal instructions. Use
`variant:"cloud"` for claude.ai web sessions where local daemon, shell, or
filesystem steps need cloud-safe wording.

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

29 skills organized into 6 categories:

### Orchestration Skills (workflow drivers)
- rdc:build, rdc:plan, rdc:preplan, rdc:review, rdc:overnight, rdc:fixit, rdc:status, rdc:report

### Agent Guides (dispatched by rdc:build, not user-invocable)
Located in `guides/agents/` — plain markdown playbooks spawned as sub-agents:
- frontend, backend, data, design, infrastructure, content, cs2, viz, setup, verify

### Bridge Skills (Planning → CLI)
- rdc:handoff, rdc:prototype, rdc:workitems

### Utility Skills
- rdc:collab
- rdc:co-develop — peer-aware Claude/Codex co-development over clauth
- rdc:fs-mcp — File System MCP bridge guidance for live repo reads/writes
- rdc:terminal-config — Windows Terminal and hidden-launch policy audit
- rdc:watch — session-log viewer initialization for attended sessions
- rdc:channel-formatter — channel-native formatting and content repurposing for LinkedIn, Twitter/X, Slack/Teams, email, decks, Word/PDF structure, web copy, and content packs

### Design Skills
- rdc:design — RDC/Studio design, tokens, palettes, themes, and Rampa CLI-assisted color systems

### Document and Brochure Skills
- rdc:convert — Office/Markdown conversion via build-corpus
- rdc:brochure — HTML/folder/zip/URL/Markdown to print-quality PDF
- rdc:brochurify — six-wave Brochurify orchestration contract
- lifeai-brochure-author — brochure JSX authoring contract for @lifeai/brochure-kit
- rdc:extract-verifier-rules — verifier-rule candidates from enhancement logs
- rpms-filemap — canonical RPMS file-map lookup

### Reference
- rdc:help, rdc:self-test

## Channel Formatting and Content Packs

`rdc:channel-formatter` handles both strict channel formatting and content
repurposing. It can take a long article, memo, report, transcript, or rough
draft and turn it into a single channel-native output or a coordinated pack.

Examples:

```bash
rdc:channel-formatter linkedin article.md
rdc:channel-formatter twitter-thread article.md
rdc:channel-formatter social-pack article.md
rdc:channel-formatter campaign-pack report.md
rdc:channel-formatter strict-format "preserve this wording for LinkedIn"
```

Pack modes:

- `social-pack` — LinkedIn thought-leadership post, short LinkedIn variant,
  Twitter/X single post, Twitter/X thread, and Slack/Teams internal share.
- `campaign-pack` — social pack plus external email intro, web excerpt, meta
  title/description, and CTA variants.
- `exec-pack` — internal email summary, Slack/Teams update, executive summary,
  talking points, and a decision/ask line when supported by the source.
- `launch-pack` — launch posts and blurbs for LinkedIn, Twitter/X, Slack/Teams,
  external email, and web hero copy.

Boundaries:

- Actual `.docx`, `.pptx`, `.ppt`, or Markdown file conversion uses
  `rdc:convert`.
- HTML/folder/zip/URL to PDF rendering uses `rdc:brochure`.
- Brochurify jobs use `rdc:brochurify`.
- Brochure JSX authored with `@lifeai/brochure-kit` uses
  `lifeai-brochure-author`.

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
  channel-formatter/SKILL.md (channel-native formatting and content packs)
  convert/SKILL.md     (Office/Markdown conversion)
  brochure/SKILL.md    (print-quality PDF rendering)
  rdc-brochurify/SKILL.md (Brochurify orchestration)
  lifeai-brochure-author/SKILL.md (brochure JSX authoring)
  rdc-extract-verifier-rules/SKILL.md (verifier rule extraction)
  rpms-filemap/SKILL.md (canonical RPMS file map)

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
# Published package
npm view @lifeaitools/rdc-skills version

# Installed global package
npm list -g @lifeaitools/rdc-skills --depth=0

# Running MCP service
curl -s https://rdc-skills.regendevcorp.com/health
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
