import { describe, it, expect, beforeEach } from "vitest";
import { CorrelationCircuitBreaker } from "../../lib/circuitBreaker";

describe("Phase 4: Cross-Venue Correlation Breakdown Circuit Breaker", () => {
  let breaker: CorrelationCircuitBreaker;

  beforeEach(() => {
    breaker = new CorrelationCircuitBreaker();
  });

  it("should report NORMAL and allow entries when venues are tightly correlated", () => {
    const baseTime = 1700000000000;
    // Feed 10 ticks of perfectly correlated price series (priceB = priceA * 1.0005)
    for (let i = 0; i < 10; i++) {
      const priceA = 100 + i * 0.5;
      const priceB = (100 + i * 0.5) * 1.0005;
      breaker.ingestTick("BINANCE_BYBIT", "BTCUSDT", priceA, priceB, baseTime + i * 1000);
    }

    const status = breaker.evaluate("BINANCE_BYBIT", "BTCUSDT", baseTime + 10000);
    expect(status.state).toBe("NORMAL");
    expect(status.pearsonR).toBeGreaterThan(0.95);
    expect(status.haltEntries).toBe(false);
    expect(status.engageDeltaLock).toBe(false);

    const check = breaker.isEntryAllowed("BINANCE_BYBIT", "BTCUSDT");
    expect(check.allowed).toBe(true);
  });

  it("should trip circuit breaker after 3 consecutive correlation breakdown ticks", () => {
    const baseTime = 1700000000000;

    // First seed with a few ticks to establish baseline
    for (let i = 0; i < 6; i++) {
      const priceA = 100 + (i % 2 === 0 ? 0.2 : -0.2);
      const priceB = 100 + (i % 2 === 0 ? 0.2 : -0.2);
      breaker.ingestTick("BINANCE_BYBIT", "SOLUSDT", priceA, priceB, baseTime + i * 1000);
    }

    // Now inject negative correlation ticks (Price A surges while Price B collapses)
    for (let i = 6; i < 12; i++) {
      const priceA = 100 + (i - 5) * 5.0; // Spikes up to 130
      const priceB = 100 - (i - 5) * 5.0; // Crashes down to 70
      breaker.ingestTick("BINANCE_BYBIT", "SOLUSDT", priceA, priceB, baseTime + i * 1000);
    }

    const status = breaker.evaluate("BINANCE_BYBIT", "SOLUSDT", baseTime + 12000);
    expect(status.state).toBe("TRIPPED");
    expect(status.pearsonR).toBeLessThan(0.80);
    expect(status.haltEntries).toBe(true);
    expect(status.engageDeltaLock).toBe(true);
    expect(status.reason).toContain("CIRCUIT_BREAKER_TRIPPED");

    const check = breaker.isEntryAllowed("BINANCE_BYBIT", "SOLUSDT");
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("CIRCUIT_BREAKER");
  });

  it("should require 3 consecutive normal ticks to reset from TRIPPED state (hysteresis guard)", () => {
    const baseTime = 1700000000000;

    // Seed and trip breaker with inverse prices
    for (let i = 0; i < 10; i++) {
      const priceA = 100 + i * 2.0;
      const priceB = 100 - i * 2.0;
      breaker.ingestTick("BINANCE_BYBIT", "ETHUSDT", priceA, priceB, baseTime + i * 1000);
    }

    let status = breaker.evaluate("BINANCE_BYBIT", "ETHUSDT", baseTime + 10000);
    expect(status.state).toBe("TRIPPED");

    // Ingest 1 normal tick (correlated) - breaker should remain TRIPPED
    const t1 = baseTime + 65000; // After previous window expires
    breaker.ingestTick("BINANCE_BYBIT", "ETHUSDT", 100, 100.01, t1);
    status = breaker.evaluate("BINANCE_BYBIT", "ETHUSDT", t1);
    expect(status.state).toBe("TRIPPED");

    // Ingest 6 correlated ticks in the new window
    for (let i = 1; i <= 6; i++) {
      const p = 100 + i * 0.1;
      breaker.ingestTick("BINANCE_BYBIT", "ETHUSDT", p, p * 1.0001, t1 + i * 1000);
    }

    // Now evaluate after multiple consecutive normal ticks in the fresh window
    status = breaker.evaluate("BINANCE_BYBIT", "ETHUSDT", t1 + 7000);
    expect(status.state).toBe("NORMAL");
    expect(status.haltEntries).toBe(false);
  });
});
