/**
 * Unit Test Suite: Standalone Autonomous Arbitrage Engine
 * Target: web/lib/statarb/engine/statArbEngine.ts
 * 
 * Verifies:
 * - Engine lifecycle: start(), stop(), emergencyKill()
 * - Isolated atomic state persistence (statarb_state.json) without legacy bot dependencies
 * - Scanning loop with Invariant 7 sticky decoupling screening and multi-condition gating
 * - Position management loop with Invariant 6 persistence breaker and zero-loss exit enforcement
 * - System safety and concurrent position capacity limits
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { StatArbEngine } from '@/lib/statarb/engine/statArbEngine';
import { StatArbStateStore } from '@/lib/statarb/engine/statArbStateStore';
import { MakerTakerOrderRouter } from '@/lib/statarb/execution/orderRouter';
import { StatArbPair, StatArbPosition } from '@/lib/statarb/types';
import { MockExchangeExecutionAdapter } from './fixtures/orderRouterFixtures';
import {
  CONTINUOUS_DIVERGENCE_30M,
  INVARIANT_7_REJECTED_HISTORY,
  INVARIANT_7_ACCEPTED_HISTORY,
} from './fixtures/invariantFixtures';

describe('Standalone StatArbEngine Unit Tests (statArbEngine.ts)', () => {
  const testStateFile = path.join(process.cwd(), 'tests', 'unit', 'statarb', 'temp_test_state.json');
  let store: StatArbStateStore;
  let adapter: MockExchangeExecutionAdapter;
  let router: MakerTakerOrderRouter;
  let engine: StatArbEngine;

  const cleanupTempFiles = () => {
    try {
      const dir = path.dirname(testStateFile);
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          if (file.startsWith('temp_test_state.json')) {
            try {
              fs.unlinkSync(path.join(dir, file));
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }
  };

  beforeEach(() => {
    cleanupTempFiles();
    store = new StatArbStateStore(testStateFile);
    adapter = new MockExchangeExecutionAdapter();
    router = new MakerTakerOrderRouter(adapter);
    engine = new StatArbEngine(store, router);
  });

  afterEach(() => {
    engine.stop();
    cleanupTempFiles();
  });

  // =========================================================================
  // 1. ENGINE LIFECYCLE (START, STOP, EMERGENCY KILL-SWITCH)
  // =========================================================================
  describe('Engine Lifecycle & Safety Controls', () => {
    it('initializes with expected default standalone state', () => {
      const state = engine.getState();
      expect(state.config.enabled).toBe(true);
      expect(state.isKillSwitchEngaged).toBe(false);
      expect(state.positions).toHaveLength(0);
      expect(engine.isEngineRunning()).toBe(false);
    });

    it('starts and stops cleanly', () => {
      engine.start();
      expect(engine.isEngineRunning()).toBe(true);
      expect(engine.getState().config.enabled).toBe(true);

      engine.stop();
      expect(engine.isEngineRunning()).toBe(false);
      expect(engine.getState().config.enabled).toBe(false);
    });

    it('triggers emergencyKill: stops engine, engages kill switch, and unwinds all active positions', async () => {
      engine.start();

      // Seed store with an active position
      const mockPos: StatArbPosition = {
        id: 'pos_btc_01',
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        status: 'OPEN',
        entryTimestamp: Date.now() - 10000,
        entryBasisBps: 32.0,
        entryBinancePrice: 60000.0,
        entryBybitPrice: 59808.0,
        quantity: 0.002,
        notionalUsdt: 120.0,
        currentBasisBps: 32.0,
        currentBinancePrice: 60000.0,
        currentBybitPrice: 59808.0,
        currentZScore: 2.3,
        realizedPnlUsdt: 0.0,
        unrealizedPnlUsdt: 0.0,
        totalFeesUsdt: 0.015,
        netPnlUsdt: 0.0,
        holdDurationMinutes: 0.16,
        divergenceHistory30m: [0.32],
      };
      store.addPosition(mockPos);

      expect(store.getActivePositions()).toHaveLength(1);

      // Trigger emergency kill
      const closed = await engine.emergencyKill();

      expect(engine.isEngineRunning()).toBe(false);
      expect(engine.getState().isKillSwitchEngaged).toBe(true);
      expect(closed).toHaveLength(1);
      expect(closed[0].status).toBe('CLOSED');
      expect(closed[0].exitReason).toBe('EMERGENCY_KILL_SWITCH_UNWIND');
      expect(store.getActivePositions()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. ISOLATED STATE PERSISTENCE & ATOMIC WRITES
  // =========================================================================
  describe('Isolated State Persistence', () => {
    it('persists positions and configuration atomically to disk without legacy bot interference', () => {
      engine.updateConfig({ maxConcurrentPositions: 8 });
      store.persistStateSync();

      // State file should exist and have valid JSON
      expect(fs.existsSync(testStateFile)).toBe(true);
      const raw = fs.readFileSync(testStateFile, 'utf-8');
      const parsed = JSON.parse(raw);

      expect(parsed.config.maxConcurrentPositions).toBe(8);
      expect(parsed.config.exitConvergenceCompression).toBe(0.75);
      expect(parsed.config.minNetProfitUsdt).toBe(0.01);
    });

    it('hydrates stored state correctly upon instantiating a new store from the same file', () => {
      store.updateConfig({ orderNotionalUsdt: 25.0 });
      store.persistStateSync();

      const newStore = new StatArbStateStore(testStateFile);
      expect(newStore.getState().config.orderNotionalUsdt).toBe(25.0);
    });
  });

  // =========================================================================
  // 3. CORRIDOR SCANNING & INVARIANT 7 SCREENING
  // =========================================================================
  describe('Corridor Scanning & Pre-Flight Gating', () => {
    const validQualifyingPair: StatArbPair = {
      canonicalSymbol: 'ETH',
      binanceSymbol: 'ETHUSDT',
      bybitSymbol: 'ETHUSDT',
      multiplier: 1.0,
      binanceMid: 3000.0,
      bybitMid: 2990.0,
      grossBasisBps: 33.44, // ((3000 - 2990) / 2990) * 10000 = +33.44 bps >= 28.0 bps
      orderBookDepthRatio: 5.0, // >= 4.0x
      binanceSpreadBps: 3.0, // <= 8.0 bps
      bybitSpreadBps: 3.5, // <= 8.0 bps
      lastUpdated: Date.now(),
    };

    it('REJECTS candidate corridor when Invariant 7 detects sticky decoupling (min divergence >= 1.0%)', async () => {
      engine.start();

      const rollingHistoryMap = new Map<string, number[]>();
      rollingHistoryMap.set('ETH', INVARIANT_7_REJECTED_HISTORY); // min divergence = 1.04%

      const scanResult = await engine.scanCorridors([validQualifyingPair], rollingHistoryMap);

      expect(scanResult.qualifyingSignals).toHaveLength(0);
      expect(scanResult.executedPositions).toHaveLength(0);
      expect(scanResult.rejectedReasons['ETH']).toBeDefined();
      expect(scanResult.rejectedReasons['ETH'][0]).toContain('INVARIANT_7_STICKY_DECOUPLING_REJECTED');
    });

    it('ACCEPTS candidate corridor and executes entry when Invariant 7 passes (min divergence 0.45%)', async () => {
      engine.start();

      const rollingHistoryMap = new Map<string, number[]>();
      rollingHistoryMap.set('ETH', INVARIANT_7_ACCEPTED_HISTORY); // min divergence = 0.45% < 1.0%

      const scanResult = await engine.scanCorridors([validQualifyingPair], rollingHistoryMap);

      expect(scanResult.qualifyingSignals).toHaveLength(1);
      expect(scanResult.executedPositions).toHaveLength(1);
      const executed = scanResult.executedPositions[0];
      expect(executed.canonicalSymbol).toBe('ETH');
      expect(executed.direction).toBe('SHORT_BINANCE_LONG_BYBIT');
      expect(executed.status).toBe('OPEN');
      expect(store.getActivePositions()).toHaveLength(1);
    });

    it('REJECTS candidate when gross basis is below hurdle (< 28.0 bps)', async () => {
      engine.start();

      const lowBasisPair: StatArbPair = {
        ...validQualifyingPair,
        canonicalSymbol: 'SOL',
        grossBasisBps: 18.0, // < 28.0 bps hurdle
      };

      const scanResult = await engine.scanCorridors([lowBasisPair]);

      expect(scanResult.qualifyingSignals).toHaveLength(0);
      const reasons = scanResult.rejectedReasons['SOL'] || [];
      expect(reasons.some((r) => r.includes('Gross Basis') || r.includes('Gross basis') || r.includes('28'))).toBe(true);
    });

    it('respects max concurrent positions capacity limits', async () => {
      engine.start();
      engine.updateConfig({ maxConcurrentPositions: 1 });

      // First pair executes
      await engine.scanCorridors([validQualifyingPair]);
      expect(store.getActivePositions()).toHaveLength(1);

      // Second pair should be rejected due to capacity
      const secondPair: StatArbPair = {
        ...validQualifyingPair,
        canonicalSymbol: 'AVAX',
      };
      const result2 = await engine.scanCorridors([secondPair]);
      expect(result2.executedPositions).toHaveLength(0);
      expect(store.getActivePositions()).toHaveLength(1);
    });
  });

  // =========================================================================
  // 4. POSITION MANAGEMENT LOOP & INVARIANT 6 BREAKER
  // =========================================================================
  describe('Active Position Management Loop', () => {
    it('closes position via PROFITABLE_CONVERGENCE_EXIT when basis compresses >= 75% and Net PnL >= +$0.01', async () => {
      // Seed an active position entered at 32.0 bps
      const position: StatArbPosition = {
        id: 'pos_conv_01',
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        status: 'OPEN',
        entryTimestamp: Date.now() - 15 * 60 * 1000,
        entryBasisBps: 32.0,
        entryBinancePrice: 50000.0,
        entryBybitPrice: 49840.0,
        quantity: 0.002, // $100 notional
        notionalUsdt: 100.0,
        currentBasisBps: 32.0,
        currentBinancePrice: 50000.0,
        currentBybitPrice: 49840.0,
        currentZScore: 2.4,
        realizedPnlUsdt: 0.0,
        unrealizedPnlUsdt: 0.0,
        totalFeesUsdt: 0.015,
        netPnlUsdt: 0.0,
        holdDurationMinutes: 15.0,
        divergenceHistory30m: [0.32, 0.25, 0.15],
      };
      store.addPosition(position);

      // Market prices: basis compresses down to 6.0 bps (81.25% compression)
      // Binance = 49,920, Bybit = 49,890 -> ((49920 - 49890) / 49890) * 10000 = 6.01 bps
      const marketData = new Map<string, { binancePrice: number; bybitPrice: number }>();
      marketData.set('BTC', { binancePrice: 49920.0, bybitPrice: 49890.0 });

      const zScoreMap = new Map<string, number>();
      zScoreMap.set('BTC', 0.20); // |z| <= 0.35

      const result = await engine.managePositions(marketData, zScoreMap);

      expect(result.closedPositions).toHaveLength(1);
      const closed = result.closedPositions[0];
      expect(closed.status).toBe('CLOSED');
      expect(closed.exitReason).toBe('PROFITABLE_CONVERGENCE_EXIT');
      expect(closed.netPnlUsdt).toBeGreaterThanOrEqual(0.01);
      expect(store.getActivePositions()).toHaveLength(0);
    });

    it('triggers Invariant 6 Persistence Breaker to liquidate decoupled depeg even if net PnL is negative', async () => {
      // Seed a position held for 32 minutes with continuous divergence >= 1.0%
      const position: StatArbPosition = {
        id: 'pos_depeg_01',
        canonicalSymbol: 'DEPEG_COIN',
        binanceSymbol: 'DEPEGUSDT',
        bybitSymbol: 'DEPEGUSDT',
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        status: 'OPEN',
        entryTimestamp: Date.now() - 32 * 60 * 1000, // 32 minutes ago
        entryBasisBps: 110.0,
        entryBinancePrice: 10.0,
        entryBybitPrice: 9.89,
        quantity: 10.0,
        notionalUsdt: 100.0,
        currentBasisBps: 120.0,
        currentBinancePrice: 10.0,
        currentBybitPrice: 9.88,
        currentZScore: 2.8,
        realizedPnlUsdt: 0.0,
        unrealizedPnlUsdt: -0.05,
        totalFeesUsdt: 0.015,
        netPnlUsdt: -0.065,
        holdDurationMinutes: 32.0,
        divergenceHistory30m: CONTINUOUS_DIVERGENCE_30M, // 30m continuously >= 1.0%
      };
      store.addPosition(position);

      const marketData = new Map<string, { binancePrice: number; bybitPrice: number }>();
      marketData.set('DEPEG_COIN', { binancePrice: 10.0, bybitPrice: 9.88 });

      const result = await engine.managePositions(marketData);

      expect(result.closedPositions).toHaveLength(1);
      const closed = result.closedPositions[0];
      expect(closed.status).toBe('CLOSED');
      expect(closed.exitReason).toBe('STRUCTURAL_BASIS_DECOUPLING');
      expect(store.getActivePositions()).toHaveLength(0);
    });

    it('HOLDS position when compression target is met but Net PnL < +$0.01', async () => {
      // Small entry position with high fee hurdle relative to spread
      const position: StatArbPosition = {
        id: 'pos_low_spread_01',
        canonicalSymbol: 'SMALL_BASIS',
        binanceSymbol: 'SBUSDT',
        bybitSymbol: 'SBUSDT',
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        status: 'OPEN',
        entryTimestamp: Date.now() - 5 * 60 * 1000,
        entryBasisBps: 12.0,
        entryBinancePrice: 100.0,
        entryBybitPrice: 99.88,
        quantity: 0.2, // $20 notional
        notionalUsdt: 20.0,
        currentBasisBps: 12.0,
        currentBinancePrice: 100.0,
        currentBybitPrice: 99.88,
        currentZScore: 1.5,
        realizedPnlUsdt: 0.0,
        unrealizedPnlUsdt: 0.0,
        totalFeesUsdt: 0.015,
        netPnlUsdt: -0.015,
        holdDurationMinutes: 5.0,
        divergenceHistory30m: [0.12, 0.10],
      };
      store.addPosition(position);

      // Spread compresses 75% down to 3.0 bps, but net profit after fees is still < +$0.01
      const marketData = new Map<string, { binancePrice: number; bybitPrice: number }>();
      marketData.set('SMALL_BASIS', { binancePrice: 100.0, bybitPrice: 99.97 }); // 3 bps

      const result = await engine.managePositions(marketData);

      // Must remain open (held for carry parity)
      expect(result.closedPositions).toHaveLength(0);
      expect(store.getActivePositions()).toHaveLength(1);
    });

    it('strictly caps max live running orders to 4 and blocks 5th entry', async () => {
      // Add 4 active positions
      for (let i = 1; i <= 4; i++) {
        store.addPosition({
          id: `pos_fill_${i}`,
          canonicalSymbol: `COIN_${i}`,
          binanceSymbol: `COIN_${i}USDT`,
          bybitSymbol: `COIN_${i}USDT`,
          direction: 'SHORT_BINANCE_LONG_BYBIT',
          status: 'OPEN',
          entryTimestamp: Date.now(),
          entryBasisBps: 30.0,
          entryBinancePrice: 10.0,
          entryBybitPrice: 9.97,
          quantity: 1.5,
          notionalUsdt: 15.0,
          currentBasisBps: 30.0,
          currentBinancePrice: 10.0,
          currentBybitPrice: 9.97,
          currentZScore: 2.5,
          realizedPnlUsdt: 0,
          unrealizedPnlUsdt: 0,
          totalFeesUsdt: 0.015,
          netPnlUsdt: 0,
          holdDurationMinutes: 1,
          divergenceHistory30m: [],
        });
      }

      const pairCandidate: StatArbPair = {
        canonicalSymbol: 'NEW_COIN',
        binanceSymbol: 'NEW_COINUSDT',
        bybitSymbol: 'NEW_COINUSDT',
        multiplier: 1.0,
        binanceMid: 10.0,
        bybitMid: 9.97,
        grossBasisBps: 30.1,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 4.0,
        bybitSpreadBps: 4.0,
        lastUpdated: Date.now(),
      };

      const scanResult = await engine.scanCorridors([pairCandidate], new Map(), new Map());
      expect(scanResult.executedPositions).toHaveLength(0);
      expect(scanResult.rejectedReasons.SYSTEM?.[0]).toContain('4/4 active slots full');
    });

    it('strictly caps max repeated trades on the same symbol to 2 and blocks 3rd entry', async () => {
      // Add 2 active positions on the SAME symbol (CYBER)
      for (let i = 1; i <= 2; i++) {
        store.addPosition({
          id: `pos_cyber_${i}`,
          canonicalSymbol: 'CYBER',
          binanceSymbol: 'CYBERUSDT',
          bybitSymbol: 'CYBERUSDT',
          direction: 'SHORT_BINANCE_LONG_BYBIT',
          status: 'OPEN',
          entryTimestamp: Date.now(),
          entryBasisBps: 30.0,
          entryBinancePrice: 10.0,
          entryBybitPrice: 9.97,
          quantity: 1.5,
          notionalUsdt: 15.0,
          currentBasisBps: 30.0,
          currentBinancePrice: 10.0,
          currentBybitPrice: 9.97,
          currentZScore: 2.5,
          realizedPnlUsdt: 0,
          unrealizedPnlUsdt: 0,
          totalFeesUsdt: 0.015,
          netPnlUsdt: 0,
          holdDurationMinutes: 1,
          divergenceHistory30m: [],
        });
      }

      const cyberCandidate: StatArbPair = {
        canonicalSymbol: 'CYBER',
        binanceSymbol: 'CYBERUSDT',
        bybitSymbol: 'CYBERUSDT',
        multiplier: 1.0,
        binanceMid: 10.0,
        bybitMid: 9.97,
        grossBasisBps: 30.1,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 4.0,
        bybitSpreadBps: 4.0,
        lastUpdated: Date.now(),
      };

      const scanResult = await engine.scanCorridors([cyberCandidate], new Map(), new Map());
      expect(scanResult.executedPositions).toHaveLength(0);
      expect(scanResult.rejectedReasons.CYBER?.[0]).toContain('Max repeated trades cap reached for CYBER: 2/2 active positions running');
    });
  });
});
