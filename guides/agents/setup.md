> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.


> **Sandbox contract:** This guide honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls short-circuit under the flag.

# /rdc:setup — Intelligent Project Setup

Scan the current project, detect all existing configuration, and generate (or update) `.rdc/config.json` and overlay guides. Works on both new and existing projects.

---

## Step 1 — Scan the project

Read these files (all optional — use what exists):

| File | What to extract |
|------|----------------|
| `package.json` | `name`, `description`, stack (next/vite/etc), monorepo? |
| `pnpm-workspace.yaml` or `lerna.json` | monorepo structure |
| `git remote get-url origin` | GitHub org + repo name |
| `git branch -a` | main/develop/master detection |
| `.env.local`, `apps/**/.env.local` | `NEXT_PUBLIC_SUPABASE_URL` → extract project ref |
| `CLAUDE.md` | PROJECT_SCOPE, forbidden commands, branch rules, supabase ref |
| `.claude/rules/*.md` | existing rule files, what systems are covered |
| `docs/guides/agent-bootstrap.md` or `.rdc/guides/agent-bootstrap.md` | existing credentials pattern |
| `.rdc/config.json` | already configured? just show current state + offer update |
| `docs/guides/`, `docs/plans/`, `.rdc/guides/`, `.rdc/plans/` | existing directory structure (either layout) |
| `apps/` or `sites/` | app names, ports from package.json `dev` scripts |
| `supabase/migrations/` | schema exists? |
| `tailwind.config.*` | Tailwind confirmed |
| `vitest.config.*` or `jest.config.*` | test framework |
| `.coolify/` or coolify deployment refs | deploy platform |

Emit a structured summary of what you found:
```
Detected:
  Project name  : <name>
  GitHub        : <org>/<repo>
  Supabase ref  : <ref or "not found">
  Branches      : main=<branch>, dev=<branch>
  Stack         : <next.js 14 / vite / etc>
  Monorepo      : yes/no (<tool>)
  Apps found    : <list or "none">
  Guides dir    : <.rdc/guides or docs/guides or "none">
  Existing cfg  : yes/no
  Hook scope    : <detected folder name or "unknown">
```

---

## Step 2 — Check for gaps

List anything that was NOT found and ask the user to fill in:

```
Missing (please provide):
  [ ] Project description
  [ ] Deploy platform / dashboard URL
  [ ] Forbidden commands beyond defaults?
  [ ] Any satellite repos (other GitHub repos in this project)?
```

Keep questions to a minimum — only ask what can't be auto-detected.

---

## Step 3 — Generate .rdc/config.json

Using all detected + user-supplied values, write `.rdc/config.json`:

```json
{
  "name": "<slug>",
  "version": "1.0.0",
  "description": "<description>",
  "rdc_skills_version": ">=0.2.0",
  "hook_scope": "<project-folder-name>",
  "git": {
    "org": "<githubOrg>",
    "repo": "<githubRepo>",
    "main_branch": "<main>",
    "dev_branch": "<develop>",
    "auto_commit_branch": "<develop>"
  },
  "supabase": {
    "ref": "<ref>",
    "url": "https://<ref>.supabase.co",
    "mcp_server": "mcp__claude_ai_Supabase__execute_sql"
  },
  "credentials": {
    "provider": "clauth",
    "daemon_url": "http://127.0.0.1:52437",
    "env_paths": [".env.local"]
  },
  "repos": [
    { "path": ".", "role": "primary", "description": "<project name>" }
  ],
  "paths": {
    "guides":   ".rdc/guides",
    "plans":    ".rdc/plans",
    "reports":  ".rdc/reports",
    "research": ".rdc/research",
    "state":    ".rdc/state",
    "systems":  "docs/systems"
  },
  "work_items": { "enabled": true },
  "constraints": {
    "forbidden_commands": ["pnpm build"],
    "typecheck_command": "npx tsc --noEmit",
    "test_command": "npx vitest run",
    "never_push_to": ["main"]
  }
}
```

If `.rdc/config.json` already exists, show a diff of proposed changes and ask before overwriting.

---

## Step 4 — Generate overlay guides

Create `.rdc/guides/agent-bootstrap.md` if it doesn't exist:

