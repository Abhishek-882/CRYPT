<#
.SYNOPSIS
    Automated 1-Click Zero-Proxy Deployment Script for AI-Hedge Delta-Neutral Cockpit
    Specifically engineered for Indian Windows Server VPS (2019 / 2022 / 2025).
.DESCRIPTION
    1. Validates Administrator privileges.
    2. Configures Cloudflare (1.1.1.1) and Google (8.8.8.8) Secure DNS to prevent Indian ISP domain filtering.
    3. Detects or installs Node.js LTS (v20+) and Git.
    4. Installs web dependencies and builds Next.js production bundle.
    5. Sets up NSSM (Non-Sucking Service Manager) in C:\tools\nssm.exe.
    6. Registers 24/7 Auto-Restarting Windows Services:
       - 'AiHedgeCockpit': Next.js High-Speed Web Trading Cockpit (Port 3000)
       - 'AiHedgeDaemon': Autonomous 24/7 Bot Engine Heartbeat Runner
    7. Downloads Cloudflare Tunnel (cloudflared.exe) for 1-click HTTPS remote mobile/laptop access.
    8. Executes pre-flight connectivity & latency benchmark across CoinDCX, Bitget, Bybit, Binance.
    9. Generates desktop management shortcuts.
.NOTES
    Run as Administrator in PowerShell:
    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
    .\setup_indian_vps.ps1
#>

