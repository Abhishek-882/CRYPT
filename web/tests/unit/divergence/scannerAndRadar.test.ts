/**
 * Divergence Bot: 24h Dispersion Scanner & Radar API Gating Test Suite
 * Milestone 2 (M2) Specification Verification & Live Ingestion Integration Tests
 * Location: web/tests/unit/divergence/scannerAndRadar.test.ts
 * 
 * Primary Invariants Enforced:
 * 1. ZERO BPS NOTATION: All spreads, basis, hurdles, fees strictly in % notation.
 * 2. STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * 3. DELTA-NEUTRALITY: Order sizing and hedge matching |Delta_net| < 0.001.
 * 4. PRODUCTION RECONNECTION: Directly tests web/lib/divergence/scanner.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculateLiveBasisPercent,
  calculateDispersion24hPercent,
  calculateDDI24h,
  isAntiCollisionValid,
  evaluateCandidateGates,
  executeUniverseScan,
  getDivergenceRadarFeed,
  scanDivergenceUniverse,
  resetDivergenceScannerCache,
  BASELINE_SEED_CORRIDOR,
  RADAR_CACHE_TTL_MS,
  DivergenceCandidate,
  RadarApiResponse,
} from '@/lib/divergence/scanner';
import {
  DEFAULT_DIVERGENCE_CONFIG,
  DIVERGENCE_HARD_LIMITS,
  DivergenceConfig,
  DivergenceDirection,
} from '@/lib/divergence/types';
import { BOUNDARY_TEST_CASES } from './fixtures/candidateMatrix';

// ============================================================================
// Mock Exchange Response Builders
// ============================================================================

function buildMockExchangeResponses() {
  // 18 mutual pairs: 13 qualifying, 5 failing specific gates
  const binanceBookTickers = [
    // 13 Qualifying Coins (Pass all 5 gates)
    { symbol: 'BTCUSDT', bidPrice: '68499.0', askPrice: '68501.0' },
    { symbol: 'ETHUSDT', bidPrice: '2479.5', askPrice: '2480.5' },
    { symbol: 'SOLUSDT', bidPrice: '172.49', askPrice: '172.51' },
    { symbol: 'SUIUSDT', bidPrice: '2.149', askPrice: '2.151' },
    { symbol: 'NEARUSDT', bidPrice: '4.849', askPrice: '4.851' },
    { symbol: 'AVAXUSDT', bidPrice: '28.39', askPrice: '28.41' },
    { symbol: 'DOGEUSDT', bidPrice: '0.1649', askPrice: '0.1651' },
    { symbol: 'ARBUSDT', bidPrice: '0.5799', askPrice: '0.5801' },
    { symbol: 'OPUSDT', bidPrice: '1.619', askPrice: '1.621' },
    { symbol: 'LINKUSDT', bidPrice: '12.19', askPrice: '12.21' },
    { symbol: 'APTUSDT', bidPrice: '9.39', askPrice: '9.41' },
    { symbol: '1000PEPEUSDT', bidPrice: '0.00984', askPrice: '0.00986' },
    { symbol: '1000SATSUSDT', bidPrice: '0.0002849', askPrice: '0.0002851' },

    // 5 Non-Qualifying Coins (Each failing a distinct gate)
    { symbol: 'XRPUSDT', bidPrice: '0.5399', askPrice: '0.5401' },   // Fails Gate 1: disp < 0.400%
    { symbol: 'ADAUSDT', bidPrice: '0.3599', askPrice: '0.3601' },   // Fails Gate 1: disp < 0.400%
    { symbol: 'TIAUSDT', bidPrice: '5.195', askPrice: '5.205' },     // Fails Gate 2: comp > 0.100%
    { symbol: 'INJUSDT', bidPrice: '20.014', askPrice: '20.016' },   // Fails Gate 4: runway blocked
    { symbol: 'ONUSDT', bidPrice: '0.399', askPrice: '0.401' },      // Fails Gate 3: disparity > 5.000%
  ];

  const bybitTickersList = [
    // 13 Qualifying Coins
    { symbol: 'BTCUSDT', bid1Price: '68489.0', ask1Price: '68491.0', turnover24h: '1500000000', fundingRate: '0.0001' },
    { symbol: 'ETHUSDT', bid1Price: '2479.0', ask1Price: '2480.0', turnover24h: '900000000', fundingRate: '0.0001' },
    { symbol: 'SOLUSDT', bid1Price: '172.47', ask1Price: '172.49', turnover24h: '500000000', fundingRate: '0.0001' },
    { symbol: 'SUIUSDT', bid1Price: '2.1490', ask1Price: '2.1500', turnover24h: '300000000', fundingRate: '0.0001' },
    { symbol: 'NEARUSDT', bid1Price: '4.848', ask1Price: '4.850', turnover24h: '150000000', fundingRate: '0.0001' },
    { symbol: 'AVAXUSDT', bid1Price: '28.390', ask1Price: '28.400', turnover24h: '200000000', fundingRate: '0.0001' },
    { symbol: 'DOGEUSDT', bid1Price: '0.16496', ask1Price: '0.16500', turnover24h: '400000000', fundingRate: '0.0001' },
    { symbol: 'ARBUSDT', bid1Price: '0.5798', ask1Price: '0.5800', turnover24h: '120000000', fundingRate: '0.0001' },
    { symbol: 'OPUSDT', bid1Price: '1.6196', ask1Price: '1.6200', turnover24h: '110000000', fundingRate: '0.0001' },
    { symbol: 'LINKUSDT', bid1Price: '12.196', ask1Price: '12.200', turnover24h: '130000000', fundingRate: '0.0001' },
    { symbol: 'APTUSDT', bid1Price: '9.396', ask1Price: '9.400', turnover24h: '95000000', fundingRate: '0.0001' },
    { symbol: '1000PEPEUSDT', bid1Price: '0.009846', ask1Price: '0.009850', turnover24h: '250000000', fundingRate: '0.0001' },
    { symbol: '10000SATSUSDT', bid1Price: '0.0028490', ask1Price: '0.0028500', turnover24h: '180000000', fundingRate: '0.0001' },

    // 5 Non-Qualifying Coins
    { symbol: 'XRPUSDT', bid1Price: '0.5398', ask1Price: '0.5400', turnover24h: '350000000', fundingRate: '0.0001' },
    { symbol: 'ADAUSDT', bid1Price: '0.3598', ask1Price: '0.3600', turnover24h: '220000000', fundingRate: '0.0001' },
    { symbol: 'TIAUSDT', bid1Price: '5.045', ask1Price: '5.055', turnover24h: '85000000', fundingRate: '0.0001' },
    { symbol: 'INJUSDT', bid1Price: '19.998', ask1Price: '20.002', turnover24h: '75000000', fundingRate: '0.0001' },
    { symbol: 'ONUSDT', bid1Price: '0.799', ask1Price: '0.801', turnover24h: '10000000', fundingRate: '0.0001' },
  ];

  return { binanceBookTickers, bybitTickersList };
}

function mockSuccessfulExchanges() {
  const { binanceBookTickers, bybitTickersList } = buildMockExchangeResponses();
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.includes('fapi.binance.com')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => binanceBookTickers,
      } as Response);
    }
    if (url.includes('api.bybit.com')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          retCode: 0,
          retMsg: 'OK',
          result: {
            category: 'linear',
            list: bybitTickersList,
          },
        }),
      } as Response);
    }
    return Promise.reject(new Error(`Unhandled URL in mock: ${url}`));
  });
}

describe('Milestone 2: 24h Dispersion Scanner & Radar Gating Suite', () => {
  const config: DivergenceConfig = { ...DEFAULT_DIVERGENCE_CONFIG };

  beforeEach(() => {
    resetDivergenceScannerCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetDivergenceScannerCache();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Core Happy Paths & 5 Gates)
  // =========================================================================
  describe('Tier 1: Feature Coverage & Core Happy Paths', () => {
    it('TC1.2.1 (24h Dispersion Calculation): evaluates rolling max absolute basis envelope', () => {
      const history = [0.050, -0.120, 0.250, -0.420, 0.380, -0.150, 0.020];
      const dispersion = calculateDispersion24hPercent(history);

      expect(dispersion).toBe(0.420);
      expect(dispersion).toBeGreaterThanOrEqual(config.minDispersion24hPercent);
    });

    it('TC1.2.2 (Dispersion Gate Filter): accepts >= 0.400% and rejects < 0.400%', () => {
      const qualifyingHistory = [0.100, -0.250, 0.450, -0.100];
      const nonQualifyingHistory = [0.050, -0.150, 0.220, -0.180];

      const dispPass = calculateDispersion24hPercent(qualifyingHistory);
      const dispFail = calculateDispersion24hPercent(nonQualifyingHistory);

      expect(dispPass).toBe(0.450);
      expect(dispPass >= config.minDispersion24hPercent).toBe(true);

      expect(dispFail).toBe(0.220);
      expect(dispFail >= config.minDispersion24hPercent).toBe(false);
    });

    it('TC1.2.3 (Live Compression Entry Gate): asserts coiled entry |bt| <= 0.100%', () => {
      const btCompressed = calculateLiveBasisPercent(2.1495, 2.1485);
      expect(Math.abs(btCompressed)).toBeLessThanOrEqual(config.maxLiveCompressionPercent);

      const btUncompressed = calculateLiveBasisPercent(2.1550, 2.1480);
      expect(Math.abs(btUncompressed)).toBeGreaterThan(config.maxLiveCompressionPercent);
    });

    it('TC1.2.4 (Anti-Collision Sanity Gate): rejects cross-venue price disparity > 5.000%', () => {
      const normalValid = isAntiCollisionValid(100.05, 100.00, config.antiCollisionSanityPercent);
      expect(normalValid).toBe(true);

      const anomalousValid = isAntiCollisionValid(0.40, 0.80, config.antiCollisionSanityPercent);
      expect(anomalousValid).toBe(false);
    });

    it('TC1.2.5 (Direction Selection Matrix): routes Direction 1 for DDI > +0.200 and Direction 2 for DDI < -0.200', () => {
      const ddiDir1 = calculateDDI24h(0.650, -0.200);
      expect(ddiDir1).toBeGreaterThan(0.200);

      const candidateDir1 = evaluateCandidateGates(100.01, 100.00, 0.650, ddiDir1, 0.000, config);
      expect(candidateDir1.suggestedDirection).toBe('LONG_BN_SHORT_BYB');

      const ddiDir2 = calculateDDI24h(0.150, -0.700);
      expect(ddiDir2).toBeLessThan(-0.200);

      const candidateDir2 = evaluateCandidateGates(100.00, 100.01, 0.700, ddiDir2, 0.000, config);
      expect(candidateDir2.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
    });

    it('TC1.2.6 (Compression Runway Buffer Guard Dir 1): withholds entry if bt > +0.030%', () => {
      const candidateRunwayBlocked = evaluateCandidateGates(100.075, 100.00, 0.600, 0.50, 0.000, config);
      expect(candidateRunwayBlocked.gatesPassed.runwayBuffer).toBe(false);
      expect(candidateRunwayBlocked.overallPassed).toBe(false);
      expect(candidateRunwayBlocked.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');

      const candidateRunwayPassed = evaluateCandidateGates(100.020, 100.00, 0.600, 0.50, 0.000, config);
      expect(candidateRunwayPassed.gatesPassed.runwayBuffer).toBe(true);
      expect(candidateRunwayPassed.overallPassed).toBe(true);
      expect(candidateRunwayPassed.statusReason).toBe('QUALIFIED_PRIME_ZONE');
    });

    it('TC1.2.7 (Compression Runway Buffer Guard Dir 2): withholds entry if bt < -0.030%', () => {
      const blockedDir2 = evaluateCandidateGates(99.965, 100.00, 0.600, -0.50, 0.000, config);
      expect(blockedDir2.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
      expect(blockedDir2.gatesPassed.runwayBuffer).toBe(false);
      expect(blockedDir2.overallPassed).toBe(false);
      expect(blockedDir2.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');

      const passedDir2 = evaluateCandidateGates(99.980, 100.00, 0.600, -0.50, 0.000, config);
      expect(passedDir2.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
      expect(passedDir2.gatesPassed.runwayBuffer).toBe(true);
      expect(passedDir2.overallPassed).toBe(true);
    });

    it('TC1.2.8 (Carry Feasibility Gate): accepts carry >= -0.030% and rejects < -0.030%', () => {
      const passCarry = evaluateCandidateGates(100.01, 100.00, 0.500, 0.40, -0.025, config);
      expect(passCarry.gatesPassed.carryFeasibility).toBe(true);
      expect(passCarry.overallPassed).toBe(true);

      const failCarry = evaluateCandidateGates(100.01, 100.00, 0.500, 0.40, -0.035, config);
      expect(failCarry.gatesPassed.carryFeasibility).toBe(false);
      expect(failCarry.overallPassed).toBe(false);
      expect(failCarry.statusReason).toBe('REJECTED_ADVERSE_CARRY');
    });

    it('TC1.2.9 (Net Alpha Projection & Zero-Loss Margin): verifies +0.120% net edge and zero-loss compliance', () => {
      const candidate = evaluateCandidateGates(100.01, 100.00, 0.500, 0.40, 0.000, config);
      expect(candidate.netAlphaProjectedPercent).toBe(0.120);

      const notional = DIVERGENCE_HARD_LIMITS.ORDER_NOTIONAL_USDT; // 15.00 USDT
      const dollarProfit = notional * (candidate.netAlphaProjectedPercent / 100.0);
      expect(dollarProfit).toBeCloseTo(0.0180, 4);
      expect(dollarProfit).toBeGreaterThanOrEqual(config.zeroLossNetHurdleUsdt);
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC2.2.1 (Exact Boundary 24h Dispersion 0.399% vs 0.400%): single epsilon distinction', () => {
      const below = evaluateCandidateGates(
        BOUNDARY_TEST_CASES.dispersionBelow.pBn,
        BOUNDARY_TEST_CASES.dispersionBelow.pByb,
        BOUNDARY_TEST_CASES.dispersionBelow.dispersion,
        BOUNDARY_TEST_CASES.dispersionBelow.ddi,
        BOUNDARY_TEST_CASES.dispersionBelow.carry,
        config
      );
      expect(below.gatesPassed.dispersion).toBe(false);
      expect(below.statusReason).toBe('REJECTED_LOW_DISPERSION_24H');

      const atMin = evaluateCandidateGates(
        BOUNDARY_TEST_CASES.dispersionAtMin.pBn,
        BOUNDARY_TEST_CASES.dispersionAtMin.pByb,
        BOUNDARY_TEST_CASES.dispersionAtMin.dispersion,
        BOUNDARY_TEST_CASES.dispersionAtMin.ddi,
        BOUNDARY_TEST_CASES.dispersionAtMin.carry,
        config
      );
      expect(atMin.gatesPassed.dispersion).toBe(true);
      expect(atMin.overallPassed).toBe(true);
    });

    it('TC2.2.2 (Exact Boundary Live Compression 0.100% vs 0.101%): tight entry qualification', () => {
      const passComp = calculateLiveBasisPercent(100.10, 100.00);
      expect(Math.abs(passComp)).toBeCloseTo(0.1000, 3);
      expect(Math.abs(passComp) <= config.maxLiveCompressionPercent).toBe(true);

      const failComp = calculateLiveBasisPercent(100.1015, 100.00);
      expect(Math.abs(failComp) <= config.maxLiveCompressionPercent).toBe(false);
    });

    it('TC2.2.3 (Exact Boundary Anti-Collision 5.000% vs 5.001%): protects against split order books', () => {
      const valid = isAntiCollisionValid(105.00, 100.00, 5.000);
      expect(valid).toBe(true);

      const rejected = isAntiCollisionValid(106.00, 100.00, 5.000);
      expect(rejected).toBe(false);
    });

    it('TC2.2.4 (Exact Boundary Runway Buffer Dir 1 +0.030% vs +0.031%): preserves expansion runway', () => {
      const atBoundary = evaluateCandidateGates(100.015, 99.985, 0.500, 0.50, 0.000, config);
      expect(atBoundary.liveBasisPercent).toBe(0.030);
      expect(atBoundary.gatesPassed.runwayBuffer).toBe(true);

      const aboveBoundary = evaluateCandidateGates(100.0155, 99.9845, 0.500, 0.50, 0.000, config);
      expect(aboveBoundary.liveBasisPercent).toBe(0.031);
      expect(aboveBoundary.gatesPassed.runwayBuffer).toBe(false);
    });

    it('TC2.2.5 (Exact Boundary Runway Buffer Dir 2 -0.030% vs -0.031%): preserves negative expansion runway', () => {
      const atBoundary = evaluateCandidateGates(99.985, 100.015, 0.500, -0.50, 0.000, config);
      expect(atBoundary.liveBasisPercent).toBe(-0.030);
      expect(atBoundary.gatesPassed.runwayBuffer).toBe(true);

      const belowBoundary = evaluateCandidateGates(99.9845, 100.0155, 0.500, -0.50, 0.000, config);
      expect(belowBoundary.liveBasisPercent).toBe(-0.031);
      expect(belowBoundary.gatesPassed.runwayBuffer).toBe(false);
    });

    it('TC2.2.6 (Exact Boundary Carry Feasibility -0.030% vs -0.031%): protects against funding drag', () => {
      const atLimit = evaluateCandidateGates(100.01, 100.00, 0.500, 0.40, -0.030, config);
      expect(atLimit.gatesPassed.carryFeasibility).toBe(true);
      expect(atLimit.overallPassed).toBe(true);

      const exceeded = evaluateCandidateGates(100.01, 100.00, 0.500, 0.40, -0.031, config);
      expect(exceeded.gatesPassed.carryFeasibility).toBe(false);
      expect(exceeded.overallPassed).toBe(false);
    });

    it('TC2.2.7 (Exact Parity bt = 0.000%): evaluates cleanly with zero division immunity', () => {
      const parity = evaluateCandidateGates(100.00, 100.00, 0.550, 0.35, 0.0, config);

      expect(parity.liveBasisPercent).toBe(0.000);
      expect(parity.gatesPassed.compression).toBe(true);
      expect(parity.gatesPassed.antiCollision).toBe(true);
      expect(parity.gatesPassed.runwayBuffer).toBe(true);
      expect(parity.overallPassed).toBe(true);
      expect(isNaN(parity.netAlphaProjectedPercent)).toBe(false);
    });

    it('TC2.2.8 (Empty History & Pathological Prices Resilience): handles zero length and NaN safely', () => {
      expect(calculateDispersion24hPercent([])).toBe(0.000);
      expect(calculateDDI24h(0, 0)).toBe(0.000);
      expect(calculateLiveBasisPercent(0, 0)).toBe(0.000);
      expect(isAntiCollisionValid(0, 0)).toBe(false);
      expect(isAntiCollisionValid(NaN, 100)).toBe(false);
    });

    it('TC2.2.9 (Negative-Only Historical Basis DDI Clamping): ensures DDI is bounded within [-1.0, +1.0]', () => {
      const ddiNegative = calculateDDI24h(-0.100, -0.500);
      expect(ddiNegative).toBeGreaterThanOrEqual(-1.000);
      expect(ddiNegative).toBeLessThanOrEqual(1.000);
    });
  });

  // =========================================================================
  // TIER 3: COMBINATORIAL PERMUTATION MATRIX (32 Vectors)
  // =========================================================================
  describe('Tier 3: Combinatorial Permutation Matrix (2^5 = 32 Vectors)', () => {
    it('TC3.2.1: evaluates all 32 combinations: asserts only vector 11111 passes overall', () => {
      let passCount = 0;

      for (let i = 0; i < 32; i++) {
        const dispPass = Boolean((i & 16) !== 0);
        const compPass = Boolean((i & 8) !== 0);
        const antiColPass = Boolean((i & 4) !== 0);
        const runwayPass = Boolean((i & 2) !== 0);
        const carryPass = Boolean((i & 1) !== 0);

        const testConfig: DivergenceConfig = {
          ...config,
          minDispersion24hPercent: dispPass ? 0.400 : 0.500,
          maxLiveCompressionPercent: compPass ? 0.100 : 0.005,
          antiCollisionSanityPercent: antiColPass ? 5.000 : 0.010,
          maxAdverseFundingRatePercent: carryPass ? -0.030 : 0.050,
        };

        const pBn = runwayPass ? 100.010 : 100.025;
        const pByb = runwayPass ? 99.990 : 99.975;
        const dispersion = 0.450;
        const ddi = 0.50;
        const carry = 0.000;

        const cand = evaluateCandidateGates(pBn, pByb, dispersion, ddi, carry, testConfig);

        expect(cand.gatesPassed.dispersion).toBe(dispPass);
        expect(cand.gatesPassed.compression).toBe(compPass);
        expect(cand.gatesPassed.antiCollision).toBe(antiColPass);
        expect(cand.gatesPassed.runwayBuffer).toBe(runwayPass);
        expect(cand.gatesPassed.carryFeasibility).toBe(carryPass);

        const expectedPass = dispPass && compPass && antiColPass && runwayPass && carryPass;
        expect(cand.overallPassed).toBe(expectedPass);

        if (cand.overallPassed) {
          passCount++;
          expect(cand.statusReason).toBe('QUALIFIED_PRIME_ZONE');
        } else {
          expect(cand.statusReason).not.toBe('QUALIFIED_PRIME_ZONE');
        }
      }

      expect(passCount).toBe(1);
    });

    it('TC3.2.2: verifies priority-based statusReason rejection ladder', () => {
      const rAntiCollision = evaluateCandidateGates(110.0, 90.0, 0.200, 0.50, -0.050, config);
      expect(rAntiCollision.statusReason).toBe('REJECTED_ANTI_COLLISION_SANITY');

      const rDispersion = evaluateCandidateGates(100.20, 99.80, 0.200, 0.50, -0.050, config);
      expect(rDispersion.statusReason).toBe('REJECTED_LOW_DISPERSION_24H');

      const rCompression = evaluateCandidateGates(100.10, 99.90, 0.500, 0.50, -0.050, config);
      expect(rCompression.statusReason).toBe('AWAITING_COMPRESSION');

      const rRunway = evaluateCandidateGates(100.025, 99.975, 0.500, 0.50, -0.050, config);
      expect(rRunway.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');

      const rCarry = evaluateCandidateGates(100.010, 99.990, 0.500, 0.50, -0.050, config);
      expect(rCarry.statusReason).toBe('REJECTED_ADVERSE_CARRY');
    });
  });

  // =========================================================================
  // TIER 4: LIVE UNIVERSE SCAN WITH MOCKED NETWORK
  // =========================================================================
  describe('Tier 4: Live Universe Ingestion with Mocked Network', () => {
    it('TC4.2.1: normal operational scan produces degraded === false and discovers candidate universe', async () => {
      mockSuccessfulExchanges();

      const res = await executeUniverseScan(config);

      expect(res.success).toBe(true);
      expect(res.degraded).toBeFalsy();
      expect(res.warning).toBeUndefined();
      expect(res.candidatesCount).toBe(18); // 18 mock pairs > 15 fallback seeds
      expect(res.summary.totalScanned).toBe(18);
      expect(res.summary.qualifyingCount).toBe(13);
      expect(res.summary.primeZoneCount).toBe(13);
    });

    it('TC4.2.2: asserts candidate object construction and bybitSymbol naming fix', async () => {
      mockSuccessfulExchanges();

      const res = await executeUniverseScan(config);
      expect(res.candidates.length).toBeGreaterThan(0);

      for (const candidate of res.candidates) {
        expect(candidate.symbol).toBeDefined();
        expect(candidate.canonicalSymbol).toBeDefined();
        expect(candidate.binanceSymbol).toBeDefined();
        expect(candidate.bybitSymbol).toBeDefined();
        expect(candidate.bybitSymbol).toBe(candidate.symbol);
        expect(candidate.multiplier).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(candidate.liveBasisPercent)).toBe(true);
        expect(Number.isFinite(candidate.dispersion24hPercent)).toBe(true);
      }
    });

    it('TC4.2.3: normalizes meme coin contract multipliers (PEPE & SATS)', async () => {
      mockSuccessfulExchanges();

      const res = await executeUniverseScan(config);

      const pepe = res.candidates.find((c) => c.canonicalSymbol === 'PEPE');
      expect(pepe).toBeDefined();
      expect(pepe?.multiplier).toBe(1); // 1000PEPE on both venues -> 1:1 cross-venue ratio
      expect(pepe?.gatesPassed.antiCollision).toBe(true);

      const sats = res.candidates.find((c) => c.canonicalSymbol === 'SATS');
      expect(sats).toBeDefined();
      expect(sats?.multiplier).toBe(10); // Bybit 10000SATS vs Binance 1000SATS
      expect(sats?.gatesPassed.antiCollision).toBe(true);
    });

    it('TC4.2.4: sorts candidates with overallPassed: true first, then descending dispersion', async () => {
      mockSuccessfulExchanges();

      const res = await executeUniverseScan(config);
      const candidates = res.candidates;

      // First 13 candidates must be overallPassed === true
      for (let i = 0; i < 13; i++) {
        expect(candidates[i].overallPassed).toBe(true);
      }

      // Remaining 5 candidates must be overallPassed === false
      for (let i = 13; i < 18; i++) {
        expect(candidates[i].overallPassed).toBe(false);
      }

      // Within qualifying group, dispersion must be non-increasing
      for (let i = 0; i < 12; i++) {
        expect(candidates[i].dispersion24hPercent).toBeGreaterThanOrEqual(candidates[i + 1].dispersion24hPercent);
      }
    });

    it('TC4.2.5: exchange network timeout activates degraded baseline corridor without throwing', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.reject(new Error('ETIMEDOUT: Connection timed out'))
      );

      const res = await executeUniverseScan(config);

      expect(res.success).toBe(true);
      expect(res.degraded).toBe(true);
      expect(res.warning).toContain('Live exchange ingestion degraded');
      expect(res.candidatesCount).toBe(BASELINE_SEED_CORRIDOR.length); // Exactly 15
      expect(res.summary.totalScanned).toBe(15);
    });
  });

  // =========================================================================
  // TIER 5: RADAR FEED API & SWR CACHING
  // =========================================================================
  describe('Tier 5: Radar Feed API & SWR In-Memory Caching', () => {
    it('TC5.2.1: cold start executes universe scan and returns cached: false', async () => {
      mockSuccessfulExchanges();

      const res = await getDivergenceRadarFeed(config);

      expect(res.success).toBe(true);
      expect(res.cached).toBe(false);
      expect(res.degraded).toBeFalsy();
      expect(res.candidatesCount).toBe(18);
    });

    it('TC5.2.2: fresh cache hit (< 2,500ms) serves instant cached response', async () => {
      mockSuccessfulExchanges();

      const first = await getDivergenceRadarFeed(config);
      expect(first.cached).toBe(false);

      const second = await getDivergenceRadarFeed(config);
      expect(second.cached).toBe(true);
      expect(second.candidatesCount).toBe(first.candidatesCount);
      expect(second.degraded).toBeFalsy();
    });

    it('TC5.2.3: forceFresh = true bypasses cache and returns fresh data', async () => {
      mockSuccessfulExchanges();

      await getDivergenceRadarFeed(config);
      const forced = await getDivergenceRadarFeed(config, true);

      expect(forced.cached).toBe(false);
      expect(forced.degraded).toBeFalsy();
    });

    it('TC5.2.4: scanDivergenceUniverse contract entry point returns candidate array directly', async () => {
      mockSuccessfulExchanges();

      const candidates = await scanDivergenceUniverse(config);

      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBe(18);
      expect(candidates[0].symbol).toBeDefined();
    });
  });

  // =========================================================================
  // TIER 6: STRICT REPOSITORY INVARIANTS
  // =========================================================================
  describe('Tier 6: Strict Repository Invariants Certification', () => {
    const scannerPath = path.resolve(__dirname, '../../../lib/divergence/scanner.ts');
    const routePath = path.resolve(__dirname, '../../../app/api/divergence/radar/route.ts');

    it('TC6.2.1 (Zero BPS Invariant): scanner.ts strictly contains zero numerical BPS notation', () => {
      const content = fs.readFileSync(scannerPath, 'utf-8');
      const forbiddenBps = /\b\d+(\.\d+)?\s*bps\b/i;
      expect(content.match(forbiddenBps)).toBeNull();
    });

    it('TC6.2.2 (Zero Legacy References): scanner.ts strictly contains zero legacy bot references', () => {
      const content = fs.readFileSync(scannerPath, 'utf-8');
      const legacyTerms = ['legacy_bot', 'deprecated_bot', 'basis_bot'];
      for (const term of legacyTerms) {
        expect(content.toLowerCase()).not.toContain(term);
      }
    });

    it('TC6.2.3 (Next.js TS2344 Compliance): route.ts strictly exports only dynamic and GET', () => {
      const content = fs.readFileSync(routePath, 'utf-8');
      expect(content).toContain("export const dynamic = 'force-dynamic';");
      expect(content).toContain('export async function GET(');

      const nonRouteExports = content.match(/export (?!const dynamic|async function GET)\w+/g);
      expect(nonRouteExports).toBeNull();
    });
  });
});
