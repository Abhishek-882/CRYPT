/**
 * Unit Test Suite: Real-Time Z-Score Engine & Multi-Condition Entry Gating
 * Target: web/lib/statarb/math/zScoreEngine.ts
 * 
 * Verifies:
 * - Tier 1: Real-time z-score calculation, basis computation, trade signal formatting
 * - Tier 2: Strict boundary/borderline thresholds:
 *     - |z_t|: 2.19 (FAIL) vs 2.20 (PASS)
 *     - |b_t|: 27.9 bps (FAIL) vs 28.0 bps (PASS)
 *     - Depth cushion: 3.99x (FAIL) vs 4.00x (PASS)
 *     - Binance spread: 8.01 bps (FAIL) vs 8.00 bps (PASS)
 *     - Bybit spread: 8.01 bps (FAIL) vs 8.00 bps (PASS)
 *     - Zero variance & division-by-zero resilience
 * - Tier 3: Complete 2^4 = 16 combinatorial gate permutations & directional polarity assignments
 */

import { describe, it, expect } from 'vitest';
import {
  calculateZScore,
  calculateBasisBps,
  evaluateEntryGates,
  generateTradeSignal,
  DEFAULT_ENTRY_GATE_CONFIG,
} from '@/lib/statarb/math/zScoreEngine';
import {
  createMockPair,
  createMockOUParams,
  CORE_GATE_SCENARIOS,
  BOUNDARY_TEST_CASES,
  generateFullCombinatorialMatrix,
} from './fixtures/entryGateMatrix';

