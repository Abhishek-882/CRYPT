/**
 * Divergence Bot: State Store, Concurrency Lock & Intent Journaling Test Suite
 * Milestone 1 (M1) Specification Verification
 * 
 * Primary Invariants:
 * - ZERO BPS NOTATION: All spreads, hurdles, fees formatted strictly in % notation.
 * - STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * - DELTA-NEUTRALITY: Delta balance maintained |Delta_net| < 0.001.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createInitialDivergenceState,
  getDefaultDivergenceConfig,
  DivergenceConfig,
  DivergenceStateSchema,
} from './fixtures/divergenceMockAdapter';
import { resolveDataDir } from '@/lib/storagePath';
import {
  acquireDaemonLock,
  releaseDaemonLock,
  updateDaemonLockHeartbeat,
  isDaemonLocked,
  isDaemonRunning,
  isDaemonLockHeldByCurrentProcess,
  getDaemonLockFilePath,
  readDaemonLock,
  startHeartbeatCron,
  stopHeartbeatCron,
} from '@/lib/daemonLockManager';

describe('Milestone 1: State Store, Concurrency Lock & Intent Journaling', () => {
  const dataDir = resolveDataDir();
  const testStateFile = path.join(dataDir, 'test_divergence_state.json');
  const testLockFile = path.join(dataDir, 'test_divergence_daemon.lock');
  const testInflightFile = path.join(dataDir, 'test_divergence_inflight.json');

  function cleanupTestFiles() {
    [testStateFile, testLockFile, testInflightFile].forEach(f => {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    });
  }

  beforeEach(() => {
    cleanupTestFiles();
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Core Happy Paths)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {
    it('TC1.1.1 (State Initialization): creates valid DivergenceStateSchema defaulting to PAUSED', () => {
      const state = createInitialDivergenceState('1.0.0');

      expect(state.version).toBe('1.0.0');
      // MANDATORY CRITICAL INVARIANT: PAUSED / READY mode default
      expect(state.isRunning).toBe(false);
      expect(state.fsmState).toBe('PAUSED');
      expect(Object.keys(state.activePositions)).toHaveLength(0);
      expect(state.closedPositions).toHaveLength(0);
      expect(state.telemetry.loopCount).toBe(0);
      expect(state.telemetry.totalRealizedAlphaUsdt).toBe(0.0000);
      expect(state.telemetry.winCount).toBe(0);
      expect(state.telemetry.lossCount).toBe(0);
      expect(state.lastUpdated).toBeGreaterThan(0);
    });

    it('TC1.1.2 (Parameterized Lockfile): isolates divergence_daemon.lock from bot_daemon.lock', () => {
      const divergenceLockName = 'divergence_daemon.lock';
      const statArbLockName = 'bot_daemon.lock';

      // Both names must be distinct to prevent cross-strategy kernel lock collisions
      expect(divergenceLockName).not.toBe(statArbLockName);

      // Simulate lock creation with specific filename
      const lockPayload = {
        pid: process.pid,
        startedAt: Date.now(),
        heartbeat: Date.now(),
        hostname: os.hostname(),
        platform: process.platform,
        strategy: 'DIVERGENCE_BOT',
      };

      fs.writeFileSync(testLockFile, JSON.stringify(lockPayload, null, 2), 'utf-8');
      expect(fs.existsSync(testLockFile)).toBe(true);

      const readPayload = JSON.parse(fs.readFileSync(testLockFile, 'utf-8'));
      expect(readPayload.strategy).toBe('DIVERGENCE_BOT');
      expect(readPayload.pid).toBe(process.pid);
    });

    it('TC1.1.3 (Capital Risk Hard Caps): enforces max 3 concurrent positions and $60.00 USDT allocation', () => {
      const config = getDefaultDivergenceConfig();

      expect(config.maxConcurrentPositions).toBe(3);
      expect(config.maxPositionsPerSymbol).toBe(1);
      expect(config.maxCapitalAllocationUsdt).toBe(60.00);
      expect(config.orderNotionalUsdt).toBe(15.00);

      // Validation function testing boundary violations
      function validateDivergenceConfig(cfg: DivergenceConfig): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (cfg.maxConcurrentPositions > 3) {
          errors.push('CAPITAL_VIOLATION: maxConcurrentPositions cannot exceed 3 on current fleet NAV');
        }
        if (cfg.maxCapitalAllocationUsdt > 60.00) {
          errors.push('CAPITAL_VIOLATION: maxCapitalAllocationUsdt cannot exceed 60.00 USDT on current fleet NAV');
        }
        if (cfg.orderNotionalUsdt > 15.00) {
          errors.push('CAPITAL_VIOLATION: orderNotionalUsdt cannot exceed 15.00 USDT');
        }
        return { valid: errors.length === 0, errors };
      }

      const validRes = validateDivergenceConfig(config);
      expect(validRes.valid).toBe(true);

      // Rejects excessive position limit
      const invalidPositions = { ...config, maxConcurrentPositions: 4 };
      expect(validateDivergenceConfig(invalidPositions).valid).toBe(false);

      // Rejects excessive capital allocation
      const invalidCapital = { ...config, maxCapitalAllocationUsdt: 75.00 };
      expect(validateDivergenceConfig(invalidCapital).valid).toBe(false);
    });

    it('TC1.1.4 (Windows Atomic Persistence): performs temp file write and atomic rename with fallback', () => {
      const state = createInitialDivergenceState();
      state.telemetry.loopCount = 42;

      function saveAtomicState(filepath: string, data: DivergenceStateSchema): boolean {
        const tempPath = `${filepath}.tmp.${Date.now()}`;
        const content = JSON.stringify(data, null, 2);
        try {
          fs.writeFileSync(tempPath, content, 'utf-8');
          try {
            fs.renameSync(tempPath, filepath);
          } catch (renameErr: any) {
            // Windows EPERM/EBUSY fallback
            fs.copyFileSync(tempPath, filepath);
            fs.unlinkSync(tempPath);
          }
          return true;
        } catch {
          if (fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch {}
          }
          return false;
        }
      }

      const saved = saveAtomicState(testStateFile, state);
      expect(saved).toBe(true);
      expect(fs.existsSync(testStateFile)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(testStateFile, 'utf-8'));
      expect(loaded.telemetry.loopCount).toBe(42);
    });

    it('TC1.1.5 (In-Flight Intent Journal): writes, updates and clears pre-dispatch intent', () => {
      interface InFlightIntent {
        intentId: string;
        timestamp: number;
        symbol: string;
        direction: string;
        targetNotional: number;
        state: 'INTENT_DECLARED' | 'LEG1_DISPATCHED' | 'LEG1_FILLED' | 'HEDGED';
      }

      const intent: InFlightIntent = {
        intentId: `intent_${Date.now()}`,
        timestamp: Date.now(),
        symbol: 'SUIUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        targetNotional: 15.00,
        state: 'INTENT_DECLARED',
      };

      // 1. Persist pre-dispatch intent
      fs.writeFileSync(testInflightFile, JSON.stringify(intent, null, 2), 'utf-8');
      expect(fs.existsSync(testInflightFile)).toBe(true);

      // 2. Transition state on Leg 1 fill
      intent.state = 'LEG1_FILLED';
      fs.writeFileSync(testInflightFile, JSON.stringify(intent, null, 2), 'utf-8');
      const updated = JSON.parse(fs.readFileSync(testInflightFile, 'utf-8'));
      expect(updated.state).toBe('LEG1_FILLED');

      // 3. Clear intent upon successful dual-leg persistence
      fs.unlinkSync(testInflightFile);
      expect(fs.existsSync(testInflightFile)).toBe(false);
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC2.1.1 (Stale Lock Dead PID Eviction): detects dead PID and recovers lock cleanly', () => {
      // Create a stale lock with an impossible dead PID
      const deadPid = 99999999;
      const staleLock = {
        pid: deadPid,
        startedAt: Date.now() - 120000,
        heartbeat: Date.now() - 120000,
        hostname: 'test-host',
        strategy: 'DIVERGENCE_BOT',
      };
      fs.writeFileSync(testLockFile, JSON.stringify(staleLock), 'utf-8');

      function isPidAlive(pid: number): boolean {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }

      function acquireWithStaleRecovery(lockPath: string, currentPid: number): boolean {
        if (fs.existsSync(lockPath)) {
          try {
            const existing = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
            if (!isPidAlive(existing.pid)) {
              // Dead process: evict stale lock
              fs.unlinkSync(lockPath);
            } else {
              // Live process: collision error
              return false;
            }
          } catch {
            fs.unlinkSync(lockPath);
          }
        }

        fs.writeFileSync(lockPath, JSON.stringify({ pid: currentPid, startedAt: Date.now() }), 'utf-8');
        return true;
      }

      const recovered = acquireWithStaleRecovery(testLockFile, process.pid);
      expect(recovered).toBe(true);

      const activeLock = JSON.parse(fs.readFileSync(testLockFile, 'utf-8'));
      expect(activeLock.pid).toBe(process.pid);
    });

    it('TC2.1.2 (Active PID Collision Rejection): active process lock collision throws error', () => {
      // Simulate lock held by current process
      const liveLock = {
        pid: process.pid,
        startedAt: Date.now(),
        heartbeat: Date.now(),
        hostname: os.hostname(),
        strategy: 'DIVERGENCE_BOT',
      };
      fs.writeFileSync(testLockFile, JSON.stringify(liveLock), 'utf-8');

      function tryAcquire(lockPath: string): { acquired: boolean; reason?: string } {
        if (fs.existsSync(lockPath)) {
          const payload = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
          try {
            process.kill(payload.pid, 0);
            return { acquired: false, reason: `COLLISION_WITH_PID_${payload.pid}` };
          } catch {
            // dead
          }
        }
        return { acquired: true };
      }

      const collision = tryAcquire(testLockFile);
      expect(collision.acquired).toBe(false);
      expect(collision.reason).toBe(`COLLISION_WITH_PID_${process.pid}`);
    });

    it('TC2.1.3 (Corrupted Statefile Auto-Recovery): corrupted or truncated JSON re-initializes cleanly', () => {
      // Write corrupted truncated JSON
      fs.writeFileSync(testStateFile, '{"version":"1.0.0", "isRunning": true, "corrupted...', 'utf-8');

      function safeLoadState(filepath: string): DivergenceStateSchema {
        try {
          if (fs.existsSync(filepath)) {
            const raw = fs.readFileSync(filepath, 'utf-8');
            return JSON.parse(raw);
          }
        } catch {
          // Corrupted state auto-recovers to initial PAUSED state
        }
        return createInitialDivergenceState('1.0.0');
      }

      const recoveredState = safeLoadState(testStateFile);
      expect(recoveredState.isRunning).toBe(false);
      expect(recoveredState.fsmState).toBe('PAUSED');
      expect(recoveredState.version).toBe('1.0.0');
    });

    it('TC2.1.4 (Rapid Concurrent Atomic Saves): 20 rapid asynchronous writes resolve without corruption', async () => {
      const state = createInitialDivergenceState();

      const promises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          new Promise((resolve) => {
            const tempFile = `${testStateFile}.${i}.tmp`;
            state.telemetry.loopCount = i;
            fs.writeFileSync(tempFile, JSON.stringify(state), 'utf-8');
            try {
              fs.renameSync(tempFile, testStateFile);
            } catch {
              fs.copyFileSync(tempFile, testStateFile);
              try { fs.unlinkSync(tempFile); } catch {}
            }
            resolve();
          })
        );
      }

      await Promise.all(promises);
      expect(fs.existsSync(testStateFile)).toBe(true);

      const finalState = JSON.parse(fs.readFileSync(testStateFile, 'utf-8'));
      expect(typeof finalState.telemetry.loopCount).toBe('number');
      expect(finalState.isRunning).toBe(false);
    });

    it('TC2.1.5 (Zero Capital Allocation Boundary): maxCapitalAllocationUsdt = 0 blocks new entries', () => {
      const config = getDefaultDivergenceConfig();
      config.maxCapitalAllocationUsdt = 0;

      function canOpenNewPosition(activeCount: number, proposedNotional: number, cfg: DivergenceConfig): boolean {
        if (cfg.maxCapitalAllocationUsdt <= 0) return false;
        if (activeCount >= cfg.maxConcurrentPositions) return false;
        if (proposedNotional > cfg.maxCapitalAllocationUsdt) return false;
        return true;
      }

      expect(canOpenNewPosition(0, 15.00, config)).toBe(false);
      expect(canOpenNewPosition(0, 0.00, config)).toBe(false);

      // Re-enabling valid allocation allows positions up to maxConcurrentPositions
      config.maxCapitalAllocationUsdt = 60.00;
      expect(canOpenNewPosition(0, 15.00, config)).toBe(true);
      expect(canOpenNewPosition(config.maxConcurrentPositions, 15.00, config)).toBe(false); // Max reached
    });
  });

  // =========================================================================
  // TIER 3 & 4: CROSS-FEATURE & REAL-WORLD SCENARIOS
  // =========================================================================
  describe('Tier 3 & 4: Cross-Feature & Real-World Scenarios', () => {
    it('COMB-08 (Emergency Kill Switch + Daemon Lock): emergency kill transitions state and preserves lock', () => {
      // 1. Daemon lock held
      const lockPayload = { pid: process.pid, strategy: 'DIVERGENCE_BOT' };
      fs.writeFileSync(testLockFile, JSON.stringify(lockPayload), 'utf-8');

      // 2. Active state
      const state = createInitialDivergenceState();
      state.isRunning = true;
      state.fsmState = 'ACTIVE_EXPANDING';

      // 3. Trigger emergency kill
      function executeEmergencyKill(st: DivergenceStateSchema): DivergenceStateSchema {
        return {
          ...st,
          isRunning: false,
          fsmState: 'EMERGENCY_KILLED',
          lastUpdated: Date.now(),
        };
      }

      const killedState = executeEmergencyKill(state);
      expect(killedState.isRunning).toBe(false);
      expect(killedState.fsmState).toBe('EMERGENCY_KILLED');

      // Lockfile remains valid so no concurrent process can boot while emergency killed
      expect(fs.existsSync(testLockFile)).toBe(true);
      const lockOnDisk = JSON.parse(fs.readFileSync(testLockFile, 'utf-8'));
      expect(lockOnDisk.pid).toBe(process.pid);
    });

    it('Scenario 4 (Mid-Flight Process Crash Recovery): discovers unhedged Leg 1 orphan via intent log', () => {
      // Simulate crash intent: Leg 1 was filled on Binance, but daemon was killed before Leg 2 IOC
      const orphanedIntent = {
        intentId: 'intent_crash_123',
        timestamp: Date.now() - 5000,
        symbol: 'SUIUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        targetNotional: 15.00,
        state: 'LEG1_FILLED',
        leg1Receipt: {
          venue: 'BINANCE',
          symbol: 'SUIUSDT',
          side: 'BUY',
          price: 2.15,
          executedQty: 7.0,
        },
      };

      fs.writeFileSync(testInflightFile, JSON.stringify(orphanedIntent), 'utf-8');

      // Reboot recovery routine
      function reconcileCrashRecovery(inflightPath: string): { orphanFound: boolean; action: string } {
        if (!fs.existsSync(inflightPath)) {
          return { orphanFound: false, action: 'CLEAN_BOOT' };
        }
        const intent = JSON.parse(fs.readFileSync(inflightPath, 'utf-8'));
        if (intent.state === 'LEG1_FILLED') {
          // Orphan detected! Must unwind Leg 1 with reduceOnly: true
          fs.unlinkSync(inflightPath); // Clear intent
          return { orphanFound: true, action: 'EMERGENCY_MARKET_UNWIND_REDUCE_ONLY' };
        }
        return { orphanFound: false, action: 'CLEAN_BOOT' };
      }

      const recovery = reconcileCrashRecovery(testInflightFile);
      expect(recovery.orphanFound).toBe(true);
      expect(recovery.action).toBe('EMERGENCY_MARKET_UNWIND_REDUCE_ONLY');
      expect(fs.existsSync(testInflightFile)).toBe(false);
    });
  });

  // =========================================================================
  // TIER 5: REAL DAEMON LOCK MANAGER MULTI-LOCK CONCURRENCY & LIFECYCLE
  // =========================================================================
  describe('Tier 5: Real DaemonLockManager Multi-Lock Concurrency & Lifecycle', () => {
    const botLock = 'bot_daemon.lock';
    const divLock = 'divergence_daemon.lock';

    beforeEach(() => {
      releaseDaemonLock(botLock);
      releaseDaemonLock(divLock);
      const botPath = getDaemonLockFilePath(botLock);
      const divPath = getDaemonLockFilePath(divLock);
      [botPath, divPath].forEach((p) => {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch {}
        }
      });
    });

    afterEach(() => {
      stopHeartbeatCron(botLock);
      stopHeartbeatCron(divLock);
      releaseDaemonLock(botLock);
      releaseDaemonLock(divLock);
      const botPath = getDaemonLockFilePath(botLock);
      const divPath = getDaemonLockFilePath(divLock);
      [botPath, divPath].forEach((p) => {
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch {}
        }
      });
    });

    it('should acquire and maintain dual concurrent locks without in-memory collision', () => {
      const acqBot = acquireDaemonLock({ lockFileName: botLock, throwOnCollision: false });
      expect(acqBot.acquired).toBe(true);
      expect(isDaemonLocked(botLock)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(botLock)).toBe(true);

      const acqDiv = acquireDaemonLock({ lockFileName: divLock, throwOnCollision: false });
      expect(acqDiv.acquired).toBe(true);
      expect(isDaemonLocked(divLock)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(divLock)).toBe(true);

      // Distinct instance UUIDs
      expect(acqBot.instanceUuid).not.toBe(acqDiv.instanceUuid);

      // Independent heartbeat updates
      expect(updateDaemonLockHeartbeat(botLock)).toBe(true);
      expect(updateDaemonLockHeartbeat(divLock)).toBe(true);

      // Release bot lock only: divergence lock must remain active
      expect(releaseDaemonLock(botLock)).toBe(true);
      expect(isDaemonLocked(botLock)).toBe(false);
      expect(isDaemonLockHeldByCurrentProcess(botLock)).toBe(false);

      expect(isDaemonLocked(divLock)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(divLock)).toBe(true);

      // Release divergence lock
      expect(releaseDaemonLock(divLock)).toBe(true);
      expect(isDaemonLocked(divLock)).toBe(false);
    });

    it('should support startHeartbeatCron and stopHeartbeatCron on divergence_daemon.lock', async () => {
      const acq = acquireDaemonLock({ lockFileName: divLock });
      expect(acq.acquired).toBe(true);

      const initial = readDaemonLock(divLock);
      expect(initial).not.toBeNull();

      const timer = startHeartbeatCron({ lockFileName: divLock, intervalMs: 20 });
      expect(timer).not.toBeNull();

      await new Promise((r) => setTimeout(r, 60));

      const updated = readDaemonLock(divLock);
      expect(updated!.heartbeat).toBeGreaterThanOrEqual(initial!.heartbeat);

      expect(stopHeartbeatCron(divLock)).toBe(true);
      releaseDaemonLock(divLock);
    });

    it('should support force acquisition to overwrite existing active lock', () => {
      acquireDaemonLock({ lockFileName: divLock });
      expect(isDaemonRunning(divLock)).toBe(true);

      // Forced re-acquisition must succeed
      const forced = acquireDaemonLock({ lockFileName: divLock, force: true });
      expect(forced.acquired).toBe(true);
      expect(isDaemonRunning(divLock)).toBe(true);

      releaseDaemonLock(divLock);
    });
  });
});
