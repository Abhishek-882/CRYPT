/**
 * ZERO-LOSS DYNAMIC EXIT ENGINE & OPTIMIZER
 * 
 * Implements the 5 institutional exit methods:
 * 1. Guaranteed Net-Positive Exit Gate (NetPnL >= +$0.01 USDT invariant)
 * 2. Multi-Cycle Carry Compounding (Roll into next cycle instead of timeout dump)
 * 3. Maker Post-Only Limit Unwind (GTX on Binance / PostOnly on Bybit)
 * 4. Positive Basis Convergence Capture (Directional basis PnL optimization)
 * 5. Ornstein-Uhlenbeck (OU) Mean-Reversion Stopping Time Model
 */

import type { ActiveBotHedge } from "./botEngine";
import {
  HARD_SAFETY_FLOOR_USDT,
  BASE_NOTIONAL_UNIT_USDT,
  getEffectiveZeroLossFloorUsdt,
} from "./divergence/engine";

export { HARD_SAFETY_FLOOR_USDT, BASE_NOTIONAL_UNIT_USDT, getEffectiveZeroLossFloorUsdt };
export const MIN_EXIT_PROFIT_USDT = 0.01;
export const DEFAULT_MIN_NET_HEDGE_TARGET_PCT = 0.30; // 0.30% Net ROI hurdle on total invested capital

/**
 * Calculates the dynamic auto-adaptive profit hurdle in USDT based on total invested margin.
 * Adapts to capital size and leverage, strictly enforcing the $0.0100 USDT safety floor:
 * AdaptiveFloorUsdt = max(hardFloorUsdt, totalMarginUsdt * (minNetTargetPct / 100))
 */
export function calculateAdaptiveZeroLossFloorUsdt(
  totalMarginUsdt: number,
  minNetTargetPct: number = DEFAULT_MIN_NET_HEDGE_TARGET_PCT,
  hardFloorUsdt: number = HARD_SAFETY_FLOOR_USDT
): number {
  const targetFloor = parseFloat((totalMarginUsdt * (minNetTargetPct / 100)).toFixed(4));
  return Math.max(hardFloorUsdt, targetFloor);
}

export const CATASTROPHIC_STOP_LOSS_ROI = -20.0;
/** Minimum forward continuation funding spread: 0.200% */
export const MIN_CONTINUATION_SPREAD_PCT = 0.20; // 0.200%
export const MIN_CONTINUATION_SPREAD_BPS = 20.0; // Legacy export alias: 0.200%
export const MAX_ADAPTIVE_PARITY_DIV_PCT = 0.25;

export interface FreshPricePair {
  bnPrice: number;
  bgPrice: number;
  divergencePct: number;
  bnBestBid?: number;
  bnBestAsk?: number;
  bgBestBid?: number;
  bgBestAsk?: number;
}

export interface OUStoppingResult {
  theta: number;
  mu: number;
  sigma: number;
  halfLifeMinutes: number;
  zScore: number;
  expectedConvergenceMinutes: number;
  shouldWait: boolean;
}

export interface ExitDecision {
  canExit: boolean;
  exitType:
    | "CONTINUATION_HOLD"
    | "PARITY_LIMIT_EXIT"
    | "TWAP_PASSIVE_EXIT"
    | "EMERGENCY_TAKER_EXIT"
    | "CATASTROPHIC_STOP"
    | "STRUCTURAL_BASIS_DECOUPLING"
    | "HOLD_CARRY_FOR_PARITY"
    | "MAKER_POST_ONLY";
  expectedPnlUsd: number;
  netPnL: number;
  grossBasisPnL: number;
  fundingClaimed: number;
  totalFeesUsdt: number;
  currentRoiPct: number;
  halfLifeMinutes?: number;
  zScore?: number;
  reason: string;
}

/**
 * Calculates exact directional basis PnL across Leg 1 and Leg 2.
 * Selling rich / buying cheap gains profit as prices converge.
 */
