# AI-Hedge Delta-Neutral Cockpit — Complete VPS Migration Guide

This package contains the entire production web platform, automated trading engines, verified user configurations, historical telemetry, and complete audit reports.

---

## Package Contents

1. **`web/`**: Full Next.js 14 Web Application & Autonomous Quant Engines
   - `lib/autoBotEngine.ts`: Real USD Cross-Exchange Sniper (Bot 1) & Opportunity Hunter (Bot 2)
   - `lib/basisBotEngine.ts`: Dynamic Spot-Futures Basis Arbitrage (Basis Bot 2 / Yield Hunter - 30 pairs)
   - `components/`: Full UI dashboard with auto-scrolling container fix, Live Radar, and Bot controls
   - `data/`: Active user database, admin session stores, basis bot state, and trade audit journals
   - `.env.local`: Live API credentials, encryption secrets, and corridor configs
2. **`reports/`**: Complete Quantitative, Forensic, and Operational Audit Reports
   - `audits/`: All 13 continuous 4-Hour Automated Audit Reports (Iterations 1 through 13 covering 48+ hours of continuous uptime)
   - `verifications/`: Live UI verification reports, browser automation telemetry, and full-page screenshots
   - `trade_reports/`: Trade forensic analysis, PDF reports, and PnL breakdown
   - `architecture_plans/`: Basis bot architecture, 5-gate fail-safe rules, and zero-loss blueprints
3. **Deployment Scripts**:
   - `setup_indian_vps.ps1`: Automated 1-Click Installer for Windows Server VPS (2019 / 2022 / 2025)
   - `setup_linux_vps.sh`: Automated 1-Click Installer for Linux VPS (Ubuntu / Debian)
   - `start_services.bat`, `stop_services.bat`, `restart_services.bat`
   - `cloudflared.exe`: Pre-packaged Cloudflare Quick Tunnel executable for zero-firewall HTTPS access

---

## Migration Path A: Windows Server VPS (Recommended for Indian Latency)

### Step 1: Copy and Extract
1. Copy `AI_Hedge_Cockpit_Full_Package_VPS.zip` onto your Windows VPS (via RDP clipboard copy/paste or browser download).
2. Extract the archive into:
   ```text
   C:\AI-Hedge-Cockpit
   ```

### Step 2: Run 1-Click PowerShell Installer
1. Open **PowerShell** as **Administrator**.
2. Run the deployment script:
   ```powershell
   cd C:\AI-Hedge-Cockpit
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\setup_indian_vps.ps1
   ```
3. The installer will:
   - Configure optimized DNS (1.1.1.1 / 8.8.8.8) to prevent ISP filtering.
   - Install/verify Node.js LTS.
   - Install dependencies and compile the Next.js production build.
   - Register auto-restarting 24/7 background Windows services via NSSM (`AiHedgeCockpit` and `AiHedgeDaemon`).
   - Launch your secure Cloudflare HTTPS tunnel.

---

## Migration Path B: Linux VPS (Ubuntu 20.04 / 22.04 / 24.04 LTS / Debian)

### Step 1: Upload and Extract
1. Upload the zip file via SCP or SFTP to your Linux VPS:
   ```bash
   scp AI_Hedge_Cockpit_Full_Package_VPS.zip user@YOUR_VPS_IP:/home/user/
   ```
2. SSH into your VPS and extract:
   ```bash
   sudo apt-get install -y unzip
   sudo mkdir -p /var/www/ai-hedge-cockpit
   sudo unzip -o AI_Hedge_Cockpit_Full_Package_VPS.zip -d /var/www/ai-hedge-cockpit
   cd /var/www/ai-hedge-cockpit
   ```

### Step 2: Run 1-Click Bash Installer
1. Execute the installer script:
   ```bash
   sudo bash setup_linux_vps.sh
   ```
2. The installer will:
   - Install Node.js 20 LTS and build essentials.
   - Install PM2 process manager.
   - Install dependencies and build production artifacts (`npm run build`).
   - Configure PM2 auto-restart on system boot.
   - Set up Cloudflare Tunnel and firewall rules.

---

## Admin Credentials & Access Verification

- **Default Cockpit URL**: `http://localhost:3000` (or your Cloudflare tunnel domain)
- **Institutional Admin Login**:
  - **Email**: `admin@safecoiner.com`
  - **Password**: `123456Safe`
- **Pre-Configured Bot States**:
  - **Bot 1** (`Binance ⇄ Bybit Real USD Sniper`): **ENABLED & ACTIVE**
  - **Bot 2** (`Opportunity Hunter`): **DISABLED / PAUSED (Skipped)**
  - **Basis Bot 2** (`Dynamic Yield Hunter`): **ACTIVE (IDLE_MONITORING)** with 30-pair universe and loosened $38\text{ bps}$ gross / $7\text{ bps}$ net hurdle.
  - Sizing & Safety: strictly **\$5.00 USDT**, **Max 1 live coin**, **Max 2 entries per coin**.
