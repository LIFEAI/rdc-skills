---
name: rdc:edit
description: "Usage `rdc:edit <site|brand|route|file>` — open the local website editor host for a target site, brand, route, or file. Resolves the target, launches or reuses the local editor host on port 3015, and opens the target in the browser when not under `RDC_TEST=1`."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md`).

> **Sandbox contract:** This skill honors `RDC_TEST=1`. Under test, do not steal focus or rely on foreground-only browser automation; report the resolved editor URL instead.


# rdc:edit — Local Website Editor Launcher

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

### 3. Start or reuse the editor host
- The editor host lives at `http://localhost:3015`.
- Launch the host if needed:
  ```powershell
  pnpm --filter @regen/editor-host dev
  ```
- Open the editor page for the resolved target:
  ```txt
  http://localhost:3015/editor/local/<brandSlug>?targetUrl=<targetUrl>
  ```

### 4. Open the page
- Normal use: open the URL in the browser and confirm the editor loaded.
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
