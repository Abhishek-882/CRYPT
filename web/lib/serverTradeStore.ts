import fs from "fs";
import path from "path";
import { readDataFile, saveDataFile, readUserDataFile, saveUserDataFile, resolveUserStoragePath, resolveDataFilePath } from "./storagePath";
import { ServerHedgeTrade, isRealMainnetTrade } from "./tradeTypes";

export { isRealMainnetTrade };
export type { ServerHedgeTrade };

const TRADES_FILE_NAME = "hedge_trades_history.json";

// In-memory per-tenant trade cache with disk signature (mtime + size) synchronization
const globalForTrades = global as unknown as {
  tenantTrades?: Record<string, ServerHedgeTrade[]>;
  tenantTradesMtime?: Record<string, number>;
  tenantTradesSignature?: Record<string, string>;
};

if (!globalForTrades.tenantTrades) {
  globalForTrades.tenantTrades = {};
}
if (!globalForTrades.tenantTradesMtime) {
  globalForTrades.tenantTradesMtime = {};
}
if (!globalForTrades.tenantTradesSignature) {
  globalForTrades.tenantTradesSignature = {};
}

function getTradesFileSignature(userId?: string): string {
  try {
    let sig = "0_0";
    if (userId && userId !== "global_default") {
      const userFilePath = resolveUserStoragePath(userId, TRADES_FILE_NAME);
      if (fs.existsSync(userFilePath)) {
        const stat = fs.statSync(userFilePath);
        sig = `${stat.mtimeMs}_${stat.size}`;
      }
      if (userId === "usr_admin_varsha" || userId.includes("admin")) {
        const globalFilePath = resolveDataFilePath(TRADES_FILE_NAME);
        if (fs.existsSync(globalFilePath)) {
          const gStat = fs.statSync(globalFilePath);
          sig += `|${gStat.mtimeMs}_${gStat.size}`;
        }
      }
    } else {
      const globalFilePath = resolveDataFilePath(TRADES_FILE_NAME);
      if (fs.existsSync(globalFilePath)) {
        const stat = fs.statSync(globalFilePath);
        sig = `${stat.mtimeMs}_${stat.size}`;
      }
    }
    return sig;
  } catch {}
  return "0_0";
}

export function loadTrades(userId?: string, forceDiskRead: boolean = false): ServerHedgeTrade[] {
  const cacheKey = userId || "global_default";
  const diskSig = getTradesFileSignature(userId);

  // If cached in memory AND disk signature (mtime + size) matches AND not forcing reload, return cache
  if (
    !forceDiskRead &&
    globalForTrades.tenantTrades?.[cacheKey] !== undefined &&
    globalForTrades.tenantTradesSignature?.[cacheKey] === diskSig &&
    diskSig !== "0_0"
  ) {
    return globalForTrades.tenantTrades[cacheKey];
  }

  let parsed: ServerHedgeTrade[] = [];
  if (userId && userId !== "global_default") {
    parsed = readUserDataFile<ServerHedgeTrade[]>(userId, TRADES_FILE_NAME, []);
    // For admin, ensure all global trades are merged so no trade receipts are ever missed
    if (userId === "usr_admin_varsha" || userId.includes("admin")) {
      const globalTrades = readDataFile<ServerHedgeTrade[]>(TRADES_FILE_NAME, []);
      if (Array.isArray(globalTrades) && globalTrades.length > 0) {
        const existingIds = new Set(parsed.map((t) => t.id));
        const newFromGlobal = globalTrades.filter((t) => !existingIds.has(t.id));
        if (newFromGlobal.length > 0) {
          parsed = [...newFromGlobal, ...parsed];
        }
      }
    }
  } else {
    parsed = readDataFile<ServerHedgeTrade[]>(TRADES_FILE_NAME, []);
  }

  if (!Array.isArray(parsed)) {
    parsed = [];
  }

  // Normalize legacy records with deterministic mode, isRealMainnet tags, and eliminate dummy $0.0012 fallback
  parsed.forEach((t) => {
    if (t.isRealMainnet === undefined) {
      t.isRealMainnet = isRealMainnetTrade(t);
    }
    if (!t.mode) {
      t.mode = t.isRealMainnet ? "mainnet" : (String(t.type || "").includes("TESTNET") ? "testnet" : "paper");
    }
    // Eliminate dummy 0.0012 fallback so reported fees reflect exchange reality
    if (t.feesUsdt === 0.0012) {
      t.feesUsdt = t.totalFeesUsdt !== undefined && t.totalFeesUsdt !== 0.0012 ? t.totalFeesUsdt : 0;
    }
    if (t.totalFeesUsdt === 0.0012) {
      t.totalFeesUsdt = t.feesUsdt || 0;
    }
    // Net realized PnL must correctly account for funding payments received or debited
    if (t.fundingClaimedUsdt !== undefined) {
      const fees = t.feesUsdt || t.totalFeesUsdt || 0;
      if (t.priceSpreadPnlUsdt === undefined) {
        if (t.netHarvestUsdt !== undefined) {
          t.priceSpreadPnlUsdt = parseFloat((t.netHarvestUsdt - t.fundingClaimedUsdt + fees).toFixed(4));
        } else if (t.realizedPnl !== undefined) {
          t.priceSpreadPnlUsdt = parseFloat((t.realizedPnl - t.fundingClaimedUsdt + fees).toFixed(4));
        } else {
          t.priceSpreadPnlUsdt = 0;
        }
      }
      t.netHarvestUsdt = parseFloat((t.priceSpreadPnlUsdt + t.fundingClaimedUsdt - fees).toFixed(4));
      if (t.status === "CLOSED" || t.type === "AUTONOMOUS_SERVER_CLOSE" || t.type === "DUAL_LEG_UNWIND") {
        t.realizedPnl = t.netHarvestUsdt;
      }
    }
  });

  globalForTrades.tenantTrades![cacheKey] = parsed;
  globalForTrades.tenantTradesMtime![cacheKey] = Date.now();
  globalForTrades.tenantTradesSignature![cacheKey] = getTradesFileSignature(userId);
  return parsed;
}

