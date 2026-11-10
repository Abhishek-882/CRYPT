/**
 * EMPIRICAL CHALLENGER: ADVERSARIAL DEEP STRESS HARNESS (Milestone 1 Remediation Iteration 2)
 * 
 * Deep, rigorous adversarial stress-testing across the 5 core remediation targets:
 * 1. High-Contention Concurrent Writes (100 parallel async writes, serialized queues, Windows NTFS retry backoff)
 * 2. Pre-Trade & State Input Validation (NaN, negative, zero, non-numeric, infinity, boundary limits)
 * 3. Oversized & Out-of-Bounds Position Rejection (Direct injection, capacity limits, capital ceiling)
 * 4. Deep Clone Mutation & Heap Memory Isolation (getState, getActivePositions, getClosedPositions, getPositionById)
 * 5. Daemon Lock Stale Eviction, TOCTOU Race Defense & Anti-Hijack Exclusivity
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import {
  acquireDaemonLock,
  releaseDaemonLock,
  clearStaleDaemonLock,
  getDaemonLockInfo,
  getDaemonLockFilePath,
  isDaemonLocked,
  isDaemonRunning,
  isDaemonLockHeldByCurrentProcess,
  LockCollisionError,
} from '../lib/daemonLockManager';

import {
  DivergenceStateStore,
  atomicWriteFile,
  atomicWriteFileSync,
  DEFAULT_DIVERGENCE_CONFIG,
} from '../lib/divergence/store/stateStore';

import {
  DivergencePosition,
  DivergenceClosedPosition,
  DivergenceInFlightIntent,
} from '../lib/divergence/types';

interface ChallengeResult {
  section: string;
  testName: string;
  passed: boolean;
  details: string;
}

const results: ChallengeResult[] = [];
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

const sandboxDir = path.resolve(__dirname, 'sandbox_challenger_m1_r2');
const stateFilePath = path.join(sandboxDir, 'stress_divergence_state.json');
const inflightFilePath = path.join(sandboxDir, 'stress_divergence_inflight.json');
const lockDivPath = path.join(sandboxDir, 'divergence_daemon.lock');
const lockBotPath = path.join(sandboxDir, 'bot_daemon.lock');

function setupSandbox() {
  if (fs.existsSync(sandboxDir)) {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  }
  fs.mkdirSync(sandboxDir, { recursive: true });
}

function cleanupSandbox() {
  try {
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  } catch {}
}

async function runAllStressTests() {
  console.log('========================================================================');
  console.log('  CHALLENGER 1: EMPIRICAL ADVERSARIAL DEEP STRESS HARNESS (M1 R2)');
  console.log('========================================================================\n');

  setupSandbox();

  try {
    // ========================================================================
    // AREA 1: High-Contention Concurrent Writes (Windows NTFS Resilience)
    // ========================================================================
    console.log('--- AREA 1: High-Contention Concurrent Writes & Atomic Serialization ---');
    {
      const writeTarget = path.join(sandboxDir, 'concurrent_stress.json');
      const backupTarget = `${writeTarget}.backup`;
      const numWrites = 100;
      const promises: Promise<void>[] = [];
      const writeErrors: any[] = [];

      // Burst 100 concurrent async writes to the exact same file
      for (let i = 0; i < numWrites; i++) {
        const payload = JSON.stringify({
          iteration: i,
          timestamp: Date.now(),
          uuid: crypto.randomUUID(),
          bufferPadding: 'X'.repeat(512),
        });

        promises.push(
          atomicWriteFile(writeTarget, payload).catch((err) => {
            writeErrors.push(err);
          })
        );
      }

      await Promise.all(promises);

      assert(
        'Area 1.1',
        `100 rapid concurrent atomicWriteFile calls complete with 0 unhandled rejections`,
        writeErrors.length === 0,
        `Errors encountered: ${writeErrors.length} (first: ${writeErrors[0]?.message})`
      );

      assert(
        'Area 1.1',
        'Target file exists on disk and is non-empty',
        fs.existsSync(writeTarget) && fs.statSync(writeTarget).size > 0
      );

      let parsedDisk: any = null;
      let validJson = false;
      try {
        parsedDisk = JSON.parse(fs.readFileSync(writeTarget, 'utf-8'));
        validJson = typeof parsedDisk === 'object' && typeof parsedDisk.iteration === 'number';
      } catch (err: any) {
        validJson = false;
      }

      assert(
        'Area 1.1',
        'Target file content is 100% valid parseable JSON with zero byte corruption',
        validJson,
        `Parsed iteration: ${parsedDisk?.iteration}`
      );

      assert(
        'Area 1.1',
        'Backup file (.backup) exists and is non-empty',
        fs.existsSync(backupTarget) && fs.statSync(backupTarget).size > 0
      );

      // Now test DivergenceStateStore persistState() under 100 concurrent async calls
      const store = new DivergenceStateStore(stateFilePath, inflightFilePath);
      const storePromises: Promise<void>[] = [];
      const storeErrors: any[] = [];

      for (let i = 0; i < numWrites; i++) {
        storePromises.push(
          store.persistState().catch((err) => {
            storeErrors.push(err);
          })
        );
      }

      await Promise.all(storePromises);

      assert(
        'Area 1.2',
        '100 concurrent store.persistState() calls resolve cleanly via writeQueue Promise chaining',
        storeErrors.length === 0,
        `Errors: ${storeErrors.length}`
      );

      const parsedState = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
      assert(
        'Area 1.2',
        'Persisted state file exists, is valid JSON, and contains valid schema version',
        fs.existsSync(stateFilePath) && parsedState.version === '1.0.0',
        `version=${parsedState?.version}`
      );
    }

    // ========================================================================
    // AREA 2: Input Validation (NaN, Negative, Zero, Infinity, Non-Numeric)
    // ========================================================================
    console.log('\n--- AREA 2: Input Validation (NaN, Negative, Zero, Boundary, Types) ---');
    {
      const store = new DivergenceStateStore(stateFilePath, inflightFilePath);
      store.setRunning(true);

      // Adversarial inputs for canOpenPosition
      const invalidNotionals = [
        { label: 'NaN', val: NaN },
        { label: 'Number.NaN', val: Number.NaN },
        { label: '-1.00', val: -1.0 },
        { label: '-0.0000001', val: -0.0000001 },
        { label: '-15.00', val: -15.0 },
        { label: '-1000', val: -1000 },
        { label: '0.00 (zero)', val: 0 },
        { label: '-0 (negative zero)', val: -0 },
        { label: '+Infinity', val: Infinity },
        { label: '-Infinity', val: -Infinity },
        { label: 'null', val: null as any },
        { label: 'string "15"', val: '15' as any },
        { label: 'string "NaN"', val: 'NaN' as any },
        { label: 'boolean true', val: true as any },
        { label: 'boolean false', val: false as any },
        { label: 'empty object {}', val: {} as any },
        { label: 'array [15]', val: [15] as any },
      ];

      for (const item of invalidNotionals) {
        const check = store.canOpenPosition(item.val);
        assert(
          'Area 2.1',
          `canOpenPosition strictly rejects invalid input: ${item.label}`,
          check.allowed === false && typeof check.reason === 'string' && check.reason.length > 0,
          `allowed=${check.allowed}, reason=${check.reason}`
        );
      }

      // Default argument check (when called without parameters, defaults to 15.00 USDT)
      const defaultCheck = store.canOpenPosition();
      assert(
        'Area 2.1',
        'canOpenPosition without arguments defaults to $15.00 USDT ceiling and evaluates correctly',
        defaultCheck.allowed === true
      );

      // Boundary tests
      const boundaryValid = [0.00001, 1.0, 14.99, 15.0];
      for (const val of boundaryValid) {
        const check = store.canOpenPosition(val);
        assert(
          'Area 2.2',
          `canOpenPosition allows legitimate positive notional within $15.00: $${val}`,
          check.allowed === true,
          `allowed=${check.allowed}, reason=${check.reason}`
        );
      }

      const boundaryInvalid = [15.000001, 15.01, 15.5, 20.0, 1000.0];
      for (const val of boundaryInvalid) {
        const check = store.canOpenPosition(val);
        assert(
          'Area 2.2',
          `canOpenPosition strictly rejects notional exceeding $15.00 ceiling: $${val}`,
          check.allowed === false,
          `allowed=${check.allowed}, reason=${check.reason}`
        );
      }
    }

    // ========================================================================
    // AREA 3: Oversized Position Rejection & Capacity Hard-Lock
    // ========================================================================
    console.log('\n--- AREA 3: Oversized Position Rejection & Capacity Hard-Lock ---');
    {
      const store = new DivergenceStateStore(stateFilePath, inflightFilePath);
      store.setRunning(true);

      // 1. Direct injection of invalid or oversized positions into addPosition()
      const invalidPositions: any[] = [
        null,
        undefined,
        {},
        { id: 'pos_nan', notionalUsdt: NaN },
        { id: 'pos_neg', notionalUsdt: -10.0 },
        { id: 'pos_zero', notionalUsdt: 0 },
        { id: 'pos_inf', notionalUsdt: Infinity },
        { id: 'pos_str', notionalUsdt: '15' },
        { id: 'pos_oversized_15_01', notionalUsdt: 15.01 },
        { id: 'pos_oversized_50', notionalUsdt: 50.0 },
        { id: 'pos_oversized_5000', notionalUsdt: 5000.0 },
      ];

      for (let i = 0; i < invalidPositions.length; i++) {
        const pos = invalidPositions[i];
        const added = store.addPosition(pos);
        assert(
          'Area 3.1',
          `addPosition rejects malicious/invalid position payload [${i}]: ${pos ? JSON.stringify(pos) : String(pos)}`,
          added === false
        );
      }

      assert(
        'Area 3.1',
        'State activePositions remains empty after all malicious addPosition attempts',
        Object.keys(store.getState().activePositions).length === 0
      );

      // 2. Add valid position at limit ($15.00 USDT)
      const validPosition: any = {
        id: 'div_pos_legit_001',
        canonicalSymbol: 'ETH',
        symbol: 'ETHUSDT',
        direction: 'DIRECTION_1',
        notionalUsdt: 15.0,
        entryBasisPct: 0.05,
        targetBasisPct: 0.45,
        stopBasisPct: -0.15,
        entryTimestamp: Date.now(),
        openedAt: Date.now(),
        lastUpdated: Date.now(),
        legs: {
          leg1: {
            venue: 'BINANCE_USDM',
            symbol: 'ETHUSDT',
            side: 'BUY',
            quantity: 0.005,
            fillPrice: 3000,
            orderId: 'bn_ord_1',
            status: 'FILLED',
            executedAt: Date.now(),
          },
          leg2: {
            venue: 'BYBIT_LINEAR',
            symbol: 'ETHUSDT',
            side: 'SELL',
            quantity: 0.005,
            fillPrice: 3000,
            orderId: 'byb_ord_1',
            status: 'FILLED',
            executedAt: Date.now(),
          },
        },
      };

      const addResult = store.addPosition(validPosition);
      assert('Area 3.2', 'addPosition accepts valid position within $15.00 limit', addResult === true);

      // 3. Attempting to add a 2nd position when capacity is 1
      const secondPosition: any = {
        ...validPosition,
        id: 'div_pos_legit_002',
        symbol: 'BTCUSDT',
        notionalUsdt: 0.01,
      };

      const secondAddResult = store.addPosition(secondPosition);
      assert(
        'Area 3.2',
        'addPosition strictly blocks 2nd position (maxConcurrentPositions = 1 capacity reached)',
        secondAddResult === false
      );

      // 4. canOpenPosition rejects while position is open
      const canOpenWhileActive = store.canOpenPosition(0.01);
      assert(
        'Area 3.2',
        'canOpenPosition rejects order entry while active position is present',
        canOpenWhileActive.allowed === false,
        canOpenWhileActive.reason
      );

      // 5. Close position and verify canOpenPosition unlocks
      const closed = store.closePosition('div_pos_legit_001', {
        exitReason: 'EXPANSION_TP',
        netRealizedPnlUsdt: 0.05,
        exitTimestamp: Date.now(),
      });
      assert('Area 3.2', 'closePosition cleanly closes active position', closed !== null);

      const canOpenAfterClose = store.canOpenPosition(15.0);
      assert('Area 3.2', 'canOpenPosition allows entry after position is closed', canOpenAfterClose.allowed === true);
    }

    // ========================================================================
    // AREA 4: Deep Clone Mutation & Heap Memory Isolation
    // ========================================================================
    console.log('\n--- AREA 4: Deep Clone Mutation & Memory Isolation ---');
    {
      const store = new DivergenceStateStore(stateFilePath, inflightFilePath);
      store.clearState();
      store.setRunning(true);

      // Test 1: getState() isolation
      const state1 = store.getState() as any;
      state1.config.maxCapitalAllocationUsdt = 999999;
      state1.config.maxConcurrentPositions = 99;
      state1.isRunning = false;
      state1.fsmState = 'MALICIOUS_FSM';
      state1.activePositions['malicious_pos'] = { id: 'malicious', notionalUsdt: 99999 };

      const state2 = store.getState();
      assert(
        'Area 4.1',
        'Mutating returned state.config.maxCapitalAllocationUsdt does not corrupt internal state ($15.00 preserved)',
        state2.config.maxCapitalAllocationUsdt === 15.0,
        `state2 cap: ${state2.config.maxCapitalAllocationUsdt}`
      );

      assert(
        'Area 4.1',
        'Mutating returned state.config.maxConcurrentPositions does not corrupt internal state (1 preserved)',
        state2.config.maxConcurrentPositions === 1
      );

      assert(
        'Area 4.1',
        'Mutating returned state.isRunning does not corrupt internal state (true preserved)',
        state2.isRunning === true
      );

      assert(
        'Area 4.1',
        'Mutating returned state.activePositions does not inject positions into internal state',
        state2.activePositions['malicious_pos'] === undefined
      );

      // Test 2: getActivePositions() isolation
      const testPos: any = {
        id: 'div_pos_clone_test',
        canonicalSymbol: 'SOL',
        symbol: 'SOLUSDT',
        direction: 'DIRECTION_1',
        notionalUsdt: 12.5,
        entryBasisPct: 0.02,
        targetBasisPct: 0.42,
        stopBasisPct: -0.15,
        entryTimestamp: Date.now(),
        openedAt: Date.now(),
        lastUpdated: Date.now(),
        legs: {
          leg1: {
            venue: 'BINANCE_USDM',
            symbol: 'SOLUSDT',
            side: 'BUY',
            quantity: 0.1,
            fillPrice: 125,
            orderId: 'bn_sol_1',
            status: 'FILLED',
            executedAt: Date.now(),
          },
          leg2: {
            venue: 'BYBIT_LINEAR',
            symbol: 'SOLUSDT',
            side: 'SELL',
            quantity: 0.1,
            fillPrice: 125,
            orderId: 'byb_sol_1',
            status: 'FILLED',
            executedAt: Date.now(),
          },
        },
      };

      store.addPosition(testPos);

      const activePositions1: any[] = store.getActivePositions();
      assert('Area 4.2', 'getActivePositions returns 1 position', activePositions1.length === 1);

      // Mutate returned array and elements
      activePositions1[0].notionalUsdt = 88888.88;
      activePositions1[0].legs.leg1.fillPrice = 0;
      activePositions1.push({} as any);

      const activePositions2: any[] = store.getActivePositions();
      assert(
        'Area 4.2',
        'Mutating array elements from getActivePositions does not leak into internal state (notional preserved at 12.5)',
        activePositions2[0].notionalUsdt === 12.5 && activePositions2[0].legs.leg1.fillPrice === 125,
        `notionalUsdt=${activePositions2[0].notionalUsdt}, fillPrice=${activePositions2[0].legs.leg1.fillPrice}`
      );

      assert(
        'Area 4.2',
        'Mutating array length from getActivePositions does not affect internal position count',
        activePositions2.length === 1
      );

      // Test 3: getPositionById() isolation
      const posById1: any = store.getPositionById('div_pos_clone_test');
      assert('Area 4.3', 'getPositionById finds active position', posById1 !== undefined);

      if (posById1) {
        posById1.notionalUsdt = 77777;
        posById1.symbol = 'HACKED';
      }

      const posById2: any = store.getPositionById('div_pos_clone_test');
      assert(
        'Area 4.3',
        'Mutating object returned by getPositionById does not mutate internal position',
        posById2?.notionalUsdt === 12.5 && posById2?.symbol === 'SOLUSDT',
        `notionalUsdt=${posById2?.notionalUsdt}, symbol=${posById2?.symbol}`
      );

      // Test 4: getClosedPositions() isolation
      const closedPos = store.closePosition('div_pos_clone_test', {
        exitReason: 'MANUAL_UNWIND',
        netRealizedPnlUsdt: 0.10,
        exitTimestamp: Date.now(),
      });
      assert('Area 4.4', 'closePosition succeeds', closedPos !== null);

      const closedPositions1 = store.getClosedPositions();
      assert('Area 4.4', 'getClosedPositions returns 1 closed position', closedPositions1.length === 1);

      closedPositions1[0].netRealizedPnlUsdt = 999999;
      closedPositions1.push({} as any);

      const closedPositions2 = store.getClosedPositions();
      assert(
        'Area 4.4',
        'Mutating object/array returned by getClosedPositions does not mutate internal state',
        closedPositions2[0].netRealizedPnlUsdt === 0.10 && closedPositions2.length === 1,
        `netRealizedPnlUsdt=${closedPositions2[0].netRealizedPnlUsdt}, length=${closedPositions2.length}`
      );
    }

    // ========================================================================
    // AREA 5: Stale Lock Eviction, Concurrency & TOCTOU Defense
    // ========================================================================
    console.log('\n--- AREA 5: Stale Lock Eviction, TOCTOU Defense & Concurrency ---');
    {
      const lockFileName = lockDivPath;

      // Ensure clean state
      if (fs.existsSync(lockFileName)) fs.unlinkSync(lockFileName);

      // Test 1: Clean Acquisition and Exclusivity
      const acq1 = acquireDaemonLock({ lockFileName });
      assert('Area 5.1', 'Acquires daemon lock cleanly', acq1.acquired === true);

      // Second acquire fails with collision without throwing
      const acq2 = acquireDaemonLock({ lockFileName, throwOnCollision: false });
      assert('Area 5.1', 'Second acquire without force fails with collision', acq2.acquired === false);

      // Second acquire with throwOnCollision throws LockCollisionError
      let threwCollision = false;
      try {
        acquireDaemonLock({ lockFileName, throwOnCollision: true });
      } catch (err: any) {
        threwCollision = err instanceof LockCollisionError;
      }
      assert('Area 5.1', 'Second acquire with throwOnCollision throws LockCollisionError', threwCollision === true);

      // Release
      const rel1 = releaseDaemonLock({ lockFileName });
      assert('Area 5.1', 'releaseDaemonLock cleanly releases lock', rel1 === true);
      assert('Area 5.1', 'Lock file unlinked from disk', !fs.existsSync(lockFileName));

      // Test 2: Dead PID Stale Lock Eviction
      const deadPid = 99999988;
      const stalePayload = {
        pid: deadPid,
        instanceUuid: 'uuid_dead_test_001',
        hostname: os.hostname(),
        startedAt: Date.now() - 60000,
        lastHeartbeat: Date.now() - 50000,
        processTitle: 'stale_worker_dead',
      };
      fs.writeFileSync(lockFileName, JSON.stringify(stalePayload, null, 2), 'utf-8');

      // Attempt acquisition over dead PID
      const acqStale = acquireDaemonLock({ lockFileName });
      assert('Area 5.2', 'Evicts stale lock for dead PID and acquires cleanly', acqStale.acquired === true);
      assert('Area 5.2', 'Lock on disk now has current process PID', acqStale.pid === process.pid);

      releaseDaemonLock({ lockFileName });

      // Test 3: TOCTOU Defense (Race Condition Simulation)
      // When clearStaleDaemonLock is called on a file that contains an active PID
      const activePayload = {
        pid: process.pid,
        instanceUuid: 'uuid_active_race_winner',
        hostname: os.hostname(),
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        processTitle: 'active_race_winner',
      };
      fs.writeFileSync(lockFileName, JSON.stringify(activePayload, null, 2), 'utf-8');

      const cleared = clearStaleDaemonLock({ lockFileName });
      assert(
        'Area 5.3',
        'clearStaleDaemonLock refuses to unlink active lock (TOCTOU defense)',
        cleared === false
      );
      assert(
        'Area 5.3',
        'Active lock file remains untouched on disk',
        fs.existsSync(lockFileName)
      );

      // Test 4: Anti-Hijack Defense
      // Write foreign lock with different instanceUuid
      const foreignPayload = {
        pid: process.pid,
        instanceUuid: 'foreign_instance_uuid_different_process',
        hostname: 'foreign_host',
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        processTitle: 'foreign_node',
      };
      fs.writeFileSync(lockFileName, JSON.stringify(foreignPayload, null, 2), 'utf-8');

      const hijackRelease = releaseDaemonLock({ lockFileName });
      assert(
        'Area 5.4',
        'releaseDaemonLock refuses to delete foreign lockfile (Anti-Hijack Invariant)',
        hijackRelease === false
      );
      assert(
        'Area 5.4',
        'Foreign lock remains intact on disk',
        fs.existsSync(lockFileName)
      );

      // Clean up manually for next test
      fs.unlinkSync(lockFileName);

      // Test 5: Multi-Daemon Lock Coexistence (divergence_daemon.lock vs bot_daemon.lock)
      if (fs.existsSync(lockDivPath)) fs.unlinkSync(lockDivPath);
      if (fs.existsSync(lockBotPath)) fs.unlinkSync(lockBotPath);

      const acqDiv = acquireDaemonLock({ lockFileName: lockDivPath });
      const acqBot = acquireDaemonLock({ lockFileName: lockBotPath });

      assert('Area 5.5', 'Acquires divergence daemon lock', acqDiv.acquired === true);
      assert('Area 5.5', 'Acquires bot daemon lock concurrently without interference', acqBot.acquired === true);
      assert('Area 5.5', 'Both locks exist simultaneously on disk', fs.existsSync(lockDivPath) && fs.existsSync(lockBotPath));

      const relDiv = releaseDaemonLock({ lockFileName: lockDivPath });
      assert('Area 5.5', 'Releases divergence daemon lock', relDiv === true);
      assert('Area 5.5', 'Bot daemon lock remains intact on disk after divergence release', fs.existsSync(lockBotPath));

      const relBot = releaseDaemonLock({ lockFileName: lockBotPath });
      assert('Area 5.5', 'Releases bot daemon lock', relBot === true);
      assert('Area 5.5', 'Both lock files unlinked cleanly', !fs.existsSync(lockDivPath) && !fs.existsSync(lockBotPath));
    }

  } finally {
    cleanupSandbox();
  }

  console.log('\n========================================================================');
  console.log('  CHALLENGER 1 EMPIRICAL DEEP STRESS COMPLETE');
  console.log(`  Total Passed: ${passCount}`);
  console.log(`  Total Failed: ${failCount}`);
  const verdict = failCount === 0 ? 'APPROVE' : 'REJECT';
  console.log(`  VERDICT: ${verdict}`);
  console.log('========================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllStressTests().catch((err) => {
  console.error('Unhandled fatal error in challenger stress harness:', err);
  process.exit(1);
});
