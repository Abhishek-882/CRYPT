import { readDataFile, saveDataFile, readUserDataFile, saveUserDataFile } from "./storagePath";
import { recordServerTrade } from "./serverTradeStore";

export interface PaperWallet {
  totalBalance: number;       // Initial default: 10,000.00 USDT
  availableBalance: number;   // totalBalance - lockedMargin
  lockedMargin: number;       // Sum of margin for all active open positions
  unrealizedPnl: number;      // Net mark-to-market PnL across open positions
  realizedPnl: number;        // Cumulative realized PnL from closed positions
  totalFeesPaid: number;      // Cumulative trading fees paid (entry + exit)
  fundingAccrued: number;     // Cumulative funding payments collected/paid
  lastUpdated: number;
}

export interface PaperPositionLeg {
  venue: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  feePaid: number;
  unrealizedPnl: number;
  orderId: string;
}

export interface PaperPosition {
  id: string;
  userId?: string;
  symbol: string;
  direction: "STANDARD_CARRY" | "REVERSE_CARRY";
  quantity: number;
  notionalUsdt: number;
  leverage: number;
  marginLocked: number;
  openTimestamp: number;
  closeTimestamp?: number;
  status: "OPEN" | "CLOSED";
  leg1: PaperPositionLeg; // Binance leg
  leg2: PaperPositionLeg; // Bitget leg
  fundingRateBinance: number;
  fundingRateBitget: number;
  nextFundingTime: number;
  fundingIntervalHours: number;
  fundingAccrued: number;
  netUnrealizedPnl: number;
  totalFees: number;
  isPaper: true;
}

const WALLET_FILE = "paper_wallet.json";
const POSITIONS_FILE = "paper_positions.json";
const DEFAULT_INITIAL_BALANCE = 10000.0;
const BINANCE_TAKER_FEE_RATE = 0.0005; // 0.05%
const BITGET_TAKER_FEE_RATE = 0.0006;  // 0.06%
const SLIPPAGE_RATE = 0.0002;          // 0.02% (2 bps)

// ---------------------------------------------------------------------------
// Precision & Sizing Helper
// ---------------------------------------------------------------------------
export function calculateSafeOrderQuantity(symbol: string, notionalDollars: number, refPrice: number): number {
  if (refPrice <= 0) return 1;
  const safeNotional = Math.max(5.5, notionalDollars); // Binance minimum notional guarantee
  const rawQty = safeNotional / refPrice;

  // Round according to coin price magnitude with minimum quantity guards
  if (refPrice >= 1000) return Math.max(0.001, parseFloat(rawQty.toFixed(3)) || 0.001);     // BTC: 0.001
  if (refPrice >= 50) return Math.max(0.01, parseFloat(rawQty.toFixed(2)) || 0.01);       // SOL/ETH: 0.01
  if (refPrice >= 1) return Math.max(0.1, parseFloat(rawQty.toFixed(1)) || 0.1);        // Mid coins: 0.1
  if (refPrice >= 0.01) return Math.max(1, Math.round(rawQty) || 1);   // Penny coins: 1
  return Math.max(1000, Math.round(rawQty / 1000) * 1000 || 1000);        // Micro coins (PEPE/SHIB): whole thousands
}

// ---------------------------------------------------------------------------
// Wallet State Management
// ---------------------------------------------------------------------------
export function loadPaperWallet(userId?: string): PaperWallet {
  let wallet: PaperWallet | null = null;
  if (userId && userId !== "global_default") {
    wallet = readUserDataFile<PaperWallet | null>(userId, WALLET_FILE, null);
  }
  if (!wallet) {
    wallet = readDataFile<PaperWallet | null>(WALLET_FILE, null);
  }

  if (!wallet || typeof wallet.totalBalance !== "number") {
    wallet = {
      totalBalance: DEFAULT_INITIAL_BALANCE,
      availableBalance: DEFAULT_INITIAL_BALANCE,
      lockedMargin: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      totalFeesPaid: 0,
      fundingAccrued: 0,
      lastUpdated: Date.now(),
    };
    savePaperWallet(wallet, userId);
  }

  return wallet;
}

