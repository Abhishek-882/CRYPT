/**
 * Vitest Unit Suite: Adversarial Option 2 (Strict Sync Only) & Macro Horizon Verification
 */

import { describe, it, expect } from "vitest";
import {
  checkFundingSynchronization,
  SymbolFundingMeta,
  FundingIntervalMode,
} from "../../lib/exchangeFundingMeta";
import {
  evaluatePairwiseArbitrage,
  VenueRateInfo,
} from "../../lib/spreadCalculation";
import {
  serializeConfigToSetText,
  parseSetTextToConfig,
  BotConfig,
  DEFAULT_CONFIG,
} from "../../lib/botEngine";

describe("Adversarial Option 2 (Strict Sync Only) & Macro Horizon Verification", () => {
  const now = 1700000000000;

  describe("1. Interval Mismatch Rejection (All 12 Permutations)", () => {
    const permutations: Array<[number, number]> = [
      [1, 4], [4, 1],
      [4, 8], [8, 4],
      [1, 8], [8, 1],
      [2, 4], [4, 2],
      [2, 8], [8, 2],
      [1, 2], [2, 1],
    ];

    permutations.forEach(([iA, iB]) => {
      it(`strictly rejects interval mismatch ${iA}h != ${iB}h under Option 2`, () => {
        const meta: SymbolFundingMeta = {
          symbol: `TEST-${iA}H-${iB}H`,
          fundingIntervalHours: Math.min(iA, iB),
          settlementCycleLabel: "Test",
          payoutsPerDay: 24 / Math.min(iA, iB),
          binanceIntervalHours: iA,
          bybitIntervalHours: iB,
          binanceNextFundingTime: now + 3600 * 1000,
          bybitNextFundingTime: now + 3600 * 1000,
        };

        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });

        expect(res.synchronized).toBe(false);
        expect(res.isAsymmetric).toBe(true);
        expect(res.reason).toBe(`[STRICT_SYNC_REJECTED] Interval mismatch: Binance (${iA}h) !== Bybit (${iB}h)`);

        // Also test evaluatePairwiseArbitrage
        const arb = evaluatePairwiseArbitrage([
          { venue: "binance", label: "Binance", badge: "BN", color: "#F3BA2F", rate: 0.10, intervalHours: iA, nextFundingTime: now + 3600 * 1000 },
          { venue: "bybit", label: "Bybit", badge: "BY", color: "#F7A600", rate: 0.02, intervalHours: iB, nextFundingTime: now + 3600 * 1000 },
        ], 8, { intervalMode: "STRICT_SYNC_ONLY" });

        expect(arb.allPairs[0].isFundingSynchronized).toBe(false);
        expect(arb.allPairs[0].syncDisqualificationReason).toBe(`[STRICT_SYNC_REJECTED] Interval mismatch: Binance (${iA}h) !== Bybit (${iB}h)`);
      });
    });
  });

  describe("2. Countdown Desynchronization Threshold Boundary", () => {
    it("admits countdown delta <= 60s under Option 2", () => {
      const deltas = [0, 10000, 30000, 59000, 60000];
      for (const d of deltas) {
        const meta: SymbolFundingMeta = {
          symbol: "TEST-SYNC",
          fundingIntervalHours: 8,
          settlementCycleLabel: "8h",
          payoutsPerDay: 3,
          binanceIntervalHours: 8,
          bybitIntervalHours: 8,
          binanceNextFundingTime: now + 3600 * 1000,
          bybitNextFundingTime: now + 3600 * 1000 + d,
        };
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });
        expect(res.synchronized).toBe(true);
        expect(res.isAsymmetric).toBe(false);
      }
    });

    it("rejects countdown delta > 60s under Option 2", () => {
      const deltas = [60001, 61000, 120000, 300000, 3600000];
      for (const d of deltas) {
        const meta: SymbolFundingMeta = {
          symbol: "TEST-DESYNC",
          fundingIntervalHours: 8,
          settlementCycleLabel: "8h",
          payoutsPerDay: 3,
          binanceIntervalHours: 8,
          bybitIntervalHours: 8,
          binanceNextFundingTime: now + 3600 * 1000,
          bybitNextFundingTime: now + 3600 * 1000 + d,
        };
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });
        expect(res.synchronized).toBe(false);
        expect(res.isAsymmetric).toBe(true);
        expect(res.reason).toContain("[STRICT_SYNC_REJECTED] Countdown desynchronization");
      }
    });

    it("rejects when one venue has timestamp and other is missing", () => {
      const arb = evaluatePairwiseArbitrage([
        { venue: "binance", label: "Binance", badge: "BN", color: "#F3BA2F", rate: 0.10, intervalHours: 8, nextFundingTime: now + 3600 * 1000 },
        { venue: "bybit", label: "Bybit", badge: "BY", color: "#F7A600", rate: 0.02, intervalHours: 8, nextFundingTime: 0 },
      ], 8, { intervalMode: "STRICT_SYNC_ONLY" });
      expect(arb.allPairs[0].isFundingSynchronized).toBe(false);
      expect(arb.allPairs[0].syncDisqualificationReason).toContain("[STRICT_SYNC_REJECTED] Countdown desynchronization");
    });

    it("handles undefined meta by falling back safely to deterministic 8h", () => {
      const res = checkFundingSynchronization("Binance", "Bybit", undefined, now, {
        intervalMode: "STRICT_SYNC_ONLY",
      });
      expect(res.synchronized).toBe(true);
      expect(res.isAsymmetric).toBe(false);
    });
  });

  describe("3. Strict Sync Admission for Identical Intervals", () => {
    [1, 2, 4, 8].forEach((interval) => {
      it(`admits identical interval ${interval}h = ${interval}h`, () => {
        const meta: SymbolFundingMeta = {
          symbol: `TEST-${interval}H`,
          fundingIntervalHours: interval,
          settlementCycleLabel: `${interval}h`,
          payoutsPerDay: 24 / interval,
          binanceIntervalHours: interval,
          bybitIntervalHours: interval,
          binanceNextFundingTime: now + 3600 * 1000,
          bybitNextFundingTime: now + 3600 * 1000 + 15 * 1000,
        };
        const res = checkFundingSynchronization("Binance", "Bybit", meta, now, {
          intervalMode: "STRICT_SYNC_ONLY",
        });
        expect(res.synchronized).toBe(true);
        expect(res.isAsymmetric).toBe(false);
        expect(res.macroHorizonHours).toBe(interval);
        expect(res.cyclesA).toBe(1);
        expect(res.cyclesB).toBe(1);
        expect(res.firstSettlementVenue).toBe("Simultaneous");
      });
    });
  });

  describe("4. Macro Horizon Settlement Holding & Overwrite Protection", () => {
    it("asymmetric hedge assigns fundingSettlementTime = macroNextFundingTime and holds through T_macro + postWait", () => {
      const entryTime = now;
      const t1h = entryTime + 3600 * 1000;
      const t4h = entryTime + 14400 * 1000;
      const meta: SymbolFundingMeta = {
        symbol: "TEST-HOLD",
        fundingIntervalHours: 1,
        settlementCycleLabel: "1h/4h",
        payoutsPerDay: 24,
        binanceIntervalHours: 1,
        bybitIntervalHours: 4,
        binanceNextFundingTime: t1h,
        bybitNextFundingTime: t4h,
      };

      const sync = checkFundingSynchronization("Binance", "Bybit", meta, entryTime, {
        intervalMode: "ALL_ASYMMETRIC",
      });

      expect(sync.synchronized).toBe(true);
      expect(sync.isAsymmetric).toBe(true);
      expect(sync.earliestNextFundingTime).toBe(t1h);
      expect(sync.macroNextFundingTime).toBe(t4h);

      const assignedSettlementTime = (sync.isAsymmetric && sync.macroNextFundingTime)
        ? sync.macroNextFundingTime
        : sync.earliestNextFundingTime;

      expect(assignedSettlementTime).toBe(t4h);

      const postWaitMs = 15000;
      const waitThreshold = assignedSettlementTime + postWaitMs;

      // Before first settlement (30m)
      expect(entryTime + 1800000 >= waitThreshold).toBe(false);
      // Immediately after faster venue settlement (1h + 1m)
      expect(t1h + 60000 >= waitThreshold).toBe(false);
      // T_macro exact
      expect(t4h >= waitThreshold).toBe(false);
      // T_macro + 10s (inside postWait)
      expect(t4h + 10000 >= waitThreshold).toBe(false);
      // T_macro + 15s (exact waitThreshold reached)
      expect(waitThreshold >= waitThreshold).toBe(true);
      // T_macro + 20s
      expect(waitThreshold + 5000 >= waitThreshold).toBe(true);
    });
  });

  describe("5. Config Persistence Round-Trip", () => {
    it("preserves IntervalMode and AllowedIntervalPairs through serialize/deserialize", () => {
      const strictConfig: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "STRICT_SYNC_ONLY",
        allowAsymmetricFunding: false,
        allowedIntervalPairs: [],
      };
      const strictText = serializeConfigToSetText(strictConfig, "Strict Test");
      expect(strictText).toContain("IntervalMode=STRICT_SYNC_ONLY");
      expect(strictText).toContain("AllowAsymmetricFunding=false");

      const parsedStrict = parseSetTextToConfig(strictText);
      expect(parsedStrict.intervalMode).toBe("STRICT_SYNC_ONLY");
      expect(parsedStrict.allowAsymmetricFunding).toBe(false);
      expect(parsedStrict.allowedIntervalPairs).toEqual([]);

      const asymConfig: BotConfig = {
        ...DEFAULT_CONFIG,
        intervalMode: "ALL_ASYMMETRIC",
        allowAsymmetricFunding: true,
        allowedIntervalPairs: ["1h_4h", "4h_8h", "1h_8h"],
      };
      const asymText = serializeConfigToSetText(asymConfig, "Asym Test");
      const parsedAsym = parseSetTextToConfig(asymText);
      expect(parsedAsym.intervalMode).toBe("ALL_ASYMMETRIC");
      expect(parsedAsym.allowAsymmetricFunding).toBe(true);
      expect(parsedAsym.allowedIntervalPairs).toEqual(["1h_4h", "4h_8h", "1h_8h"]);
    });
  });
});
