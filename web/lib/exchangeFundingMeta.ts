/**
 * Exchange Funding Metadata Indexer & Cache Service
 * Discovers and caches real settlement intervals (8h, 4h, 1h) and next funding times
 * across Binance Futures and Bitget USDT-Futures.
 */

import { getDeterministicNextFundingTime, getPayoutsPerDay, getSettlementCycleLabel } from "./settlementTime";

export interface SymbolFundingMeta {
  symbol: string;
  fundingIntervalHours: number; // effective interval (e.g. 4, 8, 1)
  binanceIntervalHours?: number;
  binanceNextFundingTime?: number;
  bybitIntervalHours?: number;
  bybitNextFundingTime?: number;
  bitgetIntervalHours?: number;
  bitgetNextFundingTime?: number;
  coindcxIntervalHours?: number;
  coindcxNextFundingTime?: number;
  settlementCycleLabel: string;
  payoutsPerDay: number;
  bitgetNextUpdate?: number;
}

export function parseFundingTimestamp(val: any): number {
  if (val === undefined || val === null || val === "") return 0;
  const num = typeof val === "number" ? val : Number(val);
  const t = Math.round(num);
  if (!isNaN(t) && isFinite(t) && t > 0) {
    return t < 1e11 ? t * 1000 : t;
  }
  return 0;
}

// In-memory cache structures
let cachedMetaMap: Map<string, SymbolFundingMeta> = new Map();
let lastCacheFetchTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache
let isFetchingPromise: Promise<Map<string, SymbolFundingMeta>> | null = null;

/**
 * Fetch and index funding interval definitions and next funding times
 * across all 4 active exchanges: Binance, Bybit, Bitget, and CoinDCX.
 */
