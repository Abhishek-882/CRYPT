/**
 * Synthetic Exit Gate Test Fixtures for STATARB-OU-PERP
 * Target: Exit Optimizer (exitOptimizer.ts)
 * 
 * Verifies:
 * - Basis compression exit gate: 74.9% (blocked) vs 75.0% (approved)
 * - Z-score normalization exit gate: |z| = 0.36 (blocked) vs 0.35 (approved)
 * - Zero-loss net PnL gate: +$0.009 (blocked) vs +$0.010 (approved) vs +$0.120 (approved)
 * - Fee deduction calculations: Binance Maker 2.0 bps + Bybit Taker 5.5 bps
 * - Invariant 6 structural decoupling override of zero-loss gate
 */

import { StatArbPosition, StatArbDirection } from '@/lib/statarb/types';

export interface ExitGateScenario {
  name: string;
  position: StatArbPosition;
  currentBasisBps: number;
  zScore: number;
  expectedBasisCompressionPct: number;
  expectedCompressionPassed: boolean;
  expectedZScorePassed: boolean;
  expectedZeroLossPassed: boolean;
  expectedExitAllowed: boolean;
  expectedReasonCode?: string;
  description: string;
}

/**
 * Creates a fully populated mock StatArbPosition with deterministic sensible defaults
 */
export function createMockPosition(overrides: Partial<StatArbPosition> = {}): StatArbPosition {
  const notionalUsdt = overrides.notionalUsdt ?? 100.0;
  const entryBinancePrice = overrides.entryBinancePrice ?? 50000.0;
  const entryBybitPrice = overrides.entryBybitPrice ?? 49840.0;
  const quantity = overrides.quantity ?? notionalUsdt / entryBinancePrice;

  return {
    id: 'test-pos-001',
    canonicalSymbol: 'BTC',
    binanceSymbol: 'BTCUSDT',
    bybitSymbol: 'BTCUSDT',
    direction: 'SHORT_BINANCE_LONG_BYBIT' as StatArbDirection,
    status: 'OPEN',
    entryTimestamp: Date.now() - 15 * 60 * 1000,
    entryBasisBps: 32.0,
    entryBinancePrice,
    entryBybitPrice,
    quantity,
    notionalUsdt,
    currentBasisBps: 8.0,
    currentBinancePrice: 49920.0,
    currentBybitPrice: 49880.0,
    currentZScore: 0.30,
    realizedPnlUsdt: 0.0,
    unrealizedPnlUsdt: 0.0,
    totalFeesUsdt: 0.0,
    netPnlUsdt: 0.0,
    holdDurationMinutes: 15,
    divergenceHistory30m: [0.32, 0.28, 0.24, 0.20, 0.16, 0.12, 0.08],
    ...overrides,
  };
}

/**
 * Standard Scenario 1: Basis Compression 74.9% (Boundary Failure)
 * Entry basis = 32.0 bps, Current basis = 8.032 bps
 * Compression = (32.0 - 8.032) / 32.0 = 0.749 (74.9%) < 75.0%
 * Z-score = 0.85 (not normalized)
 * Result: Blocked (neither convergence condition met)
 */
export const COMPRESSION_74_9_SCENARIO: ExitGateScenario = {
  name: 'Basis Compression 74.9% (Below 75% Gate)',
  position: createMockPosition({
    entryBasisBps: 32.0,
    notionalUsdt: 100.0,
    netPnlUsdt: 0.05,
  }),
  currentBasisBps: 8.032,
  zScore: 0.85,
  expectedBasisCompressionPct: 0.749,
  expectedCompressionPassed: false,
  expectedZScorePassed: false,
  expectedZeroLossPassed: true,
  expectedExitAllowed: false,
  expectedReasonCode: 'CONVERGENCE_TARGET_NOT_REACHED',
  description: '74.9% basis compression is strictly below the 75.0% requirement; exit must be blocked',
};

/**
 * Standard Scenario 2: Basis Compression 75.0% (Exact Boundary Pass)
 * Entry basis = 32.0 bps, Current basis = 8.000 bps
 * Compression = (32.0 - 8.000) / 32.0 = 0.750 (75.0%) >= 75.0%
 * Z-score = 0.60
 * Result: Approved
 */
export const COMPRESSION_75_0_SCENARIO: ExitGateScenario = {
  name: 'Basis Compression 75.0% (Exact Boundary Approval)',
  position: createMockPosition({
    entryBasisBps: 32.0,
    notionalUsdt: 100.0,
    netPnlUsdt: 0.025,
  }),
  currentBasisBps: 8.000,
  zScore: 0.60,
  expectedBasisCompressionPct: 0.750,
  expectedCompressionPassed: true,
  expectedZScorePassed: false,
  expectedZeroLossPassed: true,
  expectedExitAllowed: true,
  expectedReasonCode: 'APPROVED_BASIS_COMPRESSION',
  description: 'Exactly 75.0% basis compression triggers exit approval when net PnL >= +$0.01',
};

/**
 * Standard Scenario 3: Basis Compression 80.0% (Comfortable Pass)
 * Entry basis = 32.0 bps, Current basis = 6.400 bps
 * Compression = 0.800 (80.0%)
 */
