/**
 * Unit Test Suite: Hardened Adaptive Invariants Suite (STATARB-OU-PERP)
 * Target: web/lib/statarb/math/zScoreEngine.ts & web/lib/statarb/execution/
 * 
 * Verifies the 5 Hardened Mathematical Invariants:
 * - Guard 1: Symmetrically Directional Anti-Inversion Gate & Leg-Aware IOC Bound
 * - Guard 2: Dynamic Friction Floor (k = 1.6x - 1.8x) & 8-Second Maker Abort
 * - Guard 3: Strategy-Decoupled Pure StatArb Evaluator (24/7 continuous sweep)
 * - Guard 4: Dynamic Stagnancy Breaker (Triple-Conditional Invariant)
 * - Guard 5: Multi-Tiered Exit Invariant Hierarchy (Tier 1-4)
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateStrictDirectionality,
  computeLeg2IocBoundPrice,
  evaluateDynamicFrictionFloor,
  shouldAbortLeg1MakerOrder,
  evaluatePureStatArbEligibility,
} from '@/lib/statarb/math/zScoreEngine';
import {
  evaluateDynamicStagnancyBreaker,
} from '@/lib/statarb/execution/invariantGuard';
import {
  evaluateMultiTierExitGate,
} from '@/lib/statarb/execution/exitOptimizer';
import { createMockPosition } from './fixtures/exitGateFixtures';

describe('Hardened Adaptive Invariants Suite (STATARB-OU-PERP)', () => {
  // =========================================================================
  // GUARD 1: DIRECTIONALITY GATE & IOC BOUND INVARIANT
  // =========================================================================
  describe('Guard 1: Strict Directionality & Leg-Aware IOC Bound', () => {
    it('approves SHORT_BINANCE_LONG_BYBIT when Binance bid > Bybit ask by >= minGrossSpreadPct', () => {
      // Binance bid = 0.04020, Bybit ask = 0.04000 -> Spread = (0.04020 - 0.04000) / 0.04000 = +0.500%
      const res = evaluateStrictDirectionality(
        'SHORT_BINANCE_LONG_BYBIT',
        0.04020, // binanceBid
        0.04022, // binanceAsk
        0.03998, // bybitBid
        0.04000, // bybitAsk
        0.240
      );
      expect(res.passed).toBe(true);
      expect(res.grossSpreadPct).toBeCloseTo(0.500, 3);
      expect(res.reason).toBe('DIRECTIONALITY_AND_SPREAD_VERIFIED');
    });

    it('strictly BLOCKS inverted entry where short price <= long price (e.g. FLOCK incident scenario)', () => {
      // Binance bid = 0.03998, Bybit ask = 0.04010 -> Shorting cheaper venue
      const res = evaluateStrictDirectionality(
        'SHORT_BINANCE_LONG_BYBIT',
        0.03998,
        0.04000,
        0.04008,
        0.04010,
        0.240
      );
      expect(res.passed).toBe(false);
      expect(res.grossSpreadPct).toBeLessThan(0);
      expect(res.reason).toContain('DIRECTIONAL_INVERSION_BLOCKED');
    });

    it('approves reverse corridor SHORT_BYBIT_LONG_BINANCE when Bybit bid > Binance ask', () => {
      // Bybit bid = 1.0050, Binance ask = 1.0000 -> Spread = +0.500%
      const res = evaluateStrictDirectionality(
        'SHORT_BYBIT_LONG_BINANCE',
        0.9998,
        1.0000,
        1.0050,
        1.0052,
        0.240
      );
      expect(res.passed).toBe(true);
      expect(res.grossSpreadPct).toBeCloseTo(0.500, 3);
    });

    it('blocks when gross spread is positive but below friction floor (e.g. 0.150% < 0.240%)', () => {
      // Binance bid = 1.0015, Bybit ask = 1.0000 -> Spread = 0.150% < 0.240%
      const res = evaluateStrictDirectionality(
        'SHORT_BINANCE_LONG_BYBIT',
        1.0015,
        1.0018,
        0.9998,
        1.0000,
        0.240
      );
      expect(res.passed).toBe(false);
      expect(res.reason).toContain('INSUFFICIENT_SPREAD_EDGE');
    });

    it('computes leg-aware IOC bound price protecting taker execution against adverse slip', () => {
      // Leg 1 was SELL @ $100.00. Leg 2 must BUY at maximum: 100 / (1 + 0.0024) ~= 99.76057
      const maxBuyPrice = computeLeg2IocBoundPrice('SELL', 100.0, 0.240);
      expect(maxBuyPrice).toBeLessThan(100.0);
      expect(maxBuyPrice).toBeCloseTo(99.7605746, 4);

      // Leg 1 was BUY @ $100.00. Leg 2 must SELL at minimum: 100 * (1 + 0.0024) = 100.24
      const minSellPrice = computeLeg2IocBoundPrice('BUY', 100.0, 0.240);
      expect(minSellPrice).toBeGreaterThan(100.0);
      expect(minSellPrice).toBe(100.24);
    });
  });

  // =========================================================================
  // GUARD 2: DYNAMIC FRICTION FLOOR & PASSIVE MAKER TIMEOUT
  // =========================================================================
  describe('Guard 2: Dynamic Friction Floor & Passive Maker Watchdog', () => {
    it('approves spread >= 1.6x nominal fee schedule (0.240% hurdle for standard pairs)', () => {
      const res = evaluateDynamicFrictionFloor(0.280, 0.020, 0.055, false, 1.6);
      expect(res.canDispatch).toBe(true);
      expect(res.requiredHurdlePct).toBeCloseTo(0.240, 3);
      expect(res.netEdgePct).toBeCloseTo(0.130, 3);
    });

    it('blocks spread below 1.6x fee hurdle (e.g. 0.210% < 0.240%)', () => {
      const res = evaluateDynamicFrictionFloor(0.210, 0.020, 0.055, false, 1.6);
      expect(res.canDispatch).toBe(false);
      expect(res.reason).toContain('GROSS_SPREAD_BELOW_FRICTION_FLOOR');
    });

    it('adapts fee floor for altcoin tier with wider taker fees', () => {
      // Altcoin tier: taker fee 0.065% -> roundtrip fee = 2 * (0.020 + 0.065) = 0.170% -> Hurdle = 1.6 * 0.170% = 0.272%
      const res = evaluateDynamicFrictionFloor(0.260, 0.020, 0.055, true, 1.6);
      expect(res.canDispatch).toBe(false);
      expect(res.requiredHurdlePct).toBeCloseTo(0.272, 3);
    });

    it('enforces 8,000ms passive maker watchdog timeout', () => {
      expect(shouldAbortLeg1MakerOrder(7999)).toBe(false);
      expect(shouldAbortLeg1MakerOrder(8000)).toBe(true);
      expect(shouldAbortLeg1MakerOrder(10500)).toBe(true);
    });
  });

  // =========================================================================
  // GUARD 3: STRATEGY DECOUPLING & PURE STATARB ELIGIBILITY
  // =========================================================================
  describe('Guard 3: Strategy Decoupling (24/7 Pure Price Convergence)', () => {
    it('approves entry on pure price dislocation (|z| >= 2.20, depth >= 4.0x, spread >= 0.240%)', () => {
      const res = evaluatePureStatArbEligibility(2.45, 5.2, 0.310);
      expect(res.eligible).toBe(true);
      expect(res.reason).toBe('PURE_STATARB_CRITERIA_VERIFIED');
    });

    it('rejects when z-score is insufficient (|z| < 2.20)', () => {
      const res = evaluatePureStatArbEligibility(1.85, 5.2, 0.310);
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('INSUFFICIENT_ZSCORE');
    });

    it('rejects when depth cushion is insufficient (< 4.0x)', () => {
      const res = evaluatePureStatArbEligibility(2.50, 3.2, 0.310);
      expect(res.eligible).toBe(false);
      expect(res.reason).toContain('INSUFFICIENT_DEPTH');
    });
  });

  // =========================================================================
  // GUARD 4: TRIPLE-CONDITIONAL DYNAMIC STAGNANCY BREAKER
  // =========================================================================
  describe('Guard 4: Dynamic Stagnancy Breaker (Triple-Conditional Invariant)', () => {
    it('safeguards profitable trades from premature timer exit (e.g. 1000CATUSDT held 176.75m for +$0.1743)', () => {
      // 1000CATUSDT case: held 176.75m (near 180m), profitable (+0.1743 USDT), compressed 93.4%
      const res = evaluateDynamicStagnancyBreaker(176.75, 0.1743, 93.4, 180, 30.0);
      expect(res.triggered).toBe(false);
      expect(res.reason).toContain('PASS');
    });

    it('safeguards trades at or above 180m duration if they are in profit or parity', () => {
      // Held 195m, but Net PnL is +$0.0250 USDT
      const res = evaluateDynamicStagnancyBreaker(195.0, 0.0250, 50.0, 180, 30.0);
      expect(res.triggered).toBe(false);
      expect(res.reason).toContain('PROTECTED: Position is profitable or at parity');
    });

    it('safeguards trades at or above 180m duration if basis is actively compressing (>= 30%)', () => {
      // Held 200m, Net PnL is -$0.002 USDT, but compression is 45.0% (actively converging)
      const res = evaluateDynamicStagnancyBreaker(200.0, -0.002, 45.0, 180, 30.0);
      expect(res.triggered).toBe(false);
      expect(res.reason).toContain('PROTECTED: Position is actively compressing');
    });

    it('triggers breaker ONLY when ALL THREE conditions are met (duration >= 180m AND losing AND compression < 30%)', () => {
      // Stagnant dead trade: held 238m (like FLOCK), losing (-$0.0489), and compression only 15.6% (< 30%)
      const res = evaluateDynamicStagnancyBreaker(238.0, -0.0489, 15.6, 180, 30.0);
      expect(res.triggered).toBe(true);
      expect(res.reason).toContain('Dynamic Stagnancy Breaker TRIGGERED');
    });
  });

  // =========================================================================
  // GUARD 5: MULTI-TIERED EXIT INVARIANT HIERARCHY
  // =========================================================================
  describe('Guard 5: Multi-Tiered Exit Invariant Hierarchy', () => {
    it('Tier 1: approves high-conviction profit exit when Net PnL >= +$0.0100 USDT', () => {
      const pos = createMockPosition({
        entryBasisBps: 32.0,
        notionalUsdt: 100.0,
        netPnlUsdt: 0.050,
      });

      const res = evaluateMultiTierExitGate(pos, 6.0, 0.25);
      expect(res.canExit).toBe(true);
      expect(res.tier).toBe(1);
      expect(res.exitType).toBe('PROFITABLE_CONVERGENCE_EXIT');
      expect(res.netPnLUsdt).toBeGreaterThanOrEqual(0.0100);
    });

    it('Tier 2: triggers Parity Scratch Exit when normalized (|z| <= 0.15) with zero loss (>= +$0.0000 USDT)', () => {
      // TUSDT scenario: Reconciled cleanly at +$0.0000 USDT in 5.2m (held 18m), z = 0.08
      const pos = createMockPosition({
        entryBasisBps: 20.0,
        notionalUsdt: 15.0,
        netPnlUsdt: 0.0000,
        holdDurationMinutes: 18.0,
      });

      // Price exactly converged, gross basis = roundtrip fee so net PnL = +$0.0000 (below $0.0100 tier 1 profit, but >= $0.0000 parity scratch)
      const res = evaluateMultiTierExitGate(pos, 5.0, 0.08, {
        holdMinutes: 18.0,
        fundingEarnedUsdt: 0.0000,
      });
      expect(res.canExit).toBe(true);
      expect(res.tier).toBe(2);
      expect(res.exitType).toBe('PARITY_SCRATCH_EXIT');
      expect(res.reason).toContain('Tier 2 Parity Scratch Exit');
    });

    it('Tier 3: triggers Dynamic Stagnancy Breaker on duration >= 180m, losing, compression < 30%', () => {
      const pos = createMockPosition({
        entryBasisBps: 30.0,
        notionalUsdt: 15.0,
        holdDurationMinutes: 200.0,
      });

      // Current basis 25.0 bps (only 16.7% compression), net PnL < 0
      const res = evaluateMultiTierExitGate(pos, 25.0, 1.8, {
        holdMinutes: 200.0,
      });
      expect(res.canExit).toBe(true);
      expect(res.tier).toBe(3);
      expect(res.exitType).toBe('STAGNANCY_DECOUPLING_UNWIND');
    });

    it('Tier 4: triggers Catastrophic Stop Loss when ROI <= -20%', () => {
      const pos = createMockPosition({
        entryBasisBps: 30.0,
      });

      const res = evaluateMultiTierExitGate(pos, 45.0, 2.8, {
        currentRoiPct: -22.0,
      });
      expect(res.canExit).toBe(true);
      expect(res.tier).toBe(4);
      expect(res.exitType).toBe('CATASTROPHIC_STOP');
    });
  });
});
