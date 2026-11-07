import { signAndFetchBinance } from "./binanceSigner";
import { getBitgetAccount, BitgetCredentials } from "./bitgetSigner";
import { getCoinDcxAccount, fromCoinDcxPair } from "./coindcxSigner";
import { fetchBybitPositions } from "./bybitSigner";
import { UserApiKeys } from "./userStore";
import { decryptVaultSecret } from "./cryptoVault";
import fs from "fs";
import path from "path";

export interface VenuePositionsSnapshot {
  timestamp: number;
  // Map of normalized venue name -> Set of active open symbols (e.g. "BTCUSDT")
  venueOpenSymbols: Map<string, Set<string>>;
  // Detailed open positions list
  rawPositions: any[];
}

// In-memory cache per user/creds with 5-second TTL to prevent redundant exchange rate limit consumption
const positionsCache = new Map<string, VenuePositionsSnapshot>();
const CACHE_TTL_MS = 5000;

/**
 * Standardize coin symbols to match Cockpit notation (e.g. "BTCUSDT")
 */
export function normalizeExchangeSymbol(rawSym: string): string {
  if (!rawSym) return "";
  let clean = rawSym.trim().toUpperCase();

  // CoinDCX format: "B-BTC_USDT" -> "BTCUSDT"
  if (clean.startsWith("B-") || clean.includes("_USDT")) {
    clean = fromCoinDcxPair(clean);
  }

  // Bitget mix format: "BTCUSDT_UMCBL" -> "BTCUSDT"
  if (clean.endsWith("_UMCBL")) {
    clean = clean.replace(/_UMCBL$/, "");
  }

  // Remove common punctuation and delimiters
  clean = clean.replace(/[-_/]/g, "");

  // If symbol doesn't end with USDT, append USDT if it looks like a base symbol
  if (!clean.endsWith("USDT") && !clean.endsWith("USDC")) {
    clean = `${clean}USDT`;
  }

  return clean;
}

/**
 * Fetches open positions for specified venues (or all 4 venues by default)
 * Respects 5-second in-memory cache to ensure sub-millisecond candidate filtering
 */
