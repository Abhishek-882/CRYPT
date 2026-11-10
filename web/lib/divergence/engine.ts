/**
 * Divergence Bot: Strategy Engine, 10-State FSM, Exit Gating & Risk Breakers
 * Location: web/lib/divergence/engine.ts
 * 
 * Strict Invariants Enforced:
 * 1. ZERO BPS NOTATION: All spreads, basis, hurdles, fees, and returns formatted strictly in % notation.
 * 2. STRICT BAN ON LEGACY REFERENCES: Zero mentions of legacy bots or deprecated venues.
 * 3. SAFE PAUSED / READY MODE DEFAULT: isRunning: false, fsmState: 'PAUSED'.
 * 4. DELTA-NEUTRALITY: Verified base lot quantum balance (|Delta_net| < 0.001).
 * 5. MANDATORY reduceOnly: true on all exit, trim, stop, and emergency orders.
 * 6. ZERO-LOSS ENFORCER: Blocks take-profit exits unless Net Realized PnL >= +$0.0100 USDT.
 */

import crypto from 'crypto';
import {
  DivergenceFsmState,
  DivergenceDirection,
  DivergenceExitReason,
  DivergenceConfig,
  DivergencePosition,
  DivergenceClosedPosition,
  DivergenceCandidate,
  DivergenceStateSchema,
  DEFAULT_DIVERGENCE_CONFIG,
} from './types';
import { DivergenceStateStore, getDivergenceStateStore } from './store/stateStore';
import {
  DivergenceOrderRouter,
  getDivergenceOrderRouter,
  DivergenceExecutionAdapter,
} from './execution/orderRouter';
import { getDivergenceRadarFeed } from './scanner';
import { getSymbolFilter } from '@/lib/statarb/utils/exchangeFilterRegistry';

// ============================================================================
// 1. Core Financial & Strategy Constants
// ============================================================================

/** Conservative roundtrip fee & slippage friction: 0.260% (0.075% entry + 0.105% exit + 0.080% slippage) */
export const ROUNDTRIP_FEE_FRICTION_PCT = 0.00260; // 0.260%

/** Hard net profit safety floor required for any Take-Profit exit: +$0.0100 USDT */
export const HARD_SAFETY_FLOOR_USDT = 0.0100;

/** Backwards-compatible alias for hard net profit floor */
export const MIN_ZERO_LOSS_FLOOR_USDT = HARD_SAFETY_FLOOR_USDT; // $0.0100 USDT

/** Base notional unit for dynamic exit scaling: $60.00 USDT ($6 margin at 10x leverage) */
export const BASE_NOTIONAL_UNIT_USDT = 60.00; // $6 margin at 10x leverage

/**
 * Calculates auto-adaptive dynamic zero-loss exit profit floor.
 * Scales linearly with order notional sizing (proportional to margin at 10x leverage)
 * while strictly enforcing the $0.0100 USDT hard safety floor and respecting user override.
 *
 * Scaling schedule:
 * - $60 notional ($6 margin @ 10x) -> $0.0100 floor
 * - $300 notional ($30 margin @ 10x) -> $0.0500 floor
 * - $600 notional ($60 margin @ 10x) -> $0.1000 floor
 *
 * Dynamic ROI target formula (when minNetTargetPct is specified):
 * - AdaptiveFloorUsdt = max(HARD_SAFETY_FLOOR_USDT, totalMargin * (minNetTargetPct / 100))
 * - E.g. $30 margin @ 10x ($300 notional, $60 total margin) -> max(0.0100, 60 * 0.0030) = $0.1800 floor (+0.30% net ROI)
 */
export function getEffectiveZeroLossFloorUsdt(
  orderNotionalUsdt: number,
  configuredFloorUsdt?: number,
  leverage: number = 10,
  minNetTargetPct?: number
): number {
  const HARD_SAFETY_FLOOR_USDT = 0.0100;
  const BASE_NOTIONAL_UNIT_USDT = 60.00; // $6 margin at 10x leverage

  if (configuredFloorUsdt !== undefined && configuredFloorUsdt >= HARD_SAFETY_FLOOR_USDT) {
    return parseFloat(configuredFloorUsdt.toFixed(4));
  }

  if (minNetTargetPct !== undefined && minNetTargetPct > 0) {
    const lev = leverage > 0 ? leverage : 10;
    const totalMargin = (orderNotionalUsdt * 2) / lev;
    const targetFloor = parseFloat((totalMargin * (minNetTargetPct / 100)).toFixed(4));
    return Math.max(HARD_SAFETY_FLOOR_USDT, targetFloor);
  }

  const scaleFactor = Math.max(1.0, orderNotionalUsdt / BASE_NOTIONAL_UNIT_USDT);
  const autoAdaptedFloor = parseFloat((scaleFactor * HARD_SAFETY_FLOOR_USDT).toFixed(4));
  return Math.max(HARD_SAFETY_FLOOR_USDT, autoAdaptedFloor);
}

