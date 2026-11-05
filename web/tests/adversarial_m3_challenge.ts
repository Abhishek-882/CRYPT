/**
 * Adversarial Milestone 3 Challenge Harness:
 * Track A-04: Pre-Broker RiskGate & $500 Single Order Cap
 * Track A-05: Live MTM Drawdown & 4.0% Global Circuit Breaker
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest } from "next/server";

process.env.COCKPIT_VAULT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { RiskGate, RISK_LIMITS, PreOrderValidationRequest } from "../lib/riskGate";
import { POST as binanceOrderRoute } from "../app/api/order/route";
import { POST as bitgetOrderRoute } from "../app/api/bitget/order/route";
import { POST as bybitOrderRoute } from "../app/api/bybit/order/route";
import { POST as coindcxOrderRoute } from "../app/api/coindcx/order/route";
import { POST as hedgeRoute } from "../app/api/hedge/route";
import { GET as riskGetRoute, POST as riskPostRoute } from "../app/api/risk/route";
import { createSessionToken, saveUsers, loadUsers, findUserByEmail, registerUser, UserAccount } from "../lib/userStore";
import { encryptVaultSecret } from "../lib/cryptoVault";
import { resolveDataFilePath } from "../lib/storagePath";
import { saveBotState, BotEngineState } from "../lib/botEngine";
import { recordServerTrade } from "../lib/serverTradeStore";

let passed = 0;
let failed = 0;
const results: Array<{ testName: string; status: "PASS" | "FAIL"; details: string }> = [];

function assert(condition: boolean, testName: string, details = "") {
  if (condition) {
    passed++;
    results.push({ testName, status: "PASS", details });
    console.log(`  [PASS] ${testName}`);
  } else {
    failed++;
    results.push({ testName, status: "FAIL", details });
    console.error(`  [FAIL] ${testName}: ${details}`);
  }
}

async function run() {
  console.log("===============================================================================");
  console.log("  ADVERSARIAL STRESS TEST: PRE-BROKER RISKGATE (A-04) & MTM BREAKER (A-05)");
  console.log("===============================================================================\n");

  const killSwitchFile = resolveDataFilePath("risk_kill_switch.json");
  if (fs.existsSync(killSwitchFile)) {
    try { fs.unlinkSync(killSwitchFile); } catch {}
  }
  RiskGate.resetKillSwitch("test_runner_init");

  const adminCookie = `auth_session=${createSessionToken("usr_admin_varsha")}`;
  const testAdminId = "usr_admin_varsha";

  let regularTrader = findUserByEmail("regular_trader@safecoiner.com");
  if (!regularTrader) {
    const reg = registerUser("regular_trader@safecoiner.com", "SecurePass123!", "regular_trader");
    regularTrader = reg.user;
  }
  const testTraderId = regularTrader?.id || "usr_trader_fallback";
  const traderCookie = `auth_session=${createSessionToken(testTraderId)}`;

  // ─────────────────────────────────────────────────────────────────────────
  // SUITE 1: Pre-Broker Notional Size Caps ($500 Cap for Micro-Live)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("--- SUITE 1: Pre-Broker Notional Size Caps ($500 Cap) ---");

  // 1.1 Valid sizes under $500
  const pass1 = RiskGate.validatePreOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 0.005, price: 80000, notionalUsdt: 400.0 });
  assert(pass1.allowed === true, "1.1.1: Order with notional $400 is approved", JSON.stringify(pass1));
  assert(pass1.code === "RISK_APPROVED", "1.1.2: Code is RISK_APPROVED", pass1.code);

  const pass2 = RiskGate.validatePreOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 0.00625, price: 80000, notionalUsdt: 500.0 });
  assert(pass2.allowed === true, "1.1.3: Order exactly at $500 cap is approved", JSON.stringify(pass2));

  // 1.2 Over-sized orders (> $500)
  const rej1 = RiskGate.validatePreOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 0.006251, price: 80000, notionalUsdt: 500.08 });
  assert(rej1.allowed === false, "1.2.1: Order at $500.08 is rejected", JSON.stringify(rej1));
  assert(rej1.code === "ORDER_EXCEEDS_NOTIONAL_CAP", "1.2.2: Rejection code is ORDER_EXCEEDS_NOTIONAL_CAP", rej1.code);
  assert(rej1.reason?.includes("exceeds maximum allowed cap of $500.00") ?? false, "1.2.3: Rejection reason reports $500 cap", rej1.reason);

  const rej2 = RiskGate.validatePreOrder({ symbol: "ETHUSDT", side: "SELL", quantity: 1.0, price: 2500, notionalUsdt: 2500.0 });
  assert(rej2.allowed === false, "1.2.4: $2,500 notional order is rejected", JSON.stringify(rej2));
  assert(rej2.code === "ORDER_EXCEEDS_NOTIONAL_CAP", "1.2.5: $2,500 order code is ORDER_EXCEEDS_NOTIONAL_CAP", rej2.code);

  const rej3 = RiskGate.validatePreOrder({ symbol: "SOLUSDT", side: "BUY", quantity: 500, price: 180 }); // 500 * 180 = $90,000
  assert(rej3.allowed === false, "1.2.6: $90,000 computed notional order is rejected", JSON.stringify(rej3));

  // 1.3 Invalid Price & Quantity Guard
  const invQty1 = RiskGate.validatePreOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 0 });
  assert(invQty1.allowed === false && invQty1.code === "INVALID_PRICE_OR_QUANTITY", "1.3.1: Zero quantity is rejected as INVALID_PRICE_OR_QUANTITY");

  const invQty2 = RiskGate.validatePreOrder({ symbol: "BTCUSDT", side: "BUY", quantity: -0.5 });
  assert(invQty2.allowed === false && invQty2.code === "INVALID_PRICE_OR_QUANTITY", "1.3.2: Negative quantity is rejected");

  const invQty3 = RiskGate.validatePreOrder({ symbol: "BTCUSDT", side: "BUY", quantity: NaN });
  assert(invQty3.allowed === false && invQty3.code === "INVALID_PRICE_OR_QUANTITY", "1.3.3: NaN quantity is rejected");

  const invPrice1 = RiskGate.validatePreOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 0.1, price: -100 });
  assert(invPrice1.allowed === false && invPrice1.code === "INVALID_PRICE_OR_QUANTITY", "1.3.4: Negative price is rejected");

  // ─────────────────────────────────────────────────────────────────────────
  // SUITE 2: Floating MTM Drawdown & Circuit Breaker Triggers (A-05)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- SUITE 2: Floating MTM Drawdown & Circuit Breaker Triggers ---");

  // 2.1 Baseline State: No Drawdown
  const mtm0 = RiskGate.computeLiveMtmDrawdown(testAdminId);
  assert(mtm0.drawdownPct === 0, "2.1.1: Fresh initial state has 0.00% drawdown");
  assert(mtm0.totalLoss === 0, "2.1.2: Initial total loss is 0.00 USDT");

  // 2.2 Simulate acceptable floating loss (e.g. -$40 USDT on active hedge)
  const mockState1 = {
    cyclesCompleted: 1,
    lastCycleTimestamp: Date.now(),
    bots: [
      {
        id: "bot_test_1",
        name: "TestBot",
        statusText: "HEDGED",
        config: {
          enabled: true,
          executionCorridor: "BINANCE_BITGET",
          maxSimultaneousHedges: 3,
          balanceAllocationPct: 20,
          minSpreadBps: 35,
          targetProfitSpreadBps: 20,
          stopLossSpreadBps: 60,
          maxHoldHours: 12,
          leverageMode: "MAX_PER_COIN" as const,
          customLeverage: 10,
          postSettlementWaitSeconds: 120,
          closeMaxPriceDivergencePct: 0.25,
          scanIntervalSeconds: 5,
        },
        activeHedges: [
          {
            id: "HEDGE-1",
            symbol: "BTCUSDT",
            direction: "SHORT_BINANCE_LONG_BITGET",
            quantity: "0.005",
            effectiveQty: 0.005,
            notionalUsdt: 400,
            binanceLeverage: 10,
            bitgetLeverage: 10,
            entrySpreadBps: 45,
            entryBinancePrice: 80000,
            entryBitgetPrice: 80000,
            entryDivergencePct: 0.02,
            entryTime: Date.now(),
            fundingSettlementTime: Date.now() + 3600000,
            status: "ACTIVE",
            pnl: -40.0, // Floating loss -$40
          },
        ],
        completedHedges: [],
      },
    ],
  };
  saveBotState(mockState1 as unknown as BotEngineState, testAdminId);

  const mtm1 = RiskGate.computeLiveMtmDrawdown(testAdminId);
  assert(mtm1.floatingLoss === 40.0, "2.2.1: Correctly captured floating unrealized loss of $40.00", `${mtm1.floatingLoss}`);
  assert(mtm1.drawdownPct < RISK_LIMITS.MAX_DAILY_MTM_DRAWDOWN_PCT, "2.2.2: $40 loss on $3,750 is ~1.07% (< 4.0% limit)");

  const preOrderCheck1 = RiskGate.validatePreOrder({
    userId: testAdminId,
    symbol: "ETHUSDT",
    side: "BUY",
    quantity: 0.1,
    price: 2500,
    notionalUsdt: 250.0,
  });
  assert(preOrderCheck1.allowed === true, "2.2.3: Order approved under 1.07% drawdown", JSON.stringify(preOrderCheck1));

  // 2.3 Breach Drawdown: Inject floating loss of -$165 USDT (Drawdown 4.4% >= 4.0% & > $150 limit)
  mockState1.bots[0].activeHedges[0].pnl = -165.0;
  saveBotState(mockState1 as unknown as BotEngineState, testAdminId);

  const mtm2 = RiskGate.computeLiveMtmDrawdown(testAdminId);
  assert(mtm2.floatingLoss === 165.0, "2.3.1: Floating loss recorded as $165.00");
  assert(mtm2.totalLoss === 165.0, "2.3.2: Total loss is $165.00");
  assert(mtm2.drawdownPct >= RISK_LIMITS.MAX_DAILY_MTM_DRAWDOWN_PCT, "2.3.3: Drawdown (4.4%) breaches 4.0% ceiling");

  const breachCheck = RiskGate.validatePreOrder({
    userId: testAdminId,
    symbol: "SOLUSDT",
    side: "BUY",
    quantity: 1.0,
    price: 150,
    notionalUsdt: 150.0,
  });
  assert(breachCheck.allowed === false, "2.3.4: Pre-order validation rejected on 4.4% MTM drawdown breach", JSON.stringify(breachCheck));
  assert(breachCheck.code === "MAX_DAILY_DRAWDOWN_BREACHED", "2.3.5: Rejection code is MAX_DAILY_DRAWDOWN_BREACHED", breachCheck.code);
  assert(RiskGate.isKillSwitchActive() === true, "2.3.6: Kill-switch was automatically latched into ACTIVE state");

  // ─────────────────────────────────────────────────────────────────────────
  // SUITE 3: Persistent Global Kill-Switch & Latch Enforcement
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- SUITE 3: Persistent Global Kill-Switch & Latch Enforcement ---");

  // 3.1 Kill switch persists to disk
  assert(fs.existsSync(killSwitchFile) === true, "3.1.1: risk_kill_switch.json exists on disk");
  const diskKillData = JSON.parse(fs.readFileSync(killSwitchFile, "utf-8"));
  assert(diskKillData.active === true, "3.1.2: Disk kill switch file records active: true");
  assert(diskKillData.reason?.includes("Daily MTM drawdown breach") ?? false, "3.1.3: Disk kill switch records breach reason");

  // 3.2 While kill switch is latched, ANY regular order is rejected immediately
  const smallOrder = RiskGate.validatePreOrder({
    symbol: "DOGEUSDT",
    side: "BUY",
    quantity: 50,
    price: 0.15,
    notionalUsdt: 7.5,
  });
  assert(smallOrder.allowed === false, "3.2.1: Micro order ($7.50) rejected when kill-switch is active", JSON.stringify(smallOrder));
  assert(smallOrder.code === "EMERGENCY_HALT_ACTIVE", "3.2.2: Rejection code is EMERGENCY_HALT_ACTIVE", smallOrder.code);

  // 3.3 Admin Reset of Kill Switch
  // Clear the simulated loss first
  mockState1.bots[0].activeHedges = [];
  saveBotState(mockState1 as unknown as BotEngineState, testAdminId);

  const resetSuccess = RiskGate.resetKillSwitch(testAdminId);
  assert(resetSuccess === true, "3.3.1: Admin resetKillSwitch returns true");
  assert(RiskGate.isKillSwitchActive() === false, "3.3.2: Kill-switch is now inactive");

  const diskAfterReset = JSON.parse(fs.readFileSync(killSwitchFile, "utf-8"));
  assert(diskAfterReset.active === false, "3.3.3: Disk kill switch file updated to active: false");

  const postResetOrder = RiskGate.validatePreOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 0.002,
    price: 80000,
    notionalUsdt: 160.0,
  });
  assert(postResetOrder.allowed === true, "3.3.4: Normal orders approved after admin kill-switch reset", JSON.stringify(postResetOrder));

  // ─────────────────────────────────────────────────────────────────────────
  // SUITE 4: Emergency Unwind & Position Close Exemption
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- SUITE 4: Emergency Unwind & Position Close Exemption ---");

  // Re-trip kill switch manually
  RiskGate.tripKillSwitch("Adversarial emergency test halt", "TestSuite");
  assert(RiskGate.isKillSwitchActive() === true, "4.1.1: Kill-switch manually primed to ACTIVE");

  // Normal order rejected
  const normOrd = RiskGate.validatePreOrder({ symbol: "ETHUSDT", side: "BUY", quantity: 0.05, price: 2500, notionalUsdt: 125 });
  assert(normOrd.allowed === false && normOrd.code === "EMERGENCY_HALT_ACTIVE", "4.1.2: Regular order rejected while kill-switch active");

  // Emergency close order (isEmergencyClose: true) MUST be approved
  const emClose1 = RiskGate.validatePreOrder({
    symbol: "ETHUSDT",
    side: "SELL",
    quantity: 0.05,
    price: 2500,
    notionalUsdt: 125,
    isEmergencyClose: true,
  });
  assert(emClose1.allowed === true, "4.2.1: isEmergencyClose: true is APPROVED even during active kill-switch", JSON.stringify(emClose1));
  assert(emClose1.code === "RISK_APPROVED", "4.2.2: Emergency close receives RISK_APPROVED code", emClose1.code);

  // Even for over-sized emergency close ($1,500 position unwinding), it MUST pass
  const emCloseOverSize = RiskGate.validatePreOrder({
    symbol: "BTCUSDT",
    side: "SELL",
    quantity: 0.02,
    price: 80000,
    notionalUsdt: 1600.0,
    isEmergencyClose: true,
  });
  assert(emCloseOverSize.allowed === true, "4.2.3: Over-sized position unwind ($1,600) is APPROVED for risk reduction", JSON.stringify(emCloseOverSize));

  // Reset for next suites
  RiskGate.resetKillSwitch(testAdminId);

  // ─────────────────────────────────────────────────────────────────────────
  // SUITE 5: Portfolio Gross Exposure Limits
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- SUITE 5: Portfolio Gross Exposure Limits ($2,500 Cap) ---");

  // Mock active hedges with $2,200 notional total
  const mockStateExposure = {
    cyclesCompleted: 1,
    lastCycleTimestamp: Date.now(),
    bots: [
      {
        id: "bot_exposure",
        name: "ExposureBot",
        statusText: "HEDGED",
        config: mockState1.bots[0].config,
        activeHedges: [
          {
            id: "H-1",
            symbol: "BTCUSDT",
            direction: "SHORT_A_LONG_B",
            quantity: "0.02",
            effectiveQty: 0.02,
            notionalUsdt: 1600.0,
            binanceLeverage: 10,
            bitgetLeverage: 10,
            entrySpreadBps: 40,
            entryBinancePrice: 80000,
            entryBitgetPrice: 80000,
            entryDivergencePct: 0.01,
            entryTime: Date.now(),
            fundingSettlementTime: Date.now() + 3600000,
            status: "ACTIVE",
            pnl: 0,
          },
          {
            id: "H-2",
            symbol: "ETHUSDT",
            direction: "SHORT_A_LONG_B",
            quantity: "0.24",
            effectiveQty: 0.24,
            notionalUsdt: 600.0,
            binanceLeverage: 10,
            bitgetLeverage: 10,
            entrySpreadBps: 40,
            entryBinancePrice: 2500,
            entryBitgetPrice: 2500,
            entryDivergencePct: 0.01,
            entryTime: Date.now(),
            fundingSettlementTime: Date.now() + 3600000,
            status: "ACTIVE",
            pnl: 0,
          },
        ],
        completedHedges: [],
      },
    ],
  };
  saveBotState(mockStateExposure as unknown as BotEngineState, testAdminId);

  // Current exposure is $1,600 + $600 = $2,200 USDT.
  // Adding an order of $200 (Total $2,400 <= $2,500) -> Approved
  const expPass = RiskGate.validatePreOrder({
    userId: testAdminId,
    symbol: "SOLUSDT",
    side: "BUY",
    quantity: 1.0,
    price: 200,
    notionalUsdt: 200.0,
  });
  assert(expPass.allowed === true, "5.1.1: Order adding $200 notional (total $2,400 <= $2,500) is approved", JSON.stringify(expPass));

  // Adding an order of $400 (Total $2,600 > $2,500) -> Rejected
  const expRej = RiskGate.validatePreOrder({
    userId: testAdminId,
    symbol: "SOLUSDT",
    side: "BUY",
    quantity: 2.0,
    price: 200,
    notionalUsdt: 400.0,
  });
  assert(expRej.allowed === false, "5.1.2: Order pushing total gross exposure ($2,600) above $2,500 is rejected", JSON.stringify(expRej));
  assert(expRej.code === "GROSS_EXPOSURE_CAP_BREACHED", "5.1.3: Code is GROSS_EXPOSURE_CAP_BREACHED", expRej.code);

  // Clear mock exposure state
  mockStateExposure.bots[0].activeHedges = [];
  saveBotState(mockStateExposure as unknown as BotEngineState, testAdminId);

  // ─────────────────────────────────────────────────────────────────────────
  // SUITE 6: End-to-End Route Interception Challenge
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- SUITE 6: End-to-End Route Interception Challenge ---");

  // Helper to create authenticated NextRequest with test headers
  function makeAuthReq(url: string, body: any, cookie: string): NextRequest {
    return new NextRequest(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-binance-key": "mock_bn_key",
        "x-binance-secret": "mock_bn_sec",
        "x-bybit-key": "mock_bb_key",
        "x-bybit-secret": "mock_bb_sec",
        "x-coindcx-key": "mock_cdx_key",
        "x-coindcx-secret": "mock_cdx_sec",
        "x-bitget-key": "mock_bg_key",
        "x-bitget-secret": "mock_bg_sec",
        "x-bitget-passphrase": "mock_bg_pass",
      },
      body: JSON.stringify(body),
    });
  }

  // 6.1 Binance Route (/api/order): Over-sized order (> $500) rejected with HTTP 403
  const bnOverReq = makeAuthReq("http://localhost:3000/api/order", {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "0.01", // 0.01 * ~80000 = $800 > $500
    notionalUsdt: "800.0",
  }, adminCookie);
  const bnOverRes = await binanceOrderRoute(bnOverReq);
  const bnOverJson = await bnOverRes.json();
  assert(bnOverRes.status === 403, "6.1.1: Binance route returns HTTP 403 on over-sized order", `${bnOverRes.status}`);
  assert(bnOverJson.code === "ORDER_EXCEEDS_NOTIONAL_CAP", "6.1.2: Binance route error code is ORDER_EXCEEDS_NOTIONAL_CAP", bnOverJson.code);

  // 6.2 Bitget Route (/api/bitget/order): Over-sized order rejected with HTTP 403
  const bgOverReq = makeAuthReq("http://localhost:3000/api/bitget/order", {
    symbol: "BTCUSDT",
    side: "buy",
    size: "0.01",
    notionalUsdt: "750.0",
  }, adminCookie);
  const bgOverRes = await bitgetOrderRoute(bgOverReq);
  const bgOverJson = await bgOverRes.json();
  assert(bgOverRes.status === 403, "6.2.1: Bitget route returns HTTP 403 on over-sized order", `${bgOverRes.status}`);
  assert(bgOverJson.code === "ORDER_EXCEEDS_NOTIONAL_CAP", "6.2.2: Bitget route error code is ORDER_EXCEEDS_NOTIONAL_CAP", bgOverJson.code);

  // 6.3 Bybit Route (/api/bybit/order): Over-sized order rejected with HTTP 403
  const bbOverReq = makeAuthReq("http://localhost:3000/api/bybit/order", {
    symbol: "BTCUSDT",
    side: "Buy",
    quantity: "0.01",
    notionalUsdt: "900.0",
  }, adminCookie);
  const bbOverRes = await bybitOrderRoute(bbOverReq);
  const bbOverJson = await bbOverRes.json();
  assert(bbOverRes.status === 403, "6.3.1: Bybit route returns HTTP 403 on over-sized order", `${bbOverRes.status}`);
  assert(bbOverJson.code === "ORDER_EXCEEDS_NOTIONAL_CAP", "6.3.2: Bybit route error code is ORDER_EXCEEDS_NOTIONAL_CAP", bbOverJson.code);

  // 6.4 CoinDCX Route (/api/coindcx/order): Over-sized order rejected with HTTP 403
  const cdxOverReq = makeAuthReq("http://localhost:3000/api/coindcx/order", {
    symbol: "BTCUSDT",
    side: "buy",
    quantity: "0.01",
    notionalUsdt: "850.0",
  }, adminCookie);
  const cdxOverRes = await coindcxOrderRoute(cdxOverReq);
  const cdxOverJson = await cdxOverRes.json();
  assert(cdxOverRes.status === 403, "6.4.1: CoinDCX route returns HTTP 403 on over-sized order", `${cdxOverRes.status}`);
  assert(cdxOverJson.code === "ORDER_EXCEEDS_NOTIONAL_CAP", "6.4.2: CoinDCX route error code is ORDER_EXCEEDS_NOTIONAL_CAP", cdxOverJson.code);

  // 6.5 Arbitrage Hedge Route (/api/hedge): Over-sized order rejected with HTTP 403
  const hedgeOverReq = makeAuthReq("http://localhost:3000/api/hedge", {
    symbol: "BTCUSDT",
    direction: "STANDARD_CARRY",
    action: "entry",
    quantity: "0.01", // notional > $500
    tradingMode: "mainnet",
    isArmed: true,
  }, adminCookie);
  const hedgeOverRes = await hedgeRoute(hedgeOverReq);
  const hedgeOverJson = await hedgeOverRes.json();
  assert(hedgeOverRes.status === 403, "6.5.1: Hedge route returns HTTP 403 on over-sized entry", `${hedgeOverRes.status}`);
  assert(hedgeOverJson.code === "ORDER_EXCEEDS_NOTIONAL_CAP", "6.5.2: Hedge route code is ORDER_EXCEEDS_NOTIONAL_CAP", hedgeOverJson.code);

  // 6.6 Risk Telemetry & Control Route (/api/risk)
  // GET: authenticated user can retrieve risk telemetry
  const riskGetReq = new NextRequest("http://localhost:3000/api/risk", {
    method: "GET",
    headers: { cookie: adminCookie },
  });
  const riskGetRes = await riskGetRoute(riskGetReq);
  const riskGetJson = await riskGetRes.json();
  assert(riskGetRes.status === 200, "6.6.1: GET /api/risk returns HTTP 200", `${riskGetRes.status}`);
  assert(riskGetJson.risk?.maxSingleOrderNotionalUsdt === 500.0, "6.6.2: GET /api/risk reports $500 cap");
  assert(riskGetJson.risk?.maxDailyDrawdownPct === 0.04, "6.6.3: GET /api/risk reports 4.0% drawdown limit");

  // POST: non-admin cannot trip or reset kill-switch
  const nonAdminTripReq = makeAuthReq("http://localhost:3000/api/risk", { action: "trip" }, traderCookie);
  const nonAdminTripRes = await riskPostRoute(nonAdminTripReq);
  assert(nonAdminTripRes.status === 403, "6.6.4: Non-admin cannot trip kill-switch (HTTP 403)", `${nonAdminTripRes.status}`);

  // POST: admin can trip kill-switch
  const adminTripReq = makeAuthReq("http://localhost:3000/api/risk", { action: "trip", reason: "Manual drill test" }, adminCookie);
  const adminTripRes = await riskPostRoute(adminTripReq);
  const adminTripJson = await adminTripRes.json();
  assert(adminTripRes.status === 200, "6.6.5: Admin trip returns HTTP 200");
  assert(adminTripJson.risk?.killSwitchActive === true, "6.6.6: Telemetry confirms kill-switch active");

  // While tripped, route rejects even small order
  const bnHaltReq = makeAuthReq("http://localhost:3000/api/order", {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "0.001",
    notionalUsdt: "80.0",
  }, adminCookie);
  const bnHaltRes = await binanceOrderRoute(bnHaltReq);
  const bnHaltJson = await bnHaltRes.json();
  assert(bnHaltRes.status === 403, "6.6.7: Binance route rejects small order when kill-switch is tripped (403)");
  assert(bnHaltJson.code === "EMERGENCY_HALT_ACTIVE", "6.6.8: Binance code is EMERGENCY_HALT_ACTIVE", bnHaltJson.code);

  // POST: admin can reset kill-switch
  const adminResetReq = makeAuthReq("http://localhost:3000/api/risk", { action: "reset" }, adminCookie);
  const adminResetRes = await riskPostRoute(adminResetReq);
  const adminResetJson = await adminResetRes.json();
  assert(adminResetRes.status === 200, "6.6.9: Admin reset returns HTTP 200");
  assert(adminResetJson.risk?.killSwitchActive === false, "6.6.10: Telemetry confirms kill-switch is inactive");

  // Clean up disk state
  if (fs.existsSync(killSwitchFile)) {
    try { fs.unlinkSync(killSwitchFile); } catch {}
  }

  console.log("\n===============================================================================");
  console.log(`  MILESTONE 3 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Test execution threw unhandled exception:", err);
  process.exit(1);
});
