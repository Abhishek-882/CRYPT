import { NextRequest, NextResponse } from "next/server";
import { getCoinsCache, COINS_CACHE_TTL_MS, TESTNET_CACHE_TTL_MS } from "@/lib/coinsCache";
import { getDeterministicNextFundingTime } from "@/lib/settlementTime";
import { fetchFundingMetaMap } from "@/lib/exchangeFundingMeta";
import {
  subscribeBybitSymbols,
  getAllBybitTickers,
  getBybitTicker,
} from "@/lib/bybitStreamManager";
import { calculateDirectionalSpread } from "@/lib/spreadCalculation";
import { ContractIdentityResolver } from "@/lib/contractIdentityResolver";

export const dynamic = "force-dynamic";

export interface CoinArbitrageOpportunity {
  symbol: string;
  baseAsset: string;
  binanceRate: number; // in % format (e.g. 0.01000 for 0.01%)
  bitgetRate: number;  // in % format (e.g. -0.01000 for -0.01%)
  coindcxRate?: number | null; // in % format
  bybitRate?: number | null;   // in % format
  rateDiffPct: number; // directional spread in %
  spreadBps: number;   // spread in basis points (rateDiffPct * 100)
  annualizedApr: number;
  binanceMarkPrice: number;
  bitgetMarkPrice: number;
  bybitMarkPrice?: number | null;
  direction: "SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET";
  volume24h: number;
  nextFundingTime: number;
  fundingIntervalHours: number;
  settlementCycleLabel: string;
  payoutsPerDay: number;
  binanceIntervalHours?: number;
  bitgetIntervalHours?: number;
  isTestnetSupported: boolean;
  isCoinDcxSupported?: boolean;
  isBybitSupported?: boolean;
}

export interface ExchangeRankedCoin {
  symbol: string;
  baseAsset: string;
  exchange: "Binance" | "Bitget" | "CoinDCX" | "Bybit";
  fundingRate: number; // in % format
  markPrice: number;
  volume24h: number;
  isMutual: boolean;
  counterpartRate: number | null; // counter-exchange funding rate if mutual, or null
  spreadPct: number | null;        // directional spread if mutual, or null
  spreadBps: number | null;
  direction?: "SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET" | null;
  isTestnetSupported: boolean;
  isCoinDcxSupported?: boolean;
  isBybitSupported?: boolean;
  coindcxRate?: number | null;
  bybitRate?: number | null;
  bybitMarkPrice?: number | null;
  nextFundingTime?: number;
  fundingIntervalHours?: number;
  annualizedApr?: number;
  binanceRate?: number;
  bitgetRate?: number;
  binanceMarkPrice?: number;
  bitgetMarkPrice?: number;
  rateDiffPct?: number;
}

export interface BlacklistedCoin {
  symbol: string;
  baseAsset: string;
  exchange: "Binance" | "Bitget" | "Bybit";
  reason: string;
  fundingRate: number; // in % format
  markPrice: number;
  volume24h: number;
  isTestnetSupported: boolean;
  isCoinDcxSupported?: boolean;
  isBybitSupported?: boolean;
}

export interface MarketSummary {
  binanceTotal: number;
  bitgetTotal: number;
  mutualTotal: number;
  binanceOverThresholdTotal: number;
  bitgetOverThresholdTotal: number;
  blacklistedTotal: number;
  binanceOnlyTotal: number;
  bitgetOnlyTotal: number;
  coindcxTotal?: number;
  coindcxMutualTotal?: number;
  bybitTotal?: number;
  bybitMutualTotal?: number;
  blacklistedOverThresholdTotal?: number;
  fetchLatencyMs: number;
}

export interface CoinsApiResponse {
  success: boolean;
  count: number;
  cached: boolean;
  updatedAt: number;
  fetchLatencyMs: number;
  marketSummary: MarketSummary;
  coins: CoinArbitrageOpportunity[];
  binanceRanked: ExchangeRankedCoin[];
  bitgetRanked: ExchangeRankedCoin[];
  binanceOverThreshold: CoinArbitrageOpportunity[];
  bitgetOverThreshold: CoinArbitrageOpportunity[];
  blacklistedCoins: BlacklistedCoin[];
  coindcxRanked?: ExchangeRankedCoin[];
  bybitRanked?: ExchangeRankedCoin[];
  error?: string;
}

// In-memory cache structures
const coinsCache = getCoinsCache();


const CACHE_TTL_MS = COINS_CACHE_TTL_MS;

// Testnet symbols cache (valid for 15 minutes)

