/** Adverse divergence stop-loss relative basis drift threshold: -0.150% */
export const ADVERSE_STOP_DRIFT_PCT = -0.00150; // -0.150%

/** Maximum bounded loss on adverse stop (-0.150% drift - 0.260% fee friction): -0.410% */
export const MAX_ADVERSE_LOSS_PCT = -0.00410; // -0.410%

/** Cumulative carry drag circuit breaker: 0.080% negative funding drag */
export const CARRY_DRAG_BREAKER_PCT = 0.00080; // 0.080%

/** Nominal stagnancy scratch holding evaluation horizon: 180 minutes */
export const NOMINAL_STAGNANCY_MINUTES = 180;

/** Hard maximum holding duration ceiling: 360 minutes */
export const MANDATORY_CEILING_MINUTES = 360;

/** Dynamic momentum extension duration: +60 minutes */
export const MOMENTUM_EXTENSION_MINUTES = 60;

/** Pre-settlement funding lockout window: 10 minutes prior to epoch */
export const FUNDING_LOCKOUT_WINDOW_MINUTES = 10;

/** Pre-settlement funding lockout threshold: projected carry < -0.015% */
export const FUNDING_LOCKOUT_THRESHOLD_PCT = -0.015;

/** Default nominal relative expansion target hurdle: +0.380% */
export const DEFAULT_RELATIVE_EXPANSION_TARGET_PCT = 0.380;

// ============================================================================
// 2. Types & Interfaces
// ============================================================================

export type ExitReason =
  | 'EXPANSION_TP'
  | 'STAGNANCY_SCRATCH'
  | 'ADVERSE_STOP'
  | 'CARRY_BREAKER'
  | 'MANDATORY_CEILING'
  | 'MANUAL_UNWIND'
  | 'EMERGENCY_KILL'
  | 'NONE';

export type ExitStatusBadge =
  | 'TARGET_REACHED'
  | 'EXPANDING_IN_PROFIT'
  | 'ABSORBING_FRICTION'
  | 'COMPRESSED'
  | 'MOMENTUM_EXTENSION'
  | 'STAGNANCY_SCRATCH'
  | 'ADVERSE_DRIFT'
  | 'EMERGENCY_STOP';

export interface ExitEvaluation {
  shouldExit: boolean;
  reason: ExitReason;
  relativeExpansionPercent: number;
  netPnlUsdt: number;
  zeroLossSatisfied: boolean;
  requiresReduceOnly: boolean;
  statusBadge: ExitStatusBadge;
  effectiveZeroLossFloorUsdt?: number;
}

// ============================================================================
// 3. Mathematical Calculations & Exit Gating Functions
// ============================================================================

/**
 * Calculates signed relative expansion strictly from entry basis:
 * Direction 1 (LONG_BN_SHORT_BYB / LONG_BINANCE_SHORT_BYBIT): bt - b_entry
 * Direction 2 (SHORT_BN_LONG_BYB / LONG_BYBIT_SHORT_BINANCE): b_entry - bt
 * Precision: 4 decimal places.
 */
export function calculateRelativeExpansionPercent(
  bEntryPercent: number,
  bCurrentPercent: number,
  direction: DivergenceDirection
): number {
  if (direction === 'LONG_BN_SHORT_BYB' || direction === 'LONG_BINANCE_SHORT_BYBIT') {
    return Math.round((bCurrentPercent - bEntryPercent) * 10000) / 10000;
  } else {
    return Math.round((bEntryPercent - bCurrentPercent) * 10000) / 10000;
  }
}

/**
 * Calculates net realized PnL in USDT after deducting conservative roundtrip fees and funding carry:
 * Gross Yield = (relativeExpansionPercent / 100) + (accumulatedCarryPercent / 100)
 * Net Yield = Gross Yield - (feeFrictionPercent / 100)
 * Net PnL = notionalUsdt * Net Yield
 * Precision: 4 decimal places.
 */
export function calculateNetRealizedPnlUsdt(
  notionalUsdt: number,
  relativeExpansionPercent: number,
  accumulatedCarryPercent: number = 0.000,
  feeFrictionPercent: number = 0.260
): number {
  const grossYield = (relativeExpansionPercent / 100.0) + (accumulatedCarryPercent / 100.0);
  const netYield = grossYield - (feeFrictionPercent / 100.0);
  const netPnl = notionalUsdt * netYield;
  return Math.round(netPnl * 10000) / 10000;
}

