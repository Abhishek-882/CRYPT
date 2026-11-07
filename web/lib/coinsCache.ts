/**
 * In-memory caching and rate-limit constants for coins API route.
 * Separated from route.ts to comply with Next.js App Router export restrictions (TS2344).
 */

export const COINS_CACHE_TTL_MS = 4_000; // 4 second in-memory cache for ultra-fast polling
export const TESTNET_CACHE_TTL_MS = 15 * 60 * 1000;

export interface CoinsRouteCacheState {
  cachedResponse: any | null;
  lastFetchTime: number;
  cachedTestnetSymbols: Set<string> | null;
  lastTestnetFetch: number;
  lastUpstreamError: any;
}

declare global {
  // eslint-disable-next-line no-var
  var __coinsRouteCache: CoinsRouteCacheState | undefined;
}

export function getCoinsCache(): CoinsRouteCacheState {
  if (!globalThis.__coinsRouteCache) {
    globalThis.__coinsRouteCache = {
      cachedResponse: null,
      lastFetchTime: 0,
      cachedTestnetSymbols: null,
      lastTestnetFetch: 0,
      lastUpstreamError: null,
    };
  }
  return globalThis.__coinsRouteCache;
}

export const coinsCache = getCoinsCache();

export function _resetCoinsCacheForTesting(resetTestnet = false): void {
  const cache = getCoinsCache();
  cache.lastUpstreamError = null;
  cache.cachedResponse = null;
  cache.lastFetchTime = 0;
  if (resetTestnet) {
    cache.cachedTestnetSymbols = null;
    cache.lastTestnetFetch = 0;
  }
}