export async function fetchFundingMetaMap(): Promise<Map<string, SymbolFundingMeta>> {
  const now = Date.now();

  // Return existing fresh cache if valid
  if (cachedMetaMap.size > 0 && now - lastCacheFetchTime < CACHE_TTL_MS) {
    return cachedMetaMap;
  }

  // Deduplicate simultaneous requests
  if (isFetchingPromise) {
    return isFetchingPromise;
  }

  isFetchingPromise = (async () => {
    try {
      const [bnInfoRes, bnPremRes, bgRes, bybRes] = await Promise.allSettled([
        (async () => {
          const urls = [
            "https://www.binance.com/fapi/v1/fundingInfo",
            "https://fapi.binance.com/fapi/v1/fundingInfo",
            "https://testnet.binancefuture.com/fapi/v1/fundingInfo",
          ];
          for (const u of urls) {
            try {
              const res = await fetch(u, {
                headers: { "User-Agent": "FundingRateEngine/2.0" },
                cache: "no-store",
                signal: AbortSignal.timeout(3000),
              });
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) return data;
              }
            } catch {}
          }
          return [];
        })(),
        (async () => {
          const urls = [
            "https://www.binance.com/fapi/v1/premiumIndex",
            "https://fapi.binance.com/fapi/v1/premiumIndex",
            "https://testnet.binancefuture.com/fapi/v1/premiumIndex",
          ];
          for (const u of urls) {
            try {
              const res = await fetch(u, {
                headers: { "User-Agent": "FundingRateEngine/2.0" },
                cache: "no-store",
                signal: AbortSignal.timeout(3000),
              });
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) return data;
              }
            } catch {}
          }
          return [];
        })(),
        fetch("https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES", {
          headers: { "User-Agent": "FundingRateEngine/2.0" },
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        }).then((r) => r.json()).catch(() => ({ data: [] })),
        fetch("https://api.bybit.com/v5/market/tickers?category=linear", {
          headers: { "User-Agent": "FundingRateEngine/2.0" },
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        }).then((r) => r.json()).catch(() => ({ result: { list: [] } })),
      ]);

      const bnInfoList = bnInfoRes.status === "fulfilled" && Array.isArray(bnInfoRes.value) ? bnInfoRes.value : [];
      const bnPremList = bnPremRes.status === "fulfilled" && Array.isArray(bnPremRes.value) ? bnPremRes.value : [];
      const bgData = bgRes.status === "fulfilled" && Array.isArray(bgRes.value?.data) ? bgRes.value.data : [];
      const bybData = bybRes.status === "fulfilled" && Array.isArray(bybRes.value?.result?.list) ? bybRes.value.result.list : [];

      // 1. Binance index
      const bnIntervalMap = new Map<string, number>();
      for (const item of bnInfoList) {
        if (item.symbol && typeof item.fundingIntervalHours === "number") {
          bnIntervalMap.set(item.symbol.toUpperCase(), item.fundingIntervalHours);
        }
      }

      const bnNextTimeMap = new Map<string, number>();
      for (const item of bnPremList) {
        if (item.symbol && item.nextFundingTime) {
          const t = parseFundingTimestamp(item.nextFundingTime);
          if (t > 0) bnNextTimeMap.set(item.symbol.toUpperCase(), t);
        }
      }

      // 2. Bitget index
      const bgIntervalMap = new Map<string, { interval: number; nextUpdate: number }>();
      for (const item of bgData) {
        if (item.symbol) {
          const sym = item.symbol.toUpperCase();
          const parsedInt = parseInt(item.fundingRateInterval || "8", 10) || 8;
          const nextUpdate = parseFundingTimestamp(item.nextUpdate);
          bgIntervalMap.set(sym, { interval: parsedInt, nextUpdate });
        }
      }

      // 3. Bybit index
      const bybIntervalMap = new Map<string, { interval: number; nextFundingTime: number }>();
      for (const item of bybData) {
        if (item.symbol) {
          const sym = item.symbol.toUpperCase();
          const parsedInt = parseInt(item.fundingIntervalHour || "8", 10) || 8;
          const nextFundingTime = parseFundingTimestamp(item.nextFundingTime);
          bybIntervalMap.set(sym, { interval: parsedInt, nextFundingTime });

          // Also index normalized stripped name if starts with 1000
          if (sym.startsWith("1000")) {
            const stripped = sym.replace(/^1000/, "");
            if (!bybIntervalMap.has(stripped)) {
              bybIntervalMap.set(stripped, { interval: parsedInt, nextFundingTime });
            }
          }
        }
      }

      const newMetaMap = new Map<string, SymbolFundingMeta>();

      // Merge all known symbols from all exchanges
      const allSymbols = new Set<string>();
      bnIntervalMap.forEach((_, sym) => allSymbols.add(sym));
      bnNextTimeMap.forEach((_, sym) => allSymbols.add(sym));
      bgIntervalMap.forEach((_, sym) => allSymbols.add(sym));
      bybIntervalMap.forEach((_, sym) => allSymbols.add(sym));

      allSymbols.forEach((sym) => {
        const bnH = bnIntervalMap.get(sym) || 8;
        const bnNext = bnNextTimeMap.get(sym) || getDeterministicNextFundingTime(now, bnH);

        const bgEntry = bgIntervalMap.get(sym);
        const bgH = bgEntry?.interval || bnH || 8;
        const bgNext = bgEntry?.nextUpdate && bgEntry.nextUpdate > 0
          ? bgEntry.nextUpdate
          : getDeterministicNextFundingTime(now, bgH);

        const bybEntry = bybIntervalMap.get(sym);
        const bybH = bybEntry?.interval || 8;
        const bybNext = bybEntry?.nextFundingTime && bybEntry.nextFundingTime > 0
          ? bybEntry.nextFundingTime
          : getDeterministicNextFundingTime(now, bybH);

        // CoinDCX mirrors Binance Futures intervals and countdowns
        const cdxH = bnH;
        const cdxNext = bnNext;

        // Effective settlement interval: min across active venues or matching
        const effH = Math.min(bnH, bgH, bybH);
        const validEffH = effH > 0 && effH <= 24 ? effH : 8;

        newMetaMap.set(sym, {
          symbol: sym,
          fundingIntervalHours: validEffH,
          binanceIntervalHours: bnH,
          binanceNextFundingTime: bnNext,
          bybitIntervalHours: bybH,
          bybitNextFundingTime: bybNext,
          bitgetIntervalHours: bgH,
          bitgetNextFundingTime: bgNext,
          coindcxIntervalHours: cdxH,
          coindcxNextFundingTime: cdxNext,
          settlementCycleLabel: getSettlementCycleLabel(validEffH),
          payoutsPerDay: getPayoutsPerDay(validEffH),
          bitgetNextUpdate: bgEntry?.nextUpdate && bgEntry.nextUpdate > 0 ? bgEntry.nextUpdate : undefined,
        });
      });

      if (newMetaMap.size > 0) {
        cachedMetaMap = newMetaMap;
        lastCacheFetchTime = Date.now();
      }

      return cachedMetaMap;
    } catch (err) {
      console.error("fetchFundingMetaMap error:", err);
      return cachedMetaMap;
    } finally {
      isFetchingPromise = null;
    }
  })();

  return isFetchingPromise;
}

