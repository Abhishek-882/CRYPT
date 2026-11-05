/**
 * Empirical Adversarial Stress-Test Suite for Challenger m1_2
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const dns = require('dns');

async function measureHttp(urlStr, options = {}) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(urlStr, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'AI-Hedge-Challenger/2.0',
        ...(options.headers || {})
      },
      timeout: options.timeout || 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latencyMs = Math.round(performance.now() - t0);
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          latencyMs,
          headers: res.headers,
          data: parsed,
          raw: data
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 408, latencyMs: Math.round(performance.now() - t0), error: 'TIMEOUT' });
    });
    req.on('error', (err) => {
      resolve({ statusCode: 500, latencyMs: Math.round(performance.now() - t0), error: err.message });
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runMultiSampleLatency(name, url, count = 5) {
  const latencies = [];
  let successCount = 0;
  for (let i = 0; i < count; i++) {
    const res = await measureHttp(url);
    if (res.statusCode === 200) {
      successCount++;
      latencies.push(res.latencyMs);
    }
  }
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1));
  return { name, total: count, successes: successCount, min, max, avg, samples: latencies };
}

async function main() {
  console.log("==================================================================");
  console.log("   CHALLENGER M1_2 EMPIRICAL ADVERSARIAL STRESS-TEST HARNESS     ");
  console.log("==================================================================\n");

  // 1. IP & DNS
  const ipRes = await measureHttp('https://api.ipify.org?format=json');
  console.log(`[1] PUBLIC IP AUDIT:`);
  console.log(`    Detected Public IP: ${ipRes.data?.ip}`);
  const expectedIp = '15.252.200.246';
  const ipMatch = ipRes.data?.ip === expectedIp;
  console.log(`    Expected IP:        ${expectedIp} -> ${ipMatch ? 'PASS [MATCH]' : 'FAIL [MISMATCH]'}\n`);

  // 2. Latency & Jitter Stress Test (5 rounds per venue)
  console.log(`[2] JITTER & MULTI-SAMPLE LATENCY AUDIT (5 samples per venue):`);
  const venues = [
    { name: 'CoinDCX Futures', url: 'https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments' },
    { name: 'Bybit V5 Linear ', url: 'https://api.bybit.com/v5/market/time' },
    { name: 'Bitget Futures  ', url: 'https://api.bitget.com/api/v2/public/time' },
    { name: 'Binance Futures ', url: 'https://fapi.binance.com/fapi/v1/time' }
  ];

  for (const v of venues) {
    const stats = await runMultiSampleLatency(v.name, v.url, 5);
    console.log(`    ${v.name}: ${stats.successes}/5 PASS (200) | Min: ${stats.min}ms, Avg: ${stats.avg}ms, Max: ${stats.max}ms | Jitter: ${stats.max - stats.min}ms`);
  }
  console.log("");

  // 3. Bybit V5 Direct REST Inspection
  console.log(`[3] BYBIT V5 DIRECT CONNECTION & CLOUDFRONT BLOCK VERIFICATION:`);
  const bybitTest = await measureHttp('https://api.bybit.com/v5/market/time');
  console.log(`    HTTP Status:      ${bybitTest.statusCode}`);
  console.log(`    Server Header:    ${bybitTest.headers?.server || 'N/A'}`);
  console.log(`    CloudFront Block: ${bybitTest.statusCode === 403 ? 'DETECTED (FAIL)' : 'ZERO BLOCK (PASS)'}`);
  console.log(`    Bybit ServerTime: ${bybitTest.data?.result?.timeNano ? new Date(Number(BigInt(bybitTest.data.result.timeNano) / 1000000n)).toISOString() : 'N/A'}`);
  console.log("");

  // 4. Live Exchange Accounts Query
  console.log(`[4] LIVE EXCHANGE BALANCES & COLLATERAL AUDIT:`);
  const secret = "ai_hedge_cockpit_secure_session_key_2026_vps";
  const hmac = crypto.createHmac("sha256", secret).update("usr_admin_varsha").digest("hex");
  const token = `usr_admin_varsha.${hmac}`;

  const cdxAcc = await measureHttp('http://127.0.0.1:3000/api/coindcx/account', {
    headers: { Cookie: `auth_session=${token}` }
  });
  console.log(`    CoinDCX Mainnet: Status ${cdxAcc.statusCode} | Venue: ${cdxAcc.data?.venue} | Equity: $${cdxAcc.data?.equity} USDT | Simulated: ${cdxAcc.data?.isSimulated}`);

  const bybitAcc = await measureHttp('http://127.0.0.1:3000/api/bybit/account', {
    headers: { Cookie: `auth_session=${token}` }
  });
  console.log(`    Bybit Mainnet:   Status ${bybitAcc.statusCode} | Venue: ${bybitAcc.data?.venue} | Equity: $${bybitAcc.data?.equity} USD | Simulated: ${bybitAcc.data?.isSimulated}`);

  const bgAcc = await measureHttp('http://127.0.0.1:3000/api/bitget/account', {
    headers: { Cookie: `auth_session=${token}` }
  });
  console.log(`    Bitget Account:  Status ${bgAcc.statusCode} | Venue: ${bgAcc.data?.venue} | Equity: $${bgAcc.data?.equity} | Simulated: ${bgAcc.data?.isSimulated}`);
  console.log("");

  // 5. Bot Engine State & Cycle Advancement Audit
  console.log(`[5] BOT ENGINE ACTIVE STATE & CYCLE TICK AUDIT:`);
  const daemon1 = await measureHttp('http://127.0.0.1:3000/api/bot/daemon', {
    headers: { Cookie: `auth_session=${token}` }
  });
  const st1 = daemon1.data?.daemon;
  const cycleCount1 = st1?.cyclesCompleted || st1?.cyclesCount;
  const corridor1 = st1?.config?.executionCorridor;
  const isRunning1 = st1?.isRunning;
  console.log(`    T0: isRunning: ${isRunning1} | activeCorridor: ${corridor1} | cyclesCompleted: ${cycleCount1}`);

  console.log(`    Waiting 6 seconds for daemon tick...`);
  await new Promise(r => setTimeout(r, 6000));

  const daemon2 = await measureHttp('http://127.0.0.1:3000/api/bot/daemon', {
    headers: { Cookie: `auth_session=${token}` }
  });
  const st2 = daemon2.data?.daemon;
  const cycleCount2 = st2?.cyclesCompleted || st2?.cyclesCount;
  const deltaCycles = cycleCount2 - cycleCount1;
  console.log(`    T+6s: cyclesCompleted: ${cycleCount2} (Delta: +${deltaCycles})`);
  console.log(`    Continuous Tick Verification: ${deltaCycles >= 1 ? 'PASS [TICKING AUTONOMOUSLY]' : 'FAIL [STALLED]'}`);

  console.log("\n==================================================================");
  console.log("                     HARNESS COMPLETE                             ");
  console.log("==================================================================");
}

main().catch(console.error);
