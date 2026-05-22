---
name: rdc:terminal-config
description: "Usage `rdc:terminal-config <task>` — read and safely modify Windows Terminal settings, shell profiles, and agent startup sequencing without relying on machine-specific paths."
---

> **⚠️ OUTPUT CONTRACT (READ FIRST):** `guides/output-contract.md`
> Checklist-only output. No tool-call narration. No raw MCP/JSON/log dumps.
> One checklist upfront, updated in place, shown again at end with a 1-line verdict.

# rdc:terminal-config — Terminal & Agent Startup

## When to Use

- Before modifying Windows Terminal settings, shell profiles, keybindings, startup scripts, or agent launch commands.
- When setting up a Claude, Codex, or project-specific cell profile.
- When startup is broken because the wrong cwd, shell, env var, or prompt file is being loaded.

## Rules

1. Read the current settings file before editing.
2. Never change existing profile GUIDs unless the user explicitly wants a new profile identity.
3. Never remove intentionally null keybindings without explaining the consequence.
4. Validate JSON before saving.
5. Use environment-derived paths:
   - Terminal settings: `$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`
   - Claude user settings: `$env:USERPROFILE\.claude\settings.json`
   - Codex user config: `$env:USERPROFILE\.codex\config.toml`
   - Project startup scripts: `{PROJECT_ROOT}\scripts\...`

## Safe Edit Procedure

```
rdc:terminal-config: <task>
[ ] Current settings file located from environment
[ ] File read before edit
[ ] Existing GUIDs preserved
[ ] Null keybindings preserved or explicitly approved
[ ] JSON/TOML syntax validated
[ ] Startup command uses the intended shell, cwd, and project root
[ ] Verification command run
✅ rdc:terminal-config: <result>
```

## Windows Terminal Notes

- Prefer `pwsh.exe` for PowerShell 7 profiles.
- Keep `startingDirectory` explicit for project profiles.
- Use a newly generated GUID for each new profile:

```powershell
"{$([System.Guid]::NewGuid().ToString())}"
```

- Validate settings before restarting Terminal:

```powershell
Get-Content "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json" | ConvertFrom-Json
```

## Startup Scripts

If a project uses role/cell startup scripts, keep those scripts under the project root and commit them with the project. Do not bake one user's absolute machine paths into shared RDC skill files.
