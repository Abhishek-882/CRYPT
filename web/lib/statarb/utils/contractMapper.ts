/**
 * STATARB-OU-PERP: Cross-Exchange Contract & Multiplier Normalizer
 * 
 * Maps canonical instrument symbols across Binance USD-M Perpetuals and Bybit Linear Perpetuals.
 * Normalizes meme coin multiplier differences (e.g. 1000SATS vs 10000SATS, 1000CAT, 1000PEPE)
 * and strictly isolates TradFi stocks/commodities to prevent phantom pricing disparities.
 * 
 * 100% standalone with zero imports from legacy bot engines.
 */

import { InstrumentMapping } from '../types';

/**
 * TradFi Equities, Commodities, and Index ETFs listed on Binance or Bybit
 * that must be excluded from crypto statistical arbitrage.
 */
export const TRADFI_EXCLUSION_SET: ReadonlySet<string> = new Set([
  'CATUSDT', // Caterpillar Inc. Stock (Binance) - Distinct from 1000CATUSDT Simon's Cat!
  'EBAYUSDT',
  'AMCUSDT',
  'PFEUSDT',
  'SKHYNIXUSDT',
  'HYUNDAIUSDT',
  'SAMSUNGUSDT',
  'TSLAUSDT',
  'NVDAUSDT',
  'AAPLUSDT',
  'MSFTUSDT',
  'AMZNUSDT',
  'GOOGLUSDT',
  'METAUSDT',
  'COINUSDT',
  'MSTRUSDT',
  'SPYUSDT',
  'QQQUSDT',
  'BXUSDT',
  'EQTUSDT',
  'CIENUSDT',
  'DDOGUSDT',
  'BONDUSDT',
  'XAUUSDT', // Gold
  'XAGUSDT', // Silver
  'COPPERUSDT',
  'CLUSDT', // Crude Oil
  'BZUSDT', // Brent Crude Oil
  'NATGASUSDT',
  'XPTUSDT',
  'XPDUSDT',
]);

/**
 * Detailed specification of special-multiplier meme coins and high-volume crypto pairs
 */
interface DetailedInstrumentConfig {
  canonicalSymbol: string;
  binanceSymbol: string;
  bybitSymbol: string;
  binanceMultiplier: number;
  bybitMultiplier: number;
  description?: string;
}

const SPECIAL_INSTRUMENTS: DetailedInstrumentConfig[] = [
  {
    canonicalSymbol: 'SIMONS_CAT',
    binanceSymbol: '1000CATUSDT',
    bybitSymbol: '1000CATUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: "Simon's Cat meme coin (1000CAT, distinct from TradFi CATUSDT)",
  },
  {
    canonicalSymbol: 'SATS',
    binanceSymbol: '1000SATSUSDT',
    bybitSymbol: '10000SATSUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 10000,
    description: 'SATS (10x ratio between Bybit 10000SATS and Binance 1000SATS)',
  },
  {
    canonicalSymbol: 'PEPE',
    binanceSymbol: '1000PEPEUSDT',
    bybitSymbol: '1000PEPEUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: 'Pepe (1000PEPE on both venues)',
  },
  {
    canonicalSymbol: 'BABYDOGE',
    binanceSymbol: '1MBABYDOGEUSDT',
    bybitSymbol: '1000000BABYDOGEUSDT',
    binanceMultiplier: 1000000,
    bybitMultiplier: 1000000,
    description: 'BabyDoge (Binance 1M prefix vs Bybit 1000000 numeric)',
  },
  {
    canonicalSymbol: 'SHIB',
    binanceSymbol: '1000SHIBUSDT',
    bybitSymbol: '1000SHIBUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: 'Shiba Inu (1000SHIB on both venues)',
  },
  {
    canonicalSymbol: 'BONK',
    binanceSymbol: '1000BONKUSDT',
    bybitSymbol: '1000BONKUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: 'Bonk (1000BONK on both venues)',
  },
  {
    canonicalSymbol: 'FLOKI',
    binanceSymbol: '1000FLOKIUSDT',
    bybitSymbol: '1000FLOKIUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: 'Floki (1000FLOKI on both venues)',
  },
  {
    canonicalSymbol: 'TURBO',
    binanceSymbol: 'TURBOUSDT',
    bybitSymbol: '1000TURBOUSDT',
    binanceMultiplier: 1,
    bybitMultiplier: 1000,
    description: 'Turbo (1000x multiplier on Bybit vs 1x on Binance)',
  },
  {
    canonicalSymbol: 'RATS',
    binanceSymbol: '1000RATSUSDT',
    bybitSymbol: '1000RATSUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: 'Rats (1000RATS on both venues)',
  },
  {
    canonicalSymbol: 'LUNC',
    binanceSymbol: '1000LUNCUSDT',
    bybitSymbol: '1000LUNCUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: 'Terra Classic (1000LUNC on both venues)',
  },
  {
    canonicalSymbol: 'XEC',
    binanceSymbol: '1000XECUSDT',
    bybitSymbol: '1000XECUSDT',
    binanceMultiplier: 1000,
    bybitMultiplier: 1000,
    description: 'eCash (1000XEC on both venues)',
  },
];

