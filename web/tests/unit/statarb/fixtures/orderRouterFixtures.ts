/**
 * Synthetic Order Router Execution Fixtures for STATARB-OU-PERP
 * Target: Maker-Taker Limit Order Router (orderRouter.ts)
 * 
 * Provides:
 * - Mock exchange execution adapters simulating:
 *   - Fast Maker fills (top-of-book GTX Post-Only limit orders)
 *   - 8.0-second timeouts resulting in clean cancellation with $0.00 capital loss
 *   - 120ms counterpart adverse drift (> 8.0 bps abort with $0.00 loss)
 *   - Partial fills (e.g., 40% filled -> cancels resting remainder, sizes Leg 2 IOC to exactly 40%)
 *   - Sub-35ms WebSocket latency tracking and telemetry recording
 *   - 500ms watchdog circuit breaker triggering REST fallback
 *   - Emergency market unwind on catastrophic Leg 2 failure
 * - Factory helpers for ExecutionRequest and standard test scenarios
 */

import {
  ExchangeExecutionAdapter,
  ExchangeVenue,
  OrderSide,
  ExecutionRequest,
} from '@/lib/statarb/execution/orderRouter';
import { StatArbPair, StatArbDirection } from '@/lib/statarb/types';

export interface MockAdapterOptions {
  /** Leg 1 fill behavior: 'INSTANT' | 'PARTIAL' | 'TIMEOUT' | 'REJECT' */
  leg1Behavior?: 'INSTANT' | 'PARTIAL' | 'TIMEOUT' | 'REJECT';
  /** Fraction of Leg 1 filled if PARTIAL (e.g. 0.40 for 40% fill) */
  leg1PartialRatio?: number;
  /** Simulated fill delay in milliseconds */
  leg1FillDelayMs?: number;
  /** WebSocket roundtrip latency in ms (default: 24ms, sub-35ms) */
  leg2WsLatencyMs?: number;
  /** Simulate WebSocket ACK timeout (>500ms) to trigger REST fallback */
  leg2WsTimeout?: boolean;
  /** Simulate catastrophic failure on both WS and REST fallback */
  leg2CatastrophicFailure?: boolean;
  /** Simulated counterpart price drift trajectory */
  counterpartDriftBps?: number;
}

export interface OrderAuditLog {
  placedMakerOrders: Array<{
    venue: ExchangeVenue;
    symbol: string;
    side: OrderSide;
    price: number;
    qty: number;
    clientOrderId: string;
    timeInForce: 'GTX' | 'PostOnly';
    timestamp: number;
  }>;
  cancelledOrders: Array<{
    venue: ExchangeVenue;
    symbol: string;
    orderId: string;
    clientOrderId: string;
    timestamp: number;
  }>;
  placedTakerOrders: Array<{
    venue: ExchangeVenue;
    symbol: string;
    side: OrderSide;
    qty: number;
    clientOrderId: string;
    useWebSocket: boolean;
    latencyMs: number;
    timestamp: number;
  }>;
  emergencyUnwinds: Array<{
    venue: ExchangeVenue;
    symbol: string;
    side: OrderSide;
    qty: number;
    timestamp: number;
  }>;
}

/**
 * High-fidelity controllable Mock Exchange Execution Adapter
 */
export class MockExchangeExecutionAdapter implements ExchangeExecutionAdapter {
  public options: MockAdapterOptions;
  public auditLog: OrderAuditLog = {
    placedMakerOrders: [],
    cancelledOrders: [],
    placedTakerOrders: [],
    emergencyUnwinds: [],
  };

  private orderState: Map<
    string,
    {
      venue: ExchangeVenue;
      symbol: string;
      side: OrderSide;
      price: number;
      qty: number;
      executedQty: number;
      status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
      placedAt: number;
    }
  > = new Map();

  constructor(options: MockAdapterOptions = {}) {
    this.options = {
      leg1Behavior: 'INSTANT',
      leg1PartialRatio: 0.40,
      leg1FillDelayMs: 0,
      leg2WsLatencyMs: 24, // 24ms sub-35ms baseline
      leg2WsTimeout: false,
      leg2CatastrophicFailure: false,
      counterpartDriftBps: 0,
      ...options,
    };
  }

  public resetAudit(): void {
    this.auditLog = {
      placedMakerOrders: [],
      cancelledOrders: [],
      placedTakerOrders: [],
      emergencyUnwinds: [],
    };
    this.orderState.clear();
  }

  async placeMakerLimit(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    price: number,
    qty: number,
    clientOrderId: string,
    timeInForce: 'GTX' | 'PostOnly'
  ): Promise<{ orderId: string; status: 'NEW' | 'REJECTED'; rejectReason?: string }> {
    const timestamp = Date.now();
    this.auditLog.placedMakerOrders.push({
      venue,
      symbol,
      side,
      price,
      qty,
      clientOrderId,
      timeInForce,
      timestamp,
    });

    if (this.options.leg1Behavior === 'REJECT') {
      return {
        orderId: '',
        status: 'REJECTED',
        rejectReason: 'Post-Only order would cross spread / immediately match',
      };
    }

    const orderId = `mock_maker_${timestamp}_${Math.floor(Math.random() * 1000)}`;
    this.orderState.set(orderId, {
      venue,
      symbol,
      side,
      price,
      qty,
      executedQty: 0,
      status: 'NEW',
      placedAt: timestamp,
    });

    return { orderId, status: 'NEW' };
  }

