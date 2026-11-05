/**
 * Canonical Contract Identity & Multiplier Normalization Engine
 * Track SPEC-CORE / IDENT-01
 * 
 * Prevents cross-venue symbol multiplier collisions, TradFi stock contamination,
 * and phantom price disparities (e.g. Binance Caterpillar Stock $588 vs Bybit Simon's Cat $0.0018).
 */

export interface CanonicalInstrumentMapping {
  canonicalId: string;
  binanceSymbol: string;
  bybitSymbol: string;
  bitgetSymbol?: string;
  coindcxSymbol?: string;
  binanceMultiplier: number;
  bybitMultiplier: number;
  multiplierRatioBnToByb: number; // bybitMultiplier / binanceMultiplier
  assetCategory: "crypto" | "stock" | "commodity" | "forex";
  isCrypto: boolean;
}

export class ContractIdentityResolver {
  // Comprehensive TradFi Equities, Commodities and ETFs known on Binance USD-M & Bybit Linear
  private static readonly TRADFI_NON_CRYPTO_SYMBOLS: Set<string> = new Set([
    "CATUSDT",      // Caterpillar Inc. Stock (Binance)
    "EBAYUSDT",     // eBay Inc. Stock
    "AMCUSDT",      // AMC Entertainment Stock
    "PFEUSDT",      // Pfizer Inc. Stock
    "SKHYNIXUSDT",  // SK Hynix Korea Stock
    "HYUNDAIUSDT",  // Hyundai Motor Korea Stock
    "SAMSUNGUSDT",  // Samsung Electronics Korea Stock
    "TSLAUSDT",     // Tesla Stock
    "NVDAUSDT",     // Nvidia Stock
    "AAPLUSDT",     // Apple Stock
    "MSFTUSDT",     // Microsoft Stock
    "AMZNUSDT",     // Amazon Stock
    "GOOGLUSDT",    // Alphabet Stock
    "METAUSDT",     // Meta Platforms Stock
    "COINUSDT",     // Coinbase Stock
    "MSTRUSDT",     // MicroStrategy Stock
    "SPYUSDT",      // S&P 500 ETF
    "QQQUSDT",      // Invesco QQQ ETF
    "BXUSDT",       // Blackstone Stock
    "EQTUSDT",      // EQT Corp Stock
    "CIENUSDT",     // Ciena Corp Stock
    "DDOGUSDT",     // Datadog Stock
    "BONDUSDT",     // Bond ETF
    "XAUUSDT",      // Gold
    "XAGUSDT",      // Silver
    "COPPERUSDT",   // Copper
    "CLUSDT",       // Crude Oil
    "BZUSDT",       // Brent Crude Oil
    "NATGASUSDT",   // Natural Gas
    "XPTUSDT",      // Platinum
    "XPDUSDT",      // Palladium
  ]);

