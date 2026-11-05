# AI Hedge Cockpit — Indian Windows VPS Zero-Proxy Migration Guide

This guide walks you through deploying the **AI Hedge Cockpit** and its **24/7 Autonomous Bot Engine** onto your **Indian Windows Server VPS (2019 / 2022 / 2025)** with zero proxy configuration.

---

## Why an Indian VPS?
1. **Zero AWS CloudFront Geo-Blocking**: Direct REST & WebSocket connectivity to Bybit, Binance, Bitget, and CoinDCX without CloudFront HTTP 403 errors.
2. **Sub-15ms Ultra-Low Latency to CoinDCX**: Direct domestic fiber routing to CoinDCX servers in India.
3. **Dedicated 24/7 Windows Services**: Auto-restarting background execution via NSSM that survives RDP disconnects, user logouts, and VPS reboots.

---

## 3-Minute 1-Click Deployment Instructions

### Step 1: Transfer the Package to your Indian VPS
1. Locate the packaged archive on your source machine:
   - Path: `ai-hedge-cockpit-indian-vps.zip` (available in `Downloads` or `C:\AI-Hedge-Cockpit\`).
2. Transfer it to your Indian VPS:
   - **Method A (RDP Clipboard)**: Simply Copy (`Ctrl+C`) the `.zip` file on your local machine, and Paste (`Ctrl+V`) it into `C:\` inside your Remote Desktop session.
   - **Method B (Google Drive / Mega / Dropbox)**: Upload the zip and download it via browser on the VPS.
3. Extract the ZIP into:
   ```text
   C:\AI-Hedge-Cockpit
   ```

---

### Step 2: Run the 1-Click Automated Installer
1. On the Indian VPS, press the **Windows Key**, type **PowerShell**, right-click **Windows PowerShell**, and select **Run as Administrator**.
2. Navigate to the extracted folder:
   ```powershell
   cd C:\AI-Hedge-Cockpit
   ```
3. Allow script execution and run the installer:
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\setup_indian_vps.ps1
   ```

**What the installer does automatically:**
- Sets network DNS to **Cloudflare (`1.1.1.1`)** and **Google (`8.8.8.8`)** to bypass Indian ISP domain filtering.
- Detects/Installs **Node.js LTS** if missing.
- Compiles the production Next.js engine (`npm run build`).
- Installs **NSSM** into `C:\tools\nssm.exe`.
- Registers two auto-restarting 24/7 background Windows Services:
  - `AiHedgeCockpit` (Web UI on port 3000)
  - `AiHedgeDaemon` (Autonomous Bot Engine heartbeat & execution loop)
- Downloads `cloudflared.exe` for encrypted remote access.
- Executes the live 4-exchange pre-flight connectivity and latency validator.
- Generates management shortcuts on your VPS Desktop.

---

### Step 3: Accessing the Trading Cockpit

#### A. Inside the VPS (Local Access):
Open any browser on the VPS and navigate to:
```text
http://localhost:3000
```
- **Login Email:** `varsha633@gmail.com`
- **Default Password:** `123456Safe`

#### B. Outside the VPS on Mobile / Laptop (Free Secure HTTPS Tunnel):
1. On the VPS Desktop, double-click **Start Cloudflare Tunnel** (or run `start_cloudflare_tunnel.bat`).
2. The terminal will display a secure public link, for example:
   ```text
   https://random-words.trycloudflare.com
   ```
3. Open that link on your iPhone, Android, or laptop browser from anywhere in the world. Zero open ports or firewall changes needed!

---

## Important Exchange Configuration Notes

### Bybit API Key IP Whitelisting
If you had IP whitelisting enabled on your Bybit API Key:
1. Log in to Bybit (`https://www.bybit.com`).
2. Navigate to **Account & Security -> API Management**.
3. Under your API key, either:
   - Add your **Indian VPS Public IP** to the whitelist, OR
   - Select **"No IP restriction (unrestricted)"** for uninterrupted automated trading.

### CoinDCX & Bitget Credentials
All existing verified credentials (including your live CoinDCX mainnet keys and Bitget keys) are **pre-configured and preserved** inside your encrypted vault (`.vault_master_key` and `user_accounts_store.json`). You do not need to re-type them!

---

## Windows Service Management

You have 1-click batch files on your Desktop and in `C:\AI-Hedge-Cockpit`:
- **Restart Services**: Run `restart_services.bat` (or Desktop shortcut)
- **Stop Services**: Run `stop_services.bat`
- **Start Services**: Run `start_services.bat`

### Checking Live Service Logs:
All output logs are saved under:
- `C:\AI-Hedge-Cockpit\logs\web_service.log`
- `C:\AI-Hedge-Cockpit\logs\daemon_service.log`
- `C:\AI-Hedge-Cockpit\logs\daemon_error.log`

---

## Diagnostics & Pre-Flight Testing
You can re-run the 4-exchange connectivity and latency validator anytime by running:
```powershell
cd C:\AI-Hedge-Cockpit
node scripts\validate_indian_vps.js
```
This confirms direct REST & WebSocket latency to CoinDCX, Bitget, Bybit, and Binance with zero proxy overhead.
