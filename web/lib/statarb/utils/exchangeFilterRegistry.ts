/**
 * STATARB-OU-PERP: Authoritative Exchange Filter Registry & Lot Size Reconciler
 * 
 * Provides static authoritative specifications for tick sizes, step sizes, minimum quantities,
 * and minimum notional values across Binance USD-M Perpetuals and Bybit Linear Perpetuals.
 * 
 * Reconciles dual-leg order sizing using discrete lot quantum math:
 *   E_quantum = LCM(S1 * M1, S2 * M2)
 * Ensuring Leg 2 is an exact multiple of S2, |Delta_net| < 0.001, and notional >= $5.00 USDT.
 * 
 * 100% standalone with zero external network dependencies.
 */

import {
  getInstrumentMapping,
  resolveCanonicalSymbol,
  normalizeQuantity,
} from './contractMapper';

export interface SymbolFilterSpec {
  symbol: string;
  venue: 'BINANCE' | 'BYBIT';
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number; // Institutional minimum: $5.00 USDT
  priceDecimals: number;
  qtyDecimals: number;
  contractMultiplier?: number;
}

export interface ReconciledDualLegQuantities {
  valid: boolean;
  leg1Qty: number;
  leg2Qty: number;
  leg1Notional: number;
  leg2Notional: number;
  rejectionReason?: string;
}

/**
 * Authoritative Static Filter Catalog for:
 * 1. All 15 Core Corridor Pairs: BTC, ETH, SOL, PEPE, SATS, NEAR, SUI, AVAX, DOGE, ARB, OP, LINK, APT, XRP, ADA
 * 2. Top Meme & Asymmetric Multiplier Coins: TURBO, BABYDOGE, BONK, SHIB, FLOKI, RATS, LUNC, XEC, SIMONS_CAT
 */
