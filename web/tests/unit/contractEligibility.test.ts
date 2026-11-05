import { describe, it, expect, beforeEach } from "vitest";
import {
  ContractEligibilityScreener,
  globalContractEligibilityScreener,
} from "../../lib/contractEligibilityScreener";

describe("Pre-Flight Contract Eligibility & Web-Agreement Screener", () => {
  let screener: ContractEligibilityScreener;

  beforeEach(() => {
    screener = new ContractEligibilityScreener();
    screener.clearCache();
  });

  it("quarantines hardcoded telemetry failure symbols immediately", async () => {
    const failureSymbols = ["BXUSDT", "EQTUSDT", "CIENUSDT", "DDOGUSDT", "BONDUSDT"];
    for (const sym of failureSymbols) {
      const res = await screener.validateCorridorEligibility(sym, "Binance", "Bybit");
      expect(res.eligible).toBe(false);
      expect(res.venueBEligible).toBe(false);
      expect(res.rejectionReason).toContain("WEB_AGREEMENT_REQUIRED");
    }
  });

  it("approves standard liquid crypto perpetual pairs", async () => {
    const res = await screener.validateCorridorEligibility("BTCUSDT", "Binance", "Bybit");
    expect(res.eligible).toBe(true);
    expect(res.venueAEligible).toBe(true);
    expect(res.venueBEligible).toBe(true);
  });

  it("includes all quarantined symbols in getIneligibleSymbols()", () => {
    const ineligible = screener.getIneligibleSymbols();
    expect(ineligible).toContain("BXUSDT");
    expect(ineligible).toContain("EQTUSDT");
    expect(ineligible).toContain("CIENUSDT");
    expect(ineligible).toContain("DDOGUSDT");
  });
});
