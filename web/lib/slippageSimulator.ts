/**
 * Pure Mathematical Pre-Trade Slippage, Liquidity & Net Funding Yield Simulator Engine
 * 
 * CRITICAL INVARIANT:
 * - Purely analytical / visual simulation library.
 * - ZERO side effects; does NOT touch or trigger live bot execution routines.
 * - Fully deterministic and unit-tested.
 * 
 * Requirements:
 * - R1: Non-disruptive simulator widget in Terminal UI
 * - R2: Dual-exchange VWAP calculation & Price Parity Check (tolerance <= 0.1%)
 * - R3: Token quantity & capital preservation telemetry
 * - R4: Round-trip taker fee (default 24 bps) & exit value calculation
 * - R5: Net Funding Arbitrage PnL equation
 * - R6: Margin & Leverage dual-controls (No hard blocking; sweeps Notional depth)
 * - R7: Return on Equity (ROE %) & Itemized loss-impact breakdown (USDT and % of margin)
 * - R8: Actionable profit guidance (Breakeven Funding Spread & Optimal Leverage)
 * - R9: Asymmetric Settlement Timing & Staggered Fee Erosion Protection
 * - R10: Symmetric Continuous Roll vs Asymmetric Mandatory Flattening
 */

export type LiquidityTier = "DEEP" | "MEDIUM" | "THIN";

export type FundingInterval = 1 | 4 | 8;
export const SUPPORTED_FUNDING_INTERVALS = [1, 4, 8] as const;

export type AsymmetricStrategyStatus =
  | "HOLDING_MULTI_CYCLE_VIABLE"
  | "WAITING_ASYMMETRIC_FINAL_CYCLE"
  | "UNVIABLE_NEGATIVE_SNIPE";

export type SettlementRollMode =
  | "CONTINUOUS_ROLL_ALLOWED"
  | "MANDATORY_SINGLE_SETTLEMENT_FLATTEN";

export interface AsymmetricSettlementAnalysis {
  intervalHoursA: number;
  intervalHoursB: number;
  isAsymmetric: boolean;
  intervalRatio: number;
  intervalRatioLabel: string;
  macroHorizonHours: number;
  receivingIntervalHours: number;
  payingIntervalHours: number;
  receivingLeg: "A" | "B";
  payingLeg: "A" | "B";
  timeRemainingSeconds: number;
  nRemDebits: number;
  maxCycleDebits: number;
  receivingYieldBps: number;
  payingRateBps: number;
  totalFrictionBps: number;
  projectedMultiCycleNetYieldBps: number;
  projectedMultiCycleNetUsdt: number;
  finalCycleNetYieldBps: number;
  finalCycleNetUsdt: number;
  intermediateFeeErosionBps: number;
  intermediateFeeErosionUsdt: number;
  status: AsymmetricStrategyStatus;
  statusLabel: string;
  recommendedEntryWindow: string;
  recommendedWaitSeconds: number;
  continuousRollPermitted: boolean;
  rollMode: SettlementRollMode;
  rollModeLabel: string;
  rollModeDescription: string;
}

export interface SimulatorInputs {
  capitalUsdt?: number; // Legacy/alias for margin or notional (backwards compatibility)
  marginUsdt?: number; // Margin Collateral in USDT (R6)
  leverage?: number; // Leverage multiplier (1x..50x) (R6)
  priceA: number; // Leg 1 Mark Price (e.g. Binance / CoinDCX)
  priceB: number; // Leg 2 Mark Price (e.g. Bitget / Bybit)
  fundingSpreadBps: number; // Funding rate difference in bps (e.g. 35 bps = 0.35%)
  roundtripFeeBps?: number; // Total round-trip taker fees in bps (default: 24.0 bps)
  liquidityTier?: LiquidityTier; // Market depth profile (default: "MEDIUM")

  // R9 & R10: Asymmetric Settlement Timing & Staggered Fee Erosion Protection
  intervalHoursA?: number; // Settlement interval for Leg A in hours (e.g. 1, 4, 8; default: 8)
  intervalHoursB?: number; // Settlement interval for Leg B in hours (e.g. 1, 4, 8; default: 8)
  timeRemainingSeconds?: number; // Seconds remaining until next macro settlement
  receivingLeg?: "A" | "B"; // Leg receiving funding yield (default: longer interval or "A")
  receivingYieldBps?: number; // Explicit gross funding yield on receiving leg (bps)
  payingRateBps?: number; // Explicit intermediate fee rate per cycle on paying leg (bps)
  minHurdleBps?: number; // Hurdle net yield required (bps, default: 0)
}

export interface SimulationResult {
  // Inputs echo & sanitized configuration
  capitalUsdt: number; // Backwards-compatible alias (equals notionalUsdt when leverage=1 or marginUsdt)
  marginUsdt: number; // Collateral margin in USDT (R6)
  leverage: number; // Leverage multiplier (R6)
  notionalUsdt: number; // Effective Notional = Margin * Leverage (R6)
  priceA: number;
  priceB: number;
  fundingSpreadBps: number;
  roundtripFeeBps: number;
  liquidityTier: LiquidityTier;
  depthFactor: number;

