---
name: design
description: rdc:design (topic) — design Studio, palette and token-aware UI work
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
- UI critique, audit, polish, colorize, type, layout, or craft work in `{PROJECT_ROOT}`
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
- `rdc:design prototype <description>` — build a new UI surface for visual review
- `rdc:design compare <brief>` — dispatch the same design brief to a Claude-side pass AND a Codex-side pass in parallel, then synthesize a structured comparison (any mode also accepts a trailing `--compare` flag to run the same dual-dispatch before finalizing that mode's output)

## New-Surface Gate — PRODUCT.md / DESIGN.md Before Source Mutation

> Promoted from `rdc:onramp` (Phase 1 disk-tree scaffold + Phase 4 brand-book rubric gate),
> which is the existing model for this pattern — read `skills/onramp/SKILL.md` §Phase 1.5,
> §Phase 4.6 if this section is ever unclear. Onramp scoped this to `places/<slug>/`; this
> section is the same mechanism generalized to any new or reshaped product surface. Approved:
> Dave, direct instruction, 2026-09-05/06 session — "the existing onramp version is the model;
> it was simply scoped too narrowly."

**Applies to:** `craft`, `prototype`, and any other mode about to build a **new or reshaped
product surface** — a new app/site/package root, a new top-level route, or a rename/merge/
split of an existing screen map. **Does not apply to** `edit`, `audit`, `critique`, `polish`,
`tokens`, `palette`, `theme`, or `colorize` against an already-documented surface — those
operate against an existing PRODUCT.md/DESIGN.md, they don't have to create one first.

**Small-fix exemption — same boundary as `rdc:fixit`:** a change touching **fewer than 5
files** that does **not** introduce a new route, a new top-level screen, or a new app/site
root is exempt. Anything at or above that, or anything that adds a route/screen/app root
regardless of file count, is in scope for this gate.

### The gate

Before writing or editing any source file for an in-scope task:

1. **Locate the surface root** — the app/site/package directory, or the repo root for a
   standalone project (e.g. `C:/Dev/rdc-cde/PRODUCT.md`, not a subdirectory).
2. **Check for `PRODUCT.md` and `DESIGN.md` at that root.**
3. **If either is absent, or present but stale against the requested surface** (its screen
   map / information hierarchy does not cover the screen, route, or object the task is about
   to add or change) — **refuse to proceed to source mutation.** Create or update the missing
   or stale document(s) first, using the field lists below. This mirrors onramp's Phase 4
   rubric row *"DESIGN.md — 24-spread outline, not a stub"* and the Phase 1 gate *"disk:
   places/<slug>/ exists with all required files"* — a present-but-stub or present-but-stale
   document fails the gate exactly like an absent one.
4. Only after both documents exist and are current does the mode proceed to `craft`/
   `prototype` source work.

### PRODUCT.md — required fields

| Field | Content |
|---|---|
| Operator | Who runs/uses this surface day to day |
| Job-to-be-done | The concrete task the surface exists to complete |
| Durable objects + authority | The entities the UI reads/writes and who/what owns each one |
| Screen map | Every screen/route/panel, one row each, with its purpose |
| Acceptance outcomes | What "this surface works" means, observably |

### DESIGN.md — required fields

| Field | Content |
|---|---|
| Dominant visual object | The one element the eye lands on first, per screen |
| Information hierarchy | What outranks what, and why |
| Interaction model | How the user acts on the dominant object and its neighbors |
| Responsive transformation | What changes, collapses, or reflows at narrower widths |
| Semantic color | Token names mapped to meaning (never raw hex) |
| References | Existing surfaces/patterns this design borrows from, cited by path |
| Anti-patterns | What this surface deliberately does NOT do |
| Visual acceptance criteria | What a reviewer checks to call the visual design done |

**Refusal wording** (use verbatim, adapted to the target): *"BLOCKED: `<surface>` has no
PRODUCT.md/DESIGN.md at its root (or they are stale against this request). Per the
new-surface gate, I'm writing/updating those first before touching source."* Then write them,
then proceed.

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
       -d "{\"brandSlug\":\"<brandSlug>\",\"appSlug\":\"<appSlug>\",\"repoRoot\":\"{PROJECT_ROOT}\",\"cwd\":\"{PROJECT_ROOT}\",\"modeDefault\":\"direct_edit\",\"startedBy\":\"claude-cli\"}"
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
     node scripts/studio-debug-start.mjs --target <url|domain|brand|app|file> [--brand <slug>] [--app <slug>] [--mode direct_edit|variant_edit|reference_replace|note] [--studio-origin http://localhost:3011] [--connector http://127.0.0.1:52437] [--repo-root {PROJECT_ROOT}] [--cwd {PROJECT_ROOT}] [--dev-url <url>] [--dev-command <command>] [--no-launch]
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
   - For CLI prompt work: run `node {RDC_SKILLS_ROOT}/scripts/rdc-design-cli.mjs <command> <brief>` and inspect the generated report under `.rdc/reports/rdc-design-cli/`.

## Design Compare — Claude vs Codex, Dispatched in Parallel

Two AI engines are already wired for dual-dispatch across this fleet — Claude Code and
Codex (OpenAI/ChatGPT models) — via `codex exec`. This is not a new integration; it is the
same mechanism `scripts/lib/runner.mjs` already uses to spawn both `claude --print
--output-format stream-json` and `codex exec --json` against a prompt, and the same one
CDE's `apps/implementor-manager/src/codex-cli-implementor.ts` uses for a fresh read-only
planning turn (`codex exec --sandbox read-only --json --output-schema <schema> <prompt>`).

`rdc:design compare <brief>` (or any mode + `--compare`) runs that mechanism against a
design brief instead of a code-change prompt:

```powershell
node {RDC_SKILLS_ROOT}/scripts/rdc-design-compare-cli.mjs "<design brief>" [--out <dir>]
```

This is a **real dispatch**, not a description of one: the script spawns a fresh
`claude --print` process and a fresh `codex exec --sandbox read-only --json` process **in
parallel**, both against the identical brief plus the design skill's own operating
instructions (same construction as `rdc-design-cli.mjs`'s prompt assembly), and both told
explicitly not to mutate files — this is a proposal pass, not an edit pass. It waits for
both, extracts each engine's final message, and writes:

```text
{RDC_SKILLS_ROOT}/.rdc/reports/rdc-design-cli/compare-<timestamp>/
  claude.md     — Claude's raw design proposal
  codex.md      — Codex's raw design proposal
  report.json   — both outputs + timing + exit codes
```

**After the script returns, the calling agent (not the script) writes the comparison** —
read both `claude.md` and `codex.md` and produce a structured table, never concatenation:

| Dimension | Claude proposal | Codex proposal | Verdict |
|---|---|---|---|
| Dominant visual object | ... | ... | which fits the brief |
| Information hierarchy | ... | ... | which fits the brief |
| Interaction model | ... | ... | which fits the brief |
| Token/brand-system fit | ... | ... | which reuses existing tokens vs invents new ones |
| Tradeoffs | ... | ... | cost of each approach |

Recommend one, or a hybrid, with the reason stated — never "both are good options."

If `codex` is unreachable (binary missing, non-zero exit), report that plainly and fall
back to a single-engine pass; do not fabricate a second opinion.

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
| `craft` | Shape and build a token-aware interface — gated by New-Surface Gate above |
| `prototype` | Build a new UI surface for visual review — gated by New-Surface Gate above |
| `compare` | Dispatch the same design brief to Claude AND Codex in parallel, synthesize a comparison |

## CLI Helper

Use the local helper to see exactly how much instruction text the skill is generating before sending it through an agent:

```powershell
node {RDC_SKILLS_ROOT}/scripts/rdc-design-cli.mjs studio "audit the Studio palette page"
node {RDC_SKILLS_ROOT}/scripts/rdc-design-cli.mjs palette "generate a PRT palette workflow"
node {RDC_SKILLS_ROOT}/scripts/rdc-design-cli.mjs --json theme "RDC earth-forward light theme"
node {RDC_SKILLS_ROOT}/scripts/rdc-design-compare-cli.mjs "dashboard hero panel for a stewardship dashboard"
```

The helper writes logs to:

```text
{RDC_SKILLS_ROOT}/.rdc/reports/rdc-design-cli/
```

Each run includes character count, word count, approximate token count, references loaded, and the final prompt text. `rdc-design-compare-cli.mjs` writes its dual-engine outputs under `.rdc/reports/rdc-design-cli/compare-<timestamp>/` (see Design Compare above).

## Boundaries

- Do not edit unrelated installed skills.
- Do not rename this skill or create duplicate aliases for it.
- Do not use external live-edit runtimes as Studio's live-edit execution path.
- Do not persist Rampa output directly to production without Studio token mapping.
- Do not fork or ship Palette Designer until its license is verified.
- Do not use Studio's deprecated `/api/editor/render` route.
- Do not skip the New-Surface Gate for `craft`/`prototype` work on a new or reshaped
  surface, even when the requester did not mention PRODUCT.md/DESIGN.md.
- Do not let `compare` mode's Codex-side pass mutate files — it runs `--sandbox read-only`
  by design; if a prompt change would lift that, treat it as an architectural change.
