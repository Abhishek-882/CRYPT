/**
 * Live Pre-Flight Diagnostic and Latency Benchmark Validator for Indian VPS
 * Tests direct connectivity to CoinDCX, Bitget, Bybit, and Binance without proxies.
 */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function measureEndpoint(urlStr, options = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'AI-Hedge-Indian-VPS-Validator/2.0',
        Accept: 'application/json',
        ...(options.headers || {})
      },
      timeout: options.timeout || 6000
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const latencyMs = Math.round(performance.now() - t0);
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          latencyMs,
          success: res.statusCode >= 200 && res.statusCode < 300,
          rawPreview: data.slice(0, 150),
          data: parsed,
          headers: res.headers
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 408, latencyMs: Math.round(performance.now() - t0), success: false, error: 'TIMEOUT (6s)' });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 500, latencyMs: Math.round(performance.now() - t0), success: false, error: err.message });
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function getPublicIp() {
  const res = await measureEndpoint('https://api.ipify.org?format=json');
  return res?.data?.ip || 'Unknown IP';
}

async function runValidation() {
  console.log("================================================================================");
  console.log("       AI HEDGE COCKPIT - INDIAN VPS ZERO-PROXY PRE-FLIGHT VALIDATOR            ");
  console.log("================================================================================\n");

  const publicIp = await getPublicIp();
  console.log(`[HOST INFO] Detected Public VPS IP: ${publicIp}`);
  console.log(`[TIMESTAMP] ${new Date().toISOString()} (${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST)\n`);

  console.log("--------------------------------------------------------------------------------");
  console.log("VENUE               STATUS      LATENCY    GEO-BLOCK STATUS      DETAILS        ");
  console.log("--------------------------------------------------------------------------------");

  // 1. CoinDCX
  const cdx = await measureEndpoint('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments');
  const cdxStatus = cdx.success ? 'PASS (200)' : `FAIL (${cdx.statusCode})`;
  const cdxGeo = cdx.success ? 'DIRECT / NO BLOCK' : 'INVESTIGATE';
  const cdxDetails = cdx.success ? 'Indian Local Host (Ultra-Fast)' : (cdx.error || cdx.rawPreview.slice(0, 30));
  console.log(`CoinDCX Futures     ${cdxStatus.padEnd(12)} ${String(cdx.latencyMs + 'ms').padEnd(10)} ${cdxGeo.padEnd(21)} ${cdxDetails}`);

  // 2. Bitget
  const bg = await measureEndpoint('https://api.bitget.com/api/v2/public/time');
  const bgStatus = bg.success ? 'PASS (200)' : `FAIL (${bg.statusCode})`;
  const bgGeo = bg.success ? 'DIRECT / NO BLOCK' : 'INVESTIGATE';
  const bgDetails = bg.success ? 'USDT-M Futures Endpoint Active' : (bg.error || bg.rawPreview.slice(0, 30));
  console.log(`Bitget Futures      ${bgStatus.padEnd(12)} ${String(bg.latencyMs + 'ms').padEnd(10)} ${bgGeo.padEnd(21)} ${bgDetails}`);

  // 3. Bybit
  const bybit = await measureEndpoint('https://api.bybit.com/v5/market/time');
  let bybitStatus = bybit.success ? 'PASS (200)' : `FAIL (${bybit.statusCode})`;
  let bybitGeo = 'DIRECT / NO BLOCK';
  let bybitDetails = 'Linear Perps API Operational';
  
  if (bybit.statusCode === 403) {
    bybitGeo = 'CLOUDFRONT BLOCKED';
    bybitDetails = 'AWS US Geo-Block detected! Check IP geolocation';
  } else if (!bybit.success) {
    bybitGeo = 'ERROR';
    bybitDetails = bybit.error || bybit.rawPreview.slice(0, 30);
  }
  console.log(`Bybit V5 Linear     ${bybitStatus.padEnd(12)} ${String(bybit.latencyMs + 'ms').padEnd(10)} ${bybitGeo.padEnd(21)} ${bybitDetails}`);

  // 4. Binance Futures
  const bn = await measureEndpoint('https://fapi.binance.com/fapi/v1/time');
  let bnStatus = bn.success ? 'PASS (200)' : `FAIL (${bn.statusCode})`;
  let bnGeo = bn.success ? 'DIRECT / NO BLOCK' : 'BLOCKED / 451';
  let bnDetails = bn.success ? 'USD-M Futures API Operational' : (bn.error || bn.rawPreview.slice(0, 30));
  console.log(`Binance Futures     ${bnStatus.padEnd(12)} ${String(bn.latencyMs + 'ms').padEnd(10)} ${bnGeo.padEnd(21)} ${bnDetails}`);

  console.log("--------------------------------------------------------------------------------\n");

  // Summary and Recommendations
  console.log("=== PRE-FLIGHT VERIFICATION VERDICT ===");
  if (cdx.success && bg.success && bybit.success) {
    console.log(">>> [SUCCESS] All primary arbitrage venues (CoinDCX, Bitget, Bybit) are 100% accessible!");
    console.log(">>> [ZERO PROXIES] No proxy hops or tunnels required. Direct execution enabled.\n");
  } else {
    console.log(">>> [ATTENTION] One or more venues returned a non-200 status code.");
    if (bybit.statusCode === 403) {
      console.log("    * Bybit returned 403. Ensure the VPS public IP is genuinely located in India,");
      console.log("      and ensure DNS is configured to 1.1.1.1 and 8.8.8.8.");
    }
    if (!cdx.success) {
      console.log("    * CoinDCX is unreachable. Check firewall outbound port 443.");
    }
  }

  console.log("=== BYBIT API KEY IP WHITELIST CHECK ===");
  console.log(`* Current VPS Public IP: ${publicIp}`);
  console.log("* If Bybit returns code 10010 ('Unmatched IP') during trade execution,");
  console.log(`  add ${publicIp} to your Bybit API Key Whitelist in the Bybit web dashboard,`);
  console.log("  or set the key to 'No IP restriction' for automated 24/7 execution.\n");
}

runValidation().catch(console.error);
