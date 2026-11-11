export interface ServerHedgeTrade {
  id: string;
  userId?: string;
  timestamp: number; // Open timestamp
  closeTimestamp?: number; // Close timestamp
  durationMs?: number; // Latency / duration between hedge open and close
  symbol: string;
  type: string;
  directionLabel: string;
  quantity: number | string;
  notionalUsdt?: number;
  leg1Venue: string;
  leg1Side: string;
  leg1Price: number;
  leg1OrderId?: string | number;
  leg1PlacedAt?: number;
  leg1LatencyMs?: number;
  leg2Venue: string;
  leg2Side: string;
  leg2Price: number;
  leg2OrderId?: string | number;
  leg2PlacedAt?: number;
  leg2LatencyMs?: number;
  interLegDeltaMs: number;
  botId?: string;
  botName?: string;
  closeLeg1PlacedAt?: number;
  closeLeg1LatencyMs?: number;
  closeLeg2PlacedAt?: number;
  closeLeg2LatencyMs?: number;
  closeInterLegDeltaMs?: number;
  realizedPnl: number;
  returnsPct?: number;
  feesUsdt?: number;
  status: "ACTIVE" | "CONFIRMED" | "CLOSED" | "DELTA_NEUTRAL" | "FAILED_UNWOUND" | "ABORTED_UNWOUND";
  mode?: "mainnet" | "paper" | "testnet";
  isRealMainnet?: boolean;
  tradeCategory?: "BOT_TRADE" | "MANUAL_TERMINAL";
  settlementCycle?: string; // e.g. "08:00:00 UTC", "04:00:00 UTC"
  // Funding Harvest Telemetry
  fundingClaimedUsdt?: number; // Net funding fee received / paid (+ or -)
  fundingGotUsdt?: number; // Gross funding collected from paying leg
  fundingPaidUsdt?: number; // Gross funding paid on charging leg
  fundingRateVenueA?: number;
  fundingRateVenueB?: number;
  fundingVenueA?: number;
  fundingVenueB?: number;
  expectedSlippagePct?: number;
  bidAskSpreadBps?: number;
  unwindReason?: string;
  notes?: string;
  direction?: string;
  fundingRatePct?: number; // Funding rate % applied at settlement (e.g. -0.7304%)
  fundingRateApr?: number; // Annualized percentage rate (e.g. 1117.3%)
  fundingVenue?: string; // Venue where funding was settled / claimed
  priceSpreadPnlUsdt?: number; // Gross price difference PnL between entry and exit legs
  netHarvestUsdt?: number; // Total net bottom line (Funding + Price Spread - Fees)
  transport?: "WEBSOCKET" | "REST" | "REST_FALLBACK";
  // Real Exchange Commission Receipts
  leg1FeeUsdt?: number;
  leg2FeeUsdt?: number;
  closeLeg1FeeUsdt?: number;
  closeLeg2FeeUsdt?: number;
  totalFeesUsdt?: number;
  closeLeg1OrderId?: string | number;
  closeLeg2OrderId?: string | number;
  closeLeg1Price?: number;
  closeLeg2Price?: number;
  entryDivergencePct?: number;
  closeDivergencePct?: number;
  entryPriceSpreadBps?: number;
  isAsymmetricFunding?: boolean;
  venueAIntervalHours?: number;
  venueBIntervalHours?: number;
}

export function isTodayTrade(timestamp: number): boolean {
  if (!timestamp) return false;
  const tradeDate = new Date(timestamp);
  const nowDate = new Date();
  return (
    tradeDate.getFullYear() === nowDate.getFullYear() &&
    tradeDate.getMonth() === nowDate.getMonth() &&
    tradeDate.getDate() === nowDate.getDate()
  );
}

export function isRealMainnetTrade(trade: Partial<ServerHedgeTrade>): boolean {
  if (trade.isRealMainnet === true) return true;
  if (trade.isRealMainnet === false) return false;
  if (trade.mode === "mainnet") return true;
  if (trade.mode === "paper" || trade.mode === "testnet") return false;

  const id = String(trade.id || "").toLowerCase();
  const type = String(trade.type || "").toUpperCase();
  const leg1 = String(trade.leg1Venue || "").toLowerCase();
  const leg2 = String(trade.leg2Venue || "").toLowerCase();

  // Explicit Paper indicators
  if (id.startsWith("paper_") || type.includes("PAPER") || leg1.includes("paper") || leg2.includes("paper")) {
    return false;
  }

  // Explicit Testnet indicators
  if (type.includes("TESTNET") || leg1.includes("testnet") || leg2.includes("testnet")) {
    return false;
  }

  // Live Mainnet indicators
  if (
    type.includes("LIVE_MAINNET") ||
    leg1.includes("mainnet") ||
    leg2.includes("mainnet") ||
    type === "DUAL_LEG_UNWIND"
  ) {
    return true;
  }

  // Live production venues
  if (
    leg1.includes("coindcx") ||
    leg2.includes("coindcx") ||
    leg1.includes("bybit") ||
    leg2.includes("bybit")
  ) {
    return true;
  }

  return false;
}
