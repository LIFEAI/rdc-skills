# Update rdc-skills plugin to latest version
# Windows PowerShell script

Write-Host "rdc-skills Updater" -ForegroundColor Cyan
Write-Host "=================" -ForegroundColor Cyan
Write-Host ""

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Get current version before pulling
$oldVersion = "unknown"
$pkgFile = Join-Path $repoRoot "package.json"
if (Test-Path $pkgFile) {
    $pkg = Get-Content $pkgFile | ConvertFrom-Json
    $oldVersion = $pkg.version
}

Write-Host "Current version: $oldVersion" -ForegroundColor Yellow

# Pull latest from git
Write-Host "Pulling latest from git..." -ForegroundColor Cyan
Push-Location $repoRoot
git fetch origin | Out-Null
git pull origin main --ff-only 2>&1 | ForEach-Object { Write-Host "  $_" }
Pop-Location

# Get new version after pulling
$newVersion = "unknown"
if (Test-Path $pkgFile) {
    $pkg = Get-Content $pkgFile | ConvertFrom-Json
    $newVersion = $pkg.version
}

Write-Host "New version: $newVersion" -ForegroundColor Green

if ($oldVersion -eq $newVersion) {
    Write-Host ""
    Write-Host "Already up to date." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Reinstalling..." -ForegroundColor Cyan
    & (Join-Path $repoRoot "scripts" "install.ps1")
}