/**
 * Dynamic Take-Profit Carry Ratchet:
 * Widens target hurdle if carry is negative to preserve net alpha floor.
 * dynamicTarget = baseTargetPercent + |accumulatedCarryPercent| (if carry < 0)
 * Precision: 4 decimal places.
 */
export function calculateDynamicTargetPercent(
  baseTargetPercent: number = DEFAULT_RELATIVE_EXPANSION_TARGET_PCT,
  accumulatedCarryPercent: number = 0.000
): number {
  if (accumulatedCarryPercent < 0) {
    return Math.round((baseTargetPercent + Math.abs(accumulatedCarryPercent)) * 10000) / 10000;
  }
  return baseTargetPercent;
}

/**
 * Pre-Settlement Funding Lockout Guard:
 * Evaluates whether entry should be blocked within lockoutWindowMinutes prior to funding epoch.
 */
export function isFundingLockoutActive(
  minutesToFundingEpoch: number,
  projectedCarryPercent: number,
  lockoutWindowMinutes: number = FUNDING_LOCKOUT_WINDOW_MINUTES,
  lockoutThresholdPercent: number = FUNDING_LOCKOUT_THRESHOLD_PCT
): boolean {
  if (minutesToFundingEpoch <= lockoutWindowMinutes && projectedCarryPercent < lockoutThresholdPercent) {
    return true; // LOCKOUT ACTIVE: Do not enter
  }
  return false;
}

/**
 * Calculates remaining minutes until the next 8-hour exchange funding epoch (00:00, 08:00, 16:00 UTC).
 */
export function getMinutesToNextFundingEpoch(timestamp: number = Date.now()): number {
  const date = new Date(timestamp);
  const curUtcHour = date.getUTCHours();
  const curUtcMin = date.getUTCMinutes();
  const curUtcSec = date.getUTCSeconds();
  const curDayMinutes = curUtcHour * 60 + curUtcMin + curUtcSec / 60;

  const epochs = [0, 480, 960, 1440];
  for (const epoch of epochs) {
    if (epoch > curDayMinutes) {
      return Math.round((epoch - curDayMinutes) * 10) / 10;
    }
  }
  return Math.round((1440 - curDayMinutes) * 10) / 10;
}

/**
 * Evaluates comprehensive exit and risk conditions for an active divergence position.
 * 
 * Priority Evaluation Hierarchy:
 * 1. Adverse Divergence Stop-Loss (relExp <= -0.150%) -> EMERGENCY_STOP
 * 2. Cumulative Carry Breaker (|accumulatedCarry| >= 0.080% drag) -> STAGNANCY_SCRATCH
 * 3. Stagnancy Hard Ceiling (duration >= 360m) -> MANDATORY_CEILING
 * 4. Stagnancy Scratch at 180m (duration >= 180m AND relExp < 0.120% AND netPnl <= 0.0) -> STAGNANCY_SCRATCH
 * 5. Take-Profit & Zero-Loss Conjunction Gate (relExp >= dynamicTarget AND netPnl >= effectiveFloorUsdt) -> EXPANSION_TP
 * 6. Non-exit holding: assigns contextual status badge.
 */