export function saveTrades(trades: ServerHedgeTrade[], userId?: string) {
  const cacheKey = userId || "global_default";
  globalForTrades.tenantTrades![cacheKey] = trades;

  if (userId && userId !== "global_default") {
    saveUserDataFile(userId, TRADES_FILE_NAME, trades);
    // Mirror to global if admin
    if (userId === "usr_admin_varsha" || userId.includes("admin")) {
      saveDataFile(TRADES_FILE_NAME, trades);
    }
  } else {
    saveDataFile(TRADES_FILE_NAME, trades);
  }

  globalForTrades.tenantTradesMtime![cacheKey] = Date.now();
  globalForTrades.tenantTradesSignature![cacheKey] = getTradesFileSignature(userId);
}

export function clearTrades(userId?: string): void {
  saveTrades([], userId);
}

export function recordServerTrade(trade: Partial<ServerHedgeTrade>, userId?: string): ServerHedgeTrade {
  const targetUser = userId || trade.userId || "global_default";
  const trades = loadTrades(targetUser, true);
  const now = Date.now();
  const openTime = trade.timestamp || now;
  const closeTime = trade.closeTimestamp || (trade.status === "CLOSED" || trade.status === "DELTA_NEUTRAL" ? now : undefined);
  const durationMs = trade.durationMs !== undefined
    ? trade.durationMs
    : (closeTime ? Math.max(120, closeTime - openTime) : undefined);

  const price = trade.leg1Price || trade.leg2Price || 0;
  const qty = typeof trade.quantity === "number" ? trade.quantity : parseFloat(String(trade.quantity || "0"));
  const notional = trade.notionalUsdt || (price > 0 && qty > 0 ? parseFloat((price * qty).toFixed(2)) : 0);

  // R4: Eliminate $0.0012 dummy fee fallback and reflect real exchange fill commissions
  const feesUsdt = typeof trade.feesUsdt === "number"
    ? trade.feesUsdt
    : (typeof trade.totalFeesUsdt === "number" ? trade.totalFeesUsdt : 0);
  const totalFeesUsdt = typeof trade.totalFeesUsdt === "number" ? trade.totalFeesUsdt : feesUsdt;

  // Net realized PnL must correctly account for funding payments received or debited
  const fundingClaimed = typeof trade.fundingClaimedUsdt === "number" ? trade.fundingClaimedUsdt : 0;
  let priceSpreadPnl: number;
  if (trade.priceSpreadPnlUsdt !== undefined) {
    priceSpreadPnl = trade.priceSpreadPnlUsdt;
  } else if (trade.netHarvestUsdt !== undefined && trade.fundingClaimedUsdt !== undefined) {
    priceSpreadPnl = parseFloat((trade.netHarvestUsdt - fundingClaimed + totalFeesUsdt).toFixed(4));
  } else if (trade.realizedPnl !== undefined && trade.fundingClaimedUsdt !== undefined && (trade.status === "CLOSED" || trade.type === "AUTONOMOUS_SERVER_CLOSE" || trade.type === "DUAL_LEG_UNWIND")) {
    priceSpreadPnl = parseFloat((trade.realizedPnl - fundingClaimed + totalFeesUsdt).toFixed(4));
  } else {
    priceSpreadPnl = trade.realizedPnl !== undefined ? trade.realizedPnl : 0;
  }

  const netHarvest = trade.netHarvestUsdt !== undefined
    ? trade.netHarvestUsdt
    : parseFloat((priceSpreadPnl + fundingClaimed - totalFeesUsdt).toFixed(4));

  const realizedPnl = (trade.status === "CLOSED" || trade.type === "AUTONOMOUS_SERVER_CLOSE" || trade.type === "DUAL_LEG_UNWIND" || trade.fundingClaimedUsdt !== undefined)
    ? netHarvest
    : (trade.realizedPnl !== undefined ? trade.realizedPnl : 0);

  const returnsPct = trade.returnsPct !== undefined
    ? trade.returnsPct
    : (notional > 0 ? parseFloat(((realizedPnl / notional) * 100).toFixed(4)) : 0);

  const isReal = trade.isRealMainnet !== undefined
    ? trade.isRealMainnet
    : isRealMainnetTrade(trade);
  const tradeMode = trade.mode || (isReal ? "mainnet" : "paper");

  const fullTrade: ServerHedgeTrade = {
    id: trade.id || `HDG-${Date.now().toString().slice(-6)}`,
    userId: targetUser,
    timestamp: openTime,
    closeTimestamp: closeTime,
    durationMs,
    symbol: (trade.symbol || "BTCUSDT").toUpperCase(),
    type: trade.type || (isReal ? "LIVE_MAINNET_HEDGE" : "QUICK_HEDGE_1CLICK"),
    directionLabel: trade.directionLabel || (trade.leg1Side === "SELL" ? "Short BN + Long BG" : "Long BN + Short BG"),
    quantity: trade.quantity || "0.005",
    notionalUsdt: notional,
    leg1Venue: trade.leg1Venue || "Binance",
    leg1Side: trade.leg1Side || "SELL",
    leg1Price: trade.leg1Price || 0,
    leg1OrderId: trade.leg1OrderId,
    leg2Venue: trade.leg2Venue || "Bitget",
    leg2Side: trade.leg2Side || "BUY",
    leg2Price: trade.leg2Price || 0,
    leg2OrderId: trade.leg2OrderId,
    leg1LatencyMs: trade.leg1LatencyMs,
    leg2LatencyMs: trade.leg2LatencyMs,
    leg1PlacedAt: trade.leg1PlacedAt,
    leg2PlacedAt: trade.leg2PlacedAt,
    closeLeg1LatencyMs: trade.closeLeg1LatencyMs,
    closeLeg2LatencyMs: trade.closeLeg2LatencyMs,
    closeLeg1PlacedAt: trade.closeLeg1PlacedAt,
    closeLeg2PlacedAt: trade.closeLeg2PlacedAt,
    closeInterLegDeltaMs: (trade.closeLeg1LatencyMs != null && trade.closeLeg2LatencyMs != null && trade.closeLeg1LatencyMs > 0 && trade.closeLeg2LatencyMs > 0)
      ? Math.abs(trade.closeLeg2LatencyMs - trade.closeLeg1LatencyMs)
      : (trade.closeInterLegDeltaMs ?? 0),
    interLegDeltaMs: (trade.leg1LatencyMs != null && trade.leg2LatencyMs != null && trade.leg1LatencyMs > 0 && trade.leg2LatencyMs > 0)
      ? Math.abs(trade.leg2LatencyMs - trade.leg1LatencyMs)
      : (trade.interLegDeltaMs || 0),
    botId: trade.botId,
    botName: trade.botName,
    realizedPnl,
    returnsPct,
    feesUsdt,
    totalFeesUsdt,
    leg1FeeUsdt: trade.leg1FeeUsdt,
    leg2FeeUsdt: trade.leg2FeeUsdt,
    closeLeg1FeeUsdt: trade.closeLeg1FeeUsdt,
    closeLeg2FeeUsdt: trade.closeLeg2FeeUsdt,
    status: trade.status || "ACTIVE",
    mode: tradeMode,
    isRealMainnet: isReal,
    fundingClaimedUsdt: trade.fundingClaimedUsdt,
    fundingRatePct: trade.fundingRatePct,
    fundingRateApr: trade.fundingRateApr,
    fundingVenue: trade.fundingVenue,
    priceSpreadPnlUsdt: trade.priceSpreadPnlUsdt,
    netHarvestUsdt: netHarvest,
    closeLeg1OrderId: trade.closeLeg1OrderId,
    closeLeg2OrderId: trade.closeLeg2OrderId,
    closeLeg1Price: trade.closeLeg1Price,
    closeLeg2Price: trade.closeLeg2Price,
    entryDivergencePct: trade.entryDivergencePct,
    closeDivergencePct: trade.closeDivergencePct,
    entryPriceSpreadBps: trade.entryPriceSpreadBps,
    isAsymmetricFunding: trade.isAsymmetricFunding,
    venueAIntervalHours: trade.venueAIntervalHours,
    venueBIntervalHours: trade.venueBIntervalHours,
  };

  const existingIdx = trades.findIndex((t) => t.id === fullTrade.id);
  let updated: ServerHedgeTrade[];
  if (existingIdx >= 0) {
    updated = [...trades];
    const prev = updated[existingIdx];
    const mergedFees = (fullTrade.feesUsdt ?? 0) > 0 ? (fullTrade.feesUsdt ?? 0) : (prev.feesUsdt || 0);
    const mergedTotalFees = fullTrade.totalFeesUsdt !== undefined && fullTrade.totalFeesUsdt > 0 ? fullTrade.totalFeesUsdt : (prev.totalFeesUsdt || mergedFees);
    const mergedFunding = fullTrade.fundingClaimedUsdt !== undefined ? fullTrade.fundingClaimedUsdt : prev.fundingClaimedUsdt;
    const prevPriceSpread = prev.priceSpreadPnlUsdt !== undefined
      ? prev.priceSpreadPnlUsdt
      : (prev.netHarvestUsdt !== undefined && prev.fundingClaimedUsdt !== undefined
          ? parseFloat((prev.netHarvestUsdt - prev.fundingClaimedUsdt + (prev.feesUsdt || 0)).toFixed(4))
          : (prev.realizedPnl !== undefined && prev.fundingClaimedUsdt !== undefined && (prev.status === "CLOSED" || prev.type === "AUTONOMOUS_SERVER_CLOSE")
              ? parseFloat((prev.realizedPnl - prev.fundingClaimedUsdt + (prev.feesUsdt || 0)).toFixed(4))
              : prev.realizedPnl));
    const mergedPricePnl = fullTrade.priceSpreadPnlUsdt !== undefined ? fullTrade.priceSpreadPnlUsdt : prevPriceSpread;
    const mergedNetHarvest = parseFloat(((mergedPricePnl || 0) + (mergedFunding || 0) - (mergedTotalFees || 0)).toFixed(4));

    updated[existingIdx] = {
      ...prev,
      ...fullTrade,
      leg1OrderId: fullTrade.leg1OrderId || prev.leg1OrderId,
      leg2OrderId: fullTrade.leg2OrderId || prev.leg2OrderId,
      closeLeg1OrderId: fullTrade.closeLeg1OrderId || prev.closeLeg1OrderId,
      closeLeg2OrderId: fullTrade.closeLeg2OrderId || prev.closeLeg2OrderId,
      closeLeg1Price: fullTrade.closeLeg1Price || prev.closeLeg1Price,
      closeLeg2Price: fullTrade.closeLeg2Price || prev.closeLeg2Price,
      leg1FeeUsdt: fullTrade.leg1FeeUsdt ?? prev.leg1FeeUsdt,
      leg2FeeUsdt: fullTrade.leg2FeeUsdt ?? prev.leg2FeeUsdt,
      closeLeg1FeeUsdt: fullTrade.closeLeg1FeeUsdt ?? prev.closeLeg1FeeUsdt,
      closeLeg2FeeUsdt: fullTrade.closeLeg2FeeUsdt ?? prev.closeLeg2FeeUsdt,
      leg1LatencyMs: fullTrade.leg1LatencyMs ?? prev.leg1LatencyMs,
      leg2LatencyMs: fullTrade.leg2LatencyMs ?? prev.leg2LatencyMs,
      interLegDeltaMs: (fullTrade.leg1LatencyMs != null && fullTrade.leg2LatencyMs != null)
        ? Math.abs(fullTrade.leg2LatencyMs - fullTrade.leg1LatencyMs)
        : (fullTrade.interLegDeltaMs || prev.interLegDeltaMs),
      closeLeg1LatencyMs: fullTrade.closeLeg1LatencyMs ?? prev.closeLeg1LatencyMs,
      closeLeg2LatencyMs: fullTrade.closeLeg2LatencyMs ?? prev.closeLeg2LatencyMs,
      closeInterLegDeltaMs: (fullTrade.closeLeg1LatencyMs != null && fullTrade.closeLeg2LatencyMs != null)
        ? Math.abs(fullTrade.closeLeg2LatencyMs - fullTrade.closeLeg1LatencyMs)
        : (fullTrade.closeInterLegDeltaMs ?? prev.closeInterLegDeltaMs),
      entryDivergencePct: fullTrade.entryDivergencePct ?? prev.entryDivergencePct,
      closeDivergencePct: fullTrade.closeDivergencePct ?? prev.closeDivergencePct,
      isAsymmetricFunding: fullTrade.isAsymmetricFunding ?? prev.isAsymmetricFunding,
      feesUsdt: mergedFees,
      totalFeesUsdt: mergedTotalFees,
      fundingClaimedUsdt: mergedFunding,
      fundingRatePct: fullTrade.fundingRatePct ?? prev.fundingRatePct,
      fundingRateApr: fullTrade.fundingRateApr ?? prev.fundingRateApr,
      fundingVenue: fullTrade.fundingVenue ?? prev.fundingVenue,
      priceSpreadPnlUsdt: mergedPricePnl,
      netHarvestUsdt: mergedNetHarvest,
      realizedPnl: (fullTrade.status === "CLOSED" || prev.status === "CLOSED") ? mergedNetHarvest : fullTrade.realizedPnl,
    };
  } else {
    updated = [fullTrade, ...trades].slice(0, 200);
  }

  // Perfect History Saver: Synchronize parent entry trade with complete close receipt
  if (fullTrade.type === "DUAL_LEG_UNWIND" || fullTrade.status === "CLOSED" || fullTrade.type === "AUTONOMOUS_SERVER_CLOSE" || fullTrade.id.startsWith("CLS-")) {
    const parentHedgeId = fullTrade.id.startsWith("CLS-") ? fullTrade.id.replace(/^CLS-/, "") : null;
    updated = updated.map((t) => {
      const isParentMatch = parentHedgeId ? t.id === parentHedgeId : (t.symbol === fullTrade.symbol && t.status === "ACTIVE" && t.id !== fullTrade.id);
      if (isParentMatch) {
        const cTime = fullTrade.closeTimestamp || now;
        const dur = Math.max(120, cTime - t.timestamp);
        const parentTotalFees = parseFloat(((t.leg1FeeUsdt || 0) + (t.leg2FeeUsdt || 0) + (fullTrade.closeLeg1FeeUsdt || 0) + (fullTrade.closeLeg2FeeUsdt || 0)).toFixed(4)) || fullTrade.totalFeesUsdt || t.totalFeesUsdt || 0;
        return {
          ...t,
          status: "CLOSED" as const,
          closeTimestamp: cTime,
          durationMs: dur,
          closeLeg1Price: fullTrade.closeLeg1Price || fullTrade.leg1Price,
          closeLeg2Price: fullTrade.closeLeg2Price || fullTrade.leg2Price,
          closeLeg1OrderId: fullTrade.closeLeg1OrderId,
          closeLeg2OrderId: fullTrade.closeLeg2OrderId,
          closeLeg1FeeUsdt: fullTrade.closeLeg1FeeUsdt,
          closeLeg2FeeUsdt: fullTrade.closeLeg2FeeUsdt,
          totalFeesUsdt: parentTotalFees,
          feesUsdt: parentTotalFees,
          priceSpreadPnlUsdt: fullTrade.priceSpreadPnlUsdt ?? t.priceSpreadPnlUsdt,
          fundingClaimedUsdt: fullTrade.fundingClaimedUsdt ?? t.fundingClaimedUsdt,
          realizedPnl: fullTrade.realizedPnl,
          netHarvestUsdt: fullTrade.netHarvestUsdt ?? fullTrade.realizedPnl,
          closeDivergencePct: fullTrade.closeDivergencePct,
          returnsPct: t.notionalUsdt && t.notionalUsdt > 0 ? parseFloat(((fullTrade.realizedPnl / t.notionalUsdt) * 100).toFixed(4)) : fullTrade.returnsPct,
        };
      }
      return t;
    });
  }

  saveTrades(updated, targetUser);

  // If trade was recorded globally, also mirror to usr_admin_varsha so admin sees it immediately
  if (targetUser === "global_default") {
    try {
      const adminTrades = loadTrades("usr_admin_varsha");
      if (!adminTrades.some((t) => t.id === fullTrade.id)) {
        saveTrades([fullTrade, ...adminTrades], "usr_admin_varsha");
      }
    } catch {}
  }

  return fullTrade;
}