```markdown
# Agent Bootstrap — <Project Name>
> Project overlay — extends rdc-skills base guide.

## Credentials
curl -s http://127.0.0.1:52437/get/<service>

## Git Rules
- Branch: `<devBranch>` for all work. `<mainBranch>` = production.
- GitHub org: <githubOrg>
- Auto-commit to `<devBranch>` after every logical block.

## Supabase
Project ref: `<ref>`
Use `mcp__claude_ai_Supabase__execute_sql` — no `project_id` needed.

## Work Items
SELECT get_open_epics();
SELECT insert_work_item(p_title := '...', p_priority := 'high');
SELECT update_work_item_status('<id>'::uuid, 'review', '["Implementation complete; ready for validator"]'::jsonb, '<agent-session-id>', 'agent');
Create work items BEFORE starting work.

## Completion Report
After finishing work, output:
## Work Summary
- Files changed: <list>
- Tests: pass/fail
- Work items updated: <list>
- Committed: <sha>
```

If `docs/guides/` or `.rdc/guides/` already has an `agent-bootstrap.md`, read it and preserve any custom sections — only add missing sections, don't overwrite existing ones.

---

## Step 5 — Offer to move docs/ dirs

If `docs/guides/`, `docs/plans/`, `docs/reports/`, or `docs/research/` exist, ask:

```
Found existing docs/ directories. Move to .rdc/ layout?
  docs/guides   → .rdc/guides   [Y/n]
  docs/plans    → .rdc/plans    [Y/n]
  docs/reports  → .rdc/reports  [Y/n]
  docs/research → .rdc/research [Y/n]
```

Move only the directories the user confirms.

---

## Step 6 — Scaffold CLAUDE.ai.md and relay dirs

Create `.rdc/relay/from-claude-ai/`, `.rdc/relay/from-claude-code/`, and `.rdc/relay/RELAY.md`.

Create `CLAUDE.ai.md` in the project root if it doesn't exist:

```markdown
# CLAUDE.ai — Startup Guide for claude.ai Sessions
> Read this at the start of every claude.ai session on this repo.

## What You Are

You are a claude.ai session — the **creative studio** in this stack. You produce artifacts,
React prototypes, plans, copy, and designs. Claude Code CLI is the **build engine** — it runs
agents, manages git, enforces hooks, and ships to production.

**This is co-working, not handoff.** You produce real artifacts; Claude Code adapts and ships them.

## Startup Sequence — every session

```
1. fs_read CLAUDE.ai.md                     ← you are here
2. fs_read CLAUDE.md                        ← CLI routing, hard rules
3. SELECT get_open_epics()                  ← what's in flight
4. fs_list .rdc/relay/from-claude-code/     ← messages from Claude Code
5. fs_read apps/<app>/CLAUDE.md             ← only if working in a specific app
```

## Capabilities

| Capability | Tool |
|-----------|------|
| Read/write/import repo files | `fs_read`, `fs_write`, `fs_write_chunk`, `fs_ingest_url`, `fs_import_git_files`, `fs_glob`, `fs_grep` |
| Query Supabase | Supabase MCP `execute_sql` |
| GitHub operations | Github Proxy MCP |
| Credentials | clauth MCP `clauth_get` |
| Trigger Claude Code | `monkey_dispatch` MCP |

For filesystem decisions, load `rdc:fs-mcp`. It defines when to use direct FS writes, chunked writes, URL ingest, or GitHub-branch import into the dirty local monorepo.

## Two-Claude Relay

Two channels to communicate with Claude Code:

**File relay (async):** Write to `.rdc/relay/from-claude-ai/<timestamp>-<topic>.md`:
```
---
from: claude-ai
to: claude-code
type: task | artifact
topic: <slug>
epic_id: <uuid>
status: pending
---
<agent prompt or artifact content>
```

**Live dispatch (immediate):** Fire Claude Code directly:
```
mcp__claude_ai_clauth__monkey_dispatch({
  prompt: "Read .rdc/guides/agent-bootstrap.md. Your task: ...",
  cwd: "<project root>"
})
```

Check `.rdc/relay/from-claude-code/` at startup for results and questions from Claude Code.
Full protocol: `.rdc/relay/RELAY.md`

## Hard Rules

- **NEVER run `pnpm build`** — crashes machine
- **NEVER commit to `main`** — always `<devBranch>`
- **NEVER start work without a work item**
- **NEVER ask for credentials** — use clauth MCP directly
```

If `CLAUDE.ai.md` already exists, read it first and add only the relay section if missing — do not overwrite existing content.

---

## Step 7 — Commit

```bash
git add .rdc/ CLAUDE.ai.md
git commit -m "feat(rdc): add .rdc/ config, guides, relay scaffold and CLAUDE.ai.md

Generated by /rdc:setup scan.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
if [ "$RDC_TEST" != "1" ]; then
  git push origin <devBranch>
else
  echo "[RDC_TEST] skipping git push origin <devBranch>"
fi
```

---

## Output

Report:
- What was detected automatically
- What was generated
- What still needs manual attention (e.g. `deploy_dashboard_url`, `satellite_repos`)
- Next step: `/rdc:status` to verify
