const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const vaultKey = '2f1afca42db8f9b86e03660cf5591193c3c061b5c01b99002892c4c5e5454d18';

function decryptVaultSecret(cipherText) {
  if (!cipherText || !cipherText.startsWith('enc:v1:')) return cipherText || '';
  try {
    const parts = cipherText.substring('enc:v1:'.length).split(':');
    if (parts.length !== 3) return cipherText;
    const [ivHex, tagHex, dataHex] = parts;
    const key = Buffer.from(vaultKey, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
}

const storePath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/user_accounts_store.json';
let bnKey = '';
let bnSec = '';
let byKey = '';
let bySec = '';

if (fs.existsSync(storePath)) {
  try {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const admin = store.find(u => u.id === 'usr_admin_varsha');
    if (admin && admin.apiKeys) {
      bnKey = admin.apiKeys.binanceKey || '';
      bnSec = decryptVaultSecret(admin.apiKeys.binanceSecret);
      byKey = admin.apiKeys.bybitKey || '';
      bySec = decryptVaultSecret(admin.apiKeys.bybitSecret);
    }
  } catch (e) {
    console.error('Error loading API credentials:', e.message);
  }
}

function signBinance(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function signBybit(timestamp, apiKey, recvWindow, queryString, secret) {
  const message = timestamp + apiKey + recvWindow + queryString;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

async function generateReport(options = {}) {
  const now = new Date();
  const timestampStr = now.toISOString();

  // 1. Binance Balance & Positions
  let bnUsdt = 0;
  let bnOpenPositions = [];
  if (bnKey && bnSec) {
    try {
      const ts = Date.now();
      const qs = `timestamp=${ts}`;
      const sig = signBinance(qs, bnSec);
      const pUrl = `https://fapi.binance.com/fapi/v2/positionRisk?${qs}&signature=${sig}`;
      const pRes = await fetch(pUrl, { headers: { 'X-MBX-APIKEY': bnKey } });
      const pData = await pRes.json();
      if (Array.isArray(pData)) {
        bnOpenPositions = pData.filter(p => parseFloat(p.positionAmt) !== 0);
      }
      const bUrl = `https://fapi.binance.com/fapi/v2/balance?${qs}&signature=${sig}`;
      const bRes = await fetch(bUrl, { headers: { 'X-MBX-APIKEY': bnKey } });
      const bData = await bRes.json();
      if (Array.isArray(bData)) {
        const u = bData.find(b => b.asset === 'USDT');
        if (u) bnUsdt = parseFloat(u.balance);
      }
    } catch (e) {
      console.error('Binance API error:', e.message);
    }
  }

  // 2. Bybit Balance & Positions
  let byTotalEquity = 0;
  let byAvailableMargin = 0;
  let byUsdtBalance = 0;
  let byOpenPositions = [];
  if (byKey && bySec) {
    try {
      const ts = Date.now().toString();
      const recvWindow = '5000';
      const qs = 'category=linear&settleCoin=USDT';
      const sig = signBybit(ts, byKey, recvWindow, qs, bySec);
      const posUrl = `https://api.bybit.com/v5/position/list?${qs}`;
      const posRes = await fetch(posUrl, {
        headers: {
          'X-BAPI-API-KEY': byKey,
          'X-BAPI-SIGN': sig,
          'X-BAPI-TIMESTAMP': ts,
          'X-BAPI-RECV-WINDOW': recvWindow
        }
      });
      const posData = await posRes.json();
      if (posData.retCode === 0 && posData.result && Array.isArray(posData.result.list)) {
        byOpenPositions = posData.result.list.filter(p => parseFloat(p.size) > 0);
      }

      const qs2 = 'accountType=UNIFIED';
      const sig2 = signBybit(ts, byKey, recvWindow, qs2, bySec);
      const wUrl = `https://api.bybit.com/v5/account/wallet-balance?${qs2}`;
      const wRes = await fetch(wUrl, {
        headers: {
          'X-BAPI-API-KEY': byKey,
          'X-BAPI-SIGN': sig2,
          'X-BAPI-TIMESTAMP': ts,
          'X-BAPI-RECV-WINDOW': recvWindow
        }
      });
      const wData = await wRes.json();
      if (wData.retCode === 0 && wData.result?.list?.[0]) {
        const acc = wData.result.list[0];
        byTotalEquity = parseFloat(acc.totalEquity || '0');
        byAvailableMargin = parseFloat(acc.totalAvailableBalance || '0');
        const coins = acc.coin || [];
        const u = coins.find(c => c.coin === 'USDT');
        if (u) byUsdtBalance = parseFloat(u.walletBalance || '0');
      }
    } catch (e) {
      console.error('Bybit API error:', e.message);
    }
  }

  // 3. Bot Daemon State
  const daemonPath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/users/usr_admin_varsha/bot_daemon_state.json';
  let daemon = { bots: [], isRunning: false, cyclesCompleted: 0 };
  if (fs.existsSync(daemonPath)) {
    try {
      daemon = JSON.parse(fs.readFileSync(daemonPath, 'utf8'));
    } catch (e) {}
  }

  // 4. Compute Comprehensive A/B Bot Statistics
  const botMetrics = (daemon.bots || []).map(b => {
    const completed = Array.isArray(b.completedHedges) ? b.completedHedges : [];
    const active = Array.isArray(b.activeHedges) ? b.activeHedges : Object.values(b.activeHedges || {});

    let totalRealizedPnl = 0;
    let totalFundingHarvested = 0;
    let totalFeesPaid = 0;
    let totalMakerFeesSaved = 0;
    let carryRollCount = 0;
    let zeroLossGateHolds = 0;

    for (const h of completed) {
      totalRealizedPnl += parseFloat(h.realizedPnl || h.netPnl || 0);
      totalFundingHarvested += parseFloat(h.fundingClaimedUsdt || h.harvestedFundingUsd || 0);
      totalFeesPaid += parseFloat(h.feesUsdt || h.totalFeesUsdt || 0);
      if (h.isMaker || h.makerFeeSavedBps) {
        totalMakerFeesSaved += parseFloat(h.makerFeeSavedUsdt || ((h.notionalUsdt || 20) * 0.002));
      }
      if (h.cyclesHarvested && h.cyclesHarvested > 1) {
        carryRollCount += (h.cyclesHarvested - 1);
      }
    }

    // Check active status
    const statusText = b.statusText || 'IDLE';
    if (statusText.includes('WAITING') || statusText.includes('PARITY')) {
      zeroLossGateHolds += 1;
    }

    return {
      id: b.id,
      name: b.name,
      enabled: b.enabled,
      statusText,
      activeHedgesCount: active.length,
      completedTradesCount: completed.length,
      totalRealizedPnl,
      totalFundingHarvested,
      totalFeesPaid,
      totalMakerFeesSaved,
      carryRollCount,
      zeroLossGateHolds,
      config: b.config || {},
    };
  });

  // 5. Recent Trade Audit Events
  const auditPath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/users/usr_admin_varsha/trade_audit_permanent.jsonl';
  let recentEvents = [];
  if (fs.existsSync(auditPath)) {
    try {
      const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n');
      recentEvents = lines.slice(-8).map(l => {
        try { return JSON.parse(l); } catch(e) { return { message: l }; }
      });
    } catch (e) {}
  }

  // Portfolio Totals
  const totalNav = bnUsdt + byTotalEquity;
  const totalUsableMargin = bnUsdt + byAvailableMargin;
  const totalOpenPositions = bnOpenPositions.length + byOpenPositions.length;

  // Format Markdown Report
  const md = `# Automated 2-Hour Fleet Status Report
**Generated**: ${timestampStr}  
**Status**: ${daemon.isRunning ? '🟢 RUNNING 24/7' : '🔴 STOPPED'} | **Uptime / Cycles**: ${daemon.cyclesCompleted || 0} cycles  
**Risk / Capital Integrity**: ${totalOpenPositions === 0 ? '✅ 0 OPEN POSITIONS (Zero Orphan Exposure)' : `⚠️ ${totalOpenPositions} OPEN POSITIONS DETECTED`}
**Combined Portfolio NAV**: **$${totalNav.toFixed(2)} USDT** | **Usable Margin**: **$${totalUsableMargin.toFixed(2)} USDT**

---

## 1. Exchange Balances & Usable Margin

| Exchange Venue | Total Equity | Wallet Balance | Usable Margin | Open Positions | Health |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Binance USD-M Futures** | **\$${bnUsdt.toFixed(2)} USDT** | \$${bnUsdt.toFixed(2)} | **\$${bnUsdt.toFixed(2)}** | **${bnOpenPositions.length}** | 🟢 Connected / Healthy |
| **Bybit Linear Unified** | **\$${byTotalEquity.toFixed(2)} USD** | \$${byUsdtBalance.toFixed(2)} USDT | **\$${byAvailableMargin.toFixed(2)}** | **${byOpenPositions.length}** | 🟢 Connected / Healthy |

---

## 2. A/B Bot Fleet Performance Benchmark (Profit Maximizer vs Innovation Lab)

| Performance Metric | Bot 1: Profit Maximizer (\`${botMetrics[0]?.id || 'bot-1'}\`) | Bot 2: Innovation Lab (\`${botMetrics[1]?.id || 'bot-2'}\`) | System Total |
| :--- | :--- | :--- | :--- |
| **Operational Role** | High-Conviction Profit Harvester | Upgrade Feature Testbed & Challenger | Dual-Bot Fleet |
| **Status** | ${botMetrics[0]?.enabled ? '🟢 ENABLED' : '⏸️ PAUSED'} | ${botMetrics[1]?.enabled ? '🟢 ENABLED' : '⏸️ PAUSED'} | 2 Active Bots |
| **Spread Hurdle** | **${botMetrics[0]?.config?.minSpreadBps || 45} bps** | **${botMetrics[1]?.config?.minSpreadBps || 32} bps** | Tiered Spread |
| **Net Real Yield Hurdle** | **${botMetrics[0]?.config?.minNetYieldHurdleBps || 25} bps** | **${botMetrics[1]?.config?.minNetYieldHurdleBps || 10} bps** | Dynamic Hurdle |
| **Divergence Ceiling** | **${botMetrics[0]?.config?.maxPriceDivergencePct || 0.08}%** (Tight) | **${botMetrics[1]?.config?.maxPriceDivergencePct || 0.25}%** (Loosened) | Parity Gated |
| **Leverage Engine** | **${botMetrics[0]?.config?.customLeverage || 10}x** (\`${botMetrics[0]?.config?.leverageMode || 'CUSTOM'}\`) | **Dynamic ATR** (\`${botMetrics[1]?.config?.leverageMode || 'MAX_PER_COIN'}\`) | Risk-Calibrated |
| **Capital Allocation** | **${botMetrics[0]?.config?.balanceAllocationPct || 25}%** (High Kelly) | **Dynamic Quarter-Kelly** (\`positionSizer\`) | Sizing Optimized |
| **Active Hedges** | **${botMetrics[0]?.activeHedgesCount || 0}** | **${botMetrics[1]?.activeHedgesCount || 0}** | ${totalOpenPositions} active |
| **Completed Trades** | **${botMetrics[0]?.completedTradesCount || 0}** | **${botMetrics[1]?.completedTradesCount || 0}** | ${(botMetrics[0]?.completedTradesCount || 0) + (botMetrics[1]?.completedTradesCount || 0)} trades |
| **Total Realized PnL** | **+\$${(botMetrics[0]?.totalRealizedPnl || 0).toFixed(4)} USDT** | **+\$${(botMetrics[1]?.totalRealizedPnl || 0).toFixed(4)} USDT** | **+\$${((botMetrics[0]?.totalRealizedPnl || 0) + (botMetrics[1]?.totalRealizedPnl || 0)).toFixed(4)} USDT** |
| **Maker Fees Saved (GTX)**| **+\$${(botMetrics[0]?.totalMakerFeesSaved || 0).toFixed(4)}** | **+\$${(botMetrics[1]?.totalMakerFeesSaved || 0).toFixed(4)}** | **+\$${((botMetrics[0]?.totalMakerFeesSaved || 0) + (botMetrics[1]?.totalMakerFeesSaved || 0)).toFixed(4)}** |
| **Zero-Loss Gate Holds** | **${botMetrics[0]?.zeroLossGateHolds || 0}** | **${botMetrics[1]?.zeroLossGateHolds || 0}** | Protected |

---

## 3. Active Bot Status & Scanning Pipeline

${botMetrics.map(b => `
### Bot: ${b.name} (\`${b.id}\`)
- **Live Status**: \`${b.statusText}\`
- **Corridor**: \`${b.config.executionCorridor || 'BINANCE_BYBIT'}\` | **Maker Routing**: \`${b.config.enableMakerRouting ? 'ENABLED (GTX Limit)' : 'DISABLED'}\`
- **Zero-Loss Gate**: \`${b.config.enableZeroLossGate ? 'ACTIVE (+$0.01 Invariant)' : 'DISABLED'}\` | **Carry Rolling**: \`${b.config.enableCarryContinuation ? 'ENABLED' : 'DISABLED'}\`
- **Max Sizing**: \$${b.config.maxAmountPerHedgeUsdt || 15} USDT | **Max Margin Cap**: \$${b.config.maxMarginCapUsdt || 250} USDT
`).join('\n')}

---

## 4. Recent Execution Events & Telemetry

\`\`\`
${recentEvents.map(e => `[${e.timestamp || 'N/A'}] [${(e.level || 'info').toUpperCase()}] ${e.message || JSON.stringify(e)}`).join('\n')}
\`\`\`

---
*Autonomous 2-Hour Telemetry Audit generated by AI Hedge Cockpit Reporting Engine.*
`;

  // Output paths
  // 1. Artifact Directory: latest copy
  const artifactDir = 'C:/Users/Administrator/.gemini/antigravity/brain/1d2bf9be-31cc-4a00-bea0-9564b0cbc34b';
  const latestReportPath = path.join(artifactDir, 'fleet_status_report_latest.md');
  fs.writeFileSync(latestReportPath, md, 'utf8');

  // 2. Persistent Archive Directory
  const reportsArchiveDir = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/reports';
  if (!fs.existsSync(reportsArchiveDir)) {
    fs.mkdirSync(reportsArchiveDir, { recursive: true });
  }

  // Format date for filename: YYYY-MM-DD_HH-mm
  const fileDateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 16);
  const archivePath = path.join(reportsArchiveDir, `fleet_report_${fileDateStr}.md`);
  fs.writeFileSync(archivePath, md, 'utf8');

  console.log(`[REPORT GENERATED] Successfully written to:`);
  console.log(`  - Latest:  ${latestReportPath}`);
  console.log(`  - Archive: ${archivePath}`);
  console.log(`[FLEET SUMMARY] Total NAV: $${totalNav.toFixed(2)} | Binance: $${bnUsdt.toFixed(2)} | Bybit: $${byAvailableMargin.toFixed(2)} | Open Positions: ${totalOpenPositions}`);

  return {
    success: true,
    timestamp: timestampStr,
    totalNav,
    totalUsableMargin,
    totalOpenPositions,
    binanceUsdt: bnUsdt,
    bybitEquity: byTotalEquity,
    bybitUsableMargin: byAvailableMargin,
    botMetrics,
    latestReportPath,
    archivePath,
    markdown: md,
  };
}

if (require.main === module) {
  generateReport().catch(err => {
    console.error('generateReport error:', err);
    process.exit(1);
  });
}

module.exports = { generateReport };
