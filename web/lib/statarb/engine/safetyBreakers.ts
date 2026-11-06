/**
 * STATARB-OU-PERP: Global Safety Breakers & System Health Monitor
 * 
 * Enforces strategy-wide safety bounds:
 * - Max Concurrent Positions Gate (default: 5 concurrent slots)
 * - Emergency Kill-Switch & Circuit Breakers
 * - Account Drawdown Protection
 * - System Health Telemetry & Diagnostic Status
 * 
 * 100% standalone with zero legacy dependencies.
 */

import { SystemHealthStatus } from '../types';

export const DEFAULT_MAX_CONCURRENT_POSITIONS = 5;
export const DEFAULT_MAX_DRAWDOWN_PCT = 15.0;

export interface PositionCapacityResult {
  allowed: boolean;
  activeCount: number;
  maxAllowed: number;
  remainingCapacity: number;
  reason: string;
}

export interface DrawdownBreakerResult {
  triggered: boolean;
  currentDrawdownPct: number;
  maxAllowedDrawdownPct: number;
  peakEquityUsdt: number;
  currentEquityUsdt: number;
  reason: string;
}

export interface SafetyCheckResult {
  canTrade: boolean;
  systemStatus: SystemHealthStatus;
  capacity: PositionCapacityResult;
  drawdown: DrawdownBreakerResult;
  killSwitchActive: boolean;
  reasons: string[];
}

/**
 * Evaluates whether concurrent position slots are available.
 */
export function checkConcurrentPositionsLimit(
  activeCount: number,
  maxAllowed: number = DEFAULT_MAX_CONCURRENT_POSITIONS
): PositionCapacityResult {
  const allowed = activeCount < maxAllowed;
  const remainingCapacity = Math.max(0, maxAllowed - activeCount);

  return {
    allowed,
    activeCount,
    maxAllowed,
    remainingCapacity,
    reason: allowed
      ? `Slot capacity available: ${activeCount}/${maxAllowed} active positions (${remainingCapacity} slots free).`
      : `Max concurrent positions limit reached: ${activeCount}/${maxAllowed} active slots full. New entries blocked.`,
  };
}

/**
 * Evaluates portfolio-level drawdown against high-watermark peak equity.
 */
export function checkDrawdownBreaker(
  currentEquityUsdt: number,
  peakEquityUsdt: number,
  maxDrawdownPct: number = DEFAULT_MAX_DRAWDOWN_PCT
): DrawdownBreakerResult {
  if (peakEquityUsdt <= 0 || currentEquityUsdt >= peakEquityUsdt) {
    return {
      triggered: false,
      currentDrawdownPct: 0.0,
      maxAllowedDrawdownPct: maxDrawdownPct,
      peakEquityUsdt: Math.max(currentEquityUsdt, peakEquityUsdt),
      currentEquityUsdt,
      reason: 'No drawdown relative to peak equity.',
    };
  }

  const drawdownPct = ((peakEquityUsdt - currentEquityUsdt) / peakEquityUsdt) * 100;
  const triggered = drawdownPct >= maxDrawdownPct;

  return {
    triggered,
    currentDrawdownPct: parseFloat(drawdownPct.toFixed(2)),
    maxAllowedDrawdownPct: maxDrawdownPct,
    peakEquityUsdt,
    currentEquityUsdt,
    reason: triggered
      ? `Global Drawdown Breaker TRIPPED: Drawdown ${drawdownPct.toFixed(2)}% >= ${maxDrawdownPct.toFixed(2)}% cap. All trading halted.`
      : `Drawdown ${drawdownPct.toFixed(2)}% is within normal operating limits (< ${maxDrawdownPct.toFixed(2)}%).`,
  };
}

/**
 * Comprehensive pre-flight safety check aggregating all safety invariant breakers.
 */
export function evaluateSystemSafety(
  activePositionsCount: number,
  currentEquityUsdt: number,
  peakEquityUsdt: number,
  isKillSwitchEngaged: boolean = false,
  maxConcurrentPositions: number = DEFAULT_MAX_CONCURRENT_POSITIONS,
  maxDrawdownPct: number = DEFAULT_MAX_DRAWDOWN_PCT
): SafetyCheckResult {
  const reasons: string[] = [];
  let systemStatus: SystemHealthStatus = 'HEALTHY';

  // 1. Check Kill-Switch
  if (isKillSwitchEngaged) {
    systemStatus = 'HALTED';
    reasons.push('Emergency Kill-Switch is active. All autonomous trading is halted.');
  }

  // 2. Check Drawdown Breaker
  const drawdown = checkDrawdownBreaker(currentEquityUsdt, peakEquityUsdt, maxDrawdownPct);
  if (drawdown.triggered) {
    systemStatus = 'HALTED';
    reasons.push(drawdown.reason);
  }

  // 3. Check Capacity
  const capacity = checkConcurrentPositionsLimit(activePositionsCount, maxConcurrentPositions);
  if (!capacity.allowed) {
    if (systemStatus === 'HEALTHY') {
      systemStatus = 'DEGRADED';
    }
    reasons.push(capacity.reason);
  }

  const canTrade = !isKillSwitchEngaged && !drawdown.triggered && capacity.allowed;

  return {
    canTrade,
    systemStatus,
    capacity,
    drawdown,
    killSwitchActive: isKillSwitchEngaged,
    reasons,
  };
}
