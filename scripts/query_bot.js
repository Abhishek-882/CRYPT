const http = require('http');
const crypto = require('crypto');

const secret = process.env.SESSION_SECRET || "ai_hedge_cockpit_secure_session_key_2026_vps";
const hmac = crypto.createHmac("sha256", secret).update("usr_admin_varsha").digest("hex");
const token = `usr_admin_varsha.${hmac}`;

async function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      headers: {
        'Cookie': `auth_session=${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
  });
}

async function run() {
  console.log("Fetching bot state...");
  const daemon = await request('/api/bot/daemon');
  console.log("=== BOT DAEMON STATE ===");
  if (daemon.state) {
    const s = daemon.state;
    console.log(`isRunning: ${s.isRunning}`);
    console.log(`startedAt: ${s.startedAt ? new Date(s.startedAt).toLocaleString() : 'none'}`);
    console.log(`cyclesCount: ${s.cyclesCount}`);
    console.log(`lastCycleAt: ${s.lastCycleAt ? new Date(s.lastCycleAt).toLocaleString() : 'none'}`);
    console.log(`activeCorridor: ${s.activeCorridor}`);
    console.log(`currentPreset: ${s.currentPreset}`);
    console.log(`openTrades count: ${s.openTrades ? s.openTrades.length : 0}`);
    console.log(`closedTrades count: ${s.closedTrades ? s.closedTrades.length : 0}`);
    console.log(`bots count: ${s.bots ? s.bots.length : 0}`);
    if (s.bots) {
      s.bots.forEach((b, idx) => {
        console.log(`Bot #${idx + 1}: name=${b.name}, enabled=${b.enabled}, corridor=${b.corridor}, pair=${b.pair || 'AUTO'}`);
      });
    }
    if (s.openTrades && s.openTrades.length > 0) {
      console.log("Open Trades:", JSON.stringify(s.openTrades, null, 2));
    }
    if (s.closedTrades && s.closedTrades.length > 0) {
      console.log("Recent Closed Trades:", JSON.stringify(s.closedTrades.slice(-5), null, 2));
    }
  } else {
    console.log(JSON.stringify(daemon, null, 2));
  }

  console.log("\nFetching bot logs...");
  const logsRes = await request('/api/bot/logs');
  if (logsRes && logsRes.logs) {
    console.log(`Total logs: ${logsRes.logs.length}`);
    const recent = logsRes.logs.slice(-20);
    recent.forEach((l, i) => {
      const t = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : 'N/A';
      console.log(`[${t}] [${l.level || 'INFO'}] ${l.message || JSON.stringify(l)}`);
    });
  } else {
    console.log("Logs response:", logsRes);
  }
}

run().catch(console.error);
