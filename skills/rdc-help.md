---
name: rdc:help
description: >-
  Show all available rdc:* skills and what each one does. Use when the project lead
  asks "what skills do you have", "what commands are available", "how do I",
  or when you need to decide which skill to invoke for a given task.
---

# rdc:help — Skill Index

## Workflow Skills (orchestrators)

| Skill | When to Use |
|-------|-------------|
| `rdc:overnight` | Unattended overnight build — works all urgent/high epics autonomously |
| `rdc:build` | Execute a specific epic or topic — dispatches typed agents |
| `rdc:plan` | Architecture doc + database epic/tasks from a research doc or direction |
| `rdc:preplan` | Research best practices before committing to a plan |
| `rdc:review` | Code quality check — typecheck, lint, test affected packages |
| `rdc:report` | Session summary → docs/reports/ |
| `rdc:status` | Current state: open epics, build health, deployment status |

## Agent Type Skills (dispatched by rdc:build)

| Skill | When to Use |
|-------|-------------|
| `rdc:frontend` | React components, pages, Tailwind, animation, UI library |
| `rdc:backend` | API routes, server components, database queries, auth |
| `rdc:data` | Migrations, schema changes, RPC functions, field schema seeding |
| `rdc:design` | Brand tokens, OG images, typography, design system |
| `rdc:infra` | CI/CD deploys, DNS, SSL, env vars, build config |
| `rdc:content` | Marketing copy, email templates, messaging |
| `rdc:cs2` | HAIL, Quad Pixel, AEMG, Virtue Engine, PAL, CS 2.0 packages |
| `rdc:viz` | Custom viz: charts, SVG diagrams, data visualizations, etc. |

## Planning ↔ CLI Bridge Skills

| Skill | When to Use |
|-------|-------------|
| `rdc:handoff` | Finalize a session → plan doc + database work items for CLI |
| `rdc:prototype` | Build a JSX prototype for review before production implementation |
| `rdc:workitems` | Create/update/query database work items |

## Guide Files (read by agents — not invoked directly)

| File | For Agent Type |
|------|---------------|
| `docs/guides/frontend.md` | frontend, viz |
| `docs/guides/backend.md` | backend |
| `docs/guides/data.md` | data |
| `docs/guides/design.md` | design, viz |
| `docs/guides/infrastructure.md` | infra |
| `docs/guides/content.md` | content |
| `docs/guides/cs2.md` | cs2, hail, pal, virtue |

## Decision Tree

```
Project lead says → invoke
─────────────────────────────────────────────────
"build it" / "go" / "execute"        → rdc:build <topic>
"run overnight" / "build while I sleep" → rdc:overnight
"research this" / "how do others do" → rdc:preplan <topic>
"plan this out" / "architect"        → rdc:plan <topic>
"what's the status" / "how are we"   → rdc:status
"write a report" / "summarize session" → rdc:report
"hand this off" / "give to agents"   → rdc:handoff
"show me what it looks like"         → rdc:prototype
"add to backlog" / "create a ticket" → rdc:workitems
"what commands" / "what skills"      → rdc:help
```

## Key Infrastructure

| Resource | Purpose |
|----------|---------|
| Project Root | `{PROJECT_ROOT}` |
| Database URL | Configured per project |
| Deployment System | Configured per project |
| Credential Daemon | `http://127.0.0.1:52437` |
| Dev Branch | `{development-branch}` |
| Prod Branch | `{production-branch}` |

## Rules That Apply Everywhere

- NEVER run `pnpm build` — crashes the system
- NEVER overlap agents on the same files
- NEVER push to production from agent sessions
- ALWAYS update work items in real time
- ALWAYS read the guide file before starting agent work
- ALWAYS check prototype_registry before building from scratch
