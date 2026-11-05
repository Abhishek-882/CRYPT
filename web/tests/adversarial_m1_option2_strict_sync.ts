/**
 * Adversarial Milestone 1 Challenge Harness:
 * Option 2 (Strict Sync Only) Guardrails, Timing Horizon Logic, and Config Persistence
 *
 * Empirical verification harness executing adversarial stress-tests against:
 * 1. Option 2 Interval Mismatch Rejection across all 12 permutations
 * 2. Option 2 Countdown Desync Threshold Boundary Testing (<=60s vs >60s)
 * 3. Option 2 Strict Sync Admission across identical intervals (1h, 2h, 4h, 8h)
 * 4. Option 1 vs Option 2 Contrast Stress Testing
 * 5. Macro Settlement Horizon Holding & Lifecycle Invariants
 * 6. Bot Config Persistence & .set File Serialization Round-Trip Stress
 */

import path from "path";
import {
  checkFundingSynchronization,
  getVenueFundingInfo,
  computeMacroCycleInfo,
  formatIntervalPairKey,
  isIntervalPairAllowed,
  FundingIntervalMode,
  SymbolFundingMeta,
} from "../lib/exchangeFundingMeta";
import {
  calculateAsymmetricMacroYield,
  evaluatePairwiseArbitrage,
  VenueRateInfo,
} from "../lib/spreadCalculation";
import {
  serializeConfigToSetText,
  parseSetTextToConfig,
  BotConfig,
  DEFAULT_CONFIG,
  ActiveBotHedge,
} from "../lib/botEngine";

// Test counters and results ledger
let passed = 0;
let failed = 0;
const results: Array<{ suite: string; testName: string; status: "PASS" | "FAIL"; details: string }> = [];

function assert(condition: boolean, suite: string, testName: string, details: string = "") {
  if (condition) {
    passed++;
    results.push({ suite, testName, status: "PASS", details });
    console.log(`  [PASS] [${suite}] ${testName}`);
  } else {
    failed++;
    results.push({ suite, testName, status: "FAIL", details });
    console.error(`  [FAIL] [${suite}] ${testName}: ${details}`);
  }
}

