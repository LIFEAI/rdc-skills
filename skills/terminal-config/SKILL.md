---
name: terminal-config
description: rdc:terminal-config (task) — read and safely modify Windows Terminal settings, shell profiles, and agent startup sequencing without rely...
---

> If dispatching subagents or running as a subagent: read `{PROJECT_ROOT}/.rdc/guides/agent-bootstrap.md` first (fallback: `.rdc/guides/agent-bootstrap.md`) — this is also where the global rdc-harness-use policy for create/open/build/deploy work lives.
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

### Programmatically launching a configured profile — use the GUID, not `-p "name"`

To actually launch (not edit) a named multi-word profile — e.g. to smoke-test a
launcher change live — pass the profile's **GUID**, not `-p "Claude WT"`. The
name form silently opened the *default* PowerShell profile instead when passed
through `Start-Process -ArgumentList` (no error, just the wrong profile) —
confirmed live 2026-08-20 chasing a Claude interactive-launcher TTY fix.
Read the GUID from `settings.json` first (profiles get added/removed), never
hardcode a remembered one:

```powershell
$guid = '{030efb20-4dba-4ec6-a8fd-dcedb53f97be}'   # e.g. "Claude WT" — read the real GUID, don't assume this one
Start-Process -FilePath 'wt.exe' -ArgumentList "-w -1 -p `"$guid`""
```

`-w -1` forces a genuinely new window instead of `-w 0` (reuse most-recently-used),
which hijacks whatever window the user currently has focused — disruptive if
they're watching it live. Verify the launch actually happened via a live
process-tree check (new `pwsh.exe`/`WindowsTerminal.exe` since the launch) and
the target script's own RdcRun log under `.logs/lifeai-env/<script>/<date>/` —
"the command returned no error" is not evidence it launched the right thing.

## Startup Scripts

If a project uses role/cell startup scripts, keep those scripts under the project root and commit them with the project. Do not bake one user's absolute machine paths into shared RDC skill files.
