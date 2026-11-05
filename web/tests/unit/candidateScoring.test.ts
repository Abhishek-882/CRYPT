import { describe, it, expect } from "vitest";
import { computeCompositeArbitrageScore } from "../../lib/candidateScoring";

describe("Multi-Factor Composite Arbitrage Scoring (CAS) Engine", () => {
  it("ranks favorable signed basis significantly higher than adverse signed basis with identical spread", () => {
    // Pair A: 40 bps spread, +20 bps favorable signed basis
    const pairA = computeCompositeArbitrageScore({
      symbol: "GOODCOIN",
      corridor: "BINANCE_BYBIT",
      venueA: "Binance",
      venueB: "Bybit",
      grossSpreadBps: 55.0,
      netSpreadBps: 40.0,
      signedBasisBps: 20.0,
      l2DepthUsd: 500.0,
      targetNotionalUsd: 30.0,
    });

    // Pair B: 40 bps spread, -30 bps adverse signed basis
    const pairB = computeCompositeArbitrageScore({
      symbol: "BADCOIN",
      corridor: "BINANCE_BYBIT",
      venueA: "Binance",
      venueB: "Bybit",
      grossSpreadBps: 55.0,
      netSpreadBps: 40.0,
      signedBasisBps: -30.0,
      l2DepthUsd: 500.0,
      targetNotionalUsd: 30.0,
    });

    expect(pairA.compositeScore).toBeGreaterThan(pairB.compositeScore);
    expect(pairA.scoreBreakdown.basisComponent).toBeGreaterThan(
      pairB.scoreBreakdown.basisComponent
    );
  });

  it("penalizes thin order book candidates", () => {
    const deepPair = computeCompositeArbitrageScore({
      symbol: "DEEPCOIN",
      corridor: "BINANCE_BYBIT",
      venueA: "Binance",
      venueB: "Bybit",
      grossSpreadBps: 50.0,
      netSpreadBps: 35.0,
      signedBasisBps: 0.0,
      l2DepthUsd: 1000.0, // 33x notional
      targetNotionalUsd: 30.0,
    });

    const thinPair = computeCompositeArbitrageScore({
      symbol: "THINCOIN",
      corridor: "BINANCE_BYBIT",
      venueA: "Binance",
      venueB: "Bybit",
      grossSpreadBps: 50.0,
      netSpreadBps: 35.0,
      signedBasisBps: 0.0,
      l2DepthUsd: 30.0, // 1x notional
      targetNotionalUsd: 30.0,
    });

    expect(deepPair.compositeScore).toBeGreaterThan(thinPair.compositeScore);
    expect(deepPair.scoreBreakdown.depthComponent).toBeGreaterThan(
      thinPair.scoreBreakdown.depthComponent
    );
  });

  it("rejects negative net spread candidates", () => {
    const res = computeCompositeArbitrageScore({
      symbol: "LOSERCOIN",
      corridor: "BINANCE_BYBIT",
      venueA: "Binance",
      venueB: "Bybit",
      grossSpreadBps: 15.0,
      netSpreadBps: -5.0, // Net negative after fees
      signedBasisBps: 0.0,
    });

    expect(res.qualified).toBe(false);
    expect(res.rejectionReason).toContain("NEGATIVE_NET_SPREAD");
  });
});
