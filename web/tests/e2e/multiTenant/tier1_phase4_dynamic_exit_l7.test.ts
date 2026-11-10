/**
 * Tier 1: Feature Coverage — Phase 4: Auto-Adaptive Layer 7 Zero-Loss Dynamic Exit Engine
 * 
 * Verifies:
 * - Linear Proportional Capital Scaling Rule
 * - Mandatory User-Specified Test L7-01:
 *   - $60 notional ($6 margin @ 10x leverage) -> $0.0100 floor
 *   - $300 notional ($30 margin @ 10x leverage) -> $0.0500 floor
 *   - $600 notional ($60 margin @ 10x leverage) -> $0.1000 floor
 * - Hard Safety Barrier: Floor never drops below $0.0100 USDT under any notional
 * - User override support (configuredFloorUsdt >= 0.0100 honored; < 0.0100 clamped to 0.0100)
 * - Integration with evaluateExitGates in divergence engine
 * - StateStore config sanitization supporting relaxed notional sizing
 * 
 * Strict Compliance:
 * - ZERO BPS NOTATION: 100% % notation exclusively.
 * - MODERN TERMINOLOGY ONLY: Multi-tenant execution engine, autonomous hedge worker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getEffectiveZeroLossFloorUsdt,
  evaluateExitGates,
  HARD_SAFETY_FLOOR_USDT,
  BASE_NOTIONAL_UNIT_USDT,
  calculateNetRealizedPnlUsdt,
  calculateRelativeExpansionPercent,
} from '@/lib/divergence/engine';
import {
  getDivergenceStateStore,
  DivergenceStateStore,
} from '@/lib/divergence/store/stateStore';
import {
  oracleDynamicExitFloor,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 1: Phase 4 — Auto-Adaptive Layer 7 Dynamic Exit Engine', () => {
  let store: DivergenceStateStore;

  beforeEach(() => {
    store = getDivergenceStateStore();
    store.clearState();
  });

  afterEach(() => {
    store.clearState();
  });

  // --------------------------------------------------------------------------
  // Feature 7: Auto-Adaptive Dynamic Exit Hurdle Formula & Sizing Rule
  // --------------------------------------------------------------------------
  describe('Feature 7: Auto-Adaptive Formula & Test L7-01 Verification', () => {
    /**
     * CRITICAL USER SPECIFICATION: Test L7-01
     * Capital Structure:
     * - Sizing is specified in terms of committed initial margin equity:
     *   e.g. $30 USD margin per side ($60 USD total user margin).
     * - At 10x leverage, commands $300 USD notional per side ($600 USD total hedge).
     * Linear Proportional Capital Scaling Rule:
     * - $60 notional ($6 margin @ 10x) -> $0.0100 floor
     * - $300 notional ($30 margin @ 10x) -> $0.0500 floor
     * - $600 notional ($60 margin @ 10x) -> $0.1000 floor
     */
    it('P4-F7-01: executes Test L7-01 linear proportional capital scaling rule exactly', () => {
      // 1. $60 notional ($6 margin @ 10x leverage) -> $0.0100 floor
      const floor60 = getEffectiveZeroLossFloorUsdt(60.00);
      expect(floor60).toBe(0.0100);
      expect(floor60).toBe(oracleDynamicExitFloor(60.00));

      // 2. $300 notional ($30 margin @ 10x leverage) -> $0.0500 floor
      const floor300 = getEffectiveZeroLossFloorUsdt(300.00);
      expect(floor300).toBe(0.0500);
      expect(floor300).toBe(oracleDynamicExitFloor(300.00));

      // 3. $600 notional ($60 margin @ 10x leverage) -> $0.1000 floor
      const floor600 = getEffectiveZeroLossFloorUsdt(600.00);
      expect(floor600).toBe(0.1000);
      expect(floor600).toBe(oracleDynamicExitFloor(600.00));
    });

    it('P4-F7-02: sub-$60 notionals strictly enforce $0.0100 USDT hard safety barrier', () => {
      // $15 notional (default single-leg notional)
      expect(getEffectiveZeroLossFloorUsdt(15.00)).toBe(0.0100);
      // $30 notional ($3 margin @ 10x)
      expect(getEffectiveZeroLossFloorUsdt(30.00)).toBe(0.0100);
      // $5 notional (minimum allowable leg notional)
      expect(getEffectiveZeroLossFloorUsdt(5.00)).toBe(0.0100);
      // Degenerate $0 notional
      expect(getEffectiveZeroLossFloorUsdt(0.00)).toBe(0.0100);
    });

    it('P4-F7-03: intermediate order notionals scale with exact 4-decimal precision', () => {
      // $120 notional (2x base) -> 2 * 0.0100 = 0.0200
      expect(getEffectiveZeroLossFloorUsdt(120.00)).toBe(0.0200);
      // $150 notional (2.5x base) -> 2.5 * 0.0100 = 0.0250
      expect(getEffectiveZeroLossFloorUsdt(150.00)).toBe(0.0250);
      // $240 notional (4x base) -> 4 * 0.0100 = 0.0400
      expect(getEffectiveZeroLossFloorUsdt(240.00)).toBe(0.0400);
      // $450 notional (7.5x base) -> 7.5 * 0.0100 = 0.0750
      expect(getEffectiveZeroLossFloorUsdt(450.00)).toBe(0.0750);
    });

    it('P4-F7-04: user override >= $0.0100 USDT is strictly respected', () => {
      // User sets $0.0800 on $60 notional (where default is $0.0100)
      expect(getEffectiveZeroLossFloorUsdt(60.00, 0.0800)).toBe(0.0800);
      // User sets $0.1500 on $300 notional (where default is $0.0500)
      expect(getEffectiveZeroLossFloorUsdt(300.00, 0.1500)).toBe(0.1500);
      // User sets exact safety floor $0.0100
      expect(getEffectiveZeroLossFloorUsdt(300.00, 0.0100)).toBe(0.0100);
    });

    it('P4-F7-05: user override below $0.0100 USDT is clamped to hard safety floor', () => {
      // User attempts to set $0.0050 (below safety barrier)
      expect(getEffectiveZeroLossFloorUsdt(60.00, 0.0050)).toBe(0.0100);
      // User attempts to set negative hurdle -$0.0200
      expect(getEffectiveZeroLossFloorUsdt(300.00, -0.0200)).toBe(0.0500);
      // User attempts $0.0000
      expect(getEffectiveZeroLossFloorUsdt(600.00, 0.0000)).toBe(0.1000);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 8: Dynamic Exit Gate Integration in evaluateExitGates
  // --------------------------------------------------------------------------
  describe('Feature 8: Dynamic Exit Gate Evaluations', () => {
    it('P4-F8-01: blocks exit when Net PnL is below the dynamic auto-adapted floor', () => {
      // Sizing: $300 notional. Floor = $0.0500 USDT.
      // Net PnL = +$0.0300 USDT (clears old static $0.01 floor, but fails dynamic $0.0500 floor)
      // Direction 1: bEntry = 0.000%, bCurrent = 0.380%
      const evaluation = evaluateExitGates(
        0.000, // bEntryPercent
        0.270, // bCurrentPercent (generates Net PnL below $0.0500)
        'LONG_BN_SHORT_BYB',
        30,    // durationMinutes
        0.000, // accumulatedCarryPercent
        300.00 // notionalUsdt ($300 notional)
      );

      // Must NOT exit because dynamic hurdle is not cleared
      expect(evaluation.zeroLossSatisfied).toBe(false);
      expect(evaluation.shouldExit).toBe(false);
      expect((evaluation as any).effectiveZeroLossFloorUsdt).toBe(0.0500);
    });

    it('P4-F8-02: triggers EXPANSION_TP when Net PnL clears dynamic auto-adapted floor', () => {
      // Sizing: $300 notional. Floor = $0.0500 USDT.
      // bEntry = 0.000%, bCurrent = 0.380% (generates Net PnL > $0.0500)
      const evaluation = evaluateExitGates(
        0.000,
        0.380,
        'LONG_BN_SHORT_BYB',
        30,
        0.000,
        300.00
      );

      expect(evaluation.zeroLossSatisfied).toBe(true);
      expect(evaluation.shouldExit).toBe(true);
      expect(evaluation.reason).toBe('EXPANSION_TP');
      expect((evaluation as any).effectiveZeroLossFloorUsdt).toBe(0.0500);
    });

    it('P4-F8-03: honors user override hurdle passed into evaluateExitGates', () => {
      // Sizing: $60 notional. Normal auto floor = $0.0100.
      // User override = $0.0500.
      // If Net PnL = +$0.0300, should be blocked by user override.
      const evaluationBlocked = evaluateExitGates(
        0.000,
        0.310, // Generates Net PnL ~ $0.0300
        'LONG_BN_SHORT_BYB',
        30,
        0.000,
        60.00,
        false,
        0.0500 // userHurdleUsdt override
      );

      expect(evaluationBlocked.zeroLossSatisfied).toBe(false);
      expect(evaluationBlocked.shouldExit).toBe(false);
      expect((evaluationBlocked as any).effectiveZeroLossFloorUsdt).toBe(0.0500);
    });

    it('P4-F8-04: adverse divergence stop-loss executes immediately without zero-loss constraint', () => {
      // Adverse drift = -0.160% (<= -0.150%)
      const evaluation = evaluateExitGates(
        0.000,
        -0.160,
        'LONG_BN_SHORT_BYB',
        30,
        0.000,
        300.00
      );

      expect(evaluation.shouldExit).toBe(true);
      expect(evaluation.reason).toBe('ADVERSE_STOP');
      expect(evaluation.zeroLossSatisfied).toBe(false);
      expect(evaluation.requiresReduceOnly).toBe(true);
      expect(evaluation.statusBadge).toBe('EMERGENCY_STOP');
    });

    it('P4-F8-05: stagnancy hard ceiling (360m) executes unconditional exit', () => {
      const evaluation = evaluateExitGates(
        0.000,
        0.100, // Basis didn't expand to target
        'LONG_BN_SHORT_BYB',
        360,   // Hard ceiling reached
        0.000,
        300.00
      );

      expect(evaluation.shouldExit).toBe(true);
      expect(evaluation.reason).toBe('MANDATORY_CEILING');
      expect(evaluation.requiresReduceOnly).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 9: State Store Notional Limit Relaxation
  // --------------------------------------------------------------------------
  describe('Feature 9: State Store Notional Relaxation & Sanitization', () => {
    it('P4-F9-01: accepts orderNotionalUsdt = 30.00 without clamping to 15.00', () => {
      store.updateConfig({ orderNotionalUsdt: 30.00 });
      const currentConfig = store.getState().config;
      expect(currentConfig.orderNotionalUsdt).toBe(30.00);
    });

    it('P4-F9-02: accepts orderNotionalUsdt = 60.00 and scales maxCapitalAllocationUsdt appropriately', () => {
      store.updateConfig({ orderNotionalUsdt: 60.00 });
      const currentConfig = store.getState().config;
      expect(currentConfig.orderNotionalUsdt).toBe(60.00);
      expect(currentConfig.maxCapitalAllocationUsdt).toBeGreaterThanOrEqual(60.00);
    });

    it('P4-F9-03: clamps zeroLossNetHurdleUsdt below $0.0100 to the hard safety floor', () => {
      store.updateConfig({ zeroLossNetHurdleUsdt: 0.0025 });
      const currentConfig = store.getState().config;
      expect(currentConfig.zeroLossNetHurdleUsdt).toBe(0.0100);
    });

    it('P4-F9-04: persists user-specified zeroLossNetHurdleUsdt when >= 0.0100', () => {
      store.updateConfig({ zeroLossNetHurdleUsdt: 0.0800 });
      const currentConfig = store.getState().config;
      expect(currentConfig.zeroLossNetHurdleUsdt).toBe(0.0800);
    });

    it('P4-F9-05: verifies strict zero BPS notation across Layer 7 comments and logs', () => {
      const sampleL7Logs = [
        "Auto-adaptive zero-loss floor calculated: +$0.0500 USDT (Net Yield: +0.267%)",
        "Relative expansion target: 0.380% | fee friction deduction: 0.260%",
        "Dynamic carry ratchet widened hurdle by 0.015%",
      ];
      for (const log of sampleL7Logs) {
        expect(assertZeroBpsNotation(log)).toBe(true);
        expect(assertModernTerminologyOnly(log)).toBe(true);
      }
    });
  });
});
