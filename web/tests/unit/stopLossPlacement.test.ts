/**
 * Vitest Unit Tests: Broker-Side Protective Stop-Loss Order Placement (Track B-01 / RISK-02)
 * 
 * Verifies:
 * 1. Option B Dynamic Liquidation Buffer Stop Loss calculation (liquidationCalculator.ts)
 * 2. Adaptive leverage calibration (5x vs 10x vs 20x)
 * 3. Unified broker stop placement & cancellation across Binance, Bitget, Bybit, CoinDCX (protectiveStopManager.ts)
 * 4. Error isolation and reduction of liquidation vulnerability
 */

import { describe, it, expect } from "vitest";
import { calculateDynamicLiquidationStop } from "../../lib/liquidationCalculator";
import { placeVenueProtectiveStop, cancelVenueProtectiveStop } from "../../lib/protectiveStopManager";

describe("Milestone 7: Broker-Side Protective Stop-Loss Engine (Option B Locked)", () => {
  describe("Dynamic Liquidation Stop-Loss Calculation", () => {
    it("should compute dynamic liquidation stop for Long (BUY) position at 10x leverage", () => {
      const entryPrice = 65000.0;
      const leverage = 10;
      const res = calculateDynamicLiquidationStop("BUY", entryPrice, leverage, 0.005, 0.50);

      expect(res.positionSide).toBe("BUY");
      expect(res.stopSide).toBe("SELL");
      expect(res.entryPrice).toBe(65000);
      expect(res.leverage).toBe(10);

      // Long liquidation price must be below entry price
      expect(res.estimatedLiquidationPrice).toBeLessThan(entryPrice);
      // Stop price must be between entry and liquidation price (breathing room)
      expect(res.stopPrice).toBeLessThan(entryPrice);
      expect(res.stopPrice).toBeGreaterThan(res.estimatedLiquidationPrice);

      // At 50% buffer, stopDistancePct should be approx half of distanceToLiquidationPct
      expect(res.stopDistancePct).toBeCloseTo(res.distanceToLiquidationPct / 2, 1);
    });

    it("should compute dynamic liquidation stop for Short (SELL) position at 10x leverage", () => {
      const entryPrice = 65000.0;
      const leverage = 10;
      const res = calculateDynamicLiquidationStop("SELL", entryPrice, leverage, 0.005, 0.50);

      expect(res.positionSide).toBe("SELL");
      expect(res.stopSide).toBe("BUY");
      expect(res.entryPrice).toBe(65000);

      // Short liquidation price must be above entry price
      expect(res.estimatedLiquidationPrice).toBeGreaterThan(entryPrice);
      // Stop price must be between entry and liquidation price
      expect(res.stopPrice).toBeGreaterThan(entryPrice);
      expect(res.stopPrice).toBeLessThan(res.estimatedLiquidationPrice);

      expect(res.stopDistancePct).toBeCloseTo(res.distanceToLiquidationPct / 2, 1);
    });

    it("should dynamically widen breathing room for lower leverage and tighten for higher leverage", () => {
      const entry = 1000.0;
      const stop5x = calculateDynamicLiquidationStop("BUY", entry, 5, 0.005, 0.50);
      const stop10x = calculateDynamicLiquidationStop("BUY", entry, 10, 0.005, 0.50);
      const stop20x = calculateDynamicLiquidationStop("BUY", entry, 20, 0.005, 0.50);

      // Lower leverage has more breathing room (larger distance to stop)
      expect(stop5x.stopDistancePct).toBeGreaterThan(stop10x.stopDistancePct);
      expect(stop10x.stopDistancePct).toBeGreaterThan(stop20x.stopDistancePct);

      // 5x gives ~9.75% stop distance, 10x gives ~4.75%, 20x gives ~2.25%
      expect(stop5x.stopDistancePct).toBeGreaterThan(8.0);
      expect(stop10x.stopDistancePct).toBeGreaterThan(4.0);
      expect(stop20x.stopDistancePct).toBeGreaterThan(2.0);
    });
  });

  describe("Multi-Venue Protective Stop Dispatch & Cancellation", () => {
    it("should place and simulate protective stops for Binance", async () => {
      const res = await placeVenueProtectiveStop("Binance", {
        symbol: "BTCUSDT",
        positionSide: "BUY",
        quantity: 0.05,
        entryPrice: 65000,
        leverage: 10,
      });

      expect(res.success).toBe(true);
      expect(res.venue).toBe("Binance");
      expect(res.stopSide).toBe("SELL");
      expect(res.stopPrice).toBeLessThan(65000);
      expect(res.stopOrderId).toBeTruthy();

      // Test clean cancellation
      const cancel = await cancelVenueProtectiveStop("Binance", "BTCUSDT", res.stopOrderId);
      expect(cancel.success).toBe(true);
    });

    it("should place and simulate protective stops for Bitget", async () => {
      const res = await placeVenueProtectiveStop("Bitget", {
        symbol: "ETHUSDT",
        positionSide: "SELL",
        quantity: 1.0,
        entryPrice: 2500,
        leverage: 10,
      });

      expect(res.success).toBe(true);
      expect(res.venue).toBe("Bitget");
      expect(res.stopSide).toBe("BUY");
      expect(res.stopPrice).toBeGreaterThan(2500);

      const cancel = await cancelVenueProtectiveStop("Bitget", "ETHUSDT", res.stopOrderId);
      expect(cancel.success).toBe(true);
    });

    it("should place and simulate protective stops for Bybit", async () => {
      const res = await placeVenueProtectiveStop("Bybit", {
        symbol: "SOLUSDT",
        positionSide: "BUY",
        quantity: 5.0,
        entryPrice: 150,
        leverage: 10,
      });

      expect(res.success).toBe(true);
      expect(res.venue).toBe("Bybit");
      expect(res.stopSide).toBe("SELL");
      expect(res.stopPrice).toBeLessThan(150);

      const cancel = await cancelVenueProtectiveStop("Bybit", "SOLUSDT", res.stopOrderId);
      expect(cancel.success).toBe(true);
    });

    it("should place and simulate protective stops for CoinDCX", async () => {
      const res = await placeVenueProtectiveStop("CoinDCX", {
        symbol: "BTCUSDT",
        positionSide: "SELL",
        quantity: 0.02,
        entryPrice: 65000,
        leverage: 10,
      });

      expect(res.success).toBe(true);
      expect(res.venue).toBe("CoinDCX");
      expect(res.stopSide).toBe("BUY");
      expect(res.stopPrice).toBeGreaterThan(65000);

      const cancel = await cancelVenueProtectiveStop("CoinDCX", "BTCUSDT", res.stopOrderId);
      expect(cancel.success).toBe(true);
    });
  });
});
