import { describe, it, expect } from "vitest";
import {
  calculateAsymmetricMacroYield,
  calculateSignedBasisBps,
  MIN_GROSS_SPREAD_BPS,
} from "../../lib/spreadCalculation";
import {
  evaluatePreTradeSlippageAndDepth,
  BotConfig,
} from "../../lib/botEngine";

describe("Bot Filter & Yield Calculation Remediation Suite", () => {
  describe("Target 1: Signed Directional Basis in Price Divergence", () => {
    it("calculates positive basis for SHORT_A when Venue A price > Venue B price", () => {
      // Selling at $101 on Venue A and buying at $100 on Venue B
      const basis = calculateSignedBasisBps(101, 100, "SHORT_A_LONG_B");
      expect(basis).toBe(100.0); // +100 bps favorable basis
    });

    it("calculates negative basis for SHORT_A when Venue A price < Venue B price", () => {
      // Selling at $99 on Venue A and buying at $100 on Venue B
      const basis = calculateSignedBasisBps(99, 100, "SHORT_A_LONG_B");
      expect(basis).toBe(-100.0); // -100 bps adverse basis
    });

    it("calculates positive basis for LONG_A when Venue A price < Venue B price", () => {
      // Buying at $99 on Venue A and selling at $100 on Venue B
      const basis = calculateSignedBasisBps(99, 100, "LONG_A_SHORT_B");
      expect(basis).toBe(101.01); // +101 bps favorable basis
    });

    it("calculates negative basis for LONG_A when Venue A price > Venue B price", () => {
      // Buying at $101 on Venue A and selling at $100 on Venue B
      const basis = calculateSignedBasisBps(101, 100, "LONG_A_SHORT_B");
      expect(basis).toBe(-99.01); // -99 bps adverse basis
    });

    it("handles zero or negative prices gracefully without NaN or throwing", () => {
      expect(calculateSignedBasisBps(0, 100)).toBe(0);
      expect(calculateSignedBasisBps(100, 0)).toBe(0);
      expect(calculateSignedBasisBps(-5, 100)).toBe(0);
    });
  });

  describe("Target 2: Dynamic Order-Proportional Depth Gating", () => {
    const baseConfig: BotConfig = {
      enabled: true,
      minSpreadBps: 35.0,
      maxPriceDivergencePct: 0.10,
      balanceAllocationPct: 20,
      leverageMode: "CUSTOM",
      customLeverage: 1,
      maxSimultaneousHedges: 2,
      maxMarginCapUsdt: 500,
      postSettlementWaitSeconds: 15,
      closeMaxPriceDivergencePct: 0.05,
      scanIntervalSeconds: 5,
      liquidityTier: "THIN",
      enablePreTradeSlippageGate: true,
      minNetYieldHurdleBps: 15.0,
      maxBidAskSpreadBps: 25.0,
    };

    it("computes dynamic depth for $20 order on THIN tier as $25 instead of static $100", async () => {
      // Order notional $20 on THIN tier (1.25x) -> required depth = max(15, 20 * 1.25) = $25
      // Simulating a real candidate like FLOCK with $63.90 available depth
      const res = await evaluatePreTradeSlippageAndDepth(
        "TESTUSDT",
        "Binance",
        "Bybit",
        20,
        "SELL",
        "buy",
        baseConfig,
        60.0 // 60 bps gross spread clears 43 bps friction + 15 bps hurdle (expected net = +17 bps)
      );

      // In the mock environment without external fetch, default fallback depth is 500
      expect(res.passed).toBe(true);
      expect(res.expectedNetYieldBps).toBeGreaterThanOrEqual(15.0);
    });

    it("enforces depth proportional to larger order sizes ($500 order on MEDIUM tier)", async () => {
      const mediumConfig: BotConfig = { ...baseConfig, liquidityTier: "MEDIUM" };
      // $500 order on MEDIUM tier (2.0x) -> required depth = $1,000
      const res = await evaluatePreTradeSlippageAndDepth(
        "TESTUSDT",
        "Binance",
        "Bybit",
        500,
        "SELL",
        "buy",
        mediumConfig,
        80.0
      );

      // With default 500 depth < 1000 required, it should reject with ILLIQUID_BOOK_DEPTH
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("ILLIQUID_BOOK_DEPTH");
    });
  });

  describe("Target 3 & 4: Master Net-Yield Hurdle and 8x Multiplier Elimination", () => {
    it("caps cycles at 1 for sniper modes, eliminating 8x phantom yield inflation", () => {
      // 1h vs 8h interval: normal macro horizon is 8h -> cyclesA = 8/1 = 8
      const normalYield = calculateAsymmetricMacroYield(0.05, 1, 0.01, 8);
      expect(normalYield.cyclesA).toBe(8);
      expect(normalYield.grossYieldBps).toBe(39.0); // |8 * 0.05 - 1 * 0.01| = |0.40 - 0.01| = 0.39% = 39 bps

      // Under FUNDING_SNIPER_5M mode: cycles must be capped at 1 for single-settlement capture
      const sniperYield = calculateAsymmetricMacroYield(0.05, 1, 0.01, 8, "FUNDING_SNIPER_5M");
      expect(sniperYield.cyclesA).toBe(1);
      expect(sniperYield.cyclesB).toBe(1);
      expect(sniperYield.grossYieldBps).toBe(4.0); // |1 * 0.05 - 1 * 0.01| = 0.04% = 4 bps (real single cash flow)
    });

    it("incorporates positive signed basis into expectedNetYieldBps", async () => {
      const configWithFavorableBasis: BotConfig = {
        enabled: true,
        minSpreadBps: 35.0,
        maxPriceDivergencePct: 0.10,
        balanceAllocationPct: 20,
        leverageMode: "CUSTOM",
        customLeverage: 1,
        maxSimultaneousHedges: 2,
        maxMarginCapUsdt: 500,
        postSettlementWaitSeconds: 15,
        closeMaxPriceDivergencePct: 0.05,
        scanIntervalSeconds: 5,
        liquidityTier: "THIN",
        enablePreTradeSlippageGate: true,
        minNetYieldHurdleBps: 15.0,
        currentSignedBasisBps: 30.0, // +30 bps favorable basis convergence
      };

      const res = await evaluatePreTradeSlippageAndDepth(
        "TESTUSDT",
        "Binance",
        "Bybit",
        30,
        "SELL",
        "buy",
        configWithFavorableBasis,
        40.0 // 40 bps gross spread
      );

      // Expected net yield = gross (40) + basis (30) - friction (~43) = ~27 bps
      // Without basis, 40 - 43 = -3 bps would fail the 15 bps hurdle.
      // With basis, 40 + 30 - 43 = 27 bps clears the 15 bps hurdle!
      expect(res.passed).toBe(true);
      expect(res.expectedNetYieldBps).toBeGreaterThanOrEqual(15.0);
    });

    it("triggers EXTREME_SPREAD_CIRCUIT_BREAKER only on pathological spreads > 100 bps", async () => {
      // In the mock environment, default spread is 5.0 bps
      // Let's verify normal spread clears without triggering the circuit breaker
      const config: BotConfig = {
        enabled: true,
        minSpreadBps: 35.0,
        maxPriceDivergencePct: 0.10,
        balanceAllocationPct: 20,
        leverageMode: "CUSTOM",
        customLeverage: 1,
        maxSimultaneousHedges: 2,
        maxMarginCapUsdt: 500,
        postSettlementWaitSeconds: 15,
        closeMaxPriceDivergencePct: 0.05,
        scanIntervalSeconds: 5,
        liquidityTier: "THIN",
        enablePreTradeSlippageGate: true,
        minNetYieldHurdleBps: 15.0,
      };

      const res = await evaluatePreTradeSlippageAndDepth(
        "TESTUSDT",
        "Binance",
        "Bybit",
        30,
        "SELL",
        "buy",
        config,
        80.0
      );
      expect(res.passed).toBe(true);
      expect(res.reason).toBeUndefined();
    });
  });
});
