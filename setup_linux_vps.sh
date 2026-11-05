#!/usr/bin/env bash
# ==============================================================================
# AI-HEDGE DELTA-NEUTRAL COCKPIT - 1-CLICK LINUX VPS DEPLOYMENT SCRIPT
# Supported OS: Ubuntu 20.04 / 22.04 / 24.04 LTS, Debian 11 / 12
# ==============================================================================

set -euo pipefail

echo -e "\033[1;36m================================================================================\033[0m"
echo -e "\033[1;36m   AI-HEDGE DELTA-NEUTRAL COCKPIT - LINUX VPS 1-CLICK INSTALLER                 \033[0m"
echo -e "\033[1;36m================================================================================\033[0m"

# 1. Root check
if [ "$EUID" -ne 0 ]; then
  echo -e "\033[1;31m[ERROR] Please run this script with sudo or as root: sudo bash setup_linux_vps.sh\033[0m"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="${SCRIPT_DIR}/web"

# 2. Update packages and install prerequisites
echo -e "\n\033[1;33m[1/6] Updating system packages & installing build tools...\033[0m"
apt-get update -y
apt-get install -y curl wget git build-essential ufw unzip

# 3. Install Node.js LTS (v20.x) if not present or outdated
echo -e "\n\033[1;33m[2/6] Configuring Node.js LTS runtime...\033[0m"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 18 ]; then
  echo "Installing Node.js 20 LTS from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node version: $(node -v)"
echo "NPM version:  $(npm -v)"

# 4. Install PM2 process manager
echo -e "\n\033[1;33m[3/6] Installing PM2 process manager for 24/7 background execution...\033[0m"
npm install -g pm2

# 5. Install Next.js dependencies & compile production build
echo -e "\n\033[1;33m[4/6] Installing dependencies and building production bundle...\033[0m"
cd "$WEB_DIR"

if [ -f ".env.local" ]; then
  echo "Verified: .env.local configuration file present."
else
  echo "[WARNING] .env.local not found in web directory. Copying from root if available..."
  if [ -f "${SCRIPT_DIR}/.env.local" ]; then
    cp "${SCRIPT_DIR}/.env.local" "${WEB_DIR}/.env.local"
  fi
fi

npm install --production=false
npm run build

# 6. Configure PM2 auto-restart service
echo -e "\n\033[1;33m[5/6] Registering PM2 auto-start service...\033[0m"
pm2 delete ai-hedge-cockpit 2>/dev/null || true
pm2 start npm --name "ai-hedge-cockpit" -- start -- -p 3000
pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root || true

# 7. Configure firewall (UFW)
echo -e "\n\033[1;33m[6/6] Configuring firewall rules...\033[0m"
ufw allow 22/tcp || true
ufw allow 3000/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true

# 8. Install Cloudflared (Linux amd64)
echo -e "\n\033[1;33m[OPTIONAL] Setting up Cloudflare Tunnel...\033[0m"
if ! command -v cloudflared >/dev/null 2>&1; then
  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -O /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb || true
  rm -f /tmp/cloudflared.deb
fi

echo -e "\n\033[1;32m================================================================================\033[0m"
echo -e "\033[1;32m   AI-HEDGE COCKPIT DEPLOYED SUCCESSFULLY!                                      \033[0m"
echo -e "\033[1;32m================================================================================\033[0m"
echo -e "Cockpit Local URL:  http://localhost:3000"
echo -e "Public VPS URL:     http://$(curl -s ifconfig.me):3000"
echo -e "\nTo launch a quick Cloudflare HTTPS tunnel, run:"
echo -e "   cloudflared tunnel --url http://localhost:3000"
echo -e "\nTo check PM2 bot service status, run:"
echo -e "   pm2 status"
echo -e "   pm2 logs ai-hedge-cockpit"
