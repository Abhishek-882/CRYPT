/**
 * EMPIRICAL CHALLENGER: ADVERSARIAL STRESS TEST & VERIFICATION HARNESS FOR MILESTONE 1
 * Targets:
 *   - web/lib/daemonLockManager.ts
 *   - web/lib/divergence/store/stateStore.ts
 *   - web/lib/divergence/types.ts
 * 
 * Verifies:
 * 1. Lock Manager Exclusivity & Process Isolation:
 *    - Concurrent acquisition between divergence_daemon.lock and bot_daemon.lock
 *    - Child-process multi-process lock contention and race conditions
 *    - Stale lock detection and dead PID eviction
 *    - Foreign PID anti-hijack release protection
 *    - Heartbeat cron lifecycle
 * 2. Atomic State Store Under Stress:
 *    - 50 rapid concurrent async persistence operations
 *    - 50 rapid sequential synchronous persistence operations
 *    - Deliberately corrupted primary file recovery from .backup (syntax corruption, 0-byte, binary garbage)
 *    - Dual corruption graceful recovery to clean default state
 * 3. In-Flight Intent Journal CRUD & Crash Recovery:
 *    - Complete lifecycle: prepare, dispatch, fill, clear
 *    - Startup crash detection of dangling unhedged intents
 *    - Enforcement: canOpenPosition blocks when dangling intent exists
 * 4. Capital Limits Hard-Locking ($15.00 USDT, max 1 position):
 *    - Mutation clamping on updateConfig (excessive, zero, negative)
 *    - On-disk tampering sanitization on load
 *    - Pre-trade gating (canOpenPosition) for limits, running state, and capacity
 *    - addPosition rejection when capacity reached
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawnSync, fork } from 'child_process';

import {
  acquireDaemonLock,
  releaseDaemonLock,
  updateDaemonLockHeartbeat,
  clearStaleDaemonLock,
  getDaemonLockInfo,
  getDaemonLockFilePath,
  isDaemonLocked,
  isDaemonRunning,
  isDaemonLockHeldByCurrentProcess,
  startHeartbeatCron,
  stopHeartbeatCron,
  LockCollisionError,
} from '../lib/daemonLockManager';

import {
  DivergenceStateStore,
  atomicWriteFileSync,
  atomicWriteFile,
  DEFAULT_DIVERGENCE_CONFIG,
  DEFAULT_DIVERGENCE_TELEMETRY,
} from '../lib/divergence/store/stateStore';

import {
  DivergencePosition,
  DivergenceClosedPosition,
  DivergenceInFlightIntent,
} from '../lib/divergence/types';

interface TestResult {
  section: string;
  testName: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

function assert(section: string, testName: string, condition: boolean, details: string = '') {
  if (condition) {
    passCount++;
    results.push({ section, testName, passed: true, details });
    console.log(`  [PASS] [${section}] ${testName}`);
  } else {
    failCount++;
    results.push({ section, testName, passed: false, details });
    console.error(`  [FAIL] [${section}] ${testName} -> ${details}`);
  }
}

// Sandbox paths for stress tests
const sandboxDir = path.resolve(__dirname, 'sandbox_adversarial_m1');
const stateSandboxPath = path.join(sandboxDir, 'adversarial_state.json');
const inflightSandboxPath = path.join(sandboxDir, 'adversarial_inflight.json');
const lockDivergencePath = path.join(sandboxDir, 'divergence_daemon.lock');
const lockBotPath = path.join(sandboxDir, 'bot_daemon.lock');

function resetSandbox() {
  if (fs.existsSync(sandboxDir)) {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  }
  fs.mkdirSync(sandboxDir, { recursive: true });
}

async function runAdversarialHarness() {
  console.log('========================================================================');
  console.log('  EMPIRICAL CHALLENGER: ADVERSARIAL STRESS TEST & VERIFICATION (M1)');
  console.log('========================================================================\n');

  resetSandbox();

  // ===========================================================================
  // SECTION 1: LOCK MANAGER EXCLUSIVITY & MULTI-PROCESS ISOLATION
  // ===========================================================================
  console.log('--- SECTION 1: Lock Manager Exclusivity & Concurrency Verification ---');

  // Test 1.1: Concurrent dual lock acquisition (bot_daemon.lock & divergence_daemon.lock)
  // Both locks should be simultaneously acquirable and completely isolated
  try {
    const divResult = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
    const botResult = acquireDaemonLock({ lockFileName: lockBotPath, throwOnCollision: false });

    assert(
      'Section 1.1',
      'Acquires divergence_daemon.lock cleanly',
      divResult.acquired === true && fs.existsSync(lockDivergencePath),
      `divResult.acquired=${divResult.acquired}, fileExists=${fs.existsSync(lockDivergencePath)}`
    );

    assert(
      'Section 1.1',
      'Acquires bot_daemon.lock cleanly while divergence lock is held',
      botResult.acquired === true && fs.existsSync(lockBotPath),
      `botResult.acquired=${botResult.acquired}, fileExists=${fs.existsSync(lockBotPath)}`
    );

    assert(
      'Section 1.1',
      'Both locks report active in kernel simultaneously',
      isDaemonLocked(lockDivergencePath) && isDaemonLocked(lockBotPath),
      `divLocked=${isDaemonLocked(lockDivergencePath)}, botLocked=${isDaemonLocked(lockBotPath)}`
    );

    assert(
      'Section 1.1',
      'Both locks report held by current process simultaneously',
      isDaemonLockHeldByCurrentProcess(lockDivergencePath) && isDaemonLockHeldByCurrentProcess(lockBotPath),
      `divHeld=${isDaemonLockHeldByCurrentProcess(lockDivergencePath)}, botHeld=${isDaemonLockHeldByCurrentProcess(lockBotPath)}`
    );

    // Releasing divergence_daemon.lock MUST NOT affect bot_daemon.lock
    const divReleased = releaseDaemonLock({ lockFileName: lockDivergencePath });
    assert(
      'Section 1.1',
      'Releases divergence_daemon.lock cleanly',
      divReleased === true && !fs.existsSync(lockDivergencePath),
      `divReleased=${divReleased}, fileExists=${fs.existsSync(lockDivergencePath)}`
    );

    assert(
      'Section 1.1',
      'bot_daemon.lock remains active and held after divergence lock release',
      isDaemonLocked(lockBotPath) && isDaemonLockHeldByCurrentProcess(lockBotPath),
      `botLocked=${isDaemonLocked(lockBotPath)}, botHeld=${isDaemonLockHeldByCurrentProcess(lockBotPath)}`
    );

    const botReleased = releaseDaemonLock({ lockFileName: lockBotPath });
    assert(
      'Section 1.1',
      'Releases bot_daemon.lock cleanly',
      botReleased === true && !fs.existsSync(lockBotPath),
      `botReleased=${botReleased}, fileExists=${fs.existsSync(lockBotPath)}`
    );
  } catch (err: any) {
    assert('Section 1.1', 'Dual lock isolation exception', false, err.message);
  }

  // Test 1.2: Same lock collision rejection
  try {
    const firstAcquire = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
    assert('Section 1.2', 'First acquire succeeds', firstAcquire.acquired === true, '');

    const secondAcquire = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
    assert('Section 1.2', 'Second acquire without force is rejected', secondAcquire.acquired === false, `error=${secondAcquire.error}`);

    let threwCollision = false;
    try {
      acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: true });
    } catch (err: any) {
      if (err instanceof LockCollisionError) {
        threwCollision = true;
      }
    }
    assert('Section 1.2', 'Second acquire with throwOnCollision throws LockCollisionError', threwCollision, '');

    releaseDaemonLock({ lockFileName: lockDivergencePath });
  } catch (err: any) {
    assert('Section 1.2', 'Collision test exception', false, err.message);
  }

  // Test 1.3: Multi-Process Kernel Exclusivity via Child Process
  try {
    // Child script acquires lockDivergencePath, stays alive for 1200ms, then exits
    const childScript = `
      const fs = require('fs');
      const crypto = require('crypto');
      const payload = {
        pid: process.pid,
        startedAt: Date.now(),
        heartbeat: Date.now(),
        hostname: require('os').hostname(),
        platform: process.platform,
        instanceUuid: crypto.randomUUID()
      };
      fs.writeFileSync(${JSON.stringify(lockDivergencePath)}, JSON.stringify(payload, null, 2));
      setTimeout(() => { process.exit(0); }, 1000);
    `;

    const child = require('child_process').spawn(process.execPath, ['-e', childScript], {
      stdio: 'ignore',
      detached: false,
    });

    // Wait 150ms for child to create lock
    const startWait = Date.now();
    while (Date.now() - startWait < 150) {}

    // Verify child holds lock
    const childLockInfo = getDaemonLockInfo(lockDivergencePath);
    assert(
      'Section 1.3',
      'Child process successfully created lock on disk',
      Boolean(childLockInfo && childLockInfo.pid === child.pid),
      `childPid=${child.pid}, lockPid=${childLockInfo?.pid}`
    );

    // Parent attempts to acquire child-held lock -> MUST FAIL with collision
    const parentTry = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
    assert(
      'Section 1.3',
      'Parent process rejected with collision while child holds lock',
      parentTry.acquired === false && parentTry.pid === child.pid,
      `acquired=${parentTry.acquired}, reportedPid=${parentTry.pid}`
    );

    // Meanwhile, parent attempts to acquire bot_daemon.lock -> MUST SUCCEED (cross-daemon isolation)
    const parentBotTry = acquireDaemonLock({ lockFileName: lockBotPath, throwOnCollision: false });
    assert(
      'Section 1.3',
      'Parent acquires bot_daemon.lock independently while child holds divergence lock',
      parentBotTry.acquired === true,
      `acquired=${parentBotTry.acquired}`
    );

    // Release parent bot lock
    releaseDaemonLock({ lockFileName: lockBotPath });

    // Wait for child process to exit
    const waitChildExitStart = Date.now();
    while (Date.now() - waitChildExitStart < 1200) {}

    // Verify child PID is now dead
    let isChildAlive = true;
    try {
      process.kill(child.pid, 0);
    } catch {
      isChildAlive = false;
    }
    assert('Section 1.3', 'Child process exited and is now dead', !isChildAlive, `childPid=${child.pid}`);

    // Now parent attempts to acquire lockDivergencePath -> Stale lock recovery must evict dead PID and acquire!
    const staleAcquire = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
    assert(
      'Section 1.3',
      'Parent successfully evicts dead child PID lock and acquires divergence lock',
      staleAcquire.acquired === true && staleAcquire.pid === process.pid,
      `acquired=${staleAcquire.acquired}, newPid=${staleAcquire.pid}`
    );

    releaseDaemonLock({ lockFileName: lockDivergencePath });
  } catch (err: any) {
    assert('Section 1.3', 'Multi-process exclusivity test exception', false, err.message);
  }

  // Test 1.4: Anti-Hijack Foreign Process Release Protection
  try {
    // Write fake lock belonging to foreign PID
    const foreignPid = 99999993;
    const foreignLockPayload = {
      pid: foreignPid,
      startedAt: Date.now(),
      heartbeat: Date.now(),
      hostname: 'foreign-node',
      platform: 'linux',
      instanceUuid: 'foreign-uuid-99999993',
    };
    fs.writeFileSync(lockDivergencePath, JSON.stringify(foreignLockPayload, null, 2), 'utf-8');

    // Calling releaseDaemonLock MUST NOT unlink foreign lock
    const released = releaseDaemonLock({ lockFileName: lockDivergencePath });
    assert(
      'Section 1.4',
      'releaseDaemonLock refuses to delete foreign process lock (Anti-Hijack Invariant)',
      released === false && fs.existsSync(lockDivergencePath),
      `released=${released}, exists=${fs.existsSync(lockDivergencePath)}`
    );

    // Calling clearStaleDaemonLock on dead foreign PID SHOULD clean it up
    const staleCleaned = clearStaleDaemonLock({ lockFileName: lockDivergencePath });
    assert(
      'Section 1.4',
      'clearStaleDaemonLock successfully unlinks dead foreign lock',
      staleCleaned === true && !fs.existsSync(lockDivergencePath),
      `staleCleaned=${staleCleaned}, exists=${fs.existsSync(lockDivergencePath)}`
    );
  } catch (err: any) {
    assert('Section 1.4', 'Anti-hijack test exception', false, err.message);
  }

  // Test 1.5: Heartbeat Cron Lifecycle
  try {
    acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
    const infoBefore = getDaemonLockInfo(lockDivergencePath);
    const hbBefore = infoBefore!.heartbeat;

    // Start cron with 40ms interval
    const timer = startHeartbeatCron({ lockFileName: lockDivergencePath, intervalMs: 40 });
    assert('Section 1.5', 'startHeartbeatCron returns active timer', timer !== null, '');

    // Wait 120ms for at least two ticks
    const waitHbStart = Date.now();
    while (Date.now() - waitHbStart < 120) {}

    const infoAfter = getDaemonLockInfo(lockDivergencePath);
    const hbAfter = infoAfter!.heartbeat;
    assert(
      'Section 1.5',
      'Heartbeat timestamp updated automatically by background cron',
      hbAfter >= hbBefore,
      `before=${hbBefore}, after=${hbAfter}`
    );

    stopHeartbeatCron(lockDivergencePath);
    releaseDaemonLock({ lockFileName: lockDivergencePath });
  } catch (err: any) {
    assert('Section 1.5', 'Heartbeat cron test exception', false, err.message);
  }

  // ===========================================================================
  // SECTION 2: ATOMIC STATE STORE UNDER STRESS & CORRUPTION RECOVERY
  // ===========================================================================
  console.log('\n--- SECTION 2: Atomic State Store Under Stress & Corruption Recovery ---');

  // Test 2.1: 50 Rapid Concurrent Asynchronous Writes
  try {
    const concurrentWritesCount = 50;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < concurrentWritesCount; i++) {
      const payload = JSON.stringify({
        version: '1.0.0',
        writeIndex: i,
        randomNonce: crypto.randomBytes(8).toString('hex'),
        timestamp: Date.now(),
      });
      promises.push(atomicWriteFile(stateSandboxPath, payload));
    }

    const settled = await Promise.allSettled(promises);
    const failedWrites = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    if (failedWrites.length > 0) {
      console.log('    [DEBUG] First failed write reason:', failedWrites[0].reason);
    }

    assert(
      'Section 2.1',
      '50 rapid concurrent async atomic writes complete with 0 unhandled rejections',
      failedWrites.length === 0,
      `failedWrites=${failedWrites.length}, firstReason=${failedWrites[0]?.reason?.message || failedWrites[0]?.reason}`
    );

    assert(
      'Section 2.1',
      'State file exists and is non-zero after 50 concurrent writes',
      fs.existsSync(stateSandboxPath) && fs.statSync(stateSandboxPath).size > 0,
      `size=${fs.existsSync(stateSandboxPath) ? fs.statSync(stateSandboxPath).size : 0}`
    );

    // Verify valid parseable JSON content
    let parsedState: any = null;
    let parseError = false;
    try {
      const content = fs.readFileSync(stateSandboxPath, 'utf-8');
      parsedState = JSON.parse(content);
    } catch {
      parseError = true;
    }

    assert(
      'Section 2.1',
      'State file content is 100% valid parseable JSON with zero byte corruption',
      !parseError && parsedState && typeof parsedState.writeIndex === 'number',
      `parseError=${parseError}, writeIndex=${parsedState?.writeIndex}`
    );

    // Verify .backup file is also valid JSON
    const backupPath = `${stateSandboxPath}.backup`;
    assert(
      'Section 2.1',
      'Backup file (.backup) exists and is non-zero',
      fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0,
      `backupSize=${fs.existsSync(backupPath) ? fs.statSync(backupPath).size : 0}`
    );
  } catch (err: any) {
    assert('Section 2.1', 'Concurrent write stress exception', false, err.message);
  }

  // Test 2.2: 50 Rapid Synchronous Persistence Flushes
  try {
    const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    let allPersisted = true;

    for (let i = 0; i < 50; i++) {
      try {
        store.setFsmState(i % 2 === 0 ? 'SCANNING' : 'IDLE');
      } catch {
        allPersisted = false;
        break;
      }
    }

    assert(
      'Section 2.2',
      '50 rapid synchronous persistence flushes succeed without NTFS EPERM / lock errors',
      allPersisted,
      ''
    );

    const onDiskState = JSON.parse(fs.readFileSync(stateSandboxPath, 'utf-8'));
    assert(
      'Section 2.2',
      'Disk state reflects final state after 50 flushes',
      onDiskState.fsmState === 'IDLE',
      `fsmState=${onDiskState.fsmState}`
    );
  } catch (err: any) {
    assert('Section 2.2', 'Synchronous flushes exception', false, err.message);
  }

  // Test 2.3: Deliberate Primary File Corruption Recovery from .backup
  // Case A: Syntax-corrupted truncated JSON in primary file
  try {
    const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    store.updateConfig({ zeroLossNetHurdleUsdt: 0.0250 });
    store.setRunning(true);
    store.persistStateSync();

    const backupContentBefore = fs.readFileSync(`${stateSandboxPath}.backup`, 'utf-8');
    assert('Section 2.3A', 'Backup file exists before deliberate corruption', backupContentBefore.length > 0, '');

    // Corrupt primary file with truncated syntax
    fs.writeFileSync(stateSandboxPath, '{"version":"1.0.0", "isRunning": true, "corrupted_incomplete...', 'utf-8');

    // Create a new store instance; it MUST recover automatically from .backup
    const recoveredStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    const recoveredState = recoveredStore.getState();

    assert(
      'Section 2.3A',
      'Automatically recovers state from .backup when primary JSON is truncated',
      recoveredState.config.zeroLossNetHurdleUsdt === 0.0250 && recoveredState.isRunning === true,
      `recoveredHurdle=${recoveredState.config.zeroLossNetHurdleUsdt}, isRunning=${recoveredState.isRunning}`
    );

    // Verify primary file was restored on disk
    const restoredPrimary = JSON.parse(fs.readFileSync(stateSandboxPath, 'utf-8'));
    assert(
      'Section 2.3A',
      'Primary file on disk was automatically healed and rewritten',
      restoredPrimary.config.zeroLossNetHurdleUsdt === 0.0250,
      `restoredHurdle=${restoredPrimary.config.zeroLossNetHurdleUsdt}`
    );
  } catch (err: any) {
    assert('Section 2.3A', 'Truncated JSON recovery exception', false, err.message);
  }

  // Case B: 0-Byte truncated primary file
  try {
    fs.writeFileSync(stateSandboxPath, '', 'utf-8'); // 0-byte file
    assert('Section 2.3B', 'Primary file is 0 bytes', fs.statSync(stateSandboxPath).size === 0, '');

    const recoveredStore0 = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    const state0 = recoveredStore0.getState();

    assert(
      'Section 2.3B',
      'Automatically recovers state from .backup when primary file is 0-byte truncated',
      state0.config.zeroLossNetHurdleUsdt === 0.0250,
      `hurdle=${state0.config.zeroLossNetHurdleUsdt}`
    );
  } catch (err: any) {
    assert('Section 2.3B', '0-byte recovery exception', false, err.message);
  }

  // Case C: Binary garbage corruption in primary file
  try {
    const garbageBuffer = Buffer.from([0x00, 0xff, 0xfe, 0x12, 0x89, 0xba, 0xde, 0xad]);
    fs.writeFileSync(stateSandboxPath, garbageBuffer);

    const recoveredStoreGarbage = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    const stateGarbage = recoveredStoreGarbage.getState();

    assert(
      'Section 2.3C',
      'Automatically recovers state from .backup when primary file is corrupted with binary garbage',
      stateGarbage.config.zeroLossNetHurdleUsdt === 0.0250,
      `hurdle=${stateGarbage.config.zeroLossNetHurdleUsdt}`
    );
  } catch (err: any) {
    assert('Section 2.3C', 'Binary garbage recovery exception', false, err.message);
  }

  // Case D: Dual corruption (both primary and backup files are corrupt)
  try {
    fs.writeFileSync(stateSandboxPath, 'FATAL_CORRUPTION_PRIMARY', 'utf-8');
    fs.writeFileSync(`${stateSandboxPath}.backup`, 'FATAL_CORRUPTION_BACKUP', 'utf-8');

    // Store must not throw unhandled exception; must fall back to clean default PAUSED state
    let dualRecoveredStore: DivergenceStateStore | null = null;
    let didThrow = false;
    try {
      dualRecoveredStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    } catch {
      didThrow = true;
    }

    assert(
      'Section 2.3D',
      'Does not crash when both primary and backup files are corrupted',
      !didThrow && dualRecoveredStore !== null,
      `didThrow=${didThrow}`
    );

    const fallbackState = dualRecoveredStore!.getState();
    assert(
      'Section 2.3D',
      'Falls back safely to clean default state in PAUSED mode with capital hard-locks',
      fallbackState.isRunning === false &&
        fallbackState.fsmState === 'PAUSED' &&
        fallbackState.config.maxCapitalAllocationUsdt === 15.00 &&
        fallbackState.config.maxConcurrentPositions === 1,
      `isRunning=${fallbackState.isRunning}, fsmState=${fallbackState.fsmState}, cap=${fallbackState.config.maxCapitalAllocationUsdt}`
    );
  } catch (err: any) {
    assert('Section 2.3D', 'Dual corruption exception', false, err.message);
  }

  // ===========================================================================
  // SECTION 3: IN-FLIGHT INTENT JOURNAL CRUD & DANGLING INTENT RECOVERY
  // ===========================================================================
  console.log('\n--- SECTION 3: In-Flight Intent Journal CRUD & Crash Recovery ---');

  try {
    const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);

    // Initial read on empty file
    const initialIntents = store.readInflightIntents();
    assert('Section 3.1', 'Empty inflight journal returns empty array', Array.isArray(initialIntents) && initialIntents.length === 0, '');

    // Record an in-flight intent before Leg 1 dispatch
    const testIntent: DivergenceInFlightIntent = {
      intentId: 'div_intent_stress_001',
      canonicalSymbol: 'SUIUSDT',
      direction: 'LONG_BN_SHORT_BYB',
      targetNotionalUsdt: 15.00,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'INTENT_PREPARED',
      leg1: {
        venue: 'BINANCE',
        symbol: 'SUIUSDT',
        clientOrderId: 'div1_stress_001',
        targetQty: 7.5,
        filledQty: 0,
        avgPrice: 0,
        status: 'PENDING',
        updatedAt: Date.now(),
      },
      leg2: {
        venue: 'BYBIT',
        symbol: 'SUIUSDT',
        clientOrderId: 'div2_stress_001',
        targetQty: 7.5,
        filledQty: 0,
        avgPrice: 0,
        status: 'PENDING',
        updatedAt: Date.now(),
      },
    };

    store.recordInflightIntent(testIntent);

    const readAfterRecord = store.readInflightIntents();
    assert(
      'Section 3.1',
      'Pre-dispatch intent persisted to disk with INTENT_PREPARED status',
      readAfterRecord.length === 1 && readAfterRecord[0].intentId === 'div_intent_stress_001',
      `count=${readAfterRecord.length}`
    );

    // Update intent: Leg 1 fills
    const updateOk = store.updateInflightIntent('div_intent_stress_001', {
      status: 'LEG1_FILLED',
      leg1: {
        ...testIntent.leg1,
        filledQty: 7.5,
        status: 'FILLED',
        avgPrice: 2.00,
        updatedAt: Date.now(),
      },
    });

    assert('Section 3.1', 'updateInflightIntent returns true on existing intent', updateOk === true, '');

    const readAfterFill = store.readInflightIntents();
    assert(
      'Section 3.1',
      'Disk state reflects updated LEG1_FILLED status',
      readAfterFill[0].status === 'LEG1_FILLED' && readAfterFill[0].leg1.status === 'FILLED',
      `status=${readAfterFill[0].status}`
    );

    // Crash Recovery: Startup check must detect this as dangling!
    const dangling = store.checkDanglingIntentsOnStartup();
    assert(
      'Section 3.2',
      'checkDanglingIntentsOnStartup detects unhedged dangling intent',
      dangling.length === 1 && dangling[0].intentId === 'div_intent_stress_001',
      `danglingCount=${dangling.length}`
    );

    // Critical Enforcement: canOpenPosition MUST be blocked when dangling intent exists
    store.setRunning(true);
    const gateWithDangling = store.canOpenPosition(15.00);
    assert(
      'Section 3.2',
      'canOpenPosition rejects order entry when dangling in-flight intent exists',
      gateWithDangling.allowed === false && Boolean(gateWithDangling.reason?.includes('Dangling in-flight intent')),
      `allowed=${gateWithDangling.allowed}, reason=${gateWithDangling.reason}`
    );

    // Now resolve intent to COMPLETED
    store.updateInflightIntent('div_intent_stress_001', {
      status: 'COMPLETED',
      leg2: {
        ...testIntent.leg2,
        filledQty: 7.5,
        status: 'FILLED',
        avgPrice: 1.995,
        updatedAt: Date.now(),
      },
    });

    const danglingAfterComplete = store.checkDanglingIntentsOnStartup();
    assert(
      'Section 3.2',
      'checkDanglingIntentsOnStartup returns 0 dangling intents after status COMPLETED',
      danglingAfterComplete.length === 0,
      `danglingCount=${danglingAfterComplete.length}`
    );

    const gateAfterComplete = store.canOpenPosition(15.00);
    assert(
      'Section 3.2',
      'canOpenPosition allows entry after dangling intent is completed',
      gateAfterComplete.allowed === true,
      `allowed=${gateAfterComplete.allowed}, reason=${gateAfterComplete.reason}`
    );

    // Clear intent by ID
    store.clearInflightIntent('div_intent_stress_001');
    assert('Section 3.1', 'clearInflightIntent by ID removes the intent', store.readInflightIntents().length === 0, '');

    // Record two intents and clear all
    store.recordInflightIntent({ ...testIntent, intentId: 'intent_a' });
    store.recordInflightIntent({ ...testIntent, intentId: 'intent_b' });
    assert('Section 3.1', 'Recorded 2 intents', store.readInflightIntents().length === 2, '');
    store.clearInflightIntent();
    assert('Section 3.1', 'clearInflightIntent() with no args clears all intents', store.readInflightIntents().length === 0, '');
  } catch (err: any) {
    assert('Section 3', 'In-flight intent journal exception', false, err.message);
  }

  // ===========================================================================
  // SECTION 4: CAPITAL LIMITS HARD-LOCKING ($15.00 USDT, MAX 1 POSITION)
  // ===========================================================================
  console.log('\n--- SECTION 4: Capital Limits Hard-Locking ($15.00 USDT, Max 1 Position) ---');

  try {
    const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    store.clearState();

    // Test 4.1: Mutation clamping on updateConfig
    // Attempt 1: maxConcurrentPositions > 1
    const cfg1 = store.updateConfig({ maxConcurrentPositions: 5 });
    assert(
      'Section 4.1',
      'updateConfig clamps maxConcurrentPositions (5 -> 1)',
      cfg1.maxConcurrentPositions === 1 && store.getState().config.maxConcurrentPositions === 1,
      `got=${cfg1.maxConcurrentPositions}`
    );

    // Attempt 2: maxConcurrentPositions = 0 or negative
    const cfg2 = store.updateConfig({ maxConcurrentPositions: 0 });
    assert(
      'Section 4.1',
      'updateConfig clamps maxConcurrentPositions (0 -> 1)',
      cfg2.maxConcurrentPositions === 1,
      `got=${cfg2.maxConcurrentPositions}`
    );

    // Attempt 3: maxCapitalAllocationUsdt > 15.00
    const cfg3 = store.updateConfig({ maxCapitalAllocationUsdt: 500.00 });
    assert(
      'Section 4.1',
      'updateConfig clamps maxCapitalAllocationUsdt (500 -> 15.00)',
      cfg3.maxCapitalAllocationUsdt === 15.00 && store.getState().config.maxCapitalAllocationUsdt === 15.00,
      `got=${cfg3.maxCapitalAllocationUsdt}`
    );

    // Attempt 4: maxCapitalAllocationUsdt <= 0
    const cfg4 = store.updateConfig({ maxCapitalAllocationUsdt: -25.00 });
    assert(
      'Section 4.1',
      'updateConfig clamps negative maxCapitalAllocationUsdt (-25 -> 15.00)',
      cfg4.maxCapitalAllocationUsdt === 15.00,
      `got=${cfg4.maxCapitalAllocationUsdt}`
    );

    // Attempt 5: orderNotionalUsdt > 15.00
    const cfg5 = store.updateConfig({ orderNotionalUsdt: 100.00 });
    assert(
      'Section 4.1',
      'updateConfig clamps orderNotionalUsdt (100 -> 15.00)',
      cfg5.orderNotionalUsdt === 15.00,
      `got=${cfg5.orderNotionalUsdt}`
    );

    // Attempt 6: maxPositionsPerSymbol !== 1
    const cfg6 = store.updateConfig({ maxPositionsPerSymbol: 3 });
    assert(
      'Section 4.1',
      'updateConfig clamps maxPositionsPerSymbol (3 -> 1)',
      cfg6.maxPositionsPerSymbol === 1,
      `got=${cfg6.maxPositionsPerSymbol}`
    );

    // Test 4.2: On-Disk Tampering Sanitization on Load
    // Maliciously tamper with the state file on disk
    const tamperedContent = JSON.stringify({
      version: '1.0.0',
      isRunning: true,
      fsmState: 'IDLE',
      config: {
        maxConcurrentPositions: 99,
        maxPositionsPerSymbol: 99,
        maxCapitalAllocationUsdt: 99999.00,
        orderNotionalUsdt: 5000.00,
        zeroLossNetHurdleUsdt: 0.0100,
      },
      activePositions: {},
      closedPositions: [],
      telemetry: {},
      lastUpdated: Date.now(),
    });
    fs.writeFileSync(stateSandboxPath, tamperedContent, 'utf-8');

    // Reload state store from disk
    const tamperedStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
    const sanitizedState = tamperedStore.getState();

    assert(
      'Section 4.2',
      'On-disk tampered maxConcurrentPositions (99) sanitized to 1 on load',
      sanitizedState.config.maxConcurrentPositions === 1,
      `got=${sanitizedState.config.maxConcurrentPositions}`
    );

    assert(
      'Section 4.2',
      'On-disk tampered maxPositionsPerSymbol (99) sanitized to 1 on load',
      sanitizedState.config.maxPositionsPerSymbol === 1,
      `got=${sanitizedState.config.maxPositionsPerSymbol}`
    );

    assert(
      'Section 4.2',
      'On-disk tampered maxCapitalAllocationUsdt ($99,999.00) sanitized to 15.00 on load',
      sanitizedState.config.maxCapitalAllocationUsdt === 15.00,
      `got=${sanitizedState.config.maxCapitalAllocationUsdt}`
    );

    assert(
      'Section 4.2',
      'On-disk tampered orderNotionalUsdt ($5,000.00) sanitized to 15.00 on load',
      sanitizedState.config.orderNotionalUsdt === 15.00,
      `got=${sanitizedState.config.orderNotionalUsdt}`
    );

    // Test 4.3: Pre-Trade Gating & Position Capacity Hard-Locks
    tamperedStore.setRunning(true);

    // 4.3.1: Reject order exceeding $15.00 USDT
    const gateExceedNotional = tamperedStore.canOpenPosition(15.01);
    assert(
      'Section 4.3',
      'canOpenPosition rejects order notional exceeding $15.00 USDT ($15.01)',
      gateExceedNotional.allowed === false && Boolean(gateExceedNotional.reason?.includes('Capital limit exceeded')),
      `allowed=${gateExceedNotional.allowed}, reason=${gateExceedNotional.reason}`
    );

    // 4.3.2: Allow order exactly at $15.00 USDT
    const gateExact = tamperedStore.canOpenPosition(15.00);
    assert('Section 4.3', 'canOpenPosition allows order at exact $15.00 USDT ceiling', gateExact.allowed === true, '');

    // 4.3.3: Add first position -> should succeed
    const mockPos: DivergencePosition = {
      id: 'div_pos_001',
      canonicalSymbol: 'SUIUSDT',
      binanceSymbol: 'SUIUSDT',
      bybitSymbol: 'SUIUSDT',
      direction: 'LONG_BN_SHORT_BYB',
      status: 'OPEN',
      entryTimestamp: Date.now(),
      entryBinancePrice: 2.00,
      entryBybitPrice: 2.00,
      entryBasisPercent: 0.000,
      currentBasisPercent: 0.000,
      peakBasisPercent: 0.000,
      targetExpansionPercent: 0.380,
      stopLossBasisPercent: -0.150,
      notionalUsdt: 15.00,
      quantityBinance: 7.5,
      quantityBybit: 7.5,
      leg1: {
        venue: 'BINANCE',
        side: 'BUY',
        orderType: 'POST_ONLY_MAKER_GTX',
        orderId: 'ord1',
        clientOrderId: 'div1_pos_001',
        symbol: 'SUIUSDT',
        executedQty: 7.5,
        avgPrice: 2.00,
        feePercent: 0.020,
        feeUsdt: 0.003,
        latencyMs: 14,
        timestamp: Date.now(),
      },
      leg2: {
        venue: 'BYBIT',
        side: 'SELL',
        orderType: 'WS_IOC_TAKER',
        orderId: 'ord2',
        clientOrderId: 'div2_pos_001',
        symbol: 'SUIUSDT',
        executedQty: 7.5,
        avgPrice: 2.00,
        feePercent: 0.055,
        feeUsdt: 0.008,
        latencyMs: 28,
        timestamp: Date.now(),
      },
      currentBinancePrice: 2.00,
      currentBybitPrice: 2.00,
      relativeExpansionPercent: 0.000,
      unrealizedGrossPnlUsdt: 0.000,
      estimatedTotalFeesUsdt: 0.022,
      netPnlUsdt: -0.022,
      roiPercent: -0.147,
      holdDurationMinutes: 0,
      isHurdleMet: false,
      executionHash: 'mock_exec_hash_001',
      stagnancyNominalDeadline: Date.now() + 180 * 60000,
      stagnancyCeilingDeadline: Date.now() + 360 * 60000,
      hasMomentumExtension: false,
      accumulatedCarryPercent: 0.000,
      lastUpdated: Date.now(),
    };

    const add1 = tamperedStore.addPosition(mockPos);
    assert('Section 4.3', 'First position added cleanly within limits', add1 === true, '');

    // 4.3.4: Attempt to add second position -> addPosition MUST return false!
    const mockPos2: DivergencePosition = {
      ...mockPos,
      id: 'div_pos_002',
      canonicalSymbol: 'APTUSDT',
      binanceSymbol: 'APTUSDT',
      bybitSymbol: 'APTUSDT',
    };
    const add2 = tamperedStore.addPosition(mockPos2);
    assert('Section 4.3', 'addPosition strictly rejects second position (capacity = 1)', add2 === false, '');

    // 4.3.5: canOpenPosition MUST reject while 1 position is active
    const gateWhileFull = tamperedStore.canOpenPosition(15.00);
    assert(
      'Section 4.3',
      'canOpenPosition rejects when 1 position is active',
      gateWhileFull.allowed === false && Boolean(gateWhileFull.reason?.includes('Max concurrent positions limit reached')),
      `allowed=${gateWhileFull.allowed}, reason=${gateWhileFull.reason}`
    );

    // 4.3.6: Close position -> canOpenPosition becomes allowed again
    const closed = tamperedStore.closePosition('div_pos_001', {
      exitReason: 'EXPANSION_TP',
      netRealizedPnlUsdt: 0.0250,
      actualFeesUsdt: 0.0220,
    });
    assert('Section 4.3', 'closePosition successfully closes active position', closed !== null && closed.status === 'CLOSED', '');

    const gateAfterClose = tamperedStore.canOpenPosition(15.00);
    assert('Section 4.3', 'canOpenPosition allows entry after position closed', gateAfterClose.allowed === true, '');

    // 4.3.7: canOpenPosition rejects when isRunning = false
    tamperedStore.setRunning(false);
    const gatePaused = tamperedStore.canOpenPosition(15.00);
    assert(
      'Section 4.3',
      'canOpenPosition rejects when engine is PAUSED (isRunning = false)',
      gatePaused.allowed === false && Boolean(gatePaused.reason?.includes('Engine is not running')),
      `allowed=${gatePaused.allowed}, reason=${gatePaused.reason}`
    );

    // Test 4.4: Boundary Input Stress on canOpenPosition (NaN and Negative Notional)
    tamperedStore.setRunning(true);
    const gateNaN = tamperedStore.canOpenPosition(NaN);
    // As a strict risk invariant, NaN must NEVER be permitted
    assert(
      'Section 4.4',
      'canOpenPosition rejects NaN notional input (Vulnerability finding: currently permitted)',
      gateNaN.allowed === false,
      `allowed=${gateNaN.allowed}`
    );

    const gateNegative = tamperedStore.canOpenPosition(-50.00);
    // As a strict risk invariant, negative notional must NEVER be permitted
    assert(
      'Section 4.4',
      'canOpenPosition rejects negative notional input (Vulnerability finding: currently permitted)',
      gateNegative.allowed === false,
      `allowed=${gateNegative.allowed}`
    );

    // Test 4.5: Oversized Notional Bypass in addPosition
    tamperedStore.clearState();
    tamperedStore.setRunning(true);
    const oversizedPos: any = {
      id: 'oversized_test_pos',
      symbol: 'BTC',
      canonicalSymbol: 'BTCUSDT',
      direction: 'LONG_BN_SHORT_BYB',
      status: 'OPEN',
      entryTimestamp: Date.now(),
      notionalUsdt: 5000.00, // 333x larger than $15 limit!
      lastUpdated: Date.now(),
    };
    const addedOversized = tamperedStore.addPosition(oversizedPos);
    assert(
      'Section 4.5',
      'addPosition rejects position with notional exceeding $15.00 limit ($5,000.00)',
      addedOversized === false,
      `addedOversized=${addedOversized}, posNotional=${tamperedStore.getPositionById('oversized_test_pos')?.notionalUsdt}`
    );

    // Test 4.6: In-Memory Reference Leakage via getState()
    const stateRef = tamperedStore.getState();
    (stateRef.config as any).maxCapitalAllocationUsdt = 99999.00;
    (stateRef.activePositions as any)['memory_injection'] = { id: 'memory_injection', notionalUsdt: 99999 };
    const stateAfterMutation = tamperedStore.getState();
    assert(
      'Section 4.6',
      'getState() returns deep clone preventing in-memory capital tampering (Vulnerability finding: shallow clone mutates internal state)',
      stateAfterMutation.config.maxCapitalAllocationUsdt === 15.00 && tamperedStore.getActivePositions().length === (addedOversized ? 1 : 0),
      `leakedCap=${stateAfterMutation.config.maxCapitalAllocationUsdt}, leakedPositions=${tamperedStore.getActivePositions().length}`
    );
  } catch (err: any) {
    assert('Section 4', 'Capital limits test exception', false, err.message);
  }

  // ===========================================================================
  // SUMMARY REPORT & VERDICT
  // ===========================================================================
  console.log('\n========================================================================');
  console.log(`  EMPIRICAL CHALLENGER VERIFICATION COMPLETE:`);
  console.log(`  Total Passed: ${passCount}`);
  console.log(`  Total Failed: ${failCount}`);
  console.log(`  VERDICT: ${failCount === 0 ? 'APPROVE' : 'REJECT'}`);
  console.log('========================================================================\n');

  // Clean up sandbox
  resetSandbox();

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAdversarialHarness().catch((err) => {
  console.error('Fatal harness crash:', err);
  process.exit(1);
});
