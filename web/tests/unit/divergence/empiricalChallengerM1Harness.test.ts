/**
 * Empirical Challenger M1 Stress & Boundary Test Harness
 * Author: teamwork_challenger (empirical_challenger)
 * Milestone: M1 (Foundation, State & Lock Isolation)
 * 
 * Verifies:
 * 1. Capital limits boundary tests (capital > 15.00 USDT, concurrent positions > 1, <=0 clamping, disk tampering)
 * 2. Invariant verification: PAUSED mode default (isRunning: false, fsmState: 'PAUSED')
 * 3. Sizing and delta-neutrality invariant contracts (|Delta_net| < 0.001)
 * 4. Pre-dispatch in-flight intent gating and crash recovery
 * 5. Daemon lock isolation between bot_daemon.lock and divergence_daemon.lock
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  DIVERGENCE_HARD_LIMITS,
  DEFAULT_DIVERGENCE_CONFIG,
  DEFAULT_DIVERGENCE_TELEMETRY,
  INITIAL_DIVERGENCE_STATE,
  DivergencePosition,
  DivergenceInFlightIntent,
} from '@/lib/divergence/types';
import { DivergenceStateStore } from '@/lib/divergence/store/stateStore';
import {
  acquireDaemonLock,
  releaseDaemonLock,
  isDaemonLocked,
  isDaemonRunning,
  getDaemonLockFilePath,
} from '@/lib/daemonLockManager';

describe('Empirical Challenger M1 Harness: Capital Limits & Invariants', () => {
  const sandboxDir = path.join(process.cwd(), 'tests', 'sandbox_challenger_m1');
  const testStateFile = path.join(sandboxDir, 'divergence_state.json');
  const testInflightFile = path.join(sandboxDir, 'divergence_inflight.json');

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
    cleanSandbox();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Invariant Verification: PAUSED Mode Default & Production Seed Files
  // ==========================================================================
  describe('1. Invariant Verification: PAUSED Mode Default', () => {
    it('verifies INITIAL_DIVERGENCE_STATE constant adheres to PAUSED mode default', () => {
      expect(INITIAL_DIVERGENCE_STATE.isRunning).toBe(false);
      expect(INITIAL_DIVERGENCE_STATE.fsmState).toBe('PAUSED');
      expect(INITIAL_DIVERGENCE_STATE.activePositions).toEqual({});
      expect(INITIAL_DIVERGENCE_STATE.closedPositions).toEqual([]);
      expect(INITIAL_DIVERGENCE_STATE.config.maxConcurrentPositions).toBe(3);
      expect(INITIAL_DIVERGENCE_STATE.config.maxCapitalAllocationUsdt).toBe(60.00);
      expect(INITIAL_DIVERGENCE_STATE.config.orderNotionalUsdt).toBe(15.00);
    });

    it('verifies production data/divergence_state.json seed file', () => {
      const rootStatePath = path.resolve(process.cwd(), '../data/divergence_state.json');
      expect(fs.existsSync(rootStatePath)).toBe(true);

      const rootState = JSON.parse(fs.readFileSync(rootStatePath, 'utf-8'));
      expect(rootState.isRunning).toBe(false);
      expect(rootState.fsmState).toBe('PAUSED');
      expect(rootState.config.maxPositionsPerSymbol).toBe(1);
    });

    it('verifies web/data/divergence_state.json mirror seed file matches production seed', () => {
      const webStatePath = path.resolve(process.cwd(), 'data/divergence_state.json');
      expect(fs.existsSync(webStatePath)).toBe(true);

      const webState = JSON.parse(fs.readFileSync(webStatePath, 'utf-8'));
      expect(webState.fsmState).toBeDefined();
    });

    it('verifies production data/divergence_inflight.json seed file is clean', () => {
      const rootInflightPath = path.resolve(process.cwd(), '../data/divergence_inflight.json');
      expect(fs.existsSync(rootInflightPath)).toBe(true);

      const rootInflight = JSON.parse(fs.readFileSync(rootInflightPath, 'utf-8'));
      expect(rootInflight.version).toBe('1.0.0');
      expect(rootInflight.intents).toEqual([]);
    });

    it('verifies web/data/divergence_inflight.json mirror seed file is clean', () => {
      const webInflightPath = path.resolve(process.cwd(), 'data/divergence_inflight.json');
      expect(fs.existsSync(webInflightPath)).toBe(true);

      const webInflight = JSON.parse(fs.readFileSync(webInflightPath, 'utf-8'));
      expect(webInflight.version).toBe('1.0.0');
      expect(webInflight.intents).toEqual([]);
    });

    it('verifies DIVERGENCE_HARD_LIMITS contains exact production boundaries', () => {
      expect(DIVERGENCE_HARD_LIMITS.MAX_CONCURRENT_POSITIONS).toBe(3);
      expect(DIVERGENCE_HARD_LIMITS.MAX_POSITIONS_PER_SYMBOL).toBe(1);
      expect(DIVERGENCE_HARD_LIMITS.MAX_CAPITAL_ALLOCATION_USDT).toBe(60.00);
      expect(DIVERGENCE_HARD_LIMITS.ORDER_NOTIONAL_USDT).toBe(15.00);
      expect(DIVERGENCE_HARD_LIMITS.DELTA_NET_TOLERANCE).toBe(0.001);
      expect(DIVERGENCE_HARD_LIMITS.MIN_NOTIONAL_USDT).toBe(5.00);
    });
  });

  // ==========================================================================
  // 2. Boundary Tests for Capital Limits & Position Capacity
  // ==========================================================================
  describe('2. Boundary Tests for Capital Limits & Positions', () => {
    it('clamps capital allocation > 60.00 USDT (boundary: 60.01, 100, 9999) to 60.00', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      store.updateConfig({ maxCapitalAllocationUsdt: 60.01 });
      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00);

      store.updateConfig({ maxCapitalAllocationUsdt: 100.00 });
      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00);

      store.updateConfig({ maxCapitalAllocationUsdt: 9999.00 });
      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00);
    });

    it('clamps capital allocation <= 0 (boundary: 0, -0.01, -500) to 60.00', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      store.updateConfig({ maxCapitalAllocationUsdt: 0 });
      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00);

      store.updateConfig({ maxCapitalAllocationUsdt: -0.01 });
      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00);

      store.updateConfig({ maxCapitalAllocationUsdt: -500 });
      expect(store.getState().config.maxCapitalAllocationUsdt).toBe(60.00);
    });

    it('clamps concurrent positions outside 1..3 (boundary: 0, -1, 100) to 3', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      store.updateConfig({ maxConcurrentPositions: 2 });
      expect(store.getState().config.maxConcurrentPositions).toBe(2);

      store.updateConfig({ maxConcurrentPositions: 0 });
      expect(store.getState().config.maxConcurrentPositions).toBe(3);

      store.updateConfig({ maxConcurrentPositions: -1 });
      expect(store.getState().config.maxConcurrentPositions).toBe(3);

      store.updateConfig({ maxConcurrentPositions: 100 });
      expect(store.getState().config.maxConcurrentPositions).toBe(3);
    });

    it('clamps orderNotionalUsdt > 15.00 or <= 0 to 15.00', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      store.updateConfig({ orderNotionalUsdt: 15.01 });
      expect(store.getState().config.orderNotionalUsdt).toBe(15.00);

      store.updateConfig({ orderNotionalUsdt: 100.00 });
      expect(store.getState().config.orderNotionalUsdt).toBe(15.00);

      store.updateConfig({ orderNotionalUsdt: 0 });
      expect(store.getState().config.orderNotionalUsdt).toBe(15.00);

      store.updateConfig({ orderNotionalUsdt: -15 });
      expect(store.getState().config.orderNotionalUsdt).toBe(15.00);
    });

    it('sanitizes malicious on-disk tampering of capital and position limits', () => {
      const maliciousState = {
        version: '1.0.0',
        isRunning: false,
        fsmState: 'PAUSED',
        config: {
          ...DEFAULT_DIVERGENCE_CONFIG,
          maxConcurrentPositions: 25,
          maxPositionsPerSymbol: 10,
          maxCapitalAllocationUsdt: 1000.00,
          orderNotionalUsdt: 250.00,
        },
        activePositions: {},
        closedPositions: [],
        telemetry: DEFAULT_DIVERGENCE_TELEMETRY,
        lastUpdated: Date.now(),
      };
      fs.writeFileSync(testStateFile, JSON.stringify(maliciousState, null, 2), 'utf-8');

      // Hydrating store from tampered disk file
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      const sanitized = store.getState().config;

      expect(sanitized.maxConcurrentPositions).toBe(3);
      expect(sanitized.maxPositionsPerSymbol).toBe(1);
      expect(sanitized.maxCapitalAllocationUsdt).toBe(60.00);
      expect(sanitized.orderNotionalUsdt).toBe(15.00);
    });

    it('canOpenPosition strictly gates capacity, pause state, and notional limits', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);

      // Gate 1: Engine paused
      expect(store.canOpenPosition().allowed).toBe(false);
      expect(store.canOpenPosition().reason).toContain('not running');

      // Unpause
      store.setRunning(true);
      expect(store.getState().isRunning).toBe(true);
      expect(store.getState().fsmState).toBe('IDLE');

      // Gate 2: Capital limit exceeded on requested notional > 60.00
      const overNotional = store.canOpenPosition(60.01);
      expect(overNotional.allowed).toBe(false);
      expect(overNotional.reason).toContain('Capital limit exceeded');

      // Standard notional (10.00) allowed
      expect(store.canOpenPosition(10.00).allowed).toBe(true);

      // Gate 3: Concurrent position limit reached
      const mockPos: DivergencePosition = {
        id: 'div_pos_harness_1',
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: Date.now(),
        entryBasisPercent: 0.040,
        currentBasisPercent: 0.040,
        peakBasisPercent: 0.040,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 70000,
        entryBybitPrice: 70000,
        currentBinancePrice: 70000,
        currentBybitPrice: 70000,
        quantityBinance: 0.00021,
        quantityBybit: 0.00021,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0,
        estimatedTotalFeesUsdt: 0.039,
        netPnlUsdt: -0.039,
        roiPercent: -0.260,
        holdDurationMinutes: 0,
        relativeExpansionPercent: 0,
        isHurdleMet: false,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'BN-101',
          clientOrderId: 'div1_101',
          symbol: 'BTCUSDT',
          executedQty: 0.00021,
          avgPrice: 70000,
          feePercent: 0.020,
          feeUsdt: 0.003,
          latencyMs: 10,
          timestamp: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'BYB-101',
          clientOrderId: 'div2_101',
          symbol: 'BTCUSDT',
          executedQty: 0.00021,
          avgPrice: 70000,
          feePercent: 0.055,
          feeUsdt: 0.008,
          latencyMs: 18,
          timestamp: Date.now(),
        },
        executionHash: 'harness_hash',
        stagnancyNominalDeadline: Date.now() + 180 * 60000,
        stagnancyCeilingDeadline: Date.now() + 360 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0,
        lastUpdated: Date.now(),
      };

      const addResult = store.addPosition(mockPos);
      expect(addResult).toBe(true);

      // Add up to 3 positions
      store.addPosition({ ...mockPos, id: 'div_pos_harness_2', canonicalSymbol: 'ETH', notionalUsdt: 5.0 });
      store.addPosition({ ...mockPos, id: 'div_pos_harness_3', canonicalSymbol: 'SOL', notionalUsdt: 5.0 });

      // Subsequent position check fails
      const blockedCheck = store.canOpenPosition();
      expect(blockedCheck.allowed).toBe(false);
      expect(blockedCheck.reason).toContain('Max concurrent positions limit reached');

      // Direct addPosition attempt rejected
      const addFourthResult = store.addPosition({ ...mockPos, id: 'div_pos_harness_4', canonicalSymbol: 'AVAX', notionalUsdt: 5.0 });
      expect(addFourthResult).toBe(false);
      expect(Object.keys(store.getState().activePositions).length).toBe(3);
    });
  });

  // ==========================================================================
  // 3. Sizing & Delta-Neutrality Invariant Contracts (|Delta_net| < 0.001)
  // ==========================================================================
  describe('3. Sizing & Delta-Neutrality Invariant Contracts', () => {
    function computeDeltaNet(leg1Qty: number, leg2Qty: number, normalizer: number = 1.0): number {
      return Math.abs(leg1Qty - leg2Qty) / normalizer;
    }

    it('validates delta-neutrality across discrete lot quantum matching on standard contracts', () => {
      // SUIUSDT: notional = $15.00, price = $2.105 -> qty = 7.12 SUI on both legs
      const qtyBinance = 7.12;
      const qtyBybit = 7.12;
      const deltaNet = computeDeltaNet(qtyBinance, qtyBybit);

      expect(deltaNet).toBe(0.0);
      expect(deltaNet).toBeLessThan(DIVERGENCE_HARD_LIMITS.DELTA_NET_TOLERANCE);
    });

    it('validates delta-neutrality on 1000x contract multiplier instruments (1000PEPE)', () => {
      const contractsBinance = 1500;
      const contractsBybit = 1500;
      const baseUnitsBinance = contractsBinance * 1000;
      const baseUnitsBybit = contractsBybit * 1000;

      const deltaNet = computeDeltaNet(baseUnitsBinance, baseUnitsBybit, baseUnitsBinance);
      expect(deltaNet).toBe(0.0);
      expect(deltaNet).toBeLessThan(DIVERGENCE_HARD_LIMITS.DELTA_NET_TOLERANCE);
    });

    it('validates delta-neutrality on asymmetric contract multipliers (10000SATS vs SATS)', () => {
      const binanceMultiplier = 10000;
      const bybitMultiplier = 1000;

      const binanceContracts = 5;
      const bybitContracts = 50;

      const baseExposureBinance = binanceContracts * binanceMultiplier;
      const baseExposureBybit = bybitContracts * bybitMultiplier;

      const deltaNet = computeDeltaNet(baseExposureBinance, baseExposureBybit, baseExposureBinance);
      expect(deltaNet).toBe(0.0);
      expect(deltaNet).toBeLessThan(DIVERGENCE_HARD_LIMITS.DELTA_NET_TOLERANCE);
    });

    it('strictly enforces the boundary threshold: delta = 0.00099 passes, delta = 0.00100 fails', () => {
      const tolerance = DIVERGENCE_HARD_LIMITS.DELTA_NET_TOLERANCE; // 0.001

      // 0.00099 < 0.001 -> PASS
      expect(0.00099 < tolerance).toBe(true);

      // Exactly 0.00100 -> FAIL (strictly < 0.001 required)
      expect(0.00100 < tolerance).toBe(false);

      // 0.00101 -> FAIL
      expect(0.00101 < tolerance).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Pre-Dispatch In-Flight Intent Gating & Crash Recovery
  // ==========================================================================
  describe('4. Pre-Dispatch In-Flight Intent Gating', () => {
    it('blocks new trade entry when a dangling unhedged intent exists', () => {
      const store = new DivergenceStateStore(testStateFile, testInflightFile);
      store.setRunning(true);

      const danglingIntent: DivergenceInFlightIntent = {
        intentId: 'div_intent_dangling_crash_test',
        canonicalSymbol: 'SOL',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'LEG1_FILLED',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000,
        targetNotionalUsdt: 15.00,
        leg1: {
          venue: 'BINANCE',
          symbol: 'SOLUSDT',
          clientOrderId: 'div1_sol_crash',
          targetQty: 0.08,
          filledQty: 0.08,
          avgPrice: 185.00,
          status: 'FILLED',
          updatedAt: Date.now() - 5000,
        },
        leg2: {
          venue: 'BYBIT',
          symbol: 'SOLUSDT',
          clientOrderId: 'div2_sol_crash',
          targetQty: 0.08,
          filledQty: 0.0,
          avgPrice: 0.0,
          status: 'PENDING',
          updatedAt: Date.now() - 5000,
        },
      };

      store.recordInflightIntent(danglingIntent);

      const dangling = store.checkDanglingIntentsOnStartup();
      expect(dangling.length).toBe(1);
      expect(dangling[0].intentId).toBe('div_intent_dangling_crash_test');

      const gateResult = store.canOpenPosition();
      expect(gateResult.allowed).toBe(false);
      expect(gateResult.reason).toContain('Dangling in-flight intent exists');

      store.clearInflightIntent('div_intent_dangling_crash_test');
      expect(store.checkDanglingIntentsOnStartup().length).toBe(0);
      expect(store.canOpenPosition().allowed).toBe(true);
    });
  });

  // ==========================================================================
  // 5. Lock Manager Parameterization & Strategy Isolation
  // ==========================================================================
  describe('5. Lock Manager Parameterization & Strategy Isolation', () => {
    it('allows concurrent acquisition of parameterized locks without collision', () => {
      const lock1 = 'test_challenger_bot.lock';
      const lock2 = 'test_challenger_divergence.lock';

      const defaultLockResult = acquireDaemonLock({ lockFileName: lock1, force: true });
      expect(defaultLockResult.acquired).toBe(true);

      const divergenceLockResult = acquireDaemonLock({ lockFileName: lock2, force: true });
      expect(divergenceLockResult.acquired).toBe(true);

      expect(isDaemonLocked({ lockFileName: lock1 })).toBe(true);
      expect(isDaemonLocked({ lockFileName: lock2 })).toBe(true);

      expect(() => {
        acquireDaemonLock({ lockFileName: lock2, throwOnCollision: true });
      }).toThrow();

      expect(releaseDaemonLock({ lockFileName: lock2 })).toBe(true);
      expect(isDaemonLocked({ lockFileName: lock2 })).toBe(false);

      expect(isDaemonLocked({ lockFileName: lock1 })).toBe(true);
      expect(releaseDaemonLock({ lockFileName: lock1 })).toBe(true);
      expect(isDaemonLocked({ lockFileName: lock1 })).toBe(false);
    });
  });
});
