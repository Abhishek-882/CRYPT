import { describe, it, expect } from "vitest";
import {
  calculateDirectionalBasisPnL,
  estimateOrnsteinUhlenbeckStopping,
  evaluateZeroLossExitGate,
  reconcileHedgeFunding,
  MIN_EXIT_PROFIT_USDT,
  CATASTROPHIC_STOP_LOSS_ROI,
  MIN_CONTINUATION_SPREAD_BPS,
} from "../../lib/exitOptimizer";
import type { ActiveBotHedge } from "../../lib/botEngine";

describe("ZERO-LOSS DYNAMIC EXIT ENGINE & OPTIMIZER", () => {
  const baseHedge: ActiveBotHedge = {
    id: "test-hedge-001",
    symbol: "BMTUSDT",
    direction: "SHORT_BINANCE_LONG_BYBIT",
    venueA: "Binance",
    venueB: "Bybit",
    quantity: "100",
    effectiveQty: 100,
    notionalUsdt: 30.0,
    binanceLeverage: 10,
    bitgetLeverage: 10,
    entrySpreadBps: 70.0,
    entryBinancePrice: 0.301,
    entryBitgetPrice: 0.299,
    entryDivergencePct: 0.668,
    entryTime: Date.now() - 3600000, // 1 hour ago
    fundingSettlementTime: Date.now() - 60000, // 1 min ago
    status: "ACTIVE",
    totalFeesUsdt: 0.034,
    fundingClaimedUsdt: 0,
    fundingRatePct: 0.007, // 70 bps
  };

  describe("Method 4: Directional Basis PnL Calculation", () => {
    it("calculates positive basis PnL when prices converge in trade direction", () => {
      // Entry: Short BN @ 0.301, Long BYB @ 0.299
      // Exit: BN converges down to 0.300, BYB stays at 0.299
      // Short BN gains (0.301 - 0.300) * 100 = +0.1000
      // Long BYB is (0.299 - 0.299) * 100 = 0.0000
      const res = calculateDirectionalBasisPnL(baseHedge, 0.300, 0.299);
      expect(res.grossBasisPnL).toBe(0.1);
      expect(res.leg1PnL).toBe(0.1);
      expect(res.leg2PnL).toBe(0);
    });

    it("calculates negative basis PnL when prices diverge adversely", () => {
      // Entry: Short BN @ 0.301, Long BYB @ 0.299
      // Exit: BN rises to 0.305 (+0.004 adverse), BYB stays at 0.299
      // Short BN loses: -1 * (0.305 - 0.301) * 100 = -0.4000
      const res = calculateDirectionalBasisPnL(baseHedge, 0.305, 0.299);
      expect(res.grossBasisPnL).toBe(-0.4);
    });
  });

  describe("Method 5: Ornstein-Uhlenbeck Stopping Time Estimation", () => {
    it("falls back safely with fewer than 5 samples", () => {
      const res = estimateOrnsteinUhlenbeckStopping(25.0, [24.0, 25.0]);
      expect(res.halfLifeMinutes).toBe(8.0);
      expect(typeof res.zScore).toBe("number");
      expect(typeof res.shouldWait).toBe("boolean");
    });

    it("estimates mean reversion half-life on synthetic mean-reverting series", () => {
      // Synthetic mean reverting around 10 bps
      const samples = [10, 14, 12, 9, 15, 11, 10, 8, 12, 10, 11, 9, 10];
      const res = estimateOrnsteinUhlenbeckStopping(22.0, samples);
      expect(res.theta).toBeGreaterThan(0);
      expect(res.halfLifeMinutes).toBeGreaterThan(0);
      expect(res.halfLifeMinutes).toBeLessThan(120);
      expect(res.zScore).toBeGreaterThan(0);
    });
  });

  describe("Method 1: Guaranteed Net-Positive Exit Gate (The Zero-Loss Invariant)", () => {
    it("blocks exit when Net PnL is negative (prevents forced timeout losses like LSKUSDT)", () => {
      // Adverse price divergence causing negative net PnL
      const adversePrices = {
        bnPrice: 0.305, // Short leg losing
        bgPrice: 0.298, // Long leg losing
        divergencePct: 0.235,
      };

      const hedgeWithoutFunding: ActiveBotHedge = {
        ...baseHedge,
        fundingSettlementTime: Date.now() + 3600000, // Settlement not passed yet
        fundingClaimedUsdt: 0,
      };

      const decision = evaluateZeroLossExitGate(hedgeWithoutFunding, adversePrices);
      expect(decision.canExit).toBe(false);
      expect(decision.netPnL).toBeLessThan(MIN_EXIT_PROFIT_USDT);
      expect(decision.exitType).toBe("HOLD_CARRY_FOR_PARITY");
      expect(decision.reason).toContain("Blocked by Zero-Loss Gate");
    });

    it("triggers catastrophic stop-loss when ROI is <= -40%", () => {
      // Extreme adverse divergence causing catastrophic loss
      const crashPrices = {
        bnPrice: 0.320, // Short leg losing heavily
        bgPrice: 0.280, // Long leg losing heavily
        divergencePct: 14.28,
      };

      const hedgeInLoss: ActiveBotHedge = {
        ...baseHedge,
        fundingSettlementTime: Date.now() + 3600000,
        fundingClaimedUsdt: 0,
      };

      const decision = evaluateZeroLossExitGate(hedgeInLoss, crashPrices);
      expect(decision.canExit).toBe(true);
      expect(decision.exitType).toBe("CATASTROPHIC_STOP");
      expect(decision.currentRoiPct).toBeLessThanOrEqual(CATASTROPHIC_STOP_LOSS_ROI);
      expect(decision.reason).toContain("Catastrophic stop-loss triggered");
    });

    it("rolls into next cycle when exit is not profitable but forward spread is lucrative", () => {
      const marginalPrices = {
        bnPrice: 0.3015,
        bgPrice: 0.299,
        divergencePct: 0.08,
      };

      const hedgePending: ActiveBotHedge = {
        ...baseHedge,
        fundingSettlementTime: Date.now() + 10000,
        fundingClaimedUsdt: 0,
      };

      // Forward spread is 45 bps (>= 20 bps)
      const decision = evaluateZeroLossExitGate(hedgePending, marginalPrices, [], 45.0);
      expect(decision.canExit).toBe(false);
      expect(decision.exitType).toBe("CONTINUATION_HOLD");
      expect(decision.reason).toContain("Rolling into next cycle");
    });

    it("confirms guaranteed net-positive exit when Net PnL >= +$0.01 USDT and prices converged", () => {
      // Good convergence + funding harvested
      const favorablePrices = {
        bnPrice: 0.300,
        bgPrice: 0.2999,
        divergencePct: 0.033, // <= 0.05%
      };

      const hedgeWithFunding: ActiveBotHedge = {
        ...baseHedge,
        fundingClaimedUsdt: 0.21, // Collected 70 bps funding
        totalFeesUsdt: 0.034,
      };

      const decision = evaluateZeroLossExitGate(hedgeWithFunding, favorablePrices);
      expect(decision.canExit).toBe(true);
      expect(decision.netPnL).toBeGreaterThanOrEqual(MIN_EXIT_PROFIT_USDT);
      expect(decision.exitType).toBe("MAKER_POST_ONLY");
      expect(decision.reason).toContain("Guaranteed Net-Positive Confirmed");
    });
  });

  describe("Funding Reconciler Fallback", () => {
    it("accrues funding mathematically if settlement passed and exchange query is empty", async () => {
      const hedgeToReconcile: ActiveBotHedge = {
        ...baseHedge,
        fundingSettlementTime: Date.now() - 5000,
        fundingClaimedUsdt: 0,
        cyclesHarvested: 1,
        fundingRatePct: 0.007,
      };

      const claimed = await reconcileHedgeFunding(hedgeToReconcile);
      expect(claimed).toBeGreaterThan(0);
      expect(hedgeToReconcile.fundingClaimedUsdt).toBe(claimed);
    });
  });
});
