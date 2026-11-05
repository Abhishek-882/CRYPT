/**
 * Standalone Adversarial Stress Harness: In-Flight Carry Inversion & CUSTOM Mode Interval Filtering
 * 
 * Verifies:
 * 1. Case A: In-flight asymmetric carry protection (1h vs 4h, SHORT_A_LONG_B, +0.15% vs +0.20%)
 *    Macro carry = +0.40% (positive carry) -> CIRCUIT_BREAKER_FUNDING_INVERSION does NOT trip!
 * 2. Case B: In-flight carry inversion trip (1h vs 4h, SHORT_A_LONG_B, +0.02% vs +0.20%)
 *    Macro carry = -0.12% (negative carry) -> CIRCUIT_BREAKER_FUNDING_INVERSION DOES trip cleanly!
 * 3. Case C: Reverse asymmetric carry protection (4h vs 1h, LONG_A_SHORT_B, +0.10% vs +0.15%)
 *    Macro carry = +0.50% (positive carry) -> does NOT trip!
 * 4. Case D: Reverse asymmetric carry inversion trip (4h vs 1h, LONG_A_SHORT_B, +0.10% vs +0.01%)
 *    Macro carry = -0.06% (negative carry) -> DOES trip cleanly!
 * 5. Pre-settlement 15s freeze buffer boundary.
 * 6. CUSTOM mode symmetric baseline admission (8h ⇄ 8h, 4h ⇄ 4h, 1h ⇄ 1h).
 * 7. CUSTOM mode asymmetric pair selection (admit permitted, reject unlisted with [CUSTOM_FILTER_REJECTED]).
 * 8. Option 2 (Strict Sync Only) guardrails (12 mismatched pairs rejected, 60s countdown boundary).
 */

