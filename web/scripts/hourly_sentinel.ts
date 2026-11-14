import fs from "fs";
import path from "path";
import http from "http";
import { findUserById, getDecryptedUserApiKeys } from "../lib/userStore";
import { loadBotState, saveBotState, fetchAvailableBalances } from "../lib/botEngine";
import { getDaemonLockInfo } from "../lib/daemonLockManager";
import { signAndFetchBinance } from "../lib/binanceSigner";
import { sendBybitRequest } from "../lib/bybitSigner";

const AUDIT_LOG_FILE = path.join(process.cwd(), "data", "reports", "hourly_sentinel_audit.jsonl");

// Ensure audit log dir exists
const dir = path.dirname(AUDIT_LOG_FILE);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

function logAudit(entry: Record<string, any>) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
  fs.appendFileSync(AUDIT_LOG_FILE, line, "utf8");
  console.log(`[HOURLY SENTINEL ${new Date().toISOString()}] ${entry.summary}`);
}

async function checkServerHealth(): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const req = http.get("http://localhost:3000/history", (res) => {
      resolve({ ok: res.statusCode === 200, status: res.statusCode || 0, latencyMs: Math.round(performance.now() - t0) });
    });
    req.on("error", () => {
      resolve({ ok: false, status: 0, latencyMs: Math.round(performance.now() - t0) });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ok: false, status: 408, latencyMs: 5000 });
    });
  });
}

export interface LiveExchangeAuditResult {
  binancePositions: any[];
  bybitPositions: any[];
  binanceOpenOrders: any[];
  bybitOpenOrders: any[];
  unhedgedOrphans: string[];
  untrackedGhostPositions: string[];
  staleOrders: string[];
  totalUnrealizedPnL: number;
}