/**
 * Fast lookup indexes
 */
const CANONICAL_MAP = new Map<string, DetailedInstrumentConfig>();
const SYMBOL_TO_CONFIG = new Map<string, DetailedInstrumentConfig>();

// Populate fast lookups
for (const config of SPECIAL_INSTRUMENTS) {
  CANONICAL_MAP.set(config.canonicalSymbol.toUpperCase(), config);
  SYMBOL_TO_CONFIG.set(config.binanceSymbol.toUpperCase(), config);
  SYMBOL_TO_CONFIG.set(config.bybitSymbol.toUpperCase(), config);
}

// Special alias for Bybit alternative ticker SHIB1000USDT
const shibConfig = CANONICAL_MAP.get('SHIB');
if (shibConfig) {
  SYMBOL_TO_CONFIG.set('SHIB1000USDT', shibConfig);
}

/**
 * Checks if a symbol belongs to TradFi equities, commodities, or ETFs
 * that should be excluded from crypto statistical arbitrage.
 */
export function isTradFiExcluded(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase().trim();
  return TRADFI_EXCLUSION_SET.has(upper);
}

/**
 * Resolves a canonical symbol given any venue symbol or canonical ID.
 * (e.g. '1000PEPEUSDT' -> 'PEPE', '10000SATSUSDT' -> 'SATS', 'BTCUSDT' -> 'BTC')
 */
export function resolveCanonicalSymbol(rawInput: string): string {
  if (!rawInput) return '';
  const clean = rawInput.toUpperCase().trim();

  // Check known special mappings first
  const special = SYMBOL_TO_CONFIG.get(clean) || CANONICAL_MAP.get(clean);
  if (special) {
    return special.canonicalSymbol;
  }

  // Strip USDT / USDC quote currency
  let base = clean;
  if (base.endsWith('USDT')) {
    base = base.slice(0, -4);
  } else if (base.endsWith('USDC')) {
    base = base.slice(0, -4);
  }

  // Strip standard multiplier prefixes like 1000, 10000, 1M if not already caught
  if (base.startsWith('1000000')) {
    base = base.slice(7);
  } else if (base.startsWith('10000')) {
    base = base.slice(5);
  } else if (base.startsWith('1000')) {
    base = base.slice(4);
  } else if (base.startsWith('1M')) {
    base = base.slice(2);
  }

  return base;
}

/**
 * Resolves complete InstrumentMapping for any given symbol (canonical or venue-specific).
 */
export function getInstrumentMapping(rawInput: string): InstrumentMapping | null {
  if (!rawInput) return null;
  const clean = rawInput.toUpperCase().trim();

  if (isTradFiExcluded(clean)) {
    return {
      canonicalSymbol: clean,
      binanceSymbol: clean,
      bybitSymbol: clean,
      multiplier: 1.0,
      isTradFiExcluded: true,
      description: 'TradFi asset excluded from crypto statistical arbitrage',
    };
  }

  const special = SYMBOL_TO_CONFIG.get(clean) || CANONICAL_MAP.get(clean);
  if (special) {
    const multiplierRatio = special.bybitMultiplier / special.binanceMultiplier;
    return {
      canonicalSymbol: special.canonicalSymbol,
      binanceSymbol: special.binanceSymbol,
      bybitSymbol: special.bybitSymbol,
      multiplier: multiplierRatio,
      isTradFiExcluded: false,
      description: special.description,
    };
  }

  // Standard crypto perpetual (e.g. BTCUSDT, ETHUSDT, SOLUSDT)
  const canonical = resolveCanonicalSymbol(clean);
  const standardSymbol = canonical ? `${canonical}USDT` : clean;

  return {
    canonicalSymbol: canonical,
    binanceSymbol: standardSymbol,
    bybitSymbol: standardSymbol,
    multiplier: 1.0,
    isTradFiExcluded: false,
    description: `Standard 1:1 cross-exchange crypto perpetual (${canonical})`,
  };
}

