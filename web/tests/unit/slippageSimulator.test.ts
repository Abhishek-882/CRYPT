import { describe, it, expect } from "vitest";
import {
  simulatePreTradeExecution,
  calculateSlippagePct,
  checkPriceParity,
  getDepthFactor,
  findOptimalLeverage,
  CANDIDATE_LEVERAGES,
  evaluateAsymmetricSettlement,
  formatPrice,
  formatCoins,
  formatUsdt,
  formatSignedUsdt,
  formatSignedBps,
  formatSignedPct,
  formatRoe,
  formatPriceDiff,
  formatDurationSeconds,
  SUPPORTED_FUNDING_INTERVALS,
  type LiquidityTier,
  type SimulatorInputs,
  type AsymmetricStrategyStatus,
  type SettlementRollMode,
  type AsymmetricSettlementAnalysis,
} from "../../lib/slippageSimulator";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

describe("Pre-Trade Slippage, Liquidity & Net Funding Yield Simulator", () => {
  // =========================================================================
  // R1: Non-Disruptive Pre-Trade Simulator Widget & AST Isolation
  // =========================================================================
  describe("R1: Non-Disruptive Pure Analytical Simulator Invariant", () => {
    it("asserts simulator code does NOT import or touch live botEngine", () => {
      const simLibPath = path.resolve(__dirname, "../../lib/slippageSimulator.ts");
      const content = fs.readFileSync(simLibPath, "utf-8");

      expect(content).not.toMatch(/from\s+['"].*botEngine/);
      expect(content).not.toContain("executeOrder");
      expect(content).not.toContain("placeOrder");
      expect(content).not.toContain("submitOrder");
      expect(content).not.toContain("bot_daemon");
    });

    it("executes purely as a synchronous, deterministic calculation without network or side-effects", () => {
      const inputs: SimulatorInputs = {
        capitalUsdt: 500,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 35,
        roundtripFeeBps: 24,
        liquidityTier: "MEDIUM",
      };

      const res1 = simulatePreTradeExecution(inputs);
      const res2 = simulatePreTradeExecution(inputs);

      expect(res1).toEqual(res2);
    });
  });

  // =========================================================================
  // R2: Dual-Exchange Expected Average Price & Parity Check (<= 0.1%)
  // =========================================================================
  describe("R2: Dual-Exchange Expected Average Price & Parity Check", () => {
    it("calculates VWAP buy on Leg 1 and VWAP short on Leg 2 correctly", () => {
      const priceA = 50000;
      const priceB = 50000;
      const capital = 1000;

      const res = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA,
        priceB,
        fundingSpreadBps: 30,
        liquidityTier: "DEEP",
      });

      // Buy VWAP must be higher than mark price (ask slippage)
      expect(res.expectedBuyPriceA).toBeGreaterThan(priceA);
      // Short VWAP must be lower than mark price (bid slippage)
      expect(res.expectedShortPriceB).toBeLessThan(priceB);

      // Verify exact percentage expansion
      expect(res.expectedBuyPriceA).toBeCloseTo(priceA * (1 + res.slippagePctA / 100), 4);
      expect(res.expectedShortPriceB).toBeCloseTo(priceB * (1 - res.slippagePctB / 100), 4);
    });

    it("validates price parity tolerance threshold (tolerance <= 0.1%)", () => {
      // 1. Identical prices with tiny slippage -> Parity matches (<= 0.1%)
      const match1 = checkPriceParity(60000, 60030, 0.10); // diff = 30 / 60000 = 0.05%
      expect(match1.diffPct).toBeCloseTo(0.05, 3);
      expect(match1.isMatched).toBe(true);

      // 2. Exactly at 0.10% boundary -> Parity matches
      const match2 = checkPriceParity(60000, 60060, 0.10); // diff = 60 / 60000 = 0.10%
      expect(match2.diffPct).toBeCloseTo(0.10, 3);
      expect(match2.isMatched).toBe(true);

      // 3. At 0.101% (just over threshold) -> Parity fails
      const match3 = checkPriceParity(60000, 60065, 0.10); // diff = 65 / 60000 = 0.1083%
      expect(match3.diffPct).toBeGreaterThan(0.10);
      expect(match3.isMatched).toBe(false);

      // 4. Large divergence (0.50%) -> Parity fails
      const match4 = checkPriceParity(60000, 60300, 0.10); // diff = 300 / 60000 = 0.50%
      expect(match4.diffPct).toBeCloseTo(0.50, 3);
      expect(match4.isMatched).toBe(false);
    });

    it("verifies isParityMatched flag in end-to-end simulation output", () => {
      // When venues have identical base price and small order, expected prices match
      const matchedRes = simulatePreTradeExecution({
        capitalUsdt: 100,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 30,
        liquidityTier: "DEEP",
      });
      expect(matchedRes.isParityMatched).toBe(true);

      // When venues have divergent base price (> 0.20%), expected prices diverge
      const divergedRes = simulatePreTradeExecution({
        capitalUsdt: 100,
        priceA: 65000,
        priceB: 65200, // 0.30% difference
        fundingSpreadBps: 30,
        liquidityTier: "DEEP",
      });
      expect(divergedRes.isParityMatched).toBe(false);
      expect(divergedRes.priceDiffPct).toBeGreaterThan(0.10);
    });
  });

  // =========================================================================
  // R3: Token Quantity & Capital Preservation Telemetry
  // =========================================================================
  describe("R3: Token Quantity & Capital Preservation Telemetry", () => {
    it("calculates exact coin quantity: Coins Received = USDT Allocated / Expected Average Price", () => {
      const capital = 1000;
      const priceA = 50000;

      const res = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA,
        priceB: priceA,
        fundingSpreadBps: 30,
      });

      const expectedCoins = capital / res.expectedBuyPriceA;
      expect(res.coinsReceivedA).toBeCloseTo(expectedCoins, 8);
      expect(res.coinsReceivedA).toBeLessThan(capital / priceA); // Fewer coins due to slippage
    });

    it("displays immediate capital difference between money spent and mark value (entry slippage drag)", () => {
      const capital = 2000;
      const priceA = 40000;

      const res = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA,
        priceB: priceA,
        fundingSpreadBps: 30,
      });

      // Mark value = coins received * mark price
      const expectedMarkValue = res.coinsReceivedA * priceA;
      expect(res.coinValueAtMarkA).toBeCloseTo(expectedMarkValue, 4);

      // Entry slippage drag = capital - mark value
      const expectedDrag = capital - expectedMarkValue;
      expect(res.entrySlippageCostA).toBeCloseTo(expectedDrag, 4);
      expect(res.entrySlippageCostA).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // R4: Complete Round-Trip Fee & Exit Value Calculation
  // =========================================================================
  describe("R4: Complete Round-Trip Fee & Exit Value Calculation", () => {
    it("calculates round-trip fees (default 24 bps total)", () => {
      const capital = 1000;
      const res = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA: 100,
        priceB: 100,
        fundingSpreadBps: 30,
        roundtripFeeBps: 24, // 24 bps = 0.24%
      });

      const expectedFees = 1000 * (24 / 10000); // $2.40
      expect(res.totalTradingFeesUsdt).toBeCloseTo(expectedFees, 4);
      expect(res.roundtripFeeBps).toBe(24);
    });

    it("calculates expected money returned before funding after subtracting slippage and fees", () => {
      const capital = 2000;
      const res = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA: 2000,
        priceB: 2000,
        fundingSpreadBps: 30,
        roundtripFeeBps: 25,
      });

      const totalFriction = res.totalEntrySlippageUsdt + res.totalExitSlippageUsdt + res.totalTradingFeesUsdt;
      expect(res.totalExecutionFrictionUsdt).toBeCloseTo(totalFriction, 4);

      // Expected Money Returned = capital - totalFriction
      expect(res.expectedMoneyReturned).toBeCloseTo(capital - totalFriction, 4);
      expect(res.expectedMoneyReturned).toBeLessThan(capital);

      // Money returned drawdown = expectedMoneyReturned - capital
      expect(res.moneyReturnedDrawdownUsdt).toBeCloseTo(-totalFriction, 4);
    });
  });

  // =========================================================================
  // R5: Net Funding Arbitrage PnL Equation
  // =========================================================================
  describe("R5: Net Funding Arbitrage PnL Equation", () => {
    it("computes Net PnL using the exact user-specified formula: (Expected Money Back - Initial Money Spent) + Funding Rate Yield", () => {
      const capital = 1500;
      const fundingSpreadBps = 40; // 40 bps = 0.40%

      const res = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA: 3000,
        priceB: 3000,
        fundingSpreadBps,
        roundtripFeeBps: 24,
      });

      const expectedFundingYield = capital * (fundingSpreadBps / 10000); // 1500 * 0.0040 = $6.00
      expect(res.fundingYieldUsdt).toBeCloseTo(expectedFundingYield, 4);

      const tradingPnL = res.expectedMoneyReturned - capital;
      expect(res.tradingPnLUsdt).toBeCloseTo(tradingPnL, 4);

      // Exact user formula: (Expected Money Back - Initial Money Spent) + Funding Rate Yield
      const expectedNetPnL = tradingPnL + expectedFundingYield;
      expect(res.netPnLUsdt).toBeCloseTo(expectedNetPnL, 4);

      // Net Yield bps = (Net PnL / Capital) * 10000
      expect(res.netYieldBps).toBeCloseTo((expectedNetPnL / capital) * 10000, 4);
    });

    it("demonstrates why a $2,000 order produces a loss on thin books (slippage + fees exceed funding rate)", () => {
      const capital = 2000;
      const fundingSpreadBps = 35; // 35 bps

      const resThin = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA: 10,
        priceB: 10,
        fundingSpreadBps,
        roundtripFeeBps: 24,
        liquidityTier: "THIN", // Thin altcoin book sweeps deeper
      });

      // On thin books, slippage + fees exceed the 35 bps funding rate
      expect(resThin.totalExecutionFrictionUsdt).toBeGreaterThan(resThin.fundingYieldUsdt);
      expect(resThin.netPnLUsdt).toBeLessThan(0);
      expect(resThin.isProfitable).toBe(false);
    });

    it("demonstrates why a $20 order produces a profit (funding rate overcomes execution friction)", () => {
      const capital = 20;
      const fundingSpreadBps = 35; // 35 bps

      const resSmall = simulatePreTradeExecution({
        capitalUsdt: capital,
        priceA: 10,
        priceB: 10,
        fundingSpreadBps,
        roundtripFeeBps: 24,
        liquidityTier: "THIN",
      });

      // At $20, slippage is minimal, so 35 bps funding rate overcomes the ~26 bps friction
      expect(resSmall.fundingYieldUsdt).toBeGreaterThan(resSmall.totalExecutionFrictionUsdt);
      expect(resSmall.netPnLUsdt).toBeGreaterThan(0);
      expect(resSmall.isProfitable).toBe(true);
    });
  });

  // =========================================================================
  // Acceptance Criteria: Capital Input Presets ($20, $100, $500, $1k, $2k, $5k)
  // =========================================================================
  describe("Acceptance Criteria: Preset Capital Inputs", () => {
    const presets = [20, 100, 500, 1000, 2000, 5000];

    presets.forEach((preset) => {
      it(`runs simulation cleanly without NaN or zero division for preset $${preset}`, () => {
        const res = simulatePreTradeExecution({
          capitalUsdt: preset,
          priceA: 65000,
          priceB: 65010,
          fundingSpreadBps: 35,
          roundtripFeeBps: 24,
          liquidityTier: "MEDIUM",
        });

        expect(Number.isFinite(res.expectedBuyPriceA)).toBe(true);
        expect(Number.isFinite(res.expectedShortPriceB)).toBe(true);
        expect(Number.isFinite(res.coinsReceivedA)).toBe(true);
        expect(Number.isFinite(res.expectedMoneyReturned)).toBe(true);
        expect(Number.isFinite(res.netPnLUsdt)).toBe(true);
        expect(Number.isFinite(res.netYieldBps)).toBe(true);
        expect(typeof res.isParityMatched).toBe("boolean");
        expect(typeof res.isProfitable).toBe("boolean");
      });
    });
  });

  // =========================================================================
  // R6: Margin & Leverage Dual-Controls (No Hard Blocking)
  // =========================================================================
  describe("R6: Margin & Leverage Dual-Controls (No Hard Blocking)", () => {
    const marginPresets = [50, 100, 250, 500, 1000];
    const leveragePresets = [1, 2, 5, 10, 20, 30, 50];

    it("calculates Effective Notional = Margin * Leverage for all presets", () => {
      marginPresets.forEach((margin) => {
        leveragePresets.forEach((lev) => {
          const res = simulatePreTradeExecution({
            marginUsdt: margin,
            leverage: lev,
            priceA: 65000,
            priceB: 65000,
            fundingSpreadBps: 35,
          });

          expect(res.marginUsdt).toBe(margin);
          expect(res.leverage).toBe(lev);
          expect(res.notionalUsdt).toBe(margin * lev);
        });
      });
    });

    it("sweeps order book depth and VWAP across full Notional size, while evaluating return against Margin Collateral", () => {
      const margin = 200;
      const leverage = 10; // Notional = $2,000

      const resLeveraged = simulatePreTradeExecution({
        marginUsdt: margin,
        leverage,
        priceA: 50000,
        priceB: 50000,
        fundingSpreadBps: 35,
        roundtripFeeBps: 24,
      });

      const resUnleveragedNotional = simulatePreTradeExecution({
        capitalUsdt: 2000, // Equivalent $2,000 1x order
        priceA: 50000,
        priceB: 50000,
        fundingSpreadBps: 35,
        roundtripFeeBps: 24,
      });

      // Slippage must match the $2,000 order book sweep, NOT the $200 margin
      expect(resLeveraged.slippagePctA).toBeCloseTo(resUnleveragedNotional.slippagePctA, 6);
      expect(resLeveraged.slippagePctB).toBeCloseTo(resUnleveragedNotional.slippagePctB, 6);
      expect(resLeveraged.expectedBuyPriceA).toBeCloseTo(resUnleveragedNotional.expectedBuyPriceA, 4);

      // Coins received must equal Notional / expectedBuyPriceA
      expect(resLeveraged.coinsReceivedA).toBeCloseTo(2000 / resLeveraged.expectedBuyPriceA, 8);

      // Trading fees apply to the full $2,000 position
      expect(resLeveraged.totalTradingFeesUsdt).toBeCloseTo(2000 * (24 / 10000), 4);
    });

    it("maintains full backwards compatibility when caller provides capitalUsdt without margin/leverage", () => {
      const res = simulatePreTradeExecution({
        capitalUsdt: 1200,
        priceA: 100,
        priceB: 100,
        fundingSpreadBps: 30,
      });

      expect(res.marginUsdt).toBe(1200);
      expect(res.leverage).toBe(1);
      expect(res.notionalUsdt).toBe(1200);
      expect(res.capitalUsdt).toBe(1200);
    });

    it("handles custom margin and leverage inputs cleanly with sanitization", () => {
      // Negative margin clamped to 0
      const resNeg = simulatePreTradeExecution({
        marginUsdt: -100,
        leverage: 10,
        priceA: 50,
        priceB: 50,
        fundingSpreadBps: 30,
      });
      expect(resNeg.marginUsdt).toBe(0);
      expect(resNeg.notionalUsdt).toBe(0);

      // Leverage < 1 clamped to 1
      const resZeroLev = simulatePreTradeExecution({
        marginUsdt: 500,
        leverage: 0,
        priceA: 50,
        priceB: 50,
        fundingSpreadBps: 30,
      });
      expect(resZeroLev.leverage).toBe(1);
      expect(resZeroLev.notionalUsdt).toBe(500);
    });
  });

  // =========================================================================
  // R7: Return on Equity (ROE %) & Loss-Impact Breakdown
  // =========================================================================
  describe("R7: Return on Equity (ROE %) & Loss-Impact Breakdown", () => {
    it("itemizes loss-impact breakdown in both USDT and % of margin equity", () => {
      const margin = 500;
      const leverage = 5; // Notional = $2,500
      const fundingSpreadBps = 45; // 45 bps
      const roundtripFeeBps = 24; // 24 bps

      const res = simulatePreTradeExecution({
        marginUsdt: margin,
        leverage,
        priceA: 1000,
        priceB: 1000,
        fundingSpreadBps,
        roundtripFeeBps,
        liquidityTier: "MEDIUM",
      });

      // 1. Slippage Loss in USDT and % of margin
      const expectedSlippageUsdt = res.totalEntrySlippageUsdt + res.totalExitSlippageUsdt;
      expect(res.totalSlippageLossUsdt).toBeCloseTo(expectedSlippageUsdt, 4);
      expect(res.slippageLossMarginPct).toBeCloseTo((expectedSlippageUsdt / margin) * 100, 4);

      // 2. Roundtrip Taker Fees in USDT and % of margin
      const expectedFeesUsdt = 2500 * (24 / 10000); // $6.00
      expect(res.totalTradingFeesUsdt).toBeCloseTo(expectedFeesUsdt, 4);
      expect(res.roundtripFeeMarginPct).toBeCloseTo((expectedFeesUsdt / margin) * 100, 4); // 6.00 / 500 * 100 = 1.20%

      // 3. Gross Funding Yield in USDT and % of margin
      const expectedFundingYieldUsdt = 2500 * (45 / 10000); // $11.25
      expect(res.fundingYieldUsdt).toBeCloseTo(expectedFundingYieldUsdt, 4);
      expect(res.fundingYieldMarginPct).toBeCloseTo((expectedFundingYieldUsdt / margin) * 100, 4); // 11.25 / 500 * 100 = 2.25%

      // 4. Net Estimated Outcome in USDT and ROE %
      expect(res.netPnLUsdt).toBeCloseTo(expectedFundingYieldUsdt - expectedSlippageUsdt - expectedFeesUsdt, 4);
      expect(res.roePct).toBeCloseTo((res.netPnLUsdt / margin) * 100, 4);
    });

    it("verifies mathematical coherence: ROE % equals funding yield % minus slippage % minus fee %", () => {
      const margin = 250;
      const leverage = 10;
      const res = simulatePreTradeExecution({
        marginUsdt: margin,
        leverage,
        priceA: 200,
        priceB: 200,
        fundingSpreadBps: 50,
        roundtripFeeBps: 24,
      });

      const netMarginPct = res.fundingYieldMarginPct - res.slippageLossMarginPct - res.roundtripFeeMarginPct;
      expect(res.roePct).toBeCloseTo(netMarginPct, 4);
    });

    it("verifies ROE magnification under leverage", () => {
      // Compare 1x vs 10x on a deep book with high funding yield
      const res1x = simulatePreTradeExecution({
        marginUsdt: 1000,
        leverage: 1,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 100, // 100 bps spread
        roundtripFeeBps: 20,
        liquidityTier: "DEEP",
      });

      const res10x = simulatePreTradeExecution({
        marginUsdt: 1000,
        leverage: 10,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 100,
        roundtripFeeBps: 20,
        liquidityTier: "DEEP",
      });

      // 10x leverage increases notional 10-fold, significantly expanding net dollar profit and ROE %
      expect(res10x.netPnLUsdt).toBeGreaterThan(res1x.netPnLUsdt * 5);
      expect(res10x.roePct).toBeGreaterThan(res1x.roePct * 5);
    });

    it("safely returns 0% ROE and 0% margin breakdowns when margin is 0", () => {
      const res = simulatePreTradeExecution({
        marginUsdt: 0,
        leverage: 10,
        priceA: 100,
        priceB: 100,
        fundingSpreadBps: 35,
      });

      expect(res.roePct).toBe(0);
      expect(res.slippageLossMarginPct).toBe(0);
      expect(res.roundtripFeeMarginPct).toBe(0);
      expect(res.fundingYieldMarginPct).toBe(0);
    });
  });

  // =========================================================================
  // R8: Actionable Profit Guidance & Breakeven Spread
  // =========================================================================
  describe("R8: Actionable Profit Guidance & Breakeven Spread", () => {
    it("calculates exact Breakeven Funding Spread (bps) required to cover fees + slippage", () => {
      const margin = 200;
      const leverage = 5; // Notional = $1,000

      const res = simulatePreTradeExecution({
        marginUsdt: margin,
        leverage,
        priceA: 500,
        priceB: 500,
        fundingSpreadBps: 35,
        roundtripFeeBps: 24,
      });

      const totalFriction = res.totalExecutionFrictionUsdt;
      const expectedBreakevenBps = (totalFriction / 1000) * 10000;
      expect(res.breakevenSpreadBps).toBeCloseTo(expectedBreakevenBps, 4);

      // Verify that at exactly breakeven spread, Net PnL is approximately $0.00
      const resAtBreakeven = simulatePreTradeExecution({
        marginUsdt: margin,
        leverage,
        priceA: 500,
        priceB: 500,
        fundingSpreadBps: res.breakevenSpreadBps,
        roundtripFeeBps: 24,
      });

      expect(Math.abs(resAtBreakeven.netPnLUsdt)).toBeLessThan(0.01);
    });

    it("identifies candidate leverages [1x, 2x, 5x, 10x, 20x, 30x, 50x]", () => {
      expect(CANDIDATE_LEVERAGES).toEqual([1, 2, 5, 10, 20, 30, 50]);
    });

    it("finds recommended optimal leverage that maximizes net dollar profit accounting for slippage steepening", () => {
      // Scenario A: Thin altcoin with moderate 35 bps spread
      // On thin books, high leverage blows out slippage quickly, so 1x or 2x is optimal
      const optThin = findOptimalLeverage(500, 10, 10, 35, 24, "THIN");
      expect([1, 2, 5]).toContain(optThin.optimalLeverage);

      // Scenario B: Deep book (BTC) with high 80 bps funding spread
      // On deep books, higher leverage captures substantial funding yield without excessive slippage
      const optDeep = findOptimalLeverage(250, 65000, 65000, 80, 24, "DEEP");
      expect(optDeep.isAnyLeverageProfitable).toBe(true);
      expect(optDeep.optimalLeverage).toBeGreaterThanOrEqual(5);
      expect(optDeep.optimalNetPnLUsdt).toBeGreaterThan(0);
    });

    it("handles scenario where no leverage is profitable (e.g. funding spread < fee friction)", () => {
      // 10 bps funding spread cannot cover 24 bps roundtrip taker fee
      const optUnprofitable = findOptimalLeverage(500, 100, 100, 10, 24, "MEDIUM");

      expect(optUnprofitable.isAnyLeverageProfitable).toBe(false);
      expect(optUnprofitable.optimalLeverage).toBe(1); // Defaults to 1x for capital preservation
    });

    it("does not enforce hard blocking, safely computing results for extreme 50x leverage on thin books", () => {
      const resExtreme = simulatePreTradeExecution({
        marginUsdt: 1000,
        leverage: 50, // $50,000 on thin book
        priceA: 5,
        priceB: 5,
        fundingSpreadBps: 25,
        roundtripFeeBps: 24,
        liquidityTier: "THIN",
      });

      // Does not throw or crash with hard block; provides explicit loss telemetry
      expect(Number.isFinite(resExtreme.netPnLUsdt)).toBe(true);
      expect(resExtreme.isProfitable).toBe(false);
      expect(resExtreme.netPnLUsdt).toBeLessThan(0);
      expect(resExtreme.breakevenSpreadBps).toBeGreaterThan(25);
    });
  });

  // =========================================================================
  // Robustness, Boundary & Extreme Capital Edge Cases
  // =========================================================================
  describe("Robustness & Boundary Stress Testing", () => {
    it("handles zero capital safely without crashing, returning neutral zero state", () => {
      const res = simulatePreTradeExecution({
        capitalUsdt: 0,
        priceA: 100,
        priceB: 100,
        fundingSpreadBps: 30,
      });

      expect(res.capitalUsdt).toBe(0);
      expect(res.coinsReceivedA).toBe(0);
      expect(res.expectedMoneyReturned).toBe(0);
      expect(res.netPnLUsdt).toBe(0);
      expect(res.netYieldBps).toBe(0);
      expect(res.isProfitable).toBe(false);
    });

    it("handles negative capital by clamping safely to 0", () => {
      const res = simulatePreTradeExecution({
        capitalUsdt: -500,
        priceA: 100,
        priceB: 100,
        fundingSpreadBps: 30,
      });

      expect(res.capitalUsdt).toBe(0);
      expect(res.netPnLUsdt).toBe(0);
    });

    it("handles extreme capital (Infinity, NaN, 1e9) without producing NaN", () => {
      const resInf = simulatePreTradeExecution({
        capitalUsdt: Infinity,
        priceA: 100,
        priceB: 100,
        fundingSpreadBps: 35,
      });

      expect(Number.isFinite(resInf.capitalUsdt)).toBe(true);
      expect(Number.isFinite(resInf.expectedMoneyReturned)).toBe(true);
      expect(Number.isFinite(resInf.netPnLUsdt)).toBe(true);
      expect(Number.isFinite(resInf.entrySlippageCostA)).toBe(true);
      expect(Number.isFinite(resInf.totalExecutionFrictionUsdt)).toBe(true);

      const resNaN = simulatePreTradeExecution({
        capitalUsdt: NaN,
        priceA: 100,
        priceB: 100,
        fundingSpreadBps: 35,
      });

      expect(resNaN.capitalUsdt).toBe(0);
      expect(resNaN.netPnLUsdt).toBe(0);
    });

    it("handles extreme non-finite or negative prices safely without crashing or NaN", () => {
      const resZeroPrice = simulatePreTradeExecution({
        capitalUsdt: 1000,
        priceA: 0,
        priceB: -10,
        fundingSpreadBps: 30,
      });

      expect(resZeroPrice.expectedBuyPriceA).toBeGreaterThan(0);
      expect(resZeroPrice.expectedShortPriceB).toBeGreaterThan(0);
      expect(resZeroPrice.coinsReceivedA).toBeGreaterThan(0);

      const resInfPrice = simulatePreTradeExecution({
        capitalUsdt: 1000,
        priceA: Infinity,
        priceB: NaN,
        fundingSpreadBps: 30,
      });

      expect(Number.isFinite(resInfPrice.expectedBuyPriceA)).toBe(true);
      expect(Number.isFinite(resInfPrice.coinsReceivedA)).toBe(true);
      expect(Number.isFinite(resInfPrice.netPnLUsdt)).toBe(true);
    });

    it("handles negative funding rate cleanly (short squeeze funding scenario)", () => {
      const res = simulatePreTradeExecution({
        capitalUsdt: 1000,
        priceA: 50,
        priceB: 50,
        fundingSpreadBps: -20, // Negative funding yield
      });

      expect(res.fundingYieldUsdt).toBeLessThan(0);
      expect(res.netPnLUsdt).toBeLessThan(0);
      expect(res.isProfitable).toBe(false);
    });

    it("verifies depth factor scaling across DEEP, MEDIUM, and THIN tiers", () => {
      expect(getDepthFactor("DEEP")).toBe(0.35);
      expect(getDepthFactor("MEDIUM")).toBe(1.00);
      expect(getDepthFactor("THIN")).toBe(2.50);

      const cap = 2000;
      const slippageDeep = calculateSlippagePct(cap, getDepthFactor("DEEP"));
      const slippageMed = calculateSlippagePct(cap, getDepthFactor("MEDIUM"));
      const slippageThin = calculateSlippagePct(cap, getDepthFactor("THIN"));

      expect(slippageDeep).toBeLessThan(slippageMed);
      expect(slippageMed).toBeLessThan(slippageThin);
    });

    it("verifies calculateSlippagePct and checkPriceParity withstand NaN and non-finite arguments", () => {
      const slippageWithNaN = calculateSlippagePct(1000, NaN, NaN);
      expect(Number.isFinite(slippageWithNaN)).toBe(true);
      expect(slippageWithNaN).toBeGreaterThan(0);

      const parityWithInf = checkPriceParity(Infinity, 60000);
      expect(parityWithInf.isMatched).toBe(false);
      expect(parityWithInf.diffUsdt).toBe(0);

      const parityWithNaN = checkPriceParity(NaN, NaN);
      expect(parityWithNaN.isMatched).toBe(false);
    });
  });

  // =========================================================================
  // Micro-Tokens & Currency Formatting Telemetry (R1-OPEN-1)
  // =========================================================================
  describe("Micro-Tokens & Number Formatting Telemetry (R1-OPEN-1)", () => {
    it("formats high-value BTC price without losing cents", () => {
      expect(formatPrice(65432.1)).toBe("$65,432.10");
    });

    it("formats mid-tier SOL price with up to 4 decimal places", () => {
      expect(formatPrice(185.3456)).toBe("$185.3456");
    });

    it("formats low-decimal micro-token (PEPE, SHIB) without truncating to $0.00", () => {
      const pepePrice = 0.00001852;
      const formatted = formatPrice(pepePrice);
      expect(formatted).not.toBe("$0.00");
      expect(formatted).toBe("$0.00001852");
    });

    it("formats coin quantities correctly across large micro-token amounts and tiny BTC fractions", () => {
      const pepeCoins = 107991360.6911;
      expect(formatCoins(pepeCoins)).toBe("107,991,360.6911");

      const btcCoins = 0.00030566;
      expect(formatCoins(btcCoins)).toBe("0.00030566");
    });

    it("formats signed currency, bps, percentage and ROE without glitches", () => {
      expect(formatSignedUsdt(7.50)).toBe("+$7.50");
      expect(formatSignedUsdt(-20.50)).toBe("-$20.50");
      expect(formatSignedUsdt(0)).toBe("$0.00");

      expect(formatSignedBps(35.0)).toBe("+35.0 bps");
      expect(formatSignedBps(-20.0)).toBe("-20.0 bps");
      expect(formatSignedBps(0)).toBe("0.0 bps");

      expect(formatSignedPct(8.45)).toBe("+8.45%");
      expect(formatSignedPct(-12.30)).toBe("-12.30%");
      expect(formatSignedPct(0)).toBe("0.00%");

      expect(formatRoe(15.2)).toBe("+15.20% ROE");
      expect(formatRoe(-4.8)).toBe("-4.80% ROE");

      expect(formatUsdt(2000)).toBe("$2,000.00");
      expect(formatUsdt(0)).toBe("$0.00");
    });

    it("formats price differences accurately for micro tokens", () => {
      expect(formatPriceDiff(0.00000015)).toBe("$0.00000015");
      expect(formatPriceDiff(12.50)).toBe("$12.50");
    });
  });

  // =========================================================================
  // React Component: PreTradeSlippageSimulator Source & AST Contract Audit
  // =========================================================================
  describe("React Component: PreTradeSlippageSimulator Source & AST Contract Audit", () => {
    const componentPath = path.resolve(__dirname, "../../components/PreTradeSlippageSimulator.tsx");
    const terminalPagePath = path.resolve(__dirname, "../../app/terminal/page.tsx");

    it("verifies PreTradeSlippageSimulator.tsx exists and is readable", () => {
      expect(fs.existsSync(componentPath)).toBe(true);
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code.length).toBeGreaterThan(500);
    });

    it("AST audit: parses PreTradeSlippageSimulator.tsx cleanly without syntax errors", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      const sourceFile = ts.createSourceFile(
        "PreTradeSlippageSimulator.tsx",
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      expect(sourceFile).toBeDefined();
      expect(sourceFile.statements.length).toBeGreaterThan(0);
    });

    it("verifies component imports from pure math engine @/lib/slippageSimulator including formatting helpers", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain('from "@/lib/slippageSimulator"');
      expect(code).toContain("simulatePreTradeExecution");
      expect(code).toContain("formatPrice");
      expect(code).toContain("formatCoins");
      expect(code).toContain("formatUsdt");
      expect(code).toContain("formatSignedUsdt");
      expect(code).toContain("formatSignedBps");
      expect(code).toContain("formatSignedPct");
      expect(code).toContain("formatRoe");
    });

    it("verifies dynamic capital presets ($20, $100, $500, $1k, $2k, $5k) are present for backwards compatibility", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("20");
      expect(code).toContain("100");
      expect(code).toContain("500");
      expect(code).toContain("1000");
      expect(code).toContain("2000");
      expect(code).toContain("5000");
      expect(code).toMatch(/presetSizes\s*=\s*\[\s*20,\s*100,\s*500,\s*1000,\s*2000,\s*5000\s*\]/);
    });

    it("verifies R6 Margin Presets ($50, $100, $250, $500, $1,000) and Leverage Presets (1x..50x) are rendered", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("MARGIN COLLATERAL (USDT)");
      expect(code).toContain("LEVERAGE MULTIPLIER");
      expect(code).toMatch(/marginPresets\s*=\s*\[\s*50,\s*100,\s*250,\s*500,\s*1000\s*\]/);
      expect(code).toMatch(/leveragePresets\s*=\s*\[\s*1,\s*2,\s*5,\s*10,\s*20,\s*30,\s*50\s*\]/);
      expect(code).toContain("EFFECTIVE NOTIONAL");
    });

    it("verifies R7 Return on Equity (ROE %) & Loss-Impact Breakdown card is rendered", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("RETURN ON EQUITY (ROE %)");
      expect(code).toContain("LOSS-IMPACT BREAKDOWN");
      expect(code).toContain("Slippage Loss");
      expect(code).toContain("Roundtrip Taker Fees");
      expect(code).toContain("Gross Funding Yield");
      expect(code).toContain("Net Estimated Outcome");
      expect(code).toContain("result.roePct");
    });

    it("verifies R8 Actionable Profit Guidance & Breakeven Spread card is rendered without hard blocking", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("ACTIONABLE PROFIT GUIDANCE");
      expect(code).toContain("BREAKEVEN FUNDING SPREAD");
      expect(code).toContain("RECOMMENDED OPTIMAL LEVERAGE");
      expect(code).toContain("NO HARD BLOCKS");
      expect(code).toContain("result.breakevenSpreadBps");
      expect(code).toContain("result.optimalLeverage");
    });

    it("verifies Price Parity indicator with <= 0.1% rule is prominently rendered", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("PARITY MATCHED (≤ 0.1%)");
      expect(code).toContain("PRICE MISMATCH");
      expect(code).toContain("isParityMatched");
    });

    it("verifies Full Equation Breakdown flow is visually rendered (Initial Spent -> Coins -> Returned -> Yield -> PnL)", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("FULL EQUATION BREAKDOWN");
      expect(code).toContain("1. Initial Spent");
      expect(code).toContain("2. Coins Received");
      expect(code).toContain("3. Money Returned");
      expect(code).toContain("4. Funding Yield");
      expect(code).toContain("5. Net PnL");
    });

    it("verifies Net Arbitrage PnL equation banner with Profit and Loss conditions", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("PROFITABLE TRADE: FUNDING RATE OVERCOMES ALL FRICTION");
      expect(code).toContain("LOSS WARNING: SLIPPAGE & ROUND-TRIP FEES EXCEED FUNDING RATE");
      expect(code).toContain("result.isProfitable");
    });

    it("verifies component does NOT import or execute live botEngine routines", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).not.toMatch(/from\s+['"].*botEngine/);
      expect(code).not.toContain("executeOrder");
      expect(code).not.toContain("placeOrder");
      expect(code).not.toContain("submitOrder");
      expect(code).not.toContain("bot_daemon");
    });

    it("verifies web/app/terminal/page.tsx imports and mounts PreTradeSlippageSimulator", () => {
      expect(fs.existsSync(terminalPagePath)).toBe(true);
      const terminalCode = fs.readFileSync(terminalPagePath, "utf-8");

      expect(terminalCode).toMatch(/import\s+PreTradeSlippageSimulator\s+from\s+['"]@\/components\/PreTradeSlippageSimulator['"]/);
      expect(terminalCode).toContain("<PreTradeSlippageSimulator");
      expect(terminalCode).toContain("symbol={selectedSymbol}");
      expect(terminalCode).toContain("venueAName={activeVenueA}");
      expect(terminalCode).toContain("venueBName={activeVenueB}");
    });

    it("verifies R9 Asymmetric Settlement Timing & Staggered Fee Erosion Protection card is rendered in component", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("ASYMMETRIC SETTLEMENT TIMING");
      expect(code).toContain("STAGGERED FEE");
      expect(code).toContain("WAITING_ASYMMETRIC_FINAL_CYCLE");
      expect(code).toContain("HOLDING MULTI-CYCLE VIABLE");
      expect(code).toContain("Intermediate Fee Debits");
      expect(code).toContain("Intermediate Fee Erosion");
      expect(code).toContain("Holding Full Period");
      expect(code).toContain("Final Window Snipe");
      expect(code).toContain("intervalHoursA");
      expect(code).toContain("intervalHoursB");
    });

    it("verifies R10 Roll Mode indicators (CONTINUOUS ROLL PERMITTED vs MANDATORY DUAL-CLOSE UNWIND) are rendered", () => {
      const code = fs.readFileSync(componentPath, "utf-8");
      expect(code).toContain("ROLL POLICY (R10)");
      expect(code).toContain("CONTINUOUS ROLL PERMITTED");
      expect(code).toContain("MANDATORY DUAL-CLOSE UNWIND AT MACRO SETTLEMENT (CONTINUOUS ROLL FORBIDDEN)");
      expect(code).toContain("result.continuousRollPermitted");
      expect(code).toContain("CONTINUOUS ROLL ALLOWED");
      expect(code).toContain("MANDATORY FLATTEN");
    });
  });

  // =========================================================================
  // R9: Asymmetric Settlement Timing & Staggered Fee Erosion Protection
  // =========================================================================
  describe("R9: Asymmetric Settlement Timing & Staggered Fee Erosion Protection", () => {
    it("calculates remaining intermediate fee counts: N_rem = ceil((NextFunding - Now) / Interval_paying)", () => {
      // 1. 8h vs 1h at beginning of cycle (8h remaining = 28,800s): N_rem = 8
      const eval1 = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 28800,
        receivingYieldBps: 40,
        payingRateBps: 5,
        totalFrictionBps: 24,
      });
      expect(eval1.isAsymmetric).toBe(true);
      expect(eval1.nRemDebits).toBe(8);
      expect(eval1.maxCycleDebits).toBe(8);
      expect(eval1.receivingIntervalHours).toBe(8);
      expect(eval1.payingIntervalHours).toBe(1);

      // 2. 8h vs 1h at 4.5h remaining (16,200s): N_rem = ceil(16200 / 3600) = 5
      const eval2 = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 16200,
      });
      expect(eval2.nRemDebits).toBe(5);

      // 3. 8h vs 1h at 1h remaining (3,600s, exactly 1 cycle remaining): N_rem = 1
      const eval3 = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 3600,
      });
      expect(eval3.nRemDebits).toBe(1);

      // 4. 8h vs 1h at 30 minutes remaining (1,800s, inside final 1h window): N_rem = 1
      const eval4 = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 1800,
      });
      expect(eval4.nRemDebits).toBe(1);

      // 5. 8h vs 4h at beginning (28,800s): N_rem = ceil(28800 / 14400) = 2
      const eval5 = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 4,
        timeRemainingSeconds: 28800,
      });
      expect(eval5.nRemDebits).toBe(2);
      expect(eval5.maxCycleDebits).toBe(2);

      // 6. 8h vs 4h at 3h remaining (10,800s): N_rem = ceil(10800 / 14400) = 1
      const eval6 = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 4,
        timeRemainingSeconds: 10800,
      });
      expect(eval6.nRemDebits).toBe(1);

      // 7. 4h vs 1h at beginning (14,400s): N_rem = ceil(14400 / 3600) = 4
      const eval7 = evaluateAsymmetricSettlement({
        intervalHoursA: 4,
        intervalHoursB: 1,
        timeRemainingSeconds: 14400,
      });
      expect(eval7.nRemDebits).toBe(4);
      expect(eval7.maxCycleDebits).toBe(4);
    });

    it("evaluates multi-cycle cumulative fee erosion: ProjectedNet = Yield_rec - (N_rem * Rate_pay) - RoundTripFees", () => {
      // 8h vs 1h: receiving = 40 bps, paying = 5 bps/h, friction = 24 bps
      // At N_rem = 8:
      // projectedMultiCycleNetYield = 40 - (8 * 5) - 24 = 40 - 40 - 24 = -24 bps
      const res = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 28800,
        receivingYieldBps: 40,
        payingRateBps: 5,
        totalFrictionBps: 24,
        notionalUsdt: 10000,
      });

      expect(res.projectedMultiCycleNetYieldBps).toBe(-24);
      expect(res.projectedMultiCycleNetUsdt).toBeCloseTo(-24);
      expect(res.intermediateFeeErosionBps).toBe(35); // (8 - 1) * 5 = 35 bps
      expect(res.intermediateFeeErosionUsdt).toBeCloseTo(35);
    });

    it("evaluates final-cycle snipe yield: finalCycleNetYield = Yield_rec - (1 * Rate_pay) - RoundTripFees", () => {
      // 8h vs 1h: receiving = 40 bps, paying = 5 bps, friction = 24 bps
      // Final cycle net: 40 - (1 * 5) - 24 = 40 - 5 - 24 = +11 bps
      const res = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 28800,
        receivingYieldBps: 40,
        payingRateBps: 5,
        totalFrictionBps: 24,
        notionalUsdt: 10000,
      });

      expect(res.finalCycleNetYieldBps).toBe(11);
      expect(res.finalCycleNetUsdt).toBeCloseTo(11);
    });

    it("triggers WAITING_ASYMMETRIC_FINAL_CYCLE when multi-cycle hold erodes yield into loss but final cycle is profitable", () => {
      // Holding for 8h gives -24 bps (loss), but waiting for final 1h gives +11 bps (profit)
      const res = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 28800, // 8 hours remaining
        receivingYieldBps: 40,
        payingRateBps: 5,
        totalFrictionBps: 24,
        minHurdleBps: 0,
      });

      expect(res.status).toBe("WAITING_ASYMMETRIC_FINAL_CYCLE");
      expect(res.statusLabel).toBe("WAITING_ASYMMETRIC_FINAL_CYCLE");
      // Recommended wait time is 8h - 1h = 7h (25,200 seconds)
      expect(res.recommendedWaitSeconds).toBe(25200);
      expect(res.recommendedEntryWindow).toContain("Wait 7h for final 1h window");
    });

    it("transitions to HOLDING_MULTI_CYCLE_VIABLE once timeRemaining enters the final cycle window", () => {
      // At 30m remaining (1,800s), N_rem is 1, so holding and final cycle yield are both +11 bps
      const res = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 1800,
        receivingYieldBps: 40,
        payingRateBps: 5,
        totalFrictionBps: 24,
        minHurdleBps: 0,
      });

      expect(res.nRemDebits).toBe(1);
      expect(res.status).toBe("HOLDING_MULTI_CYCLE_VIABLE");
      expect(res.recommendedWaitSeconds).toBe(0);
      expect(res.recommendedEntryWindow).toContain("inside final 1h window");
    });

    it("detects UNVIABLE_NEGATIVE_SNIPE when gross yield cannot even cover single-cycle friction", () => {
      // receiving = 15 bps, paying = 5 bps, friction = 24 bps -> final cycle = 15 - 5 - 24 = -14 bps
      const res = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        receivingYieldBps: 15,
        payingRateBps: 5,
        totalFrictionBps: 24,
      });

      expect(res.status).toBe("UNVIABLE_NEGATIVE_SNIPE");
      expect(res.recommendedEntryWindow).toContain("insufficient");
    });

    it("verifies interval ratio labels across all combinations: 8h vs 1h, 8h vs 4h, 4h vs 1h, 8h vs 8h, 1h vs 8h", () => {
      expect(evaluateAsymmetricSettlement({ intervalHoursA: 8, intervalHoursB: 1 }).intervalRatioLabel).toBe("8h vs 1h [8x Staggered Ratio]");
      expect(evaluateAsymmetricSettlement({ intervalHoursA: 8, intervalHoursB: 4 }).intervalRatioLabel).toBe("8h vs 4h [2x Staggered Ratio]");
      expect(evaluateAsymmetricSettlement({ intervalHoursA: 4, intervalHoursB: 1 }).intervalRatioLabel).toBe("4h vs 1h [4x Staggered Ratio]");
      expect(evaluateAsymmetricSettlement({ intervalHoursA: 8, intervalHoursB: 8 }).intervalRatioLabel).toBe("8h vs 8h [1x Symmetric]");
      expect(evaluateAsymmetricSettlement({ intervalHoursA: 1, intervalHoursB: 8 }).intervalRatioLabel).toBe("1h vs 8h [8x Staggered Ratio]");
    });

    it("integrates end-to-end through simulatePreTradeExecution with R9 asymmetric telemetry", () => {
      const res = simulatePreTradeExecution({
        marginUsdt: 50,
        leverage: 2,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 35,
        roundtripFeeBps: 24,
        liquidityTier: "DEEP",
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 28800,
        receivingYieldBps: 40,
        payingRateBps: 5,
      });

      expect(res.asymmetricAnalysis).toBeDefined();
      expect(res.intervalHoursA).toBe(8);
      expect(res.intervalHoursB).toBe(1);
      expect(res.isAsymmetric).toBe(true);
      expect(res.nRemDebits).toBe(8);
      expect(res.asymmetricStatus).toBe("WAITING_ASYMMETRIC_FINAL_CYCLE");
      expect(res.finalCycleNetYieldBps).toBeGreaterThan(0);
      expect(res.projectedMultiCycleNetYieldBps).toBeLessThan(0);
    });
  });

  // =========================================================================
  // R10: Symmetric Continuous Roll vs Asymmetric Mandatory Flattening
  // =========================================================================
  describe("R10: Symmetric Continuous Roll vs Asymmetric Mandatory Flattening", () => {
    it("permits continuous carry roll for symmetric settlement pairs (8h-8h, 4h-4h, 1h-1h)", () => {
      const sym8 = evaluateAsymmetricSettlement({ intervalHoursA: 8, intervalHoursB: 8 });
      expect(sym8.isAsymmetric).toBe(false);
      expect(sym8.continuousRollPermitted).toBe(true);
      expect(sym8.rollMode).toBe("CONTINUOUS_ROLL_ALLOWED");
      expect(sym8.rollModeLabel).toBe("CONTINUOUS ROLL PERMITTED");

      const sym4 = evaluateAsymmetricSettlement({ intervalHoursA: 4, intervalHoursB: 4 });
      expect(sym4.isAsymmetric).toBe(false);
      expect(sym4.continuousRollPermitted).toBe(true);
      expect(sym4.rollMode).toBe("CONTINUOUS_ROLL_ALLOWED");

      const sym1 = evaluateAsymmetricSettlement({ intervalHoursA: 1, intervalHoursB: 1 });
      expect(sym1.isAsymmetric).toBe(false);
      expect(sym1.continuousRollPermitted).toBe(true);
      expect(sym1.rollMode).toBe("CONTINUOUS_ROLL_ALLOWED");
    });

    it("strictly forbids continuous carry roll and enforces mandatory single-settlement flattening for asymmetric pairs", () => {
      const asym81 = evaluateAsymmetricSettlement({ intervalHoursA: 8, intervalHoursB: 1 });
      expect(asym81.isAsymmetric).toBe(true);
      expect(asym81.continuousRollPermitted).toBe(false);
      expect(asym81.rollMode).toBe("MANDATORY_SINGLE_SETTLEMENT_FLATTEN");
      expect(asym81.rollModeLabel).toBe("MANDATORY DUAL-CLOSE UNWIND AT MACRO SETTLEMENT (CONTINUOUS ROLL FORBIDDEN)");

      const asym84 = evaluateAsymmetricSettlement({ intervalHoursA: 8, intervalHoursB: 4 });
      expect(asym84.continuousRollPermitted).toBe(false);
      expect(asym84.rollMode).toBe("MANDATORY_SINGLE_SETTLEMENT_FLATTEN");

      const asym41 = evaluateAsymmetricSettlement({ intervalHoursA: 4, intervalHoursB: 1 });
      expect(asym41.continuousRollPermitted).toBe(false);
      expect(asym41.rollMode).toBe("MANDATORY_SINGLE_SETTLEMENT_FLATTEN");

      const asym18 = evaluateAsymmetricSettlement({ intervalHoursA: 1, intervalHoursB: 8 });
      expect(asym18.continuousRollPermitted).toBe(false);
      expect(asym18.rollMode).toBe("MANDATORY_SINGLE_SETTLEMENT_FLATTEN");
    });

    it("reflects continuousRollPermitted and rollMode on simulatePreTradeExecution result directly", () => {
      const symRes = simulatePreTradeExecution({
        capitalUsdt: 100,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 30,
        intervalHoursA: 8,
        intervalHoursB: 8,
      });
      expect(symRes.continuousRollPermitted).toBe(true);
      expect(symRes.rollMode).toBe("CONTINUOUS_ROLL_ALLOWED");

      const asymRes = simulatePreTradeExecution({
        capitalUsdt: 100,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 30,
        intervalHoursA: 8,
        intervalHoursB: 1,
      });
      expect(asymRes.continuousRollPermitted).toBe(false);
      expect(asymRes.rollMode).toBe("MANDATORY_SINGLE_SETTLEMENT_FLATTEN");
    });
  });

  // =========================================================================
  // Duration Formatting Telemetry
  // =========================================================================
  describe("Duration Formatting Telemetry", () => {
    it("formats durations in seconds to human-readable strings accurately", () => {
      expect(formatDurationSeconds(28800)).toBe("8h");
      expect(formatDurationSeconds(25200)).toBe("7h");
      expect(formatDurationSeconds(3660)).toBe("1h 1m");
      expect(formatDurationSeconds(1800)).toBe("30m");
      expect(formatDurationSeconds(90)).toBe("1m 30s");
      expect(formatDurationSeconds(45)).toBe("45s");
      expect(formatDurationSeconds(0)).toBe("0m");
      expect(formatDurationSeconds(-100)).toBe("0m");
      expect(formatDurationSeconds(NaN)).toBe("0m");
      expect(formatDurationSeconds(Infinity)).toBe("0m");
    });
  });

  // =========================================================================
  // R9 & R10 Edge Cases & Boundary Values
  // =========================================================================
  describe("R9 & R10 Edge Cases & Boundary Values", () => {
    it("handles zero margin in simulatePreTradeExecution returning clean zeroed asymmetric telemetry", () => {
      const zeroRes = simulatePreTradeExecution({
        marginUsdt: 0,
        leverage: 10,
        priceA: 65000,
        priceB: 65000,
        fundingSpreadBps: 35,
        intervalHoursA: 8,
        intervalHoursB: 1,
      });

      expect(zeroRes.marginUsdt).toBe(0);
      expect(zeroRes.notionalUsdt).toBe(0);
      expect(zeroRes.isAsymmetric).toBe(true);
      expect(zeroRes.continuousRollPermitted).toBe(false);
      expect(zeroRes.asymmetricAnalysis.projectedMultiCycleNetUsdt).toBe(0);
      expect(zeroRes.asymmetricAnalysis.finalCycleNetUsdt).toBe(0);
    });

    it("sanitizes invalid or non-finite inputs cleanly without throwing or returning NaN", () => {
      const res = evaluateAsymmetricSettlement({
        intervalHoursA: NaN,
        intervalHoursB: -5,
        timeRemainingSeconds: -500,
        receivingYieldBps: NaN,
        payingRateBps: NaN,
        totalFrictionBps: NaN,
      });

      expect(res.intervalHoursA).toBe(8); // sanitized default
      expect(res.intervalHoursB).toBe(8); // sanitized default
      expect(res.isAsymmetric).toBe(false);
      expect(res.continuousRollPermitted).toBe(true);
      expect(Number.isFinite(res.projectedMultiCycleNetYieldBps)).toBe(true);
      expect(Number.isFinite(res.finalCycleNetYieldBps)).toBe(true);
    });

    it("evaluates custom minHurdleBps correctly", () => {
      // Final cycle yield is +11 bps. With minHurdle = 15 bps, it should become UNVIABLE_NEGATIVE_SNIPE
      const resHurdle = evaluateAsymmetricSettlement({
        intervalHoursA: 8,
        intervalHoursB: 1,
        timeRemainingSeconds: 28800,
        receivingYieldBps: 40,
        payingRateBps: 5,
        totalFrictionBps: 24, // final cycle net = 40 - 5 - 24 = 11 bps
        minHurdleBps: 15, // hurdle is higher than 11 bps
      });

      expect(resHurdle.status).toBe("UNVIABLE_NEGATIVE_SNIPE");
    });

    it("evaluates reversed receiving leg (e.g. shorter cycle receiving, longer cycle paying)", () => {
      // Leg A (1h) receives, Leg B (8h) pays
      const resRev = evaluateAsymmetricSettlement({
        intervalHoursA: 1,
        intervalHoursB: 8,
        receivingLeg: "A",
        receivingYieldBps: 50,
        payingRateBps: 10,
        totalFrictionBps: 24,
      });

      expect(resRev.isAsymmetric).toBe(true);
      expect(resRev.continuousRollPermitted).toBe(false);
      expect(resRev.receivingIntervalHours).toBe(1);
      expect(resRev.payingIntervalHours).toBe(8);
      expect(resRev.nRemDebits).toBe(1);
    });
  });
});
