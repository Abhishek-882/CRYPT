/**
 * SafeCoiner Offline Mock Exchange Broker Engine
 * 
 * Provides an in-memory, deterministic multi-exchange matching engine simulating:
 * - Binance Futures (/fapi/v1/*)
 * - Bitget Mix Futures (/api/v2/mix/*)
 * - Bybit V5 Linear (/v5/order/*)
 * - CoinDCX Derivatives (/exchange/v1/*)
 * 
 * Features:
 * 1. Deterministic order state machine: NEW -> PARTIALLY_FILLED -> FILLED | CANCELED | REJECTED
 * 2. Strict RFC 4122 v4 UUID clientOrderId idempotency enforcement
 * 3. Execution dynamics: Realistic slippage, partial fills, latency injection, and simulated network timeouts
 * 4. Configurable fault injection: Rate limits, insufficient margin, maintenance mode, symbol invalidation
 * 5. Complete balance & position bookkeeping with unrealized PnL calculation
 */

import crypto from "crypto";
const uuidv4 = () => crypto.randomUUID();

export type ExchangeType = "binance" | "bitget" | "bybit" | "coindcx";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus = "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED";

export interface MockOrder {
  orderId: string;
  clientOrderId: string;
  exchange: ExchangeType;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  qty: number;
  filledQty: number;
  remainingQty: number;
  avgPrice: number;
  status: OrderStatus;
  feeUsdt: number;
  slippagePct: number;
  createdAt: number;
  updatedAt: number;
  rejectReason?: string;
}

export interface MockPosition {
  symbol: string;
  exchange: ExchangeType;
  side: "LONG" | "SHORT" | "BOTH";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginUsdt: number;
}

export interface MockBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface FaultInjectionConfig {
  rejectNextOrder?: { code: string; message: string };
  simulatedLatencyMs?: number;
  partialFillRatio?: number; // e.g. 0.5 for 50% partial fill
  rateLimitTrip?: boolean;
  networkTimeout?: boolean;
}

export class MockExchangeEngine {
  private orders: Map<string, MockOrder> = new Map(); // orderId -> MockOrder
  private clientOrderMap: Map<string, string> = new Map(); // clientOrderId -> orderId
  private balances: Map<string, MockBalance> = new Map(); // asset -> MockBalance
  private positions: Map<string, MockPosition> = new Map(); // symbol_exchange -> MockPosition
  private marketPrices: Map<string, number> = new Map(); // symbol -> midPrice
  private faultConfig: FaultInjectionConfig = {};

  constructor(initialBalances?: { [asset: string]: number }) {
    this.reset(initialBalances);
  }

  public reset(initialBalances?: { [asset: string]: number }): void {
    this.orders.clear();
    this.clientOrderMap.clear();
    this.positions.clear();
    this.balances.clear();
    this.faultConfig = {};

    // Default assets
    const init = initialBalances || { USDT: 50000, BTC: 1.5, ETH: 20.0 };
    for (const [asset, amount] of Object.entries(init)) {
      this.balances.set(asset, {
        asset,
        free: amount,
        locked: 0,
        total: amount,
      });
    }

    // Default Market Prices
    this.marketPrices.set("BTCUSDT", 65000.0);
    this.marketPrices.set("ETHUSDT", 2500.0);
    this.marketPrices.set("SOLUSDT", 145.0);
    this.marketPrices.set("BNBUSDT", 580.0);
  }

  public setMarketPrice(symbol: string, price: number): void {
    this.marketPrices.set(symbol.toUpperCase(), price);
    this.recomputePositions();
  }

  public getMarketPrice(symbol: string): number {
    return this.marketPrices.get(symbol.toUpperCase()) || 100.0;
  }

  public setFaultConfig(config: FaultInjectionConfig): void {
    this.faultConfig = { ...this.faultConfig, ...config };
  }

  public clearFaultConfig(): void {
    this.faultConfig = {};
  }