export async function getLivePositionsForVenues(
  targetVenues: string[] = ["Binance", "Bitget", "CoinDCX", "Bybit"],
  creds?: UserApiKeys,
  cacheKey: string = "default",
  forceRefresh: boolean = false
): Promise<VenuePositionsSnapshot> {
  const now = Date.now();
  const cached = positionsCache.get(cacheKey);

  if (!forceRefresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  const venueOpenSymbols = new Map<string, Set<string>>();
  targetVenues.forEach((v) => venueOpenSymbols.set(v.toLowerCase(), new Set<string>()));

  let allPositions: any[] = [];

  const promises: Promise<void>[] = [];

  // 1. Binance Live Positions
  if (targetVenues.some((v) => v.toLowerCase() === "binance")) {
    promises.push(
      (async () => {
        try {
          const key = creds?.binanceKey || process.env.ADMIN_BINANCE_KEY || "";
          const sec = creds?.binanceSecret || process.env.ADMIN_BINANCE_SECRET || "";
          const ep = creds?.binanceEndpoint || undefined;

          if (key && sec) {
            const { data } = await signAndFetchBinance(
              key,
              sec,
              "GET",
              "/fapi/v2/positionRisk",
              {},
              true,
              ep
            );
            if (Array.isArray(data)) {
              const binanceSet = venueOpenSymbols.get("binance") || new Set<string>();
              data.forEach((p: any) => {
                const amt = parseFloat(p.positionAmt || "0");
                if (Math.abs(amt) > 0.000001) {
                  const norm = normalizeExchangeSymbol(p.symbol);
                  binanceSet.add(norm);
                  allPositions.push({
                    venue: "Binance",
                    symbol: norm,
                    rawSymbol: p.symbol,
                    amount: amt,
                    entryPrice: parseFloat(p.entryPrice || "0"),
                    markPrice: parseFloat(p.markPrice || "0"),
                  });
                }
              });
              venueOpenSymbols.set("binance", binanceSet);
            }
          }
        } catch (err: any) {
          // Non-fatal logging
        }
      })()
    );
  }

  // 2. Bitget Live Positions
  if (targetVenues.some((v) => v.toLowerCase() === "bitget")) {
    promises.push(
      (async () => {
        try {
          const bgCreds: BitgetCredentials | undefined = creds?.bitgetKey && creds?.bitgetSecret && creds?.bitgetPassphrase
            ? {
                apiKey: creds.bitgetKey,
                apiSecret: creds.bitgetSecret,
                passphrase: creds.bitgetPassphrase,
                isDemo: creds.bitgetEnv !== "live",
              }
            : undefined;

          const bitgetAcc = await getBitgetAccount(bgCreds);
          if (bitgetAcc.success && Array.isArray(bitgetAcc.positions)) {
            const bitgetSet = venueOpenSymbols.get("bitget") || new Set<string>();
            bitgetAcc.positions.forEach((p: any) => {
              const amt = parseFloat(p.amount || p.total || p.size || "0");
              if (Math.abs(amt) > 0.000001) {
                const norm = normalizeExchangeSymbol(p.symbol);
                bitgetSet.add(norm);
                allPositions.push({
                  venue: "Bitget",
                  symbol: norm,
                  rawSymbol: p.symbol,
                  amount: amt,
                  entryPrice: parseFloat(p.entryPrice || "0"),
                  markPrice: parseFloat(p.markPrice || "0"),
                });
              }
            });
            venueOpenSymbols.set("bitget", bitgetSet);
          }
        } catch (err: any) {
          // Non-fatal logging
        }
      })()
    );
  }

  // 3. CoinDCX Live Positions
  if (targetVenues.some((v) => v.toLowerCase() === "coindcx")) {
    promises.push(
      (async () => {
        try {
          if (creds?.coindcxKey && creds?.coindcxSecret) {
            const cdxAcc = await getCoinDcxAccount({
              apiKey: creds.coindcxKey,
              apiSecret: creds.coindcxSecret,
            });
            if (cdxAcc.success && Array.isArray(cdxAcc.positions)) {
              const cdxSet = venueOpenSymbols.get("coindcx") || new Set<string>();
              cdxAcc.positions.forEach((p: any) => {
                const amt = parseFloat(p.amount || p.active_pos || "0");
                if (Math.abs(amt) > 0.000001) {
                  const norm = normalizeExchangeSymbol(p.symbol || p.pair);
                  cdxSet.add(norm);
                  allPositions.push({
                    venue: "CoinDCX",
                    symbol: norm,
                    rawSymbol: p.pair,
                    amount: amt,
                    entryPrice: parseFloat(p.entryPrice || "0"),
                    markPrice: parseFloat(p.markPrice || "0"),
                    unrealizedPnl: parseFloat(p.unrealizedPnl || "0"),
                    leverage: p.leverage || 10,
                  });
                }
              });
              venueOpenSymbols.set("coindcx", cdxSet);
            }
          }
        } catch (err: any) {
          // Non-fatal logging
        }
      })()
    );
  }

  // 4. Bybit Live Positions
  if (targetVenues.some((v) => v.toLowerCase() === "bybit")) {
    promises.push(
      (async () => {
        try {
          if (creds?.bybitKey && creds?.bybitSecret) {
            const rawBybitSec = creds.bybitSecret;
            const cleanBybitSec = rawBybitSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBybitSec) : rawBybitSec;
            const bybitPositions = await fetchBybitPositions({
              apiKey: creds.bybitKey,
              apiSecret: cleanBybitSec,
              proxyUrl: creds.bybitProxy,
              baseUrl: creds.bybitBaseUrl,
              backupProxyUrl: creds.bybitBackupProxy,
              backupBaseUrl: creds.bybitBackupBaseUrl,
            });
            if (Array.isArray(bybitPositions)) {
              const bybitSet = venueOpenSymbols.get("bybit") || new Set<string>();
              bybitPositions.forEach((p: any) => {
                const size = parseFloat(p.size || "0");
                if (size > 0.000001) {
                  const norm = normalizeExchangeSymbol(p.symbol);
                  bybitSet.add(norm);
                  allPositions.push({
                    venue: "Bybit",
                    symbol: norm,
                    rawSymbol: p.symbol,
                    amount: p.side === "Sell" ? -size : size,
                    entryPrice: parseFloat(p.entryPrice || "0"),
                    markPrice: parseFloat(p.markPrice || "0"),
                    unrealizedPnl: parseFloat(p.unrealisedPnl || p.unrealizedPnl || "0"),
                    leverage: p.leverage || 20,
                  });
                }
              });
              venueOpenSymbols.set("bybit", bybitSet);
            }
          }
        } catch (err: any) {
          // Non-fatal logging
        }
      })()
    );
  }

  await Promise.allSettled(promises);

  const snapshot: VenuePositionsSnapshot = {
    timestamp: now,
    venueOpenSymbols,
    rawPositions: allPositions,
  };

  positionsCache.set(cacheKey, snapshot);
  return snapshot;
}

