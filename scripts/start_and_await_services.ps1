# scripts/start_and_await_services.ps1
Write-Host "Starting AiHedgeCockpit..."
Start-Service -Name AiHedgeCockpit

$timeout = 30
$listening = $false
while ($timeout -gt 0) {
    $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $listening = $true
        break
    }
    Start-Sleep -Seconds 1
    $timeout--
}

if (-not $listening) {
    Write-Error "AiHedgeCockpit failed to listen on port 3000 within 30 seconds"
    exit 1
}

Write-Host "Port 3000 is listening successfully!"
Write-Host "Starting AiHedgeDaemon..."
Start-Service -Name AiHedgeDaemon

Get-Service -Name AiHedgeCockpit, AiHedgeDaemon
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object LocalAddress, LocalPort, State, OwningProcess