  // Slippage Rates (percentages)
  slippagePctA: number; // Leg 1 entry ask slippage (%)
  slippagePctB: number; // Leg 2 entry bid slippage (%)
  exitSlippagePctA: number; // Leg 1 exit bid slippage (%)
  exitSlippagePctB: number; // Leg 2 exit ask slippage (%)
  totalSlippagePct: number; // Total round-trip slippage across all 4 legs (%)

  // Expected Execution Prices (VWAP) (R2)
  expectedBuyPriceA: number; // VWAP_buy on Leg 1
  expectedShortPriceB: number; // VWAP_short on Leg 2

  // Price Parity Check (R2: tolerance <= 0.1%)
  priceDiffUsdt: number;
  priceDiffPct: number;
  isParityMatched: boolean; // true if priceDiffPct <= 0.10%

  // Token Quantity & Capital Preservation Telemetry (R3)
  coinsReceivedA: number; // USDT Allocated / VWAP_buy (Notional / VWAP_buy)
  coinValueAtMarkA: number; // coinsReceivedA * priceA
  entrySlippageCostA: number; // USDT Allocated - coinValueAtMarkA (entry slippage drag Leg 1)
  entrySlippageCostB: number; // Entry slippage drag Leg 2
  totalEntrySlippageUsdt: number; // Combined entry slippage drag

  // Round-trip fee & Exit Value Calculation (R4)
  totalTradingFeesUsdt: number; // notionalUsdt * (roundtripFeeBps / 10000)
  totalExitSlippageUsdt: number; // Unwind slippage drag on exit
  totalExecutionFrictionUsdt: number; // totalEntrySlippage + totalExitSlippage + totalTradingFees
  expectedMoneyReturned: number; // Exact net USDT returned before funding
  moneyReturnedDrawdownUsdt: number; // expectedMoneyReturned - marginUsdt

  // Net Funding Arbitrage PnL Equation (R5)
  // Equation: Net PnL = (Expected Money Back - Initial Money Spent) + Funding Rate Yield
  fundingYieldUsdt: number; // notionalUsdt * (fundingSpreadBps / 10000)
  tradingPnLUsdt: number; // Expected Money Back - Initial Money Spent
  netPnLUsdt: number; // (expectedMoneyReturned - marginUsdt) + fundingYieldUsdt
  netYieldBps: number; // (netPnLUsdt / notionalUsdt) * 10000
  isProfitable: boolean; // netPnLUsdt > 0

  // R7: Return on Equity (ROE %) & Loss-Impact Breakdown
  totalSlippageLossUsdt: number; // Total slippage drag across entry and exit in USDT
  slippageLossMarginPct: number; // Slippage loss as % of margin equity
  roundtripFeeMarginPct: number; // Roundtrip fees as % of margin equity
  fundingYieldMarginPct: number; // Gross funding yield as % of margin equity
  roePct: number; // Return on Equity: ((Net PnL / Margin) * 100)

  // R8: Actionable Profit Guidance & Breakeven Spread
  breakevenSpreadBps: number; // Exact minimum funding rate spread (in bps) required to cover fees + slippage
  optimalLeverage: number; // The leverage that maximizes net dollar profit for this coin's liquidity profile
  optimalNetPnLUsdt: number; // Projected net PnL at the recommended optimal leverage
  isAnyLeverageProfitable: boolean; // Whether any candidate leverage achieves positive profit

  // R9 & R10: Asymmetric Settlement Timing & Staggered Fee Erosion Protection
  asymmetricAnalysis: AsymmetricSettlementAnalysis;
  intervalHoursA: number;
  intervalHoursB: number;
  isAsymmetric: boolean;
  nRemDebits: number;
  projectedMultiCycleNetYieldBps: number;
  finalCycleNetYieldBps: number;
  asymmetricStatus: AsymmetricStrategyStatus;
  continuousRollPermitted: boolean;
  rollMode: SettlementRollMode;
}

export const CANDIDATE_LEVERAGES = [1, 2, 5, 10, 20, 30, 50] as const;

/**
 * Robust currency, coin, and percentage formatting helpers.
 * Prevents truncating low-decimal micro-tokens to $0.00 and formatting glitches like +$-3.50.
 */
export function formatPrice(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return "$0.00";
  if (val >= 1000) {
    return "$" + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (val >= 1) {
    return "$" + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  } else if (val >= 0.01) {
    return "$" + val.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  } else {
    return "$" + val.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 });
  }
}

export function formatPriceDiff(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return "$0.00";
  if (val >= 1) {
    return "$" + val.toFixed(2);
  } else if (val >= 0.01) {
    return "$" + val.toFixed(4);
  } else {
    return "$" + val.toFixed(8);
  }
}

export function formatCoins(coins: number): string {
  if (!Number.isFinite(coins) || coins <= 0) return "0.00";
  if (coins >= 1000) {
    return coins.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  } else if (coins >= 1) {
    return coins.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  } else {
    return coins.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 });
  }
}

