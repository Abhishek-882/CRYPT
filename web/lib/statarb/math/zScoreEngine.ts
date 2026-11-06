/**
 * STATARB-OU-PERP: Real-Time Z-Score Engine & Multi-Condition Entry Gating
 * 
 * Computes instantaneous standardized basis distance from long-term equilibrium:
 * z_t = (b_t - mu) / equilibriumSigma
 * 
 * Enforces pre-flight entry gates:
 * Gate 1: |z_t| >= minZScore (2.20)
 * Gate 2: |b_t| >= minGrossBasisBps (28.0 bps)
 * Gate 3: orderBookDepthRatio >= minDepthRatio (4.0x)
 * Gate 4: binanceSpreadBps <= maxSpreadBps (8.0 bps) AND bybitSpreadBps <= maxSpreadBps (8.0 bps)
 * Gate 5: netExpectedEdgeBps >= minNetEdgeBps (8.0 bps = 0.080% net edge hurdle covering Binance 0.020% Maker + Bybit 0.055% Taker + slippage buffer)
 * 
 * Assigns deterministic delta-neutral execution direction:
 * b_t >= +28.0 and z_t >= +2.20 -> SHORT_BINANCE_LONG_BYBIT
 * b_t <= -28.0 and z_t <= -2.20 -> SHORT_BYBIT_LONG_BINANCE
 */

import {
  OUParameters,
  StatArbPair,
  EntryGateConfig,
  EntryGateResult,
  TradeSignal,
  StatArbDirection,
} from '../types';

/**
 * Standard default entry gating thresholds per strategy specification
 */
export const DEFAULT_ENTRY_GATE_CONFIG: EntryGateConfig = {
  minZScore: 2.2,
  minGrossBasisBps: 28.0,
  minDepthRatio: 4.0,
  maxSpreadBps: 8.0,
  minNetEdgeBps: 8.0,
  roundtripFrictionBps: 17.0,
};

/**
 * Computes the real-time z-score for a given basis relative to calibrated OU parameters.
 * z_t = (b_t - mu) / equilibriumSigma
 * 
 * @param currentBasisBps Current cross-exchange gross basis in basis points (bps)
 * @param params Calibrated OU continuous parameters
 * @returns Normalized z-score (number of stationary standard deviations from equilibrium mean)
 */
export function calculateZScore(currentBasisBps: number, params: OUParameters): number {
  if (
    !Number.isFinite(currentBasisBps) ||
    !params ||
    !Number.isFinite(params.mu) ||
    !Number.isFinite(params.equilibriumSigma) ||
    params.equilibriumSigma <= 1e-6
  ) {
    return 0.0;
  }

  return (currentBasisBps - params.mu) / params.equilibriumSigma;
}

/**
 * Computes cross-exchange gross basis in basis points (bps):
 * b_t = ((P_binance - P_bybit) / P_bybit) * 10,000
 * 
 * @param binancePrice Midpoint price on Binance USD-M
 * @param bybitPrice Midpoint price on Bybit Linear
 * @returns Gross basis in bps
 */
export function calculateBasisBps(binancePrice: number, bybitPrice: number): number {
  if (!Number.isFinite(binancePrice) || !Number.isFinite(bybitPrice) || bybitPrice <= 0) {
    return 0.0;
  }

  return ((binancePrice - bybitPrice) / bybitPrice) * 10000.0;
}

/**
 * Evaluates all four pre-flight entry gates concurrently for a pair candidate.
 * 
 * @param pair Live state of the monitored statistical arbitrage pair
 * @param params Calibrated OU parameters for the pair
 * @param config Optional custom entry gate thresholds
 * @returns EntryGateResult containing pass/fail status, metrics, direction, and detailed audit reasons
 */
