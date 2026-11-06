/**
 * Synthetic Entry Gate Matrix Fixture
 * Multi-Condition Entry Gating Test Scenarios:
 * Gate 1: |z_t| >= 2.20
 * Gate 2: |b_t| >= 28.0 bps
 * Gate 3: orderBookDepthRatio >= 4.0x
 * Gate 4: binanceSpreadBps <= 8.0 bps AND bybitSpreadBps <= 8.0 bps
 * 
 * Provides mock factory helpers and pre-calculated matrices for
 * pass/fail combinations, boundary thresholds, and directional regimes.
 */

import { StatArbPair, OUParameters, StatArbDirection } from '@/lib/statarb/types';

/**
 * Creates a fully populated StatArbPair with sensible defaults, allowing partial overrides.
 */
export function createMockPair(overrides: Partial<StatArbPair> = {}): StatArbPair {
  return {
    canonicalSymbol: 'BTC',
    binanceSymbol: 'BTCUSDT',
    bybitSymbol: 'BTCUSDT',
    multiplier: 1.0,
    binanceMid: 65000.0,
    bybitMid: 64800.0,
    grossBasisBps: 30.86, // ((65000 - 64800) / 64800) * 10000 ~= 30.86 bps
    orderBookDepthRatio: 5.5,
    binanceSpreadBps: 3.5,
    bybitSpreadBps: 4.0,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

/**
 * Creates a fully populated OUParameters object with sensible defaults, allowing partial overrides.
 */
export function createMockOUParams(overrides: Partial<OUParameters> = {}): OUParameters {
  return {
    theta: 0.12,
    mu: 0.0,
    sigma: 6.0,
    halfLifeMinutes: Math.LN2 / 0.12, // ~5.77 min
    equilibriumSigma: 12.247, // 6.0 / sqrt(2 * 0.12)
    rSquared: 0.88,
    sampleCount: 60,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

export interface GateTestCase {
  name: string;
  pair: StatArbPair;
  params: OUParameters;
  expectedPassed: boolean;
  expectedDirection?: StatArbDirection;
  failingGateDescription?: string;
}

/**
 * Standard single-condition failure & clean pass scenarios
 */
export const CORE_GATE_SCENARIOS: GateTestCase[] = [
  {
    name: 'Clean Pass: Binance Rich (Positive Basis & Z-Score)',
    pair: createMockPair({
      grossBasisBps: 32.0,
      orderBookDepthRatio: 5.0,
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 4.5,
    }),
    params: createMockOUParams({
      mu: 0.0,
      equilibriumSigma: 12.0, // z = 32.0 / 12.0 = +2.67 >= 2.20
    }),
    expectedPassed: true,
    expectedDirection: 'SHORT_BINANCE_LONG_BYBIT',
  },
  {
    name: 'Clean Pass: Bybit Rich (Negative Basis & Z-Score)',
    pair: createMockPair({
      grossBasisBps: -32.0,
      orderBookDepthRatio: 5.0,
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 4.5,
    }),
    params: createMockOUParams({
      mu: 0.0,
      equilibriumSigma: 12.0, // z = -32.0 / 12.0 = -2.67 <= -2.20
    }),
    expectedPassed: true,
    expectedDirection: 'SHORT_BYBIT_LONG_BINANCE',
  },
  {
    name: 'Reject: Gate 1 Fails (Z-Score too low, |z| = 1.88 < 2.20)',
    pair: createMockPair({
      grossBasisBps: 30.0,
      orderBookDepthRatio: 5.0,
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 4.5,
    }),
    params: createMockOUParams({
      mu: 0.0,
      equilibriumSigma: 16.0, // z = 30.0 / 16.0 = 1.875 < 2.20
    }),
    expectedPassed: false,
    failingGateDescription: 'Gate 1 (Z-Score)',
  },
  {
    name: 'Reject: Gate 2 Fails (Gross Basis too low, |b| = 24.0 bps < 28.0 bps)',
    pair: createMockPair({
      grossBasisBps: 24.0,
      orderBookDepthRatio: 5.0,
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 4.5,
    }),
    params: createMockOUParams({
      mu: 0.0,
      equilibriumSigma: 8.0, // z = 24.0 / 8.0 = 3.00 >= 2.20 (z passes, basis fails)
    }),
    expectedPassed: false,
    failingGateDescription: 'Gate 2 (Gross Basis)',
  },
  {
    name: 'Reject: Gate 3 Fails (Depth Cushion too shallow, 2.5x < 4.0x)',
    pair: createMockPair({
      grossBasisBps: 32.0,
      orderBookDepthRatio: 2.5, // Fails depth hurdle
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 4.5,
    }),
    params: createMockOUParams({
      mu: 0.0,
      equilibriumSigma: 12.0, // z = 2.67 >= 2.20
    }),
    expectedPassed: false,
    failingGateDescription: 'Gate 3 (Depth Cushion)',
  },
  {
    name: 'Reject: Gate 4 Fails (Binance Bid-Ask Spread too wide, 9.5 bps > 8.0 bps)',
    pair: createMockPair({
      grossBasisBps: 32.0,
      orderBookDepthRatio: 5.0,
      binanceSpreadBps: 9.5, // Exceeds 8.0 bps cap
      bybitSpreadBps: 4.0,
    }),
    params: createMockOUParams({
      mu: 0.0,
      equilibriumSigma: 12.0,
    }),
    expectedPassed: false,
    failingGateDescription: 'Gate 4 (Spread Cap)',
  },
  {
    name: 'Reject: Gate 4 Fails (Bybit Bid-Ask Spread too wide, 10.2 bps > 8.0 bps)',
    pair: createMockPair({
      grossBasisBps: 32.0,
      orderBookDepthRatio: 5.0,
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 10.2, // Exceeds 8.0 bps cap
    }),
    params: createMockOUParams({
      mu: 0.0,
      equilibriumSigma: 12.0,
    }),
    expectedPassed: false,
    failingGateDescription: 'Gate 4 (Spread Cap)',
  },
  {
    name: 'Reject: Conflicting Polarity (Positive basis but negative z-score)',
    pair: createMockPair({
      grossBasisBps: 30.0, // Positive basis
      orderBookDepthRatio: 5.0,
      binanceSpreadBps: 4.0,
      bybitSpreadBps: 4.0,
    }),
    params: createMockOUParams({
      mu: 60.0, // High mean shift
      equilibriumSigma: 10.0, // z = (30 - 60) / 10 = -3.00 (negative z, positive basis)
    }),
    expectedPassed: false,
    failingGateDescription: 'Directional Inconclusive',
  },
];

/**
 * Strict boundary comparison pairs testing single-unit quantization
 */
export const BOUNDARY_TEST_CASES = {
  zScore: {
    failValue: 2.19,
    passValue: 2.20,
    basisBps: 35.0,
    // When basis is 35.0, eqSigma = 35.0 / z
    failEqSigma: 35.0 / 2.19,
    passEqSigma: 35.0 / 2.20,
  },
  grossBasis: {
    failBps: 27.9,
    passBps: 28.0,
    eqSigma: 10.0, // z_fail = 2.79, z_pass = 2.80 (both z-scores pass)
  },
  depthRatio: {
    failRatio: 3.99,
    passRatio: 4.00,
  },
  binanceSpread: {
    failSpreadBps: 8.01,
    passSpreadBps: 8.00,
  },
  bybitSpread: {
    failSpreadBps: 8.01,
    passSpreadBps: 8.00,
  },
};

/**
 * Generates the full 2^4 = 16 combinatorial truth table of pass/fail gates
 */
export function generateFullCombinatorialMatrix(): GateTestCase[] {
  const cases: GateTestCase[] = [];
  const gateLabels = ['ZScore', 'Basis', 'Depth', 'Spread'];

  for (let mask = 0; mask < 16; mask++) {
    const g1Pass = (mask & 1) !== 0;
    const g2Pass = (mask & 2) !== 0;
    const g3Pass = (mask & 4) !== 0;
    const g4Pass = (mask & 8) !== 0;

    const allPassed = g1Pass && g2Pass && g3Pass && g4Pass;

    const basisBps = g2Pass ? 32.0 : 20.0;
    // Set eqSigma such that z is >= 2.20 if g1Pass, or < 2.20 if !g1Pass
    const targetZ = g1Pass ? 2.50 : 1.50;
    const eqSigma = basisBps / targetZ;

    const depthRatio = g3Pass ? 4.5 : 2.5;
    const binanceSpreadBps = g4Pass ? 4.0 : 9.0;
    const bybitSpreadBps = 4.0;

    const failingGates: string[] = [];
    if (!g1Pass) failingGates.push(gateLabels[0]);
    if (!g2Pass) failingGates.push(gateLabels[1]);
    if (!g3Pass) failingGates.push(gateLabels[2]);
    if (!g4Pass) failingGates.push(gateLabels[3]);

    cases.push({
      name: `Combo [Mask ${mask.toString(2).padStart(4, '0')}] G1:${g1Pass ? 'P' : 'F'} G2:${g2Pass ? 'P' : 'F'} G3:${g3Pass ? 'P' : 'F'} G4:${g4Pass ? 'P' : 'F'}`,
      pair: createMockPair({
        grossBasisBps: basisBps,
        orderBookDepthRatio: depthRatio,
        binanceSpreadBps,
        bybitSpreadBps,
      }),
      params: createMockOUParams({
        mu: 0.0,
        equilibriumSigma: eqSigma,
      }),
      expectedPassed: allPassed,
      expectedDirection: allPassed ? 'SHORT_BINANCE_LONG_BYBIT' : undefined,
      failingGateDescription: failingGates.join(', '),
    });
  }

  return cases;
}