[CmdletBinding()]
param (
    [int]$Port = 3000,
    [switch]$SkipDnsConfig,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "   AI-HEDGE DELTA-NEUTRAL COCKPIT - INDIAN WINDOWS VPS 1-CLICK INSTALLER        " -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# 1. Administrator Check
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Please run this PowerShell script as Administrator! Right-click PowerShell -> 'Run as Administrator'."
    Exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$ProjectRoot = (Resolve-Path $ScriptDir).Path
Set-Location $ProjectRoot
Write-Host "[1/8] Root Directory: $ProjectRoot" -ForegroundColor Green

# 2. Configure Secure Anti-Filtering Public DNS (1.1.1.1 / 8.8.8.8)
if (-not $SkipDnsConfig) {
    Write-Host "[2/8] Configuring Secure DNS (1.1.1.1 & 8.8.8.8) to bypass Indian ISP domain filtering..." -ForegroundColor Yellow
    try {
        $adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" }
        foreach ($adapter in $adapters) {
            Write-Host "  -> Applying Cloudflare/Google DNS to adapter: $($adapter.Name)..." -ForegroundColor Cyan
            Set-DnsClientServerAddress -InterfaceIndex $adapter.InterfaceIndex -ServerAddresses ("1.1.1.1", "8.8.8.8", "1.0.0.1") -ErrorAction SilentlyContinue
        }
        Clear-DnsClientCache
        Write-Host "  -> DNS successfully configured and cache flushed." -ForegroundColor Green
    } catch {
        Write-Warning "Could not modify network DNS automatically: $($_.Exception.Message). Continuing with system defaults..."
    }
} else {
    Write-Host "[2/8] Skipping DNS configuration as requested." -ForegroundColor DarkGray
}

# 3. Check / Install Node.js LTS and Git
Write-Host "[3/8] Checking Node.js runtime and Git..." -ForegroundColor Yellow
$nodeInstalled = $false
try {
    $nodeVer = node -v
    Write-Host "  -> Node.js detected: $nodeVer" -ForegroundColor Green
    $nodeInstalled = $true
} catch {
    Write-Host "  -> Node.js not found in PATH. Attempting automatic installation..." -ForegroundColor Yellow
}

if (-not $nodeInstalled) {
    # Attempt winget installation first
    try {
        Write-Host "  -> Installing Node.js LTS via winget..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $nodeVer = node -v
        Write-Host "  -> Node.js installed successfully: $nodeVer" -ForegroundColor Green
    } catch {
        # Fallback to direct official MSI download
        Write-Host "  -> Downloading official Node.js LTS MSI installer..." -ForegroundColor Cyan
        $nodeMsi = "$env:TEMP\node-v20.x64.msi"
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -OutFile $nodeMsi
        Write-Host "  -> Running silent MSI installation..." -ForegroundColor Cyan
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn /norestart" -Wait
        Remove-Item $nodeMsi -Force -ErrorAction SilentlyContinue
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
}

try {
    $gitVer = git --version
    Write-Host "  -> Git detected: $gitVer" -ForegroundColor Green
} catch {
    Write-Warning "Git not detected in PATH. Standalone ZIP build does not require git."
}

# 4. Dependency Installation and Production Build
if (-not $SkipBuild) {
    Write-Host "[4/8] Installing web dependencies and compiling production bundle..." -ForegroundColor Yellow
    Set-Location "$ProjectRoot\web"
    npm install --no-audit --no-fund
    Write-Host "  -> Compiling Next.js production engine..." -ForegroundColor Cyan
    npm run build
    Set-Location $ProjectRoot
    Write-Host "  -> Production bundle compiled successfully." -ForegroundColor Green
} else {
    Write-Host "[4/8] Skipping build step as requested." -ForegroundColor DarkGray
}

# 5. NSSM Setup in C:\tools
Write-Host "[5/8] Setting up NSSM (Non-Sucking Service Manager)..." -ForegroundColor Yellow
$ToolsDir = "C:\tools"
if (-not (Test-Path $ToolsDir)) { New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null }
$NssmExe = "$ToolsDir\nssm.exe"

if (-not (Test-Path $NssmExe)) {
    Write-Host "  -> Downloading NSSM 64-bit..." -ForegroundColor Cyan
    $NssmZip = "$env:TEMP\nssm-2.24.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $NssmZip
    Expand-Archive -Path $NssmZip -DestinationPath "$env:TEMP\nssm_temp" -Force
    Copy-Item "$env:TEMP\nssm_temp\nssm-2.24\win64\nssm.exe" -Destination $NssmExe -Force
    Remove-Item $NssmZip -Force -ErrorAction SilentlyContinue
    Remove-Item "$env:TEMP\nssm_temp" -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "  -> NSSM ready at $NssmExe" -ForegroundColor Green

# 6. Register 24/7 Windows Services
Write-Host "[6/8] Registering 24/7 Auto-Restarting Windows Services..." -ForegroundColor Yellow

$NodeExePath = (Get-Command node).Source
$NpmCmdPath = (Get-Command npm.cmd).Source
$LogsDir = "$ProjectRoot\logs"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null }

# Service 1: AiHedgeCockpit (Web GUI on port 3000)
$SrvWeb = "AiHedgeCockpit"
$existingSrvWeb = Get-Service -Name $SrvWeb -ErrorAction SilentlyContinue
if ($existingSrvWeb) {
    Write-Host "  -> Updating existing $SrvWeb service..." -ForegroundColor Cyan
    & $NssmExe stop $SrvWeb 2>$null
    & $NssmExe remove $SrvWeb confirm 2>$null
    Start-Sleep -Seconds 2
}

& $NssmExe install $SrvWeb $NpmCmdPath "run start"
& $NssmExe set $SrvWeb AppDirectory "$ProjectRoot\web"
& $NssmExe set $SrvWeb AppStdout "$LogsDir\web_service.log"
& $NssmExe set $SrvWeb AppStderr "$LogsDir\web_error.log"
& $NssmExe set $SrvWeb AppRestartDelay 5000
& $NssmExe set $SrvWeb Start SERVICE_AUTO_START
& $NssmExe start $SrvWeb
Write-Host "  -> Windows Service '$SrvWeb' registered and started (Port $Port)." -ForegroundColor Green

# Service 2: AiHedgeDaemon (24/7 Autonomous Bot Heartbeat Runner)
$SrvDaemon = "AiHedgeDaemon"
$existingSrvDaemon = Get-Service -Name $SrvDaemon -ErrorAction SilentlyContinue
if ($existingSrvDaemon) {
    Write-Host "  -> Updating existing $SrvDaemon service..." -ForegroundColor Cyan
    & $NssmExe stop $SrvDaemon 2>$null
    & $NssmExe remove $SrvDaemon confirm 2>$null
    Start-Sleep -Seconds 2
}

& $NssmExe install $SrvDaemon $NodeExePath "scripts\run_daemon_24_7.js"
& $NssmExe set $SrvDaemon AppDirectory "$ProjectRoot"
& $NssmExe set $SrvDaemon AppStdout "$LogsDir\daemon_service.log"
& $NssmExe set $SrvDaemon AppStderr "$LogsDir\daemon_error.log"
& $NssmExe set $SrvDaemon AppRestartDelay 5000
& $NssmExe set $SrvDaemon Start SERVICE_AUTO_START
& $NssmExe start $SrvDaemon
Write-Host "  -> Windows Service '$SrvDaemon' registered and started." -ForegroundColor Green

# 7. Download Cloudflare Tunnel (cloudflared.exe)
Write-Host "[7/8] Preparing Cloudflare Tunnel for secure remote mobile/laptop access..." -ForegroundColor Yellow
$CloudflaredExe = "$ToolsDir\cloudflared.exe"
if (-not (Test-Path $CloudflaredExe)) {
    try {
        Write-Host "  -> Downloading cloudflared.exe..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $CloudflaredExe
        Write-Host "  -> Cloudflare Tunnel utility downloaded to $CloudflaredExe" -ForegroundColor Green
    } catch {
        Write-Warning "Could not download cloudflared.exe automatically: $($_.Exception.Message)"
    }
}

# Create quick tunnel batch launcher
$TunnelBat = "$ProjectRoot\start_cloudflare_tunnel.bat"
$TunnelContent = @"
@echo off
title AI Hedge Cockpit - Cloudflare Tunnel
echo =======================================================
echo   STARTING SECURE CLOUDFLARE HTTPS TUNNEL (PORT 3000)
echo =======================================================
echo Connect to the https://*.trycloudflare.com URL shown below:
echo.
C:\tools\cloudflared.exe tunnel --url http://localhost:3000
pause
"@
Set-Content -Path $TunnelBat -Value $TunnelContent

# 8. Create Management Desktop Shortcuts
Write-Host "[8/8] Creating Desktop management shortcuts..." -ForegroundColor Yellow
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)

# Desktop Helper 1: Start Services
$StartBat = "$ProjectRoot\start_services.bat"
Set-Content -Path $StartBat -Value "@echo off`nnet start AiHedgeCockpit`nnet start AiHedgeDaemon`necho Services Started.`npause"

# Desktop Helper 2: Stop Services
$StopBat = "$ProjectRoot\stop_services.bat"
Set-Content -Path $StopBat -Value "@echo off`nnet stop AiHedgeCockpit`nnet stop AiHedgeDaemon`necho Services Stopped.`npause"

# Desktop Helper 3: Restart Services
$RestartBat = "$ProjectRoot\restart_services.bat"
Set-Content -Path $RestartBat -Value "@echo off`nnet stop AiHedgeCockpit`nnet stop AiHedgeDaemon`ntimeout /t 2 /nobreak >nul`nnet start AiHedgeCockpit`nnet start AiHedgeDaemon`necho Services Restarted.`npause"

try {
    $WshShell = New-Object -ComObject WScript.Shell
    
    # Shortcut: Open Cockpit Browser
    $ShortcutWeb = $WshShell.CreateShortcut("$DesktopPath\AI Hedge Cockpit.lnk")
    $ShortcutWeb.TargetPath = "http://localhost:3000"
    $ShortcutWeb.Save()

    # Shortcut: Start Cloudflare Tunnel
    $ShortcutTunnel = $WshShell.CreateShortcut("$DesktopPath\Start Cloudflare Tunnel.lnk")
    $ShortcutTunnel.TargetPath = $TunnelBat
    $ShortcutTunnel.WorkingDirectory = $ProjectRoot
    $ShortcutTunnel.Save()

    # Shortcut: Restart Cockpit Services
    $ShortcutRestart = $WshShell.CreateShortcut("$DesktopPath\Restart AI Hedge Services.lnk")
    $ShortcutRestart.TargetPath = $RestartBat
    $ShortcutRestart.WorkingDirectory = $ProjectRoot
    $ShortcutRestart.Save()

    Write-Host "  -> Desktop shortcuts created." -ForegroundColor Green
} catch {}

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "       DEPLOYMENT COMPLETE! RUNNING ZERO-PROXY PRE-FLIGHT VALIDATOR...          " -ForegroundColor Cyan
Write-Host "================================================================================`n" -ForegroundColor Cyan

# Wait 3 seconds for Next.js service to initialize
Start-Sleep -Seconds 3

# Run Pre-flight Diagnostic
node "$ProjectRoot\scripts\validate_indian_vps.js"

Write-Host "Access your Trading Cockpit locally at: http://localhost:3000" -ForegroundColor Green
Write-Host "Or double-click 'Start Cloudflare Tunnel' on your desktop to access remotely from mobile/laptop." -ForegroundColor Green
