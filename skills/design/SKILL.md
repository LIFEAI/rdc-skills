---
name: rdc:design
description: >-
  Usage `rdc:design <command|brief>` — RDC-owned design skill for Studio, Palette Library, token-aware UI work, and Rampa CLI-assisted color systems. Forked/adapted from Impeccable concepts without modifying installed Impeccable.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls, Supabase writes, git pushes, package publishes, and deploys are skipped under `RDC_TEST=1`.

# rdc:design — RDC Design Skill

RDC-owned design execution for Studio and LIFEAI interfaces. This skill is inspired by and adapted from the Impeccable design workflow, but it is not the installed Impeccable skill and must not modify upstream Impeccable files.

## When to Use

- Studio, Palette Library, brand-token, theme, component, or live-editor work
- Any design task that must understand RDC's real token tables and Studio routes
- UI critique, audit, polish, colorize, type, layout, or craft work in `regen-root`
- Agent-side color-system exploration using Rampa CLI
- Preparing token-aware implementation instructions for frontend/backend/data agents

Use the installed `impeccable` skill directly only when the task is a general upstream Impeccable workflow and does not need RDC Studio knowledge.

## Arguments

- `rdc:design` — show the command menu
- `rdc:design studio <target>` — Studio-aware design task
- `rdc:design tokens <brand-or-route>` — token model, resolver, export, or governance task
- `rdc:design palette <brief>` — Palette Library or palette generation task
- `rdc:design theme <brief>` — theme generation/application task
- `rdc:design colorize <target>` — Rampa-assisted color-system work
- `rdc:design audit <target>` — design quality audit
- `rdc:design critique <target>` — UX/design critique
- `rdc:design polish <target>` — final visual and interaction pass
- `rdc:design craft <feature>` — shape and build a token-aware UI feature

## Required References

Load only what applies, but do not skip the Studio model for Studio/token/palette/theme work.

| Task type | Required reference |
|---|---|
| Studio, tokens, palettes, themes, editor | `skills/design/reference/studio-model.md` |
| Color generation, ramps, contrast, neutrals | `skills/design/reference/rampa.md` |
| Attribution, fork boundary, Impeccable relationship | `skills/design/reference/lineage.md` |

Project docs to read for Studio work:

- `docs/systems/studio/ARCHITECTURE.md`
- `apps/studio/CLAUDE.md`
- `.claude/context/design-system-global.md`
- affected route/component/source files

## Procedure

1. **Classify the task.**
   - `studio`, `tokens`, `palette`, and `theme` always load the Studio model.
   - `palette`, `theme`, and `colorize` also load the Rampa reference.
   - `audit`, `critique`, `polish`, and `craft` load Studio model when the target is inside Studio or uses Studio tokens.

2. **Read the actual system context.**
   - For Studio: read `docs/systems/studio/ARCHITECTURE.md` and `apps/studio/CLAUDE.md`.
   - For token work: read `.claude/context/design-system-global.md`.
   - For app UI work: read the app-specific `CLAUDE.md` if present.

3. **Find the source of truth before proposing changes.**
   - Tokens: Studio APIs, resolver files, and Supabase token tables.
   - Palette Library: Studio palette APIs and theme/palette model.
   - Live editor: RDC Native Local Debug only — `/editor/local/*`, `/api/editor/local-debug`, `/studio/debug/*`, `/studio/claude/*`, and `scripts/studio-debug-poll.mjs`.
   - Components: `@regen/ui`, Studio component registry, and existing local components.

4. **Use Rampa only as proposal tooling.**
   - Run Rampa CLI for color ramps, APCA/WCAG checks, tinted neutrals, status palettes, or data-viz palettes.
   - Treat output as draft design material.
   - Persist only after mapping into Studio token roles or Palette Library payloads.

5. **Apply RDC design rules.**
   - Use Studio tokens for production surfaces.
   - Do not hardcode color/font/spacing when a token exists.
   - Do not modify locked governance tokens.
   - Keep product UIs compact, operational, and scannable.
   - Avoid generic AI design patterns and card-heavy layouts.

6. **Plan edits before mutating files.**
   - State the files/routes/tables involved.
   - Use RDC work-item protocol for non-trivial implementation.
   - Keep upstream Impeccable installed and untouched.

7. **Verify.**
   - Run scoped tests only.
   - For Studio: prefer route smoke checks, token API checks, and browser screenshots when UI changed.
   - For CLI prompt work: run `node C:/Dev/rdc-skills/scripts/rdc-design-cli.mjs <command> <brief>` and inspect the generated report under `.rdc/reports/rdc-design-cli/`.

## Command Menu

| Command | Purpose |
|---|---|
| `studio` | Studio-aware design/build task with token, route, and editor context |
| `tokens` | Diagnose or design token usage, resolver flow, API/export, governance |
| `palette` | Palette Library work, palette generation, external Palette Designer handoff |
| `theme` | Theme creation/application/export against Studio's canonical model |
| `colorize` | Rampa-assisted color relationships and contrast checks |
| `audit` | Technical and visual audit |
| `critique` | UX/design review |
| `polish` | Final detail pass |
| `craft` | Shape and build a token-aware interface |

## CLI Helper

Use the local helper to see exactly how much instruction text the skill is generating before sending it through an agent:

```powershell
node C:/Dev/rdc-skills/scripts/rdc-design-cli.mjs studio "audit the Studio palette page"
node C:/Dev/rdc-skills/scripts/rdc-design-cli.mjs palette "generate a PRT palette workflow"
node C:/Dev/rdc-skills/scripts/rdc-design-cli.mjs --json theme "RDC earth-forward light theme"
```

The helper writes logs to:

```text
C:/Dev/rdc-skills/.rdc/reports/rdc-design-cli/
```

Each run includes character count, word count, approximate token count, references loaded, and the final prompt text.

## Boundaries

- Do not edit installed Impeccable skills.
- Do not create another skill named `impeccable`.
- Do not use Impeccable Live as Studio's live-edit execution path.
- Do not persist Rampa output directly to production without Studio token mapping.
- Do not fork or ship Palette Designer until its license is verified.
- Do not use Studio's deprecated `/api/editor/render` route.