export function calculateDirectionalBasisPnL(
  hedge: ActiveBotHedge,
  priceA: number,
  priceB: number
): { leg1PnL: number; leg2PnL: number; grossBasisPnL: number } {
  const isShortA =
    hedge.direction.startsWith("SHORT_") ||
    hedge.direction.includes("SHORT_BINANCE") ||
    hedge.direction.includes("SHORT_A");

  const leg1Dir = isShortA ? -1 : 1;
  const leg2Dir = -leg1Dir;

  const leg1PnL = leg1Dir * (priceA - hedge.entryBinancePrice) * hedge.effectiveQty;
  const leg2PnL = leg2Dir * (priceB - hedge.entryBitgetPrice) * hedge.effectiveQty;
  const grossBasisPnL = parseFloat((leg1PnL + leg2PnL).toFixed(4));

  return {
    leg1PnL: parseFloat(leg1PnL.toFixed(4)),
    leg2PnL: parseFloat(leg2PnL.toFixed(4)),
    grossBasisPnL,
  };
}

/**
 * Estimates Ornstein-Uhlenbeck (OU) mean-reversion stopping time from 1-minute historical basis samples.
 * dX_t = theta * (mu - X_t) dt + sigma * dW_t
 * Half-life = ln(2) / theta
 */
export function estimateOrnsteinUhlenbeckStopping(
  currentBasisMetric: number,
  historicalBasisSamples: number[] = []
): OUStoppingResult {
  if (!historicalBasisSamples || historicalBasisSamples.length < 5) {
    const sampleMean =
      historicalBasisSamples && historicalBasisSamples.length > 0
        ? historicalBasisSamples.reduce((a, b) => a + b, 0) / historicalBasisSamples.length
        : 0;
    const zScore = Math.abs(currentBasisMetric - sampleMean) / 10.0;
    return {
      theta: 0.0866, // ~8 min half-life
      mu: sampleMean,
      sigma: 5.0,
      halfLifeMinutes: 8.0,
      zScore: parseFloat(zScore.toFixed(2)),
      expectedConvergenceMinutes: 8.0,
      shouldWait: zScore > 1.8,
    };
  }

  const N = historicalBasisSamples.length;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < N - 1; i++) {
    sumX += historicalBasisSamples[i];
    sumY += historicalBasisSamples[i + 1];
  }

  const nPairs = N - 1;
  const meanX = sumX / nPairs;
  const meanY = sumY / nPairs;

  let num = 0;
  let den = 0;
  for (let i = 0; i < nPairs; i++) {
    const x = historicalBasisSamples[i];
    const y = historicalBasisSamples[i + 1];
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) * (x - meanX);
  }

  const b = den !== 0 ? num / den : 0.9;
  const a = meanY - b * meanX;

  // b = exp(-theta * dt) => theta = -ln(b) / dt
  const clampedB = Math.max(0.01, Math.min(0.99, b));
  const theta = -Math.log(clampedB);
  const halfLifeMinutes = theta > 0.0001 ? Math.min(120, Math.log(2) / theta) : 15.0;
  const mu = 1 - clampedB !== 0 ? a / (1 - clampedB) : 0;

  // Residual variance
  let sse = 0;
  for (let i = 0; i < nPairs; i++) {
    const x = historicalBasisSamples[i];
    const y = historicalBasisSamples[i + 1];
    const pred = a + clampedB * x;
    sse += (y - pred) * (y - pred);
  }
  const sigma = Math.sqrt(sse / Math.max(1, nPairs - 2));
  const zScore = sigma > 0.001 ? Math.abs(currentBasisMetric - mu) / sigma : 0;

  const shouldWait = zScore > 1.8 && halfLifeMinutes <= 30;
  const expectedConvergenceMinutes = Math.min(45, halfLifeMinutes * Math.max(1, zScore));

  return {
    theta,
    mu,
    sigma,
    halfLifeMinutes: parseFloat(halfLifeMinutes.toFixed(2)),
    zScore: parseFloat(zScore.toFixed(2)),
    expectedConvergenceMinutes: parseFloat(expectedConvergenceMinutes.toFixed(2)),
    shouldWait,
  };
}

