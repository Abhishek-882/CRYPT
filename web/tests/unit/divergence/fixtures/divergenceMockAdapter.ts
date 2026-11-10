/**
 * Divergence Bot Mock Execution Adapter & Interfaces Fixture
 * Target: Opaque-Box E2E Testing for Basis Divergence Bot
 * 
 * Primary Invariants:
 * - ZERO BPS NOTATION: All spreads, basis, hurdles, fees strictly in % notation.
 * - STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * - DELTA-NEUTRALITY: Verify |Delta_net| < 0.001.
 */

export type ExchangeVenue = 'BINANCE' | 'BYBIT';
export type OrderSide = 'BUY' | 'SELL';
export type DivergenceDirection = 'LONG_BN_SHORT_BYB' | 'SHORT_BN_LONG_BYB';
export type DivergenceFsmState =
  | 'PAUSED'
  | 'IDLE'
  | 'SCANNING'
  | 'BALANCING'
  | 'RECONCILING'
  | 'ACTIVE_EXPANDING'
  | 'EXITING'
  | 'SCRATCH_UNWINDING'
  | 'EMERGENCY_STOPPING'
  | 'EMERGENCY_KILLED';

export interface DivergenceConfig {
  maxConcurrentPositions: number; // Hard-locked: 1
  maxPositionsPerSymbol: number;   // Hard-locked: 1
  maxCapitalAllocationUsdt: number; // Hard-locked: 15.00 USDT
  orderNotionalUsdt: number;       // Hard-locked: 15.00 USDT
  minDispersion24hPercent: number; // 0.400%
  maxLiveCompressionPercent: number; // 0.100%
  antiCollisionSanityPercent: number; // 5.000%
  relativeExpansionTargetPercent: number; // 0.380%
  zeroLossNetHurdleUsdt: number;   // 0.0100 USDT
  adverseStopLossPercent: number;  // -0.150%
  nominalStagnancyMinutes: number; // 180m
  maxStagnancyCeilingMinutes: number; // 360m
  makerWatchdogMs: number;         // 8000ms
  adverseDriftWatchdogPercent: number; // 0.080%
  adverseDriftSampleMs: number;    // 120ms
  wsWatchdogTimeoutMs: number;     // 500ms
  partialFillReconcileMs: number;  // 500ms
}

export function getDefaultDivergenceConfig(): DivergenceConfig {
  return {
    maxConcurrentPositions: 3,
    maxPositionsPerSymbol: 1,
    maxCapitalAllocationUsdt: 60.00,
    orderNotionalUsdt: 15.00,
    minDispersion24hPercent: 0.400,
    maxLiveCompressionPercent: 0.100,
    antiCollisionSanityPercent: 5.000,
    relativeExpansionTargetPercent: 0.380,
    zeroLossNetHurdleUsdt: 0.0100,
    adverseStopLossPercent: -0.150,
    nominalStagnancyMinutes: 180,
    maxStagnancyCeilingMinutes: 360,
    makerWatchdogMs: 8000,
    adverseDriftWatchdogPercent: 0.080,
    adverseDriftSampleMs: 120,
    wsWatchdogTimeoutMs: 500,
    partialFillReconcileMs: 500,
  };
}

export interface DivergencePosition {
  id: string;
  symbol: string;
  canonicalSymbol: string;
  direction: DivergenceDirection;
  entryTimestamp: number;
  entryBasisPercent: number;
  currentBasisPercent: number;
  relativeExpansionPercent: number;
  leg1: {
    venue: ExchangeVenue;
    side: OrderSide;
    orderId: string;
    clientOrderId: string;
    price: number;
    qty: number;
    notional: number;
    feePaidUsdt: number;
  };
  leg2: {
    venue: ExchangeVenue;
    side: OrderSide;
    orderId: string;
    clientOrderId: string;
    price: number;
    qty: number;
    notional: number;
    feePaidUsdt: number;
  };
  deltaNet: number;
  accumulatedCarryPercent: number;
  dynamicTargetPercent: number;
  netRealizedPnlUsdt?: number;
  status:
    | 'ACTIVE_EXPANDING'
    | 'MOMENTUM_EXTENSION'
    | 'TARGET_REACHED'
    | 'ABSORBING_FRICTION'
    | 'COMPRESSED'
    | 'STAGNANCY_SCRATCH'
    | 'ADVERSE_DRIFT'
    | 'EMERGENCY_STOP';
}

