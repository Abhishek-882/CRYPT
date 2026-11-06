/**
 * STATARB-OU-PERP: Guaranteed Zero-Loss Exit Optimizer
 * 
 * Enforces institutional mathematical exit logic:
 * 1. Convergence Trigger 1: Basis Compression >= 75% ((|entryBasis| - |currentBasis|) / |entryBasis| >= 0.75)
 * 2. Convergence Trigger 2: Z-Score Normalization (|z_t| <= 0.35)
 * 3. Mandatory Zero-Loss Invariant Gate: Net PnL (Gross Basis PnL + Funding Earned - Roundtrip Fees) >= +$0.0100 USDT.
 * 4. Safety Breaker Overrides: Catastrophic Stop-Loss and Invariant 6 30-Minute Persistence Breaker.
 * 
 * 100% standalone with zero legacy dependencies.
 */

import { StatArbPosition } from '../types';
import { checkInvariant6PersistenceBreaker, checkInvariant4CatastrophicStopLoss } from './invariantGuard';

export const MIN_ZERO_LOSS_PROFIT_USDT = 0.01;
export const DEFAULT_COMPRESSION_THRESHOLD = 0.75;
export const DEFAULT_Z_SCORE_EXIT_THRESHOLD = 0.35;

/**
 * Standard fee schedule:
 * Binance USD-M: Maker 2.0 bps (0.00020), Taker 5.5 bps (0.00055)
 * Bybit Linear: Maker 2.0 bps (0.00020), Taker 5.5 bps (0.00055)
 * Standard Maker-Taker entry = 2.0 + 5.5 = 7.5 bps
 * Standard Maker-Taker exit  = 2.0 + 5.5 = 7.5 bps
 * Total roundtrip fees = 15.0 bps
 */
export interface FeeStructure {
  binanceMakerBps?: number;
  binanceTakerBps?: number;
  bybitMakerBps?: number;
  bybitTakerBps?: number;
  roundtripFeeBps?: number;
}

export const DEFAULT_FEE_STRUCTURE: FeeStructure = {
  binanceMakerBps: 2.0,
  binanceTakerBps: 5.5,
  bybitMakerBps: 2.0,
  bybitTakerBps: 5.5,
  roundtripFeeBps: 15.0, // (2.0 + 5.5) * 2 = 15.0 bps
};

export interface ZeroLossGateResult {
  exitAllowed: boolean;
  netPnLUsdt: number;
  grossBasisPnLUsdt: number;
  fundingEarnedUsdt: number;
  totalFeesUsdt: number;
  minRequiredProfitUsdt: number;
  reason: string;
}

export type ExitDecisionType =
  | 'PROFITABLE_CONVERGENCE_EXIT'
  | 'HOLD_CARRY_FOR_PARITY'
  | 'HOLD_ACTIVE'
  | 'STRUCTURAL_BASIS_DECOUPLING'
  | 'CATASTROPHIC_STOP';

export interface ExitEvaluationResult {
  canExit: boolean;
  exitAllowed: boolean;
  exitType: ExitDecisionType;
  basisCompression: number;
  isCompressed: boolean;
  isNormalized: boolean;
  currentZScore: number;
  currentBasisBps: number;
  netPnLUsdt: number;
  grossBasisPnLUsdt: number;
  totalFeesUsdt: number;
  reason: string;
}

/**
 * Calculates percentage basis compression between entry and current basis:
 * Compression = (|b_entry| - |b_current|) / |b_entry|
 */
export function calculateBasisCompression(
  entryBasisBps: number,
  currentBasisBps: number
): number {
  const absEntry = Math.abs(entryBasisBps);
  const absCurrent = Math.abs(currentBasisBps);

  if (absEntry === 0) {
    return 0;
  }

  const compression = (absEntry - absCurrent) / absEntry;
  return parseFloat(compression.toFixed(4));
}

/**
 * Evaluates whether basis compression is >= 75% (or custom threshold).
 */
export function isBasisCompressed(
  entryBasisBps: number,
  currentBasisBps: number,
  threshold: number = DEFAULT_COMPRESSION_THRESHOLD
): boolean {
  return calculateBasisCompression(entryBasisBps, currentBasisBps) >= threshold;
}

/**
 * Evaluates whether the current z-score has reverted to within normal boundaries (|z| <= 0.35).
 */
export function isZScoreNormalized(
  zScore: number,
  threshold: number = DEFAULT_Z_SCORE_EXIT_THRESHOLD
): boolean {
  return Math.abs(zScore) <= threshold;
}

/**
 * Computes exact Gross Basis PnL for a delta-neutral position.
 */
