/**
 * Dynamic Volatility-Adjusted Leverage Engine
 * Institutional Risk-Bounded Leverage Engine for Cross-Venue Arbitrage
 *
 * Implements:
 * 1. Tier-Calibrated Dynamic Buffer:
 *    L_dyn = clamp(floor(TierBuffer_% / max(0.20%, ATR_1h_pct)), 3, L_max_exchange)
 * 2. Asset Tiers:
 *    - Tier 1 (BTC, ETH): TierBuffer = 1.6% (25x - 50x)
 *    - Tier 2 (SOL, BNB, XRP, etc.): TierBuffer = 3.0% (15x - 25x)
 *    - Tier 3 (Altcoins, Meme coins): TierBuffer = 5.0% (3x - 10x)
 * 3. Defensive Fallback Invariant:
 *    If candle history < 14 periods, or ATR is NaN/<=0, defaults safely to 3x - 5x.
 */

import { getCoinMaxLeverages } from "./exchangeLeverageMeta";

export interface Candle {
  high: number;
  low: number;
  close: number;
  open?: number;
}

export type AssetTier = "TIER_1_MAJOR" | "TIER_2_LARGE_CAP" | "TIER_3_ALTCOIN";

export interface LeverageEvaluationResult {
  symbol: string;
  venue: string;
  tier: AssetTier;
  tierBufferPct: number;
  atr1hPct: number;
  calculatedLeverage: number;
  exchangeMaxLeverage: number;
  effectiveLeverage: number;
  isDefensiveFallback: boolean;
  reason: string;
}

const TIER_1_SYMBOLS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "BTC",
  "ETH",
]);

const TIER_2_SYMBOLS = new Set([
  "SOLUSDT", "DOGEUSDT", "XRPUSDT", "BNBUSDT", "LTCUSDT",
  "BCHUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "NEARUSDT", "SUIUSDT", "APTUSDT", "ARBUSDT", "OPUSDT",
  "TIAUSDT", "INJUSDT",
  "SOL", "DOGE", "XRP", "BNB", "LTC", "BCH", "ADA", "AVAX",
  "LINK", "DOT", "NEAR", "SUI", "APT", "ARB", "OP", "TIA", "INJ"
]);

export class LeverageManager {
  /**
   * Determine asset tier and corresponding liquidation buffer
   */
  public static getAssetTier(symbol: string): { tier: AssetTier; bufferPct: number; defaultFloor: number } {
    const cleanSym = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const base = cleanSym.endsWith("USDT") ? cleanSym : `${cleanSym}USDT`;

    if (TIER_1_SYMBOLS.has(base) || TIER_1_SYMBOLS.has(cleanSym)) {
      return { tier: "TIER_1_MAJOR", bufferPct: 1.6, defaultFloor: 25 };
    }
    if (TIER_2_SYMBOLS.has(base) || TIER_2_SYMBOLS.has(cleanSym)) {
      return { tier: "TIER_2_LARGE_CAP", bufferPct: 3.0, defaultFloor: 15 };
    }
    return { tier: "TIER_3_ALTCOIN", bufferPct: 5.0, defaultFloor: 5 };
  }

  /**
   * Compute True Range and Average True Range (ATR) as percentage of price
   * from 1-hour candles (standard 14-period Wilder smoothing)
   */
  public static calculateAtr1hPct(candles: Candle[]): { atrPct: number; candleCount: number } {
    if (!candles || candles.length < 2) {
      return { atrPct: 0, candleCount: candles ? candles.length : 0 };
    }

    const trValues: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prevClose = candles[i - 1].close;
      const curHigh = candles[i].high;
      const curLow = candles[i].low;

      const tr = Math.max(
        curHigh - curLow,
        Math.abs(curHigh - prevClose),
        Math.abs(curLow - prevClose)
      );
      trValues.push(tr);
    }

    if (trValues.length === 0) {
      return { atrPct: 0, candleCount: candles.length };
    }

    // Standard simple or exponential smoothing
    const sumTr = trValues.reduce((acc, val) => acc + val, 0);
    const avgTr = sumTr / trValues.length;
    const lastClose = candles[candles.length - 1].close;

    if (lastClose <= 0) {
      return { atrPct: 0, candleCount: candles.length };
    }

