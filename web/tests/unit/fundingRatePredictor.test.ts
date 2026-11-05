import { describe, it, expect, beforeEach } from "vitest";
import { FundingRatePredictor } from "../../lib/fundingRatePredictor";

describe("Real-Time Cumulative Premium Index TWAP Predictive Funding Rate Engine", () => {
  let predictor: FundingRatePredictor;

  beforeEach(() => {
    predictor = new FundingRatePredictor();
  });

  it("contracts standard error continuously towards 0.00 as settlement approaches", () => {
    const symbol = "BTCUSDT";

    // Ingest 100 samples with variance around 0.05% premium
    for (let i = 0; i < 100; i++) {
      predictor.ingestSample(symbol, {
        timestamp: Date.now() - (100 - i) * 1000,
        markPrice: 65032.5,
        indexPrice: 65000.0,
        premiumPct: 0.05 + (i % 5) * 0.005,
      });
    }

    // At t = 2 hours (7,200s of 28,800s)
    const earlyPred = predictor.predictUpcomingFundingRate(symbol, "Binance", 0.05, 7200, 28800);

    // At t = 7.5 hours (27,000s of 28,800s)
    const latePred = predictor.predictUpcomingFundingRate(symbol, "Binance", 0.05, 27000, 28800);

    // At t = 8.0 hours (28,800s - exactly settlement)
    const settlePred = predictor.predictUpcomingFundingRate(symbol, "Binance", 0.05, 28800, 28800);

    expect(earlyPred.standardErrorPct).toBeGreaterThan(latePred.standardErrorPct);
    expect(latePred.standardErrorPct).toBeGreaterThanOrEqual(settlePred.standardErrorPct);
    expect(settlePred.standardErrorPct).toBe(0.0);
  });

  it("detects surging trajectory when observed premium exceeds posted rate", () => {
    const symbol = "ETHUSDT";

    // Ingest samples surging to 0.12% premium
    for (let i = 0; i < 50; i++) {
      predictor.ingestSample(symbol, {
        timestamp: Date.now() - (50 - i) * 1000,
        markPrice: 2503.0,
        indexPrice: 2500.0,
        premiumPct: 0.12,
      });
    }

    // Posted rate was 0.01%
    const res = predictor.predictUpcomingFundingRate(symbol, "Binance", 0.01, 14400, 28800);
    expect(res.trajectory).toBe("SURGING");
    expect(res.predictedSettlementRatePct).toBeGreaterThan(0.01);
  });

  it("falls back gracefully to posted rate when buffer is empty", () => {
    const res = predictor.predictUpcomingFundingRate("UNKNOWN", "Binance", 0.03, 3600, 28800);
    expect(res.predictedSettlementRatePct).toBe(0.03);
    expect(res.standardErrorPct).toBe(0.0);
    expect(res.trajectory).toBe("STABLE");
  });
});