export function savePaperWallet(wallet: PaperWallet, userId?: string): void {
  wallet.lastUpdated = Date.now();
  if (userId && userId !== "global_default") {
    saveUserDataFile(userId, WALLET_FILE, wallet);
  }
  saveDataFile(WALLET_FILE, wallet);
}

export function resetPaperWallet(userId?: string): PaperWallet {
  // Close any remaining open positions
  const openPositions = loadPaperPositions(userId, "OPEN");
  for (const pos of openPositions) {
    pos.status = "CLOSED";
    pos.closeTimestamp = Date.now();
  }
  savePaperPositions(openPositions, userId);

  const freshWallet: PaperWallet = {
    totalBalance: DEFAULT_INITIAL_BALANCE,
    availableBalance: DEFAULT_INITIAL_BALANCE,
    lockedMargin: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalFeesPaid: 0,
    fundingAccrued: 0,
    lastUpdated: Date.now(),
  };

  savePaperWallet(freshWallet, userId);
  return freshWallet;
}

// ---------------------------------------------------------------------------
// Position State Management
// ---------------------------------------------------------------------------
export function loadPaperPositions(userId?: string, filter: "OPEN" | "CLOSED" | "ALL" = "OPEN"): PaperPosition[] {
  let list: PaperPosition[] = [];
  if (userId && userId !== "global_default") {
    list = readUserDataFile<PaperPosition[]>(userId, POSITIONS_FILE, []);
  }
  if (!list || list.length === 0) {
    list = readDataFile<PaperPosition[]>(POSITIONS_FILE, []);
  }

  if (!Array.isArray(list)) list = [];

  if (filter === "OPEN") {
    return list.filter((p) => p.status === "OPEN");
  }
  if (filter === "CLOSED") {
    return list.filter((p) => p.status === "CLOSED");
  }
  return list;
}

export function savePaperPositions(positions: PaperPosition[], userId?: string): void {
  if (userId && userId !== "global_default") {
    saveUserDataFile(userId, POSITIONS_FILE, positions);
  }
  saveDataFile(POSITIONS_FILE, positions);
}

// ---------------------------------------------------------------------------
// High-Precision Execution Simulator
// ---------------------------------------------------------------------------
export interface ExecutePaperHedgeParams {
  symbol: string;
  notional?: number;
  quantity?: number;
  direction?: "STANDARD_CARRY" | "REVERSE_CARRY";
  leverage?: number;
  liveBnPrice?: number;
  liveBgPrice?: number;
  bnRate?: number;
  bgRate?: number;
  nextFundingTime?: number;
  userId?: string;
  leg1Venue?: string;
  leg2Venue?: string;
}

