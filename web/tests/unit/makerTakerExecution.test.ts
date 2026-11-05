/**
 * Vitest Unit Tests: Maker-First Routing & Execution Drag Optimization (Track B-04 / QUANT-01)
 * 
 * Verifies:
 * 1. Post-only limit price calibration to ensure passive Maker execution
 * 2. Successful Maker execution and fee savings accounting (~40 bps savings)
 * 3. Clean timeout cancellation without leaving resting orders or committing capital
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MakerTakerRouter } from "../../lib/makerTakerRouter";
import { MockExchangeEngine } from "../mockExchange";

describe("Milestone 10: Maker-First Routing & Fee Drag Defense (Track B-04 / QUANT-01)", () => {
  let router: MakerTakerRouter;
  let mockEngine: MockExchangeEngine;

  beforeEach(() => {
    router = new MakerTakerRouter();
    mockEngine = new MockExchangeEngine({ USDT: 20000 });
  });

  it("should calculate correct passive post-only prices without crossing spread", () => {
    const bestBid = 65000.0;
    const bestAsk = 65005.0;

    // BUY order must be <= bestBid to be a Maker order
    const buyPrice = router.calculatePostOnlyPrice("BUY", bestBid, bestAsk);
    expect(buyPrice).toBeLessThanOrEqual(bestBid);

    // SELL order must be >= bestAsk to be a Maker order
    const sellPrice = router.calculatePostOnlyPrice("SELL", bestBid, bestAsk);
    expect(sellPrice).toBeGreaterThanOrEqual(bestAsk);
  });

  it("should execute Leg 1 as Maker and account for fee savings", async () => {
    const res = await router.executeMakerLeg1(
      {
        venue: "Binance",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.05,
        bestBid: 65000,
        bestAsk: 65005,
        isSimulated: true,
      },
      mockEngine
    );

    expect(res.filled).toBe(true);
    expect(res.cancelled).toBe(false);
    expect(res.venue).toBe("Binance");
    expect(res.feeSavedBps).toBe(40); // 40 bps savings over dual-taker execution
    expect(res.orderId).toBeTruthy();
  });

  it("should cleanly cancel Leg 1 upon timeout if unfilled without orphan exposure", async () => {
    // Inject 0% fill ratio to simulate unfilled limit order at top of book
    mockEngine.setFaultConfig({ partialFillRatio: 0.0 });

    const res = await router.executeMakerLeg1(
      {
        venue: "Bitget",
        symbol: "ETHUSDT",
        side: "SELL",
        quantity: 1.0,
        bestBid: 2500,
        bestAsk: 2501,
        timeoutSeconds: 5,
        isSimulated: true,
      },
      mockEngine
    );

    expect(res.filled).toBe(false);
    expect(res.cancelled).toBe(true);
    expect(res.error).toBe("MAKER_TIMEOUT_UNFILLED");

    // Order status in mock broker must be CANCELED
    const order = mockEngine.getOrder(res.orderId);
    expect(order?.status).toBe("CANCELED");
  });
});