/**
 * Get funding metadata for a specific venue and symbol
 */
export function getVenueFundingInfo(
  venue: string,
  meta?: SymbolFundingMeta,
  now: number = Date.now()
): { intervalHours: number; nextFundingTime: number } {
  const v = (venue || "").toLowerCase();
  if (!meta) {
    return { intervalHours: 8, nextFundingTime: getDeterministicNextFundingTime(now, 8) };
  }
  if (v.includes("binance")) {
    const intH = meta.binanceIntervalHours || 8;
    const nextT = parseFundingTimestamp(meta.binanceNextFundingTime);
    return {
      intervalHours: intH,
      nextFundingTime: nextT && nextT > now ? nextT : getDeterministicNextFundingTime(now, intH),
    };
  }
  if (v.includes("bybit")) {
    const intH = meta.bybitIntervalHours || 8;
    const nextT = parseFundingTimestamp(meta.bybitNextFundingTime);
    return {
      intervalHours: intH,
      nextFundingTime: nextT && nextT > now ? nextT : getDeterministicNextFundingTime(now, intH),
    };
  }
  if (v.includes("bitget")) {
    const intH = meta.bitgetIntervalHours || 8;
    const nextT = parseFundingTimestamp(meta.bitgetNextFundingTime || meta.bitgetNextUpdate);
    return {
      intervalHours: intH,
      nextFundingTime: nextT && nextT > now ? nextT : getDeterministicNextFundingTime(now, intH),
    };
  }
  if (v.includes("coindcx")) {
    const intH = meta.coindcxIntervalHours || meta.binanceIntervalHours || 8;
    const nextT = parseFundingTimestamp(meta.coindcxNextFundingTime || meta.binanceNextFundingTime);
    return {
      intervalHours: intH,
      nextFundingTime: nextT && nextT > now ? nextT : getDeterministicNextFundingTime(now, intH),
    };
  }
  const intH = meta.fundingIntervalHours || 8;
  return {
    intervalHours: intH,
    nextFundingTime: getDeterministicNextFundingTime(now, intH),
  };
}

export type FundingIntervalMode = "ALL_ASYMMETRIC" | "STRICT_SYNC_ONLY" | "CUSTOM";

export interface MacroCycleInfo {
  macroHorizonHours: number;
  cyclesA: number;
  cyclesB: number;
  ratioLabel: string;
}

export interface FundingSyncCheckOptions {
  allowAsymmetric?: boolean;                    // Legacy compatibility flag (true = ALL_ASYMMETRIC, false = STRICT_SYNC_ONLY)
  intervalMode?: FundingIntervalMode;          // Modern 3-tier selector ("ALL_ASYMMETRIC" | "STRICT_SYNC_ONLY" | "CUSTOM")
  allowedIntervalPairs?: string[];             // e.g. ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h", "1h_2h"]
  minGrossSpreadBps?: number;                  // Default: 35.0 bps
  rateA?: number;                              // Optional nominal funding rate for venue A (%)
  rateB?: number;                              // Optional nominal funding rate for venue B (%)
}

export interface FundingSyncCheckResult {
  synchronized: boolean;
  isAsymmetric: boolean;
  intervalA: number;
  intervalB: number;
  venueAIntervalHours: number;                 // Preserved for 100% backwards compatibility
  venueBIntervalHours: number;                 // Preserved for 100% backwards compatibility
  venueANextFundingTime: number;
  venueBNextFundingTime: number;
  deltaMs: number;
  deltaSeconds: number;
  earliestNextFundingTime: number;
  macroNextFundingTime: number;
  secondsToEarliestFunding: number;
  secondsToMacroFunding: number;
  firstSettlementVenue: string;                // "Simultaneous" | venueA | venueB
  macroHorizonHours: number;                   // max(intervalA, intervalB)
  cyclesA: number;                             // macroHorizonHours / intervalA
  cyclesB: number;                             // macroHorizonHours / intervalB
  asymmetricYield?: {
    macroHorizonHours: number;
    cyclesA: number;
    cyclesB: number;
    nominalRateA: number;
    nominalRateB: number;
    grossYieldPct: number;
    grossYieldBps: number;
    netYieldBps: number;
    clearsFeeHurdle: boolean;
    recommendedDirection: "SHORT_A_LONG_B" | "LONG_A_SHORT_B";
  };
  reason?: string;
}

