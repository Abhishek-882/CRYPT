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

  it("should allow concurrent cross-tenant execution locks on the same market pair", () => {
    // Tenant 1 trading agent acquires lock on BTCUSDT
    const acquiredTenant1 = dispatcher.acquireFleetLock("BTCUSDT", "BINANCE_BYBIT", "agent-1", "usr_tenant_1");
    expect(acquiredTenant1).toBe(true);

    // Tenant 2 trading agent simultaneously acquires lock on BTCUSDT on independent exchange account
    const acquiredTenant2 = dispatcher.acquireFleetLock("BTCUSDT", "BINANCE_BYBIT", "agent-2", "usr_tenant_2");
    expect(acquiredTenant2).toBe(true);

    // Both tenants have active locks on the same symbol without collision
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, "usr_tenant_1")).toBe(true);
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, "usr_tenant_2")).toBe(true);

    // Requesting agent is permitted for its own tenant
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", "agent-1", "usr_tenant_1")).toBe(false);
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", "agent-2", "usr_tenant_2")).toBe(false);

    // Secondary agent under same tenant is locked out
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", "agent-3", "usr_tenant_1")).toBe(true);

    // Tenant 1 releases lock
    dispatcher.releaseFleetLock("BTCUSDT", "BINANCE_BYBIT", "agent-1", "usr_tenant_1");
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, "usr_tenant_1")).toBe(false);

    // Tenant 2 lock remains active on disk/memory
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, "usr_tenant_2")).toBe(true);

    // Tenant 2 releases lock
    dispatcher.releaseFleetLock("BTCUSDT", "BINANCE_BYBIT", "agent-2", "usr_tenant_2");
    expect(dispatcher.isSymbolLockedFleetWide("BTCUSDT", undefined, "usr_tenant_2")).toBe(false);
  });

  it("should enforce intra-tenant fleet mutual exclusion while maintaining cross-tenant isolation", () => {
    // Tenant Alpha has Instance 1 and Instance 2
    const tAlphaInst1 = dispatcher.acquireFleetLock("SOLUSDT", "COINDCX_BYBIT", "alpha-inst-1", "usr_tenant_alpha");
    expect(tAlphaInst1).toBe(true);

    // Instance 2 of Tenant Alpha attempts to acquire lock on same symbol -> denied
    const tAlphaInst2 = dispatcher.acquireFleetLock("SOLUSDT", "COINDCX_BYBIT", "alpha-inst-2", "usr_tenant_alpha");
    expect(tAlphaInst2).toBe(false);

    // Tenant Beta Instance 1 attempts to acquire lock on SOLUSDT -> permitted
    const tBetaInst1 = dispatcher.acquireFleetLock("SOLUSDT", "COINDCX_BYBIT", "beta-inst-1", "usr_tenant_beta");
    expect(tBetaInst1).toBe(true);
  });

  it("should generate correct lock keys using getLockKey with and without tenant scoping", () => {
    // Scoped keys with tenant ID
    expect(dispatcher.getLockKey("BTCUSDT", "BINANCE_BYBIT", "usr_100")).toBe("usr_100_BINANCE_BYBIT_BTCUSDT");
    expect(dispatcher.getLockKey("BTCUSDT", undefined, "usr_100")).toBe("usr_100_BTCUSDT");

    // Unscoped keys for backward compatibility
    expect(dispatcher.getLockKey("BTCUSDT", "BINANCE_BYBIT")).toBe("BINANCE_BYBIT_BTCUSDT");
    expect(dispatcher.getLockKey("BTCUSDT")).toBe("BTCUSDT");
  });
});