  async cancelOrder(
    venue: ExchangeVenue,
    symbol: string,
    orderId: string,
    clientOrderId: string
  ): Promise<{ success: boolean; executedQty: number }> {
    const timestamp = Date.now();
    this.auditLog.cancelledOrders.push({
      venue,
      symbol,
      orderId,
      clientOrderId,
      timestamp,
    });

    const order = this.orderState.get(orderId);
    if (order) {
      order.status = 'CANCELLED';
      return { success: true, executedQty: order.executedQty };
    }
    return { success: true, executedQty: 0 };
  }

  async pollOrderStatus(
    venue: ExchangeVenue,
    symbol: string,
    orderId: string,
    clientOrderId: string
  ): Promise<{
    status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
    executedQty: number;
    avgPrice: number;
  }> {
    const order = this.orderState.get(orderId);
    if (!order) {
      return { status: 'CANCELLED', executedQty: 0, avgPrice: 0 };
    }

    if (order.status === 'CANCELLED') {
      return { status: 'CANCELLED', executedQty: order.executedQty, avgPrice: order.price };
    }

    // Determine behavior based on test options
    if (this.options.leg1Behavior === 'TIMEOUT') {
      // Never fills, remains NEW until canceled by 8s watchdog
      return { status: 'NEW', executedQty: 0, avgPrice: order.price };
    }

    if (this.options.leg1Behavior === 'PARTIAL') {
      const ratio = this.options.leg1PartialRatio ?? 0.40;
      const partialQty = parseFloat((order.qty * ratio).toFixed(4));
      order.status = 'PARTIALLY_FILLED';
      order.executedQty = partialQty;
      return {
        status: 'PARTIALLY_FILLED',
        executedQty: partialQty,
        avgPrice: order.price,
      };
    }

    // Default: INSTANT FULL FILL
    order.status = 'FILLED';
    order.executedQty = order.qty;
    return {
      status: 'FILLED',
      executedQty: order.qty,
      avgPrice: order.price,
    };
  }

  async placeTakerIoc(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    qty: number,
    clientOrderId: string,
    useWebSocket: boolean
  ): Promise<{
    orderId: string;
    executedQty: number;
    avgPrice: number;
    feeUsdt: number;
    latencyMs: number;
  }> {
    const timestamp = Date.now();

    if (this.options.leg2CatastrophicFailure) {
      throw new Error('Simulated catastrophic failure: venue rejected order on both WS and REST');
    }

    if (useWebSocket && this.options.leg2WsTimeout) {
      // Simulate WebSocket network stall / ACK dropped
      await new Promise((resolve) => setTimeout(resolve, 600));
      throw new Error('WebSocket ACK timeout (> 500ms)');
    }

    const latencyMs = useWebSocket ? (this.options.leg2WsLatencyMs ?? 24) : 75;
    const feeRate = venue === 'BYBIT' ? 0.00055 : 0.00050;

    this.auditLog.placedTakerOrders.push({
      venue,
      symbol,
      side,
      qty,
      clientOrderId,
      useWebSocket,
      latencyMs,
      timestamp,
    });

    return {
      orderId: `mock_taker_${timestamp}_${Math.floor(Math.random() * 1000)}`,
      executedQty: qty,
      avgPrice: 1.0,
      feeUsdt: parseFloat((qty * 1.0 * feeRate).toFixed(4)),
      latencyMs,
    };
  }

  async emergencyMarketUnwind(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    qty: number
  ): Promise<{ success: boolean; executedQty: number; avgPrice: number }> {
    const timestamp = Date.now();
    this.auditLog.emergencyUnwinds.push({
      venue,
      symbol,
      side,
      qty,
      timestamp,
    });

    return {
      success: true,
      executedQty: qty,
      avgPrice: 1.0,
    };
  }
}

/**
 * Creates a standard mock StatArbPair for execution tests
 */
export function createMockExecutionPair(overrides: Partial<StatArbPair> = {}): StatArbPair {
  return {
    canonicalSymbol: 'BTC',
    binanceSymbol: 'BTCUSDT',
    bybitSymbol: 'BTCUSDT',
    multiplier: 1.0,
    binanceMid: 60000.0,
    bybitMid: 59800.0,
    grossBasisBps: 33.44,
    orderBookDepthRatio: 5.0,
    binanceSpreadBps: 3.0,
    bybitSpreadBps: 3.5,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

/**
 * Creates a default standard ExecutionRequest
 */
export function createMockExecutionRequest(
  overrides: Partial<ExecutionRequest> = {}
): ExecutionRequest {
  const pair = overrides.pair || createMockExecutionPair();
  const quantity = overrides.quantity ?? 0.002; // 0.002 BTC @ 60,000 = $120 USDT

  return {
    pair,
    direction: 'SHORT_BINANCE_LONG_BYBIT' as StatArbDirection,
    notionalUsdt: 120.0,
    quantity,
    leg1Venue: 'BINANCE',
    leg2Venue: 'BYBIT',
    leg1Symbol: 'BTCUSDT',
    leg2Symbol: 'BTCUSDT',
    leg1Side: 'SELL', // Selling rich venue
    leg2Side: 'BUY',  // Buying cheap venue
    leg1BestBid: 59999.0,
    leg1BestAsk: 60000.0,
    leg2InitialPrice: 59800.0,
    tickSize: 0.1,
    timeoutMs: 8000,
    maxAdverseDriftBps: 8.0,
    driftCheckIntervalMs: 120,
    ...overrides,
  };
}
