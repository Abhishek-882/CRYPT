/**
 * Synthetic Invariant Test Fixtures for STATARB-OU-PERP
 * Target: Invariant 6 (30-Minute Low-Watermark Persistence Breaker)
 *         Invariant 7 (Upstream Sticky Decoupling Filter)
 * 
 * Provides deterministic 30-minute divergence time series covering:
 * - 30-min continuous divergence sequences (>= 1.0%)
 * - Reset sequences (dipping to 0.85% at minute 24)
 * - Invariant 7 pre-entry rejected histories (min divergence 1.04%)
 * - Invariant 7 accepted histories (dipping to 0.45% at minute 12)
 * - Boundary threshold conditions, sparse sample guards, and custom thresholds
 */

export interface InvariantScenario {
  name: string;
  divergenceHistory: number[];
  holdMinutes: number;
  thresholdPct: number;
  expectedInv6Triggered: boolean;
  expectedInv7Passed: boolean;
  expectedMinDivergence: number;
  description: string;
}

/**
 * 30-minute continuous divergence trajectory strictly >= 1.00%.
 * Every single 1-minute sample remains above 1.00% (min = 1.01%).
 * - Triggers Invariant 6 when hold duration >= 30m.
 * - Rejects Invariant 7 pre-entry screening.
 */
export const CONTINUOUS_DIVERGENCE_30M: number[] = [
  1.12, 1.15, 1.20, 1.18, 1.14, 1.10, 1.25, 1.28, 1.30, 1.22,
  1.15, 1.12, 1.08, 1.06, 1.04, 1.05, 1.07, 1.09, 1.11, 1.15,
  1.20, 1.18, 1.14, 1.10, 1.08, 1.05, 1.04, 1.03, 1.02, 1.01,
];

/**
 * Reset sequence where divergence stays >= 1.0% until minute 24, where it dips to 0.85%,
 * and then returns to 1.05%+ for minutes 25-29.
 * - Min divergence = 0.85% (< 1.00%).
 * - Invariant 6 low-watermark timer RESETS at minute 24 -> NOT triggered at minute 30.
 * - Invariant 7 passes (pair touched < 1.00% within the 30-min window).
 */
export const RESET_SEQUENCE_DIPPING_AT_24: number[] = [
  1.10, 1.12, 1.15, 1.18, 1.14, 1.09, 1.08, 1.06, 1.05, 1.07, // 0-9
  1.12, 1.15, 1.20, 1.18, 1.14, 1.10, 1.08, 1.06, 1.05, 1.04, // 10-19
  1.03, 1.02, 1.01, 1.00, 0.85, 1.05, 1.08, 1.12, 1.15, 1.18, // 20-29 (minute 24 = 0.85)
];

/**
 * Invariant 7 Pre-Entry Rejected History:
 * Trajectory where spread never dipped below 1.04% across the full 30-minute window.
 * - Min divergence = 1.04% >= 1.00%.
 * - Disqualified by Invariant 7 (sticky decoupling).
 */
export const INVARIANT_7_REJECTED_HISTORY: number[] = [
  1.25, 1.22, 1.18, 1.15, 1.12, 1.10, 1.08, 1.06, 1.05, 1.04, // 0-9
  1.06, 1.09, 1.14, 1.18, 1.22, 1.25, 1.30, 1.28, 1.24, 1.20, // 10-19
  1.16, 1.14, 1.10, 1.08, 1.07, 1.05, 1.04, 1.06, 1.10, 1.15, // 20-29 (min = 1.04)
];

/**
 * Invariant 7 Accepted History:
 * Trajectory that started decoupled (1.25%), dipped down to 0.45% at minute 12,
 * proving active mean-reverting elasticity, before widening again to 1.10%.
 * - Min divergence = 0.45% (< 1.00%).
 * - Passes Invariant 7 (not sticky decoupled).
 */
export const INVARIANT_7_ACCEPTED_HISTORY: number[] = [
  1.25, 1.20, 1.15, 1.05, 0.95, 0.82, 0.70, 0.60, 0.52, 0.48, // 0-9
  0.46, 0.47, 0.45, 0.49, 0.55, 0.65, 0.78, 0.88, 0.96, 1.02, // 10-19 (minute 12 = 0.45)
  1.05, 1.08, 1.12, 1.15, 1.10, 1.06, 1.04, 1.05, 1.08, 1.10, // 20-29
];

/**
 * Boundary Test Sequence: Flat exactly at 1.000% threshold.
 * Condition: divergence >= 1.000% is satisfied for every sample.
 */
export const EXACT_THRESHOLD_FLAT_1PCT: number[] = new Array(30).fill(1.000);

/**
 * Boundary Test Sequence: Borderline dip to 0.999% at the final minute (sample 29).
 * Condition >= 1.000% is violated at the very end -> breaker must NOT trip.
 */
export const BORDERLINE_DIP_LAST_MINUTE: number[] = [
  ...new Array(29).fill(1.100),
  0.999, // minute 29 dip just below 1.000%
];

/**
 * Boundary Test Sequence: Borderline dip to 0.999% at the very first minute (sample 0).
 */