async function getMutualDemoCryptoSymbols(): Promise<Set<string>> {
  const now = Date.now();
  if (coinsCache.cachedTestnetSymbols && now - coinsCache.lastTestnetFetch < TESTNET_CACHE_TTL_MS) {
    return coinsCache.cachedTestnetSymbols;
  }

  try {
    const [bRes, bgRes] = await Promise.all([
      fetch("https://testnet.binancefuture.com/fapi/v1/exchangeInfo", {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      }),
      fetch("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES", {
        headers: { "papertrading": "1", "paptrading": "1" },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      }),
    ]);
    const bData = await bRes.json().catch(() => ({}));
    const bgData = await bgRes.json().catch(() => ({}));

    // Filter strictly to standard crypto perpetuals
    const bCrypto = new Set(
      (bData.symbols || [])
        .filter((s: any) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.underlyingType === "COIN" && s.contractType === "PERPETUAL")
        .map((s: any) => s.symbol)
    );

    const bgList: string[] = (bgData?.data || []).map((c: any) => c.symbol);
    const mutual = new Set<string>();
    for (const sym of bgList) {
      if (bCrypto.has(sym)) {
        mutual.add(sym);
      }
    }

    if (mutual.size > 0) {
      coinsCache.cachedTestnetSymbols = mutual;
      coinsCache.lastTestnetFetch = now;
      return mutual;
    }
  } catch (err) {
    console.error("Failed to fetch mutual demo crypto symbols:", err);
  }

  const fallback = new Set([
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT",
    "ADAUSDT", "AVAXUSDT", "BCHUSDT", "BNBUSDT", "DOTUSDT",
    "LINKUSDT", "LTCUSDT", "NEARUSDT", "TRXUSDT", "UNIUSDT",
    "USDCUSDT", "HYPEUSDT"
  ]);
  coinsCache.cachedTestnetSymbols = fallback;
  coinsCache.lastTestnetFetch = now;
  return fallback;
}