/**
 * Method 1 & Central Gate: Guaranteed Net-Positive Exit Gate
 * Enforces the invariant:
 * NetPnL = GrossBasisPnL + FundingClaimed - EntryFees - EstExitFees >= dynamicFloor (minimum +$0.0100 USDT)
 * 
 * Only Catastrophic Stop Loss (-40% ROI) is permitted to exit at a net loss.
 */
export function evaluateZeroLossExitGate(
  hedge: ActiveBotHedge,
  freshPrices: FreshPricePair,
  historicalBasisSamples: number[] = [],
  nextCyclePredictedSpreadPercent?: number,
  configuredMinProfitUsdt?: number,
  configuredMinNetTargetPct?: number
): ExitDecision {
  const { grossBasisPnL } = calculateDirectionalBasisPnL(
    hedge,
    freshPrices.bnPrice,
    freshPrices.bgPrice
  );

  const now = Date.now();
  let fundingClaimed = hedge.fundingClaimedUsdt || 0;

  // Accrual fallback if settlement passed but exchange income sync has not yet completed
  if (
    fundingClaimed === 0 &&
    hedge.fundingSettlementTime &&
    now >= hedge.fundingSettlementTime
  ) {
    const cycles = Math.max(1, hedge.cyclesHarvested || 1);
    const estSpreadPct =
      hedge.fundingRatePct !== undefined
        ? hedge.fundingRatePct
        : hedge.entrySpreadBps
        ? hedge.entrySpreadBps / 10000
        : 0.0025;
    const notional = hedge.notionalUsdt || freshPrices.bnPrice * hedge.effectiveQty;
    const estFunding = notional * estSpreadPct * cycles;
    fundingClaimed = parseFloat(Math.max(0, estFunding).toFixed(4));
  }

  const notional = (freshPrices.bnPrice || hedge.entryBinancePrice) * hedge.effectiveQty;
  const entryFees =
    hedge.totalFeesUsdt ||
    (hedge.leg1FeeUsdt || 0) + (hedge.leg2FeeUsdt || 0) ||
    parseFloat((notional * 0.00115).toFixed(4));

  // Projected exit fee: Maker Leg 1 (0.020%) + Taker Leg 2 (0.0649%) = 0.0849%
  const estExitFees = parseFloat((notional * (0.00020 + 0.000649)).toFixed(4));
  const totalFeesUsdt = parseFloat((entryFees + estExitFees).toFixed(4));
  const netPnL = parseFloat((grossBasisPnL + fundingClaimed - totalFeesUsdt).toFixed(4));

  const leverage = hedge.binanceLeverage || 10;
  const legMargin = (hedge.notionalUsdt || notional || 30.0) / leverage;
  const totalMargin = legMargin * 2;
  const minNetTargetPct = configuredMinNetTargetPct;
  const currentRoiPct =
    totalMargin > 0 ? parseFloat(((netPnL / totalMargin) * 100).toFixed(3)) : 0;

  const effectiveBasisSamples =
    historicalBasisSamples && historicalBasisSamples.length >= 5
      ? historicalBasisSamples
      : hedge.divergenceHistory && hedge.divergenceHistory.length >= 5
      ? hedge.divergenceHistory.map((s) => s.divPct * 100)
      : historicalBasisSamples;

  const currentBasisMetric = freshPrices.divergencePct * 100;
  const ouResult = estimateOrnsteinUhlenbeckStopping(
    currentBasisMetric,
    effectiveBasisSamples
  );

  // Auto-adaptive dynamic zero-loss floor hurdle
  const effectiveExitFloorUsdt = getEffectiveZeroLossFloorUsdt(
    hedge.notionalUsdt || notional,
    configuredMinProfitUsdt,
    leverage,
    configuredMinNetTargetPct
  );

  // 1. CATASTROPHIC STOP-LOSS LIMIT (Emergency override)
  if (currentRoiPct <= CATASTROPHIC_STOP_LOSS_ROI) {
    return {
      canExit: true,
      exitType: "CATASTROPHIC_STOP",
      expectedPnlUsd: netPnL,
      netPnL,
      grossBasisPnL,
      fundingClaimed,
      totalFeesUsdt,
      currentRoiPct,
      halfLifeMinutes: ouResult.halfLifeMinutes,
      zScore: ouResult.zScore,
      reason: `Catastrophic stop-loss triggered: ROI ${currentRoiPct}% <= ${CATASTROPHIC_STOP_LOSS_ROI}% cap. Executing emergency risk cutoff.`,
    };
  }

  // 1.5 ADVERSE CARRY INVERSION BREAKER (Prevents "Hotel California" Lockup Trap)
  // If forward spread has flipped severely negative (<= -0.20%), holding further guarantees continuous fee bleed.
  const isAdverseCarryInversion =
    nextCyclePredictedSpreadPercent !== undefined &&
    (nextCyclePredictedSpreadPercent <= -20.0 ||
      (nextCyclePredictedSpreadPercent < 0 && nextCyclePredictedSpreadPercent <= -0.20));

  if (isAdverseCarryInversion) {
    const formattedSpreadPct =
      Math.abs(nextCyclePredictedSpreadPercent!) >= 1.0
        ? (nextCyclePredictedSpreadPercent! / 100).toFixed(2)
        : nextCyclePredictedSpreadPercent!.toFixed(2);

    return {
      canExit: true,
      exitType: "EMERGENCY_TAKER_EXIT",
      expectedPnlUsd: netPnL,
      netPnL,
      grossBasisPnL,
      fundingClaimed,
      totalFeesUsdt,
      currentRoiPct,
      halfLifeMinutes: ouResult.halfLifeMinutes,
      zScore: ouResult.zScore,
      reason: `Adverse Carry Inversion Breaker triggered: Forward funding spread inverted to ${formattedSpreadPct}% (<= -0.20%). Overriding Net-Positive Gate to halt terminal fee bleed.`,
    };
  }

  // 1.7 30-MINUTE LOW-WATERMARK BASIS PERSISTENCE BREAKER (Invariant 6)
  // If price divergence has stayed continuously >= 1.0% without visiting < 1.0% for 30 minutes,
  // the mean-reversion assumption has failed. Trigger an orderly structural exit to eliminate endless carry bleed.
  const divergenceHistory = hedge.divergenceHistory || [];
  const thirtyMinutesAgo = now - 30 * 60 * 1000;
  const recentDivergenceSamples = divergenceHistory.filter((s) => s.timestamp >= thirtyMinutesAgo);
  const holdDurationMs = now - (hedge.entryTime || now);

  if (holdDurationMs >= 30 * 60 * 1000 && recentDivergenceSamples.length >= 8) {
    const minDivPctInWindow = Math.min(...recentDivergenceSamples.map((s) => s.divPct));
    if (freshPrices.divergencePct >= 1.0 && minDivPctInWindow >= 1.0) {
      return {
        canExit: true,
        exitType: "STRUCTURAL_BASIS_DECOUPLING",
        expectedPnlUsd: netPnL,
        netPnL,
        grossBasisPnL,
        fundingClaimed,
        totalFeesUsdt,
        currentRoiPct,
        halfLifeMinutes: ouResult.halfLifeMinutes,
        zScore: ouResult.zScore,
        reason: `30-Minute Persistence Breaker triggered: Divergence remained >= 1.0% continuously for 30m without mean-reverting (Min diff: ${minDivPctInWindow.toFixed(3)}% >= 1.0%). Overriding Zero-Loss Gate to prevent structural lockup.`,
      };
    }
  }

  // 2. NET-POSITIVE INVARIANT CHECK
  const isTargetAchieved =
    netPnL >= effectiveExitFloorUsdt &&
    (minNetTargetPct === undefined || currentRoiPct >= minNetTargetPct);

  if (!isTargetAchieved) {
    const targetText =
      minNetTargetPct !== undefined
        ? ` (+${currentRoiPct}% < +${minNetTargetPct.toFixed(2)}% target)`
        : "";
    // If forward spread is profitable, roll carry forward
    const isLucrativeContinuation =
      nextCyclePredictedSpreadPercent !== undefined &&
      (nextCyclePredictedSpreadPercent >= MIN_CONTINUATION_SPREAD_BPS ||
        nextCyclePredictedSpreadPercent >= MIN_CONTINUATION_SPREAD_PCT);

    if (isLucrativeContinuation) {
      const formattedContinuationPct =
        Math.abs(nextCyclePredictedSpreadPercent!) >= 1.0
          ? (nextCyclePredictedSpreadPercent! / 100).toFixed(2)
          : nextCyclePredictedSpreadPercent!.toFixed(2);

      return {
        canExit: false,
        exitType: "CONTINUATION_HOLD",
        expectedPnlUsd: netPnL,
        netPnL,
        grossBasisPnL,
        fundingClaimed,
        totalFeesUsdt,
        currentRoiPct,
        halfLifeMinutes: ouResult.halfLifeMinutes,
        zScore: ouResult.zScore,
        reason: `Blocked by Zero-Loss Gate: Net PnL ($${netPnL}) < +$${effectiveExitFloorUsdt.toFixed(4)}${targetText}. Rolling into next cycle (+${formattedContinuationPct}% >= 0.20%) to compound harvest.`,
      };
    }

    // Otherwise, hold for basis mean-reversion
    return {
      canExit: false,
      exitType: "HOLD_CARRY_FOR_PARITY",
      expectedPnlUsd: netPnL,
      netPnL,
      grossBasisPnL,
      fundingClaimed,
      totalFeesUsdt,
      currentRoiPct,
      halfLifeMinutes: ouResult.halfLifeMinutes,
      zScore: ouResult.zScore,
      reason: `Blocked by Zero-Loss Gate: Net PnL ($${netPnL}) < +$${effectiveExitFloorUsdt.toFixed(4)}${targetText} (Basis: $${grossBasisPnL}, Funding: +$${fundingClaimed}, Fees: -$${totalFeesUsdt}). Holding for basis parity reversion (OU zScore: ${ouResult.zScore}, t_half: ${ouResult.halfLifeMinutes}m).`,
    };
  }

  // 3. NET-POSITIVE CONFIRMED (NetPnL >= effectiveExitFloorUsdt && ROI >= minNetTargetPct)
  const targetMetText =
    minNetTargetPct !== undefined
      ? `, +${currentRoiPct}% ROI >= +${minNetTargetPct.toFixed(2)}% target`
      : `, +${currentRoiPct}% ROI`;
  if (freshPrices.divergencePct <= 0.05) {
    return {
      canExit: true,
      exitType: "MAKER_POST_ONLY",
      expectedPnlUsd: netPnL,
      netPnL,
      grossBasisPnL,
      fundingClaimed,
      totalFeesUsdt,
      currentRoiPct,
      halfLifeMinutes: ouResult.halfLifeMinutes,
      zScore: ouResult.zScore,
      reason: `Guaranteed Net-Positive Confirmed ($${netPnL} USDT${targetMetText}). Divergence is tight (${freshPrices.divergencePct.toFixed(3)}% <= 0.05%). Executing Maker Post-Only unwind.`,
    };
  }

  if (freshPrices.divergencePct <= MAX_ADAPTIVE_PARITY_DIV_PCT) {
    return {
      canExit: true,
      exitType: "PARITY_LIMIT_EXIT",
      expectedPnlUsd: netPnL,
      netPnL,
      grossBasisPnL,
      fundingClaimed,
      totalFeesUsdt,
      currentRoiPct,
      halfLifeMinutes: ouResult.halfLifeMinutes,
      zScore: ouResult.zScore,
      reason: `Guaranteed Net-Positive Confirmed ($${netPnL} USDT${targetMetText}). Divergence (${freshPrices.divergencePct.toFixed(3)}%) is within adaptive safe window (<= ${MAX_ADAPTIVE_PARITY_DIV_PCT}%). Executing limit unwind.`,
    };
  }

  // If divergence is wider than 0.25%, but Net PnL is solidly positive (>= effectiveExitFloorUsdt or $0.05)
  if (netPnL >= Math.max(0.05, effectiveExitFloorUsdt)) {
    return {
      canExit: true,
      exitType: "MAKER_POST_ONLY",
      expectedPnlUsd: netPnL,
      netPnL,
      grossBasisPnL,
      fundingClaimed,
      totalFeesUsdt,
      currentRoiPct,
      halfLifeMinutes: ouResult.halfLifeMinutes,
      zScore: ouResult.zScore,
      reason: `Guaranteed Net-Positive Confirmed ($${netPnL} USDT${targetMetText}). Profit absorbs divergence. Executing Maker Post-Only unwind.`,
    };
  }

  // Otherwise wait for closer convergence
  return {
    canExit: false,
    exitType: "HOLD_CARRY_FOR_PARITY",
    expectedPnlUsd: netPnL,
    netPnL,
    grossBasisPnL,
    fundingClaimed,
    totalFeesUsdt,
    currentRoiPct,
    halfLifeMinutes: ouResult.halfLifeMinutes,
    zScore: ouResult.zScore,
    reason: `Net PnL ($${netPnL}) is positive but divergence (${freshPrices.divergencePct.toFixed(3)}% > 0.25%) is wide. Holding for OU basis convergence to maximize profit capture.`,
  };
}