export function calculateGrossBasisPnL(
  position: StatArbPosition,
  currentBasisBps: number,
  currentBinancePrice?: number,
  currentBybitPrice?: number
): number {
  // If concrete prices are provided, use exact leg price differentials
  if (
    currentBinancePrice !== undefined &&
    currentBybitPrice !== undefined &&
    currentBinancePrice > 0 &&
    currentBybitPrice > 0 &&
    position.entryBinancePrice > 0 &&
    position.entryBybitPrice > 0
  ) {
    const isShortBn = position.direction === 'SHORT_BINANCE_LONG_BYBIT';
    const bnDir = isShortBn ? -1 : 1;
    const bybDir = -bnDir;

    const bnPnl = bnDir * (currentBinancePrice - position.entryBinancePrice) * position.quantity;
    const bybPnl = bybDir * (currentBybitPrice - position.entryBybitPrice) * position.quantity;

    return parseFloat((bnPnl + bybPnl).toFixed(4));
  }

  // Otherwise calculate from basis points compression and notional
  // Basis captured in bps = |entryBasisBps| - |currentBasisBps|
  const absEntry = Math.abs(position.entryBasisBps);
  const absCurrent = Math.abs(currentBasisBps);
  const basisCapturedBps = absEntry - absCurrent;

  const notional = position.notionalUsdt || position.quantity * position.entryBinancePrice || 15.0;
  const pnlFromBasis = notional * (basisCapturedBps / 10000);

  return parseFloat(pnlFromBasis.toFixed(4));
}

/**
 * Computes total roundtrip fees (entry + exit).
 * Standard schedule: 15.0 bps (0.15% = 15 / 10000)
 */
export function calculateRoundtripFees(
  position: StatArbPosition,
  feesConfig: FeeStructure = DEFAULT_FEE_STRUCTURE
): number {
  const roundtripBps = feesConfig.roundtripFeeBps ?? 15.0;
  const notional = position.notionalUsdt || 15.0;
  const totalFees = notional * (roundtripBps / 10000);
  return parseFloat(totalFees.toFixed(4));
}

/**
 * Guaranteed Zero-Loss Exit Enforcer
 * 
 * Rules:
 * - Calculates Gross Basis PnL + Funding Earned - Roundtrip Fees
 *   (Binance Maker 2.0 bps + Bybit Taker 5.5 bps or custom).
 * - Enforces strict invariant: Net PnL must be >= +$0.0100 USDT.
 * - If Net PnL < +$0.01 USDT, block exit (exitAllowed: false, reason: 'BLOCKED_BY_ZERO_LOSS_GATE')
 *   and hold for parity reversion.
 * 
 * @param position Active delta-neutral statistical arbitrage position
 * @param currentBasisBps Current instantaneous gross basis in bps
 * @param zScore Current Ornstein-Uhlenbeck z-score
 * @param feesConfig Optional custom fee schedule
 * @param fundingEarned Optional accumulated funding earned in USDT
 */
export function evaluateZeroLossExitGate(
  position: StatArbPosition,
  currentBasisBps: number,
  zScore: number,
  feesConfig: FeeStructure = DEFAULT_FEE_STRUCTURE,
  fundingEarned: number = 0,
  currentBinancePrice?: number,
  currentBybitPrice?: number
): ZeroLossGateResult {
  const totalFees = calculateRoundtripFees(position, feesConfig);

  let grossBasisPnL = calculateGrossBasisPnL(
    position,
    currentBasisBps,
    currentBinancePrice,
    currentBybitPrice
  );

  const netPnL = parseFloat((grossBasisPnL + fundingEarned - totalFees).toFixed(4));

  if (netPnL < MIN_ZERO_LOSS_PROFIT_USDT) {
    return {
      exitAllowed: false,
      netPnLUsdt: netPnL,
      grossBasisPnLUsdt: grossBasisPnL,
      fundingEarnedUsdt: fundingEarned,
      totalFeesUsdt: totalFees,
      minRequiredProfitUsdt: MIN_ZERO_LOSS_PROFIT_USDT,
      reason: 'BLOCKED_BY_ZERO_LOSS_GATE',
    };
  }

  return {
    exitAllowed: true,
    netPnLUsdt: netPnL,
    grossBasisPnLUsdt: grossBasisPnL,
    fundingEarnedUsdt: fundingEarned,
    totalFeesUsdt: totalFees,
    minRequiredProfitUsdt: MIN_ZERO_LOSS_PROFIT_USDT,
    reason: `Zero-Loss Gate passed: Net PnL ($${netPnL.toFixed(4)}) >= +$${MIN_ZERO_LOSS_PROFIT_USDT.toFixed(4)} USDT. Exit permitted.`,
  };
}

/**
 * Comprehensive Institutional Exit Evaluator
 * 
 * Evaluates active positions against:
 * 1. Catastrophic Stop Loss (ROI <= -20%): Overrides Zero-Loss Gate
 * 2. Invariant 6 Persistence Breaker: Overrides Zero-Loss Gate
 * 3. Convergence criteria (Basis compression >= 75% OR |z| <= 0.35)
 * 4. Zero-Loss Invariant Enforcer (Net PnL >= +$0.0100 USDT)
 */