export async function auditLiveExchangePositionsAndOrders(
  creds: any,
  botState: any,
  userLabel: string
): Promise<LiveExchangeAuditResult> {
  const result: LiveExchangeAuditResult = {
    binancePositions: [],
    bybitPositions: [],
    binanceOpenOrders: [],
    bybitOpenOrders: [],
    unhedgedOrphans: [],
    untrackedGhostPositions: [],
    staleOrders: [],
    totalUnrealizedPnL: 0,
  };

  const activeHedgeSymbols = new Set<string>();
  for (const bot of botState?.bots || []) {
    for (const h of bot.activeHedges || []) {
      if (h.symbol) activeHedgeSymbols.add(h.symbol.toUpperCase());
    }
  }

  // 1. Audit Binance USD-M Futures (Positions & Open Orders)
  if (creds?.binanceKey && creds?.binanceSecret) {
    try {
      const bnPosRes = await signAndFetchBinance(creds.binanceKey, creds.binanceSecret, "GET", "/fapi/v2/positionRisk", {});
      const activeBn = (bnPosRes?.data || []).filter((p: any) => parseFloat(p.positionAmt) !== 0);
      result.binancePositions = activeBn.map((p: any) => ({
        symbol: p.symbol,
        positionAmt: parseFloat(p.positionAmt),
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        unrealizedProfit: parseFloat(p.unRealizedProfit),
        liquidationPrice: parseFloat(p.liquidationPrice || "0"),
        leverage: parseInt(p.leverage),
        marginType: p.marginType,
      }));

      const bnOrdersRes = await signAndFetchBinance(creds.binanceKey, creds.binanceSecret, "GET", "/fapi/v1/openOrders", {});
      result.binanceOpenOrders = (bnOrdersRes?.data || []).map((o: any) => ({
        symbol: o.symbol,
        orderId: o.orderId,
        side: o.side,
        price: parseFloat(o.price),
        origQty: parseFloat(o.origQty),
        executedQty: parseFloat(o.executedQty),
        time: o.time,
        clientOrderId: o.clientOrderId,
      }));
    } catch (err: any) {
      console.error(`[SENTINEL AUDIT] Binance live query error for ${userLabel}:`, err.message);
    }
  }

  // 2. Audit Bybit Linear Futures (Positions & Open Orders)
  if (creds?.bybitKey && creds?.bybitSecret) {
    try {
      const bybPosRes = await sendBybitRequest("/v5/position/list", "GET", {
        apiKey: creds.bybitKey,
        apiSecret: creds.bybitSecret,
        proxyUrl: creds.bybitProxy,
        baseUrl: creds.bybitBaseUrl,
      }, { category: "linear", settleCoin: "USDT" });
      const activeByb = (bybPosRes?.result?.list || []).filter((p: any) => parseFloat(p.size) !== 0);
      result.bybitPositions = activeByb.map((p: any) => ({
        symbol: p.symbol,
        side: p.side,
        size: parseFloat(p.size),
        avgPrice: parseFloat(p.avgPrice),
        markPrice: parseFloat(p.markPrice),
        unrealisedPnl: parseFloat(p.unrealisedPnl),
        liqPrice: parseFloat(p.liqPrice || "0"),
        leverage: parseInt(p.leverage),
      }));

      const bybOrdersRes = await sendBybitRequest("/v5/order/realtime", "GET", {
        apiKey: creds.bybitKey,
        apiSecret: creds.bybitSecret,
        proxyUrl: creds.bybitProxy,
        baseUrl: creds.bybitBaseUrl,
      }, { category: "linear", settleCoin: "USDT" });
      result.bybitOpenOrders = (bybOrdersRes?.result?.list || []).map((o: any) => ({
        symbol: o.symbol,
        orderId: o.orderId,
        side: o.side,
        price: parseFloat(o.price),
        qty: parseFloat(o.qty),
        cumExecQty: parseFloat(o.cumExecQty),
        createdTime: parseInt(o.createdTime),
        orderLinkId: o.orderLinkId,
      }));
    } catch (err: any) {
      console.error(`[SENTINEL AUDIT] Bybit live query error for ${userLabel}:`, err.message);
    }
  }

  // 3. Compute Total Unrealized PnL
  const bnPnl = result.binancePositions.reduce((s, p) => s + (p.unrealizedProfit || 0), 0);
  const bybPnl = result.bybitPositions.reduce((s, p) => s + (p.unrealisedPnl || 0), 0);
  result.totalUnrealizedPnL = parseFloat((bnPnl + bybPnl).toFixed(4));

  // 4. Cross-Exchange Delta-Neutral Pair Reconciliation (Orphan Detection)
  const bybPosMap = new Map<string, any>();
  for (const bp of result.bybitPositions) {
    bybPosMap.set(bp.symbol.toUpperCase(), bp);
  }

  const bnPosMap = new Map<string, any>();
  for (const bp of result.binancePositions) {
    bnPosMap.set(bp.symbol.toUpperCase(), bp);
  }

  // Check Binance positions for missing Bybit counterpart
  for (const bp of result.binancePositions) {
    const sym = bp.symbol.toUpperCase();
    const bybMatch = bybPosMap.get(sym);
    if (!bybMatch) {
      result.unhedgedOrphans.push(
        `CRITICAL ORPHAN: Binance has ${bp.positionAmt > 0 ? "LONG" : "SHORT"} ${Math.abs(bp.positionAmt)} ${sym} @ $${bp.entryPrice} (PnL: ${bp.unrealizedProfit >= 0 ? "+" : ""}${bp.unrealizedProfit} USDT), but Bybit has 0 contracts!`
      );
    } else {
      // Check net delta neutrality
      const bnDir = bp.positionAmt > 0 ? 1 : -1;
      const bybDir = bybMatch.side === "Buy" ? 1 : -1;
      const bnUnits = Math.abs(bp.positionAmt);
      const bybUnits = Math.abs(bybMatch.size);
      if (bnDir === bybDir) {
        result.unhedgedOrphans.push(
          `DIRECTIONAL CONFLICT: Both Binance and Bybit are on the SAME side (${bybMatch.side}) for ${sym} (Binance: ${bnUnits}, Bybit: ${bybUnits})!`
        );
      } else {
        const delta = Math.abs(bnUnits - bybUnits);
        const maxUnits = Math.max(bnUnits, bybUnits);
        if (delta / maxUnits > 0.05) {
          result.unhedgedOrphans.push(
            `DELTA MISMATCH: ${sym} net delta is unhedged by ${(delta / maxUnits * 100).toFixed(1)}% (Binance: ${bnUnits}, Bybit: ${bybUnits})!`
          );
        }
      }
    }

    // Check if tracked by bot memory
    if (!activeHedgeSymbols.has(sym)) {
      result.untrackedGhostPositions.push(
        `UNTRACKED GHOST: Binance has active ${sym} (${bp.positionAmt} units) but bot memory activeHedges is EMPTY for this symbol!`
      );
    }
  }

  // Check Bybit positions for missing Binance counterpart
  for (const bp of result.bybitPositions) {
    const sym = bp.symbol.toUpperCase();
    if (!bnPosMap.has(sym)) {
      result.unhedgedOrphans.push(
        `CRITICAL ORPHAN: Bybit has ${bp.side.toUpperCase()} ${bp.size} ${sym} @ $${bp.avgPrice} (PnL: ${bp.unrealisedPnl >= 0 ? "+" : ""}${bp.unrealisedPnl} USDT), but Binance has 0 contracts!`
      );
    }
    if (!activeHedgeSymbols.has(sym)) {
      result.untrackedGhostPositions.push(
        `UNTRACKED GHOST: Bybit has active ${sym} (${bp.size} units) but bot memory activeHedges is EMPTY for this symbol!`
      );
    }
  }

  // 5. Stale Open Orders Detection (> 3 minutes old)
  const now = Date.now();
  for (const o of result.binanceOpenOrders) {
    const ageSeconds = Math.round((now - o.time) / 1000);
    if (ageSeconds > 180) {
      result.staleOrders.push(`Binance open order #${o.orderId} on ${o.symbol} (${o.side} ${o.origQty} @ $${o.price}) resting for ${ageSeconds}s without fill`);
    }
  }
  for (const o of result.bybitOpenOrders) {
    const ageSeconds = Math.round((now - o.createdTime) / 1000);
    if (ageSeconds > 180) {
      result.staleOrders.push(`Bybit open order #${o.orderId} on ${o.symbol} (${o.side} ${o.qty} @ $${o.price}) resting for ${ageSeconds}s without fill`);
    }
  }

  return result;
}