export function evaluateEntryGates(
  pair: StatArbPair,
  params: OUParameters,
  config: EntryGateConfig = DEFAULT_ENTRY_GATE_CONFIG
): EntryGateResult {
  const zScore = calculateZScore(pair.grossBasisBps, params);
  const absZScore = Math.abs(zScore);
  const absBasis = Math.abs(pair.grossBasisBps);
  const reasons: string[] = [];

  // Gate 1: Z-Score tail statistical significance (|z_t| >= minZScore)
  const gate1Passed = absZScore >= config.minZScore;
  if (gate1Passed) {
    reasons.push(`Gate 1 (Z-Score): |${zScore.toFixed(2)}| >= ${config.minZScore} [PASS]`);
  } else {
    reasons.push(`Gate 1 (Z-Score): |${zScore.toFixed(2)}| < ${config.minZScore} [FAIL]`);
  }

  // Gate 2: Gross Basis hurdle (|b_t| >= minGrossBasisBps)
  const gate2Passed = absBasis >= config.minGrossBasisBps;
  if (gate2Passed) {
    reasons.push(
      `Gate 2 (Gross Basis): |${pair.grossBasisBps.toFixed(2)} bps| >= ${config.minGrossBasisBps} bps [PASS]`
    );
  } else {
    reasons.push(
      `Gate 2 (Gross Basis): |${pair.grossBasisBps.toFixed(2)} bps| < ${config.minGrossBasisBps} bps [FAIL]`
    );
  }

  // Gate 3: Orderbook depth cushion ratio (depthRatio >= minDepthRatio)
  const gate3Passed = pair.orderBookDepthRatio >= config.minDepthRatio;
  if (gate3Passed) {
    reasons.push(
      `Gate 3 (Depth Cushion): ${pair.orderBookDepthRatio.toFixed(2)}x >= ${config.minDepthRatio}x [PASS]`
    );
  } else {
    reasons.push(
      `Gate 3 (Depth Cushion): ${pair.orderBookDepthRatio.toFixed(2)}x < ${config.minDepthRatio}x [FAIL]`
    );
  }

  // Gate 4: Bid-Ask spread cap (Spread_BN <= maxSpread AND Spread_BYB <= maxSpread)
  const bnSpread = pair.binanceSpreadBps ?? 0;
  const bybSpread = pair.bybitSpreadBps ?? 0;
  const gate4Passed =
    bnSpread <= config.maxSpreadBps &&
    bybSpread <= config.maxSpreadBps;
  if (gate4Passed) {
    reasons.push(
      `Gate 4 (Spread Cap): BN=${bnSpread.toFixed(2)} bps, BYB=${bybSpread.toFixed(2)} bps <= ${config.maxSpreadBps} bps [PASS]`
    );
  } else {
    reasons.push(
      `Gate 4 (Spread Cap): BN=${bnSpread.toFixed(2)} bps, BYB=${bybSpread.toFixed(2)} bps exceeds ${config.maxSpreadBps} bps cap [FAIL]`
    );
  }

  // Direction Assignment:
  // b_t >= +28.0 bps AND z_t >= +2.20 -> Binance is rich, Bybit is cheap -> SHORT_BINANCE_LONG_BYBIT
  // b_t <= -28.0 bps AND z_t <= -2.20 -> Bybit is rich, Binance is cheap -> SHORT_BYBIT_LONG_BINANCE
  let direction: StatArbDirection | undefined;
  if (pair.grossBasisBps >= config.minGrossBasisBps && zScore >= config.minZScore) {
    direction = 'SHORT_BINANCE_LONG_BYBIT';
    reasons.push(`Direction: Binance rich (+${pair.grossBasisBps.toFixed(1)} bps) -> SHORT_BINANCE_LONG_BYBIT`);
  } else if (pair.grossBasisBps <= -config.minGrossBasisBps && zScore <= -config.minZScore) {
    direction = 'SHORT_BYBIT_LONG_BINANCE';
    reasons.push(`Direction: Bybit rich (${pair.grossBasisBps.toFixed(1)} bps) -> SHORT_BYBIT_LONG_BINANCE`);
  } else {
    reasons.push(`Direction: Inconclusive (directional alignment criteria not met)`);
  }

  // Gate 5: Pre-Flight Net-Edge Hurdle (Gross Basis - 4-Leg Friction >= minNetEdge)
  // minNetEdgeBps defaults to 8.0 bps (0.080% net edge hurdle covering Binance 0.020% Maker + Bybit 0.055% Taker + buffer)
  const frictionBps = config.roundtripFrictionBps ?? 17.0;
  const minNetEdge = config.minNetEdgeBps !== undefined ? config.minNetEdgeBps : 8.0;
  const netExpectedEdgeBps = parseFloat((absBasis - frictionBps).toFixed(2));
  const gate5Passed = netExpectedEdgeBps >= minNetEdge;
  if (gate5Passed) {
    reasons.push(
      `Gate 5 (Net-Edge): Net ${(netExpectedEdgeBps / 100).toFixed(3)}% (${netExpectedEdgeBps.toFixed(1)} bps) [Gross ${(absBasis / 100).toFixed(3)}% - Friction ${(frictionBps / 100).toFixed(3)}%] >= ${(minNetEdge / 100).toFixed(3)}% [PASS]`
    );
  } else {
    reasons.push(
      `Gate 5 (Net-Edge): Net ${(netExpectedEdgeBps / 100).toFixed(3)}% (${netExpectedEdgeBps.toFixed(1)} bps) [Gross ${(absBasis / 100).toFixed(3)}% - Friction ${(frictionBps / 100).toFixed(3)}%] < ${(minNetEdge / 100).toFixed(3)}% [FAIL]`
    );
  }

  const passed =
    gate1Passed &&
    gate2Passed &&
    gate3Passed &&
    gate4Passed &&
    gate5Passed &&
    direction !== undefined;

  return {
    passed,
    zScore,
    grossBasisBps: pair.grossBasisBps,
    netExpectedEdgeBps,
    depthRatio: pair.orderBookDepthRatio,
    binanceSpreadBps: pair.binanceSpreadBps,
    bybitSpreadBps: pair.bybitSpreadBps,
    direction,
    reasons,
  };
}

/**
 * Generates an actionable TradeSignal if entry gates pass for a given pair.
 * 
 * @param pair Live state of the monitored statistical arbitrage pair
 * @param params Calibrated OU parameters
 * @param config Optional custom entry gate thresholds
 * @returns TradeSignal object or null if gates failed
 */
export function generateTradeSignal(
  pair: StatArbPair,
  params: OUParameters,
  config: EntryGateConfig = DEFAULT_ENTRY_GATE_CONFIG
): TradeSignal | null {
  const result = evaluateEntryGates(pair, params, config);

  if (!result.passed || !result.direction) {
    return null;
  }

  const timestamp = Date.now();
  const id = `SIG-${pair.canonicalSymbol}-${timestamp}-${Math.floor(Math.random() * 10000)}`;

  return {
    id,
    pair,
    timestamp,
    zScore: result.zScore,
    grossBasisBps: result.grossBasisBps,
    direction: result.direction,
    passedGates: true,
    reasons: result.reasons,
  };
}
