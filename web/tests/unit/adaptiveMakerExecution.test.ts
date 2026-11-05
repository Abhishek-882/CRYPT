/**
 * Vitest Unit Tests: Upgrade 2 - Adaptive Maker-Taker Execution & Meme Coin Solvency Protection
 * 
 * Verifies:
 * 1. Pillar 1: Price-based watchdog detects adverse counterpart price drift and cancels resting maker orders early.
 * 2. Pillar 1: Favorable price drift or stable prices preserve maker orders to capture full profits.
 * 3. Pillar 2: Pre-flight solvency and liquidity checks block Leg 1 if counterpart has insufficient margin or missing quote.
 * 4. Zero Orphan Invariant: Guaranteed safe aborts on adverse price shifts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MakerTakerRouter } from "../../lib/makerTakerRouter";
import { MockExchangeEngine } from "../mockExchange";
import { preFlightLeg2Check } from "../../lib/botEngine";

describe("Upgrade 2: Adaptive Maker-Taker Execution & Solvency Protection", () => {
  let router: MakerTakerRouter;
  let mockEngine: MockExchangeEngine;

  beforeEach(() => {
    router = new MakerTakerRouter();
    mockEngine = new MockExchangeEngine({ USDT: 20000 });
  });

  describe("Pillar 1: Counterpart Price Drift Watchdog", () => {
    it("should detect adverse price drift when Leg 1 is BUY (counterpart is SELL) and counterpart drops", () => {
      // Leg 1: BUY Binance, Leg 2: SELL Bybit.
      // If Bybit drops from 100 to 99.85, that is 15 bps adverse drift (we get less selling Bybit).
      const check = router.checkAdverseDrift("BUY", 100.0, 99.85, 8.0);
      expect(check.isAdverse).toBe(true);
      expect(check.driftBps).toBe(15);
    });

    it("should NOT flag favorable price drift when Leg 1 is BUY and counterpart rises", () => {
      // If Bybit rises from 100 to 100.20, we get MORE selling Bybit (favorable!).
      const check = router.checkAdverseDrift("BUY", 100.0, 100.20, 8.0);
      expect(check.isAdverse).toBe(false);
      expect(check.driftBps).toBe(-20);
    });

    it("should detect adverse price drift when Leg 1 is SELL (counterpart is BUY) and counterpart rises", () => {
      // Leg 1: SELL Binance, Leg 2: BUY Bybit.
      // If Bybit rises from 100 to 100.15, that is 15 bps adverse drift (we pay more buying Bybit).
      const check = router.checkAdverseDrift("SELL", 100.0, 100.15, 8.0);
      expect(check.isAdverse).toBe(true);
      expect(check.driftBps).toBe(15);
    });

    it("should NOT flag favorable price drift when Leg 1 is SELL and counterpart drops", () => {
      // If Bybit drops from 100 to 99.80, we pay LESS buying Bybit (favorable!).
      const check = router.checkAdverseDrift("SELL", 100.0, 99.80, 8.0);
      expect(check.isAdverse).toBe(false);
      expect(check.driftBps).toBe(-20);
    });

    it("should abort simulated maker execution early if adverse drift triggers watchdog", async () => {
      // Simulate unfilled limit order
      mockEngine.setFaultConfig({ partialFillRatio: 0.0 });

      // Counterpart price drifts from 100 to 100.15 on a SELL Binance leg
      const res = await router.executeMakerLeg1(
        {
          venue: "Binance",
          symbol: "PEPEUSDT",
          side: "SELL",
          quantity: 1000,
          bestBid: 100.0,
          bestAsk: 100.01,
          timeoutSeconds: 8,
          isSimulated: true,
          initialCounterpartPrice: 100.0,
          maxAdverseDriftBps: 8.0,
          counterpartPriceCheckFn: async () => 100.15,
        },
        mockEngine
      );

      expect(res.filled).toBe(false);
      expect(res.cancelled).toBe(true);
      expect(res.error).toContain("ADVERSE_PRICE_DRIFT_15BPS");
    });

    it("should preserve maker order and allow fill when counterpart price is stable", async () => {
      // Normal fill (100% fill ratio)
      const res = await router.executeMakerLeg1(
        {
          venue: "Binance",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: 0.05,
          bestBid: 65000,
          bestAsk: 65005,
          isSimulated: true,
          initialCounterpartPrice: 65002,
          maxAdverseDriftBps: 8.0,
          counterpartPriceCheckFn: async () => 65003, // Favorable move (+15 bps)
        },
        mockEngine
      );

      expect(res.filled).toBe(true);
      expect(res.feeSavedBps).toBe(40);
    });
  });

  describe("Pillar 2: Pre-Flight Leg 2 Solvency & Health Guarantee", () => {
    it("should reject pre-flight check if Bybit has no active price quote", async () => {
      const res = await preFlightLeg2Check({
        venueBName: "Bybit",
        symbol: "NONEXISTENT_COIN_XYZ_USDT",
        requiredMarginUsdt: 2.50,
      });

      expect(res.passed).toBe(false);
      expect(res.reason).toContain("no active price quote");
    });

    it("should pass pre-flight check for non-Bybit venues", async () => {
      const res = await preFlightLeg2Check({
        venueBName: "Bitget",
        symbol: "BTCUSDT",
        requiredMarginUsdt: 5.0,
      });

      expect(res.passed).toBe(true);
    });
  });
});
