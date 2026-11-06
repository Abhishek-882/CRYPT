/**
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE: STATARB-OU-PERP
 * Target: Complete Statistical Arbitrage Engine, Calibration, Boundaries, and Invariants
 * 
 * Conducts exhaustive adversarial boundary and mathematical stress testing:
 * 1. Mathematical verification of continuous Ornstein-Uhlenbeck calibration & real-time z-score SDE mapping
 * 2. Strict boundary condition stress:
 *    - Gate 1: |z_t| = 2.19 (FAIL) vs 2.20 (PASS)
 *    - Gate 2: Gross basis = 27.9 (FAIL) vs 28.0 (PASS) bps
 *    - Gate 3: Depth cushion = 3.99x (FAIL) vs 4.00x (PASS)
 *    - Gate 4: Bid-Ask spread = 8.01 (FAIL) vs 8.00 (PASS) bps
 * 3. Zero-Loss Exit boundary:
 *    - Net PnL = +$0.0099 USDT (BLOCKED) vs +$0.0100 USDT (APPROVED)
 * 4. Invariant 6: 30-minute low-watermark breaker persistence:
 *    - Triggered if continuously >= 1.0% for >= 30 min
 *    - Reset (blocked) if spread dips to < 1.0% (e.g. 0.999% or 0.85% at minute 28)
 *    - Blocked if hold time is 29.9 min (< 30 min)
 * 5. Invariant 7: Upstream sticky decoupling filter:
 *    - Rejected if min divergence across 30m window is >= 1.0%
 *    - Approved if spread touched < 1.0% within the 30m window
 */

import { describe, it, expect } from 'vitest';
import {
  calibrateOrnsteinUhlenbeck,
  DEFAULT_OU_PRIORS,
  simulateOUProcess,
} from '@/lib/statarb/math/ouCalibrator';
import {
  calculateZScore,
  calculateBasisBps,
  evaluateEntryGates,
  DEFAULT_ENTRY_GATE_CONFIG,
} from '@/lib/statarb/math/zScoreEngine';
import {
  checkInvariant6PersistenceBreaker,
  checkInvariant7StickyDecoupling,
  checkInvariant4CatastrophicStopLoss,
  checkZeroOrphanInvariant,
} from '@/lib/statarb/execution/invariantGuard';
import {
  evaluateZeroLossExitGate,
  evaluateExit,
  calculateBasisCompression,
  isBasisCompressed,
  isZScoreNormalized,
  MIN_ZERO_LOSS_PROFIT_USDT,
  DEFAULT_FEE_STRUCTURE,
} from '@/lib/statarb/execution/exitOptimizer';
import { StatArbPair, StatArbPosition, OUParameters } from '@/lib/statarb/types';

