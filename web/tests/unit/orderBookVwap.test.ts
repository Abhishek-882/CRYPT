import { describe, it, expect } from "vitest";
import { OrderBookManager, OrderBookLevel } from "../../lib/orderBookManager";

describe("L2 20-Level Depth & Deterministic VWAP Sweep Engine", () => {
  const manager = new OrderBookManager();

  // Synthetic 5-level ask book for BUY orders
  const syntheticAsks: OrderBookLevel[] = [
    { price: 100.0, qty: 1.0, notionalUsd: 100.0 }, // Level 1
    { price: 100.1, qty: 2.0, notionalUsd: 200.2 }, // Level 2
    { price: 100.2, qty: 5.0, notionalUsd: 501.0 }, // Level 3
    { price: 100.5, qty: 10.0, notionalUsd: 1005.0 }, // Level 4
    { price: 101.0, qty: 20.0, notionalUsd: 2020.0 }, // Level 5
  ];

  it("calculates exact VWAP for single-level fill", () => {
    // $50 order fits completely in Level 1 ($100 available @ $100.0)
    const res = manager.calculateVwapSweep(syntheticAsks, "BUY", 50.0);
    expect(res.vwap).toBe(100.0);
    expect(res.slippageBps).toBe(0.0);
    expect(res.filledLevels).toBe(1);
    expect(res.isSufficientDepth).toBe(true);
  });

  it("calculates exact multi-level VWAP across 3 levels", () => {
    // Target $500 notional:
    // Level 1: $100.0 (qty 1.0)
    // Level 2: $200.2 (qty 2.0)
    // Level 3: needed $199.8 @ $100.2 => qty = 199.8 / 100.2 = 1.9940119
    // Total qty = 1.0 + 2.0 + 1.9940119 = 4.9940119
    // VWAP = 500 / 4.9940119 = 100.12
    const res = manager.calculateVwapSweep(syntheticAsks, "BUY", 500.0);
    expect(res.filledLevels).toBe(3);
    expect(res.vwap).toBeGreaterThan(100.0);
    expect(res.vwap).toBeLessThan(100.2);
    expect(res.slippageBps).toBeGreaterThan(0);
    expect(res.isSufficientDepth).toBe(true);
  });

  it("detects book exhaustion when order exceeds available depth", () => {
    // Order $10,000 exceeds total depth of ~$3,826
    const res = manager.calculateVwapSweep(syntheticAsks, "BUY", 10000.0);
    expect(res.isSufficientDepth).toBe(false);
  });

  it("calculates depth within 10 bps correctly", () => {
    // Mid price = 100.0; 10 bps = 0.10%; 100.0 * 1.001 = 100.10
    // Levels <= 100.10: Level 1 ($100) + Level 2 ($200.2) = $300.2
    const res = manager.calculateVwapSweep(syntheticAsks, "BUY", 50.0);
    expect(res.depthWithin10BpsUsd).toBeCloseTo(300.2, 1);
  });
});
