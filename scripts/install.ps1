# Install rdc-skills plugin to Claude Code
# Windows PowerShell script

param(
    [string]$claudeHome = $env:CLAUDE_HOME,
    [switch]$force = $false
)

# Detect CLAUDE_HOME if not provided
if (-not $claudeHome) {
    $claudeHome = Join-Path $env:USERPROFILE ".claude"
}

# Resolve script location
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Write-Host "rdc-skills Installer" -ForegroundColor Green
Write-Host "===================" -ForegroundColor Green
Write-Host ""

# Check CLAUDE_HOME exists
if (-not (Test-Path $claudeHome)) {
    Write-Host "ERROR: CLAUDE_HOME does not exist: $claudeHome" -ForegroundColor Red
    Write-Host "       Create it first: mkdir `"$claudeHome`"" -ForegroundColor Yellow
    exit 1
}

Write-Host "CLAUDE_HOME: $claudeHome" -ForegroundColor Cyan

# Create skills directory
$skillsDir = Join-Path $claudeHome "skills" "user"
if (-not (Test-Path $skillsDir)) {
    New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
    Write-Host "✓ Created skills directory: $skillsDir" -ForegroundColor Green
} else {
    Write-Host "✓ Skills directory exists: $skillsDir" -ForegroundColor Green
}

# Copy skills
$srcSkills = Join-Path $repoRoot "skills"
if (Test-Path $srcSkills) {
    $skillFiles = Get-ChildItem -Path $srcSkills -Filter "*.md" -ErrorAction SilentlyContinue
    foreach ($file in $skillFiles) {
        $dest = Join-Path $skillsDir $file.Name
        Copy-Item -Path $file.FullName -Destination $dest -Force
        Write-Host "  → $($file.Name)" -ForegroundColor DarkGreen
    }
    if ($skillFiles.Count -eq 0) {
        Write-Host "  (no skills yet — guides to be added by WP2 agent)" -ForegroundColor DarkGray
    } else {
        Write-Host "  ✓ Copied $($skillFiles.Count) skill(s)" -ForegroundColor Green
    }
}

# Create hooks directory
$hooksDir = Join-Path $claudeHome "hooks"
if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
    Write-Host "✓ Created hooks directory: $hooksDir" -ForegroundColor Green
} else {
    Write-Host "✓ Hooks directory exists: $hooksDir" -ForegroundColor Green
}

# Copy hooks
$srcHooks = Join-Path $repoRoot "hooks"
$hookFiles = Get-ChildItem -Path $srcHooks -Filter "*.js" -ErrorAction SilentlyContinue
foreach ($file in $hookFiles) {
    $dest = Join-Path $hooksDir $file.Name
    Copy-Item -Path $file.FullName -Destination $dest -Force
    Write-Host "  → $($file.Name)" -ForegroundColor DarkGreen
}
if ($hookFiles.Count -gt 0) {
    Write-Host "  ✓ Copied $($hookFiles.Count) hook(s)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Installation Complete" -ForegroundColor Green
Write-Host "=====================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Create project-specific guides in your codebase:"
Write-Host "   - docs/guides/agent-bootstrap.md (required — credentials, git rules)"
Write-Host "   - docs/guides/frontend.md (if building UI)"
Write-Host "   - docs/guides/backend.md (if building APIs)"
Write-Host "   - docs/guides/data.md (if doing DB work)"
Write-Host ""
Write-Host "2. Use rdc-skills/guides/*.md as starting point templates for your project overlays"
Write-Host ""
Write-Host "3. Run /rdc:status in Claude Code to verify setup"
Write-Host ""
Write-Host "For help: https://github.com/LIFEAI/rdc-skills#readme" -ForegroundColor Cyan