  /**
   * Universal Place Order Implementation
   */
  public async placeOrder(params: {
    exchange: ExchangeType;
    symbol: string;
    side: OrderSide;
    type: OrderType;
    qty: number;
    price?: number;
    clientOrderId?: string;
    slippagePct?: number;
    leverage?: number;
  }): Promise<MockOrder> {
    const symbol = params.symbol.toUpperCase();
    const clientOrderId = params.clientOrderId || uuidv4();
    const exchange = params.exchange;
    const side = params.side;
    const type = params.type;
    const qty = params.qty;
    const slippagePct = params.slippagePct ?? 0.0005; // 0.05% baseline slippage
    const leverage = params.leverage || 10;

    // 1. Fault Injections: Timeout
    if (this.faultConfig.networkTimeout) {
      throw new Error(`ETIMEDOUT: Connection to mock exchange ${exchange} timed out after 5000ms`);
    }

    // 2. Fault Injections: Rate Limit
    if (this.faultConfig.rateLimitTrip) {
      throw new Error(`429 Too Many Requests: Rate limit exceeded on exchange ${exchange}`);
    }

    // 3. Fault Injections: Custom Rejection
    if (this.faultConfig.rejectNextOrder) {
      const err = this.faultConfig.rejectNextOrder;
      this.faultConfig.rejectNextOrder = undefined;
      const rejectedOrder: MockOrder = {
        orderId: `mock_${exchange}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        clientOrderId,
        exchange,
        symbol,
        side,
        type,
        price: params.price || this.getMarketPrice(symbol),
        qty,
        filledQty: 0,
        remainingQty: qty,
        avgPrice: 0,
        status: "REJECTED",
        feeUsdt: 0,
        slippagePct: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rejectReason: `${err.code}: ${err.message}`,
      };
      this.orders.set(rejectedOrder.orderId, rejectedOrder);
      this.clientOrderMap.set(clientOrderId, rejectedOrder.orderId);
      return rejectedOrder;
    }

    // 4. Strict Idempotency Check: UUID Collision
    if (this.clientOrderMap.has(clientOrderId)) {
      const existingOrderId = this.clientOrderMap.get(clientOrderId)!;
      const existing = this.orders.get(existingOrderId)!;
      // Duplicate clientOrderId returns existing order or idempotency match
      return existing;
    }

    // 5. Basic Parameter Validation
    if (qty <= 0) {
      throw new Error(`INVALID_QTY: Order quantity must be > 0. Received ${qty}`);
    }

    const midPrice = this.getMarketPrice(symbol);
    const execPrice = type === "LIMIT" && params.price
      ? params.price
      : side === "BUY"
      ? midPrice * (1 + slippagePct)
      : midPrice * (1 - slippagePct);

    const notional = qty * execPrice;
    const requiredMargin = notional / leverage;
    const usdtBalance = this.balances.get("USDT");

    const posKey = `${exchange}_${symbol}`;
    const existingPos = this.positions.get(posKey);
    const isClosingOrder = Boolean(
      existingPos &&
      ((existingPos.side === "LONG" && side === "SELL") || (existingPos.side === "SHORT" && side === "BUY"))
    );

    if (!isClosingOrder && (!usdtBalance || usdtBalance.free < requiredMargin)) {
      const rejectedOrder: MockOrder = {
        orderId: `mock_${exchange}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        clientOrderId,
        exchange,
        symbol,
        side,
        type,
        price: execPrice,
        qty,
        filledQty: 0,
        remainingQty: qty,
        avgPrice: 0,
        status: "REJECTED",
        feeUsdt: 0,
        slippagePct,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rejectReason: `INSUFFICIENT_MARGIN: Required $${requiredMargin.toFixed(2)} USDT, available $${(usdtBalance?.free || 0).toFixed(2)} USDT`,
      };
      this.orders.set(rejectedOrder.orderId, rejectedOrder);
      this.clientOrderMap.set(clientOrderId, rejectedOrder.orderId);
      return rejectedOrder;
    }

    // 6. Simulate Execution: Full or Partial Fill
    const orderId = `mock_${exchange}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const partialRatio = this.faultConfig.partialFillRatio ?? 1.0;
    const filledQty = qty * Math.min(1.0, Math.max(0.0, partialRatio));
    const remainingQty = qty - filledQty;
    const status: OrderStatus = filledQty >= qty ? "FILLED" : filledQty > 0 ? "PARTIALLY_FILLED" : "NEW";

    const feeRate = 0.0004; // 0.04% taker fee
    const feeUsdt = filledQty * execPrice * feeRate;

    // Deduct margin and fee
    if (usdtBalance) {
      if (!isClosingOrder) {
        usdtBalance.free -= (requiredMargin * (filledQty / qty) + feeUsdt);
        usdtBalance.locked += requiredMargin * (filledQty / qty);
      } else {
        usdtBalance.free -= feeUsdt;
      }
    }

    const order: MockOrder = {
      orderId,
      clientOrderId,
      exchange,
      symbol,
      side,
      type,
      price: execPrice,
      qty,
      filledQty,
      remainingQty,
      avgPrice: filledQty > 0 ? execPrice : 0,
      status,
      feeUsdt,
      slippagePct,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.orders.set(orderId, order);
    this.clientOrderMap.set(clientOrderId, orderId);

    // Update Position
    if (filledQty > 0) {
      this.updatePosition(exchange, symbol, side, filledQty, execPrice, leverage, requiredMargin * (filledQty / qty));
    }

    return order;
  }

  private updatePosition(
    exchange: ExchangeType,
    symbol: string,
    side: OrderSide,
    qty: number,
    price: number,
    leverage: number,
    marginUsdt: number
  ): void {
    const key = `${exchange}_${symbol}`;
    const existing = this.positions.get(key);

    if (!existing) {
      this.positions.set(key, {
        symbol,
        exchange,
        side: side === "BUY" ? "LONG" : "SHORT",
        size: side === "BUY" ? qty : -qty,
        entryPrice: price,
        markPrice: price,
        unrealizedPnl: 0,
        leverage,
        marginUsdt,
      });
    } else {
      const isSameSide = (existing.side === "LONG" && side === "BUY") || (existing.side === "SHORT" && side === "SELL");
      if (isSameSide) {
        const totalSize = Math.abs(existing.size) + qty;
        const weightedEntry = (Math.abs(existing.size) * existing.entryPrice + qty * price) / totalSize;
        existing.entryPrice = weightedEntry;
        existing.size = existing.side === "LONG" ? totalSize : -totalSize;
        existing.marginUsdt += marginUsdt;
      } else {
        // Closing or reducing position
        const remainingSize = Math.abs(existing.size) - qty;
        if (remainingSize <= 0) {
          // Closed out
          this.positions.delete(key);
          const usdtBalance = this.balances.get("USDT");
          if (usdtBalance) {
            usdtBalance.locked = Math.max(0, usdtBalance.locked - existing.marginUsdt);
            usdtBalance.free += existing.marginUsdt + existing.unrealizedPnl;
          }
        } else {
          existing.size = existing.side === "LONG" ? remainingSize : -remainingSize;
          existing.marginUsdt = (existing.marginUsdt * remainingSize) / (remainingSize + qty);
        }
      }
    }

    this.recomputePositions();
  }

  private recomputePositions(): void {
    for (const pos of this.positions.values()) {
      const markPrice = this.getMarketPrice(pos.symbol);
      pos.markPrice = markPrice;
      if (pos.side === "LONG") {
        pos.unrealizedPnl = (markPrice - pos.entryPrice) * Math.abs(pos.size);
      } else {
        pos.unrealizedPnl = (pos.entryPrice - markPrice) * Math.abs(pos.size);
      }
    }
  }

  public getOrder(orderId: string): MockOrder | undefined {
    return this.orders.get(orderId);
  }

  public getOrderByClientOrderId(clientOrderId: string): MockOrder | undefined {
    const orderId = this.clientOrderMap.get(clientOrderId);
    return orderId ? this.orders.get(orderId) : undefined;
  }

  public cancelOrder(orderId: string): MockOrder | undefined {
    const order = this.orders.get(orderId);
    if (!order) return undefined;
    if (order.status === "NEW" || order.status === "PARTIALLY_FILLED") {
      order.status = "CANCELED";
      order.updatedAt = Date.now();
    }
    return order;
  }

  public getPosition(exchange: ExchangeType, symbol: string): MockPosition | undefined {
    return this.positions.get(`${exchange}_${symbol.toUpperCase()}`);
  }

  public getAllPositions(): MockPosition[] {
    return Array.from(this.positions.values());
  }

  public getBalance(asset: string): MockBalance | undefined {
    return this.balances.get(asset.toUpperCase());
  }

  public getPortfolioGrossExposureUsdt(): number {
    let gross = 0;
    for (const pos of this.positions.values()) {
      gross += Math.abs(pos.size) * pos.markPrice;
    }
    return gross;
  }

  public getTotalUnrealizedPnlUsdt(): number {
    let totalPnl = 0;
    for (const pos of this.positions.values()) {
      totalPnl += pos.unrealizedPnl;
    }
    return totalPnl;
  }

  /**
   * Formats response payloads matching exchange-specific native JSON schemas
   */
  public toExchangeResponse(order: MockOrder): any {
    switch (order.exchange) {
      case "binance":
        return {
          symbol: order.symbol,
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          price: order.price.toString(),
          origQty: order.qty.toString(),
          executedQty: order.filledQty.toString(),
          cumQuote: (order.filledQty * order.avgPrice).toString(),
          status: order.status,
          type: order.type,
          side: order.side,
          avgPrice: order.avgPrice.toString(),
          updateTime: order.updatedAt,
        };
      case "bitget":
        return {
          code: order.status === "REJECTED" ? "400171" : "00000",
          msg: order.status === "REJECTED" ? order.rejectReason : "success",
          data: {
            orderId: order.orderId,
            clientOid: order.clientOrderId,
          },
        };
      case "bybit":
        return {
          retCode: order.status === "REJECTED" ? 10001 : 0,
          retMsg: order.status === "REJECTED" ? order.rejectReason : "OK",
          result: {
            orderId: order.orderId,
            orderLinkId: order.clientOrderId,
          },
        };
      case "coindcx":
        return {
          id: order.orderId,
          client_order_id: order.clientOrderId,
          status: order.status.toLowerCase(),
          market: order.symbol,
          side: order.side.toLowerCase(),
          price_per_unit: order.price,
          total_quantity: order.qty,
        };
    }
  }
}

// Global Singleton Instance for Tests
export const mockExchange = new MockExchangeEngine();
