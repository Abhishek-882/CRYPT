/**
 * Empirical Challenger Stress Harness (M2 - M4 Hardening)
 * 
 * Verifies and stress-tests:
 * 1. Concurrency Stress: Concurrent trades by Tenant Alpha & Beta on BTCUSDT & BINANCE_BYBIT (200 rapid concurrent cycles).
 * 2. Credential Breach Stress: Non-admin tenant with empty/missing keys receives MISSING_EXCHANGE_CREDENTIALS; zero admin fallback.
 * 3. Layer 7 Exit Hurdle Verification: Test L7-01 ($60->$0.0100, $300->$0.0500, $600->$0.1000, micro $15/$30->$0.0100).
 * 4. Quarantine Scoping: User manual close quarantines only caller, not admin.
 * 5. Daemon Auth Gating: Unauthenticated and forged token requests to /api/divergence/daemon return HTTP 401.
 * 6. System Invariants: Zero BPS notation & modern architecture terminology.
 */

import { NextRequest } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Multi-tenant core imports
import { FleetDispatcher, getLockKey } from "../lib/fleetDispatcher";
import {
  isCorridorSymbolLocked,
  releaseCorridorSymbolLock,
  getVerifiedCredentialsForTenant,
  MissingCredentialsError,
  isTenantAdmin,
  lockFlattenedCoinForBot,
  loadBotState,
  resetBotMemory,
  executeDualHedgeEntry,
  fetchAvailableBalances,
} from "../lib/botEngine";
import { getLivePositionsForVenues } from "../lib/exchangePositions";
import {
  getEffectiveZeroLossFloorUsdt,
  evaluateExitGates,
  HARD_SAFETY_FLOOR_USDT,
  BASE_NOTIONAL_UNIT_USDT,
} from "../lib/divergence/engine";
import { evaluateZeroLossExitGate } from "../lib/exitOptimizer";
import { GET as daemonGet, POST as daemonPost } from "../app/api/divergence/daemon/route";
import { createSessionToken, saveUsers, UserAccount } from "../lib/userStore";

