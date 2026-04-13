# Uninstall rdc-skills plugin from Claude Code
# Windows PowerShell script

param(
    [string]$claudeHome = $env:CLAUDE_HOME,
    [switch]$confirm = $false
)

# Detect CLAUDE_HOME if not provided
if (-not $claudeHome) {
    $claudeHome = Join-Path $env:USERPROFILE ".claude"
}

Write-Host "rdc-skills Uninstaller" -ForegroundColor Red
Write-Host "======================" -ForegroundColor Red
Write-Host ""

# Check CLAUDE_HOME exists
if (-not (Test-Path $claudeHome)) {
    Write-Host "CLAUDE_HOME does not exist or is empty: $claudeHome" -ForegroundColor Yellow
    exit 0
}

Write-Host "CLAUDE_HOME: $claudeHome" -ForegroundColor Cyan
Write-Host ""

# List what will be removed
$skillsDir = Join-Path $claudeHome "skills" "user"
$hooksDir = Join-Path $claudeHome "hooks"

$toDelete = @()

if (Test-Path $skillsDir) {
    $skills = Get-ChildItem -Path $skillsDir -Filter "rdc*.md" -ErrorAction SilentlyContinue
    foreach ($skill in $skills) {
        $toDelete += $skill.FullName
    }
}

if (Test-Path $hooksDir) {
    $hooks = Get-ChildItem -Path $hooksDir -Filter "*open-epics*" -ErrorAction SilentlyContinue
    foreach ($hook in $hooks) {
        $toDelete += $hook.FullName
    }
}

if ($toDelete.Count -eq 0) {
    Write-Host "No rdc-skills files found to remove." -ForegroundColor Yellow
    exit 0
}

Write-Host "Will remove the following files:" -ForegroundColor Yellow
foreach ($file in $toDelete) {
    Write-Host "  - $(Split-Path -Leaf $file)" -ForegroundColor DarkRed
}
Write-Host ""

# Confirm
if (-not $confirm) {
    $response = Read-Host "Continue? (y/N)"
    if ($response -ne 'y' -and $response -ne 'Y') {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 0
    }
}

# Remove files
foreach ($file in $toDelete) {
    Remove-Item -Path $file -Force -ErrorAction SilentlyContinue
    Write-Host "✓ Removed: $(Split-Path -Leaf $file)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Uninstall Complete" -ForegroundColor Green
Write-Host ""
Write-Host "Remaining guides and project overlays in docs/guides/ were NOT removed." -ForegroundColor Cyan
Write-Host "Delete them manually if desired." -ForegroundColor Cyan
