import { describe, it, expect } from "vitest";
import {
  calculateAsymmetricMacroYield,
  calculateDirectionalSpread,
  evaluatePairwiseArbitrage,
  MIN_GROSS_SPREAD_BPS,
  ROUNDTRIP_TAKER_FEE_PCT,
  VenueRateInfo,
} from "../../lib/spreadCalculation";
import {
  computeMacroCycleInfo,
  formatIntervalPairKey,
  isIntervalPairAllowed,
  checkFundingSynchronization,
  SymbolFundingMeta,
} from "../../lib/exchangeFundingMeta";

describe("ADVERSARIAL CHALLENGE SUITE: Universal Multi-Interval Macro Yield & Direction Dominance", () => {
  const INTERVAL_SET = [1, 2, 4, 8];

  // =========================================================================
  // 1. ALL 16 INTERVAL PERMUTATIONS AND CYCLE MULTIPLIERS (N_A = H/I_A, N_B = H/I_B)
  // =========================================================================
  describe("1. All 16 Interval Permutations & Multiplier Matrix", () => {
    it("exhaustively validates N_A = H / I_A and N_B = H / I_B across all 16 permutations in computeMacroCycleInfo", () => {
      let testedPermutations = 0;
      for (const iA of INTERVAL_SET) {
        for (const iB of INTERVAL_SET) {
          const expectedH = Math.max(iA, iB);
          const expectedNA = expectedH / iA;
          const expectedNB = expectedH / iB;

          const info = computeMacroCycleInfo(iA, iB);

          expect(info.macroHorizonHours).toBe(expectedH);
          expect(info.cyclesA).toBe(expectedNA);
          expect(info.cyclesB).toBe(expectedNB);
          expect(info.ratioLabel).toBe(`${expectedNA}:${expectedNB}`);

          // Invariant: N_A * I_A === H and N_B * I_B === H
          expect(info.cyclesA * iA).toBe(info.macroHorizonHours);
          expect(info.cyclesB * iB).toBe(info.macroHorizonHours);

          testedPermutations++;
        }
      }
      expect(testedPermutations).toBe(16);
    });

    it("exhaustively validates N_A and N_B across all 16 permutations in calculateAsymmetricMacroYield", () => {
      let testedPermutations = 0;
      for (const iA of INTERVAL_SET) {
        for (const iB of INTERVAL_SET) {
          const expectedH = Math.max(iA, iB);
          const expectedNA = expectedH / iA;
          const expectedNB = expectedH / iB;

          const res = calculateAsymmetricMacroYield(0.05, iA, 0.05, iB);

          expect(res.macroHorizonHours).toBe(expectedH);
          expect(res.cyclesA).toBe(expectedNA);
          expect(res.cyclesB).toBe(expectedNB);

          testedPermutations++;
        }
      }
      expect(testedPermutations).toBe(16);
    });

    it("validates all 16 permutations under checkFundingSynchronization with Option 1 (ALL_ASYMMETRIC)", () => {
      const now = 1700000000000;
      let admittedCount = 0;

      for (const iA of INTERVAL_SET) {
        for (const iB of INTERVAL_SET) {
          const meta: SymbolFundingMeta = {
            symbol: `CHALLENGE-${iA}-${iB}`,
            fundingIntervalHours: Math.min(iA, iB),
            settlementCycleLabel: "Test",
            payoutsPerDay: 24 / Math.min(iA, iB),
            binanceIntervalHours: iA,
            bybitIntervalHours: iB,
            binanceNextFundingTime: now + 3600 * 1000,
            bybitNextFundingTime: now + 3600 * 1000,
          };

          const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
            intervalMode: "ALL_ASYMMETRIC",
          });

          expect(res.synchronized).toBe(true);
          expect(res.macroHorizonHours).toBe(Math.max(iA, iB));
          expect(res.cyclesA).toBe(Math.max(iA, iB) / iA);
          expect(res.cyclesB).toBe(Math.max(iA, iB) / iB);

          if (iA !== iB) {
            expect(res.isAsymmetric).toBe(true);
            expect(res.reason).toContain("Asymmetric funding schedule permitted");
          } else {
            expect(res.isAsymmetric).toBe(false);
          }

          admittedCount++;
        }
      }
      expect(admittedCount).toBe(16);
    });
  });

  // =========================================================================
  // 2. DIRECTION ASSIGNMENT UNDER COMPOUNDING INVERSION
  // =========================================================================
  describe("2. Direction Assignment Under Compounding Inversion", () => {
    it("inverts direction when Venue A has lower nominal rate but higher cycle compounding (1h +0.06% vs 4h +0.15%)", () => {
      // Nominal comparison: R_A (0.06%) < R_B (0.15%) -> naive rule: SHORT B / LONG A.
      // Compounded over H = 4h:
      // N_A * R_A = 4 * 0.06% = +0.24%
      // N_B * R_B = 1 * 0.15% = +0.15%
      // 0.24% > 0.15% -> Venue A yield dominates!
      // Capturing positive spread requires SHORT A (collect 4 * 0.06%) + LONG B (pay 1 * 0.15%).
      // Net cash flow = +0.24% - 0.15% = +0.09% (+9 bps).
      const res = calculateAsymmetricMacroYield(0.06, 1, 0.15, 4);

      expect(res.nominalRateA).toBe(0.06);
      expect(res.nominalRateB).toBe(0.15);
      expect(res.cyclesA).toBe(4);
      expect(res.cyclesB).toBe(1);
      expect(res.grossYieldBps).toBe(9);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B");
    });

    it("inverts direction in reverse permutation (4h +0.15% vs 1h +0.06%)", () => {
      // Nominal comparison: R_A (0.15%) > R_B (0.06%) -> naive rule: SHORT A / LONG B.
      // Compounded over H = 4h:
      // N_A * R_A = 1 * 0.15% = +0.15%
      // N_B * R_B = 4 * 0.06% = +0.24%
      // N_B * R_B (0.24%) > N_A * R_A (0.15%) -> Venue B yield dominates!
      // Must LONG A (pay 1 * 0.15%) + SHORT B (collect 4 * 0.06%).
      // Net cash flow = +0.24% - 0.15% = +0.09% (+9 bps).
      const res = calculateAsymmetricMacroYield(0.15, 4, 0.06, 1);

      expect(res.nominalRateA).toBe(0.15);
      expect(res.nominalRateB).toBe(0.06);
      expect(res.cyclesA).toBe(1);
      expect(res.cyclesB).toBe(4);
      expect(res.grossYieldBps).toBe(9);
      expect(res.recommendedDirection).toBe("LONG_A_SHORT_B");
    });

    it("inverts direction on 1h vs 8h aggressive compounding (1h +0.02% vs 8h +0.12%)", () => {
      // Nominal: R_A (0.02%) vs R_B (0.12%) (R_A is 6x smaller nominally!)
      // Compounded over H = 8h:
      // N_A * R_A = 8 * 0.02% = 0.16%
      // N_B * R_B = 1 * 0.12% = 0.12%
      // 0.16% > 0.12% -> Venue A dominates despite 6x lower nominal rate!
      const res = calculateAsymmetricMacroYield(0.02, 1, 0.12, 8);

      expect(res.cyclesA).toBe(8);
      expect(res.cyclesB).toBe(1);
      expect(res.grossYieldBps).toBe(4);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B");
    });

    it("inverts direction with negative rates (1h -0.05% vs 4h -0.15%)", () => {
      // Nominal: R_A (-0.05%) > R_B (-0.15%).
      // Compounded over H = 4h:
      // N_A * R_A = 4 * (-0.05%) = -0.20%
      // N_B * R_B = 1 * (-0.15%) = -0.15%
      // Since -0.15% > -0.20%, N_B * R_B > N_A * R_A.
      // Holding LONG A: receives -(-0.20%) = +0.20%.
      // Holding SHORT B: pays +(-0.15%) = -0.15%.
      // Net cash flow = +0.20% - 0.15% = +0.05% (+5 bps).
      // Direction must be LONG_A_SHORT_B.
      const res = calculateAsymmetricMacroYield(-0.05, 1, -0.15, 4);

      expect(res.grossYieldBps).toBe(5);
      expect(res.recommendedDirection).toBe("LONG_A_SHORT_B");
    });

    it("inverts direction with reverse negative rates (4h -0.15% vs 1h -0.05%)", () => {
      // Nominal: R_A (-0.15%) < R_B (-0.05%).
      // Compounded over H = 4h:
      // N_A * R_A = 1 * (-0.15%) = -0.15%
      // N_B * R_B = 4 * (-0.05%) = -0.20%
      // Since -0.15% > -0.20%, N_A * R_A > N_B * R_B.
      // Holding SHORT A: pays +(-0.15%) = -0.15%.
      // Holding LONG B: receives -(-0.20%) = +0.20%.
      // Net cash flow = +0.20% - 0.15% = +0.05% (+5 bps).
      // Direction must be SHORT_A_LONG_B.
      const res = calculateAsymmetricMacroYield(-0.15, 4, -0.05, 1);

      expect(res.grossYieldBps).toBe(5);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B");
    });

    it("propagates inverted direction accurately through evaluatePairwiseArbitrage", () => {
      const venues: VenueRateInfo[] = [
        { venue: "binance", label: "Binance", badge: "BN", color: "yellow", rate: 0.06, intervalHours: 1 },
        { venue: "bybit", label: "Bybit", badge: "BY", color: "orange", rate: 0.15, intervalHours: 4 },
      ];

      const result = evaluatePairwiseArbitrage(venues, 8, { intervalMode: "ALL_ASYMMETRIC" });
      expect(result.bestPair).not.toBeNull();
      const pair = result.bestPair!;

      // Verify that the pair reflects the macro compounded direction SHORT Binance / LONG Bybit
      expect(pair.direction).toBe("SHORT_A_LONG_B");
      expect(pair.directionLabel).toBe("Short BN / Long BY");
      expect(pair.spreadBps).toBe(9);
      expect(pair.nominalSpreadBps).toBe(9);
    });
  });

  // =========================================================================
  // 3. FEE HURDLE BOUNDARY CONDITIONS (34.9 bps, 35.0 bps, 35.1 bps)
  // =========================================================================
  describe("3. Fee Hurdle Boundary Conditions (34.9 bps, 35.0 bps, 35.1 bps)", () => {
    it("strictly rejects 34.9 bps in calculateAsymmetricMacroYield", () => {
      // 0.349% on 8h vs 8h = 34.9 bps
      const res = calculateAsymmetricMacroYield(0.349, 8, 0, 8);
      expect(res.grossYieldBps).toBe(34.9);
      expect(res.netYieldBps).toBe(-0.1);
      expect(res.clearsFeeHurdle).toBe(false);
    });

    it("strictly clears 35.0 bps in calculateAsymmetricMacroYield", () => {
      // 0.350% on 8h vs 8h = 35.0 bps
      const res = calculateAsymmetricMacroYield(0.350, 8, 0, 8);
      expect(res.grossYieldBps).toBe(35.0);
      expect(res.netYieldBps).toBe(0.0);
      expect(res.clearsFeeHurdle).toBe(true);
    });

    it("strictly clears 35.1 bps in calculateAsymmetricMacroYield", () => {
      // 0.351% on 8h vs 8h = 35.1 bps
      const res = calculateAsymmetricMacroYield(0.351, 8, 0, 8);
      expect(res.grossYieldBps).toBe(35.1);
      expect(res.netYieldBps).toBe(0.1);
      expect(res.clearsFeeHurdle).toBe(true);
    });

    it("strictly verifies boundary conditions on asymmetric 1h vs 4h cycle (N_A = 4, N_B = 1)", () => {
      // 34.9 bps gross: R_A = 0.08725% -> 4 * 0.08725% = 0.349% = 34.9 bps
      const resSub = calculateAsymmetricMacroYield(0.08725, 1, 0, 4);
      expect(resSub.grossYieldBps).toBe(34.9);
      expect(resSub.clearsFeeHurdle).toBe(false);

      // 35.0 bps gross: R_A = 0.08750% -> 4 * 0.08750% = 0.350% = 35.0 bps
      const resAt = calculateAsymmetricMacroYield(0.08750, 1, 0, 4);
      expect(resAt.grossYieldBps).toBe(35.0);
      expect(resAt.clearsFeeHurdle).toBe(true);

      // 35.1 bps gross: R_A = 0.08775% -> 4 * 0.08775% = 0.351% = 35.1 bps
      const resSup = calculateAsymmetricMacroYield(0.08775, 1, 0, 4);
      expect(resSup.grossYieldBps).toBe(35.1);
      expect(resSup.clearsFeeHurdle).toBe(true);
    });

    it("verifies fee hurdle boundaries in evaluatePairwiseArbitrage qualification", () => {
      // Case 1: 34.9 bps candidate (Must be disqualified from validPairs / bestPair with clearsFeeFilter: false)
      const venues349: VenueRateInfo[] = [
        { venue: "binance", label: "Binance", badge: "BN", color: "yellow", rate: 0.349, intervalHours: 8 },
        { venue: "bybit", label: "Bybit", badge: "BY", color: "orange", rate: 0, intervalHours: 8 },
      ];
      const res349 = evaluatePairwiseArbitrage(venues349, 8);
      expect(res349.allPairs[0].spreadBps).toBe(34.9);
      expect(res349.allPairs[0].clearsFeeHurdle).toBe(false);
      expect(res349.allPairs[0].clearsFeeFilter).toBe(false);

      // Case 2: 35.0 bps candidate (Must clear fee hurdle and filter)
      const venues350: VenueRateInfo[] = [
        { venue: "binance", label: "Binance", badge: "BN", color: "yellow", rate: 0.350, intervalHours: 8 },
        { venue: "bybit", label: "Bybit", badge: "BY", color: "orange", rate: 0, intervalHours: 8 },
      ];
      const res350 = evaluatePairwiseArbitrage(venues350, 8);
      expect(res350.allPairs[0].spreadBps).toBe(35.0);
      expect(res350.allPairs[0].clearsFeeHurdle).toBe(true);
      expect(res350.allPairs[0].clearsFeeFilter).toBe(true);
      expect(res350.bestPair).not.toBeNull();

      // Case 3: 35.1 bps candidate (Must clear fee hurdle and filter)
      const venues351: VenueRateInfo[] = [
        { venue: "binance", label: "Binance", badge: "BN", color: "yellow", rate: 0.351, intervalHours: 8 },
        { venue: "bybit", label: "Bybit", badge: "BY", color: "orange", rate: 0, intervalHours: 8 },
      ];
      const res351 = evaluatePairwiseArbitrage(venues351, 8);
      expect(res351.allPairs[0].spreadBps).toBe(35.1);
      expect(res351.allPairs[0].clearsFeeHurdle).toBe(true);
      expect(res351.allPairs[0].clearsFeeFilter).toBe(true);
      expect(res351.bestPair).not.toBeNull();
    });

    it("verifies fee hurdle behavior in checkFundingSynchronization optional asymmetricYield", () => {
      const now = 1700000000000;
      const meta: SymbolFundingMeta = {
        symbol: "BTCUSDT",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      // 34.9 bps test
      const res349 = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        rateA: 0.349,
        rateB: 0,
        minGrossSpreadBps: 35.0,
      });
      expect(res349.asymmetricYield?.grossYieldBps).toBe(34.9);
      expect(res349.asymmetricYield?.clearsFeeHurdle).toBe(false);

      // 35.1 bps test
      const res351 = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        rateA: 0.351,
        rateB: 0,
        minGrossSpreadBps: 35.0,
      });
      expect(res351.asymmetricYield?.grossYieldBps).toBe(35.1);
      expect(res351.asymmetricYield?.clearsFeeHurdle).toBe(true);

      // 35.0 bps boundary test:
      // NOTE: In checkFundingSynchronization (exchangeFundingMeta.ts:446),
      // the formula is `grossYieldBps >= feeHurdleBps && netYieldBps > 0`.
      // At exactly 35.0 bps, netYieldBps = 35.0 - 35.0 = 0, so netYieldBps > 0 evaluates to false!
      // We empirically record whether exchangeFundingMeta.ts:446 passes or fails 35.0 bps:
      const res350 = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        rateA: 0.350,
        rateB: 0,
        minGrossSpreadBps: 35.0,
      });
      expect(res350.asymmetricYield?.grossYieldBps).toBe(35.0);
      expect(res350.asymmetricYield?.clearsFeeHurdle).toBe(true);
    });

    it("evaluates NaN handling in checkFundingSynchronization", () => {
      const now = 1700000000000;
      const meta: SymbolFundingMeta = {
        symbol: "BTCUSDT",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      const resNaN = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        rateA: NaN,
        rateB: 0.10,
        minGrossSpreadBps: 35.0,
      });
      // Test if asymmetricYield cleanly sanitized NaN or returned NaN
      expect(isNaN(resNaN.asymmetricYield?.grossYieldBps ?? 0)).toBe(false);
    });
  });

  // =========================================================================
  // 4. EXTREME RATES (BOTH POSITIVE, BOTH NEGATIVE, OPPOSITE SIGNS, ZERO, NaN)
  // =========================================================================
  describe("4. Extreme Rates & Edge Cases", () => {
    it("handles extreme positive rates (+5.00% vs +1.00% on 1h vs 4h)", () => {
      // H = 4. N_A = 4, N_B = 1.
      // N_A * R_A = 4 * 5.00% = 20.00%.
      // N_B * R_B = 1 * 1.00% = 1.00%.
      // Gross = |20 - 1| = 19.00% = 1900 bps.
      const res = calculateAsymmetricMacroYield(5.00, 1, 1.00, 4);
      expect(res.grossYieldBps).toBe(1900);
      expect(res.netYieldBps).toBe(1865);
      expect(res.clearsFeeHurdle).toBe(true);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B");
    });

    it("handles extreme negative rates (-5.00% vs -1.00% on 1h vs 4h)", () => {
      // H = 4. N_A = 4, N_B = 1.
      // N_A * R_A = 4 * (-5.00%) = -20.00%.
      // N_B * R_B = 1 * (-1.00%) = -1.00%.
      // Gross = |-20 - (-1)| = 19.00% = 1900 bps.
      // N_B * R_B (-1%) > N_A * R_A (-20%) => LONG_A_SHORT_B.
      const res = calculateAsymmetricMacroYield(-5.00, 1, -1.00, 4);
      expect(res.grossYieldBps).toBe(1900);
      expect(res.netYieldBps).toBe(1865);
      expect(res.clearsFeeHurdle).toBe(true);
      expect(res.recommendedDirection).toBe("LONG_A_SHORT_B");
    });

    it("handles extreme opposite signs (+5.00% vs -5.00% on 4h vs 4h)", () => {
      // H = 4. N_A = 1, N_B = 1.
      // Gross = |5 - (-5)| = 10.00% = 1000 bps.
      // 5 >= -5 => SHORT_A_LONG_B.
      const res = calculateAsymmetricMacroYield(5.00, 4, -5.00, 4);
      expect(res.grossYieldBps).toBe(1000);
      expect(res.clearsFeeHurdle).toBe(true);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B");
    });

    it("handles zero rates gracefully (both zero)", () => {
      const res = calculateAsymmetricMacroYield(0, 1, 0, 8);
      expect(res.grossYieldBps).toBe(0);
      expect(res.netYieldBps).toBe(-35);
      expect(res.clearsFeeHurdle).toBe(false);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B"); // 0 >= 0
    });

    it("handles zero on one side with positive rate on the other (0% vs +0.10% on 4h vs 1h)", () => {
      // N_A = 1, N_B = 4.
      // N_A * R_A = 0.
      // N_B * R_B = 4 * 0.10% = 0.40%.
      // Gross = 0.40% = 40 bps.
      // Direction: N_B * R_B > N_A * R_A => LONG_A_SHORT_B.
      const res = calculateAsymmetricMacroYield(0, 4, 0.10, 1);
      expect(res.grossYieldBps).toBe(40);
      expect(res.clearsFeeHurdle).toBe(true);
      expect(res.recommendedDirection).toBe("LONG_A_SHORT_B");
    });

    it("handles NaN rates safely in calculateAsymmetricMacroYield", () => {
      // Rate A is NaN: should default to 0
      const resA = calculateAsymmetricMacroYield(NaN, 1, 0.40, 4);
      expect(resA.nominalRateA).toBe(0);
      expect(resA.nominalRateB).toBe(0.40);
      expect(resA.grossYieldBps).toBe(40);
      expect(resA.clearsFeeHurdle).toBe(true);
      expect(resA.recommendedDirection).toBe("LONG_A_SHORT_B");

      // Rate B is NaN: should default to 0
      const resB = calculateAsymmetricMacroYield(0.40, 4, NaN, 1);
      expect(resB.nominalRateA).toBe(0.40);
      expect(resB.nominalRateB).toBe(0);
      expect(resB.grossYieldBps).toBe(40);
      expect(resB.clearsFeeHurdle).toBe(true);
      expect(resB.recommendedDirection).toBe("SHORT_A_LONG_B");

      // Both NaN: should default to 0
      const resBoth = calculateAsymmetricMacroYield(NaN, 2, NaN, 4);
      expect(resBoth.nominalRateA).toBe(0);
      expect(resBoth.nominalRateB).toBe(0);
      expect(resBoth.grossYieldBps).toBe(0);
      expect(resBoth.clearsFeeHurdle).toBe(false);
    });

    it("handles invalid or non-positive interval parameters safely", () => {
      // Invalid/zero/negative intervals should fallback to default 8h
      const resInvalid = calculateAsymmetricMacroYield(0.10, -4, 0.10, 0);
      expect(resInvalid.macroHorizonHours).toBe(8);
      expect(resInvalid.cyclesA).toBe(1);
      expect(resInvalid.cyclesB).toBe(1);

      const infoInvalid = computeMacroCycleInfo(0, -1);
      expect(infoInvalid.macroHorizonHours).toBe(8);
      expect(infoInvalid.cyclesA).toBe(1);
      expect(infoInvalid.cyclesB).toBe(1);
    });
  });

  // =========================================================================
  // 5. OPTION 2 (STRICT SYNC ONLY) GUARDRAIL ENFORCEMENT
  // =========================================================================
  describe("5. Option 2 (Strict Sync Only) Guardrail Enforcement", () => {
    it("disqualifies all 12 asymmetric interval permutations under STRICT_SYNC_ONLY", () => {
      const now = 1700000000000;
      let rejectedCount = 0;

      for (const iA of INTERVAL_SET) {
        for (const iB of INTERVAL_SET) {
          if (iA === iB) continue; // Only test mismatched pairs

          const meta: SymbolFundingMeta = {
            symbol: `STRICT-${iA}-${iB}`,
            fundingIntervalHours: Math.min(iA, iB),
            settlementCycleLabel: "Test",
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
          expect(res.reason).toContain("[STRICT_SYNC_REJECTED] Interval mismatch");
          rejectedCount++;
        }
      }
      expect(rejectedCount).toBe(12);
    });

    it("admits symmetric intervals with countdown delta <= 60s under STRICT_SYNC_ONLY", () => {
      const now = 1700000000000;
      for (const interval of INTERVAL_SET) {
        const meta: SymbolFundingMeta = {
          symbol: `STRICT-PASS-${interval}`,
          fundingIntervalHours: interval,
          settlementCycleLabel: `${interval}h`,
          payoutsPerDay: 24 / interval,
          binanceIntervalHours: interval,
          bybitIntervalHours: interval,
          binanceNextFundingTime: now + 3600 * 1000,
          bybitNextFundingTime: now + 3600 * 1000 + 45 * 1000, // 45s delta <= 60s
        };

        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });

        expect(res.synchronized).toBe(true);
        expect(res.isAsymmetric).toBe(false);
        expect(res.firstSettlementVenue).toBe("Simultaneous");
      }
    });

    it("rejects symmetric intervals with countdown delta > 60s under STRICT_SYNC_ONLY", () => {
      const now = 1700000000000;
      const meta: SymbolFundingMeta = {
        symbol: "STRICT-FAIL-COUNTDOWN",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000 + 61 * 1000, // 61s delta > 60s
      };

      const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });

      expect(res.synchronized).toBe(false);
      expect(res.isAsymmetric).toBe(true);
      expect(res.reason).toContain("[STRICT_SYNC_REJECTED] Countdown desynchronization");
    });
  });
});