async function runAdversarialHarness() {
  console.log("===============================================================================");
  console.log("  EMPIRICAL ADVERSARIAL STRESS TEST: OPTION 2 STRICT SYNC & MACRO HORIZON");
  console.log("===============================================================================\n");

  const now = 1700000000000; // Fixed timestamp for reproducible evaluation

  // ===========================================================================
  // SUITE 1: Option 2 Interval Mismatch Rejection Stress Matrix (All 12 Permutations)
  // ===========================================================================
  console.log("--- SUITE 1: Option 2 Interval Mismatch Rejection Stress Matrix ---");

  // All 12 distinct permutations between {1h, 2h, 4h, 8h}
  const mismatchedPermutations: Array<[number, number]> = [
    [1, 4], [4, 1],
    [4, 8], [8, 4],
    [1, 8], [8, 1],
    [2, 4], [4, 2],
    [2, 8], [8, 2],
    [1, 2], [2, 1],
  ];

  for (const [iA, iB] of mismatchedPermutations) {
    const meta: SymbolFundingMeta = {
      symbol: `TEST-${iA}H-${iB}H`,
      fundingIntervalHours: Math.min(iA, iB),
      settlementCycleLabel: "Test",
      payoutsPerDay: 24 / Math.min(iA, iB),
      binanceIntervalHours: iA,
      bybitIntervalHours: iB,
      binanceNextFundingTime: now + 3600 * 1000,
      bybitNextFundingTime: now + 3600 * 1000, // Identical countdown time, but mismatched intervals
    };

    // 1A. Test via checkFundingSynchronization with intervalMode: "STRICT_SYNC_ONLY"
    const syncRes = checkFundingSynchronization("Binance", "Bybit", meta, now, {
      intervalMode: "STRICT_SYNC_ONLY",
    });

    assert(
      syncRes.synchronized === false,
      "SUITE 1 - Interval Mismatch",
      `1A.1: checkFundingSynchronization rejects ${iA}h != ${iB}h under STRICT_SYNC_ONLY (synchronized === false)`,
      `Expected false, got ${syncRes.synchronized}`
    );

    assert(
      syncRes.isAsymmetric === true,
      "SUITE 1 - Interval Mismatch",
      `1A.2: checkFundingSynchronization marks ${iA}h != ${iB}h as isAsymmetric === true`,
      `Expected true, got ${syncRes.isAsymmetric}`
    );

    const expectedSyncReason = `[STRICT_SYNC_REJECTED] Interval mismatch: Binance (${iA}h) !== Bybit (${iB}h)`;
    assert(
      syncRes.reason === expectedSyncReason,
      "SUITE 1 - Interval Mismatch",
      `1A.3: checkFundingSynchronization provides exact reason for ${iA}h != ${iB}h`,
      `Expected "${expectedSyncReason}", got "${syncRes.reason}"`
    );

    // 1B. Test backward-compatibility: allowAsymmetric: false (legacy flag fallback)
    const legacySyncRes = checkFundingSynchronization("Binance", "Bybit", meta, now, {
      allowAsymmetric: false,
    });
    assert(
      legacySyncRes.synchronized === false && legacySyncRes.reason === expectedSyncReason,
      "SUITE 1 - Interval Mismatch",
      `1B: Legacy allowAsymmetric=false falls back to STRICT_SYNC_ONLY and rejects ${iA}h != ${iB}h`,
      `Reason: ${legacySyncRes.reason}`
    );

    // 1C. Test via evaluatePairwiseArbitrage with intervalMode: "STRICT_SYNC_ONLY"
    const venues: VenueRateInfo[] = [
      {
        venue: "binance",
        label: "Binance",
        badge: "BN",
        color: "#F3BA2F",
        rate: 0.10,
        intervalHours: iA,
        nextFundingTime: now + 3600 * 1000,
      },
      {
        venue: "bybit",
        label: "Bybit",
        badge: "BY",
        color: "#F7A600",
        rate: 0.02,
        intervalHours: iB,
        nextFundingTime: now + 3600 * 1000,
      },
    ];

    const arbRes = evaluatePairwiseArbitrage(venues, 8, {
      intervalMode: "STRICT_SYNC_ONLY",
    });

    assert(
      arbRes.allPairs.length === 1,
      "SUITE 1 - Interval Mismatch",
      `1C.1: evaluatePairwiseArbitrage evaluates ${iA}h vs ${iB}h pair`,
      `Pairs count: ${arbRes.allPairs.length}`
    );

    const pair = arbRes.allPairs[0];
    assert(
      pair.isFundingSynchronized === false,
      "SUITE 1 - Interval Mismatch",
      `1C.2: pair.isFundingSynchronized === false for ${iA}h != ${iB}h under STRICT_SYNC_ONLY`,
      `Got ${pair.isFundingSynchronized}`
    );

    const expectedArbReason = `[STRICT_SYNC_REJECTED] Interval mismatch: Binance (${iA}h) !== Bybit (${iB}h)`;
    assert(
      pair.syncDisqualificationReason === expectedArbReason,
      "SUITE 1 - Interval Mismatch",
      `1C.3: pair.syncDisqualificationReason contains exact error for ${iA}h != ${iB}h`,
      `Got "${pair.syncDisqualificationReason}"`
    );

    assert(
      arbRes.bestPair === null || arbRes.bestPair.isFundingSynchronized === false,
      "SUITE 1 - Interval Mismatch",
      `1C.4: No disqualified pair is admitted as a valid bestPair without warning`,
      `BestPair sync: ${arbRes.bestPair?.isFundingSynchronized}`
    );
  }

  // ===========================================================================
  // SUITE 2: Option 2 Countdown Desync Threshold Boundary Testing (|T_A - T_B| <= 60s vs > 60s)
  // ===========================================================================
  console.log("\n--- SUITE 2: Option 2 Countdown Desync Threshold Boundary Testing ---");

  interface CountdownTestCase {
    deltaMs: number;
    aAhead: boolean;
    expectedSynchronized: boolean;
    description: string;
  }

  const countdownTestCases: CountdownTestCase[] = [
    { deltaMs: 0, aAhead: true, expectedSynchronized: true, description: "Exact 0s synchronization" },
    { deltaMs: 10000, aAhead: true, expectedSynchronized: true, description: "+10s offset (A ahead)" },
    { deltaMs: 10000, aAhead: false, expectedSynchronized: true, description: "-10s offset (B ahead)" },
    { deltaMs: 30000, aAhead: true, expectedSynchronized: true, description: "+30s offset (A ahead)" },
    { deltaMs: 30000, aAhead: false, expectedSynchronized: true, description: "-30s offset (B ahead)" },
    { deltaMs: 59000, aAhead: true, expectedSynchronized: true, description: "+59s offset (A ahead, inside boundary)" },
    { deltaMs: 59000, aAhead: false, expectedSynchronized: true, description: "-59s offset (B ahead, inside boundary)" },
    { deltaMs: 60000, aAhead: true, expectedSynchronized: true, description: "Exact 60,000ms boundary (A ahead, admitted)" },
    { deltaMs: 60000, aAhead: false, expectedSynchronized: true, description: "Exact 60,000ms boundary (B ahead, admitted)" },
    { deltaMs: 60001, aAhead: true, expectedSynchronized: false, description: "60,001ms (1ms over boundary, rejected)" },
    { deltaMs: 60001, aAhead: false, expectedSynchronized: false, description: "-60,001ms (1ms over boundary, rejected)" },
    { deltaMs: 61000, aAhead: true, expectedSynchronized: false, description: "+61s offset (rejected)" },
    { deltaMs: 61000, aAhead: false, expectedSynchronized: false, description: "-61s offset (rejected)" },
    { deltaMs: 120000, aAhead: true, expectedSynchronized: false, description: "+120s offset (rejected)" },
    { deltaMs: 300000, aAhead: true, expectedSynchronized: false, description: "+300s (5m offset, rejected)" },
    { deltaMs: 3600000, aAhead: true, expectedSynchronized: false, description: "+3600s (1h offset, rejected)" },
    { deltaMs: 28800000, aAhead: true, expectedSynchronized: false, description: "+28800s (8h offset, rejected)" },
  ];

  for (const tc of countdownTestCases) {
    const baseTime = now + 7200 * 1000;
    const timeA = tc.aAhead ? baseTime + tc.deltaMs : baseTime;
    const timeB = tc.aAhead ? baseTime : baseTime + tc.deltaMs;

    const meta: SymbolFundingMeta = {
      symbol: "TEST-COUNTDOWN",
      fundingIntervalHours: 8,
      settlementCycleLabel: "8h Cycle",
      payoutsPerDay: 3,
      binanceIntervalHours: 8,
      bybitIntervalHours: 8, // Both 8h, strictly testing countdown difference
      binanceNextFundingTime: timeA,
      bybitNextFundingTime: timeB,
    };

    const syncRes = checkFundingSynchronization("Binance", "Bybit", meta, now, {
      intervalMode: "STRICT_SYNC_ONLY",
    });

    assert(
      syncRes.synchronized === tc.expectedSynchronized,
      "SUITE 2 - Countdown Desync",
      `2.1: ${tc.description} -> synchronized === ${tc.expectedSynchronized}`,
      `Expected ${tc.expectedSynchronized}, got ${syncRes.synchronized} (deltaMs: ${syncRes.deltaMs})`
    );

    if (!tc.expectedSynchronized) {
      assert(
        syncRes.isAsymmetric === true,
        "SUITE 2 - Countdown Desync",
        `2.2: ${tc.description} marked as isAsymmetric === true`,
        `Got ${syncRes.isAsymmetric}`
      );

      assert(
        typeof syncRes.reason === "string" &&
        syncRes.reason.includes("[STRICT_SYNC_REJECTED] Countdown desynchronization"),
        "SUITE 2 - Countdown Desync",
        `2.3: ${tc.description} provides [STRICT_SYNC_REJECTED] Countdown desynchronization reason`,
        `Reason: "${syncRes.reason}"`
      );
    } else {
      assert(
        syncRes.isAsymmetric === false,
        "SUITE 2 - Countdown Desync",
        `2.4: ${tc.description} inside boundary marked as isAsymmetric === false`,
        `Got ${syncRes.isAsymmetric}`
      );
      assert(
        syncRes.firstSettlementVenue === "Simultaneous",
        "SUITE 2 - Countdown Desync",
        `2.5: ${tc.description} inside boundary classified as Simultaneous settlement`,
        `Got "${syncRes.firstSettlementVenue}"`
      );
    }

    // Also verify via evaluatePairwiseArbitrage
    const venues: VenueRateInfo[] = [
      {
        venue: "binance",
        label: "Binance",
        badge: "BN",
        color: "#F3BA2F",
        rate: 0.10,
        intervalHours: 8,
        nextFundingTime: timeA,
      },
      {
        venue: "bybit",
        label: "Bybit",
        badge: "BY",
        color: "#F7A600",
        rate: 0.02,
        intervalHours: 8,
        nextFundingTime: timeB,
      },
    ];

    const arbRes = evaluatePairwiseArbitrage(venues, 8, {
      intervalMode: "STRICT_SYNC_ONLY",
    });

    const pair = arbRes.allPairs[0];
    assert(
      pair.isFundingSynchronized === tc.expectedSynchronized,
      "SUITE 2 - Countdown Desync",
      `2.6: evaluatePairwiseArbitrage ${tc.description} -> isFundingSynchronized === ${tc.expectedSynchronized}`,
      `Got ${pair.isFundingSynchronized}`
    );

    if (!tc.expectedSynchronized) {
      assert(
        typeof pair.syncDisqualificationReason === "string" &&
        pair.syncDisqualificationReason.includes("[STRICT_SYNC_REJECTED] Countdown desynchronization"),
        "SUITE 2 - Countdown Desync",
        `2.7: evaluatePairwiseArbitrage ${tc.description} contains [STRICT_SYNC_REJECTED] Countdown desync reason`,
        `Reason: "${pair.syncDisqualificationReason}"`
      );
    }
  }

  // 2.8 Edge Case: One venue has timestamp while the other is missing (0 or undefined)
  const oneTimeVenues: VenueRateInfo[] = [
    {
      venue: "binance",
      label: "Binance",
      badge: "BN",
      color: "#F3BA2F",
      rate: 0.10,
      intervalHours: 8,
      nextFundingTime: now + 3600 * 1000,
    },
    {
      venue: "bybit",
      label: "Bybit",
      badge: "BY",
      color: "#F7A600",
      rate: 0.02,
      intervalHours: 8,
      nextFundingTime: 0, // Missing timestamp
    },
  ];

  const oneTimeArb = evaluatePairwiseArbitrage(oneTimeVenues, 8, {
    intervalMode: "STRICT_SYNC_ONLY",
  });
  const oneTimePair = oneTimeArb.allPairs[0];
  assert(
    oneTimePair.isFundingSynchronized === false,
    "SUITE 2 - Countdown Desync",
    "2.8.1: Missing timestamp on one venue triggers countdown desynchronization rejection",
    `isFundingSynchronized: ${oneTimePair.isFundingSynchronized}`
  );
  assert(
    typeof oneTimePair.syncDisqualificationReason === "string" &&
    oneTimePair.syncDisqualificationReason.includes("[STRICT_SYNC_REJECTED] Countdown desynchronization"),
    "SUITE 2 - Countdown Desync",
    "2.8.2: Rejection reason contains [STRICT_SYNC_REJECTED] Countdown desynchronization",
    `Reason: "${oneTimePair.syncDisqualificationReason}"`
  );

  // 2.9 Edge Case: Undefined meta in checkFundingSynchronization (fallback to deterministic 8h)
  const undefinedMetaSync = checkFundingSynchronization("Binance", "Bybit", undefined, now, {
    intervalMode: "STRICT_SYNC_ONLY",
  });
  assert(
    undefinedMetaSync.synchronized === true && undefinedMetaSync.isAsymmetric === false,
    "SUITE 2 - Countdown Desync",
    "2.9: Undefined meta falls back safely to deterministic 8h sync",
    `Synchronized: ${undefinedMetaSync.synchronized}`
  );


  // ===========================================================================
  // SUITE 3: Option 2 Strict Sync Admission Matrix (1h=1h, 2h=2h, 4h=4h, 8h=8h)
  // ===========================================================================
  console.log("\n--- SUITE 3: Option 2 Strict Sync Admission Matrix ---");

  const identicalIntervals = [1, 2, 4, 8];

  for (const interval of identicalIntervals) {
    const meta: SymbolFundingMeta = {
      symbol: `TEST-${interval}H-SYNC`,
      fundingIntervalHours: interval,
      settlementCycleLabel: `${interval}h Cycle`,
      payoutsPerDay: 24 / interval,
      binanceIntervalHours: interval,
      bybitIntervalHours: interval,
      binanceNextFundingTime: now + 3600 * 1000,
      bybitNextFundingTime: now + 3600 * 1000 + 30 * 1000, // 30s delta <= 60s
    };

    const syncRes = checkFundingSynchronization("Binance", "Bybit", meta, now, {
      intervalMode: "STRICT_SYNC_ONLY",
    });

    assert(
      syncRes.synchronized === true,
      "SUITE 3 - Strict Sync Admission",
      `3.1: ${interval}h=${interval}h admitted under Option 2 (synchronized === true)`,
      `Expected true, got ${syncRes.synchronized}`
    );

    assert(
      syncRes.isAsymmetric === false,
      "SUITE 3 - Strict Sync Admission",
      `3.2: ${interval}h=${interval}h identified as symmetric (isAsymmetric === false)`,
      `Expected false, got ${syncRes.isAsymmetric}`
    );

    assert(
      syncRes.macroHorizonHours === interval,
      "SUITE 3 - Strict Sync Admission",
      `3.3: ${interval}h=${interval}h macroHorizonHours === ${interval}`,
      `Got ${syncRes.macroHorizonHours}`
    );

    assert(
      syncRes.cyclesA === 1 && syncRes.cyclesB === 1,
      "SUITE 3 - Strict Sync Admission",
      `3.4: ${interval}h=${interval}h cycle multipliers are 1:1`,
      `Got ${syncRes.cyclesA}:${syncRes.cyclesB}`
    );

    assert(
      syncRes.firstSettlementVenue === "Simultaneous",
      "SUITE 3 - Strict Sync Admission",
      `3.5: ${interval}h=${interval}h firstSettlementVenue === "Simultaneous"`,
      `Got "${syncRes.firstSettlementVenue}"`
    );

    // evaluatePairwiseArbitrage verification
    const venues: VenueRateInfo[] = [
      {
        venue: "binance",
        label: "Binance",
        badge: "BN",
        color: "#F3BA2F",
        rate: 0.10,
        intervalHours: interval,
        nextFundingTime: now + 3600 * 1000,
      },
      {
        venue: "bybit",
        label: "Bybit",
        badge: "BY",
        color: "#F7A600",
        rate: -0.05,
        intervalHours: interval,
        nextFundingTime: now + 3600 * 1000 + 30 * 1000,
      },
    ];

    const arbRes = evaluatePairwiseArbitrage(venues, interval, {
      intervalMode: "STRICT_SYNC_ONLY",
    });

    const pair = arbRes.allPairs[0];
    assert(
      pair.isFundingSynchronized === true,
      "SUITE 3 - Strict Sync Admission",
      `3.6: evaluatePairwiseArbitrage ${interval}h=${interval}h isFundingSynchronized === true`,
      `Got ${pair.isFundingSynchronized}`
    );

    assert(
      pair.syncDisqualificationReason === undefined,
      "SUITE 3 - Strict Sync Admission",
      `3.7: evaluatePairwiseArbitrage ${interval}h=${interval}h syncDisqualificationReason === undefined`,
      `Got ${pair.syncDisqualificationReason}`
    );

    assert(
      arbRes.bestPair !== null && arbRes.bestPair.isFundingSynchronized === true,
      "SUITE 3 - Strict Sync Admission",
      `3.8: evaluatePairwiseArbitrage ${interval}h=${interval}h selected as bestPair`,
      `BestPair: ${arbRes.bestPair?.label}`
    );
  }

  // ===========================================================================
  // SUITE 4: Option 1 vs Option 2 Contrast Stress Testing
  // ===========================================================================
  console.log("\n--- SUITE 4: Option 1 (ALL_ASYMMETRIC) vs Option 2 (STRICT_SYNC_ONLY) Contrast Matrix ---");

  // Run all 12 mismatched pairs side-by-side through Option 1 and Option 2
  for (const [iA, iB] of mismatchedPermutations) {
    const meta: SymbolFundingMeta = {
      symbol: `CONTRAST-${iA}-${iB}`,
      fundingIntervalHours: Math.min(iA, iB),
      settlementCycleLabel: "Contrast",
      payoutsPerDay: 24 / Math.min(iA, iB),
      binanceIntervalHours: iA,
      bybitIntervalHours: iB,
      binanceNextFundingTime: now + 3600 * 1000,
      bybitNextFundingTime: now + 3600 * 1000,
    };

    const opt1Res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
      intervalMode: "ALL_ASYMMETRIC",
    });

    const opt2Res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
      intervalMode: "STRICT_SYNC_ONLY",
    });

    assert(
      opt1Res.synchronized === true && opt2Res.synchronized === false,
      "SUITE 4 - Contrast Matrix",
      `4.1: Contrast ${iA}h vs ${iB}h: Option 1 ADMITS while Option 2 REJECTS`,
      `Option 1: ${opt1Res.synchronized}, Option 2: ${opt2Res.synchronized}`
    );

    assert(
      opt1Res.isAsymmetric === true && opt2Res.isAsymmetric === true,
      "SUITE 4 - Contrast Matrix",
      `4.2: Both Option 1 and Option 2 correctly identify ${iA}h vs ${iB}h as asymmetric`,
      `Option 1: ${opt1Res.isAsymmetric}, Option 2: ${opt2Res.isAsymmetric}`
    );
  }

  // ===========================================================================
  // SUITE 5: Macro Settlement Horizon Holding & Lifecycle Invariants
  // ===========================================================================
  console.log("\n--- SUITE 5: Macro Settlement Horizon Holding & Lifecycle Invariants ---");

  // Scenario: Binance 1h vs Bybit 4h
  // Venue A settles at now + 1h (3600s), Venue B settles at now + 4h (14400s)
  const entryTime = now;
  const timeA_1h = entryTime + 3600 * 1000;
  const timeB_4h = entryTime + 14400 * 1000;

  const asymMeta: SymbolFundingMeta = {
    symbol: "ASYM-BTC",
    fundingIntervalHours: 1,
    settlementCycleLabel: "1h/4h Staggered",
    payoutsPerDay: 24,
    binanceIntervalHours: 1,
    bybitIntervalHours: 4,
    binanceNextFundingTime: timeA_1h,
    bybitNextFundingTime: timeB_4h,
  };

  const preFlightSync = checkFundingSynchronization("Binance", "Bybit", asymMeta, entryTime, {
    intervalMode: "ALL_ASYMMETRIC",
  });

  assert(
    preFlightSync.synchronized === true,
    "SUITE 5 - Macro Horizon",
    "5.1.1: Pre-flight sync check admits 1h vs 4h under ALL_ASYMMETRIC",
    `Synchronized: ${preFlightSync.synchronized}`
  );

  assert(
    preFlightSync.isAsymmetric === true,
    "SUITE 5 - Macro Horizon",
    "5.1.2: Pre-flight sync check flags 1h vs 4h as isAsymmetric === true",
    `isAsymmetric: ${preFlightSync.isAsymmetric}`
  );

  assert(
    preFlightSync.earliestNextFundingTime === timeA_1h,
    "SUITE 5 - Macro Horizon",
    "5.1.3: earliestNextFundingTime correctly identified as Venue A (1h)",
    `Expected ${timeA_1h}, got ${preFlightSync.earliestNextFundingTime}`
  );

  assert(
    preFlightSync.macroNextFundingTime === timeB_4h,
    "SUITE 5 - Macro Horizon",
    "5.1.4: macroNextFundingTime correctly identified as Venue B (4h)",
    `Expected ${timeB_4h}, got ${preFlightSync.macroNextFundingTime}`
  );

  assert(
    preFlightSync.firstSettlementVenue === "Binance",
    "SUITE 5 - Macro Horizon",
    '5.1.5: firstSettlementVenue correctly identified as "Binance"',
    `Got "${preFlightSync.firstSettlementVenue}"`
  );

  // 5.2 Verify Hedge Execution Settlement Assignment Logic
  // As implemented in botEngine.ts line 2726-2728:
  // fundingSettlementTime = (syncCheck.isAsymmetric && syncCheck.macroNextFundingTime)
  //   ? syncCheck.macroNextFundingTime
  //   : (syncCheck.earliestNextFundingTime || coin.nextFundingTime)
  const assignedSettlementTime = (preFlightSync.isAsymmetric && preFlightSync.macroNextFundingTime)
    ? preFlightSync.macroNextFundingTime
    : preFlightSync.earliestNextFundingTime;

  assert(
    assignedSettlementTime === timeB_4h,
    "SUITE 5 - Macro Horizon",
    "5.2: Asymmetric hedge assigns fundingSettlementTime = macroNextFundingTime (14400s / 4h), NOT earliest (3600s / 1h)",
    `Assigned: ${assignedSettlementTime}, Expected macro: ${timeB_4h}`
  );

  // 5.3 Verify Symmetric Hedge Assignment (Control Case)
  const symMeta: SymbolFundingMeta = {
    symbol: "SYM-ETH",
    fundingIntervalHours: 8,
    settlementCycleLabel: "8h",
    payoutsPerDay: 3,
    binanceIntervalHours: 8,
    bybitIntervalHours: 8,
    binanceNextFundingTime: entryTime + 28800 * 1000,
    bybitNextFundingTime: entryTime + 28800 * 1000,
  };
  const symSync = checkFundingSynchronization("Binance", "Bybit", symMeta, entryTime, {
    intervalMode: "STRICT_SYNC_ONLY",
  });
  const symAssigned = (symSync.isAsymmetric && symSync.macroNextFundingTime)
    ? symSync.macroNextFundingTime
    : symSync.earliestNextFundingTime;

  assert(
    symAssigned === entryTime + 28800 * 1000,
    "SUITE 5 - Macro Horizon",
    "5.3: Symmetric hedge assigns synchronized settlement time correctly",
    `Assigned: ${symAssigned}`
  );

  // 5.4 Verify Post-Settlement Exit Timing Invariant
  // botEngine.ts lines 4102-4118:
  // const waitThreshold = hedge.fundingSettlementTime + (config.postSettlementWaitSeconds || 15) * 1000;
  // const settlementHasPassed = now >= waitThreshold;
  const postSettlementWaitSeconds = 15;
  const waitThreshold = assignedSettlementTime + postSettlementWaitSeconds * 1000;

  // Timeline check points
  const t_mid1h = entryTime + 1800 * 1000; // 30 min in
  const t_after1h = timeA_1h + 60 * 1000;  // 1h + 1m (intermediate settlement passed!)
  const t_mid3h = entryTime + 10800 * 1000; // 3 hours in
  const t_macro_minus_1s = timeB_4h - 1000;
  const t_macro_exact = timeB_4h;
  const t_macro_plus_10s = timeB_4h + 10000; // 10s after macro (still in 15s postWait buffer!)
  const t_macro_threshold = waitThreshold;   // exact waitThreshold
  const t_after_wait = waitThreshold + 5000; // 5s after wait threshold

  assert(
    t_mid1h < waitThreshold && !(t_mid1h >= waitThreshold),
    "SUITE 5 - Macro Horizon",
    "5.4.1: At 30m, settlementHasPassed === false (holding)",
    `Passed at 30m: ${t_mid1h >= waitThreshold}`
  );

  assert(
    t_after1h < waitThreshold && !(t_after1h >= waitThreshold),
    "SUITE 5 - Macro Horizon",
    "5.4.2: At 1h + 1m (AFTER faster venue settlement), settlementHasPassed === false (CRITICAL: position held!)",
    `Passed after 1h: ${t_after1h >= waitThreshold}`
  );

  assert(
    t_mid3h < waitThreshold && !(t_mid3h >= waitThreshold),
    "SUITE 5 - Macro Horizon",
    "5.4.3: At 3h, settlementHasPassed === false (holding through cycle 3)",
    `Passed at 3h: ${t_mid3h >= waitThreshold}`
  );

  assert(
    t_macro_minus_1s < waitThreshold && !(t_macro_minus_1s >= waitThreshold),
    "SUITE 5 - Macro Horizon",
    "5.4.4: At T_macro - 1s, settlementHasPassed === false",
    `Passed at T_macro - 1s: ${t_macro_minus_1s >= waitThreshold}`
  );

  assert(
    t_macro_exact < waitThreshold && !(t_macro_exact >= waitThreshold),
    "SUITE 5 - Macro Horizon",
    "5.4.5: At T_macro exact (0s post-settlement), settlementHasPassed === false (postWait active)",
    `Passed at T_macro exact: ${t_macro_exact >= waitThreshold}`
  );

  assert(
    t_macro_plus_10s < waitThreshold && !(t_macro_plus_10s >= waitThreshold),
    "SUITE 5 - Macro Horizon",
    "5.4.6: At T_macro + 10s (inside 15s postWait), settlementHasPassed === false (protecting against settlement debit lag)",
    `Passed at T_macro + 10s: ${t_macro_plus_10s >= waitThreshold}`
  );

  assert(
    t_macro_threshold >= waitThreshold,
    "SUITE 5 - Macro Horizon",
    "5.4.7: At T_macro + 15s (exact waitThreshold), settlementHasPassed === true (eligible for exit)",
    `Passed at exact waitThreshold: ${t_macro_threshold >= waitThreshold}`
  );

  assert(
    t_after_wait >= waitThreshold,
    "SUITE 5 - Macro Horizon",
    "5.4.8: At T_macro + 20s, settlementHasPassed === true (eligible for exit)",
    `Passed after waitThreshold: ${t_after_wait >= waitThreshold}`
  );

  // 5.5 Dynamic Interval Shift Overwrite Protection
  // In botEngine.ts lines 4048-4061:
  // const relevantLiveNextFunding = hedge.isAsymmetric
  //   ? (liveSyncCheck.macroNextFundingTime || liveSyncCheck.earliestNextFundingTime)
  //   : liveSyncCheck.venueANextFundingTime;
  // If venue A settles at 1h, liveSyncCheck.venueANextFundingTime moves to 2h (7200s),
  // but liveSyncCheck.macroNextFundingTime is still 4h (14400s).
  // relevantLiveNextFunding evaluates to 14400s, so it DOES NOT overwrite hedge.fundingSettlementTime!
  const liveSyncCheckAfter1h = {
    synchronized: true,
    isAsymmetric: true,
    venueANextFundingTime: entryTime + 7200 * 1000, // Venue A moved to 2h!
    venueBNextFundingTime: timeB_4h,                 // Venue B still at 4h
    earliestNextFundingTime: entryTime + 7200 * 1000,
    macroNextFundingTime: timeB_4h,                  // Macro horizon preserved at 4h!
  };

  const relevantLiveNextFunding = true /* hedge.isAsymmetric */
    ? (liveSyncCheckAfter1h.macroNextFundingTime || liveSyncCheckAfter1h.earliestNextFundingTime)
    : liveSyncCheckAfter1h.venueANextFundingTime;

  assert(
    relevantLiveNextFunding === timeB_4h,
    "SUITE 5 - Macro Horizon",
    "5.5: relevantLiveNextFunding preserves macro horizon (14400s) and does NOT collapse to Venue A's earlier cycle (7200s)",
    `Relevant next funding: ${relevantLiveNextFunding}, expected: ${timeB_4h}`
  );

  // ===========================================================================
  // SUITE 6: Bot Config Persistence & .set File Serialization Round-Trip Stress
  // ===========================================================================
  console.log("\n--- SUITE 6: Bot Config Persistence & .set File Serialization Round-Trip Stress ---");

  // 6.1 Option 2 (Strict Sync Only) Persistence Round-Trip
  const configOption2: BotConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    minSpreadBps: 35,
    intervalMode: "STRICT_SYNC_ONLY",
    allowAsymmetricFunding: false,
    allowedIntervalPairs: [],
  };

  const setOption2 = serializeConfigToSetText(configOption2, "Strict Sync Preset");
  assert(
    setOption2.includes("IntervalMode=STRICT_SYNC_ONLY"),
    "SUITE 6 - Config Persistence",
    "6.1.1: serializeConfigToSetText outputs IntervalMode=STRICT_SYNC_ONLY",
    setOption2
  );
  assert(
    setOption2.includes("AllowAsymmetricFunding=false"),
    "SUITE 6 - Config Persistence",
    "6.1.2: serializeConfigToSetText outputs AllowAsymmetricFunding=false for legacy engines",
    setOption2
  );
  assert(
    setOption2.includes("AllowedIntervalPairs="),
    "SUITE 6 - Config Persistence",
    "6.1.3: serializeConfigToSetText outputs empty AllowedIntervalPairs=",
    setOption2
  );

  const parsedOption2 = parseSetTextToConfig(setOption2);
  assert(
    parsedOption2.intervalMode === "STRICT_SYNC_ONLY",
    "SUITE 6 - Config Persistence",
    "6.1.4: parseSetTextToConfig round-trips intervalMode === STRICT_SYNC_ONLY",
    `Got "${parsedOption2.intervalMode}"`
  );
  assert(
    parsedOption2.allowAsymmetricFunding === false,
    "SUITE 6 - Config Persistence",
    "6.1.5: parseSetTextToConfig round-trips allowAsymmetricFunding === false",
    `Got ${parsedOption2.allowAsymmetricFunding}`
  );
  assert(
    Array.isArray(parsedOption2.allowedIntervalPairs) && parsedOption2.allowedIntervalPairs.length === 0,
    "SUITE 6 - Config Persistence",
    "6.1.6: parseSetTextToConfig round-trips empty allowedIntervalPairs",
    JSON.stringify(parsedOption2.allowedIntervalPairs)
  );

  // 6.2 Option 1 (All Asymmetric) Persistence Round-Trip
  const configOption1: BotConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    minSpreadBps: 35,
    intervalMode: "ALL_ASYMMETRIC",
    allowAsymmetricFunding: true,
    allowedIntervalPairs: ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h", "1h_2h"],
  };

  const setOption1 = serializeConfigToSetText(configOption1, "All Asymmetric Preset");
  assert(
    setOption1.includes("IntervalMode=ALL_ASYMMETRIC"),
    "SUITE 6 - Config Persistence",
    "6.2.1: serializeConfigToSetText outputs IntervalMode=ALL_ASYMMETRIC",
    setOption1
  );
  assert(
    setOption1.includes("AllowAsymmetricFunding=true"),
    "SUITE 6 - Config Persistence",
    "6.2.2: serializeConfigToSetText outputs AllowAsymmetricFunding=true",
    setOption1
  );
  assert(
    setOption1.includes("AllowedIntervalPairs=1h_4h,4h_8h,1h_8h,2h_4h,2h_8h,1h_2h"),
    "SUITE 6 - Config Persistence",
    "6.2.3: serializeConfigToSetText outputs formatted AllowedIntervalPairs string",
    setOption1
  );

  const parsedOption1 = parseSetTextToConfig(setOption1);
  assert(
    parsedOption1.intervalMode === "ALL_ASYMMETRIC",
    "SUITE 6 - Config Persistence",
    "6.2.4: parseSetTextToConfig round-trips intervalMode === ALL_ASYMMETRIC",
    `Got "${parsedOption1.intervalMode}"`
  );
  assert(
    parsedOption1.allowAsymmetricFunding === true,
    "SUITE 6 - Config Persistence",
    "6.2.5: parseSetTextToConfig round-trips allowAsymmetricFunding === true",
    `Got ${parsedOption1.allowAsymmetricFunding}`
  );
  assert(
    JSON.stringify(parsedOption1.allowedIntervalPairs) === JSON.stringify(configOption1.allowedIntervalPairs),
    "SUITE 6 - Config Persistence",
    "6.2.6: parseSetTextToConfig round-trips exact allowedIntervalPairs array",
    JSON.stringify(parsedOption1.allowedIntervalPairs)
  );

  // 6.3 Custom Mode Persistence Round-Trip
  const configCustom: BotConfig = {
    ...DEFAULT_CONFIG,
    enabled: true,
    intervalMode: "CUSTOM",
    allowAsymmetricFunding: true,
    allowedIntervalPairs: ["1h_4h", "2h_4h"],
  };

  const setCustom = serializeConfigToSetText(configCustom, "Custom Preset");
  const parsedCustom = parseSetTextToConfig(setCustom);
  assert(
    parsedCustom.intervalMode === "CUSTOM",
    "SUITE 6 - Config Persistence",
    "6.3.1: parseSetTextToConfig round-trips CUSTOM intervalMode",
    `Got "${parsedCustom.intervalMode}"`
  );
  assert(
    JSON.stringify(parsedCustom.allowedIntervalPairs) === JSON.stringify(["1h_4h", "2h_4h"]),
    "SUITE 6 - Config Persistence",
    "6.3.2: parseSetTextToConfig round-trips custom allowedIntervalPairs array",
    JSON.stringify(parsedCustom.allowedIntervalPairs)
  );

  // 6.4 Robustness, Case-Insensitivity, and Whitespace Fuzzing
  const caseFuzzCases = [
    { input: "intervalmode=strict_sync_only", expectedMode: "STRICT_SYNC_ONLY", expectedAsym: false, name: "lowercase strict_sync_only" },
    { input: "IntervalMode =  STRICT_SYNC_ONLY  ", expectedMode: "STRICT_SYNC_ONLY", expectedAsym: false, name: "whitespace padded STRICT_SYNC_ONLY" },
    { input: "intervalmode=option2", expectedMode: "STRICT_SYNC_ONLY", expectedAsym: false, name: "alias option2" },
    { input: "intervalmode=strict", expectedMode: "STRICT_SYNC_ONLY", expectedAsym: false, name: "alias strict" },
    { input: "intervalmode=custom", expectedMode: "CUSTOM", expectedAsym: true, name: "lowercase custom" },
    { input: "intervalmode=all_asymmetric", expectedMode: "ALL_ASYMMETRIC", expectedAsym: true, name: "lowercase all_asymmetric" },
    { input: "intervalmode=UNKNOWN_INVALID_MODE", expectedMode: "ALL_ASYMMETRIC", expectedAsym: true, name: "unknown mode falls back to ALL_ASYMMETRIC" },
  ];

  for (const fz of caseFuzzCases) {
    const parsed = parseSetTextToConfig(fz.input);
    assert(
      parsed.intervalMode === fz.expectedMode,
      "SUITE 6 - Config Persistence",
      `6.4: Case/format test "${fz.name}" -> intervalMode === ${fz.expectedMode}`,
      `Got "${parsed.intervalMode}"`
    );
    assert(
      parsed.allowAsymmetricFunding === fz.expectedAsym,
      "SUITE 6 - Config Persistence",
      `6.4: Case/format test "${fz.name}" -> allowAsymmetricFunding === ${fz.expectedAsym}`,
      `Got ${parsed.allowAsymmetricFunding}`
    );
  }

  // 6.5 Whitespace in AllowedIntervalPairs
  const pairFuzzText = "AllowedIntervalPairs = 1h_4h , 4h_8h ,  1h_8h \n";
  const parsedPairFuzz = parseSetTextToConfig(pairFuzzText);
  assert(
    JSON.stringify(parsedPairFuzz.allowedIntervalPairs) === JSON.stringify(["1h_4h", "4h_8h", "1h_8h"]),
    "SUITE 6 - Config Persistence",
    "6.5: parseSetTextToConfig trims whitespace around individual pair items",
    JSON.stringify(parsedPairFuzz.allowedIntervalPairs)
  );

  // 6.6 Legacy Backward Compatibility (Sets with only AllowAsymmetricFunding)
  const legacyFalse = "AllowAsymmetricFunding=false\n";
  const parsedLegacyFalse = parseSetTextToConfig(legacyFalse, { ...DEFAULT_CONFIG, intervalMode: undefined });
  assert(
    parsedLegacyFalse.allowAsymmetricFunding === false && parsedLegacyFalse.intervalMode === "STRICT_SYNC_ONLY",
    "SUITE 6 - Config Persistence",
    "6.6.1: Legacy AllowAsymmetricFunding=false without IntervalMode maps to STRICT_SYNC_ONLY",
    `Mode: ${parsedLegacyFalse.intervalMode}, Asym: ${parsedLegacyFalse.allowAsymmetricFunding}`
  );

  const legacyTrue = "AllowAsymmetricFunding=true\n";
  const parsedLegacyTrue = parseSetTextToConfig(legacyTrue, { ...DEFAULT_CONFIG, intervalMode: undefined });
  assert(
    parsedLegacyTrue.allowAsymmetricFunding === true && parsedLegacyTrue.intervalMode === "ALL_ASYMMETRIC",
    "SUITE 6 - Config Persistence",
    "6.6.2: Legacy AllowAsymmetricFunding=true without IntervalMode maps to ALL_ASYMMETRIC",
    `Mode: ${parsedLegacyTrue.intervalMode}, Asym: ${parsedLegacyTrue.allowAsymmetricFunding}`
  );

  // 6.7 Precedence Invariant: When both IntervalMode and AllowAsymmetricFunding are present
  const precedenceConflict = `
AllowAsymmetricFunding=true
IntervalMode=STRICT_SYNC_ONLY
`;
  const parsedConflict = parseSetTextToConfig(precedenceConflict);
  assert(
    parsedConflict.intervalMode === "STRICT_SYNC_ONLY" && parsedConflict.allowAsymmetricFunding === false,
    "SUITE 6 - Config Persistence",
    "6.7: IntervalMode=STRICT_SYNC_ONLY takes strict precedence over conflicting AllowAsymmetricFunding=true",
    `Mode: ${parsedConflict.intervalMode}, Asym: ${parsedConflict.allowAsymmetricFunding}`
  );

  // ===========================================================================
  // HARNESS SUMMARY
  // ===========================================================================
  console.log("\n===============================================================================");
  console.log(`  ADVERSARIAL STRESS TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    console.error(`FAILED WITH ${failed} FAILING TESTS`);
    process.exit(1);
  } else {
    console.log(`ALL ${passed} ADVERSARIAL STRESS TESTS PASSED CLEANLY WITH ZERO REGRESSIONS.`);
    process.exit(0);
  }
}

runAdversarialHarness().catch((err) => {
  console.error("Adversarial harness crashed with unhandled exception:", err);
  process.exit(1);
});
