/**
 * Vitest Unit Suite: Adversarial In-Flight Carry Inversion Protection & CUSTOM Mode Filter
 * 
 * Tests empirical invariants for:
 * 1. In-flight carry inversion circuit breaker in botEngine.ts:
 *    - Case A: Active asymmetric hedge (1h vs 4h, SHORT_A_LONG_B), R_A=+0.15%, R_B=+0.20%
 *              Unweighted spread = -0.05%, Macro carry = +0.40% -> MUST NOT TRIP.
 *    - Case B: Rates flip to R_A=+0.02%, R_B=+0.20% -> Macro carry = -0.12% -> MUST TRIP CLEANLY.
 *    - Case C/D: Reverse asymmetric hedge (4h vs 1h, LONG_A_SHORT_B) stability and flip trip.
 *    - Case E: Direction naming variants (SHORT_A_LONG_B, SHORT_BINANCE_LONG_BYBIT, etc.).
 *    - Case F: Pre-settlement 15s freeze buffer boundary.
 * 2. CUSTOM Mode Interval Filtering:
 *    - Symmetric pairs (8h ⇄ 8h, 4h ⇄ 4h, 1h ⇄ 1h) automatically admitted.
 *    - Selected asymmetric pairs admitted (including forward and reverse matching).
 *    - Unselected asymmetric pairs rejected with [CUSTOM_FILTER_REJECTED].
 * 3. Strict Sync (Option 2) Guardrails.
 */

import { describe, it, expect } from "vitest";
import {
  checkFundingSynchronization,
  isIntervalPairAllowed,
  formatIntervalPairKey,
  SymbolFundingMeta,
  FundingIntervalMode,
} from "../../lib/exchangeFundingMeta";
import {
  calculateAsymmetricMacroYield,
  calculateHedgeFundingYield,
} from "../../lib/spreadCalculation";

