/**
 * Vitest Unit Tests: Mock Order Dispatch & Offline Broker Simulation
 * 
 * Verifies Mock Exchange Execution:
 * - Multi-exchange matching (Binance, Bitget, Bybit, CoinDCX)
 * - Strict clientOrderId UUID v4 idempotency (duplicate prevention)
 * - Slippage modeling & partial fills
 * - Fault injection: timeouts, rate limits (429), insufficient margin
 * - Portfolio gross exposure & mark-to-market position bookkeeping
 */

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
const uuidv4 = () => crypto.randomUUID();
import { mockExchange, MockExchangeEngine } from "../mockExchange";

describe("Offline Mock Exchange Dispatch Engine", () => {
  beforeEach(() => {
    mockExchange.reset({ USDT: 10000 });
  });

  describe("Multi-Exchange Order Placement & Idempotency", () => {
    it("should place and fill a Binance MARKET order with clientOrderId", async () => {
      const clientOrderId = uuidv4();
      const order = await mockExchange.placeOrder({
        exchange: "binance",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 0.05,
        clientOrderId,
      });

      expect(order.status).toBe("FILLED");
      expect(order.exchange).toBe("binance");
      expect(order.clientOrderId).toBe(clientOrderId);
      expect(order.filledQty).toBe(0.05);
      expect(order.avgPrice).toBeGreaterThan(60000);

      // Verify native exchange response schema formatting
      const res = mockExchange.toExchangeResponse(order);
      expect(res.symbol).toBe("BTCUSDT");
      expect(res.clientOrderId).toBe(clientOrderId);
      expect(res.status).toBe("FILLED");
    });

    it("should strictly enforce clientOrderId idempotency across duplicate submissions", async () => {
      const uniqueClientOrderId = uuidv4();

      // First submission
      const order1 = await mockExchange.placeOrder({
        exchange: "bybit",
        symbol: "ETHUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 0.1,
        clientOrderId: uniqueClientOrderId,
      });

      // Duplicate submission with same clientOrderId
      const order2 = await mockExchange.placeOrder({
        exchange: "bybit",
        symbol: "ETHUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 0.1,
        clientOrderId: uniqueClientOrderId,
      });

      // Must be identical order, no second fill or double fee
      expect(order1.orderId).toBe(order2.orderId);
      expect(order1.clientOrderId).toBe(order2.clientOrderId);
      expect(order1.createdAt).toBe(order2.createdAt);
    });

    it("should handle Bitget and CoinDCX orders accurately", async () => {
      const bitgetOrder = await mockExchange.placeOrder({
        exchange: "bitget",
        symbol: "SOLUSDT",
        side: "SELL",
        type: "MARKET",
        qty: 2.0,
      });
      expect(bitgetOrder.exchange).toBe("bitget");
      expect(bitgetOrder.status).toBe("FILLED");

      const bitgetRes = mockExchange.toExchangeResponse(bitgetOrder);
      expect(bitgetRes.code).toBe("00000");
      expect(bitgetRes.data.orderId).toBe(bitgetOrder.orderId);

      const coindcxOrder = await mockExchange.placeOrder({
        exchange: "coindcx",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 0.01,
      });
      expect(coindcxOrder.exchange).toBe("coindcx");
      expect(coindcxOrder.status).toBe("FILLED");
    });
  });

  describe("Execution Dynamics: Slippage & Partial Fills", () => {
    it("should apply buy-side slippage above mid price", async () => {
      mockExchange.setMarketPrice("ETHUSDT", 2500.0);
      const order = await mockExchange.placeOrder({
        exchange: "binance",
        symbol: "ETHUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 0.1,
        slippagePct: 0.001, // 0.1% slippage
      });

      // 2500 * 1.001 = 2502.5
      expect(order.avgPrice).toBeCloseTo(2502.5, 1);
    });

    it("should simulate partial fills when configured", async () => {
      mockExchange.setFaultConfig({ partialFillRatio: 0.4 }); // 40% fill

      const order = await mockExchange.placeOrder({
        exchange: "binance",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        qty: 1.0,
        price: 65000,
      });

      expect(order.status).toBe("PARTIALLY_FILLED");
      expect(order.filledQty).toBeCloseTo(0.4, 2);
      expect(order.remainingQty).toBeCloseTo(0.6, 2);

      mockExchange.clearFaultConfig();
    });
  });

  describe("Fault Injections: Network Errors & Rejections", () => {
    it("should throw simulated timeout error when networkTimeout fault is active", async () => {
      mockExchange.setFaultConfig({ networkTimeout: true });

      await expect(
        mockExchange.placeOrder({
          exchange: "binance",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          qty: 0.01,
        })
      ).rejects.toThrow(/ETIMEDOUT/);

      mockExchange.clearFaultConfig();
    });

    it("should throw 429 rate limit error when rateLimitTrip fault is active", async () => {
      mockExchange.setFaultConfig({ rateLimitTrip: true });

      await expect(
        mockExchange.placeOrder({
          exchange: "bybit",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          qty: 0.01,
        })
      ).rejects.toThrow(/429 Too Many Requests/);

      mockExchange.clearFaultConfig();
    });

    it("should reject order when available margin is insufficient", async () => {
      // Balance is only 10 USDT
      const poorEngine = new MockExchangeEngine({ USDT: 10 });
      const order = await poorEngine.placeOrder({
        exchange: "binance",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 1.0, // 1 BTC @ 65k with 10x leverage requires $6,500 margin
      });

      expect(order.status).toBe("REJECTED");
      expect(order.rejectReason).toContain("INSUFFICIENT_MARGIN");
    });
  });

  describe("Position & Unrealized PnL Bookkeeping", () => {
    it("should track position and update unrealized PnL when mark price shifts", async () => {
      mockExchange.setMarketPrice("ETHUSDT", 2500.0);
      await mockExchange.placeOrder({
        exchange: "binance",
        symbol: "ETHUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 1.0,
        slippagePct: 0,
      });

      const pos = mockExchange.getPosition("binance", "ETHUSDT");
      expect(pos).toBeDefined();
      expect(pos!.side).toBe("LONG");
      expect(pos!.size).toBe(1.0);

      // Price rises to 2600 (+100 USDT profit on 1 ETH)
      mockExchange.setMarketPrice("ETHUSDT", 2600.0);
      expect(pos!.unrealizedPnl).toBeCloseTo(100.0, 0);

      // Price falls to 2400 (-100 USDT loss on 1 ETH)
      mockExchange.setMarketPrice("ETHUSDT", 2400.0);
      expect(pos!.unrealizedPnl).toBeCloseTo(-100.0, 0);
    });

    it("should compute accurate portfolio gross exposure", async () => {
      mockExchange.setMarketPrice("BTCUSDT", 60000.0);
      mockExchange.setMarketPrice("ETHUSDT", 2000.0);

      await mockExchange.placeOrder({
        exchange: "binance",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        qty: 0.01, // $600 exposure
      });

      await mockExchange.placeOrder({
        exchange: "bybit",
        symbol: "ETHUSDT",
        side: "SELL",
        type: "MARKET",
        qty: 0.2, // $400 exposure
      });

      const gross = mockExchange.getPortfolioGrossExposureUsdt();
      expect(gross).toBeCloseTo(1000.0, 1);
    });
  });
});