export interface DivergenceClosedPosition extends DivergencePosition {
  exitTimestamp: number;
  exitBasisPercent: number;
  exitReason:
    | 'EXPANSION_TP'
    | 'STAGNANCY_SCRATCH'
    | 'ADVERSE_STOP'
    | 'MANUAL_UNWIND'
    | 'EMERGENCY_KILL';
  totalFrictionPercent: number;
  netPnlUsdt: number;
  netRoiPercent: number;
}

export interface DivergenceTelemetry {
  loopCount: number;
  lastTickMs: number;
  activePositionsCount: number;
  candidateCount: number;
  totalRealizedAlphaUsdt: number;
  winCount: number;
  lossCount: number;
  makerTimeoutCount: number;
  adverseDriftAbortCount: number;
  wsFallbackCount: number;
  partialReconcileCount: number;
  emergencyUnwindCount: number;
  lastError?: string;
}

export interface DivergenceStateSchema {
  version: string;
  isRunning: boolean; // MUST DEFAULT TO false
  fsmState: DivergenceFsmState;
  config: DivergenceConfig;
  activePositions: Record<string, DivergencePosition>;
  closedPositions: DivergenceClosedPosition[];
  telemetry: DivergenceTelemetry;
  lastUpdated: number;
}

export function createInitialDivergenceState(version = '1.0.0'): DivergenceStateSchema {
  return {
    version,
    isRunning: false,
    fsmState: 'PAUSED',
    config: getDefaultDivergenceConfig(),
    activePositions: {},
    closedPositions: [],
    telemetry: {
      loopCount: 0,
      lastTickMs: Date.now(),
      activePositionsCount: 0,
      candidateCount: 0,
      totalRealizedAlphaUsdt: 0.0000,
      winCount: 0,
      lossCount: 0,
      makerTimeoutCount: 0,
      adverseDriftAbortCount: 0,
      wsFallbackCount: 0,
      partialReconcileCount: 0,
      emergencyUnwindCount: 0,
    },
    lastUpdated: Date.now(),
  };
}

export interface OrderFillReceipt {
  orderId: string;
  clientOrderId: string;
  venue: ExchangeVenue;
  symbol: string;
  side: OrderSide;
  price: number;
  executedQty: number;
  notional: number;
  feePaidUsdt: number;
  isMaker: boolean;
  reduceOnly: boolean;
  latencyMs: number;
  timestamp: number;
}

export interface ExecutionResult {
  success: boolean;
  positionId?: string;
  leg1Fill?: OrderFillReceipt;
  leg2Fill?: OrderFillReceipt;
  reconciliationAction?: 'NONE' | 'TRIMMED' | 'UNWOUND';
  error?: string;
  unwindReceipt?: OrderFillReceipt;
}

export interface MockAdapterOptions {
  leg1Behavior?: 'INSTANT' | 'PARTIAL' | 'TIMEOUT' | 'ADVERSE_DRIFT' | 'REJECT';
  leg1PartialRatio?: number;
  leg2WsFails?: boolean;
  leg2RestFails?: boolean;
  emergencyUnwindFails?: boolean;
  leg2WsLatencyMs?: number;
}

/**
 * High-fidelity Mock Execution Adapter for Divergence Bot E2E Testing
 */
export class DivergenceMockExecutionAdapter {
  public options: MockAdapterOptions;
  public placedOrders: OrderFillReceipt[] = [];
  public cancelledOrders: Array<{ venue: ExchangeVenue; clientOrderId: string; reason: string }> = [];
  public emergencyUnwinds: Array<{ venue: ExchangeVenue; symbol: string; qty: number; reduceOnly: boolean }> = [];
  public currentNetExposure: number = 0;

  constructor(options: MockAdapterOptions = {}) {
    this.options = {
      leg1Behavior: 'INSTANT',
      leg1PartialRatio: 1.0,
      leg2WsFails: false,
      leg2RestFails: false,
      emergencyUnwindFails: false,
      leg2WsLatencyMs: 22,
      ...options,
    };
  }

  public reset(options?: MockAdapterOptions) {
    if (options) this.options = { ...this.options, ...options };
    this.placedOrders = [];
    this.cancelledOrders = [];
    this.emergencyUnwinds = [];
    this.currentNetExposure = 0;
  }

