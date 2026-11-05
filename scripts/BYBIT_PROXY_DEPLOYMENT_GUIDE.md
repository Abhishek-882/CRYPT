# Bybit V5 Live Trading Proxy Guide

This guide explains how to route Bybit live mainnet orders and account queries through a proxy to bypass AWS CloudFront geo-IP restrictions.

---

## Method 1: Free Cloudflare Worker Reverse Proxy (Recommended, 60 Seconds)

Cloudflare Workers provide **100,000 free requests per day** and execute on Cloudflare's non-US global edge (Frankfurt, Singapore, London, Tokyo), which completely bypasses CloudFront country restrictions.

### Step-by-Step Setup:
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Navigate to **Workers & Pages** -> **Create Application** -> **Create Worker**.
3. Name your worker (e.g. `bybit-v5-proxy`).
4. Click **Deploy**.
5. Click **Edit Code**, delete the template code, and paste the contents of `scripts/bybit-proxy-worker.js`.
6. Click **Save and Deploy**.
7. Copy your deployed Worker URL (e.g. `https://bybit-v5-proxy.<your-subdomain>.workers.dev`).
8. In your **AI Hedge Cockpit**:
   - Open **Settings** (Gear icon) -> **Exchange API Keys** -> **Bybit Proxy / Worker URL**.
   - Paste the Worker URL.
   - Click **Test Bybit Live Connection** (it will turn green 🟢 with live wallet equity).

---

## Method 2: Standard Outbound HTTP / HTTPS / SOCKS5 Proxy

If you already own an HTTP or SOCKS5 proxy:
1. Format your proxy URL:
   - With authentication: `http://username:password@proxy-ip:port`
   - Without authentication: `http://proxy-ip:port`
   - SOCKS5: `socks5://proxy-ip:port`
2. Set it in `.env`:
   ```bash
   BYBIT_PROXY_URL=http://user:pass@123.45.67.89:8080
   ```
   Or paste it into the Cockpit Settings modal under **Bybit Proxy URL**.
3. The cockpit's internal dispatcher will automatically route all Bybit REST calls through `https-proxy-agent` with automatic 3x retry backoff.
