/**
 * Live latency benchmark: Direct vs Proxies across exchanges.
 */
const https = require("https");
const http = require("http");
const path = require("path");
const { HttpsProxyAgent } = require(path.join(__dirname, "../web/node_modules/https-proxy-agent/dist"));

const PROXIES = [
  { name: "Webshare Proxy 1 (US)", url: "http://bxkvaxsa:qrsiapbvvdda@45.38.107.97:6014" },
  { name: "Webshare Proxy 2 (EU)", url: "http://bxkvaxsa:qrsiapbvvdda@84.247.60.125:6095" },
  { name: "Webshare Proxy 3 (US)", url: "http://bxkvaxsa:qrsiapbvvdda@64.137.10.153:5803" },
  { name: "Webshare Proxy 4 (US)", url: "http://bxkvaxsa:qrsiapbvvdda@64.137.96.74:6641" },
];

const CF_WORKER = "https://worker-curly-lab-568e.varsha99633.workers.dev";

function measureRequest(targetUrl, proxyUrl = null) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const urlObj = new URL(targetUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent": "AI-Hedge-Cockpit/2.0",
        Accept: "application/json",
      },
      timeout: 6000,
    };

    if (proxyUrl) {
      options.agent = new HttpsProxyAgent(proxyUrl);
    }

    const mod = urlObj.protocol === "https:" ? https : http;
    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        const latencyMs = Math.round(performance.now() - t0);
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          latencyMs,
          success: res.statusCode >= 200 && res.statusCode < 300,
          preview: data.slice(0, 100),
          isJson: !!parsed,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ statusCode: 408, latencyMs: Math.round(performance.now() - t0), success: false, error: "TIMEOUT (6s)" });
    });

    req.on("error", (err) => {
      resolve({ statusCode: 500, latencyMs: Math.round(performance.now() - t0), success: false, error: err.message });
    });

    req.end();
  });
}

async function runBenchmark() {
  console.log("==================================================================");
  console.log("    LIVE EXCHANGE & PROXY LATENCY BENCHMARK AUDIT");
  console.log("==================================================================");

  // 1. Bybit Direct (NO PROXY)
  console.log("\n[1] Testing BYBIT DIRECT (Without Proxy)...");
  const bybitDirect = await measureRequest("https://api.bybit.com/v5/market/time");
  console.log(`    Status: ${bybitDirect.statusCode} | Latency: ${bybitDirect.latencyMs}ms | Success: ${bybitDirect.success}`);
  if (!bybitDirect.success) {
    console.log(`    Note: Direct Bybit connection response: ${bybitDirect.preview || bybitDirect.error}`);
  }

  // 2. Bybit with Webshare Proxies
  console.log("\n[2] Testing BYBIT WITH WEBSHARE FORWARD PROXIES...");
  for (const p of PROXIES) {
    const res = await measureRequest("https://api.bybit.com/v5/market/time", p.url);
    console.log(`    ${p.name}: Status: ${res.statusCode} | Latency: ${res.latencyMs}ms | Success: ${res.success}`);
  }

  // 3. Bybit with Cloudflare Worker
  console.log("\n[3] Testing BYBIT VIA CLOUDFLARE WORKER...");
  const cfRes = await measureRequest(`${CF_WORKER}/v5/market/time`);
  console.log(`    Cloudflare Worker: Status: ${cfRes.statusCode} | Latency: ${cfRes.latencyMs}ms | Success: ${cfRes.success}`);

  // 4. Other Exchanges (Direct - No Proxy Needed)
  console.log("\n[4] Testing DIRECT VENUES (Binance, CoinDCX, Bitget)...");
  const bnRes = await measureRequest("https://fapi.binance.com/fapi/v1/time");
  console.log(`    Binance Futures Direct: Status: ${bnRes.statusCode} | Latency: ${bnRes.latencyMs}ms | Success: ${bnRes.success}`);

  const cdxRes = await measureRequest("https://public.coindcx.com/market_data/current_prices");
  console.log(`    CoinDCX Direct:         Status: ${cdxRes.statusCode} | Latency: ${cdxRes.latencyMs}ms | Success: ${cdxRes.success}`);

  const bgRes = await measureRequest("https://api.bitget.com/api/v2/public/time");
  console.log(`    Bitget Direct:          Status: ${bgRes.statusCode} | Latency: ${bgRes.latencyMs}ms | Success: ${bgRes.success}`);

  console.log("\n==================================================================");
  console.log("                     BENCHMARK COMPLETE");
  console.log("==================================================================");
}

runBenchmark().catch(console.error);
