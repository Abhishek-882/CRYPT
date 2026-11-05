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
  const daemon = await request('/api/bot/daemon');
  console.log("=== BOT ENGINE STATUS ===");
  const s = daemon.daemon || daemon.state || daemon;
  console.log("isRunning:", s.isRunning);
  console.log("startedAt:", s.startedAt ? new Date(s.startedAt).toLocaleString() : 'N/A');
  console.log("cyclesCount / cyclesCompleted:", s.cyclesCompleted || s.cyclesCount);
  console.log("lastCycleAt:", s.lastCycleAt ? new Date(s.lastCycleAt).toLocaleString() : 'N/A');
  console.log("activeCorridor:", s.activeCorridor || s.config?.executionCorridor || s.bots?.[0]?.config?.executionCorridor || 'COINDCX_BYBIT');
  console.log("statusText:", s.statusText);
  console.log("lastEvaluatedCandidate:", s.lastEvaluatedCandidate);
  
  console.log("\n=== CONFIGURED BOTS ===");
  const bots = s.bots || [];
  console.log("Total bots:", bots.length);
  bots.forEach((b, i) => {
    console.log(`\nBot #${i+1}:`);
    console.log(`  id: ${b.id}`);
    console.log(`  name: "${b.name}"`);
    console.log(`  enabled: ${b.enabled}`);
    console.log(`  corridor: ${b.config ? (b.config.executionCorridor || b.config.corridor) : b.corridor}`);
    console.log(`  activeHedges count: ${(b.activeHedges || []).length}`);
    console.log(`  completedHedges count: ${(b.completedHedges || []).length}`);
    console.log(`  statusText: "${b.statusText}"`);
    console.log(`  lastEvaluatedCandidate:`, b.lastEvaluatedCandidate);
    if ((b.activeHedges || []).length > 0) {
      console.log(`  ACTIVE HEDGES:`, JSON.stringify(b.activeHedges, null, 2));
    }
  });

  console.log("\n=== RECENT BOT AUDIT LOGS (last 10) ===");
  const logsRes = await request('/api/bot/logs');
  const logs = (logsRes && logsRes.logs) ? logsRes.logs : (s.logs || []);
  console.log("Total log count:", logs.length);
  logs.slice(-10).forEach(l => {
    const t = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : 'N/A';
    console.log(`[${t}] [${l.level || 'INFO'}] ${l.message}`);
  });
}

run().catch(console.error);