const AUTHORITATIVE_FILTERS: SymbolFilterSpec[] = [
  // --- 1. BTC ---
  { symbol: 'BTCUSDT', venue: 'BINANCE', tickSize: 0.10, stepSize: 0.001, minQty: 0.001, minNotional: 5.0, priceDecimals: 1, qtyDecimals: 3, contractMultiplier: 1 },
  { symbol: 'BTCUSDT', venue: 'BYBIT', tickSize: 0.10, stepSize: 0.001, minQty: 0.001, minNotional: 5.0, priceDecimals: 1, qtyDecimals: 3, contractMultiplier: 1 },

  // --- 2. ETH ---
  { symbol: 'ETHUSDT', venue: 'BINANCE', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5.0, priceDecimals: 2, qtyDecimals: 3, contractMultiplier: 1 },
  { symbol: 'ETHUSDT', venue: 'BYBIT', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5.0, priceDecimals: 2, qtyDecimals: 3, contractMultiplier: 1 },

  // --- 3. SOL ---
  { symbol: 'SOLUSDT', venue: 'BINANCE', tickSize: 0.01, stepSize: 0.01, minQty: 0.01, minNotional: 5.0, priceDecimals: 2, qtyDecimals: 2, contractMultiplier: 1 },
  { symbol: 'SOLUSDT', venue: 'BYBIT', tickSize: 0.01, stepSize: 0.01, minQty: 0.01, minNotional: 5.0, priceDecimals: 2, qtyDecimals: 2, contractMultiplier: 1 },

  // --- 4. PEPE (1000PEPEUSDT) ---
  { symbol: '1000PEPEUSDT', venue: 'BINANCE', tickSize: 0.0000010, stepSize: 100, minQty: 100, minNotional: 5.0, priceDecimals: 7, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000PEPEUSDT', venue: 'BYBIT', tickSize: 0.0000010, stepSize: 100, minQty: 100, minNotional: 5.0, priceDecimals: 7, qtyDecimals: 0, contractMultiplier: 1000 },

  // --- 5. SATS (Binance 1000SATS vs Bybit 10000SATS) ---
  { symbol: '1000SATSUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '10000SATSUSDT', venue: 'BYBIT', tickSize: 0.0001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 0, contractMultiplier: 10000 },

  // --- 6. NEAR ---
  { symbol: 'NEARUSDT', venue: 'BINANCE', tickSize: 0.001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 3, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'NEARUSDT', venue: 'BYBIT', tickSize: 0.001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 3, qtyDecimals: 1, contractMultiplier: 1 },

  // --- 7. SUI ---
  { symbol: 'SUIUSDT', venue: 'BINANCE', tickSize: 0.0001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 1, contractMultiplier: 1 },
  { symbol: 'SUIUSDT', venue: 'BYBIT', tickSize: 0.0001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 0, contractMultiplier: 1 },

  // --- 8. AVAX ---
  { symbol: 'AVAXUSDT', venue: 'BINANCE', tickSize: 0.01, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 2, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'AVAXUSDT', venue: 'BYBIT', tickSize: 0.01, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 2, qtyDecimals: 1, contractMultiplier: 1 },

  // --- 9. DOGE ---
  { symbol: 'DOGEUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'DOGEUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },

  // --- 10. ARB ---
  { symbol: 'ARBUSDT', venue: 'BINANCE', tickSize: 0.0001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 1, contractMultiplier: 1 },
  { symbol: 'ARBUSDT', venue: 'BYBIT', tickSize: 0.0001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 1, contractMultiplier: 1 },

  // --- 11. OP ---
  { symbol: 'OPUSDT', venue: 'BINANCE', tickSize: 0.0001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 1, contractMultiplier: 1 },
  { symbol: 'OPUSDT', venue: 'BYBIT', tickSize: 0.0001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 1, contractMultiplier: 1 },

  // --- 12. LINK ---
  { symbol: 'LINKUSDT', venue: 'BINANCE', tickSize: 0.001, stepSize: 0.01, minQty: 0.01, minNotional: 5.0, priceDecimals: 3, qtyDecimals: 2, contractMultiplier: 1 },
  { symbol: 'LINKUSDT', venue: 'BYBIT', tickSize: 0.001, stepSize: 0.01, minQty: 0.01, minNotional: 5.0, priceDecimals: 3, qtyDecimals: 2, contractMultiplier: 1 },

  // --- 13. APT ---
  { symbol: 'APTUSDT', venue: 'BINANCE', tickSize: 0.001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 3, qtyDecimals: 1, contractMultiplier: 1 },
  { symbol: 'APTUSDT', venue: 'BYBIT', tickSize: 0.001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 3, qtyDecimals: 1, contractMultiplier: 1 },

  // --- 14. XRP ---
  { symbol: 'XRPUSDT', venue: 'BINANCE', tickSize: 0.0001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 1, contractMultiplier: 1 },
  { symbol: 'XRPUSDT', venue: 'BYBIT', tickSize: 0.0001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 0, contractMultiplier: 1 },

  // --- 15. ADA ---
  { symbol: 'ADAUSDT', venue: 'BINANCE', tickSize: 0.0001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'ADAUSDT', venue: 'BYBIT', tickSize: 0.0001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 4, qtyDecimals: 0, contractMultiplier: 1 },

  // --- TOP MEME COINS & ASYMMETRIC MULTIPLIERS ---

  // TURBO (Binance 1x vs Bybit 1000x)
  { symbol: 'TURBOUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: '1000TURBOUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },

  // BABYDOGE (Binance 1MBABYDOGE vs Bybit 1000000BABYDOGE)
  { symbol: '1MBABYDOGEUSDT', venue: 'BINANCE', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000000 },
  { symbol: '1000000BABYDOGEUSDT', venue: 'BYBIT', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000000 },

  // BONK (1000BONK on both)
  { symbol: '1000BONKUSDT', venue: 'BINANCE', tickSize: 0.000001, stepSize: 100, minQty: 100, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000BONKUSDT', venue: 'BYBIT', tickSize: 0.000001, stepSize: 100, minQty: 100, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },

  // SHIB (1000SHIB on both)
  { symbol: '1000SHIBUSDT', venue: 'BINANCE', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000SHIBUSDT', venue: 'BYBIT', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },

  // FLOKI (1000FLOKI on both)
  { symbol: '1000FLOKIUSDT', venue: 'BINANCE', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000FLOKIUSDT', venue: 'BYBIT', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },

  // RATS (1000RATS on both)
  { symbol: '1000RATSUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000RATSUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },

  // LUNC (1000LUNC on both)
  { symbol: '1000LUNCUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000LUNCUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },

  // XEC (1000XEC on both)
  { symbol: '1000XECUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 10, minQty: 10, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000XECUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 10, minQty: 10, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1000 },

  // SIMONS_CAT (1000CAT on both)
  { symbol: '1000CATUSDT', venue: 'BINANCE', tickSize: 0.000001, stepSize: 10, minQty: 10, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },
  { symbol: '1000CATUSDT', venue: 'BYBIT', tickSize: 0.000001, stepSize: 10, minQty: 10, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1000 },

  // Dislocated Altcoins (Empirically Calibrated)
  // ERA
  { symbol: 'ERAUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'ERAUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },

  // LSK
  { symbol: 'LSKUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'LSKUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 0.1, minQty: 0.1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 1, contractMultiplier: 1 },

  // HUMA
  { symbol: 'HUMAUSDT', venue: 'BINANCE', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'HUMAUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },

  // BIRB
  { symbol: 'BIRBUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'BIRBUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },

  // WLFI
  { symbol: 'WLFIUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'WLFIUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },

  // SOPH
  { symbol: 'SOPHUSDT', venue: 'BINANCE', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'SOPHUSDT', venue: 'BYBIT', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },

  // BMT
  { symbol: 'BMTUSDT', venue: 'BINANCE', tickSize: 0.00001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 5, qtyDecimals: 0, contractMultiplier: 1 },
  { symbol: 'BMTUSDT', venue: 'BYBIT', tickSize: 0.000001, stepSize: 1, minQty: 1, minNotional: 5.0, priceDecimals: 6, qtyDecimals: 0, contractMultiplier: 1 },
];

/**
 * In-memory index keyed by `${venue}:${symbol}` and `${venue}:${canonical}`
 */
const FILTER_INDEX = new Map<string, SymbolFilterSpec>();

function registerFilter(filter: SymbolFilterSpec): void {
  const symbolKey = `${filter.venue}:${filter.symbol.toUpperCase().trim()}`;
  FILTER_INDEX.set(symbolKey, filter);

  // Also index by canonical identifier
  const canonical = resolveCanonicalSymbol(filter.symbol);
  if (canonical) {
    const canonicalKey = `${filter.venue}:${canonical.toUpperCase().trim()}`;
    if (!FILTER_INDEX.has(canonicalKey)) {
      FILTER_INDEX.set(canonicalKey, filter);
    }
  }
}

// Populate the lookup index
for (const spec of AUTHORITATIVE_FILTERS) {
  registerFilter(spec);
}

/**
 * Public function to register or override a SymbolFilterSpec dynamically.
 */
export function registerSymbolFilter(spec: SymbolFilterSpec): void {
  registerFilter(spec);
}

/**
 * Returns the SymbolFilterSpec for a given venue and symbol (venue-specific or canonical).
 * Falls back to institutional safety defaults ($5.00 USDT minNotional) if uncatalogued.
 */
export function getSymbolFilter(
  venue: 'BINANCE' | 'BYBIT',
  symbol: string
): SymbolFilterSpec {
  if (!symbol) {
    return {
      symbol: '',
      venue,
      tickSize: 0.0001,
      stepSize: 1,
      minQty: 1,
      minNotional: 5.0,
      priceDecimals: 4,
      qtyDecimals: 0,
      contractMultiplier: 1,
    };
  }

  const clean = symbol.toUpperCase().trim();
  const directKey = `${venue}:${clean}`;
  const directMatch = FILTER_INDEX.get(directKey);
  if (directMatch) {
    return directMatch;
  }

  // Try resolving canonical symbol
  const canonical = resolveCanonicalSymbol(clean);
  if (canonical) {
    const canonicalKey = `${venue}:${canonical}`;
    const canonicalMatch = FILTER_INDEX.get(canonicalKey);
    if (canonicalMatch) {
      return canonicalMatch;
    }
  }

  // Dynamic fallback for uncatalogued crypto instruments
  return {
    symbol: clean,
    venue,
    tickSize: 0.0001,
    stepSize: 1,
    minQty: 1,
    minNotional: 5.0,
    priceDecimals: 4,
    qtyDecimals: 0,
    contractMultiplier: 1,
  };
}

/**
 * Rounds price to the exchange's tickSize.
 * When side is 'BUY', floors price so maker limit order does not cross the book.
 * When side is 'SELL', ceils price so maker limit order does not cross the book.
 * When side is omitted, rounds to nearest tickSize.
 */
export function roundPrice(
  price: number,
  tickSize: number,
  side?: 'BUY' | 'SELL'
): number {
  if (price <= 0 || !Number.isFinite(price)) return 0;
  if (tickSize <= 0 || !Number.isFinite(tickSize)) return price;

  let decimals = 0;
  const tickStr = tickSize.toString();
  if (tickStr.includes('e-')) {
    decimals = parseInt(tickStr.split('e-')[1], 10);
  } else if (tickStr.includes('.')) {
    decimals = tickStr.split('.')[1].length;
  }
  const precision = Math.min(12, Math.max(0, decimals));

  let rounded: number;
  if (side === 'BUY') {
    rounded = Math.floor(price / tickSize + 1e-12) * tickSize;
  } else if (side === 'SELL') {
    rounded = Math.ceil(price / tickSize - 1e-12) * tickSize;
  } else {
    rounded = Math.round(price / tickSize) * tickSize;
  }

  return parseFloat(rounded.toFixed(precision));
}

/**
 * Floors quantity to the exchange's stepSize without floating point artifacts.
 */
export function roundQuantity(qty: number, stepSize: number): number {
  if (qty <= 0 || !Number.isFinite(qty)) return 0;
  if (stepSize <= 0 || !Number.isFinite(stepSize)) return qty;

  let decimals = 0;
  const stepStr = stepSize.toString();
  if (stepStr.includes('e-')) {
    decimals = parseInt(stepStr.split('e-')[1], 10);
  } else if (stepStr.includes('.')) {
    decimals = stepStr.split('.')[1].length;
  }
  const precision = Math.min(12, Math.max(0, decimals));

  const quantized = Math.floor(qty / stepSize + 1e-12) * stepSize;
  return parseFloat(quantized.toFixed(precision));
}

/**
 * Calculates Greatest Common Divisor of two integers
 */
function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Returns decimal precision of a number
 */
function getDecimals(num: number): number {
  if (!num || Math.floor(num) === num) return 0;
  const str = num.toString();
  if (str.includes('e-')) {
    return parseInt(str.split('e-')[1], 10);
  }
  if (str.includes('.')) {
    return str.split('.')[1].length;
  }
  return 0;
}

/**
 * Resolves contract multiplier for a given venue and canonical symbol.
 */
function getVenueMultiplier(venue: 'BINANCE' | 'BYBIT', canonical: string): number {
  const mapping = getInstrumentMapping(canonical);
  if (!mapping) return 1;
  const clean = canonical.toUpperCase().trim();
  const filter = getSymbolFilter(venue, clean);
  if (filter.contractMultiplier && filter.contractMultiplier > 0) {
    return filter.contractMultiplier;
  }
  if (venue === 'BYBIT' && mapping.multiplier) {
    return mapping.multiplier;
  }
  return 1;
}

/**
 * Pre-flight dual-leg order sizing using discrete lot quantum math:
 *   E_base, quantum = LCM(S1 * M1, S2 * M2)
 * 
 * Guarantee:
 * - Leg 1 qty is an exact integer multiple of S1
 * - Leg 2 qty is an exact integer multiple of S2
 * - Base token exposures are strictly equal: |Delta_net| < 0.001
 * - Both legs have notional >= $5.00 USDT
 */
export function reconcileDualLegQuantities(
  targetNotional: number,
  price1: number,
  price2: number,
  venue1: 'BINANCE' | 'BYBIT',
  venue2: 'BINANCE' | 'BYBIT',
  canonical: string
): ReconciledDualLegQuantities {
  // 1. Pre-flight minimum notional requirement
  if (targetNotional < 5.0) {
    return {
      valid: false,
      leg1Qty: 0,
      leg2Qty: 0,
      leg1Notional: 0,
      leg2Notional: 0,
      rejectionReason: `MIN_NOTIONAL_VIOLATION: Target notional $${targetNotional.toFixed(2)} is below exchange minimum of $5.00 USDT`,
    };
  }

  if (price1 <= 0 || price2 <= 0 || !Number.isFinite(price1) || !Number.isFinite(price2)) {
    return {
      valid: false,
      leg1Qty: 0,
      leg2Qty: 0,
      leg1Notional: 0,
      leg2Notional: 0,
      rejectionReason: `INVALID_PRICES: Execution prices must be positive and finite (P1=${price1}, P2=${price2})`,
    };
  }

  const cleanCanonical = resolveCanonicalSymbol(canonical) || canonical.toUpperCase().trim();
  const filter1 = getSymbolFilter(venue1, cleanCanonical);
  const filter2 = getSymbolFilter(venue2, cleanCanonical);

  const M1 = getVenueMultiplier(venue1, cleanCanonical);
  const M2 = getVenueMultiplier(venue2, cleanCanonical);

  const S1 = filter1.stepSize;
  const S2 = filter2.stepSize;

  // Base token exposure per single contract step on each venue
  const E1 = S1 * M1;
  const E2 = S2 * M2;

  // Compute LCM of E1 and E2 using integer scaling
  const maxDecimals = Math.max(getDecimals(E1), getDecimals(E2), 0);
  const scaleFactor = Math.pow(10, Math.min(10, maxDecimals));
  const I1 = Math.round(E1 * scaleFactor);
  const I2 = Math.round(E2 * scaleFactor);

  const g = gcd(I1, I2);
  const lcmInt = (I1 / g) * I2;
  const E_quantum = lcmInt / scaleFactor;

  // Quanta in contract units for each venue
  const Q1_quantum = E_quantum / M1;
  const Q2_quantum = E_quantum / M2;

  // Notional per quantum
  const notionalQuantum1 = Q1_quantum * price1;
  const notionalQuantum2 = Q2_quantum * price2;
  const avgNotionalQuantum = (notionalQuantum1 + notionalQuantum2) / 2;

  if (avgNotionalQuantum <= 0) {
    return {
      valid: false,
      leg1Qty: 0,
      leg2Qty: 0,
      leg1Notional: 0,
      leg2Notional: 0,
      rejectionReason: 'CALCULATION_ERROR: Average quantum notional is non-positive',
    };
  }

  // Determine integer multiple k of discrete lot quanta
  let k = Math.floor(targetNotional / avgNotionalQuantum);

  // If k = 0, check if 1 quantum is within reasonable proximity of targetNotional
  if (k < 1) {
    if (Math.max(notionalQuantum1, notionalQuantum2) <= Math.max(targetNotional * 1.5, 10.0)) {
      k = 1;
    } else {
      return {
        valid: false,
        leg1Qty: 0,
        leg2Qty: 0,
        leg1Notional: 0,
        leg2Notional: 0,
        rejectionReason: `MIN_NOTIONAL_VIOLATION: Single lot quantum notional ($${avgNotionalQuantum.toFixed(2)}) exceeds target ($${targetNotional.toFixed(2)})`,
      };
    }
  }

  // Ensure k satisfies minNotional on both venues (min $5.00 USDT)
  const minRequiredNotional1 = Math.max(filter1.minNotional ?? 5.0, 5.0);
  const minRequiredNotional2 = Math.max(filter2.minNotional ?? 5.0, 5.0);

  const minK1 = Math.ceil(minRequiredNotional1 / notionalQuantum1);
  const minK2 = Math.ceil(minRequiredNotional2 / notionalQuantum2);
  const minRequiredK = Math.max(minK1, minK2, 1);

  if (k < minRequiredK) {
    if (minRequiredK * avgNotionalQuantum <= targetNotional * 2.0) {
      k = minRequiredK;
    } else {
      return {
        valid: false,
        leg1Qty: 0,
        leg2Qty: 0,
        leg1Notional: k * notionalQuantum1,
        leg2Notional: k * notionalQuantum2,
        rejectionReason: `MIN_NOTIONAL_VIOLATION: Cannot fulfill minimum $5.00 USDT without exceeding 2.0x target notional`,
      };
    }
  }

  // Ensure k satisfies minQty on both venues
  if (filter1.minQty && k * Q1_quantum < filter1.minQty) {
    const minKQty1 = Math.ceil(filter1.minQty / Q1_quantum);
    k = Math.max(k, minKQty1);
  }
  if (filter2.minQty && k * Q2_quantum < filter2.minQty) {
    const minKQty2 = Math.ceil(filter2.minQty / Q2_quantum);
    k = Math.max(k, minKQty2);
  }

  const finalLeg1Qty = roundQuantity(k * Q1_quantum, filter1.stepSize);
  const finalLeg2Qty = roundQuantity(k * Q2_quantum, filter2.stepSize);

  const finalLeg1Notional = parseFloat((finalLeg1Qty * price1).toFixed(4));
  const finalLeg2Notional = parseFloat((finalLeg2Qty * price2).toFixed(4));

  // Final verification of minNotional ($5.00 USDT)
  if (finalLeg1Notional < minRequiredNotional1 || finalLeg2Notional < minRequiredNotional2) {
    return {
      valid: false,
      leg1Qty: finalLeg1Qty,
      leg2Qty: finalLeg2Qty,
      leg1Notional: finalLeg1Notional,
      leg2Notional: finalLeg2Notional,
      rejectionReason: `MIN_NOTIONAL_VIOLATION: Sized notional (L1=$${finalLeg1Notional}, L2=$${finalLeg2Notional}) below required minimum $5.00 USDT`,
    };
  }

  // Verify delta neutrality
  const baseExposure1 = finalLeg1Qty * M1;
  const baseExposure2 = finalLeg2Qty * M2;
  const netDeltaInL1Contracts = Math.abs(baseExposure1 - baseExposure2) / M1;

  if (netDeltaInL1Contracts > 0.001) {
    return {
      valid: false,
      leg1Qty: finalLeg1Qty,
      leg2Qty: finalLeg2Qty,
      leg1Notional: finalLeg1Notional,
      leg2Notional: finalLeg2Notional,
      rejectionReason: `DELTA_NEUTRALITY_VIOLATION: Net delta |Delta_net| = ${netDeltaInL1Contracts.toFixed(6)} > 0.001`,
    };
  }

  return {
    valid: true,
    leg1Qty: finalLeg1Qty,
    leg2Qty: finalLeg2Qty,
    leg1Notional: finalLeg1Notional,
    leg2Notional: finalLeg2Notional,
  };
}
