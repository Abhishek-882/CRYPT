/**
 * Vitest Unit Tests: RiskGate Invariants & Safeguards
 * 
 * Verifies Pre-Broker Risk Engine:
 * - $500 Single Order Notional Cap
 * - 4.0% Daily MTM Drawdown Circuit Breaker ($150 limit on $3,750 base)
 * - $2,500 Portfolio Gross Exposure Ceiling
 * - Persistent Emergency Kill-Switch Tripping and Admin Reset
 * - Emergency Position Close Exemption
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RiskGate, RISK_LIMITS, PreOrderValidationRequest } from "@/lib/riskGate";
import { saveBotState, loadBotState, BotEngineState } from "@/lib/botEngine";

const TEST_USER = "usr_unit_test_risk";

describe("RiskGate Institutional Engine", () => {
  beforeEach(() => {
    // Reset kill-switch and state before each test
    RiskGate.resetKillSwitch("test_admin");
    const cleanState = {
      isRunning: false,
      runInBackgroundWhenClosed: false,
      mode: "REAL_TRADING",
      startedAt: Date.now(),
      lastCycleAt: Date.now(),
      cyclesCompleted: 0,
      activeBotId: "bot_1",
      bots: [],
      setFiles: [],
      logs: [],
    } as unknown as BotEngineState;
    saveBotState(cleanState, TEST_USER);
  });

  afterEach(() => {
    RiskGate.resetKillSwitch("test_admin");
    const cleanState = {
      isRunning: false,
      runInBackgroundWhenClosed: false,
      mode: "REAL_TRADING",
      startedAt: Date.now(),
      lastCycleAt: Date.now(),
      cyclesCompleted: 0,
      activeBotId: "bot_1",
      bots: [],
      setFiles: [],
      logs: [],
    } as unknown as BotEngineState;
    saveBotState(cleanState, TEST_USER);
  });

  describe("Single Order Notional Cap ($500.00 USDT)", () => {
    it("should approve orders strictly under the $500 cap", () => {
      const order: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.005,
        price: 65000,
        notionalUsdt: 325.0, // 0.005 * 65,000 = $325.00
      };

      const result = RiskGate.validatePreOrder(order);
      expect(result.allowed).toBe(true);
      expect(result.code).toBe("RISK_APPROVED");
      expect(result.reason).toBeUndefined();
    });

    it("should approve orders exactly at the $500.00 threshold", () => {
      const order: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "ETHUSDT",
        side: "SELL",
        quantity: 0.2,
        price: 2500,
        notionalUsdt: 500.0,
      };

      const result = RiskGate.validatePreOrder(order);
      expect(result.allowed).toBe(true);
      expect(result.code).toBe("RISK_APPROVED");
    });

    it("should reject orders exceeding $500.00 notional cap", () => {
      const order: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        price: 65000,
        notionalUsdt: 650.0,
      };

      const result = RiskGate.validatePreOrder(order);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("ORDER_EXCEEDS_NOTIONAL_CAP");
      expect(result.reason).toContain("exceeds maximum allowed cap of $500.00 USDT");
    });

    it("should reject negative or zero quantities", () => {
      const zeroOrder: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0,
      };
      const result = RiskGate.validatePreOrder(zeroOrder);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("INVALID_PRICE_OR_QUANTITY");
    });
  });

  describe("Emergency Kill-Switch & Position Close Exemption", () => {
    it("should reject standard entry orders when kill-switch is tripped", () => {
      RiskGate.tripKillSwitch("Manual administrative emergency trip", "test_admin");
      expect(RiskGate.isKillSwitchActive()).toBe(true);

      const order: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "ETHUSDT",
        side: "BUY",
        quantity: 0.05,
        price: 2500,
        notionalUsdt: 125.0,
      };

      const result = RiskGate.validatePreOrder(order);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("EMERGENCY_HALT_ACTIVE");
    });

    it("should allow emergency close orders even when kill-switch is actively tripped", () => {
      RiskGate.tripKillSwitch("Circuit breaker triggered", "system");
      expect(RiskGate.isKillSwitchActive()).toBe(true);

      const emergencyCloseOrder: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "BTCUSDT",
        side: "SELL",
        quantity: 0.5,
        price: 65000,
        notionalUsdt: 32500.0, // Exceeds $500 cap!
        isEmergencyClose: true,
      };

      const result = RiskGate.validatePreOrder(emergencyCloseOrder);
      expect(result.allowed).toBe(true);
      expect(result.code).toBe("RISK_APPROVED");
    });

    it("should allow resetting the kill-switch by admin", () => {
      RiskGate.tripKillSwitch("Volatility surge", "admin");
      expect(RiskGate.isKillSwitchActive()).toBe(true);

      const resetSuccess = RiskGate.resetKillSwitch("super_admin");
      expect(resetSuccess).toBe(true);
      expect(RiskGate.isKillSwitchActive()).toBe(false);
    });
  });

  describe("Mark-to-Market (MTM) 4.0% Drawdown Circuit Breaker", () => {
    it("should report normal status when drawdown is below 4.0%", () => {
      const mtm = RiskGate.computeLiveMtmDrawdown(TEST_USER);
      expect(mtm.drawdownPct).toBe(0);
      expect(mtm.totalLoss).toBe(0);
      expect(RiskGate.isKillSwitchActive()).toBe(false);
    });

    it("should trip kill-switch automatically when floating loss reaches or exceeds $150 (4.0%)", () => {
      const mockState = {
        cyclesCompleted: 1,
        lastCycleTimestamp: Date.now(),
        bots: [
          {
            id: "bot_test_mtm",
            name: "TestBot",
            statusText: "HEDGED",
            config: {
              enabled: true,
              executionCorridor: "BINANCE_BITGET",
              maxSimultaneousHedges: 3,
              balanceAllocationPct: 20,
              minSpreadBps: 35,
              targetProfitSpreadBps: 20,
              stopLossSpreadBps: 60,
              maxHoldHours: 12,
              leverageMode: "MAX_PER_COIN",
              customLeverage: 10,
              postSettlementWaitSeconds: 120,
              closeMaxPriceDivergencePct: 0.25,
              scanIntervalSeconds: 5,
            },
            activeHedges: [
              {
                id: "HEDGE-MTM-1",
                symbol: "BTCUSDT",
                direction: "SHORT_BINANCE_LONG_BITGET",
                quantity: "0.005",
                effectiveQty: 0.005,
                notionalUsdt: 400,
                binanceLeverage: 10,
                bitgetLeverage: 10,
                entrySpreadBps: 45,
                entryBinancePrice: 80000,
                entryBitgetPrice: 80000,
                entryDivergencePct: 0.02,
                entryTime: Date.now(),
                fundingSettlementTime: Date.now() + 3600000,
                status: "ACTIVE",
                pnl: -165.0, // Floating loss -$165 (4.4% on $3,750 base)
              },
            ],
            completedHedges: [],
          },
        ],
      } as unknown as BotEngineState;
      saveBotState(mockState, TEST_USER);

      const mtm = RiskGate.computeLiveMtmDrawdown(TEST_USER);
      expect(mtm.floatingLoss).toBe(165.0);
      expect(mtm.totalLoss).toBe(165.0);
      expect(mtm.drawdownPct).toBeGreaterThanOrEqual(RISK_LIMITS.MAX_DAILY_MTM_DRAWDOWN_PCT);

      // Pre-order check must fail and auto-trip kill switch
      const preOrderCheck = RiskGate.validatePreOrder({
        userId: TEST_USER,
        symbol: "SOLUSDT",
        side: "BUY",
        quantity: 1.0,
        price: 150,
        notionalUsdt: 150.0,
      });

      expect(preOrderCheck.allowed).toBe(false);
      expect(preOrderCheck.code).toBe("MAX_DAILY_DRAWDOWN_BREACHED");
      expect(RiskGate.isKillSwitchActive()).toBe(true);
    });
  });

  describe("Portfolio Gross Exposure Ceiling ($2,500.00 USDT)", () => {
    it("should reject orders that would push portfolio gross exposure beyond $2,500", () => {
      const mockState = {
        cyclesCompleted: 1,
        lastCycleTimestamp: Date.now(),
        bots: [
          {
            id: "bot_exposure_test",
            name: "TestBot",
            statusText: "HEDGED",
            config: {
              enabled: true,
              executionCorridor: "BINANCE_BITGET",
              maxSimultaneousHedges: 3,
              balanceAllocationPct: 20,
              minSpreadBps: 35,
              targetProfitSpreadBps: 20,
              stopLossSpreadBps: 60,
              maxHoldHours: 12,
              leverageMode: "MAX_PER_COIN",
              customLeverage: 10,
              postSettlementWaitSeconds: 120,
              closeMaxPriceDivergencePct: 0.25,
              scanIntervalSeconds: 5,
            },
            activeHedges: [
              {
                id: "HEDGE-EXP-1",
                symbol: "BTCUSDT",
                direction: "SHORT_BINANCE_LONG_BITGET",
                quantity: "0.02875",
                effectiveQty: 0.02875,
                notionalUsdt: 2300.0, // Existing exposure = $2,300
                binanceLeverage: 10,
                bitgetLeverage: 10,
                entrySpreadBps: 45,
                entryBinancePrice: 80000,
                entryBitgetPrice: 80000,
                entryDivergencePct: 0.02,
                entryTime: Date.now(),
                fundingSettlementTime: Date.now() + 3600000,
                status: "ACTIVE",
                pnl: 10.0, // Healthy profit
              },
            ],
            completedHedges: [],
          },
        ],
      } as unknown as BotEngineState;
      saveBotState(mockState, TEST_USER);

      const mtm = RiskGate.computeLiveMtmDrawdown(TEST_USER);
      expect(mtm.grossExposure).toBe(2300.0);

      // New order of $300 notional: $2,300 + $300 = $2,600 > $2,500 ceiling
      const order: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "SOLUSDT",
        side: "BUY",
        quantity: 2.0,
        price: 150,
        notionalUsdt: 300.0, // Under $500 cap, but breaches gross portfolio limit
      };

      const result = RiskGate.validatePreOrder(order);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("GROSS_EXPOSURE_CAP_BREACHED");
      expect(result.reason).toContain("above max permitted $2500.00 USDT");
    });

    it("should accept orders within both single notional and gross portfolio ceilings", () => {
      const order: PreOrderValidationRequest = {
        userId: TEST_USER,
        symbol: "SOLUSDT",
        side: "BUY",
        quantity: 1.0,
        price: 150,
        notionalUsdt: 150.0,
      };

      const result = RiskGate.validatePreOrder(order);
      expect(result.allowed).toBe(true);
      expect(result.code).toBe("RISK_APPROVED");
    });
  });
});
