# Clean Stop Services
$cockpitDir = "C:\Users\Administrator\Desktop\AI_Hedge_Cockpit"
$pidFile = "$cockpitDir\logs\services_pids.json"

if (Test-Path $pidFile) {
    try {
        $pids = Get-Content $pidFile | ConvertFrom-Json
        if ($pids.WebPID) {
            Stop-Process -Id $pids.WebPID -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped Web process $($pids.WebPID)"
        }
        if ($pids.DaemonPID) {
            Stop-Process -Id $pids.DaemonPID -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped Daemon process $($pids.DaemonPID)"
        }
    } catch {
        Write-Warning "Could not stop recorded PIDs: $_"
    }
}

# Also ensure any lingering node process on port 3000 is stopped
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Stop-Process -Id $conn[0].OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped process on port 3000 ($($conn[0].OwningProcess))"
}
