/**
 * Unit Test Suite: Guaranteed Zero-Loss Exit Optimizer
 * Target: web/lib/statarb/execution/exitOptimizer.ts
 * 
 * Verifies:
 * - Basis compression exit gate: 74.9% (blocked) vs 75.0% (approved)
 * - Z-score normalization exit gate: |z| = 0.36 (blocked) vs |z| = 0.35 (approved)
 * - Strictly verifies that Net PnL < +$0.01 is blocked while Net PnL >= +$0.01 is approved
 * - Fee deduction calculations (Binance Maker 2.0 bps + Bybit Taker 5.5 bps)
 * - Comprehensive exit evaluation: Hold states, convergence approvals, and emergency overrides
 */

import { describe, it, expect } from 'vitest';
import {
  calculateBasisCompression,
  isBasisCompressed,
  isZScoreNormalized,
  calculateGrossBasisPnL,
  calculateRoundtripFees,
  evaluateZeroLossExitGate,
  evaluateExit,
  MIN_ZERO_LOSS_PROFIT_USDT,
  DEFAULT_COMPRESSION_THRESHOLD,
  DEFAULT_Z_SCORE_EXIT_THRESHOLD,
  DEFAULT_FEE_STRUCTURE,
} from '@/lib/statarb/execution/exitOptimizer';
import {
  createMockPosition,
  COMPRESSION_74_9_SCENARIO,
  COMPRESSION_75_0_SCENARIO,
  COMPRESSION_80_0_SCENARIO,
  NEGATIVE_BASIS_COMPRESSION_SCENARIO,
  ZSCORE_0_36_SCENARIO,
  ZSCORE_0_35_SCENARIO,
  ZSCORE_NEGATIVE_0_35_SCENARIO,
  ZERO_LOSS_BLOCKED_0_009_SCENARIO,
  ZERO_LOSS_APPROVED_0_010_SCENARIO,
  ZERO_LOSS_APPROVED_0_120_SCENARIO,
  ZERO_LOSS_BLOCKED_NEGATIVE_SCENARIO,
  EXIT_GATE_TEST_MATRIX,
} from './fixtures/exitGateFixtures';
import { CONTINUOUS_DIVERGENCE_30M } from './fixtures/invariantFixtures';

