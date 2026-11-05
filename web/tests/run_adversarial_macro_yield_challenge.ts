/**
 * Empirical Adversarial Challenger: Universal Multi-Interval Macro Yield & Direction Dominance
 * Milestone 1 Stress Verification Harness
 */

import {
  calculateAsymmetricMacroYield,
  calculateDirectionalSpread,
  evaluatePairwiseArbitrage,
  MIN_GROSS_SPREAD_BPS,
  VenueRateInfo,
} from "../lib/spreadCalculation";
import {
  computeMacroCycleInfo,
  formatIntervalPairKey,
  isIntervalPairAllowed,
  checkFundingSynchronization,
  SymbolFundingMeta,
} from "../lib/exchangeFundingMeta";

interface TestResult {
  suite: string;
  testId: string;
  name: string;
  passed: boolean;
  expected: any;
  actual: any;
  diagnostic?: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

function recordTest(
  suite: string,
  testId: string,
  name: string,
  passed: boolean,
  expected: any,
  actual: any,
  diagnostic?: string
) {
  if (passed) {
    passCount++;
  } else {
    failCount++;
  }
  results.push({
    suite,
    testId,
    name,
    passed,
    expected,
    actual,
    diagnostic,
  });
  const status = passed ? "[PASS]" : "[FAIL]";
  console.log(`${status} [${suite}] ${testId}: ${name}`);
  if (!passed && diagnostic) {
    console.error(`       Diagnostic: ${diagnostic}`);
    console.error(`       Expected: ${JSON.stringify(expected)}`);
    console.error(`       Actual:   ${JSON.stringify(actual)}`);
  }
}

async function runAdversarialChallenge() {
  console.log("================================================================================");
  console.log("  EMPIRICAL CHALLENGER: UNIVERSAL MULTI-INTERVAL MACRO YIELD & DIRECTION DOMINANCE");
  console.log("  Timestamp: 2026-10-28T04:25:00Z");
  console.log("================================================================================\n");

  const INTERVALS = [1, 2, 4, 8];

  // ===========================================================================
  // SUITE 1: ALL 16 INTERVAL PERMUTATIONS AND CYCLE MULTIPLIERS
  // ===========================================================================
  console.log("--- SUITE 1: All 16 Interval Permutations (N_A = H/I_A, N_B = H/I_B) ---");

  for (const iA of INTERVALS) {
    for (const iB of INTERVALS) {
      const testId = `PERM-${iA}h-${iB}h`;
      const expectedH = Math.max(iA, iB);
      const expectedNA = expectedH / iA;
      const expectedNB = expectedH / iB;

      // 1. computeMacroCycleInfo
      const cycleInfo = computeMacroCycleInfo(iA, iB);
      const cycleInfoPass =
        cycleInfo.macroHorizonHours === expectedH &&
        cycleInfo.cyclesA === expectedNA &&
        cycleInfo.cyclesB === expectedNB &&
        cycleInfo.ratioLabel === `${expectedNA}:${expectedNB}`;

      recordTest(
        "Suite 1: Permutations",
        `${testId}-cycleInfo`,
        `computeMacroCycleInfo(${iA}h, ${iB}h) -> H=${expectedH}, N_A=${expectedNA}, N_B=${expectedNB}`,
        cycleInfoPass,
        { H: expectedH, NA: expectedNA, NB: expectedNB },
        { H: cycleInfo.macroHorizonHours, NA: cycleInfo.cyclesA, NB: cycleInfo.cyclesB },
        cycleInfoPass ? undefined : "Cycle multiplier or macro horizon calculation mismatch"
      );

      // 2. calculateAsymmetricMacroYield
      const yieldRes = calculateAsymmetricMacroYield(0.05, iA, 0.05, iB);
      const yieldPass =
        yieldRes.macroHorizonHours === expectedH &&
        yieldRes.cyclesA === expectedNA &&
        yieldRes.cyclesB === expectedNB;

      recordTest(
        "Suite 1: Permutations",
        `${testId}-macroYield`,
        `calculateAsymmetricMacroYield on (${iA}h, ${iB}h) preserves multipliers`,
        yieldPass,
        { H: expectedH, NA: expectedNA, NB: expectedNB },
        { H: yieldRes.macroHorizonHours, NA: yieldRes.cyclesA, NB: yieldRes.cyclesB },
        yieldPass ? undefined : "Multipliers not reflected in macro yield result"
      );

      // 3. checkFundingSynchronization (Option 1: ALL_ASYMMETRIC)
      const now = 1700000000000;
      const meta: SymbolFundingMeta = {
        symbol: `SYM-${iA}-${iB}`,
        fundingIntervalHours: Math.min(iA, iB),
        settlementCycleLabel: "Test",
        payoutsPerDay: 24 / Math.min(iA, iB),
        binanceIntervalHours: iA,
        bybitIntervalHours: iB,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      const syncCheck = checkFundingSynchronization("binance", "bybit", meta, now, {
        intervalMode: "ALL_ASYMMETRIC",
      });

      const syncPass =
        syncCheck.synchronized === true &&
        syncCheck.macroHorizonHours === expectedH &&
        syncCheck.cyclesA === expectedNA &&
        syncCheck.cyclesB === expectedNB &&
        (iA !== iB ? syncCheck.isAsymmetric === true : syncCheck.isAsymmetric === false);

      recordTest(
        "Suite 1: Permutations",
        `${testId}-syncCheck`,
        `checkFundingSynchronization admits (${iA}h, ${iB}h) under ALL_ASYMMETRIC`,
        syncPass,
        { synchronized: true, H: expectedH, isAsymmetric: iA !== iB },
        { synchronized: syncCheck.synchronized, H: syncCheck.macroHorizonHours, isAsymmetric: syncCheck.isAsymmetric },
        syncPass ? undefined : syncCheck.reason
      );
    }
  }

  // ===========================================================================
  // SUITE 2: DIRECTION ASSIGNMENT UNDER COMPOUNDING INVERSION
  // ===========================================================================
  console.log("\n--- SUITE 2: Direction Assignment Under Compounding Inversion ---");

  // Case 2.1: Positive rates inversion (1h +0.06% vs 4h +0.15%)
  {
    const res = calculateAsymmetricMacroYield(0.06, 1, 0.15, 4);
    const pass = res.recommendedDirection === "SHORT_A_LONG_B" && res.grossYieldBps === 9;
    recordTest(
      "Suite 2: Direction Inversion",
      "DIR-INV-POS-1h-4h",
      "Nominal R_A (0.06%) < R_B (0.15%) inverted to SHORT_A_LONG_B via 4x compounding (0.24% > 0.15%)",
      pass,
      { direction: "SHORT_A_LONG_B", grossYieldBps: 9 },
      { direction: res.recommendedDirection, grossYieldBps: res.grossYieldBps }
    );
  }

  // Case 2.2: Reverse positive rates inversion (4h +0.15% vs 1h +0.06%)
  {
    const res = calculateAsymmetricMacroYield(0.15, 4, 0.06, 1);
    const pass = res.recommendedDirection === "LONG_A_SHORT_B" && res.grossYieldBps === 9;
    recordTest(
      "Suite 2: Direction Inversion",
      "DIR-INV-POS-4h-1h",
      "Nominal R_A (0.15%) > R_B (0.06%) inverted to LONG_A_SHORT_B via 4x compounding (0.15% < 0.24%)",
      pass,
      { direction: "LONG_A_SHORT_B", grossYieldBps: 9 },
      { direction: res.recommendedDirection, grossYieldBps: res.grossYieldBps }
    );
  }

  // Case 2.3: Aggressive 1h vs 8h inversion (1h +0.02% vs 8h +0.12%)
  {
    const res = calculateAsymmetricMacroYield(0.02, 1, 0.12, 8);
    // N_A * R_A = 8 * 0.02% = 0.16% > 1 * 0.12% = 0.12%
    const pass = res.recommendedDirection === "SHORT_A_LONG_B" && res.grossYieldBps === 4;
    recordTest(
      "Suite 2: Direction Inversion",
      "DIR-INV-POS-1h-8h",
      "6x smaller nominal R_A (0.02% vs 0.12%) inverted to SHORT_A_LONG_B via 8x compounding (0.16% > 0.12%)",
      pass,
      { direction: "SHORT_A_LONG_B", grossYieldBps: 4 },
      { direction: res.recommendedDirection, grossYieldBps: res.grossYieldBps }
    );
  }

  // Case 2.4: Negative rates inversion (1h -0.05% vs 4h -0.15%)
  {
    const res = calculateAsymmetricMacroYield(-0.05, 1, -0.15, 4);
    // N_A * R_A = 4 * (-0.05%) = -0.20%. N_B * R_B = 1 * (-0.15%) = -0.15%.
    // -0.15% > -0.20% => N_B * R_B > N_A * R_A => LONG_A_SHORT_B.
    const pass = res.recommendedDirection === "LONG_A_SHORT_B" && res.grossYieldBps === 5;
    recordTest(
      "Suite 2: Direction Inversion",
      "DIR-INV-NEG-1h-4h",
      "Negative rates: R_A (-0.05%) vs R_B (-0.15%) assigns LONG_A_SHORT_B (Long A earns +0.20%, Short B pays -0.15%, net +0.05%)",
      pass,
      { direction: "LONG_A_SHORT_B", grossYieldBps: 5 },
      { direction: res.recommendedDirection, grossYieldBps: res.grossYieldBps }
    );
  }

  // Case 2.5: Reverse negative rates inversion (4h -0.15% vs 1h -0.05%)
  {
    const res = calculateAsymmetricMacroYield(-0.15, 4, -0.05, 1);
    // N_A * R_A = -0.15%. N_B * R_B = -0.20%.
    // -0.15% > -0.20% => N_A * R_A > N_B * R_B => SHORT_A_LONG_B.
    const pass = res.recommendedDirection === "SHORT_A_LONG_B" && res.grossYieldBps === 5;
    recordTest(
      "Suite 2: Direction Inversion",
      "DIR-INV-NEG-4h-1h",
      "Reverse negative rates: assigns SHORT_A_LONG_B (Short A pays -0.15%, Long B earns +0.20%, net +0.05%)",
      pass,
      { direction: "SHORT_A_LONG_B", grossYieldBps: 5 },
      { direction: res.recommendedDirection, grossYieldBps: res.grossYieldBps }
    );
  }

  // Case 2.6: Opposite signs (1h -0.05% vs 8h +0.01%)
  {
    const res = calculateAsymmetricMacroYield(-0.05, 1, 0.01, 8);
    // N_A * R_A = -0.40%. N_B * R_B = +0.01%.
    // +0.01% > -0.40% => LONG_A_SHORT_B. Gross = |-0.40 - 0.01| = 0.41% = 41 bps.
    const pass = res.recommendedDirection === "LONG_A_SHORT_B" && res.grossYieldBps === 41;
    recordTest(
      "Suite 2: Direction Inversion",
      "DIR-INV-OPP-1h-8h",
      "Opposite signs: 1h -0.05% vs 8h +0.01% -> LONG_A_SHORT_B with 41 bps gross yield",
      pass,
      { direction: "LONG_A_SHORT_B", grossYieldBps: 41 },
      { direction: res.recommendedDirection, grossYieldBps: res.grossYieldBps }
    );
  }

  // Case 2.7: End-to-end evaluation via evaluatePairwiseArbitrage
  {
    const venues: VenueRateInfo[] = [
      { venue: "binance", label: "Binance", badge: "BN", color: "yellow", rate: 0.06, intervalHours: 1 },
      { venue: "bybit", label: "Bybit", badge: "BY", color: "orange", rate: 0.15, intervalHours: 4 },
    ];
    const arb = evaluatePairwiseArbitrage(venues, 8, { intervalMode: "ALL_ASYMMETRIC" });
    const best = arb.bestPair;
    const pass = best?.direction === "SHORT_A_LONG_B" && best?.directionLabel === "Short BN / Long BY";
    recordTest(
      "Suite 2: Direction Inversion",
      "DIR-E2E-ARBITRAGE",
      "evaluatePairwiseArbitrage propagates compounding inverted direction to bestPair",
      pass,
      { direction: "SHORT_A_LONG_B", label: "Short BN / Long BY" },
      { direction: best?.direction, label: best?.directionLabel }
    );
  }

  // ===========================================================================
  // SUITE 3: FEE HURDLE BOUNDARY CONDITIONS (34.9, 35.0, 35.1 BPS)
  // ===========================================================================
  console.log("\n--- SUITE 3: Fee Hurdle Boundary Conditions (34.9 bps, 35.0 bps, 35.1 bps) ---");

  // Boundary 3.1: 34.9 bps in calculateAsymmetricMacroYield (MUST REJECT)
  {
    const res = calculateAsymmetricMacroYield(0.349, 8, 0, 8);
    const pass = res.grossYieldBps === 34.9 && res.clearsFeeHurdle === false && res.netYieldBps === -0.1;
    recordTest(
      "Suite 3: Fee Hurdle",
      "HURDLE-34.9-macroYield",
      "34.9 bps in calculateAsymmetricMacroYield strictly REJECTED (clearsFeeHurdle: false)",
      pass,
      { clearsFeeHurdle: false, netYieldBps: -0.1 },
      { clearsFeeHurdle: res.clearsFeeHurdle, netYieldBps: res.netYieldBps }
    );
  }

  // Boundary 3.2: 35.0 bps in calculateAsymmetricMacroYield (MUST CLEAR)
  {
    const res = calculateAsymmetricMacroYield(0.350, 8, 0, 8);
    const pass = res.grossYieldBps === 35.0 && res.clearsFeeHurdle === true && res.netYieldBps === 0.0;
    recordTest(
      "Suite 3: Fee Hurdle",
      "HURDLE-35.0-macroYield",
      "35.0 bps in calculateAsymmetricMacroYield strictly CLEARED (clearsFeeHurdle: true)",
      pass,
      { clearsFeeHurdle: true, netYieldBps: 0.0 },
      { clearsFeeHurdle: res.clearsFeeHurdle, netYieldBps: res.netYieldBps }
    );
  }

  // Boundary 3.3: 35.1 bps in calculateAsymmetricMacroYield (MUST CLEAR)
  {
    const res = calculateAsymmetricMacroYield(0.351, 8, 0, 8);
    const pass = res.grossYieldBps === 35.1 && res.clearsFeeHurdle === true && res.netYieldBps === 0.1;
    recordTest(
      "Suite 3: Fee Hurdle",
      "HURDLE-35.1-macroYield",
      "35.1 bps in calculateAsymmetricMacroYield strictly CLEARED (clearsFeeHurdle: true)",
      pass,
      { clearsFeeHurdle: true, netYieldBps: 0.1 },
      { clearsFeeHurdle: res.clearsFeeHurdle, netYieldBps: res.netYieldBps }
    );
  }

  // Boundary 3.4: evaluatePairwiseArbitrage at 34.9 bps
  {
    const venues: VenueRateInfo[] = [
      { venue: "binance", label: "Binance", badge: "BN", color: "yellow", rate: 0.349, intervalHours: 8 },
      { venue: "bybit", label: "Bybit", badge: "BY", color: "orange", rate: 0, intervalHours: 8 },
    ];
    const arb = evaluatePairwiseArbitrage(venues, 8);
    const pass = arb.allPairs[0].clearsFeeHurdle === false && arb.allPairs[0].clearsFeeFilter === false;
    recordTest(
      "Suite 3: Fee Hurdle",
      "HURDLE-34.9-arbitrage",
      "34.9 bps in evaluatePairwiseArbitrage disqualified from fee filter",
      pass,
      { clearsFeeHurdle: false, clearsFeeFilter: false },
      { clearsFeeHurdle: arb.allPairs[0].clearsFeeHurdle, clearsFeeFilter: arb.allPairs[0].clearsFeeFilter }
    );
  }

  // Boundary 3.5: evaluatePairwiseArbitrage at 35.0 bps
  {
    const venues: VenueRateInfo[] = [
      { venue: "binance", label: "Binance", badge: "BN", color: "yellow", rate: 0.350, intervalHours: 8 },
      { venue: "bybit", label: "Bybit", badge: "BY", color: "orange", rate: 0, intervalHours: 8 },
    ];
    const arb = evaluatePairwiseArbitrage(venues, 8);
    const pass = arb.allPairs[0].clearsFeeHurdle === true && arb.allPairs[0].clearsFeeFilter === true && arb.bestPair !== null;
    recordTest(
      "Suite 3: Fee Hurdle",
      "HURDLE-35.0-arbitrage",
      "35.0 bps in evaluatePairwiseArbitrage cleared and qualified as bestPair",
      pass,
      { clearsFeeHurdle: true, clearsFeeFilter: true, hasBestPair: true },
      { clearsFeeHurdle: arb.allPairs[0].clearsFeeHurdle, clearsFeeFilter: arb.allPairs[0].clearsFeeFilter, hasBestPair: arb.bestPair !== null }
    );
  }

  // Boundary 3.6: checkFundingSynchronization at 35.0 bps (CHALLENGE / AUDIT)
  {
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

    const res = checkFundingSynchronization("binance", "bybit", meta, now, {
      rateA: 0.350,
      rateB: 0,
      minGrossSpreadBps: 35.0,
    });

    // In exchangeFundingMeta.ts:446:
    // const feeHurdleBps = options.minGrossSpreadBps ?? 35.0;
    // const netYieldBps = grossYieldBps - feeHurdleBps;
    // const clearsFeeHurdle = grossYieldBps >= feeHurdleBps && netYieldBps > 0;
    // At 35.0 bps, netYieldBps = 0, so netYieldBps > 0 is FALSE!
    const pass = res.asymmetricYield?.clearsFeeHurdle === true;
    recordTest(
      "Suite 3: Fee Hurdle",
      "HURDLE-35.0-checkFundingSync",
      "35.0 bps in checkFundingSynchronization clearsFeeHurdle boundary audit",
      pass,
      { clearsFeeHurdle: true },
      { clearsFeeHurdle: res.asymmetricYield?.clearsFeeHurdle, grossYieldBps: res.asymmetricYield?.grossYieldBps, netYieldBps: res.asymmetricYield?.netYieldBps },
      pass ? undefined : "BUG DETECTED: exchangeFundingMeta.ts:446 rejects 35.0 bps due to 'netYieldBps > 0' check (netYieldBps is 0.00 at exactly 35.0 bps hurdle)"
    );
  }

  // ===========================================================================
  // SUITE 4: EXTREME RATES (BOTH POSITIVE, BOTH NEGATIVE, OPPOSITE, ZERO, NaN)
  // ===========================================================================
  console.log("\n--- SUITE 4: Extreme Rates & Edge Cases ---");

  // Extreme 4.1: Extreme positive rates (+5.00% vs +1.00% on 1h vs 4h)
  {
    const res = calculateAsymmetricMacroYield(5.00, 1, 1.00, 4);
    // H = 4. N_A = 4, N_B = 1. N_A * R_A = 20.00%. N_B * R_B = 1.00%. Gross = 19.00% = 1900 bps.
    const pass = res.grossYieldBps === 1900 && res.clearsFeeHurdle === true && res.recommendedDirection === "SHORT_A_LONG_B";
    recordTest(
      "Suite 4: Extreme Rates",
      "EXT-POS-5pct-1pct",
      "Extreme positive rates (+5.00% 1h vs +1.00% 4h) computes 1900 bps gross yield",
      pass,
      { grossYieldBps: 1900, direction: "SHORT_A_LONG_B" },
      { grossYieldBps: res.grossYieldBps, direction: res.recommendedDirection }
    );
  }

  // Extreme 4.2: Extreme negative rates (-5.00% vs -1.00% on 1h vs 4h)
  {
    const res = calculateAsymmetricMacroYield(-5.00, 1, -1.00, 4);
    // H = 4. N_A = 4, N_B = 1. N_A * R_A = -20.00%. N_B * R_B = -1.00%.
    // -1.00% > -20.00% => LONG_A_SHORT_B. Gross = |-20 - (-1)| = 19.00% = 1900 bps.
    const pass = res.grossYieldBps === 1900 && res.clearsFeeHurdle === true && res.recommendedDirection === "LONG_A_SHORT_B";
    recordTest(
      "Suite 4: Extreme Rates",
      "EXT-NEG-5pct-1pct",
      "Extreme negative rates (-5.00% 1h vs -1.00% 4h) computes 1900 bps and LONG_A_SHORT_B",
      pass,
      { grossYieldBps: 1900, direction: "LONG_A_SHORT_B" },
      { grossYieldBps: res.grossYieldBps, direction: res.recommendedDirection }
    );
  }

  // Extreme 4.3: Extreme opposite signs (+5.00% vs -5.00% on 4h vs 4h)
  {
    const res = calculateAsymmetricMacroYield(5.00, 4, -5.00, 4);
    const pass = res.grossYieldBps === 1000 && res.clearsFeeHurdle === true && res.recommendedDirection === "SHORT_A_LONG_B";
    recordTest(
      "Suite 4: Extreme Rates",
      "EXT-OPP-5pct-5pct",
      "Extreme opposite signs (+5.00% 4h vs -5.00% 4h) computes 1000 bps gross yield",
      pass,
      { grossYieldBps: 1000, direction: "SHORT_A_LONG_B" },
      { grossYieldBps: res.grossYieldBps, direction: res.recommendedDirection }
    );
  }

  // Extreme 4.4: Zero rates (both 0)
  {
    const res = calculateAsymmetricMacroYield(0, 1, 0, 8);
    const pass = res.grossYieldBps === 0 && res.clearsFeeHurdle === false;
    recordTest(
      "Suite 4: Extreme Rates",
      "EXT-ZERO-BOTH",
      "Zero rates (0% vs 0%) computes 0 bps gross yield and rejects fee hurdle",
      pass,
      { grossYieldBps: 0, clearsFeeHurdle: false },
      { grossYieldBps: res.grossYieldBps, clearsFeeHurdle: res.clearsFeeHurdle }
    );
  }

  // Extreme 4.5: One zero rate (0% 4h vs +0.40% 1h)
  {
    const res = calculateAsymmetricMacroYield(0, 4, 0.40, 1);
    // N_A * R_A = 0. N_B * R_B = 4 * 0.40% = 1.60% = 160 bps.
    const pass = res.grossYieldBps === 160 && res.clearsFeeHurdle === true && res.recommendedDirection === "LONG_A_SHORT_B";
    recordTest(
      "Suite 4: Extreme Rates",
      "EXT-ZERO-ONE-SIDE",
      "One zero rate (0% 4h vs +0.40% 1h) computes 160 bps gross and LONG_A_SHORT_B",
      pass,
      { grossYieldBps: 160, direction: "LONG_A_SHORT_B" },
      { grossYieldBps: res.grossYieldBps, direction: res.recommendedDirection }
    );
  }

  // Extreme 4.6: NaN rates in calculateAsymmetricMacroYield
  {
    const res = calculateAsymmetricMacroYield(NaN, 1, 0.40, 4);
    const pass = !isNaN(res.grossYieldBps) && res.grossYieldBps === 40 && res.nominalRateA === 0;
    recordTest(
      "Suite 4: Extreme Rates",
      "EXT-NAN-macroYield",
      "NaN rate in calculateAsymmetricMacroYield sanitized safely to 0",
      pass,
      { nominalRateA: 0, grossYieldBps: 40 },
      { nominalRateA: res.nominalRateA, grossYieldBps: res.grossYieldBps }
    );
  }

  // Extreme 4.7: NaN rate in checkFundingSynchronization (AUDIT)
  {
    const now = 1700000000000;
    const meta: SymbolFundingMeta = {
      symbol: "ETHUSDT",
      fundingIntervalHours: 8,
      settlementCycleLabel: "8h",
      payoutsPerDay: 3,
      binanceIntervalHours: 8,
      bybitIntervalHours: 8,
      binanceNextFundingTime: now + 3600 * 1000,
      bybitNextFundingTime: now + 3600 * 1000,
    };

    const res = checkFundingSynchronization("binance", "bybit", meta, now, {
      rateA: NaN,
      rateB: 0.10,
      minGrossSpreadBps: 35.0,
    });

    const isNotNan = !isNaN(res.asymmetricYield?.grossYieldBps ?? NaN);
    recordTest(
      "Suite 4: Extreme Rates",
      "EXT-NAN-checkFundingSync",
      "NaN rate in checkFundingSynchronization sanitized cleanly without NaN propagation",
      isNotNan,
      { isGrossYieldBpsNaN: false },
      { isGrossYieldBpsNaN: isNaN(res.asymmetricYield?.grossYieldBps ?? NaN), actual: res.asymmetricYield?.grossYieldBps },
      isNotNan ? undefined : "BUG DETECTED: exchangeFundingMeta.ts:437 checks typeof rateA === 'number' without !isNaN, propagating NaN to asymmetricYield.grossYieldBps"
    );
  }

  // ===========================================================================
  // SUITE 5: OPTION 2 (STRICT SYNC ONLY) REJECTION INVARIANTS
  // ===========================================================================
  console.log("\n--- SUITE 5: Option 2 (Strict Sync Only) Guardrails ---");

  let strictRejectedCount = 0;
  for (const iA of INTERVALS) {
    for (const iB of INTERVALS) {
      if (iA === iB) continue;
      const now = 1700000000000;
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

      const res = checkFundingSynchronization("binance", "bybit", meta, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });

      const pass = res.synchronized === false && res.isAsymmetric === true && res.reason?.includes("[STRICT_SYNC_REJECTED] Interval mismatch") === true;
      if (pass) strictRejectedCount++;
    }
  }

  const allStrictMismatchPass = strictRejectedCount === 12;
  recordTest(
    "Suite 5: Strict Sync Guardrails",
    "STRICT-MISMATCH-ALL-12",
    "All 12 mismatched interval permutations strictly rejected under STRICT_SYNC_ONLY",
    allStrictMismatchPass,
    { rejectedCount: 12 },
    { rejectedCount: strictRejectedCount }
  );

  // Countdown desync boundary: 60s vs 61s
  {
    const now = 1700000000000;
    const meta60: SymbolFundingMeta = {
      symbol: "TEST-60s",
      fundingIntervalHours: 8,
      settlementCycleLabel: "8h",
      payoutsPerDay: 3,
      binanceIntervalHours: 8,
      bybitIntervalHours: 8,
      binanceNextFundingTime: now + 3600 * 1000,
      bybitNextFundingTime: now + 3600 * 1000 + 60 * 1000, // 60s delta <= 60s
    };
    const res60 = checkFundingSynchronization("binance", "bybit", meta60, now, {
      intervalMode: "STRICT_SYNC_ONLY",
    });
    const pass60 = res60.synchronized === true && res60.isAsymmetric === false;
    recordTest(
      "Suite 5: Strict Sync Guardrails",
      "STRICT-COUNTDOWN-60s",
      "Countdown delta exactly 60s admitted under STRICT_SYNC_ONLY",
      pass60,
      { synchronized: true },
      { synchronized: res60.synchronized }
    );

    const meta61: SymbolFundingMeta = {
      symbol: "TEST-61s",
      fundingIntervalHours: 8,
      settlementCycleLabel: "8h",
      payoutsPerDay: 3,
      binanceIntervalHours: 8,
      bybitIntervalHours: 8,
      binanceNextFundingTime: now + 3600 * 1000,
      bybitNextFundingTime: now + 3600 * 1000 + 61 * 1000, // 61s delta > 60s
    };
    const res61 = checkFundingSynchronization("binance", "bybit", meta61, now, {
      intervalMode: "STRICT_SYNC_ONLY",
    });
    const pass61 = res61.synchronized === false && res61.isAsymmetric === true && res61.reason?.includes("Countdown desynchronization") === true;
    recordTest(
      "Suite 5: Strict Sync Guardrails",
      "STRICT-COUNTDOWN-61s",
      "Countdown delta 61s strictly rejected under STRICT_SYNC_ONLY",
      pass61,
      { synchronized: false },
      { synchronized: res61.synchronized }
    );
  }

  // ===========================================================================
  // SUMMARY AND VERDICT
  // ===========================================================================
  console.log("\n================================================================================");
  console.log("  ADVERSARIAL CHALLENGE EXECUTION SUMMARY");
  console.log("================================================================================");
  console.log(`  Total Invariant Tests Executed: ${results.length}`);
  console.log(`  Passed:                        ${passCount}`);
  console.log(`  Failed / Defect Findings:      ${failCount}`);
  console.log("--------------------------------------------------------------------------------");

  if (failCount > 0) {
    console.log("  EXPLICIT VERDICT: REQUEST_CHANGES");
    console.log("  Remediation Required:");
    results.filter(r => !r.passed).forEach(f => {
      console.log(`  - [${f.testId}] ${f.diagnostic}`);
    });
  } else {
    console.log("  EXPLICIT VERDICT: APPROVE");
  }
  console.log("================================================================================\n");

  return { total: results.length, passed: passCount, failed: failCount, results };
}

runAdversarialChallenge().catch(console.error);
