/**
 * STATARB-OU-PERP: Safety Invariant Guards & Persistence Breakers
 * 
 * Enforces rigorous risk controls and decoupling protections:
 * - Invariant 6: 30-Minute Low-Watermark Persistence Breaker (Exit side)
 * - Invariant 7: Upstream Sticky Decoupling Filter (Entry / Screener side)
 * - Invariant 4: Catastrophic Stop-Loss Override
 * - Invariant 5: Adverse Carry Inversion Breaker
 * - Invariant 0: Zero-Orphan 1:1 Delta Neutrality Assertion
 * 
 * 100% standalone with zero legacy dependencies.
 */

export const DEFAULT_PERSISTENCE_THRESHOLD_PCT = 1.0;
export const DEFAULT_PERSISTENCE_MINUTES = 30;
export const DEFAULT_CATASTROPHIC_ROI_PCT = -20.0;
export const DEFAULT_ADVERSE_CARRY_SPREAD_BPS = -20.0;

export interface Invariant6Result {
  triggered: boolean;
  holdMinutes: number;
  minDivergencePct: number;
  thresholdPct: number;
  sampleCount: number;
  reason: string;
}

export interface Invariant7Result {
  passed: boolean;
  code?: 'INVARIANT_7_STICKY_DECOUPLING_REJECTED';
  minDivergencePct: number;
  thresholdPct: number;
  sampleCount: number;
  reason: string;
}

export interface Invariant4Result {
  triggered: boolean;
  currentRoiPct: number;
  thresholdRoiPct: number;
  reason: string;
}

export interface Invariant5Result {
  triggered: boolean;
  fundingSpreadBps: number;
  thresholdBps: number;
  reason: string;
}

export interface ZeroOrphanResult {
  isNeutral: boolean;
  deltaNet: number;
  leg1Qty: number;
  leg2Qty: number;
  maxNetDelta: number;
  reason: string;
}

/**
 * Invariant 6: 30-Minute Low-Watermark Persistence Breaker (Exit Side)
 * 
 * Rules:
 * - If hold duration >= 30 minutes AND spread has remained continuously >= thresholdPct (1.0% default)
 *   for all samples in the 30-minute window without dropping below 1.0% even for a single tick ->
 *   triggers breaker (triggered: true).
 * - If at any point the spread dipped < 1.0% (e.g. 0.94%), the low-watermark timer resets to 0 (triggered: false).
 * 
 * When triggered, overrides Zero-Loss Gate to liquidate structural depegs.
 * 
 * @param holdMinutes Active position holding duration in minutes
 * @param divergenceHistory30m Rolling window of divergence samples (in % format, e.g. 1.25 for 1.25%)
 * @param thresholdPct Minimum persistent divergence threshold in percent (default: 1.0%)
 */
export function checkInvariant6PersistenceBreaker(
  holdMinutes: number,
  divergenceHistory30m: number[],
  thresholdPct: number = DEFAULT_PERSISTENCE_THRESHOLD_PCT
): Invariant6Result {
  if (!divergenceHistory30m || divergenceHistory30m.length === 0) {
    return {
      triggered: false,
      holdMinutes,
      minDivergencePct: 0,
      thresholdPct,
      sampleCount: 0,
      reason: 'No divergence history samples available. Invariant 6 breaker not triggered.',
    };
  }

  // Sanitize and get absolute divergence values
  const validSamples = divergenceHistory30m
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .map((v) => Math.abs(v));

  if (validSamples.length === 0) {
    return {
      triggered: false,
      holdMinutes,
      minDivergencePct: 0,
      thresholdPct,
      sampleCount: 0,
      reason: 'No valid numeric divergence samples. Breaker not triggered.',
    };
  }

  const minDivergencePct = Math.min(...validSamples);

  // If hold duration is less than 30 minutes, the breaker cannot trigger yet
  if (holdMinutes < DEFAULT_PERSISTENCE_MINUTES) {
    return {
      triggered: false,
      holdMinutes,
      minDivergencePct,
      thresholdPct,
      sampleCount: validSamples.length,
      reason: `Hold duration ${holdMinutes.toFixed(1)}m < ${DEFAULT_PERSISTENCE_MINUTES}m threshold. Breaker not triggered.`,
    };
  }

  // If the spread dipped below the threshold at any point, reset/do not trigger
  if (minDivergencePct < thresholdPct) {
    return {
      triggered: false,
      holdMinutes,
      minDivergencePct,
      thresholdPct,
      sampleCount: validSamples.length,
      reason: `Spread dipped to low watermark ${minDivergencePct.toFixed(3)}% < ${thresholdPct.toFixed(2)}%. Persistence timer reset.`,
    };
  }

  // All samples remained continuously >= threshold for >= 30 minutes
  return {
    triggered: true,
    holdMinutes,
    minDivergencePct,
    thresholdPct,
    sampleCount: validSamples.length,
    reason: `Invariant 6 Persistence Breaker triggered: Hold duration ${holdMinutes.toFixed(1)}m >= 30m and divergence remained continuously >= ${thresholdPct.toFixed(2)}% (min: ${minDivergencePct.toFixed(3)}% >= ${thresholdPct.toFixed(2)}%). Structural depeg detected.`,
  };
}