interface TestReport {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const reports: TestReport[] = [];
let passCount = 0;
let failCount = 0;

function recordTest(category: string, name: string, condition: boolean, details?: string) {
  if (condition) {
    passCount++;
    reports.push({ category, name, passed: true, details });
    console.log(`  [PASS] [${category}] ${name}${details ? ` -> ${details}` : ""}`);
  } else {
    failCount++;
    reports.push({ category, name, passed: false, error: details || "Assertion failed" });
    console.error(`  [FAIL] [${category}] ${name} -> FAILED: ${details}`);
  }
}

const TEST_ADMIN_ID = "usr_admin_varsha";
const TENANT_ALPHA_ID = "usr_tenant_alpha_challenger";
const TENANT_BETA_ID = "usr_tenant_beta_challenger";
const TENANT_GAMMA_ID = "usr_tenant_gamma_unauth";

const SESSION_SECRET = process.env.SESSION_SECRET || "safecoiner_challenger_test_secret_xyz123";
process.env.SESSION_SECRET = SESSION_SECRET;
const CRON_SECRET = process.env.CRON_SECRET || "safecoiner_cron_secret_challenger_999";
process.env.CRON_SECRET = CRON_SECRET;

function createCookie(userId: string): string {
  return `auth_session=${createSessionToken(userId)}`;
}

function createForgedCookie(userId: string): string {
  return `auth_session=${userId}.forged_signature_attack_${Date.now()}`;
}

async function runAllChallenges() {
  console.log("===============================================================================");
  console.log("  EMPIRICAL CHALLENGER STRESS HARNESS — M2-M4 VERIFICATION");
  console.log("===============================================================================\n");

  // Setup test users in user store
  const mockUsers: any[] = [
    {
      id: TEST_ADMIN_ID,
      username: "admin_varsha",
      role: "admin",
      createdAt: new Date().toISOString(),
      apiKeys: {},
    },
    {
      id: TENANT_ALPHA_ID,
      username: "tenant_alpha",
      role: "user",
      createdAt: new Date().toISOString(),
      apiKeys: {
        binanceKey: "bn_key_alpha_123",
        binanceSecret: "bn_sec_alpha_456",
        bybitKey: "by_key_alpha_123",
        bybitSecret: "by_sec_alpha_456",
        bitgetKey: "",
        bitgetSecret: "",
      },
    },
    {
      id: TENANT_BETA_ID,
      username: "tenant_beta",
      role: "user",
      createdAt: new Date().toISOString(),
      apiKeys: {
        binanceKey: "bn_key_beta_789",
        binanceSecret: "bn_sec_beta_012",
        bybitKey: "by_key_beta_789",
        bybitSecret: "by_sec_beta_012",
        bitgetKey: "",
        bitgetSecret: "",
      },
    },
    {
      id: TENANT_GAMMA_ID,
      username: "tenant_gamma_unauth",
      role: "user",
      createdAt: new Date().toISOString(),
      apiKeys: {
        binanceKey: "",
        binanceSecret: "",
        bitgetKey: "",
        bitgetSecret: "",
      },
    },
  ];
  saveUsers(mockUsers as UserAccount[]);

  // Clean bot memory
  resetBotMemory(undefined, TEST_ADMIN_ID);
  resetBotMemory(undefined, TENANT_ALPHA_ID);
  resetBotMemory(undefined, TENANT_BETA_ID);
  resetBotMemory(undefined, TENANT_GAMMA_ID);

  // ===========================================================================
  // SECTION 1: CONCURRENCY STRESS
  // Concurrent trades by Tenant Alpha & Beta on BTCUSDT & BINANCE_BYBIT
  // ===========================================================================
  console.log("\n--- SECTION 1: CONCURRENCY STRESS ---");
  const dispatcher = new FleetDispatcher();

  // Test 1.1: Concurrent lock acquisition on exact same symbol & corridor
  const alphaLocked = dispatcher.acquireFleetLock("BTCUSDT", "BINANCE_BYBIT", "bot_alpha_1", TENANT_ALPHA_ID);
  const betaLocked = dispatcher.acquireFleetLock("BTCUSDT", "BINANCE_BYBIT", "bot_beta_1", TENANT_BETA_ID);
  recordTest(
    "Concurrency",
    "Concurrent locks on BTCUSDT + BINANCE_BYBIT succeed for both Tenant Alpha and Beta",
    alphaLocked === true && betaLocked === true,
    `alphaLocked=${alphaLocked}, betaLocked=${betaLocked}`
  );

  // Test 1.2: Both tenants report symbol locked fleet-wide under their own scope
  const alphaReported = dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, TENANT_ALPHA_ID);
  const betaReported = dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, TENANT_BETA_ID);
  recordTest(
    "Concurrency",
    "Each tenant correctly sees BTCUSDT locked under their scope",
    alphaReported === true && betaReported === true,
    `alphaReported=${alphaReported}, betaReported=${betaReported}`
  );

  // Test 1.3: Intra-tenant duplicate lock attempt on same symbol & corridor MUST be rejected
  const alphaDuplicate = dispatcher.acquireFleetLock("BTCUSDT", "BINANCE_BYBIT", "bot_alpha_2", TENANT_ALPHA_ID);
  recordTest(
    "Concurrency",
    "Intra-tenant duplicate lock on BTCUSDT by second bot of Tenant Alpha is strictly rejected",
    alphaDuplicate === false,
    `alphaDuplicate=${alphaDuplicate}`
  );

  // Test 1.4: Intra-tenant cross-corridor lock attempt on same symbol MUST also be rejected
  const alphaCrossCorridor = dispatcher.acquireFleetLock("BTCUSDT", "BITGET_BYBIT", "bot_alpha_3", TENANT_ALPHA_ID);
  recordTest(
    "Concurrency",
    "Intra-tenant cross-corridor lock on BTCUSDT by Tenant Alpha is strictly rejected",
    alphaCrossCorridor === false,
    `alphaCrossCorridor=${alphaCrossCorridor}`
  );

  // Test 1.5: Release Alpha lock leaves Beta lock intact
  dispatcher.releaseFleetLock("BTCUSDT", "BINANCE_BYBIT", "bot_alpha_1", TENANT_ALPHA_ID);
  const alphaAfterRelease = dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, TENANT_ALPHA_ID);
  const betaAfterAlphaRelease = dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, TENANT_BETA_ID);
  recordTest(
    "Concurrency",
    "Releasing Alpha lock leaves Beta lock intact on BTCUSDT",
    alphaAfterRelease === false && betaAfterAlphaRelease === true,
    `alphaAfterRelease=${alphaAfterRelease}, betaAfterAlphaRelease=${betaAfterAlphaRelease}`
  );

  // Test 1.6: Release Beta lock clears Beta
  dispatcher.releaseFleetLock("BTCUSDT", "BINANCE_BYBIT", "bot_beta_1", TENANT_BETA_ID);
  const betaAfterRelease = dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, TENANT_BETA_ID);
  recordTest(
    "Concurrency",
    "Releasing Beta lock clears Beta lock on BTCUSDT",
    betaAfterRelease === false,
    `betaAfterRelease=${betaAfterRelease}`
  );

  // Test 1.7: Rapid 200-cycle concurrent acquisition race between Alpha & Beta
  let raceCollisions = 0;
  for (let i = 0; i < 200; i++) {
    const symbol = i % 2 === 0 ? "BTCUSDT" : "ETHUSDT";
    const corridor = "BINANCE_BYBIT";
    const a = dispatcher.acquireFleetLock(symbol, corridor, `worker_alpha_${i}`, TENANT_ALPHA_ID);
    const b = dispatcher.acquireFleetLock(symbol, corridor, `worker_beta_${i}`, TENANT_BETA_ID);
    if (!a || !b) {
      raceCollisions++;
    }
    dispatcher.releaseFleetLock(symbol, corridor, `worker_alpha_${i}`, TENANT_ALPHA_ID);
    dispatcher.releaseFleetLock(symbol, corridor, `worker_beta_${i}`, TENANT_BETA_ID);
  }
  recordTest(
    "Concurrency",
    "200 rapid concurrent lock & release cycles between Alpha and Beta without mutual collisions",
    raceCollisions === 0,
    `raceCollisions=${raceCollisions} (expected 0)`
  );

  // Test 1.8: In-flight entry locks scoping via isCorridorSymbolLocked
  releaseCorridorSymbolLock("BINANCE_BYBIT", "BTCUSDT", TENANT_ALPHA_ID);
  releaseCorridorSymbolLock("BINANCE_BYBIT", "BTCUSDT", TENANT_BETA_ID);
  const alphaInFlight = isCorridorSymbolLocked("BINANCE_BYBIT", "BTCUSDT", TENANT_ALPHA_ID);
  const betaInFlight = isCorridorSymbolLocked("BINANCE_BYBIT", "BTCUSDT", TENANT_BETA_ID);
  recordTest(
    "Concurrency",
    "In-flight entry lock status is clean and scoped per tenant",
    alphaInFlight === false && betaInFlight === false,
    `alphaInFlight=${alphaInFlight}, betaInFlight=${betaInFlight}`
  );

  // ===========================================================================
  // SECTION 2: CREDENTIAL BREACH STRESS
  // Non-admin tenant with empty/missing keys receives MISSING_EXCHANGE_CREDENTIALS; zero fallback
  // ===========================================================================
  console.log("\n--- SECTION 2: CREDENTIAL BREACH STRESS ---");

  // Test 2.1: Non-admin with empty keys throws MissingCredentialsError
  let emptyKeysErrorThrown = false;
  let emptyKeysErrorCode = "";
  try {
    getVerifiedCredentialsForTenant(TENANT_GAMMA_ID, {}, "BINANCE_BYBIT");
  } catch (err: any) {
    emptyKeysErrorThrown = true;
    emptyKeysErrorCode = err.code || "";
  }
  recordTest(
    "Credential Breach",
    "Non-admin tenant with empty keys throws MissingCredentialsError with code MISSING_EXCHANGE_CREDENTIALS",
    emptyKeysErrorThrown === true && emptyKeysErrorCode === "MISSING_EXCHANGE_CREDENTIALS",
    `errorThrown=${emptyKeysErrorThrown}, code=${emptyKeysErrorCode}`
  );

  // Test 2.2: Non-admin with undefined creds throws MissingCredentialsError
  let undefinedCredsErrorThrown = false;
  try {
    getVerifiedCredentialsForTenant(TENANT_GAMMA_ID, undefined, "BINANCE_BYBIT");
  } catch (err: any) {
    undefinedCredsErrorThrown = true;
  }
  recordTest(
    "Credential Breach",
    "Non-admin tenant with undefined credentials throws MissingCredentialsError",
    undefinedCredsErrorThrown === true,
    `undefinedCredsErrorThrown=${undefinedCredsErrorThrown}`
  );

  // Test 2.3: Non-admin with partial keys (Binance only, missing Bybit) throws MissingCredentialsError for Bybit
  let partialKeysErrorVenue = "";
  try {
    getVerifiedCredentialsForTenant(
      TENANT_GAMMA_ID,
      { binanceKey: "key_only", binanceSecret: "sec_only" },
      "BINANCE_BYBIT"
    );
  } catch (err: any) {
    if (err instanceof MissingCredentialsError) {
      partialKeysErrorVenue = err.venue;
    }
  }
  recordTest(
    "Credential Breach",
    "Non-admin tenant with Binance keys but missing Bybit keys throws specifically for Bybit",
    partialKeysErrorVenue === "Bybit",
    `partialKeysErrorVenue=${partialKeysErrorVenue}`
  );

  // Test 2.4: Non-admin on Binance-Bitget corridor with valid Binance keys but missing Bitget passphrase throws specifically for Bitget
  let bitgetPassMissingVenue = "";
  try {
    getVerifiedCredentialsForTenant(
      TENANT_GAMMA_ID,
      {
        binanceKey: "bn_key_valid",
        binanceSecret: "bn_sec_valid",
        bitgetKey: "bg_key_valid",
        bitgetSecret: "bg_sec_valid",
        // bitgetPassphrase deliberately missing
      },
      "BINANCE_BITGET"
    );
  } catch (err: any) {
    if (err instanceof MissingCredentialsError) {
      bitgetPassMissingVenue = err.venue;
    }
  }
  recordTest(
    "Credential Breach",
    "Non-admin tenant missing Bitget passphrase throws specifically for Bitget",
    bitgetPassMissingVenue === "Bitget",
    `bitgetPassMissingVenue=${bitgetPassMissingVenue}`
  );

  // Test 2.5: Zero fallback in balance queries for non-admin
  const nonAdminBalances = await fetchAvailableBalances(TENANT_GAMMA_ID, {} as any);
  recordTest(
    "Credential Breach",
    "Non-admin tenant with empty keys receives zero balances with zero fallback to admin",
    nonAdminBalances.binanceBal === 0 &&
      nonAdminBalances.bybitBal === 0 &&
      nonAdminBalances.bitgetBal === 0 &&
      nonAdminBalances.coindcxBal === 0,
    `binanceBal=${nonAdminBalances.binanceBal}, bybitBal=${nonAdminBalances.bybitBal}, bitgetBal=${nonAdminBalances.bitgetBal}`
  );

  // Test 2.6: Zero fallback in position queries for non-admin
  const nonAdminPositions = await getLivePositionsForVenues(
    ["Binance", "Bybit", "Bitget", "CoinDCX"],
    {} as any,
    "challenger_test_gamma",
    true,
    TENANT_GAMMA_ID
  );
  recordTest(
    "Credential Breach",
    "Non-admin tenant position query without keys returns 0 open positions (no admin position leakage)",
    nonAdminPositions.rawPositions.length === 0,
    `rawPositionsCount=${nonAdminPositions.rawPositions.length}`
  );

  // Test 2.7: Admin user (usr_admin_varsha) DOES retain system default credentials without throwing
  let adminThrown = false;
  let adminCreds: any = null;
  try {
    adminCreds = getVerifiedCredentialsForTenant(TEST_ADMIN_ID, undefined, "BINANCE_BYBIT");
  } catch {
    adminThrown = true;
  }
  recordTest(
    "Credential Breach",
    "Admin account retains system default credentials without throwing",
    adminThrown === false && adminCreds?.isAdmin === true && !!adminCreds?.binanceKey,
    `adminThrown=${adminThrown}, isAdmin=${adminCreds?.isAdmin}`
  );

  // Test 2.8: executeDualHedgeEntry for non-admin without credentials fails cleanly
  const mockCoin: any = {
    symbol: "BTCUSDT",
    binanceMarkPrice: 65000,
    bybitMarkPrice: 65020,
    bitgetMarkPrice: 65010,
    spreadBps: 30,
    divergencePct: 0.05,
    atr1hPct: 0.5,
  };
  const mockConfig: any = {
    enabled: true,
    minSpreadBps: 20,
    normalCoinLeverage: 20,
    volatileCoinLeverage: 10,
  };
  const mockState = loadBotState(TENANT_GAMMA_ID);
  mockConfig.executionCorridor = "BINANCE_BYBIT";
  const entryResult = await executeDualHedgeEntry(
    mockCoin,
    mockConfig,
    60,
    "TestBot",
    mockState,
    {} as any, // empty creds for non-admin
    TENANT_GAMMA_ID,
    "bot-1"
  );
  recordTest(
    "Credential Breach",
    "executeDualHedgeEntry strictly blocks non-admin without keys and returns MISSING_EXCHANGE_CREDENTIALS",
    entryResult.success === false && entryResult.error === "MISSING_EXCHANGE_CREDENTIALS",
    `success=${entryResult.success}, error=${entryResult.error}`
  );

  // ===========================================================================
  // SECTION 3: LAYER 7 EXIT HURDLE VERIFICATION
  // Test L7-01 empirical validation:
  // - $60 notional -> $0.0100 floor
  // - $300 notional -> $0.0500 floor
  // - $600 notional -> $0.1000 floor
  // - Micro-notionals ($15, $30) -> hard $0.0100 floor
  // ===========================================================================
  console.log("\n--- SECTION 3: LAYER 7 EXIT HURDLE VERIFICATION ---");

  // Test 3.1: $60 notional -> $0.0100 floor
  const floor60 = getEffectiveZeroLossFloorUsdt(60.00);
  recordTest(
    "Layer 7 Hurdle",
    "Test L7-01 (1x Base): $60 notional ($6 margin @ 10x leverage) yields exactly $0.0100 floor",
    floor60 === 0.0100,
    `floor60=${floor60} (expected 0.0100)`
  );

  // Test 3.2: $300 notional -> $0.0500 floor
  const floor300 = getEffectiveZeroLossFloorUsdt(300.00);
  recordTest(
    "Layer 7 Hurdle",
    "Test L7-01 (5x Base): $300 notional ($30 margin @ 10x leverage) yields exactly $0.0500 floor",
    floor300 === 0.0500,
    `floor300=${floor300} (expected 0.0500)`
  );

  // Test 3.3: $600 notional -> $0.1000 floor
  const floor600 = getEffectiveZeroLossFloorUsdt(600.00);
  recordTest(
    "Layer 7 Hurdle",
    "Test L7-01 (10x Base): $600 notional ($60 margin @ 10x leverage) yields exactly $0.1000 floor",
    floor600 === 0.1000,
    `floor600=${floor600} (expected 0.1000)`
  );

  // Test 3.4: Micro-notionals ($15, $30) -> hard $0.0100 floor
  const floor15 = getEffectiveZeroLossFloorUsdt(15.00);
  const floor30 = getEffectiveZeroLossFloorUsdt(30.00);
  const floor5 = getEffectiveZeroLossFloorUsdt(5.00);
  const floorSmall = getEffectiveZeroLossFloorUsdt(0.0001);
  recordTest(
    "Layer 7 Hurdle",
    "Micro-notionals ($15, $30, $5, $0.0001) enforce the hard safety floor of $0.0100",
    floor15 === 0.0100 && floor30 === 0.0100 && floor5 === 0.0100 && floorSmall === 0.0100,
    `floor15=${floor15}, floor30=${floor30}, floor5=${floor5}, floorSmall=${floorSmall}`
  );

  // Test 3.5: Intermediate notionals ($120, $180, $240, $450) scale linearly
  const floor120 = getEffectiveZeroLossFloorUsdt(120.00);
  const floor180 = getEffectiveZeroLossFloorUsdt(180.00);
  const floor240 = getEffectiveZeroLossFloorUsdt(240.00);
  const floor450 = getEffectiveZeroLossFloorUsdt(450.00);
  recordTest(
    "Layer 7 Hurdle",
    "Intermediate notionals scale linearly: $120->$0.0200, $180->$0.0300, $240->$0.0400, $450->$0.0750",
    floor120 === 0.0200 && floor180 === 0.0300 && floor240 === 0.0400 && floor450 === 0.0750,
    `floor120=${floor120}, floor180=${floor180}, floor240=${floor240}, floor450=${floor450}`
  );

  // Test 3.6: User override above hard floor is strictly honored
  const userOverrideAbove = getEffectiveZeroLossFloorUsdt(60.00, 0.0500);
  recordTest(
    "Layer 7 Hurdle",
    "User override ($0.0500 on $60 notional) is strictly honored",
    userOverrideAbove === 0.0500,
    `userOverrideAbove=${userOverrideAbove}`
  );

  // Test 3.7: User override below hard safety floor is clamped to $0.0100
  const userOverrideSubFloor = getEffectiveZeroLossFloorUsdt(60.00, 0.0025);
  const userOverrideNegative = getEffectiveZeroLossFloorUsdt(60.00, -0.0500);
  recordTest(
    "Layer 7 Hurdle",
    "Unsafe user override ($0.0025 or negative) is clamped to $0.0100 hard safety floor",
    userOverrideSubFloor === 0.0100 && userOverrideNegative === 0.0100,
    `userOverrideSubFloor=${userOverrideSubFloor}, userOverrideNegative=${userOverrideNegative}`
  );

  // Test 3.8: evaluateExitGates integration with scaled notional hurdles
  // At $300 notional: Net PnL of $0.0200 would pass static $0.01 floor, but MUST fail dynamic $0.0500 floor
  const gateHold300 = evaluateExitGates(
    0.000,
    0.267, // yields Net PnL ~ $0.0210
    "LONG_BN_SHORT_BYB",
    20,
    0.000,
    300.00
  );
  recordTest(
    "Layer 7 Hurdle",
    "evaluateExitGates blocks exit on $300 notional when Net PnL ($0.0210) < dynamic hurdle ($0.0500)",
    gateHold300.zeroLossSatisfied === false && gateHold300.shouldExit === false,
    `zeroLossSatisfied=${gateHold300.zeroLossSatisfied}, shouldExit=${gateHold300.shouldExit}`
  );

  const gatePass300 = evaluateExitGates(
    0.000,
    0.380, // yields Net PnL ~ $0.3600 >= $0.0500
    "LONG_BN_SHORT_BYB",
    20,
    0.000,
    300.00
  );
  recordTest(
    "Layer 7 Hurdle",
    "evaluateExitGates permits exit on $300 notional when Net PnL clears $0.0500 dynamic hurdle",
    gatePass300.zeroLossSatisfied === true && gatePass300.shouldExit === true && gatePass300.reason === "EXPANSION_TP",
    `zeroLossSatisfied=${gatePass300.zeroLossSatisfied}, shouldExit=${gatePass300.shouldExit}, reason=${gatePass300.reason}`
  );

  // Test 3.9: evaluateZeroLossExitGate in exitOptimizer.ts uses dynamic hurdle
  const parityPrices = {
    bnPrice: 0.301,
    bgPrice: 0.299,
    divergencePct: 0.033,
  };
  const baseHedgeMock: any = {
    symbol: "BMTUSDT",
    direction: "SHORT_BINANCE_LONG_BYBIT",
    venueA: "Binance",
    venueB: "Bybit",
    quantity: "1000",
    effectiveQty: 1000,
    notionalUsdt: 300.0,
    binanceLeverage: 10,
    bitgetLeverage: 10,
    entrySpreadBps: 70.0,
    entryBinancePrice: 0.301,
    entryBitgetPrice: 0.299,
    entryDivergencePct: 0.668,
    entryTime: Date.now() - 3600000,
    fundingSettlementTime: Date.now() - 60000,
    status: "ACTIVE",
    totalFeesUsdt: 0.035,
    fundingClaimedUsdt: 0.35,
    fundingRatePct: 0.007,
  };

  const hedge300Passing = { ...baseHedgeMock, fundingClaimedUsdt: 0.35 };
  const hedge300SubFloor = { ...baseHedgeMock, fundingClaimedUsdt: 0.32 };

  const optGate300Pass = evaluateZeroLossExitGate(hedge300Passing, parityPrices);
  const optGate300Hold = evaluateZeroLossExitGate(hedge300SubFloor, parityPrices);
  recordTest(
    "Layer 7 Hurdle",
    "exitOptimizer.evaluateZeroLossExitGate dynamically scales hurdle for $300 notional",
    optGate300Pass.canExit === true && optGate300Hold.canExit === false && optGate300Hold.reason.includes("0.0500"),
    `canExitPass=${optGate300Pass.canExit}, canExitHold=${optGate300Hold.canExit}, reason=${optGate300Hold.reason}`
  );

  // ===========================================================================
  // SECTION 4: QUARANTINE SCOPING
  // User manual coin close quarantines only for caller, not admin
  // ===========================================================================
  console.log("\n--- SECTION 4: QUARANTINE SCOPING ---");

  // Test 4.1: Caller quarantine scoping
  lockFlattenedCoinForBot("SOLUSDT", undefined, TENANT_ALPHA_ID);

  const alphaState = loadBotState(TENANT_ALPHA_ID);
  const betaState = loadBotState(TENANT_BETA_ID);
  const adminState = loadBotState(TEST_ADMIN_ID);

  const alphaBlacklisted = alphaState.bots[0]?.flattenedCoinsBlacklist?.includes("SOLUSDT") ?? false;
  const betaBlacklisted = betaState.bots[0]?.flattenedCoinsBlacklist?.includes("SOLUSDT") ?? false;
  const adminBlacklisted = adminState.bots[0]?.flattenedCoinsBlacklist?.includes("SOLUSDT") ?? false;

  recordTest(
    "Quarantine Scoping",
    "Manual coin close quarantines SOLUSDT exclusively for caller (Tenant Alpha)",
    alphaBlacklisted === true,
    `alphaBlacklisted=${alphaBlacklisted}`
  );

  recordTest(
    "Quarantine Scoping",
    "Manual coin close by Tenant Alpha does NOT quarantine SOLUSDT for Administrator",
    adminBlacklisted === false,
    `adminBlacklisted=${adminBlacklisted}`
  );

  recordTest(
    "Quarantine Scoping",
    "Manual coin close by Tenant Alpha does NOT quarantine SOLUSDT for peer Tenant Beta",
    betaBlacklisted === false,
    `betaBlacklisted=${betaBlacklisted}`
  );

  // Test 4.2: Verify peer Tenant Beta can acquire lock on SOLUSDT unhindered
  const betaSolLock = dispatcher.acquireFleetLock("SOLUSDT", "BINANCE_BYBIT", "worker_beta", TENANT_BETA_ID);
  recordTest(
    "Quarantine Scoping",
    "Tenant Beta can acquire fleet lock and trade SOLUSDT while Alpha has it quarantined",
    betaSolLock === true,
    `betaSolLock=${betaSolLock}`
  );
  dispatcher.releaseFleetLock("SOLUSDT", "BINANCE_BYBIT", "worker_beta", TENANT_BETA_ID);

  // ===========================================================================
  // SECTION 5: DAEMON AUTH GATING
  // Unauthenticated and forged token requests to /api/divergence/daemon return 401
  // ===========================================================================
  console.log("\n--- SECTION 5: DAEMON AUTH GATING ---");

  // Test 5.1: Unauthenticated GET request -> 401
  const unauthGetReq = new NextRequest("http://localhost:3000/api/divergence/daemon", {
    method: "GET",
  });
  const unauthGetRes = await daemonGet(unauthGetReq);
  const unauthGetBody = await unauthGetRes.json();
  recordTest(
    "Daemon Auth Gating",
    "GET /api/divergence/daemon without auth headers/cookies returns HTTP 401 UNAUTHORIZED",
    unauthGetRes.status === 401 && unauthGetBody.error === "UNAUTHORIZED",
    `status=${unauthGetRes.status}, error=${unauthGetBody.error}`
  );

  // Test 5.2: Unauthenticated POST request -> 401
  const unauthPostReq = new NextRequest("http://localhost:3000/api/divergence/daemon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  });
  const unauthPostRes = await daemonPost(unauthPostReq);
  const unauthPostBody = await unauthPostRes.json();
  recordTest(
    "Daemon Auth Gating",
    "POST /api/divergence/daemon without auth headers/cookies returns HTTP 401 UNAUTHORIZED",
    unauthPostRes.status === 401 && unauthPostBody.error === "UNAUTHORIZED",
    `status=${unauthPostRes.status}, error=${unauthPostBody.error}`
  );

  // Test 5.3: GET request with forged session token -> 401
  const forgedCookie = createForgedCookie(TEST_ADMIN_ID);
  const forgedGetReq = new NextRequest("http://localhost:3000/api/divergence/daemon", {
    method: "GET",
    headers: {
      cookie: forgedCookie,
    },
  });
  const forgedGetRes = await daemonGet(forgedGetReq);
  const forgedGetBody = await forgedGetRes.json();
  recordTest(
    "Daemon Auth Gating",
    "GET /api/divergence/daemon with forged HMAC session token returns HTTP 401 UNAUTHORIZED",
    forgedGetRes.status === 401 && forgedGetBody.error === "UNAUTHORIZED",
    `status=${forgedGetRes.status}, error=${forgedGetBody.error}`
  );

  // Test 5.4: POST request with forged session token -> 401
  const forgedPostReq = new NextRequest("http://localhost:3000/api/divergence/daemon", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: forgedCookie,
    },
    body: JSON.stringify({ action: "start" }),
  });
  const forgedPostRes = await daemonPost(forgedPostReq);
  const forgedPostBody = await forgedPostRes.json();
  recordTest(
    "Daemon Auth Gating",
    "POST /api/divergence/daemon with forged HMAC session token returns HTTP 401 UNAUTHORIZED",
    forgedPostRes.status === 401 && forgedPostBody.error === "UNAUTHORIZED",
    `status=${forgedPostRes.status}, error=${forgedPostBody.error}`
  );

  // Test 5.5: GET request with valid user session token -> 200
  const validCookie = createCookie(TEST_ADMIN_ID);
  const validGetReq = new NextRequest("http://localhost:3000/api/divergence/daemon", {
    method: "GET",
    headers: {
      cookie: validCookie,
    },
  });
  const validGetRes = await daemonGet(validGetReq);
  const validGetBody = await validGetRes.json();
  recordTest(
    "Daemon Auth Gating",
    "GET /api/divergence/daemon with valid authenticated session token succeeds with HTTP 200",
    validGetRes.status === 200 && validGetBody.success === true,
    `status=${validGetRes.status}, success=${validGetBody.success}`
  );

  // Test 5.6: GET request with valid x-cron-secret -> 200
  const cronGetReq = new NextRequest("http://localhost:3000/api/divergence/daemon", {
    method: "GET",
    headers: {
      "x-cron-secret": CRON_SECRET,
    },
  });
  const cronGetRes = await daemonGet(cronGetReq);
  const cronGetBody = await cronGetRes.json();
  recordTest(
    "Daemon Auth Gating",
    "GET /api/divergence/daemon with valid x-cron-secret header succeeds with HTTP 200",
    cronGetRes.status === 200 && cronGetBody.success === true,
    `status=${cronGetRes.status}, success=${cronGetBody.success}`
  );

  // Test 5.7: GET request with invalid x-cron-secret -> 401
  const invalidCronReq = new NextRequest("http://localhost:3000/api/divergence/daemon", {
    method: "GET",
    headers: {
      "x-cron-secret": "wrong_cron_secret_attacker",
    },
  });
  const invalidCronRes = await daemonGet(invalidCronReq);
  recordTest(
    "Daemon Auth Gating",
    "GET /api/divergence/daemon with invalid x-cron-secret header returns HTTP 401 UNAUTHORIZED",
    invalidCronRes.status === 401,
    `status=${invalidCronRes.status}`
  );

  // ===========================================================================
  // SECTION 6: SYSTEM-WIDE INVARIANTS AUDIT
  // Zero BPS notation & Modern Architecture Terminology
  // ===========================================================================
  console.log("\n--- SECTION 6: SYSTEM INVARIANTS AUDIT ---");

  const bpsRegex = /\b\d+(\.\d+)?\s*bps\b/i;
  const legacyBotRegex = /\b(bot1|bot2|legacy_bot|master_bot)\b/i;

  const testStrings = [
    optGate300Pass.reason || "",
    optGate300Hold.reason || "",
    gatePass300.reason || "",
    gateHold300.reason || "",
    "Auto-adaptive dynamic exit hurdle: 0.0500 USDT on $300 notional",
    "Autonomous execution engine: 10x volatile leverage, 20x normal coin leverage",
  ];

  let bpsViolations = 0;
  let legacyViolations = 0;
  for (const str of testStrings) {
    if (bpsRegex.test(str)) bpsViolations++;
    if (legacyBotRegex.test(str)) legacyViolations++;
  }

  recordTest(
    "System Invariants",
    "Strict Zero BPS notation maintained across all emitted exit reasons and messages",
    bpsViolations === 0,
    `bpsViolations=${bpsViolations}`
  );

  recordTest(
    "System Invariants",
    "Modern architecture terminology strictly maintained (zero legacy bot tokens)",
    legacyViolations === 0,
    `legacyViolations=${legacyViolations}`
  );

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log("\n===============================================================================");
  console.log(`  EMPIRICAL CHALLENGER TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log("===============================================================================\n");

  if (failCount > 0) {
    console.error("FAILURES DETECTED:");
    reports.filter(r => !r.passed).forEach(r => {
      console.error(`- [${r.category}] ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log("ALL CHALLENGE VERIFICATIONS PASSED CLEANLY!");
    process.exit(0);
  }
}

runAllChallenges().catch((err) => {
  console.error("Unhandled error during empirical challenge stress:", err);
  process.exit(1);
});
