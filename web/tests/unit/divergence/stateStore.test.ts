/**
 * Unit Test Suite: Divergence State Store & In-Flight Intent Journal
 * Target: web/lib/divergence/store/stateStore.ts
 * File: web/tests/unit/divergence/stateStore.test.ts
 * 
 * Verifies:
 * 1. Safe default initialization (isRunning: false, fsmState: 'PAUSED')
 * 2. Hard-locked capital verification (maxConcurrentPositions = 1, maxCapitalAllocationUsdt = 15.00)
 * 3. Windows-compatible atomic file persistence (tmp write, fsync, atomic rename)
 * 4. Windows file lock handling (EPERM / EBUSY catch, 50ms backoff, copyFileSync + unlinkSync fallback)
 * 5. Automated .backup maintenance & boot-time disaster recovery on corruption
 * 6. Pre-dispatch in-flight intent journal CRUD and atomic disk persistence
 * 7. Boot-time crash recovery & dangling intent detection
 * 8. Position lifecycle & telemetry recalculation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  DivergenceStateStore,
  atomicWriteFileSync,
  atomicWriteFile,
  DEFAULT_DIVERGENCE_CONFIG,
  DEFAULT_DIVERGENCE_TELEMETRY,
  _fsHooks,
} from '@/lib/divergence/store/stateStore';
import {
  DivergencePosition,
  DivergenceClosedPosition,
  DivergenceInFlightIntent,
} from '@/lib/divergence/types';

describe('DivergenceStateStore & In-Flight Intent Journal', () => {
  const testDir = path.join(process.cwd(), 'tests', 'sandbox_stateStore');
  const testStateFile = path.join(testDir, 'test_divergence_state.json');
  const testInflightFile = path.join(testDir, 'test_divergence_inflight.json');
  const testBackupFile = `${testStateFile}.backup`;

  const cleanSandbox = () => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  };

  beforeEach(() => {
    cleanSandbox();
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    cleanSandbox();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Group 1: Initialization & Safe Defaults
  // ==========================================================================

  describe('Initialization & Safe Defaults', () => {
    it('initializes clean default state when file does not exist', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const state = store.getState();

      expect(state.version).toBe('1.0.0');
      expect(state.isRunning).toBe(false);
      expect(state.fsmState).toBe('PAUSED');
      expect(state.activePositions).toEqual({});
      expect(state.closedPositions).toEqual([]);
      expect(state.telemetry.activePositionsCount).toBe(0);
      expect(state.telemetry.winRate).toBe(0.0);
    });

    it('enforces capital hard-locks in default configuration', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const config = store.getState().config;

      expect(config.maxConcurrentPositions).toBe(3);
      expect(config.maxPositionsPerSymbol).toBe(1);
      expect(config.maxCapitalAllocationUsdt).toBe(60.00);
      expect(config.orderNotionalUsdt).toBe(15.00);
      expect(config.minDispersion24hPercent).toBe(0.400);
      expect(config.maxLiveCompressionPercent).toBe(0.100);
      expect(config.relativeExpansionTargetPercent).toBe(0.380);
      expect(config.zeroLossNetHurdleUsdt).toBe(0.0100);
      expect(config.adverseStopLossPercent).toBe(-0.150);
    });
  });

  // ==========================================================================
  // Group 2: Atomic Persistence & Windows Lock Handling
  // ==========================================================================

  describe('Atomic Persistence & Windows Lock Handling', () => {
    it('persists state synchronously with .backup file generation', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      store.persistStateSync();

      expect(fs.existsSync(testStateFile)).toBe(true);
      expect(fs.existsSync(testBackupFile)).toBe(true);

      const stateContent = JSON.parse(fs.readFileSync(testStateFile, 'utf-8'));
      const backupContent = JSON.parse(fs.readFileSync(testBackupFile, 'utf-8'));

      expect(stateContent.isRunning).toBe(false);
      expect(stateContent.fsmState).toBe('PAUSED');
      expect(backupContent).toEqual(stateContent);
    });

    it('persists state asynchronously with .backup file generation', async () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      await store.persistState();

      expect(fs.existsSync(testStateFile)).toBe(true);
      expect(fs.existsSync(testBackupFile)).toBe(true);

      const stateContent = JSON.parse(fs.readFileSync(testStateFile, 'utf-8'));
      expect(stateContent.version).toBe('1.0.0');
    });

    it('handles Windows EPERM file lock by waiting 50ms and falling back to copyFileSync', () => {
      let callCount = 0;

      // Mock renameSync on _fsHooks to throw EPERM on first call, simulating Windows antivirus/indexer lock
      vi.spyOn(_fsHooks, 'renameSync').mockImplementation(() => {
        callCount++;
        const err: any = new Error('EPERM: operation not permitted');
        err.code = 'EPERM';
        throw err;
      });

      const copySpy = vi.spyOn(_fsHooks, 'copyFileSync');
      const testContent = JSON.stringify({ test: 'windows_eperm_recovery' });

      // Should not throw, should recover via copyFileSync
      expect(() => {
        atomicWriteFileSync(testStateFile, testContent);
      }).not.toThrow();

      expect(callCount).toBe(1);
      expect(copySpy).toHaveBeenCalled();
      expect(fs.existsSync(testStateFile)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(testStateFile, 'utf-8'));
      expect(parsed.test).toBe('windows_eperm_recovery');
    });

    it('handles Windows EBUSY file lock by waiting 50ms and falling back to copyFileSync', () => {
      vi.spyOn(_fsHooks, 'renameSync').mockImplementation(() => {
        const err: any = new Error('EBUSY: resource busy or locked');
        err.code = 'EBUSY';
        throw err;
      });

      const testContent = JSON.stringify({ test: 'windows_ebusy_recovery' });

      expect(() => {
        atomicWriteFileSync(testStateFile, testContent);
      }).not.toThrow();

      expect(fs.existsSync(testStateFile)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(testStateFile, 'utf-8'));
      expect(parsed.test).toBe('windows_ebusy_recovery');
    });

    it('cleans up temporary files without leaving orphaned .tmp files under normal operation', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      store.persistStateSync();

      const files = fs.readdirSync(testDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles.length).toBe(0);
    });
  });

  // ==========================================================================
  // Group 3: Boot-Time Corruption & Disaster Recovery
  // ==========================================================================

  describe('Boot-Time Corruption Recovery from .backup', () => {
    it('recovers state from .backup when primary file contains corrupted JSON syntax', () => {
      // 1. Create a valid state and backup
      const validState = {
        version: '1.0.0',
        isRunning: true,
        fsmState: 'ACTIVE_EXPANDING',
        config: DEFAULT_DIVERGENCE_CONFIG,
        activePositions: {},
        closedPositions: [],
        telemetry: DEFAULT_DIVERGENCE_TELEMETRY,
        lastUpdated: 1793408000000,
      };
      fs.writeFileSync(testBackupFile, JSON.stringify(validState, null, 2), 'utf-8');

      // 2. Corrupt the primary state file
      fs.writeFileSync(testStateFile, '{ corrupted JSON syntax -- unexpected EOF', 'utf-8');

      // 3. Instantiate store
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const state = store.getState();

      // State should be restored from backup!
      expect(state.isRunning).toBe(true);
      expect(state.fsmState).toBe('ACTIVE_EXPANDING');
      expect(state.lastUpdated).toBe(1793408000000);

      // Primary file should be restored on disk
      const repairedPrimary = JSON.parse(fs.readFileSync(testStateFile, 'utf-8'));
      expect(repairedPrimary.fsmState).toBe('ACTIVE_EXPANDING');
    });

    it('recovers state from .backup when primary file is a 0-byte truncated file', () => {
      const validState = {
        version: '1.0.0',
        isRunning: false,
        fsmState: 'PAUSED',
        config: DEFAULT_DIVERGENCE_CONFIG,
        activePositions: {},
        closedPositions: [],
        telemetry: { ...DEFAULT_DIVERGENCE_TELEMETRY, winRate: 75.0 },
        lastUpdated: 1793408500000,
      };
      fs.writeFileSync(testBackupFile, JSON.stringify(validState, null, 2), 'utf-8');

      // 0-byte truncated primary file
      fs.writeFileSync(testStateFile, '', 'utf-8');

      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const state = store.getState();

      expect(state.telemetry.winRate).toBe(75.0);
      expect(fs.readFileSync(testStateFile, 'utf-8').length).toBeGreaterThan(0);
    });

    it('cleanly initializes default state when both primary and backup files are corrupted', () => {
      fs.writeFileSync(testStateFile, 'bad data', 'utf-8');
      fs.writeFileSync(testBackupFile, 'bad backup', 'utf-8');

      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const state = store.getState();

      expect(state.version).toBe('1.0.0');
      expect(state.fsmState).toBe('PAUSED');
      expect(state.isRunning).toBe(false);
    });
  });

  // ==========================================================================
  // Group 4: Hard-Lock Capital Verification
  // ==========================================================================

  describe('Capital Hard-Lock Verification', () => {
    it('clamps maxConcurrentPositions to 3 on updateConfig attempt', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      store.updateConfig({ maxConcurrentPositions: 5 });

      expect(store.getState().config.maxConcurrentPositions).toBe(3);
    });

    it('clamps maxCapitalAllocationUsdt to 60.00 on updateConfig attempt', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      store.updateConfig({ maxCapitalAllocationUsdt: 100.00 });

      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00);
    });

    it('clamps orderNotionalUsdt to 15.00 on updateConfig attempt', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      store.updateConfig({ orderNotionalUsdt: 25.00 });

      expect(store.getState().config.orderNotionalUsdt).toBe(15.00);
    });

    it('sanitizes tampered file on disk containing excessive capital limits', () => {
      const tamperedState = {
        version: '1.0.0',
        isRunning: false,
        fsmState: 'PAUSED',
        config: {
          ...DEFAULT_DIVERGENCE_CONFIG,
          maxConcurrentPositions: 10,
          maxCapitalAllocationUsdt: 500.00,
          orderNotionalUsdt: 100.00,
        },
        activePositions: {},
        closedPositions: [],
        telemetry: DEFAULT_DIVERGENCE_TELEMETRY,
        lastUpdated: Date.now(),
      };
      fs.writeFileSync(testStateFile, JSON.stringify(tamperedState, null, 2), 'utf-8');

      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const config = store.getState().config;

      expect(config.maxConcurrentPositions).toBe(3);
      expect(config.maxCapitalAllocationUsdt).toBe(60.00);
      expect(config.orderNotionalUsdt).toBe(15.00);
    });

    it('canOpenPosition strictly gates capacity and running state', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      // 1. Blocked when bot is paused / not running
      expect(store.canOpenPosition().allowed).toBe(false);
      expect(store.canOpenPosition().reason).toContain('not running');

      // Start bot
      store.setRunning(true);
      expect(store.canOpenPosition().allowed).toBe(true);

      // 2. Add 1 active position
      const mockPos: DivergencePosition = {
        id: 'div_pos_test_1',
        canonicalSymbol: 'SUI',
        binanceSymbol: 'SUIUSDT',
        bybitSymbol: 'SUIUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: Date.now(),
        entryBasisPercent: 0.040,
        currentBasisPercent: 0.040,
        peakBasisPercent: 0.040,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 2.105,
        entryBybitPrice: 2.104,
        currentBinancePrice: 2.105,
        currentBybitPrice: 2.104,
        quantityBinance: 7.12,
        quantityBybit: 7.12,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0.0,
        estimatedTotalFeesUsdt: 0.039,
        netPnlUsdt: -0.039,
        roiPercent: -0.260,
        holdDurationMinutes: 0.0,
        relativeExpansionPercent: 0.0,
        isHurdleMet: false,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'BN-101',
          clientOrderId: 'div1_101',
          symbol: 'SUIUSDT',
          executedQty: 7.12,
          avgPrice: 2.105,
          feePercent: 0.020,
          feeUsdt: 0.003,
          latencyMs: 12,
          timestamp: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'BYB-101',
          clientOrderId: 'div2_101',
          symbol: 'SUIUSDT',
          executedQty: 7.12,
          avgPrice: 2.104,
          feePercent: 0.055,
          feeUsdt: 0.008,
          latencyMs: 24,
          timestamp: Date.now(),
        },
        executionHash: 'mock_hash',
        stagnancyNominalDeadline: Date.now() + 180 * 60000,
        stagnancyCeilingDeadline: Date.now() + 360 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.0,
        lastUpdated: Date.now(),
      };

      store.addPosition(mockPos);

      // Add 2nd and 3rd positions up to limit 3
      store.addPosition({ ...mockPos, id: 'div_pos_test_2', canonicalSymbol: 'SOL', notionalUsdt: 5.0 });
      store.addPosition({ ...mockPos, id: 'div_pos_test_3', canonicalSymbol: 'NEAR', notionalUsdt: 5.0 });

      // 3. Opening fourth position must be strictly rejected by hard-lock
      const fourthCheck = store.canOpenPosition();
      expect(fourthCheck.allowed).toBe(false);
      expect(fourthCheck.reason).toContain('Max concurrent positions limit reached');

      // Attempting addPosition directly should also be rejected
      const addedFourth = store.addPosition({ ...mockPos, id: 'div_pos_test_4', canonicalSymbol: 'AVAX', notionalUsdt: 5.0 });
      expect(addedFourth).toBe(false);
      expect(Object.keys(store.getState().activePositions).length).toBe(3);
    });
  });

  // ==========================================================================
  // Group 5: Pre-Dispatch In-Flight Intent Journaling
  // ==========================================================================

  describe('Pre-Dispatch In-Flight Intent Journaling', () => {
    it('records pre-dispatch intent to divergence_inflight.json atomically', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      const intent: DivergenceInFlightIntent = {
        intentId: 'div_intent_1793408158_9a2f',
        canonicalSymbol: 'SUI',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'INTENT_PREPARED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        targetNotionalUsdt: 15.00,
        leg1: {
          venue: 'BINANCE',
          symbol: 'SUIUSDT',
          clientOrderId: 'div1_1793408158',
          targetQty: 7.12,
          targetPrice: 2.105,
          filledQty: 0.0,
          avgPrice: 0.0,
          status: 'PENDING',
          updatedAt: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          symbol: 'SUIUSDT',
          clientOrderId: 'div2_1793408158',
          targetQty: 7.12,
          filledQty: 0.0,
          avgPrice: 0.0,
          status: 'PENDING',
          updatedAt: Date.now(),
        },
      };

      store.recordInflightIntent(intent);

      expect(fs.existsSync(testInflightFile)).toBe(true);
      const loaded = store.readInflightIntents();
      expect(loaded.length).toBe(1);
      expect(loaded[0].intentId).toBe('div_intent_1793408158_9a2f');
      expect(loaded[0].status).toBe('INTENT_PREPARED');
    });

    it('updates in-flight intent status and filled quantities', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      const intent: DivergenceInFlightIntent = {
        intentId: 'div_intent_test_2',
        canonicalSymbol: 'ETH',
        direction: 'SHORT_BN_LONG_BYB',
        status: 'LEG1_DISPATCHED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        targetNotionalUsdt: 15.00,
        leg1: {
          venue: 'BINANCE',
          symbol: 'ETHUSDT',
          clientOrderId: 'div1_eth',
          targetQty: 0.005,
          targetPrice: 3000.0,
          filledQty: 0.0,
          avgPrice: 0.0,
          status: 'PENDING',
          updatedAt: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          symbol: 'ETHUSDT',
          clientOrderId: 'div2_eth',
          targetQty: 0.005,
          filledQty: 0.0,
          avgPrice: 0.0,
          status: 'PENDING',
          updatedAt: Date.now(),
        },
      };

      store.recordInflightIntent(intent);

      // Leg 1 filled, update intent
      const updated = store.updateInflightIntent('div_intent_test_2', {
        status: 'LEG1_FILLED',
        leg1: {
          ...intent.leg1,
          filledQty: 0.005,
          avgPrice: 3000.1,
          status: 'FILLED',
          updatedAt: Date.now(),
        },
      });

      expect(updated).toBe(true);

      const reloaded = store.readInflightIntents();
      expect(reloaded[0].status).toBe('LEG1_FILLED');
      expect(reloaded[0].leg1.status).toBe('FILLED');
      expect(reloaded[0].leg1.avgPrice).toBe(3000.1);
    });

    it('clears individual intent or full journal', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      const makeIntent = (id: string): DivergenceInFlightIntent => ({
        intentId: id,
        canonicalSymbol: 'BTC',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'INTENT_PREPARED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        targetNotionalUsdt: 15.00,
        leg1: { venue: 'BINANCE', symbol: 'BTCUSDT', clientOrderId: `div1_${id}`, targetQty: 0.0002, filledQty: 0, avgPrice: 0, status: 'PENDING', updatedAt: Date.now() },
        leg2: { venue: 'BYBIT', symbol: 'BTCUSDT', clientOrderId: `div2_${id}`, targetQty: 0.0002, filledQty: 0, avgPrice: 0, status: 'PENDING', updatedAt: Date.now() },
      });

      store.recordInflightIntent(makeIntent('intent_A'));
      store.recordInflightIntent(makeIntent('intent_B'));

      expect(store.readInflightIntents().length).toBe(2);

      // Clear intent_A
      store.clearInflightIntent('intent_A');
      const afterA = store.readInflightIntents();
      expect(afterA.length).toBe(1);
      expect(afterA[0].intentId).toBe('intent_B');

      // Clear all
      store.clearInflightIntent();
      expect(store.readInflightIntents().length).toBe(0);
    });
  });

  // ==========================================================================
  // Group 6: Boot-Time Crash Recovery & Dangling Intent Detection
  // ==========================================================================

  describe('Boot-Time Crash Recovery & Dangling Intent Detection', () => {
    it('detects dangling unhedged intent on startup and warns', () => {
      const danglingIntent: DivergenceInFlightIntent = {
        intentId: 'div_intent_crash_dangling',
        canonicalSymbol: 'SOL',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'LEG1_FILLED', // Leg 1 filled, process crashed before Leg 2!
        createdAt: Date.now() - 30000,
        updatedAt: Date.now() - 30000,
        targetNotionalUsdt: 15.00,
        leg1: {
          venue: 'BINANCE',
          symbol: 'SOLUSDT',
          clientOrderId: 'div1_sol_crash',
          targetQty: 0.1,
          filledQty: 0.1,
          avgPrice: 150.0,
          status: 'FILLED',
          updatedAt: Date.now() - 30000,
        },
        leg2: {
          venue: 'BYBIT',
          symbol: 'SOLUSDT',
          clientOrderId: 'div2_sol_crash',
          targetQty: 0.1,
          filledQty: 0.0,
          avgPrice: 0.0,
          status: 'PENDING',
          updatedAt: Date.now() - 30000,
        },
      };

      // Write directly to inflight journal file
      fs.writeFileSync(
        testInflightFile,
        JSON.stringify({ version: '1.0.0', intents: [danglingIntent], lastUpdated: Date.now() }, null, 2),
        'utf-8'
      );

      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const dangling = store.checkDanglingIntentsOnStartup();

      expect(dangling.length).toBe(1);
      expect(dangling[0].intentId).toBe('div_intent_crash_dangling');
      expect(dangling[0].status).toBe('LEG1_FILLED');

      // Gating must block any new position dispatch until dangling intent is handled
      store.setRunning(true);
      const gateCheck = store.canOpenPosition();
      expect(gateCheck.allowed).toBe(false);
      expect(gateCheck.reason).toContain('Dangling in-flight intent exists');
    });

    it('returns empty dangling list when all intents are completed or aborted', () => {
      const completedIntent: DivergenceInFlightIntent = {
        intentId: 'div_intent_done',
        canonicalSymbol: 'SOL',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'COMPLETED',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000,
        targetNotionalUsdt: 15.00,
        leg1: { venue: 'BINANCE', symbol: 'SOLUSDT', clientOrderId: 'div1_sol', targetQty: 0.1, filledQty: 0.1, avgPrice: 150.0, status: 'FILLED', updatedAt: Date.now() },
        leg2: { venue: 'BYBIT', symbol: 'SOLUSDT', clientOrderId: 'div2_sol', targetQty: 0.1, filledQty: 0.1, avgPrice: 150.0, status: 'FILLED', updatedAt: Date.now() },
      };

      fs.writeFileSync(
        testInflightFile,
        JSON.stringify({ version: '1.0.0', intents: [completedIntent], lastUpdated: Date.now() }, null, 2),
        'utf-8'
      );

      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const dangling = store.checkDanglingIntentsOnStartup();

      expect(dangling.length).toBe(0);
    });
  });

  // ==========================================================================
  // Group 7: Position CRUD & Telemetry Recalculation
  // ==========================================================================

  describe('Position CRUD & Telemetry Recalculation', () => {
    it('closes position, moves to closed history, and accurately recalculates telemetry', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      store.setRunning(true);

      const mockPos: DivergencePosition = {
        id: 'div_pos_win_1',
        canonicalSymbol: 'SUI',
        binanceSymbol: 'SUIUSDT',
        bybitSymbol: 'SUIUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: Date.now() - 45 * 60000, // 45m hold
        entryBasisPercent: 0.040,
        currentBasisPercent: 0.420,
        peakBasisPercent: 0.420,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 2.100,
        entryBybitPrice: 2.100,
        currentBinancePrice: 2.109,
        currentBybitPrice: 2.100,
        quantityBinance: 7.14,
        quantityBybit: 7.14,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0.064,
        estimatedTotalFeesUsdt: 0.039,
        netPnlUsdt: 0.025,
        roiPercent: 0.166,
        holdDurationMinutes: 45.0,
        relativeExpansionPercent: 0.380,
        isHurdleMet: true,
        leg1: {
          venue: 'BINANCE', side: 'BUY', orderType: 'POST_ONLY_MAKER_GTX', orderId: '1', clientOrderId: 'div1_1', symbol: 'SUIUSDT',
          executedQty: 7.14, avgPrice: 2.100, feePercent: 0.020, feeUsdt: 0.003, latencyMs: 10, timestamp: Date.now() - 45 * 60000,
        },
        leg2: {
          venue: 'BYBIT', side: 'SELL', orderType: 'WS_IOC_TAKER', orderId: '2', clientOrderId: 'div2_1', symbol: 'SUIUSDT',
          executedQty: 7.14, avgPrice: 2.100, feePercent: 0.055, feeUsdt: 0.008, latencyMs: 25, timestamp: Date.now() - 45 * 60000,
        },
        executionHash: 'hash',
        stagnancyNominalDeadline: Date.now() + 135 * 60000,
        stagnancyCeilingDeadline: Date.now() + 315 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.0,
        lastUpdated: Date.now(),
      };

      store.addPosition(mockPos);
      expect(store.getActivePositions().length).toBe(1);

      // Close position with net profit +$0.0250 USDT
      const closed = store.closePosition('div_pos_win_1', {
        exitReason: 'EXPANSION_TP',
        netRealizedPnlUsdt: 0.0250,
        actualFeesUsdt: 0.0390,
        realizedRoiPercent: 0.166,
        finalRelativeExpansionPercent: 0.380,
      });

      expect(closed).not.toBeNull();
      expect(closed?.status).toBe('CLOSED');
      expect(store.getActivePositions().length).toBe(0);
      expect(store.getClosedPositions().length).toBe(1);

      const telemetry = store.getState().telemetry;
      expect(telemetry.activePositionsCount).toBe(0);
      expect(telemetry.closedPositionsCount).toBe(1);
      expect(telemetry.totalRealizedNetPnlUsdt).toBe(0.0250);
      expect(telemetry.totalRoundtripFeesUsdt).toBe(0.0390);
      expect(telemetry.winRate).toBe(100.0);
      expect(telemetry.profitFactor).toBe(99.99);
      expect(telemetry.averageHoldDurationMinutes).toBeCloseTo(45.0, 1);
    });
  });
});
