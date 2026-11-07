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
  maxAdverseFundingRateBps: 3.0,
  fundingWindowMinutes: 45,
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

  // Gate 6: Adverse Funding Rate Guard
  // If nextFundingTime is within 45 minutes, check projected adverse funding carry.
  // Direction SHORT_BINANCE_LONG_BYBIT pays funding if (F_byb > 0) or (F_bn < 0).
  // Direction SHORT_BYBIT_LONG_BINANCE pays funding if (F_bn > 0) or (F_byb < 0).
  let gate6Passed = true;
  if (
    pair.nextFundingTime &&
    pair.nextFundingTime > 0 &&
    direction !== undefined
  ) {
    const msToFunding = pair.nextFundingTime - Date.now();
    const minutesToFunding = msToFunding / (60 * 1000);

    if (minutesToFunding > 0 && minutesToFunding <= (config.fundingWindowMinutes ?? 45)) {
      const bnRate = pair.binanceFundingRate ?? 0;
      const bybRate = pair.bybitFundingRate ?? 0;

      // Calculate net carry cost in bps
      let adverseCarryBps = 0;
      if (direction === 'SHORT_BINANCE_LONG_BYBIT') {
        // Long Bybit pays if bybRate > 0; Short Binance pays if bnRate < 0
        adverseCarryBps = (Math.max(0, bybRate) + Math.max(0, -bnRate)) * 10000;
      } else {
        // Long Binance pays if bnRate > 0; Short Bybit pays if bybRate < 0
        adverseCarryBps = (Math.max(0, bnRate) + Math.max(0, -bybRate)) * 10000;
      }

      const maxAdverseCarryBps = config.maxAdverseFundingRateBps ?? 3.0; // 0.030%
      if (adverseCarryBps > maxAdverseCarryBps) {
        gate6Passed = false;
        reasons.push(
          `Gate 6 (Funding Rate Guard): Adverse carry ${(adverseCarryBps / 100).toFixed(3)}% (${adverseCarryBps.toFixed(1)} bps) in next ${minutesToFunding.toFixed(0)}m exceeds ${maxAdverseCarryBps.toFixed(1)} bps cap [FAIL]`
        );
      } else {
        reasons.push(
          `Gate 6 (Funding Rate Guard): Adverse carry ${(adverseCarryBps / 100).toFixed(3)}% in next ${minutesToFunding.toFixed(0)}m within limits [PASS]`
        );
      }
    }
  }

  const passed =
    gate1Passed &&
    gate2Passed &&
    gate3Passed &&
    gate4Passed &&
    gate5Passed &&
    gate6Passed &&
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

/**
 * Guard 1: Symmetrically Directional Anti-Inversion Gate
 * Invariant to venue labels; enforces selling venue > buying venue by S_floor.
 * Eliminates inverted entries while preserving reverse-spread winners.
 */
export function evaluateStrictDirectionality(
  direction: StatArbDirection,
  binanceBid: number,
  binanceAsk: number,
  bybitBid: number,
  bybitAsk: number,
  minGrossSpreadPct: number = 0.240
): { passed: boolean; grossSpreadPct: number; reason: string } {
  // Sanity checks on feed integrity
  if (
    !Number.isFinite(binanceBid) || !Number.isFinite(binanceAsk) ||
    !Number.isFinite(bybitBid) || !Number.isFinite(bybitAsk) ||
    binanceBid <= 0 || bybitBid <= 0
  ) {
    return { passed: false, grossSpreadPct: 0, reason: 'CORRUPTED_PRICE_FEEDS' };
  }
  // Crossed book detection
  if (binanceBid >= binanceAsk || bybitBid >= bybitAsk) {
    return { passed: false, grossSpreadPct: 0, reason: 'CROSSED_ORDERBOOK_FEED' };
  }

  const shortPrice = direction === 'SHORT_BINANCE_LONG_BYBIT' ? binanceBid : bybitBid;
  const longPrice = direction === 'SHORT_BINANCE_LONG_BYBIT' ? bybitAsk : binanceAsk;

  const grossSpreadPct = ((shortPrice - longPrice) / longPrice) * 100.0;

  // Anti-Inversion Invariant: Shorting cheap venue is mathematically forbidden
  if (shortPrice <= longPrice) {
    return {
      passed: false,
      grossSpreadPct,
      reason: `DIRECTIONAL_INVERSION_BLOCKED: Short ($${shortPrice}) <= Long ($${longPrice}), spread ${grossSpreadPct.toFixed(3)}% <= 0.000%`
    };
  }

  // Friction Floor Check
  if (grossSpreadPct < minGrossSpreadPct) {
    return {
      passed: false,
      grossSpreadPct,
      reason: `INSUFFICIENT_SPREAD_EDGE: Spread ${grossSpreadPct.toFixed(3)}% < required floor ${minGrossSpreadPct.toFixed(3)}%`
    };
  }

  return { passed: true, grossSpreadPct, reason: 'DIRECTIONALITY_AND_SPREAD_VERIFIED' };
}