export function formatUsdt(val: number): string {
  if (!Number.isFinite(val)) return "$0.00";
  return "$" + Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatSignedUsdt(val: number): string {
  if (!Number.isFinite(val) || Math.abs(val) < 1e-9) return "$0.00";
  const prefix = val > 0 ? "+$" : "-$";
  return prefix + Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatSignedBps(val: number): string {
  if (!Number.isFinite(val) || Math.abs(val) < 1e-9) return "0.0 bps";
  const prefix = val > 0 ? "+" : "";
  return prefix + val.toFixed(1) + " bps";
}

export function formatSignedPct(val: number): string {
  if (!Number.isFinite(val) || Math.abs(val) < 1e-9) return "0.00%";
  const prefix = val > 0 ? "+" : "";
  return prefix + val.toFixed(2) + "%";
}

export function formatRoe(val: number): string {
  return formatSignedPct(val) + " ROE";
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else if (m > 0) {
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${s}s`;
}

/**
 * Returns the depth factor multiplier based on liquidity tier.
 * DEEP: BTC/ETH large-cap pairs (0.35x depth factor)
 * MEDIUM: Standard liquid altcoins (1.00x depth factor)
 * THIN: Low-cap / thin order books (2.50x depth factor)
 */
export function getDepthFactor(tier: LiquidityTier): number {
  switch (tier) {
    case "DEEP":
      return 0.35;
    case "THIN":
      return 2.50;
    case "MEDIUM":
    default:
      return 1.00;
  }
}

/**
 * Computes the order book slippage percentage for a given notional capital and depth factor.
 * Uses a power-law depth curve: base = 0.015 * (notional / 100)^0.58 * depthFactor.
 * Clamped between 0.005% (minimum tick spread friction) and 5.0% (extreme book blowout).
 * Sanitizes against non-finite or extreme inputs to guarantee finite return values.
 */
export function calculateSlippagePct(
  notionalUsdt: number,
  depthFactor: number,
  asymmetryMultiplier: number = 1.0
): number {
  if (!Number.isFinite(notionalUsdt) || notionalUsdt <= 0) return 0;
  const safeDepth = Number.isFinite(depthFactor) && depthFactor > 0 ? depthFactor : 1.0;
  const safeAsym = Number.isFinite(asymmetryMultiplier) && asymmetryMultiplier > 0 ? asymmetryMultiplier : 1.0;
  const normalizedCap = Math.min(100_000_000, Math.max(1, notionalUsdt));
  const baseSlippage = 0.015 * Math.pow(normalizedCap / 100, 0.58) * safeDepth * safeAsym;
  return Math.min(5.0, Math.max(0.005, baseSlippage));
}

/**
 * Price Parity Check: verifies if expected average prices match within <= 0.1% tolerance.
 * Sanitizes against non-finite or zero prices cleanly.
 */
export function checkPriceParity(
  buyPrice: number,
  shortPrice: number,
  tolerancePct: number = 0.10
): { diffUsdt: number; diffPct: number; isMatched: boolean } {
  if (!Number.isFinite(buyPrice) || !Number.isFinite(shortPrice) || buyPrice <= 0 || shortPrice <= 0) {
    return { diffUsdt: 0, diffPct: 0, isMatched: false };
  }

  const safeTolerance = Number.isFinite(tolerancePct) && tolerancePct > 0 ? tolerancePct : 0.10;
  const diffUsdt = Math.abs(buyPrice - shortPrice);
  const diffPct = (diffUsdt / buyPrice) * 100;
  // Tolerance check with tiny epsilon for IEEE 754 precision stability
  const isMatched = diffPct <= safeTolerance + 1e-7;

  return {
    diffUsdt,
    diffPct,
    isMatched,
  };
}

/**
 * Evaluates candidate leverages [1x, 2x, 5x, 10x, 20x, 30x, 50x] and finds the leverage
 * that yields the highest positive net dollar profit, accounting for slippage steepening.
 */
export function findOptimalLeverage(
  marginUsdt: number,
  priceA: number,
  priceB: number,
  fundingSpreadBps: number,
  roundtripFeeBps: number,
  liquidityTier: LiquidityTier
): {
  optimalLeverage: number;
  optimalNetPnLUsdt: number;
  isAnyLeverageProfitable: boolean;
} {
  if (!Number.isFinite(marginUsdt) || marginUsdt <= 0) {
    return { optimalLeverage: 1, optimalNetPnLUsdt: 0, isAnyLeverageProfitable: false };
  }

  const depthFactor = getDepthFactor(liquidityTier);
  let bestLeverage = 1;
  let maxNetPnL = -Infinity;
  let hasProfitable = false;
  let pnlAt1x = 0;

  for (const lev of CANDIDATE_LEVERAGES) {
    const notional = marginUsdt * lev;
    if (notional <= 0) continue;

    const slipA = calculateSlippagePct(notional, depthFactor, 1.0);
    const slipB = calculateSlippagePct(notional, depthFactor, 1.05);
    const exitSlipA = calculateSlippagePct(notional, depthFactor, 1.0);
    const exitSlipB = calculateSlippagePct(notional, depthFactor, 1.05);

    const buyPriceA = priceA * (1 + slipA / 100);
    const coinsA = notional / buyPriceA;
    const entryCostA = notional - coinsA * priceA;
    const entryCostB = notional * (slipB / 100);
    const exitCost = notional * ((exitSlipA + exitSlipB) / 100);
    const feeCost = notional * (roundtripFeeBps / 10000);
    const totalFriction = entryCostA + entryCostB + exitCost + feeCost;

    const returned = Math.max(0, marginUsdt - totalFriction);
    const tradingPnL = returned - marginUsdt;
    const fundingYield = notional * (fundingSpreadBps / 10000);
    const netPnL = tradingPnL + fundingYield;

    if (lev === 1) {
      pnlAt1x = netPnL;
    }

    if (netPnL > 0) {
      hasProfitable = true;
      if (netPnL > maxNetPnL) {
        maxNetPnL = netPnL;
        bestLeverage = lev;
      }
    }
  }

  if (!hasProfitable) {
    return {
      optimalLeverage: 1,
      optimalNetPnLUsdt: pnlAt1x,
      isAnyLeverageProfitable: false,
    };
  }

  return {
    optimalLeverage: bestLeverage,
    optimalNetPnLUsdt: maxNetPnL,
    isAnyLeverageProfitable: true,
  };
}

/**
 * Evaluates asymmetric settlement timing, staggered fee erosion, and roll policy (R9 & R10).
 * 
 * When profit-receiving leg is on a longer cycle (e.g. 8h or 4h) and the fee-paying leg is on a shorter cycle (e.g. 1h or 4h):
 * 1. N_rem = ceil((NextFundingTime_receiving - Now) / Interval_paying).
 * 2. Multi-cycle cumulative fee erosion:
 *    projectedMultiCycleNetYield = receivingYieldBps - (N_rem * payingRateBps) - totalFrictionBps.
 * 3. Final-cycle snipe yield:
 *    finalCycleNetYield = receivingYieldBps - (1 * payingRateBps) - totalFrictionBps.
 * 4. Status determination:
 *    - If projectedMultiCycleNetYield >= minHurdleBps: HOLDING_MULTI_CYCLE_VIABLE.
 *    - If projectedMultiCycleNetYield < minHurdleBps and finalCycleNetYield >= minHurdleBps:
 *      WAITING_ASYMMETRIC_FINAL_CYCLE (bot waits until final cycle window to avoid intermediate debits).
 *    - Else: UNVIABLE_NEGATIVE_SNIPE.
 * 5. Roll Policy (R10):
 *    - Symmetric (I_A === I_B): Continuous roll allowed (continuousRollPermitted: true).
 *    - Asymmetric (I_A !== I_B): Continuous carry roll strictly forbidden (continuousRollPermitted: false),
 *      position must be flattened at macro settlement.
 */
export function evaluateAsymmetricSettlement(params: {
  intervalHoursA?: number;
  intervalHoursB?: number;
  timeRemainingSeconds?: number;
  receivingLeg?: "A" | "B";
  fundingSpreadBps?: number;
  receivingYieldBps?: number;
  payingRateBps?: number;
  totalFrictionBps?: number;
  minHurdleBps?: number;
  notionalUsdt?: number;
}): AsymmetricSettlementAnalysis {
  const intA = typeof params.intervalHoursA === "number" && Number.isFinite(params.intervalHoursA) && params.intervalHoursA > 0
    ? params.intervalHoursA
    : 8;
  const intB = typeof params.intervalHoursB === "number" && Number.isFinite(params.intervalHoursB) && params.intervalHoursB > 0
    ? params.intervalHoursB
    : 8;

  const isAsymmetric = intA !== intB;
  const macroHorizonHours = Math.max(intA, intB);

  // Determine receiving leg vs paying leg
  // If not explicitly specified, default receiving leg to the one with longer interval (or "A" if equal)
  const receivingLeg: "A" | "B" = params.receivingLeg || (intA >= intB ? "A" : "B");
  const payingLeg: "A" | "B" = receivingLeg === "A" ? "B" : "A";

  const receivingIntervalHours = receivingLeg === "A" ? intA : intB;
  const payingIntervalHours = receivingLeg === "A" ? intB : intA;

  const intervalRatio = receivingIntervalHours / payingIntervalHours;
  const ratioVal = intervalRatio >= 1 ? intervalRatio : Math.round((1 / intervalRatio) * 10) / 10;
  const intervalRatioLabel = isAsymmetric
    ? `${intA}h vs ${intB}h [${ratioVal}x Staggered Ratio]`
    : `${intA}h vs ${intB}h [1x Symmetric]`;

  // Macro time remaining: default to full receiving interval in seconds if omitted or invalid
  const defaultRemaining = receivingIntervalHours * 3600;
  const rawRemaining = typeof params.timeRemainingSeconds === "number" && Number.isFinite(params.timeRemainingSeconds)
    ? params.timeRemainingSeconds
    : defaultRemaining;
  const timeRemainingSeconds = Math.max(1, Math.min(receivingIntervalHours * 3600, rawRemaining));

  // N_rem calculation: ceil((NextFundingTime_receiving - Now) / Interval_paying)
  // In seconds: ceil(timeRemainingSeconds / (payingIntervalHours * 3600))
  const payingIntervalSeconds = payingIntervalHours * 3600;
  const maxCycleDebits = Math.max(1, Math.round(receivingIntervalHours / payingIntervalHours));
  const rawNRem = Math.ceil(timeRemainingSeconds / payingIntervalSeconds);
  const nRemDebits = Math.max(1, Math.min(maxCycleDebits, rawNRem));

  const totalFrictionBps = typeof params.totalFrictionBps === "number" && Number.isFinite(params.totalFrictionBps)
    ? params.totalFrictionBps
    : 24.0;
  const spreadBps = typeof params.fundingSpreadBps === "number" && Number.isFinite(params.fundingSpreadBps)
    ? params.fundingSpreadBps
    : 35.0;

  // Rate & Yield assignments
  let receivingYieldBps: number;
  let payingRateBps: number;

  if (params.receivingYieldBps !== undefined && Number.isFinite(params.receivingYieldBps)) {
    receivingYieldBps = params.receivingYieldBps;
    payingRateBps = params.payingRateBps !== undefined && Number.isFinite(params.payingRateBps)
      ? params.payingRateBps
      : 0;
  } else if (params.payingRateBps !== undefined && Number.isFinite(params.payingRateBps)) {
    payingRateBps = params.payingRateBps;
    receivingYieldBps = spreadBps + payingRateBps;
  } else {
    // Default derivation when only net spread is known
    if (isAsymmetric) {
      // In asymmetric markets with a paying leg on a shorter cycle,
      // default paying rate per short cycle is 5.0 bps (or spread * 0.15),
      // and receiving yield = spread + payingRate so single-cycle net funding equals spreadBps.
      payingRateBps = Math.max(1.0, Math.round(Math.abs(spreadBps) * 0.15 * 10) / 10);
      receivingYieldBps = spreadBps + payingRateBps;
    } else {
      // Symmetric: No intermediate staggered fee debits
      payingRateBps = 0;
      receivingYieldBps = spreadBps;
    }
  }

  // Multi-cycle cumulative fee erosion evaluation (R9)
  // projectedMultiCycleNetYield = receivingYieldBps - (N_rem * payingRateBps) - totalFrictionBps
  const projectedMultiCycleNetYieldBps = receivingYieldBps - (nRemDebits * payingRateBps) - totalFrictionBps;

  // Final-cycle snipe yield evaluation (R9)
  // finalCycleNetYield = receivingYieldBps - (1 * payingRateBps) - totalFrictionBps
  const finalCycleNetYieldBps = receivingYieldBps - (1 * payingRateBps) - totalFrictionBps;

  // Intermediate fee erosion: (N_rem - 1) * payingRateBps
  const intermediateFeeErosionBps = Math.max(0, (nRemDebits - 1) * payingRateBps);

  const notionalUsdt = typeof params.notionalUsdt === "number" && Number.isFinite(params.notionalUsdt) && params.notionalUsdt > 0
    ? params.notionalUsdt
    : 0;

  const projectedMultiCycleNetUsdt = notionalUsdt > 0 ? notionalUsdt * (projectedMultiCycleNetYieldBps / 10000) : 0;
  const finalCycleNetUsdt = notionalUsdt > 0 ? notionalUsdt * (finalCycleNetYieldBps / 10000) : 0;
  const intermediateFeeErosionUsdt = notionalUsdt > 0 ? notionalUsdt * (intermediateFeeErosionBps / 10000) : 0;

  const minHurdleBps = typeof params.minHurdleBps === "number" && Number.isFinite(params.minHurdleBps)
    ? params.minHurdleBps
    : 0;

  // Strategy State Determination (R9)
  let status: AsymmetricStrategyStatus;
  let statusLabel: string;
  let recommendedEntryWindow: string;
  let recommendedWaitSeconds = 0;

  if (projectedMultiCycleNetYieldBps >= minHurdleBps) {
    status = "HOLDING_MULTI_CYCLE_VIABLE";
    statusLabel = "HOLDING MULTI-CYCLE VIABLE";
    recommendedWaitSeconds = 0;
    recommendedEntryWindow = nRemDebits === 1
      ? `Execute now — inside final ${payingIntervalHours}h window`
      : `Holding through ${nRemDebits} cycles viable (yield overcomes intermediate debits)`;
  } else if (finalCycleNetYieldBps >= minHurdleBps) {
    status = "WAITING_ASYMMETRIC_FINAL_CYCLE";
    statusLabel = "WAITING_ASYMMETRIC_FINAL_CYCLE";
    // Wait until remaining time reaches the final paying cycle window
    recommendedWaitSeconds = Math.max(0, timeRemainingSeconds - payingIntervalSeconds);
    const waitFormatted = formatDurationSeconds(recommendedWaitSeconds);
    recommendedEntryWindow = recommendedWaitSeconds > 0
      ? `Wait ${waitFormatted} for final ${payingIntervalHours}h window before settlement`
      : `Execute now in final ${payingIntervalHours}h window`;
  } else {
    status = "UNVIABLE_NEGATIVE_SNIPE";
    statusLabel = "UNVIABLE SPREAD (NEGATIVE SNIPE YIELD)";
    recommendedWaitSeconds = 0;
    recommendedEntryWindow = "Spread insufficient to clear friction even in final cycle window";
  }

  // R10: Symmetric Continuous Roll vs Asymmetric Mandatory Flattening
  const continuousRollPermitted = !isAsymmetric;
  const rollMode: SettlementRollMode = continuousRollPermitted
    ? "CONTINUOUS_ROLL_ALLOWED"
    : "MANDATORY_SINGLE_SETTLEMENT_FLATTEN";

  const rollModeLabel = continuousRollPermitted
    ? "CONTINUOUS ROLL PERMITTED"
    : "MANDATORY DUAL-CLOSE UNWIND AT MACRO SETTLEMENT (CONTINUOUS ROLL FORBIDDEN)";

  const rollModeDescription = continuousRollPermitted
    ? `Symmetric settlement (${intA}h vs ${intB}h): Simultaneous cash flows occur with zero intermediate bleed. Position can roll across consecutive settlement cycles.`
    : `Asymmetric settlement (${intA}h vs ${intB}h): Continuous carry roll is strictly forbidden. Position must be unwound immediately at macro settlement; re-entry only allowed in next cycle's final alignment window.`;

  return {
    intervalHoursA: intA,
    intervalHoursB: intB,
    isAsymmetric,
    intervalRatio,
    intervalRatioLabel,
    macroHorizonHours,
    receivingIntervalHours,
    payingIntervalHours,
    receivingLeg,
    payingLeg,
    timeRemainingSeconds,
    nRemDebits,
    maxCycleDebits,
    receivingYieldBps,
    payingRateBps,
    totalFrictionBps,
    projectedMultiCycleNetYieldBps,
    projectedMultiCycleNetUsdt,
    finalCycleNetYieldBps,
    finalCycleNetUsdt,
    intermediateFeeErosionBps,
    intermediateFeeErosionUsdt,
    status,
    statusLabel,
    recommendedEntryWindow,
    recommendedWaitSeconds,
    continuousRollPermitted,
    rollMode,
    rollModeLabel,
    rollModeDescription,
  };
}

/**
 * Complete Pre-Trade Slippage, Liquidity & Net Funding Yield Simulation.
 * Implements R1 through R10 end-to-end with total input sanitization and finite guarantees.
 */
export function simulatePreTradeExecution(inputs: SimulatorInputs): SimulationResult {
  // 1. Sanitize margin collateral and leverage multiplier (R6)
  // If caller provided capitalUsdt without marginUsdt, maintain full backwards compatibility (marginUsdt = capitalUsdt, leverage = 1)
  const rawMargin = inputs.marginUsdt !== undefined ? inputs.marginUsdt : inputs.capitalUsdt;
  const marginUsdt =
    typeof rawMargin === "number" && Number.isFinite(rawMargin)
      ? Math.min(100_000_000, Math.max(0, rawMargin))
      : 0;

  const rawLev = inputs.leverage;
  const leverage =
    typeof rawLev === "number" && Number.isFinite(rawLev) && rawLev >= 1
      ? Math.min(100, Math.max(1, rawLev))
      : 1;

  // Effective Notional = Margin * Leverage (R6)
  const notionalUsdt = marginUsdt * leverage;
  // Backwards-compatible capitalUsdt (matches notionalUsdt when leverage is 1 or caller passes capitalUsdt)
  const capitalUsdt = inputs.capitalUsdt !== undefined ? (inputs.leverage !== undefined ? marginUsdt : notionalUsdt) : marginUsdt;

  const rawPriceA = inputs.priceA;
  const priceA =
    typeof rawPriceA === "number" && Number.isFinite(rawPriceA) && rawPriceA > 0
      ? rawPriceA
      : 1.0;
  const rawPriceB = inputs.priceB;
  const priceB =
    typeof rawPriceB === "number" && Number.isFinite(rawPriceB) && rawPriceB > 0
      ? rawPriceB
      : priceA;
  const rawFundingSpread = inputs.fundingSpreadBps;
  const fundingSpreadBps =
    typeof rawFundingSpread === "number" && Number.isFinite(rawFundingSpread)
      ? Math.min(10000, Math.max(-10000, rawFundingSpread))
      : 35.0;
  const rawFee = inputs.roundtripFeeBps;
  const roundtripFeeBps =
    typeof rawFee === "number" && Number.isFinite(rawFee)
      ? Math.min(5000, Math.max(0, rawFee))
      : 24.0;
  const liquidityTier: LiquidityTier = inputs.liquidityTier || "MEDIUM";

  const depthFactor = getDepthFactor(liquidityTier);

  // If margin or notional is zero, return zeroed telemetry safely
  if (marginUsdt <= 0 || notionalUsdt <= 0) {
    const parity = checkPriceParity(priceA, priceB);
    const asymmetricAnalysis = evaluateAsymmetricSettlement({
      intervalHoursA: inputs.intervalHoursA,
      intervalHoursB: inputs.intervalHoursB,
      timeRemainingSeconds: inputs.timeRemainingSeconds,
      receivingLeg: inputs.receivingLeg,
      fundingSpreadBps,
      receivingYieldBps: inputs.receivingYieldBps,
      payingRateBps: inputs.payingRateBps,
      totalFrictionBps: roundtripFeeBps,
      minHurdleBps: inputs.minHurdleBps,
      notionalUsdt: 0,
    });

    return {
      capitalUsdt: 0,
      marginUsdt: 0,
      leverage,
      notionalUsdt: 0,
      priceA,
      priceB,
      fundingSpreadBps,
      roundtripFeeBps,
      liquidityTier,
      depthFactor,
      slippagePctA: 0,
      slippagePctB: 0,
      exitSlippagePctA: 0,
      exitSlippagePctB: 0,
      totalSlippagePct: 0,
      expectedBuyPriceA: priceA,
      expectedShortPriceB: priceB,
      priceDiffUsdt: parity.diffUsdt,
      priceDiffPct: parity.diffPct,
      isParityMatched: parity.isMatched,
      coinsReceivedA: 0,
      coinValueAtMarkA: 0,
      entrySlippageCostA: 0,
      entrySlippageCostB: 0,
      totalEntrySlippageUsdt: 0,
      totalTradingFeesUsdt: 0,
      totalExitSlippageUsdt: 0,
      totalExecutionFrictionUsdt: 0,
      expectedMoneyReturned: 0,
      moneyReturnedDrawdownUsdt: 0,
      fundingYieldUsdt: 0,
      tradingPnLUsdt: 0,
      netPnLUsdt: 0,
      netYieldBps: 0,
      isProfitable: false,
      totalSlippageLossUsdt: 0,
      slippageLossMarginPct: 0,
      roundtripFeeMarginPct: 0,
      fundingYieldMarginPct: 0,
      roePct: 0,
      breakevenSpreadBps: 0,
      optimalLeverage: 1,
      optimalNetPnLUsdt: 0,
      isAnyLeverageProfitable: false,
      asymmetricAnalysis,
      intervalHoursA: asymmetricAnalysis.intervalHoursA,
      intervalHoursB: asymmetricAnalysis.intervalHoursB,
      isAsymmetric: asymmetricAnalysis.isAsymmetric,
      nRemDebits: asymmetricAnalysis.nRemDebits,
      projectedMultiCycleNetYieldBps: asymmetricAnalysis.projectedMultiCycleNetYieldBps,
      finalCycleNetYieldBps: asymmetricAnalysis.finalCycleNetYieldBps,
      asymmetricStatus: asymmetricAnalysis.status,
      continuousRollPermitted: asymmetricAnalysis.continuousRollPermitted,
      rollMode: asymmetricAnalysis.rollMode,
    };
  }

  // 1. Calculate Entry Slippage for Leg 1 (Buy/Ask) and Leg 2 (Short/Bid) across full Notional (R6)
  const slippagePctA = calculateSlippagePct(notionalUsdt, depthFactor, 1.0);
  const slippagePctB = calculateSlippagePct(notionalUsdt, depthFactor, 1.05);

  // 2. Expected Average Prices (VWAP)
  const expectedBuyPriceA = priceA * (1 + slippagePctA / 100);
  const expectedShortPriceB = priceB * (1 - slippagePctB / 100);

  // 3. Price Parity Check (R2: tolerance <= 0.1%)
  const parity = checkPriceParity(expectedBuyPriceA, expectedShortPriceB, 0.10);

  // 4. Token Quantity & Capital Preservation Telemetry (R3)
  // Coins Received = Notional Allocated / Expected Average Price
  const coinsReceivedA = notionalUsdt / expectedBuyPriceA;
  const coinValueAtMarkA = coinsReceivedA * priceA;
  const entrySlippageCostA = notionalUsdt - coinValueAtMarkA; // immediate capital difference / drag

  // Leg 2 entry drag (short side)
  const entrySlippageCostB = notionalUsdt * (slippagePctB / 100);
  const totalEntrySlippageUsdt = entrySlippageCostA + entrySlippageCostB;

  // 5. Complete Round-Trip Fee & Exit Value Calculation (R4)
  // Total round-trip taker trading fees applied across notional position
  const totalTradingFeesUsdt = notionalUsdt * (roundtripFeeBps / 10000);

  // Exit/unwind slippage when closing both legs across notional
  const exitSlippagePctA = calculateSlippagePct(notionalUsdt, depthFactor, 1.0);
  const exitSlippagePctB = calculateSlippagePct(notionalUsdt, depthFactor, 1.05);
  const totalExitSlippageUsdt = notionalUsdt * ((exitSlippagePctA + exitSlippagePctB) / 100);

  // Total execution friction across all entries, exits, and commissions
  const totalExecutionFrictionUsdt = totalEntrySlippageUsdt + totalExitSlippageUsdt + totalTradingFeesUsdt;
  // Expected Money Returned before funding (evaluated against margin collateral)
  const expectedMoneyReturned = Math.max(0, marginUsdt - totalExecutionFrictionUsdt);
  const moneyReturnedDrawdownUsdt = expectedMoneyReturned - marginUsdt;

  // 6. Net Funding Arbitrage PnL Equation (R5)
  // Equation: Net PnL = (Expected Money Back - Initial Money Spent) + Funding Rate Yield
  const fundingYieldUsdt = notionalUsdt * (fundingSpreadBps / 10000);
  const tradingPnLUsdt = expectedMoneyReturned - marginUsdt;
  const netPnLUsdt = tradingPnLUsdt + fundingYieldUsdt;
  const netYieldBps = notionalUsdt > 0 ? (netPnLUsdt / notionalUsdt) * 10000 : 0;
  const isProfitable = netPnLUsdt > 0;

  const totalSlippagePct = slippagePctA + slippagePctB + exitSlippagePctA + exitSlippagePctB;

  // 7. R7: Return on Equity (ROE %) & Loss-Impact Breakdown
  const totalSlippageLossUsdt = totalEntrySlippageUsdt + totalExitSlippageUsdt;
  const slippageLossMarginPct = marginUsdt > 0 ? (totalSlippageLossUsdt / marginUsdt) * 100 : 0;
  const roundtripFeeMarginPct = marginUsdt > 0 ? (totalTradingFeesUsdt / marginUsdt) * 100 : 0;
  const fundingYieldMarginPct = marginUsdt > 0 ? (fundingYieldUsdt / marginUsdt) * 100 : 0;
  const roePct = marginUsdt > 0 ? (netPnLUsdt / marginUsdt) * 100 : 0;

  // 8. R8: Actionable Profit Guidance & Breakeven Spread
  // Breakeven spread: Spread (in bps) required so grossFundingYield = totalExecutionFrictionUsdt
  const breakevenSpreadBps = notionalUsdt > 0 ? (totalExecutionFrictionUsdt / notionalUsdt) * 10000 : 0;

  // Recommended Optimal Leverage
  const optimal = findOptimalLeverage(
    marginUsdt,
    priceA,
    priceB,
    fundingSpreadBps,
    roundtripFeeBps,
    liquidityTier
  );

  // 9. R9 & R10: Asymmetric Settlement Timing & Staggered Fee Erosion Protection
  const totalFrictionBps = notionalUsdt > 0 ? (totalExecutionFrictionUsdt / notionalUsdt) * 10000 : roundtripFeeBps;

  const asymmetricAnalysis = evaluateAsymmetricSettlement({
    intervalHoursA: inputs.intervalHoursA,
    intervalHoursB: inputs.intervalHoursB,
    timeRemainingSeconds: inputs.timeRemainingSeconds,
    receivingLeg: inputs.receivingLeg,
    fundingSpreadBps,
    receivingYieldBps: inputs.receivingYieldBps,
    payingRateBps: inputs.payingRateBps,
    totalFrictionBps,
    minHurdleBps: inputs.minHurdleBps,
    notionalUsdt,
  });

  return {
    capitalUsdt,
    marginUsdt,
    leverage,
    notionalUsdt,
    priceA,
    priceB,
    fundingSpreadBps,
    roundtripFeeBps,
    liquidityTier,
    depthFactor,
    slippagePctA,
    slippagePctB,
    exitSlippagePctA,
    exitSlippagePctB,
    totalSlippagePct,
    expectedBuyPriceA,
    expectedShortPriceB,
    priceDiffUsdt: parity.diffUsdt,
    priceDiffPct: parity.diffPct,
    isParityMatched: parity.isMatched,
    coinsReceivedA,
    coinValueAtMarkA,
    entrySlippageCostA,
    entrySlippageCostB,
    totalEntrySlippageUsdt,
    totalTradingFeesUsdt,
    totalExitSlippageUsdt,
    totalExecutionFrictionUsdt,
    expectedMoneyReturned,
    moneyReturnedDrawdownUsdt,
    fundingYieldUsdt,
    tradingPnLUsdt,
    netPnLUsdt,
    netYieldBps,
    isProfitable,
    totalSlippageLossUsdt,
    slippageLossMarginPct,
    roundtripFeeMarginPct,
    fundingYieldMarginPct,
    roePct,
    breakevenSpreadBps,
    optimalLeverage: optimal.optimalLeverage,
    optimalNetPnLUsdt: optimal.optimalNetPnLUsdt,
    isAnyLeverageProfitable: optimal.isAnyLeverageProfitable,
    asymmetricAnalysis,
    intervalHoursA: asymmetricAnalysis.intervalHoursA,
    intervalHoursB: asymmetricAnalysis.intervalHoursB,
    isAsymmetric: asymmetricAnalysis.isAsymmetric,
    nRemDebits: asymmetricAnalysis.nRemDebits,
    projectedMultiCycleNetYieldBps: asymmetricAnalysis.projectedMultiCycleNetYieldBps,
    finalCycleNetYieldBps: asymmetricAnalysis.finalCycleNetYieldBps,
    asymmetricStatus: asymmetricAnalysis.status,
    continuousRollPermitted: asymmetricAnalysis.continuousRollPermitted,
    rollMode: asymmetricAnalysis.rollMode,
  };
}