/**
 * Computes the macro settlement horizon and discrete cycle multipliers for any two intervals.
 * Supports all 16 permutations across 1h, 2h, 4h, and 8h intervals.
 */
export function computeMacroCycleInfo(intervalA: number, intervalB: number): MacroCycleInfo {
  const intA = typeof intervalA === "number" && intervalA > 0 ? intervalA : 8;
  const intB = typeof intervalB === "number" && intervalB > 0 ? intervalB : 8;
  const macroHorizonHours = Math.max(intA, intB);
  const cyclesA = Math.max(1, Math.round(macroHorizonHours / intA));
  const cyclesB = Math.max(1, Math.round(macroHorizonHours / intB));
  const ratioLabel = `${cyclesA}:${cyclesB}`;
  return {
    macroHorizonHours,
    cyclesA,
    cyclesB,
    ratioLabel,
  };
}

/**
 * Normalizes and formats interval pair string identifiers (e.g. "1h_4h").
 */
export function formatIntervalPairKey(intervalA: number, intervalB: number, directed: boolean = true): string {
  const intA = typeof intervalA === "number" && intervalA > 0 ? intervalA : 8;
  const intB = typeof intervalB === "number" && intervalB > 0 ? intervalB : 8;
  if (directed) {
    return `${intA}h_${intB}h`;
  }
  const minInt = Math.min(intA, intB);
  const maxInt = Math.max(intA, intB);
  return `${minInt}h_${maxInt}h`;
}

/**
 * Validates whether an asymmetric interval pair is admitted under custom filter list.
 * Matches directed ("1h_4h"), reverse ("4h_1h"), and normalized ("1h_4h") keys.
 */
export function isIntervalPairAllowed(
  intervalA: number,
  intervalB: number,
  allowedPairs?: string[]
): boolean {
  if (!allowedPairs || allowedPairs.length === 0) return true;
  const directed = `${intervalA}h_${intervalB}h`.toLowerCase();
  const reverse = `${intervalB}h_${intervalA}h`.toLowerCase();
  const normalized = `${Math.min(intervalA, intervalB)}h_${Math.max(intervalA, intervalB)}h`.toLowerCase();
  return allowedPairs.some((p) => {
    const clean = p.trim().toLowerCase();
    return clean === directed || clean === reverse || clean === normalized;
  });
}

/**
 * Universal Multi-Exchange Funding Interval & Settlement Countdown Synchronization Lock.
 * Evaluates temporal synchronization, detects earliest vs macro settlement maturities,
 * and enforces Option 1 (ALL_ASYMMETRIC), Option 2 (STRICT_SYNC_ONLY), or CUSTOM guardrails.
 */