export function evaluateExitGates(
  bEntryPercent: number,
  bCurrentPercent: number,
  direction: DivergenceDirection,
  durationMinutes: number,
  accumulatedCarryPercent: number = 0.000,
  notionalUsdt: number = 15.00,
  isMomentumExpanding = false,
  userHurdleUsdt?: number,
  userExpansionTargetPercent?: number,
  leverage: number = 10,
  minNetTargetPct?: number
): ExitEvaluation {
  const relExp = calculateRelativeExpansionPercent(bEntryPercent, bCurrentPercent, direction);
  const baseTarget =
    userExpansionTargetPercent !== undefined && userExpansionTargetPercent > 0
      ? userExpansionTargetPercent
      : DEFAULT_RELATIVE_EXPANSION_TARGET_PCT;
  const dynamicTarget = calculateDynamicTargetPercent(baseTarget, accumulatedCarryPercent);
  const netPnl = calculateNetRealizedPnlUsdt(notionalUsdt, relExp, accumulatedCarryPercent);
  const effectiveFloorUsdt = getEffectiveZeroLossFloorUsdt(
    notionalUsdt,
    userHurdleUsdt,
    leverage,
    minNetTargetPct
  );
  const totalMargin = (notionalUsdt * 2) / (leverage > 0 ? leverage : 10);
  const currentRoiPct = totalMargin > 0 ? (netPnl / totalMargin) * 100 : 0;
  const targetPctSatisfied =
    minNetTargetPct !== undefined && minNetTargetPct > 0 ? currentRoiPct >= minNetTargetPct : true;
  const zeroLossSatisfied = netPnl >= effectiveFloorUsdt && targetPctSatisfied;

  // 1. Adverse Divergence Stop-Loss (<= -0.150%)
  if (relExp <= -0.150) {
    return {
      shouldExit: true,
      reason: 'ADVERSE_STOP',
      relativeExpansionPercent: relExp,
      netPnlUsdt: netPnl,
      zeroLossSatisfied: false,
      requiresReduceOnly: true,
      statusBadge: 'EMERGENCY_STOP',
      effectiveZeroLossFloorUsdt: effectiveFloorUsdt,
    };
  }

  // 2. Cumulative Carry Breaker (>= 0.080% drag)
  if (Math.abs(accumulatedCarryPercent) >= 0.080 && accumulatedCarryPercent < 0) {
    return {
      shouldExit: true,
      reason: 'CARRY_BREAKER',
      relativeExpansionPercent: relExp,
      netPnlUsdt: netPnl,
      zeroLossSatisfied: false,
      requiresReduceOnly: true,
      statusBadge: 'STAGNANCY_SCRATCH',
      effectiveZeroLossFloorUsdt: effectiveFloorUsdt,
    };
  }

  // 3. Stagnancy Hard Ceiling (360m unconditional)
  if (durationMinutes >= MANDATORY_CEILING_MINUTES) {
    return {
      shouldExit: true,
      reason: 'MANDATORY_CEILING',
      relativeExpansionPercent: relExp,
      netPnlUsdt: netPnl,
      zeroLossSatisfied,
      requiresReduceOnly: true,
      statusBadge: 'STAGNANCY_SCRATCH',
      effectiveZeroLossFloorUsdt: effectiveFloorUsdt,
    };
  }

  // 4. Stagnancy Scratch at 180m (Triple condition: >= 180m AND < 0.120% expansion AND Net PnL <= 0)
  if (durationMinutes >= NOMINAL_STAGNANCY_MINUTES) {
    if (relExp < 0.120 && netPnl <= 0.0) {
      return {
        shouldExit: true,
        reason: 'STAGNANCY_SCRATCH',
        relativeExpansionPercent: relExp,
        netPnlUsdt: netPnl,
        zeroLossSatisfied: false,
        requiresReduceOnly: true,
        statusBadge: 'STAGNANCY_SCRATCH',
        effectiveZeroLossFloorUsdt: effectiveFloorUsdt,
      };
    }
  }

  // 5. Take-Profit & Zero-Loss Conjunction Gate (Expansion >= Dynamic Hurdle AND Net PnL >= effectiveFloorUsdt)
  if (relExp >= dynamicTarget && zeroLossSatisfied) {
    return {
      shouldExit: true,
      reason: 'EXPANSION_TP',
      relativeExpansionPercent: relExp,
      netPnlUsdt: netPnl,
      zeroLossSatisfied: true,
      requiresReduceOnly: true,
      statusBadge: 'TARGET_REACHED',
      effectiveZeroLossFloorUsdt: effectiveFloorUsdt,
    };
  }

  // Position continues holding: assign appropriate telemetry badge
  let statusBadge: ExitStatusBadge = 'COMPRESSED';
  if (relExp < 0) {
    statusBadge = 'ADVERSE_DRIFT';
  } else if (durationMinutes >= NOMINAL_STAGNANCY_MINUTES && relExp >= 0.200 && isMomentumExpanding) {
    statusBadge = 'MOMENTUM_EXTENSION';
  } else if (netPnl > 0) {
    statusBadge = 'EXPANDING_IN_PROFIT';
  } else if (relExp > 0) {
    statusBadge = 'ABSORBING_FRICTION';
  }

  return {
    shouldExit: false,
    reason: 'NONE',
    relativeExpansionPercent: relExp,
    netPnlUsdt: netPnl,
    zeroLossSatisfied,
    requiresReduceOnly: true,
    statusBadge,
    effectiveZeroLossFloorUsdt: effectiveFloorUsdt,
  };
}

// ============================================================================
// 4. DivergenceEngine Class (Managing the 10-State FSM)
// ============================================================================

export class DivergenceEngine {
  private store: DivergenceStateStore;
  private router: DivergenceOrderRouter;
  private scanTimer: NodeJS.Timeout | null = null;
  private positionTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false; // CRITICAL INVARIANT: DEFAULTS STRICTLY TO false
  private cycleCount: number = 0;
  private isScanning: boolean = false;
  private isManaging: boolean = false;