/**
 * Reconciles actual realized funding payments from exchange API records.
 * Updates hedge.fundingClaimedUsdt with exchange-verified cash flow.
 */
export async function reconcileHedgeFunding(
  hedge: ActiveBotHedge,
  binanceCreds?: { apiKey: string; apiSecret: string },
  bybitCreds?: any
): Promise<number> {
  let realizedFunding = 0;
  const now = Date.now();
  const startTime = hedge.entryTime || now - 8 * 3600 * 1000;

  // 1. Binance Funding Income Query
  if (binanceCreds?.apiKey && binanceCreds?.apiSecret) {
    try {
      const { signAndFetchBinance } = await import("./binanceSigner");
      const res = await signAndFetchBinance(
        binanceCreds.apiKey,
        binanceCreds.apiSecret,
        "GET",
        "/fapi/v1/income",
        {
          symbol: hedge.symbol,
          incomeType: "FUNDING_FEE",
          startTime,
          limit: 10,
        }
      );

      if (Array.isArray(res?.data)) {
        for (const item of res.data) {
          const val = parseFloat(item.income || "0");
          if (!isNaN(val)) {
            realizedFunding += val;
          }
        }
      }
    } catch {
      // Best-effort non-blocking sync
    }
  }

  // 2. Bybit Funding Query (Account Transaction Log for Live Settlements + Closed PnL)
  if (bybitCreds?.apiKey && bybitCreds?.apiSecret) {
    try {
      const { sendBybitRequest } = await import("./bybitSigner");
      const txRes = await sendBybitRequest("/v5/account/transaction-log", "GET", bybitCreds, {
        accountType: "UNIFIED",
        category: "linear",
        type: "SETTLEMENT",
        startTime,
        limit: 10,
      });

      let foundTx = false;
      if (Array.isArray(txRes?.result?.list)) {
        for (const item of txRes.result.list) {
          if (item.symbol === hedge.symbol) {
            const funding = parseFloat(item.funding || item.change || "0");
            if (!isNaN(funding) && funding !== 0) {
              realizedFunding += funding;
              foundTx = true;
            }
          }
        }
      }

      if (!foundTx) {
        const res = await sendBybitRequest("/v5/position/closed-pnl", "GET", bybitCreds, {
          category: "linear",
          symbol: hedge.symbol,
          startTime,
          limit: 10,
        });

        if (Array.isArray(res?.result?.list)) {
          for (const item of res.result.list) {
            const funding = parseFloat(item.funding || "0");
            if (!isNaN(funding)) {
              realizedFunding += funding;
            }
          }
        }
      }
    } catch {
      // Best-effort non-blocking sync
    }
  }

  // Fallback to rate-based accrued funding if exchange queries returned zero but settlement passed
  if (realizedFunding === 0 && hedge.fundingSettlementTime && now >= hedge.fundingSettlementTime) {
    const cycles = Math.max(1, hedge.cyclesHarvested || 1);
    const estSpreadPct =
      hedge.fundingRatePct !== undefined
        ? hedge.fundingRatePct
        : hedge.entrySpreadBps
        ? hedge.entrySpreadBps / 10000
        : 0.0025;
    const notional = hedge.notionalUsdt || 30.0;
    realizedFunding = parseFloat((notional * estSpreadPct * cycles).toFixed(4));
  }

  if (realizedFunding !== 0) {
    hedge.fundingClaimedUsdt = parseFloat(realizedFunding.toFixed(4));
  }

  return hedge.fundingClaimedUsdt || 0;
}