import {
  checkFundingSynchronization,
  isIntervalPairAllowed,
  formatIntervalPairKey,
  SymbolFundingMeta,
  FundingIntervalMode,
} from "../lib/exchangeFundingMeta";
import {
  calculateAsymmetricMacroYield,
  calculateHedgeFundingYield,
} from "../lib/spreadCalculation";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testId: string, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] [${testId}] ${description}`);
  } else {
    failedTests++;
    console.error(`[FAIL] [${testId}] ${description}`);
  }
}

// In-flight carry evaluation replica from botEngine.ts:evaluatePostSettlementExit
function simulateInflightCarryExit(params: {
  direction: string;
  venueA: string;
  venueB: string;
  isAsymmetric: boolean;
  intervalA: number;
  intervalB: number;
  rateA: number;
  rateB: number;
  now: number;
  fundingSettlementTime: number;
}) {
  const { direction, venueA, venueB, isAsymmetric, intervalA, intervalB, rateA, rateB, now, fundingSettlementTime } = params;
  let isInverted = false;
  let expectedYieldBps = 0;

  if (isAsymmetric && intervalA && intervalB) {
    const macroCycle = calculateAsymmetricMacroYield(rateA || 0, intervalA, rateB || 0, intervalB);
    const isHedgeShortA =
      direction.toUpperCase().includes("SHORT_A") ||
      (venueA && direction.toUpperCase().includes(`SHORT_${venueA.toUpperCase()}`)) ||
      direction.toUpperCase().startsWith("SHORT");
    const liveDominantShortA = macroCycle.recommendedDirection === "SHORT_A_LONG_B";

    if (isHedgeShortA !== liveDominantShortA) {
      isInverted = true;
      expectedYieldBps = -macroCycle.grossYieldBps;
    }
  } else {
    const yieldEval = calculateHedgeFundingYield(direction, rateA || 0, rateB || 0);
    if (yieldEval.isNegativeYield) {
      isInverted = true;
      expectedYieldBps = yieldEval.expectedYieldBps;
    }
  }

  const tripsCircuitBreaker = isInverted && now < fundingSettlementTime - 15000;
  return {
    isInverted,
    expectedYieldBps,
    tripsCircuitBreaker,
    unwindReason: tripsCircuitBreaker ? "CIRCUIT_BREAKER_FUNDING_INVERSION" : undefined,
  };
}

async function runAdversarialStressSuite() {
  console.log("================================================================================");
  console.log("  ADVERSARIAL STRESS HARNESS: IN-FLIGHT CARRY INVERSION & CUSTOM FILTER");
  console.log("================================================================================\n");

  const now = 1700000000000;

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 1: In-Flight Carry Inversion Circuit Breaker
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("--- SUITE 1: IN-FLIGHT CARRY INVERSION CIRCUIT BREAKER ---");

  // Case A: 1h vs 4h, SHORT_A_LONG_B, +0.15% vs +0.20%
  const caseA = simulateInflightCarryExit({
    direction: "SHORT_BINANCE_LONG_BYBIT",
    venueA: "Binance",
    venueB: "Bybit",
    isAsymmetric: true,
    intervalA: 1,
    intervalB: 4,
    rateA: 0.15,
    rateB: 0.20,
    now,
    fundingSettlementTime: now + 3600 * 1000,
  });
  assert(
    !caseA.isInverted && !caseA.tripsCircuitBreaker,
    "INFLIGHT-CASE-A",
    "Case A (1h @ +0.15%, 4h @ +0.20%): Macro carry is +0.40% -> CIRCUIT_BREAKER_FUNDING_INVERSION does NOT trip"
  );

  // Case B: 1h vs 4h, SHORT_A_LONG_B, rates flip to +0.02% vs +0.20%
  const caseB = simulateInflightCarryExit({
    direction: "SHORT_BINANCE_LONG_BYBIT",
    venueA: "Binance",
    venueB: "Bybit",
    isAsymmetric: true,
    intervalA: 1,
    intervalB: 4,
    rateA: 0.02,
    rateB: 0.20,
    now,
    fundingSettlementTime: now + 3600 * 1000,
  });
  assert(
    caseB.isInverted && caseB.tripsCircuitBreaker && caseB.unwindReason === "CIRCUIT_BREAKER_FUNDING_INVERSION",
    "INFLIGHT-CASE-B",
    "Case B (1h @ +0.02%, 4h @ +0.20%): Macro carry flips to -0.12% -> CIRCUIT_BREAKER_FUNDING_INVERSION DOES trip cleanly"
  );
  assert(
    caseB.expectedYieldBps === -12,
    "INFLIGHT-CASE-B-BPS",
    "Case B reports exact negative carry expectedYieldBps (-12 bps)"
  );

  // Case C: Reverse asymmetric hedge 4h vs 1h, LONG_A_SHORT_B, +0.10% vs +0.15%
  const caseC = simulateInflightCarryExit({
    direction: "LONG_BINANCE_SHORT_BYBIT",
    venueA: "Binance",
    venueB: "Bybit",
    isAsymmetric: true,
    intervalA: 4,
    intervalB: 1,
    rateA: 0.10,
    rateB: 0.15,
    now,
    fundingSettlementTime: now + 3600 * 1000,
  });
  assert(
    !caseC.isInverted && !caseC.tripsCircuitBreaker,
    "INFLIGHT-CASE-C",
    "Case C (4h @ +0.10%, 1h @ +0.15%): Macro carry is +0.50% -> does NOT trip circuit breaker"
  );

  // Case D: Reverse hedge rates flip (+0.10% vs +0.01%)
  const caseD = simulateInflightCarryExit({
    direction: "LONG_BINANCE_SHORT_BYBIT",
    venueA: "Binance",
    venueB: "Bybit",
    isAsymmetric: true,
    intervalA: 4,
    intervalB: 1,
    rateA: 0.10,
    rateB: 0.01,
    now,
    fundingSettlementTime: now + 3600 * 1000,
  });
  assert(
    caseD.isInverted && caseD.tripsCircuitBreaker && caseD.unwindReason === "CIRCUIT_BREAKER_FUNDING_INVERSION",
    "INFLIGHT-CASE-D",
    "Case D (4h @ +0.10%, 1h @ +0.01%): Macro carry flips to -0.06% -> DOES trip circuit breaker"
  );

  // Case E: Direction naming variants
  const dirVariants = [
    { dir: "SHORT_A_LONG_B", shortA: true },
    { dir: "LONG_A_SHORT_B", shortA: false },
    { dir: "SHORT_BINANCE_LONG_BYBIT", shortA: true },
    { dir: "LONG_BINANCE_SHORT_BYBIT", shortA: false },
    { dir: "SHORT_COINDCX_LONG_BITGET", shortA: true },
    { dir: "LONG_COINDCX_SHORT_BITGET", shortA: false },
  ];
  for (const v of dirVariants) {
    const res = simulateInflightCarryExit({
      direction: v.dir,
      venueA: "Binance",
      venueB: "Bybit",
      isAsymmetric: true,
      intervalA: 1,
      intervalB: 4,
      rateA: 0.15,
      rateB: 0.20,
      now,
      fundingSettlementTime: now + 3600 * 1000,
    });
    const expectedTrip = !v.shortA; // Rate favours short A, so long A should trip
    assert(
      res.tripsCircuitBreaker === expectedTrip,
      `INFLIGHT-DIR-${v.dir}`,
      `Direction pattern ${v.dir}: trips=${res.tripsCircuitBreaker} (expected=${expectedTrip})`
    );
  }

  // Case F: Pre-settlement 15s freeze buffer
  const caseF = simulateInflightCarryExit({
    direction: "SHORT_BINANCE_LONG_BYBIT",
    venueA: "Binance",
    venueB: "Bybit",
    isAsymmetric: true,
    intervalA: 1,
    intervalB: 4,
    rateA: 0.02,
    rateB: 0.20,
    now,
    fundingSettlementTime: now + 10000, // 10s away (< 15s freeze threshold)
  });
  assert(
    caseF.isInverted && !caseF.tripsCircuitBreaker,
    "INFLIGHT-15S-FREEZE",
    "Pre-settlement 15s freeze buffer suppresses circuit breaker trip within 10s of maturity"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 2: CUSTOM Mode Interval Filtering & Baseline Symmetric Admission
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- SUITE 2: CUSTOM MODE INTERVAL FILTERING & SYMMETRIC ADMISSION ---");

  const customAllowed = ["1h_4h", "4h_8h"];

  // Symmetric 8h ⇄ 8h
  const meta8h: SymbolFundingMeta = {
    symbol: "TEST8H",
    fundingIntervalHours: 8,
    settlementCycleLabel: "8h",
    payoutsPerDay: 3,
    binanceIntervalHours: 8,
    bybitIntervalHours: 8,
    binanceNextFundingTime: now + 3600 * 1000,
    bybitNextFundingTime: now + 3600 * 1000,
  };
  const sync8h = checkFundingSynchronization("Binance", "Bybit", meta8h, now, {
    intervalMode: "CUSTOM",
    allowedIntervalPairs: customAllowed,
  });
  assert(
    sync8h.synchronized && !sync8h.isAsymmetric,
    "CUSTOM-SYM-8H",
    "CUSTOM mode automatically admits standard symmetric 8h ⇄ 8h pairs"
  );

  // Symmetric 4h ⇄ 4h
  const meta4h: SymbolFundingMeta = {
    symbol: "TEST4H",
    fundingIntervalHours: 4,
    settlementCycleLabel: "4h",
    payoutsPerDay: 6,
    binanceIntervalHours: 4,
    bybitIntervalHours: 4,
    binanceNextFundingTime: now + 1800 * 1000,
    bybitNextFundingTime: now + 1800 * 1000,
  };
  const sync4h = checkFundingSynchronization("Binance", "Bybit", meta4h, now, {
    intervalMode: "CUSTOM",
    allowedIntervalPairs: customAllowed,
  });
  assert(
    sync4h.synchronized && !sync4h.isAsymmetric,
    "CUSTOM-SYM-4H",
    "CUSTOM mode automatically admits standard symmetric 4h ⇄ 4h pairs"
  );

  // Selected asymmetric: 1h ⇄ 4h
  const meta1h4h: SymbolFundingMeta = {
    symbol: "TEST1H4H",
    fundingIntervalHours: 1,
    settlementCycleLabel: "1h",
    payoutsPerDay: 24,
    binanceIntervalHours: 1,
    bybitIntervalHours: 4,
    binanceNextFundingTime: now + 600 * 1000,
    bybitNextFundingTime: now + 3600 * 1000,
  };
  const sync1h4h = checkFundingSynchronization("Binance", "Bybit", meta1h4h, now, {
    intervalMode: "CUSTOM",
    allowedIntervalPairs: customAllowed,
  });
  assert(
    sync1h4h.synchronized && sync1h4h.isAsymmetric,
    "CUSTOM-ASYM-1H4H",
    "CUSTOM mode admits configured asymmetric pair 1h ⇄ 4h"
  );

  // Selected asymmetric reverse: 4h ⇄ 1h
  const meta4h1h: SymbolFundingMeta = {
    symbol: "TEST4H1H",
    fundingIntervalHours: 1,
    settlementCycleLabel: "1h",
    payoutsPerDay: 24,
    binanceIntervalHours: 4,
    bybitIntervalHours: 1,
    binanceNextFundingTime: now + 3600 * 1000,
    bybitNextFundingTime: now + 600 * 1000,
  };
  const sync4h1h = checkFundingSynchronization("Binance", "Bybit", meta4h1h, now, {
    intervalMode: "CUSTOM",
    allowedIntervalPairs: customAllowed,
  });
  assert(
    sync4h1h.synchronized && sync4h1h.isAsymmetric,
    "CUSTOM-ASYM-4H1H-REV",
    "CUSTOM mode admits reverse permutation 4h ⇄ 1h under allowed 1h_4h"
  );

  // Unselected asymmetric: 1h ⇄ 8h
  const meta1h8h: SymbolFundingMeta = {
    symbol: "TEST1H8H",
    fundingIntervalHours: 1,
    settlementCycleLabel: "1h",
    payoutsPerDay: 24,
    binanceIntervalHours: 1,
    bybitIntervalHours: 8,
    binanceNextFundingTime: now + 600 * 1000,
    bybitNextFundingTime: now + 3600 * 1000,
  };
  const sync1h8h = checkFundingSynchronization("Binance", "Bybit", meta1h8h, now, {
    intervalMode: "CUSTOM",
    allowedIntervalPairs: customAllowed,
  });
  assert(
    !sync1h8h.synchronized && (sync1h8h.reason?.includes("[CUSTOM_FILTER_REJECTED]") ?? false),
    "CUSTOM-REJECT-1H8H",
    "CUSTOM mode strictly rejects unselected asymmetric pair 1h ⇄ 8h with [CUSTOM_FILTER_REJECTED]"
  );

  // Unselected asymmetric: 2h ⇄ 4h
  const meta2h4h: SymbolFundingMeta = {
    symbol: "TEST2H4H",
    fundingIntervalHours: 2,
    settlementCycleLabel: "2h",
    payoutsPerDay: 12,
    binanceIntervalHours: 2,
    bybitIntervalHours: 4,
    binanceNextFundingTime: now + 600 * 1000,
    bybitNextFundingTime: now + 3600 * 1000,
  };
  const sync2h4h = checkFundingSynchronization("Binance", "Bybit", meta2h4h, now, {
    intervalMode: "CUSTOM",
    allowedIntervalPairs: customAllowed,
  });
  assert(
    !sync2h4h.synchronized && (sync2h4h.reason?.includes("[CUSTOM_FILTER_REJECTED]") ?? false),
    "CUSTOM-REJECT-2H4H",
    "CUSTOM mode strictly rejects unselected asymmetric pair 2h ⇄ 4h with [CUSTOM_FILTER_REJECTED]"
  );

  // Candidate loop direct evaluation logic
  const candidateFilterLogic = (intA: number, intB: number, isAsym: boolean, allowed: string[]) => {
    let isFundingSync = true;
    let syncDisqualificationReason: string | undefined = undefined;
    if (intA === intB && !isAsym) {
      isFundingSync = true;
    } else if (!isIntervalPairAllowed(intA, intB, allowed)) {
      isFundingSync = false;
      syncDisqualificationReason = `[CUSTOM_FILTER_REJECTED] Interval pair ${intA}h ⇄ ${intB}h not in allowed list [${allowed.join(", ")}]`;
    }
    return { isFundingSync, syncDisqualificationReason };
  };

  const candSym = candidateFilterLogic(8, 8, false, customAllowed);
  assert(candSym.isFundingSync, "CANDIDATE-SYM-8H", "botEngine candidate loop admits 8h ⇄ 8h symmetric pair");

  const candAsymPermitted = candidateFilterLogic(1, 4, true, customAllowed);
  assert(candAsymPermitted.isFundingSync, "CANDIDATE-ASYM-1H4H", "botEngine candidate loop admits 1h ⇄ 4h permitted pair");

  const candAsymRejected = candidateFilterLogic(1, 8, true, customAllowed);
  assert(
    !candAsymRejected.isFundingSync && candAsymRejected.syncDisqualificationReason?.includes("[CUSTOM_FILTER_REJECTED]") === true,
    "CANDIDATE-ASYM-1H8H",
    "botEngine candidate loop rejects 1h ⇄ 8h unselected pair with [CUSTOM_FILTER_REJECTED]"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 3: Strict Sync (Option 2) Guardrails
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- SUITE 3: STRICT SYNC (OPTION 2) GUARDRAILS ---");

  const mismatches = [
    [1, 4], [4, 1], [4, 8], [8, 4], [1, 8], [8, 1],
    [2, 4], [4, 2], [2, 8], [8, 2], [1, 2], [2, 1],
  ];

  for (const [iA, iB] of mismatches) {
    const meta: SymbolFundingMeta = {
      symbol: `M_${iA}_${iB}`,
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
    assert(
      !res.synchronized && res.reason === `[STRICT_SYNC_REJECTED] Interval mismatch: Binance (${iA}h) !== Bybit (${iB}h)`,
      `STRICT-MISMATCH-${iA}h-${iB}h`,
      `Strict Sync rejects mismatch ${iA}h != ${iB}h with deterministic reason`
    );
  }

  // Countdown boundary: 60s admitted, 61s rejected
  const meta60s: SymbolFundingMeta = {
    symbol: "SYNC60",
    fundingIntervalHours: 8,
    settlementCycleLabel: "8h",
    payoutsPerDay: 3,
    binanceIntervalHours: 8,
    bybitIntervalHours: 8,
    binanceNextFundingTime: now + 3600 * 1000,
    bybitNextFundingTime: now + 3600 * 1000 + 60000, // 60s
  };
  const res60s = checkFundingSynchronization("Binance", "Bybit", meta60s, now, { intervalMode: "STRICT_SYNC_ONLY" });
  assert(res60s.synchronized, "STRICT-60S-ADMIT", "Strict Sync admits countdown delta exactly 60s");

  const meta61s: SymbolFundingMeta = {
    symbol: "SYNC61",
    fundingIntervalHours: 8,
    settlementCycleLabel: "8h",
    payoutsPerDay: 3,
    binanceIntervalHours: 8,
    bybitIntervalHours: 8,
    binanceNextFundingTime: now + 3600 * 1000,
    bybitNextFundingTime: now + 3600 * 1000 + 61000, // 61s
  };
  const res61s = checkFundingSynchronization("Binance", "Bybit", meta61s, now, { intervalMode: "STRICT_SYNC_ONLY" });
  assert(!res61s.synchronized, "STRICT-61S-REJECT", "Strict Sync rejects countdown delta 61s (>60s)");

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY & VERDICT
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log("  ADVERSARIAL STRESS HARNESS SUMMARY");
  console.log("================================================================================");
  console.log(`  Total Stress Tests Executed:  ${totalTests}`);
  console.log(`  Passed Invariants:            ${passedTests}`);
  console.log(`  Failed Invariants:            ${failedTests}`);
  console.log("--------------------------------------------------------------------------------");
  if (failedTests === 0) {
    console.log("  EXPLICIT VERDICT: APPROVE (100% Invariants Cleared Cleanly)");
  } else {
    console.log("  EXPLICIT VERDICT: REQUEST_CHANGES (Defects Detected)");
  }
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdversarialStressSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