  // Explicit mappings for meme coins and assets with multiplier differences
  private static readonly CANONICAL_MAPPINGS: Map<string, CanonicalInstrumentMapping> = new Map([
    // Simon's Cat (Binance 1000CATUSDT <-> Bybit 1000CATUSDT) - DO NOT ALIAS TO CATUSDT (Caterpillar)
    ["1000CATUSDT", {
      canonicalId: "SIMONS_CAT",
      binanceSymbol: "1000CATUSDT",
      bybitSymbol: "1000CATUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // SATS (Binance 1000SATS vs Bybit 10000SATS - 10x ratio!)
    ["1000SATSUSDT", {
      canonicalId: "SATS",
      binanceSymbol: "1000SATSUSDT",
      bybitSymbol: "10000SATSUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 10000,
      multiplierRatioBnToByb: 10.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    ["10000SATSUSDT", {
      canonicalId: "SATS",
      binanceSymbol: "1000SATSUSDT",
      bybitSymbol: "10000SATSUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 10000,
      multiplierRatioBnToByb: 10.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // BabyDoge (Binance 1MBABYDOGE vs Bybit 1000000BABYDOGE)
    ["1MBABYDOGEUSDT", {
      canonicalId: "BABYDOGE",
      binanceSymbol: "1MBABYDOGEUSDT",
      bybitSymbol: "1000000BABYDOGEUSDT",
      binanceMultiplier: 1000000,
      bybitMultiplier: 1000000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    ["1000000BABYDOGEUSDT", {
      canonicalId: "BABYDOGE",
      binanceSymbol: "1MBABYDOGEUSDT",
      bybitSymbol: "1000000BABYDOGEUSDT",
      binanceMultiplier: 1000000,
      bybitMultiplier: 1000000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // Shiba Inu (Binance 1000SHIB vs Bybit SHIB1000USDT / 1000SHIBUSDT)
    ["1000SHIBUSDT", {
      canonicalId: "SHIB",
      binanceSymbol: "1000SHIBUSDT",
      bybitSymbol: "1000SHIBUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    ["SHIB1000USDT", {
      canonicalId: "SHIB",
      binanceSymbol: "1000SHIBUSDT",
      bybitSymbol: "SHIB1000USDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // Turbo (Binance TURBOUSDT vs Bybit 1000TURBOUSDT - 1000x ratio!)
    ["TURBOUSDT", {
      canonicalId: "TURBO",
      binanceSymbol: "TURBOUSDT",
      bybitSymbol: "1000TURBOUSDT",
      binanceMultiplier: 1,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1000.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    ["1000TURBOUSDT", {
      canonicalId: "TURBO",
      binanceSymbol: "TURBOUSDT",
      bybitSymbol: "1000TURBOUSDT",
      binanceMultiplier: 1,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1000.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // Pepe (Binance 1000PEPEUSDT vs Bybit 1000PEPEUSDT)
    ["1000PEPEUSDT", {
      canonicalId: "PEPE",
      binanceSymbol: "1000PEPEUSDT",
      bybitSymbol: "1000PEPEUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // Bonk (Binance 1000BONKUSDT vs Bybit 1000BONKUSDT)
    ["1000BONKUSDT", {
      canonicalId: "BONK",
      binanceSymbol: "1000BONKUSDT",
      bybitSymbol: "1000BONKUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // Floki (Binance 1000FLOKIUSDT vs Bybit 1000FLOKIUSDT)
    ["1000FLOKIUSDT", {
      canonicalId: "FLOKI",
      binanceSymbol: "1000FLOKIUSDT",
      bybitSymbol: "1000FLOKIUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // Rats (Binance 1000RATSUSDT vs Bybit 1000RATSUSDT)
    ["1000RATSUSDT", {
      canonicalId: "RATS",
      binanceSymbol: "1000RATSUSDT",
      bybitSymbol: "1000RATSUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
    // LUNC (Binance 1000LUNCUSDT vs Bybit 1000LUNCUSDT)
    ["1000LUNCUSDT", {
      canonicalId: "LUNC",
      binanceSymbol: "1000LUNCUSDT",
      bybitSymbol: "1000LUNCUSDT",
      binanceMultiplier: 1000,
      bybitMultiplier: 1000,
      multiplierRatioBnToByb: 1.0,
      assetCategory: "crypto",
      isCrypto: true,
    }],
  ]);

  /**
   * Check whether a symbol is a TradFi stock, commodity, or non-crypto derivative
   */
  public static isTradFiOrEquity(symbol: string): boolean {
    const s = symbol.toUpperCase().trim();
    return this.TRADFI_NON_CRYPTO_SYMBOLS.has(s);
  }

  /**
   * Resolve equivalent symbol across Binance and Bybit safely
   */
  public static resolveEquivalentSymbol(
    symbol: string,
    sourceVenue: "binance" | "bybit",
    targetVenue: "binance" | "bybit"
  ): string | null {
    const s = symbol.toUpperCase().trim();

    // 1. If TradFi equity/commodity, reject immediately
    if (this.isTradFiOrEquity(s)) {
      return null;
    }

    // 2. Check canonical registered mapping
    const mapping = this.CANONICAL_MAPPINGS.get(s);
    if (mapping) {
      if (!mapping.isCrypto) return null;
      return targetVenue === "binance" ? mapping.binanceSymbol : mapping.bybitSymbol;
    }

    // 3. For standard coins, direct match
    return s;
  }

  /**
   * Validates price parity against expected contract multipliers.
   * If price ratio deviates > 5% from the contract multiplier ratio,
   * it rejects the match (permanently preventing Caterpillar Stock vs Simon's Cat collisions).
   */
  public static validateParity(
    symbolA: string,
    priceA: number,
    symbolB: string,
    priceB: number
  ): { valid: boolean; actualRatio: number; expectedRatio: number; reason?: string } {
    if (priceA <= 0 || priceB <= 0) {
      return { valid: false, actualRatio: 0, expectedRatio: 1.0, reason: "INVALID_PRICE_ZERO_OR_NEGATIVE" };
    }

    const sA = symbolA.toUpperCase().trim();
    const sB = symbolB.toUpperCase().trim();

    // Check if either is TradFi
    if (this.isTradFiOrEquity(sA) || this.isTradFiOrEquity(sB)) {
      return { valid: false, actualRatio: 0, expectedRatio: 1.0, reason: "TRADFI_EQUITY_PROHIBITED" };
    }

    // Find expected multiplier ratio
    let expectedRatio = 1.0;
    const mappingA = this.CANONICAL_MAPPINGS.get(sA);
    const mappingB = this.CANONICAL_MAPPINGS.get(sB);

    if (mappingA) {
      expectedRatio = mappingA.multiplierRatioBnToByb;
    } else if (mappingB) {
      expectedRatio = 1.0 / mappingB.multiplierRatioBnToByb;
    } else if (sA.startsWith("1000") && !sB.startsWith("1000")) {
      expectedRatio = 1000.0;
    } else if (!sA.startsWith("1000") && sB.startsWith("1000")) {
      expectedRatio = 0.001;
    }

    // Actual ratio: priceA / priceB
    // Example: priceA (Binance Caterpillar) = 588.78, priceB (Bybit Simon's Cat) = 0.001807
    // actualRatio = 325,832! expectedRatio = 1.0! error = 32,583,100% (REJECTED!)
    const actualRatio = priceA / priceB;
    const relativeError = Math.abs(actualRatio - expectedRatio) / expectedRatio;

    if (relativeError > 0.05) {
      // Divergence greater than 5% from expected multiplier
      return {
        valid: false,
        actualRatio,
        expectedRatio,
        reason: `MULTIPLIER_PARITY_BREACH: Price ratio ${actualRatio.toFixed(4)} deviates ${(relativeError * 100).toFixed(2)}% from expected ratio ${expectedRatio}`,
      };
    }

    return { valid: true, actualRatio, expectedRatio };
  }
}