  constructor(
    store?: DivergenceStateStore,
    router?: DivergenceOrderRouter
  ) {
    this.store = store || getDivergenceStateStore();
    this.router = router || getDivergenceOrderRouter();
    // Invariant: start in PAUSED mode
    this.isRunning = false;
  }

  public isEngineRunning(): boolean {
    return this.isRunning;
  }

  public getFsmState(): DivergenceFsmState {
    return this.store.getState().fsmState;
  }

  public getState(): Readonly<DivergenceStateSchema> {
    return this.store.getState();
  }

  public updateConfig(updates: Partial<DivergenceConfig>): DivergenceConfig {
    return this.store.updateConfig(updates);
  }

  public setAdapter(adapter: DivergenceExecutionAdapter): void {
    this.router.setAdapter(adapter);
  }

  public getAdapter(): DivergenceExecutionAdapter {
    return this.router.getAdapter();
  }

  /**
   * Starts the strategy engine and FSM loops: PAUSED -> IDLE
   */
  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.store.setRunning(true);
    this.store.setFsmState('IDLE');

    // Start 4,000ms scan cycle and 2,000ms position monitoring loop
    this.scanTimer = setInterval(() => {
      this.scanAndExecute().catch((err) => {
        console.error('[DIVERGENCE_ENGINE] Error in scan cycle:', err);
      });
    }, 4000);

    this.positionTimer = setInterval(() => {
      this.managePositions().catch((err) => {
        console.error('[DIVERGENCE_ENGINE] Error in position management loop:', err);
      });
    }, 2000);