export function checkFundingSynchronization(
  venueA: string,
  venueB: string,
  meta?: SymbolFundingMeta,
  now: number = Date.now(),
  options?: FundingSyncCheckOptions
): FundingSyncCheckResult {
  const infoA = getVenueFundingInfo(venueA, meta, now);
  const infoB = getVenueFundingInfo(venueB, meta, now);

  // 1. Resolve active interval mode (with legacy boolean fallback)
  let effectiveMode: FundingIntervalMode = "STRICT_SYNC_ONLY";
  if (options?.intervalMode) {
    effectiveMode = options.intervalMode;
  } else if (options?.allowAsymmetric === true) {
    effectiveMode = "ALL_ASYMMETRIC";
  } else {
    effectiveMode = "STRICT_SYNC_ONLY";
  }

  // 2. Compute timing, countdowns, and earliest/macro horizons
  const intervalMismatch = infoA.intervalHours !== infoB.intervalHours;
  const deltaMs = Math.abs(infoA.nextFundingTime - infoB.nextFundingTime);
  const deltaSeconds = Math.round(deltaMs / 1000);
  const countdownDesync = deltaMs > 60000;

  const earliestNextFundingTime = Math.min(infoA.nextFundingTime, infoB.nextFundingTime);
  const macroNextFundingTime = Math.max(infoA.nextFundingTime, infoB.nextFundingTime);

  const secondsToEarliestFunding = Math.max(0, Math.round((earliestNextFundingTime - now) / 1000));
  const secondsToMacroFunding = Math.max(0, Math.round((macroNextFundingTime - now) / 1000));

  // 3. First settlement venue detection
  let firstSettlementVenue: string;
  if (deltaMs <= 60000) {
    firstSettlementVenue = "Simultaneous";
  } else if (infoA.nextFundingTime < infoB.nextFundingTime) {
    firstSettlementVenue = venueA;
  } else {
    firstSettlementVenue = venueB;
  }

  // 4. Compute macro cycle info across the 16 permutations
  const cycleInfo = computeMacroCycleInfo(infoA.intervalHours, infoB.intervalHours);
  const isAsymmetric = intervalMismatch || countdownDesync;

  // 5. Compute optional asymmetric yield if nominal rates are provided
  let asymmetricYield: FundingSyncCheckResult["asymmetricYield"] = undefined;
  if (typeof options?.rateA === "number" && typeof options?.rateB === "number") {
    const rateA = !isNaN(options.rateA) ? options.rateA : 0;
    const rateB = !isNaN(options.rateB) ? options.rateB : 0;
    const macroRateA = cycleInfo.cyclesA * rateA;
    const macroRateB = cycleInfo.cyclesB * rateB;
    const grossYieldPct = Math.abs(macroRateA - macroRateB);
    const grossYieldBps = grossYieldPct * 100;
    const feeHurdleBps = options.minGrossSpreadBps ?? 35.0;
    const netYieldBps = grossYieldBps - feeHurdleBps;
    const clearsFeeHurdle = grossYieldBps >= feeHurdleBps && netYieldBps >= 0;
    const recommendedDirection: "SHORT_A_LONG_B" | "LONG_A_SHORT_B" =
      macroRateA >= macroRateB ? "SHORT_A_LONG_B" : "LONG_A_SHORT_B";

    asymmetricYield = {
      macroHorizonHours: cycleInfo.macroHorizonHours,
      cyclesA: cycleInfo.cyclesA,
      cyclesB: cycleInfo.cyclesB,
      nominalRateA: rateA,
      nominalRateB: rateB,
      grossYieldPct: parseFloat(grossYieldPct.toFixed(5)),
      grossYieldBps: parseFloat(grossYieldBps.toFixed(2)),
      netYieldBps: parseFloat(netYieldBps.toFixed(2)),
      clearsFeeHurdle,
      recommendedDirection,
    };
  }

  // 6. Option 2: STRICT_SYNC_ONLY Guardrail Invariant
  if (effectiveMode === "STRICT_SYNC_ONLY") {
    if (intervalMismatch) {
      return {
        synchronized: false,
        isAsymmetric: true,
        intervalA: infoA.intervalHours,
        intervalB: infoB.intervalHours,
        venueAIntervalHours: infoA.intervalHours,
        venueBIntervalHours: infoB.intervalHours,
        venueANextFundingTime: infoA.nextFundingTime,
        venueBNextFundingTime: infoB.nextFundingTime,
        deltaMs,
        deltaSeconds,
        earliestNextFundingTime,
        macroNextFundingTime,
        secondsToEarliestFunding,
        secondsToMacroFunding,
        firstSettlementVenue,
        macroHorizonHours: cycleInfo.macroHorizonHours,
        cyclesA: cycleInfo.cyclesA,
        cyclesB: cycleInfo.cyclesB,
        asymmetricYield,
        reason: `[STRICT_SYNC_REJECTED] Interval mismatch: ${venueA} (${infoA.intervalHours}h) !== ${venueB} (${infoB.intervalHours}h)`,
      };
    }

    if (countdownDesync) {
      return {
        synchronized: false,
        isAsymmetric: true,
        intervalA: infoA.intervalHours,
        intervalB: infoB.intervalHours,
        venueAIntervalHours: infoA.intervalHours,
        venueBIntervalHours: infoB.intervalHours,
        venueANextFundingTime: infoA.nextFundingTime,
        venueBNextFundingTime: infoB.nextFundingTime,
        deltaMs,
        deltaSeconds,
        earliestNextFundingTime,
        macroNextFundingTime,
        secondsToEarliestFunding,
        secondsToMacroFunding,
        firstSettlementVenue,
        macroHorizonHours: cycleInfo.macroHorizonHours,
        cyclesA: cycleInfo.cyclesA,
        cyclesB: cycleInfo.cyclesB,
        asymmetricYield,
        reason: `[STRICT_SYNC_REJECTED] Countdown desynchronization: |${venueA} - ${venueB}| = ${deltaSeconds}s delta > 60s`,
      };
    }
  }

  // 7. Custom Mode Filtering
  if (effectiveMode === "CUSTOM" && isAsymmetric) {
    if (options?.allowedIntervalPairs && options.allowedIntervalPairs.length > 0) {
      const allowed = isIntervalPairAllowed(infoA.intervalHours, infoB.intervalHours, options.allowedIntervalPairs);
      if (!allowed) {
        const pairKey = formatIntervalPairKey(infoA.intervalHours, infoB.intervalHours);
        return {
          synchronized: false,
          isAsymmetric: true,
          intervalA: infoA.intervalHours,
          intervalB: infoB.intervalHours,
          venueAIntervalHours: infoA.intervalHours,
          venueBIntervalHours: infoB.intervalHours,
          venueANextFundingTime: infoA.nextFundingTime,
          venueBNextFundingTime: infoB.nextFundingTime,
          deltaMs,
          deltaSeconds,
          earliestNextFundingTime,
          macroNextFundingTime,
          secondsToEarliestFunding,
          secondsToMacroFunding,
          firstSettlementVenue,
          macroHorizonHours: cycleInfo.macroHorizonHours,
          cyclesA: cycleInfo.cyclesA,
          cyclesB: cycleInfo.cyclesB,
          asymmetricYield,
          reason: `[CUSTOM_FILTER_REJECTED] Interval pair ${pairKey} is not admitted under active allowedIntervalPairs: [${options.allowedIntervalPairs.join(", ")}]`,
        };
      }
    }
  }

  // 8. Option 1: ALL_ASYMMETRIC Qualification
  let reason: string | undefined;
  if (isAsymmetric) {
    reason = `Asymmetric funding schedule permitted (${venueA} ${infoA.intervalHours}h vs ${venueB} ${infoB.intervalHours}h)`;
  }

  return {
    synchronized: true,
    isAsymmetric,
    intervalA: infoA.intervalHours,
    intervalB: infoB.intervalHours,
    venueAIntervalHours: infoA.intervalHours,
    venueBIntervalHours: infoB.intervalHours,
    venueANextFundingTime: infoA.nextFundingTime,
    venueBNextFundingTime: infoB.nextFundingTime,
    deltaMs,
    deltaSeconds,
    earliestNextFundingTime,
    macroNextFundingTime,
    secondsToEarliestFunding,
    secondsToMacroFunding,
    firstSettlementVenue,
    macroHorizonHours: cycleInfo.macroHorizonHours,
    cyclesA: cycleInfo.cyclesA,
    cyclesB: cycleInfo.cyclesB,
    asymmetricYield,
    reason,
  };
}

