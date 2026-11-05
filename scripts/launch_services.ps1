# AI Hedge Cockpit Service Launcher
$ErrorActionPreference = "Continue"

$cockpitDir = "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit"
$webDir = "$cockpitDir\web"
$logsDir = "$cockpitDir\logs"

if (!(Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

# 1. Start Web Platform
Write-Host "Starting Web Platform (Next.js port 3000)..."
$webProc = Start-Process -FilePath "node.exe" `
    -ArgumentList "node_modules\next\dist\bin\next", "start", "-p", "3000" `
    -WorkingDirectory $webDir `
    -RedirectStandardOutput "$logsDir\web_service.log" `
    -RedirectStandardError "$logsDir\web_error.log" `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Web Platform started with PID: $($webProc.Id)"

# 2. Wait for Web service port 3000 to become active
Write-Host "Waiting for port 3000 to listen..."
$maxAttempts = 30
$attempt = 0
$listening = $false

while ($attempt -lt $maxAttempts) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $listening = $true
        Write-Host "Port 3000 is listening! (PID: $($conn[0].OwningProcess))"
        break
    }
    $attempt++
}

if (-not $listening) {
    Write-Error "Web platform failed to listen on port 3000 within 30 seconds."
    Get-Content "$logsDir\web_error.log" -ErrorAction SilentlyContinue
}

# 3. Start 24/7 Autonomous Bot Daemon
Write-Host "Starting 24/7 Autonomous Bot Daemon..."
$daemonProc = Start-Process -FilePath "node.exe" `
    -ArgumentList "scripts\run_daemon_24_7.js" `
    -WorkingDirectory $cockpitDir `
    -RedirectStandardOutput "$logsDir\daemon_service.log" `
    -RedirectStandardError "$logsDir\daemon_error.log" `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Daemon started with PID: $($daemonProc.Id)"

# Save PIDs to file for tracking
$pidInfo = [PSCustomObject]@{
    WebPID = $webProc.Id
    DaemonPID = $daemonProc.Id
    LaunchedAt = (Get-Date).ToString("o")
}
$pidInfo | ConvertTo-Json | Set-Content "$cockpitDir\logs\services_pids.json"

Write-Host "Services successfully launched!"
Write-Host "PIDs recorded in $cockpitDir\logs\services_pids.json"