/**
 * Ingest real fill commission receipt from exchange fill stream or REST response.
 * Eliminates dummy fee assumptions by tying directly to real exchange order fills.
 */
export function ingestExchangeFillReceipt(
  fill: {
    venue: string;
    orderId?: string | number;
    symbol?: string;
    tradeId?: string;
    commissionUsdt?: number;
    feeUsdt?: number;
    gstUsdt?: number;
    feeAsset?: string;
    timestamp?: number;
    side?: string;
    isClose?: boolean;
  },
  userId?: string
): boolean {
  const targetUser = userId || "usr_admin_varsha";
  const trades = loadTrades(targetUser, true);
  const orderIdStr = fill.orderId !== undefined ? String(fill.orderId) : "";
  const tradeIdStr = fill.tradeId !== undefined ? String(fill.tradeId) : "";
  const sym = fill.symbol ? fill.symbol.toUpperCase() : "";
  const feeVal = fill.commissionUsdt !== undefined
    ? fill.commissionUsdt
    : (fill.feeUsdt || 0) + (fill.gstUsdt || 0);
  const feeAmount = Math.abs(typeof feeVal === "number" ? feeVal : parseFloat(String(feeVal || "0")));

  let matched = false;
  const updated = trades.map((t) => {
    if (sym && t.symbol.toUpperCase() !== sym) return t;

    const isTradeIdMatch = Boolean(tradeIdStr && t.id === tradeIdStr);
    const isLeg1 = Boolean(orderIdStr && String(t.leg1OrderId || "") === orderIdStr);
    const isLeg2 = Boolean(orderIdStr && String(t.leg2OrderId || "") === orderIdStr);
    const isCloseLeg1 = Boolean(orderIdStr && String(t.closeLeg1OrderId || "") === orderIdStr);
    const isCloseLeg2 = Boolean(orderIdStr && String(t.closeLeg2OrderId || "") === orderIdStr);

    if (isTradeIdMatch || isLeg1 || isLeg2 || isCloseLeg1 || isCloseLeg2) {
      matched = true;
      const v = (fill.venue || "").toLowerCase();
      const isClose = fill.isClose === true;

      let leg1Fee = t.leg1FeeUsdt || 0;
      let leg2Fee = t.leg2FeeUsdt || 0;
      let close1Fee = t.closeLeg1FeeUsdt || 0;
      let close2Fee = t.closeLeg2FeeUsdt || 0;

      if (isLeg1 || (!isClose && v.includes("binance") && isTradeIdMatch)) {
        leg1Fee = feeAmount;
      } else if (isLeg2 || (!isClose && (v.includes("bybit") || v.includes("bitget")) && isTradeIdMatch)) {
        leg2Fee = feeAmount;
      } else if (isCloseLeg1 || (isClose && v.includes("binance") && isTradeIdMatch)) {
        close1Fee = feeAmount;
      } else if (isCloseLeg2 || (isClose && (v.includes("bybit") || v.includes("bitget")) && isTradeIdMatch)) {
        close2Fee = feeAmount;
      } else {
        leg1Fee = feeAmount;
      }

      const totalFees = parseFloat((leg1Fee + leg2Fee + close1Fee + close2Fee).toFixed(4));
      const funding = t.fundingClaimedUsdt || 0;
      let cleanPriceSpreadPnl: number;
      if (t.priceSpreadPnlUsdt !== undefined) {
        cleanPriceSpreadPnl = t.priceSpreadPnlUsdt;
      } else if (t.netHarvestUsdt !== undefined && t.fundingClaimedUsdt !== undefined) {
        cleanPriceSpreadPnl = parseFloat((t.netHarvestUsdt - t.fundingClaimedUsdt + (t.feesUsdt || t.totalFeesUsdt || 0)).toFixed(4));
      } else if (t.realizedPnl !== undefined && t.fundingClaimedUsdt !== undefined && (t.status === "CLOSED" || t.type === "AUTONOMOUS_SERVER_CLOSE")) {
        cleanPriceSpreadPnl = parseFloat((t.realizedPnl - t.fundingClaimedUsdt + (t.feesUsdt || t.totalFeesUsdt || 0)).toFixed(4));
      } else {
        cleanPriceSpreadPnl = t.realizedPnl !== undefined ? t.realizedPnl : 0;
      }
      const netHarvest = parseFloat((cleanPriceSpreadPnl + funding - totalFees).toFixed(4));

      return {
        ...t,
        leg1FeeUsdt: leg1Fee > 0 ? leg1Fee : t.leg1FeeUsdt,
        leg2FeeUsdt: leg2Fee > 0 ? leg2Fee : t.leg2FeeUsdt,
        closeLeg1FeeUsdt: close1Fee > 0 ? close1Fee : t.closeLeg1FeeUsdt,
        closeLeg2FeeUsdt: close2Fee > 0 ? close2Fee : t.closeLeg2FeeUsdt,
        feesUsdt: totalFees,
        totalFeesUsdt: totalFees,
        priceSpreadPnlUsdt: cleanPriceSpreadPnl,
        netHarvestUsdt: netHarvest,
        realizedPnl: (t.status === "CLOSED" || t.type === "AUTONOMOUS_SERVER_CLOSE") ? netHarvest : t.realizedPnl,
      };
    }
    return t;
  });

  if (matched) {
    saveTrades(updated, targetUser);
  }
  return matched;
}

