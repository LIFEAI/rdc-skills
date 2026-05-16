---
name: rdc:terminal-config
description: "Usage `rdc:terminal-config <task>` — read and safely modify Windows Terminal settings and cell startup sequencing. Contains canonical file locations, profile GUIDs, keybinding map, and what NEVER to change."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:terminal-config — Windows Terminal & Cell Startup Reference

## When to Use
- Before modifying any terminal setting, profile, or keybinding
- When setting up a new profile (Claude, Codex, cell cells)
- When cell startup is broken (wrong `--append-system-prompt`, wrong cwd, wrong CELL_ROLE)
- When keybindings conflict or are missing

## ⛔ ABSOLUTE RULES — READ BEFORE TOUCHING ANYTHING

1. **NEVER change profile GUIDs** — Windows Terminal uses these as identity. Changing a GUID orphans all pinned shortcuts and window layouts.
2. **NEVER remove `"id": null` keybinding entries** — these intentionally UNBIND enter/shift-enter/ctrl-enter so Claude Code's interactive prompt works without the terminal swallowing keystrokes.
3. **NEVER change `firstWindowPreference`** — it's `persistedWindowLayout`, which restores Dave's exact pane/tab layout on restart.
4. **NEVER change `defaultProfile`** — it's `{574e775e-...}` (PowerShell Core). Changing it breaks new-tab behavior.
5. **ALWAYS read the file before editing** — never write from memory.
6. **ALWAYS validate JSON** before saving — a syntax error silently resets all settings on next Terminal launch (no error shown, settings wiped).

---

## File Locations

| File | Path | Purpose |
|------|------|---------|
| **Terminal settings** | `C:\Users\DaveLadouceur\AppData\Local\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json` | Main config — profiles, keybindings, color schemes |
| **Cell init script** | `C:\Dev\regen-root\scripts\cell-init.ps1` | Launched by each cell profile (PowerShell 7). Sets CELL_ROLE, prints banner, runs `claude --append-system-prompt` |
| **Cell state dir** | `C:\Dev\regen-root\.cell-state\` | PID lockfiles per cell (`sv.lock`, `cell-portal.lock`, etc.) |
| **Claude keybindings** | `C:\Users\DaveLadouceur\.claude\keybindings.json` | Claude Code keybindings (separate from Terminal) |
| **Claude settings** | `C:\Dev\regen-root\.claude\settings.json` | Project-level Claude Code settings, hooks, permissions |
| **Claude user settings** | `C:\Users\DaveLadouceur\.claude\settings.json` | User-level Claude Code settings |

---

## Profile Inventory

Every profile has a fixed GUID. Do not change them.

| GUID | Name | Tab Color | Purpose |
|------|------|-----------|---------|
| `{574e775e-4f2a-5b96-ac1e-a2962a402336}` | PowerShell | — | **Default profile** — PowerShell 7 Core |
| `{e7c1128b-e51f-4eba-bcdb-85f550c31b97}` | SV | `#1A6B3C` (green) | Supervisor cell — full repo access, runs `cell-init.ps1 sv` |
| `{190a2f39-f6ad-4638-8fef-e4c7aa58c349}` | Claude | `#B91C1C` (red) | Claude conversation cell, runs `cell-init.ps1 sv` |
| `{2d0248ef-7bb7-4b9e-b381-c4aa1f570f49}` | Codex | `#0F766E` (teal) | Codex AI cell — runs `pwsh.exe -NoLogo -NoExit -Command codex` |
| `{767642b0-606c-468c-89a0-4573df6fcdaf}` | VS Code | `#2D5986` (blue) | Launches `code-safe C:\Dev\regen-root` |
| `{6cbd327a-5b5e-4e83-96f6-041615382d36}` | PowerShell (Admin) | `#1E3A5F` (dark blue) | Elevated PowerShell — uses `LIFEAI Slate` color scheme |
| `{0caa0dad-35be-5f56-a8ff-afceeeaa6101}` | Command Prompt | — | Legacy CMD — visible but rarely used |
| `{574e775e...}` and others | `hidden: true` | — | Windows PowerShell, Azure Shell, VS DevTools — all hidden |

### Profile commandlines

```
SV / Claude:   pwsh.exe -NoLogo -NoExit -ExecutionPolicy Bypass -File "C:\Dev\regen-root\scripts\cell-init.ps1" sv
Codex:         pwsh.exe -NoLogo -NoExit -Command codex
VS Code:       cmd.exe /c start "" code-safe C:\Dev\regen-root
Admin PS:      powershell.exe -NoLogo   (+ elevate: true)
```

All cell profiles set `"startingDirectory": "C:\\Dev\\regen-root"`.
SV / Claude / Codex all run on **PowerShell 7 (`pwsh.exe`)** — never bare `powershell.exe` (that resolves to legacy Windows PowerShell 5.1).

---

## Keybinding Map

### Critical: intentionally unbound keys (never restore these)

```json
{ "id": null, "keys": "shift+enter" }
{ "id": null, "keys": "ctrl+enter" }
{ "id": null, "keys": "enter" }
```

**Why:** Without these null bindings, Windows Terminal intercepts Enter/Shift-Enter/Ctrl-Enter before Claude Code's interactive prompt sees them. Sessions break silently.

### Pane navigation (safe to change)

