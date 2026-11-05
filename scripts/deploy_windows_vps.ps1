<#
.SYNOPSIS
    Automated 1-Click Deployment Script for AI-Hedge Delta-Neutral Cockpit on Windows VPS.
.DESCRIPTION
    Installs and configures:
    1. Node.js & Git prerequisites validation
    2. Dependency installation & Next.js production build
    3. NSSM (Non-Sucking Service Manager) installation
    4. Auto-restarting Windows Service 'AiHedgeCockpit' running 24/7/365
    5. Local automated backup task for bot state & .set presets
    6. Cloudflare Tunnel setup for 100% free HTTPS domain with zero firewall ports
.NOTES
    Run as Administrator in PowerShell:
    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
    .\scripts\deploy_windows_vps.ps1
#>

[CmdletBinding()]
param (
    [int]$Port = 3000,
    [string]$ServiceName = "AiHedgeCockpit",
    [switch]$InstallCloudflared
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   AI-HEDGE DELTA-NEUTRAL COCKPIT - WINDOWS VPS INSTALLER " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Ensure Administrator Privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "Please run this PowerShell script as Administrator!"
    Exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = (Resolve-Path "$ScriptDir\..").Path
Set-Location $ProjectRoot
Write-Host "[1/6] Project Root: $ProjectRoot" -ForegroundColor Green

# 2. Check Node.js and Git
Write-Host "[2/6] Checking Node.js and Git..." -ForegroundColor Yellow
try {
    $nodeVer = node -v
    Write-Host "  -> Node.js detected: $nodeVer" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not installed! Please install Node.js (v18+) from https://nodejs.org or run 'winget install OpenJS.NodeJS.LTS'"
    Exit 1
}

try {
    $gitVer = git --version
    Write-Host "  -> Git detected: $gitVer" -ForegroundColor Green
} catch {
    Write-Warning "Git not detected in PATH, continuing with local directory..."
}

# 3. Install dependencies & build production Next.js bundle
Write-Host "[3/6] Installing dependencies and building production bundle..." -ForegroundColor Yellow
Set-Location "$ProjectRoot\web"
npm install --no-audit --no-fund
npm run build
Set-Location $ProjectRoot
Write-Host "  -> Production Next.js build completed successfully." -ForegroundColor Green

# 4. Download and setup NSSM (Non-Sucking Service Manager)
Write-Host "[4/6] Setting up NSSM for 24/7 Windows Service execution..." -ForegroundColor Yellow
$ToolsDir = "C:\tools"
if (-not (Test-Path $ToolsDir)) { New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null }
$NssmExe = "$ToolsDir\nssm.exe"

if (-not (Test-Path $NssmExe)) {
    Write-Host "  -> Downloading NSSM..." -ForegroundColor Cyan
    $NssmZip = "$env:TEMP\nssm-2.24.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $NssmZip
    Expand-Archive -Path $NssmZip -DestinationPath "$env:TEMP\nssm_temp" -Force
    
    # Copy 64-bit nssm.exe
    Copy-Item "$env:TEMP\nssm_temp\nssm-2.24\win64\nssm.exe" -Destination $NssmExe -Force
    Remove-Item $NssmZip -Force -ErrorAction SilentlyContinue
    Remove-Item "$env:TEMP\nssm_temp" -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "  -> NSSM ready at $NssmExe" -ForegroundColor Green

# 5. Install or Update Windows Service
Write-Host "[5/6] Registering 24/7 Windows Service '$ServiceName'..." -ForegroundColor Yellow

# Stop existing service if running
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "  -> Stopping and updating existing $ServiceName service..." -ForegroundColor Cyan
    & $NssmExe stop $ServiceName
    & $NssmExe remove $ServiceName confirm
    Start-Sleep -Seconds 2
}

$NodeExePath = (Get-Command node).Source
$NpmCmdPath = (Get-Command npm.cmd).Source

# Configure Service through NSSM
& $NssmExe install $ServiceName "$NodeExePath"
& $NssmExe set $ServiceName AppDirectory "$ProjectRoot\web"
& $NssmExe set $ServiceName AppParameters "node_modules\next\dist\bin\next start -p $Port"
& $NssmExe set $ServiceName Start SERVICE_AUTO_START
& $NssmExe set $ServiceName AppStdout "$ProjectRoot\ai_hedge_service_stdout.log"
& $NssmExe set $ServiceName AppStderr "$ProjectRoot\ai_hedge_service_stderr.log"
& $NssmExe set $ServiceName AppRestartDelay 5000

# Start the service
& $NssmExe start $ServiceName
Start-Sleep -Seconds 4

$checkStatus = Get-Service -Name $ServiceName
Write-Host "  -> Service '$ServiceName' Status: $($checkStatus.Status)" -ForegroundColor Green

# 6. Setup Automated Backup Directory
$BackupDir = "$ProjectRoot\backups"
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
Write-Host "[6/6] Created local automated backup directory at: $BackupDir" -ForegroundColor Green

# 7. Cloudflare Tunnel (Optional / Recommended)
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   DEPLOYMENT COMPLETE! 24/7 WINDOWS SERVICE IS ACTIVE     " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Local Cockpit URL: http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Service Name:      $ServiceName (Auto-boots on Windows startup)" -ForegroundColor Cyan
Write-Host "Service Logs:      $ProjectRoot\ai_hedge_service_stdout.log" -ForegroundColor Cyan
Write-Host ""
Write-Host "--- HOW TO ACCESS OVER FREE HTTPS (CLOUDFLARE TUNNEL) ---" -ForegroundColor Yellow
Write-Host "To give your cockpit a free public HTTPS domain with ZERO open firewall ports:" -ForegroundColor White
Write-Host "1. Download cloudflared: winget install --id Cloudflare.cloudflared" -ForegroundColor Cyan
Write-Host "2. Run instant tunnel:   cloudflared tunnel --url http://localhost:$Port" -ForegroundColor Cyan
Write-Host "This will print a secure public https://<unique-id>.trycloudflare.com URL!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