/**
 * Guard 1.2: Leg-Aware IOC Bound Invariant
 * Evaluates whether Leg 1 is BUY or SELL, not whether Leg 1 is Binance or Bybit.
 * Protects against adverse microsecond book-cross drift on Leg 2 taker execution.
 */
export function computeLeg2IocBoundPrice(
  leg1Side: 'SELL' | 'BUY',
  leg1FillPrice: number,
  minGrossSpreadPct: number = 0.240
): number {
  if (leg1Side === 'SELL') {
    // Leg 1 is Short. Leg 2 is BUY (Long). Cap maximum buy price:
    return parseFloat((leg1FillPrice / (1.0 + minGrossSpreadPct / 100.0)).toFixed(8));
  } else {
    // Leg 1 is Long. Leg 2 is SELL (Short). Floor minimum sell price:
    return parseFloat((leg1FillPrice * (1.0 + minGrossSpreadPct / 100.0)).toFixed(8));
  }
}

/**
 * Guard 2: Dynamic Friction Hurdle Evaluator with Passive Maker Abort
 * Enforces k_optimal = 1.6x to 1.8x total roundtrip fees.
 * Requires 8-second passive maker cancel to eliminate taker degradation traps.
 */
export interface DynamicGatingResult {
  canDispatch: boolean;
  requiredHurdlePct: number;
  grossSpreadPct: number;
  netEdgePct: number;
  reason: string;
}

export function evaluateDynamicFrictionFloor(
  grossSpreadPct: number,
  leg1MakerFeePct: number = 0.020,
  leg2TakerFeePct: number = 0.055,
  isAltcoinTier: boolean = false,
  kMultiplier: number = 1.60
): DynamicGatingResult {
  const effectiveTakerFee = isAltcoinTier ? Math.max(leg2TakerFeePct, 0.065) : leg2TakerFeePct;
  const roundtripFeePct = 2.0 * (leg1MakerFeePct + effectiveTakerFee); // 0.150% standard / 0.170% altcoin
  
  // Enforce optimal multiplier boundary [1.6x, 1.8x]
  const clampedK = Math.min(Math.max(kMultiplier, 1.60), 1.80);
  const requiredHurdlePct = roundtripFeePct * clampedK; // 0.240% to 0.272%
  const netEdgePct = grossSpreadPct - roundtripFeePct;

  if (grossSpreadPct < requiredHurdlePct) {
    return {
      canDispatch: false,
      requiredHurdlePct,
      grossSpreadPct,
      netEdgePct,
      reason: `GROSS_SPREAD_BELOW_FRICTION_FLOOR: Spread ${grossSpreadPct.toFixed(3)}% < Hurdle ${requiredHurdlePct.toFixed(3)}% (k=${clampedK.toFixed(1)}x)`
    };
  }

  // Pre-Flight Gate 5 Net Edge Invariant: Net edge must exceed 0.080%
  if (netEdgePct < 0.080) {
    return {
      canDispatch: false,
      requiredHurdlePct,
      grossSpreadPct,
      netEdgePct,
      reason: `NET_EDGE_BELOW_PREFLIGHT_GATE: Net edge ${netEdgePct.toFixed(3)}% < 0.080%`
    };
  }

  return {
    canDispatch: true,
    requiredHurdlePct,
    grossSpreadPct,
    netEdgePct,
    reason: `DYNAMIC_FLOOR_VERIFIED: Net edge ${netEdgePct.toFixed(3)}% >= 0.080%`
  };
}

/**
 * 8-Second Passive Maker Watchdog Invariant:
 * Aborts unhedged Leg 1 maker order if not filled passively within 8,000 ms.
 */
export function shouldAbortLeg1MakerOrder(elapsedMs: number): boolean {
  return elapsedMs >= 8000;
}

/**
 * Guard 3: Strategy-Decoupled Pure StatArb Evaluator
 * Verifies that STATARB-OU-PERP is 100% decoupled from funding epoch synchronization.
 * Purges synthetic phantom funding formulas.
 */
export function evaluatePureStatArbEligibility(
  zScore: number,
  depthRatio: number,
  grossSpreadPct: number,
  minZScore: number = 2.20,
  minDepthRatio: number = 4.0,
  minGrossSpreadPct: number = 0.240
): { eligible: boolean; reason: string } {
  if (Math.abs(zScore) < minZScore) {
    return { eligible: false, reason: `INSUFFICIENT_ZSCORE: |${zScore.toFixed(2)}| < ${minZScore.toFixed(2)}` };
  }
  if (depthRatio < minDepthRatio) {
    return { eligible: false, reason: `INSUFFICIENT_DEPTH: Ratio ${depthRatio.toFixed(2)}x < ${minDepthRatio.toFixed(2)}x` };
  }
  if (grossSpreadPct < minGrossSpreadPct) {
    return { eligible: false, reason: `INSUFFICIENT_SPREAD: ${grossSpreadPct.toFixed(3)}% < ${minGrossSpreadPct.toFixed(3)}%` };
  }

  // 100% Autonomous 24/7 Orderbook Convergence — ZERO funding restrictions
  return { eligible: true, reason: 'PURE_STATARB_CRITERIA_VERIFIED' };
}