| Keys | Action |
|------|--------|
| `ctrl+alt+v` | Split pane right (duplicate) |
| `ctrl+alt+h` | Split pane down (duplicate) |
| `ctrl+alt+left/right/up/down` | Move focus between panes |
| `ctrl+alt+shift+left/right` | Resize pane |
| `ctrl+shift+z` | Toggle pane zoom |
| `ctrl+shift+w` | Close pane |
| `alt+shift+d` | Split pane auto (duplicate) |

### Standard overrides

| Keys | Action |
|------|--------|
| `ctrl+c` | Copy (singleLine: false) |
| `ctrl+v` | Paste |
| `ctrl+shift+f` | Find |

---

## Color Schemes

Four custom schemes live in the `schemes` array. Do not rename them — profiles reference by name.

| Name | Background | Used by |
|------|-----------|---------|
| `Dimidium` | `#282A36` (dark purple) | Default for all cell profiles |
| `LIFEAI Claude` | `#1A0F0A` (dark brown) | Available, not currently assigned |
| `LIFEAI Dark` | `#0D1F17` (dark green) | Available, not currently assigned |
| `LIFEAI Slate` | `#0F1923` (dark blue) | PowerShell Admin profile |
| `Dracula` | `#282A36` | Available, not currently assigned |

---

## Global Settings (safe reference)

```json
"copyOnSelect": true          // highlight = copied. Don't change — muscle memory.
"copyFormatting": "all"       // preserves ANSI colors on copy
"firstWindowPreference": "persistedWindowLayout"  // restores last layout on open. NEVER CHANGE.
"defaultProfile": "{574e775e-4f2a-5b96-ac1e-a2962a402336}"  // PowerShell Core. NEVER CHANGE.
"theme": "dark"
"showTabsFullscreen": true
"initialRows": 40
```

Font defaults (in `profiles.defaults`):
```json
"face": "Consolas"
"size": 12
"cellHeight": "1.2"
"cellWidth": "0.6"
"weight": "normal"
```

---

## Cell Startup Sequencing

`cell-init.ps1` is the PowerShell 7 startup script for all cell profiles. It:

1. Accepts `Role` arg (`sv`, `cell-portal`, `cell-data`, `cell-cs2`, `cell-mktg`, `cell-infra`, `specialist`)
2. Looks up `Label`, `Color`, `Scope`, `Paths`, `Prompt` from the `$roles` hashtable
3. Prints a colored banner
4. Writes a PID lockfile to `.cell-state\<role>.lock`
5. Runs `git log` filtered to that cell's path scope
6. Launches: `claude --append-system-prompt "<Prompt>"`

### Cell role → prompt scope mapping

| Role arg | Claude system prompt |
|----------|---------------------|
| `sv` | "You are the SUPERVISOR cell. You have full repo access. Coordinate across all packages and apps." |
| `cell-portal` | Portal cell — frontend apps only (apps/prt, apps/rdc, packages/ui, models/) |
| `cell-data` | Data cell — packages/supabase, virtue-engine, pal, hail, daf-intelligence |
| `cell-cs2` | CS2 cell — packages/cs2, quad-pixel, planetary-ontology, models/ |
| `cell-mktg` | Marketing cell — rdc-marketing-engine, canvas, sites/, email-templates |
| `cell-infra` | Infra cell — Coolify, CI/CD, root config, scripts/ |
| `specialist` | Specialist cell — repo-wide reviews, cleanup, docs, audits |

---

## Safe Edit Procedure

### When adding or modifying a profile

1. Read the current file first (never edit from memory)
2. Generate a new GUID with: `[System.Guid]::NewGuid().ToString('B')` (PowerShell) — wrap in `{}`
3. Copy the SV profile as a template
4. Set `commandline`, `startingDirectory`, `environment`, `tabColor`, `icon`, `name`
5. Do NOT set `guid` to an existing value
6. Validate JSON: `Get-Content settings.json | ConvertFrom-Json` (errors = syntax problem)
7. Save and reopen Terminal to verify

### When adding a keybinding

1. Add to the `keybindings` array
2. Check for conflicts with the null-bound keys (`enter`, `shift+enter`, `ctrl+enter`) — NEVER override them
3. Validate JSON before saving

### When editing cell startup

Edit `C:\Dev\regen-root\scripts\cell-init.ps1` — it's in the repo, so changes are tracked.
- Adding a new role: add a new entry to the `$roles` hashtable with all five keys (`Label`, `Color`, `Scope`, `Paths`, `Prompt`)
- Changing scope: update `Paths` and `Prompt` only — don't touch banner/lockfile/git logic

---

## Validation Commands

```powershell
# Validate JSON syntax before saving
Get-Content "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json" | ConvertFrom-Json

# Check cell lockfiles
Get-Content C:\Dev\regen-root\.cell-state\sv.lock

# Generate a new GUID for a profile
"{$([System.Guid]::NewGuid().ToString())}"
```

---

## WezTerm Alternative

If Windows Terminal settings keep getting corrupted or misedited, **WezTerm** is the recommended migration:
- Config is a Lua file (`~/.wezterm.lua` or `C:\Users\<user>\.config\wezterm\wezterm.lua`)
- Committed to git — every change is a reviewable diff, not an opaque JSON blob
- Startup layouts (tabs, panes, commands) are defined programmatically
- Equivalent to current setup: `wezterm.mux.spawn_window()` per cell with `args` set to `pwsh.exe -NoLogo -NoExit -File cell-init.ps1 <role>`
- Download: https://wezfurlong.org/wezterm/installation.html

Migration path: copy existing color schemes as `wezterm.color.get_default_colors()` override tables, map keybindings to `config.keys` array, define tab bar with cell roles.
