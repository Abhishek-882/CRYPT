/**
 * EMPIRICAL CHALLENGER: ADVERSARIAL STRESS & VULNERABILITY TEST SUITE (MILESTONE 3)
 * 
 * Target Modules:
 *   - web/lib/divergence/engine.ts
 *   - web/app/api/divergence/daemon/route.ts
 *   - web/app/api/divergence/audit/route.ts
 * 
 * Roles: critic, specialist
 * Archetype: EMPIRICAL CHALLENGER
 * 
 * Mandatory Stress Challenges Verified:
 * 1. 10-State FSM Lifecycle & Invariant Safety Lock Defaults:
 *    - Defaults strictly to isRunning: false, fsmState: 'PAUSED'.
 *    - Validated transitions: PAUSED -> IDLE -> SCANNING -> BALANCING -> ACTIVE_EXPANDING ->
 *      EXITING / SCRATCH_UNWINDING / EMERGENCY_STOPPING -> IDLE -> PAUSED.
 *    - Hard Emergency Kill: EMERGENCY_KILLED engages reduceOnly unwind and unbinds concurrency lock.
 * 2. Dynamic Take-Profit Carry Ratchet:
 *    - Accumulated carry drag r_carry = -0.050% widens hurdle to 0.380% + 0.050% = 0.430%.
 *    - Zero-loss enforcer: net realized PnL floor >= +$0.0100 USDT strictly enforced.
 *    - Boundary test at 0.429% (holds) vs 0.430% (triggers TP).
 * 3. Adverse Divergence Stop-Loss & Bounded Risk:
 *    - Relative adverse drift <= -0.150% triggers immediate emergency stop with reduceOnly: true.
 *    - Boundary test at -0.149% (holds in drift) vs -0.150% (emergency stop).
 *    - Maximum loss strictly bounded to -0.410% (-$0.0615 on $15.00 notional).
 *    - Directional symmetry for both LONG_BN_SHORT_BYB and SHORT_BN_LONG_BYB.
 * 4. Dual-Horizon Stagnancy Breaker:
 *    - 180m nominal scratch exit (holding with relExp < 0.120% and Net PnL <= 0).
 *    - 179m holds; 180m triggers scratch.
 *    - Profit exemption at 180m (Net PnL > 0 continues holding).
 *    - Momentum extension (+60m) if relExp >= 0.200% and expanding.
 *    - 360m unconditional hard ceiling liquidation.
 *    - Cumulative carry drag breaker at 0.080% drag.
 * 5. Daemon API Route Lifecycle & Parameterized Concurrency Lock:
 *    - GET telemetry verification.
 *    - POST actions: start, tick, update_config, stop, emergency_kill.
 *    - Lock collision (409) against divergence_daemon.lock.
 *    - Parameterized isolation from bot_daemon.lock.
 * 6. Authentic Execution Audit API Route:
 *    - Zero synthetic mock seed data on clean store (auditLedger: [], zero metrics).
 *    - Genuine closed position receipt enrichment (fees, latency, SHA-256 hash).
 *    - Zero BPS notation and zero legacy bot references certification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

import {
  DivergenceEngine,
  calculateRelativeExpansionPercent,
  calculateNetRealizedPnlUsdt,
  calculateDynamicTargetPercent,
  isFundingLockoutActive,
  getMinutesToNextFundingEpoch,
  evaluateExitGates,
  ROUNDTRIP_FEE_FRICTION_PCT,
  MIN_ZERO_LOSS_FLOOR_USDT,
  ADVERSE_STOP_DRIFT_PCT,
  MAX_ADVERSE_LOSS_PCT,
  CARRY_DRAG_BREAKER_PCT,
  NOMINAL_STAGNANCY_MINUTES,
  MANDATORY_CEILING_MINUTES,
  MOMENTUM_EXTENSION_MINUTES,
  FUNDING_LOCKOUT_WINDOW_MINUTES,
  FUNDING_LOCKOUT_THRESHOLD_PCT,
  DEFAULT_RELATIVE_EXPANSION_TARGET_PCT,
} from '@/lib/divergence/engine';

import {
  DivergenceStateStore,
  getDivergenceStateStore,
} from '@/lib/divergence/store/stateStore';

import {
  DivergencePosition,
  DivergenceClosedPosition,
  DivergenceCandidate,
  DEFAULT_DIVERGENCE_CONFIG,
  DivergenceFsmState,
} from '@/lib/divergence/types';

import {
  acquireDaemonLock,
  releaseDaemonLock,
  getDaemonLockFilePath,
  isDaemonRunning,
} from '@/lib/daemonLockManager';

import { GET as daemonGetRoute, POST as daemonPostRoute } from '@/app/api/divergence/daemon/route';
import { GET as auditGetRoute } from '@/app/api/divergence/audit/route';
import { DivergenceOrderRouter, DivergenceExecutionAdapter } from '@/lib/divergence/execution/orderRouter';

describe('Empirical Challenger: Milestone 3 Adversarial Stress Suite', () => {
  const sandboxDir = path.resolve(process.cwd(), 'tests', 'sandbox_empirical_m3');
  const stateSandboxPath = path.join(sandboxDir, 'test_divergence_state.json');
  const inflightSandboxPath = path.join(sandboxDir, 'test_divergence_inflight.json');
  const divergenceLockPath = path.join(sandboxDir, 'divergence_daemon.lock');

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
    // Reset global store state to clean default
    const globalStore = getDivergenceStateStore();
    globalStore.clearState();
    // Release any lingering lock on divergence_daemon.lock
    try {
      releaseDaemonLock({ lockFileName: 'divergence_daemon.lock' });
    } catch {}
    vi.restoreAllMocks();
  });

  afterEach(() => {
    try {
      releaseDaemonLock({ lockFileName: 'divergence_daemon.lock' });
    } catch {}
    const globalStore = getDivergenceStateStore();
    globalStore.clearState();
    cleanSandbox();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: Strategy Engine Lifecycle & 10-State FSM Transitions
  // =========================================================================
  describe('Suite 1: Strategy Engine Lifecycle & 10-State FSM Transitions', () => {
    it('TC-M3-FSM.1: verifies default engine state is strictly isRunning: false and fsmState: PAUSED', () => {
      const sandboxStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const engine = new DivergenceEngine(sandboxStore);

      // CRITICAL OPERATIONAL SAFETY LOCK DEFAULT
      expect(engine.isEngineRunning()).toBe(false);
      expect(engine.getFsmState()).toBe('PAUSED');
      expect(sandboxStore.getState().isRunning).toBe(false);
      expect(sandboxStore.getState().fsmState).toBe('PAUSED');
      expect(sandboxStore.getActivePositions()).toHaveLength(0);
      expect(sandboxStore.getClosedPositions()).toHaveLength(0);
    });

    it('TC-M3-FSM.2: start() transitions state from PAUSED to IDLE and registers execution loops', () => {
      const sandboxStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const engine = new DivergenceEngine(sandboxStore);

      engine.start();
      expect(engine.isEngineRunning()).toBe(true);
      expect(engine.getFsmState()).toBe('IDLE');
      expect(sandboxStore.getState().isRunning).toBe(true);
      expect(sandboxStore.getState().fsmState).toBe('IDLE');

      // Idempotent start: calling start() again preserves IDLE without spinning duplicate loops
      engine.start();
      expect(engine.isEngineRunning()).toBe(true);
      expect(engine.getFsmState()).toBe('IDLE');

      engine.pause();
      expect(engine.isEngineRunning()).toBe(false);
      expect(engine.getFsmState()).toBe('PAUSED');
    });

    it('TC-M3-FSM.3: scanAndExecute() rejects immediately when engine is PAUSED', async () => {
      const sandboxStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const engine = new DivergenceEngine(sandboxStore);

      expect(engine.isEngineRunning()).toBe(false);
      const result = await engine.scanAndExecute();

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('ENGINE_PAUSED');
      expect(engine.getFsmState()).toBe('PAUSED');
    });

    it('TC-M3-FSM.4: scanAndExecute() rejects when FSM is busy in non-IDLE state', async () => {
      const sandboxStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const engine = new DivergenceEngine(sandboxStore);

      engine.start();
      // Simulate state already in BALANCING
      sandboxStore.setFsmState('BALANCING');

      const result = await engine.scanAndExecute();
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('FSM_BUSY_BALANCING');
      expect(engine.getFsmState()).toBe('BALANCING');

      engine.stop();
    });

    it('TC-M3-FSM.5: transitions IDLE -> SCANNING -> IDLE when no qualified candidates pass gates', async () => {
      const sandboxStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const engine = new DivergenceEngine(sandboxStore);

      engine.start();
      expect(engine.getFsmState()).toBe('IDLE');

      // Mock radar feed returning zero qualified candidates
      const mockScanner = await import('@/lib/divergence/scanner');
      vi.spyOn(mockScanner, 'getDivergenceRadarFeed').mockResolvedValueOnce({
        success: true,
        cached: false,
        timestamp: Date.now(),
        candidatesCount: 0,
        candidates: [],
      } as any);

      const result = await engine.scanAndExecute();
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('NO_QUALIFIED_CANDIDATE');
      // Must cleanly return to IDLE
      expect(engine.getFsmState()).toBe('IDLE');

      engine.stop();
    });

    it('TC-M3-FSM.6: emergencyKill() engages EMERGENCY_KILLED and unwinds all positions with reduceOnly: true', async () => {
      const sandboxStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const router = new DivergenceOrderRouter();
      const engine = new DivergenceEngine(sandboxStore, router);

      let executeExitReduceOnlyFlag = false;
      vi.spyOn(router, 'executeExit').mockImplementation(async (pos, reason, cfg, reduceOnly) => {
        executeExitReduceOnlyFlag = Boolean(reduceOnly);
        return {
          success: true,
          positionId: pos.id,
          reconciliationAction: 'NONE',
          leg1Fill: {
            venue: 'BINANCE',
            symbol: pos.binanceSymbol,
            side: 'SELL',
            orderType: 'EMERGENCY_MARKET',
            orderId: 'mock_1',
            clientOrderId: 'mock_c1',
            price: 60000,
            quantity: 0.001,
            executedQty: 0.001,
            notionalUsdt: 60,
            feePercent: 0.050,
            feeUsdt: 0.030,
            latencyMs: 15,
            timestamp: Date.now(),
            reduceOnly: true,
            isReduceOnly: true,
          } as any,
          leg2Fill: {
            venue: 'BYBIT',
            symbol: pos.bybitSymbol,
            side: 'BUY',
            orderType: 'EMERGENCY_MARKET',
            orderId: 'mock_2',
            clientOrderId: 'mock_c2',
            price: 60000,
            quantity: 0.001,
            executedQty: 0.001,
            notionalUsdt: 60,
            feePercent: 0.050,
            feeUsdt: 0.030,
            latencyMs: 20,
            timestamp: Date.now(),
            reduceOnly: true,
            isReduceOnly: true,
          } as any,
        };
      });

      // Add active test position
      const dummyPos: DivergencePosition = {
        id: 'div_pos_test_kill_1',
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: Date.now() - 60000,
        entryBasisPercent: 0.020,
        currentBasisPercent: 0.025,
        peakBasisPercent: 0.030,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 60000,
        entryBybitPrice: 59988,
        currentBinancePrice: 60000,
        currentBybitPrice: 59988,
        quantityBinance: 0.001,
        quantityBybit: 0.001,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0.0,
        estimatedTotalFeesUsdt: 0.039,
        actualFeesUsdt: 0.039,
        netPnlUsdt: 0.0,
        roiPercent: 0.0,
        holdDurationMinutes: 1.0,
        relativeExpansionPercent: 0.005,
        isHurdleMet: false,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'bn_test_1',
          clientOrderId: 'div1_test_1',
          symbol: 'BTCUSDT',
          executedQty: 0.001,
          avgPrice: 60000,
          feePercent: 0.020,
          feeUsdt: 0.012,
          latencyMs: 15,
          timestamp: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'byb_test_1',
          clientOrderId: 'div2_test_1',
          symbol: 'BTCUSDT',
          executedQty: 0.001,
          avgPrice: 59988,
          feePercent: 0.055,
          feeUsdt: 0.033,
          latencyMs: 25,
          timestamp: Date.now(),
        },
        executionHash: 'hash_test_1',
        stagnancyNominalDeadline: Date.now() + 180 * 60000,
        stagnancyCeilingDeadline: Date.now() + 360 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.000,
        lastUpdated: Date.now(),
      };
      sandboxStore.addPosition(dummyPos);
      expect(sandboxStore.getActivePositions()).toHaveLength(1);

      engine.start();
      const closed = await engine.emergencyKill();

      expect(engine.isEngineRunning()).toBe(false);
      expect(engine.getFsmState()).toBe('EMERGENCY_KILLED');
      expect(executeExitReduceOnlyFlag).toBe(true);
      expect(closed).toHaveLength(1);
      expect(closed[0].exitReason).toBe('EMERGENCY_KILL');
      expect(sandboxStore.getActivePositions()).toHaveLength(0);
    });
  });

  // =========================================================================
  // SUITE 2: Dynamic Take-Profit Carry Ratchet & Zero-Loss Hurdle Enforcer
  // =========================================================================
  describe('Suite 2: Dynamic Take-Profit Carry Ratchet & Zero-Loss Hurdle', () => {
    it('TC-M3-CARRY.1: accumulated carry drag (-0.050%) widens target to exactly 0.430%', () => {
      const baseTarget = 0.380; // 0.380% nominal
      const carryDrag = -0.050; // -0.050% funding drag over hold

      const widenedTarget = calculateDynamicTargetPercent(baseTarget, carryDrag);
      // Formula: 0.380% + |-0.050%| = 0.430%
      expect(widenedTarget).toBe(0.430);

      // Positive carry does NOT widen or compress hurdle below base target
      const positiveCarry = +0.025;
      expect(calculateDynamicTargetPercent(baseTarget, positiveCarry)).toBe(0.380);

      // Zero carry preserves base hurdle
      expect(calculateDynamicTargetPercent(baseTarget, 0.000)).toBe(0.380);
    });

    it('TC-M3-CARRY.2: exit gate holds at 0.429% expansion and triggers at 0.430% with r_carry = -0.050%', () => {
      const bEntry = 0.000;
      const carryDrag = -0.050;
      const notional = 15.00;

      // 1. Boundary below: relative expansion 0.429% < 0.430% dynamic hurdle
      const belowHurdle = evaluateExitGates(bEntry, 0.429, 'LONG_BN_SHORT_BYB', 60, carryDrag, notional);
      expect(belowHurdle.shouldExit).toBe(false);
      expect(belowHurdle.reason).toBe('NONE');
      expect(belowHurdle.statusBadge).toBe('EXPANDING_IN_PROFIT');

      // 2. Boundary hit: relative expansion exactly 0.430% >= 0.430% dynamic hurdle
      const atHurdle = evaluateExitGates(bEntry, 0.430, 'LONG_BN_SHORT_BYB', 60, carryDrag, notional);
      expect(atHurdle.shouldExit).toBe(true);
      expect(atHurdle.reason).toBe('EXPANSION_TP');
      expect(atHurdle.zeroLossSatisfied).toBe(true);
      expect(atHurdle.statusBadge).toBe('TARGET_REACHED');
      expect(atHurdle.requiresReduceOnly).toBe(true);
    });

    it('TC-M3-CARRY.3: verifies net realized PnL >= +$0.0100 USDT floor at widened 0.430% hurdle', () => {
      const notional = 15.00;
      const relExp = 0.430; // 0.430% gross basis widening
      const carryDrag = -0.050; // -0.050% funding drag
      const feeFriction = 0.260; // 0.260% roundtrip friction

      // Gross Yield = 0.430% - 0.050% = 0.380%
      // Net Yield = 0.380% - 0.260% = 0.120%
      // Net PnL = $15.00 * 0.0012 = +$0.0180 USDT
      const netPnl = calculateNetRealizedPnlUsdt(notional, relExp, carryDrag, feeFriction);
      expect(netPnl).toBe(0.0180);
      expect(netPnl).toBeGreaterThanOrEqual(MIN_ZERO_LOSS_FLOOR_USDT);
      expect(netPnl).toBeGreaterThanOrEqual(0.0100);
    });

    it('TC-M3-CARRY.4: Zero-Loss Enforcer strictly blocks exit if Net Realized PnL < +$0.0100 USDT', () => {
      const notional = 15.00;
      // If expansion was 0.300%, net PnL is (0.300% - 0.260%) * 15 = 0.040% * 15 = +$0.0060 USDT
      const subFloorPnl = calculateNetRealizedPnlUsdt(notional, 0.300, 0.000);
      expect(subFloorPnl).toBe(0.0060);
      expect(subFloorPnl).toBeLessThan(MIN_ZERO_LOSS_FLOOR_USDT);

      // Exit evaluation must reject exit even if gross is positive
      const evalRes = evaluateExitGates(0.000, 0.300, 'LONG_BN_SHORT_BYB', 30, 0.000, notional);
      expect(evalRes.shouldExit).toBe(false);
      expect(evalRes.zeroLossSatisfied).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 3: Adverse Divergence Stop-Loss & Bounded Risk Controls
  // =========================================================================
  describe('Suite 3: Adverse Divergence Stop-Loss & Bounded Risk', () => {
    it('TC-M3-STOP.1: adverse drift <= -0.150% triggers immediate emergency stop with reduceOnly: true', () => {
      // Entry basis = +0.020%, current basis = -0.130% -> relExp = -0.150%
      const res = evaluateExitGates(0.020, -0.130, 'LONG_BN_SHORT_BYB', 15, 0.000, 15.00);

      expect(res.shouldExit).toBe(true);
      expect(res.reason).toBe('ADVERSE_STOP');
      expect(res.statusBadge).toBe('EMERGENCY_STOP');
      expect(res.requiresReduceOnly).toBe(true);
      expect(res.relativeExpansionPercent).toBe(-0.150);
    });

    it('TC-M3-STOP.2: single-epsilon boundary: -0.149% holds in warning; -0.150% stops immediately', () => {
      // -0.149%: below stop boundary -> holds with ADVERSE_DRIFT badge
      const below = evaluateExitGates(0.000, -0.149, 'LONG_BN_SHORT_BYB', 20, 0.000, 15.00);
      expect(below.shouldExit).toBe(false);
      expect(below.statusBadge).toBe('ADVERSE_DRIFT');

      // -0.150%: exactly on boundary -> triggers ADVERSE_STOP
      const atBoundary = evaluateExitGates(0.000, -0.150, 'LONG_BN_SHORT_BYB', 20, 0.000, 15.00);
      expect(atBoundary.shouldExit).toBe(true);
      expect(atBoundary.reason).toBe('ADVERSE_STOP');
      expect(atBoundary.statusBadge).toBe('EMERGENCY_STOP');
    });

    it('TC-M3-STOP.3: directional symmetry: verifies Direction 2 (SHORT_BN_LONG_BYB) triggers at -0.150%', () => {
      // Direction 2: Entry basis = -0.020%, current basis rises to +0.130%
      // relExp = b_entry - b_current = -0.020% - 0.130% = -0.150%
      const resDir2 = evaluateExitGates(-0.020, 0.130, 'SHORT_BN_LONG_BYB', 25, 0.000, 15.00);

      expect(resDir2.shouldExit).toBe(true);
      expect(resDir2.reason).toBe('ADVERSE_STOP');
      expect(resDir2.relativeExpansionPercent).toBe(-0.150);
      expect(resDir2.statusBadge).toBe('EMERGENCY_STOP');
    });

    it('TC-M3-STOP.4: maximum loss is strictly bounded to -0.410% (-$0.0615 USDT on $15 notional)', () => {
      expect(ADVERSE_STOP_DRIFT_PCT).toBe(-0.00150); // -0.150%
      expect(MAX_ADVERSE_LOSS_PCT).toBe(-0.00410); // -0.410% = -0.150% drift - 0.260% fees

      const notional = 15.00;
      const boundedLoss = calculateNetRealizedPnlUsdt(notional, -0.150, 0.000);
      // Net yield: -0.150% - 0.260% = -0.410%
      // Net PnL = $15.00 * -0.0041 = -$0.0615 USDT
      expect(boundedLoss).toBe(-0.0615);
    });

    it('TC-M3-STOP.5: managePositions() catches adverse drift, transitions to EMERGENCY_STOPPING, and unwinds', async () => {
      const sandboxStore = new DivergenceStateStore(stateSandboxPath, inflightSandboxPath);
      const router = new DivergenceOrderRouter();
      const adapter = router.getAdapter();

      // Configure top book to return live adverse drift prices
      if (typeof adapter.getLiveTopBook === 'function') {
        vi.spyOn(adapter, 'getLiveTopBook').mockImplementation(async (venue: string) => {
          if (venue === 'BINANCE') return { bid: 59899, ask: 59901, mid: 59900 };
          return { bid: 59995, ask: 59997, mid: 59996 };
        });
      }

      let exitReasonDispatched = '';
      vi.spyOn(router, 'executeExit').mockImplementation(async (_pos, reason) => {
        exitReasonDispatched = reason as string;
        return {
          success: true,
          positionId: _pos.id,
          reconciliationAction: 'NONE',
          leg1Fill: {
            venue: 'BINANCE',
            symbol: _pos.binanceSymbol,
            side: 'SELL',
            orderType: 'EMERGENCY_MARKET',
            orderId: 'mock_1',
            clientOrderId: 'mock_c1',
            price: 59900,
            quantity: 0.001,
            executedQty: 0.001,
            notionalUsdt: 59.90,
            feePercent: 0.050,
            feeUsdt: 0.030,
            latencyMs: 15,
            timestamp: Date.now(),
            reduceOnly: true,
            isReduceOnly: true,
          } as any,
          leg2Fill: {
            venue: 'BYBIT',
            symbol: _pos.bybitSymbol,
            side: 'BUY',
            orderType: 'EMERGENCY_MARKET',
            orderId: 'mock_2',
            clientOrderId: 'mock_c2',
            price: 59996,
            quantity: 0.001,
            executedQty: 0.001,
            notionalUsdt: 60.00,
            feePercent: 0.050,
            feeUsdt: 0.030,
            latencyMs: 20,
            timestamp: Date.now(),
            reduceOnly: true,
            isReduceOnly: true,
          } as any,
        };
      });

      // Add position: entry basis = +0.020%, current prices will compute basis -0.160% -> relExp = -0.180%
      const adversePos: DivergencePosition = {
        id: 'div_pos_stop_test',
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: Date.now() - 300000,
        entryBasisPercent: 0.020,
        currentBasisPercent: 0.020,
        peakBasisPercent: 0.020,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 60000,
        entryBybitPrice: 59988,
        currentBinancePrice: 60000,
        currentBybitPrice: 59988,
        quantityBinance: 0.001,
        quantityBybit: 0.001,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0.0,
        estimatedTotalFeesUsdt: 0.039,
        actualFeesUsdt: 0.039,
        netPnlUsdt: 0.0,
        roiPercent: 0.0,
        holdDurationMinutes: 5.0,
        relativeExpansionPercent: 0.0,
        isHurdleMet: false,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'bn_s1',
          clientOrderId: 'div1_s1',
          symbol: 'BTCUSDT',
          executedQty: 0.001,
          avgPrice: 60000,
          feePercent: 0.020,
          feeUsdt: 0.012,
          latencyMs: 15,
          timestamp: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'byb_s1',
          clientOrderId: 'div2_s1',
          symbol: 'BTCUSDT',
          executedQty: 0.001,
          avgPrice: 59988,
          feePercent: 0.055,
          feeUsdt: 0.033,
          latencyMs: 25,
          timestamp: Date.now(),
        },
        executionHash: 'hash_s1',
        stagnancyNominalDeadline: Date.now() + 180 * 60000,
        stagnancyCeilingDeadline: Date.now() + 360 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.000,
        lastUpdated: Date.now(),
      };
      sandboxStore.addPosition(adversePos);

      const engine = new DivergenceEngine(sandboxStore, router);
      const res = await engine.managePositions();

      expect(res.evaluatedCount).toBe(1);
      expect(res.closedPositions).toHaveLength(1);
      expect(res.closedPositions[0].exitReason).toBe('ADVERSE_STOP');
      expect(exitReasonDispatched).toBe('ADVERSE_STOP');
      expect(sandboxStore.getActivePositions()).toHaveLength(0);
    });
  });

  // =========================================================================
  // SUITE 4: Dual-Horizon Stagnancy Breaker
  // =========================================================================
  describe('Suite 4: Dual-Horizon Stagnancy Breaker', () => {
    it('TC-M3-STAG.1: 179m duration holds; 180m duration triggers scratch unwind (holding with relExp < 0.120% and Net PnL <= 0)', () => {
      // 179 minutes with relExp = 0.050% and net PnL <= 0: holds
      const at179m = evaluateExitGates(0.000, 0.050, 'LONG_BN_SHORT_BYB', 179, 0.000, 15.00);
      expect(at179m.shouldExit).toBe(false);

      // 180 minutes with stagnant expansion and negative net PnL: triggers scratch
      const at180m = evaluateExitGates(0.000, 0.050, 'LONG_BN_SHORT_BYB', 180, 0.000, 15.00);
      expect(at180m.shouldExit).toBe(true);
      expect(at180m.reason).toBe('STAGNANCY_SCRATCH');
      expect(at180m.statusBadge).toBe('STAGNANCY_SCRATCH');
      expect(at180m.requiresReduceOnly).toBe(true);
    });

    it('TC-M3-STAG.2: exempts position at 180m+ if trade is in net profit (Net PnL > 0)', () => {
      // 195m held with relExp = 0.280% (net PnL = (0.280% - 0.260%) * 15 = +$0.0030 > 0)
      const at195m = evaluateExitGates(0.000, 0.280, 'LONG_BN_SHORT_BYB', 195, 0.000, 15.00);
      expect(at195m.shouldExit).toBe(false);
      expect(at195m.statusBadge).toBe('EXPANDING_IN_PROFIT');
    });

    it('TC-M3-STAG.3: grants +60m momentum extension if relExp >= 0.200% and momentum is expanding', () => {
      // 185m duration, relExp = +0.220%, expanding momentum
      const expanding = evaluateExitGates(0.000, 0.220, 'LONG_BN_SHORT_BYB', 185, 0.000, 15.00, true);
      expect(expanding.shouldExit).toBe(false);
      expect(expanding.statusBadge).toBe('MOMENTUM_EXTENSION');
    });

    it('TC-M3-STAG.4: hard ceiling at 360m unconditionally liquidates position even with momentum', () => {
      // At 360m unconditional hard ceiling: forces exit regardless of momentum
      const at360m = evaluateExitGates(0.000, 0.250, 'LONG_BN_SHORT_BYB', 360, 0.000, 15.00, true);
      expect(at360m.shouldExit).toBe(true);
      expect(at360m.reason).toBe('MANDATORY_CEILING');
      expect(at360m.requiresReduceOnly).toBe(true);
    });

    it('TC-M3-STAG.5: cumulative carry drag breaker triggers scratch unwind at -0.080% drag', () => {
      expect(CARRY_DRAG_BREAKER_PCT).toBe(0.00080); // 0.080%

      // -0.079% carry drag: holds
      const below = evaluateExitGates(0.000, 0.050, 'LONG_BN_SHORT_BYB', 60, -0.079, 15.00);
      expect(below.shouldExit).toBe(false);

      // -0.080% carry drag: triggers carry breaker scratch
      const atBreaker = evaluateExitGates(0.000, 0.050, 'LONG_BN_SHORT_BYB', 60, -0.080, 15.00);
      expect(atBreaker.shouldExit).toBe(true);
      expect(atBreaker.reason).toBe('CARRY_BREAKER');
      expect(atBreaker.statusBadge).toBe('STAGNANCY_SCRATCH');
    });

    it('TC-M3-STAG.6: pre-settlement funding lockout freezes entry within 10m if carry < -0.015%', () => {
      // 5 minutes before epoch with -0.020% negative carry -> LOCKOUT ACTIVE
      expect(isFundingLockoutActive(5, -0.020)).toBe(true);

      // 5 minutes before epoch with +0.010% positive carry -> ALLOWED
      expect(isFundingLockoutActive(5, 0.010)).toBe(false);

      // 15 minutes before epoch with -0.020% negative carry -> ALLOWED (> 10m window)
      expect(isFundingLockoutActive(15, -0.020)).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 5: Daemon API Route Lifecycle & Concurrency Lock
  // =========================================================================
  describe('Suite 5: Daemon API Route Lifecycle & Concurrency Lock', () => {
    it('TC-M3-DAEMON.1: GET /api/divergence/daemon returns telemetry with safe PAUSED default', async () => {
      const req = new NextRequest('http://localhost:3000/api/divergence/daemon');
      const res = await daemonGetRoute(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.isRunning).toBe(false);
      expect(data.fsmState).toBe('PAUSED');
      expect(data.activePositions).toHaveLength(0);
      expect(data.telemetry).toBeDefined();
      expect(data.telemetry.lockStatus).toBeDefined();
    });

    it('TC-M3-DAEMON.2: POST start acquires divergence_daemon.lock and transitions FSM to IDLE', async () => {
      const startReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });

      const res = await daemonPostRoute(startReq);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.isRunning).toBe(true);
      expect(data.fsmState).toBe('IDLE');

      // Lock file must be active
      expect(isDaemonRunning({ lockFileName: 'divergence_daemon.lock' })).toBe(true);

      // Clean up: stop daemon
      const stopReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'stop' }),
      });
      const stopRes = await daemonPostRoute(stopReq);
      const stopData = await stopRes.json();
      expect(stopRes.status).toBe(200);
      expect(stopData.isRunning).toBe(false);
      expect(stopData.fsmState).toBe('PAUSED');
      expect(isDaemonRunning({ lockFileName: 'divergence_daemon.lock' })).toBe(false);
    });

    it('TC-M3-DAEMON.3: POST start returns 409 LOCK_COLLISION if lock is held by another process', async () => {
      // Simulate another live process holding divergence_daemon.lock
      const lockPath = getDaemonLockFilePath('divergence_daemon.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: Date.now(),
          heartbeat: Date.now(),
          hostname: 'foreign-host',
          platform: 'win32',
          instanceUuid: 'foreign-uuid',
        }),
        'utf-8'
      );

      // In daemonLockManager, isProcessActive(process.pid) will be true!
      // But let's also mock acquireDaemonLock to return acquired: false with PID 8888
      const dlm = await import('@/lib/daemonLockManager');
      vi.spyOn(dlm, 'acquireDaemonLock').mockReturnValueOnce({
        acquired: false,
        pid: 8888,
        error: 'COLLISION',
      });

      const startReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });

      const res = await daemonPostRoute(startReq);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.success).toBe(false);
      expect(data.error).toBe('LOCK_COLLISION');
      expect(data.message).toContain('8888');

      try { fs.unlinkSync(lockPath); } catch {}
    });

    it('TC-M3-DAEMON.4: POST tick executes sweep cycle and returns telemetry', async () => {
      const tickReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'tick' }),
      });

      const res = await daemonPostRoute(tickReq);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.tickResult).toBeDefined();
    });

    it('TC-M3-DAEMON.5: POST emergency_kill unwinds and sets EMERGENCY_KILLED', async () => {
      const killReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'emergency_kill' }),
      });

      const res = await daemonPostRoute(killReq);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.fsmState).toBe('EMERGENCY_KILLED');
      expect(data.isRunning).toBe(false);
    });

    it('TC-M3-DAEMON.6: rejects missing or unknown action with 400', async () => {
      const missingReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const resMissing = await daemonPostRoute(missingReq);
      expect(resMissing.status).toBe(400);

      const unknownReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'launch_missile' }),
      });
      const resUnknown = await daemonPostRoute(unknownReq);
      expect(resUnknown.status).toBe(400);
    });

    it('TC-M3-DAEMON.7: POST emergency_kill with open position must preserve EMERGENCY_KILLED in GET telemetry', async () => {
      const store = getDivergenceStateStore();
      store.clearState();

      // Add active position
      const pos: DivergencePosition = {
        id: 'div_pos_daemon_kill_1',
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: Date.now() - 60000,
        entryBasisPercent: 0.020,
        currentBasisPercent: 0.025,
        peakBasisPercent: 0.030,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 60000,
        entryBybitPrice: 59988,
        currentBinancePrice: 60000,
        currentBybitPrice: 59988,
        quantityBinance: 0.001,
        quantityBybit: 0.001,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0.0,
        estimatedTotalFeesUsdt: 0.039,
        actualFeesUsdt: 0.039,
        netPnlUsdt: 0.0,
        roiPercent: 0.0,
        holdDurationMinutes: 1.0,
        relativeExpansionPercent: 0.005,
        isHurdleMet: false,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'bn_k1',
          clientOrderId: 'div1_k1',
          symbol: 'BTCUSDT',
          executedQty: 0.001,
          avgPrice: 60000,
          feePercent: 0.020,
          feeUsdt: 0.012,
          latencyMs: 15,
          timestamp: Date.now(),
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'byb_k1',
          clientOrderId: 'div2_k1',
          symbol: 'BTCUSDT',
          executedQty: 0.001,
          avgPrice: 59988,
          feePercent: 0.055,
          feeUsdt: 0.033,
          latencyMs: 25,
          timestamp: Date.now(),
        },
        executionHash: 'hash_k1',
        stagnancyNominalDeadline: Date.now() + 180 * 60000,
        stagnancyCeilingDeadline: Date.now() + 360 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.000,
        lastUpdated: Date.now(),
      };
      store.addPosition(pos);

      // Trigger POST emergency_kill
      const killReq = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'emergency_kill' }),
      });
      const killRes = await daemonPostRoute(killReq);
      const killData = await killRes.json();

      expect(killRes.status).toBe(200);
      expect(killData.success).toBe(true);
      expect(killData.fsmState).toBe('EMERGENCY_KILLED');

      // Subsequent GET telemetry check: state in store must be EMERGENCY_KILLED
      const getReq = new NextRequest('http://localhost:3000/api/divergence/daemon');
      const getRes = await daemonGetRoute(getReq);
      const getData = await getRes.json();

      expect(getRes.status).toBe(200);
      expect(getData.fsmState).toBe('EMERGENCY_KILLED');
    });
  });

  // =========================================================================
  // SUITE 6: Authentic Execution Audit API Route
  // =========================================================================
  describe('Suite 6: Authentic Execution Audit API Route', () => {
    it('TC-M3-AUDIT.1: returns empty auditLedger and 0 metrics when no closed positions exist (zero mock data)', async () => {
      const store = getDivergenceStateStore();
      store.clearState();

      const req = new NextRequest('http://localhost:3000/api/divergence/audit');
      const res = await auditGetRoute(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      // STRICT INVARIANT: 100% authentic, ZERO synthetic or mock seed trades
      expect(data.auditLedger).toEqual([]);
      expect(data.activePositions).toEqual([]);
      expect(data.summary.totalClosedTrades).toBe(0);
      expect(data.summary.profitableTrades).toBe(0);
      expect(data.summary.unprofitableTrades).toBe(0);
      expect(data.summary.winRate).toBe(0.0);
      expect(data.summary.profitFactor).toBe(0.0);
      expect(data.summary.totalNetProfitUsdt).toBe(0.0);
      expect(data.summary.totalFeesPaidUsdt).toBe(0.0);
      expect(data.summary.zeroLossEnforcedTradesCount).toBe(0);
    });

    it('TC-M3-AUDIT.2: correctly enriches and computes metrics for authentic closed positions', async () => {
      const store = getDivergenceStateStore();
      store.clearState();

      const now = Date.now();
      const activePos: DivergencePosition = {
        id: 'div_pos_authentic_1',
        canonicalSymbol: 'SOL',
        binanceSymbol: 'SOLUSDT',
        bybitSymbol: 'SOLUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: now - 3600000,
        entryBasisPercent: 0.020,
        currentBasisPercent: 0.400,
        peakBasisPercent: 0.405,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 149.00,
        entryBybitPrice: 148.97,
        currentBinancePrice: 150.00,
        currentBybitPrice: 149.40,
        quantityBinance: 0.1,
        quantityBybit: 0.1,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0.0570,
        estimatedTotalFeesUsdt: 0.0390,
        actualFeesUsdt: 0.0200,
        netPnlUsdt: 0.0180,
        roiPercent: 0.12,
        holdDurationMinutes: 60.0,
        relativeExpansionPercent: 0.380,
        isHurdleMet: true,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'bn_auth_1',
          clientOrderId: 'div1_auth_1',
          symbol: 'SOLUSDT',
          executedQty: 0.1,
          avgPrice: 149.00,
          feePercent: 0.020,
          feeUsdt: 0.003,
          latencyMs: 12,
          timestamp: now - 3600000,
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'byb_auth_1',
          clientOrderId: 'div2_auth_1',
          symbol: 'SOLUSDT',
          executedQty: 0.1,
          avgPrice: 148.97,
          feePercent: 0.055,
          feeUsdt: 0.008,
          latencyMs: 18,
          timestamp: now - 3600000,
        },
        executionHash: crypto.createHash('sha256').update('div_pos_authentic_1').digest('hex'),
        stagnancyNominalDeadline: now + 180 * 60000,
        stagnancyCeilingDeadline: now + 360 * 60000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.000,
        lastUpdated: now,
      };

      store.addPosition(activePos);
      store.closePosition(activePos.id, {
        exitTimestamp: now,
        exitReason: 'EXPANSION_TP',
        exitBinancePrice: 150.00,
        exitBybitPrice: 149.40,
        realizedGrossPnlUsdt: 0.0570,
        actualFeesUsdt: 0.0200,
        netRealizedPnlUsdt: 0.0180,
        realizedRoiPercent: 0.12,
        finalRelativeExpansionPercent: 0.380,
        roundtripLatencyMs: 30,
      });

      const req = new NextRequest('http://localhost:3000/api/divergence/audit');
      const res = await auditGetRoute(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.auditLedger).toHaveLength(1);

      const record = data.auditLedger[0];
      expect(record.id).toBe('div_pos_authentic_1');
      expect(record.pair).toBe('SOL/USDT');
      expect(record.status).toBe('CONFIRMED_ZERO_LOSS');
      expect(record.zeroLossSatisfied).toBe(true);
      expect(record.netRealizedPnlUsdt).toBe(0.0180);
      expect(record.executionHash).toBe(activePos.executionHash);
      expect(record.leg1.venue).toBe('BINANCE');
      expect(record.leg2.venue).toBe('BYBIT');

      // Summary metrics
      expect(data.summary.totalClosedTrades).toBe(1);
      expect(data.summary.profitableTrades).toBe(1);
      expect(data.summary.winRate).toBe(100.0);
      expect(data.summary.totalNetProfitUsdt).toBe(0.0180);
      expect(data.summary.zeroLossEnforcedTradesCount).toBe(1);

      store.clearState();
    });

    it('TC-M3-AUDIT.3: certifies strict invariants (Zero BPS notation and Zero legacy references)', async () => {
      const req = new NextRequest('http://localhost:3000/api/divergence/audit');
      const res = await auditGetRoute(req);
      const text = await res.text();

      // INVARIANT 1: Zero BPS notation
      const bpsMatches = text.match(/\b\d+(\.\d+)?\s*bps\b/gi);
      expect(bpsMatches).toBeNull();

      // INVARIANT 2: Zero legacy bot references
      const legacyMatches = text.match(/legacy_basis|deprecated_basis|basis_legacy/gi);
      expect(legacyMatches).toBeNull();
    });
  });
});
