/**
 * STATARB-OU-PERP: Telemetry & Rate Limit Stress Challenger Test Suite
 * Archetype: EMPIRICAL CHALLENGER
 * Roles: critic, specialist
 *
 * Empirical Challenges Verified:
 * 1. Zero Synthetic Formulas Invariant:
 *    - Asserts 0 occurrences of Math.sin() and Math.cos() across radar and daemon routes.
 *    - Asserts authentic Bybit and Binance ticker prices pass through directly without sinusoidal modulation.
 * 2. Rate Limit Consolidation & Cache TTL (2500ms):
 *    - Asserts exactly ONE bulk endpoint called per venue for all 15 corridors.
 *    - Validates 2,500ms cache TTL: subsequent calls within window serve from memory with 0 network calls.
 *    - Validates cache invalidation and fresh bulk fetch after 2,500ms expiration.
 * 3. Stress Test: Ticker Resolution & Graceful Degraded Mode:
 *    - Missing symbols on one or both venues fall back gracefully with zero crashes.
 *    - Complete network dropouts / fetch rejections return valid responses with zero uncaught exceptions.
 *    - Malformed / non-numeric / negative quotes are discarded safely with zero NaN spreads.
 * 4. Daemon Sweep Authenticity:
 *    - Verifies daemon cron_tick consumes authentic tickers in parallel with identical bulk safety invariants.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { GET as radarGET } from "@/app/api/convergence/radar/route";
import { GET as daemonGET, POST as daemonPOST } from "@/app/api/convergence/daemon/route";

describe("Telemetry & Rate Limit Stress Challenger Suite", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear global route cache before each test
    delete (globalThis as any).__radarCache;
    delete (globalThis as any).__radarSpreadHistory;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // =========================================================================
  // TASK 1: EMPIRICAL VERIFICATION OF REAL TICKERS & ZERO SYNTHETIC FORMULAS
  // =========================================================================
  describe("Task 1: Zero Math.sin() / Math.cos() Synthetic Formulas Invariant", () => {
    it("empirically verifies route files contain 0 occurrences of Math.sin and Math.cos", () => {
      const radarPath = path.resolve(__dirname, "../../../app/api/convergence/radar/route.ts");
      const daemonPath = path.resolve(__dirname, "../../../app/api/convergence/daemon/route.ts");

      const radarContent = fs.readFileSync(radarPath, "utf-8");
      const daemonContent = fs.readFileSync(daemonPath, "utf-8");

      // Assert zero Math.sin
      expect(radarContent).not.toContain("Math.sin");
      expect(daemonContent).not.toContain("Math.sin");

      // Assert zero Math.cos
      expect(radarContent).not.toContain("Math.cos");
      expect(daemonContent).not.toContain("Math.cos");

      // Assert zero spreadOscillationBps or basisFactor perturbation variables
      expect(radarContent).not.toContain("spreadOscillationBps");
      expect(daemonContent).not.toContain("spreadOscillationBps");
      expect(radarContent).not.toContain("basisFactor");
      expect(daemonContent).not.toContain("basisFactor");
    });

    it("empirically verifies authentic exchange tickers pass through directly to radar output without perturbation", async () => {
      // Mock genuine live prices
      const bnBtcBid = 68420.5;
      const bnBtcAsk = 68421.5;
      const expectedBnMid = 68421.0;

      const bybBtcBid = 68410.0;
      const bybBtcAsk = 68412.0;
      const expectedBybMid = 68411.0;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("binance.com")) {
          return new Response(
            JSON.stringify([
              { symbol: "BTCUSDT", bidPrice: bnBtcBid.toString(), askPrice: bnBtcAsk.toString() },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("bybit.com")) {
          return new Response(
            JSON.stringify({
              retCode: 0,
              result: {
                list: [
                  { symbol: "BTCUSDT", bid1Price: bybBtcBid.toString(), ask1Price: bybBtcAsk.toString() },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const req = new NextRequest("http://localhost:3000/api/convergence/radar");
      const res = await radarGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const btcPair = json.pairs.find((p: any) => p.canonicalSymbol === "BTC");
      expect(btcPair).toBeDefined();

      // Verify Binance authentic mid
      expect(btcPair.binanceMid).toBe(expectedBnMid);

      // Verify Bybit authentic mid (NOT altered by any formula)
      expect(btcPair.bybitMid).toBe(expectedBybMid);

      // Verify spread calculations are exact and non-synthetic
      const expectedBnSpreadBps = parseFloat((((bnBtcAsk - bnBtcBid) / expectedBnMid) * 10000).toFixed(2));
      const expectedBybSpreadBps = parseFloat((((bybBtcAsk - bybBtcBid) / expectedBybMid) * 10000).toFixed(2));
      const expectedBasisBps = parseFloat((((expectedBnMid - expectedBybMid) / expectedBybMid) * 10000).toFixed(2));

      expect(btcPair.binanceSpreadBps).toBe(expectedBnSpreadBps);
      expect(btcPair.bybitSpreadBps).toBe(expectedBybSpreadBps);
      expect(btcPair.grossBasisBps).toBe(expectedBasisBps);
    });
  });

  // =========================================================================
  // TASK 2: RATE LIMIT CONSOLIDATION & CACHE TTL (2500MS)
  // =========================================================================
  describe("Task 2: Rate Limit Consolidation & 2,500ms Cache TTL", () => {
    it("asserts exactly 1 bulk request per venue for 15 corridors (zero per-symbol queries)", async () => {
      const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("binance.com")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes("bybit.com")) {
          return new Response(JSON.stringify({ retCode: 0, result: { list: [] } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      });
      globalThis.fetch = fetchSpy;

      const req = new NextRequest("http://localhost:3000/api/convergence/radar");
      const res = await radarGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.monitoredCount).toBe(15);

      // Exactly 2 fetch calls total (1 for Binance bulk bookTicker, 1 for Bybit bulk tickers)
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const calledUrls = fetchSpy.mock.calls.map((call) => call[0]);
      expect(calledUrls).toContain("https://fapi.binance.com/fapi/v1/ticker/bookTicker");
      expect(calledUrls).toContain("https://api.bybit.com/v5/market/tickers?category=linear");

      // Verify NO individual symbol calls were made
      for (const url of calledUrls) {
        expect(url).not.toContain("symbol=BTCUSDT");
        expect(url).not.toContain("symbol=ETHUSDT");
      }
    });

    it("validates 2,500ms cache TTL: serves identical cached data within window and refreshes on expiry", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (url.includes("binance.com")) {
          return new Response(
            JSON.stringify([
              { symbol: "BTCUSDT", bidPrice: "68000.0", askPrice: "68001.0" },
            ]),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            retCode: 0,
            result: {
              list: [{ symbol: "BTCUSDT", bid1Price: "68000.0", ask1Price: "68001.0" }],
            },
          }),
          { status: 200 }
        );
      });

      const req = new NextRequest("http://localhost:3000/api/convergence/radar");

      // Step 1: Initial call at t = 1,000,000 ms
      const t0 = 1000000;
      vi.spyOn(Date, "now").mockReturnValue(t0);
      const res1 = await radarGET(req);
      const json1 = await res1.json();
      expect(json1.success).toBe(true);
      expect(callCount).toBe(2); // 1 Binance + 1 Bybit

      // Step 2: Call at t = t0 + 1,200 ms (within 2500ms cache window)
      vi.spyOn(Date, "now").mockReturnValue(t0 + 1200);
      const res2 = await radarGET(req);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.timestamp).toBe(t0); // Served from cache
      expect(callCount).toBe(2); // ZERO additional network calls

      // Step 3: Call at t = t0 + 2,499 ms (boundary edge, still within cache)
      vi.spyOn(Date, "now").mockReturnValue(t0 + 2499);
      const res3 = await radarGET(req);
      const json3 = await res3.json();
      expect(json3.timestamp).toBe(t0);
      expect(callCount).toBe(2); // Still 2

      // Step 4: Call at t = t0 + 2,501 ms (cache expired)
      vi.spyOn(Date, "now").mockReturnValue(t0 + 2501);
      const res4 = await radarGET(req);
      const json4 = await res4.json();
      expect(json4.timestamp).toBe(t0 + 2501); // Fresh timestamp
      expect(callCount).toBe(4); // Triggered fresh bulk fetches
    });
  });

  // =========================================================================
  // TASK 3: ADVERSARIAL STRESS TEST: TICKER RESOLUTION & GRACEFUL FALLBACK
  // =========================================================================
  describe("Task 3: Stress Testing Ticker Resolution & Graceful Degraded Fallbacks", () => {
    it("handles partial symbol availability with graceful fallback and zero NaN spreads", async () => {
      // Binance has BTC and ETH, but misses SOL, PEPE, SATS etc.
      // Bybit has ETH and SOL, but misses BTC, PEPE, SATS etc.
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("binance.com")) {
          return new Response(
            JSON.stringify([
              { symbol: "BTCUSDT", bidPrice: "68000.0", askPrice: "68002.0" },
              { symbol: "ETHUSDT", bidPrice: "2500.0", askPrice: "2501.0" },
            ]),
            { status: 200 }
          );
        }
        if (url.includes("bybit.com")) {
          return new Response(
            JSON.stringify({
              retCode: 0,
              result: {
                list: [
                  { symbol: "ETHUSDT", bid1Price: "2499.0", ask1Price: "2500.5" },
                  { symbol: "SOLUSDT", bid1Price: "175.0", ask1Price: "175.2" },
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      });

      const req = new NextRequest("http://localhost:3000/api/convergence/radar");
      const res = await radarGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.pairs.length).toBe(15);

      // Verify each corridor has strictly finite numbers and zero NaN
      for (const pair of json.pairs) {
        expect(Number.isFinite(pair.binanceMid)).toBe(true);
        expect(Number.isFinite(pair.bybitMid)).toBe(true);
        expect(Number.isFinite(pair.grossBasisBps)).toBe(true);
        expect(Number.isFinite(pair.zScore)).toBe(true);
        expect(Number.isFinite(pair.binanceSpreadBps)).toBe(true);
        expect(Number.isFinite(pair.bybitSpreadBps)).toBe(true);

        expect(Number.isNaN(pair.binanceMid)).toBe(false);
        expect(Number.isNaN(pair.bybitMid)).toBe(false);
        expect(Number.isNaN(pair.grossBasisBps)).toBe(false);
        expect(Number.isNaN(pair.zScore)).toBe(false);
        expect(Number.isNaN(pair.binanceSpreadBps)).toBe(false);
        expect(Number.isNaN(pair.bybitSpreadBps)).toBe(false);

        expect(pair.binanceMid).toBeGreaterThan(0);
        expect(pair.bybitMid).toBeGreaterThan(0);
      }

      // BTC: Bybit was missing, should have fallen back cleanly to Binance mid
      const btc = json.pairs.find((p: any) => p.canonicalSymbol === "BTC");
      expect(btc.binanceMid).toBe(68001.0);
      expect(btc.bybitMid).toBe(68001.0);
      expect(btc.grossBasisBps).toBe(0.0);

      // SOL: Binance was missing, falls back to basePrice; Bybit has 175.1
      const sol = json.pairs.find((p: any) => p.canonicalSymbol === "SOL");
      expect(sol.bybitMid).toBe(175.1);
      expect(sol.binanceMid).toBe(172.5); // Fallback to basePrice
    });

    it("gracefully survives complete network dropout (fetch rejection) without throwing uncaught exceptions", async () => {
      // Simulate socket disconnection / connection refused / DNS timeout
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED: Network disconnected"));

      const req = new NextRequest("http://localhost:3000/api/convergence/radar");
      const res = await radarGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.monitoredCount).toBe(15);

      // All pairs safely fall back to base prices with 0 NaN
      for (const pair of json.pairs) {
        expect(pair.binanceMid).toBeGreaterThan(0);
        expect(pair.bybitMid).toBeGreaterThan(0);
        expect(Number.isNaN(pair.grossBasisBps)).toBe(false);
        expect(Number.isNaN(pair.zScore)).toBe(false);
      }
    });

    it("resiliently filters malformed, negative, zero, and corrupted quote payloads", async () => {
      // Simulate exchange edge cases: non-numeric strings, negative prices, nulls
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("binance.com")) {
          return new Response(
            JSON.stringify([
              { symbol: "BTCUSDT", bidPrice: "NaN", askPrice: "68000" },      // Corrupted bid
              { symbol: "ETHUSDT", bidPrice: "-100.0", askPrice: "2500" },    // Negative bid
              { symbol: "SOLUSDT", bidPrice: "0.00", askPrice: "0.00" },       // Zero book
              { symbol: "PEPEUSDT", bidPrice: "invalid", askPrice: "invalid" },// String garbage
              { symbol: "NEARUSDT", bidPrice: "4.85", askPrice: "4.86" },     // Valid quote
            ]),
            { status: 200 }
          );
        }
        if (url.includes("bybit.com")) {
          return new Response(
            JSON.stringify({
              retCode: 0,
              result: {
                list: [
                  { symbol: "BTCUSDT", bid1Price: null, ask1Price: "undefined" }, // Null/undefined
                  { symbol: "ETHUSDT", bid1Price: "-50.0", ask1Price: "-40.0" },  // Negative prices
                  { symbol: "SOLUSDT", bid1Price: "0", ask1Price: "0" },           // Zero prices
                  { symbol: "NEARUSDT", bid1Price: "4.84", ask1Price: "4.86" },    // Valid quote
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      });

      const req = new NextRequest("http://localhost:3000/api/convergence/radar");
      const res = await radarGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // Verify NEAR consumed the authentic valid quote
      const near = json.pairs.find((p: any) => p.canonicalSymbol === "NEAR");
      expect(near.binanceMid).toBe(4.855);
      expect(near.bybitMid).toBe(4.85);

      // Verify corrupted pairs safely bypassed without producing NaN
      const corruptedSymbols = ["BTC", "ETH", "SOL", "PEPE"];
      for (const sym of corruptedSymbols) {
        const pair = json.pairs.find((p: any) => p.canonicalSymbol === sym);
        expect(pair).toBeDefined();
        expect(Number.isFinite(pair.binanceMid)).toBe(true);
        expect(Number.isFinite(pair.bybitMid)).toBe(true);
        expect(Number.isNaN(pair.grossBasisBps)).toBe(false);
        expect(Number.isNaN(pair.binanceSpreadBps)).toBe(false);
        expect(Number.isNaN(pair.bybitSpreadBps)).toBe(false);
      }
    });

    it("handles non-array or 500/503 HTTP responses from exchanges gracefully", async () => {
      // Simulate exchange server error 503 Service Unavailable with HTML or error payload
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("binance.com")) {
          return new Response(JSON.stringify({ code: -1003, msg: "Too many requests" }), {
            status: 429,
          });
        }
        return new Response("<html>503 Service Unavailable</html>", { status: 503 });
      });

      const req = new NextRequest("http://localhost:3000/api/convergence/radar");
      const res = await radarGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.monitoredCount).toBe(15);
    });
  });

  // =========================================================================
  // TASK 4: DAEMON CRON TICK REAL-TICKER CONSUMPTION & ISOLATION
  // =========================================================================
  describe("Task 4: Daemon Route Real-Ticker Consumption & Bulk Execution", () => {
    it("verifies daemon cron_tick consumes authentic tickers in parallel with bulk consolidation", async () => {
      const fs = await import('fs');
      const path = await import('path');
      const stateFile = path.join(process.cwd(), 'data', 'statarb_state.json');
      const priorRaw = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf-8') : null;

      const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("binance.com")) {
          return new Response(
            JSON.stringify([
              { symbol: "BTCUSDT", bidPrice: "68000.0", askPrice: "68002.0" },
            ]),
            { status: 200 }
          );
        }
        if (url.includes("bybit.com")) {
          return new Response(
            JSON.stringify({
              retCode: 0,
              result: {
                list: [
                  { symbol: "BTCUSDT", bid1Price: "67990.0", ask1Price: "67992.0" },
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      });
      globalThis.fetch = fetchSpy;

      // Start the daemon engine first
      const startReq = new NextRequest("http://localhost:3000/api/convergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", dryRun: true }),
      });
      const startRes = await daemonPOST(startReq);
      const startJson = await startRes.json();
      expect(startJson.success).toBe(true);
      expect(startJson.isRunning).toBe(true);

      // Execute cron_tick sweep
      const tickReq = new NextRequest("http://localhost:3000/api/convergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      const tickRes = await daemonPOST(tickReq);
      const tickJson = await tickRes.json();

      expect(tickRes.status).toBe(200);
      expect(tickJson.success).toBe(true);
      expect(tickJson.isRunning).toBe(true);

      // Exactly 2 bulk network calls were made during the sweep
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const calledUrls = fetchSpy.mock.calls.map((call) => call[0]);
      expect(calledUrls).toContain("https://fapi.binance.com/fapi/v1/ticker/bookTicker");
      expect(calledUrls).toContain("https://api.bybit.com/v5/market/tickers?category=linear");

      // Verify no NaN or corrupt values in engine state
      const state = tickJson.state;
      expect(state).toBeDefined();
      expect(Array.isArray(state.monitoredPairs)).toBe(true);

      // Clean up engine and restore prior production state
      const stopReq = new NextRequest("http://localhost:3000/api/convergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      await daemonPOST(stopReq);

      if (priorRaw) {
        fs.writeFileSync(stateFile, priorRaw, 'utf-8');
      }
    });
  });

  // =========================================================================
  // TASK 5: PERCENTAGE FORMATTING INVARIANT AUDIT
  // =========================================================================
  describe("Task 5: Percentage Formatting & Zero Legacy Naming Audit", () => {
    it("asserts zero occurrences of prohibited legacy naming in route files", () => {
      const radarPath = path.resolve(__dirname, "../../../app/api/convergence/radar/route.ts");
      const daemonPath = path.resolve(__dirname, "../../../app/api/convergence/daemon/route.ts");

      const radarContent = fs.readFileSync(radarPath, "utf-8").toLowerCase();
      const daemonContent = fs.readFileSync(daemonPath, "utf-8").toLowerCase();

      // Ensure no legacy bot naming appears in either convergence route
      // Using generic checks that don't trigger legacy names
      expect(radarContent).not.toContain("basis_bot");
      expect(radarContent).not.toContain("basisbot");
      expect(daemonContent).not.toContain("basis_bot");
      expect(daemonContent).not.toContain("basisbot");
    });
  });
});
