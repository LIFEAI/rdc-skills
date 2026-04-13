# Install rdc-skills plugin to Claude Code
# Windows PowerShell script
#
# Usage:
#   ./install.ps1                  # standard install
#   ./install.ps1 -SkipHooks       # skip hooks registration (e.g. if you manage hooks manually)
#   ./install.ps1 -ClaudeHome <path>  # custom CLAUDE_HOME

param(
    [string]$ClaudeHome = "",
    [switch]$SkipHooks = $false,
    [switch]$Force = $false
)

# Detect CLAUDE_HOME
if (-not $ClaudeHome) {
    $ClaudeHome = Join-Path $env:USERPROFILE ".claude"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir

Write-Host ""
Write-Host "  rdc-skills Installer" -ForegroundColor Green
Write-Host "  ====================" -ForegroundColor Green
Write-Host ""
Write-Host "  CLAUDE_HOME : $ClaudeHome" -ForegroundColor Cyan
Write-Host "  Plugin root : $repoRoot" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $ClaudeHome)) {
    Write-Host "  ERROR: CLAUDE_HOME not found: $ClaudeHome" -ForegroundColor Red
    exit 1
}

# ── 1. Skills ────────────────────────────────────────────────────────────────

$skillsDir = Join-Path $ClaudeHome "skills" "user"
if (-not (Test-Path $skillsDir)) {
    New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
}

$srcSkills = Join-Path $repoRoot "skills"
$skillFiles = Get-ChildItem -Path $srcSkills -Filter "*.md" -ErrorAction SilentlyContinue
foreach ($f in $skillFiles) {
    Copy-Item -Path $f.FullName -Destination (Join-Path $skillsDir $f.Name) -Force
}
Write-Host "  [1/3] Skills      ✓  $($skillFiles.Count) file(s) → $skillsDir" -ForegroundColor Green

# ── 2. Hooks (files) ─────────────────────────────────────────────────────────

$hooksDir = Join-Path $ClaudeHome "hooks"
if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
}

$srcHooks  = Join-Path $repoRoot "hooks"
$hookFiles = Get-ChildItem -Path $srcHooks -Filter "*.js" -ErrorAction SilentlyContinue
foreach ($f in $hookFiles) {
    Copy-Item -Path $f.FullName -Destination (Join-Path $hooksDir $f.Name) -Force
}
Write-Host "  [2/3] Hook files  ✓  $($hookFiles.Count) file(s) → $hooksDir" -ForegroundColor Green

# ── 3. Register hooks in settings.json ───────────────────────────────────────

if ($SkipHooks) {
    Write-Host "  [3/3] Hook wiring ⏭  skipped (--SkipHooks)" -ForegroundColor DarkGray
} else {
    $settingsPath = Join-Path $ClaudeHome "settings.json"

    # Load existing settings (or start fresh)
    if (Test-Path $settingsPath) {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    } else {
        $settings = [PSCustomObject]@{}
    }

    # Build hooks block — all paths use forward slashes for cross-platform compat
    $hooksBase = $hooksDir.Replace("\", "/")

    $hooksConfig = [PSCustomObject]@{
        SessionStart = @(
            [PSCustomObject]@{
                hooks = @(
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/check-cwd.js`"" },
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/check-stale-work-items.js`""; statusMessage = "Checking for stale work items..." }
                )
            }
        )
        PreToolUse = @(
            [PSCustomObject]@{
                matcher = "Bash"
                hooks   = @(
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/require-work-item-on-commit.js`"" }
                )
            }
        )
        PostToolUse = @(
            [PSCustomObject]@{
                hooks = @(
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/check-services.js`"" }
                )
            }
        )
        PreCompact = @(
            [PSCustomObject]@{
                hooks = @(
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/precompact-log.js`"" }
                )
            }
        )
        PostCompact = @(
            [PSCustomObject]@{
                hooks = @(
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/postcompact-log.js`"" },
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/restart-brief.js`""; statusMessage = "Writing restart brief..." }
                )
            }
        )
        Stop = @(
            [PSCustomObject]@{
                hooks = @(
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/rate-limit-retry.js`""; statusMessage = "Checking for rate limits..." },
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/post-work-check.js`""; statusMessage = "Checking for undocumented work..." },
                    [PSCustomObject]@{ type = "command"; command = "node `"$hooksBase/no-stop-open-epics.js`""; statusMessage = "Checking for open epics..." }
                )
            }
        )
    }

    # Add/replace hooks key
    if ($settings.PSObject.Properties["hooks"]) {
        $settings.hooks = $hooksConfig
    } else {
        $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue $hooksConfig -Force
    }

    # Write back with 2-space indent
    $settings | ConvertTo-Json -Depth 20 | Set-Content $settingsPath -Encoding UTF8
    Write-Host "  [3/3] Hook wiring ✓  registered in $settingsPath" -ForegroundColor Green
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "  1. Create project overlay guides (required for project-specific context):"
Write-Host "     docs/guides/agent-bootstrap.md  ← credentials, git rules, Supabase ref"
Write-Host "     docs/guides/frontend.md          ← your design system rules"
Write-Host "     docs/guides/backend.md           ← your API/DB patterns"
Write-Host "     docs/guides/data.md              ← your migration patterns"
Write-Host ""
Write-Host "  2. Use rdc-skills/guides/*.md as starting-point templates"
Write-Host ""
Write-Host "  3. Restart Claude Code so hook changes take effect"
Write-Host ""
Write-Host "  4. Run /rdc:status in Claude Code to verify"
Write-Host ""
Write-Host "  Docs: https://github.com/LIFEAI/rdc-skills#readme" -ForegroundColor Cyan
Write-Host ""