describe('Exit Optimizer Unit Tests (exitOptimizer.ts)', () => {
  // =========================================================================
  // GATE 1: BASIS COMPRESSION (>= 75.0%)
  // =========================================================================
  describe('Gate 1: Basis Compression Calculation & Evaluation', () => {
    it('calculates exact compression ratio: (|entryBasis| - |currentBasis|) / |entryBasis|', () => {
      // Entry 32.0 bps -> Current 8.0 bps = (32 - 8) / 32 = 0.75 (75%)
      const compression = calculateBasisCompression(32.0, 8.0);
      expect(compression).toBe(0.75);

      // Entry 32.0 bps -> Current 16.0 bps = 50%
      expect(calculateBasisCompression(32.0, 16.0)).toBe(0.50);

      // Entry 32.0 bps -> Current 0.0 bps = 100%
      expect(calculateBasisCompression(32.0, 0.0)).toBe(1.0);
    });

    it('strictly BLOCKS exit at 74.9% basis compression (< 75.0% threshold)', () => {
      // Entry 32.0 bps, current 8.032 bps -> 74.9% compression
      const entryBasis = 32.0;
      const currentBasis = 8.032;
      const compression = calculateBasisCompression(entryBasis, currentBasis);

      expect(compression).toBe(0.749);
      expect(isBasisCompressed(entryBasis, currentBasis)).toBe(false);
    });

    it('APPROVES exit at exactly 75.0% basis compression', () => {
      const entryBasis = 32.0;
      const currentBasis = 8.000;
      const compression = calculateBasisCompression(entryBasis, currentBasis);

      expect(compression).toBe(0.750);
      expect(isBasisCompressed(entryBasis, currentBasis)).toBe(true);
    });

    it('APPROVES exit at 80.0% basis compression (> 75.0%)', () => {
      const entryBasis = 32.0;
      const currentBasis = 6.400;

      expect(calculateBasisCompression(entryBasis, currentBasis)).toBe(0.800);
      expect(isBasisCompressed(entryBasis, currentBasis)).toBe(true);
    });

    it('correctly handles negative entry basis corridors (Bybit rich)', () => {
      // Entry basis = -30.0 bps
      // Current basis = -7.50 bps -> (| -30 | - | -7.5 |) / 30 = 22.5 / 30 = 0.75
      expect(calculateBasisCompression(-30.0, -7.50)).toBe(0.75);
      expect(isBasisCompressed(-30.0, -7.50)).toBe(true);

      // Current basis = -7.60 bps -> 74.67% compression
      expect(isBasisCompressed(-30.0, -7.60)).toBe(false);
    });

    it('handles basis expansion (widening spread) by returning negative compression', () => {
      // Entry 25.0 bps -> expands to 35.0 bps
      const compression = calculateBasisCompression(25.0, 35.0);
      expect(compression).toBe(-0.40);
      expect(isBasisCompressed(25.0, 35.0)).toBe(false);
    });

    it('safely handles zero entry basis without division by zero errors', () => {
      expect(calculateBasisCompression(0.0, 5.0)).toBe(0);
      expect(isBasisCompressed(0.0, 5.0)).toBe(false);
    });
  });

  // =========================================================================
  // GATE 2: Z-SCORE NORMALIZATION (|z| <= 0.35)
  // =========================================================================
  describe('Gate 2: Z-Score Normalization Evaluation', () => {
    it('strictly BLOCKS exit when |z| = 0.36 (> 0.35 threshold)', () => {
      expect(isZScoreNormalized(0.36)).toBe(false);
      expect(isZScoreNormalized(-0.36)).toBe(false);
    });

    it('APPROVES exit when |z| = 0.35 (exact boundary pass)', () => {
      expect(isZScoreNormalized(0.35)).toBe(true);
      expect(isZScoreNormalized(-0.35)).toBe(true);
    });

    it('APPROVES exit when basis is fully reverted (z = 0.0 or |z| < 0.35)', () => {
      expect(isZScoreNormalized(0.0)).toBe(true);
      expect(isZScoreNormalized(0.12)).toBe(true);
      expect(isZScoreNormalized(-0.25)).toBe(true);
    });
  });

  // =========================================================================
  // MANDATORY ZERO-LOSS INVARIANT GATE (NET PnL >= +$0.0100 USDT)
  // =========================================================================
  describe('Gate 3: Guaranteed Zero-Loss Invariant Enforcer', () => {
    it('strictly BLOCKS exit when Net PnL is +$0.0090 USDT (< +$0.0100 USDT)', () => {
      // Net PnL = +$0.0090 USDT (< +$0.0100 USDT threshold)
      const position = createMockPosition({
        notionalUsdt: 15.0,
        entryBasisBps: 28.0,
        netPnlUsdt: 0.009,
      });

      const result = evaluateZeroLossExitGate(position, 7.00, 0.20);

      expect(result.exitAllowed).toBe(false);
      expect(result.netPnLUsdt).toBe(0.009);
      expect(result.minRequiredProfitUsdt).toBe(0.01);
      expect(result.reason).toBe('BLOCKED_BY_ZERO_LOSS_GATE');
    });

    it('APPROVES exit when Net PnL is exactly +$0.0100 USDT (exact invariant boundary)', () => {
      const position = createMockPosition({
        notionalUsdt: 15.0,
        entryBasisBps: 28.0,
        netPnlUsdt: 0.010,
      });

      const result = evaluateZeroLossExitGate(position, 6.3333, 0.20);

      expect(result.exitAllowed).toBe(true);
      expect(result.netPnLUsdt).toBe(0.010);
      expect(result.reason).toContain('Zero-Loss Gate passed');
    });

    it('APPROVES exit when Net PnL is +$0.1200 USDT (substantial profit)', () => {
      const position = createMockPosition({
        notionalUsdt: 100.0,
        entryBasisBps: 35.0,
        netPnlUsdt: 0.120,
      });

      const result = evaluateZeroLossExitGate(position, 8.0, 0.15);

      expect(result.exitAllowed).toBe(true);
      expect(result.netPnLUsdt).toBe(0.120);
      expect(result.reason).toContain('Zero-Loss Gate passed');
    });

    it('strictly BLOCKS exit when Net PnL is negative (loss)', () => {
      const position = createMockPosition({
        notionalUsdt: 100.0,
        entryBasisBps: 30.0,
        netPnlUsdt: -0.050,
      });

      const result = evaluateZeroLossExitGate(position, 35.0, 1.50);

      expect(result.exitAllowed).toBe(false);
      expect(result.netPnLUsdt).toBeLessThan(0);
      expect(result.reason).toBe('BLOCKED_BY_ZERO_LOSS_GATE');
    });

    it('incorporates accumulated funding earned towards the zero-loss threshold', () => {
      const position = createMockPosition({
        notionalUsdt: 15.0,
        entryBasisBps: 28.0,
        netPnlUsdt: 0,
        totalFeesUsdt: 0.0225,
      });

      // Gross PnL = 0, Fees = $0.0225
      // Funding earned = +$0.0325 USDT
      // Net PnL = 0 + 0.0325 - 0.0225 = +$0.0100 USDT >= +$0.0100
      const result = evaluateZeroLossExitGate(position, 28.0, 0.20, DEFAULT_FEE_STRUCTURE, 0.0325);

      expect(result.exitAllowed).toBe(true);
      expect(result.netPnLUsdt).toBe(0.010);
      expect(result.fundingEarnedUsdt).toBe(0.0325);
    });
  });

  // =========================================================================
  // FEE CALCULATION & CONCRETE PRICE EXECUTION VERIFICATION
  // =========================================================================
  describe('Fee Deductions & Concrete Price Execution', () => {
    it('calculates roundtrip fees based on default schedule (15.0 bps)', () => {
      const position = createMockPosition({ notionalUsdt: 200.0, totalFeesUsdt: 0 });
      const fees = calculateRoundtripFees(position);
      expect(fees).toBe(0.30);
    });

    it('computes exact gross basis PnL from concrete venue execution prices', () => {
      // Short Binance @ 50,000, Long Bybit @ 49,840. Quantity = 0.002
      const position = createMockPosition({
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        entryBinancePrice: 50000.0,
        entryBybitPrice: 49840.0,
        quantity: 0.002,
      });

      // Current: Binance drops to 49,900 (Short profit: (50000 - 49900) * 0.002 = +$0.20)
      // Current: Bybit stays at 49,840 (Long PnL: 0)
      // Total Gross PnL = +$0.20
      const grossPnl = calculateGrossBasisPnL(position, 12.0, 49900.0, 49840.0);
      expect(grossPnl).toBe(0.20);
    });
  });

  // =========================================================================
  // COMPREHENSIVE EXIT EVALUATION PIPELINE (evaluateExit)
  // =========================================================================
  describe('Comprehensive Exit Pipeline (evaluateExit)', () => {
    it('returns PROFITABLE_CONVERGENCE_EXIT when 75% compression met and Net PnL >= +$0.01', () => {
      const position = createMockPosition({
        entryBasisBps: 32.0,
        notionalUsdt: 100.0,
        netPnlUsdt: 0.049,
      });

      // 80% compression (basis down to 6.4 bps), net PnL will be +$0.0490 >= +$0.01
      const result = evaluateExit(position, 6.40, 0.50);

      expect(result.canExit).toBe(true);
      expect(result.exitAllowed).toBe(true);
      expect(result.exitType).toBe('PROFITABLE_CONVERGENCE_EXIT');
      expect(result.isCompressed).toBe(true);
      expect(result.netPnLUsdt).toBeGreaterThanOrEqual(MIN_ZERO_LOSS_PROFIT_USDT);
      expect(result.reason).toContain('Convergence target met');
    });

    it('banks profit early via PROFITABLE_CONVERGENCE_EXIT when Net PnL >= +$0.01 even with 0% compression and high z-score', () => {
      // Position entered with 50.0 bps basis, notional $100
      // Current basis 33.0 bps -> 34% compression (far below 75%), |z| = 2.1 (far above 0.35)
      // Gross basis capture = 100 * (17.0 / 10000) = $0.1700
      // Roundtrip fees = 100 * 0.0015 = $0.1500
      // Net PnL = $0.1700 - $0.1500 = +$0.0200 >= +$0.0100 USDT hurdle!
      const position = createMockPosition({
        entryBasisBps: 50.0,
        notionalUsdt: 100.0,
      });

      const result = evaluateExit(position, 33.0, 2.10, {
        enableEarlyTakeProfit: true,
      });

      expect(result.canExit).toBe(true);
      expect(result.exitAllowed).toBe(true);
      expect(result.exitType).toBe('PROFITABLE_CONVERGENCE_EXIT');
      expect(result.isCompressed).toBe(false);
      expect(result.isNormalized).toBe(false);
      expect(result.netPnLUsdt).toBe(0.02);
      expect(result.reason).toContain('Early Take-Profit Banking');
    });

    it('respects custom minNetProfitUsdt hurdle in Early Take-Profit Banking', () => {
      const position = createMockPosition({
        entryBasisBps: 50.0,
        notionalUsdt: 100.0,
      });

      // Net PnL is +$0.0200
      // If minNetProfitUsdt = 0.0300, +$0.0200 is below hurdle -> HOLD_ACTIVE
      const resultBlocked = evaluateExit(position, 33.0, 2.10, {
        enableEarlyTakeProfit: true,
        minNetProfitUsdt: 0.0300,
      });
      expect(resultBlocked.canExit).toBe(false);
      expect(resultBlocked.exitType).toBe('HOLD_ACTIVE');

      // If minNetProfitUsdt = 0.0150, +$0.0200 is above hurdle -> PROFITABLE_CONVERGENCE_EXIT
      const resultAllowed = evaluateExit(position, 33.0, 2.10, {
        enableEarlyTakeProfit: true,
        minNetProfitUsdt: 0.0150,
      });
      expect(resultAllowed.canExit).toBe(true);
      expect(resultAllowed.exitType).toBe('PROFITABLE_CONVERGENCE_EXIT');
    });

    it('accurately evaluates Executable Liquidation Value using Top-of-Book Bid/Ask quotes', () => {
      // Short BN @ 0.1555, Long BYB @ 0.15503, qty 96
      const position = createMockPosition({
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        entryBinancePrice: 0.1555,
        entryBybitPrice: 0.15503,
        quantity: 96,
        notionalUsdt: 15.0,
      });

      // Mid prices look converged (bnMid 0.1556, bybMid 0.1555)
      // BUT live order book shows wide executable spread:
      // Binance Ask = 0.1596 (we must BUY here), Bybit Bid = 0.1588 (we must SELL here)
      const result = evaluateExit(position, 7.0, 0.20, {
        currentBinancePrice: 0.1556,
        currentBybitPrice: 0.1555,
        topBook: {
          binanceBid: 0.1555,
          binanceAsk: 0.1596,
          bybitBid: 0.1588,
          bybitAsk: 0.1590,
        },
      });

      // Even though mid-basis compressed, topBook crossing spread prevents exit into a loss!
      expect(result.canExit).toBe(false);
      expect(result.exitAllowed).toBe(false);
      expect(result.exitType).toBe('HOLD_CARRY_FOR_PARITY');
      expect(result.grossBasisPnLUsdt).toBeLessThan(0);
    });

    it('returns HOLD_CARRY_FOR_PARITY when 75% compression met but Net PnL < +$0.01', () => {
      const position = createMockPosition({
        entryBasisBps: 28.0,
        notionalUsdt: 15.0,
        netPnlUsdt: 0.009,
      });

      const result = evaluateExit(position, 7.0, 0.20);

      expect(result.canExit).toBe(false);
      expect(result.exitAllowed).toBe(false);
      expect(result.exitType).toBe('HOLD_CARRY_FOR_PARITY');
      expect(result.isCompressed).toBe(true);
      expect(result.reason).toBe('BLOCKED_BY_ZERO_LOSS_GATE');
    });

    it('returns HOLD_ACTIVE when neither convergence target is reached', () => {
      const position = createMockPosition({
        entryBasisBps: 32.0,
      });

      // 50% compression only (16.0 bps), |z| = 1.20
      const result = evaluateExit(position, 16.0, 1.20);

      expect(result.canExit).toBe(false);
      expect(result.exitAllowed).toBe(false);
      expect(result.exitType).toBe('HOLD_ACTIVE');
      expect(result.reason).toContain('Awaiting mean-reversion');
    });

    it('OVERRIDES Zero-Loss Gate on Catastrophic Stop-Loss (ROI <= -20%)', () => {
      const position = createMockPosition({
        entryBasisBps: 30.0,
      });

      // ROI = -22.5% (catastrophic market crash)
      const result = evaluateExit(position, 50.0, 2.5, {
        currentRoiPct: -22.5,
      });

      expect(result.canExit).toBe(true);
      expect(result.exitAllowed).toBe(true);
      expect(result.exitType).toBe('CATASTROPHIC_STOP');
      expect(result.reason).toContain('Catastrophic stop-loss triggered');
    });

    it('OVERRIDES Zero-Loss Gate on Invariant 6 30-Minute Persistence Breaker', () => {
      const position = createMockPosition({
        entryBasisBps: 30.0,
        holdDurationMinutes: 32.0,
        divergenceHistory30m: CONTINUOUS_DIVERGENCE_30M, // 30m continuous >= 1.0%
      });

      // Net PnL is negative (-$0.08), but persistent depeg must be liquidated
      const result = evaluateExit(position, 35.0, 2.8, {
        holdMinutes: 32.0,
        divergenceHistory30m: CONTINUOUS_DIVERGENCE_30M,
      });

      expect(result.canExit).toBe(true);
      expect(result.exitAllowed).toBe(true);
      expect(result.exitType).toBe('STRUCTURAL_BASIS_DECOUPLING');
      expect(result.reason).toContain('Invariant 6 Persistence Breaker triggered');
    });
  });

  // =========================================================================
  // PARAMETRIZED EXIT MATRIX VERIFICATION
  // =========================================================================
  describe('Parametrized Exit Gate Matrix Verification', () => {
    it.each(EXIT_GATE_TEST_MATRIX)('$name', (scenario) => {
      const compression = calculateBasisCompression(
        scenario.position.entryBasisBps,
        scenario.currentBasisBps
      );
      expect(compression).toBeCloseTo(scenario.expectedBasisCompressionPct, 3);
      expect(isBasisCompressed(scenario.position.entryBasisBps, scenario.currentBasisBps)).toBe(
        scenario.expectedCompressionPassed
      );
      expect(isZScoreNormalized(scenario.zScore)).toBe(scenario.expectedZScorePassed);

      const gate = evaluateZeroLossExitGate(
        scenario.position,
        scenario.currentBasisBps,
        scenario.zScore
      );
      expect(gate.exitAllowed).toBe(scenario.expectedZeroLossPassed);

      const fullEval = evaluateExit(scenario.position, scenario.currentBasisBps, scenario.zScore);
      expect(fullEval.exitAllowed).toBe(scenario.expectedExitAllowed);
    });
  });
});
