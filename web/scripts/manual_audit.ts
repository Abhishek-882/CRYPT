import { getDecryptedExchangeCredentials } from '../lib/statarb/execution/liveExchangeAdapter';
import crypto from 'crypto';
import fs from 'fs';

async function manualAudit() {
  const creds = getDecryptedExchangeCredentials();

  // 1. Binance Account & Positions
  const ts = Date.now();
  const qs = `timestamp=${ts}`;
  const sig = crypto.createHmac('sha256', creds.binanceSecret).update(qs).digest('hex');
  const bnUrl = `https://fapi.binance.com/fapi/v2/account?${qs}&signature=${sig}`;

  const bnRes = await fetch(bnUrl, { headers: { 'X-MBX-APIKEY': creds.binanceKey } });
  const bnData = await bnRes.json();
  const bnPositions = (bnData.positions || []).filter((p: any) => parseFloat(p.positionAmt) !== 0);

  // 2. Bybit Account & Positions
  const tsB = Date.now().toString();
  const recvWindow = '5000';
  
  // Wallet Balance
  const qsW = 'accountType=UNIFIED';
  const preHashW = `${tsB}${creds.bybitKey}${recvWindow}${qsW}`;
  const sigW = crypto.createHmac('sha256', creds.bybitSecret).update(preHashW).digest('hex');
  const bybWRes = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${qsW}`, {
    headers: {
      'X-BAPI-API-KEY': creds.bybitKey,
      'X-BAPI-SIGN': sigW,
      'X-BAPI-TIMESTAMP': tsB,
      'X-BAPI-RECV-WINDOW': recvWindow
    }
  });
  const bybWData = await bybWRes.json();
  const bybAcc = bybWData.result?.list?.[0] || {};
  const bybCoins = bybAcc.coin || [];
  const usdtCoin = bybCoins.find((c: any) => c.coin === 'USDT') || {};

  // Positions
  const qsP = 'category=linear&settleCoin=USDT';
  const preHashP = `${tsB}${creds.bybitKey}${recvWindow}${qsP}`;
  const sigP = crypto.createHmac('sha256', creds.bybitSecret).update(preHashP).digest('hex');
  const bybPRes = await fetch(`https://api.bybit.com/v5/position/list?${qsP}`, {
    headers: {
      'X-BAPI-API-KEY': creds.bybitKey,
      'X-BAPI-SIGN': sigP,
      'X-BAPI-TIMESTAMP': tsB,
      'X-BAPI-RECV-WINDOW': recvWindow
    }
  });
  const bybPData = await bybPRes.json();
  const bybPositions = (bybPData.result?.list || []).filter((p: any) => parseFloat(p.size) !== 0);

  // 3. STATARB Internal Engine State
  const statePath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/statarb_state.json';
  let statArbState: any = {};
  if (fs.existsSync(statePath)) {
    statArbState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  }

  // 4. Incidents & Errors
  const incidentPath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/statarb_active_incidents.json';
  let incidents: any[] = [];
  if (fs.existsSync(incidentPath)) {
    incidents = JSON.parse(fs.readFileSync(incidentPath, 'utf8'));
  }

  // 5. Recent Audit Logs
  const auditPath = 'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/statarb_audit_log.json';
  let logs: any[] = [];
  if (fs.existsSync(auditPath)) {
    logs = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  }

  const bnWallet = parseFloat(bnData.totalWalletBalance || '0');
  const bnAvail = parseFloat(bnData.availableBalance || '0');
  const bybEquity = parseFloat(bybAcc.totalEquity || '0');
  const bybAvail = parseFloat(bybAcc.totalAvailableBalance || '0');
  const bybWallet = parseFloat(usdtCoin.walletBalance || '0');
  const totalNav = bnWallet + bybEquity;

  const result = {
    timestamp: new Date().toISOString(),
    binance: {
      walletBalanceUsdt: bnWallet,
      availableBalanceUsdt: bnAvail,
      openPositionsCount: bnPositions.length,
      openPositions: bnPositions.map((p: any) => ({
        symbol: p.symbol,
        positionAmt: p.positionAmt,
        entryPrice: p.entryPrice,
        unrealizedProfit: p.unRealizedProfit
      }))
    },
    bybit: {
      totalEquityUsd: bybEquity,
      availableMarginUsd: bybAvail,
      walletBalanceUsdt: bybWallet,
      openPositionsCount: bybPositions.length,
      openPositions: bybPositions.map((p: any) => ({
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.avgPrice,
        unrealisedPnl: p.unrealisedPnl
      }))
    },
    portfolio: {
      totalNavUsd: totalNav,
      totalOpenPositions: bnPositions.length + bybPositions.length,
      deltaExposureUsd: 0.0
    },
    statarbEngine: {
      isRunning: statArbState.config?.enabled ?? false,
      mode: statArbState.config?.dryRun ? 'PAPER_SIMULATION' : 'LIVE_ON_EXCHANGE',
      activePositionsCount: statArbState.positions?.length ?? 0,
      activePositions: statArbState.positions ?? [],
      closedPositionsCount: statArbState.closedPositions?.length ?? 0,
      totalPnlUsdt: statArbState.telemetry?.totalPnlUsdt ?? 0,
      winRate: statArbState.telemetry?.winRate ?? 0,
      systemStatus: statArbState.telemetry?.systemStatus ?? 'HEALTHY'
    },
    activeIncidents: incidents,
    recentLogs: logs.slice(-6)
  };

  console.log(JSON.stringify(result, null, 2));
}

manualAudit().catch(err => {
  console.error('Audit Error:', err);
  process.exit(1);
});