describe('Z-Score Engine & Entry Gating (zScoreEngine.ts)', () => {
  // =========================================================================
  // TIER 1: MATHEMATICAL Z-SCORE & BASIS COMPUTATION
  // =========================================================================
  describe('Tier 1: Z-Score & Basis Calculation', () => {
    it('accurately computes standardized z-score: z = (b_t - mu) / equilibriumSigma', () => {
      const params = createMockOUParams({
        mu: 2.0,
        equilibriumSigma: 10.0,
      });

      // At equilibrium mean: z = 0
      expect(calculateZScore(2.0, params)).toBeCloseTo(0.0, 4);

      // +2.5 standard deviations above mean: (27.0 - 2.0) / 10.0 = +2.50
      expect(calculateZScore(27.0, params)).toBeCloseTo(2.5, 4);

      // -2.2 standard deviations below mean: (-20.0 - 2.0) / 10.0 = -2.20
      expect(calculateZScore(-20.0, params)).toBeCloseTo(-2.2, 4);
    });

    it('returns 0.0 when equilibriumSigma is zero or negative (division-by-zero guard)', () => {
      const zeroSigmaParams = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 0.0,
      });

      expect(calculateZScore(30.0, zeroSigmaParams)).toBe(0.0);

      const tinySigmaParams = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 1e-8,
      });
      expect(calculateZScore(30.0, tinySigmaParams)).toBe(0.0);
    });

    it('returns 0.0 when inputs contain non-finite numbers', () => {
      const validParams = createMockOUParams();

      expect(calculateZScore(NaN, validParams)).toBe(0.0);
      expect(calculateZScore(Infinity, validParams)).toBe(0.0);
      expect(calculateZScore(-Infinity, validParams)).toBe(0.0);
      expect(calculateZScore(20.0, null as any)).toBe(0.0);
    });

    it('accurately computes gross basis in basis points (bps)', () => {
      // 1% spread = 100 bps: Binance = 101, Bybit = 100
      expect(calculateBasisBps(101, 100)).toBeCloseTo(100.0, 4);

      // Negative spread: Binance = 99, Bybit = 100 -> -100 bps
      expect(calculateBasisBps(99, 100)).toBeCloseTo(-100.0, 4);

      // Realistic BTC prices: Binance = 65200, Bybit = 65000 -> ((65200-65000)/65000)*10000 ~= 30.769 bps
      const btcBasis = ((65200 - 65000) / 65000) * 10000;
      expect(calculateBasisBps(65200, 65000)).toBeCloseTo(btcBasis, 4);
    });

    it('handles degenerate or non-positive Bybit prices in basis calculation', () => {
      expect(calculateBasisBps(100, 0)).toBe(0.0);
      expect(calculateBasisBps(100, -50)).toBe(0.0);
      expect(calculateBasisBps(NaN, 100)).toBe(0.0);
      expect(calculateBasisBps(100, NaN)).toBe(0.0);
    });
  });

  // =========================================================================
  // TIER 1: DIRECTIONAL ASSIGNMENT
  // =========================================================================
  describe('Tier 1: Directional Signal Assignments', () => {
    it('assigns SHORT_BINANCE_LONG_BYBIT when Binance is rich (positive basis & z-score)', () => {
      const pair = createMockPair({
        grossBasisBps: 32.5,
        orderBookDepthRatio: 4.8,
        binanceSpreadBps: 3.2,
        bybitSpreadBps: 3.8,
      });
      const params = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 12.0, // z = 32.5 / 12 = +2.71 >= 2.20
      });

      const result = evaluateEntryGates(pair, params);

      expect(result.passed).toBe(true);
      expect(result.direction).toBe('SHORT_BINANCE_LONG_BYBIT');
      expect(result.zScore).toBeGreaterThanOrEqual(2.20);
      expect(result.grossBasisBps).toBeGreaterThanOrEqual(28.0);
    });

    it('assigns SHORT_BYBIT_LONG_BINANCE when Bybit is rich (negative basis & z-score)', () => {
      const pair = createMockPair({
        grossBasisBps: -32.5,
        orderBookDepthRatio: 4.8,
        binanceSpreadBps: 3.2,
        bybitSpreadBps: 3.8,
      });
      const params = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 12.0, // z = -32.5 / 12 = -2.71 <= -2.20
      });

      const result = evaluateEntryGates(pair, params);

      expect(result.passed).toBe(true);
      expect(result.direction).toBe('SHORT_BYBIT_LONG_BINANCE');
      expect(result.zScore).toBeLessThanOrEqual(-2.20);
      expect(result.grossBasisBps).toBeLessThanOrEqual(-28.0);
    });

    it('rejects trade when basis is positive but z-score is negative (polarity conflict)', () => {
      const pair = createMockPair({
        grossBasisBps: 30.0, // Positive basis
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 3.0,
        bybitSpreadBps: 3.0,
      });
      const params = createMockOUParams({
        mu: 60.0, // High mean shift
        equilibriumSigma: 10.0, // z = (30 - 60) / 10 = -3.00 (negative z-score)
      });

      const result = evaluateEntryGates(pair, params);

      // Polarity mismatch prevents conclusive directional routing
      expect(result.passed).toBe(false);
      expect(result.direction).toBeUndefined();
    });
  });

  // =========================================================================
  // TIER 2: STRICT BOUNDARY & CORNER CASES (BORDERLINE VALUES)
  // =========================================================================
  describe('Tier 2: Boundary Threshold Testing (Fail vs Pass Pairs)', () => {
    describe('Gate 1 Boundary: |z_t| = 2.19 vs 2.20', () => {
      it('rejects at |z_t| = 2.19 and permits at |z_t| = 2.20', () => {
        const { failValue, passValue, basisBps, failEqSigma, passEqSigma } =
          BOUNDARY_TEST_CASES.zScore;

        const basePair = createMockPair({
          grossBasisBps: basisBps, // 35.0 bps (passes basis hurdle)
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: 4.0,
        });

        // Test fail boundary: z = 2.19
        const failParams = createMockOUParams({ mu: 0, equilibriumSigma: failEqSigma });
        const failResult = evaluateEntryGates(basePair, failParams);
        expect(failResult.zScore).toBeCloseTo(failValue, 2);
        expect(failResult.passed).toBe(false);
        expect(failResult.reasons.some((r) => r.includes('Gate 1') && r.includes('[FAIL]'))).toBe(true);

        // Test pass boundary: z = 2.20
        const passParams = createMockOUParams({ mu: 0, equilibriumSigma: passEqSigma });
        const passResult = evaluateEntryGates(basePair, passParams);
        expect(passResult.zScore).toBeCloseTo(passValue, 2);
        expect(passResult.passed).toBe(true);
        expect(passResult.reasons.some((r) => r.includes('Gate 1') && r.includes('[PASS]'))).toBe(true);
      });

      it('rejects at z_t = -2.19 and permits at z_t = -2.20 (negative boundary)', () => {
        const basisBps = -35.0;
        const basePair = createMockPair({
          grossBasisBps: basisBps,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: 4.0,
        });

        // z = -35.0 / 15.9817 ~= -2.19
        const failParams = createMockOUParams({ mu: 0, equilibriumSigma: 35.0 / 2.19 });
        const failResult = evaluateEntryGates(basePair, failParams);
        expect(failResult.passed).toBe(false);

        // z = -35.0 / 15.909 ~= -2.20
        const passParams = createMockOUParams({ mu: 0, equilibriumSigma: 35.0 / 2.20 });
        const passResult = evaluateEntryGates(basePair, passParams);
        expect(passResult.passed).toBe(true);
        expect(passResult.direction).toBe('SHORT_BYBIT_LONG_BINANCE');
      });
    });

    describe('Gate 2 Boundary: |b_t| = 27.9 bps vs 28.0 bps', () => {
      it('rejects at basis = 27.9 bps and permits at basis = 28.0 bps', () => {
        const { failBps, passBps, eqSigma } = BOUNDARY_TEST_CASES.grossBasis;
        const params = createMockOUParams({ mu: 0, equilibriumSigma: eqSigma });

        // Fail boundary: 27.9 bps (z = 2.79 >= 2.20, but basis fails)
        const failPair = createMockPair({
          grossBasisBps: failBps,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: 4.0,
        });
        const failResult = evaluateEntryGates(failPair, params);
        expect(failResult.passed).toBe(false);
        expect(failResult.reasons.some((r) => r.includes('Gate 2') && r.includes('[FAIL]'))).toBe(true);

        // Pass boundary: 28.0 bps (z = 2.80 >= 2.20, basis passes)
        const passPair = createMockPair({
          grossBasisBps: passBps,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: 4.0,
        });
        const passResult = evaluateEntryGates(passPair, params);
        expect(passResult.passed).toBe(true);
        expect(passResult.reasons.some((r) => r.includes('Gate 2') && r.includes('[PASS]'))).toBe(true);
      });
    });

    describe('Gate 3 Boundary: Depth Ratio = 3.99x vs 4.00x', () => {
      it('rejects at depth = 3.99x and permits at depth = 4.00x', () => {
        const { failRatio, passRatio } = BOUNDARY_TEST_CASES.depthRatio;
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 10.0 });

        // Fail boundary: 3.99x
        const failPair = createMockPair({
          grossBasisBps: 30.0,
          orderBookDepthRatio: failRatio,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: 4.0,
        });
        const failResult = evaluateEntryGates(failPair, params);
        expect(failResult.passed).toBe(false);
        expect(failResult.reasons.some((r) => r.includes('Gate 3') && r.includes('[FAIL]'))).toBe(true);

        // Pass boundary: 4.00x
        const passPair = createMockPair({
          grossBasisBps: 30.0,
          orderBookDepthRatio: passRatio,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: 4.0,
        });
        const passResult = evaluateEntryGates(passPair, params);
        expect(passResult.passed).toBe(true);
        expect(passResult.reasons.some((r) => r.includes('Gate 3') && r.includes('[PASS]'))).toBe(true);
      });
    });

    describe('Gate 4 Boundary: Bid-Ask Spread = 8.01 bps vs 8.00 bps', () => {
      it('rejects when Binance spread = 8.01 bps and permits at 8.00 bps', () => {
        const { failSpreadBps, passSpreadBps } = BOUNDARY_TEST_CASES.binanceSpread;
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 10.0 });

        // Fail boundary: Binance spread 8.01 bps
        const failPair = createMockPair({
          grossBasisBps: 30.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: failSpreadBps,
          bybitSpreadBps: 4.0,
        });
        const failResult = evaluateEntryGates(failPair, params);
        expect(failResult.passed).toBe(false);
        expect(failResult.reasons.some((r) => r.includes('Gate 4') && r.includes('[FAIL]'))).toBe(true);

        // Pass boundary: Binance spread 8.00 bps
        const passPair = createMockPair({
          grossBasisBps: 30.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: passSpreadBps,
          bybitSpreadBps: 4.0,
        });
        const passResult = evaluateEntryGates(passPair, params);
        expect(passResult.passed).toBe(true);
        expect(passResult.reasons.some((r) => r.includes('Gate 4') && r.includes('[PASS]'))).toBe(true);
      });

      it('rejects when Bybit spread = 8.01 bps and permits at 8.00 bps', () => {
        const { failSpreadBps, passSpreadBps } = BOUNDARY_TEST_CASES.bybitSpread;
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 10.0 });

        // Fail boundary: Bybit spread 8.01 bps
        const failPair = createMockPair({
          grossBasisBps: 30.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: failSpreadBps,
        });
        const failResult = evaluateEntryGates(failPair, params);
        expect(failResult.passed).toBe(false);
        expect(failResult.reasons.some((r) => r.includes('Gate 4') && r.includes('[FAIL]'))).toBe(true);

        // Pass boundary: Bybit spread 8.00 bps
        const passPair = createMockPair({
          grossBasisBps: 30.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 4.0,
          bybitSpreadBps: passSpreadBps,
        });
        const passResult = evaluateEntryGates(passPair, params);
        expect(passResult.passed).toBe(true);
      });

      it('permits when both venues are exactly at spread cap 8.00 bps', () => {
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 10.0 });
        const pair = createMockPair({
          grossBasisBps: 30.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 8.00,
          bybitSpreadBps: 8.00,
        });

        const result = evaluateEntryGates(pair, params);
        expect(result.passed).toBe(true);
      });
    });

    // -------------------------------------------------------------------------
    // Gate 5: Pre-Flight Net-Edge Hurdle (>= 8.0 bps = 0.080%)
    // -------------------------------------------------------------------------
    describe('Gate 5: Pre-Flight Net-Edge Hurdle (minNetEdge >= 0.080% / 8.0 bps)', () => {
      it('strictly enforces Gate 5 pre-flight net-edge hurdle of >= 8.0 bps (0.080%)', () => {
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 10.0 });

        // Gross basis 28.0 bps with default friction 17.0 bps -> Net edge = 11.0 bps >= 8.0 bps -> PASS
        const passPair = createMockPair({
          grossBasisBps: 28.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 3.0,
          bybitSpreadBps: 3.0,
        });
        const passResult = evaluateEntryGates(passPair, params);
        expect(passResult.passed).toBe(true);
        expect(passResult.netExpectedEdgeBps).toBe(11.0);
        expect(passResult.reasons.some((r) => r.includes('Gate 5 (Net-Edge)') && r.includes('[PASS]'))).toBe(true);
      });

      it('rejects candidate when net expected edge is below 8.0 bps boundary', () => {
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 8.0 });

        // Gross basis 28.0 bps passes Gate 2, but with custom friction of 21.0 bps:
        // Net edge = 28.0 - 21.0 = 7.0 bps < 8.0 bps hurdle -> FAIL
        const pair = createMockPair({
          grossBasisBps: 28.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 3.0,
          bybitSpreadBps: 3.0,
        });
        const result = evaluateEntryGates(pair, params, {
          ...DEFAULT_ENTRY_GATE_CONFIG,
          roundtripFrictionBps: 21.0,
          minNetEdgeBps: 8.0,
        });

        expect(result.passed).toBe(false);
        expect(result.netExpectedEdgeBps).toBe(7.0);
        expect(result.reasons.some((r) => r.includes('Gate 5 (Net-Edge)') && r.includes('[FAIL]'))).toBe(true);
      });

      it('strictly verifies Gate 5 boundary at exactly 8.00 bps vs 7.99 bps', () => {
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 8.0 });

        // 7.99 bps net edge: Gross 24.99 bps - Friction 17.0 bps = 7.99 bps < 8.0 bps
        const failPair = createMockPair({
          grossBasisBps: 24.99,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 3.0,
          bybitSpreadBps: 3.0,
        });
        const failResult = evaluateEntryGates(failPair, params, {
          ...DEFAULT_ENTRY_GATE_CONFIG,
          minGrossBasisBps: 20.0, // lower gate 2 to isolate Gate 5
          minNetEdgeBps: 8.0,
        });
        expect(failResult.passed).toBe(false);
        expect(failResult.netExpectedEdgeBps).toBe(7.99);
        expect(failResult.reasons.some((r) => r.includes('Gate 5') && r.includes('[FAIL]'))).toBe(true);

        // 8.00 bps net edge: Gross 25.00 bps - Friction 17.0 bps = 8.00 bps >= 8.0 bps
        const passPair = createMockPair({
          grossBasisBps: 25.00,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 3.0,
          bybitSpreadBps: 3.0,
        });
        const passResult = evaluateEntryGates(passPair, params, {
          ...DEFAULT_ENTRY_GATE_CONFIG,
          minGrossBasisBps: 20.0,
          minNetEdgeBps: 8.0,
        });
        expect(passResult.passed).toBe(true);
        expect(passResult.netExpectedEdgeBps).toBe(8.00);
        expect(passResult.reasons.some((r) => r.includes('Gate 5') && r.includes('[PASS]'))).toBe(true);
      });

      it('enforces Gate 5 with default 8.0 bps even if caller config omits minNetEdgeBps', () => {
        const params = createMockOUParams({ mu: 0, equilibriumSigma: 8.0 });

        // Config with minNetEdgeBps explicitly undefined
        const sparseConfig = {
          minZScore: 2.2,
          minGrossBasisBps: 20.0,
          minDepthRatio: 4.0,
          maxSpreadBps: 8.0,
          roundtripFrictionBps: 17.0,
          minNetEdgeBps: undefined,
        };

        // Gross 24.0 bps - 17.0 bps friction = 7.0 bps < default 8.0 bps hurdle -> MUST FAIL
        const pair = createMockPair({
          grossBasisBps: 24.0,
          orderBookDepthRatio: 5.0,
          binanceSpreadBps: 3.0,
          bybitSpreadBps: 3.0,
        });
        const result = evaluateEntryGates(pair, params, sparseConfig);
        expect(result.passed).toBe(false);
        expect(result.reasons.some((r) => r.includes('Gate 5') && r.includes('[FAIL]'))).toBe(true);
      });
    });
  });

  // =========================================================================
  // TIER 3: COMBINATORIAL PERMUTATION MATRIX
  // =========================================================================
  describe('Tier 3: Combinatorial Permutation Grid', () => {
    it('verifies standard core failure scenarios match expected pass/fail status', () => {
      for (const scenario of CORE_GATE_SCENARIOS) {
        const result = evaluateEntryGates(scenario.pair, scenario.params);

        expect(result.passed).toBe(scenario.expectedPassed);
        if (scenario.expectedDirection) {
          expect(result.direction).toBe(scenario.expectedDirection);
        }
      }
    });

    it('verifies all 16 combinatorial gate permutations (only all-passing passes)', () => {
      const cases = generateFullCombinatorialMatrix();
      expect(cases.length).toBe(16);

      let passedCount = 0;
      for (const c of cases) {
        const result = evaluateEntryGates(c.pair, c.params);
        expect(result.passed).toBe(c.expectedPassed);

        if (c.expectedPassed) {
          passedCount++;
          expect(result.direction).toBe('SHORT_BINANCE_LONG_BYBIT');
        }
      }

      // Exactly 1 out of 16 combinations (mask 1111) should pass
      expect(passedCount).toBe(1);
    });

    it('honors custom EntryGateConfig threshold overrides', () => {
      const pair = createMockPair({
        grossBasisBps: 35.0,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 6.0,
        bybitSpreadBps: 6.0,
      });
      const params = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 14.0, // z = 35.0 / 14.0 = +2.50
      });

      // Under default config (z >= 2.2, basis >= 28, depth >= 4, spread <= 8) -> PASS
      const defaultResult = evaluateEntryGates(pair, params);
      expect(defaultResult.passed).toBe(true);

      // Under stricter custom config (z >= 3.0) -> FAIL
      const strictZResult = evaluateEntryGates(pair, params, {
        ...DEFAULT_ENTRY_GATE_CONFIG,
        minZScore: 3.0,
      });
      expect(strictZResult.passed).toBe(false);

      // Under stricter depth config (depth >= 6.0x) -> FAIL
      const strictDepthResult = evaluateEntryGates(pair, params, {
        ...DEFAULT_ENTRY_GATE_CONFIG,
        minDepthRatio: 6.0,
      });
      expect(strictDepthResult.passed).toBe(false);

      // Under stricter spread cap (spread <= 5.0 bps) -> FAIL
      const strictSpreadResult = evaluateEntryGates(pair, params, {
        ...DEFAULT_ENTRY_GATE_CONFIG,
        maxSpreadBps: 5.0,
      });
      expect(strictSpreadResult.passed).toBe(false);
    });
  });

  // =========================================================================
  // TIER 1: TRADE SIGNAL GENERATION
  // =========================================================================
  describe('Tier 1: Trade Signal Generation (generateTradeSignal)', () => {
    it('generates fully populated TradeSignal object when all gates pass', () => {
      const pair = createMockPair({
        canonicalSymbol: 'ETH',
        grossBasisBps: 32.0,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 3.5,
        bybitSpreadBps: 3.5,
      });
      const params = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 12.0,
      });

      const signal = generateTradeSignal(pair, params);

      expect(signal).not.toBeNull();
      if (signal) {
        expect(signal.id).toMatch(/^SIG-ETH-\d+-\d+$/);
        expect(signal.pair).toBe(pair);
        expect(signal.direction).toBe('SHORT_BINANCE_LONG_BYBIT');
        expect(signal.passedGates).toBe(true);
        expect(signal.zScore).toBeCloseTo(32.0 / 12.0, 4);
        expect(signal.grossBasisBps).toBe(32.0);
        expect(signal.reasons.length).toBeGreaterThan(0);
      }
    });

    it('returns null when any entry gate fails', () => {
      const failingPair = createMockPair({
        grossBasisBps: 20.0, // Fails 28 bps hurdle
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 3.5,
        bybitSpreadBps: 3.5,
      });
      const params = createMockOUParams();

      const signal = generateTradeSignal(failingPair, params);
      expect(signal).toBeNull();
    });

    it('blocks entry when Gate 6 Adverse Funding Rate Guard trips within 45m', () => {
      const adversePair = createMockPair({
        canonicalSymbol: 'ETH',
        grossBasisBps: 35.0, // Short Binance, Long Bybit
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 3.5,
        bybitSpreadBps: 3.5,
        nextFundingTime: Date.now() + 20 * 60 * 1000, // in 20 minutes
        bybitFundingRate: 0.0005, // +0.05% (5 bps) -> Long Bybit pays 5 bps
        binanceFundingRate: 0.0,
      });
      const params = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 12.0,
      });

      const gateRes = evaluateEntryGates(adversePair, params);
      expect(gateRes.passed).toBe(false);
      expect(gateRes.reasons.some((r) => r.includes('Gate 6 (Funding Rate Guard)'))).toBe(true);

      const signal = generateTradeSignal(adversePair, params);
      expect(signal).toBeNull();
    });

    it('approves entry when upcoming funding is favorable or within 3 bps tolerance', () => {
      const favorablePair = createMockPair({
        canonicalSymbol: 'ETH',
        grossBasisBps: 35.0, // Short Binance, Long Bybit
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 3.5,
        bybitSpreadBps: 3.5,
        nextFundingTime: Date.now() + 20 * 60 * 1000, // in 20 minutes
        bybitFundingRate: -0.0002, // Negative funding on Bybit -> Long Bybit RECEIVES 2 bps!
        binanceFundingRate: 0.0001, // Positive on Binance -> Short Binance RECEIVES 1 bps!
      });
      const params = createMockOUParams({
        mu: 0.0,
        equilibriumSigma: 12.0,
      });

      const gateRes = evaluateEntryGates(favorablePair, params);
      expect(gateRes.passed).toBe(true);
      expect(gateRes.reasons.some((r) => r.includes('Gate 6 (Funding Rate Guard)') && r.includes('[PASS]'))).toBe(true);
    });
  });
});
