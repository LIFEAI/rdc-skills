---
name: rdc:design
description: >-
  Usage `rdc:design <command|brief>` — RDC-owned design skill for Studio, Palette Library, token-aware UI work, and Rampa CLI-assisted color systems.
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1` per `guides/agent-bootstrap.md` § RDC_TEST Sandbox Contract. Destructive external calls, Supabase writes, git pushes, package publishes, and deploys are skipped under `RDC_TEST=1`.

# rdc:design — RDC Design Skill

RDC-owned design execution for Studio and LIFEAI interfaces. This skill is the Studio-aware design authority for RDC token, palette, theme, component, and local-debug work.

## When to Use

- Studio, Palette Library, brand-token, theme, component, or live-editor work
- Any design task that must understand RDC's real token tables and Studio routes
- UI critique, audit, polish, colorize, type, layout, or craft work in `regen-root`
- Agent-side color-system exploration using Rampa CLI
- Preparing token-aware implementation instructions for frontend/backend/data agents

## Arguments

- `rdc:design` — show the command menu
- `rdc:design edit <target>` — start a local source-edit session for a URL, app, brand, route, or file
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
| Ownership, operating boundary, attribution files | `skills/design/reference/ownership.md` |

Project docs to read for Studio work:

- `docs/systems/studio/ARCHITECTURE.md`
- `apps/studio/CLAUDE.md`
- `.claude/context/design-system-global.md`
- affected route/component/source files

## Procedure

1. **Classify the task.**
   - `edit` means start a local source-edit session. Do not show the generic command menu for `edit`.
   - `studio`, `tokens`, `palette`, and `theme` always load the Studio model.
   - `palette`, `theme`, and `colorize` also load the Rampa reference.
   - Any task involving colors, palettes, ramps, contrast, neutrals, light/dark color pairs, status colors, chart colors, or theme colors loads the Rampa reference.
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

4. **For `edit`, start the local session directly.**
   - Intent syntax:
     ```powershell
     rdc:design edit <url|domain|brand|app|file>
     ```
   - Required variables:
     - `target`
     - `brandSlug`
     - `appSlug`
     - `repoRoot`
     - `cwd`
     - `connectorBaseUrl`
     - `studioOrigin`
     - `modeDefault`
   - Fill missing variables from the obvious target mapping before asking:
     - `test`, `studio_test`, `studio-test` -> `--brand test --app studio_test`
     - `prt`, `prt-portal`, `prtrust.fund`, `dev.prtrust.fund` -> `--brand prt --app prt`
   - If the target is a file path and brand/app are not obvious, ask one concise question for the missing brand/app. Do not search broadly or show the generic command menu.
   - Canonical start call:
     ```powershell
     curl.exe -s -X POST "http://127.0.0.1:52437/studio/debug/start" `
       -H "Content-Type: application/json" `
       -d "{\"brandSlug\":\"<brandSlug>\",\"appSlug\":\"<appSlug>\",\"repoRoot\":\"C:/Dev/regen-root\",\"cwd\":\"C:/Dev/regen-root\",\"modeDefault\":\"direct_edit\",\"startedBy\":\"claude-cli\"}"
     ```
   - Expected successful response shape:
     ```json
     {
       "ok": true,
       "sessionId": "studio-...",
       "token": "...",
       "devUrl": "http://localhost:3006",
       "relayBaseUrl": "http://127.0.0.1:52437/studio/debug/studio-...",
       "claudeBaseUrl": "http://127.0.0.1:52437/studio/claude/studio-...",
       "pollCommand": "node scripts/studio-debug-poll.mjs --session ... --token ... --relay ..."
     }
     ```
   - Construct the Studio attach URL exactly:
     ```txt
     http://localhost:3011/editor/local/<brandSlug>?attach=1&sessionId=<sessionId>&token=<token>
     ```
   - Never send the user to `/editor/local/<brandSlug>` without `attach=1&sessionId=...&token=...`.
   - Canonical poll call:
     ```powershell
     curl.exe -s "http://127.0.0.1:52437/studio/claude/<sessionId>/poll?token=<token>&timeout=600000"
     ```
   - Canonical reply call:
     ```powershell
     curl.exe -s -X POST "http://127.0.0.1:52437/studio/claude/<sessionId>/reply" `
       -H "Content-Type: application/json" `
       -d "{\"token\":\"<token>\",\"eventId\":\"<eventId>\",\"status\":\"done\",\"message\":\"Edited <path>\",\"filesChanged\":[\"<path>\"]}"
     ```
   - Allowed terminal statuses are `done`, `error`, `blocked`, and `needs_reference`.
   - Convenience helper, equivalent to the canonical start call plus attach URL construction:
     ```powershell
     node scripts/studio-debug-start.mjs --target <url|domain|brand|app|file> [--brand <slug>] [--app <slug>] [--mode direct_edit|variant_edit|reference_replace|note] [--studio-origin http://localhost:3011] [--connector http://127.0.0.1:52437] [--repo-root C:/Dev/regen-root] [--cwd C:/Dev/regen-root] [--dev-url <url>] [--dev-command <command>] [--no-launch]
     ```
   - Helper output contract:
     ```txt
     STUDIO_URL=http://localhost:3011/editor/local/<brandSlug>?attach=1&sessionId=...&token=...
     POLL_COMMAND=node scripts/studio-debug-poll.mjs --session ... --token ... --relay ...
     SESSION_FILE=.studio-debug/<sessionId>.json
     ```
   - If using the helper, run:
     ```powershell
     node scripts/studio-debug-start.mjs --target <target>
     ```
   - Return `STUDIO_URL` and `POLL_COMMAND` to the user. If operating as Claude CLI, open or instruct opening `STUDIO_URL`, then run `POLL_COMMAND`.
   - After an event is received, edit the source directly and reply with the helper or canonical reply call:
     ```powershell
     node scripts/studio-debug-poll.mjs --session <sessionId> --token <token> --relay <claudeBaseUrl> --reply <eventId> done --file <path> --message "Edited <path>"
     ```

5. **Use Rampa only as proposal tooling.**
   - Run Rampa CLI for color ramps, APCA/WCAG checks, tinted neutrals, status palettes, or data-viz palettes.
   - Treat output as draft design material.
   - Persist only after mapping into Studio token roles or Palette Library payloads.

6. **Apply RDC design rules.**
   - Use Studio tokens for production surfaces.
   - Do not hardcode color/font/spacing when a token exists.
   - Do not modify locked governance tokens.
   - Keep product UIs compact, operational, and scannable.
   - Avoid generic AI design patterns and card-heavy layouts.

7. **Plan edits before mutating files.**
   - State the files/routes/tables involved.
   - Use RDC work-item protocol for non-trivial implementation.
   - Keep unrelated installed skills and vendor artifacts untouched.

8. **Verify.**
   - Run scoped tests only.
   - For Studio: prefer route smoke checks, token API checks, and browser screenshots when UI changed.
   - For CLI prompt work: run `node C:/Dev/rdc-skills/scripts/rdc-design-cli.mjs <command> <brief>` and inspect the generated report under `.rdc/reports/rdc-design-cli/`.

## Command Menu

| Command | Purpose |
|---|---|
| `edit` | Start a local source-edit session for a URL, app, brand, route, or file |
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

- Do not edit unrelated installed skills.
- Do not rename this skill or create duplicate aliases for it.
- Do not use external live-edit runtimes as Studio's live-edit execution path.
- Do not persist Rampa output directly to production without Studio token mapping.
- Do not fork or ship Palette Designer until its license is verified.
- Do not use Studio's deprecated `/api/editor/render` route.
