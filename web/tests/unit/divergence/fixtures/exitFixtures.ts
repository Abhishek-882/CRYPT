/**
 * Exit Gate & Risk Breakers Fixture
 * Target: Opaque-Box E2E Testing for Take-Profit, Zero-Loss & Stagnancy Breakers
 * 
 * Primary Invariants:
 * - ZERO BPS NOTATION: All spreads, basis, hurdles, fees strictly in % notation.
 * - STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * - DELTA-NEUTRALITY: Delta balance maintained |Delta_net| < 0.001.
 */

import { DivergenceDirection, DivergencePosition } from './divergenceMockAdapter';

export const ROUNDTRIP_FEE_FRICTION_PCT = 0.00260; // 0.260% (0.075% entry + 0.105% exit + 0.080% slippage)
export const MIN_ZERO_LOSS_FLOOR_USDT = 0.0100; // $0.0100 USDT net profit floor
export const ADVERSE_STOP_DRIFT_PCT = -0.00150; // -0.150% adverse divergence stop
export const MAX_ADVERSE_LOSS_PCT = -0.00410; // -0.150% stop - 0.260% fees = -0.410% bounded loss
export const CARRY_DRAG_BREAKER_PCT = 0.00080; // 0.080% hard carry breaker

/**
 * Calculates signed relative expansion strictly from entry basis
 */
export function calculateRelativeExpansionPercent(
  bEntryPercent: number,
  bCurrentPercent: number,
  direction: DivergenceDirection
): number {
  if (direction === 'LONG_BN_SHORT_BYB') {
    return Math.round((bCurrentPercent - bEntryPercent) * 10000) / 10000;
  } else {
    return Math.round((bEntryPercent - bCurrentPercent) * 10000) / 10000;
  }
}

/**
 * Calculates net realized PnL in USDT after deducting conservative roundtrip fees and funding carry
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
 * Widens target hurdle if carry is negative to preserve net alpha floor
 */
export function calculateDynamicTargetPercent(
  baseTargetPercent: number = 0.380,
  accumulatedCarryPercent: number = 0.000
): number {
  if (accumulatedCarryPercent < 0) {
    return Math.round((baseTargetPercent + Math.abs(accumulatedCarryPercent)) * 10000) / 10000;
  }
  return baseTargetPercent;
}

export interface ExitEvaluation {
  shouldExit: boolean;
  reason: 'EXPANSION_TP' | 'STAGNANCY_SCRATCH' | 'ADVERSE_STOP' | 'CARRY_BREAKER' | 'MANDATORY_CEILING' | 'NONE';
  relativeExpansionPercent: number;
  netPnlUsdt: number;
  zeroLossSatisfied: boolean;
  requiresReduceOnly: boolean;
  statusBadge:
    | 'TARGET_REACHED'
    | 'EXPANDING_IN_PROFIT'
    | 'ABSORBING_FRICTION'
    | 'COMPRESSED'
    | 'MOMENTUM_EXTENSION'
    | 'STAGNANCY_SCRATCH'
    | 'ADVERSE_DRIFT'
    | 'EMERGENCY_STOP';
}

/**
 * Evaluates comprehensive exit and risk conditions
 */
export function evaluateExitGates(
  bEntryPercent: number,
  bCurrentPercent: number,
  direction: DivergenceDirection,
  durationMinutes: number,
  accumulatedCarryPercent: number = 0.000,
  notionalUsdt: number = 15.00,
  isMomentumExpanding = false
): ExitEvaluation {
  const relExp = calculateRelativeExpansionPercent(bEntryPercent, bCurrentPercent, direction);
  const dynamicTarget = calculateDynamicTargetPercent(0.380, accumulatedCarryPercent);
  const netPnl = calculateNetRealizedPnlUsdt(notionalUsdt, relExp, accumulatedCarryPercent);
  const zeroLossSatisfied = netPnl >= MIN_ZERO_LOSS_FLOOR_USDT;

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
    };
  }

  // 3. Stagnancy Hard Ceiling (360m unconditional)
  if (durationMinutes >= 360) {
    return {
      shouldExit: true,
      reason: 'MANDATORY_CEILING',
      relativeExpansionPercent: relExp,
      netPnlUsdt: netPnl,
      zeroLossSatisfied,
      requiresReduceOnly: true,
      statusBadge: 'STAGNANCY_SCRATCH',
    };
  }

  // 4. Stagnancy Scratch at 180m (Triple condition: >= 180m AND < 0.120% expansion AND Net PnL <= 0)
  if (durationMinutes >= 180) {
    if (relExp < 0.120 && netPnl <= 0.0) {
      return {
        shouldExit: true,
        reason: 'STAGNANCY_SCRATCH',
        relativeExpansionPercent: relExp,
        netPnlUsdt: netPnl,
        zeroLossSatisfied: false,
        requiresReduceOnly: true,
        statusBadge: 'STAGNANCY_SCRATCH',
      };
    }
  }

  // 5. Take-Profit & Zero-Loss Conjunction Gate (Expansion >= Dynamic Hurdle AND Net PnL >= +$0.0100)
  if (relExp >= dynamicTarget && zeroLossSatisfied) {
    return {
      shouldExit: true,
      reason: 'EXPANSION_TP',
      relativeExpansionPercent: relExp,
      netPnlUsdt: netPnl,
      zeroLossSatisfied: true,
      requiresReduceOnly: true,
      statusBadge: 'TARGET_REACHED',
    };
  }

  // Position continues holding: assign appropriate telemetry badge
  let statusBadge: ExitEvaluation['statusBadge'] = 'COMPRESSED';
  if (relExp < 0) {
    statusBadge = 'ADVERSE_DRIFT';
  } else if (durationMinutes >= 180 && relExp >= 0.200 && isMomentumExpanding) {
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
  };
}

/**
 * Creates mock position for test scenarios
 */
export function createMockPosition(overrides: Partial<DivergencePosition> = {}): DivergencePosition {
  return {
    id: `pos_test_${Date.now()}`,
    symbol: 'SUIUSDT',
    canonicalSymbol: 'SUI',
    direction: 'LONG_BN_SHORT_BYB',
    entryTimestamp: Date.now() - 30 * 60 * 1000, // 30m ago
    entryBasisPercent: 0.020,
    currentBasisPercent: 0.400,
    relativeExpansionPercent: 0.380,
    leg1: {
      venue: 'BINANCE',
      side: 'BUY',
      orderId: 'mock_bn_1',
      clientOrderId: 'div1_mock_1',
      price: 2.15,
      qty: 7.0,
      notional: 15.05,
      feePaidUsdt: 0.0030,
    },
    leg2: {
      venue: 'BYBIT',
      side: 'SELL',
      orderId: 'mock_byb_1',
      clientOrderId: 'div2_mock_1',
      price: 2.15,
      qty: 7.0,
      notional: 15.05,
      feePaidUsdt: 0.0082,
    },
    deltaNet: 0.000,
    accumulatedCarryPercent: 0.000,
    dynamicTargetPercent: 0.380,
    status: 'ACTIVE_EXPANDING',
    ...overrides,
  };
}
