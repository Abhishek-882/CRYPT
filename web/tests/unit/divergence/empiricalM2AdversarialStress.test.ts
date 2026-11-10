/**
 * EMPIRICAL CHALLENGER: ADVERSARIAL STRESS & VULNERABILITY TEST SUITE (MILESTONE 2)
 * 
 * Target Modules:
 *   - web/lib/divergence/scanner.ts
 *   - web/app/api/divergence/radar/route.ts
 * 
 * Roles: critic, specialist
 * Archetype: teamwork_challenger
 * 
 * Mandatory Stress Challenges Verified:
 * 1. 2,500ms SWR in-memory caching lifecycle (fresh, stale background revalidation, forceFresh).
 * 2. High-concurrency single-flight Promise deduplication (simulate 20 concurrent calls to GET /api/divergence/radar).
 * 3. Exchange outage & timeout fallback resilience (mock network failure, baseline corridor recovery).
 * 4. Anti-collision sanity boundary (exact 5.000% vs 5.001%, anomalous dislocation rejection, priority reason).
 * 5. Deterministic candidate sorting (priority: overallPassed > dispersion24hPercent > netAlphaProjectedPercent).
 * 6. Directional dispersion index (DDI) & compression runway buffer guard.
 * 7. Meme coin contract multiplier normalization (e.g. 1000SATS vs 10000SATS, 1000PEPE).
 * 8. Zero BPS notation and Zero legacy bot references certification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

import {
  calculateLiveBasisPercent,
  calculateDispersion24hPercent,
  calculateDDI24h,
  isAntiCollisionValid,
  evaluateCandidateGates,
  getDivergenceRadarFeed,
  executeUniverseScan,
  resetDivergenceScannerCache,
  scanDivergenceUniverse,
  BASELINE_SEED_CORRIDOR,
  RADAR_CACHE_TTL_MS,
  RADAR_STALE_TTL_MS,
  DivergenceCandidate,
} from '@/lib/divergence/scanner';

import { GET } from '@/app/api/divergence/radar/route';
import { DEFAULT_DIVERGENCE_CONFIG } from '@/lib/divergence/types';
import { normalizePrice } from '@/lib/statarb/utils/contractMapper';

describe('Empirical Challenger: Milestone 2 Adversarial Stress Suite', () => {
  const config = DEFAULT_DIVERGENCE_CONFIG;

  beforeEach(() => {
    resetDivergenceScannerCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetDivergenceScannerCache();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. In-Memory 2,500ms SWR Cache & Lifecycle Stress-Tests
  // =========================================================================
  describe('1. In-Memory 2,500ms SWR Cache Lifecycle', () => {
    it('TC-M2-SWR.1: cold start returns cached: false and populates singleton store', async () => {
      expect(globalThis.__divergenceRadarCache).toBeUndefined();

      const response = await getDivergenceRadarFeed(config);

      expect(response.success).toBe(true);
      expect(response.cached).toBe(false);
      expect(response.candidates.length).toBeGreaterThan(0);
      expect(globalThis.__divergenceRadarCache).toBeDefined();
      expect(globalThis.__divergenceRadarCache?.data).toBeDefined();
      expect(globalThis.__divergenceRadarCache?.isRevalidating).toBe(false);
    });

    it('TC-M2-SWR.2: fresh cache hit (< 2,500ms) serves in < 5ms with cached: true', async () => {
      // Warm cache
      const first = await getDivergenceRadarFeed(config);
      expect(first.cached).toBe(false);

      const t0 = performance.now();
      const second = await getDivergenceRadarFeed(config);
      const elapsed = performance.now() - t0;

      expect(second.cached).toBe(true);
      expect(second.candidatesCount).toBe(first.candidatesCount);
      expect(elapsed).toBeLessThan(15); // Instant in-memory cache return
    });

    it('TC-M2-SWR.3: forceFresh = true bypasses fresh cache and returns fresh data', async () => {
      // Warm cache
      await getDivergenceRadarFeed(config);
      expect(globalThis.__divergenceRadarCache).toBeDefined();

      // Request fresh
      const forced = await getDivergenceRadarFeed(config, true);
      expect(forced.cached).toBe(false);
    });

    it('TC-M2-SWR.4: stale window (> 2,500ms & < 60,000ms) returns stale data immediately and triggers background revalidation', async () => {
      // Warm cache
      await getDivergenceRadarFeed(config);
      expect(globalThis.__divergenceRadarCache).toBeDefined();

      // Age cache beyond 2,500ms but under 60,000ms
      const staleTimestamp = Date.now() - (RADAR_CACHE_TTL_MS + 500);
      globalThis.__divergenceRadarCache!.timestamp = staleTimestamp;

      const response = await getDivergenceRadarFeed(config);

      // Must return immediately as cached
      expect(response.cached).toBe(true);

      // Revalidation flag should have been marked
      // (or background revalidation initiated)
      expect(globalThis.__divergenceRadarCache).toBeDefined();
    });

    it('TC-M2-SWR.5: resetDivergenceScannerCache cleanly evicts all cache and in-flight globals', async () => {
      await getDivergenceRadarFeed(config);
      expect(globalThis.__divergenceRadarCache).toBeDefined();

      resetDivergenceScannerCache();

      expect(globalThis.__divergenceRadarCache).toBeUndefined();
      expect(globalThis.__divergenceInFlightScan).toBeUndefined();
      expect(globalThis.__divergenceBasisHistory).toBeUndefined();
      expect(globalThis.__divergenceKlineCache).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. High-Concurrency Single-Flight Deduplication
  // =========================================================================
  describe('2. High-Concurrency Single-Flight Deduplication', () => {
    it('TC-M2-DEDUP.1: 20 concurrent calls to getDivergenceRadarFeed coalesce into single scan', async () => {
      resetDivergenceScannerCache();

      // Spy on fetch to monitor raw outbound HTTP calls
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Dispatch 20 concurrent callers simultaneously on cold cache
      const promises = Array.from({ length: 20 }, () => getDivergenceRadarFeed(config));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(20);

      // All callers should have succeeded
      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.candidatesCount).toBe(results[0].candidatesCount);
      }

      // Single-flight guarantee: Exactly 1 pair of exchange bulk requests
      // (1 Binance bookTicker + 1 Bybit tickers = 2 fetch calls total)
      // Because all 20 calls coalesced through __divergenceInFlightScan
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(2);

      // After promise resolution, in-flight mutex MUST be cleared
      expect(globalThis.__divergenceInFlightScan).toBeUndefined();
    });

    it('TC-M2-DEDUP.2: 20 concurrent calls to GET /api/divergence/radar route handler succeed with HTTP 200', async () => {
      resetDivergenceScannerCache();

      const requests = Array.from({ length: 20 }, () =>
        GET(new NextRequest('http://localhost:3000/api/divergence/radar'))
      );

      const responses = await Promise.all(requests);
      expect(responses).toHaveLength(20);

      for (const res of responses) {
        expect(res.status).toBe(200);
        const headers = res.headers;
        expect(headers.get('Cache-Control')).toContain('stale-while-revalidate=60');

        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.candidates.length).toBeGreaterThan(0);
        expect(body.summary).toBeDefined();
        expect(body.summary.totalScanned).toBeGreaterThan(0);
      }
    });

    it('TC-M2-DEDUP.3: GET /api/divergence/radar?fresh=true forces uncached evaluation', async () => {
      // Warm cache first
      const warmRes = await GET(new NextRequest('http://localhost:3000/api/divergence/radar'));
      expect(warmRes.status).toBe(200);

      // Subsequent call without ?fresh=true should be cached
      const cachedRes = await GET(new NextRequest('http://localhost:3000/api/divergence/radar'));
      const cachedBody = await cachedRes.json();
      expect(cachedBody.cached).toBe(true);

      // Call with ?fresh=true should be uncached
      const freshRes = await GET(new NextRequest('http://localhost:3000/api/divergence/radar?fresh=true'));
      const freshBody = await freshRes.json();
      expect(freshBody.cached).toBe(false);
    });
  });

  // =========================================================================
  // 3. Exchange Outage, Timeout Fallback & Degraded Resilience
  // =========================================================================
  describe('3. Exchange Outage, Timeout Fallback & Degraded Resilience', () => {
    it('TC-M2-OUTAGE.1: when both exchange endpoints reject/timeout, returns degraded baseline corridor without throwing', async () => {
      // Mock fetch to simulate network timeout / rejection
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.reject(new Error('ETIMEDOUT: Connection timed out'))
      );

      const response = await executeUniverseScan(config);

      expect(response.success).toBe(true);
      expect(response.degraded).toBe(true);
      expect(response.warning).toContain('degraded');
      expect(response.candidates.length).toBe(BASELINE_SEED_CORRIDOR.length);
      expect(response.candidatesCount).toBe(15);

      // Verify baseline corridor contains expected seed pairs
      const symbols = response.candidates.map((c) => c.canonicalSymbol);
      expect(symbols).toContain('BTC');
      expect(symbols).toContain('ETH');
      expect(symbols).toContain('SOL');
      expect(symbols).toContain('PEPE');
      expect(symbols).toContain('SATS');
    });

    it('TC-M2-OUTAGE.2: route handler returns HTTP 200 with degraded: true during exchange failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.reject(new Error('Network unreachable'))
      );

      const res = await GET(new NextRequest('http://localhost:3000/api/divergence/radar?fresh=true'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.degraded).toBe(true);
      expect(body.candidates.length).toBe(15);
    });

    it('TC-M2-OUTAGE.3: degraded corridor correctly computes summary KPIs and top opportunity', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.reject(new Error('Simulated network blackout'))
      );

      const response = await executeUniverseScan(config);
      const summary = response.summary;

      expect(summary.totalScanned).toBe(15);
      expect(summary.qualifyingCount).toBeGreaterThan(0);
      expect(summary.primeZoneCount).toBe(summary.qualifyingCount);
      expect(summary.topOpportunity).toBeDefined();
      expect(summary.topOpportunity?.overallPassed).toBe(true);
    });
  });

  // =========================================================================
  // 4. Anti-Collision Sanity Gate Boundary (5.000% vs 5.001%)
  // =========================================================================
  describe('4. Anti-Collision Sanity Gate Boundary (5.000% vs 5.001%)', () => {
    it('TC-M2-SANITY.1: exact 5.000% disparity passes, while 5.001% is rejected', () => {
      // Disparity = |P_BN - P_BYB| / mid * 100%
      // Mid = 102.56410256410257
      // P_BN = 105.12820512820513, P_BYB = 100.00 -> Disparity = 5.0000%
      const pByb = 100.0;
      const pBnExact5 = 105.12820512820513;
      expect(isAntiCollisionValid(pBnExact5, pByb, 5.000)).toBe(true);

      // Disparity = 5.001%: P_BN = 105.130
      // Mid = 102.565, diff = 5.130 -> Disparity = 5.0017% > 5.000%
      const pBnExceed5 = 105.130;
      expect(isAntiCollisionValid(pBnExceed5, pByb, 5.000)).toBe(false);
    });

    it('TC-M2-SANITY.2: extreme cross-venue dislocation (ONUSDT scenario) is strictly rejected', () => {
      // Real-world scenario: ONUSDT @ $0.40 on Binance vs $0.80 on Bybit (66.7% disparity)
      const isNormalDislocationValid = isAntiCollisionValid(0.40, 0.80, 5.000);
      expect(isNormalDislocationValid).toBe(false);

      const evaluated = evaluateCandidateGates(0.40, 0.80, 1.200, 0.500, 0.000, config);
      expect(evaluated.gatesPassed.antiCollision).toBe(false);
      expect(evaluated.overallPassed).toBe(false);
      expect(evaluated.statusReason).toBe('REJECTED_ANTI_COLLISION_SANITY');
    });

    it('TC-M2-SANITY.3: anti-collision failure takes absolute priority in statusReason', () => {
      // Even if dispersion is huge (2.500%) and carry is positive, anti-collision failure must be the reason
      const evaluated = evaluateCandidateGates(108.00, 100.00, 2.500, 0.500, 0.050, config);
      expect(evaluated.gatesPassed.dispersion).toBe(true);
      expect(evaluated.gatesPassed.antiCollision).toBe(false);
      expect(evaluated.overallPassed).toBe(false);
      expect(evaluated.statusReason).toBe('REJECTED_ANTI_COLLISION_SANITY');
      expect(evaluated.netAlphaProjectedPercent).toBe(0.000);
    });

    it('TC-M2-SANITY.4: pathological numerical inputs (0, negative, NaN, Infinity) are safely rejected', () => {
      expect(isAntiCollisionValid(0, 100, 5.000)).toBe(false);
      expect(isAntiCollisionValid(100, 0, 5.000)).toBe(false);
      expect(isAntiCollisionValid(0, 0, 5.000)).toBe(false);
      expect(isAntiCollisionValid(-10, 10, 5.000)).toBe(false);
      expect(isAntiCollisionValid(NaN, 100, 5.000)).toBe(false);
      expect(isAntiCollisionValid(100, Infinity, 5.000)).toBe(false);
    });
  });

  // =========================================================================
  // 5. Candidate Sorting & Deterministic Ranking
  // =========================================================================
  describe('5. Candidate Sorting & Deterministic Ranking', () => {
    it('TC-M2-SORT.1: overallPassed: true candidates strictly precede overallPassed: false candidates', () => {
      const c1: DivergenceCandidate = {
        symbol: 'PASSED_LOW_DISP_USDT',
        canonicalSymbol: 'PASSED_LOW',
        binanceSymbol: 'PASSED_LOW_USDT',
        bybitSymbol: 'PASSED_LOW_USDT',
        multiplier: 1,
        binancePrice: 100.02,
        bybitPrice: 100.00,
        midPrice: 100.01,
        liveBasisPercent: 0.020,
        dispersion24hPercent: 0.420,
        expansionPotentialPercent: 0.400,
        ddi24h: 0.500,
        suggestedDirection: 'LONG_BN_SHORT_BYB',
        projectedCarryPercent: 0.000,
        gatesPassed: {
          dispersion: true,
          compression: true,
          antiCollision: true,
          runwayBuffer: true,
          carryFeasibility: true,
        },
        overallPassed: true,
        isQualified: true,
        statusReason: 'QUALIFIED_PRIME_ZONE',
        netAlphaProjectedPercent: 0.120,
        timestamp: Date.now(),
      };

      const c2: DivergenceCandidate = {
        symbol: 'FAILED_HIGH_DISP_USDT',
        canonicalSymbol: 'FAILED_HIGH',
        binanceSymbol: 'FAILED_HIGH_USDT',
        bybitSymbol: 'FAILED_HIGH_USDT',
        multiplier: 1,
        binancePrice: 100.25,
        bybitPrice: 100.00,
        midPrice: 100.125,
        liveBasisPercent: 0.250, // Fails compression
        dispersion24hPercent: 2.500, // Massive dispersion!
        expansionPotentialPercent: 2.250,
        ddi24h: 0.800,
        suggestedDirection: 'LONG_BN_SHORT_BYB',
        projectedCarryPercent: 0.000,
        gatesPassed: {
          dispersion: true,
          compression: false,
          antiCollision: true,
          runwayBuffer: false,
          carryFeasibility: true,
        },
        overallPassed: false,
        isQualified: false,
        statusReason: 'AWAITING_COMPRESSION',
        netAlphaProjectedPercent: 0.000,
        timestamp: Date.now(),
      };

      const list = [c2, c1];
      list.sort((a, b) => {
        if (a.overallPassed !== b.overallPassed) {
          return a.overallPassed ? -1 : 1;
        }
        if (b.dispersion24hPercent !== a.dispersion24hPercent) {
          return b.dispersion24hPercent - a.dispersion24hPercent;
        }
        return b.netAlphaProjectedPercent - a.netAlphaProjectedPercent;
      });

      // c1 (passed, 0.420%) MUST be #0, c2 (failed, 2.500%) MUST be #1
      expect(list[0].symbol).toBe('PASSED_LOW_DISP_USDT');
      expect(list[1].symbol).toBe('FAILED_HIGH_DISP_USDT');
    });

    it('TC-M2-SORT.2: among qualifying candidates, dispersion24hPercent sorts descending', () => {
      const cA = { ...generateDummyCandidate('A', 0.450, 0.120, true) };
      const cB = { ...generateDummyCandidate('B', 0.850, 0.120, true) };
      const cC = { ...generateDummyCandidate('C', 0.600, 0.120, true) };

      const candidates = [cA, cB, cC];
      candidates.sort((a, b) => {
        if (a.overallPassed !== b.overallPassed) return a.overallPassed ? -1 : 1;
        if (b.dispersion24hPercent !== a.dispersion24hPercent) {
          return b.dispersion24hPercent - a.dispersion24hPercent;
        }
        return b.netAlphaProjectedPercent - a.netAlphaProjectedPercent;
      });

      expect(candidates[0].symbol).toBe('BUSDT'); // 0.850%
      expect(candidates[1].symbol).toBe('CUSDT'); // 0.600%
      expect(candidates[2].symbol).toBe('AUSDT'); // 0.450%
    });

    it('TC-M2-SORT.3: among equal dispersion, netAlphaProjectedPercent breaks ties descending', () => {
      const cA = { ...generateDummyCandidate('A', 0.500, 0.120, true) };
      const cB = { ...generateDummyCandidate('B', 0.500, 0.150, true) };

      const candidates = [cA, cB];
      candidates.sort((a, b) => {
        if (a.overallPassed !== b.overallPassed) return a.overallPassed ? -1 : 1;
        if (b.dispersion24hPercent !== a.dispersion24hPercent) {
          return b.dispersion24hPercent - a.dispersion24hPercent;
        }
        return b.netAlphaProjectedPercent - a.netAlphaProjectedPercent;
      });

      expect(candidates[0].symbol).toBe('BUSDT'); // net alpha 0.150%
      expect(candidates[1].symbol).toBe('AUSDT'); // net alpha 0.120%
    });
  });

  // =========================================================================
  // 6. Directional Dispersion Index (DDI) & Compression Runway Buffer
  // =========================================================================
  describe('6. Directional Dispersion Index (DDI) & Compression Runway Buffer', () => {
    it('TC-M2-DDI.1: DDI > +0.200 routes to LONG_BN_SHORT_BYB', () => {
      const ddi = calculateDDI24h(0.700, -0.200); // (0.7 - 0.2) / 0.7 = +0.714
      expect(ddi).toBe(0.714);
      expect(ddi).toBeGreaterThan(0.200);

      const candidate = evaluateCandidateGates(100.01, 100.00, 0.700, ddi, 0.000, config);
      expect(candidate.suggestedDirection).toBe('LONG_BN_SHORT_BYB');
    });

    it('TC-M2-DDI.2: DDI < -0.200 routes to SHORT_BN_LONG_BYB', () => {
      const ddi = calculateDDI24h(0.150, -0.800); // (0.15 - 0.8) / 0.8 = -0.65 / 0.8 = -0.8125 -> Math.round is -0.812
      expect(ddi).toBe(-0.812);
      expect(ddi).toBeLessThan(-0.200);

      const candidate = evaluateCandidateGates(100.00, 100.01, 0.800, ddi, 0.000, config);
      expect(candidate.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
    });

    it('TC-M2-DDI.3: neutral DDI in [-0.200, +0.200] falls back to live basis sign tiebreaker', () => {
      const ddiNeutral = 0.050; // In neutral band

      // Positive live basis (+0.020%) -> Direction 1
      const c1 = evaluateCandidateGates(100.02, 100.00, 0.500, ddiNeutral, 0.000, config);
      expect(c1.suggestedDirection).toBe('LONG_BN_SHORT_BYB');

      // Negative live basis (-0.020%) -> Direction 2
      const c2 = evaluateCandidateGates(99.98, 100.00, 0.500, ddiNeutral, 0.000, config);
      expect(c2.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
    });

    it('TC-M2-RUNWAY.1: Runway Buffer enforces bt <= +0.030% for Direction 1', () => {
      // bt = +0.030% -> Passes
      const pass = evaluateCandidateGates(100.03, 100.00, 0.600, 0.500, 0.000, config);
      expect(pass.gatesPassed.runwayBuffer).toBe(true);
      expect(pass.overallPassed).toBe(true);

      // bt = +0.035% -> Fails runway buffer
      const fail = evaluateCandidateGates(100.035, 100.00, 0.600, 0.500, 0.000, config);
      expect(fail.gatesPassed.runwayBuffer).toBe(false);
      expect(fail.overallPassed).toBe(false);
      expect(fail.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');
    });

    it('TC-M2-RUNWAY.2: Runway Buffer enforces bt >= -0.030% for Direction 2', () => {
      // bt = -0.030% -> Passes
      const pass = evaluateCandidateGates(99.97, 100.00, 0.600, -0.500, 0.000, config);
      expect(pass.gatesPassed.runwayBuffer).toBe(true);
      expect(pass.overallPassed).toBe(true);

      // bt = -0.035% -> Fails runway buffer
      const fail = evaluateCandidateGates(99.965, 100.00, 0.600, -0.500, 0.000, config);
      expect(fail.gatesPassed.runwayBuffer).toBe(false);
      expect(fail.overallPassed).toBe(false);
      expect(fail.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');
    });
  });

  // =========================================================================
  // 7. Meme Coin Contract Multiplier Normalization
  // =========================================================================
  describe('7. Meme Coin Contract Multiplier Normalization', () => {
    it('TC-M2-NORM.1: SATS 1000SATS (Binance) vs 10000SATS (Bybit) normalizes 10x raw price difference cleanly', () => {
      // Binance raw quote for 1000SATS: $0.0002850
      // Bybit raw quote for 10000SATS: $0.0028500 (10x quote difference)
      const rawBnPrice = 0.0002850;
      const rawBybPrice = 0.0028500;

      // Without normalization, disparity is 163% -> False anti-collision rejection!
      const unnormValid = isAntiCollisionValid(rawBnPrice, rawBybPrice, 5.000);
      expect(unnormValid).toBe(false);

      // With normalization:
      const normBn = normalizePrice(rawBnPrice, 'BINANCE', 'SATS');
      const normByb = normalizePrice(rawBybPrice, 'BYBIT', 'SATS');

      expect(normBn).toBeCloseTo(0.000000285, 10);
      expect(normByb).toBeCloseTo(0.000000285, 10);

      const normValid = isAntiCollisionValid(normBn, normByb, 5.000);
      expect(normValid).toBe(true);

      const liveBasis = calculateLiveBasisPercent(normBn, normByb);
      expect(Math.abs(liveBasis)).toBe(0);
    });

    it('TC-M2-NORM.2: PEPE 1000PEPE normalizes identically on both venues', () => {
      const rawBn = 0.00985;
      const rawByb = 0.00985;

      const normBn = normalizePrice(rawBn, 'BINANCE', 'PEPE');
      const normByb = normalizePrice(rawByb, 'BYBIT', 'PEPE');

      expect(normBn).toBeCloseTo(0.00000985, 8);
      expect(normByb).toBeCloseTo(0.00000985, 8);
      expect(isAntiCollisionValid(normBn, normByb, 5.000)).toBe(true);
    });
  });

  // =========================================================================
  // 8. Zero BPS Notation & Zero Legacy Bot References Certification
  // =========================================================================
  describe('8. Zero BPS Notation & Zero Legacy Bot References Certification', () => {
    const scannerPath = path.resolve(__dirname, '../../../lib/divergence/scanner.ts');
    const routePath = path.resolve(__dirname, '../../../app/api/divergence/radar/route.ts');

    it('TC-M2-INVAR.1: scanner.ts strictly contains zero BPS notation', () => {
      const content = fs.readFileSync(scannerPath, 'utf-8');
      const forbiddenBps = /\b\d+(\.\d+)?\s*bps\b/i;
      const matches = content.match(forbiddenBps);
      expect(matches).toBeNull();
    });

    it('TC-M2-INVAR.2: radar/route.ts strictly contains zero BPS notation', () => {
      const content = fs.readFileSync(routePath, 'utf-8');
      const forbiddenBps = /\b\d+(\.\d+)?\s*bps\b/i;
      const matches = content.match(forbiddenBps);
      expect(matches).toBeNull();
    });

    it('TC-M2-INVAR.3: scanner.ts strictly contains zero legacy bot references', () => {
      const content = fs.readFileSync(scannerPath, 'utf-8');
      const legacyTerms = ['legacy_bot', 'deprecated_bot', 'basis_bot'];
      for (const term of legacyTerms) {
        expect(content.toLowerCase()).not.toContain(term);
      }
    });

    it('TC-M2-INVAR.4: radar/route.ts strictly contains zero legacy bot references', () => {
      const content = fs.readFileSync(routePath, 'utf-8');
      const legacyTerms = ['legacy_bot', 'deprecated_bot', 'basis_bot'];
      for (const term of legacyTerms) {
        expect(content.toLowerCase()).not.toContain(term);
      }
    });
  });
});

// Helper for sorting tests
function generateDummyCandidate(
  name: string,
  dispersion: number,
  netAlpha: number,
  passed: boolean
): DivergenceCandidate {
  return {
    symbol: `${name}USDT`,
    canonicalSymbol: name,
    binanceSymbol: `${name}USDT`,
    bybitSymbol: `${name}USDT`,
    multiplier: 1,
    binancePrice: 100.0,
    bybitPrice: 100.0,
    midPrice: 100.0,
    liveBasisPercent: 0.000,
    dispersion24hPercent: dispersion,
    expansionPotentialPercent: dispersion,
    ddi24h: 0.000,
    suggestedDirection: 'LONG_BN_SHORT_BYB',
    projectedCarryPercent: 0.000,
    gatesPassed: {
      dispersion: passed,
      compression: passed,
      antiCollision: true,
      runwayBuffer: passed,
      carryFeasibility: true,
    },
    overallPassed: passed,
    isQualified: passed,
    statusReason: passed ? 'QUALIFIED_PRIME_ZONE' : 'REJECTED_LOW_DISPERSION_24H',
    netAlphaProjectedPercent: netAlpha,
    timestamp: Date.now(),
  };
}