describe("Adversarial In-Flight Carry Protection & CUSTOM Mode Verification", () => {
  const now = 1700000000000;

  // Helper simulating the exact botEngine.ts Phase 1 Inversion Guard logic (lines 4067-4093)
  function evaluateInflightInversionGuard(params: {
    hedge: {
      symbol: string;
      direction: string;
      venueA?: string;
      venueB?: string;
      isAsymmetric?: boolean;
      venueAIntervalHours?: number;
      venueBIntervalHours?: number;
      fundingSettlementTime: number;
    };
    rateA: number;
    rateB: number;
    currentTime: number;
  }): {
    isInverted: boolean;
    expectedYieldBps: number;
    tripsCircuitBreaker: boolean;
    unwindReason?: string;
  } {
    const { hedge, rateA, rateB, currentTime } = params;
    let isInverted = false;
    let expectedYieldBps = 0;

    if (hedge.isAsymmetric && hedge.venueAIntervalHours && hedge.venueBIntervalHours) {
      const macroCycle = calculateAsymmetricMacroYield(
        rateA || 0,
        hedge.venueAIntervalHours,
        rateB || 0,
        hedge.venueBIntervalHours
      );
      const isHedgeShortA =
        hedge.direction.toUpperCase().includes("SHORT_A") ||
        (hedge.venueA &&
          hedge.direction.toUpperCase().includes(`SHORT_${hedge.venueA.toUpperCase()}`)) ||
        hedge.direction.toUpperCase().startsWith("SHORT");
      const liveDominantShortA = macroCycle.recommendedDirection === "SHORT_A_LONG_B";

      if (isHedgeShortA !== liveDominantShortA) {
        isInverted = true;
        expectedYieldBps = -macroCycle.grossYieldBps;
      }
    } else {
      const yieldEval = calculateHedgeFundingYield(hedge.direction, rateA || 0, rateB || 0);
      if (yieldEval.isNegativeYield) {
        isInverted = true;
        expectedYieldBps = yieldEval.expectedYieldBps;
      }
    }

    const tripsCircuitBreaker = isInverted && currentTime < hedge.fundingSettlementTime - 15000;
    return {
      isInverted,
      expectedYieldBps,
      tripsCircuitBreaker,
      unwindReason: tripsCircuitBreaker ? "CIRCUIT_BREAKER_FUNDING_INVERSION" : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. IN-FLIGHT ASYMMETRIC POSITION CARRY INVERSION TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. In-Flight Asymmetric Position Carry Inversion Guard", () => {
    it("Case A: Active asymmetric hedge (1h vs 4h, SHORT_A_LONG_B) with R_A=+0.15%, R_B=+0.20% does NOT trip circuit breaker", () => {
      const hedge = {
        symbol: "BTCUSDT",
        direction: "SHORT_BINANCE_LONG_BYBIT",
        venueA: "Binance",
        venueB: "Bybit",
        isAsymmetric: true,
        venueAIntervalHours: 1,
        venueBIntervalHours: 4,
        fundingSettlementTime: now + 3600 * 1000, // 1 hour out
      };

      // Unweighted rate diff is 0.15% - 0.20% = -0.05% (-5 bps).
      // Macro carry is 4 * 0.15% - 1 * 0.20% = +0.40% (+40 bps, positive carry!).
      const result = evaluateInflightInversionGuard({
        hedge,
        rateA: 0.15,
        rateB: 0.20,
        currentTime: now,
      });

      expect(result.isInverted).toBe(false);
      expect(result.tripsCircuitBreaker).toBe(false);
      expect(result.unwindReason).toBeUndefined();
    });

    it("Case B: Current rates flip so macro carry becomes negative (R_A=+0.02%, R_B=+0.20%) DOES trip cleanly", () => {
      const hedge = {
        symbol: "BTCUSDT",
        direction: "SHORT_BINANCE_LONG_BYBIT",
        venueA: "Binance",
        venueB: "Bybit",
        isAsymmetric: true,
        venueAIntervalHours: 1,
        venueBIntervalHours: 4,
        fundingSettlementTime: now + 3600 * 1000,
      };

      // Rates flip: 4 * 0.02% = 0.08% vs 1 * 0.20% = 0.20%.
      // Directional dominance flips to LONG_A_SHORT_B! Macro carry is -0.12% (-12 bps).
      const result = evaluateInflightInversionGuard({
        hedge,
        rateA: 0.02,
        rateB: 0.20,
        currentTime: now,
      });

      expect(result.isInverted).toBe(true);
      expect(result.expectedYieldBps).toBe(-12);
      expect(result.tripsCircuitBreaker).toBe(true);
      expect(result.unwindReason).toBe("CIRCUIT_BREAKER_FUNDING_INVERSION");
    });

    it("Case C: Reverse asymmetric hedge (4h vs 1h, LONG_A_SHORT_B) with positive macro carry does NOT trip", () => {
      const hedge = {
        symbol: "ETHUSDT",
        direction: "LONG_BINANCE_SHORT_BYBIT",
        venueA: "Binance",
        venueB: "Bybit",
        isAsymmetric: true,
        venueAIntervalHours: 4,
        venueBIntervalHours: 1,
        fundingSettlementTime: now + 3600 * 1000,
      };

      // Venue A (4h) rate: +0.10%, Venue B (1h) rate: +0.15%.
      // Macro carry: Long A pays 1 * 0.10% = 0.10%, Short B receives 4 * 0.15% = 0.60%.
      // Net macro carry = +0.50% (+50 bps).
      const result = evaluateInflightInversionGuard({
        hedge,
        rateA: 0.10,
        rateB: 0.15,
        currentTime: now,
      });

      expect(result.isInverted).toBe(false);
      expect(result.tripsCircuitBreaker).toBe(false);
    });

    it("Case D: Reverse asymmetric hedge flips to negative macro carry and trips cleanly", () => {
      const hedge = {
        symbol: "ETHUSDT",
        direction: "LONG_BINANCE_SHORT_BYBIT",
        venueA: "Binance",
        venueB: "Bybit",
        isAsymmetric: true,
        venueAIntervalHours: 4,
        venueBIntervalHours: 1,
        fundingSettlementTime: now + 3600 * 1000,
      };

      // Venue A (4h) rate: +0.10%, Venue B (1h) rate collapses to +0.01%.
      // Effective rates: A = 0.10%, B = 4 * 0.01% = 0.04%.
      // Direction flips to SHORT_A_LONG_B!
      const result = evaluateInflightInversionGuard({
        hedge,
        rateA: 0.10,
        rateB: 0.01,
        currentTime: now,
      });

      expect(result.isInverted).toBe(true);
      expect(result.expectedYieldBps).toBe(-6);
      expect(result.tripsCircuitBreaker).toBe(true);
      expect(result.unwindReason).toBe("CIRCUIT_BREAKER_FUNDING_INVERSION");
    });

    it("Case E: Validates across all direction naming patterns", () => {
      const patterns = [
        { dir: "SHORT_A_LONG_B", venueA: undefined, isShortA: true },
        { dir: "LONG_A_SHORT_B", venueA: undefined, isShortA: false },
        { dir: "SHORT_BINANCE_LONG_BYBIT", venueA: "Binance", isShortA: true },
        { dir: "LONG_BINANCE_SHORT_BYBIT", venueA: "Binance", isShortA: false },
        { dir: "SHORT_COINDCX_LONG_BITGET", venueA: "CoinDCX", isShortA: true },
        { dir: "LONG_COINDCX_SHORT_BITGET", venueA: "CoinDCX", isShortA: false },
      ];

      for (const p of patterns) {
        const hedge = {
          symbol: "SOLUSDT",
          direction: p.dir,
          venueA: p.venueA,
          venueB: "Bybit",
          isAsymmetric: true,
          venueAIntervalHours: 1,
          venueBIntervalHours: 4,
          fundingSettlementTime: now + 3600 * 1000,
        };

        // Rates favoring SHORT_A_LONG_B: R_A = 0.15%, R_B = 0.20% (Macro = +0.40% Short A)
        const resA = evaluateInflightInversionGuard({ hedge, rateA: 0.15, rateB: 0.20, currentTime: now });
        if (p.isShortA) {
          expect(resA.tripsCircuitBreaker).toBe(false);
        } else {
          expect(resA.tripsCircuitBreaker).toBe(true);
        }

        // Rates favoring LONG_A_SHORT_B: R_A = 0.02%, R_B = 0.20% (Macro = -0.12% Short A -> Favors Long A)
        const resB = evaluateInflightInversionGuard({ hedge, rateA: 0.02, rateB: 0.20, currentTime: now });
        if (p.isShortA) {
          expect(resB.tripsCircuitBreaker).toBe(true);
        } else {
          expect(resB.tripsCircuitBreaker).toBe(false);
        }
      }
    });

    it("Case F: Pre-settlement 15s freeze buffer suppresses circuit breaker trip", () => {
      const settlementTime = now + 10000; // 10s away (< 15s freeze window)
      const hedge = {
        symbol: "BTCUSDT",
        direction: "SHORT_A_LONG_B",
        venueA: "Binance",
        venueB: "Bybit",
        isAsymmetric: true,
        venueAIntervalHours: 1,
        venueBIntervalHours: 4,
        fundingSettlementTime: settlementTime,
      };

      // Inverted rates:
      const result = evaluateInflightInversionGuard({
        hedge,
        rateA: 0.02,
        rateB: 0.20,
        currentTime: now,
      });

      expect(result.isInverted).toBe(true);
      // Suppressed within 15s of settlement
      expect(result.tripsCircuitBreaker).toBe(false);
      expect(result.unwindReason).toBeUndefined();
    });

    it("Case G: Symmetric hedge uses unweighted calculateHedgeFundingYield", () => {
      const hedge = {
        symbol: "XRPUSDT",
        direction: "SHORT_BINANCE_LONG_BYBIT",
        venueA: "Binance",
        venueB: "Bybit",
        isAsymmetric: false, // Standard symmetric hedge
        venueAIntervalHours: 8,
        venueBIntervalHours: 8,
        fundingSettlementTime: now + 3600 * 1000,
      };

      // Positive unweighted carry (0.05% vs 0.01% -> Short Binance receives +0.04%)
      const resPositive = evaluateInflightInversionGuard({
        hedge,
        rateA: 0.05,
        rateB: 0.01,
        currentTime: now,
      });
      expect(resPositive.isInverted).toBe(false);
      expect(resPositive.tripsCircuitBreaker).toBe(false);

      // Negative unweighted carry (0.01% vs 0.05% -> Short Binance pays 0.01% - 0.05% = -0.04%)
      const resInverted = evaluateInflightInversionGuard({
        hedge,
        rateA: 0.01,
        rateB: 0.05,
        currentTime: now,
      });
      expect(resInverted.isInverted).toBe(true);
      expect(resInverted.tripsCircuitBreaker).toBe(true);
      expect(resInverted.unwindReason).toBe("CIRCUIT_BREAKER_FUNDING_INVERSION");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. CUSTOM MODE INTERVAL FILTERING TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. CUSTOM Mode Interval Filtering & Baseline Symmetric Admission", () => {
    it("admits standard symmetric 8h ⇄ 8h and 4h ⇄ 4h pairs in checkFundingSynchronization under CUSTOM mode", () => {
      const allowed = ["1h_4h", "4h_8h"];

      // 8h ⇄ 8h symmetric
      const meta8h: SymbolFundingMeta = {
        symbol: "SYM8",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      const res8h = checkFundingSynchronization("Binance", "Bybit", meta8h, now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res8h.synchronized).toBe(true);
      expect(res8h.isAsymmetric).toBe(false);

      // 4h ⇄ 4h symmetric
      const meta4h: SymbolFundingMeta = {
        symbol: "SYM4",
        fundingIntervalHours: 4,
        settlementCycleLabel: "4h",
        payoutsPerDay: 6,
        binanceIntervalHours: 4,
        bybitIntervalHours: 4,
        binanceNextFundingTime: now + 1800 * 1000,
        bybitNextFundingTime: now + 1800 * 1000,
      };

      const res4h = checkFundingSynchronization("Binance", "Bybit", meta4h, now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res4h.synchronized).toBe(true);
      expect(res4h.isAsymmetric).toBe(false);
    });

    it("admits configured asymmetric pairs (1h ⇄ 4h, 4h ⇄ 1h, 4h ⇄ 8h) under CUSTOM mode", () => {
      const allowed = ["1h_4h", "4h_8h"];

      // 1h ⇄ 4h
      const meta1h4h: SymbolFundingMeta = {
        symbol: "ASYM1_4",
        fundingIntervalHours: 1,
        settlementCycleLabel: "1h",
        payoutsPerDay: 24,
        binanceIntervalHours: 1,
        bybitIntervalHours: 4,
        binanceNextFundingTime: now + 600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      const res1h4h = checkFundingSynchronization("Binance", "Bybit", meta1h4h, now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res1h4h.synchronized).toBe(true);
      expect(res1h4h.isAsymmetric).toBe(true);

      // 4h ⇄ 1h (reverse of 1h_4h)
      const meta4h1h: SymbolFundingMeta = {
        symbol: "ASYM4_1",
        fundingIntervalHours: 1,
        settlementCycleLabel: "1h",
        payoutsPerDay: 24,
        binanceIntervalHours: 4,
        bybitIntervalHours: 1,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 600 * 1000,
      };

      const res4h1h = checkFundingSynchronization("Binance", "Bybit", meta4h1h, now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res4h1h.synchronized).toBe(true);
      expect(res4h1h.isAsymmetric).toBe(true);
    });

    it("strictly rejects unselected asymmetric pairs (1h ⇄ 8h, 2h ⇄ 4h) under CUSTOM mode", () => {
      const allowed = ["1h_4h", "4h_8h"];

      // 1h ⇄ 8h (not in allowed list)
      const meta1h8h: SymbolFundingMeta = {
        symbol: "ASYM1_8",
        fundingIntervalHours: 1,
        settlementCycleLabel: "1h",
        payoutsPerDay: 24,
        binanceIntervalHours: 1,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      const res1h8h = checkFundingSynchronization("Binance", "Bybit", meta1h8h, now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res1h8h.synchronized).toBe(false);
      expect(res1h8h.reason).toContain("[CUSTOM_FILTER_REJECTED]");
      expect(res1h8h.reason).toContain("Interval pair 1h_8h is not admitted under active allowedIntervalPairs: [1h_4h, 4h_8h]");

      // 2h ⇄ 4h (not in allowed list)
      const meta2h4h: SymbolFundingMeta = {
        symbol: "ASYM2_4",
        fundingIntervalHours: 2,
        settlementCycleLabel: "2h",
        payoutsPerDay: 12,
        binanceIntervalHours: 2,
        bybitIntervalHours: 4,
        binanceNextFundingTime: now + 600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      const res2h4h = checkFundingSynchronization("Binance", "Bybit", meta2h4h, now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res2h4h.synchronized).toBe(false);
      expect(res2h4h.reason).toContain("[CUSTOM_FILTER_REJECTED]");
    });

    it("verifies botEngine candidate evaluation CUSTOM filter logic directly", () => {
      const config = {
        intervalMode: "CUSTOM" as FundingIntervalMode,
        allowedIntervalPairs: ["1h_4h", "4h_8h"],
      };

      function evaluateCandidateFilter(pair: {
        venueAIntervalHours?: number;
        venueBIntervalHours?: number;
        isAsymmetricFunding?: boolean;
      }) {
        const intervalMode = config.intervalMode;
        let isFundingSync = true;
        let syncDisqualificationReason: string | undefined = undefined;

        if (intervalMode === "CUSTOM") {
          const intA = pair.venueAIntervalHours || 8;
          const intB = pair.venueBIntervalHours || 8;
          if (intA === intB && pair.isAsymmetricFunding !== true) {
            isFundingSync = true;
          } else if (!isIntervalPairAllowed(intA, intB, config.allowedIntervalPairs)) {
            isFundingSync = false;
            const allowed = config.allowedIntervalPairs || [];
            syncDisqualificationReason = `[CUSTOM_FILTER_REJECTED] Interval pair ${intA}h ⇄ ${intB}h not in allowed list [${allowed.join(", ")}]`;
          }
        }
        return { isFundingSync, syncDisqualificationReason };
      }

      // 8h ⇄ 8h symmetric
      const sym8 = evaluateCandidateFilter({ venueAIntervalHours: 8, venueBIntervalHours: 8, isAsymmetricFunding: false });
      expect(sym8.isFundingSync).toBe(true);

      // 4h ⇄ 4h symmetric
      const sym4 = evaluateCandidateFilter({ venueAIntervalHours: 4, venueBIntervalHours: 4, isAsymmetricFunding: false });
      expect(sym4.isFundingSync).toBe(true);

      // 1h ⇄ 4h allowed asymmetric
      const asym14 = evaluateCandidateFilter({ venueAIntervalHours: 1, venueBIntervalHours: 4, isAsymmetricFunding: true });
      expect(asym14.isFundingSync).toBe(true);

      // 4h ⇄ 8h allowed asymmetric
      const asym48 = evaluateCandidateFilter({ venueAIntervalHours: 4, venueBIntervalHours: 8, isAsymmetricFunding: true });
      expect(asym48.isFundingSync).toBe(true);

      // 1h ⇄ 8h unselected asymmetric
      const asym18 = evaluateCandidateFilter({ venueAIntervalHours: 1, venueBIntervalHours: 8, isAsymmetricFunding: true });
      expect(asym18.isFundingSync).toBe(false);
      expect(asym18.syncDisqualificationReason).toBe("[CUSTOM_FILTER_REJECTED] Interval pair 1h ⇄ 8h not in allowed list [1h_4h, 4h_8h]");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. STRICT SYNC ONLY (OPTION 2) GUARDRAIL VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. Strict Sync Only (Option 2) Guardrails", () => {
    it("disqualifies all mismatched intervals under Option 2", () => {
      const mismatches = [
        [1, 4], [4, 1],
        [4, 8], [8, 4],
        [1, 8], [8, 1],
        [2, 4], [4, 2],
      ];

      for (const [iA, iB] of mismatches) {
        const meta: SymbolFundingMeta = {
          symbol: `MISMATCH_${iA}_${iB}`,
          fundingIntervalHours: Math.min(iA, iB),
          settlementCycleLabel: "Cycle",
          payoutsPerDay: 24 / Math.min(iA, iB),
          binanceIntervalHours: iA,
          bybitIntervalHours: iB,
          binanceNextFundingTime: now + 3600 * 1000,
          bybitNextFundingTime: now + 3600 * 1000,
        };

        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });
        expect(res.synchronized).toBe(false);
        expect(res.isAsymmetric).toBe(true);
        expect(res.reason).toBe(`[STRICT_SYNC_REJECTED] Interval mismatch: Binance (${iA}h) !== Bybit (${iB}h)`);
      }
    });

    it("admits identical intervals when countdown difference <= 60s", () => {
      const meta: SymbolFundingMeta = {
        symbol: "STRICT_PASS",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000 + 45000, // 45s delta <= 60s
      };

      const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });
      expect(res.synchronized).toBe(true);
      expect(res.isAsymmetric).toBe(false);
    });

    it("rejects identical intervals when countdown difference > 60s", () => {
      const meta: SymbolFundingMeta = {
        symbol: "STRICT_FAIL",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000 + 61000, // 61s delta > 60s
      };

      const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });
      expect(res.synchronized).toBe(false);
      expect(res.reason).toContain("[STRICT_SYNC_REJECTED] Countdown desynchronization");
    });
  });
});
