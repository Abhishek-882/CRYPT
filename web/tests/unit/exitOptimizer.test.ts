import { describe, it, expect } from "vitest";
import {
  calculateDirectionalBasisPnL,
  estimateOrnsteinUhlenbeckStopping,
  evaluateZeroLossExitGate,
  reconcileHedgeFunding,
  MIN_EXIT_PROFIT_USDT,
  CATASTROPHIC_STOP_LOSS_ROI,
  MIN_CONTINUATION_SPREAD_BPS,
  MIN_CONTINUATION_SPREAD_PCT,
  HARD_SAFETY_FLOOR_USDT,
  BASE_NOTIONAL_UNIT_USDT,
  getEffectiveZeroLossFloorUsdt,
  DEFAULT_MIN_NET_HEDGE_TARGET_PCT,
  calculateAdaptiveZeroLossFloorUsdt,
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
    fundingRatePct: 0.007, // 0.700%
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
      // Synthetic mean reverting around 0.100%
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

      // Forward spread is 0.450% (>= 0.200%)
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
        fundingClaimedUsdt: 0.21, // Collected 0.700% funding
        totalFeesUsdt: 0.034,
      };

      const decision = evaluateZeroLossExitGate(hedgeWithFunding, favorablePrices);
      expect(decision.canExit).toBe(true);
      expect(decision.netPnL).toBeGreaterThanOrEqual(MIN_EXIT_PROFIT_USDT);
      expect(decision.exitType).toBe("MAKER_POST_ONLY");
      expect(decision.reason).toContain("Guaranteed Net-Positive Confirmed");
    });

    it("dynamically scales exit profit hurdle based on order notional sizing (Test L7-01 parity)", () => {
      // 1. $60 notional -> $0.0100 floor
      expect(getEffectiveZeroLossFloorUsdt(60.0)).toBe(0.0100);
      // 2. $300 notional -> $0.0500 floor
      expect(getEffectiveZeroLossFloorUsdt(300.0)).toBe(0.0500);
      // 3. $600 notional -> $0.1000 floor
      expect(getEffectiveZeroLossFloorUsdt(600.0)).toBe(0.1000);

      // Parity prices where gross basis PnL = 0.00 (prices match entry)
      const parityPrices = {
        bnPrice: 0.301,
        bgPrice: 0.299,
        divergencePct: 0.033, // <= 0.05% tight convergence
      };

      // $300 notional hedge ($30 margin @ 10x leverage)
      // Exit fees = 300 * 0.000849 = 0.2547. Entry fees = 0.035. Total fees = 0.2897.
      // Net PnL = 0.3500 - 0.2897 = $0.0603 >= $0.0500 floor -> Approves exit
      const hedge300Passing: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 300.0,
        effectiveQty: 1000,
        fundingClaimedUsdt: 0.35,
        totalFeesUsdt: 0.035,
      };

      const decisionPass300 = evaluateZeroLossExitGate(hedge300Passing, parityPrices);
      expect(decisionPass300.canExit).toBe(true);
      expect(decisionPass300.netPnL).toBeGreaterThanOrEqual(0.0500);
      expect(decisionPass300.reason).toContain("Guaranteed Net-Positive Confirmed");

      // $300 notional hedge with insufficient profit: funding 0.3200 -> netPnL = 0.3200 - 0.2897 = $0.0303 < $0.0500 floor -> Blocks exit
      const hedge300SubFloor: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 300.0,
        effectiveQty: 1000,
        fundingClaimedUsdt: 0.32,
        totalFeesUsdt: 0.035,
      };
      const subFloorDecision = evaluateZeroLossExitGate(hedge300SubFloor, parityPrices);
      expect(subFloorDecision.canExit).toBe(false);
      expect(subFloorDecision.netPnL).toBeLessThan(0.0500);
      expect(subFloorDecision.reason).toContain("Blocked by Zero-Loss Gate");
      expect(subFloorDecision.reason).toContain("0.0500");
    });

    it("respects user configuredMinProfitUsdt override and clamps below $0.0100", () => {
      // Parity prices where gross basis PnL = 0.00
      const parityPrices = {
        bnPrice: 0.301,
        bgPrice: 0.299,
        divergencePct: 0.033,
      };

      // $60 notional hedge ($6 margin @ 10x leverage, qty = 200)
      // Exit fees = 60 * 0.000849 = 0.0509. Entry fees = 0.034. Total fees = 0.0849.
      // Funding = 0.3000 -> Net PnL = 0.3000 - 0.0849 = $0.2151 USDT.
      const hedge60: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 60.0,
        effectiveQty: 200,
        fundingClaimedUsdt: 0.30,
        totalFeesUsdt: 0.034,
      };

      // With user hurdle = 0.3000 (higher than net profit 0.2151): blocks exit
      const blockedByUser = evaluateZeroLossExitGate(hedge60, parityPrices, [], undefined, 0.3000);
      expect(blockedByUser.canExit).toBe(false);
      expect(blockedByUser.reason).toContain("0.3000");

      // With user hurdle = 0.1500 (lower than net profit 0.2151): approves exit
      const approvedByUser = evaluateZeroLossExitGate(hedge60, parityPrices, [], undefined, 0.1500);
      expect(approvedByUser.canExit).toBe(true);
      expect(approvedByUser.reason).toContain("Guaranteed Net-Positive Confirmed");

      // With user hurdle below safety floor (0.0050 < 0.0100): clamped to 0.0100 safety floor
      const clampedFloor = getEffectiveZeroLossFloorUsdt(60.0, 0.0050);
      expect(clampedFloor).toBe(0.0100);
    });

    it("enforces auto-adaptive 0.30% minimum net profit target across variable margin and leverage", () => {
      // 1. Math formula verification: AdaptiveFloorUsdt = max(HARD_SAFETY_FLOOR, totalMargin * 0.0030)
      // $60 total margin ($30/side @ 10x): $60 * 0.0030 = $0.1800 USDT (+0.30% ROI)
      expect(calculateAdaptiveZeroLossFloorUsdt(60.0, 0.30)).toBe(0.1800);
      // $40 total margin ($20/side @ 10x): $40 * 0.0030 = $0.1200 USDT (+0.30% ROI)
      expect(calculateAdaptiveZeroLossFloorUsdt(40.0, 0.30)).toBe(0.1200);
      // $200 total margin ($100/side @ 20x): $200 * 0.0030 = $0.6000 USDT (+0.30% ROI)
      expect(calculateAdaptiveZeroLossFloorUsdt(200.0, 0.30)).toBe(0.6000);
      // Micro margin ($2 total margin): clamped to $0.0100 hard safety floor
      expect(calculateAdaptiveZeroLossFloorUsdt(2.0, 0.30)).toBe(0.0100);

      // Parity prices
      const parityPrices = {
        bnPrice: 0.301,
        bgPrice: 0.299,
        divergencePct: 0.033,
      };

      // Case A: $30 margin @ 10x ($300 notional, $60 total margin)
      // Exit fees = 300 * 0.000849 = 0.2547. Entry fees = 0.035. Total fees = 0.2897.
      // Hedge with net PnL = +$0.1003 (+0.167% ROI < +0.30% target hurdle of $0.1800)
      // Funding = 0.3900 -> Net PnL = 0.3900 - 0.2897 = $0.1003 USDT.
      const hedge300SubTarget: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 300.0,
        effectiveQty: 1000,
        fundingClaimedUsdt: 0.39,
        totalFeesUsdt: 0.035,
        binanceLeverage: 10,
      };

      const decisionSubTarget = evaluateZeroLossExitGate(hedge300SubTarget, parityPrices, [], undefined, undefined, 0.30);
      expect(decisionSubTarget.canExit).toBe(false);
      expect(decisionSubTarget.exitType).toBe("HOLD_CARRY_FOR_PARITY");
      expect(decisionSubTarget.reason).toContain("Blocked by Zero-Loss Gate");
      expect(decisionSubTarget.reason).toContain("0.1800");

      // Hedge with net PnL = +$0.1903 (+0.317% ROI >= +0.30% target hurdle of $0.1800)
      // Funding = 0.4800 -> Net PnL = 0.4800 - 0.2897 = $0.1903 USDT.
      const hedge300PassedTarget: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 300.0,
        effectiveQty: 1000,
        fundingClaimedUsdt: 0.48,
        totalFeesUsdt: 0.035,
        binanceLeverage: 10,
      };

      const decisionPassedTarget = evaluateZeroLossExitGate(hedge300PassedTarget, parityPrices, [], undefined, undefined, 0.30);
      expect(decisionPassedTarget.canExit).toBe(true);
      expect(decisionPassedTarget.exitType).toBe("MAKER_POST_ONLY");
      expect(decisionPassedTarget.reason).toContain("Guaranteed Net-Positive Confirmed");
      expect(decisionPassedTarget.reason).toContain("+0.30% target");

      // Case B: $20 margin @ 10x ($200 notional, $40 total margin)
      // Total margin = $40. Adaptive floor = $40 * 0.0030 = $0.1200 USDT.
      // Exit fees = 200 * 0.000849 = 0.1698. Entry fees = 0.030. Total fees = 0.1998.
      // Funding = 0.2800 -> Net PnL = 0.2800 - 0.1998 = $0.0802 USDT (+0.200% ROI < +0.30%).
      const hedge200SubTarget: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 200.0,
        effectiveQty: 666.6,
        fundingClaimedUsdt: 0.28,
        totalFeesUsdt: 0.030,
        binanceLeverage: 10,
      };

      const decision200Sub = evaluateZeroLossExitGate(hedge200SubTarget, parityPrices, [], undefined, undefined, 0.30);
      expect(decision200Sub.canExit).toBe(false);
      expect(decision200Sub.reason).toContain("0.1200");

      // Funding = 0.3500 -> Net PnL = 0.3500 - 0.1998 = $0.1502 USDT (+0.375% ROI >= +0.30%).
      const hedge200Passed: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 200.0,
        effectiveQty: 666.6,
        fundingClaimedUsdt: 0.35,
        totalFeesUsdt: 0.030,
        binanceLeverage: 10,
      };

      const decision200Passed = evaluateZeroLossExitGate(hedge200Passed, parityPrices, [], undefined, undefined, 0.30);
      expect(decision200Passed.canExit).toBe(true);
      expect(decision200Passed.reason).toContain("Guaranteed Net-Positive Confirmed");

      // Case C: 20x Leverage ($400 notional, $40 total margin)
      // Total margin = (400 / 20) * 2 = $40. Adaptive floor = $40 * 0.0030 = $0.1200 USDT.
      // Exit fees = 400 * 0.000849 = 0.3396. Entry fees = 0.040. Total fees = 0.3796.
      // Funding = 0.5200 -> Net PnL = 0.5200 - 0.3796 = $0.1404 USDT (+0.351% ROI >= +0.30%).
      const hedgeLev20Passed: ActiveBotHedge = {
        ...baseHedge,
        notionalUsdt: 400.0,
        effectiveQty: 1333.3,
        fundingClaimedUsdt: 0.52,
        totalFeesUsdt: 0.040,
        binanceLeverage: 20,
      };

      const decisionLev20 = evaluateZeroLossExitGate(hedgeLev20Passed, parityPrices, [], undefined, undefined, 0.30);
      expect(decisionLev20.canExit).toBe(true);
      expect(decisionLev20.reason).toContain("Guaranteed Net-Positive Confirmed");
      expect(decisionLev20.reason).toContain("+0.30% target");
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