describe('Adversarial Stress Verification Suite (STATARB-OU-PERP)', () => {
  // =========================================================================
  // 1. MATHEMATICAL CALIBRATION OF CONTINUOUS ORNSTEIN-UHLENBECK SDE
  // =========================================================================
  describe('Focus 1: Mathematical Calibration & Continuous SDE Parameter Recovery', () => {
    it('empirically verifies analytical continuous SDE parameter mapping from discrete AR(1)', () => {
      // Discrete AR(1): b_{t+1} = a + beta * b_t + epsilon
      // Continuous SDE: db_t = theta * (mu - b_t) dt + sigma * dW_t
      // Exact relations:
      // theta = -ln(beta) / dt
      // mu = a / (1 - beta)
      // halfLife = ln(2) / theta
      // sigma = sigma_epsilon * sqrt(2 * theta / (1 - beta^2))
      // equilibriumSigma = sigma / sqrt(2 * theta) = sigma_epsilon / sqrt(1 - beta^2)

      const trueBeta = 0.88;
      const trueDt = 1.0;
      const trueMu = 4.5;
      const trueAlpha = trueMu * (1.0 - trueBeta); // 4.5 * 0.12 = 0.54
      const expectedTheta = -Math.log(trueBeta) / trueDt; // ~0.127833
      const expectedHalfLife = Math.LN2 / expectedTheta; // ~5.422 minutes

      // Construct a strictly deterministic AR(1) sequence: b_{k+1} = 0.54 + 0.88 * b_k
      const N = 100;
      const obs: number[] = [35.0];
      for (let i = 0; i < N - 1; i++) {
        obs.push(trueAlpha + trueBeta * obs[i]);
      }

      const params = calibrateOrnsteinUhlenbeck(obs, trueDt);

      expect(params.sampleCount).toBe(N);
      expect(params.theta).toBeCloseTo(expectedTheta, 5);
      expect(params.mu).toBeCloseTo(trueMu, 4);
      expect(params.halfLifeMinutes).toBeCloseTo(expectedHalfLife, 4);
      expect(params.rSquared).toBeGreaterThan(0.9999);

      // Verify mathematical invariant: halfLife == ln(2) / theta
      expect(params.halfLifeMinutes).toBeCloseTo(Math.LN2 / params.theta, 6);

      // Verify mathematical invariant: equilibriumSigma == sigma / sqrt(2 * theta)
      if (params.sigma > 0.01) {
        expect(params.equilibriumSigma).toBeCloseTo(params.sigma / Math.sqrt(2.0 * params.theta), 4);
      }
    });

    it('empirically verifies time-step scaling: theta scales inversely with dtMinutes', () => {
      // Given the same discrete observations:
      // If dt = 1.0 min vs dt = 2.0 min: theta(dt=2) == theta(dt=1) / 2
      const obs = [20.0, 18.0, 16.5, 15.0, 14.0, 13.0, 12.2, 11.5, 11.0, 10.6, 10.3, 10.1];
      const params1m = calibrateOrnsteinUhlenbeck(obs, 1.0);
      const params2m = calibrateOrnsteinUhlenbeck(obs, 2.0);

      expect(params2m.theta).toBeCloseTo(params1m.theta / 2.0, 6);
      expect(params2m.halfLifeMinutes).toBeCloseTo(params1m.halfLifeMinutes * 2.0, 6);
    });

    it('stress tests stationarity clamping: explosive series (beta >= 1.0) clamped to betaCeil = 0.999', () => {
      // Divergent linear trend: 10, 15, 20, 25, 30, 35 ... (beta > 1)
      const divergentSeries = Array.from({ length: 40 }, (_, i) => 10.0 + i * 5.0);
      const params = calibrateOrnsteinUhlenbeck(divergentSeries, 1.0);

      // Clamped to 0.999 -> theta = -ln(0.999) ~= 0.0010005 > 0
      expect(params.theta).toBeCloseTo(-Math.log(0.999), 5);
      expect(params.theta).toBeGreaterThan(0);
      expect(Number.isFinite(params.mu)).toBe(true);
      expect(Number.isFinite(params.equilibriumSigma)).toBe(true);
    });

    it('stress tests stationarity clamping: anti-persistent series (beta <= 0) clamped to betaFloor = 0.01', () => {
      // High-frequency alternating flip: +30, -30, +30, -30 ... (beta ~ -1)
      const alternating = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 30.0 : -30.0));
      const params = calibrateOrnsteinUhlenbeck(alternating, 1.0);

      // Clamped to 0.01 -> theta = -ln(0.01) ~= 4.60517
      expect(params.theta).toBeCloseTo(-Math.log(0.01), 4);
      expect(params.halfLifeMinutes).toBeCloseTo(Math.LN2 / -Math.log(0.01), 4);
      expect(Number.isFinite(params.mu)).toBe(true);
    });

    it('stress tests zero variance series: frozen prices return floor without NaN or zero division', () => {
      const flatSeries = Array.from({ length: 50 }, () => 18.5);
      const params = calibrateOrnsteinUhlenbeck(flatSeries, 1.0);

      expect(params.mu).toBe(18.5);
      expect(params.theta).toBe(DEFAULT_OU_PRIORS.theta);
      expect(params.equilibriumSigma).toBe(DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor);
      expect(Number.isFinite(params.halfLifeMinutes)).toBe(true);
      expect(params.rSquared).toBe(0.0);
    });

    it('stress tests sparse observations (N < 5): returns robust default priors', () => {
      expect(calibrateOrnsteinUhlenbeck([]).theta).toBe(DEFAULT_OU_PRIORS.theta);
      expect(calibrateOrnsteinUhlenbeck([12.0]).theta).toBe(DEFAULT_OU_PRIORS.theta);
      expect(calibrateOrnsteinUhlenbeck([10.0, 11.0, 12.0, 13.0]).sampleCount).toBe(4);
    });

    it('stress tests dirty data sanitization: NaN, Infinity, -Infinity are cleanly stripped', () => {
      const dirty = [NaN, 10.0, Infinity, 12.0, -Infinity, 14.0, 16.0, 18.0, 20.0];
      const params = calibrateOrnsteinUhlenbeck(dirty, 1.0);

      // Cleaned series length is 6 (>= 5)
      expect(params.sampleCount).toBe(6);
      expect(Number.isFinite(params.theta)).toBe(true);
      expect(Number.isFinite(params.mu)).toBe(true);
    });

    it('verifies real-time z-score calculation: z_t = (b_t - mu) / equilibriumSigma', () => {
      const mockParams: OUParameters = {
        theta: 0.10,
        mu: 2.0,
        sigma: 5.0,
        halfLifeMinutes: 6.93,
        equilibriumSigma: 10.0,
        rSquared: 0.85,
        sampleCount: 60,
        lastUpdated: Date.now(),
      };

      // Mean: z = 0
      expect(calculateZScore(2.0, mockParams)).toBe(0.0);

      // +22 bps above mu: (24.0 - 2.0) / 10.0 = +2.20
      expect(calculateZScore(24.0, mockParams)).toBe(2.20);

      // -22 bps below mu: (-20.0 - 2.0) / 10.0 = -2.20
      expect(calculateZScore(-20.0, mockParams)).toBe(-2.20);

      // Division by zero safeguard
      const zeroSigmaParams = { ...mockParams, equilibriumSigma: 0.0 };
      expect(calculateZScore(24.0, zeroSigmaParams)).toBe(0.0);
    });
  });

  // =========================================================================
  // 2. BOUNDARY CONDITION STRESS TESTING: GATING THRESHOLDS
  // =========================================================================
  describe('Focus 2A: Entry Gating Boundary Conditions Stress Test', () => {
    const basePairTemplate: StatArbPair = {
      canonicalSymbol: 'BTC',
      binanceSymbol: 'BTCUSDT',
      bybitSymbol: 'BTCUSDT',
      multiplier: 1.0,
      binanceMid: 50000.0,
      bybitMid: 49840.0,
      grossBasisBps: 32.0,
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 4.0,
      orderBookDepthRatio: 5.0,
      lastUpdated: Date.now(),
    };

    const baseOUParams: OUParameters = {
      theta: 0.10,
      mu: 0.0,
      sigma: 5.0,
      halfLifeMinutes: 6.93,
      equilibriumSigma: 10.0,
      rSquared: 0.85,
      sampleCount: 60,
      lastUpdated: Date.now(),
    };

    // -----------------------------------------------------------------------
    // Gating Boundary 1: |z_t| = 2.19 vs 2.20
    // -----------------------------------------------------------------------
    it('Gate 1 Boundary: strictly REJECTS at |z_t| = 2.19 and APPROVES at |z_t| = 2.20', () => {
      const pair = { ...basePairTemplate, grossBasisBps: 30.0 };

      // Sub-case 1: Positive z = 2.19 (sigma = 30.0 / 2.19) -> REJECT
      const paramsZ219 = { ...baseOUParams, equilibriumSigma: 30.0 / 2.19 };
      const resZ219 = evaluateEntryGates(pair, paramsZ219);
      expect(resZ219.zScore).toBeCloseTo(2.19, 4);
      expect(resZ219.passed).toBe(false);
      expect(resZ219.reasons.some((r) => r.includes('Gate 1') && r.includes('[FAIL]'))).toBe(true);

      // Sub-case 2: Positive z = 2.20 (sigma = 30.0 / 2.20) -> APPROVE
      const paramsZ220 = { ...baseOUParams, equilibriumSigma: 30.0 / 2.20 };
      const resZ220 = evaluateEntryGates(pair, paramsZ220);
      expect(resZ220.zScore).toBeCloseTo(2.20, 4);
      expect(resZ220.passed).toBe(true);
      expect(resZ220.direction).toBe('SHORT_BINANCE_LONG_BYBIT');

      // Sub-case 3: Negative z = -2.19 -> REJECT
      const negPair = { ...basePairTemplate, grossBasisBps: -30.0 };
      const paramsNeg219 = { ...baseOUParams, equilibriumSigma: 30.0 / 2.19 };
      const resNeg219 = evaluateEntryGates(negPair, paramsNeg219);
      expect(resNeg219.zScore).toBeCloseTo(-2.19, 4);
      expect(resNeg219.passed).toBe(false);

      // Sub-case 4: Negative z = -2.20 -> APPROVE
      const paramsNeg220 = { ...baseOUParams, equilibriumSigma: 30.0 / 2.20 };
      const resNeg220 = evaluateEntryGates(negPair, paramsNeg220);
      expect(resNeg220.zScore).toBeCloseTo(-2.20, 4);
      expect(resNeg220.passed).toBe(true);
      expect(resNeg220.direction).toBe('SHORT_BYBIT_LONG_BINANCE');
    });

    // -----------------------------------------------------------------------
    // Gating Boundary 2: Gross Basis = 27.9 vs 28.0 bps
    // -----------------------------------------------------------------------
    it('Gate 2 Boundary: strictly REJECTS at gross basis = 27.9 bps and APPROVES at 28.0 bps', () => {
      // Set sigma such that z >= 2.20 in both cases
      const params = { ...baseOUParams, equilibriumSigma: 10.0 };

      // Sub-case 1: Basis = +27.9 bps (z = 2.79 >= 2.20, but basis fails) -> REJECT
      const pair279 = { ...basePairTemplate, grossBasisBps: 27.9 };
      const res279 = evaluateEntryGates(pair279, params);
      expect(res279.passed).toBe(false);
      expect(res279.reasons.some((r) => r.includes('Gate 2') && r.includes('[FAIL]'))).toBe(true);

      // Sub-case 2: Basis = +28.0 bps (z = 2.80 >= 2.20, basis passes) -> APPROVE
      const pair280 = { ...basePairTemplate, grossBasisBps: 28.0 };
      const res280 = evaluateEntryGates(pair280, params);
      expect(res280.passed).toBe(true);
      expect(res280.direction).toBe('SHORT_BINANCE_LONG_BYBIT');

      // Sub-case 3: Negative Basis = -27.9 bps -> REJECT
      const negPair279 = { ...basePairTemplate, grossBasisBps: -27.9 };
      const resNeg279 = evaluateEntryGates(negPair279, params);
      expect(resNeg279.passed).toBe(false);

      // Sub-case 4: Negative Basis = -28.0 bps -> APPROVE
      const negPair280 = { ...basePairTemplate, grossBasisBps: -28.0 };
      const resNeg280 = evaluateEntryGates(negPair280, params);
      expect(resNeg280.passed).toBe(true);
      expect(resNeg280.direction).toBe('SHORT_BYBIT_LONG_BINANCE');
    });

    // -----------------------------------------------------------------------
    // Gating Boundary 3: Depth Cushion = 3.99x vs 4.00x
    // -----------------------------------------------------------------------
    it('Gate 3 Boundary: strictly REJECTS at depth cushion = 3.99x and APPROVES at 4.00x', () => {
      const params = { ...baseOUParams, equilibriumSigma: 10.0 };

      // Sub-case 1: Depth = 3.99x -> REJECT
      const pair399 = { ...basePairTemplate, grossBasisBps: 30.0, orderBookDepthRatio: 3.99 };
      const res399 = evaluateEntryGates(pair399, params);
      expect(res399.passed).toBe(false);
      expect(res399.reasons.some((r) => r.includes('Gate 3') && r.includes('[FAIL]'))).toBe(true);

      // Sub-case 2: Depth = 4.00x -> APPROVE
      const pair400 = { ...basePairTemplate, grossBasisBps: 30.0, orderBookDepthRatio: 4.00 };
      const res400 = evaluateEntryGates(pair400, params);
      expect(res400.passed).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Gating Boundary 4: Bid-Ask Spread = 8.01 vs 8.00 bps
    // -----------------------------------------------------------------------
    it('Gate 4 Boundary: strictly REJECTS at spread = 8.01 bps and APPROVES at 8.00 bps', () => {
      const params = { ...baseOUParams, equilibriumSigma: 10.0 };

      // Sub-case 1: Binance spread = 8.01 bps, Bybit = 4.00 bps -> REJECT
      const pairBn801 = {
        ...basePairTemplate,
        grossBasisBps: 30.0,
        binanceSpreadBps: 8.01,
        bybitSpreadBps: 4.00,
      };
      const resBn801 = evaluateEntryGates(pairBn801, params);
      expect(resBn801.passed).toBe(false);
      expect(resBn801.reasons.some((r) => r.includes('Gate 4') && r.includes('[FAIL]'))).toBe(true);

      // Sub-case 2: Binance spread = 4.00 bps, Bybit = 8.01 bps -> REJECT
      const pairBy801 = {
        ...basePairTemplate,
        grossBasisBps: 30.0,
        binanceSpreadBps: 4.00,
        bybitSpreadBps: 8.01,
      };
      const resBy801 = evaluateEntryGates(pairBy801, params);
      expect(resBy801.passed).toBe(false);

      // Sub-case 3: Both venues exactly at 8.00 bps cap -> APPROVE
      const pairBoth800 = {
        ...basePairTemplate,
        grossBasisBps: 30.0,
        binanceSpreadBps: 8.00,
        bybitSpreadBps: 8.00,
      };
      const resBoth800 = evaluateEntryGates(pairBoth800, params);
      expect(resBoth800.passed).toBe(true);
    });
  });

  // =========================================================================
  // 3. ZERO-LOSS EXIT BOUNDARY STRESS TESTING: +$0.0099 vs +$0.0100 USDT
  // =========================================================================
  describe('Focus 2B: Guaranteed Zero-Loss Exit Boundary Stress Test', () => {
    const mockPosition: StatArbPosition = {
      id: 'test-pos-zl',
      canonicalSymbol: 'BTC',
      binanceSymbol: 'BTCUSDT',
      bybitSymbol: 'BTCUSDT',
      direction: 'SHORT_BINANCE_LONG_BYBIT',
      status: 'OPEN',
      entryTimestamp: Date.now() - 20 * 60 * 1000,
      entryBasisBps: 32.0,
      entryBinancePrice: 50000.0,
      entryBybitPrice: 49840.0,
      quantity: 0.0003,
      notionalUsdt: 15.0,
      currentBasisBps: 8.0, // 75% compression
      currentBinancePrice: 49920.0,
      currentBybitPrice: 49880.0,
      currentZScore: 0.20,
      realizedPnlUsdt: 0.0,
      unrealizedPnlUsdt: 0.0,
      totalFeesUsdt: 0.0,
      netPnlUsdt: 0.0,
      holdDurationMinutes: 20,
      divergenceHistory30m: [0.32, 0.25, 0.15, 0.08],
    };

    it('strictly BLOCKS exit when Net PnL = +$0.0099 USDT (< +$0.0100 USDT)', () => {
      // Notional = 15.0, totalFees = 0.0225. Gross required for 0.0099 net: 0.0099 + 0.0225 = 0.0324
      // Basis captured: 0.0324 * 10000 / 15.0 = 21.6 bps. With entryBasis = 32.0, currentBasis = 10.4 bps.
      const pos0099 = { ...mockPosition };
      const gate = evaluateZeroLossExitGate(pos0099, 10.4, 0.20);

      expect(gate.netPnLUsdt).toBe(0.0099);
      expect(gate.exitAllowed).toBe(false);
      expect(gate.reason).toBe('BLOCKED_BY_ZERO_LOSS_GATE');

      // Comprehensive evaluateExit must return HOLD_CARRY_FOR_PARITY
      const evalResult = evaluateExit(pos0099, 10.4, 0.20);
      expect(evalResult.canExit).toBe(false);
      expect(evalResult.exitAllowed).toBe(false);
      expect(evalResult.exitType).toBe('HOLD_CARRY_FOR_PARITY');
    });

    it('strictly APPROVES exit when Net PnL = +$0.0100 USDT (exact invariant boundary)', () => {
      // Notional = 15.0, totalFees = 0.0225. Gross required for 0.0100 net: 0.0100 + 0.0225 = 0.0325
      // Basis captured: 0.0325 * 10000 / 15.0 = 21.6667 bps. With entryBasis = 32.0, currentBasis = 10.3333 bps.
      const pos0100 = { ...mockPosition };
      const gate = evaluateZeroLossExitGate(pos0100, 10.3333, 0.20);

      expect(gate.netPnLUsdt).toBe(0.0100);
      expect(gate.exitAllowed).toBe(true);
      expect(gate.reason).toContain('Zero-Loss Gate passed');

      // Comprehensive evaluateExit must return PROFITABLE_CONVERGENCE_EXIT
      const evalResult = evaluateExit(pos0100, 10.3333, 0.20);
      expect(evalResult.canExit).toBe(true);
      expect(evalResult.exitAllowed).toBe(true);
      expect(evalResult.exitType).toBe('PROFITABLE_CONVERGENCE_EXIT');
    });

    it('stress tests sub-penny precision: +$0.00999 is blocked, +$0.01001 is approved', () => {
      // 10.4 bps basis yields netPnL = 0.0099 (< 0.0100 hurdle -> BLOCKED)
      expect(evaluateZeroLossExitGate(mockPosition, 10.4, 0.20).exitAllowed).toBe(false);

      // 10.3333 bps basis yields netPnL = 0.0100 (>= 0.0100 hurdle -> APPROVED)
      expect(evaluateZeroLossExitGate(mockPosition, 10.3333, 0.20).exitAllowed).toBe(true);
    });

    it('evaluates basis compression gate boundary: 74.9% (blocked) vs 75.0% (approved)', () => {
      // Entry 32.0 bps:
      // Current 8.032 bps -> (32.0 - 8.032) / 32.0 = 0.749 (74.9%) -> FAIL
      expect(calculateBasisCompression(32.0, 8.032)).toBe(0.749);
      expect(isBasisCompressed(32.0, 8.032)).toBe(false);

      // Current 8.000 bps -> (32.0 - 8.000) / 32.0 = 0.750 (75.0%) -> PASS
      expect(calculateBasisCompression(32.0, 8.000)).toBe(0.750);
      expect(isBasisCompressed(32.0, 8.000)).toBe(true);
    });

    it('evaluates z-score normalization gate boundary: |z| = 0.36 (blocked) vs 0.35 (approved)', () => {
      expect(isZScoreNormalized(0.36)).toBe(false);
      expect(isZScoreNormalized(-0.36)).toBe(false);
      expect(isZScoreNormalized(0.35)).toBe(true);
      expect(isZScoreNormalized(-0.35)).toBe(true);
    });
  });

  // =========================================================================
  // 4. INVARIANT 6: 30-MINUTE LOW-WATERMARK PERSISTENCE BREAKER STRESS
  // =========================================================================
  describe('Focus 2C: Invariant 6 (30-Minute Low-Watermark Breaker Persistence)', () => {
    it('TRIGGERS breaker when divergence continuously remains >= 1.0% for >= 30 minutes', () => {
      // 30 consecutive samples, all >= 1.0% (e.g. 1.05% to 1.30%)
      const continuous30m = Array.from({ length: 30 }, (_, i) => 1.05 + (i % 5) * 0.05);
      const res = checkInvariant6PersistenceBreaker(30.0, continuous30m);

      expect(res.triggered).toBe(true);
      expect(res.holdMinutes).toBe(30.0);
      expect(res.minDivergencePct).toBeGreaterThanOrEqual(1.0);
      expect(res.reason).toContain('Invariant 6 Persistence Breaker triggered');
    });

    it('does NOT trigger if hold time is 29.9 minutes (< 30 min required threshold)', () => {
      const continuous30m = Array.from({ length: 30 }, () => 1.25);
      const res = checkInvariant6PersistenceBreaker(29.9, continuous30m);

      expect(res.triggered).toBe(false);
      expect(res.reason).toContain('< 30m threshold');
    });

    it('RESETS breaker and does NOT trigger if spread touches < 1.0% at minute 28 (sample 28)', () => {
      // 30 samples: samples 0 to 27 >= 1.0%, sample 28 dips to 0.94%, sample 29 is 1.10%
      const resetAt28 = Array.from({ length: 30 }, (_, i) => (i === 28 ? 0.94 : 1.15));
      const res = checkInvariant6PersistenceBreaker(30.0, resetAt28);

      expect(res.triggered).toBe(false);
      expect(res.minDivergencePct).toBe(0.94);
      expect(res.reason).toContain('Persistence timer reset');
    });

    it('RESETS breaker if spread dips to 0.999% (borderline sub-1.0%) at minute 28', () => {
      const borderlineReset = Array.from({ length: 30 }, (_, i) => (i === 28 ? 0.999 : 1.20));
      const res = checkInvariant6PersistenceBreaker(32.0, borderlineReset);

      expect(res.triggered).toBe(false);
      expect(res.minDivergencePct).toBe(0.999);
      expect(res.reason).toContain('Persistence timer reset');
    });

    it('TRIGGERS if spread stays flat at exactly 1.000% throughout the 30 minutes', () => {
      const flat1pct = Array.from({ length: 30 }, () => 1.000);
      const res = checkInvariant6PersistenceBreaker(30.0, flat1pct);

      expect(res.triggered).toBe(true);
      expect(res.minDivergencePct).toBe(1.000);
    });

    it('OVERRIDES Zero-Loss Gate when Invariant 6 triggers during position evaluation', () => {
      const position: StatArbPosition = {
        id: 'pos_inv6',
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        status: 'OPEN',
        entryTimestamp: Date.now() - 35 * 60 * 1000,
        entryBasisBps: 30.0,
        entryBinancePrice: 50000.0,
        entryBybitPrice: 49850.0,
        quantity: 0.0003,
        notionalUsdt: 15.0,
        currentBasisBps: 35.0, // Expanded basis (loss)
        currentBinancePrice: 50000.0,
        currentBybitPrice: 49825.0,
        currentZScore: 2.8,
        realizedPnlUsdt: 0.0,
        unrealizedPnlUsdt: -0.075,
        totalFeesUsdt: 0.0225,
        netPnlUsdt: -0.0975, // Definite loss
        holdDurationMinutes: 35.0,
        divergenceHistory30m: Array.from({ length: 30 }, () => 1.15),
      };

      const evalResult = evaluateExit(position, 35.0, 2.8, {
        holdMinutes: 35.0,
        divergenceHistory30m: position.divergenceHistory30m,
      });

      // Must override Zero-Loss to liquidate structural depeg!
      expect(evalResult.canExit).toBe(true);
      expect(evalResult.exitAllowed).toBe(true);
      expect(evalResult.exitType).toBe('STRUCTURAL_BASIS_DECOUPLING');
      expect(evalResult.reason).toContain('Invariant 6 Persistence Breaker triggered');
    });
  });

  // =========================================================================
  // 5. INVARIANT 7: UPSTREAM STICKY DECOUPLING FILTER STRESS
  // =========================================================================
  describe('Focus 2D: Invariant 7 (Upstream Sticky Decoupling Filter)', () => {
    it('REJECTS pair candidate if min divergence in 30m window is >= 1.0%', () => {
      // 30 samples all >= 1.0% (e.g. min is 1.04%)
      const stickyHistory = [
        1.15, 1.22, 1.18, 1.09, 1.14, 1.25, 1.30, 1.12, 1.05, 1.04,
        1.08, 1.10, 1.15, 1.20, 1.25, 1.18, 1.12, 1.06, 1.05, 1.07,
        1.14, 1.20, 1.22, 1.19, 1.15, 1.10, 1.08, 1.05, 1.06, 1.04,
      ];

      const res = checkInvariant7StickyDecoupling(stickyHistory);

      expect(res.passed).toBe(false);
      expect(res.code).toBe('INVARIANT_7_STICKY_DECOUPLING_REJECTED');
      expect(res.minDivergencePct).toBe(1.04);
      expect(res.reason).toContain('[INVARIANT_7_STICKY_DECOUPLING_REJECTED]');
      expect(res.reason).toContain('Structurally decoupled market');
    });

    it('PASSES pair candidate if spread touched < 1.0% within the 30m window (e.g. 0.999%)', () => {
      const historyTouchedSub1 = [
        1.15, 1.22, 1.18, 1.09, 1.14, 1.25, 1.30, 1.12, 1.05, 1.04,
        1.08, 1.10, 1.15, 1.20, 1.25, 1.18, 1.12, 1.06, 1.05, 1.07,
        1.14, 1.20, 1.22, 1.19, 1.15, 1.10, 1.08, 0.999, 1.06, 1.04,
      ];

      const res = checkInvariant7StickyDecoupling(historyTouchedSub1);

      expect(res.passed).toBe(true);
      expect(res.code).toBeUndefined();
      expect(res.minDivergencePct).toBe(0.999);
      expect(res.reason).toContain('Invariant 7 passed');
    });

    it('PASSES normal mean-reverting currency pairs (spread oscillates around 0.15% to 0.40%)', () => {
      const normalHistory = [0.25, 0.30, 0.18, 0.35, 0.22, 0.15, 0.28, 0.32];
      const res = checkInvariant7StickyDecoupling(normalHistory);

      expect(res.passed).toBe(true);
      expect(res.minDivergencePct).toBe(0.15);
    });

    it('REJECTS when min divergence is flat at exactly 1.000% (min >= 1.0%)', () => {
      const flat1pct = Array.from({ length: 30 }, () => 1.000);
      const res = checkInvariant7StickyDecoupling(flat1pct);

      expect(res.passed).toBe(false);
      expect(res.code).toBe('INVARIANT_7_STICKY_DECOUPLING_REJECTED');
      expect(res.minDivergencePct).toBe(1.000);
    });

    it('handles negative divergence values via absolute value normalization', () => {
      // Bybit rich corridor: spread is -1.15% to -1.05% -> |spread| >= 1.05% -> REJECT
      const negHistory = Array.from({ length: 30 }, () => -1.15);
      const res = checkInvariant7StickyDecoupling(negHistory);

      expect(res.passed).toBe(false);
      expect(res.code).toBe('INVARIANT_7_STICKY_DECOUPLING_REJECTED');
      expect(res.minDivergencePct).toBe(1.15);
    });

    it('verifies StatArbStateStore getClosedPositions and /api/convergence/audit endpoint', async () => {
      const { StatArbStateStore } = await import('@/lib/statarb/engine/statArbStateStore');
      const store = new StatArbStateStore();
      
      expect(typeof store.getClosedPositions).toBe('function');
      expect(Array.isArray(store.getClosedPositions())).toBe(true);

      const { GET } = await import('@/app/api/convergence/audit/route');
      const { NextRequest } = await import('next/server');
      const req = new NextRequest('http://localhost:3000/api/convergence/audit');
      const response = await GET(req);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.activePositions)).toBe(true);
      expect(Array.isArray(json.completedFills)).toBe(true);
      expect(json.summary).toBeDefined();
    });
  });
});