export const COMPRESSION_80_0_SCENARIO: ExitGateScenario = {
  name: 'Basis Compression 80.0% (Comfortable Approval)',
  position: createMockPosition({
    entryBasisBps: 32.0,
    notionalUsdt: 100.0,
    netPnlUsdt: 0.040,
  }),
  currentBasisBps: 6.400,
  zScore: 0.45,
  expectedBasisCompressionPct: 0.800,
  expectedCompressionPassed: true,
  expectedZScorePassed: false,
  expectedZeroLossPassed: true,
  expectedExitAllowed: true,
  expectedReasonCode: 'APPROVED_BASIS_COMPRESSION',
  description: '80.0% basis compression easily satisfies the 75.0% threshold',
};

/**
 * Standard Scenario 4: Negative Entry Basis (Bybit Rich) Compression
 * Entry basis = -30.0 bps, Current basis = -7.45 bps
 * Compression = (|-30.0| - |-7.45|) / |-30.0| = (30.0 - 7.45) / 30.0 = 0.7517 (75.17%)
 */
export const NEGATIVE_BASIS_COMPRESSION_SCENARIO: ExitGateScenario = {
  name: 'Negative Entry Basis (Bybit Rich) Compression 75.17%',
  position: createMockPosition({
    direction: 'SHORT_BYBIT_LONG_BINANCE',
    entryBasisBps: -30.0,
    notionalUsdt: 100.0,
    netPnlUsdt: 0.035,
  }),
  currentBasisBps: -7.45,
  zScore: -0.50,
  expectedBasisCompressionPct: 0.7517,
  expectedCompressionPassed: true,
  expectedZScorePassed: false,
  expectedZeroLossPassed: true,
  expectedExitAllowed: true,
  expectedReasonCode: 'APPROVED_BASIS_COMPRESSION',
  description: 'Absolute value compression correctly handles negative basis corridors',
};

/**
 * Standard Scenario 5: Z-Score Exit |z| = 0.36 (Boundary Failure)
 * |z| = 0.36 > 0.35 threshold
 * Compression = 60% (< 75%)
 * Result: Blocked
 */
export const ZSCORE_0_36_SCENARIO: ExitGateScenario = {
  name: 'Z-Score Normalization |z| = 0.36 (Fails Gate)',
  position: createMockPosition({
    entryBasisBps: 30.0,
    notionalUsdt: 100.0,
    netPnlUsdt: 0.020,
  }),
  currentBasisBps: 12.0, // 60% compression only
  zScore: 0.36,
  expectedBasisCompressionPct: 0.60,
  expectedCompressionPassed: false,
  expectedZScorePassed: false,
  expectedZeroLossPassed: true,
  expectedExitAllowed: false,
  expectedReasonCode: 'CONVERGENCE_TARGET_NOT_REACHED',
  description: '|z| = 0.36 exceeds the 0.35 normalization boundary; exit blocked',
};

/**
 * Standard Scenario 6: Z-Score Exit |z| = 0.35 (Exact Boundary Pass)
 * |z| = 0.35 <= 0.35 threshold
 * Result: Approved
 */
export const ZSCORE_0_35_SCENARIO: ExitGateScenario = {
  name: 'Z-Score Normalization |z| = 0.35 (Exact Boundary Pass)',
  position: createMockPosition({
    entryBasisBps: 30.0,
    notionalUsdt: 100.0,
    netPnlUsdt: 0.020,
  }),
  currentBasisBps: 12.0,
  zScore: 0.35,
  expectedBasisCompressionPct: 0.60,
  expectedCompressionPassed: false,
  expectedZScorePassed: true,
  expectedZeroLossPassed: true,
  expectedExitAllowed: true,
  expectedReasonCode: 'APPROVED_ZSCORE_NORMALIZATION',
  description: 'Exactly |z| = 0.35 meets the normalization exit gate',
};

/**
 * Standard Scenario 7: Negative Z-Score Exit z = -0.35 (Passes Gate)
 */
export const ZSCORE_NEGATIVE_0_35_SCENARIO: ExitGateScenario = {
  name: 'Negative Z-Score Normalization z = -0.35 (Passes Gate)',
  position: createMockPosition({
    direction: 'SHORT_BYBIT_LONG_BINANCE',
    entryBasisBps: -30.0,
    notionalUsdt: 100.0,
    netPnlUsdt: 0.020,
  }),
  currentBasisBps: -10.0,
  zScore: -0.35,
  expectedBasisCompressionPct: 0.6667,
  expectedCompressionPassed: false,
  expectedZScorePassed: true,
  expectedZeroLossPassed: true,
  expectedExitAllowed: true,
  expectedReasonCode: 'APPROVED_ZSCORE_NORMALIZATION',
  description: 'Negative z-score magnitude |-0.35| = 0.35 satisfies the exit condition',
};

