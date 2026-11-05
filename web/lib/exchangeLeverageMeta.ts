/**
 * Exchange Coin Leverage Metadata & Asymmetric Margin Balancing Engine
 * Provides authentic exchange leverage limits across Binance, Bitget, CoinDCX, and Bybit,
 * along with institutional mathematical formulas for 1:1 delta-neutral hedging.
 */

export interface CoinLeverageTier {
  binance: number;
  bitget: number;
  coindcx: number;
  bybit: number;
}

export interface CoinLeverageSummary {
  symbol: string;
  binance: number;
  bitget: number;
  coindcx: number;
  bybit: number;
  highest: number;
  highestExchange: "Binance" | "Bitget" | "CoinDCX" | "Bybit";
}

// Institutional Coin-Specific Leverage Caps (Safe Live Limits)
const TIER_1_MAJORS: Record<string, CoinLeverageTier> = {
  BTCUSDT: { binance: 50, bitget: 50, coindcx: 20, bybit: 50 },
  ETHUSDT: { binance: 50, bitget: 50, coindcx: 20, bybit: 50 },
};

const TIER_2_LARGE_CAPS: Record<string, CoinLeverageTier> = {
  SOLUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  DOGEUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  XRPUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  BNBUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  LTCUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  BCHUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  ADAUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  AVAXUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  LINKUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  DOTUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  NEARUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  SUIUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  APTUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  ARBUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  OPUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  TIAUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
  INJUSDT: { binance: 50, bitget: 50, coindcx: 15, bybit: 50 },
};

const TIER_3_MID_CAPS: Record<string, CoinLeverageTier> = {
  FETUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  RENDERUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  PEPEUSDT: { binance: 50, bitget: 50, coindcx: 10, bybit: 50 },
  SHIBUSDT: { binance: 50, bitget: 50, coindcx: 10, bybit: 50 },
  WLDUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  GALAUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  FILUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  ATOMUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  UNIUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  ETCUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  ICPUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  STXUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  SEIUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  FTMUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  RUNEUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  KASUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  ENAUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  WUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  ONDOUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  ORDIUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
  BONKUSDT: { binance: 50, bitget: 50, coindcx: 10, bybit: 50 },
  FLOKIUSDT: { binance: 25, bitget: 25, coindcx: 10, bybit: 25 },
};

const DEFAULT_FALLBACK_TIER: CoinLeverageTier = {
  binance: 20,
  bitget: 20,
  coindcx: 10,
  bybit: 20,
};

/**
 * Retrieve maximum leverage across all four exchanges for any coin symbol.
 */
export function getCoinMaxLeverages(sym?: string): CoinLeverageSummary {
  const upper = String(sym || "BTCUSDT").toUpperCase().trim();
  const normalized = upper.endsWith("USDT") ? upper : `${upper}USDT`;

  let tier: CoinLeverageTier = DEFAULT_FALLBACK_TIER;

  if (TIER_1_MAJORS[normalized]) {
    tier = TIER_1_MAJORS[normalized];
  } else if (TIER_2_LARGE_CAPS[normalized]) {
    tier = TIER_2_LARGE_CAPS[normalized];
  } else if (TIER_3_MID_CAPS[normalized]) {
    tier = TIER_3_MID_CAPS[normalized];
  }

  // Find highest available leverage
  const exchanges: Array<{ name: "Binance" | "Bitget" | "CoinDCX" | "Bybit"; lev: number }> = [
    { name: "Binance", lev: tier.binance },
    { name: "Bitget", lev: tier.bitget },
    { name: "Bybit", lev: tier.bybit },
    { name: "CoinDCX", lev: tier.coindcx },
  ];

  let highest = tier.binance;
  let highestExchange: "Binance" | "Bitget" | "CoinDCX" | "Bybit" = "Binance";

  for (const ex of exchanges) {
    if (ex.lev > highest) {
      highest = ex.lev;
      highestExchange = ex.name;
    }
  }

  return {
    symbol: normalized,
    binance: tier.binance,
    bitget: tier.bitget,
    coindcx: tier.coindcx,
    bybit: tier.bybit,
    highest,
    highestExchange,
  };
}

/**
 * Mode 1: Single-Leg Margin Matcher
 * Given margin placed on Exchange A with leverage L_A,
 * calculates required margin on Exchange B with leverage L_B to achieve equal notional.
 */
export interface SingleLegMatchResult {
  inputVenue: "A" | "B";
  marginA: number;
  marginB: number;
  totalMargin: number;
  matchedNotional: number;
  leverageA: number;
  leverageB: number;
  disparityRatio: number;
}

export function calculateSingleLegMatch(
  inputMargin: number,
  inputVenue: "A" | "B",
  levA: number,
  levB: number
): SingleLegMatchResult {
  const safeMargin = Math.max(0, inputMargin);
  const safeLevA = Math.max(1, levA);
  const safeLevB = Math.max(1, levB);

  let marginA = 0;
  let marginB = 0;
  let matchedNotional = 0;

  if (inputVenue === "A") {
    marginA = safeMargin;
    matchedNotional = marginA * safeLevA;
    marginB = matchedNotional / safeLevB;
  } else {
    marginB = safeMargin;
    matchedNotional = marginB * safeLevB;
    marginA = matchedNotional / safeLevA;
  }

  const totalMargin = marginA + marginB;
  const disparityRatio = Math.max(safeLevA, safeLevB) / Math.min(safeLevA, safeLevB);

  return {
    inputVenue,
    marginA,
    marginB,
    totalMargin,
    matchedNotional,
    leverageA: safeLevA,
    leverageB: safeLevB,
    disparityRatio,
  };
}

/**
 * Mode 2: Auto-Split Total Budget
 * Given a total capital budget C, automatically splits into marginA and marginB
 * such that marginA + marginB = C and marginA * levA = marginB * levB (1:1 equal notional).
 */
export interface AutoSplitResult {
  totalBudget: number;
  marginA: number;
  marginB: number;
  totalMargin: number;
  matchedNotional: number;
  leverageA: number;
  leverageB: number;
  disparityRatio: number;
}

export function calculateAutoSplit(
  totalBudget: number,
  levA: number,
  levB: number
): AutoSplitResult {
  const safeBudget = Math.max(0, totalBudget);
  const safeLevA = Math.max(1, levA);
  const safeLevB = Math.max(1, levB);

  // M_A = C * L_B / (L_A + L_B)
  // M_B = C * L_A / (L_A + L_B)
  const sumLev = safeLevA + safeLevB;
  const marginA = safeBudget * (safeLevB / sumLev);
  const marginB = safeBudget * (safeLevA / sumLev);

  const matchedNotional = marginA * safeLevA; // exactly equals marginB * safeLevB
  const totalMargin = marginA + marginB;
  const disparityRatio = Math.max(safeLevA, safeLevB) / Math.min(safeLevA, safeLevB);

  return {
    totalBudget: safeBudget,
    marginA,
    marginB,
    totalMargin,
    matchedNotional,
    leverageA: safeLevA,
    leverageB: safeLevB,
    disparityRatio,
  };
}
