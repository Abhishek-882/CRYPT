<#
.SYNOPSIS
    Automated Standalone Packaging Script for Indian Windows VPS Migration.
    Packages the entire AI-Hedge Cockpit, verified credentials vault, bot presets,
    and 1-click deployment automation into 'ai-hedge-cockpit-indian-vps.zip'.
#>

[CmdletBinding()]
param ()

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$ZipOutputPath = "$ProjectRoot\ai-hedge-cockpit-indian-vps.zip"
$DownloadsZipPath = "C:\Users\Administrator\Downloads\ai-hedge-cockpit-indian-vps.zip"
$StagingDir = "$env:TEMP\ai_hedge_indian_vps_staging"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "   PACKAGING STANDALONE AI-HEDGE COCKPIT FOR INDIAN WINDOWS VPS                 " -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# 1. Clean Staging Area
if (Test-Path $StagingDir) {
    Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

if (Test-Path $ZipOutputPath) {
    Remove-Item -Force $ZipOutputPath -ErrorAction SilentlyContinue
}

Write-Host "[1/5] Staging root deployment files..." -ForegroundColor Yellow

$rootFiles = @(
    "setup_indian_vps.ps1",
    "INDIAN_VPS_MIGRATION_GUIDE.md",
    "AI_ASSISTANT_INSTRUCTIONS.md",
    "ANTIGRAVITY_DEPLOY_PROMPT.md",
    "start_services.bat",
    "stop_services.bat",
    "restart_services.bat",
    "start_cloudflare_tunnel.bat",
    "package.json",
    "README.md",
    "MEMORY.md",
    "user_accounts_store.json",
    "bot_daemon_state.json",
    "bot_audit_log.json",
    ".vault_master_key"
)

foreach ($f in $rootFiles) {
    $src = "$ProjectRoot\$f"
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination "$StagingDir\$f" -Force
    }
}

# 2. Stage Scripts (excluding media/screenshots)
Write-Host "[2/5] Staging scripts and diagnostics..." -ForegroundColor Yellow
$stagingScripts = "$StagingDir\scripts"
New-Item -ItemType Directory -Path $stagingScripts -Force | Out-Null

Get-ChildItem -Path "$ProjectRoot\scripts" -File | Where-Object {
    $_.Extension -in @(".js", ".ps1", ".py", ".mjs", ".json", ".md") -and $_.Name -notmatch "screenshot|png|jpg"
} | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "$stagingScripts\$($_.Name)" -Force
}

# 3. Stage Web Application Source Code & Assets
Write-Host "[3/5] Staging Next.js web application (excluding node_modules and .next)..." -ForegroundColor Yellow
$stagingWeb = "$StagingDir\web"
New-Item -ItemType Directory -Path $stagingWeb -Force | Out-Null

$webFolders = @("app", "components", "lib", "public", "data")
foreach ($folder in $webFolders) {
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

# 4. Create ZIP Archive
Write-Host "[4/5] Compressing standalone distribution archive..." -ForegroundColor Yellow
Compress-Archive -Path "$StagingDir\*" -DestinationPath $ZipOutputPath -CompressionLevel Optimal

# Copy to Downloads folder as well for instant access
try {
    Copy-Item -Path $ZipOutputPath -Destination $DownloadsZipPath -Force
    Write-Host "  -> Mirrored package to: $DownloadsZipPath" -ForegroundColor Cyan
} catch {}

# 5. Cleanup Staging
Write-Host "[5/5] Cleaning up temporary staging directory..." -ForegroundColor Yellow
Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue

$zipSizeMb = [math]::Round((Get-Item $ZipOutputPath).Length / 1MB, 2)
Write-Host "`n================================================================================" -ForegroundColor Green
Write-Host "   PACKAGING SUCCESSFUL!                                                        " -ForegroundColor Green
Write-Host "   Archive: $ZipOutputPath ($zipSizeMb MB)                                      " -ForegroundColor Green
Write-Host "   Downloads Link: $DownloadsZipPath                                            " -ForegroundColor Green
Write-Host "================================================================================" -ForegroundColor Green