/**
 * Ingest real funding cash flow transaction into active or completed hedge records.
 * Accurately updates net realized PnL with actual funding payments received or debited.
 */
export function ingestFundingCashFlow(
  funding: {
    venue: string;
    symbol: string;
    amountUsdt?: number;
    fundingAmountUsdt?: number;
    tradeId?: string;
    fundingRatePct?: number;
    fundingRateApr?: number;
    timestamp?: number;
  },
  userId?: string
): boolean {
  const targetUser = userId || "usr_admin_varsha";
  const trades = loadTrades(targetUser, true);
  const sym = funding.symbol.toUpperCase();
  const rawAmt = funding.fundingAmountUsdt !== undefined ? funding.fundingAmountUsdt : funding.amountUsdt;
  const fundingAmount = typeof rawAmt === "number" ? rawAmt : parseFloat(String(rawAmt || "0"));
  const ts = funding.timestamp || Date.now();
  const tradeIdStr = funding.tradeId || "";

  let matched = false;
  const updated = trades.map((t) => {
    if (t.symbol.toUpperCase() !== sym) return t;
    if (tradeIdStr && t.id !== tradeIdStr) return t;

    const openTime = t.timestamp || 0;
    const closeTime = t.closeTimestamp || (t.status === "ACTIVE" ? Date.now() : openTime + 3600000);
    const wasOpenAtTick = Boolean(tradeIdStr && t.id === tradeIdStr) || (ts >= openTime - 60000 && ts <= closeTime + 60000) || t.status === "ACTIVE";

    if (wasOpenAtTick && !matched) {
      matched = true;
      const newFundingClaimed = parseFloat(((t.fundingClaimedUsdt || 0) + fundingAmount).toFixed(4));
      const fees = t.feesUsdt || t.totalFeesUsdt || 0;
      let cleanPriceSpreadPnl: number;
      if (t.priceSpreadPnlUsdt !== undefined) {
        cleanPriceSpreadPnl = t.priceSpreadPnlUsdt;
      } else if (t.netHarvestUsdt !== undefined && t.fundingClaimedUsdt !== undefined) {
        cleanPriceSpreadPnl = parseFloat((t.netHarvestUsdt - t.fundingClaimedUsdt + fees).toFixed(4));
      } else if (t.realizedPnl !== undefined && t.fundingClaimedUsdt !== undefined && (t.status === "CLOSED" || t.type === "AUTONOMOUS_SERVER_CLOSE")) {
        cleanPriceSpreadPnl = parseFloat((t.realizedPnl - t.fundingClaimedUsdt + fees).toFixed(4));
      } else {
        cleanPriceSpreadPnl = t.realizedPnl !== undefined ? t.realizedPnl : 0;
      }
      const netHarvest = parseFloat((cleanPriceSpreadPnl + newFundingClaimed - fees).toFixed(4));

      return {
        ...t,
        fundingClaimedUsdt: newFundingClaimed,
        fundingRatePct: funding.fundingRatePct !== undefined ? funding.fundingRatePct : t.fundingRatePct,
        fundingRateApr: funding.fundingRateApr !== undefined ? funding.fundingRateApr : t.fundingRateApr,
        fundingVenue: funding.venue || t.fundingVenue,
        priceSpreadPnlUsdt: cleanPriceSpreadPnl,
        netHarvestUsdt: netHarvest,
        realizedPnl: (t.status === "CLOSED" || t.type === "AUTONOMOUS_SERVER_CLOSE") ? netHarvest : t.realizedPnl,
      };
    }
    return t;
  });

  if (matched) {
    saveTrades(updated, targetUser);
  }
  return matched;
}

