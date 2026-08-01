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

### 0. Pin your own worktree root (once, first, always)
Run `git rev-parse --show-toplevel` and keep the result as `$ROOT` for the rest
of this procedure. Every server you start or reuse, and every query param you
open the editor with, is scoped to `$ROOT` — never to a hardcoded
`C:/Dev/regen-root` or another lane's worktree. This is what step 3 and step 4
depend on to avoid the cross-tree failure documented below.

### 1. Read the local editor contract
- Read `apps/editor/CLAUDE.md` before launching anything.
- If the target is Studio-specific, prefer `rdc:design edit <target>` instead.

### 2. Resolve the target — registry first, one query
For ANY target that is (or might be) a registered app, resolve it with a
single Supabase RPC call before touching the filesystem:
```sql
SELECT get_deployment('<slug>');
```
This one call returns `monorepo_path` (app dir), the dev `pm2_port`, and the
dev `branch` — everything needed to build `targetUrl` without reading any
`package.json`. If the slug is unknown, try the app's known URL:
```sql
SELECT app_slug, environment, url, pm2_port FROM app_deployments
WHERE url ILIKE '%<fragment>%' ORDER BY app_slug, environment;
```
Known fast-path aliases (skip the query entirely for these):

| Target | App dir | Dev port | `targetUrl` |
|--------|---------|----------|-------------|
| `prt` / `prtrust.fund` / `dev.prtrust.fund` | `apps/prt` | `3006` | `http://localhost:3006` |
| `test` / `studio_test` / `studio-test` | (bundled) | `3015` | auto (`/editor/local-test-target`) |

For anything not in the registry and not aliased above (e.g. a bare local
file/route with no known brand), ask one concise question rather than
guessing. Only fall back to reading `apps/<app>/package.json` if the registry
has no row for the target at all.

### 3. Start or reuse BOTH servers — reuse must be same-tree, not just same-port
`rdc:edit` must bring up everything the preview needs: the editor host AND the
target app's dev server, both bound to `$ROOT` from step 0.

**3a. Target app dev server (skip for `brandSlug=test`)**
- Probe the resolved dev port (e.g. `http://localhost:3204/`). Non-`000` =
  already running — reuse it only after confirming it is serving `$ROOT` (see
  the cross-tree check below); a bare port probe is not enough.
- Launch only if down (background): `pnpm --filter <package> dev`
  (run from `$ROOT`; `EADDRINUSE` on launch means reuse, not an error).
  Bounded health-wait only (no unbounded polling loops):
  ```bash
  timeout 60 bash -c 'until curl -s -o /dev/null http://localhost:<port>/; do sleep 2; done'
  ```

**3b. Editor host — verify tree ownership before reusing port 3015**
A live process on 3015 is not automatically yours. Before treating it as
reusable, confirm its owning directory matches `$ROOT`:
```powershell
$portPid = (Get-NetTCPConnection -LocalPort 3015 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($portPid) { (Get-CimInstance Win32_Process -Filter "ProcessId=$portPid").CommandLine }
```
- Command line contains `$ROOT\apps\editor` → **same tree, reuse it.**
- Command line shows a different `regen-root.wt\<other-lane>` path (or the main
  tree) → **do not reuse.** That instance's `sourceDir`/`servedRoot` resolve
  against its own `process.cwd()`, not yours — direct-write source-marker
  instrumentation silently writes into files your dev server never serves, so
  every edit permanently reports `source_markers_missing` and escalates to
  TinTin instead of writing directly. This exact failure is why this rule
  exists (see Guardrails).
- Not reusable → pick the next free port from `3015, 3020, 3021, 3022, ...`
  and launch your own instance scoped to `$ROOT`, bypassing the package.json's
  hardcoded `--port 3015` (pnpm appends `-- --port N` as a broken extra
  argument, not an override):
  ```bash
  ( cd "$ROOT/apps/editor" && node_modules/.bin/next dev --port <freeport> > /path/to/scratchpad/editor-host.log 2>&1 )
  ```
  Health-wait the same bounded way as 3a before opening.

### 4. Open the page — always pin repoRoot/cwd/servedRoot explicitly
Never open the bare `<brandSlug>?appSlug=...&targetUrl=...` URL. Without
`repoRoot`/`cwd`/`servedRoot`, the editor's direct-write path falls back to a
hardcoded `C:/Dev/regen-root` (the main tree) even when the editor host itself
is correctly running from `$ROOT` — a second, independent way to end up
editing the wrong checkout. Always include all three, set to `$ROOT`:
```txt
http://localhost:<editor-port>/editor/local/<brandSlug>?appSlug=<appSlug>&targetUrl=<targetUrl>&repoRoot=<$ROOT>&cwd=<$ROOT>&servedRoot=<$ROOT>
```
- Normal use: open via PowerShell `Start-Process`, NOT `cmd start` — `cmd`
  treats the `&` between query params as a command separator and truncates
  the URL:
  ```powershell
  Start-Process 'http://localhost:<editor-port>/editor/local/<brandSlug>?appSlug=<appSlug>&targetUrl=<targetUrl>&repoRoot=<ROOT>&cwd=<ROOT>&servedRoot=<ROOT>'
  ```
- `RDC_TEST=1`: do not force a foreground browser action; report the exact editor URL and whether the target was resolved.
- Once the page is open, the editor's own startup preflight (`POST
  /api/editor/launcher/check`, called automatically on load) runs
  auto-instrumentation and reports `directWriteReady`/`diagnostics` in its UI
  badge — do not call it again manually. If it still reports
  `source_markers_missing` after step 3b/4 were followed correctly, that is a
  real instrumentation gap in the target app, not a missed preflight call —
  investigate `instrumentTarget` inference for that app rather than re-running
  the check.

### 5. Report the result
- Return a concise line with:
  - the resolved target
  - the editor URL
  - whether the page was opened or only prepared in test mode

## Guardrails
- Do not turn this into a full design audit.
- Do not start Studio unless the target actually belongs there.
- Do not do broad discovery when one target mapping is enough.
- **Never reuse an editor-host port without confirming tree ownership (step
  3b).** On 2026-08-01 a session reused a live port-3015 editor-host that
  belonged to a different lane's worktree. The editor's own preflight ran
  automatically and correctly reported `source_markers_missing`, but because
  the underlying editor-host process was instrumenting a different checkout
  than the one the target dev server was serving, no amount of re-running
  preflight could fix it — every click-to-edit escalated to TinTin instead of
  writing directly. The fix is same-tree verification before reuse, not a
  retry loop.