export function evaluateExit(
  position: StatArbPosition,
  currentBasisBps: number,
  zScore: number,
  options: {
    feesConfig?: FeeStructure;
    fundingEarnedUsdt?: number;
    currentBinancePrice?: number;
    currentBybitPrice?: number;
    currentRoiPct?: number;
    holdMinutes?: number;
    divergenceHistory30m?: number[];
  } = {}
): ExitEvaluationResult {
  const {
    feesConfig = DEFAULT_FEE_STRUCTURE,
    fundingEarnedUsdt = 0,
    currentBinancePrice,
    currentBybitPrice,
    currentRoiPct,
    holdMinutes = position.holdDurationMinutes || 0,
    divergenceHistory30m = position.divergenceHistory30m || [],
  } = options;

  const grossBasisPnL = calculateGrossBasisPnL(
    position,
    currentBasisBps,
    currentBinancePrice,
    currentBybitPrice
  );
  const totalFees = calculateRoundtripFees(position, feesConfig);
  const netPnL = parseFloat((grossBasisPnL + fundingEarnedUsdt - totalFees).toFixed(4));
  const basisCompression = calculateBasisCompression(position.entryBasisBps, currentBasisBps);
  const isCompressed = isBasisCompressed(position.entryBasisBps, currentBasisBps);
  const isNormalized = isZScoreNormalized(zScore);

  // 1. Catastrophic Stop-Loss Override
  if (currentRoiPct !== undefined) {
    const stopCheck = checkInvariant4CatastrophicStopLoss(currentRoiPct);
    if (stopCheck.triggered) {
      return {
        canExit: true,
        exitAllowed: true,
        exitType: 'CATASTROPHIC_STOP',
        basisCompression,
        isCompressed,
        isNormalized,
        currentZScore: zScore,
        currentBasisBps,
        netPnLUsdt: netPnL,
        grossBasisPnLUsdt: grossBasisPnL,
        totalFeesUsdt: totalFees,
        reason: stopCheck.reason,
      };
    }
  }

  // 2. Invariant 6: 30-Minute Low-Watermark Persistence Breaker Override
  if (divergenceHistory30m.length > 0) {
    const persistenceCheck = checkInvariant6PersistenceBreaker(holdMinutes, divergenceHistory30m);
    if (persistenceCheck.triggered) {
      return {
        canExit: true,
        exitAllowed: true,
        exitType: 'STRUCTURAL_BASIS_DECOUPLING',
        basisCompression,
        isCompressed,
        isNormalized,
        currentZScore: zScore,
        currentBasisBps,
        netPnLUsdt: netPnL,
        grossBasisPnLUsdt: grossBasisPnL,
        totalFeesUsdt: totalFees,
        reason: persistenceCheck.reason,
      };
    }
  }

  // 3. Normal Convergence Exit Evaluation
  if (isCompressed || isNormalized) {
    const gateResult = evaluateZeroLossExitGate(
      position,
      currentBasisBps,
      zScore,
      feesConfig,
      fundingEarnedUsdt,
      currentBinancePrice,
      currentBybitPrice
    );

    if (gateResult.exitAllowed) {
      return {
        canExit: true,
        exitAllowed: true,
        exitType: 'PROFITABLE_CONVERGENCE_EXIT',
        basisCompression,
        isCompressed,
        isNormalized,
        currentZScore: zScore,
        currentBasisBps,
        netPnLUsdt: netPnL,
        grossBasisPnLUsdt: grossBasisPnL,
        totalFeesUsdt: totalFees,
        reason: `Convergence target met (${isCompressed ? 'Basis compression >= 75%' : '|z| <= 0.35'}) with guaranteed profit: Net PnL $${netPnL.toFixed(4)} >= +$0.0100 USDT.`,
      };
    }

    // Convergence met but blocked by Zero-Loss Gate
    return {
      canExit: false,
      exitAllowed: false,
      exitType: 'HOLD_CARRY_FOR_PARITY',
      basisCompression,
      isCompressed,
      isNormalized,
      currentZScore: zScore,
      currentBasisBps,
      netPnLUsdt: netPnL,
      grossBasisPnLUsdt: grossBasisPnL,
      totalFeesUsdt: totalFees,
      reason: gateResult.reason,
    };
  }

  // 4. Convergence not met: Continue holding
  return {
    canExit: false,
    exitAllowed: false,
    exitType: 'HOLD_ACTIVE',
    basisCompression,
    isCompressed,
    isNormalized,
    currentZScore: zScore,
    currentBasisBps,
    netPnLUsdt: netPnL,
    grossBasisPnLUsdt: grossBasisPnL,
    totalFeesUsdt: totalFees,
    reason: `Position active: Basis compression ${(basisCompression * 100).toFixed(1)}% < 75%, |z| = ${Math.abs(zScore).toFixed(2)} > 0.35. Awaiting mean-reversion.`,
  };
}
