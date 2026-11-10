/**
 * Divergence Bot: Risk Bounds, Adverse Stop-Loss & Stagnancy Breaker Test Suite
 * Milestone 3 (M3) Specification Verification
 * 
 * Primary Invariants:
 * - ZERO BPS NOTATION: All spreads, hurdles, fees formatted strictly in % notation.
 * - STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * - DELTA-NEUTRALITY: Delta balance maintained |Delta_net| < 0.001.
 * - PRODUCTION ENGINE RECONNECTION: Directly tests @/lib/divergence/engine.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateExitGates,
  isFundingLockoutActive,
  getMinutesToNextFundingEpoch,
  ADVERSE_STOP_DRIFT_PCT,
  MAX_ADVERSE_LOSS_PCT,
  CARRY_DRAG_BREAKER_PCT,
  calculateNetRealizedPnlUsdt,
} from '@/lib/divergence/engine';

describe('Milestone 3: Risk Bounds, Adverse Stop-Loss & Dual-Horizon Stagnancy Breaker', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Core Happy Paths)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {
    it('TC1.6.1 (Adverse Divergence Stop-Loss): terminates immediately via dual-takers when adverse drift <= -0.150%', () => {
      // Entry at bt = +0.020%, current bt = -0.130% -> relative expansion = -0.150% (adverse drift)
      const res = evaluateExitGates(0.020, -0.130, 'LONG_BN_SHORT_BYB', 15, 0.000, 15.00);

      expect(res.shouldExit).toBe(true);
      expect(res.reason).toBe('ADVERSE_STOP');
      expect(res.statusBadge).toBe('EMERGENCY_STOP');
      expect(res.requiresReduceOnly).toBe(true);
      expect(res.relativeExpansionPercent).toBeLessThanOrEqual(-0.150);
    });

    it('TC1.6.2 (Maximum Loss Bounding): asserts normal stop loss is bounded to -0.410%', () => {
      expect(ADVERSE_STOP_DRIFT_PCT).toBe(-0.00150); // -0.150%
      expect(MAX_ADVERSE_LOSS_PCT).toBe(-0.00410); // -0.410% (-0.150% drift - 0.260% fees)

      const notional100 = 100.0;
      const loss100 = calculateNetRealizedPnlUsdt(notional100, -0.150, 0.000);
      expect(loss100).toBeCloseTo(-0.4100, 4);

      const notional15 = 15.0;
      const loss15 = calculateNetRealizedPnlUsdt(notional15, -0.150, 0.000);
      expect(loss15).toBeCloseTo(-0.0615, 4);
    });

    it('TC1.6.3 (Pre-Settlement Funding Lockout): freezes entries within 10m of funding if carry < -0.015%', () => {
      // Directly exercises production isFundingLockoutActive from @/lib/divergence/engine
      // 5 minutes before epoch with -0.020% negative carry -> FREEZE
      expect(isFundingLockoutActive(5, -0.020)).toBe(true);

      // 5 minutes before epoch with +0.010% positive carry -> ALLOWED
      expect(isFundingLockoutActive(5, 0.010)).toBe(false);

      // 25 minutes before epoch with -0.020% negative carry -> ALLOWED (plenty of time to expand)
      expect(isFundingLockoutActive(25, -0.020)).toBe(false);

      // Exact 10m boundary test
      expect(isFundingLockoutActive(10, -0.016)).toBe(true);
      expect(isFundingLockoutActive(10, -0.015)).toBe(false); // Threshold is < -0.015
      expect(isFundingLockoutActive(11, -0.020)).toBe(false);
    });

    it('TC1.6.3.b (Funding Epoch Calculation): accurately computes remaining minutes to UTC 00:00, 08:00, 16:00', () => {
      // Deterministic UTC timestamp tests for getMinutesToNextFundingEpoch
      const t0750 = Date.UTC(2026, 10, 9, 7, 50, 0); // 10 minutes before 08:00 UTC
      expect(getMinutesToNextFundingEpoch(t0750)).toBe(10);

      const t1545 = Date.UTC(2026, 10, 9, 15, 45, 0); // 15 minutes before 16:00 UTC
      expect(getMinutesToNextFundingEpoch(t1545)).toBe(15);

      const t2355 = Date.UTC(2026, 10, 9, 23, 55, 0); // 5 minutes before 00:00 UTC
      expect(getMinutesToNextFundingEpoch(t2355)).toBe(5);

      // Lockout active integration check
      const minsRemaining = getMinutesToNextFundingEpoch(t2355);
      expect(isFundingLockoutActive(minsRemaining, -0.025)).toBe(true);
    });

    it('TC1.6.4 (Hard Carry Breaker): triggers scratch unwind when accumulated carry drag >= 0.080%', () => {
      expect(CARRY_DRAG_BREAKER_PCT).toBe(0.00080); // 0.080%

      // Position held with -0.085% carry drag
      const res = evaluateExitGates(0.000, 0.050, 'LONG_BN_SHORT_BYB', 90, -0.085, 15.00);

      expect(res.shouldExit).toBe(true);
      expect(res.reason).toBe('CARRY_BREAKER');
      expect(res.statusBadge).toBe('STAGNANCY_SCRATCH');
      expect(res.requiresReduceOnly).toBe(true);
    });

    it('TC1.6.5 (Dual-Horizon Stagnancy Breaker): scratch exit at 180m if relExp < 0.120% and Net PnL <= 0', () => {
      // 185m duration, relExp = +0.040%, net PnL is negative (-$0.0330 on $15)
      const res = evaluateExitGates(0.000, 0.040, 'LONG_BN_SHORT_BYB', 185, 0.000, 15.00);

      expect(res.shouldExit).toBe(true);
      expect(res.reason).toBe('STAGNANCY_SCRATCH');
      expect(res.statusBadge).toBe('STAGNANCY_SCRATCH');
      expect(res.requiresReduceOnly).toBe(true);
    });

    it('TC1.6.6 (Momentum Extension to 360m): grants +60m extension if relExp >= 0.200% and expanding', () => {
      // 185m duration, relExp = +0.220%, expanding momentum
      const res = evaluateExitGates(0.000, 0.220, 'LONG_BN_SHORT_BYB', 185, 0.000, 15.00, true);

      // Stagnancy scratch WITHHELD because trade is expanding in profit!
      expect(res.shouldExit).toBe(false);
      expect(res.statusBadge).toBe('MOMENTUM_EXTENSION');
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC2.6.1 (Exact Boundary Adverse Stop -0.149% vs -0.150%): single epsilon distinction', () => {
      // -0.149% drift: holds with warning badge
      const below = evaluateExitGates(0.000, -0.149, 'LONG_BN_SHORT_BYB', 30, 0.000, 15.00);
      expect(below.shouldExit).toBe(false);
      expect(below.statusBadge).toBe('ADVERSE_DRIFT');

      // -0.150% drift: triggers immediate emergency stop
      const atStop = evaluateExitGates(0.000, -0.150, 'LONG_BN_SHORT_BYB', 30, 0.000, 15.00);
      expect(atStop.shouldExit).toBe(true);
      expect(atStop.reason).toBe('ADVERSE_STOP');
    });

    it('TC2.6.2 (Exact 180m Stagnancy Nominal Boundary): 179m holds; 180m triggers scratch', () => {
      // 179 minutes: holds
      const at179 = evaluateExitGates(0.000, 0.050, 'LONG_BN_SHORT_BYB', 179, 0.000, 15.00);
      expect(at179.shouldExit).toBe(false);

      // 180 minutes: triggers scratch
      const at180 = evaluateExitGates(0.000, 0.050, 'LONG_BN_SHORT_BYB', 180, 0.000, 15.00);
      expect(at180.shouldExit).toBe(true);
      expect(at180.reason).toBe('STAGNANCY_SCRATCH');
    });

    it('TC2.6.3 (Stagnancy Exemption When in Net Profit): hold maintained past 180m if net PnL > 0', () => {
      // At 190m, gross expansion = 0.280% -> Net PnL = (0.280% - 0.260%) * 15 = +$0.0030 USDT
      const profitableHold = evaluateExitGates(0.000, 0.280, 'LONG_BN_SHORT_BYB', 190, 0.000, 15.00);

      // Stagnancy scratch does NOT trigger because net PnL is positive!
      expect(profitableHold.shouldExit).toBe(false);
      expect(profitableHold.statusBadge).toBe('EXPANDING_IN_PROFIT');
    });

    it('TC2.6.4 (Hard 360m Ceiling Liquidation): unconditional termination regardless of profit/momentum', () => {
      // Even if trade has great momentum or is in profit, 360m hard ceiling terminates position
      const ceilingExit = evaluateExitGates(0.000, 0.350, 'LONG_BN_SHORT_BYB', 360, 0.000, 15.00, true);
      expect(ceilingExit.shouldExit).toBe(true);
      expect(ceilingExit.reason).toBe('MANDATORY_CEILING');
      expect(ceilingExit.requiresReduceOnly).toBe(true);
    });

    it('TC2.6.5 (Direction 2 Adverse Drift Symmetry): adverse drift stops identically for Direction 2', () => {
      // Direction 2: Entry bt = -0.020%, current bt = +0.130%
      // relExp = -0.020 - (+0.130) = -0.150% adverse drift
      const resDir2 = evaluateExitGates(-0.020, 0.130, 'SHORT_BN_LONG_BYB', 20, 0.000, 15.00);
      expect(resDir2.shouldExit).toBe(true);
      expect(resDir2.reason).toBe('ADVERSE_STOP');
      expect(resDir2.requiresReduceOnly).toBe(true);
    });
  });

  // =========================================================================
  // TIER 3 & 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================
  describe('Tier 3 & 4: Real-World Scenarios', () => {
    it('Scenario 3 (Persistent Non-Expanding Basis Drag): scratches cleanly at 180m', () => {
      // Basis oscillates around entry for 3 hours (180 minutes)
      const res = evaluateExitGates(0.030, 0.050, 'LONG_BN_SHORT_BYB', 180, -0.010, 15.00);

      expect(res.shouldExit).toBe(true);
      expect(res.reason).toBe('STAGNANCY_SCRATCH');
      expect(res.statusBadge).toBe('STAGNANCY_SCRATCH');
      expect(res.requiresReduceOnly).toBe(true);
    });
  });
});