async function fetchBinancePremiumIndex(): Promise<any[]> {
  const endpoints = [
    "https://www.binance.com/fapi/v1/premiumIndex",
    "https://fapi.binance.com/fapi/v1/premiumIndex",
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "FundingArbitrage/2.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    } catch (e: any) {
      coinsCache.lastUpstreamError = e;
    }
  }

  // Fallback to classic testnet only if both production endpoints fail
  try {
    const res = await fetch("https://testnet.binancefuture.com/fapi/v1/premiumIndex", {
      headers: { "User-Agent": "FundingArbitrage/2.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e: any) {
    coinsCache.lastUpstreamError = e;
  }

  return [];
}

async function fetchBitgetTickers(): Promise<any[]> {
  try {
    const res = await fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", {
      headers: { "User-Agent": "FundingArbitrage/2.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        return data.data;
      }
    }
  } catch (e: any) {
    coinsCache.lastUpstreamError = e;
  }
  return [];
}

async function fetchCoinDcxInstruments(): Promise<Set<string>> {
  try {
    const res = await fetch("https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments", {
      headers: { "User-Agent": "FundingArbitrage/2.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        return new Set(data.map((p: string) => p.replace(/^B-/, "").replace(/_USDT$/, "USDT")));
      }
    }
  } catch {}
  return new Set();
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  const searchParams = req.nextUrl?.searchParams;
  const forceRefresh = searchParams?.get("refresh") === "true";

  if (!forceRefresh && coinsCache.cachedResponse && now - coinsCache.lastFetchTime < CACHE_TTL_MS) {
    return NextResponse.json({
      ...coinsCache.cachedResponse,
      cached: true,
    });
  }

  const fetchStart = Date.now();
  coinsCache.lastUpstreamError = null; // Reset for new request

  try {
    const [binanceData, bitgetData, testnetSet, metaMap, coindcxSet] = await Promise.all([
      fetchBinancePremiumIndex(),
      fetchBitgetTickers(),
      getMutualDemoCryptoSymbols(),
      fetchFundingMetaMap(),
      fetchCoinDcxInstruments(),
    ]);

    const fetchLatencyMs = Date.now() - fetchStart;

    // Failover safeguard: retain cached response if both exchanges return empty, or return 500 on cold cache
    if (binanceData.length === 0 && bitgetData.length === 0) {
      if (coinsCache.cachedResponse) {
        const errDetail = coinsCache.lastUpstreamError && coinsCache.lastUpstreamError.message ? ' (' + coinsCache.lastUpstreamError.message + ')' : '';
        return NextResponse.json({
          ...coinsCache.cachedResponse,
          cached: true,
          updatedAt: coinsCache.lastFetchTime,
          error: 'Exchange endpoints returned empty or failed: serving cached market data' + errDetail,
        });
      }
      return NextResponse.json({
        success: false,
        error: coinsCache.lastUpstreamError && coinsCache.lastUpstreamError.message ? 'Upstream exchange endpoints failed: ' + coinsCache.lastUpstreamError.message : 'Exchange endpoints returned empty data',
        count: 0,
        cached: false,
        updatedAt: now,
        fetchLatencyMs: 0,
        marketSummary: {
          binanceTotal: 0,
          bitgetTotal: 0,
          mutualTotal: 0,
          binanceOverThresholdTotal: 0,
          bitgetOverThresholdTotal: 0,
          blacklistedTotal: 0,
          binanceOnlyTotal: 0,
          bitgetOnlyTotal: 0,
          coindcxTotal: 0,
          coindcxMutualTotal: 0,
          bybitTotal: 0,
          bybitMutualTotal: 0,
          fetchLatencyMs: 0,
        },
        coins: [],
        binanceRanked: [],
        bitgetRanked: [],
        coindcxRanked: [],
        bybitRanked: [],
        binanceOverThreshold: [],
        bitgetOverThreshold: [],
        blacklistedCoins: [],
      }, { status: 500 });
    }

    // Filter to USDT contracts
    const binanceMap = new Map<string, any>();
    for (const bn of binanceData) {
      if (bn.symbol && bn.symbol.endsWith("USDT")) {
        binanceMap.set(bn.symbol.toUpperCase(), bn);
      }
    }

    const bitgetMap = new Map<string, any>();
    for (const bg of bitgetData) {
      if (bg.symbol && bg.symbol.endsWith("USDT")) {
        bitgetMap.set(bg.symbol.toUpperCase(), bg);
      }
    }

    // Subscribe all active symbols to Bybit WebSocket stream
    const allSymbols = Array.from(new Set([
      ...binanceMap.keys(),
      ...bitgetMap.keys(),
      ...Array.from(coindcxSet),
    ]));
    if (allSymbols.length > 0) {
      subscribeBybitSymbols(allSymbols);
    }

    const opportunities: CoinArbitrageOpportunity[] = [];
    const THRESHOLD_PCT = 0.10; // 0.1% funding rate threshold

    // Process all contracts supported across at least 2 venues
    for (const sym of allSymbols) {
      if (ContractIdentityResolver.isTradFiOrEquity(sym)) continue;
      const bn = binanceMap.get(sym);
      const bg = bitgetMap.get(sym);
      const isCoinDcxSupported = coindcxSet.has(sym);
      const bybitTicker = getBybitTicker(sym);
      const isBybitSupported = Boolean(bybitTicker);

      // Require coin to be supported on at least 2 venues for arbitrage
      const supportedCount = (bn ? 1 : 0) + (bg ? 1 : 0) + (isCoinDcxSupported ? 1 : 0) + (isBybitSupported ? 1 : 0);
      if (supportedCount < 2) continue;

      const bnRateRaw = bn ? parseFloat(bn.lastFundingRate || "0") : null;
      const bgRateRaw = bg ? parseFloat(bg.fundingRate || "0") : null;

      const bnRate = bnRateRaw !== null ? parseFloat((bnRateRaw * 100).toFixed(5)) : 0;
      const bgRate = bgRateRaw !== null ? parseFloat((bgRateRaw * 100).toFixed(5)) : bnRate;

      const bnMark = bn ? parseFloat(bn.markPrice || "0") : (bybitTicker ? bybitTicker.markPrice : (bg ? parseFloat(bg.markPrice || bg.lastPr || "0") : 0));
      const bgMark = bg ? (parseFloat(bg.markPrice || bg.lastPr || "0") || bnMark) : bnMark;

      const coindcxRate = isCoinDcxSupported ? (bnRateRaw !== null ? parseFloat((bnRateRaw * 100).toFixed(5)) : bgRate) : null;
      const bybitRate = bybitTicker ? bybitTicker.fundingRatePct : null;
      const bybitMark = bybitTicker ? bybitTicker.markPrice : null;

      // Primary spread benchmark: BN vs BG if both exist, else best available pair
      let rateDiffPct = 0;
      if (bn && bg) {
        rateDiffPct = calculateDirectionalSpread(bnRate, bgRate);
      } else if (bn && isBybitSupported && bybitRate !== null) {
        rateDiffPct = calculateDirectionalSpread(bnRate, bybitRate);
      } else if (bg && isBybitSupported && bybitRate !== null) {
        rateDiffPct = calculateDirectionalSpread(bgRate, bybitRate);
      } else if (isCoinDcxSupported && isBybitSupported && bybitRate !== null) {
        rateDiffPct = calculateDirectionalSpread(coindcxRate ?? 0, bybitRate);
      }

      const spreadBps = parseFloat((rateDiffPct * 100).toFixed(2));

      // Resolve funding interval metadata (4h, 8h, 1h)
      const meta = metaMap.get(sym);
      const effInterval = meta?.fundingIntervalHours || (bybitTicker ? bybitTicker.fundingIntervalHours : 8) || 8;
      const payoutsPerDay = meta?.payoutsPerDay || (24 / effInterval);
      const annualizedApr = parseFloat((rateDiffPct * payoutsPerDay * 365).toFixed(2));

      const direction: "SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET" =
        bnRate >= bgRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET";

      const vol24h = parseFloat(bg?.quoteVolume || bg?.usdtVolume || bn?.quoteVolume || (bybitTicker ? String(bybitTicker.volume24h) : "0"));
      const baseAsset = sym.replace(/^1000/, "").replace("USDT", "");
      const isTestnetSupported = testnetSet.size > 0 ? testnetSet.has(sym) : true;

      // Settlement countdown timestamp
      const rawBnNext = parseInt(bn?.nextFundingTime || "0", 10);
      const bgNext = meta?.bitgetNextUpdate || 0;
      const byNext = bybitTicker?.nextFundingTime || 0;
      let nextFundingTime = 0;

      const futureTimes = [rawBnNext, bgNext, byNext].filter((t) => t > now);
      if (futureTimes.length > 0) {
        nextFundingTime = Math.min(...futureTimes);
      } else {
        nextFundingTime = getDeterministicNextFundingTime(now, effInterval);
      }

      opportunities.push({
        symbol: sym,
        baseAsset,
        binanceRate: bn ? bnRate : (coindcxRate ?? 0),
        bitgetRate: bg ? bgRate : (bybitRate ?? bnRate),
        rateDiffPct,
        spreadBps,
        annualizedApr,
        binanceMarkPrice: bnMark,
        bitgetMarkPrice: bgMark > 0 ? bgMark : bnMark,
        direction,
        volume24h: Math.round(vol24h),
        nextFundingTime,
        fundingIntervalHours: effInterval,
        settlementCycleLabel: meta?.settlementCycleLabel || `${effInterval}h Cycle`,
        payoutsPerDay,
        binanceIntervalHours: meta?.binanceIntervalHours || 8,
        bitgetIntervalHours: meta?.bitgetIntervalHours || 8,
        isTestnetSupported,
        isCoinDcxSupported,
        coindcxRate,
        isBybitSupported,
        bybitRate,
        bybitMarkPrice: bybitMark,
      });
    }

    // Sort mutual opportunities by highest directional spread descending
    opportunities.sort((a, b) => {
      if (Math.abs(b.rateDiffPct - a.rateDiffPct) > 0.00001) {
        return b.rateDiffPct - a.rateDiffPct;
      }
      return b.volume24h - a.volume24h;
    });

    // 1. Binance pure ranked (all Binance contracts ranked by funding rate descending)
    const binanceRanked: ExchangeRankedCoin[] = [];
    for (const [sym, bn] of binanceMap.entries()) {
      const bnRateRaw = parseFloat(bn.lastFundingRate || "0");
      const bnRate = parseFloat((bnRateRaw * 100).toFixed(5));
      const bnMark = parseFloat(bn.markPrice || "0");
      const bg = bitgetMap.get(sym);
      const isMutual = Boolean(bg);
      const bgRateRaw = bg ? parseFloat(bg.fundingRate || "0") : null;
      const bgRate = bgRateRaw !== null ? parseFloat((bgRateRaw * 100).toFixed(5)) : null;
      const bgMark = bg ? (parseFloat(bg.markPrice || bg.lastPr || "0") || bnMark) : bnMark;
      const spreadPct = bgRate !== null ? calculateDirectionalSpread(bnRate, bgRate) : null;
      const spreadBps = spreadPct !== null ? parseFloat((spreadPct * 100).toFixed(2)) : null;
      const direction = bgRate !== null
        ? (bnRate >= bgRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET")
        : null;
      const vol24h = bg ? parseFloat(bg.quoteVolume || bg.usdtVolume || "0") : 0;
      const meta = metaMap.get(sym);
      const effInterval = meta?.fundingIntervalHours || 8;
      const payoutsPerDay = meta?.payoutsPerDay || (24 / effInterval);
      const annualizedApr = spreadPct !== null ? parseFloat((spreadPct * payoutsPerDay * 365).toFixed(2)) : 0;
      const rawBnNext = parseInt(bn.nextFundingTime || "0", 10);
      const nextFundingTime = rawBnNext > now ? rawBnNext : getDeterministicNextFundingTime(now, effInterval);

      binanceRanked.push({
        symbol: sym,
        baseAsset: sym.replace("USDT", ""),
        exchange: "Binance",
        fundingRate: bnRate,
        markPrice: bnMark,
        volume24h: Math.round(vol24h),
        isMutual,
        counterpartRate: bgRate,
        spreadPct,
        spreadBps,
        direction,
        isTestnetSupported: testnetSet.has(sym),
        isCoinDcxSupported: coindcxSet.has(sym),
        isBybitSupported: Boolean(getBybitTicker(sym)),
        bybitRate: getBybitTicker(sym)?.fundingRatePct ?? null,
        bybitMarkPrice: getBybitTicker(sym)?.markPrice ?? null,
        fundingIntervalHours: effInterval,
        nextFundingTime,
        annualizedApr,
        binanceRate: bnRate,
        bitgetRate: bgRate !== null ? bgRate : 0,
        binanceMarkPrice: bnMark,
        bitgetMarkPrice: bgMark,
        rateDiffPct: spreadPct !== null ? spreadPct : 0,
      });
    }
    binanceRanked.sort((a, b) => {
      if (Math.abs(b.fundingRate - a.fundingRate) > 0.00001) {
        return b.fundingRate - a.fundingRate; // pure funding rate descending
      }
      return b.volume24h - a.volume24h;
    });

    // 2. Bitget pure ranked (all Bitget contracts ranked by funding rate descending)
    const bitgetRanked: ExchangeRankedCoin[] = [];
    for (const [sym, bg] of bitgetMap.entries()) {
      const bgRateRaw = parseFloat(bg.fundingRate || "0");
      const bgRate = parseFloat((bgRateRaw * 100).toFixed(5));
      const bgMark = parseFloat(bg.markPrice || bg.lastPr || "0");
      const bn = binanceMap.get(sym);
      const isMutual = Boolean(bn);
      const bnRateRaw = bn ? parseFloat(bn.lastFundingRate || "0") : null;
      const bnRate = bnRateRaw !== null ? parseFloat((bnRateRaw * 100).toFixed(5)) : null;
      const bnMark = bn ? parseFloat(bn.markPrice || "0") : bgMark;
      const spreadPct = bnRate !== null ? calculateDirectionalSpread(bnRate, bgRate) : null;
      const spreadBps = spreadPct !== null ? parseFloat((spreadPct * 100).toFixed(2)) : null;
      const direction = bnRate !== null
        ? (bnRate >= bgRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET")
        : null;
      const vol24h = parseFloat(bg.quoteVolume || bg.usdtVolume || "0");
      const meta = metaMap.get(sym);
      const effInterval = meta?.fundingIntervalHours || 8;
      const payoutsPerDay = meta?.payoutsPerDay || (24 / effInterval);
      const annualizedApr = spreadPct !== null ? parseFloat((spreadPct * payoutsPerDay * 365).toFixed(2)) : 0;
      const bgNext = meta?.bitgetNextUpdate || 0;
      const rawBnNext = bn ? parseInt(bn.nextFundingTime || "0", 10) : 0;
      let nextFundingTime = 0;
      if (bgNext > now) nextFundingTime = bgNext;
      else if (rawBnNext > now) nextFundingTime = rawBnNext;
      else nextFundingTime = getDeterministicNextFundingTime(now, effInterval);

      bitgetRanked.push({
        symbol: sym,
        baseAsset: sym.replace("USDT", ""),
        exchange: "Bitget",
        fundingRate: bgRate,
        markPrice: bgMark,
        volume24h: Math.round(vol24h),
        isMutual,
        counterpartRate: bnRate,
        spreadPct,
        spreadBps,
        direction,
        isTestnetSupported: testnetSet.has(sym),
        isCoinDcxSupported: coindcxSet.has(sym),
        isBybitSupported: Boolean(getBybitTicker(sym)),
        bybitRate: getBybitTicker(sym)?.fundingRatePct ?? null,
        bybitMarkPrice: getBybitTicker(sym)?.markPrice ?? null,
        fundingIntervalHours: effInterval,
        nextFundingTime,
        annualizedApr,
        binanceRate: bnRate !== null ? bnRate : 0,
        bitgetRate: bgRate,
        binanceMarkPrice: bnMark,
        bitgetMarkPrice: bgMark,
        rateDiffPct: spreadPct !== null ? spreadPct : 0,
      });
    }
    bitgetRanked.sort((a, b) => {
      if (Math.abs(b.fundingRate - a.fundingRate) > 0.00001) {
        return b.fundingRate - a.fundingRate; // pure funding rate descending
      }
      return b.volume24h - a.volume24h;
    });

    // 3. Binance >= 0.1% threshold (|Rate_BN| >= 0.10%), matched with Bitget and ranked by spread
    const binanceOverThreshold = opportunities
      .filter((c) => Math.abs(c.binanceRate) >= THRESHOLD_PCT)
      .sort((a, b) => {
        if (Math.abs(b.rateDiffPct - a.rateDiffPct) > 0.00001) return b.rateDiffPct - a.rateDiffPct;
        return b.volume24h - a.volume24h;
      });

    // 4. Bitget >= 0.1% threshold (|Rate_BG| >= 0.10%), matched with Binance and ranked by spread
    const bitgetOverThreshold = opportunities
      .filter((c) => Math.abs(c.bitgetRate) >= THRESHOLD_PCT)
      .sort((a, b) => {
        if (Math.abs(b.rateDiffPct - a.rateDiffPct) > 0.00001) return b.rateDiffPct - a.rateDiffPct;
        return b.volume24h - a.volume24h;
      });

    // 5. Blacklisted Single-Exchange contracts (excluded from spread calculations)
    const blacklistedCoins: BlacklistedCoin[] = [];
    let binanceOnlyCount = 0;
    let bitgetOnlyCount = 0;

    for (const [sym, bn] of binanceMap.entries()) {
      if (!bitgetMap.has(sym)) {
        binanceOnlyCount++;
        const bnRateRaw = parseFloat(bn.lastFundingRate || "0");
        const bnMark = parseFloat(bn.markPrice || "0");
        blacklistedCoins.push({
          symbol: sym,
          baseAsset: sym.replace("USDT", ""),
          exchange: "Binance",
          reason: "Only listed on Binance (Bitget counter-leg unavailable)",
          fundingRate: parseFloat((bnRateRaw * 100).toFixed(5)),
          markPrice: bnMark,
          volume24h: 0,
          isTestnetSupported: testnetSet.has(sym),
          isCoinDcxSupported: coindcxSet.has(sym),
          isBybitSupported: Boolean(getBybitTicker(sym)),
        });
      }
    }

    for (const [sym, bg] of bitgetMap.entries()) {
      if (!binanceMap.has(sym)) {
        bitgetOnlyCount++;
        const bgRateRaw = parseFloat(bg.fundingRate || "0");
        const bgMark = parseFloat(bg.markPrice || bg.lastPr || "0");
        const vol24h = parseFloat(bg.quoteVolume || bg.usdtVolume || "0");
        blacklistedCoins.push({
          symbol: sym,
          baseAsset: sym.replace("USDT", ""),
          exchange: "Bitget",
          reason: "Only listed on Bitget (Binance counter-leg unavailable)",
          fundingRate: parseFloat((bgRateRaw * 100).toFixed(5)),
          markPrice: bgMark,
          volume24h: Math.round(vol24h),
          isTestnetSupported: testnetSet.has(sym),
          isCoinDcxSupported: coindcxSet.has(sym),
          isBybitSupported: Boolean(getBybitTicker(sym)),
        });
      }
    }

    blacklistedCoins.sort((a, b) => {
      if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
      return Math.abs(b.fundingRate) - Math.abs(a.fundingRate);
    });

    let blacklistedOverThresholdCount = 0;
    for (const bl of blacklistedCoins) {
      if (Math.abs(bl.fundingRate) >= THRESHOLD_PCT) {
        blacklistedOverThresholdCount++;
      }
    }

    const allBybitMap = getAllBybitTickers();

    const marketSummary: MarketSummary = {
      binanceTotal: binanceMap.size,
      bitgetTotal: bitgetMap.size,
      mutualTotal: opportunities.length,
      binanceOverThresholdTotal: binanceOverThreshold.length,
      bitgetOverThresholdTotal: bitgetOverThreshold.length,
      blacklistedTotal: blacklistedCoins.length,
      binanceOnlyTotal: binanceOnlyCount,
      bitgetOnlyTotal: bitgetOnlyCount,
      coindcxTotal: coindcxSet.size,
      coindcxMutualTotal: opportunities.filter((o) => o.isCoinDcxSupported).length,
      bybitTotal: allBybitMap.size,
      bybitMutualTotal: opportunities.filter((o) => o.isBybitSupported).length,
      blacklistedOverThresholdTotal: blacklistedOverThresholdCount,
      fetchLatencyMs,
    };

    // CoinDCX pure ranked (all CoinDCX-supported contracts ranked by CoinDCX funding rate descending)
    const coindcxRanked: ExchangeRankedCoin[] = [];
    for (const [sym, bn] of binanceMap.entries()) {
      if (!coindcxSet.has(sym)) continue;
      const bnRateRaw = parseFloat(bn.lastFundingRate || "0");
      const cdxRate = parseFloat((bnRateRaw * 100).toFixed(5));
      const bnMark = parseFloat(bn.markPrice || "0");
      const bg = bitgetMap.get(sym);
      const isMutual = Boolean(bg);
      const bgRateRaw = bg ? parseFloat(bg.fundingRate || "0") : null;
      const bgRate = bgRateRaw !== null ? parseFloat((bgRateRaw * 100).toFixed(5)) : null;
      const bgMark = bg ? (parseFloat(bg.markPrice || bg.lastPr || "0") || bnMark) : bnMark;
      const spreadPct = bgRate !== null ? calculateDirectionalSpread(cdxRate, bgRate) : null;
      const spreadBps = spreadPct !== null ? parseFloat((spreadPct * 100).toFixed(2)) : null;
      const direction = bgRate !== null
        ? (cdxRate >= bgRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET")
        : null;
      const vol24h = bg ? parseFloat(bg.quoteVolume || bg.usdtVolume || "0") : 0;
      const meta = metaMap.get(sym);
      const effInterval = meta?.fundingIntervalHours || 8;
      const payoutsPerDay = meta?.payoutsPerDay || (24 / effInterval);
      const annualizedApr = spreadPct !== null ? parseFloat((spreadPct * payoutsPerDay * 365).toFixed(2)) : 0;
      const rawBnNext = parseInt(bn.nextFundingTime || "0", 10);
      const nextFundingTime = rawBnNext > now ? rawBnNext : getDeterministicNextFundingTime(now, effInterval);

      coindcxRanked.push({
        symbol: sym,
        baseAsset: sym.replace("USDT", ""),
        exchange: "CoinDCX",
        fundingRate: cdxRate,
        markPrice: bnMark,
        volume24h: Math.round(vol24h),
        isMutual,
        counterpartRate: bgRate,
        spreadPct,
        spreadBps,
        direction,
        isTestnetSupported: testnetSet.has(sym),
        isCoinDcxSupported: true,
        isBybitSupported: Boolean(getBybitTicker(sym)),
        coindcxRate: cdxRate,
        bybitRate: getBybitTicker(sym)?.fundingRatePct ?? null,
        bybitMarkPrice: getBybitTicker(sym)?.markPrice ?? null,
        fundingIntervalHours: effInterval,
        nextFundingTime,
        annualizedApr,
        binanceRate: cdxRate,
        bitgetRate: bgRate !== null ? bgRate : 0,
        binanceMarkPrice: bnMark,
        bitgetMarkPrice: bgMark,
        rateDiffPct: spreadPct !== null ? spreadPct : 0,
      });
    }
    coindcxRanked.sort((a, b) => {
      if (Math.abs(b.fundingRate - a.fundingRate) > 0.00001) {
        return b.fundingRate - a.fundingRate; // pure CoinDCX funding rate descending
      }
      return b.volume24h - a.volume24h;
    });

    // Bybit pure ranked (all Bybit contracts ranked by funding rate descending)
    const bybitRanked: ExchangeRankedCoin[] = [];
    for (const [sym, bybitData] of allBybitMap.entries()) {
      if (ContractIdentityResolver.isTradFiOrEquity(sym)) continue;
      const baseAsset = sym.replace(/^1000/, "").replace(/USDT$/, "");
      const bybitRate = bybitData.fundingRatePct;
      const bybitMark = bybitData.markPrice;
      const bnSym = ContractIdentityResolver.resolveEquivalentSymbol(sym, "bybit", "binance");
      const bn = bnSym ? binanceMap.get(bnSym) : null;
      const bg = bitgetMap.get(sym) || bitgetMap.get(sym.replace(/^1000/, ""));
      if (bn && bybitMark > 0 && bn.markPrice) {
        const bnMark = parseFloat(bn.markPrice || "0");
        const parity = ContractIdentityResolver.validateParity(bnSym || sym, bnMark, sym, bybitMark);
        if (!parity.valid) continue;
      }
      const isMutual = Boolean(bn || bg);

      const counterpartRate = bn
        ? parseFloat((parseFloat(bn.lastFundingRate || "0") * 100).toFixed(5))
        : bg
        ? parseFloat((parseFloat(bg.fundingRate || "0") * 100).toFixed(5))
        : null;

      const spreadPct = counterpartRate !== null ? calculateDirectionalSpread(bybitRate, counterpartRate) : null;
      const spreadBps = spreadPct !== null ? parseFloat((spreadPct * 100).toFixed(2)) : null;
      const direction = counterpartRate !== null
        ? (bybitRate >= counterpartRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET")
        : null;

      const vol24h = bybitData.volume24h || 0;
      const effInterval = bybitData.fundingIntervalHours || 8;
      const payoutsPerDay = 24 / effInterval;
      const annualizedApr = spreadPct !== null ? parseFloat((spreadPct * payoutsPerDay * 365).toFixed(2)) : 0;
      const nextFundingTime = bybitData.nextFundingTime > now
        ? bybitData.nextFundingTime
        : getDeterministicNextFundingTime(now, effInterval);

      bybitRanked.push({
        symbol: sym,
        baseAsset,
        exchange: "Bybit",
        fundingRate: bybitRate,
        markPrice: bybitMark,
        volume24h: Math.round(vol24h),
        isMutual,
        counterpartRate,
        spreadPct,
        spreadBps,
        direction,
        isTestnetSupported: testnetSet.has(sym),
        isCoinDcxSupported: coindcxSet.has(sym),
        isBybitSupported: true,
        bybitRate,
        bybitMarkPrice: bybitMark,
        fundingIntervalHours: effInterval,
        nextFundingTime,
        annualizedApr,
        binanceRate: bn ? parseFloat((parseFloat(bn.lastFundingRate || "0") * 100).toFixed(5)) : 0,
        bitgetRate: bg ? parseFloat((parseFloat(bg.fundingRate || "0") * 100).toFixed(5)) : 0,
        binanceMarkPrice: bn ? parseFloat(bn.markPrice || "0") : bybitMark,
        bitgetMarkPrice: bg ? (parseFloat(bg.markPrice || bg.lastPr || "0") || bybitMark) : bybitMark,
        rateDiffPct: spreadPct !== null ? spreadPct : 0,
      });
    }
    bybitRanked.sort((a, b) => {
      if (Math.abs(b.fundingRate - a.fundingRate) > 0.00001) {
        return b.fundingRate - a.fundingRate; // pure Bybit funding rate descending
      }
      return b.volume24h - a.volume24h;
    });

    const responsePayload: CoinsApiResponse = {
      success: true,
      count: opportunities.length,
      cached: false,
      updatedAt: now,
      fetchLatencyMs,
      marketSummary,
      coins: opportunities,
      binanceRanked,
      bitgetRanked,
      binanceOverThreshold,
      bitgetOverThreshold,
      blacklistedCoins,
      coindcxRanked,
      bybitRanked,
    };

    coinsCache.cachedResponse = responsePayload;
    coinsCache.lastFetchTime = now;

    return NextResponse.json(responsePayload);
  } catch (err: any) {
    if (coinsCache.cachedResponse) {
      return NextResponse.json({
        ...coinsCache.cachedResponse,
        cached: true,
        error: `Transient fetch error: ${err.message}`,
      });
    }

    return NextResponse.json({
      success: false,
      error: err.message,
      count: 0,
      cached: false,
      updatedAt: now,
      fetchLatencyMs: 0,
      marketSummary: {
        binanceTotal: 0,
        bitgetTotal: 0,
        mutualTotal: 0,
        binanceOverThresholdTotal: 0,
        bitgetOverThresholdTotal: 0,
        blacklistedTotal: 0,
        binanceOnlyTotal: 0,
        bitgetOnlyTotal: 0,
        coindcxTotal: 0,
        coindcxMutualTotal: 0,
        bybitTotal: 0,
        bybitMutualTotal: 0,
        fetchLatencyMs: 0,
      },
      coins: [],
      binanceRanked: [],
      bitgetRanked: [],
      coindcxRanked: [],
      bybitRanked: [],
      binanceOverThreshold: [],
      bitgetOverThreshold: [],
      blacklistedCoins: [],
    }, { status: 500 });
  }
}
