import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { StatArbEngine } from '@/lib/statarb/engine/statArbEngine';
import { StatArbStateStore } from '@/lib/statarb/engine/statArbStateStore';
import { evaluateExit, LIVE_FEE_STRUCTURE } from '@/lib/statarb/execution/exitOptimizer';
import { StatArbPosition, StatArbPair } from '@/lib/statarb/types';
import { MockExchangeExecutionAdapter } from './fixtures/orderRouterFixtures';

describe('Wind-Down Mode & Funding Accounting & Aging Resolution Suite', () => {
  const testStatePath = path.join(process.cwd(), 'data', 'test_winddown_state.json');
  let store: StatArbStateStore;
  let adapter: MockExchangeExecutionAdapter;
  let engine: StatArbEngine;

  beforeEach(() => {
    if (fs.existsSync(testStatePath)) fs.unlinkSync(testStatePath);
    store = new StatArbStateStore(testStatePath);
    adapter = new MockExchangeExecutionAdapter();
    engine = new StatArbEngine(store, adapter as any);
  });

  afterEach(() => {
    if (fs.existsSync(testStatePath)) fs.unlinkSync(testStatePath);
  });

  describe('1. Wind-Down Mode (No New Trades, Handle Existing)', () => {
    it('halts candidate scanning and opens 0 new trades when noNewTrades is true', async () => {
      engine.updateConfig({ noNewTrades: true, enabled: true, dryRun: true });

      const candidate: StatArbPair = {
        canonicalSymbol: 'ETH',
        binanceSymbol: 'ETHUSDT',
        bybitSymbol: 'ETHUSDT',
        multiplier: 1.0,
        binanceMid: 2000.0,
        bybitMid: 1990.0,
        grossBasisBps: 50.0,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 2.0,
        bybitSpreadBps: 2.0,
        lastUpdated: Date.now(),
      };

      const scanResult = await engine.scanCorridors([candidate], new Map(), new Map());
      expect(scanResult.executedPositions).toHaveLength(0);
      expect(scanResult.rejectedReasons.SYSTEM?.[0]).toContain('Wind-Down Mode ACTIVE (No New Trades)');
    });

    it('resumes normal scanning when noNewTrades is toggled back to false', async () => {
      engine.updateConfig({ noNewTrades: false, enabled: true, dryRun: true });
      expect(store.getState().config.noNewTrades).toBe(false);
    });
  });

  describe('2. Adaptive Time-Decay Compression & Parity Scratch for Aging Trades', () => {
    const basePosition: StatArbPosition = {
      id: 'pos_test_aging_1',
      canonicalSymbol: 'ZIL',
      binanceSymbol: 'ZILUSDT',
      bybitSymbol: 'ZILUSDT',
      direction: 'SHORT_BYBIT_LONG_BINANCE',
      status: 'OPEN',
      entryTimestamp: Date.now() - 850 * 60 * 1000, // 850 mins ago (14+ hours)
      entryBasisBps: -29.35,
      entryBinancePrice: 0.001699,
      entryBybitPrice: 0.001702,
      quantity: 8831,
      notionalUsdt: 15.0,
      currentBasisBps: -12.0, // 59.1% compression
      currentBinancePrice: 0.001665,
      currentBybitPrice: 0.001667,
      currentZScore: 0.85,
      realizedPnlUsdt: 0,
      unrealizedPnlUsdt: 0.015,
      totalFeesUsdt: 0.039,
      netPnlUsdt: 0,
      holdDurationMinutes: 850,
      divergenceHistory30m: [],
    };

    it('permits Aging Stagnancy Resolution on 850m hold with 59% compression and small friction', () => {
      // Net PnL is close to parity within 1 cent friction band ($-0.0072 >= -$0.0100)
      const res = evaluateExit(basePosition, -12.0, 0.85, {
        currentBinancePrice: 0.001665,
        currentBybitPrice: 0.001667,
        holdMinutes: 850,
        fundingEarnedUsdt: 0.035, // Accrued positive carry over 14 hours
        feesConfig: LIVE_FEE_STRUCTURE,
        enableParityScratch: true,
      });

      expect(res.canExit).toBe(true);
      expect(res.exitAllowed).toBe(true);
      expect(['PROFITABLE_CONVERGENCE_EXIT', 'PARITY_SCRATCH_EXIT', 'STAGNANCY_DECOUPLING_UNWIND']).toContain(res.exitType);
    });
  });

  describe('3. Strict No-Duplicate Trades Rule (cap = 1)', () => {
    it('strictly rejects 2nd trade on same symbol when maxPositionsPerSymbol is 1', async () => {
      engine.updateConfig({ maxPositionsPerSymbol: 1, enabled: true, dryRun: true });

      store.addPosition({
        id: 'pos_existing_1',
        canonicalSymbol: 'CARV',
        binanceSymbol: 'CARVUSDT',
        bybitSymbol: 'CARVUSDT',
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        status: 'OPEN',
        entryTimestamp: Date.now(),
        entryBasisBps: 37.0,
        entryBinancePrice: 0.032,
        entryBybitPrice: 0.0325,
        quantity: 450,
        notionalUsdt: 15.0,
        currentBasisBps: 37.0,
        currentBinancePrice: 0.032,
        currentBybitPrice: 0.0325,
        currentZScore: 2.5,
        realizedPnlUsdt: 0,
        unrealizedPnlUsdt: 0,
        totalFeesUsdt: 0.02,
        netPnlUsdt: 0,
        holdDurationMinutes: 1,
        divergenceHistory30m: [],
      });

      const carvCandidate: StatArbPair = {
        canonicalSymbol: 'CARV',
        binanceSymbol: 'CARVUSDT',
        bybitSymbol: 'CARVUSDT',
        multiplier: 1.0,
        binanceMid: 0.032,
        bybitMid: 0.0325,
        grossBasisBps: 38.0,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 2.0,
        bybitSpreadBps: 2.0,
        lastUpdated: Date.now(),
      };

      const res = await engine.scanCorridors([carvCandidate], new Map(), new Map());
      expect(res.executedPositions).toHaveLength(0);
      expect(res.rejectedReasons.CARV?.[0]).toContain('Duplicate trade rejected for CARV');
    });
  });
});
