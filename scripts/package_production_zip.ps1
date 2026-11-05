<#
.SYNOPSIS
    Automated Production Packager for AI-Hedge Cockpit.
    Creates a clean, bloat-free 'ai-hedge-cockpit-production.zip' ready for instant sharing and deployment.
#>

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$ZipOutputPath = "$ProjectRoot\ai-hedge-cockpit-production.zip"
$StagingDir = "$env:TEMP\ai_hedge_cockpit_package_staging"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   PACKAGING CLEAN PRODUCTION ZIP FOR SHARING & SETUP     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Clean Staging Area
if (Test-Path $StagingDir) {
    Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

if (Test-Path $ZipOutputPath) {
    Remove-Item -Force $ZipOutputPath -ErrorAction SilentlyContinue
}

Write-Host "[1/4] Staging production assets (excluding node_modules, .git, repos)..." -ForegroundColor Yellow

# List of root files to copy
$rootFiles = @(
    "ANTIGRAVITY_DEPLOY_PROMPT.md",
    "setup_windows_vps.ps1",
    "verify_cockpit.ps1",
    "start_cockpit.bat",
    "stop_cockpit.bat",
    "README.md",
    "MEMORY.md",
    "package.json",
    "requirements.txt",
    "user_accounts_store.json",
    "bot_daemon_state.json",
    "bot_audit_log.json"
)

foreach ($f in $rootFiles) {
    $src = "$ProjectRoot\$f"
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination "$StagingDir\$f" -Force
    }
}

# Copy scripts directory (exclude __pycache__ and test media)
$stagingScripts = "$StagingDir\scripts"
New-Item -ItemType Directory -Path $stagingScripts -Force | Out-Null

Get-ChildItem -Path "$ProjectRoot\scripts" -File | Where-Object {
    $_.Extension -in @(".js", ".ps1", ".py", ".mjs", ".json")
} | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "$stagingScripts\$($_.Name)" -Force
}

# Copy web directory (excluding node_modules and .next)
Write-Host "[2/4] Copying web application source..." -ForegroundColor Yellow
$stagingWeb = "$StagingDir\web"
New-Item -ItemType Directory -Path $stagingWeb -Force | Out-Null

$webIncludeFolders = @("app", "components", "lib", "public", "data")
foreach ($folder in $webIncludeFolders) {
    $srcFolder = "$ProjectRoot\web\$folder"
    if (Test-Path $srcFolder) {
        Copy-Item -Path $srcFolder -Destination "$stagingWeb\$folder" -Recurse -Force
    }
}

$webFiles = @(
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tailwind.config.ts",
    "postcss.config.mjs",
    "next.config.mjs",
    "user_accounts_store.json",
    "bot_daemon_state.json",
    "bot_set_files.json",
    "bot_audit_log.json",
    ".vault_master_key"
)

foreach ($wf in $webFiles) {
    $src = "$ProjectRoot\web\$wf"
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination "$stagingWeb\$wf" -Force
    }
}

Write-Host "[3/4] Compressing into '$ZipOutputPath'..." -ForegroundColor Yellow
Compress-Archive -Path "$StagingDir\*" -DestinationPath $ZipOutputPath -CompressionLevel Optimal

# 4. Clean Staging Area
Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue

$zipSizeMb = [math]::Round((Get-Item $ZipOutputPath).Length / 1MB, 2)
Write-Host "[4/4] Package Created Successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Archive Path: $ZipOutputPath" -ForegroundColor Cyan
Write-Host " Archive Size: $zipSizeMb MB" -ForegroundColor Cyan
Write-Host " Ready for instant sharing and Antigravity setup!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
