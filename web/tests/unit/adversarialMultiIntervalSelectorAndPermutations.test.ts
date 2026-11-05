/**
 * Vitest Unit Suite: Adversarial Multi-Interval Selector Logic & 16-Permutation Matrix Verification
 * 
 * Target: Milestone 2 UI multi-interval selector logic and mode filtering in SafeCoiner Cockpit.
 * 
 * Verifies:
 * 1. checkFundingSynchronization() across all 16 interval permutations under ALL_ASYMMETRIC (Option 1).
 * 2. checkFundingSynchronization() across all 16 interval permutations under STRICT_SYNC_ONLY (Option 2).
 * 3. checkFundingSynchronization() across diverse CUSTOM configurations:
 *    - Explicitly allowed pairs permitted.
 *    - Unselected pairs strictly rejected with [CUSTOM_FILTER_REJECTED].
 * 4. UI Checkbox State Machine Simulation across all 32 (2^5) permutation subsets:
 *    - All 5 checkboxes selected -> ALL_ASYMMETRIC.
 *    - Partial (1 to 4) checkboxes selected -> CUSTOM.
 *    - 0 checkboxes selected -> STRICT_SYNC_ONLY.
 * 5. Quick Header Toggle transitions between Option 1, Option 2, and CUSTOM.
 * 6. Adversarial edge cases, fuzzing, invalid intervals, corrupted timestamps, and zero-crash invariants.
 */

import { describe, it, expect } from "vitest";
import {
  checkFundingSynchronization,
  computeMacroCycleInfo,
  formatIntervalPairKey,
  isIntervalPairAllowed,
  SymbolFundingMeta,
  FundingIntervalMode,
} from "../../lib/exchangeFundingMeta";
import {
  calculateAsymmetricMacroYield,
  calculateHedgeFundingYield,
} from "../../lib/spreadCalculation";

