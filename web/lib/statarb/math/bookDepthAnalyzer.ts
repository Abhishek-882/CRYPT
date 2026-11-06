/**
 * STATARB-OU-PERP: L2 Order Book Depth Cushion Analyzer
 * 
 * Evaluates cumulative resting liquidity within a tight basis-point window
 * (default: 10 bps from best bid/ask) to ensure orders can execute without
 * adverse slippage.
 * 
 * Gate 3 requires:
 * DepthRatio = min(BinanceDepth_10bps, BybitDepth_10bps) / OrderNotional >= 4.0x
 * (e.g. $15 USDT standard notional requires >= $60 USDT cumulative depth on both venues).
 */

import { L2OrderBookSnapshot, L2Level, BookDepthResult } from '../types';

export interface DualVenueDepthResult {
  binanceDepth: BookDepthResult;
  bybitDepth: BookDepthResult;
  combinedDepthRatio: number;
  passed: boolean;
  reasons: string[];
}

export interface VwapSweepResult {
  targetNotionalUsdt: number;
  filledNotionalUsdt: number;
  vwapPrice: number;
  topOfBookPrice: number;
  slippageBps: number;
  fullyFilled: boolean;
  levelsConsumed: number;
}

/**
 * Default depth cushion parameters
 */
export const DEFAULT_DEPTH_CONFIG = {
  depthWindowBps: 10.0, // 10 bps (0.10%) window around best bid/ask
  defaultTargetNotionalUsdt: 15.0, // Standard slot size $15 USDT
  requiredMultiplier: 4.0, // 4.0x required cushion ($60 USDT for $15 notional)
} as const;

/**
 * Analyzes cumulative L2 orderbook depth within a specified basis-point window
 * around the best bid/ask.
 * 
 * @param snapshot L2 orderbook snapshot with bids and asks
 * @param targetNotionalUsdt Target order size in USDT (default: 15.0)
 * @param depthWindowBps Basis point window within which liquidity is aggregated (default: 10.0)
 * @param requiredMultiplier Required multiple of target notional (default: 4.0)
 * @returns BookDepthResult with aggregated depths, depth ratio, and sufficiency status
 */
export function analyzeOrderBookDepth(
  snapshot: L2OrderBookSnapshot,
  targetNotionalUsdt: number = DEFAULT_DEPTH_CONFIG.defaultTargetNotionalUsdt,
  depthWindowBps: number = DEFAULT_DEPTH_CONFIG.depthWindowBps,
  requiredMultiplier: number = DEFAULT_DEPTH_CONFIG.requiredMultiplier
): BookDepthResult {
  const notional = targetNotionalUsdt > 0 ? targetNotionalUsdt : DEFAULT_DEPTH_CONFIG.defaultTargetNotionalUsdt;

  if (
    !snapshot ||
    !Array.isArray(snapshot.bids) ||
    !Array.isArray(snapshot.asks) ||
    snapshot.bids.length === 0 ||
    snapshot.asks.length === 0
  ) {
    return {
      bidDepthUsdt: 0,
      askDepthUsdt: 0,
      cumulativeDepthUsdt: 0,
      depthRatio: 0,
      bestBid: 0,
      bestAsk: 0,
      midPrice: 0,
      spreadBps: 0,
      hasSufficientDepth: false,
    };
  }

  const bestBid = snapshot.bids[0][0];
  const bestAsk = snapshot.asks[0][0];

  if (bestBid <= 0 || bestAsk <= 0 || bestAsk < bestBid) {
    return {
      bidDepthUsdt: 0,
      askDepthUsdt: 0,
      cumulativeDepthUsdt: 0,
      depthRatio: 0,
      bestBid,
      bestAsk,
      midPrice: 0,
      spreadBps: 0,
      hasSufficientDepth: false,
    };
  }

  const midPrice = (bestBid + bestAsk) / 2.0;
  const spreadBps = ((bestAsk - bestBid) / midPrice) * 10000.0;

  // Window thresholds in price units
  const askCutoffPrice = bestAsk * (1.0 + depthWindowBps / 10000.0);
  const bidCutoffPrice = bestBid * (1.0 - depthWindowBps / 10000.0);

  // Aggregate ask depth (liquidity for buy orders) within +10 bps
  let askDepthUsdt = 0;
  for (const [price, qty] of snapshot.asks) {
    if (price <= askCutoffPrice && price > 0 && qty > 0) {
      askDepthUsdt += price * qty;
    } else if (price > askCutoffPrice) {
      break; // Sorted ascending
    }
  }

  // Aggregate bid depth (liquidity for sell orders) within -10 bps
  let bidDepthUsdt = 0;
  for (const [price, qty] of snapshot.bids) {
    if (price >= bidCutoffPrice && price > 0 && qty > 0) {
      bidDepthUsdt += price * qty;
    } else if (price < bidCutoffPrice) {
      break; // Sorted descending
    }
  }

  const cumulativeDepthUsdt = askDepthUsdt + bidDepthUsdt;
  // Conservative evaluation uses the tighter side (min of bid and ask depth)
  const minSideDepthUsdt = Math.min(bidDepthUsdt, askDepthUsdt);
  const depthRatio = minSideDepthUsdt / notional;
  const hasSufficientDepth = depthRatio >= requiredMultiplier;

  return {
    bidDepthUsdt,
    askDepthUsdt,
    cumulativeDepthUsdt,
    depthRatio,
    bestBid,
    bestAsk,
    midPrice,
    spreadBps,
    hasSufficientDepth,
  };
}