/**
 * Returns the Binance USD-M contract symbol for a canonical instrument.
 */
export function toBinanceSymbol(canonicalOrSymbol: string): string {
  const mapping = getInstrumentMapping(canonicalOrSymbol);
  return mapping ? mapping.binanceSymbol : canonicalOrSymbol.toUpperCase().trim();
}

/**
 * Returns the Bybit Linear contract symbol for a canonical instrument.
 */
export function toBybitSymbol(canonicalOrSymbol: string): string {
  const mapping = getInstrumentMapping(canonicalOrSymbol);
  return mapping ? mapping.bybitSymbol : canonicalOrSymbol.toUpperCase().trim();
}

/**
 * Returns the multiplier ratio between Bybit and Binance contracts:
 * ratio = BybitContractSize / BinanceContractSize
 * (e.g. SATS = 10000 / 1000 = 10.0; TURBO = 1000 / 1 = 1000.0; Standard = 1.0)
 */
export function getMultiplierRatio(canonicalOrSymbol: string): number {
  const mapping = getInstrumentMapping(canonicalOrSymbol);
  return mapping ? mapping.multiplier : 1.0;
}

/**
 * Normalizes mid-price to base per-token units so that Binance and Bybit prices
 * can be compared 1:1 in gross basis calculations.
 * 
 * @param price Raw quoted mid price on the exchange
 * @param venue 'BINANCE' | 'BYBIT'
 * @param canonicalOrSymbol Instrument symbol
 * @returns Normalized price per base token
 */
export function normalizePrice(
  price: number,
  venue: 'BINANCE' | 'BYBIT',
  canonicalOrSymbol: string
): number {
  if (price <= 0 || !Number.isFinite(price)) return 0;
  const clean = canonicalOrSymbol.toUpperCase().trim();
  const special = SYMBOL_TO_CONFIG.get(clean) || CANONICAL_MAP.get(clean);

  if (!special) {
    return price;
  }

  const contractMultiplier =
    venue === 'BINANCE' ? special.binanceMultiplier : special.bybitMultiplier;

  return price / contractMultiplier;
}

/**
 * Translates execution fill quantity from one venue to the counterpart venue
 * to maintain strict 1:1 delta neutrality across differing contract multipliers.
 * 
 * Example for SATS:
 * Fill 100 contracts on Binance (100 * 1,000 = 100,000 SATS)
 * Sized on Bybit (1 contract = 10,000 SATS) -> 100 * (1,000 / 10,000) = 10 contracts.
 * 
 * @param quantity Quantity executed on source venue
 * @param fromVenue Source exchange ('BINANCE' | 'BYBIT')
 * @param toVenue Target exchange ('BINANCE' | 'BYBIT')
 * @param canonicalOrSymbol Instrument symbol
 * @returns Scaled contract quantity for target venue
 */
export function normalizeQuantity(
  quantity: number,
  fromVenue: 'BINANCE' | 'BYBIT',
  toVenue: 'BINANCE' | 'BYBIT',
  canonicalOrSymbol: string
): number {
  if (quantity <= 0 || !Number.isFinite(quantity) || fromVenue === toVenue) {
    return quantity;
  }

  const clean = canonicalOrSymbol.toUpperCase().trim();
  const special = SYMBOL_TO_CONFIG.get(clean) || CANONICAL_MAP.get(clean);

  if (!special) {
    return quantity;
  }

  const fromMultiplier =
    fromVenue === 'BINANCE' ? special.binanceMultiplier : special.bybitMultiplier;
  const toMultiplier =
    toVenue === 'BINANCE' ? special.binanceMultiplier : special.bybitMultiplier;

  // Total base units = quantity * fromMultiplier
  // Target contracts = total base units / toMultiplier
  return (quantity * fromMultiplier) / toMultiplier;
}
