import { describe, it, expect, beforeEach } from "vitest";
import { FleetDispatcher } from "../../lib/fleetDispatcher";

describe("Phase 4: Centralized Fleet Priority Queue Dispatcher", () => {
  let dispatcher: FleetDispatcher;

  beforeEach(() => {
    dispatcher = new FleetDispatcher();
    dispatcher.clear();
  });

  it("should rank candidates globally across multiple bots by Composite Arbitrage Score", () => {
    // Bot 1 submits SOL with high spread and positive basis
    const casSol = dispatcher.submitCandidate(
      "bot-1",
      "Binance-Bybit Alpha",
      { symbol: "SOLUSDT", spreadBps: 65 },
      {
        symbol: "SOLUSDT",
        corridor: "BINANCE_BYBIT",
        venueA: "Binance",
        venueB: "Bybit",
        grossSpreadBps: 65,
        netSpreadBps: 45,
        signedBasisBps: 15,
        l2DepthUsd: 15000,
        targetNotionalUsd: 500,
        basisVolatilityBps: 5,
        persistenceScore: 80,
        secondsToFunding: 1800,
      }
    );

    // Bot 2 submits BTC with low spread
    const casBtc = dispatcher.submitCandidate(
      "bot-2",
      "Bitget-Bybit Delta",
      { symbol: "BTCUSDT", spreadBps: 20 },
      {
        symbol: "BTCUSDT",
        corridor: "BITGET_BYBIT",
        venueA: "Bitget",
        venueB: "Bybit",
        grossSpreadBps: 20,
        netSpreadBps: 5,
        signedBasisBps: 0,
        l2DepthUsd: 50000,
        targetNotionalUsd: 500,
        basisVolatilityBps: 2,
        persistenceScore: 60,
        secondsToFunding: 7200,
      }
    );

    expect(casSol.qualified).toBe(true);
    expect(casSol.compositeScore).toBeGreaterThan(casBtc.compositeScore);

    const topForBot1 = dispatcher.pollBestCandidateForBot("bot-1");
    expect(topForBot1).not.toBeNull();
    expect(topForBot1?.symbol).toBe("SOLUSDT");
  });

  it("should enforce fleet-wide mutual exclusion locks across bots", () => {
    // Bot 1 acquires lock on ETHUSDT
    const acquired1 = dispatcher.acquireFleetLock("ETHUSDT", "BINANCE_BYBIT", "bot-1");
    expect(acquired1).toBe(true);

    // Symbol is now locked fleet-wide
    expect(dispatcher.isSymbolLockedFleetWide("ETHUSDT")).toBe(true);
    // Requesting bot itself is not locked out
    expect(dispatcher.isSymbolLockedFleetWide("ETHUSDT", "bot-1")).toBe(false);
    // Other bot IS locked out
    expect(dispatcher.isSymbolLockedFleetWide("ETHUSDT", "bot-2")).toBe(true);

    // Bot 2 tries to acquire lock on same symbol -> denied
    const acquired2 = dispatcher.acquireFleetLock("ETHUSDT", "BITGET_BYBIT", "bot-2");
    expect(acquired2).toBe(false);

    // Bot 1 releases lock
    dispatcher.releaseFleetLock("ETHUSDT", "BINANCE_BYBIT", "bot-1");
    expect(dispatcher.isSymbolLockedFleetWide("ETHUSDT")).toBe(false);

    // Now Bot 2 can acquire lock
    const acquired3 = dispatcher.acquireFleetLock("ETHUSDT", "BITGET_BYBIT", "bot-2");
    expect(acquired3).toBe(true);
  });
});