  /**
   * Executes dual-leg entry with Maker-Taker router logic and watchdogs
   */
  public async executeEntry(
    symbol: string,
    direction: DivergenceDirection,
    targetNotional: number,
    price1: number,
    price2: number,
    quantumStep: number = 1.0
  ): Promise<ExecutionResult> {
    if (targetNotional < 5.0) {
      return { success: false, error: 'MIN_NOTIONAL_VIOLATION' };
    }

    const leg1Venue: ExchangeVenue = 'BINANCE';
    const leg2Venue: ExchangeVenue = 'BYBIT';
    const leg1Side: OrderSide = direction === 'LONG_BN_SHORT_BYB' ? 'BUY' : 'SELL';
    const leg2Side: OrderSide = direction === 'LONG_BN_SHORT_BYB' ? 'SELL' : 'BUY';

    const baseQty = Math.floor((targetNotional / price1) / quantumStep) * quantumStep;
    if (baseQty * price1 < 5.0 || baseQty * price2 < 5.0) {
      return { success: false, error: 'MIN_NOTIONAL_VIOLATION' };
    }

    // Step 1: Leg 1 Maker Limit Order
    const leg1ClientOrderId = `div1_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (this.options.leg1Behavior === 'TIMEOUT') {
      this.cancelledOrders.push({
        venue: leg1Venue,
        clientOrderId: leg1ClientOrderId,
        reason: 'MAKER_WATCHDOG_TIMEOUT_8000MS',
      });
      return { success: false, error: 'MAKER_WATCHDOG_TIMEOUT' };
    }

    if (this.options.leg1Behavior === 'ADVERSE_DRIFT') {
      this.cancelledOrders.push({
        venue: leg1Venue,
        clientOrderId: leg1ClientOrderId,
        reason: 'ADVERSE_DRIFT_EXCEEDED_0.080%',
      });
      return { success: false, error: 'ADVERSE_DRIFT_ABORT' };
    }

    if (this.options.leg1Behavior === 'REJECT') {
      return { success: false, error: 'ORDER_BOOK_CROSS_REJECTED' };
    }

    const fillRatio = this.options.leg1Behavior === 'PARTIAL' ? (this.options.leg1PartialRatio ?? 0.4) : 1.0;
    const executedQty1 = Math.round(baseQty * fillRatio * 1000) / 1000;
    const notional1 = executedQty1 * price1;

    const leg1Receipt: OrderFillReceipt = {
      orderId: `ord_bn_${Date.now()}`,
      clientOrderId: leg1ClientOrderId,
      venue: leg1Venue,
      symbol,
      side: leg1Side,
      price: price1,
      executedQty: executedQty1,
      notional: notional1,
      feePaidUsdt: notional1 * 0.0002, // 0.020% maker fee
      isMaker: true,
      reduceOnly: false,
      latencyMs: 120,
      timestamp: Date.now(),
    };
    this.placedOrders.push(leg1Receipt);
    this.currentNetExposure += (leg1Side === 'BUY' ? 1 : -1) * executedQty1;

    // Step 2: Leg 2 WebSocket IOC Taker
    const leg2ClientOrderId = `div2_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let leg2Filled = false;
    let leg2Receipt: OrderFillReceipt | undefined;
    let wsFallbackOccurred = false;

    if (!this.options.leg2WsFails) {
      leg2Filled = true;
      const notional2 = executedQty1 * price2;
      leg2Receipt = {
        orderId: `ord_byb_${Date.now()}`,
        clientOrderId: leg2ClientOrderId,
        venue: leg2Venue,
        symbol,
        side: leg2Side,
        price: price2,
        executedQty: executedQty1,
        notional: notional2,
        feePaidUsdt: notional2 * 0.00055, // 0.055% taker fee
        isMaker: false,
        reduceOnly: false,
        latencyMs: this.options.leg2WsLatencyMs ?? 22,
        timestamp: Date.now(),
      };
      this.placedOrders.push(leg2Receipt);
      this.currentNetExposure += (leg2Side === 'BUY' ? 1 : -1) * executedQty1;
    } else {
      // WS Timeout (500ms watchdog tripped)
      if (!this.options.leg2RestFails) {
        // REST fallback succeeds
        wsFallbackOccurred = true;
        leg2Filled = true;
        const notional2 = executedQty1 * price2;
        leg2Receipt = {
          orderId: `ord_byb_rest_${Date.now()}`,
          clientOrderId: leg2ClientOrderId,
          venue: leg2Venue,
          symbol,
          side: leg2Side,
          price: price2,
          executedQty: executedQty1,
          notional: notional2,
          feePaidUsdt: notional2 * 0.00055,
          isMaker: false,
          reduceOnly: false,
          latencyMs: 240, // REST latency
          timestamp: Date.now(),
        };
        this.placedOrders.push(leg2Receipt);
        this.currentNetExposure += (leg2Side === 'BUY' ? 1 : -1) * executedQty1;
      }
    }

    // Step 3: Handle Leg 2 Catastrophic Failure -> Emergency Market Unwind
    if (!leg2Filled) {
      if (this.options.emergencyUnwindFails) {
        return {
          success: false,
          error: 'EMERGENCY_UNWIND_REJECTED',
          leg1Fill: leg1Receipt,
        };
      }

      // Execute Emergency Market Unwind of Leg 1 with reduceOnly: true
      const unwindSide: OrderSide = leg1Side === 'BUY' ? 'SELL' : 'BUY';
      const unwindReceipt: OrderFillReceipt = {
        orderId: `unwind_${Date.now()}`,
        clientOrderId: `unwind_${leg1ClientOrderId}`,
        venue: leg1Venue,
        symbol,
        side: unwindSide,
        price: price1,
        executedQty: executedQty1,
        notional: executedQty1 * price1,
        feePaidUsdt: (executedQty1 * price1) * 0.0005,
        isMaker: false,
        reduceOnly: true, // MANDATORY INVARIANT
        latencyMs: 35,
        timestamp: Date.now(),
      };
      this.placedOrders.push(unwindReceipt);
      this.emergencyUnwinds.push({
        venue: leg1Venue,
        symbol,
        qty: executedQty1,
        reduceOnly: true,
      });
      this.currentNetExposure += (unwindSide === 'BUY' ? 1 : -1) * executedQty1;

      return {
        success: false,
        reconciliationAction: 'UNWOUND',
        error: 'LEG2_CATASTROPHIC_FAILURE_UNWOUND',
        leg1Fill: leg1Receipt,
        unwindReceipt,
      };
    }

    const reconAction = this.options.leg1Behavior === 'PARTIAL' ? 'TRIMMED' : 'NONE';
    return {
      success: true,
      positionId: `pos_${symbol}_${Date.now()}`,
      leg1Fill: leg1Receipt,
      leg2Fill: leg2Receipt,
      reconciliationAction: reconAction,
    };
  }