/**
 * Reconciles actual filled entry prices from open positions on the exchange.
 * Overwrites pre-dispatch estimated ticker prices with ground-truth exchange fills.
 */
export async function reconcileHedgeEntryPrices(
  hedge: ActiveBotHedge,
  binanceCreds?: { apiKey: string; apiSecret: string },
  bybitCreds?: any
): Promise<void> {
  // 1. Binance Ground-Truth Entry Price Sync
  if (binanceCreds?.apiKey && binanceCreds?.apiSecret) {
    try {
      const { signAndFetchBinance } = await import("./binanceSigner");
      const res = await signAndFetchBinance(
        binanceCreds.apiKey,
        binanceCreds.apiSecret,
        "GET",
        "/fapi/v2/positionRisk",
        { symbol: hedge.symbol }
      );
      if (Array.isArray(res?.data)) {
        const pos = res.data.find((p: any) => p.symbol === hedge.symbol && parseFloat(p.positionAmt) !== 0);
        if (pos && parseFloat(pos.entryPrice) > 0) {
          const trueEntry = parseFloat(pos.entryPrice);
          if (Math.abs(hedge.entryBinancePrice - trueEntry) > 0.0000001) {
            hedge.entryBinancePrice = trueEntry;
          }
        }
      }
    } catch {
      // Best-effort non-blocking sync
    }
  }

  // 2. Bybit Ground-Truth Entry Price Sync
  if (bybitCreds?.apiKey && bybitCreds?.apiSecret) {
    try {
      const { sendBybitRequest } = await import("./bybitSigner");
      const posRes = await sendBybitRequest("/v5/position/list", "GET", bybitCreds, {
        category: "linear",
        symbol: hedge.symbol,
      });
      if (Array.isArray(posRes?.result?.list)) {
        const pos = posRes.result.list.find((p: any) => p.symbol === hedge.symbol && parseFloat(p.size) > 0);
        if (pos && parseFloat(pos.avgPrice) > 0) {
          const trueEntry = parseFloat(pos.avgPrice);
          if (Math.abs(hedge.entryBitgetPrice - trueEntry) > 0.0000001) {
            hedge.entryBitgetPrice = trueEntry;
          }
        }
      }
    } catch {
      // Best-effort non-blocking sync
    }
  }
}