let lastConvergenceSymbolsCache: {
  timestamp: number;
  symbols: Set<string>;
  symbolCounts: Map<string, number>;
  directions: Map<string, string>;
  totalActiveCount: number;
} = {
  timestamp: 0,
  symbols: new Set(),
  symbolCounts: new Map(),
  directions: new Map(),
  totalActiveCount: 0,
};

/**
 * Returns active positions held by STATARB-OU-PERP convergence engine
 */
export function getConvergenceActivePositions(): {
  symbols: Set<string>;
  symbolCounts: Map<string, number>;
  directions: Map<string, string>;
  totalActiveCount: number;
} {
  const now = Date.now();
  if (now - lastConvergenceSymbolsCache.timestamp < 3000) {
    return lastConvergenceSymbolsCache;
  }

  try {
    const statePath = path.resolve(process.cwd(), "data/statarb_state.json");
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const symbols = new Set<string>();
      const symbolCounts = new Map<string, number>();
      const directions = new Map<string, string>();
      let totalActiveCount = 0;
      if (Array.isArray(data.positions)) {
        for (const p of data.positions) {
          if (p.canonicalSymbol && (p.status === "OPEN" || !p.status)) {
            const norm = normalizeExchangeSymbol(p.canonicalSymbol);
            symbols.add(norm);
            symbolCounts.set(norm, (symbolCounts.get(norm) || 0) + 1);
            directions.set(norm, p.direction || "");
            totalActiveCount++;
          }
        }
      }
      lastConvergenceSymbolsCache = { timestamp: now, symbols, symbolCounts, directions, totalActiveCount };
      return lastConvergenceSymbolsCache;
    }
  } catch {}

  return lastConvergenceSymbolsCache;
}

/**
 * Check if a coin has an open position on either corridor venue.
 * Enforces strict max repeated trades cap (default: 2) across engine & fleet.
 */
export function hasCorridorLivePosition(
  symbol: string,
  venueA: string,
  venueB: string,
  snapshot: VenuePositionsSnapshot,
  ignoreConvergencePositions: boolean = false,
  maxRepeatedTrades: number = 2
): {
  hasPosition: boolean;
  blockingVenues: string[];
  isConvergencePosition?: boolean;
  convergenceDirection?: string;
  totalPositionsForSymbol?: number;
  reason?: string;
} {
  const normSym = normalizeExchangeSymbol(symbol);
  const blockingVenues: string[] = [];

  const conv = getConvergenceActivePositions();
  const convCount = conv.symbolCounts.get(normSym) || (conv.symbols.has(normSym) ? 1 : 0);
  const isConvergence = convCount > 0;

  // If this symbol already has reached or exceeded max repeated trades (e.g. 2 in convergence), strictly block!
  if (convCount >= maxRepeatedTrades) {
    return {
      hasPosition: true,
      blockingVenues: ["Convergence Engine (Max Repeated 2 Trades Active)"],
      isConvergencePosition: true,
      convergenceDirection: conv.directions.get(normSym),
      totalPositionsForSymbol: convCount,
      reason: `Max repeated trades cap (${maxRepeatedTrades}) reached in convergence engine.`,
    };
  }

  // If under max repeated trades cap (< 2) and coexistence is allowed:
  if (ignoreConvergencePositions && isConvergence) {
    return {
      hasPosition: false,
      blockingVenues: [],
      isConvergencePosition: true,
      convergenceDirection: conv.directions.get(normSym),
      totalPositionsForSymbol: convCount,
      reason: `Repeated trade permitted: ${convCount}/${maxRepeatedTrades} active in convergence.`,
    };
  }

  const setA = snapshot.venueOpenSymbols.get(venueA.toLowerCase());
  if (setA && setA.has(normSym)) {
    blockingVenues.push(venueA);
  }

  const setB = snapshot.venueOpenSymbols.get(venueB.toLowerCase());
  if (setB && setB.has(normSym)) {
    blockingVenues.push(venueB);
  }

  return {
    hasPosition: blockingVenues.length > 0,
    blockingVenues,
    isConvergencePosition: isConvergence,
    convergenceDirection: conv.directions.get(normSym),
    totalPositionsForSymbol: convCount,
  };
}