/**
 * Get funding metadata for a specific symbol
 */
export async function getFundingMetaForSymbol(symbol: string): Promise<SymbolFundingMeta> {
  const sym = symbol.toUpperCase();
  const map = await fetchFundingMetaMap();
  const found = map.get(sym);
  if (found) return found;

  const now = Date.now();
  const defNext = getDeterministicNextFundingTime(now, 8);

  // Fallback defaults if symbol is not yet indexed
  return {
    symbol: sym,
    fundingIntervalHours: 8,
    binanceIntervalHours: 8,
    binanceNextFundingTime: defNext,
    bybitIntervalHours: 8,
    bybitNextFundingTime: defNext,
    bitgetIntervalHours: 8,
    bitgetNextFundingTime: defNext,
    coindcxIntervalHours: 8,
    coindcxNextFundingTime: defNext,
    settlementCycleLabel: "8h Cycle",
    payoutsPerDay: 3,
  };
}

/**
 * Synchronous cached lookup (returns fallback if not yet fetched)
 */
export function getCachedFundingMeta(symbol: string): SymbolFundingMeta {
  const sym = symbol.toUpperCase();
  const found = cachedMetaMap.get(sym);
  if (found) return found;

  const now = Date.now();
  const defNext = getDeterministicNextFundingTime(now, 8);

  return {
    symbol: sym,
    fundingIntervalHours: 8,
    binanceIntervalHours: 8,
    binanceNextFundingTime: defNext,
    bybitIntervalHours: 8,
    bybitNextFundingTime: defNext,
    bitgetIntervalHours: 8,
    bitgetNextFundingTime: defNext,
    coindcxIntervalHours: 8,
    coindcxNextFundingTime: defNext,
    settlementCycleLabel: "8h Cycle",
    payoutsPerDay: 3,
  };
}
