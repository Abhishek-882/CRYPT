/**
 * Unit Test Suite: Safety Invariant Guards & Persistence Breakers
 * Target: web/lib/statarb/execution/invariantGuard.ts
 * 
 * Verifies:
 * - Invariant 6: 30-Minute Low-Watermark Persistence Breaker (Exit side)
 *   - Continuous >= 1.0% divergence over 30 minutes trips breaker
 *   - Dip to 0.85% at minute 24 resets breaker timer
 *   - Hold duration guard: < 30 minutes does NOT trip breaker even if divergence is high
 *   - Boundary conditions: exactly 1.000%, 0.999% dip at last minute
 * - Invariant 7: Upstream Sticky Decoupling Filter (Entry / Screener side)
 *   - Pre-entry rejection when min divergence >= 1.04% over 30 minutes
 *   - Pre-entry acceptance when divergence dipped to 0.45% at minute 12
 *   - Rejection error code: INVARIANT_7_STICKY_DECOUPLING_REJECTED
 * - Invariant 0: Zero-Orphan 1:1 Delta Neutrality Assertion
 * - Invariant 4 & Invariant 5: Catastrophic Stop-Loss and Adverse Carry Inversion Breakers
 */

import { describe, it, expect } from 'vitest';
import {
  checkInvariant6PersistenceBreaker,
  checkInvariant7StickyDecoupling,
  checkInvariant4CatastrophicStopLoss,
  checkInvariant5AdverseCarryInversion,
  checkZeroOrphanInvariant,
  DEFAULT_PERSISTENCE_THRESHOLD_PCT,
  DEFAULT_PERSISTENCE_MINUTES,
} from '@/lib/statarb/execution/invariantGuard';
import {
  CONTINUOUS_DIVERGENCE_30M,
  RESET_SEQUENCE_DIPPING_AT_24,
  INVARIANT_7_REJECTED_HISTORY,
  INVARIANT_7_ACCEPTED_HISTORY,
  EXACT_THRESHOLD_FLAT_1PCT,
  BORDERLINE_DIP_LAST_MINUTE,
  BORDERLINE_DIP_FIRST_MINUTE,
  SPARSE_HISTORY_5_SAMPLES,
  NORMAL_MEAN_REVERTING_HISTORY,
  INVARIANT_TEST_MATRIX,
  generateSyntheticDivergenceHistory,
} from './fixtures/invariantFixtures';

