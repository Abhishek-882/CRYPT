/**
 * EMPIRICAL CHALLENGER: ADVERSARIAL STRESS & VULNERABILITY TEST SUITE (MILESTONE 1)
 * Target Modules:
 *   - web/lib/daemonLockManager.ts
 *   - web/lib/divergence/store/stateStore.ts
 *   - web/lib/divergence/types.ts
 * 
 * Roles: critic, specialist
 * Archetype: teamwork_challenger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import {
  acquireDaemonLock,
  releaseDaemonLock,
  updateDaemonLockHeartbeat,
  clearStaleDaemonLock,
  getDaemonLockInfo,
  getDaemonLockFilePath,
  isDaemonLocked,
  isDaemonLockHeldByCurrentProcess,
  startHeartbeatCron,
  stopHeartbeatCron,
  LockCollisionError,
} from '@/lib/daemonLockManager';

import {
  DivergenceStateStore,
  atomicWriteFileSync,
  atomicWriteFile,
  DEFAULT_DIVERGENCE_CONFIG,
  DEFAULT_DIVERGENCE_TELEMETRY,
} from '@/lib/divergence/store/stateStore';

import {
  DivergencePosition,
  DivergenceInFlightIntent,
} from '@/lib/divergence/types';

describe('Empirical Challenger: Milestone 1 Adversarial Stress Suite', () => {
  const sandboxDir = path.resolve(process.cwd(), 'tests', 'sandbox_empirical_m1');
  const stateSandboxPath = path.join(sandboxDir, 'test_divergence_state.json');
  const inflightSandboxPath = path.join(sandboxDir, 'test_divergence_inflight.json');
  const lockDivergencePath = path.join(sandboxDir, 'divergence_daemon.lock');
  const lockBotPath = path.join(sandboxDir, 'bot_daemon.lock');

  const cleanSandbox = () => {
    try {
      if (fs.existsSync(sandboxDir)) {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      }
    } catch {}
  };

  beforeEach(() => {
    cleanSandbox();
    fs.mkdirSync(sandboxDir, { recursive: true });
  });

  afterEach(() => {
    try {
      releaseDaemonLock({ lockFileName: lockDivergencePath });
      releaseDaemonLock({ lockFileName: lockBotPath });
    } catch {}
    cleanSandbox();
  });

  // =========================================================================
  // TASK 1: LOCK MANAGER EXCLUSIVITY & RACE CONDITIONS
  // =========================================================================
  describe('Task 1: Lock Manager Exclusivity & Race Conditions', () => {
    it('proves concurrent lock coexistence between divergence_daemon.lock and bot_daemon.lock', () => {
      const resDiv = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
      const resBot = acquireDaemonLock({ lockFileName: lockBotPath, throwOnCollision: false });

      expect(resDiv.acquired).toBe(true);
      expect(resBot.acquired).toBe(true);
      expect(isDaemonLocked(lockDivergencePath)).toBe(true);
      expect(isDaemonLocked(lockBotPath)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(lockDivergencePath)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(lockBotPath)).toBe(true);

      // Releasing divergence does not release bot
      const divReleased = releaseDaemonLock({ lockFileName: lockDivergencePath });
      expect(divReleased).toBe(true);
      expect(isDaemonLocked(lockDivergencePath)).toBe(false);
      expect(isDaemonLocked(lockBotPath)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(lockBotPath)).toBe(true);

      const botReleased = releaseDaemonLock({ lockFileName: lockBotPath });
      expect(botReleased).toBe(true);
      expect(isDaemonLocked(lockBotPath)).toBe(false);
    });

    it('rejects duplicate acquisition of the same lock with LockCollisionError', () => {
      const first = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
      expect(first.acquired).toBe(true);

      const secondNoThrow = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
      expect(secondNoThrow.acquired).toBe(false);
      expect(secondNoThrow.error).toContain('Lockfile collision');

      expect(() => {
        acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: true });
      }).toThrow(LockCollisionError);
    });

    it('recovers from stale lock with dead PID and acquires cleanly', () => {
      const deadPid = 99999991;
      const stalePayload = {
        pid: deadPid,
        startedAt: Date.now() - 60000,
        heartbeat: Date.now() - 60000,
        hostname: 'dead-node',
        platform: 'win32',
        instanceUuid: 'dead-uuid-99999991',
      };
      fs.writeFileSync(lockDivergencePath, JSON.stringify(stalePayload, null, 2), 'utf-8');

      expect(isDaemonLocked(lockDivergencePath)).toBe(false);

      const recoverResult = acquireDaemonLock({ lockFileName: lockDivergencePath, throwOnCollision: false });
      expect(recoverResult.acquired).toBe(true);
      expect(recoverResult.pid).toBe(process.pid);
      expect(isDaemonLocked(lockDivergencePath)).toBe(true);
    });

    it('enforces anti-hijack invariant: foreign process locks cannot be released by current process', () => {
      const foreignPayload = {
        pid: 99999992,
        startedAt: Date.now(),
        heartbeat: Date.now(),
        hostname: 'foreign-node',
        platform: 'linux',
        instanceUuid: 'foreign-uuid-99999992',
      };
      fs.writeFileSync(lockDivergencePath, JSON.stringify(foreignPayload, null, 2), 'utf-8');

      const released = releaseDaemonLock({ lockFileName: lockDivergencePath });
      expect(released).toBe(false);
      expect(fs.existsSync(lockDivergencePath)).toBe(true);

      const cleaned = clearStaleDaemonLock({ lockFileName: lockDivergencePath });
      expect(cleaned).toBe(true);
      expect(fs.existsSync(lockDivergencePath)).toBe(false);
    });
  });

  // =========================================================================
  // TASK 2: ATOMIC STATE STORE UNDER STRESS & CORRUPTION RECOVERY
  // =========================================================================
  describe('Task 2: Atomic State Store Under Stress & Corruption Recovery', () => {
    it('recovers state from .backup when primary JSON is truncated syntax', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      store.updateConfig({ zeroLossNetHurdleUsdt: 0.0350 });
      store.setRunning(true);
      store.persistStateSync();

      const backupPath = `${stateSandboxPath}.backup`;
      expect(fs.existsSync(backupPath)).toBe(true);

      // Deliberately corrupt primary file with incomplete syntax
      fs.writeFileSync(stateSandboxPath, '{"version":"1.0.0", "isRunning": true, "corrup', 'utf-8');

      const recoveredStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const recoveredState = recoveredStore.getState();

      expect(recoveredState.isRunning).toBe(true);
      expect(recoveredState.config.zeroLossNetHurdleUsdt).toBe(0.0350);

      // Primary file healed on disk
      const primaryOnDisk = JSON.parse(fs.readFileSync(stateSandboxPath, 'utf-8'));
      expect(primaryOnDisk.config.zeroLossNetHurdleUsdt).toBe(0.0350);
    });

    it('recovers state from .backup when primary file is 0-byte truncated', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      store.updateConfig({ relativeExpansionTargetPercent: 0.395 });
      store.persistStateSync();

      fs.writeFileSync(stateSandboxPath, '', 'utf-8');

      const recovered = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      expect(recovered.getState().config.relativeExpansionTargetPercent).toBe(0.395);
    });

    it('recovers state from .backup when primary file contains binary garbage', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      store.updateConfig({ zeroLossNetHurdleUsdt: 0.0150 });
      store.persistStateSync();

      fs.writeFileSync(stateSandboxPath, Buffer.from([0x00, 0xff, 0xde, 0xad, 0xbe, 0xef]));

      const recovered = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      expect(recovered.getState().config.zeroLossNetHurdleUsdt).toBe(0.0150);
    });

    it('recovers state when primary file is missing but .backup exists', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      store.updateConfig({ zeroLossNetHurdleUsdt: 0.0200 });
      store.persistStateSync();

      fs.unlinkSync(stateSandboxPath);
      expect(fs.existsSync(stateSandboxPath)).toBe(false);

      const recovered = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      expect(recovered.getState().config.zeroLossNetHurdleUsdt).toBe(0.0200);
      expect(fs.existsSync(stateSandboxPath)).toBe(true);
    });

    it('gracefully handles dual corruption without crashing (clean default in PAUSED mode)', () => {
      fs.writeFileSync(stateSandboxPath, 'CORRUPTED_PRIMARY_BYTES', 'utf-8');
      fs.writeFileSync(`${stateSandboxPath}.backup`, 'CORRUPTED_BACKUP_BYTES', 'utf-8');

      let store: DivergenceStateStore | null = null;
      expect(() => {
        store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      }).not.toThrow();

      const state = store!.getState();
      expect(state.isRunning).toBe(false);
      expect(state.fsmState).toBe('PAUSED');
      expect(state.config.maxCapitalAllocationUsdt).toBe(60.00);
      expect(state.config.maxConcurrentPositions).toBe(3);
    });

    it('manages pre-dispatch in-flight intent journal CRUD and dangling recovery', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      expect(store.readInflightIntents()).toHaveLength(0);

      const intent: DivergenceInFlightIntent = {
        intentId: 'div_intent_unit_001',
        canonicalSymbol: 'SUIUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        targetNotionalUsdt: 15.00,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'LEG1_FILLED',
        leg1: {
          venue: 'BINANCE',
          symbol: 'SUIUSDT',
          clientOrderId: 'div1_test_001',
          targetQty: 7.5,
          filledQty: 7.5,
          avgPrice: 2.0,
          status: 'FILLED',
          updatedAt: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          symbol: 'SUIUSDT',
          clientOrderId: 'div2_test_001',
          targetQty: 7.5,
          filledQty: 0,
          avgPrice: 0,
          status: 'PENDING',
          updatedAt: Date.now(),
        },
      };

      store.recordInflightIntent(intent);
      expect(store.readInflightIntents()).toHaveLength(1);

      // Startup check detects dangling unhedged intent
      const dangling = store.checkDanglingIntentsOnStartup();
      expect(dangling).toHaveLength(1);
      expect(dangling[0].intentId).toBe('div_intent_unit_001');

      // Order gating blocks when dangling intent exists
      store.setRunning(true);
      const gateResult = store.canOpenPosition(15.00);
      expect(gateResult.allowed).toBe(false);
      expect(gateResult.reason).toContain('Dangling in-flight intent exists');

      // Resolve intent to COMPLETED
      store.updateInflightIntent('div_intent_unit_001', { status: 'COMPLETED' });
      expect(store.checkDanglingIntentsOnStartup()).toHaveLength(0);

      const gateAfterComplete = store.canOpenPosition(15.00);
      expect(gateAfterComplete.allowed).toBe(true);

      // Clear intent
      store.clearInflightIntent('div_intent_unit_001');
      expect(store.readInflightIntents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // TASK 3: CAPITAL LIMITS HARD-LOCKING & SECURITY MUTATION VULNERABILITIES
  // =========================================================================
  describe('Task 3: Capital Limits Hard-Locking Verification & Boundary Stress', () => {
    it('clamps excessive or invalid values on updateConfig', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);

      expect(store.updateConfig({ maxConcurrentPositions: 10 }).maxConcurrentPositions).toBe(3);
      expect(store.updateConfig({ maxConcurrentPositions: -2 }).maxConcurrentPositions).toBe(3);
      expect(store.updateConfig({ maxConcurrentPositions: 0 }).maxConcurrentPositions).toBe(3);

      expect(store.updateConfig({ maxCapitalAllocationUsdt: 1000 }).maxCapitalAllocationUsdt).toBe(60.00);
      expect(store.updateConfig({ maxCapitalAllocationUsdt: -50 }).maxCapitalAllocationUsdt).toBe(60.00);
      expect(store.updateConfig({ maxCapitalAllocationUsdt: 0 }).maxCapitalAllocationUsdt).toBe(60.00);

      expect(store.updateConfig({ orderNotionalUsdt: 50 }).orderNotionalUsdt).toBe(15.00);
      expect(store.updateConfig({ maxPositionsPerSymbol: 5 }).maxPositionsPerSymbol).toBe(1);
    });

    it('sanitizes tampered on-disk state file upon startup', () => {
      const tampered = {
        version: '1.0.0',
        isRunning: true,
        fsmState: 'IDLE',
        config: {
          maxConcurrentPositions: 50,
          maxPositionsPerSymbol: 50,
          maxCapitalAllocationUsdt: 50000.00,
          orderNotionalUsdt: 10000.00,
        },
        activePositions: {},
        closedPositions: [],
        telemetry: {},
        lastUpdated: Date.now(),
      };
      fs.writeFileSync(stateSandboxPath, JSON.stringify(tampered, null, 2), 'utf-8');

      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const sanitized = store.getState().config;

      expect(sanitized.maxConcurrentPositions).toBe(3);
      expect(sanitized.maxPositionsPerSymbol).toBe(1);
      expect(sanitized.maxCapitalAllocationUsdt).toBe(60.00);
      expect(sanitized.orderNotionalUsdt).toBe(15.00);
    });

    it('strictly enforces single position capacity and capital ceiling in canOpenPosition', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      store.setRunning(true);

      // Rejects notional > $60.00 USDT
      const gateExceed = store.canOpenPosition(60.01);
      expect(gateExceed.allowed).toBe(false);
      expect(gateExceed.reason).toContain('Capital limit exceeded');

      // Accepts exact valid notional
      expect(store.canOpenPosition(10.00).allowed).toBe(true);

      // Add 1 position
      const pos: DivergencePosition = {
        id: 'div_pos_test_01',
        canonicalSymbol: 'SUIUSDT',
        binanceSymbol: 'SUIUSDT',
        bybitSymbol: 'SUIUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: Date.now(),
        entryBinancePrice: 2.0,
        entryBybitPrice: 2.0,
        entryBasisPercent: 0.0,
        currentBasisPercent: 0.0,
        peakBasisPercent: 0.0,
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
          clientOrderId: 'div1_test_01',
          symbol: 'SUIUSDT',
          executedQty: 7.5,
          avgPrice: 2.0,
          feePercent: 0.020,
          feeUsdt: 0.003,
          latencyMs: 12,
          timestamp: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'ord2',
          clientOrderId: 'div2_test_01',
          symbol: 'SUIUSDT',
          executedQty: 7.5,
          avgPrice: 2.0,
          feePercent: 0.055,
          feeUsdt: 0.008,
          latencyMs: 25,
          timestamp: Date.now(),
        },
        currentBinancePrice: 2.0,
        currentBybitPrice: 2.0,
        relativeExpansionPercent: 0.0,
        unrealizedGrossPnlUsdt: 0.0,
        estimatedTotalFeesUsdt: 0.022,
        netPnlUsdt: -0.022,
        roiPercent: -0.147,
        holdDurationMinutes: 0,
        isHurdleMet: false,
        executionHash: 'test_hash_001',
        stagnancyNominalDeadline: Date.now() + 180 * 60000,
        stagnancyCeilingDeadline: Date.now() + 360 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.0,
        lastUpdated: Date.now(),
      };

      expect(store.addPosition(pos)).toBe(true);

      // Accepts 2nd and 3rd positions up to max 3
      const pos2 = { ...pos, id: 'div_pos_test_02', canonicalSymbol: 'APTUSDT', notionalUsdt: 7.00 };
      expect(store.addPosition(pos2)).toBe(true);

      const pos3 = { ...pos, id: 'div_pos_test_03', canonicalSymbol: 'NEARUSDT', notionalUsdt: 7.00 };
      expect(store.addPosition(pos3)).toBe(true);

      // 4th position MUST be rejected
      const pos4 = { ...pos, id: 'div_pos_test_04', canonicalSymbol: 'SOLUSDT', notionalUsdt: 5.00 };
      expect(store.addPosition(pos4)).toBe(false);

      // canOpenPosition rejects when full
      const gateFull = store.canOpenPosition(5.00);
      expect(gateFull.allowed).toBe(false);
      expect(gateFull.reason).toContain('Max concurrent positions limit reached');
    });

    // =======================================================================
    // ADVERSARIAL VULNERABILITY FINDINGS (Critic Empirical Evidence)
    // =======================================================================

    it('VERIFIES REMEDIATION 1: canOpenPosition rejects NaN and negative notional inputs', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      store.setRunning(true);

      const gateNaN = store.canOpenPosition(NaN);
      expect(gateNaN.allowed).toBe(false);
      expect(gateNaN.reason).toContain('Invalid notionalUsdt requested');

      const gateNegative = store.canOpenPosition(-50);
      expect(gateNegative.allowed).toBe(false);
      expect(gateNegative.reason).toContain('Invalid notionalUsdt requested');
    });

    it('VERIFIES REMEDIATION 2: addPosition strictly validates notionalUsdt against capital ceiling', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      store.setRunning(true);

      const oversizedPos: any = {
        id: 'oversized_pos',
        symbol: 'BTC',
        notionalUsdt: 5000.00, // 333x larger than $15 limit!
      };

      const added = store.addPosition(oversizedPos);
      expect(added).toBe(false);
      expect(store.getPositionById('oversized_pos')).toBeUndefined();
    });

    it('VERIFIES REMEDIATION 3: getState() returns deep clone preventing in-memory capital tampering', () => {
      const store = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const stateRef = store.getState();

      // Mutating returned object does not modify store private state in memory
      (stateRef.config as any).maxCapitalAllocationUsdt = 99999.00;
      (stateRef.activePositions as any)['memory_injection'] = { id: 'memory_injection', notionalUsdt: 99999 };

      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00); // Immutability preserved
      expect(store.getActivePositions().length).toBe(0); // Injected position blocked
    });
  });
});