export async function runHourlyAuditPass(): Promise<{
  healthy: boolean;
  adminStatus: any;
  userStatus: any;
  suspiciousFindings: string[];
  autoRemediations: string[];
}> {
  const suspiciousFindings: string[] = [];
  const autoRemediations: string[] = [];

  // 1. Web Server & Daemon Health Check
  const server = await checkServerHealth();
  if (!server.ok) {
    suspiciousFindings.push(`Next.js server endpoint unhealthy (status: ${server.status}, latency: ${server.latencyMs}ms)`);
  }

  // 2. Daemon Lock Check
  const lockInfo = getDaemonLockInfo();
  if (!lockInfo || !lockInfo.pid) {
    suspiciousFindings.push(`Daemon lock is inactive or missing`);
  }

  // 3. User Account Audit: rada7788@gmail.com (usr_1794314482670_kyff8)
  const user = findUserById("usr_1794314482670_kyff8");
  let userBotState: any = null;
  let userBal: any = null;
  let userExchangeAudit: LiveExchangeAuditResult | null = null;

  if (!user) {
    suspiciousFindings.push("User rada7788@gmail.com not found in user accounts store!");
  } else {
    userBotState = loadBotState(user.id);
    if (!userBotState.isRunning) {
      suspiciousFindings.push(`User bot daemon was STOPPED. Auto-remediating: restarting daemon...`);
      userBotState.isRunning = true;
      saveBotState(userBotState, user.id);
      autoRemediations.push("Auto-restarted user bot daemon");
    }

    const bot2 = userBotState.bots.find((b: any) => b.id === "bot-120328");
    if (!bot2) {
      suspiciousFindings.push("User Bot 2 (Innovation Lab) missing in bot list!");
    } else {
      if (!bot2.enabled) {
        suspiciousFindings.push("User Bot 2 was DISABLED. Auto-remediating: re-enabling...");
        bot2.enabled = true;
        saveBotState(userBotState, user.id);
        autoRemediations.push("Re-enabled user Bot 2");
      }
      if (bot2.config?.fastExitIntervalMs !== 250) {
        bot2.config.fastExitIntervalMs = 250;
        saveBotState(userBotState, user.id);
        autoRemediations.push("Upgraded user Bot 2 fastExitIntervalMs to 250ms");
      }
    }

    // Verify User Balances & Live Exchange Orders/Positions
    const userCreds = getDecryptedUserApiKeys(user);
    if (userCreds) {
      try {
        userBal = await fetchAvailableBalances(userCreds, user.id);
      } catch (balErr: any) {
        suspiciousFindings.push(`User exchange balance query failed: ${balErr.message}`);
      }

      userExchangeAudit = await auditLiveExchangePositionsAndOrders(userCreds, userBotState, "rada7788@gmail.com");
      for (const o of userExchangeAudit.unhedgedOrphans) suspiciousFindings.push(`[USER] ${o}`);
      for (const g of userExchangeAudit.untrackedGhostPositions) suspiciousFindings.push(`[USER] ${g}`);
      for (const s of userExchangeAudit.staleOrders) suspiciousFindings.push(`[USER] ${s}`);
    }
  }

  // 4. Admin Account Audit: usr_admin_varsha
  const admin = findUserById("usr_admin_varsha");
  let adminBotState: any = null;
  let adminBal: any = null;
  let adminExchangeAudit: LiveExchangeAuditResult | null = null;

  if (!admin) {
    suspiciousFindings.push("Admin usr_admin_varsha not found in user store!");
  } else {
    adminBotState = loadBotState(admin.id);
    if (!adminBotState.isRunning) {
      suspiciousFindings.push("Admin bot daemon was STOPPED. Auto-remediating: restarting daemon...");
      adminBotState.isRunning = true;
      saveBotState(adminBotState, admin.id);
      autoRemediations.push("Auto-restarted admin bot daemon");
    }

    const adminBot = adminBotState.bots.find((b: any) => b.id === "bot-120328") || adminBotState.bots[0];
    if (adminBot && adminBot.config?.fastExitIntervalMs !== 250) {
      adminBot.config.fastExitIntervalMs = 250;
      saveBotState(adminBotState, admin.id);
      autoRemediations.push("Upgraded admin bot fastExitIntervalMs to 250ms");
    }

    const adminCreds = getDecryptedUserApiKeys(admin);
    if (adminCreds) {
      try {
        adminBal = await fetchAvailableBalances(adminCreds, admin.id);
      } catch (adminBalErr: any) {
        suspiciousFindings.push(`Admin exchange balance query failed: ${adminBalErr.message}`);
      }

      adminExchangeAudit = await auditLiveExchangePositionsAndOrders(adminCreds, adminBotState, "usr_admin_varsha");
      for (const o of adminExchangeAudit.unhedgedOrphans) suspiciousFindings.push(`[ADMIN] ${o}`);
      for (const g of adminExchangeAudit.untrackedGhostPositions) suspiciousFindings.push(`[ADMIN] ${g}`);
      for (const s of adminExchangeAudit.staleOrders) suspiciousFindings.push(`[ADMIN] ${s}`);
    }
  }

  // 5. Inspect Log Health for Critical Errors
  const userLogPath = path.join(process.cwd(), "data", "users", "usr_1794314482670_kyff8", "bot_audit_log.json");
  if (fs.existsSync(userLogPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(userLogPath, "utf8"));
      const recentLogs = Array.isArray(logs) ? logs.slice(-20) : [];
      for (const log of recentLogs) {
        const msg = typeof log === "string" ? log : log.message || "";
        if (msg.includes("IP_BANNED") || msg.includes("API_KEY_INVALID") || msg.includes("RATE_LIMIT_EXCEEDED")) {
          suspiciousFindings.push(`Suspicious error in user audit log: ${msg}`);
        }
      }
    } catch {}
  }

  const healthy = suspiciousFindings.length === 0;

  // Build comprehensive readable summary with exact exchange orders & positions
  const adminActivePosStr = adminExchangeAudit
    ? `Live Pos: ${adminExchangeAudit.binancePositions.length} BN, ${adminExchangeAudit.bybitPositions.length} BYB | Orders: ${adminExchangeAudit.binanceOpenOrders.length} BN, ${adminExchangeAudit.bybitOpenOrders.length} BYB`
    : "Live Pos: N/A";

  const userActivePosStr = userExchangeAudit
    ? `Live Pos: ${userExchangeAudit.binancePositions.length} BN, ${userExchangeAudit.bybitPositions.length} BYB | Orders: ${userExchangeAudit.binanceOpenOrders.length} BN, ${userExchangeAudit.bybitOpenOrders.length} BYB`
    : "Live Pos: N/A";

  const summary = healthy
    ? `ALL CHECKS PASSED: Server healthy (${server.latencyMs}ms). Admin: BN $${adminBal?.binanceBal?.toFixed(2)}, BYB $${adminBal?.bybitBal?.toFixed(2)} (${adminActivePosStr}, 0 orphans, 0 ghost pos). User: BYB $${userBal?.bybitBal?.toFixed(2)} (${userActivePosStr}, 0 orphans, 0 ghost pos).`
    : `ANOMALIES DETECTED: ${suspiciousFindings.join(" | ")}. Remediations applied: ${autoRemediations.length > 0 ? autoRemediations.join(", ") : "None"}`;

  logAudit({
    healthy,
    summary,
    suspiciousFindings,
    autoRemediations,
    serverLatencyMs: server.latencyMs,
    adminBalance: { binance: adminBal?.binanceBal, bybit: adminBal?.bybitBal },
    userBalance: { binance: userBal?.binanceBal, bybit: userBal?.bybitBal },
    adminExchangeAudit: {
      binancePositions: adminExchangeAudit?.binancePositions,
      bybitPositions: adminExchangeAudit?.bybitPositions,
      binanceOpenOrders: adminExchangeAudit?.binanceOpenOrders,
      bybitOpenOrders: adminExchangeAudit?.bybitOpenOrders,
      unhedgedOrphans: adminExchangeAudit?.unhedgedOrphans,
      untrackedGhostPositions: adminExchangeAudit?.untrackedGhostPositions,
      staleOrders: adminExchangeAudit?.staleOrders,
      totalUnrealizedPnL: adminExchangeAudit?.totalUnrealizedPnL,
    },
    userExchangeAudit: {
      binancePositions: userExchangeAudit?.binancePositions,
      bybitPositions: userExchangeAudit?.bybitPositions,
      binanceOpenOrders: userExchangeAudit?.binanceOpenOrders,
      bybitOpenOrders: userExchangeAudit?.bybitOpenOrders,
      unhedgedOrphans: userExchangeAudit?.unhedgedOrphans,
      untrackedGhostPositions: userExchangeAudit?.untrackedGhostPositions,
      staleOrders: userExchangeAudit?.staleOrders,
      totalUnrealizedPnL: userExchangeAudit?.totalUnrealizedPnL,
    },
  });

  return {
    healthy,
    adminStatus: {
      isRunning: adminBotState?.isRunning,
      balances: adminBal,
      exchangeAudit: adminExchangeAudit,
    },
    userStatus: {
      isRunning: userBotState?.isRunning,
      balances: userBal,
      exchangeAudit: userExchangeAudit,
    },
    suspiciousFindings,
    autoRemediations,
  };
}

// If executed directly, run immediately
if (require.main === module || process.argv[1]?.includes("hourly_sentinel")) {
  runHourlyAuditPass().then((res) => {
    console.log("Sentinel Execution Finished. Status:", res.healthy ? "HEALTHY" : "NEEDS ATTENTION");
    process.exit(0);
  }).catch((err) => {
    console.error("[HOURLY SENTINEL CRASH PREVENTED]:", err);
    process.exit(1);
  });
}
