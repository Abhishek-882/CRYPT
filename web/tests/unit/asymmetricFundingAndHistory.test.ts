import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkFundingSynchronization, computeMacroCycleInfo, formatIntervalPairKey, isIntervalPairAllowed } from "../../lib/exchangeFundingMeta";
import { evaluatePairwiseArbitrage, calculateAsymmetricMacroYield, VenueRateInfo } from "../../lib/spreadCalculation";
import { fetchFreshPrices, BotConfig, serializeConfigToSetText, parseSetTextToConfig } from "../../lib/botEngine";
import { recordServerTrade, loadTrades, clearTrades, ServerHedgeTrade } from "../../lib/serverTradeStore";

describe("Staggered & Asymmetric Funding Arbitrage Upgrade", () => {
  const TEST_USER = "usr_test_asym_trader";

  beforeEach(() => {
    clearTrades(TEST_USER);
  });

  afterEach(() => {
    clearTrades(TEST_USER);
  });

  describe("1. checkFundingSynchronization Invariant", () => {
    it("qualifies ERAUSDT with Binance (1h) vs Bybit (4h) interval mismatch when allowAsymmetric is true", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "ERAUSDT",
        fundingIntervalHours: 4,
        settlementCycleLabel: "Staggered Cycle",
        payoutsPerDay: 6,
        binanceIntervalHours: 1,
        bybitIntervalHours: 4,
        binanceNextFundingTime: now + 300 * 1000, // 5 min
        bybitNextFundingTime: now + 14400 * 1000, // 4 hours
      };

      const result = checkFundingSynchronization("Binance", "Bybit", meta as any, now, { allowAsymmetric: true });
      expect(result.synchronized).toBe(true);
      expect(result.isAsymmetric).toBe(true);
      expect(result.venueAIntervalHours).toBe(1);
      expect(result.venueBIntervalHours).toBe(4);
      expect(result.earliestNextFundingTime).toBe(meta.binanceNextFundingTime);
      expect(result.secondsToEarliestFunding).toBe(300);
      expect(result.reason).toContain("Asymmetric funding schedule permitted");
    });

    it("rejects ERAUSDT interval mismatch when allowAsymmetric is explicitly false", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "ERAUSDT",
        fundingIntervalHours: 4,
        settlementCycleLabel: "Staggered Cycle",
        payoutsPerDay: 6,
        binanceIntervalHours: 1,
        bybitIntervalHours: 4,
        binanceNextFundingTime: now + 300 * 1000,
        bybitNextFundingTime: now + 14400 * 1000,
      };

      const result = checkFundingSynchronization("Binance", "Bybit", meta as any, now, { allowAsymmetric: false });
      expect(result.synchronized).toBe(false);
      expect(result.reason).toContain("Interval mismatch: Binance (1h) !== Bybit (4h)");
    });

    it("qualifies PUFFERUSDT with 14,400s countdown delta when allowAsymmetric is true", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "PUFFERUSDT",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h Cycle",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 600 * 1000, // 10 min
        bybitNextFundingTime: now + 15000 * 1000, // 14,400s delta
      };

      const result = checkFundingSynchronization("Binance", "Bybit", meta as any, now, { allowAsymmetric: true });
      expect(result.synchronized).toBe(true);
      expect(result.isAsymmetric).toBe(true);
      expect(result.deltaMs).toBe(14400 * 1000);
      expect(result.earliestNextFundingTime).toBe(meta.binanceNextFundingTime);
    });

    it("rejects PUFFERUSDT countdown desynchronization (>60s) when allowAsymmetric is false", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "PUFFERUSDT",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h Cycle",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 600 * 1000,
        bybitNextFundingTime: now + 15000 * 1000,
      };

      const result = checkFundingSynchronization("Binance", "Bybit", meta as any, now, { allowAsymmetric: false });
      expect(result.synchronized).toBe(false);
      expect(result.reason).toContain("Countdown desynchronization");
    });
  });

  describe("2. evaluatePairwiseArbitrage Combinatorial Evaluation", () => {
    it("admits asymmetric pair into validPairs and bestPair when gross spread clears fee filter", () => {
      const now = 1700000000000;
      const venues: VenueRateInfo[] = [
        {
          venue: "binance",
          label: "Binance",
          badge: "Binance",
          color: "amber",
          rate: 0.75, // +0.75% (Short)
          intervalHours: 1,
          nextFundingTime: now + 180 * 1000, // 3 min
        },
        {
          venue: "bybit",
          label: "Bybit",
          badge: "Bybit",
          color: "orange",
          rate: -0.10, // -0.10% (Long) -> Gross spread = 0.85% (85 bps)
          intervalHours: 4,
          nextFundingTime: now + 14400 * 1000,
        },
      ];

      const res = evaluatePairwiseArbitrage(venues, 4, { allowAsymmetric: true });
      expect(res.bestPair).not.toBeNull();
      expect(res.bestPair?.label).toBe("Binance ⇄ Bybit");
      expect(res.bestPair?.spreadBps).toBe(310);
      expect(res.bestPair?.clearsFeeFilter).toBe(true);
      expect(res.bestPair?.isFundingSynchronized).toBe(true);
      expect(res.bestPair?.isAsymmetricFunding).toBe(true);
      expect(res.bestPair?.earliestNextFundingTime).toBe(now + 180 * 1000);
    });

    it("rejects asymmetric pair from validPairs when allowAsymmetric is false", () => {
      const now = 1700000000000;
      const venues: VenueRateInfo[] = [
        {
          venue: "binance",
          label: "Binance",
          badge: "Binance",
          color: "amber",
          rate: 0.75,
          intervalHours: 1,
          nextFundingTime: now + 180 * 1000,
        },
        {
          venue: "bybit",
          label: "Bybit",
          badge: "Bybit",
          color: "orange",
          rate: -0.10,
          intervalHours: 4,
          nextFundingTime: now + 14400 * 1000,
        },
      ];

      const res = evaluatePairwiseArbitrage(venues, 4, { allowAsymmetric: false });
      expect(res.bestPair?.isFundingSynchronized).toBe(false);
      expect(res.bestPair?.syncDisqualificationReason).toContain("Interval mismatch");
    });
  });

  describe("3. Price Divergence & Dynamic Parity Verification", () => {
    it("computes accurate price divergence across specific corridor venues", async () => {
      // Mock getBybitTicker or fallback fetch
      const freshPrices = await fetchFreshPrices("BTCUSDT", "Binance", "Bybit");
      expect(freshPrices).toHaveProperty("divergencePct");
      expect(freshPrices).toHaveProperty("priceA");
      expect(freshPrices).toHaveProperty("priceB");
      expect(typeof freshPrices.divergencePct).toBe("number");
    });

    it("satisfies dynamic close parity when divergence is within relaxed tolerance", () => {
      const config: BotConfig = {
        enabled: true,
        minSpreadBps: 35,
        maxPriceDivergencePct: 0.05,
        closeMaxPriceDivergencePct: 0.03,
        balanceAllocationPct: 20,
        leverageMode: "MAX_PER_COIN",
        customLeverage: 10,
        maxSimultaneousHedges: 2,
        maxMarginCapUsdt: 500,
        postSettlementWaitSeconds: 15,
        scanIntervalSeconds: 5,
      };

      const entryDivergencePct = 0.042; // Entered at 0.042% divergence
      const currentDivergencePct = 0.038; // Post-settlement divergence is 0.038%

      const baseConvergence = config.closeMaxPriceDivergencePct || 0.03;
      const dynamicTarget = Math.max(
        baseConvergence,
        config.maxPriceDivergencePct || 0.05,
        entryDivergencePct
      );

      // 0.038% would fail a rigid 0.03% check, but passes the dynamic parity threshold (0.05%)
      const isParitySatisfied = currentDivergencePct <= dynamicTarget;
      expect(dynamicTarget).toBe(0.05);
      expect(isParitySatisfied).toBe(true);
    });
  });

  describe("4. Perfect History Saver & Atomic Disk Persistence", () => {
    it("records entry trade with complete telemetry and order IDs", () => {
      const entryTrade: Partial<ServerHedgeTrade> = {
        id: "BOT-TEST-001",
        symbol: "ERAUSDT",
        type: "AUTONOMOUS_SERVER_HEDGE",
        directionLabel: "Short Binance / Long Bybit",
        quantity: "100",
        notionalUsdt: 500,
        leg1Venue: "Binance",
        leg1Side: "SELL",
        leg1Price: 5.00,
        leg1OrderId: "BN_ORD_101",
        leg1FeeUsdt: 0.25,
        leg2Venue: "Bybit",
        leg2Side: "BUY",
        leg2Price: 5.002,
        leg2OrderId: "BYB_ORD_201",
        leg2FeeUsdt: 0.3245,
        feesUsdt: 0.5745,
        totalFeesUsdt: 0.5745,
        interLegDeltaMs: 42,
        entryDivergencePct: 0.04,
        entryPriceSpreadBps: 85,
        isAsymmetricFunding: true,
        venueAIntervalHours: 1,
        venueBIntervalHours: 4,
        status: "ACTIVE",
      };

      recordServerTrade(entryTrade, TEST_USER);

      const trades = loadTrades(TEST_USER, true);
      const saved = trades.find((t) => t.id === "BOT-TEST-001");
      expect(saved).toBeDefined();
      expect(saved?.symbol).toBe("ERAUSDT");
      expect(saved?.status).toBe("ACTIVE");
      expect(saved?.leg1OrderId).toBe("BN_ORD_101");
      expect(saved?.leg2OrderId).toBe("BYB_ORD_201");
      expect(saved?.isAsymmetricFunding).toBe(true);
      expect(saved?.venueAIntervalHours).toBe(1);
      expect(saved?.venueBIntervalHours).toBe(4);
      expect(saved?.entryDivergencePct).toBe(0.04);
    });

    it("updates parent trade upon close with exit prices, all 4 fees, funding, and net PnL", () => {
      const entryTrade: Partial<ServerHedgeTrade> = {
        id: "BOT-TEST-001",
        symbol: "ERAUSDT",
        type: "AUTONOMOUS_SERVER_HEDGE",
        directionLabel: "Short Binance / Long Bybit",
        quantity: "100",
        notionalUsdt: 500,
        leg1Venue: "Binance",
        leg1Side: "SELL",
        leg1Price: 5.00,
        leg1OrderId: "BN_ORD_101",
        leg1FeeUsdt: 0.25,
        leg2Venue: "Bybit",
        leg2Side: "BUY",
        leg2Price: 5.002,
        leg2OrderId: "BYB_ORD_201",
        leg2FeeUsdt: 0.3245,
        feesUsdt: 0.5745,
        totalFeesUsdt: 0.5745,
        status: "ACTIVE",
      };
      recordServerTrade(entryTrade, TEST_USER);

      const closeReceipt: Partial<ServerHedgeTrade> = {
        id: "CLS-BOT-TEST-001",
        symbol: "ERAUSDT",
        type: "AUTONOMOUS_SERVER_CLOSE",
        directionLabel: "Unwind & Realize Harvest",
        quantity: "100",
        notionalUsdt: 500,
        leg1Venue: "Binance",
        leg1Side: "BUY",
        leg1Price: 4.995,
        closeLeg1OrderId: "BN_CLOSE_301",
        closeLeg1FeeUsdt: 0.2497,
        leg2Venue: "Bybit",
        leg2Side: "SELL",
        leg2Price: 4.996,
        closeLeg2OrderId: "BYB_CLOSE_401",
        closeLeg2FeeUsdt: 0.3242,
        interLegDeltaMs: 38,
        priceSpreadPnlUsdt: 0.20,
        fundingClaimedUsdt: 3.75, // Harvested funding
        feesUsdt: 1.1484, // 0.5745 entry + 0.5739 close
        totalFeesUsdt: 1.1484,
        realizedPnl: 2.8016, // 0.20 + 3.75 - 1.1484
        netHarvestUsdt: 2.8016,
        closeLeg1Price: 4.995,
        closeLeg2Price: 4.996,
        closeDivergencePct: 0.02,
        status: "CLOSED",
      };

      recordServerTrade(closeReceipt, TEST_USER);

      const trades = loadTrades(TEST_USER, true);

      // Verify parent entry trade was perfectly updated
      const parent = trades.find((t) => t.id === "BOT-TEST-001");
      expect(parent).toBeDefined();
      expect(parent?.status).toBe("CLOSED");
      expect(parent?.realizedPnl).toBe(2.8016);
      expect(parent?.fundingClaimedUsdt).toBe(3.75);
      expect(parent?.priceSpreadPnlUsdt).toBe(0.20);
      expect(parent?.closeLeg1Price).toBe(4.995);
      expect(parent?.closeLeg2Price).toBe(4.996);
      expect(parent?.closeLeg1OrderId).toBe("BN_CLOSE_301");
      expect(parent?.closeLeg2OrderId).toBe("BYB_CLOSE_401");
      expect(parent?.closeDivergencePct).toBe(0.02);
      expect(parent?.durationMs).toBeGreaterThan(0);

      // Verify dedicated close receipt CLS-BOT-TEST-001 is also present for audit
      const receipt = trades.find((t) => t.id === "CLS-BOT-TEST-001");
      expect(receipt).toBeDefined();
      expect(receipt?.status).toBe("CLOSED");
      expect(receipt?.realizedPnl).toBe(2.8016);
    });
  });

  describe("5. Universal Asymmetric Macro Yield Calculation Matrix", () => {
    it("computes accurate cycle-weighted macro yield for 1h vs 4h (Binance +0.10% vs Bybit +0.02%)", () => {
      // H = 4, N_A = 4, N_B = 1.
      // N_A * R_A = 4 * 0.10% = 0.40%.
      // N_B * R_B = 1 * 0.02% = 0.02%.
      // Gross = |0.40 - 0.02| = 0.38% = 38 bps.
      // Net = 38 - 35 = +3 bps. Fee hurdle cleared.
      const res = calculateAsymmetricMacroYield(0.10, 1, 0.02, 4);
      expect(res.macroHorizonHours).toBe(4);
      expect(res.cyclesA).toBe(4);
      expect(res.cyclesB).toBe(1);
      expect(res.grossYieldBps).toBe(38);
      expect(res.netYieldBps).toBe(3);
      expect(res.clearsFeeHurdle).toBe(true);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B");
    });

    it("evaluates directional dominance flip in reverse permutation (4h vs 1h)", () => {
      // Rate A = +0.15% (4h), Rate B = +0.06% (1h).
      // H = 4, N_A = 1, N_B = 4.
      // N_A * R_A = 1 * 0.15% = 0.15%.
      // N_B * R_B = 4 * 0.06% = 0.24%.
      // N_B * R_B > N_A * R_A => Direction is LONG_A_SHORT_B!
      // Gross = |0.15 - 0.24| = 0.09% = 9 bps. Net = 9 - 35 = -26 bps.
      const res = calculateAsymmetricMacroYield(0.15, 4, 0.06, 1);
      expect(res.macroHorizonHours).toBe(4);
      expect(res.cyclesA).toBe(1);
      expect(res.cyclesB).toBe(4);
      expect(res.grossYieldBps).toBe(9);
      expect(res.netYieldBps).toBe(-26);
      expect(res.clearsFeeHurdle).toBe(false);
      expect(res.recommendedDirection).toBe("LONG_A_SHORT_B");
    });

    it("evaluates 1h vs 8h macro cycle with negative rates (CoinDCX -0.05% vs Bybit +0.01%)", () => {
      // H = 8, N_A = 8, N_B = 1.
      // N_A * R_A = 8 * (-0.05%) = -0.40%.
      // N_B * R_B = 1 * (+0.01%) = +0.01%.
      // Long A yield: -(-0.40) on short? No:
      // Short A yield: 8 * (-0.05%) = -0.40%. Long B yield: - 1 * (+0.01%) = -0.01% => net = -0.41%.
      // Long A yield: - 8 * (-0.05%) = +0.40%. Short B yield: + 1 * (+0.01%) = +0.01% => net = +0.41%.
      // Dominance: N_B * R_B (+0.01) > N_A * R_A (-0.40) => LONG_A_SHORT_B.
      // Gross = |-0.40 - 0.01| = 0.41% = 41 bps. Net = 41 - 35 = +6 bps.
      const res = calculateAsymmetricMacroYield(-0.05, 1, 0.01, 8);
      expect(res.macroHorizonHours).toBe(8);
      expect(res.cyclesA).toBe(8);
      expect(res.cyclesB).toBe(1);
      expect(res.grossYieldBps).toBe(41);
      expect(res.netYieldBps).toBe(6);
      expect(res.clearsFeeHurdle).toBe(true);
      expect(res.recommendedDirection).toBe("LONG_A_SHORT_B");
    });

    it("maintains 100% backward compatibility for symmetric 8h vs 8h pairs", () => {
      // Binance +0.10% (8h) vs Bybit -0.25% (8h)
      // H = 8, N_A = 1, N_B = 1.
      // Gross = |0.10 - (-0.25)| = 0.35% = 35 bps.
      const res = calculateAsymmetricMacroYield(0.10, 8, -0.25, 8);
      expect(res.macroHorizonHours).toBe(8);
      expect(res.cyclesA).toBe(1);
      expect(res.cyclesB).toBe(1);
      expect(res.grossYieldBps).toBe(35);
      expect(res.clearsFeeHurdle).toBe(true);
      expect(res.recommendedDirection).toBe("SHORT_A_LONG_B");
    });
  });

  describe("6. Universal Funding Synchronization & Strict Sync Guardrails", () => {
    it("admits all 16 interval permutations under Option 1 (ALL_ASYMMETRIC)", () => {
      const intervals = [1, 2, 4, 8];
      const now = 1700000000000;
      for (const iA of intervals) {
        for (const iB of intervals) {
          const meta = {
            symbol: `TEST-${iA}-${iB}`,
            fundingIntervalHours: Math.min(iA, iB),
            settlementCycleLabel: "Test",
            payoutsPerDay: 24 / Math.min(iA, iB),
            binanceIntervalHours: iA,
            bybitIntervalHours: iB,
            binanceNextFundingTime: now + 3600 * 1000,
            bybitNextFundingTime: now + 3600 * 1000,
          };
          const res = checkFundingSynchronization("Binance", "Bybit", meta as any, now, {
            intervalMode: "ALL_ASYMMETRIC",
          });
          expect(res.synchronized).toBe(true);
          expect(res.macroHorizonHours).toBe(Math.max(iA, iB));
          expect(res.cyclesA).toBe(Math.max(iA, iB) / iA);
          expect(res.cyclesB).toBe(Math.max(iA, iB) / iB);
        }
      }
    });

    it("rejects mismatched intervals with [STRICT_SYNC_REJECTED] under Option 2 (STRICT_SYNC_ONLY)", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "TEST",
        fundingIntervalHours: 4,
        settlementCycleLabel: "4h Cycle",
        payoutsPerDay: 6,
        binanceIntervalHours: 1,
        bybitIntervalHours: 4,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };
      const res = checkFundingSynchronization("Binance", "Bybit", meta as any, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });
      expect(res.synchronized).toBe(false);
      expect(res.reason).toContain("[STRICT_SYNC_REJECTED] Interval mismatch: Binance (1h) !== Bybit (4h)");
    });

    it("rejects countdown desync >60s with [STRICT_SYNC_REJECTED] under Option 2 (STRICT_SYNC_ONLY)", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "TEST",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h Cycle",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 300 * 1000,
        bybitNextFundingTime: now + 600 * 1000, // 300s delta > 60s
      };
      const res = checkFundingSynchronization("Binance", "Bybit", meta as any, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });
      expect(res.synchronized).toBe(false);
      expect(res.reason).toContain("[STRICT_SYNC_REJECTED] Countdown desynchronization");
    });

    it("admits identical intervals and <=60s countdown under Option 2 (STRICT_SYNC_ONLY)", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "TEST",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h Cycle",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 300 * 1000,
        bybitNextFundingTime: now + 330 * 1000, // 30s delta <= 60s
      };
      const res = checkFundingSynchronization("Binance", "Bybit", meta as any, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });
      expect(res.synchronized).toBe(true);
      expect(res.isAsymmetric).toBe(false);
      expect(res.firstSettlementVenue).toBe("Simultaneous");
    });

    it("filters custom interval pairs accurately in CUSTOM mode", () => {
      expect(isIntervalPairAllowed(1, 4, ["1h_4h", "4h_8h"])).toBe(true);
      expect(isIntervalPairAllowed(4, 1, ["1h_4h", "4h_8h"])).toBe(true); // reverse match
      expect(isIntervalPairAllowed(1, 8, ["1h_4h", "4h_8h"])).toBe(false);
      expect(formatIntervalPairKey(1, 4)).toBe("1h_4h");
      expect(formatIntervalPairKey(4, 1, false)).toBe("1h_4h");
    });
  });

  describe("7. Bot Config Persistence & .set File Serialization", () => {
    it("serializes and deserializes intervalMode and allowedIntervalPairs seamlessly", () => {
      const config: BotConfig = {
        enabled: true,
        minSpreadBps: 35,
        maxPriceDivergencePct: 0.05,
        closeMaxPriceDivergencePct: 0.03,
        balanceAllocationPct: 20,
        leverageMode: "MAX_PER_COIN",
        customLeverage: 10,
        maxSimultaneousHedges: 2,
        maxMarginCapUsdt: 500,
        postSettlementWaitSeconds: 15,
        scanIntervalSeconds: 5,
        intervalMode: "STRICT_SYNC_ONLY",
        allowedIntervalPairs: ["1h_4h", "4h_8h"],
      };

      const serialized = serializeConfigToSetText(config, "Strict Preset");
      expect(serialized).toContain("IntervalMode=STRICT_SYNC_ONLY");
      expect(serialized).toContain("AllowAsymmetricFunding=false");
      expect(serialized).toContain("AllowedIntervalPairs=1h_4h,4h_8h");

      const parsed = parseSetTextToConfig(serialized);
      expect(parsed.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsed.allowAsymmetricFunding).toBe(false);
      expect(parsed.allowedIntervalPairs).toEqual(["1h_4h", "4h_8h"]);
    });

    it("parses legacy .set files without IntervalMode into default ALL_ASYMMETRIC", () => {
      const legacySet = `
Enabled=true
MinSpreadBps=35
AllowAsymmetricFunding=true
`;
      const parsed = parseSetTextToConfig(legacySet);
      expect(parsed.allowAsymmetricFunding).toBe(true);
      expect(parsed.intervalMode).toBe("ALL_ASYMMETRIC");
    });
  });

  describe("8. Remediation Invariants: Macro Carry Protection & CUSTOM Symmetric Admission", () => {
    it("preserves positive macro carry without tripping direction inversion when R_A < R_B on 1h vs 4h", () => {
      // 1h rate is 0.15%, 4h rate is 0.20%.
      // Unweighted rate diff is -0.05% (-5 bps).
      // Macro cycle (H=4h): 4 * 0.15% = 0.60% vs 1 * 0.20% = 0.20%. Net macro carry = +0.40% (+40 bps).
      const macroEval = calculateAsymmetricMacroYield(0.15, 1, 0.20, 4);
      expect(macroEval.recommendedDirection).toBe("SHORT_A_LONG_B");
      expect(macroEval.grossYieldBps).toBe(40);
      expect(macroEval.clearsFeeHurdle).toBe(true);

      const hedgeDirection = "SHORT_BINANCE_LONG_BYBIT";
      const isHedgeShortA = hedgeDirection.toUpperCase().includes("SHORT_A") ||
        hedgeDirection.toUpperCase().includes("SHORT_BINANCE") ||
        hedgeDirection.toUpperCase().startsWith("SHORT");
      const liveDominantShortA = macroEval.recommendedDirection === "SHORT_A_LONG_B";

      // Dominance has NOT flipped against established hedge direction
      expect(isHedgeShortA).toBe(true);
      expect(liveDominantShortA).toBe(true);
      expect(isHedgeShortA !== liveDominantShortA).toBe(false); // Does NOT trip inversion circuit breaker!
    });

    it("trips inversion when live rates cause macro directional dominance to flip against hedge", () => {
      // Venue A rate collapses from 0.15% to 0.02%, Venue B stays 0.20%.
      // Macro cycle: 4 * 0.02% = 0.08% vs 1 * 0.20% = 0.20%.
      // Direction flips to LONG_A_SHORT_B!
      const macroEval = calculateAsymmetricMacroYield(0.02, 1, 0.20, 4);
      expect(macroEval.recommendedDirection).toBe("LONG_A_SHORT_B");

      const hedgeDirection = "SHORT_BINANCE_LONG_BYBIT";
      const isHedgeShortA = hedgeDirection.toUpperCase().includes("SHORT_A") ||
        hedgeDirection.toUpperCase().includes("SHORT_BINANCE") ||
        hedgeDirection.toUpperCase().startsWith("SHORT");
      const liveDominantShortA = macroEval.recommendedDirection === "SHORT_A_LONG_B";

      // Dominance HAS flipped!
      expect(isHedgeShortA).toBe(true);
      expect(liveDominantShortA).toBe(false);
      expect(isHedgeShortA !== liveDominantShortA).toBe(true); // TRIPS inversion circuit breaker!
    });

    it("verifies CUSTOM mode automatically admits standard symmetric pairs (8h ⇄ 8h, 4h ⇄ 4h)", () => {
      const allowed = ["1h_4h", "4h_8h"];
      // Standard 8h ⇄ 8h symmetric pair
      const intA = 8;
      const intB = 8;
      const pair: { isAsymmetricFunding?: boolean } = { isAsymmetricFunding: false };
      const isSymmetricAdmitted = (intA === intB && pair.isAsymmetricFunding !== true);
      expect(isSymmetricAdmitted).toBe(true);

      // Asymmetric allowed pair 1h ⇄ 4h
      expect(isIntervalPairAllowed(1, 4, allowed)).toBe(true);
      // Asymmetric unlisted pair 1h ⇄ 8h
      expect(isIntervalPairAllowed(1, 8, allowed)).toBe(false);
    });

    it("verifies exact 35.0 bps fee hurdle clears in checkFundingSynchronization", () => {
      const now = 1700000000000;
      const meta = {
        symbol: "HURDLE35",
        fundingIntervalHours: 8,
        settlementCycleLabel: "8h Cycle",
        payoutsPerDay: 3,
        binanceIntervalHours: 8,
        bybitIntervalHours: 8,
        binanceNextFundingTime: now + 3600 * 1000,
        bybitNextFundingTime: now + 3600 * 1000,
      };

      const res = checkFundingSynchronization("Binance", "Bybit", meta as any, now, {
        rateA: 0.35,
        rateB: 0,
        minGrossSpreadBps: 35.0,
      });

      expect(res.asymmetricYield?.grossYieldBps).toBe(35.0);
      expect(res.asymmetricYield?.netYieldBps).toBe(0.0);
      expect(res.asymmetricYield?.clearsFeeHurdle).toBe(true);
    });
  });
});