export function executePaperHedge(params: ExecutePaperHedgeParams): {
  success: boolean;
  position?: PaperPosition;
  wallet?: PaperWallet;
  error?: string;
} {
  const symbol = params.symbol.toUpperCase();
  const direction = params.direction || "STANDARD_CARRY";
  const leverage = Math.min(20, Math.max(1, params.leverage || 10));
  const liveBnPrice = params.liveBnPrice && params.liveBnPrice > 0 ? params.liveBnPrice : 100;
  const liveBgPrice = params.liveBgPrice && params.liveBgPrice > 0 ? params.liveBgPrice : liveBnPrice;

  // Resolve quantity and notional
  let qty = params.quantity && params.quantity > 0 ? params.quantity : 0;
  if (qty <= 0) {
    qty = calculateSafeOrderQuantity(symbol, params.notional || 25.0, liveBnPrice);
  }
  let notional = params.notional && params.notional > 0 ? params.notional : qty * liveBnPrice;
  if (notional <= 0) {
    notional = qty * liveBnPrice;
  }

  // Enforce Minimum Notional
  if (notional < 5.0) {
    return {
      success: false,
      error: `Notional $${notional.toFixed(2)} is below minimum $5.00 notional threshold.`,
    };
  }

  const wallet = loadPaperWallet(params.userId);
  const marginRequired = (notional / leverage) * 2; // Both legs require margin
  if (wallet.availableBalance < marginRequired) {
    return {
      success: false,
      error: `Insufficient available paper balance ($${wallet.availableBalance.toFixed(2)}). Required margin: $${marginRequired.toFixed(2)}.`,
    };
  }

  // Direction resolution:
  // STANDARD_CARRY: Binance SELL (Short), Bitget BUY (Long)
  // REVERSE_CARRY:  Binance BUY (Long), Bitget SELL (Short)
  const bnSide: "SELL" | "BUY" = direction === "STANDARD_CARRY" ? "SELL" : "BUY";
  const bgSide: "BUY" | "SELL" = direction === "STANDARD_CARRY" ? "BUY" : "SELL";

  // Simulate realistic fill price with slippage
  const bnFillPrice = bnSide === "BUY"
    ? liveBnPrice * (1 + SLIPPAGE_RATE)
    : liveBnPrice * (1 - SLIPPAGE_RATE);

  const bgFillPrice = bgSide === "BUY"
    ? liveBgPrice * (1 + SLIPPAGE_RATE)
    : liveBgPrice * (1 - SLIPPAGE_RATE);

  // Calculate taker fees
  const bnFee = qty * bnFillPrice * BINANCE_TAKER_FEE_RATE;
  const bgFee = qty * bgFillPrice * BITGET_TAKER_FEE_RATE;
  const totalFees = bnFee + bgFee;

  const now = Date.now();
  const positionId = `paper_hedge_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const position: PaperPosition = {
    id: positionId,
    userId: params.userId,
    symbol,
    direction,
    quantity: qty,
    notionalUsdt: parseFloat(notional.toFixed(4)),
    leverage,
    marginLocked: parseFloat(marginRequired.toFixed(4)),
    openTimestamp: now,
    status: "OPEN",
    leg1: {
      venue: params.leg1Venue || "Binance",
      side: bnSide,
      quantity: qty,
      entryPrice: parseFloat(bnFillPrice.toFixed(6)),
      currentPrice: parseFloat(liveBnPrice.toFixed(6)),
      feePaid: parseFloat(bnFee.toFixed(6)),
      unrealizedPnl: 0,
      orderId: `SIM_L1_${Date.now()}`,
    },
    leg2: {
      venue: params.leg2Venue || "Bitget",
      side: bgSide,
      quantity: qty,
      entryPrice: parseFloat(bgFillPrice.toFixed(6)),
      currentPrice: parseFloat(liveBgPrice.toFixed(6)),
      feePaid: parseFloat(bgFee.toFixed(6)),
      unrealizedPnl: 0,
      orderId: `SIM_L2_${Date.now()}`,
    },
    fundingRateBinance: params.bnRate || 0,
    fundingRateBitget: params.bgRate || 0,
    nextFundingTime: params.nextFundingTime || (now + 8 * 3600 * 1000),
    fundingIntervalHours: 8,
    fundingAccrued: 0,
    netUnrealizedPnl: -parseFloat(totalFees.toFixed(4)), // Starts with fee drag
    totalFees: parseFloat(totalFees.toFixed(4)),
    isPaper: true,
  };

  // Update wallet balances
  wallet.lockedMargin += marginRequired;
  wallet.totalFeesPaid += totalFees;
  wallet.totalBalance -= totalFees; // Fees deducted from capital
  wallet.availableBalance = wallet.totalBalance - wallet.lockedMargin;
  savePaperWallet(wallet, params.userId);

  // Save new position
  const allPositions = loadPaperPositions(params.userId, "ALL");
  allPositions.unshift(position);
  savePaperPositions(allPositions, params.userId);

  // Record trade history in server trade store
  try {
    const v1 = params.leg1Venue || "Binance";
    const v2 = params.leg2Venue || "Bitget";
    recordServerTrade({
      id: positionId,
      userId: params.userId,
      timestamp: now,
      symbol,
      type: "PAPER_HEDGE",
      directionLabel: direction === "STANDARD_CARRY" ? `Short ${v1} / Long ${v2}` : `Long ${v1} / Short ${v2}`,
      quantity: qty,
      notionalUsdt: notional,
      leg1Venue: `${v1} (Paper)`,
      leg1Side: bnSide,
      leg1Price: bnFillPrice,
      leg1OrderId: position.leg1.orderId,
      leg2Venue: `${v2} (Paper)`,
      leg2Side: bgSide,
      leg2Price: bgFillPrice,
      leg2OrderId: position.leg2.orderId,
      interLegDeltaMs: 12, // Sub-millisecond simulated atomic delta
      realizedPnl: 0,
      feesUsdt: totalFees,
      status: "ACTIVE",
      mode: "paper",
      isRealMainnet: false,
    });
  } catch {}

  return {
    success: true,
    position,
    wallet,
  };
}

// ---------------------------------------------------------------------------
// Position Closure Simulator
// ---------------------------------------------------------------------------
export function closePaperPosition(
  positionIdOrSymbol: string,
  liveBnPrice?: number,
  liveBgPrice?: number,
  userId?: string
): {
  success: boolean;
  closedPosition?: PaperPosition;
  closedPositions?: PaperPosition[];
  count?: number;
  wallet?: PaperWallet;
  error?: string;
} {
  const allPositions = loadPaperPositions(userId, "ALL");
  const isCloseAll = !positionIdOrSymbol || positionIdOrSymbol.toUpperCase() === "ALL";

  const targets = isCloseAll
    ? allPositions.filter((p) => p.status === "OPEN")
    : allPositions.filter((p) => p.status === "OPEN" && (p.id === positionIdOrSymbol || p.symbol === positionIdOrSymbol.toUpperCase()));

  if (targets.length === 0) {
    const wallet = loadPaperWallet(userId);
    return {
      success: true,
      count: 0,
      closedPositions: [],
      wallet,
    };
  }

  const wallet = loadPaperWallet(userId);
  const closedList: PaperPosition[] = [];

  for (const target of targets) {
    const bnExitPrice = liveBnPrice && liveBnPrice > 0 ? liveBnPrice : target.leg1.currentPrice;
    const bgExitPrice = liveBgPrice && liveBgPrice > 0 ? liveBgPrice : target.leg2.currentPrice;

    // Calculate exit slippage
    const actualBnExit = target.leg1.side === "SELL"
      ? bnExitPrice * (1 + SLIPPAGE_RATE) // Buying to cover Short
      : bnExitPrice * (1 - SLIPPAGE_RATE); // Selling to close Long

    const actualBgExit = target.leg2.side === "BUY"
      ? bgExitPrice * (1 - SLIPPAGE_RATE) // Selling to close Long
      : bgExitPrice * (1 + SLIPPAGE_RATE); // Buying to cover Short

    // PnL per leg
    const leg1Pnl = target.leg1.side === "SELL"
      ? (target.leg1.entryPrice - actualBnExit) * target.quantity
      : (actualBnExit - target.leg1.entryPrice) * target.quantity;

    const leg2Pnl = target.leg2.side === "BUY"
      ? (actualBgExit - target.leg2.entryPrice) * target.quantity
      : (target.leg2.entryPrice - actualBgExit) * target.quantity;

    // Exit trading fees
    const exitBnFee = target.quantity * actualBnExit * BINANCE_TAKER_FEE_RATE;
    const exitBgFee = target.quantity * actualBgExit * BITGET_TAKER_FEE_RATE;
    const exitFees = exitBnFee + exitBgFee;

    const netRealizedPnl = leg1Pnl + leg2Pnl + target.fundingAccrued - exitFees;

    target.status = "CLOSED";
    target.closeTimestamp = Date.now();
    target.totalFees += exitFees;
    target.netUnrealizedPnl = 0;

    // Update wallet
    wallet.lockedMargin = Math.max(0, wallet.lockedMargin - target.marginLocked);
    wallet.realizedPnl += netRealizedPnl;
    wallet.totalFeesPaid += exitFees;
    wallet.totalBalance += netRealizedPnl; // Realized PnL credited/debited
    wallet.availableBalance = wallet.totalBalance - wallet.lockedMargin;

    closedList.push(target);

    // Update server trade store
    try {
      recordServerTrade({
        id: target.id,
        userId,
        timestamp: target.openTimestamp,
        closeTimestamp: target.closeTimestamp,
        durationMs: target.closeTimestamp - target.openTimestamp,
        symbol: target.symbol,
        type: "PAPER_HEDGE",
        directionLabel: target.direction === "STANDARD_CARRY" ? "Short Leg1 / Long Leg2" : "Long Leg1 / Short Leg2",
        quantity: target.quantity,
        notionalUsdt: target.notionalUsdt,
        leg1Venue: target.leg1.venue || "Leg1 (Paper)",
        leg1Side: target.leg1.side === "SELL" ? "BUY (Close)" : "SELL (Close)",
        leg1Price: actualBnExit,
        leg1OrderId: `CLOSE_${target.leg1.orderId}`,
        leg2Venue: target.leg2.venue || "Leg2 (Paper)",
        leg2Side: target.leg2.side === "BUY" ? "SELL (Close)" : "BUY (Close)",
        leg2Price: actualBgExit,
        leg2OrderId: `CLOSE_${target.leg2.orderId}`,
        interLegDeltaMs: 15,
        realizedPnl: parseFloat(netRealizedPnl.toFixed(4)),
        returnsPct: target.marginLocked > 0 ? parseFloat(((netRealizedPnl / target.marginLocked) * 100).toFixed(2)) : 0,
        feesUsdt: target.totalFees,
        status: "CLOSED",
        mode: "paper",
        isRealMainnet: false,
      });
    } catch {}
  }

  savePaperPositions(allPositions, userId);
  savePaperWallet(wallet, userId);

  return {
    success: true,
    closedPosition: closedList[0],
    closedPositions: closedList,
    count: closedList.length,
    wallet,
  };
}

// ---------------------------------------------------------------------------
// Dynamic Mark Price & Unrealized PnL Updater
// ---------------------------------------------------------------------------
export function updatePaperPositionsPrices(
  priceMap: Record<string, { bnPrice?: number; bgPrice?: number }>,
  userId?: string
): { positions: PaperPosition[]; wallet: PaperWallet } {
  const allPositions = loadPaperPositions(userId, "ALL");
  let totalUnrealized = 0;

  for (const pos of allPositions) {
    if (pos.status !== "OPEN") continue;
    const ticks = priceMap[pos.symbol];
    if (ticks) {
      if (ticks.bnPrice && ticks.bnPrice > 0) {
        pos.leg1.currentPrice = ticks.bnPrice;
        pos.leg1.unrealizedPnl = pos.leg1.side === "SELL"
          ? (pos.leg1.entryPrice - ticks.bnPrice) * pos.quantity
          : (ticks.bnPrice - pos.leg1.entryPrice) * pos.quantity;
      }
      if (ticks.bgPrice && ticks.bgPrice > 0) {
        pos.leg2.currentPrice = ticks.bgPrice;
        pos.leg2.unrealizedPnl = pos.leg2.side === "BUY"
          ? (ticks.bgPrice - pos.leg2.entryPrice) * pos.quantity
          : (pos.leg2.entryPrice - ticks.bgPrice) * pos.quantity;
      }
    }
    pos.netUnrealizedPnl = pos.leg1.unrealizedPnl + pos.leg2.unrealizedPnl + pos.fundingAccrued;
    totalUnrealized += pos.netUnrealizedPnl;
  }

  savePaperPositions(allPositions, userId);

  const wallet = loadPaperWallet(userId);
  wallet.unrealizedPnl = totalUnrealized;
  savePaperWallet(wallet, userId);

  return {
    positions: allPositions.filter((p) => p.status === "OPEN"),
    wallet,
  };
}
