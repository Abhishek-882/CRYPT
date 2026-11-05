/**
 * Multi-Factor Composite Arbitrage Scoring (CAS) Engine
 * Track SPEC-04 / QUANT-02
 * 
 * Vectorized multi-factor scoring model that replaces greedy 1-D spread sorting.
 * Synthesizes:
 * 1. Net spread after dynamic fee deduction (w1 = 0.35)
 * 2. Signed basis contribution (+bps favorable, -bps adverse) (w2 = 0.20)
 * 3. 3-cycle funding rate sign persistence (w3 = 0.15)
 * 4. L2 order book depth liquidity score (w4 = 0.15)
 * 5. Basis volatility penalty (w5 = 0.10)
 * 6. Countdown timing distance penalty (w6 = 0.05)
 */

export interface CandidateScoringFactors {
  symbol: string;
  corridor: string;
  venueA: string;
  venueB: string;
  grossSpreadBps: number;
  netSpreadBps: number;
  signedBasisBps: number;
  l2DepthUsd?: number;
  targetNotionalUsd?: number;
  basisVolatilityBps?: number;
  persistenceScore?: number; // 0 to 100
  secondsToFunding?: number;
}

export interface CandidateScoreResult {
  symbol: string;
  corridor: string;
  compositeScore: number;
  qualified: boolean;
  scoreBreakdown: {
    netSpreadComponent: number;
    basisComponent: number;
    depthComponent: number;
    persistenceComponent: number;
    volatilityPenalty: number;
    timingPenalty: number;
  };
  rejectionReason?: string;
}

export function computeCompositeArbitrageScore(
  factors: CandidateScoringFactors
): CandidateScoreResult {
  const targetNotional = factors.targetNotionalUsd || 30.0;
  const l2Depth = factors.l2DepthUsd || targetNotional * 5.0;
  const basisVol = factors.basisVolatilityBps || 5.0;
  const persistence = factors.persistenceScore !== undefined ? factors.persistenceScore : 80.0;
  const secondsToFunding = factors.secondsToFunding || 3600;

  // 1. Net Spread Component (w1 = 0.35)
  // Standardized against 50 bps baseline: (NetSpread / 50) * 100 * 0.35
  const netSpreadNorm = Math.min(100, Math.max(0, (factors.netSpreadBps / 50.0) * 100));
  const netSpreadComponent = parseFloat((netSpreadNorm * 0.35).toFixed(2));

  // 2. Signed Basis Component (w2 = 0.20)
  // Positive signed basis (+10 to +30 bps) adds profit; adverse signed basis penalizes
  const signedBasisClamped = Math.max(-50, Math.min(50, factors.signedBasisBps));
  const basisNorm = Math.max(0, Math.min(100, 50 + signedBasisClamped));
  const basisComponent = parseFloat((basisNorm * 0.20).toFixed(2));

  // 3. Liquidity Depth Component (w4 = 0.15)
  // Ratio of available depth within 10 bps to required notional
  const depthRatio = targetNotional > 0 ? l2Depth / targetNotional : 5.0;
  const depthNorm = Math.min(100, Math.max(0, (depthRatio / 5.0) * 100));
  const depthComponent = parseFloat((depthNorm * 0.15).toFixed(2));

  // 4. Persistence Component (w3 = 0.15)
  const persistenceNorm = Math.min(100, Math.max(0, persistence));
  const persistenceComponent = parseFloat((persistenceNorm * 0.15).toFixed(2));

  // 5. Basis Volatility Penalty (w5 = 0.10)
  // Higher basis volatility increases risk of basis blowout
  const volNorm = Math.min(100, Math.max(0, (basisVol / 20.0) * 100));
  const volatilityPenalty = parseFloat((volNorm * 0.10).toFixed(2));

  // 6. Timing Penalty (w6 = 0.05)
  // Positions entered right into the settlement spike (< 15s) or too far (> 6h) receive small penalty
  let timingNorm = 0;
  if (secondsToFunding < 20) {
    timingNorm = 60; // Jitter penalty for entering right before settlement
  } else if (secondsToFunding > 6 * 3600) {
    timingNorm = 40; // Opportunity cost penalty for entering too early
  }
  const timingPenalty = parseFloat((timingNorm * 0.05).toFixed(2));

  // Composite Score
  const rawScore =
    netSpreadComponent +
    basisComponent +
    depthComponent +
    persistenceComponent -
    volatilityPenalty -
    timingPenalty;

  const compositeScore = parseFloat(Math.max(0, Math.min(100, rawScore)).toFixed(2));

  // Qualification Gate: Requires positive net spread and composite score >= 35
  const qualified = factors.netSpreadBps > 0 && compositeScore >= 35.0;
  let rejectionReason: string | undefined;

  if (factors.netSpreadBps <= 0) {
    rejectionReason = `NEGATIVE_NET_SPREAD: Net spread ${factors.netSpreadBps} bps <= 0`;
  } else if (compositeScore < 35.0) {
    rejectionReason = `LOW_COMPOSITE_SCORE: Score ${compositeScore} < 35.0 threshold`;
  }

  return {
    symbol: factors.symbol,
    corridor: factors.corridor,
    compositeScore,
    qualified,
    scoreBreakdown: {
      netSpreadComponent,
      basisComponent,
      depthComponent,
      persistenceComponent,
      volatilityPenalty,
      timingPenalty,
    },
    rejectionReason,
  };
}