/**
 * Invariant 7: Upstream Sticky Decoupling Filter (Entry / Screener Side)
 * 
 * Rules:
 * - Before opening a position, inspect the historical 1-minute spread trajectory over the past 30 minutes.
 * - If the minimum observed divergence across the entire 30m window is >= thresholdPct (1.0%) ->
 *   REJECT pair with code INVARIANT_7_STICKY_DECOUPLING_REJECTED (pair has not touched < 1.0% in 30 minutes).
 * - If min divergence < 1.0% -> PASS (passed: true).
 * 
 * @param divergenceHistory30m Rolling window of divergence samples (in % format, e.g. 1.25 for 1.25%)
 * @param thresholdPct Minimum persistent divergence threshold in percent (default: 1.0%)
 */
export function checkInvariant7StickyDecoupling(
  divergenceHistory30m: number[],
  thresholdPct: number = DEFAULT_PERSISTENCE_THRESHOLD_PCT
): Invariant7Result {
  if (!divergenceHistory30m || divergenceHistory30m.length === 0) {
    return {
      passed: true,
      minDivergencePct: 0,
      thresholdPct,
      sampleCount: 0,
      reason: 'No divergence history available. Invariant 7 sticky decoupling check passed by default.',
    };
  }

  const validSamples = divergenceHistory30m
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .map((v) => Math.abs(v));

  if (validSamples.length === 0) {
    return {
      passed: true,
      minDivergencePct: 0,
      thresholdPct,
      sampleCount: 0,
      reason: 'No valid numeric divergence samples. Invariant 7 check passed.',
    };
  }

  const minDivergencePct = Math.min(...validSamples);

  // If the minimum divergence observed across the window is >= thresholdPct,
  // the pair has NEVER touched below the threshold in 30 minutes -> REJECT!
  if (minDivergencePct >= thresholdPct) {
    return {
      passed: false,
      code: 'INVARIANT_7_STICKY_DECOUPLING_REJECTED',
      minDivergencePct,
      thresholdPct,
      sampleCount: validSamples.length,
      reason: `[INVARIANT_7_STICKY_DECOUPLING_REJECTED] Pair divergence remained >= ${thresholdPct.toFixed(2)}% continuously over 30m window (min observed: ${minDivergencePct.toFixed(3)}%). Structurally decoupled market.`,
    };
  }

  return {
    passed: true,
    minDivergencePct,
    thresholdPct,
    sampleCount: validSamples.length,
    reason: `Invariant 7 passed: Pair touched low watermark of ${minDivergencePct.toFixed(3)}% < ${thresholdPct.toFixed(2)}% within the 30m window. Mean-reverting regime intact.`,
  };
}

/**
 * Invariant 4: Catastrophic Stop-Loss Override
 * 
 * Rules:
 * - If mark-to-market ROI <= -20.0%, trigger immediate emergency liquidation,
 *   overriding the Zero-Loss Invariant to safeguard portfolio solvency.
 */
export function checkInvariant4CatastrophicStopLoss(
  currentRoiPct: number,
  thresholdRoiPct: number = DEFAULT_CATASTROPHIC_ROI_PCT
): Invariant4Result {
  const triggered = currentRoiPct <= thresholdRoiPct;
  return {
    triggered,
    currentRoiPct,
    thresholdRoiPct,
    reason: triggered
      ? `Catastrophic stop-loss triggered: ROI ${currentRoiPct.toFixed(2)}% <= ${thresholdRoiPct.toFixed(2)}% cap. Executing emergency liquidation.`
      : `ROI ${currentRoiPct.toFixed(2)}% above catastrophic stop ${thresholdRoiPct.toFixed(2)}%.`,
  };
}

/**
 * Invariant 5: Adverse Carry Inversion Breaker
 * 
 * Rules:
 * - If forward predicted funding rate spread flips severely negative (<= -20 bps against the trade),
 *   holding further will cause terminal funding bleed. Trigger emergency taker exit.
 */
export function checkInvariant5AdverseCarryInversion(
  fundingSpreadBps: number,
  thresholdBps: number = DEFAULT_ADVERSE_CARRY_SPREAD_BPS
): Invariant5Result {
  const triggered = fundingSpreadBps <= thresholdBps;
  return {
    triggered,
    fundingSpreadBps,
    thresholdBps,
    reason: triggered
      ? `Adverse Carry Inversion Breaker triggered: Funding spread ${fundingSpreadBps.toFixed(1)} bps <= ${thresholdBps.toFixed(1)} bps. Exiting to prevent fee bleed.`
      : `Funding spread ${fundingSpreadBps.toFixed(1)} bps above adverse threshold ${thresholdBps.toFixed(1)} bps.`,
  };
}

/**
 * Invariant 0: Zero-Orphan 1:1 Delta Neutrality Assertion
 * 
 * Rules:
 * - Sizing between Leg 1 and Leg 2 must match within strict tolerance (|Delta_net| < 0.001).
 */
export function checkZeroOrphanInvariant(
  leg1Qty: number,
  leg2Qty: number,
  maxNetDelta: number = 0.001
): ZeroOrphanResult {
  const deltaNet = Math.abs(leg1Qty - leg2Qty);
  const isNeutral = deltaNet <= maxNetDelta;

  return {
    isNeutral,
    deltaNet,
    leg1Qty,
    leg2Qty,
    maxNetDelta,
    reason: isNeutral
      ? `Delta neutrality verified: |Delta_net| = ${deltaNet.toFixed(6)} <= ${maxNetDelta}.`
      : `Zero-Orphan Invariant violated: Leg 1 qty (${leg1Qty}) does not match Leg 2 qty (${leg2Qty}), |Delta_net| = ${deltaNet.toFixed(6)} > ${maxNetDelta}.`,
  };
}