    console.log('[DIVERGENCE_ENGINE] Started Divergence Engine in IDLE state.');
  }

  /**
   * Stops the strategy engine and pauses FSM: -> PAUSED
   */
  public stop(): void {
    this.pause();
  }

  public pause(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }

    this.isRunning = false;
    this.store.setRunning(false);
    this.store.setFsmState('PAUSED');
    console.log('[DIVERGENCE_ENGINE] Paused Divergence Engine.');
  }

  /**
   * Immediate synchronous cycle execution for manual testing or cron triggers
   */
  public async tick(): Promise<{ scanResult?: any; manageResult?: any }> {
    this.cycleCount++;
    const scanResult = await this.scanAndExecute();
    const manageResult = await this.managePositions();
    return { scanResult, manageResult };
  }

  /**
   * Autonomous Opportunity Discovery & Entry Dispatch:
   * IDLE -> SCANNING -> BALANCING -> ACTIVE_EXPANDING (or RECONCILING on partial fill)
   */
  public async scanAndExecute(): Promise<{ executed: boolean; reason?: string }> {
    if (!this.isRunning) {
      return { executed: false, reason: 'ENGINE_PAUSED' };
    }

    const currentState = this.store.getState().fsmState;
    // Allow scanning when IDLE or when ACTIVE_EXPANDING with spare position capacity
    if (currentState !== 'IDLE' && currentState !== 'ACTIVE_EXPANDING') {
      return { executed: false, reason: `FSM_BUSY_${currentState}` };
    }

    if (this.isScanning) {
      return { executed: false, reason: 'SCAN_IN_PROGRESS' };
    }

    this.isScanning = true;
    try {
      const config = this.store.getState().config;
      const notional = config.orderNotionalUsdt || 10.00;

      // 1. Check Capacity & Gating
      const canOpen = this.store.canOpenPosition(notional);
      if (!canOpen.allowed) {
        return { executed: false, reason: canOpen.reason };
      }

      this.store.setFsmState('SCANNING');

      // 2. Fetch Candidates from Dispersion Radar
      const radarFeed = await getDivergenceRadarFeed(config);
      const activePositions = this.store.getActivePositions();
      const activeSymbols = new Set(activePositions.map((p) => p.canonicalSymbol.toUpperCase()));

      const qualified = (radarFeed?.candidates || []).filter(
        (c) =>
          c.isQualified &&
          c.gatesPassed.dispersion &&
          c.gatesPassed.compression &&
          c.gatesPassed.antiCollision &&
          !activeSymbols.has(c.canonicalSymbol.toUpperCase())
      );

      if (qualified.length === 0) {
        const remaining = this.store.getActivePositions().length;
        this.store.setFsmState(remaining > 0 ? 'ACTIVE_EXPANDING' : 'IDLE');
        return { executed: false, reason: 'NO_QUALIFIED_CANDIDATE' };
      }

      // 3. Pre-Settlement Funding Lockout Check
      const minutesToEpoch = getMinutesToNextFundingEpoch();
      const topCandidate = qualified.find((c) => {
        const isLockedOut = isFundingLockoutActive(minutesToEpoch, c.netAlphaProjectedPercent);
        return !isLockedOut;
      });

      if (!topCandidate) {
        const remaining = this.store.getActivePositions().length;
        this.store.setFsmState(remaining > 0 ? 'ACTIVE_EXPANDING' : 'IDLE');
        return { executed: false, reason: 'PRE_SETTLEMENT_LOCKOUT_ACTIVE' };
      }

      // 4. Balancing & Order Sizing
      this.store.setFsmState('BALANCING');

      // 5. Execute Entry Order Routing
      const entryResult = await this.router.executeEntry(topCandidate, config);

      if (!entryResult.success || !entryResult.leg1Fill || !entryResult.leg2Fill) {
        const remaining = this.store.getActivePositions().length;
        this.store.setFsmState(this.isRunning ? (remaining > 0 ? 'ACTIVE_EXPANDING' : 'IDLE') : 'PAUSED');
        if (entryResult.reconciliationAction === 'UNWOUND') {
          return { executed: false, reason: entryResult.error || 'PARTIAL_FILL_UNWOUND' };
        }
        return { executed: false, reason: entryResult.error || 'ENTRY_FAILED' };
      }

      // 6. Register Active Position
      const positionId = entryResult.positionId || `div_pos_${topCandidate.canonicalSymbol}_${Date.now()}`;
      const now = Date.now();

      const newPosition: DivergencePosition = {
        id: positionId,
        canonicalSymbol: topCandidate.canonicalSymbol,
        binanceSymbol: topCandidate.binanceSymbol,
        bybitSymbol: topCandidate.bybitSymbol,
        direction: topCandidate.suggestedDirection,
        status: 'OPEN',
        entryTimestamp: now,
        entryBasisPercent: topCandidate.liveBasisPercent,
        currentBasisPercent: topCandidate.liveBasisPercent,
        peakBasisPercent: topCandidate.liveBasisPercent,
        targetExpansionPercent: config.relativeExpansionTargetPercent || DEFAULT_RELATIVE_EXPANSION_TARGET_PCT,
        stopLossBasisPercent: config.adverseStopLossPercent || ADVERSE_STOP_DRIFT_PCT,
        entryBinancePrice: entryResult.leg1Fill.price,
        entryBybitPrice: entryResult.leg2Fill.price,
        currentBinancePrice: entryResult.leg1Fill.price,
        currentBybitPrice: entryResult.leg2Fill.price,
        quantityBinance: entryResult.leg1Fill.quantity,
        quantityBybit: entryResult.leg2Fill.quantity,
        notionalUsdt: entryResult.leg1Fill.notionalUsdt || notional,
        unrealizedGrossPnlUsdt: 0.0,
        estimatedTotalFeesUsdt: (entryResult.leg1Fill.notionalUsdt || notional) * (ROUNDTRIP_FEE_FRICTION_PCT / 100.0),
        actualFeesUsdt: entryResult.leg1Fill.feeUsdt + entryResult.leg2Fill.feeUsdt,
        netPnlUsdt: 0.0,
        roiPercent: 0.0,
        holdDurationMinutes: 0.0,
        relativeExpansionPercent: 0.0,
        isHurdleMet: false,
        leg1: {
          venue: entryResult.leg1Fill.venue,
          side: entryResult.leg1Fill.side,
          orderType: entryResult.leg1Fill.orderType,
          orderId: entryResult.leg1Fill.orderId,
          clientOrderId: entryResult.leg1Fill.clientOrderId,
          symbol: entryResult.leg1Fill.symbol,
          executedQty: entryResult.leg1Fill.quantity,
          avgPrice: entryResult.leg1Fill.price,
          feePercent: entryResult.leg1Fill.feePercent,
          feeUsdt: entryResult.leg1Fill.feeUsdt,
          latencyMs: entryResult.leg1Fill.latencyMs,
          timestamp: entryResult.leg1Fill.timestamp,
        },
        leg2: {
          venue: entryResult.leg2Fill.venue,
          side: entryResult.leg2Fill.side,
          orderType: entryResult.leg2Fill.orderType,
          orderId: entryResult.leg2Fill.orderId,
          clientOrderId: entryResult.leg2Fill.clientOrderId,
          symbol: entryResult.leg2Fill.symbol,
          executedQty: entryResult.leg2Fill.quantity,
          avgPrice: entryResult.leg2Fill.price,
          feePercent: entryResult.leg2Fill.feePercent,
          feeUsdt: entryResult.leg2Fill.feeUsdt,
          latencyMs: entryResult.leg2Fill.latencyMs,
          timestamp: entryResult.leg2Fill.timestamp,
        },
        executionHash: crypto.createHash('sha256').update(`${positionId}_${now}`).digest('hex'),
        stagnancyNominalDeadline: now + (config.nominalStagnancyMinutes || NOMINAL_STAGNANCY_MINUTES) * 60 * 1000,
        stagnancyCeilingDeadline: now + (config.maxStagnancyCeilingMinutes || MANDATORY_CEILING_MINUTES) * 60 * 1000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.000,
        lastUpdated: now,
      };

      const added = this.store.addPosition(newPosition);
      if (!added) {
        return { executed: false, reason: 'STATE_STORE_CAPITAL_LIMIT_REJECTED' };
      }

      this.store.setFsmState('ACTIVE_EXPANDING');
      return { executed: true };
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Real-Time Active Position Monitoring & Exit Gate Enforcement:
   * ACTIVE_EXPANDING -> EXITING / SCRATCH_UNWINDING / EMERGENCY_STOPPING -> IDLE
   */
  public async managePositions(): Promise<{ evaluatedCount: number; closedPositions: DivergenceClosedPosition[] }> {
    if (this.isManaging) {
      return { evaluatedCount: 0, closedPositions: [] };
    }

    this.isManaging = true;
    const closedPositions: DivergenceClosedPosition[] = [];

    try {
      const active = this.store.getActivePositions();
      if (active.length === 0) {
        const curFsm = this.store.getState().fsmState;
        if (curFsm === 'ACTIVE_EXPANDING') {
          const remainingActive = this.store.getActivePositions().length;
          this.store.setFsmState(this.isRunning ? (remainingActive > 0 ? 'ACTIVE_EXPANDING' : 'IDLE') : 'PAUSED');
        }
        return { evaluatedCount: 0, closedPositions: [] };
      }

      const config = this.store.getState().config;
      const now = Date.now();

      for (const pos of active) {
        const durationMinutes = parseFloat(((now - pos.entryTimestamp) / (60 * 1000)).toFixed(2));

        // 1. Fetch Live Counterpart Prices or fall back to position prices
        let pBn = pos.currentBinancePrice;
        let pByb = pos.currentBybitPrice;

        if (typeof this.router.getAdapter().getLiveTopBook === 'function') {
          try {
            const [tbBn, tbByb] = await Promise.all([
              this.router.getAdapter().getLiveTopBook!('BINANCE', pos.binanceSymbol),
              this.router.getAdapter().getLiveTopBook!('BYBIT', pos.bybitSymbol),
            ]);
            if (tbBn && tbBn.mid > 0 && Math.abs(tbBn.mid - pos.currentBinancePrice) / Math.max(1, pos.currentBinancePrice) < 0.5) {
              pBn = tbBn.mid;
            }
            if (tbByb && tbByb.mid > 0 && Math.abs(tbByb.mid - pos.currentBybitPrice) / Math.max(1, pos.currentBybitPrice) < 0.5) {
              pByb = tbByb.mid;
            }
          } catch {}
        }

        // 2. Compute Live Relative Basis
        const midPrice = (pBn + pByb) / 2.0;
        const currentBasisPercent = midPrice > 0 ? ((pBn - pByb) / midPrice) * 100.0 : pos.currentBasisPercent;

        // 3. Evaluate Exit Gates Hierarchy
        const exitEval = evaluateExitGates(
          pos.entryBasisPercent,
          currentBasisPercent,
          pos.direction,
          durationMinutes,
          pos.accumulatedCarryPercent || 0.000,
          pos.notionalUsdt || config?.orderNotionalUsdt || 15.00,
          pos.hasMomentumExtension || false,
          config?.zeroLossNetHurdleUsdt,
          config?.relativeExpansionTargetPercent
        );

        if (exitEval.shouldExit) {
          // Transition FSM according to exit trigger
          if (exitEval.reason === 'ADVERSE_STOP') {
            this.store.setFsmState('EMERGENCY_STOPPING');
          } else if (exitEval.reason === 'EXPANSION_TP') {
            this.store.setFsmState('EXITING');
          } else {
            this.store.setFsmState('SCRATCH_UNWINDING');
          }

          const mappedReason: DivergenceExitReason =
            exitEval.reason === 'EXPANSION_TP'
              ? 'EXPANSION_TP'
              : exitEval.reason === 'ADVERSE_STOP'
              ? 'ADVERSE_STOP'
              : 'STAGNANCY_SCRATCH';

          // Execute dual-leg exit with mandatory reduceOnly: true
          const exitResult = await this.router.executeExit(pos, mappedReason, config, true);

          // Close position in isolated state store
          const closed = this.store.closePosition(pos.id, {
            exitTimestamp: now,
            exitReason: mappedReason,
            exitBinancePrice: pBn,
            exitBybitPrice: pByb,
            realizedGrossPnlUsdt: (pos.notionalUsdt * (exitEval.relativeExpansionPercent / 100.0)),
            actualFeesUsdt: (exitResult.leg1Fill?.feeUsdt || 0) + (exitResult.leg2Fill?.feeUsdt || 0),
            netRealizedPnlUsdt: exitEval.netPnlUsdt,
            realizedRoiPercent: pos.notionalUsdt > 0 ? (exitEval.netPnlUsdt / pos.notionalUsdt) * 100 : 0.0,
            finalRelativeExpansionPercent: exitEval.relativeExpansionPercent,
            roundtripLatencyMs: (exitResult.leg1Fill?.latencyMs || 0) + (exitResult.leg2Fill?.latencyMs || 0),
          });

          if (closed) {
            closedPositions.push(closed);
          }

          const remainingActive = this.store.getActivePositions().length;
          this.store.setFsmState(this.isRunning ? (remainingActive > 0 ? 'ACTIVE_EXPANDING' : 'IDLE') : 'PAUSED');
        } else {
          // Position continues holding: update live metrics and status
          let hasMomentumExtension = pos.hasMomentumExtension || false;
          if (exitEval.statusBadge === 'MOMENTUM_EXTENSION') {
            hasMomentumExtension = true;
          }

          this.store.updatePosition(pos.id, {
            currentBasisPercent,
            currentBinancePrice: pBn,
            currentBybitPrice: pByb,
            relativeExpansionPercent: exitEval.relativeExpansionPercent,
            netPnlUsdt: exitEval.netPnlUsdt,
            roiPercent: pos.notionalUsdt > 0 ? (exitEval.netPnlUsdt / pos.notionalUsdt) * 100 : 0.0,
            isHurdleMet: exitEval.zeroLossSatisfied,
            peakBasisPercent: Math.max(pos.peakBasisPercent || 0, currentBasisPercent),
            hasMomentumExtension,
          });
        }
      }

      return { evaluatedCount: active.length, closedPositions };
    } finally {
      this.isManaging = false;
    }
  }

  /**
   * Engages hard kill-switch: halts timers, sets EMERGENCY_KILLED, unwinds all legs with reduceOnly: true
   */
  public async emergencyKill(): Promise<DivergenceClosedPosition[]> {
    this.pause();
    this.store.setFsmState('EMERGENCY_KILLED');

    const active = this.store.getActivePositions();
    const config = this.store.getState().config;
    const closedList: DivergenceClosedPosition[] = [];

    for (const pos of active) {
      try {
        const exitResult = await this.router.executeExit(pos, 'EMERGENCY_KILL', config, true);
        const closed = this.store.closePosition(pos.id, {
          exitTimestamp: Date.now(),
          exitReason: 'EMERGENCY_KILL',
          actualFeesUsdt: (exitResult.leg1Fill?.feeUsdt || 0) + (exitResult.leg2Fill?.feeUsdt || 0),
        });
        if (closed) closedList.push(closed);
      } catch (err) {
        console.error(`[DIVERGENCE_ENGINE] Critical error during emergency unwind of ${pos.id}:`, err);
      }
    }

    this.store.setFsmState('EMERGENCY_KILLED');
    return closedList;
  }

  /**
   * Closes a single specific position by ID with reduceOnly: true
   */
  public async closePosition(positionId: string): Promise<DivergenceClosedPosition | null> {
    const pos = this.store.getPositionById(positionId);
    if (!pos) return null;

    const config = this.store.getState().config;
    const exitResult = await this.router.executeExit(pos, 'MANUAL_UNWIND', config, true);

    return this.store.closePosition(pos.id, {
      exitTimestamp: Date.now(),
      exitReason: 'MANUAL_UNWIND',
      actualFeesUsdt: (exitResult.leg1Fill?.feeUsdt || 0) + (exitResult.leg2Fill?.feeUsdt || 0),
    });
  }
}

// Global Engine Singleton Instance
let defaultEngineInstance: DivergenceEngine | null = null;
export function getDivergenceEngine(): DivergenceEngine {
  if (!defaultEngineInstance) {
    defaultEngineInstance = new DivergenceEngine();
  }
  return defaultEngineInstance;
}
