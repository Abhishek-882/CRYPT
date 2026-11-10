/**
 * Divergence Bot: Exit Gating, Dynamic Carry Ratchet & Zero-Loss Enforcer Test Suite
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
  calculateRelativeExpansionPercent,
  calculateNetRealizedPnlUsdt,
  calculateDynamicTargetPercent,
  evaluateExitGates,
  ROUNDTRIP_FEE_FRICTION_PCT,
  MIN_ZERO_LOSS_FLOOR_USDT,
  HARD_SAFETY_FLOOR_USDT,
  BASE_NOTIONAL_UNIT_USDT,
  getEffectiveZeroLossFloorUsdt,
} from '@/lib/divergence/engine';

describe('Milestone 3: Exit Gating, Dynamic Carry Ratchet & Zero-Loss Enforcer', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Core Happy Paths)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {
    it('TC1.5.1 (Relative Basis Expansion Trigger): triggers take-profit at relative expansion >= 0.380%', () => {
      // Direction 1: Entry bt = +0.020%, current bt = +0.400% -> relExp = +0.380%
      const relExpDir1 = calculateRelativeExpansionPercent(0.020, 0.400, 'LONG_BN_SHORT_BYB');
      expect(relExpDir1).toBe(0.380);

      const exitDir1 = evaluateExitGates(0.020, 0.400, 'LONG_BN_SHORT_BYB', 45, 0.000, 15.00);
      expect(exitDir1.shouldExit).toBe(true);
      expect(exitDir1.reason).toBe('EXPANSION_TP');
      expect(exitDir1.zeroLossSatisfied).toBe(true);
      expect(exitDir1.statusBadge).toBe('TARGET_REACHED');

      // Direction 2: Entry bt = -0.020%, current bt = -0.400% -> relExp = +0.380%
      const relExpDir2 = calculateRelativeExpansionPercent(-0.020, -0.400, 'SHORT_BN_LONG_BYB');
      expect(relExpDir2).toBe(0.380);

      const exitDir2 = evaluateExitGates(-0.020, -0.400, 'SHORT_BN_LONG_BYB', 45, 0.000, 15.00);
      expect(exitDir2.shouldExit).toBe(true);
      expect(exitDir2.reason).toBe('EXPANSION_TP');
      expect(exitDir2.zeroLossSatisfied).toBe(true);
    });

    it('TC1.5.2 (Absolute vs Relative Target Proof): entry at +0.100% requires +0.480% exit to prevent net loss', () => {
      const grossAbsoluteExpansion = 0.350 - 0.100;
      const netLossUsdt = calculateNetRealizedPnlUsdt(15.00, grossAbsoluteExpansion, 0.000);
      expect(netLossUsdt).toBeLessThan(0); // FLAWED! Net loss!

      // Divergence Bot strictly enforces Relative Expansion from Entry (+0.380%):
      const relativeExpansion = 0.480 - 0.100;
      const netProfitUsdt = calculateNetRealizedPnlUsdt(15.00, relativeExpansion, 0.000);
      expect(netProfitUsdt).toBe(0.0180);
      expect(netProfitUsdt).toBeGreaterThanOrEqual(MIN_ZERO_LOSS_FLOOR_USDT);
    });

    it('TC1.5.3 (Roundtrip Fee Friction Deduction): subtracts conservative 0.260% friction', () => {
      expect(ROUNDTRIP_FEE_FRICTION_PCT).toBe(0.00260); // 0.260%

      const notional = 15.00;
      const relExp = 0.380; // 0.380% gross
      const pnl = calculateNetRealizedPnlUsdt(notional, relExp, 0.000, 0.260);

      // (0.380% - 0.260%) * 15.00 = 0.120% * 15 = $0.0180 USDT
      expect(pnl).toBeCloseTo(0.0180, 4);
    });

    it('TC1.5.4 (Zero-Loss Hurdle Enforcer): blocks exit if Net Realized PnL < +$0.0100 USDT', () => {
      const subFloorExit = evaluateExitGates(0.000, 0.300, 'LONG_BN_SHORT_BYB', 30, 0.000, 15.00);
      expect(subFloorExit.shouldExit).toBe(false);
      expect(subFloorExit.zeroLossSatisfied).toBe(false);
      expect(subFloorExit.netPnlUsdt).toBeLessThan(MIN_ZERO_LOSS_FLOOR_USDT);

      const validExit = evaluateExitGates(0.000, 0.380, 'LONG_BN_SHORT_BYB', 30, 0.000, 15.00);
      expect(validExit.shouldExit).toBe(true);
      expect(validExit.zeroLossSatisfied).toBe(true);
      expect(validExit.netPnlUsdt).toBeGreaterThanOrEqual(MIN_ZERO_LOSS_FLOOR_USDT);
    });

    it('TC1.5.5 (Dynamic Carry Ratchet): negative carry increments expansion hurdle', () => {
      const baseTarget = 0.380;
      const negativeCarry = -0.025; // -0.025% funding drag over hold

      const dynamicTarget = calculateDynamicTargetPercent(baseTarget, negativeCarry);
      expect(dynamicTarget).toBe(0.405); // 0.380% + 0.025% = 0.405%

      const netPnl = calculateNetRealizedPnlUsdt(15.00, dynamicTarget, negativeCarry);
      expect(netPnl).toBeCloseTo(0.0180, 4);
    });

    it('TC1.5.6 (Mandatory reduceOnly: true Flag): verifies evaluation enforces reduceOnly', () => {
      const evalResult = evaluateExitGates(0.000, 0.380, 'LONG_BN_SHORT_BYB', 30, 0.000, 15.00);
      expect(evalResult.requiresReduceOnly).toBe(true);
    });

    it('Test L7-01 (Auto-Adaptive Dynamic Zero-Loss Floor Linear Scaling): verifies $60 -> $0.0100, $300 -> $0.0500, $600 -> $0.1000', () => {
      // Base constants
      expect(HARD_SAFETY_FLOOR_USDT).toBe(0.0100);
      expect(BASE_NOTIONAL_UNIT_USDT).toBe(60.00);

      // 1. $60 notional ($6 margin @ 10x leverage) -> $0.0100 floor
      const floor60 = getEffectiveZeroLossFloorUsdt(60.00);
      expect(floor60).toBe(0.0100);

      // 2. $300 notional ($30 margin @ 10x leverage) -> $0.0500 floor
      const floor300 = getEffectiveZeroLossFloorUsdt(300.00);
      expect(floor300).toBe(0.0500);

      // 3. $600 notional ($60 margin @ 10x leverage) -> $0.1000 floor
      const floor600 = getEffectiveZeroLossFloorUsdt(600.00);
      expect(floor600).toBe(0.1000);

      // 4. Sub-unit notional ($15 notional) enforces $0.0100 hard safety floor
      const floor15 = getEffectiveZeroLossFloorUsdt(15.00);
      expect(floor15).toBe(0.0100);

      // 5. User override above safety floor ($0.0500 configured floor on $60 notional)
      const floorUserOverride = getEffectiveZeroLossFloorUsdt(60.00, 0.0500);
      expect(floorUserOverride).toBe(0.0500);

      // 6. User override below safety floor ($0.0050 configured floor on $60 notional) is clamped to safety floor
      const floorClamped = getEffectiveZeroLossFloorUsdt(60.00, 0.0050);
      expect(floorClamped).toBe(0.0100);
    });

    it('TC1.5.8 (Dynamic Exit Hurdle Gate Enforcement for Scaled Notional): blocks sub-floor and approves >= floor', () => {
      // For $300 notional ($30 margin @ 10x), hurdle is $0.0500
      // 1. Sub-floor net profit: relExp = 0.270% (net = (0.270% - 0.260%) * 300 = $0.0300 < $0.0500)
      const subFloor300 = evaluateExitGates(0.000, 0.270, 'LONG_BN_SHORT_BYB', 30, 0.000, 300.00);
      expect(subFloor300.effectiveZeroLossFloorUsdt).toBe(0.0500);
      expect(subFloor300.netPnlUsdt).toBeCloseTo(0.0300, 4);
      expect(subFloor300.zeroLossSatisfied).toBe(false);
      expect(subFloor300.shouldExit).toBe(false);

      // 2. Net profit clearing hurdle: relExp = 0.380% (net = (0.380% - 0.260%) * 300 = $0.3600 >= $0.0500)
      const validExit300 = evaluateExitGates(0.000, 0.380, 'LONG_BN_SHORT_BYB', 30, 0.000, 300.00);
      expect(validExit300.effectiveZeroLossFloorUsdt).toBe(0.0500);
      expect(validExit300.netPnlUsdt).toBeCloseTo(0.3600, 4);
      expect(validExit300.zeroLossSatisfied).toBe(true);
      expect(validExit300.shouldExit).toBe(true);
      expect(validExit300.reason).toBe('EXPANSION_TP');

      // For $600 notional ($60 margin @ 10x), hurdle is $0.1000
      // 3. Sub-floor net profit: relExp = 0.270% (net = (0.270% - 0.260%) * 600 = $0.0600 < $0.1000)
      const subFloor600 = evaluateExitGates(0.000, 0.270, 'LONG_BN_SHORT_BYB', 30, 0.000, 600.00);
      expect(subFloor600.effectiveZeroLossFloorUsdt).toBe(0.1000);
      expect(subFloor600.netPnlUsdt).toBeCloseTo(0.0600, 4);
      expect(subFloor600.zeroLossSatisfied).toBe(false);
      expect(subFloor600.shouldExit).toBe(false);

      // 4. Net profit clearing hurdle: relExp = 0.380% (net = (0.380% - 0.260%) * 600 = $0.7200 >= $0.1000)
      const validExit600 = evaluateExitGates(0.000, 0.380, 'LONG_BN_SHORT_BYB', 30, 0.000, 600.00);
      expect(validExit600.effectiveZeroLossFloorUsdt).toBe(0.1000);
      expect(validExit600.netPnlUsdt).toBeCloseTo(0.7200, 4);
      expect(validExit600.zeroLossSatisfied).toBe(true);
      expect(validExit600.shouldExit).toBe(true);
      expect(validExit600.reason).toBe('EXPANSION_TP');
    });

    it('TC1.5.9 (User Configured Exit Hurdle Override in Gate Checks): honors user hurdle and custom expansion target', () => {
      // $60 notional, user hurdle = $0.0500 (higher than auto-adapted $0.0100)
      // Net PnL = (0.310% - 0.260%) * 60 = 0.050% * 60 = $0.0300 < $0.0500 hurdle
      const belowUserHurdle = evaluateExitGates(
        0.000,
        0.310,
        'LONG_BN_SHORT_BYB',
        30,
        0.000,
        60.00,
        false,
        0.0500
      );
      expect(belowUserHurdle.effectiveZeroLossFloorUsdt).toBe(0.0500);
      expect(belowUserHurdle.zeroLossSatisfied).toBe(false);
      expect(belowUserHurdle.shouldExit).toBe(false);

      // Net PnL = (0.380% - 0.260%) * 60 = 0.120% * 60 = $0.0720 >= $0.0500 hurdle
      const aboveUserHurdle = evaluateExitGates(
        0.000,
        0.380,
        'LONG_BN_SHORT_BYB',
        30,
        0.000,
        60.00,
        false,
        0.0500
      );
      expect(aboveUserHurdle.effectiveZeroLossFloorUsdt).toBe(0.0500);
      expect(aboveUserHurdle.zeroLossSatisfied).toBe(true);
      expect(aboveUserHurdle.shouldExit).toBe(true);
      expect(aboveUserHurdle.reason).toBe('EXPANSION_TP');

      // Custom user expansion target = 0.500%
      const customTargetNotMet = evaluateExitGates(
        0.000,
        0.420,
        'LONG_BN_SHORT_BYB',
        30,
        0.000,
        60.00,
        false,
        0.0100,
        0.500
      );
      expect(customTargetNotMet.shouldExit).toBe(false);

      const customTargetMet = evaluateExitGates(
        0.000,
        0.510,
        'LONG_BN_SHORT_BYB',
        30,
        0.000,
        60.00,
        false,
        0.0100,
        0.500
      );
      expect(customTargetMet.shouldExit).toBe(true);
      expect(customTargetMet.reason).toBe('EXPANSION_TP');
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC2.5.1 (Exact Boundary Take-Profit 0.379% vs 0.380%): single epsilon evaluation', () => {
      const below = evaluateExitGates(0.000, 0.379, 'LONG_BN_SHORT_BYB', 40, 0.000, 15.00);
      expect(below.shouldExit).toBe(false);
      expect(below.statusBadge).toBe('EXPANDING_IN_PROFIT');

      const atTarget = evaluateExitGates(0.000, 0.380, 'LONG_BN_SHORT_BYB', 40, 0.000, 15.00);
      expect(atTarget.shouldExit).toBe(true);
      expect(atTarget.reason).toBe('EXPANSION_TP');
    });

    it('TC2.5.2 (Exact Boundary Net Hurdle +$0.0099 vs +$0.0100 USDT): zero-loss floor precision', () => {
      const belowFloor = calculateNetRealizedPnlUsdt(100.0, 0.2699, 0.000);
      expect(belowFloor).toBe(0.0099);
      expect(belowFloor < MIN_ZERO_LOSS_FLOOR_USDT).toBe(true);

      const atFloor = calculateNetRealizedPnlUsdt(100.0, 0.2700, 0.000);
      expect(atFloor).toBe(0.0100);
      expect(atFloor >= MIN_ZERO_LOSS_FLOOR_USDT).toBe(true);
    });

    it('TC2.5.3 (Upper Compression Boundary Entry bt = +0.100%): requires +0.480% exit', () => {
      const bEntry = 0.100;
      const bTargetExit = bEntry + 0.380; // +0.480%

      const exitEval = evaluateExitGates(bEntry, bTargetExit, 'LONG_BN_SHORT_BYB', 25, 0.000, 15.00);
      expect(exitEval.shouldExit).toBe(true);
      expect(exitEval.netPnlUsdt).toBe(0.0180);
      expect(exitEval.netPnlUsdt).toBeGreaterThanOrEqual(MIN_ZERO_LOSS_FLOOR_USDT);
    });

    it('TC2.5.4 (Negative Basis Corridor Entry bt = -0.080%): Direction 1 requires +0.300% exit', () => {
      const bEntry = -0.080;
      const bTargetExit = bEntry + 0.380; // +0.300%

      const exitEval = evaluateExitGates(bEntry, bTargetExit, 'LONG_BN_SHORT_BYB', 25, 0.000, 15.00);
      expect(exitEval.shouldExit).toBe(true);
      expect(exitEval.relativeExpansionPercent).toBe(0.380);
      expect(exitEval.netPnlUsdt).toBe(0.0180);
    });

    it('TC2.5.5 (Extreme Funding Carry Drag -0.025%): widens TP hurdle to +0.405%', () => {
      const dynamicHurdle = calculateDynamicTargetPercent(0.380, -0.025);
      expect(dynamicHurdle).toBe(0.405);

      const notYetExit = evaluateExitGates(0.000, 0.380, 'LONG_BN_SHORT_BYB', 60, -0.025, 15.00);
      expect(notYetExit.shouldExit).toBe(false);

      const widenedExit = evaluateExitGates(0.000, 0.405, 'LONG_BN_SHORT_BYB', 60, -0.025, 15.00);
      expect(widenedExit.shouldExit).toBe(true);
      expect(widenedExit.reason).toBe('EXPANSION_TP');
    });
  });

  // =========================================================================
  // TIER 3 & 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================
  describe('Tier 3 & 4: Real-World Scenarios', () => {
    it('Scenario 1 (Flash Liquidation Cascade): Bybit plunge expands basis from +0.040% to +1.200%', () => {
      const bEntry = 0.040;
      const bCascade = 1.200;

      const evalCascade = evaluateExitGates(bEntry, bCascade, 'LONG_BN_SHORT_BYB', 5, 0.000, 15.00);
      expect(evalCascade.shouldExit).toBe(true);
      expect(evalCascade.reason).toBe('EXPANSION_TP');
      expect(evalCascade.relativeExpansionPercent).toBe(1.160);

      expect(evalCascade.netPnlUsdt).toBeCloseTo(0.1350, 4);
      expect(evalCascade.requiresReduceOnly).toBe(true);
    });
  });
});