/**
 * Evaluates dual-venue L2 depth across Binance USD-M and Bybit Linear to enforce Gate 3.
 * 
 * @param binanceBook L2 orderbook snapshot from Binance
 * @param bybitBook L2 orderbook snapshot from Bybit
 * @param targetNotionalUsdt Target order size in USDT
 * @param depthWindowBps Window size in basis points (default: 10.0)
 * @param requiredMultiplier Minimum required multiplier (default: 4.0)
 * @returns DualVenueDepthResult
 */
export function evaluateDualVenueDepth(
  binanceBook: L2OrderBookSnapshot,
  bybitBook: L2OrderBookSnapshot,
  targetNotionalUsdt: number = DEFAULT_DEPTH_CONFIG.defaultTargetNotionalUsdt,
  depthWindowBps: number = DEFAULT_DEPTH_CONFIG.depthWindowBps,
  requiredMultiplier: number = DEFAULT_DEPTH_CONFIG.requiredMultiplier
): DualVenueDepthResult {
  const binanceDepth = analyzeOrderBookDepth(binanceBook, targetNotionalUsdt, depthWindowBps, requiredMultiplier);
  const bybitDepth = analyzeOrderBookDepth(bybitBook, targetNotionalUsdt, depthWindowBps, requiredMultiplier);

  const combinedDepthRatio = Math.min(binanceDepth.depthRatio, bybitDepth.depthRatio);
  const passed = combinedDepthRatio >= requiredMultiplier;

  const reasons: string[] = [];
  if (binanceDepth.hasSufficientDepth) {
    reasons.push(`Binance depth cushion ${binanceDepth.depthRatio.toFixed(2)}x >= ${requiredMultiplier}x [PASS]`);
  } else {
    reasons.push(`Binance depth cushion ${binanceDepth.depthRatio.toFixed(2)}x < ${requiredMultiplier}x [FAIL]`);
  }

  if (bybitDepth.hasSufficientDepth) {
    reasons.push(`Bybit depth cushion ${bybitDepth.depthRatio.toFixed(2)}x >= ${requiredMultiplier}x [PASS]`);
  } else {
    reasons.push(`Bybit depth cushion ${bybitDepth.depthRatio.toFixed(2)}x < ${requiredMultiplier}x [FAIL]`);
  }

  return {
    binanceDepth,
    bybitDepth,
    combinedDepthRatio,
    passed,
    reasons,
  };
}

/**
 * Simulates sweeping orderbook levels to calculate Volume-Weighted Average Price (VWAP)
 * and expected slippage for an immediate execution of targetNotionalUsdt.
 * 
 * @param levels Sorted order book levels (asks for BUY, bids for SELL)
 * @param targetNotionalUsdt Target notional in USDT to sweep
 * @param side 'BUY' | 'SELL'
 * @returns VwapSweepResult
 */
export function calculateVwapSlippage(
  levels: L2Level[],
  targetNotionalUsdt: number,
  side: 'BUY' | 'SELL'
): VwapSweepResult {
  if (!levels || levels.length === 0 || targetNotionalUsdt <= 0) {
    return {
      targetNotionalUsdt,
      filledNotionalUsdt: 0,
      vwapPrice: 0,
      topOfBookPrice: 0,
      slippageBps: 0,
      fullyFilled: false,
      levelsConsumed: 0,
    };
  }

  const topOfBookPrice = levels[0][0];
  let remainingNotional = targetNotionalUsdt;
  let accumulatedCost = 0;
  let accumulatedQuantity = 0;
  let levelsConsumed = 0;

  for (const [price, qty] of levels) {
    if (price <= 0 || qty <= 0) continue;
    levelsConsumed++;

    const levelNotional = price * qty;
    if (remainingNotional <= levelNotional) {
      const neededQty = remainingNotional / price;
      accumulatedCost += neededQty * price;
      accumulatedQuantity += neededQty;
      remainingNotional = 0;
      break;
    } else {
      accumulatedCost += levelNotional;
      accumulatedQuantity += qty;
      remainingNotional -= levelNotional;
    }
  }

  const filledNotionalUsdt = targetNotionalUsdt - remainingNotional;
  const fullyFilled = remainingNotional <= 1e-6;
  const vwapPrice = accumulatedQuantity > 0 ? accumulatedCost / accumulatedQuantity : topOfBookPrice;

  // Slippage calculation:
  // For BUY: higher VWAP is adverse -> (vwap - top) / top * 10000
  // For SELL: lower VWAP is adverse -> (top - vwap) / top * 10000
  let slippageBps = 0;
  if (topOfBookPrice > 0 && vwapPrice > 0) {
    if (side === 'BUY') {
      slippageBps = ((vwapPrice - topOfBookPrice) / topOfBookPrice) * 10000.0;
    } else {
      slippageBps = ((topOfBookPrice - vwapPrice) / topOfBookPrice) * 10000.0;
    }
  }

  return {
    targetNotionalUsdt,
    filledNotionalUsdt,
    vwapPrice,
    topOfBookPrice,
    slippageBps: Math.max(0, slippageBps),
    fullyFilled,
    levelsConsumed,
  };
}