export const BORDERLINE_DIP_FIRST_MINUTE: number[] = [
  0.999, // minute 0 dip just below 1.000%
  ...new Array(29).fill(1.100),
];

/**
 * Sparse sample sequence (N = 5 samples, below minimum statistical significance window of 8 samples).
 */
export const SPARSE_HISTORY_5_SAMPLES: number[] = [1.15, 1.20, 1.18, 1.25, 1.22];

/**
 * Normal healthy mean-reverting basis history (0.10% to 0.35% range).
 */
export const NORMAL_MEAN_REVERTING_HISTORY: number[] = [
  0.28, 0.25, 0.22, 0.18, 0.15, 0.12, 0.10, 0.14, 0.18, 0.22,
  0.25, 0.30, 0.32, 0.35, 0.30, 0.26, 0.21, 0.16, 0.14, 0.12,
  0.15, 0.19, 0.24, 0.28, 0.31, 0.29, 0.24, 0.20, 0.17, 0.15,
];

/**
 * Comprehensive fixture matrix for automated parametrized testing
 */
export const INVARIANT_TEST_MATRIX: InvariantScenario[] = [
  {
    name: 'Invariant 6 Trigger: 30m continuous >= 1.0%, hold duration = 30m',
    divergenceHistory: CONTINUOUS_DIVERGENCE_30M,
    holdMinutes: 30,
    thresholdPct: 1.0,
    expectedInv6Triggered: true,
    expectedInv7Passed: false,
    expectedMinDivergence: 1.01,
    description: 'Continuous decoupling without single dip below 1.0% triggers persistence breaker at 30 min',
  },
  {
    name: 'Invariant 6 Reset: Dip to 0.85% at minute 24 resets breaker timer',
    divergenceHistory: RESET_SEQUENCE_DIPPING_AT_24,
    holdMinutes: 30,
    thresholdPct: 1.0,
    expectedInv6Triggered: false,
    expectedInv7Passed: true,
    expectedMinDivergence: 0.85,
    description: 'Dip to 0.85% at minute 24 resets the low-watermark timer; only 5 continuous mins since reset',
  },
  {
    name: 'Invariant 6 Hold Guard: 30m continuous divergence but position hold time is only 25 min',
    divergenceHistory: CONTINUOUS_DIVERGENCE_30M,
    holdMinutes: 25,
    thresholdPct: 1.0,
    expectedInv6Triggered: false,
    expectedInv7Passed: false,
    expectedMinDivergence: 1.01,
    description: 'Even if spread is continuously high, hold duration must reach at least 30 min before tripping',
  },
  {
    name: 'Invariant 7 Rejected: Minimum divergence across 30m is 1.04% >= 1.00%',
    divergenceHistory: INVARIANT_7_REJECTED_HISTORY,
    holdMinutes: 0,
    thresholdPct: 1.0,
    expectedInv6Triggered: false,
    expectedInv7Passed: false,
    expectedMinDivergence: 1.04,
    description: 'Upstream screening disqualifies pairs that have remained decoupled persistently',
  },
  {
    name: 'Invariant 7 Accepted: Minimum divergence drops to 0.45% at minute 12',
    divergenceHistory: INVARIANT_7_ACCEPTED_HISTORY,
    holdMinutes: 0,
    thresholdPct: 1.0,
    expectedInv6Triggered: false,
    expectedInv7Passed: true,
    expectedMinDivergence: 0.45,
    description: 'Elastic spread that touched 0.45% is confirmed mean-reverting and passes screening',
  },
  {
    name: 'Exact Threshold Boundary: Flat 1.000% divergence sequence',
    divergenceHistory: EXACT_THRESHOLD_FLAT_1PCT,
    holdMinutes: 30,
    thresholdPct: 1.0,
    expectedInv6Triggered: true,
    expectedInv7Passed: false,
    expectedMinDivergence: 1.000,
    description: 'Exactly 1.000% satisfies >= 1.000% threshold',
  },
  {
    name: 'Last Minute Dip: 0.999% at sample 29 resets persistence breaker',
    divergenceHistory: BORDERLINE_DIP_LAST_MINUTE,
    holdMinutes: 30,
    thresholdPct: 1.0,
    expectedInv6Triggered: false,
    expectedInv7Passed: true,
    expectedMinDivergence: 0.999,
    description: 'A 0.001% dip below threshold at the final minute resets breaker and allows Invariant 7 pass',
  },
];

/**
 * Generator helper to dynamically build arbitrary divergence sequences for fuzz testing
 */
export function generateSyntheticDivergenceHistory(opts: {
  length?: number;
  basePct?: number;
  noiseAmplitude?: number;
  dipIndex?: number;
  dipValue?: number;
}): number[] {
  const {
    length = 30,
    basePct = 1.10,
    noiseAmplitude = 0.05,
    dipIndex,
    dipValue,
  } = opts;

  const result: number[] = [];
  for (let i = 0; i < length; i++) {
    if (dipIndex !== undefined && i === dipIndex && dipValue !== undefined) {
      result.push(dipValue);
    } else {
      // Deterministic pseudo-random variation based on index
      const variation = Math.sin(i * 0.7) * noiseAmplitude;
      result.push(Math.round((basePct + variation) * 1000) / 1000);
    }
  }
  return result;
}
