/**
 * Adversarial Stress & Empirical Challenge Suite:
 * Price Cache TTL Boundaries, Concurrency Invariants, and Upstream Failover
 *
 * Target: web/app/api/coins/route.ts
 *
 * Verification Axes:
 * 1. Sub-millisecond Boundary Invariants:
 *    - Exact boundary at 3,999ms (cached: true, 0 HTTP calls, unchanged timestamp)
 *    - Exact boundary at 4,000ms (cached: false, TTL expired, fresh fetch)
 *    - Exact boundary at 4,001ms (cached: false, TTL expired, fresh fetch)
 * 2. Rapid Concurrent Burst Invariants:
 *    - 35 concurrent requests against WARM cache: 100% cached: true, sub-10ms latency, zero HTTP calls.
 *    - 35 concurrent requests against COLD cache: race condition & duplicate fetch storm analysis.
 * 3. Forced Cache Invalidation:
 *    - ?refresh=true forces fresh fetch even 10ms after warm.
 *    - ?refresh=false or missing preserves cache.
 * 4. Resilient Failover under Upstream Faults:
 *    - HTTP 429 Too Many Requests while warm -> fallback to cache with HTTP 200.
 *    - HTTP 500 Internal Server Error while warm -> fallback to cache with HTTP 200.
 *    - Empty array soft-failures ([]) while warm -> fallback to cache with HTTP 200.
 *    - Cold failure handling -> HTTP 500 graceful error without process crash.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GET,
  CoinsApiResponse,
} from "../../app/api/coins/route";
import {
  COINS_CACHE_TTL_MS,
  _resetCoinsCacheForTesting,
} from "../../lib/coinsCache";
import { bybitStreamManager } from "../../lib/bybitStreamManager";

// Mock exchangeFundingMeta to isolate pricing logic
vi.mock("../../lib/exchangeFundingMeta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/exchangeFundingMeta")>();
  const defaultMetaMap = new Map();
  const initSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT"];
  for (const sym of initSymbols) {
    defaultMetaMap.set(sym, {
      symbol: sym,
      fundingIntervalHours: 8,
      settlementCycleLabel: "8h (3x/day)",
      payoutsPerDay: 3,
    });
  }
  return {
    ...actual,
    fetchFundingMetaMap: vi.fn().mockImplementation(async () => defaultMetaMap),
  };
});

const defaultSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT"];
const outboundHttpCalls: string[] = [];

function buildMockBinanceTickers(symbols: string[]) {
  return symbols.map((sym, i) => ({
    symbol: sym,
    markPrice: (1000 + i * 50).toFixed(4),
    lastFundingRate: (0.0001 + (i % 3) * 0.00005).toFixed(6),
    time: Date.now(),
  }));
}

function buildMockBitgetTickers(symbols: string[]) {
  return symbols.map((sym, i) => ({
    symbol: sym,
    markPrice: (1000 + i * 50 + 0.1).toFixed(4),
    lastPr: (1000 + i * 50).toFixed(4),
    fundingRate: (0.00012 + (i % 3) * 0.00004).toFixed(6),
  }));
}

function buildMockCoinDcxSymbols(symbols: string[]) {
  return symbols.map((sym) => `B-${sym.replace("USDT", "")}_USDT`);
}

describe("Adversarial Stress Verification: Price Cache Boundaries & Concurrency", () => {
  let originalFetch: typeof global.fetch;
  let simulatedNow = 1_700_000_000_000;
  let injectUpstreamError: "NONE" | "429" | "500" | "EMPTY" = "NONE";
  let fetchDelayMs = 0;

  beforeEach(() => {
    outboundHttpCalls.length = 0;
    simulatedNow = 1_700_000_000_000;
    injectUpstreamError = "NONE";
    fetchDelayMs = 0;

    _resetCoinsCacheForTesting(true);
    bybitStreamManager.getAllTickers().clear();

    vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);

    originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url;

      outboundHttpCalls.push(urlStr);

      if (fetchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, fetchDelayMs));
      }

      if (injectUpstreamError === "429") {
        throw new Error("Exchange rate limit exceeded: HTTP 429 Too Many Requests");
      }
      if (injectUpstreamError === "500") {
        throw new Error("Upstream server fault: HTTP 500 Internal Server Error");
      }

      if (urlStr.includes("premiumIndex")) {
        if (injectUpstreamError === "EMPTY") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify(buildMockBinanceTickers(defaultSymbols)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("mix/market/tickers")) {
        if (injectUpstreamError === "EMPTY") {
          return new Response(JSON.stringify({ code: "00000", data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ code: "00000", data: buildMockBitgetTickers(defaultSymbols) }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (urlStr.includes("active_instruments")) {
        return new Response(JSON.stringify(buildMockCoinDcxSymbols(defaultSymbols)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("exchangeInfo")) {
        return new Response(
          JSON.stringify({
            symbols: defaultSymbols.map((sym) => ({
              symbol: sym,
              status: "TRADING",
              quoteAsset: "USDT",
              underlyingType: "COIN",
              contractType: "PERPETUAL",
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("contracts")) {
        return new Response(
          JSON.stringify({
            code: "00000",
            data: defaultSymbols.map((s) => ({ symbol: s })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    _resetCoinsCacheForTesting(true);
    bybitStreamManager.getAllTickers().clear();
  });

  // =========================================================================
  // Challenge 1: Exact Sub-millisecond Boundary Testing
  // =========================================================================
  describe("Challenge 1: Exact Sub-millisecond Boundary Testing (3,999ms vs 4,000ms vs 4,001ms)", () => {
    it("empirically verifies cached: true and 0 HTTP calls at t0 + 3,999ms", async () => {
      // 1. Initial warm fetch at t0
      const t0 = simulatedNow;
      const resWarm = await GET(new NextRequest("http://localhost:3000/api/coins"));
      const dataWarm: CoinsApiResponse = await resWarm.json();
      expect(dataWarm.cached).toBe(false);
      expect(dataWarm.updatedAt).toBe(t0);
      const warmHttpCalls = outboundHttpCalls.length;
      expect(warmHttpCalls).toBeGreaterThan(0);

      // 2. Advance time to EXACTLY 3,999ms after t0 (1ms before TTL expiration)
      simulatedNow = t0 + 3999;
      const resBoundary = await GET(new NextRequest("http://localhost:3000/api/coins"));
      expect(resBoundary.status).toBe(200);

      const dataBoundary: CoinsApiResponse = await resBoundary.json();
      expect(dataBoundary.cached).toBe(true);
      expect(dataBoundary.updatedAt).toBe(t0); // Preserves original warm timestamp
      expect(dataBoundary.coins.length).toBe(dataWarm.coins.length);

      // CRITICAL ASSERTION: Exactly 0 additional HTTP calls issued
      expect(outboundHttpCalls.length).toBe(warmHttpCalls);
    });

    it("empirically verifies TTL expiry at t0 + 4,000ms and t0 + 4,001ms triggers fresh fetch", async () => {
      // 1. Initial warm fetch at t0
      const t0 = simulatedNow;
      await GET(new NextRequest("http://localhost:3000/api/coins"));
      const warmHttpCalls = outboundHttpCalls.length;

      // 2. At t0 + 4,000ms (now - lastFetchTime === 4000, condition < 4000 is FALSE)
      simulatedNow = t0 + 4000;
      const resAt4000 = await GET(new NextRequest("http://localhost:3000/api/coins"));
      const dataAt4000: CoinsApiResponse = await resAt4000.json();
      expect(dataAt4000.cached).toBe(false);
      expect(dataAt4000.updatedAt).toBe(t0 + 4000);
      const callsAfter4000 = outboundHttpCalls.length;
      expect(callsAfter4000).toBeGreaterThan(warmHttpCalls);

      // 3. At t0 + 4000 + 4,001ms (beyond second TTL window)
      simulatedNow = (t0 + 4000) + 4001;
      const resAt4001 = await GET(new NextRequest("http://localhost:3000/api/coins"));
      const dataAt4001: CoinsApiResponse = await resAt4001.json();
      expect(dataAt4001.cached).toBe(false);
      expect(dataAt4001.updatedAt).toBe(simulatedNow);
      expect(outboundHttpCalls.length).toBeGreaterThan(callsAfter4000);
    });
  });

  // =========================================================================
  // Challenge 2: Rapid Concurrent Burst Invariants (35+ simultaneous calls)
  // =========================================================================
  describe("Challenge 2: Rapid Concurrent Bursts & Zero-Contention Performance", () => {
    it("handles 35 simultaneous requests against a WARM cache in sub-10ms with zero HTTP calls", async () => {
      // 1. Warm cache
      const t0 = simulatedNow;
      await GET(new NextRequest("http://localhost:3000/api/coins"));
      const warmHttpCalls = outboundHttpCalls.length;

      // Advance by 1,500ms (well within cache TTL)
      simulatedNow = t0 + 1500;

      // 2. Fire 35 simultaneous requests
      const CONCURRENCY_COUNT = 35;
      const startWallClock = performance.now();

      const promises = Array.from({ length: CONCURRENCY_COUNT }, (_, i) =>
        GET(new NextRequest(`http://localhost:3000/api/coins?clientId=${i}`))
      );

      const responses = await Promise.all(promises);
      const elapsedWallClock = performance.now() - startWallClock;
      const avgLatencyMs = elapsedWallClock / CONCURRENCY_COUNT;

      // 3. Assertions across all 35 responses
      expect(responses.length).toBe(CONCURRENCY_COUNT);
      for (const res of responses) {
        expect(res.status).toBe(200);
        const data: CoinsApiResponse = await res.json();
        expect(data.cached).toBe(true);
        expect(data.updatedAt).toBe(t0);
        expect(data.coins.length).toBeGreaterThan(0);
      }

      // 4. Assert zero additional outbound HTTP requests
      expect(outboundHttpCalls.length).toBe(warmHttpCalls);

      // 5. Assert sub-10ms average latency requirement
      expect(avgLatencyMs).toBeLessThan(10);
    });

    it("observes behavior of 35 simultaneous requests against a COLD cache (thundering herd stress analysis)", async () => {
      // Cache is completely cold
      _resetCoinsCacheForTesting(true);
      outboundHttpCalls.length = 0;

      const CONCURRENCY_COUNT = 35;
      const promises = Array.from({ length: CONCURRENCY_COUNT }, (_, i) =>
        GET(new NextRequest(`http://localhost:3000/api/coins?burstId=${i}`))
      );

      const responses = await Promise.all(promises);
      expect(responses.length).toBe(CONCURRENCY_COUNT);

      for (const res of responses) {
        expect(res.status).toBe(200);
        const data: CoinsApiResponse = await res.json();
        expect(data.success).toBe(true);
        expect(data.coins.length).toBeGreaterThan(0);
      }

      // Record empirical observation of cold thundering herd
      const binanceCalls = outboundHttpCalls.filter((u) => u.includes("premiumIndex")).length;
      const bitgetCalls = outboundHttpCalls.filter((u) => u.includes("mix/market/tickers")).length;

      // In Node.js Next.js route without in-flight promise memoization,
      // all concurrent cold calls invoke fetch before the first one writes to cachedResponse.
      // We verify whether this completes safely without corrupted data or crashes.
      expect(binanceCalls).toBeGreaterThanOrEqual(1);
      expect(bitgetCalls).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Challenge 3: Forced Cache Invalidation (?refresh=true)
  // =========================================================================
  describe("Challenge 3: Forced Cache Invalidation (?refresh=true)", () => {
    it("forces fresh fetch even when called 10ms after warm fetch", async () => {
      const t0 = simulatedNow;
      await GET(new NextRequest("http://localhost:3000/api/coins"));
      const warmCalls = outboundHttpCalls.length;

      // Advance by just 10ms
      simulatedNow = t0 + 10;
      const resForce = await GET(new NextRequest("http://localhost:3000/api/coins?refresh=true"));
      expect(resForce.status).toBe(200);

      const dataForce: CoinsApiResponse = await resForce.json();
      expect(dataForce.cached).toBe(false);
      expect(dataForce.updatedAt).toBe(t0 + 10);
      expect(outboundHttpCalls.length).toBeGreaterThan(warmCalls);
    });

    it("preserves cache when ?refresh=false or query param is omitted", async () => {
      const t0 = simulatedNow;
      await GET(new NextRequest("http://localhost:3000/api/coins"));
      const warmCalls = outboundHttpCalls.length;

      simulatedNow = t0 + 500;
      const resFalse = await GET(new NextRequest("http://localhost:3000/api/coins?refresh=false"));
      const dataFalse: CoinsApiResponse = await resFalse.json();
      expect(dataFalse.cached).toBe(true);
      expect(dataFalse.updatedAt).toBe(t0);
      expect(outboundHttpCalls.length).toBe(warmCalls);

      simulatedNow = t0 + 1000;
      const resNoParam = await GET(new NextRequest("http://localhost:3000/api/coins"));
      const dataNoParam: CoinsApiResponse = await resNoParam.json();
      expect(dataNoParam.cached).toBe(true);
      expect(dataNoParam.updatedAt).toBe(t0);
      expect(outboundHttpCalls.length).toBe(warmCalls);
    });
  });

  // =========================================================================
  // Challenge 4: Failover Under Upstream 429 and 500 Error Codes
  // =========================================================================
  describe("Challenge 4: Failover Resilience Under Upstream Faults (429, 500, Empty)", () => {
    it("falls back gracefully to cached payload with HTTP 200 when upstream throws HTTP 429", async () => {
      // 1. Seed healthy cache
      const t0 = simulatedNow;
      const resWarm = await GET(new NextRequest("http://localhost:3000/api/coins"));
      const dataWarm: CoinsApiResponse = await resWarm.json();
      expect(dataWarm.cached).toBe(false);
      expect(dataWarm.coins.length).toBeGreaterThan(0);

      // 2. Inject upstream 429 error and force refresh
      simulatedNow = t0 + 5000;
      injectUpstreamError = "429";

      const resFail = await GET(new NextRequest("http://localhost:3000/api/coins?refresh=true"));
      expect(resFail.status).toBe(200);

      const dataFail: CoinsApiResponse = await resFail.json();
      expect(dataFail.cached).toBe(true);
      expect(dataFail.coins.length).toBe(dataWarm.coins.length);
      expect(dataFail.error).toContain("HTTP 429");
    });

    it("falls back gracefully to cached payload with HTTP 200 when upstream throws HTTP 500", async () => {
      // 1. Seed healthy cache
      const t0 = simulatedNow;
      await GET(new NextRequest("http://localhost:3000/api/coins"));

      // 2. Inject upstream 500 server fault
      simulatedNow = t0 + 5000;
      injectUpstreamError = "500";

      const resFail = await GET(new NextRequest("http://localhost:3000/api/coins?refresh=true"));
      expect(resFail.status).toBe(200);

      const dataFail: CoinsApiResponse = await resFail.json();
      expect(dataFail.cached).toBe(true);
      expect(dataFail.coins.length).toBeGreaterThan(0);
      expect(dataFail.error).toContain("HTTP 500");
    });

    it("falls back to cached data when external exchanges return empty arrays (soft outage)", async () => {
      // 1. Seed healthy cache
      const t0 = simulatedNow;
      await GET(new NextRequest("http://localhost:3000/api/coins"));

      // 2. Inject empty arrays from exchanges
      simulatedNow = t0 + 5000;
      injectUpstreamError = "EMPTY";

      const resEmpty = await GET(new NextRequest("http://localhost:3000/api/coins?refresh=true"));
      expect(resEmpty.status).toBe(200);

      const dataEmpty: CoinsApiResponse = await resEmpty.json();
      expect(dataEmpty.cached).toBe(true);
      expect(dataEmpty.coins.length).toBeGreaterThan(0);
      expect(dataEmpty.error).toContain("Exchange endpoints returned empty or failed");
    });

    it("returns clean HTTP 500 without crashing when cold cache experiences upstream failure", async () => {
      _resetCoinsCacheForTesting(true);
      injectUpstreamError = "500";

      const resColdFail = await GET(new NextRequest("http://localhost:3000/api/coins"));
      expect(resColdFail.status).toBe(500);

      const dataColdFail: CoinsApiResponse = await resColdFail.json();
      expect(dataColdFail.success).toBe(false);
      expect(dataColdFail.cached).toBe(false);
      expect(dataColdFail.coins).toEqual([]);
      expect(dataColdFail.error).toContain("HTTP 500");
    });
  });
});
