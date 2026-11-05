/**
 * Vitest Unit Tests: Startup Active Position & Order Reconciliation Engine (Track B-02 / EXEC-04)
 * 
 * Verifies Option A Architecture: Controlled Auto-Resolution (Zero Fleet Quarantine Freeze)
 * 1. Clean match between saved hedges and live exchange positions
 * 2. Pruning of ghost hedges (persisted locally but 0 on exchange)
 * 3. Detection of unhedged orphans auto-resolved without locking the fleet (zero quarantine freeze)
 * 4. Controlled operator resolution of orphans when needed
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  reconcileStartupPositions,
  resolveQuarantinedOrphan,
  isStartupQuarantineActive,
  forceReleaseFleetQuarantine,
} from "../../lib/reconciliationEngine";
import * as exchangePositionsModule from "../../lib/exchangePositions";

describe("Milestone 8: Startup Position Reconciliation Engine (Option A Locked)", () => {
  beforeEach(() => {
    forceReleaseFleetQuarantine("test_reset");
    vi.restoreAllMocks();
  });

  it("should cleanly synchronize when saved dual hedges exactly match live exchange positions", async () => {
    // Mock exchange positions snapshot: BTCUSDT active on Binance (LONG) and Bitget (SHORT)
    vi.spyOn(exchangePositionsModule, "getLivePositionsForVenues").mockResolvedValue({
      timestamp: Date.now(),
      venueOpenSymbols: new Map([
        ["binance", new Set(["BTCUSDT"])],
        ["bitget", new Set(["BTCUSDT"])],
        ["bybit", new Set()],
        ["coindcx", new Set()],
      ]),
      rawPositions: [
        { venue: "Binance", symbol: "BTCUSDT", amount: 0.1, entryPrice: 65000, markPrice: 65100 },
        { venue: "Bitget", symbol: "BTCUSDT", amount: -0.1, entryPrice: 65050, markPrice: 65100 },
      ],
    });

    const savedHedges = [
      {
        id: "hedge_test_1",
        symbol: "BTCUSDT",
        venueA: "Binance",
        venueB: "Bitget",
        status: "ACTIVE",
      },
    ];

    const report = await reconcileStartupPositions("usr_test", undefined, savedHedges);

    expect(report.matchedCount).toBe(1);
    expect(report.ghostHedgesPruned.length).toBe(0);
    expect(report.detectedOrphans.length).toBe(0);
    expect(report.quarantineRequired).toBe(false);
    expect(report.actionTaken).toBe("NORMAL_SYNC");
    expect(isStartupQuarantineActive()).toBe(false);
  });

  it("should prune ghost hedges when local state has active hedge but exchange holds 0 position", async () => {
    // Exchange has 0 positions
    vi.spyOn(exchangePositionsModule, "getLivePositionsForVenues").mockResolvedValue({
      timestamp: Date.now(),
      venueOpenSymbols: new Map([
        ["binance", new Set()],
        ["bitget", new Set()],
        ["bybit", new Set()],
        ["coindcx", new Set()],
      ]),
      rawPositions: [],
    });

    const savedHedges: any[] = [
      {
        id: "ghost_hedge_1",
        symbol: "ETHUSDT",
        venueA: "Binance",
        venueB: "Bitget",
        status: "ACTIVE",
      },
    ];

    const report = await reconcileStartupPositions("usr_test", undefined, savedHedges);

    expect(report.matchedCount).toBe(0);
    expect(report.ghostHedgesPruned).toContain("ghost_hedge_1");
    expect(savedHedges[0].status).toBe("CLOSED_EXTERNALLY");
    expect(savedHedges[0].unwindReason).toBe("STARTUP_GHOST_PRUNED");
    expect(report.actionTaken).toBe("GHOSTS_PRUNED");
    expect(isStartupQuarantineActive()).toBe(false);
  });

  it("should enforce Option A auto-resolution upon detecting unhedged orphans (zero quarantine freeze)", async () => {
    // Exchange has an unhedged position on Bybit that does NOT exist in local savedHedges
    vi.spyOn(exchangePositionsModule, "getLivePositionsForVenues").mockResolvedValue({
      timestamp: Date.now(),
      venueOpenSymbols: new Map([
        ["binance", new Set()],
        ["bitget", new Set()],
        ["bybit", new Set(["SOLUSDT"])],
        ["coindcx", new Set()],
      ]),
      rawPositions: [
        { venue: "Bybit", symbol: "SOLUSDT", amount: 15.0, entryPrice: 150, markPrice: 152 },
      ],
    });

    const savedHedges: any[] = []; // No hedges in local state

    const report = await reconcileStartupPositions("usr_test", undefined, savedHedges);

    // Option A Policy: Auto-resolve orphan, ZERO quarantine freeze!
    expect(report.quarantineRequired).toBe(false);
    expect(report.actionTaken).toBe("AUTO_RESOLVED");
    expect(report.detectedOrphans.length).toBe(1);
    expect(report.detectedOrphans[0].symbol).toBe("SOLUSDT");
    expect(report.detectedOrphans[0].venue).toBe("Bybit");
    expect(report.detectedOrphans[0].status).toBe("AUTO_RESOLVED");
    expect(isStartupQuarantineActive()).toBe(false);

    // Test operator controlled action compatibility
    const orphanId = report.detectedOrphans[0].id;
    const resolveRes = await resolveQuarantinedOrphan(orphanId, "MANUAL_CLOSE");
    expect(resolveRes.success).toBe(true);
    expect(resolveRes.orphan?.status).toBe("MANUALLY_CLOSED");
    expect(isStartupQuarantineActive()).toBe(false);
  });
});