describe('Invariant Guard Unit Tests (invariantGuard.ts)', () => {
  // =========================================================================
  // INVARIANT 6: 30-MINUTE LOW-WATERMARK PERSISTENCE BREAKER (EXIT SIDE)
  // =========================================================================
  describe('Invariant 6: 30-Minute Low-Watermark Persistence Breaker', () => {
    it('triggers breaker when divergence remains continuously >= 1.0% for >= 30 minutes', () => {
      const holdMinutes = 30.5;
      const result = checkInvariant6PersistenceBreaker(holdMinutes, CONTINUOUS_DIVERGENCE_30M);

      expect(result.triggered).toBe(true);
      expect(result.holdMinutes).toBe(holdMinutes);
      expect(result.minDivergencePct).toBeGreaterThanOrEqual(1.0);
      expect(result.reason).toContain('Invariant 6 Persistence Breaker triggered');
      expect(result.reason).toContain('Structural depeg detected');
    });

    it('resets breaker timer and does NOT trigger when divergence dipped to 0.85% at minute 24', () => {
      const holdMinutes = 30.0;
      const result = checkInvariant6PersistenceBreaker(holdMinutes, RESET_SEQUENCE_DIPPING_AT_24);

      expect(result.triggered).toBe(false);
      expect(result.minDivergencePct).toBe(0.85);
      expect(result.reason).toContain('Spread dipped to low watermark');
      expect(result.reason).toContain('Persistence timer reset');
    });

    it('does NOT trigger when hold duration is less than 30 minutes despite continuous high divergence', () => {
      // 25 minutes hold duration < 30 min required
      const holdMinutes = 25.0;
      const result = checkInvariant6PersistenceBreaker(holdMinutes, CONTINUOUS_DIVERGENCE_30M);

      expect(result.triggered).toBe(false);
      expect(result.holdMinutes).toBe(25.0);
      expect(result.reason).toContain('< 30m threshold');
    });

    it('triggers when divergence is flat at exactly 1.000% threshold for 30 minutes', () => {
      const holdMinutes = 30.0;
      const result = checkInvariant6PersistenceBreaker(holdMinutes, EXACT_THRESHOLD_FLAT_1PCT);

      expect(result.triggered).toBe(true);
      expect(result.minDivergencePct).toBe(1.000);
    });

    it('does NOT trigger when divergence dips to 0.999% at sample 29 (just below 1.000%)', () => {
      const holdMinutes = 30.0;
      const result = checkInvariant6PersistenceBreaker(holdMinutes, BORDERLINE_DIP_LAST_MINUTE);

      expect(result.triggered).toBe(false);
      expect(result.minDivergencePct).toBe(0.999);
      expect(result.reason).toContain('Persistence timer reset');
    });

    it('does NOT trigger when divergence dipped to 0.999% at sample 0', () => {
      const holdMinutes = 30.0;
      const result = checkInvariant6PersistenceBreaker(holdMinutes, BORDERLINE_DIP_FIRST_MINUTE);

      expect(result.triggered).toBe(false);
      expect(result.minDivergencePct).toBe(0.999);
    });

    it('safely handles empty or missing sample history', () => {
      const emptyResult = checkInvariant6PersistenceBreaker(35.0, []);
      expect(emptyResult.triggered).toBe(false);
      expect(emptyResult.sampleCount).toBe(0);

      const nullResult = checkInvariant6PersistenceBreaker(35.0, null as any);
      expect(nullResult.triggered).toBe(false);
    });

    it('respects custom thresholdPct (e.g. 1.5%)', () => {
      // Divergence ranges from 1.01% to 1.30%, which is < 1.5% custom threshold
      const result = checkInvariant6PersistenceBreaker(35.0, CONTINUOUS_DIVERGENCE_30M, 1.5);
      expect(result.triggered).toBe(false);
      expect(result.thresholdPct).toBe(1.5);
    });

    it('handles negative divergence percentage inputs via absolute value normalization', () => {
      // Spread can be negative if Bybit is rich: -1.15% is 1.15% divergence
      const negativeSeries = CONTINUOUS_DIVERGENCE_30M.map((v) => -v);
      const result = checkInvariant6PersistenceBreaker(32.0, negativeSeries);
      expect(result.triggered).toBe(true);
      expect(result.minDivergencePct).toBeGreaterThanOrEqual(1.0);
    });
  });

  // =========================================================================
  // INVARIANT 7: UPSTREAM STICKY DECOUPLING FILTER (ENTRY / SCREENER SIDE)
  // =========================================================================
  describe('Invariant 7: Upstream Sticky Decoupling Filter', () => {
    it('REJECTS pre-entry candidate when spread remained >= 1.04% throughout the entire 30m window', () => {
      const result = checkInvariant7StickyDecoupling(INVARIANT_7_REJECTED_HISTORY);

      expect(result.passed).toBe(false);
      expect(result.code).toBe('INVARIANT_7_STICKY_DECOUPLING_REJECTED');
      expect(result.minDivergencePct).toBe(1.04);
      expect(result.thresholdPct).toBe(DEFAULT_PERSISTENCE_THRESHOLD_PCT);
      expect(result.reason).toContain('[INVARIANT_7_STICKY_DECOUPLING_REJECTED]');
      expect(result.reason).toContain('Structurally decoupled market');
    });

    it('ACCEPTS pre-entry candidate when spread dipped to 0.45% at minute 12', () => {
      const result = checkInvariant7StickyDecoupling(INVARIANT_7_ACCEPTED_HISTORY);

      expect(result.passed).toBe(true);
      expect(result.code).toBeUndefined();
      expect(result.minDivergencePct).toBe(0.45);
      expect(result.reason).toContain('Invariant 7 passed');
      expect(result.reason).toContain('Mean-reverting regime intact');
    });

    it('REJECTS continuous 30m divergence trajectory (min 1.01% >= 1.0%)', () => {
      const result = checkInvariant7StickyDecoupling(CONTINUOUS_DIVERGENCE_30M);

      expect(result.passed).toBe(false);
      expect(result.code).toBe('INVARIANT_7_STICKY_DECOUPLING_REJECTED');
    });

    it('ACCEPTS reset sequence that dipped to 0.85% at minute 24', () => {
      const result = checkInvariant7StickyDecoupling(RESET_SEQUENCE_DIPPING_AT_24);

      expect(result.passed).toBe(true);
      expect(result.minDivergencePct).toBe(0.85);
    });

    it('ACCEPTS normal mean-reverting basis history (0.10% to 0.35%)', () => {
      const result = checkInvariant7StickyDecoupling(NORMAL_MEAN_REVERTING_HISTORY);

      expect(result.passed).toBe(true);
      expect(result.minDivergencePct).toBe(0.10);
    });

    it('safely handles empty history by passing with zero watermark', () => {
      const result = checkInvariant7StickyDecoupling([]);
      expect(result.passed).toBe(true);
      expect(result.sampleCount).toBe(0);
    });

    it('filters non-numeric or NaN anomalies safely', () => {
      const dirtyHistory = [1.25, NaN, null as any, 1.15, undefined as any, 0.50, 1.30];
      const result = checkInvariant7StickyDecoupling(dirtyHistory);

      expect(result.passed).toBe(true);
      expect(result.minDivergencePct).toBe(0.50);
      expect(result.sampleCount).toBe(4);
    });

    it('verifies custom threshold (e.g. 0.80% filter)', () => {
      // RESET_SEQUENCE_DIPPING_AT_24 has min divergence 0.85%
      // With standard 1.0% threshold: passes (0.85 < 1.00)
      const standardPass = checkInvariant7StickyDecoupling(RESET_SEQUENCE_DIPPING_AT_24, 1.0);
      expect(standardPass.passed).toBe(true);

      // With strict 0.80% threshold: fails (0.85 >= 0.80)
      const strictReject = checkInvariant7StickyDecoupling(RESET_SEQUENCE_DIPPING_AT_24, 0.80);
      expect(strictReject.passed).toBe(false);
      expect(strictReject.code).toBe('INVARIANT_7_STICKY_DECOUPLING_REJECTED');
    });
  });

  // =========================================================================
  // PARAMETRIZED TEST MATRIX VERIFICATION
  // =========================================================================
  describe('Parametrized Invariant Matrix Verification', () => {
    it.each(INVARIANT_TEST_MATRIX)('$name', (scenario) => {
      const inv6 = checkInvariant6PersistenceBreaker(
        scenario.holdMinutes,
        scenario.divergenceHistory,
        scenario.thresholdPct
      );
      expect(inv6.triggered).toBe(scenario.expectedInv6Triggered);

      const inv7 = checkInvariant7StickyDecoupling(
        scenario.divergenceHistory,
        scenario.thresholdPct
      );
      expect(inv7.passed).toBe(scenario.expectedInv7Passed);
      expect(inv7.minDivergencePct).toBeCloseTo(scenario.expectedMinDivergence, 2);
    });
  });

  // =========================================================================
  // INVARIANT 0: ZERO-ORPHAN 1:1 DELTA NEUTRALITY ASSERTION
  // =========================================================================
  describe('Invariant 0: Zero-Orphan 1:1 Delta Neutrality', () => {
    it('verifies exact 1:1 quantity matching', () => {
      const result = checkZeroOrphanInvariant(100.0, 100.0);
      expect(result.isNeutral).toBe(true);
      expect(result.deltaNet).toBe(0.0);
    });

    it('verifies delta neutrality within tolerance (|Delta_net| <= 0.001)', () => {
      const result = checkZeroOrphanInvariant(100.0005, 100.0);
      expect(result.isNeutral).toBe(true);
      expect(result.deltaNet).toBeCloseTo(0.0005, 4);
    });

    it('flags violation when quantity mismatch exceeds 0.001', () => {
      const result = checkZeroOrphanInvariant(100.05, 100.0);
      expect(result.isNeutral).toBe(false);
      expect(result.deltaNet).toBeCloseTo(0.05, 2);
      expect(result.reason).toContain('Zero-Orphan Invariant violated');
    });
  });

  // =========================================================================
  // INVARIANTS 4 & 5: CATASTROPHIC STOP-LOSS & ADVERSE CARRY INVERSION
  // =========================================================================
  describe('Invariants 4 & 5: Catastrophic Risk Breakers', () => {
    it('Invariant 4 triggers when mark-to-market ROI <= -20.0%', () => {
      const tripped = checkInvariant4CatastrophicStopLoss(-20.5);
      expect(tripped.triggered).toBe(true);
      expect(tripped.reason).toContain('Catastrophic stop-loss triggered');

      const boundary = checkInvariant4CatastrophicStopLoss(-20.0);
      expect(boundary.triggered).toBe(true);

      const safe = checkInvariant4CatastrophicStopLoss(-19.8);
      expect(safe.triggered).toBe(false);
    });

    it('Invariant 5 triggers when predicted funding spread <= -20 bps', () => {
      const tripped = checkInvariant5AdverseCarryInversion(-22.0);
      expect(tripped.triggered).toBe(true);
      expect(tripped.reason).toContain('Adverse Carry Inversion Breaker triggered');

      const safe = checkInvariant5AdverseCarryInversion(-15.0);
      expect(safe.triggered).toBe(false);
    });
  });
});