  /**
   * Executes dual-leg exit with mandatory reduceOnly: true
   */
  public async executeExit(
    position: DivergencePosition,
    price1: number,
    price2: number,
    reduceOnly = true
  ): Promise<ExecutionResult> {
    if (!reduceOnly) {
      throw new Error('MANDATORY_INVARIANT_VIOLATION: reduceOnly MUST be true on exits');
    }

    const exitSide1: OrderSide = position.leg1.side === 'BUY' ? 'SELL' : 'BUY';
    const exitSide2: OrderSide = position.leg2.side === 'BUY' ? 'SELL' : 'BUY';

    const exitReceipt1: OrderFillReceipt = {
      orderId: `exit_bn_${Date.now()}`,
      clientOrderId: `exit_div1_${position.id}`,
      venue: position.leg1.venue,
      symbol: position.symbol,
      side: exitSide1,
      price: price1,
      executedQty: position.leg1.qty,
      notional: position.leg1.qty * price1,
      feePaidUsdt: (position.leg1.qty * price1) * 0.0005,
      isMaker: false,
      reduceOnly: true,
      latencyMs: 25,
      timestamp: Date.now(),
    };

    const exitReceipt2: OrderFillReceipt = {
      orderId: `exit_byb_${Date.now()}`,
      clientOrderId: `exit_div2_${position.id}`,
      venue: position.leg2.venue,
      symbol: position.symbol,
      side: exitSide2,
      price: price2,
      executedQty: position.leg2.qty,
      notional: position.leg2.qty * price2,
      feePaidUsdt: (position.leg2.qty * price2) * 0.00055,
      isMaker: false,
      reduceOnly: true,
      latencyMs: 24,
      timestamp: Date.now(),
    };

    this.placedOrders.push(exitReceipt1, exitReceipt2);
    this.currentNetExposure = 0;

    return {
      success: true,
      positionId: position.id,
      leg1Fill: exitReceipt1,
      leg2Fill: exitReceipt2,
      reconciliationAction: 'NONE',
    };
  }
}