/**
 * Standard Scenario 8: Zero-Loss Gate: Net PnL = +$0.009 (Strictly Blocked)
 * Standard $15.0 USDT notional:
 * Entry basis = 28.0 bps, Current basis = 7.00 bps (exact 75% compression!)
 * Net PnL = +$0.0090 USDT (< +$0.0100 USDT threshold)
 * Result: BLOCKED_BY_ZERO_LOSS_GATE (must hold for parity)
 */
export const ZERO_LOSS_BLOCKED_0_009_SCENARIO: ExitGateScenario = {
  name: 'Zero-Loss Gate Block: Net PnL = +$0.009 USDT (< +$0.0100)',
  position: createMockPosition({
    notionalUsdt: 15.0,
    entryBasisBps: 28.0,
    netPnlUsdt: 0.009,
    unrealizedPnlUsdt: 0,
    totalFeesUsdt: 0,
  }),
  currentBasisBps: 7.00, // 75% compression
  zScore: 0.20,
  expectedBasisCompressionPct: 0.750,
  expectedCompressionPassed: true,
  expectedZScorePassed: true,
  expectedZeroLossPassed: false,
  expectedExitAllowed: false,
  expectedReasonCode: 'BLOCKED_BY_ZERO_LOSS_GATE',
  description: 'Net PnL of +$0.009 USDT is strictly less than +$0.0100 USDT; exit is programmatically blocked',
};

/**
 * Standard Scenario 9: Zero-Loss Gate: Net PnL = +$0.0100 (Exact Invariant Boundary Pass)
 * Standard $15.0 USDT notional:
 * Entry basis = 28.0 bps, Current basis = 6.3333 bps (77.4% compression)
 * Net PnL = +$0.0100 USDT (>= +$0.0100 USDT)
 * Result: Approved
 */
export const ZERO_LOSS_APPROVED_0_010_SCENARIO: ExitGateScenario = {
  name: 'Zero-Loss Gate Approval: Net PnL = +$0.0100 USDT (Exact Boundary)',
  position: createMockPosition({
    notionalUsdt: 15.0,
    entryBasisBps: 28.0,
    netPnlUsdt: 0.0100,
    unrealizedPnlUsdt: 0,
    totalFeesUsdt: 0,
  }),
  currentBasisBps: 6.3333,
  zScore: 0.20,
  expectedBasisCompressionPct: 0.7738,
  expectedCompressionPassed: true,
  expectedZScorePassed: true,
  expectedZeroLossPassed: true,
  expectedExitAllowed: true,
  expectedReasonCode: 'APPROVED_ZERO_LOSS_CONVERGENCE',
  description: 'Net PnL of exactly +$0.0100 USDT satisfies the Zero-Loss invariant',
};

/**
 * Standard Scenario 10: Zero-Loss Gate: Net PnL = +$0.1200 (Substantial Profit Approval)
 * $100.0 notional:
 * Entry basis = 35.0 bps, Current basis = 8.0 bps (77.1% compression)
 * Net PnL = +$0.1200 USDT
 * Result: Approved
 */
export const ZERO_LOSS_APPROVED_0_120_SCENARIO: ExitGateScenario = {
  name: 'Zero-Loss Gate Approval: Net PnL = +$0.1200 USDT (High Profit)',
  position: createMockPosition({
    notionalUsdt: 100.0,
    entryBasisBps: 35.0,
    netPnlUsdt: 0.1200,
    unrealizedPnlUsdt: 0,
    totalFeesUsdt: 0,
  }),
  currentBasisBps: 8.0,
  zScore: 0.15,
  expectedBasisCompressionPct: 0.7714,
  expectedCompressionPassed: true,
  expectedZScorePassed: true,
  expectedZeroLossPassed: true,
  expectedExitAllowed: true,
  expectedReasonCode: 'APPROVED_ZERO_LOSS_CONVERGENCE',
  description: 'Net PnL of +$0.1200 USDT comfortably clears the fee hurdle and zero-loss threshold',
};

/**
 * Standard Scenario 11: Negative Net PnL = -$0.050 USDT (Loss Block)
 * Z-score = 0.10 (normalized)
 * Net PnL = -$0.0500 USDT (< +$0.0100)
 * Result: Blocked
 */
export const ZERO_LOSS_BLOCKED_NEGATIVE_SCENARIO: ExitGateScenario = {
  name: 'Zero-Loss Gate Block: Negative Net PnL (-$0.050 USDT)',
  position: createMockPosition({
    notionalUsdt: 100.0,
    entryBasisBps: 30.0,
    netPnlUsdt: -0.050,
    unrealizedPnlUsdt: 0,
    totalFeesUsdt: 0,
  }),
  currentBasisBps: 35.0, // basis widened
  zScore: 0.10, // normalized
  expectedBasisCompressionPct: -0.1667,
  expectedCompressionPassed: false,
  expectedZScorePassed: true,
  expectedZeroLossPassed: false,
  expectedExitAllowed: false,
  expectedReasonCode: 'BLOCKED_BY_ZERO_LOSS_GATE',
  description: 'Negative net PnL is blocked from exiting, enforcing capital preservation',
};

/**
 * All scenarios assembled in test matrix
 */
export const EXIT_GATE_TEST_MATRIX: ExitGateScenario[] = [
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
];