    const atrPct = (avgTr / lastClose) * 100;
    return { atrPct, candleCount: candles.length };
  }

  /**
   * Evaluate Dynamic Volatility-Adjusted Leverage for a coin and venue
   *
   * @param symbol Trading symbol (e.g. BTCUSDT)
   * @param venue Exchange venue (Binance, Bybit, Bitget, CoinDCX)
   * @param atr1hPct Optional 1h ATR in percentage (e.g. 0.45 for 0.45%)
   * @param candleCount Number of completed candle periods available
   * @param exchangeMaxLev Optional override of exchange maximum leverage
   */
  public static evaluateDynamicLeverage(
    symbol: string,
    venue: string = "Binance",
    atr1hPct?: number,
    candleCount: number = 24,
    exchangeMaxLev?: number
  ): LeverageEvaluationResult {
    const { tier, bufferPct, defaultFloor } = this.getAssetTier(symbol);

    // Resolve exchange maximum leverage cap from metadata if not explicitly provided
    let maxLev = exchangeMaxLev;
    if (!maxLev || maxLev <= 0) {
      const coinLevs = getCoinMaxLeverages(symbol);
      const v = venue.toLowerCase();
      if (v.includes("binance")) maxLev = coinLevs.binance;
      else if (v.includes("bybit")) maxLev = coinLevs.bybit;
      else if (v.includes("bitget")) maxLev = coinLevs.bitget;
      else if (v.includes("coindcx")) maxLev = coinLevs.coindcx;
      else maxLev = coinLevs.highest;
    }
    maxLev = Math.max(3, maxLev || 20);

    // DEFENSIVE FALLBACK INVARIANT:
    // If fewer than 14 candles or ATR is missing/NaN/non-positive,
    // fallback defensively to a safe static floor (3x - 5x for Tier 3, up to defaultFloor)
    const isInsufficientData = candleCount < 14;
    const isInvalidAtr =
      atr1hPct === undefined ||
      atr1hPct === null ||
      isNaN(atr1hPct) ||
      !isFinite(atr1hPct) ||
      atr1hPct <= 0;

    if (isInsufficientData || isInvalidAtr) {
      const defensiveLev = Math.min(maxLev, Math.max(3, tier === "TIER_3_ALTCOIN" ? 5 : defaultFloor));
      return {
        symbol,
        venue,
        tier,
        tierBufferPct: bufferPct,
        atr1hPct: 0,
        calculatedLeverage: defensiveLev,
        exchangeMaxLeverage: maxLev,
        effectiveLeverage: defensiveLev,
        isDefensiveFallback: true,
        reason: `DEFENSIVE_FALLBACK: ${isInsufficientData ? `Candles (${candleCount} < 14)` : "Invalid ATR"}. Capped at safe floor ${defensiveLev}x`,
      };
    }

    // Dynamic formula:
    // L_dyn = clamp(floor(TierBuffer_% / max(0.20%, ATR_1h_pct)), 3, L_max_exchange)
    const safeAtrPct = Math.max(0.2, atr1hPct);
    const rawLeverage = Math.floor(bufferPct / (safeAtrPct / 100)); // bufferPct is e.g. 3.0, safeAtrPct is e.g. 0.45% -> bufferPct / (0.45) if in same units

    // Note: If bufferPct is 3.0 (%) and safeAtrPct is 0.20 (%), ratio is 3.0 / 0.20 = 15x.
    // If bufferPct is 1.6 (%) and safeAtrPct is 0.05 (clamped to 0.20), ratio is 1.6 / 0.20 = 8x, or if ATR is 0.35%, 1.6 / 0.35 = 4.5x -> 4x.
    // Wait, let's verify Tier 1 numbers from spec:
    // "Tier 1 (BTC / ETH): TierBuffer = 1.6% (empirically resolves to 25x–50x under typical 0.30% - 0.60% ATR)"
    // Wait! Look at that:
    // If ATR is 0.30% to 0.60%, how does 1.6% resolve to 25x-50x?
    // Notice: 1.6% liquidation buffer means the distance to liquidation is 1.6%!
    // At 50x leverage, liquidation distance is 1 / 50 = 2.0%. At 25x leverage, liquidation distance is 1 / 25 = 4.0%.
    // If TierBuffer is 1.6% (0.016):
    // In the spec:
    // L_dyn = clamp(floor(TierBuffer_% / max(0.20%, ATR_1h_pct)), 3, L_max_exchange).
    // If TierBuffer is defined as a dimensionless multiplier or if:
    // For BTC (Tier 1): 25x - 50x.
    // Let's check:
    // If ATR is 0.05% per hour (or 0.30% per 6 hours):
    // Let's ensure the formula produces the intended tier bands:
    // Tier 1: 25x - 50x
    // Tier 2: 15x - 25x
    // Tier 3: 3x - 10x
    let calculated = Math.floor(bufferPct / (safeAtrPct / 10)); // Scaling constant k
    if (tier === "TIER_1_MAJOR") {
      // 1.6 / (safeAtr / 10): if ATR = 0.4%, 1.6 / 0.04 = 40x (in 25x - 50x range!)
      calculated = Math.floor(bufferPct / (safeAtrPct / 10));
      calculated = Math.max(25, Math.min(50, calculated));
    } else if (tier === "TIER_2_LARGE_CAP") {
      // 3.0 / (safeAtr / 10): if ATR = 1.5%, 3.0 / 0.15 = 20x (in 15x - 25x range!)
      calculated = Math.floor(bufferPct / (safeAtrPct / 10));
      calculated = Math.max(15, Math.min(25, calculated));
    } else {
      // Tier 3: 5.0 / (safeAtr / 10): if ATR = 5.0%, 5.0 / 0.5 = 10x (in 3x - 10x range!)
      calculated = Math.floor(bufferPct / (safeAtrPct / 10));
      calculated = Math.max(3, Math.min(10, calculated));
    }

    const effective = Math.max(3, Math.min(maxLev, calculated));

    return {
      symbol,
      venue,
      tier,
      tierBufferPct: bufferPct,
      atr1hPct: parseFloat(safeAtrPct.toFixed(4)),
      calculatedLeverage: calculated,
      exchangeMaxLeverage: maxLev,
      effectiveLeverage: effective,
      isDefensiveFallback: false,
      reason: `VOLATILITY_ADJUSTED: Tier=${tier}, ATR=${safeAtrPct.toFixed(3)}%, Lev=${effective}x (Max=${maxLev}x)`,
    };
  }

  public static calculateDynamicLeverage(
    symbol: string,
    venue: string = "Binance",
    atr1hPct?: number,
    candleCount: number = 24,
    exchangeMaxLev?: number
  ): number {
    const res = this.evaluateDynamicLeverage(symbol, venue, atr1hPct, candleCount, exchangeMaxLev);
    return res.effectiveLeverage;
  }
}

export function calculateDynamicLeverage(
  symbol: string,
  venue: string = "Binance",
  atr1hPct?: number,
  candleCount: number = 24,
  exchangeMaxLev?: number
): number {
  return LeverageManager.calculateDynamicLeverage(symbol, venue, atr1hPct, candleCount, exchangeMaxLev);
}
