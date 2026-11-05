import { describe, it, expect } from "vitest";
import { PositionSizer, calculateDynamicAllocation } from "../../lib/positionSizer";
import { LeverageManager } from "../../lib/leverageManager";

describe("Phase 4: Fractional Kelly Position Sizer & Dynamic Capital Allocator", () => {
  it("should enforce explicit hurdle check: negative or zero net spread yields 0.0 allocation", () => {
    // Zero spread with 0.0 hurdle
    const resZero = PositionSizer.calculateKellyFraction(0.0, 100, 0.25, 0.0);
    expect(resZero.fraction).toBe(0.0);
    expect(resZero.hurdleCleared).toBe(false);
    expect(resZero.reason).toContain("HURDLE_REJECTED");

    // Negative spread
    const resNeg = PositionSizer.calculateKellyFraction(-15.0, 250, 0.25, 0.0);
    expect(resNeg.fraction).toBe(0.0);
    expect(resNeg.hurdleCleared).toBe(false);

    // Spread below positive hurdle (e.g. 5 bps spread < 10 bps hurdle)
    const resHurdle = PositionSizer.calculateKellyFraction(5.0, 100, 0.25, 10.0);
    expect(resHurdle.fraction).toBe(0.0);
    expect(resHurdle.hurdleCleared).toBe(false);
  });

  it("should guard against non-positive or invalid variance", () => {
    const resZeroVar = PositionSizer.calculateKellyFraction(45.0, 0, 0.25, 0.0);
    expect(resZeroVar.fraction).toBe(0.0);
    expect(resZeroVar.hurdleCleared).toBe(false);

    const resNegVar = PositionSizer.calculateKellyFraction(45.0, -50, 0.25, 0.0);
    expect(resNegVar.fraction).toBe(0.0);
    expect(resNegVar.hurdleCleared).toBe(false);

    const resNan = PositionSizer.calculateKellyFraction(45.0, NaN, 0.25, 0.0);
    expect(resNan.fraction).toBe(0.0);
    expect(resNan.hurdleCleared).toBe(false);
  });

  it("should compute Quarter-Kelly fraction and clamp correctly between 10% and 35%", () => {
    // 1. Moderate edge: mu = 40 bps, var = 100 bps^2 -> raw = 0.40 -> Quarter-Kelly = 0.10 (at 10% lower clamp)
    const resMod = PositionSizer.calculateKellyFraction(40.0, 100, 0.25, 0.0);
    expect(resMod.fraction).toBeCloseTo(0.10, 4);
    expect(resMod.hurdleCleared).toBe(true);

    // 2. High edge: mu = 80 bps, var = 100 bps^2 -> raw = 0.80 -> Quarter-Kelly = 0.20 (20%)
    const resHigh = PositionSizer.calculateKellyFraction(80.0, 100, 0.25, 0.0);
    expect(resHigh.fraction).toBeCloseTo(0.20, 4);
    expect(resHigh.hurdleCleared).toBe(true);

    // 3. Extreme edge: mu = 300 bps, var = 100 bps^2 -> raw = 3.0 -> Quarter-Kelly = 0.75 -> clamped to 0.35 (35% max)
    const resExtreme = PositionSizer.calculateKellyFraction(300.0, 100, 0.25, 0.0);
    expect(resExtreme.fraction).toBe(0.35);
    expect(resExtreme.hurdleCleared).toBe(true);

    // 4. Low edge: mu = 10 bps, var = 200 bps^2 -> raw = 0.05 -> Quarter-Kelly = 0.0125 -> clamped to 0.10 (10% min)
    const resLow = PositionSizer.calculateKellyFraction(10.0, 200, 0.25, 0.0);
    expect(resLow.fraction).toBe(0.10);
    expect(resLow.hurdleCleared).toBe(true);
  });

  it("should balance asymmetric margins maintaining strict 1:1 delta-neutral notional parity", () => {
    const res = calculateDynamicAllocation({
      corridor: "BINANCE_BYBIT",
      symbol: "BTCUSDT",
      venueAFreeBalance: 24.0,
      venueBFreeBalance: 15.0,
      expectedNetSpreadBps: 45.0,
      basisVariance: 100.0,
      atr1hPct: 0.4,
      maxExchangeLeverageA: 50,
      maxExchangeLeverageB: 50,
      totalPortfolioNav: 39.0,
      minHurdleBps: 0.0,
    });

    expect(res.hurdleCleared).toBe(true);
    expect(res.allocatedMarginTotal).toBeGreaterThan(0);
    expect(res.matchedNotionalUsd).toBeGreaterThan(0);

    // Margin A * Lev A must closely match Margin B * Lev B (within 1 cent rounding)
    const notionalA = res.allocatedMarginA * res.leverageA;
    const notionalB = res.allocatedMarginB * res.leverageB;
    expect(Math.abs(notionalA - notionalB)).toBeLessThanOrEqual(0.05);

    // Free balance constraints
    expect(res.allocatedMarginA).toBeLessThanOrEqual(24.0);
    expect(res.allocatedMarginB).toBeLessThanOrEqual(15.0);

    // Positive liquidation buffers
    expect(res.liquidationBufferPctA).toBeGreaterThan(0);
    expect(res.liquidationBufferPctB).toBeGreaterThan(0);
  });
});

