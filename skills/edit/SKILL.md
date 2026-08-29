---
name: edit
description: "rdc:edit (target) — open the local website editor for a target"
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1`. Under test, do not steal focus or rely on foreground-only browser automation; report the resolved editor URL instead.


# rdc:edit — Local Website Editor Launcher

**This skill is the designated handler `rdc-harness` dispatches to.**
`packages/work/src/editors.mjs`'s `BY_CLASS` table maps `site-html`/`site-ts`
product classes to editor id `'rdc:edit'` — when an agent calls
`node C:/Dev/rdc-harness/bin/rdc-harness.mjs edit <slug>` against a website
target, its receipt names `editorId: 'rdc:edit'` and an `editableBoundary`.
This skill IS that handler: resolve the same target, launch/reuse the editor
host, use the harness's `editableBoundary` as the save boundary if the call
originated from a harness `edit` receipt. Every other product class
(`app`/`package`/`mcp`/`model`/`artifact`) maps to editor id `'source'` — a
boundary-checked file save with no live/co-editing surface at all; that gap
is real and unbuilt, not something this skill covers.

## When to Use
- The user wants to open a site, brand, route, or file in the local editor app
- The user says "open this in the editor" or asks for the editor-host workflow
- The target should be loaded in `@regen/editor-host` rather than Studio

## Arguments
- `rdc:edit <site|brand|route|file>` — resolve the target and open it in the local editor host

## Procedure

### 1. Read the local editor contract
- Read `apps/editor/CLAUDE.md` before launching anything.
- If the target is Studio-specific, prefer `rdc:design edit <target>` instead.

### 2. Resolve the target
- For known LIFEAI brand targets, map to the obvious brand/app pair first.
- `prtrust.fund` and `dev.prtrust.fund` resolve to `brandSlug=prt` and `appSlug=prt`.
- `test`, `studio_test`, and `studio-test` resolve to `brandSlug=test` and `appSlug=studio_test`.
- If the target is a local file or route and the brand/app is unclear, ask one concise question.

Resolve the **target dev server** (package + port) so the preview iframe has
something live to load. Read the brand app's `package.json` `name` and its
`dev` script port — never hard-code a stale port:

| Target | App dir | Package (`name`) | Dev port | `targetUrl` |
|--------|---------|------------------|----------|-------------|
| `prt` / `prtrust.fund` | `apps/prt` | `@regen/prt-portal` | `3006` | `http://localhost:3006` |
| `test` / `studio_test` | (bundled) | — (editor host serves it) | `3015` | auto (`/editor/local-test-target`) |

For any other brand, derive the package name and port by reading
`apps/<app>/package.json` (`name` field and the `--port` in the `dev` script).
`brandSlug=test` needs no target server — the editor host serves the fixture
on its own origin.

### 3. Start or reuse BOTH servers (edit starts everything)
`rdc:edit` must bring up everything the preview needs — the editor host AND the
target brand's dev server. Start-or-reuse each: probe the port first, only
launch if it is dead.

**3a. Editor host (`http://localhost:3015`)**
- Probe: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3015/` — any
  non-`000` means it is already up; reuse it.
- Launch only if down (background, do not block the session):
  ```powershell
  pnpm --filter @regen/editor-host dev
  ```

**3b. Target brand dev server (skip for `brandSlug=test`)**
- Probe the resolved dev port (e.g. `http://localhost:3006/`). Non-`000` =
  already running; reuse it. `EADDRINUSE` on launch also means reuse — not an error.
- Launch only if down (background), then health-wait on the port before opening:
  ```powershell
  pnpm --filter <package> dev
  ```
  Bounded health-wait only (no `for`/`seq`/`sleep` polling loops):
  ```bash
  until curl -s -o /dev/null http://localhost:<port>/; do sleep 2; done
  ```
- Open the editor page for the resolved target once BOTH report a live code:
  ```txt
  http://localhost:3015/editor/local/<brandSlug>?appSlug=<appSlug>&targetUrl=<targetUrl>
  ```

### 4. Open the page
- Normal use: open the URL in the browser and confirm the editor loaded.
  Open via PowerShell `Start-Process`, NOT `cmd start` — `cmd` treats the `&`
  between query params as a command separator and truncates the URL:
  ```powershell
  Start-Process 'http://localhost:3015/editor/local/<brandSlug>?appSlug=<appSlug>&targetUrl=<targetUrl>'
  ```
- `RDC_TEST=1`: do not force a foreground browser action; report the exact editor URL and whether the target was resolved.

### 5. Report the result
- Return a concise line with:
  - the resolved target
  - the editor URL
  - whether the page was opened or only prepared in test mode

## Guardrails
- Do not turn this into a full design audit.
- Do not start Studio unless the target actually belongs there.
- Do not do broad discovery when one target mapping is enough.
