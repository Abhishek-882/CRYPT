/**
 * Empirical Challenger Verification Harness: Milestone 2 Round 2
 * Scope: Live Scanner Execution, Radar API Route, Network Outage Fallback,
 * Contract Multiplier Normalization (PEPE 1000, SATS 10), and Mathematical Bounds.
 * Location: web/tests/challenger_m2_r2_empirical_probe.ts
 */

import { NextRequest } from 'next/server';
import {
  executeUniverseScan,
  getDivergenceRadarFeed,
  resetDivergenceScannerCache,
  calculateLiveBasisPercent,
  calculateDispersion24hPercent,
  calculateDDI24h,
  isAntiCollisionValid,
  evaluateCandidateGates,
  BASELINE_SEED_CORRIDOR,
  RadarApiResponse,
} from '../lib/divergence/scanner';
import { GET } from '../app/api/divergence/radar/route';
import {
  resolveCanonicalSymbol,
  getInstrumentMapping,
  normalizePrice,
  normalizeQuantity,
  getMultiplierRatio,
} from '../lib/statarb/utils/contractMapper';

interface AssertionResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: AssertionResult[] = [];
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, id: string, name: string, details: string = '') {
  if (condition) {
    passCount++;
    results.push({ id, name, passed: true, details });
    console.log(`  [PASS] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  } else {
    failCount++;
    results.push({ id, name, passed: false, details });
    console.error(`  [FAIL] ${id}: ${name} -> FAILED: ${details}`);
  }
}

async function runEmpiricalProbe() {
  console.log('================================================================================');
  console.log('  CHALLENGER M2-R2 EMPIRICAL ADVERSARIAL VERIFICATION HARNESS');
  console.log('================================================================================\n');

  // ============================================================================
  // SUITE 1: Live Discovery & executeUniverseScan()
  // ============================================================================
  console.log('--- SUITE 1: Live Scanner Discovery & Candidate Generation ---');

  resetDivergenceScannerCache();
  const startTime = Date.now();
  let liveScanResult: RadarApiResponse | undefined = undefined;

  try {
    liveScanResult = await executeUniverseScan();
    const durationMs = Date.now() - startTime;
    console.log(`  Executed live scan in ${durationMs}ms`);

    assert(
      liveScanResult !== null && typeof liveScanResult === 'object',
      'TC-LIVE-01',
      'executeUniverseScan returns valid object'
    );
    assert(
      liveScanResult.success === true,
      'TC-LIVE-02',
      'executeUniverseScan success is strictly true'
    );
    assert(
      liveScanResult.degraded === undefined || liveScanResult.degraded === false,
      'TC-LIVE-03',
      'Live scan is NOT degraded (degraded is undefined or false)',
      `degraded=${liveScanResult.degraded}`
    );
    assert(
      liveScanResult.warning === undefined || liveScanResult.warning === '',
      'TC-LIVE-04',
      'Live scan warning is undefined or empty',
      `warning=${liveScanResult.warning}`
    );
    assert(
      liveScanResult.candidatesCount > 100,
      'TC-LIVE-05',
      'Live candidatesCount exceeds 100 mutual pairs',
      `Count = ${liveScanResult.candidatesCount} mutual pairs`
    );
    assert(
      liveScanResult.candidates.length === liveScanResult.candidatesCount,
      'TC-LIVE-06',
      'candidates array length strictly matches candidatesCount',
      `Length = ${liveScanResult.candidates.length}`
    );
    assert(
      liveScanResult.summary !== undefined && typeof liveScanResult.summary === 'object',
      'TC-LIVE-07',
      'Summary block is present and populated'
    );
    assert(
      liveScanResult.summary.totalScanned === liveScanResult.candidatesCount,
      'TC-LIVE-08',
      'Summary totalScanned matches candidatesCount',
      `totalScanned=${liveScanResult.summary.totalScanned}`
    );
    assert(
      liveScanResult.summary.qualifyingCount >= 0,
      'TC-LIVE-09',
      'Summary qualifyingCount is non-negative number',
      `qualifyingCount=${liveScanResult.summary.qualifyingCount}`
    );

    // Deep inspection of candidate items
    const sampleCandidates = liveScanResult.candidates.slice(0, 10);
    let allCandidatesValid = true;
    let malformedDetails = '';

    for (let i = 0; i < liveScanResult.candidates.length; i++) {
      const c = liveScanResult.candidates[i];
      if (!c.symbol || !c.canonicalSymbol || !c.binanceSymbol || !c.bybitSymbol) {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} missing symbols`;
        break;
      }
      if (typeof c.binancePrice !== 'number' || c.binancePrice <= 0 || !Number.isFinite(c.binancePrice)) {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} (${c.symbol}) invalid binancePrice: ${c.binancePrice}`;
        break;
      }
      if (typeof c.bybitPrice !== 'number' || c.bybitPrice <= 0 || !Number.isFinite(c.bybitPrice)) {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} (${c.symbol}) invalid bybitPrice: ${c.bybitPrice}`;
        break;
      }
      if (typeof c.liveBasisPercent !== 'number' || !Number.isFinite(c.liveBasisPercent)) {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} (${c.symbol}) invalid liveBasisPercent: ${c.liveBasisPercent}`;
        break;
      }
      if (typeof c.ddi24h !== 'number' || c.ddi24h < -1.0 || c.ddi24h > 1.0) {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} (${c.symbol}) ddi24h out of bounds: ${c.ddi24h}`;
        break;
      }
      if (c.suggestedDirection !== 'LONG_BN_SHORT_BYB' && c.suggestedDirection !== 'SHORT_BN_LONG_BYB') {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} (${c.symbol}) invalid suggestedDirection: ${c.suggestedDirection}`;
        break;
      }
      if (!c.gatesPassed || typeof c.gatesPassed !== 'object') {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} (${c.symbol}) missing gatesPassed`;
        break;
      }
      const expectedOverall =
        c.gatesPassed.dispersion &&
        c.gatesPassed.compression &&
        c.gatesPassed.antiCollision &&
        c.gatesPassed.runwayBuffer &&
        c.gatesPassed.carryFeasibility;
      if (c.overallPassed !== expectedOverall || c.isQualified !== expectedOverall) {
        allCandidatesValid = false;
        malformedDetails = `Index ${i} (${c.symbol}) overallPassed (${c.overallPassed}) does not match gate logical AND (${expectedOverall})`;
        break;
      }
    }

    assert(
      allCandidatesValid,
      'TC-LIVE-10',
      'All candidates possess valid prices, bounded DDI, strict directional type, and gate consistency',
      malformedDetails || `Inspected ${liveScanResult.candidates.length} candidates`
    );

    // Verify Deterministic Sorting: overallPassed: true first, then dispersion magnitude descending
    let sortingValid = true;
    let sortViolation = '';
    for (let i = 0; i < liveScanResult.candidates.length - 1; i++) {
      const curr = liveScanResult.candidates[i];
      const next = liveScanResult.candidates[i + 1];
      if (!curr.overallPassed && next.overallPassed) {
        sortingValid = false;
        sortViolation = `Unqualified candidate at index ${i} precedes qualified candidate at index ${i + 1}`;
        break;
      }
      if (curr.overallPassed === next.overallPassed) {
        if (curr.dispersion24hPercent < next.dispersion24hPercent) {
          sortingValid = false;
          sortViolation = `Dispersion inversion at index ${i} (${curr.dispersion24hPercent}%) < index ${i + 1} (${next.dispersion24hPercent}%)`;
          break;
        }
      }
    }

    assert(
      sortingValid,
      'TC-LIVE-11',
      'Deterministic sorting order strictly enforced (qualified first, then dispersion descending)',
      sortViolation || 'Sort order certified'
    );
  } catch (err: any) {
    assert(false, 'TC-LIVE-FAIL', 'executeUniverseScan threw unexpected exception', err?.message || String(err));
  }

  // ============================================================================
  // SUITE 2: Multiplier Normalization (PEPE 1000, SATS 10)
  // ============================================================================
  console.log('\n--- SUITE 2: Contract Multiplier Normalization (PEPE 1000, SATS 10) ---');

  // 2.1 Canonical symbol resolution
  const pepeCanonical = resolveCanonicalSymbol('1000PEPEUSDT');
  const satsCanonicalBybit = resolveCanonicalSymbol('10000SATSUSDT');
  const satsCanonicalBinance = resolveCanonicalSymbol('1000SATSUSDT');

  assert(pepeCanonical === 'PEPE', 'TC-NORM-01', "resolveCanonicalSymbol('1000PEPEUSDT') === 'PEPE'", pepeCanonical || 'undefined');
  assert(satsCanonicalBybit === 'SATS', 'TC-NORM-02', "resolveCanonicalSymbol('10000SATSUSDT') === 'SATS'", satsCanonicalBybit || 'undefined');
  assert(satsCanonicalBinance === 'SATS', 'TC-NORM-03', "resolveCanonicalSymbol('1000SATSUSDT') === 'SATS'", satsCanonicalBinance || 'undefined');

  // 2.2 Mapping and Multiplier Ratios
  const pepeMapping = getInstrumentMapping('PEPE');
  const satsMapping = getInstrumentMapping('SATS');

  assert(
    pepeMapping !== null &&
    pepeMapping.binanceSymbol === '1000PEPEUSDT' &&
    pepeMapping.bybitSymbol === '1000PEPEUSDT',
    'TC-NORM-04',
    'PEPE mapping correctly points to 1000PEPEUSDT on both venues'
  );

  assert(
    satsMapping !== null &&
    satsMapping.binanceSymbol === '1000SATSUSDT' &&
    satsMapping.bybitSymbol === '10000SATSUSDT',
    'TC-NORM-05',
    'SATS mapping correctly points to Binance 1000SATSUSDT and Bybit 10000SATSUSDT'
  );

  const satsMultiplierRatio = getMultiplierRatio('SATS');
  assert(
    satsMultiplierRatio === 10.0,
    'TC-NORM-06',
    'getMultiplierRatio for SATS is strictly 10.0 (10000 Bybit / 1000 Binance)',
    `Ratio = ${satsMultiplierRatio}`
  );

  const pepeMultiplierRatio = getMultiplierRatio('PEPE');
  assert(
    pepeMultiplierRatio === 1.0,
    'TC-NORM-07',
    'getMultiplierRatio for PEPE is strictly 1.0 (1000 Bybit / 1000 Binance)',
    `Ratio = ${pepeMultiplierRatio}`
  );

  // 2.3 Price Normalization (Per-Token Base Pricing)
  // Binance PEPE quote for 1000 tokens = $0.0098000 -> price per token = $0.0000098
  const rawPepeBinanceQuote = 0.0098;
  const normalizedPepeBinance = normalizePrice(rawPepeBinanceQuote, 'BINANCE', 'PEPE');
  const normalizedPepeBybit = normalizePrice(rawPepeBinanceQuote, 'BYBIT', 'PEPE');

  assert(
    Math.abs(normalizedPepeBinance - 0.0000098) < 1e-9,
    'TC-NORM-08',
    'PEPE Binance price normalized by 1,000 divisor',
    `Normalized = ${normalizedPepeBinance}`
  );
  assert(
    Math.abs(normalizedPepeBybit - 0.0000098) < 1e-9,
    'TC-NORM-09',
    'PEPE Bybit price normalized by 1,000 divisor',
    `Normalized = ${normalizedPepeBybit}`
  );

  // SATS Price Normalization:
  // Binance 1000SATS quote = $0.000285 -> per-token = 0.000285 / 1000 = $0.000000285
  // Bybit 10000SATS quote = $0.002850 -> per-token = 0.002850 / 10000 = $0.000000285
  const rawSatsBinanceQuote = 0.000285;
  const rawSatsBybitQuote = 0.002850;
  const normalizedSatsBinance = normalizePrice(rawSatsBinanceQuote, 'BINANCE', 'SATS');
  const normalizedSatsBybit = normalizePrice(rawSatsBybitQuote, 'BYBIT', 'SATS');

  assert(
    Math.abs(normalizedSatsBinance - 0.000000285) < 1e-12,
    'TC-NORM-10',
    'SATS Binance price normalized by 1,000 divisor',
    `Normalized = ${normalizedSatsBinance}`
  );
  assert(
    Math.abs(normalizedSatsBybit - 0.000000285) < 1e-12,
    'TC-NORM-11',
    'SATS Bybit price normalized by 10,000 divisor',
    `Normalized = ${normalizedSatsBybit}`
  );

  // Cross-Venue Basis on Normalized Prices:
  // Without normalization: raw basis would be 2 * (0.000285 - 0.002850) / (0.000285 + 0.002850) = -163.6% (artificial dislocation!)
  // With normalization: basis = 0.000%
  const normalizedBasis = calculateLiveBasisPercent(normalizedSatsBinance, normalizedSatsBybit);
  assert(
    Math.abs(normalizedBasis) < 0.001,
    'TC-NORM-12',
    'Normalized basis between Binance 1000SATS and Bybit 10000SATS eliminates artificial 10x dislocation',
    `Basis = ${normalizedBasis}%`
  );

  const antiCollisionPassedWithNorm = isAntiCollisionValid(normalizedSatsBinance, normalizedSatsBybit);
  const antiCollisionPassedWithoutNorm = isAntiCollisionValid(rawSatsBinanceQuote, rawSatsBybitQuote);
  assert(
    antiCollisionPassedWithNorm === true && antiCollisionPassedWithoutNorm === false,
    'TC-NORM-13',
    'Anti-collision sanity gate passes under normalized prices but correctly rejects unnormalized 10x dislocation',
    `With norm: ${antiCollisionPassedWithNorm}, Without norm: ${antiCollisionPassedWithoutNorm}`
  );

  // 2.4 Quantity Translation
  // 100 contracts on Binance (100 * 1,000 = 100,000 SATS) -> Bybit contracts (100,000 / 10,000 = 10 contracts)
  const bybitSatsQty = normalizeQuantity(100, 'BINANCE', 'BYBIT', 'SATS');
  assert(
    bybitSatsQty === 10,
    'TC-NORM-14',
    'normalizeQuantity translates 100 Binance 1000SATS contracts to 10 Bybit 10000SATS contracts',
    `Bybit Qty = ${bybitSatsQty}`
  );

  // 10 contracts on Bybit (10 * 10,000 = 100,000 SATS) -> Binance contracts (100,000 / 1,000 = 100 contracts)
  const binanceSatsQty = normalizeQuantity(10, 'BYBIT', 'BINANCE', 'SATS');
  assert(
    binanceSatsQty === 100,
    'TC-NORM-15',
    'normalizeQuantity translates 10 Bybit 10000SATS contracts to 100 Binance 1000SATS contracts',
    `Binance Qty = ${binanceSatsQty}`
  );

  // 2.5 Live Candidate Multiplier Verification
  if (liveScanResult && liveScanResult.candidates) {
    const pepeCandidate = liveScanResult.candidates.find(
      (c) => c.canonicalSymbol === 'PEPE' || c.symbol.includes('PEPE')
    );
    if (pepeCandidate) {
      assert(
        pepeCandidate.multiplier === 1.0,
        'TC-NORM-16',
        'Live PEPE candidate records multiplier 1.0',
        `Multiplier = ${pepeCandidate.multiplier}, binancePrice = ${pepeCandidate.binancePrice}`
      );
      assert(
        pepeCandidate.binancePrice < 0.001,
        'TC-NORM-17',
        'Live PEPE price is normalized to per-token scale (< $0.001)',
        `Price = ${pepeCandidate.binancePrice}`
      );
    } else {
      console.log('  [INFO] PEPE not found in current live candidate matrix');
    }

    const satsCandidate = liveScanResult.candidates.find(
      (c) => c.canonicalSymbol === 'SATS' || c.symbol.includes('SATS')
    );
    if (satsCandidate) {
      assert(
        satsCandidate.multiplier === 10.0,
        'TC-NORM-18',
        'Live SATS candidate records multiplier 10.0',
        `Multiplier = ${satsCandidate.multiplier}`
      );
      assert(
        satsCandidate.binancePrice < 0.001 && satsCandidate.bybitPrice < 0.001,
        'TC-NORM-19',
        'Live SATS prices are normalized to per-token scale (< $0.001)',
        `Bn = ${satsCandidate.binancePrice}, Byb = ${satsCandidate.bybitPrice}`
      );
      assert(
        Math.abs(satsCandidate.liveBasisPercent) < 5.0,
        'TC-NORM-20',
        'Live SATS liveBasisPercent is within normal bounds (< 5.000%, no 10x ratio artifact)',
        `Basis = ${satsCandidate.liveBasisPercent}%`
      );
    } else {
      console.log('  [INFO] SATS not found in current live candidate matrix');
    }
  }

  // ============================================================================
  // SUITE 3: Radar API Route (GET /api/divergence/radar)
  // ============================================================================
  console.log('\n--- SUITE 3: Radar API Route (GET /api/divergence/radar) ---');

  resetDivergenceScannerCache();

  // 3.1 Standard live GET invocation
  const req1 = new NextRequest('http://localhost:3000/api/divergence/radar');
  const res1 = await GET(req1);
  const data1 = await res1.json();

  assert(res1.status === 200, 'TC-ROUTE-01', 'GET /api/divergence/radar returns HTTP 200');
  assert(
    res1.headers.get('x-degraded-feed') === 'false',
    'TC-ROUTE-02',
    "GET /api/divergence/radar includes header 'X-Degraded-Feed: false' on live feed",
    `Header = ${res1.headers.get('x-degraded-feed')}`
  );
  assert(
    Boolean(res1.headers.get('cache-control')?.includes('stale-while-revalidate')),
    'TC-ROUTE-03',
    "Response includes Cache-Control header with stale-while-revalidate",
    `Cache-Control = ${res1.headers.get('cache-control')}`
  );
  assert(data1.success === true, 'TC-ROUTE-04', 'Route response body has success: true');
  assert(data1.candidatesCount > 100, 'TC-ROUTE-05', 'Route response has candidatesCount > 100', `Count = ${data1.candidatesCount}`);
  assert(data1.degraded === undefined || data1.degraded === false, 'TC-ROUTE-06', 'Route response degraded is false/undefined');

  // 3.2 In-Memory 2,500ms SWR Cache Hit
  const req2 = new NextRequest('http://localhost:3000/api/divergence/radar');
  const t0 = Date.now();
  const res2 = await GET(req2);
  const tDelta = Date.now() - t0;
  const data2 = await res2.json();

  assert(res2.status === 200, 'TC-ROUTE-07', 'Cached request returns HTTP 200');
  assert(data2.cached === true, 'TC-ROUTE-08', 'Subsequent request within 2,500ms serves with cached: true');
  assert(tDelta < 20, 'TC-ROUTE-09', 'Cached response served in < 20ms (in-memory SWR)', `Latency = ${tDelta}ms`);

  // 3.3 Force fresh bypass (?fresh=true)
  const reqFresh = new NextRequest('http://localhost:3000/api/divergence/radar?fresh=true');
  const resFresh = await GET(reqFresh);
  const dataFresh = await resFresh.json();

  assert(resFresh.status === 200, 'TC-ROUTE-10', 'Fresh request returns HTTP 200');
  assert(dataFresh.cached === false, 'TC-ROUTE-11', 'fresh=true bypasses cache and evaluates freshly (cached: false)');

  // ============================================================================
  // SUITE 4: Adversarial Network Outage & Degradation Fallback
  // ============================================================================
  console.log('\n--- SUITE 4: Network Outage Stress-Test & Fallback Corridor ---');

  const originalFetch = globalThis.fetch;

  try {
    // 4.1 Mock Total Network Rejection on executeUniverseScan()
    globalThis.fetch = async () => {
      throw new Error('ETIMEDOUT: Connection to exchange API timed out');
    };

    resetDivergenceScannerCache();
    const outageResult = await executeUniverseScan();

    assert(
      outageResult !== null && typeof outageResult === 'object',
      'TC-OUTAGE-01',
      'executeUniverseScan handles fetch rejection gracefully without crashing'
    );
    assert(
      outageResult.success === true,
      'TC-OUTAGE-02',
      'Outage fallback returns success: true (graceful degradation)'
    );
    assert(
      outageResult.degraded === true,
      'TC-OUTAGE-03',
      'Outage fallback strictly flags degraded: true',
      `degraded=${outageResult.degraded}`
    );
    assert(
      typeof outageResult.warning === 'string' &&
      outageResult.warning.includes('Live exchange ingestion degraded') &&
      outageResult.warning.includes('Serving baseline corridor'),
      'TC-OUTAGE-04',
      'Outage fallback includes descriptive warning message',
      outageResult.warning
    );
    assert(
      outageResult.candidatesCount === BASELINE_SEED_CORRIDOR.length,
      'TC-OUTAGE-05',
      `Fallback candidatesCount strictly equals BASELINE_SEED_CORRIDOR size (${BASELINE_SEED_CORRIDOR.length})`,
      `Count = ${outageResult.candidatesCount}`
    );
    assert(
      outageResult.candidates.length === BASELINE_SEED_CORRIDOR.length,
      'TC-OUTAGE-06',
      'Fallback candidates array matches baseline corridor item count'
    );

    // Verify baseline corridor contents
    const btcFallback = outageResult.candidates.find((c) => c.canonicalSymbol === 'BTC');
    assert(
      btcFallback !== undefined && btcFallback.binancePrice === 68500.0 && btcFallback.dispersion24hPercent === 0.420,
      'TC-OUTAGE-07',
      'BTC fallback candidate populates expected baseline seed price and dispersion',
      `Price = ${btcFallback?.binancePrice}, Disp = ${btcFallback?.dispersion24hPercent}%`
    );

    // 4.2 Route Response Under Network Outage
    resetDivergenceScannerCache();
    const outageReq = new NextRequest('http://localhost:3000/api/divergence/radar?fresh=true');
    const outageRouteRes = await GET(outageReq);
    const outageRouteData = await outageRouteRes.json();

    assert(
      outageRouteRes.status === 200,
      'TC-OUTAGE-08',
      'Route returns HTTP 200 during network outage (resilient baseline fallback)'
    );
    assert(
      outageRouteRes.headers.get('x-degraded-feed') === 'true',
      'TC-OUTAGE-09',
      "Route emits 'X-Degraded-Feed: true' header during network outage",
      `Header = ${outageRouteRes.headers.get('x-degraded-feed')}`
    );
    assert(
      outageRouteData.degraded === true,
      'TC-OUTAGE-10',
      'Route payload body explicitly indicates degraded: true'
    );
    assert(
      outageRouteData.candidatesCount === BASELINE_SEED_CORRIDOR.length,
      'TC-OUTAGE-11',
      'Route payload serves baseline corridor assets during outage'
    );

    // 4.3 Partial Outage: Binance OK, Bybit down
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('binance')) {
        return new Response(JSON.stringify([{ symbol: 'BTCUSDT', bidPrice: '68000', askPrice: '68001' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Bybit network 502 Bad Gateway');
    };

    resetDivergenceScannerCache();
    const partialBybitDownResult = await executeUniverseScan();
    assert(
      partialBybitDownResult.success === true,
      'TC-OUTAGE-12',
      'Partial outage (Bybit down) handled gracefully without throwing'
    );
    // Since mutual pairs require Bybit data (loop iterates over Bybit map),
    // 0 candidates found from live loop -> candidatesCount = 0
    assert(
      partialBybitDownResult.candidatesCount === 0 || partialBybitDownResult.degraded === true,
      'TC-OUTAGE-13',
      'Partial outage returns 0 candidates or degraded fallback cleanly',
      `Count = ${partialBybitDownResult.candidatesCount}`
    );

    // 4.4 Partial Outage: Bybit OK, Binance down
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('bybit')) {
        return new Response(
          JSON.stringify({
            result: {
              list: [
                {
                  symbol: 'BTCUSDT',
                  bid1Price: '68000',
                  ask1Price: '68001',
                  turnover24h: '1000000',
                  fundingRate: '0.0001',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error('Binance 503 Service Unavailable');
    };

    resetDivergenceScannerCache();
    const partialBnDownResult = await executeUniverseScan();
    assert(
      partialBnDownResult.success === true,
      'TC-OUTAGE-14',
      'Partial outage (Binance down) handled gracefully without throwing',
      `Count = ${partialBnDownResult.candidatesCount}`
    );
  } finally {
    // Restore original native fetch
    globalThis.fetch = originalFetch;
    resetDivergenceScannerCache();
  }

  // 4.5 Verify Recovery back to Live State
  const recoveryResult = await executeUniverseScan();
  assert(
    recoveryResult.success === true &&
    (recoveryResult.degraded === undefined || recoveryResult.degraded === false) &&
    recoveryResult.candidatesCount > 100,
    'TC-OUTAGE-15',
    'Full recovery to live exchange ingestion verified upon network restoration',
    `Count = ${recoveryResult.candidatesCount}, Degraded = ${recoveryResult.degraded}`
  );

  // ============================================================================
  // SUITE 5: Mathematical Edge Cases & Directional Carry
  // ============================================================================
  console.log('\n--- SUITE 5: Mathematical Edge Cases & Direction-Aware Carry ---');

  // 5.1 DDI24h Boundedness [-1.000, +1.000]
  const ddiUniformNegative = calculateDDI24h(-0.1, -0.5);
  assert(
    ddiUniformNegative === -1.0,
    'TC-MATH-01',
    'calculateDDI24h(-0.1, -0.5) is strictly clamped to -1.000 (not -1.200)',
    `Value = ${ddiUniformNegative}`
  );

  const ddiUniformPositive = calculateDDI24h(0.5, 0.1);
  assert(
    ddiUniformPositive === 0.8,
    'TC-MATH-02',
    'calculateDDI24h(0.5, 0.1) evaluates mathematically to 0.800',
    `Value = ${ddiUniformPositive}`
  );

  const ddiMaxPositive = calculateDDI24h(0.5, 0.0);
  assert(
    ddiMaxPositive === 1.0,
    'TC-MATH-02B',
    'calculateDDI24h(0.5, 0.0) reaches theoretical maximum +1.000',
    `Value = ${ddiMaxPositive}`
  );

  const ddiSymmetric = calculateDDI24h(0.3, -0.3);
  assert(
    ddiSymmetric === 0.0,
    'TC-MATH-03',
    'calculateDDI24h(0.3, -0.3) evaluates to 0.000',
    `Value = ${ddiSymmetric}`
  );

  const ddiZero = calculateDDI24h(0, 0);
  assert(
    ddiZero === 0.0,
    'TC-MATH-04',
    'calculateDDI24h(0, 0) evaluates safely to 0.000 without NaN',
    `Value = ${ddiZero}`
  );

  const ddiExtremeDisparity = calculateDDI24h(-0.01, -10.0);
  assert(
    ddiExtremeDisparity >= -1.0 && ddiExtremeDisparity <= 1.0,
    'TC-MATH-05',
    'calculateDDI24h(-0.01, -10.0) stays strictly inside [-1.000, +1.000]',
    `Value = ${ddiExtremeDisparity}`
  );

  // 5.2 Direction-Aware Carry Formulation
  // Scenario A: Direction 1 (LONG_BN_SHORT_BYB) with positive Bybit funding rate (+0.05%)
  // Short Bybit receives funding -> projected carry is positive (+0.05%)
  const evalDir1 = evaluateCandidateGates(100.0, 100.0, 0.50, 0.30, 0.05);
  assert(
    evalDir1.suggestedDirection === 'LONG_BN_SHORT_BYB',
    'TC-MATH-06',
    'Positive DDI (+0.300) selects LONG_BN_SHORT_BYB'
  );
  assert(
    evalDir1.projectedCarryPercent === 0.05,
    'TC-MATH-07',
    'Direction 1 preserves positive carry (+0.05%)',
    `Carry = ${evalDir1.projectedCarryPercent}%`
  );
  assert(
    evalDir1.gatesPassed.carryFeasibility === true,
    'TC-MATH-08',
    'Gate 5 passes for positive carry (+0.05% >= -0.030%)'
  );

  // Scenario B: Direction 2 (SHORT_BN_LONG_BYB) with positive Bybit funding rate (+0.05%)
  // Long Bybit pays funding -> directional carry becomes -0.05%
  // Gate 5 hurdle is -0.030% -> -0.05% < -0.030% -> carry feasibility MUST fail!
  const evalDir2Adverse = evaluateCandidateGates(100.0, 100.0, 0.50, -0.30, -0.05);
  assert(
    evalDir2Adverse.suggestedDirection === 'SHORT_BN_LONG_BYB',
    'TC-MATH-09',
    'Negative DDI (-0.300) selects SHORT_BN_LONG_BYB'
  );
  assert(
    evalDir2Adverse.projectedCarryPercent === -0.05,
    'TC-MATH-10',
    'Direction 2 accurately reflects funding drag (-0.05%)',
    `Carry = ${evalDir2Adverse.projectedCarryPercent}%`
  );
  assert(
    evalDir2Adverse.gatesPassed.carryFeasibility === false,
    'TC-MATH-11',
    'Gate 5 correctly rejects adverse carry (-0.05% < -0.030% hurdle)',
    `GatePassed = ${evalDir2Adverse.gatesPassed.carryFeasibility}, Reason = ${evalDir2Adverse.statusReason}`
  );
  assert(
    evalDir2Adverse.statusReason === 'REJECTED_ADVERSE_CARRY',
    'TC-MATH-12',
    "Status reason correctly indicates 'REJECTED_ADVERSE_CARRY'"
  );

  // ============================================================================
  // SUMMARY REPORT
  // ============================================================================
  console.log('\n================================================================================');
  console.log(`  VERIFICATION RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL ${results.length})`);
  console.log('================================================================================\n');

  if (failCount > 0) {
    console.error(`FAILURE: ${failCount} test(s) failed!`);
    process.exit(1);
  } else {
    console.log('SUCCESS: All adversarial probes passed cleanly!');
    process.exit(0);
  }
}

runEmpiricalProbe().catch((err) => {
  console.error('Fatal probe runner error:', err);
  process.exit(1);
});