/**
 * Ingest bulk exchange telemetry receipts from Binance and Bybit.
 * Updates trade records with 100% real exchange fill commissions and funding cash flows.
 */
export function ingestExchangeTelemetry(
  telemetry: {
    binanceTrades?: Array<{ orderId: string | number; symbol: string; commission: string | number; realizedPnl?: string | number; time?: number }>;
    bybitExecutions?: Array<{ orderId: string | number; symbol: string; execFee: string | number; execType?: string; execTime?: string | number }>;
    binanceIncome?: Array<{ symbol?: string; incomeType: string; income: string | number; time?: number; info?: string }>;
    bybitTransactions?: Array<{ symbol?: string; type: string; change: string | number; fee?: string | number; orderId?: string; transactionTime?: string | number }>;
  },
  userId?: string
): { updatedCount: number } {
  let count = 0;

  // Ingest Binance Trades (t.commission)
  if (Array.isArray(telemetry.binanceTrades)) {
    for (const t of telemetry.binanceTrades) {
      if (t.orderId && t.commission !== undefined) {
        const ok = ingestExchangeFillReceipt({
          venue: "Binance",
          orderId: t.orderId,
          symbol: t.symbol,
          commissionUsdt: Math.abs(parseFloat(String(t.commission))),
          timestamp: t.time,
        }, userId);
        if (ok) count++;
      }
    }
  }

  // Ingest Bybit Executions (execFee)
  if (Array.isArray(telemetry.bybitExecutions)) {
    for (const e of telemetry.bybitExecutions) {
      if (e.orderId && e.execFee !== undefined) {
        const ok = ingestExchangeFillReceipt({
          venue: "Bybit",
          orderId: e.orderId,
          symbol: e.symbol,
          commissionUsdt: Math.abs(parseFloat(String(e.execFee))),
          timestamp: typeof e.execTime === "string" ? parseInt(e.execTime, 10) : e.execTime,
        }, userId);
        if (ok) count++;
      }
    }
  }

  // Ingest Binance Income (FUNDING_FEE)
  if (Array.isArray(telemetry.binanceIncome)) {
    for (const i of telemetry.binanceIncome) {
      if (i.incomeType === "FUNDING_FEE" && i.symbol) {
        const ok = ingestFundingCashFlow({
          venue: "Binance",
          symbol: i.symbol,
          amountUsdt: parseFloat(String(i.income || "0")),
          timestamp: i.time,
        }, userId);
        if (ok) count++;
      }
    }
  }

  // Ingest Bybit Transactions (SETTLEMENT)
  if (Array.isArray(telemetry.bybitTransactions)) {
    for (const tx of telemetry.bybitTransactions) {
      if (tx.type === "SETTLEMENT" && tx.symbol) {
        const ok = ingestFundingCashFlow({
          venue: "Bybit",
          symbol: tx.symbol,
          amountUsdt: parseFloat(String(tx.change || "0")),
          timestamp: typeof tx.transactionTime === "string" ? parseInt(tx.transactionTime, 10) : tx.transactionTime,
        }, userId);
        if (ok) count++;
      }
    }
  }

  return { updatedCount: count };
}