describe("Phase 4: Volatility-Adjusted Dynamic Leverage Engine", () => {
  it("should calibrate leverage correctly by asset tier under normal ATR", () => {
    // Tier 1 (BTC): 25x - 50x
    const btcLev = LeverageManager.evaluateDynamicLeverage("BTCUSDT", "Binance", 0.4, 24, 50);
    expect(btcLev.tier).toBe("TIER_1_MAJOR");
    expect(btcLev.effectiveLeverage).toBeGreaterThanOrEqual(25);
    expect(btcLev.effectiveLeverage).toBeLessThanOrEqual(50);
    expect(btcLev.isDefensiveFallback).toBe(false);

    // Tier 2 (SOL): 15x - 25x
    const solLev = LeverageManager.evaluateDynamicLeverage("SOLUSDT", "Bybit", 1.2, 24, 50);
    expect(solLev.tier).toBe("TIER_2_LARGE_CAP");
    expect(solLev.effectiveLeverage).toBeGreaterThanOrEqual(15);
    expect(solLev.effectiveLeverage).toBeLessThanOrEqual(25);
    expect(solLev.isDefensiveFallback).toBe(false);

    // Tier 3 (Altcoins / Meme): 3x - 10x
    const memeLev = LeverageManager.evaluateDynamicLeverage("PEPEUSDT", "Bybit", 3.5, 24, 50);
    expect(memeLev.tier).toBe("TIER_3_ALTCOIN");
    expect(memeLev.effectiveLeverage).toBeGreaterThanOrEqual(3);
    expect(memeLev.effectiveLeverage).toBeLessThanOrEqual(10);
    expect(memeLev.isDefensiveFallback).toBe(false);
  });

  it("should trigger defensive fallback when candle count is insufficient or ATR is invalid", () => {
    // Insufficient candles (< 14)
    const unseeded = LeverageManager.evaluateDynamicLeverage("NEWCOINUSDT", "Binance", 1.0, 5, 50);
    expect(unseeded.isDefensiveFallback).toBe(true);
    expect(unseeded.effectiveLeverage).toBeLessThanOrEqual(15);
    expect(unseeded.reason).toContain("DEFENSIVE_FALLBACK");

    // Invalid ATR
    const invalidAtr = LeverageManager.evaluateDynamicLeverage("DOGEUSDT", "Binance", NaN, 24, 50);
    expect(invalidAtr.isDefensiveFallback).toBe(true);
    expect(invalidAtr.effectiveLeverage).toBeLessThanOrEqual(15);
  });
});
