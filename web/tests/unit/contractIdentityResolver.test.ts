import { describe, it, expect } from "vitest";
import { ContractIdentityResolver } from "@/lib/contractIdentityResolver";

describe("ContractIdentityResolver", () => {
  it("correctly identifies TradFi non-crypto equities and commodities", () => {
    expect(ContractIdentityResolver.isTradFiOrEquity("CATUSDT")).toBe(true);
    expect(ContractIdentityResolver.isTradFiOrEquity("EBAYUSDT")).toBe(true);
    expect(ContractIdentityResolver.isTradFiOrEquity("AMCUSDT")).toBe(true);
    expect(ContractIdentityResolver.isTradFiOrEquity("SKHYNIXUSDT")).toBe(true);
    expect(ContractIdentityResolver.isTradFiOrEquity("XAUUSDT")).toBe(true);

    // Crypto assets must NOT be classified as TradFi
    expect(ContractIdentityResolver.isTradFiOrEquity("BTCUSDT")).toBe(false);
    expect(ContractIdentityResolver.isTradFiOrEquity("ETHUSDT")).toBe(false);
    expect(ContractIdentityResolver.isTradFiOrEquity("1000CATUSDT")).toBe(false);
    expect(ContractIdentityResolver.isTradFiOrEquity("1000PEPEUSDT")).toBe(false);
  });

  it("safely resolves canonical meme coin symbols without stripping to colliding stock tickers", () => {
    // 1000CATUSDT must map to 1000CATUSDT on Binance (Simon's Cat), NEVER to CATUSDT (Caterpillar)
    const bnCat = ContractIdentityResolver.resolveEquivalentSymbol("1000CATUSDT", "bybit", "binance");
    expect(bnCat).toBe("1000CATUSDT");

    // TradFi CATUSDT must be completely blocked
    const bnStock = ContractIdentityResolver.resolveEquivalentSymbol("CATUSDT", "bybit", "binance");
    expect(bnStock).toBe(null);
  });

  it("catches and rejects the 3.25 Billion bps Caterpillar stock vs Simon's Cat parity breach", () => {
    const binanceCaterpillarPrice = 588.78;
    const bybitSimonsCatPrice = 0.001807;

    // Direct parity check: Caterpillar ($588.78) vs Simon's Cat ($0.001807)
    const result = ContractIdentityResolver.validateParity(
      "CATUSDT",
      binanceCaterpillarPrice,
      "1000CATUSDT",
      bybitSimonsCatPrice
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("TRADFI_EQUITY_PROHIBITED");
  });

  it("accepts valid crypto pairs with normal basis", () => {
    // Normal BTC ($80,350 vs $80,345)
    const btcResult = ContractIdentityResolver.validateParity("BTCUSDT", 80350, "BTCUSDT", 80345);
    expect(btcResult.valid).toBe(true);

    // Normal 1000CAT meme coin on both venues ($0.001805 vs $0.001807)
    const catResult = ContractIdentityResolver.validateParity("1000CATUSDT", 0.001805, "1000CATUSDT", 0.001807);
    expect(catResult.valid).toBe(true);
  });
});
