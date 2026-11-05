/**
 * Adversarial Milestone 2 Challenge Harness:
 * Track A-03: Exclusive OS-Level Kernel File Lock (bot_daemon.lock)
 * Track A-06: Universal RFC 4122 v4 UUID Client Order ID Idempotency
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fork } from "child_process";
import { NextRequest } from "next/server";

import {
  acquireDaemonLock,
  releaseDaemonLock,
  isDaemonLocked,
  isDaemonLockHeldByCurrentProcess,
  updateDaemonLockHeartbeat,
  clearStaleDaemonLock,
  getDaemonLockInfo,
  getDaemonLockFilePath,
  isProcessActive,
  LockCollisionError,
} from "../lib/daemonLockManager";

import { placeBinanceOrder } from "../lib/binanceSigner";
import { placeBitgetOrder } from "../lib/bitgetSigner";
import { placeBybitOrder } from "../lib/bybitSigner";
import { executeDualHedgeEntry, loadBotState, BotConfig, BotEngineState, ActiveBotHedge } from "../lib/botEngine";
import { GET, POST } from "../app/api/bot/daemon/route";
import { createSessionToken, saveUsers, UserAccount } from "../lib/userStore";
import { encryptVaultSecret } from "../lib/cryptoVault";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  console.log("  ADVERSARIAL STRESS TEST: KERNEL LOCKING (A-03) & CLIENT ORDER ID (A-06)");
  console.log("===============================================================================\n");

  const lockFilePath = getDaemonLockFilePath();

  // Clean slate before starting tests
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {}

  // ---------------------------------------------------------------------------
  // SUITE 1: Exclusive OS-Level Kernel Lock (bot_daemon.lock)
  // ---------------------------------------------------------------------------
  console.log("--- SUITE 1: Exclusive OS-Level Kernel File Lock (bot_daemon.lock) ---");

  // Test 1.1: Clean acquisition when lockfile does not exist
  const acq1 = acquireDaemonLock();
  assert(acq1.acquired === true, "1.1.1: Clean acquisition acquires lockfile successfully");
  assert(acq1.pid === process.pid, "1.1.2: Lock payload records current process PID");
  assert(typeof acq1.instanceUuid === "string" && acq1.instanceUuid.length === 36, "1.1.3: Lock payload assigns RFC 4122 UUID instanceUuid");
  assert(fs.existsSync(lockFilePath), "1.1.4: bot_daemon.lock exists on disk after acquisition");

  const lockDiskInfo = getDaemonLockInfo();
  assert(lockDiskInfo?.pid === process.pid, "1.1.5: Disk lock metadata matches current process PID");
  assert(lockDiskInfo?.platform === process.platform, "1.1.6: Disk lock metadata matches current OS platform");
  assert(lockDiskInfo?.hostname === os.hostname(), "1.1.7: Disk lock metadata matches host hostname");
  assert(isDaemonLocked() === true, "1.1.8: isDaemonLocked() returns true while lock is actively held");
  assert(isDaemonLockHeldByCurrentProcess() === true, "1.1.9: isDaemonLockHeldByCurrentProcess() returns true for owner");

  // Test 1.2: Duplicate acquisition in same process throws LockCollisionError
  let duplicateThrew = false;
  let collisionPid = 0;
  try {
    acquireDaemonLock({ throwOnCollision: true });
  } catch (err: any) {
    duplicateThrew = true;
    collisionPid = err.pid;
    assert(err instanceof LockCollisionError, "1.2.1: Duplicate acquisition throws LockCollisionError instance");
    assert(err.message.includes("Lockfile collision: Daemon already running under PID"), "1.2.2: Error message contains exact collision prefix");
  }
  assert(duplicateThrew && collisionPid === process.pid, "1.2.3: Duplicate acquisition rejected with current PID");

  // Test 1.2.4: Duplicate acquisition with throwOnCollision: false returns failure object
  const dupeResult = acquireDaemonLock({ throwOnCollision: false });
  assert(dupeResult.acquired === false, "1.2.4: Duplicate acquisition with throwOnCollision:false returns acquired=false");
  assert(dupeResult.pid === process.pid, "1.2.5: Duplicate acquisition returns colliding PID");

  // Test 1.3: Heartbeat updates
  const originalHeartbeat = lockDiskInfo?.heartbeat || 0;
  await new Promise((r) => setTimeout(r, 20));
  const hbUpdated = updateDaemonLockHeartbeat();
  assert(hbUpdated === true, "1.3.1: updateDaemonLockHeartbeat() returns true for lock owner");
  const postHbInfo = getDaemonLockInfo();
  assert((postHbInfo?.heartbeat || 0) >= originalHeartbeat, "1.3.2: Lock heartbeat timestamp monotonically increases");
  assert(postHbInfo?.instanceUuid === acq1.instanceUuid, "1.3.3: Heartbeat preserves original instanceUuid");

  // Test 1.4: Cross-Process Concurrency / Multi-process Mutual Exclusion
  // Spawn a child process to attempt lock acquisition while parent holds lock
  const childScript = `
    const { acquireDaemonLock } = require(${JSON.stringify(path.resolve(__dirname, "../lib/daemonLockManager"))});
    try {
      acquireDaemonLock({ throwOnCollision: true });
      process.exit(0); // Unexpected success
    } catch (err) {
      if (err.name === 'LockCollisionError') {
        process.exit(42); // Expected collision rejection
      }
      process.exit(99);
    }
  `;
  const childExitCode = await new Promise<number>((resolve) => {
    const cp = fork("-e", [childScript], { stdio: "pipe" });
    cp.on("exit", (code) => resolve(code ?? -1));
  });
  assert(childExitCode === 42, "1.4.1: Spawning a second process while lock is active throws LockCollisionError immediately (exit 42)");

  // Test 1.5: Foreign Lock Protection (Cannot release a lock held by another process)
  // Simulate foreign lock by editing lockfile with another PID
  const foreignPid = 99999999;
  const fakeForeignPayload = {
    pid: foreignPid,
    startedAt: Date.now(),
    heartbeat: Date.now(),
    hostname: "foreign-host",
    platform: "linux",
    instanceUuid: crypto.randomUUID(),
  };
  fs.writeFileSync(lockFilePath, JSON.stringify(fakeForeignPayload, null, 2), "utf-8");

  // Attempt to release foreign lock
  const foreignReleaseResult = releaseDaemonLock();
  assert(foreignReleaseResult === false, "1.5.1: releaseDaemonLock() refuses to release a lock owned by another process");
  assert(fs.existsSync(lockFilePath) === true, "1.5.2: Foreign lockfile remains intact on disk after unauthorized release attempt");

  // Test 1.6: Stale Lock Recovery
  // Foreign PID 99999999 is dead (ESRCH verified)
  assert(isProcessActive(foreignPid) === false, "1.6.1: PID 99999999 verified dead (ESRCH)");
  assert(isDaemonLocked() === false, "1.6.2: isDaemonLocked() returns false when lockfile has dead PID");

  // Calling acquireDaemonLock() with dead PID on disk must clean up and acquire
  const staleAcq = acquireDaemonLock();
  assert(staleAcq.acquired === true, "1.6.3: acquireDaemonLock() recovers from stale lockfile and acquires");
  assert(staleAcq.pid === process.pid, "1.6.4: Recovered lockfile now owned by current process PID");

  // Test 1.7: Legitimate release by owner
  const ownReleaseResult = releaseDaemonLock();
  assert(ownReleaseResult === true, "1.7.1: releaseDaemonLock() returns true when invoked by owner");
  assert(fs.existsSync(lockFilePath) === false, "1.7.2: bot_daemon.lock removed from disk after owner release");
  assert(isDaemonLocked() === false, "1.7.3: isDaemonLocked() returns false after release");
  assert(isDaemonLockHeldByCurrentProcess() === false, "1.7.4: isDaemonLockHeldByCurrentProcess() returns false after release");

  // ---------------------------------------------------------------------------
  // SUITE 2: Universal RFC 4122 v4 Client Order ID Idempotency
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 2: Universal RFC 4122 v4 Client Order ID Idempotency ---");

  // 2.1: Binance Order Idempotency
  console.log("  Testing Binance Signer (lib/binanceSigner.ts)...");
  // Default UUID generation test
  const bnResult1 = await placeBinanceOrder(
    { apiKey: "test_key", apiSecret: "test_secret", endpoint: "https://testnet.binancefuture.com" },
    { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.001 }
  );
  assert(typeof bnResult1.clientOrderId === "string", "2.1.1: Binance order result returns clientOrderId");
  assert(UUID_V4_REGEX.test(bnResult1.clientOrderId || ""), "2.1.2: Binance default clientOrderId is valid RFC 4122 v4 UUID");
  assert((bnResult1.clientOrderId || "").length === 36, "2.1.3: Binance default clientOrderId length is exactly 36 chars");

  // Explicit UUID override test
  const customBnUuid = crypto.randomUUID();
  const bnResult2 = await placeBinanceOrder(
    { apiKey: "test_key", apiSecret: "test_secret", endpoint: "https://testnet.binancefuture.com" },
    { symbol: "BTCUSDT", side: "SELL", type: "MARKET", quantity: 0.001, clientOrderId: customBnUuid }
  );
  assert(bnResult2.clientOrderId === customBnUuid, "2.1.4: Binance accepts and transmits explicit custom clientOrderId");

  // Uniqueness across consecutive orders
  const bnResult3 = await placeBinanceOrder(
    { apiKey: "test_key", apiSecret: "test_secret", endpoint: "https://testnet.binancefuture.com" },
    { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.001 }
  );
  assert(bnResult1.clientOrderId !== bnResult3.clientOrderId, "2.1.5: Binance generates unique UUIDs across consecutive orders");

  // Invalid override validation & fallback
  const bnInvalidRes = await placeBinanceOrder(
    { apiKey: "test_key", apiSecret: "test_secret", endpoint: "https://testnet.binancefuture.com" },
    { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.001, clientOrderId: "invalid@client#id!with$symbols*and_spaces" }
  );
  assert(
    typeof bnInvalidRes.clientOrderId === "string" && UUID_V4_REGEX.test(bnInvalidRes.clientOrderId),
    "2.1.6: Binance rejects invalid clientOrderId override and falls back to valid RFC 4122 v4 UUID"
  );

  // 2.2: Bitget Order Idempotency
  console.log("  Testing Bitget Signer (lib/bitgetSigner.ts)...");
  // Simulation mode (no credentials) default UUID
  const bgResult1 = await placeBitgetOrder({
    symbol: "BTCUSDT",
    side: "buy",
    size: "0.001",
    orderType: "market",
    tradeSide: "open",
  });
  assert(typeof bgResult1.clientOid === "string", "2.2.1: Bitget order result returns clientOid");
  assert(UUID_V4_REGEX.test(bgResult1.clientOid!), "2.2.2: Bitget default clientOid is valid RFC 4122 v4 UUID");
  assert(bgResult1.clientOid!.length === 36, "2.2.3: Bitget default clientOid length is exactly 36 chars");

  // Explicit clientOid override test
  const customBgUuid = crypto.randomUUID();
  const bgResult2 = await placeBitgetOrder({
    symbol: "BTCUSDT",
    side: "sell",
    size: "0.001",
    orderType: "market",
    tradeSide: "open",
    clientOid: customBgUuid,
  });
  assert(bgResult2.clientOid === customBgUuid, "2.2.4: Bitget accepts and forwards explicit custom clientOid");

  // Consecutive uniqueness
  const bgResult3 = await placeBitgetOrder({
    symbol: "BTCUSDT",
    side: "buy",
    size: "0.001",
    orderType: "market",
    tradeSide: "open",
  });
  assert(bgResult1.clientOid !== bgResult3.clientOid, "2.2.5: Bitget generates unique UUIDs across consecutive orders");

  // Invalid override validation & fallback
  const bgInvalidRes = await placeBitgetOrder({
    symbol: "BTCUSDT",
    side: "buy",
    size: "0.001",
    orderType: "market",
    tradeSide: "open",
    clientOid: "invalid bitget oid with spaces and #@! symbols",
  });
  assert(
    typeof bgInvalidRes.clientOid === "string" && UUID_V4_REGEX.test(bgInvalidRes.clientOid),
    "2.2.6: Bitget rejects invalid clientOid override and falls back to valid RFC 4122 v4 UUID"
  );

  // 2.3: Bybit Order Idempotency
  console.log("  Testing Bybit Signer (lib/bybitSigner.ts)...");
  const bybitCreds = {
    apiKey: "test_bybit_key",
    apiSecret: "test_bybit_secret",
  };
  const byResult1 = await placeBybitOrder(bybitCreds, {
    symbol: "BTCUSDT",
    side: "Buy",
    qty: 0.001,
    orderType: "Market",
  });
  assert(typeof byResult1.orderLinkId === "string", "2.3.1: Bybit order result returns orderLinkId");
  assert(UUID_V4_REGEX.test(byResult1.orderLinkId!), "2.3.2: Bybit default orderLinkId is valid RFC 4122 v4 UUID");
  assert(byResult1.orderLinkId!.length === 36, "2.3.3: Bybit default orderLinkId length is exactly 36 chars");
  assert(byResult1.clientOrderId === byResult1.orderLinkId, "2.3.4: Bybit clientOrderId alias matches orderLinkId");

  // Explicit orderLinkId override test
  const customByUuid = crypto.randomUUID();
  const byResult2 = await placeBybitOrder(bybitCreds, {
    symbol: "BTCUSDT",
    side: "Sell",
    qty: 0.001,
    orderType: "Market",
    orderLinkId: customByUuid,
  });
  assert(byResult2.orderLinkId === customByUuid, "2.3.5: Bybit accepts and forwards explicit custom orderLinkId");

  // Consecutive uniqueness
  const byResult3 = await placeBybitOrder(bybitCreds, {
    symbol: "BTCUSDT",
    side: "Buy",
    qty: 0.001,
    orderType: "Market",
  });
  assert(byResult1.orderLinkId !== byResult3.orderLinkId, "2.3.6: Bybit generates unique UUIDs across consecutive orders");

  // Invalid override validation & fallback
  const byInvalidRes = await placeBybitOrder(bybitCreds, {
    symbol: "BTCUSDT",
    side: "Buy",
    qty: 0.001,
    orderType: "Market",
    orderLinkId: "invalid bybit link with $pecial %chars! and spaces",
  });
  assert(
    typeof byInvalidRes.orderLinkId === "string" && UUID_V4_REGEX.test(byInvalidRes.orderLinkId),
    "2.3.7: Bybit rejects invalid orderLinkId override and falls back to valid RFC 4122 v4 UUID"
  );

  // 2.4: Bot Engine executeDualHedgeEntry UUID Generation
  console.log("  Testing Bot Engine executeDualHedgeEntry (lib/botEngine.ts)...");
  const mockCoin = {
    symbol: "ETHUSDT",
    direction: "SHORT_BINANCE_LONG_BITGET",
    spreadBps: 45.0,
    divergencePct: 0.02,
    binanceMarkPrice: 2500,
    bitgetMarkPrice: 2500,
    nextFundingTime: Date.now() + 3600000,
    leg1Side: "SELL",
  };

  const mockConfig: BotConfig = {
    enabled: true,
    minSpreadBps: 35.0,
    maxPriceDivergencePct: 0.05,
    balanceAllocationPct: 20,
    leverageMode: "MAX_PER_COIN",
    customLeverage: 10,
    maxSimultaneousHedges: 3,
    maxMarginCapUsdt: 500,
    executionCorridor: "COINDCX_BITGET",
    postSettlementWaitSeconds: 15,
    closeMaxPriceDivergencePct: 0.05,
    scanIntervalSeconds: 5,
  };

  const mockState: BotEngineState = loadBotState("usr_admin_varsha");

  // Simulated execution corridor: empty credentials engage simulated fills
  const entryResult = await executeDualHedgeEntry(
    mockCoin,
    mockConfig,
    20, // allocatedMargin ($200 notional <= $500 RiskGate cap)
    "TestBot",
    mockState,
    {
      binanceKey: "",
      binanceSecret: "",
      bitgetKey: "",
      bitgetSecret: "",
      bitgetPassphrase: "",
      bitgetEnv: "demo",
      coindcxKey: "",
      coindcxSecret: "",
    },
    "usr_admin_varsha",
    "bot-test"
  );

  // 2.4.1: Genuinely verify executeDualHedgeEntry UUID binding contracts on ActiveBotHedge
  assert(
    entryResult.success === true && Boolean(entryResult.hedge),
    "2.4.1.1: executeDualHedgeEntry executes successfully in simulation corridor",
    entryResult.error || ""
  );
  const hedge = entryResult.hedge!;
  assert(
    typeof hedge?.legAClientOrderId === "string" && UUID_V4_REGEX.test(hedge.legAClientOrderId),
    "2.4.1.2: executeDualHedgeEntry assigns valid RFC 4122 v4 UUID to legAClientOrderId",
    `legAClientOrderId: ${hedge?.legAClientOrderId}`
  );
  assert(
    typeof hedge?.legBClientOrderId === "string" && UUID_V4_REGEX.test(hedge.legBClientOrderId),
    "2.4.1.3: executeDualHedgeEntry assigns valid RFC 4122 v4 UUID to legBClientOrderId",
    `legBClientOrderId: ${hedge?.legBClientOrderId}`
  );
  assert(
    hedge?.legAClientOrderId !== hedge?.legBClientOrderId,
    "2.4.1.4: executeDualHedgeEntry assigns distinct UUIDs for Leg A & Leg B"
  );
  assert(
    hedge?.leg1ClientOrderId === hedge?.legAClientOrderId,
    "2.4.1.5: executeDualHedgeEntry maps leg1ClientOrderId to legAClientOrderId"
  );
  assert(
    hedge?.leg2ClientOrderId === hedge?.legBClientOrderId,
    "2.4.1.6: executeDualHedgeEntry maps leg2ClientOrderId to legBClientOrderId"
  );

  // ---------------------------------------------------------------------------
  // SUITE 3: Daemon Route Concurrency Locking & 409 Collision Gating
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 3: Daemon Route Concurrency Locking (app/api/bot/daemon) ---");

  // Ensure clean test user
  const adminUser: UserAccount = {
    id: "usr_admin_varsha",
    email: "varsha633@gmail.com",
    username: "Admin",
    password: "mock_hashed_password",
    role: "admin",
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    apiKeys: {
      binanceKey: "",
      binanceSecret: "",
      bitgetKey: "",
      bitgetSecret: "",
    },
  };
  saveUsers([adminUser]);
  const adminToken = createSessionToken(adminUser.id);

  // Subtest 3.1: Normal cron_tick when lock is free
  releaseDaemonLock();
  process.env.CRON_SECRET = "super_secret_cron_key_12345";
  const cronReqFree = new NextRequest("http://localhost:3000/api/bot/daemon?action=cron_tick", {
    method: "GET",
    headers: {
      "x-cron-secret": "super_secret_cron_key_12345",
    },
  });
  const cronResFree = await GET(cronReqFree);
  const cronJsonFree = await cronResFree.json();
  assert(cronResFree.status === 200, "3.1.1: GET cron_tick succeeds (200) when lock is available");
  assert(cronJsonFree.success === true, "3.1.2: GET cron_tick returns success=true");
  assert(cronJsonFree.isLocked === true, "3.1.3: GET cron_tick confirms lock is acquired");
  assert(isDaemonLocked() === true, "3.1.4: bot_daemon.lock is active on disk after cron_tick");

  // Release lock before foreign lock test
  releaseDaemonLock();

  // Subtest 3.2: Simulate an external process (foreign PID) holding the lock
  const simulatedExternalPid = 888888;
  const externalLockPayload = {
    pid: process.pid, // Use a running process PID so isProcessActive returns true
    startedAt: Date.now() - 60000,
    heartbeat: Date.now(),
    hostname: "remote-worker-node",
    platform: process.platform,
    instanceUuid: "00000000-0000-4000-8000-000000000000", // foreign instanceUuid!
  };
  // Write foreign lock payload with different instanceUuid
  fs.writeFileSync(lockFilePath, JSON.stringify(externalLockPayload, null, 2), "utf-8");

  // Verify route detects collision from foreign daemon
  // Note: Since PID is process.pid, but instanceUuid !== activeLockPayload.instanceUuid,
  // isDaemonLockHeldByCurrentProcess() returns false, causing acquireDaemonLock to run.
  // acquireDaemonLock attempts fs.openSync('wx') which throws EEXIST, and checks isProcessActive -> true!
  // It returns acquired: false with collision error!

  // 3.2.1: GET cron_tick with collision
  const cronReqCollision = new NextRequest("http://localhost:3000/api/bot/daemon?action=cron_tick", {
    method: "GET",
    headers: {
      "x-cron-secret": "super_secret_cron_key_12345",
    },
  });
  const cronResColl = await GET(cronReqCollision);
  const cronJsonColl = await cronResColl.json();
  assert(cronResColl.status === 409, "3.2.1: GET cron_tick returns HTTP 409 when lock is held by external daemon");
  assert(cronJsonColl.code === "LOCK_COLLISION", "3.2.2: GET cron_tick returns error code LOCK_COLLISION");
  assert(cronJsonColl.error.includes("Lockfile collision"), "3.2.3: Error message reports Lockfile collision");

  // 3.2.2: POST action=start with collision
  const startReqCollision = new NextRequest("http://localhost:3000/api/bot/daemon", {
    method: "POST",
    headers: {
      cookie: `auth_session=${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "start" }),
  });
  const startResColl = await POST(startReqCollision);
  const startJsonColl = await startResColl.json();
  assert(startResColl.status === 409, "3.2.4: POST action=start returns HTTP 409 on lock collision");
  assert(startJsonColl.code === "LOCK_COLLISION", "3.2.5: POST action=start code is LOCK_COLLISION");

  // 3.2.3: POST action=toggle_daemon with collision
  // Ensure state is stopped before attempting toggle to running
  const stopReq = new NextRequest("http://localhost:3000/api/bot/daemon", {
    method: "POST",
    headers: {
      cookie: `auth_session=${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "stop" }),
  });
  await POST(stopReq);
  // Re-write external lockfile since stop unlinked it
  fs.writeFileSync(lockFilePath, JSON.stringify(externalLockPayload, null, 2), "utf-8");

  const toggleReqCollision = new NextRequest("http://localhost:3000/api/bot/daemon", {
    method: "POST",
    headers: {
      cookie: `auth_session=${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "toggle_daemon" }),
  });
  const toggleResColl = await POST(toggleReqCollision);
  const toggleJsonColl = await toggleResColl.json();
  assert(toggleResColl.status === 409, "3.2.6: POST action=toggle_daemon returns HTTP 409 on lock collision");
  assert(toggleJsonColl.code === "LOCK_COLLISION", "3.2.7: POST action=toggle_daemon code is LOCK_COLLISION");

  // Subtest 3.3: Clean recovery after foreign lock terminates
  if (fs.existsSync(lockFilePath)) {
    fs.unlinkSync(lockFilePath);
  }
  const startReqClean = new NextRequest("http://localhost:3000/api/bot/daemon", {
    method: "POST",
    headers: {
      cookie: `auth_session=${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "start" }),
  });
  const startResClean = await POST(startReqClean);
  assert(startResClean.status === 200, "3.3.1: POST action=start succeeds (200) after lock is cleared");

  // Clean up lock
  releaseDaemonLock();

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log(`  MILESTONE 2 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Milestone 2 Challenge Exception:", err);
  process.exit(1);
});
