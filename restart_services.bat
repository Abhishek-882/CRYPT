@echo off
net stop AiHedgeCockpit
net stop AiHedgeDaemon
timeout /t 2 /nobreak >nul
net start AiHedgeCockpit
net start AiHedgeDaemon
echo Services Restarted.
pause