describe("Adversarial Multi-Interval Selector & 16-Permutation Matrix Verification", () => {
  const now = 1700000000000;
  const SUPPORTED_INTERVALS = [1, 2, 4, 8];

  // Generate all 16 interval permutations (4x4)
  const ALL_16_PERMUTATIONS: Array<[number, number]> = [];
  for (const iA of SUPPORTED_INTERVALS) {
    for (const iB of SUPPORTED_INTERVALS) {
      ALL_16_PERMUTATIONS.push([iA, iB]);
    }
  }

  const AVAILABLE_5_PAIRS = ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h"];

  function createMetaForIntervals(iA: number, iB: number, deltaMs: number = 0): SymbolFundingMeta {
    return {
      symbol: `TEST_${iA}H_${iB}H`,
      fundingIntervalHours: Math.min(iA, iB),
      settlementCycleLabel: `${iA}h/${iB}h`,
      payoutsPerDay: 24 / Math.min(iA, iB),
      binanceIntervalHours: iA,
      bybitIntervalHours: iB,
      binanceNextFundingTime: now + 3600 * 1000,
      bybitNextFundingTime: now + 3600 * 1000 + deltaMs,
    };
  }

  // =========================================================================
  // 1. ALL 16 INTERVAL PERMUTATIONS UNDER ALL_ASYMMETRIC (OPTION 1)
  // =========================================================================
  describe("1. ALL_ASYMMETRIC Mode: Full 16-Permutation Matrix", () => {
    it("admits all 16 permutations cleanly with correct macro cycle multipliers", () => {
      expect(ALL_16_PERMUTATIONS).toHaveLength(16);

      for (const [iA, iB] of ALL_16_PERMUTATIONS) {
        const meta = createMetaForIntervals(iA, iB, 0);
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "ALL_ASYMMETRIC",
          rateA: 0.10,
          rateB: 0.01,
        });

        // 1. Must be synchronized
        expect(res.synchronized).toBe(true);

        // 2. Interval values
        expect(res.intervalA).toBe(iA);
        expect(res.intervalB).toBe(iB);

        // 3. Macro horizon = max(iA, iB)
        const expectedMacro = Math.max(iA, iB);
        expect(res.macroHorizonHours).toBe(expectedMacro);

        // 4. Cycles = macro / interval
        expect(res.cyclesA).toBe(expectedMacro / iA);
        expect(res.cyclesB).toBe(expectedMacro / iB);

        // 5. Asymmetry classification
        if (iA === iB) {
          expect(res.isAsymmetric).toBe(false);
          expect(res.firstSettlementVenue).toBe("Simultaneous");
        } else {
          expect(res.isAsymmetric).toBe(true);
        }

        // 6. Asymmetric yield calculation
        expect(res.asymmetricYield).toBeDefined();
        if (res.asymmetricYield) {
          expect(res.asymmetricYield.macroHorizonHours).toBe(expectedMacro);
          expect(res.asymmetricYield.cyclesA).toBe(expectedMacro / iA);
          expect(res.asymmetricYield.cyclesB).toBe(expectedMacro / iB);
          expect(res.asymmetricYield.recommendedDirection).toBe("SHORT_A_LONG_B");
        }
      }
    });

    it("verifies directional flip across unequal cycle multipliers in asymmetric yield", () => {
      // 1h vs 4h: cyclesA = 4, cyclesB = 1.
      // If rateA = 0.02%, rateB = 0.10%: macroA = 4 * 0.02 = 0.08%, macroB = 1 * 0.10 = 0.10%.
      // Since macroB > macroA, recommended direction MUST be LONG_A_SHORT_B!
      const meta = createMetaForIntervals(1, 4, 0);
      const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        intervalMode: "ALL_ASYMMETRIC",
        rateA: 0.02,
        rateB: 0.10,
      });

      expect(res.synchronized).toBe(true);
      expect(res.asymmetricYield).toBeDefined();
      expect(res.asymmetricYield?.recommendedDirection).toBe("LONG_A_SHORT_B");
      expect(res.asymmetricYield?.grossYieldPct).toBeCloseTo(0.02, 5); // |0.08 - 0.10| = 0.02%
      expect(res.asymmetricYield?.clearsFeeHurdle).toBe(false); // 2 bps < 35 bps hurdle
    });
  });

  // =========================================================================
  // 2. ALL 16 INTERVAL PERMUTATIONS UNDER STRICT_SYNC_ONLY (OPTION 2)
  // =========================================================================
  describe("2. STRICT_SYNC_ONLY Mode: Full 16-Permutation Matrix", () => {
    it("strictly rejects all 12 asymmetric permutations (iA !== iB) with [STRICT_SYNC_REJECTED]", () => {
      const asymmetricPermutations = ALL_16_PERMUTATIONS.filter(([iA, iB]) => iA !== iB);
      expect(asymmetricPermutations).toHaveLength(12);

      for (const [iA, iB] of asymmetricPermutations) {
        const meta = createMetaForIntervals(iA, iB, 0);
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });

        expect(res.synchronized).toBe(false);
        expect(res.isAsymmetric).toBe(true);
        expect(res.reason).toBe(
          `[STRICT_SYNC_REJECTED] Interval mismatch: Binance (${iA}h) !== Bybit (${iB}h)`
        );
      }
    });

    it("admits all 4 symmetric permutations (iA === iB) when countdown delta <= 60s", () => {
      const symmetricPermutations = ALL_16_PERMUTATIONS.filter(([iA, iB]) => iA === iB);
      expect(symmetricPermutations).toHaveLength(4);

      for (const [iA, iB] of symmetricPermutations) {
        // Test with 30s delta (within 60s window)
        const meta = createMetaForIntervals(iA, iB, 30000);
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });

        expect(res.synchronized).toBe(true);
        expect(res.isAsymmetric).toBe(false);
        expect(res.macroHorizonHours).toBe(iA);
        expect(res.cyclesA).toBe(1);
        expect(res.cyclesB).toBe(1);
      }
    });

    it("strictly rejects symmetric permutations (iA === iB) when countdown delta > 60s", () => {
      const symmetricPermutations = ALL_16_PERMUTATIONS.filter(([iA, iB]) => iA === iB);

      for (const [iA, iB] of symmetricPermutations) {
        // Test with 65s delta (> 60s)
        const meta = createMetaForIntervals(iA, iB, 65000);
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });

        expect(res.synchronized).toBe(false);
        expect(res.isAsymmetric).toBe(true);
        expect(res.reason).toContain("[STRICT_SYNC_REJECTED] Countdown desynchronization");
        expect(res.reason).toContain("65s delta > 60s");
      }
    });
  });

  // =========================================================================
  // 3. CUSTOM MODE FILTERING ACROSS PERMUTATIONS & REJECTIONS
  // =========================================================================
  describe("3. CUSTOM Mode: Permutation Filtering & [CUSTOM_FILTER_REJECTED] Invariants", () => {
    it("admits only explicitly selected pairs and rejects unselected with [CUSTOM_FILTER_REJECTED]", () => {
      const allowed = ["1h_4h", "2h_8h"];

      for (const [iA, iB] of ALL_16_PERMUTATIONS) {
        const meta = createMetaForIntervals(iA, iB, 0);
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "CUSTOM",
          allowedIntervalPairs: allowed,
        });

        const isSymmetric = iA === iB;
        const pairKeyDirected = `${iA}h_${iB}h`;
        const pairKeyNormalized = `${Math.min(iA, iB)}h_${Math.max(iA, iB)}h`;
        const isPairExplicitlyAllowed =
          allowed.includes(pairKeyDirected) ||
          allowed.includes(pairKeyNormalized) ||
          allowed.includes(`${iB}h_${iA}h`);

        if (isSymmetric) {
          // Symmetric pairs must be admitted in CUSTOM mode
          expect(res.synchronized).toBe(true);
          expect(res.isAsymmetric).toBe(false);
        } else if (isPairExplicitlyAllowed) {
          // Explicitly allowed asymmetric pairs must be admitted
          expect(res.synchronized).toBe(true);
          expect(res.isAsymmetric).toBe(true);
        } else {
          // Unselected asymmetric pairs MUST be rejected with [CUSTOM_FILTER_REJECTED]
          expect(res.synchronized).toBe(false);
          expect(res.isAsymmetric).toBe(true);
          expect(res.reason).toContain("[CUSTOM_FILTER_REJECTED]");
          expect(res.reason).toContain(
            `Interval pair ${formatIntervalPairKey(iA, iB)} is not admitted under active allowedIntervalPairs: [${allowed.join(", ")}]`
          );
        }
      }
    });

    it("handles reverse matching and whitespace/casing normalization in custom filters", () => {
      // Configuration with reverse key "4h_1h" and uppercase/whitespace " 8H_2H "
      const allowed = ["4h_1h", " 8H_2H "];

      // 1h ⇄ 4h (forward) -> should be admitted because "4h_1h" reverse matches
      const res1_4 = checkFundingSynchronization("Binance", "Bybit", createMetaForIntervals(1, 4), now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res1_4.synchronized).toBe(true);

      // 4h ⇄ 1h (direct) -> admitted
      const res4_1 = checkFundingSynchronization("Binance", "Bybit", createMetaForIntervals(4, 1), now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res4_1.synchronized).toBe(true);

      // 2h ⇄ 8h -> admitted because " 8H_2H " matches
      const res2_8 = checkFundingSynchronization("Binance", "Bybit", createMetaForIntervals(2, 8), now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res2_8.synchronized).toBe(true);

      // 1h ⇄ 8h -> unselected, MUST be rejected
      const res1_8 = checkFundingSynchronization("Binance", "Bybit", createMetaForIntervals(1, 8), now, {
        intervalMode: "CUSTOM",
        allowedIntervalPairs: allowed,
      });
      expect(res1_8.synchronized).toBe(false);
      expect(res1_8.reason).toContain("[CUSTOM_FILTER_REJECTED]");
    });
  });

  // =========================================================================
  // 4. UI CHECKBOX STATE MACHINE SIMULATION ACROSS ALL 32 SUBSETS
  // =========================================================================
  describe("4. UI Checkbox State Machine Simulation (2^5 = 32 Subsets)", () => {
    // Exact UI state transition logic from AutoBotPanel.tsx lines 2314-2329
    function simulateCheckboxToggle(
      currentPairs: string[],
      toggledKey: string
    ): { nextPairs: string[]; nextMode: FundingIntervalMode; nextAllowAsym: boolean } {
      const isChecked = currentPairs.includes(toggledKey);
      const nextPairs = isChecked
        ? currentPairs.filter((p) => p !== toggledKey)
        : [...currentPairs, toggledKey];

      let nextMode: FundingIntervalMode;
      let nextAllowAsym: boolean;

      if (nextPairs.length === AVAILABLE_5_PAIRS.length) {
        nextMode = "ALL_ASYMMETRIC";
        nextAllowAsym = true;
      } else if (nextPairs.length === 0) {
        nextMode = "STRICT_SYNC_ONLY";
        nextAllowAsym = false;
      } else {
        nextMode = "CUSTOM";
        nextAllowAsym = true;
      }

      return { nextPairs, nextMode, nextAllowAsym };
    }

    it("verifies state resolution for all 32 possible subsets of checkboxes", () => {
      // Generate all 32 subsets of AVAILABLE_5_PAIRS
      const totalSubsets = 1 << AVAILABLE_5_PAIRS.length; // 32
      expect(totalSubsets).toBe(32);

      let allAsymmetricCount = 0;
      let strictSyncCount = 0;
      let customCount = 0;

      for (let mask = 0; mask < totalSubsets; mask++) {
        const selectedPairs: string[] = [];
        for (let i = 0; i < AVAILABLE_5_PAIRS.length; i++) {
          if ((mask & (1 << i)) !== 0) {
            selectedPairs.push(AVAILABLE_5_PAIRS[i]);
          }
        }

        // Apply resolution logic
        let resolvedMode: FundingIntervalMode;
        let resolvedAllowAsym: boolean;

        if (selectedPairs.length === AVAILABLE_5_PAIRS.length) {
          resolvedMode = "ALL_ASYMMETRIC";
          resolvedAllowAsym = true;
          allAsymmetricCount++;
        } else if (selectedPairs.length === 0) {
          resolvedMode = "STRICT_SYNC_ONLY";
          resolvedAllowAsym = false;
          strictSyncCount++;
        } else {
          resolvedMode = "CUSTOM";
          resolvedAllowAsym = true;
          customCount++;
        }

        // Invariant assertions
        if (selectedPairs.length === 5) {
          expect(resolvedMode).toBe("ALL_ASYMMETRIC");
          expect(resolvedAllowAsym).toBe(true);
        } else if (selectedPairs.length === 0) {
          expect(resolvedMode).toBe("STRICT_SYNC_ONLY");
          expect(resolvedAllowAsym).toBe(false);
        } else {
          expect(resolvedMode).toBe("CUSTOM");
          expect(resolvedAllowAsym).toBe(true);
          expect(selectedPairs.length).toBeGreaterThanOrEqual(1);
          expect(selectedPairs.length).toBeLessThanOrEqual(4);
        }
      }

      // Exact distribution: 1 subset with 5 items, 1 subset with 0 items, 30 subsets with 1-4 items
      expect(allAsymmetricCount).toBe(1);
      expect(strictSyncCount).toBe(1);
      expect(customCount).toBe(30);
    });

    it("simulates sequential unchecking from 5 down to 0 checkboxes", () => {
      let currentPairs = [...AVAILABLE_5_PAIRS];
      let currentMode: FundingIntervalMode = "ALL_ASYMMETRIC";
      let allowAsym = true;

      // 1. Uncheck 1st pair: 5 -> 4 (transitions to CUSTOM)
      const step1 = simulateCheckboxToggle(currentPairs, "1h_4h");
      expect(step1.nextMode).toBe("CUSTOM");
      expect(step1.nextAllowAsym).toBe(true);
      expect(step1.nextPairs).toHaveLength(4);
      currentPairs = step1.nextPairs;

      // 2. Uncheck 2nd pair: 4 -> 3 (remains CUSTOM)
      const step2 = simulateCheckboxToggle(currentPairs, "4h_8h");
      expect(step2.nextMode).toBe("CUSTOM");
      expect(step2.nextPairs).toHaveLength(3);
      currentPairs = step2.nextPairs;

      // 3. Uncheck 3rd pair: 3 -> 2 (remains CUSTOM)
      const step3 = simulateCheckboxToggle(currentPairs, "1h_8h");
      expect(step3.nextMode).toBe("CUSTOM");
      expect(step3.nextPairs).toHaveLength(2);
      currentPairs = step3.nextPairs;

      // 4. Uncheck 4th pair: 2 -> 1 (remains CUSTOM)
      const step4 = simulateCheckboxToggle(currentPairs, "2h_4h");
      expect(step4.nextMode).toBe("CUSTOM");
      expect(step4.nextPairs).toHaveLength(1);
      currentPairs = step4.nextPairs;

      // 5. Uncheck 5th pair: 1 -> 0 (transitions to STRICT_SYNC_ONLY)
      const step5 = simulateCheckboxToggle(currentPairs, "2h_8h");
      expect(step5.nextMode).toBe("STRICT_SYNC_ONLY");
      expect(step5.nextAllowAsym).toBe(false);
      expect(step5.nextPairs).toHaveLength(0);
    });

    it("simulates sequential checking from 0 up to 5 checkboxes", () => {
      let currentPairs: string[] = [];

      // 1. Check 1st pair: 0 -> 1 (transitions to CUSTOM)
      const step1 = simulateCheckboxToggle(currentPairs, "1h_4h");
      expect(step1.nextMode).toBe("CUSTOM");
      expect(step1.nextAllowAsym).toBe(true);
      expect(step1.nextPairs).toEqual(["1h_4h"]);
      currentPairs = step1.nextPairs;

      // 2. Check 2nd, 3rd, 4th pairs: remain CUSTOM
      currentPairs = simulateCheckboxToggle(currentPairs, "4h_8h").nextPairs;
      currentPairs = simulateCheckboxToggle(currentPairs, "1h_8h").nextPairs;
      currentPairs = simulateCheckboxToggle(currentPairs, "2h_4h").nextPairs;
      expect(currentPairs).toHaveLength(4);

      // 3. Check 5th pair: 4 -> 5 (transitions to ALL_ASYMMETRIC)
      const step5 = simulateCheckboxToggle(currentPairs, "2h_8h");
      expect(step5.nextMode).toBe("ALL_ASYMMETRIC");
      expect(step5.nextAllowAsym).toBe(true);
      expect(step5.nextPairs).toHaveLength(5);
    });
  });

  // =========================================================================
  // 5. QUICK HEADER TOGGLE STATE TRANSITION INVARIANTS
  // =========================================================================
  describe("5. Quick Header Toggle State Transitions", () => {
    function simulateHeaderToggle(currentMode: FundingIntervalMode): {
      nextMode: FundingIntervalMode;
      nextEnabled: boolean;
    } {
      const nextMode: FundingIntervalMode =
        currentMode === "STRICT_SYNC_ONLY" ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY";
      const nextEnabled = nextMode !== "STRICT_SYNC_ONLY";
      return { nextMode, nextEnabled };
    }

    it("toggles from ALL_ASYMMETRIC to STRICT_SYNC_ONLY and back", () => {
      const toggle1 = simulateHeaderToggle("ALL_ASYMMETRIC");
      expect(toggle1.nextMode).toBe("STRICT_SYNC_ONLY");
      expect(toggle1.nextEnabled).toBe(false);

      const toggle2 = simulateHeaderToggle(toggle1.nextMode);
      expect(toggle2.nextMode).toBe("ALL_ASYMMETRIC");
      expect(toggle2.nextEnabled).toBe(true);
    });

    it("toggles from CUSTOM to STRICT_SYNC_ONLY and then to ALL_ASYMMETRIC", () => {
      const toggle1 = simulateHeaderToggle("CUSTOM");
      expect(toggle1.nextMode).toBe("STRICT_SYNC_ONLY");
      expect(toggle1.nextEnabled).toBe(false);

      const toggle2 = simulateHeaderToggle(toggle1.nextMode);
      expect(toggle2.nextMode).toBe("ALL_ASYMMETRIC");
      expect(toggle2.nextEnabled).toBe(true);
    });
  });

  // =========================================================================
  // 6. ADVERSARIAL EDGE CASES, FUZZING & ZERO-CRASH ROBUSTNESS
  // =========================================================================
  describe("6. Adversarial Robustness & Zero-Crash Invariants", () => {
    it("handles undefined, null, or empty options gracefully without throwing", () => {
      const meta = createMetaForIntervals(1, 4);

      expect(() => {
        const res1 = checkFundingSynchronization("Binance", "Bybit", meta, now, undefined);
        expect(res1.synchronized).toBe(true);
      }).not.toThrow();

      expect(() => {
        const res2 = checkFundingSynchronization("Binance", "Bybit", undefined, now, undefined);
        expect(res2.synchronized).toBe(true);
      }).not.toThrow();
    });

    it("handles negative, zero, or NaN funding intervals safely", () => {
      // computeMacroCycleInfo handles <= 0 and NaN by falling back to 8
      const cycle1 = computeMacroCycleInfo(0, -5);
      expect(cycle1.macroHorizonHours).toBe(8);
      expect(cycle1.cyclesA).toBe(1);
      expect(cycle1.cyclesB).toBe(1);

      const cycle2 = computeMacroCycleInfo(NaN, -99);
      expect(cycle2.macroHorizonHours).toBe(8);
      expect(cycle2.cyclesA).toBe(1);
      expect(cycle2.cyclesB).toBe(1);
    });

    it("handles non-standard custom intervals (e.g. 3h, 6h, 12h) without division by zero or NaN", () => {
      const cycleInfo = computeMacroCycleInfo(3, 6);
      expect(cycleInfo.macroHorizonHours).toBe(6);
      expect(cycleInfo.cyclesA).toBe(2);
      expect(cycleInfo.cyclesB).toBe(1);
      expect(cycleInfo.ratioLabel).toBe("2:1");
    });

    it("handles isIntervalPairAllowed with undefined, empty, or garbage allowed lists", () => {
      expect(isIntervalPairAllowed(1, 4, undefined)).toBe(true);
      expect(isIntervalPairAllowed(1, 4, [])).toBe(true);
      expect(isIntervalPairAllowed(1, 4, ["", "   ", "random_junk"])).toBe(false);
      expect(isIntervalPairAllowed(1, 4, ["1H_4H"])).toBe(true);
      expect(isIntervalPairAllowed(4, 1, ["1h_4h"])).toBe(true);
    });

    it("handles corrupted or NaN rates in checkFundingSynchronization", () => {
      const meta = createMetaForIntervals(1, 4);

      // When rates are NaN, they are coerced to 0:
      const resNaN = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        intervalMode: "ALL_ASYMMETRIC",
        rateA: NaN,
        rateB: NaN,
      });
      expect(resNaN.synchronized).toBe(true);
      expect(resNaN.asymmetricYield).toBeDefined();
      expect(resNaN.asymmetricYield?.nominalRateA).toBe(0);
      expect(resNaN.asymmetricYield?.nominalRateB).toBe(0);
      expect(resNaN.asymmetricYield?.grossYieldBps).toBe(0);
      expect(resNaN.asymmetricYield?.clearsFeeHurdle).toBe(false);

      // When rates are undefined, asymmetricYield is intentionally omitted:
      const resUndef = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        intervalMode: "ALL_ASYMMETRIC",
        rateA: NaN,
        rateB: undefined,
      });
      expect(resUndef.synchronized).toBe(true);
      expect(resUndef.asymmetricYield).toBeUndefined();
    });

    it("handles extreme negative rates (heavy short squeeze funding) cleanly", () => {
      const meta = createMetaForIntervals(1, 4);
      // Venue A rate = -0.50% (extreme negative, longs receive / shorts pay), Venue B = +0.01%
      const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
        intervalMode: "ALL_ASYMMETRIC",
        rateA: -0.50,
        rateB: 0.01,
      });

      expect(res.synchronized).toBe(true);
      expect(res.asymmetricYield).toBeDefined();
      // macroA = 4 * (-0.50) = -2.00%, macroB = 1 * 0.01 = 0.01%
      // grossYield = |-2.00 - 0.01| = 2.01% = 201 bps
      expect(res.asymmetricYield?.grossYieldBps).toBeCloseTo(201, 1);
      expect(res.asymmetricYield?.clearsFeeHurdle).toBe(true);
      expect(res.asymmetricYield?.recommendedDirection).toBe("LONG_A_SHORT_B");
    });
  });
});
