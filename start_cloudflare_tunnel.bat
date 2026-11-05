@echo off
title AI Hedge Cockpit - Cloudflare Tunnel
echo =======================================================
echo   STARTING SECURE CLOUDFLARE HTTPS TUNNEL (PORT 3000)
echo =======================================================
echo Connect to the https://*.trycloudflare.com URL shown below:
echo.
C:\tools\cloudflared.exe tunnel --url http://localhost:3000
pause
