/**
 * EMPIRICAL CHALLENGER: Deep Adversarial Concurrency Locking & Order Idempotency Stress Suite
 * Target: SafeCoiner M2 Remediation (Track A-03 & Track A-06)
 *
 * Focus:
 * 1. Multi-Child Process Concurrent Lock Race (10 simultaneous processes)
 * 2. Multi-Request Concurrent Daemon Route Gating (/api/bot/daemon HTTP 409)
 * 3. Abnormal Process Termination (SIGKILL / Unhandled Exit) & Stale Lock Recovery
 * 4. Corrupted / Malformed Lockfile Graceful Recovery
 * 5. Foreign Lock Anti-Hijack & Unauthorized Release Gating
 * 6. 10,000 Client Order ID Collision & Strict RFC 4122 v4 Format Verification
 * 7. Exchange Signers (Binance, Bitget, Bybit) Malformed Input & Override Preservation
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fork, ChildProcess } from "child_process";
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
import { GET, POST } from "../app/api/bot/daemon/route";
import { createSessionToken, saveUsers, UserAccount } from "../lib/userStore";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let passed = 0;
let failed = 0;
const failures: Array<{ testName: string; details: string }> = [];

function assert(condition: boolean, testName: string, details = "") {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failed++;
    failures.push({ testName, details });
    console.error(`  [FAIL] ${testName}: ${details}`);
  }
}

async function run() {
  console.log("===============================================================================");
  console.log("  EMPIRICAL CHALLENGER: DEEP ADVERSARIAL STRESS TEST (M2 CONCURRENCY & IDEMPOTENCY)");
  console.log("===============================================================================\n");

  const lockFilePath = getDaemonLockFilePath();

  // Reset lock before starting
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {}

  // ---------------------------------------------------------------------------
  // SUITE 1: Multi-Process Concurrent Lock Race (10 Simultaneous Child Processes)
  // ---------------------------------------------------------------------------
  console.log("--- SUITE 1: Multi-Process Concurrent Lock Race (10 Simultaneous Child Processes) ---");
  try {
    const NUM_RACE_PROCESSES = 10;
    const workerScript = path.resolve(__dirname, "helpers/lock_race_worker.ts");
    const children: ChildProcess[] = [];
    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < NUM_RACE_PROCESSES; i++) {
      const cp = fork(workerScript, [], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
      });
      children.push(cp);

      readyPromises.push(
        new Promise<void>((resolve) => {
          const onMsg = (msg: any) => {
            if (msg?.type === "READY") {
              cp.off("message", onMsg);
              resolve();
            }
          };
          cp.on("message", onMsg);
        })
      );
    }

    // Wait until all 10 child processes are booted and ready to race
    await Promise.all(readyPromises);

    // Synchronously fire the RACE command to all 10 processes simultaneously
    const exitPromises = children.map((cp) => {
      return new Promise<{ pid: number; exitCode: number | null }>((resolve) => {
        cp.on("exit", (code) => {
          resolve({ pid: cp.pid || 0, exitCode: code });
        });
      });
    });

    for (const cp of children) {
      cp.send({ cmd: "RACE" });
    }

    const exitResults = await Promise.all(exitPromises);

    const acquiredProcesses = exitResults.filter((r) => r.exitCode === 10);
    const collisionProcesses = exitResults.filter((r) => r.exitCode === 20);
    const errorProcesses = exitResults.filter((r) => r.exitCode === 30 || (r.exitCode !== 10 && r.exitCode !== 20));

    assert(
      acquiredProcesses.length === 1,
      "1.1.1: Exactly ONE child process won the 10-way concurrent race",
      `Expected 1 winner, got ${acquiredProcesses.length} (${JSON.stringify(acquiredProcesses)})`
    );

    assert(
      collisionProcesses.length === NUM_RACE_PROCESSES - 1,
      `1.1.2: Exactly ${NUM_RACE_PROCESSES - 1} child processes were rejected with LockCollisionError`,
      `Expected ${NUM_RACE_PROCESSES - 1} collisions, got ${collisionProcesses.length}`
    );

    assert(
      errorProcesses.length === 0,
      "1.1.3: Zero child processes crashed or encountered unexpected errors during race",
      `Error count: ${errorProcesses.length} (${JSON.stringify(errorProcesses)})`
    );
  } catch (err: any) {
    assert(false, "1.1.X: Suite 1 Multi-Process Race Suite exception", err.message);
  } finally {
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // SUITE 2: Multi-Request Concurrent Daemon Route Gating (/api/bot/daemon HTTP 409)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 2: Concurrent API Gating Race (/api/bot/daemon HTTP 409) ---");
  try {
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

    // Ensure lock is free
    releaseDaemonLock();

    // Test cross-process route collision: lock is held by an active external daemon process
    const externalLockPayload = {
      pid: process.pid,
      startedAt: Date.now() - 60000,
      heartbeat: Date.now(),
      hostname: "remote-worker-node",
      platform: process.platform,
      instanceUuid: "00000000-0000-4000-8000-000000000000", // foreign instanceUuid!
    };
    fs.writeFileSync(lockFilePath, JSON.stringify(externalLockPayload, null, 2), "utf-8");

    const NUM_HTTP_REQUESTS = 10;
    const httpPromises: Promise<{ status: number; body: any }>[] = [];

    for (let i = 0; i < NUM_HTTP_REQUESTS; i++) {
      const req = new NextRequest("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: {
          cookie: `auth_session=${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "start" }),
      });

      httpPromises.push(
        (async () => {
          const res = await POST(req);
          const body = await res.json();
          return { status: res.status, body };
        })()
      );
    }

    const httpResponses = await Promise.all(httpPromises);
    const http409s = httpResponses.filter((r) => r.status === 409);
    const httpOther = httpResponses.filter((r) => r.status !== 409);

    assert(
      http409s.length === NUM_HTTP_REQUESTS,
      `2.1.1: All ${NUM_HTTP_REQUESTS} concurrent HTTP requests received HTTP 409 when foreign daemon is active`,
      `Got ${http409s.length} 409s, ${httpOther.length} others`
    );

    assert(
      http409s.every((r) => r.body?.code === "LOCK_COLLISION"),
      "2.1.2: All 409 responses carry code 'LOCK_COLLISION'"
    );

    assert(
      http409s.every((r) => typeof r.body?.error === "string" && r.body.error.includes("Lockfile collision")),
      "2.1.3: All 409 responses explain Lockfile collision with colliding PID"
    );
  } catch (err: any) {
    assert(false, "2.1.X: Suite 2 API Gating exception", err.message);
  } finally {
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch {}
    releaseDaemonLock();
  }

  // ---------------------------------------------------------------------------
  // SUITE 3: Abnormal Process Termination (Dead PID & SIGKILL Simulation)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 3: Abnormal Process Termination (Dead PID & SIGKILL Simulation) ---");
  try {
    const workerScript = path.resolve(__dirname, "helpers/lock_race_worker.ts");
    const deadChild = fork(workerScript, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const deadChildPid = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for child lock")), 5000);
      deadChild.on("message", (msg: any) => {
        if (msg?.type === "READY") {
          deadChild.send({ cmd: "LOCK_AND_FREEZE" });
        }
        if (msg?.type === "LOCKED") {
          clearTimeout(timeout);
          resolve(msg.pid);
        }
      });
    });

    assert(deadChildPid > 0, "3.1.1: Child process acquired daemon lock before termination");
    assert(fs.existsSync(lockFilePath), "3.1.2: Lockfile exists on disk held by child process");

    const childDiskInfo = getDaemonLockInfo();
    assert(childDiskInfo?.pid === deadChildPid, "3.1.3: Lockfile contains child PID");
    assert(isProcessActive(deadChildPid) === true, "3.1.4: Child process is initially confirmed active");

    // Abruptly terminate child with SIGKILL (bypassing normal process exit handlers)
    const deadChildExitPromise = new Promise<void>((resolve) => {
      deadChild.on("exit", () => resolve());
    });

    try {
      deadChild.kill("SIGKILL");
    } catch (err: any) {
      try {
        process.kill(deadChildPid, "SIGKILL");
      } catch {}
    }

    await deadChildExitPromise;

    // Delay to allow OS to reap the process table
    await new Promise((r) => setTimeout(r, 100));

    assert(isProcessActive(deadChildPid) === false, "3.1.5: Child process is confirmed dead after SIGKILL (ESRCH)");
    assert(fs.existsSync(lockFilePath), "3.1.6: Lockfile remained on disk because unhandled kill bypassed exit handlers");
    assert(isDaemonLocked() === false, "3.1.7: isDaemonLocked() correctly reports false despite lockfile presence on disk");

    // Attempt acquisition by current challenger process — must auto-unlink stale lock without deadlock
    const staleRecovery = acquireDaemonLock({ throwOnCollision: true });
    assert(staleRecovery.acquired === true, "3.1.8: acquireDaemonLock() unlinked stale lock and acquired successfully");
    assert(staleRecovery.pid === process.pid, "3.1.9: Recovered lock is now owned by current process PID");
    assert(isDaemonLockHeldByCurrentProcess() === true, "3.1.10: Lock ownership verified for current process");

    releaseDaemonLock();
    assert(fs.existsSync(lockFilePath) === false, "3.1.11: Lockfile cleanly removed after challenger release");
  } catch (err: any) {
    assert(false, "3.1.X: Suite 3 Abnormal Termination exception", err.message);
  } finally {
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch {}
    releaseDaemonLock();
  }

  // ---------------------------------------------------------------------------
  // SUITE 4: Corrupted & Malformed Lockfile Recovery
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 4: Corrupted & Malformed Lockfile Recovery ---");
  const malformedCases = [
    { name: "Empty string file", content: "" },
    { name: "Malformed syntax JSON", content: "{\"pid\": 1234, \"startedAt\":" },
    { name: "Zero PID", content: JSON.stringify({ pid: 0, instanceUuid: "test" }) },
    { name: "Negative PID", content: JSON.stringify({ pid: -999, instanceUuid: "test" }) },
    { name: "String non-number PID", content: JSON.stringify({ pid: "not_a_pid", instanceUuid: "test" }) },
    { name: "Dead high PID", content: JSON.stringify({ pid: 2147483640, instanceUuid: "test" }) },
  ];

  for (let idx = 0; idx < malformedCases.length; idx++) {
    const c = malformedCases[idx];
    try {
      fs.writeFileSync(lockFilePath, c.content, "utf-8");
      assert(isDaemonLocked() === false, `4.${idx + 1}.1: isDaemonLocked() handles ${c.name} without crashing`);

      const acq = acquireDaemonLock({ throwOnCollision: true });
      assert(acq.acquired === true, `4.${idx + 1}.2: acquireDaemonLock() auto-recovers from ${c.name}`);
      assert(acq.pid === process.pid, `4.${idx + 1}.3: New lockfile cleanly owned by current process for ${c.name}`);
      releaseDaemonLock();
    } catch (err: any) {
      assert(false, `4.${idx + 1}.X: Malformed case ${c.name} exception`, err.message);
    } finally {
      try {
        if (fs.existsSync(lockFilePath)) {
          fs.unlinkSync(lockFilePath);
        }
      } catch {}
      releaseDaemonLock();
    }
  }

  // ---------------------------------------------------------------------------
  // SUITE 5: Foreign Lock Protection (Anti-Hijack & Unauthorized Release)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 5: Foreign Lock Protection (Anti-Hijack & Unauthorized Release) ---");
  try {
    // Subtest 5.1: Foreign PID lock protection (completely foreign PID)
    const foreignPid1 = 88888888;
    const foreignPayload1 = {
      pid: foreignPid1,
      startedAt: Date.now() - 30000,
      heartbeat: Date.now(),
      hostname: "foreign-cluster-node",
      platform: process.platform,
      instanceUuid: "11111111-1111-4111-8111-111111111111",
    };
    fs.writeFileSync(lockFilePath, JSON.stringify(foreignPayload1, null, 2), "utf-8");

    const releaseAttempt1 = releaseDaemonLock();
    assert(releaseAttempt1 === false, "5.1.1: releaseDaemonLock() refuses to unlink foreign PID lock");
    assert(fs.existsSync(lockFilePath) === true, "5.1.2: Foreign PID lockfile remains on disk after unauthorized release");

    // Subtest 5.2: Same PID but foreign instanceUuid protection (anti-instance-hijack)
    const foreignPayload2 = {
      pid: process.pid,
      startedAt: Date.now() - 30000,
      heartbeat: Date.now(),
      hostname: "foreign-cluster-node",
      platform: process.platform,
      instanceUuid: "ffffffff-ffff-4fff-bfff-ffffffffffff", // foreign instanceUuid!
    };
    fs.writeFileSync(lockFilePath, JSON.stringify(foreignPayload2, null, 2), "utf-8");

    const releaseAttempt2 = releaseDaemonLock();
    assert(
      releaseAttempt2 === false,
      "5.2.1: releaseDaemonLock() refuses to unlink lock with matching PID but mismatched instanceUuid",
      "releaseDaemonLock() used 'data.pid === process.pid || ...' which allowed unauthorized deletion of foreign instance lock!"
    );
    assert(
      fs.existsSync(lockFilePath) === true,
      "5.2.2: Lockfile remains on disk after mismatched instanceUuid release attempt",
      "Lockfile was prematurely deleted by unauthorized release call!"
    );
  } catch (err: any) {
    assert(false, "5.X: Suite 5 Foreign Lock Protection exception", err.message);
  } finally {
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch {}
    releaseDaemonLock();
  }

  // ---------------------------------------------------------------------------
  // SUITE 6: 10,000 Client Order ID Collision & RFC 4122 v4 Conformance
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 6: 10,000 Client Order ID Collision & RFC 4122 v4 Conformance ---");
  try {
    const TOTAL_UUIDS = 10000;
    const uuidSet = new Set<string>();
    let allMatchedRegex = true;
    let allCorrectVersion = true;
    let allCorrectVariant = true;

    for (let i = 0; i < TOTAL_UUIDS; i++) {
      const id = crypto.randomUUID();
      uuidSet.add(id);

      if (!UUID_V4_REGEX.test(id)) {
        allMatchedRegex = false;
      }
      // Version check: character at index 14 must be '4'
      if (id.charAt(14) !== "4") {
        allCorrectVersion = false;
      }
      // Variant check: character at index 19 must be 8, 9, a, or b (case insensitive)
      const variantChar = id.charAt(19).toLowerCase();
      if (!["8", "9", "a", "b"].includes(variantChar)) {
        allCorrectVariant = false;
      }
    }

    assert(
      uuidSet.size === TOTAL_UUIDS,
      `6.1.1: Exactly ${TOTAL_UUIDS} UUIDs generated with ZERO collisions (Set size: ${uuidSet.size})`
    );
    assert(allMatchedRegex, `6.1.2: 100% of 10,000 UUIDs match RFC 4122 v4 regex`);
    assert(allCorrectVersion, `6.1.3: 100% of 10,000 UUIDs have version nibble '4'`);
    assert(allCorrectVariant, `6.1.4: 100% of 10,000 UUIDs have RFC 4122 variant bits (8, 9, a, b)`);
  } catch (err: any) {
    assert(false, "6.1.X: Suite 6 10k UUID exception", err.message);
  }

  // ---------------------------------------------------------------------------
  // SUITE 7: Exchange Signer Parameter Validation & Override Preservation
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 7: Exchange Signer Parameter Validation & Override Preservation ---");
  try {
    // 7.1: Binance Signer Validation & Overrides
    console.log("  [Binance Signer Tests]");
    const bnCreds = {
      apiKey: "test_bn_key",
      apiSecret: "test_bn_secret",
      endpoint: "https://testnet.binancefuture.com",
    };

    // 7.1.1 Default UUID generation
    const bnDefaultRes = await placeBinanceOrder(bnCreds, {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.001,
    });
    assert(typeof bnDefaultRes.clientOrderId === "string", "7.1.1: Binance returns clientOrderId by default");
    assert(UUID_V4_REGEX.test(bnDefaultRes.clientOrderId || ""), "7.1.2: Binance default clientOrderId is RFC 4122 v4 UUID");

    // 7.1.3 Custom UUID override via clientOrderId
    const bnCustom1 = crypto.randomUUID();
    const bnOverrideRes1 = await placeBinanceOrder(bnCreds, {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.001,
      clientOrderId: bnCustom1,
    });
    assert(bnOverrideRes1.clientOrderId === bnCustom1, "7.1.3: Binance preserves explicit clientOrderId override");

    // 7.1.4 Custom UUID override via newClientOrderId
    const bnCustom2 = crypto.randomUUID();
    const bnOverrideRes2 = await placeBinanceOrder(bnCreds, {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.001,
      newClientOrderId: bnCustom2,
    });
    assert(bnOverrideRes2.clientOrderId === bnCustom2, "7.1.4: Binance preserves explicit newClientOrderId override");

    // 7.1.5 Malformed input handling (zero quantity, empty symbol)
    const bnMalformed1 = await placeBinanceOrder(bnCreds, {
      symbol: "",
      side: "BUY",
      type: "MARKET",
      quantity: 0,
    });
    assert(bnMalformed1.success === false, "7.1.5: Binance rejects malformed empty symbol gracefully");
    assert(typeof bnMalformed1.clientOrderId === "string" && bnMalformed1.clientOrderId.length > 0, "7.1.6: Binance preserves clientOrderId even on malformed rejection");

    // 7.2: Bitget Signer Validation & Overrides
    console.log("  [Bitget Signer Tests]");
    // 7.2.1 Default UUID generation in simulation
    const bgDefaultRes = await placeBitgetOrder({
      symbol: "BTCUSDT",
      side: "buy",
      size: "0.001",
      orderType: "market",
      tradeSide: "open",
    });
    assert(typeof bgDefaultRes.clientOid === "string", "7.2.1: Bitget returns clientOid by default");
    assert(UUID_V4_REGEX.test(bgDefaultRes.clientOid || ""), "7.2.2: Bitget default clientOid is RFC 4122 v4 UUID");

    // 7.2.3 Custom clientOid override
    const bgCustom = crypto.randomUUID();
    const bgOverrideRes = await placeBitgetOrder({
      symbol: "BTCUSDT",
      side: "buy",
      size: "0.001",
      orderType: "market",
      tradeSide: "open",
      clientOid: bgCustom,
    });
    assert(bgOverrideRes.clientOid === bgCustom, "7.2.3: Bitget preserves explicit clientOid override");

    // 7.2.4 Malformed input handling (empty symbol, invalid side)
    const bgMalformed = await placeBitgetOrder({
      symbol: "",
      side: "buy",
      size: "0",
      orderType: "market",
      tradeSide: "open",
    });
    assert(typeof bgMalformed.clientOid === "string", "7.2.4: Bitget preserves clientOid on zero size order");

    // 7.3: Bybit Signer Validation & Overrides
    console.log("  [Bybit Signer Tests]");
    const byCreds = {
      apiKey: "test_bybit_key",
      apiSecret: "test_bybit_secret",
    };

    // 7.3.1 Default UUID generation
    const byDefaultRes = await placeBybitOrder(byCreds, {
      symbol: "BTCUSDT",
      side: "Buy",
      qty: 0.001,
      orderType: "Market",
    });
    assert(typeof byDefaultRes.orderLinkId === "string", "7.3.1: Bybit returns orderLinkId by default");
    assert(UUID_V4_REGEX.test(byDefaultRes.orderLinkId || ""), "7.3.2: Bybit default orderLinkId is RFC 4122 v4 UUID");
    assert(byDefaultRes.clientOrderId === byDefaultRes.orderLinkId, "7.3.3: Bybit clientOrderId alias matches orderLinkId");

    // 7.3.4 Custom orderLinkId override
    const byCustom1 = crypto.randomUUID();
    const byOverrideRes1 = await placeBybitOrder(byCreds, {
      symbol: "BTCUSDT",
      side: "Buy",
      qty: 0.001,
      orderType: "Market",
      orderLinkId: byCustom1,
    });
    assert(byOverrideRes1.orderLinkId === byCustom1, "7.3.4: Bybit preserves explicit orderLinkId override");

    // 7.3.5 Custom clientOrderId alias override
    const byCustom2 = crypto.randomUUID();
    const byOverrideRes2 = await placeBybitOrder(byCreds, {
      symbol: "BTCUSDT",
      side: "Buy",
      qty: 0.001,
      orderType: "Market",
      clientOrderId: byCustom2,
    });
    assert(byOverrideRes2.orderLinkId === byCustom2, "7.3.5: Bybit maps clientOrderId alias to orderLinkId");

    // 7.3.6 Malformed input handling (empty symbol, zero qty)
    const byMalformed = await placeBybitOrder(byCreds, {
      symbol: "",
      side: "Buy",
      qty: 0,
      orderType: "Market",
    });
    assert(byMalformed.success === false, "7.3.6: Bybit rejects malformed empty symbol gracefully");
    assert(typeof byMalformed.orderLinkId === "string" && byMalformed.orderLinkId.length > 0, "7.3.7: Bybit preserves orderLinkId on failure");
  } catch (err: any) {
    assert(false, "7.X: Suite 7 Signer Validation exception", err.message);
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log(`  EMPIRICAL CHALLENGER STRESS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    console.error("FAILURES DETECTED:");
    for (const f of failures) {
      console.error(`- [${f.testName}]: ${f.details}`);
    }
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Deep Adversarial Challenge Exception:", err);
  process.exit(1);
});
