"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Zap,
  Clock,
  ShieldAlert,
  Check,
  ChevronDown,
  ChevronUp,
  Shield,
  Layers,
  Lock,
  SlidersHorizontal,
  Info,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { getDeterministicNextFundingTime, formatCountdown } from "@/lib/settlementTime";
import {
  calculateDirectionalSpread,
  evaluatePairwiseArbitrage,
  VenueRateInfo,
  PairwiseCombination,
  BestArbitrageResult,
} from "@/lib/spreadCalculation";

export interface CoinOpportunity {
  symbol: string;
  baseAsset: string;
  binanceRate: number;
  bitgetRate: number;
  coindcxRate?: number | null;
  bybitRate?: number | null;
  rateDiffPct?: number;
  spreadBps: number;
  annualizedApr: number;
  binanceMarkPrice: number;
  bitgetMarkPrice: number;
  bybitMarkPrice?: number | null;
  direction: "SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET";
  volume24h: number;
  nextFundingTime: number;
  fundingIntervalHours?: number;
  settlementCycleLabel?: string;
  payoutsPerDay?: number;
  isTestnetSupported?: boolean;
  isCoinDcxSupported?: boolean;
  isBybitSupported?: boolean;
  bestPair?: PairwiseCombination | null;
  allPairs?: PairwiseCombination[];
  winningBadgeA?: string;
  winningBadgeB?: string;
  winningVenueA?: string;
  winningVenueB?: string;
}

export interface ExchangeRankedCoin {
  symbol: string;
  baseAsset: string;
  exchange: "Binance" | "Bitget" | "CoinDCX" | "Bybit";
  fundingRate: number;
  markPrice: number;
  volume24h: number;
  isMutual: boolean;
  counterpartRate: number | null;
  spreadPct: number | null;
  spreadBps: number | null;
  direction?: "SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET" | null;
  isTestnetSupported: boolean;
  isCoinDcxSupported?: boolean;
  isBybitSupported?: boolean;
  nextFundingTime?: number;
  fundingIntervalHours?: number;
  annualizedApr?: number;
  binanceRate?: number;
  bitgetRate?: number;
  binanceMarkPrice?: number;
  bitgetMarkPrice?: number;
  rateDiffPct?: number;
  coindcxRate?: number;
  bybitRate?: number;
  bybitMarkPrice?: number;
}

export interface BlacklistedCoin {
  symbol: string;
  baseAsset: string;
  exchange: "Binance" | "Bitget" | "Bybit";
  reason: string;
  fundingRate: number;
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

interface AllCoinsScannerProps {
  onSelectCoin: (
    symbol: string,
    direction?: "SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET",
    coin?: any
  ) => void;
  selectedSymbol?: string;
  onTradeExecuted?: (trade: any) => void;
  getVaultHeaders?: () => Record<string, string>;
  tradingMode?: "paper" | "testnet" | "mainnet";
  isMainnetArmed?: boolean;
  onRequestMainnetConfirm?: (tradeParams: any) => void;
  onExchangesChange?: (exchanges: SelectedExchanges, venueA: string, venueB: string) => void;
  activeVenueA?: string;
  activeVenueB?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export type ExchangeKey = "binance" | "coindcx" | "bitget" | "bybit";

export interface SelectedExchanges {
  binance: boolean;
  coindcx: boolean;
  bitget: boolean;
  bybit: boolean;
}

export default function AllCoinsScanner({
  onSelectCoin,
  selectedSymbol,
  onTradeExecuted,
  getVaultHeaders,
  tradingMode = "paper",
  isMainnetArmed = false,
  onRequestMainnetConfirm,
  onExchangesChange,
  activeVenueA,
  activeVenueB,
  isExpanded = true,
  onToggleExpand,
}: AllCoinsScannerProps) {
  // Datasets from API
  const [mutualCoins, setMutualCoins] = useState<CoinOpportunity[]>([]);
  const [binanceRanked, setBinanceRanked] = useState<ExchangeRankedCoin[]>([]);
  const [bitgetRanked, setBitgetRanked] = useState<ExchangeRankedCoin[]>([]);
  const [coindcxRanked, setCoindcxRanked] = useState<ExchangeRankedCoin[]>([]);
  const [bybitRanked, setBybitRanked] = useState<ExchangeRankedCoin[]>([]);
  const [blacklistedCoins, setBlacklistedCoins] = useState<BlacklistedCoin[]>([]);
  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);
  const [fetchLatencyMs, setFetchLatencyMs] = useState<number>(0);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Clean 5 Options Exchange Selection State
  // 1st: Binance | 2nd: CoinDCX | 3rd: Bitget | 4th: Bybit | 5th: All Exchanges
  const [selectedExchanges, setSelectedExchanges] = useState<SelectedExchanges>({
    binance: true,
    coindcx: true,
    bitget: true,
    bybit: true,
  });

  const [sortBy, setSortBy] = useState<"spread" | "funding" | "bitgetRate" | "coindcxRate" | "bybitRate" | "counterpart" | "apr" | "countdown" | "volume" | "symbol">("spread");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [displayLimit, setDisplayLimit] = useState<number>(50);

  // 1-Click Quick Hedge Execution State
  const [executingSymbol, setExecutingSymbol] = useState<string | null>(null);
  const [filledSymbol, setFilledSymbol] = useState<string | null>(null);
  const [errorFeedback, setErrorFeedback] = useState<{ symbol: string; message: string } | null>(null);
  const [errorSymbol, setErrorSymbol] = useState<string | null>(null);
  const [guardAlert, setGuardAlert] = useState<{ symbol: string; message: string } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [expandedCoins, setExpandedCoins] = useState<Set<string>>(new Set());

  const toggleCoinAccordion = (symbol: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedCoins((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  // Active exchange metrics
  const activeExchangeCount =
    (selectedExchanges.binance ? 1 : 0) +
    (selectedExchanges.coindcx ? 1 : 0) +
    (selectedExchanges.bitget ? 1 : 0) +
    (selectedExchanges.bybit ? 1 : 0);

  const isAllSelected =
    selectedExchanges.binance &&
    selectedExchanges.coindcx &&
    selectedExchanges.bitget &&
    selectedExchanges.bybit;

  // Single active exchange key when activeExchangeCount === 1
  const singleExchangeKey: ExchangeKey = selectedExchanges.binance
    ? "binance"
    : selectedExchanges.coindcx
    ? "coindcx"
    : selectedExchanges.bitget
    ? "bitget"
    : "bybit";

  // Live 1-second ticker for settlement countdowns
  useEffect(() => {
    const tick = setInterval(() => {
      if (!document.hidden) {
        setCurrentTime(Date.now());
      }
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const fetchAllMarketData = useCallback(async (isManualRefresh = false) => {
    if (document.hidden && !isManualRefresh) return;
    try {
      const url = isManualRefresh ? "/api/coins?refresh=true" : "/api/coins";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();

      if (data.success && Array.isArray(data.coins)) {
        setMutualCoins(data.coins || []);
        setBinanceRanked(data.binanceRanked || []);
        setBitgetRanked(data.bitgetRanked || []);
        setCoindcxRanked(data.coindcxRanked || []);
        if (data.bybitRanked) setBybitRanked(data.bybitRanked || []);
        setBlacklistedCoins(data.blacklistedCoins || []);
        if (data.marketSummary) setMarketSummary(data.marketSummary);
        if (data.fetchLatencyMs) setFetchLatencyMs(data.fetchLatencyMs);
        setError(null);
      } else {
        if (mutualCoins.length === 0) {
          setError(data.error || "Failed to load market scanner");
        }
      }
    } catch (err: any) {
      if (mutualCoins.length === 0) {
        setError(err.message || "Network error loading market data");
      }
    } finally {
      setIsLoading(false);
    }
  }, [mutualCoins.length]);

  useEffect(() => {
    fetchAllMarketData();
    const interval = setInterval(() => {
      if (!document.hidden) fetchAllMarketData();
    }, 6000);
    return () => clearInterval(interval);
  }, [fetchAllMarketData]);

  // Handle column header sort toggle
  const handleSortToggle = (column: "spread" | "funding" | "bitgetRate" | "coindcxRate" | "bybitRate" | "counterpart" | "apr" | "countdown" | "volume" | "symbol") => {
    if (sortBy === column) {
      setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(column);
      setSortDirection("desc");
    }
  };

  // Helper to resolve active corridor pair from selected exchanges
  const resolveActiveVenues = useCallback((exchanges: SelectedExchanges): { venueA: string; venueB: string } => {
    const active: string[] = [];
    if (exchanges.binance) active.push("Binance");
    if (exchanges.coindcx) active.push("CoinDCX");
    if (exchanges.bitget) active.push("Bitget");
    if (exchanges.bybit) active.push("Bybit");

    if (active.length === 2) {
      return { venueA: active[0], venueB: active[1] };
    }
    if (active.length === 1) {
      const solo = active[0];
      const counterpart = solo === "Bybit" ? "CoinDCX" : solo === "CoinDCX" ? "Bybit" : solo === "Binance" ? "Bitget" : "Binance";
      return { venueA: solo, venueB: counterpart };
    }
    // Multi-exchange (3 or 4) - default to CoinDCX + Bybit (Primary Real USD Corridor)
    return { venueA: "CoinDCX", venueB: "Bybit" };
  }, []);

  const emitExchangesChange = useCallback((next: SelectedExchanges) => {
    if (onExchangesChange) {
      const { venueA, venueB } = resolveActiveVenues(next);
      onExchangesChange(next, venueA, venueB);
    }
  }, [onExchangesChange, resolveActiveVenues]);

  // Toggle selection for an exchange
  const handleToggleExchange = (key: ExchangeKey) => {
    let next: SelectedExchanges;
    if (isAllSelected) {
      // If all are selected, clicking one isolates that single exchange
      next = {
        binance: key === "binance",
        coindcx: key === "coindcx",
        bitget: key === "bitget",
        bybit: key === "bybit",
      };
    } else if (selectedExchanges[key]) {
      // Already selected; deselect only if at least 1 remains selected
      if (activeExchangeCount > 1) {
        next = { ...selectedExchanges, [key]: false };
      } else {
        next = selectedExchanges;
      }
    } else {
      // Turn this exchange ON
      next = { ...selectedExchanges, [key]: true };
    }
    setSelectedExchanges(next);
    emitExchangesChange(next);
  };

  // Solo select an exchange in 1 click
  const handleSoloExchange = (key: ExchangeKey) => {
    const next = {
      binance: key === "binance",
      coindcx: key === "coindcx",
      bitget: key === "bitget",
      bybit: key === "bybit",
    };
    setSelectedExchanges(next);
    emitExchangesChange(next);
  };

  // Select all exchanges (All Exchanges button)
  const handleSelectAllExchanges = () => {
    const next = { binance: true, coindcx: true, bitget: true, bybit: true };
    setSelectedExchanges(next);
    emitExchangesChange(next);
  };

  // Dual exchange metadata and items computation
  const dualConfig = useMemo(() => {
    if (activeExchangeCount !== 2) return null;

    if (selectedExchanges.binance && selectedExchanges.bitget) {
      return {
        labelA: "Binance",
        labelB: "Bitget",
        colorA: "text-amber-400",
        colorB: "text-cyan-400",
        badgeA: "🟡",
        badgeB: "🔵",
        keyA: "binanceRate",
        keyB: "bitgetRate",
      };
    }
    if (selectedExchanges.coindcx && selectedExchanges.bitget) {
      return {
        labelA: "CoinDCX",
        labelB: "Bitget",
        colorA: "text-purple-400",
        colorB: "text-cyan-400",
        badgeA: "🟣",
        badgeB: "🔵",
        keyA: "coindcxRate",
        keyB: "bitgetRate",
      };
    }
    if (selectedExchanges.binance && selectedExchanges.coindcx) {
      return {
        labelA: "Binance",
        labelB: "CoinDCX",
        colorA: "text-amber-400",
        colorB: "text-purple-400",
        badgeA: "🟡",
        badgeB: "🟣",
        keyA: "binanceRate",
        keyB: "coindcxRate",
      };
    }
    if (selectedExchanges.binance && selectedExchanges.bybit) {
      return {
        labelA: "Binance",
        labelB: "Bybit",
        colorA: "text-amber-400",
        colorB: "text-orange-400",
        badgeA: "🟡",
        badgeB: "🟧",
        keyA: "binanceRate",
        keyB: "bybitRate",
      };
    }
    if (selectedExchanges.coindcx && selectedExchanges.bybit) {
      return {
        labelA: "CoinDCX",
        labelB: "Bybit",
        colorA: "text-purple-400",
        colorB: "text-orange-400",
        badgeA: "🟣",
        badgeB: "🟧",
        keyA: "coindcxRate",
        keyB: "bybitRate",
      };
    }
    if (selectedExchanges.bitget && selectedExchanges.bybit) {
      return {
        labelA: "Bitget",
        labelB: "Bybit",
        colorA: "text-cyan-400",
        colorB: "text-orange-400",
        badgeA: "🔵",
        badgeB: "🟧",
        keyA: "bitgetRate",
        keyB: "bybitRate",
      };
    }
    return null;
  }, [activeExchangeCount, selectedExchanges]);

  // Compute items based on selected venue count
  const rawDataset = useMemo(() => {
    // CASE 1: Single Exchange Selected
    if (activeExchangeCount === 1) {
      if (selectedExchanges.binance) return binanceRanked;
      if (selectedExchanges.coindcx) return coindcxRanked;
      if (selectedExchanges.bitget) return bitgetRanked;
      return bybitRanked;
    }

    // CASE 2: Two Exchanges Selected
    if (activeExchangeCount === 2) {
      // 2A: Binance + Bitget
      if (selectedExchanges.binance && selectedExchanges.bitget) {
        return mutualCoins.map((c) => ({
          ...c,
          rateA: c.binanceRate,
          rateB: c.bitgetRate,
          diffPct: c.rateDiffPct ?? calculateDirectionalSpread(c.binanceRate, c.bitgetRate),
          spreadBps: c.spreadBps ?? parseFloat(((c.rateDiffPct ?? 0) * 100).toFixed(2)),
          directionLabel: c.binanceRate >= c.bitgetRate ? "Short BN / Long BG" : "Long BN / Short BG",
          direction: c.direction,
          canHedge: true,
        }));
      }

      // 2B: CoinDCX + Bitget
      if (selectedExchanges.coindcx && selectedExchanges.bitget) {
        return mutualCoins
          .filter((c) => c.isCoinDcxSupported)
          .map((c) => {
            const cdxRate = c.coindcxRate ?? c.binanceRate;
            const diff = calculateDirectionalSpread(cdxRate, c.bitgetRate);
            const interval = c.fundingIntervalHours || 8;
            const payoutsPerDay = 24 / interval;
            const apr = parseFloat((diff * payoutsPerDay * 365).toFixed(2));
            const direction = cdxRate >= c.bitgetRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET";
            const directionLabel = cdxRate >= c.bitgetRate ? "Short CDX / Long BG" : "Long CDX / Short BG";

            return {
              ...c,
              rateA: cdxRate,
              rateB: c.bitgetRate,
              diffPct: diff,
              spreadBps: parseFloat((diff * 100).toFixed(2)),
              annualizedApr: apr,
              directionLabel,
              direction,
              canHedge: true,
            };
          });
      }

      // 2C: Binance + CoinDCX
      if (selectedExchanges.binance && selectedExchanges.coindcx) {
        return mutualCoins
          .filter((c) => c.isCoinDcxSupported)
          .map((c) => {
            const cdxRate = c.coindcxRate ?? c.binanceRate;
            const diff = calculateDirectionalSpread(c.binanceRate, cdxRate);
            const interval = c.fundingIntervalHours || 8;
            const payoutsPerDay = 24 / interval;
            const apr = parseFloat((diff * payoutsPerDay * 365).toFixed(2));
            const directionLabel = c.binanceRate >= cdxRate ? "BN ≥ CDX" : "CDX > BN";

            return {
              ...c,
              rateA: c.binanceRate,
              rateB: cdxRate,
              diffPct: diff,
              spreadBps: parseFloat((diff * 100).toFixed(2)),
              annualizedApr: apr,
              directionLabel,
              direction: c.direction,
              canHedge: false, // Mirrored rate basis
            };
          });
      }

      // 2D: Binance + Bybit
      if (selectedExchanges.binance && selectedExchanges.bybit) {
        return mutualCoins
          .filter((c) => c.isBybitSupported)
          .map((c) => {
            const byRate = c.bybitRate ?? 0;
            const diff = calculateDirectionalSpread(c.binanceRate, byRate);
            const interval = c.fundingIntervalHours || 8;
            const payoutsPerDay = 24 / interval;
            const apr = parseFloat((diff * payoutsPerDay * 365).toFixed(2));
            const direction = c.binanceRate >= byRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET";
            const directionLabel = c.binanceRate >= byRate ? "Short BN / Long BY" : "Long BN / Short BY";

            return {
              ...c,
              rateA: c.binanceRate,
              rateB: byRate,
              diffPct: diff,
              spreadBps: parseFloat((diff * 100).toFixed(2)),
              annualizedApr: apr,
              directionLabel,
              direction,
              canHedge: true,
            };
          });
      }

      // 2E: CoinDCX + Bybit
      if (selectedExchanges.coindcx && selectedExchanges.bybit) {
        return mutualCoins
          .filter((c) => c.isCoinDcxSupported && c.isBybitSupported)
          .map((c) => {
            const cdxRate = c.coindcxRate ?? c.binanceRate;
            const byRate = c.bybitRate ?? 0;
            const diff = calculateDirectionalSpread(cdxRate, byRate);
            const interval = c.fundingIntervalHours || 8;
            const payoutsPerDay = 24 / interval;
            const apr = parseFloat((diff * payoutsPerDay * 365).toFixed(2));
            const direction = cdxRate >= byRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET";
            const directionLabel = cdxRate >= byRate ? "Short CDX / Long BY" : "Long CDX / Short BY";

            return {
              ...c,
              rateA: cdxRate,
              rateB: byRate,
              diffPct: diff,
              spreadBps: parseFloat((diff * 100).toFixed(2)),
              annualizedApr: apr,
              directionLabel,
              direction,
              canHedge: true,
            };
          });
      }

      // 2F: Bitget + Bybit
      if (selectedExchanges.bitget && selectedExchanges.bybit) {
        return mutualCoins
          .filter((c) => c.isBybitSupported)
          .map((c) => {
            const byRate = c.bybitRate ?? 0;
            const diff = calculateDirectionalSpread(c.bitgetRate, byRate);
            const interval = c.fundingIntervalHours || 8;
            const payoutsPerDay = 24 / interval;
            const apr = parseFloat((diff * payoutsPerDay * 365).toFixed(2));
            const direction = c.bitgetRate >= byRate ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET";
            const directionLabel = c.bitgetRate >= byRate ? "Short BG / Long BY" : "Long BG / Short BY";

            return {
              ...c,
              rateA: c.bitgetRate,
              rateB: byRate,
              diffPct: diff,
              spreadBps: parseFloat((diff * 100).toFixed(2)),
              annualizedApr: apr,
              directionLabel,
              direction,
              canHedge: true,
            };
          });
      }
    }

    // CASE 3: Multi-Exchange Selected (3 or 4 Venues)
    const resultList: any[] = [];

    for (const c of mutualCoins) {
      const effInterval = c.fundingIntervalHours || 8;
      const cdxRate = c.coindcxRate ?? c.binanceRate;
      const byRate = c.bybitRate;

      const activeVenues: VenueRateInfo[] = [];

      if (selectedExchanges.binance && c.binanceRate !== undefined && c.binanceRate !== null) {
        activeVenues.push({
          venue: "binance",
          label: "Binance",
          badge: "BN",
          color: "text-amber-400",
          rate: c.binanceRate,
        });
      }

      if (selectedExchanges.coindcx && c.isCoinDcxSupported && cdxRate !== null && cdxRate !== undefined) {
        activeVenues.push({
          venue: "coindcx",
          label: "CoinDCX",
          badge: "CDX",
          color: "text-purple-400",
          rate: cdxRate,
        });
      }

      if (selectedExchanges.bitget && c.bitgetRate !== undefined && c.bitgetRate !== null) {
        activeVenues.push({
          venue: "bitget",
          label: "Bitget",
          badge: "BG",
          color: "text-cyan-400",
          rate: c.bitgetRate,
        });
      }

      if (selectedExchanges.bybit && c.isBybitSupported && byRate !== null && byRate !== undefined) {
        activeVenues.push({
          venue: "bybit",
          label: "Bybit",
          badge: "BY",
          color: "text-orange-400",
          rate: byRate,
        });
      }

      // Filter: Require at least 2 active venues among the selected exchanges
      if (activeVenues.length < 2) continue;

      const evalRes = evaluatePairwiseArbitrage(activeVenues, effInterval);
      const bestPair = evalRes.bestPair;
      if (!bestPair) continue;

      resultList.push({
        ...c,
        coindcxRate: cdxRate,
        bybitRate: byRate,
        rateDiffPct: evalRes.maxSpreadPct,
        spreadBps: evalRes.maxSpreadBps,
        annualizedApr: bestPair.annualizedApr,
        directionLabel: bestPair.directionLabel,
        direction: bestPair.direction === "SHORT_A_LONG_B" ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET",
        bestPair,
        allPairs: evalRes.allPairs,
        winningBadgeA: bestPair.badgeA,
        winningBadgeB: bestPair.badgeB,
        winningVenueA: bestPair.venueA,
        winningVenueB: bestPair.venueB,
        canHedge: true,
      });
    }

    return resultList;
  }, [activeExchangeCount, selectedExchanges, mutualCoins, binanceRanked, bitgetRanked, coindcxRanked, bybitRanked]);

  // Processed items (search filtering & sorting)
  const processedItems = useMemo(() => {
    let list = [...rawDataset];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toUpperCase().trim();
      list = list.filter((item: any) =>
        (item?.symbol || "").includes(q) || (item?.baseAsset || "").includes(q)
      );
    }

    const mult = sortDirection === "desc" ? 1 : -1;

    list.sort((a: any, b: any) => {
      // 1. Single exchange sorting (pure rates, price, volume, symbol, countdown)
      if (activeExchangeCount === 1) {
        if (sortBy === "funding" || sortBy === "spread" || sortBy === "coindcxRate" || sortBy === "bitgetRate" || sortBy === "bybitRate") {
          const rateA = a.fundingRate ?? a.binanceRate ?? a.bitgetRate ?? a.coindcxRate ?? a.bybitRate ?? 0;
          const rateB = b.fundingRate ?? b.binanceRate ?? b.bitgetRate ?? b.coindcxRate ?? b.bybitRate ?? 0;
          return mult * (rateB - rateA);
        }
        if (sortBy === "volume") return mult * ((b.volume24h || 0) - (a.volume24h || 0));
        if (sortBy === "symbol") return mult * String(a?.symbol || "").localeCompare(String(b?.symbol || ""));
        if (sortBy === "countdown") {
          const timeA = a.nextFundingTime && a.nextFundingTime > currentTime
            ? a.nextFundingTime
            : getDeterministicNextFundingTime(currentTime, a.fundingIntervalHours || 8);
          const timeB = b.nextFundingTime && b.nextFundingTime > currentTime
            ? b.nextFundingTime
            : getDeterministicNextFundingTime(currentTime, b.fundingIntervalHours || 8);
          return mult * (timeA - timeB);
        }
        // Default sort by funding rate descending
        const rateA = a.fundingRate ?? a.binanceRate ?? a.bitgetRate ?? a.coindcxRate ?? a.bybitRate ?? 0;
        const rateB = b.fundingRate ?? b.binanceRate ?? b.bitgetRate ?? b.coindcxRate ?? b.bybitRate ?? 0;
        return mult * (rateB - rateA);
      }

      // 2. Dual exchange sorting
      if (activeExchangeCount === 2) {
        if (sortBy === "spread") {
          const diffA = a.diffPct !== undefined ? a.diffPct : (a.rateDiffPct || 0);
          const diffB = b.diffPct !== undefined ? b.diffPct : (b.rateDiffPct || 0);
          if (Math.abs(diffB - diffA) > 0.00001) return mult * (diffB - diffA);
          return mult * ((b.volume24h || 0) - (a.volume24h || 0));
        }
        if (sortBy === "funding") {
          const rateA = a.rateA ?? a.binanceRate ?? 0;
          const rateB = b.rateA ?? b.binanceRate ?? 0;
          return mult * (rateB - rateA);
        }
        if (sortBy === "counterpart" || sortBy === "bitgetRate" || sortBy === "bybitRate") {
          const rateA = a.rateB ?? a.bitgetRate ?? a.bybitRate ?? 0;
          const rateB = b.rateB ?? b.bitgetRate ?? b.bybitRate ?? 0;
          return mult * (rateB - rateA);
        }
        if (sortBy === "apr") return mult * ((b.annualizedApr || 0) - (a.annualizedApr || 0));
        if (sortBy === "volume") return mult * ((b.volume24h || 0) - (a.volume24h || 0));
        if (sortBy === "symbol") return mult * String(a?.symbol || "").localeCompare(String(b?.symbol || ""));
        if (sortBy === "countdown") {
          const timeA = a.nextFundingTime && a.nextFundingTime > currentTime
            ? a.nextFundingTime
            : getDeterministicNextFundingTime(currentTime, a.fundingIntervalHours || 8);
          const timeB = b.nextFundingTime && b.nextFundingTime > currentTime
            ? b.nextFundingTime
            : getDeterministicNextFundingTime(currentTime, b.fundingIntervalHours || 8);
          return mult * (timeA - timeB);
        }
        // Default dual sort by spread descending
        const diffA = a.diffPct !== undefined ? a.diffPct : (a.rateDiffPct || 0);
        const diffB = b.diffPct !== undefined ? b.diffPct : (b.rateDiffPct || 0);
        return mult * (diffB - diffA);
      }

      // 3. Multi-exchange (All Exchanges) sorting
      if (sortBy === "spread") {
        const diffA = a.rateDiffPct || 0;
        const diffB = b.rateDiffPct || 0;
        if (Math.abs(diffB - diffA) > 0.00001) return mult * (diffB - diffA);
        return mult * ((b.volume24h || 0) - (a.volume24h || 0));
      }
      if (sortBy === "funding") return mult * ((b.binanceRate || 0) - (a.binanceRate || 0));
      if (sortBy === "coindcxRate") return mult * (((b.coindcxRate ?? b.binanceRate) || 0) - ((a.coindcxRate ?? a.binanceRate) || 0));
      if (sortBy === "bitgetRate") return mult * ((b.bitgetRate || 0) - (a.bitgetRate || 0));
      if (sortBy === "bybitRate") return mult * (((b.bybitRate) || 0) - ((a.bybitRate) || 0));
      if (sortBy === "apr") return mult * ((b.annualizedApr || 0) - (a.annualizedApr || 0));
      if (sortBy === "volume") return mult * ((b.volume24h || 0) - (a.volume24h || 0));
      if (sortBy === "symbol") return mult * String(a?.symbol || "").localeCompare(String(b?.symbol || ""));
      if (sortBy === "countdown") {
        const timeA = a.nextFundingTime && a.nextFundingTime > currentTime
          ? a.nextFundingTime
          : getDeterministicNextFundingTime(currentTime, a.fundingIntervalHours || 8);
        const timeB = b.nextFundingTime && b.nextFundingTime > currentTime
          ? b.nextFundingTime
          : getDeterministicNextFundingTime(currentTime, b.fundingIntervalHours || 8);
        return mult * (timeA - timeB);
      }

      return mult * ((b.rateDiffPct || 0) - (a.rateDiffPct || 0));
    });

    return list;
  }, [rawDataset, searchQuery, activeExchangeCount, sortBy, sortDirection, currentTime]);

  // 1-Click Quick Hedge on ANY coin row
  const handleQuickHedge = async (coin: any) => {
    if (activeExchangeCount === 1) {
      setGuardAlert({
        symbol: coin.symbol,
        message: "Delta-neutral arbitrage requires at least 2 active venues. Select 2 or 3 exchanges to execute hedged pairs.",
      });
      setTimeout(() => setGuardAlert(null), 6000);
      return;
    }

    if (coin.isMutual === false) {
      setGuardAlert({
        symbol: coin.symbol,
        message: "Single-exchange unhedgable contract. Delta-neutral arbitrage requires active legs on both exchanges.",
      });
      setTimeout(() => setGuardAlert(null), 6000);
      return;
    }

    const isTestnetSupported = coin.isTestnetSupported !== false;
    if (tradingMode === "testnet" && !isTestnetSupported) {
      setGuardAlert({
        symbol: coin.symbol,
        message: `🔒 TESTNET RESTRICTION: Binance testnet does not host ${coin.symbol}. Switch to Paper Mode to simulate trading this coin with zero risk, or switch to Live Mainnet.`,
      });
      setTimeout(() => setGuardAlert(null), 7000);
      return;
    }

    setExecutingSymbol(coin.symbol);
    setErrorSymbol(null);
    setErrorFeedback(null);
    setGuardAlert(null);

    onSelectCoin(coin.symbol, coin.direction, coin);

    try {
      let minRequiredNotional = 15.0;
      if (coin.symbol.startsWith("BTC")) minRequiredNotional = 60.0;
      else if (coin.symbol.startsWith("ETH")) minRequiredNotional = 30.0;

      const markPrice = coin.binanceMarkPrice || coin.markPrice || 1;
      let safeQty = 10;
      if (markPrice > 0) {
        if (coin.symbol.startsWith("BTC")) safeQty = 0.001;
        else if (coin.symbol.startsWith("ETH")) safeQty = 0.01;
        else if (coin.symbol.startsWith("SOL")) safeQty = 0.2;
        else if (markPrice > 500) {
          safeQty = parseFloat((minRequiredNotional / markPrice).toFixed(2));
          if (safeQty <= 0) safeQty = 0.05;
        } else if (markPrice > 50) {
          safeQty = parseFloat((minRequiredNotional / markPrice).toFixed(1));
          if (safeQty <= 0) safeQty = 0.5;
        } else if (markPrice > 1) {
          safeQty = Math.max(1, Math.round(minRequiredNotional / markPrice));
        } else {
          safeQty = Math.max(10, Math.round(minRequiredNotional / markPrice));
        }
      }

      const notional = safeQty * markPrice;
      const leg1Side = coin.direction === "SHORT_BINANCE_LONG_BITGET" ? "SELL" : "BUY";

      if (tradingMode === "mainnet" && onRequestMainnetConfirm) {
        onRequestMainnetConfirm({
          symbol: coin.symbol,
          direction: coin.direction === "SHORT_BINANCE_LONG_BITGET" ? "STANDARD_CARRY" : "REVERSE_CARRY",
          quantity: safeQty,
          notionalUsdt: notional,
          binancePrice: coin.binanceMarkPrice || markPrice,
          bitgetPrice: coin.bitgetMarkPrice || markPrice,
          spreadBps: coin.spreadBps || 0,
          leverage: 10,
          onConfirmed: async () => {
            await executeQuickHedgeOrder(coin, safeQty, notional, leg1Side);
          },
        });
        setExecutingSymbol(null);
        return;
      }

      await executeQuickHedgeOrder(coin, safeQty, notional, leg1Side);
    } catch (err: any) {
      setErrorSymbol(coin.symbol);
      setErrorFeedback({
        symbol: coin.symbol,
        message: err.message || "Failed to execute hedge",
      });
      setTimeout(() => {
        setErrorSymbol(null);
        setErrorFeedback(null);
      }, 7000);
    } finally {
      setExecutingSymbol(null);
    }
  };

  const executeQuickHedgeOrder = async (
    coin: any,
    safeQty: number,
    notional: number,
    leg1Side: "SELL" | "BUY"
  ) => {
    setExecutingSymbol(coin.symbol);
    try {
      const vaultHeaders: Record<string, string> = getVaultHeaders ? getVaultHeaders() : {};
      if (typeof window !== "undefined" && Object.keys(vaultHeaders).length === 0) {
        const bnKey = localStorage.getItem("BINANCE_KEY") || "";
        const bnSecret = localStorage.getItem("BINANCE_SECRET") || "";
        const bnEndpoint = localStorage.getItem("BINANCE_ENDPOINT") || "";
        const bgKey = localStorage.getItem("BITGET_KEY") || "";
        const bgSecret = localStorage.getItem("BITGET_SECRET") || "";
        const bgPass = localStorage.getItem("BITGET_PASSPHRASE") || "";
        const bgEnv = localStorage.getItem("BITGET_ENV") || "demo";
        if (bnKey) vaultHeaders["x-binance-key"] = bnKey;
        if (bnSecret) vaultHeaders["x-binance-secret"] = bnSecret;
        if (bnEndpoint) vaultHeaders["x-binance-endpoint"] = bnEndpoint;
        if (bgKey) vaultHeaders["x-bitget-key"] = bgKey;
        if (bgSecret) vaultHeaders["x-bitget-secret"] = bgSecret;
        if (bgPass) vaultHeaders["x-bitget-passphrase"] = bgPass;
        if (bgEnv) vaultHeaders["x-bitget-env"] = bgEnv;
        const byKey = localStorage.getItem("BYBIT_KEY") || "";
        const bySecret = localStorage.getItem("BYBIT_SECRET") || "";
        const byProxy = localStorage.getItem("BYBIT_PROXY") || "";
        const byBaseUrl = localStorage.getItem("BYBIT_BASE_URL") || "";
        if (byKey) vaultHeaders["x-bybit-key"] = byKey;
        if (bySecret) vaultHeaders["x-bybit-secret"] = bySecret;
        if (byProxy) vaultHeaders["x-bybit-proxy"] = byProxy;
        if (byBaseUrl) vaultHeaders["x-bybit-base-url"] = byBaseUrl;
      }

      const corridor = coin.bestPair
        ? `${coin.bestPair.venueA.toUpperCase()}_${coin.bestPair.venueB.toUpperCase()}`
        : dualConfig
        ? `${dualConfig.labelA.toUpperCase()}_${dualConfig.labelB.toUpperCase()}`
        : "COINDCX_BYBIT";

      const res = await fetch("/api/hedge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-trading-mode": tradingMode,
          "x-mainnet-armed": isMainnetArmed ? "true" : "false",
          ...vaultHeaders,
        },
        body: JSON.stringify({
          action: "entry",
          symbol: coin.symbol,
          quantity: safeQty,
          notional,
          leg1Side,
          corridor,
          mode: tradingMode,
          isArmed: isMainnetArmed,
          liveBnPrice: coin.binanceMarkPrice || coin.markPrice,
          liveBgPrice: coin.bitgetMarkPrice || coin.markPrice,
          bnRate: coin.binanceRate,
          bgRate: coin.bitgetRate,
          nextFundingTime: coin.nextFundingTime,
        }),
      });

      const rawText = await res.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        const titleMatch = rawText.match(/<title>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";
        throw new Error(
          title
            ? `Server error (${res.status}): ${title}`
            : `Server returned HTTP ${res.status}: ${rawText.slice(0, 100).replace(/<[^>]*>/g, "").trim() || "Gateway Error"}`
        );
      }
      if (!data.success) throw new Error(data.error || "Hedge execution failed");

      setFilledSymbol(coin.symbol);
      setTimeout(() => setFilledSymbol(null), 4000);

      const tradeRecord = {
        id: `HDG-${Date.now().toString().slice(-6)}`,
        timestamp: Date.now(),
        symbol: coin.symbol,
        type: tradingMode === "paper" ? "PAPER_HEDGE" : tradingMode === "mainnet" ? "LIVE_MAINNET_HEDGE" : "QUICK_HEDGE_1CLICK",
        directionLabel: coin.direction === "SHORT_BINANCE_LONG_BITGET" ? "Short BN + Long BG" : "Long BN + Short BG",
        quantity: safeQty.toString(),
        leg1Venue: tradingMode === "paper" ? "Binance (Paper)" : "Binance",
        leg1Side: leg1Side,
        leg1Price: data.leg1?.price || coin.binanceMarkPrice || 0,
        leg1OrderId: data.leg1?.orderId || "SIM_1",
        leg2Venue: tradingMode === "paper" ? "Bitget (Paper)" : "Bitget",
        leg2Side: leg1Side === "SELL" ? "BUY" : "SELL",
        leg2Price: data.leg2?.price || coin.bitgetMarkPrice || 0,
        leg2OrderId: data.leg2?.orderId || "SIM_2",
        interLegDeltaMs: data.interLegDeltaMs || 12,
        realizedPnl: 0,
        status: "ACTIVE",
      };

      if (onTradeExecuted) onTradeExecuted(tradeRecord);
    } catch (err: any) {
      setErrorSymbol(coin.symbol);
      setErrorFeedback({
        symbol: coin.symbol,
        message: err.message || "Failed to execute hedge",
      });
      setTimeout(() => {
        setErrorSymbol(null);
        setErrorFeedback(null);
      }, 7000);
    } finally {
      setExecutingSymbol(null);
    }
  };

  const handleQuickHedgePair = async (coin: any, pair: PairwiseCombination) => {
    const pairCoin = {
      ...coin,
      direction: pair.direction === "SHORT_A_LONG_B" ? "SHORT_BINANCE_LONG_BITGET" : "LONG_BINANCE_SHORT_BITGET",
      directionLabel: pair.directionLabel,
      rateDiffPct: pair.spreadPct,
      spreadBps: pair.spreadBps,
      annualizedApr: pair.annualizedApr,
      bestPair: pair,
    };
    await handleQuickHedge(pairCoin);
  };

  const topOpportunity = useMemo(() => {
    if (mutualCoins.length === 0) return null;
    return mutualCoins[0];
  }, [mutualCoins]);

  return (
    <div className="bg-surface rounded-xl border border-border p-3.5 sm:p-5 font-mono transition-all duration-300">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-border gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Flame className="w-4 h-4 text-accent-amber animate-pulse" />
          <h2 className="text-sm font-semibold text-zinc-100 tracking-wide uppercase">
            FULL-MARKET FUNDING ARBITRAGE SCANNER
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
            {marketSummary
              ? `${marketSummary.mutualTotal} Mutual | ${marketSummary.binanceTotal + marketSummary.bitgetTotal} Total Listed`
              : mutualCoins.length > 0
              ? `${mutualCoins.length} Verified Pairs`
              : "Scanning..."}
          </span>
          {topOpportunity && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-accent-emerald border border-emerald-500/30 font-bold flex items-center space-x-1">
              <span>Top Spread: {topOpportunity.symbol}</span>
              <span className="text-zinc-400 font-mono">
                (+{(topOpportunity.rateDiffPct || (topOpportunity.spreadBps / 100)).toFixed(4)}% | +{topOpportunity.spreadBps.toFixed(1)} bps)
              </span>
            </span>
          )}
          {fetchLatencyMs > 0 && (
            <span className="hidden xl:inline text-[10px] px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/50 font-bold">
              ⚡ Parallel Ingest: {fetchLatencyMs}ms (&lt; 0.5s)
            </span>
          )}
        </div>

        {/* Action Controls & Collapse Button */}
        <div className="flex items-center space-x-2 self-end sm:self-auto">
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="hidden lg:flex items-center space-x-1 px-2.5 py-1 text-[10px] rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/80 transition-all font-semibold"
              title={isExpanded ? "Dock beside Order Execution Panel" : "Expand scanner to full screen width"}
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="w-3 h-3 text-amber-400" />
                  <span>Dock Beside Terminal</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3 h-3 text-cyan-400" />
                  <span>Full Width</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="px-2.5 py-1 text-[10px] rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors min-h-[24px] min-w-[24px]"
            title="Scroll back to Top"
          >
            ↑ Top
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors min-h-[24px] min-w-[24px] flex items-center justify-center"
            title={isCollapsed ? "Expand Scanner" : "Collapse Scanner"}
            aria-label={isCollapsed ? "Expand Scanner" : "Collapse Scanner"}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isCollapsed ? "grid-rows-[0fr] opacity-0 pointer-events-none" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 pt-3.5">

            {/* Universe Summary Telemetry Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-[11px]">
              <div className="flex flex-col">
                <span className="text-zinc-500 text-[10px] flex items-center space-x-1">
                  <span>🟡</span>
                  <span>Binance USD-M</span>
                </span>
                <span className="text-amber-400 font-bold font-mono">
                  {marketSummary?.binanceTotal ?? (binanceRanked.length || 881)} contracts
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-zinc-500 text-[10px] flex items-center space-x-1">
                  <span>🟣</span>
                  <span>CoinDCX Futures</span>
                </span>
                <span className="text-purple-400 font-bold font-mono">
                  {marketSummary?.coindcxTotal ?? (coindcxRanked.length || 505)} contracts
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-zinc-500 text-[10px] flex items-center space-x-1">
                  <span>🔵</span>
                  <span>Bitget USDT</span>
                </span>
                <span className="text-cyan-400 font-bold font-mono">
                  {marketSummary?.bitgetTotal ?? (bitgetRanked.length || 833)} contracts
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-zinc-500 text-[10px] flex items-center space-x-1">
                  <span>🟧</span>
                  <span>Bybit Linear</span>
                </span>
                <span className="text-orange-400 font-bold font-mono">
                  {marketSummary?.bybitTotal ?? (bybitRanked.length || 450)} contracts
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-zinc-500 text-[10px] flex items-center space-x-1">
                  <span>⚡</span>
                  <span>Mutual Cross-Listed</span>
                </span>
                <span className="text-accent-emerald font-bold font-mono">
                  {marketSummary?.mutualTotal ?? (mutualCoins.length || 648)} pairs
                </span>
              </div>
              <div className="flex flex-col col-span-2 sm:col-span-1">
                <span className="text-zinc-500 text-[10px]">Active Scanner Mode</span>
                <span className="text-zinc-200 font-bold font-mono">
                  {activeExchangeCount === 1
                    ? `1-Venue (${selectedExchanges.binance ? "Binance" : selectedExchanges.coindcx ? "CoinDCX" : selectedExchanges.bitget ? "Bitget" : "Bybit"})`
                    : activeExchangeCount === 2
                    ? `2-Venue (${dualConfig?.labelA} ⇄ ${dualConfig?.labelB})`
                    : activeExchangeCount === 3
                    ? "3-Venue Comparison"
                    : "4-Venue (All Exchanges)"}
                </span>
              </div>
            </div>

            {/* Clean 5 Options Exchange Filter Selector */}
            {/* 1st: Binance | 2nd: CoinDCX | 3rd: Bitget | 4th: Bybit | 5th: All Exchanges */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {/* Option 1: Binance */}
              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 shadow-sm">
                <button
                  onClick={() => handleToggleExchange("binance")}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center space-x-1.5 ${
                    selectedExchanges.binance
                      ? "bg-amber-500/20 text-accent-amber border border-amber-500/40 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                  title="Toggle Binance in comparison (Click Only to solo view)"
                >
                  <span>🟡</span>
                  <span>Binance</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    selectedExchanges.binance ? "bg-amber-500/30 text-amber-300 font-black" : "bg-zinc-800 text-zinc-500"
                  }`}>
                    {marketSummary?.binanceTotal ?? (binanceRanked.length || 881)}
                  </span>
                  {selectedExchanges.binance && <Check className="w-3.5 h-3.5 text-accent-amber" />}
                </button>
                <button
                  onClick={() => handleSoloExchange("binance")}
                  className={`px-2 py-1 text-[9px] rounded font-bold transition-colors ${
                    activeExchangeCount === 1 && selectedExchanges.binance
                      ? "bg-accent-amber text-zinc-950 font-black"
                      : "text-zinc-500 hover:text-amber-300 hover:bg-zinc-800"
                  }`}
                  title="Solo view: Show ONLY Binance (no spread/difference)"
                >
                  ONLY
                </button>
              </div>

              {/* Option 2: CoinDCX */}
              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 shadow-sm">
                <button
                  onClick={() => handleToggleExchange("coindcx")}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center space-x-1.5 ${
                    selectedExchanges.coindcx
                      ? "bg-purple-900/40 text-purple-300 border border-purple-600/50 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                  title="Toggle CoinDCX in comparison (Click Only to solo view)"
                >
                  <span>🟣</span>
                  <span>CoinDCX</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    selectedExchanges.coindcx ? "bg-purple-800/60 text-purple-200 font-black" : "bg-zinc-800 text-zinc-500"
                  }`}>
                    {marketSummary?.coindcxTotal ?? (coindcxRanked.length || 505)}
                  </span>
                  {selectedExchanges.coindcx && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
                <button
                  onClick={() => handleSoloExchange("coindcx")}
                  className={`px-2 py-1 text-[9px] rounded font-bold transition-colors ${
                    activeExchangeCount === 1 && selectedExchanges.coindcx
                      ? "bg-purple-600 text-white font-black"
                      : "text-zinc-500 hover:text-purple-300 hover:bg-zinc-800"
                  }`}
                  title="Solo view: Show ONLY CoinDCX (no spread/difference)"
                >
                  ONLY
                </button>
              </div>

              {/* Option 3: Bitget */}
              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 shadow-sm">
                <button
                  onClick={() => handleToggleExchange("bitget")}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center space-x-1.5 ${
                    selectedExchanges.bitget
                      ? "bg-cyan-900/40 text-cyan-300 border border-cyan-600/50 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                  title="Toggle Bitget in comparison (Click Only to solo view)"
                >
                  <span>🔵</span>
                  <span>Bitget</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    selectedExchanges.bitget ? "bg-cyan-800/60 text-cyan-200 font-black" : "bg-zinc-800 text-zinc-500"
                  }`}>
                    {marketSummary?.bitgetTotal ?? (bitgetRanked.length || 833)}
                  </span>
                  {selectedExchanges.bitget && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                </button>
                <button
                  onClick={() => handleSoloExchange("bitget")}
                  className={`px-2 py-1 text-[9px] rounded font-bold transition-colors ${
                    activeExchangeCount === 1 && selectedExchanges.bitget
                      ? "bg-cyan-500 text-zinc-950 font-black"
                      : "text-zinc-500 hover:text-cyan-300 hover:bg-zinc-800"
                  }`}
                  title="Solo view: Show ONLY Bitget (no spread/difference)"
                >
                  ONLY
                </button>
              </div>

              {/* Option 4: Bybit */}
              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 shadow-sm">
                <button
                  onClick={() => handleToggleExchange("bybit")}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center space-x-1.5 ${
                    selectedExchanges.bybit
                      ? "bg-orange-500/20 text-orange-400 border border-orange-500/40 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                  title="Toggle Bybit in comparison (Click Only to solo view)"
                >
                  <span>🟧</span>
                  <span>Bybit</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    selectedExchanges.bybit ? "bg-orange-500/30 text-orange-300 font-black" : "bg-zinc-800 text-zinc-500"
                  }`}>
                    {marketSummary?.bybitTotal ?? (bybitRanked.length || 450)}
                  </span>
                  {selectedExchanges.bybit && <Check className="w-3.5 h-3.5 text-orange-400" />}
                </button>
                <button
                  onClick={() => handleSoloExchange("bybit")}
                  className={`px-2 py-1 text-[9px] rounded font-bold transition-colors ${
                    activeExchangeCount === 1 && selectedExchanges.bybit
                      ? "bg-orange-500 text-zinc-950 font-black"
                      : "text-zinc-500 hover:text-orange-300 hover:bg-zinc-800"
                  }`}
                  title="Solo view: Show ONLY Bybit (no spread/difference)"
                >
                  ONLY
                </button>
              </div>

              {/* Option 5: All Exchanges */}
              <button
                onClick={handleSelectAllExchanges}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 border ${
                  isAllSelected
                    ? "bg-accent-emerald text-zinc-950 border-emerald-400 shadow-md shadow-emerald-500/20"
                    : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-700/70"
                }`}
                title="View all 4 exchanges side by side across mutual contracts"
              >
                <span>🌐</span>
                <span>All Exchanges</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                  isAllSelected ? "bg-emerald-950/40 text-emerald-950 font-black" : "bg-zinc-800 text-zinc-400"
                }`}>
                  {marketSummary?.mutualTotal ?? mutualCoins.length} Mutual
                </span>
                {isAllSelected && <Check className="w-3.5 h-3.5 text-zinc-950" />}
              </button>
            </div>

            {/* Contextual Mode Information Banner */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800/80 text-[11px]">
              <div className="flex items-center space-x-2 text-zinc-300">
                <Info className="w-4 h-4 text-zinc-400 shrink-0" />
                <span>
                  {activeExchangeCount === 1 ? (
                    <>
                      <strong>Single-Exchange View ({singleExchangeKey.toUpperCase()}):</strong> Displaying pure standalone contracts for {singleExchangeKey === "binance" ? "Binance" : singleExchangeKey === "coindcx" ? "CoinDCX" : singleExchangeKey === "bitget" ? "Bitget" : "Bybit"}. <em>Spread and difference columns are hidden.</em>
                    </>
                  ) : activeExchangeCount === 2 ? (
                    <>
                      <strong>Dual-Exchange Arbitrage ({dualConfig?.labelA} ⇄ {dualConfig?.labelB}):</strong> Displaying individual rates, directional spread magnitude, difference, and annualized APR across mutual contracts.
                    </>
                  ) : (
                    <>
                      <strong>Multi-Exchange Scanner (Binance ⇄ CoinDCX ⇄ Bitget ⇄ Bybit):</strong> Displaying all live rates side by side, max directional spread, best corridor, and settlement countdowns.
                    </>
                  )}
                </span>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono hidden md:block">
                {processedItems.length} contracts matching
              </div>
            </div>

            {/* Sub-Filters, Quick Chips & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-800/80">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex items-center w-full sm:w-auto">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <input
                    type="text"
                    aria-label="Search coin contract ticker (e.g. PEPE, SOL)"
                    placeholder="Search coin (e.g. PEPE, SOL)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-7 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-accent-amber w-full sm:w-48 md:w-52 font-mono"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 text-zinc-500 hover:text-zinc-200 text-xs transition-colors p-1"
                      title="Clear Search"
                      aria-label="Clear search input"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Quick Coin Search Chips */}
                <div className="flex items-center space-x-1 text-[10px] overflow-x-auto py-0.5 max-w-full scrollbar-none">
                  {["BTC", "ETH", "SOL", "DOGE", "LTC", "PEPE", "XRP", "SUI"].map((coinName) => {
                    const isMatch = searchQuery.toUpperCase() === coinName;
                    return (
                      <button
                        key={coinName}
                        onClick={() => setSearchQuery(isMatch ? "" : coinName)}
                        className={`px-1.5 py-0.5 rounded transition-all font-mono shrink-0 ${
                          isMatch
                            ? "bg-accent-amber text-zinc-950 font-bold"
                            : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700/60"
                        }`}
                      >
                        {coinName}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Refresh & Row Limit Controls */}
              <div className="flex items-center space-x-2">
                <select
                  value={displayLimit}
                  onChange={(e) => setDisplayLimit(parseInt(e.target.value, 10))}
                  className="bg-zinc-900 text-zinc-300 text-[10px] border border-zinc-700 rounded px-1.5 py-1 font-mono focus:outline-none"
                  title="Rows per page"
                >
                  <option value={50}>Show 50</option>
                  <option value={100}>Show 100</option>
                  <option value={250}>Show 250</option>
                  <option value={1000}>Show 1,000</option>
                  <option value={2000}>Show All (2,000)</option>
                </select>

                <button
                  onClick={() => fetchAllMarketData(true)}
                  disabled={isLoading}
                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="Force Refresh All Market Data"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-accent-amber" : ""}`} />
                </button>
              </div>
            </div>

            {/* Execution Guard Notice Banner */}
            {guardAlert && (
              <div className="my-2 px-3.5 py-2.5 rounded-lg bg-amber-950/80 border border-amber-800 text-amber-200 text-xs flex items-center justify-between shadow-lg shadow-amber-950/30 animate-fadeIn">
                <div className="flex items-center space-x-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Execution Guard:</strong> {guardAlert.message}
                  </span>
                </div>
                <button
                  onClick={() => setGuardAlert(null)}
                  className="text-zinc-400 hover:text-zinc-100 text-xs px-2 py-0.5 rounded hover:bg-amber-900/50 transition-colors"
                >
                  ✕ Dismiss
                </button>
              </div>
            )}

            {/* Execution Error Feedback Banner */}
            {errorFeedback && (
              <div className="my-2 px-3.5 py-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center justify-between shadow-lg shadow-rose-950/30 animate-fadeIn">
                <div className="flex items-center space-x-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>
                    <strong>{errorFeedback.symbol}</strong> execution notice: {errorFeedback.message}
                  </span>
                </div>
                <button
                  onClick={() => setErrorFeedback(null)}
                  className="text-zinc-400 hover:text-zinc-100 text-xs px-2 py-0.5 rounded hover:bg-rose-900/50 transition-colors"
                >
                  ✕ Dismiss
                </button>
              </div>
            )}

            {/* Dynamic Market Table */}
            {error ? (
              <div className="py-8 text-center text-xs text-rose-400 flex items-center justify-center space-x-2">
                <ShieldAlert className="w-4 h-4" />
                <span>Error loading scanner: {error}</span>
              </div>
            ) : processedItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                {isLoading ? "Ingesting contracts from active exchanges..." : "No matching contracts found."}
              </div>
            ) : (
              <div className="overflow-x-auto mt-2 max-h-96 overflow-y-auto -mx-1 sm:mx-0 px-1 sm:px-0">
                <table className="w-full min-w-[780px] text-left text-xs">
                  <thead className="sticky top-0 bg-surface border-b border-border text-[10px] text-zinc-400 uppercase z-10">
                    <tr>
                      <th className="pb-2 cursor-pointer w-14 text-center" onClick={() => handleSortToggle("spread")}>
                        # Rank {sortBy === "spread" && (sortDirection === "desc" ? "▾" : "▴")}
                      </th>
                      <th className="pb-2 cursor-pointer" onClick={() => handleSortToggle("symbol")}>
                        Contract / Asset {sortBy === "symbol" && (sortDirection === "desc" ? "▾" : "▴")}
                      </th>

                      {/* MODE 1: SINGLE EXCHANGE SELECTED -> NO SPREAD / NO DIFF COLUMNS */}
                      {activeExchangeCount === 1 ? (
                        <>
                          <th
                            className={`pb-2 cursor-pointer ${
                              singleExchangeKey === "binance"
                                ? "text-accent-amber"
                                : singleExchangeKey === "coindcx"
                                ? "text-purple-400"
                                : singleExchangeKey === "bitget"
                                ? "text-cyan-400"
                                : "text-orange-400"
                            }`}
                            onClick={() => handleSortToggle("funding")}
                            title={`Sort purely by ${singleExchangeKey.toUpperCase()} Funding Rate`}
                          >
                            {singleExchangeKey === "binance"
                              ? "Binance Rate"
                              : singleExchangeKey === "coindcx"
                              ? "CoinDCX Rate"
                              : singleExchangeKey === "bitget"
                              ? "Bitget Rate"
                              : "Bybit Rate"}{" "}
                            {sortBy === "funding" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th className="pb-2 text-zinc-300">Mark Price</th>
                          <th
                            className="pb-2 cursor-pointer text-zinc-300"
                            onClick={() => handleSortToggle("countdown")}
                            title="Settlement Cycle & Live Countdown"
                          >
                            <div className="flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-zinc-400" />
                              <span>Cycle / Countdown {sortBy === "countdown" && (sortDirection === "desc" ? "▾" : "▴")}</span>
                            </div>
                          </th>
                          <th className="pb-2 cursor-pointer" onClick={() => handleSortToggle("volume")}>
                            24h Vol {sortBy === "volume" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th className="pb-2 text-right">Actions</th>
                        </>
                      ) : activeExchangeCount === 2 ? (
                        /* MODE 2: ANY TWO EXCHANGES SELECTED -> SHOW BOTH RATES & SPREAD/DIFF */
                        <>
                          <th
                            className="pb-2 cursor-pointer text-accent-amber"
                            onClick={() => handleSortToggle("spread")}
                            title={`Directional Spread: |Rate_${dualConfig?.labelA} - Rate_${dualConfig?.labelB}|`}
                          >
                            Rate Diff (Spread) {sortBy === "spread" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th
                            className={`pb-2 cursor-pointer ${dualConfig?.colorA}`}
                            onClick={() => handleSortToggle("funding")}
                            title={`Sort by ${dualConfig?.labelA} Funding Rate`}
                          >
                            {dualConfig?.labelA} Rate {sortBy === "funding" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th
                            className={`pb-2 cursor-pointer ${dualConfig?.colorB}`}
                            onClick={() => handleSortToggle("counterpart")}
                            title={`Sort by ${dualConfig?.labelB} Funding Rate`}
                          >
                            {dualConfig?.labelB} Rate {sortBy === "counterpart" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th
                            className="pb-2 cursor-pointer text-zinc-300"
                            onClick={() => handleSortToggle("countdown")}
                            title="Settlement Cycle & Countdown"
                          >
                            <div className="flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-zinc-400" />
                              <span>Cycle / Countdown {sortBy === "countdown" && (sortDirection === "desc" ? "▾" : "▴")}</span>
                            </div>
                          </th>
                          <th className="pb-2 cursor-pointer text-accent-emerald" onClick={() => handleSortToggle("apr")}>
                            Annualized APR {sortBy === "apr" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th className="pb-2">Direction</th>
                          <th className="pb-2 cursor-pointer" onClick={() => handleSortToggle("volume")}>
                            24h Vol {sortBy === "volume" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th className="pb-2 text-right">Actions</th>
                        </>
                      ) : (
                        /* MODE 3: MULTI-EXCHANGE SELECTED (3 or 4 Venues) */
                        <>
                          <th
                            className="pb-2 cursor-pointer text-accent-amber"
                            onClick={() => handleSortToggle("spread")}
                            title="Best Rate Difference (highest spread across evaluated pairwise combinations)"
                          >
                            Best Rate Diff (Spread) {sortBy === "spread" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          {selectedExchanges.binance && (
                            <th
                              className="pb-2 cursor-pointer text-amber-400"
                              onClick={() => handleSortToggle("funding")}
                              title="Binance Funding Rate"
                            >
                              Binance Rate {sortBy === "funding" && (sortDirection === "desc" ? "▾" : "▴")}
                            </th>
                          )}
                          {selectedExchanges.coindcx && (
                            <th
                              className="pb-2 cursor-pointer text-purple-400"
                              onClick={() => handleSortToggle("coindcxRate")}
                              title="CoinDCX Funding Rate"
                            >
                              CoinDCX Rate {sortBy === "coindcxRate" && (sortDirection === "desc" ? "▾" : "▴")}
                            </th>
                          )}
                          {selectedExchanges.bitget && (
                            <th
                              className="pb-2 cursor-pointer text-cyan-400"
                              onClick={() => handleSortToggle("bitgetRate")}
                              title="Bitget Funding Rate"
                            >
                              Bitget Rate {sortBy === "bitgetRate" && (sortDirection === "desc" ? "▾" : "▴")}
                            </th>
                          )}
                          {selectedExchanges.bybit && (
                            <th
                              className="pb-2 cursor-pointer text-orange-400"
                              onClick={() => handleSortToggle("bybitRate")}
                              title="Bybit Funding Rate"
                            >
                              Bybit Rate {sortBy === "bybitRate" && (sortDirection === "desc" ? "▾" : "▴")}
                            </th>
                          )}
                          <th
                            className="pb-2 cursor-pointer text-zinc-300"
                            onClick={() => handleSortToggle("countdown")}
                            title="Settlement Cycle & Countdown"
                          >
                            <div className="flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-zinc-400" />
                              <span>Cycle / Countdown {sortBy === "countdown" && (sortDirection === "desc" ? "▾" : "▴")}</span>
                            </div>
                          </th>
                          <th className="pb-2 cursor-pointer text-accent-emerald" onClick={() => handleSortToggle("apr")}>
                            Annualized APR {sortBy === "apr" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th className="pb-2">Best Direction</th>
                          <th className="pb-2 cursor-pointer" onClick={() => handleSortToggle("volume")}>
                            24h Vol {sortBy === "volume" && (sortDirection === "desc" ? "▾" : "▴")}
                          </th>
                          <th className="pb-2 text-right">Actions</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y border-border">
                    {processedItems.slice(0, displayLimit).map((item: any, index: number) => {
                      const isSelected = selectedSymbol === item.symbol;
                      const rankNum = index + 1;
                      const isExecuting = executingSymbol === item.symbol;
                      const isFilled = filledSymbol === item.symbol;
                      const isError = errorSymbol === item.symbol;
                      const effInterval = item.fundingIntervalHours || 8;
                      const coinFundingTarget = item.nextFundingTime && item.nextFundingTime > currentTime
                        ? item.nextFundingTime
                        : getDeterministicNextFundingTime(currentTime, effInterval);
                      const countdownDisplay = formatCountdown(coinFundingTarget, currentTime, effInterval);

                      // ROW 1: SINGLE EXCHANGE VIEW (No Diff / No Spread)
                      if (activeExchangeCount === 1) {
                        const rateVal = item.fundingRate ?? item.binanceRate ?? item.bitgetRate ?? item.coindcxRate ?? item.bybitRate ?? 0;
                        const isPositive = rateVal >= 0;
                        const soloVenue = singleExchangeKey === "binance" ? "Binance" : singleExchangeKey === "coindcx" ? "CoinDCX" : singleExchangeKey === "bitget" ? "Bitget" : "Bybit";
                        const counterpartVenue = soloVenue === "Bybit" ? "CoinDCX" : soloVenue === "CoinDCX" ? "Bybit" : soloVenue === "Binance" ? "Bitget" : "Binance";
                        const singleItem = {
                          ...item,
                          venueA: soloVenue,
                          venueB: counterpartVenue,
                        };

                        return (
                          <tr
                            key={`single-${item.symbol}-${index}`}
                            onClick={() => onSelectCoin(item.symbol, item.direction, singleItem)}
                            className={`cursor-pointer transition-all duration-150 group select-none ${
                              isSelected
                                ? "bg-amber-950/30 border-l-4 border-accent-amber"
                                : "hover:bg-zinc-800/50 hover:border-l-2 hover:border-amber-500/40"
                            }`}
                          >
                            <td className="py-2.5 text-center font-mono">
                              {rankNum === 1 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  🥇 #1
                                </span>
                              ) : rankNum === 2 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-700/50 text-zinc-200 border border-zinc-600/60">
                                  🥈 #2
                                </span>
                              ) : rankNum === 3 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/30 text-amber-400 border border-amber-800/40">
                                  🥉 #3
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-500 font-semibold">
                                  #{rankNum}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5">
                              <div className="flex items-center space-x-2">
                                <span className={`font-bold transition-colors ${isSelected ? "text-accent-amber" : "text-zinc-100 group-hover:text-amber-300"}`}>
                                  {item.baseAsset}
                                </span>
                                <span className="text-[10px] text-zinc-500 font-mono">USDT</span>
                                {item.isTestnetSupported ? (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                                    ⚡ Testnet
                                  </span>
                                ) : (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                                    🔒 Mainnet
                                  </span>
                                )}
                                {item.isCoinDcxSupported && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-purple-950/60 text-purple-400 border border-purple-800/50" title="CoinDCX Futures Listed">
                                    CoinDCX
                                  </span>
                                )}
                                {item.isBybitSupported && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-orange-950/60 text-orange-400 border border-orange-800/50" title="Bybit Linear Listed">
                                    Bybit
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 font-mono">
                              <span className={isPositive ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                {isPositive ? "+" : ""}{rateVal.toFixed(5)}%
                              </span>
                            </td>
                            <td className="py-2.5 font-mono text-zinc-300">
                              ${item.markPrice > 1 ? item.markPrice.toFixed(2) : item.markPrice.toFixed(4)}
                            </td>
                            <td className="py-2.5 font-mono text-zinc-200">
                              <div className="flex items-center space-x-1.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border tracking-wider ${
                                  effInterval === 4
                                    ? "bg-purple-950/70 text-purple-300 border-purple-700/60"
                                    : "bg-blue-950/70 text-blue-300 border-blue-700/60"
                                }`}>
                                  {effInterval}H
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-[11px] text-zinc-200 font-semibold">
                                  {countdownDisplay}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 text-zinc-400 text-[11px] font-mono">
                              {item.volume24h > 0 ? `$${(item.volume24h / 1_000_000).toFixed(1)}M` : "—"}
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectCoin(item.symbol, item.direction, singleItem);
                                }}
                                className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                                  isSelected
                                    ? "bg-amber-500/20 text-accent-amber border border-amber-500/40"
                                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                                }`}
                              >
                                {isSelected ? "LOADED" : "LOAD"}
                              </button>
                            </td>
                          </tr>
                        );
                      }

                      // ROW 2: DUAL EXCHANGE VIEW (Showing both rates and their difference/spread)
                      if (activeExchangeCount === 2) {
                        const diffVal = item.diffPct !== undefined ? item.diffPct : (item.rateDiffPct || 0);
                        const rateAVal = item.rateA ?? item.binanceRate ?? 0;
                        const rateBVal = item.rateB ?? item.bitgetRate ?? 0;
                        const dualItem = {
                          ...item,
                          venueA: dualConfig?.labelA || "CoinDCX",
                          venueB: dualConfig?.labelB || "Bybit",
                        };

                        return (
                          <tr
                            key={`dual-${item.symbol}-${index}`}
                            onClick={() => onSelectCoin(item.symbol, item.direction, dualItem)}
                            className={`cursor-pointer transition-all duration-150 group select-none ${
                              isSelected
                                ? "bg-amber-950/30 border-l-4 border-accent-amber"
                                : "hover:bg-zinc-800/50 hover:border-l-2 hover:border-amber-500/40"
                            }`}
                          >
                            <td className="py-2.5 text-center font-mono">
                              {rankNum === 1 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  🥇 #1
                                </span>
                              ) : rankNum === 2 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-700/50 text-zinc-200 border border-zinc-600/60">
                                  🥈 #2
                                </span>
                              ) : rankNum === 3 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/30 text-amber-400 border border-amber-800/40">
                                  🥉 #3
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-500 font-semibold">
                                  #{rankNum}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5">
                              <div className="flex items-center space-x-2">
                                <span className={`font-bold transition-colors ${isSelected ? "text-accent-amber" : "text-zinc-100 group-hover:text-amber-300"}`}>
                                  {item.baseAsset}
                                </span>
                                <span className="text-[10px] text-zinc-500 font-mono">USDT</span>
                                {item.isTestnetSupported ? (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                                    ⚡ Testnet
                                  </span>
                                ) : (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                                    🔒 Mainnet
                                  </span>
                                )}
                                {item.isCoinDcxSupported && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-purple-950/60 text-purple-400 border border-purple-800/50" title="CoinDCX Futures Listed">
                                    CoinDCX
                                  </span>
                                )}
                                {item.isBybitSupported && (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-orange-950/60 text-orange-400 border border-orange-800/50" title="Bybit Linear Listed">
                                    Bybit
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 font-mono">
                              <div className="flex flex-col">
                                <span className="font-bold text-accent-amber text-xs">
                                  +{diffVal.toFixed(4)}%
                                </span>
                                <span className="text-[10px] text-zinc-400">
                                  +{(diffVal * 100).toFixed(1)} bps
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 font-mono">
                              <span className={rateAVal >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                                {rateAVal >= 0 ? "+" : ""}{rateAVal.toFixed(5)}%
                              </span>
                            </td>
                            <td className="py-2.5 font-mono">
                              <span className={rateBVal >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                                {rateBVal >= 0 ? "+" : ""}{rateBVal.toFixed(5)}%
                              </span>
                            </td>
                            <td className="py-2.5 font-mono text-zinc-200">
                              <div className="flex items-center space-x-1.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border tracking-wider ${
                                  effInterval === 4
                                    ? "bg-purple-950/70 text-purple-300 border-purple-700/60"
                                    : "bg-blue-950/70 text-blue-300 border-blue-700/60"
                                }`}>
                                  {effInterval}H
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-[11px] text-zinc-200 font-semibold">
                                  {countdownDisplay}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 font-bold text-accent-emerald font-mono">
                              +{item.annualizedApr?.toFixed(1) || "0.0"}% APR
                            </td>
                            <td className="py-2.5 text-[11px]">
                              <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-200 border border-zinc-700">
                                <span>{item.directionLabel || "Hedge Corridor"}</span>
                              </span>
                            </td>
                            <td className="py-2.5 text-zinc-400 text-[11px] font-mono">
                              ${(item.volume24h / 1_000_000).toFixed(1)}M
                            </td>
                            <td className="py-2.5 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {item.canHedge !== false ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuickHedge(item);
                                    }}
                                    disabled={isExecuting}
                                    className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all flex items-center space-x-1 ${
                                      isFilled
                                        ? "bg-emerald-500 text-zinc-950"
                                        : isExecuting
                                        ? "bg-amber-600 text-white animate-pulse"
                                        : "bg-accent-amber hover:bg-amber-400 text-zinc-950 shadow-sm"
                                    }`}
                                  >
                                    <Zap className="w-3 h-3" />
                                    <span>{isFilled ? "FILLED ✓" : isExecuting ? "HEDGING..." : "HEDGE"}</span>
                                  </button>
                                ) : (
                                  <span className="text-[10px] px-2 py-1 rounded bg-zinc-900 text-zinc-500 border border-zinc-800">
                                    Synced
                                  </span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectCoin(item.symbol, item.direction, dualItem);
                                  }}
                                  className={`px-2 py-1 text-[10px] font-bold rounded transition-all ${
                                    isSelected
                                      ? "bg-amber-500/20 text-accent-amber border-amber-500/40"
                                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                                  }`}
                                >
                                  {isSelected ? "LOADED" : "LOAD"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      // ROW 3: TRI-EXCHANGE & MULTI-EXCHANGE VIEW (3 or 4 Venues)
                      const isExpanded = expandedCoins.has(item.symbol);
                      const rateDiff = item.rateDiffPct !== undefined ? item.rateDiffPct : 0;
                      const cdxRateVal = item.coindcxRate ?? item.binanceRate;
                      const hasPairMatrix = item.allPairs && item.allPairs.length > 0;
                      const colSpanCount = 7 + (selectedExchanges.binance ? 1 : 0) + (selectedExchanges.coindcx ? 1 : 0) + (selectedExchanges.bitget ? 1 : 0) + (selectedExchanges.bybit ? 1 : 0);
                      const multiItem = {
                        ...item,
                        venueA: item.winningVenueA || item.bestPair?.venueA?.label || item.bestPair?.venueA || "Binance",
                        venueB: item.winningVenueB || item.bestPair?.venueB?.label || item.bestPair?.venueB || "Bitget",
                      };

                      return (
                        <React.Fragment key={`tri-group-${item.symbol}-${index}`}>
                          <tr
                            key={`tri-${item.symbol}`}
                            onClick={() => onSelectCoin(item.symbol, item.direction, multiItem)}
                            className={`cursor-pointer transition-all duration-150 group select-none ${
                              isSelected
                                ? "bg-amber-950/30 border-l-4 border-accent-amber"
                                : "hover:bg-zinc-800/50 hover:border-l-2 hover:border-amber-500/40"
                            }`}
                          >
                            <td className="py-2.5 text-center font-mono">
                              {rankNum === 1 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  🥇 #1
                                </span>
                              ) : rankNum === 2 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-700/50 text-zinc-200 border border-zinc-600/60">
                                  🥈 #2
                                </span>
                              ) : rankNum === 3 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/30 text-amber-400 border border-amber-800/40">
                                  🥉 #3
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-500 font-semibold">
                                  #{rankNum}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5">
                              <div className="flex items-center space-x-2">
                                <span className={`font-bold transition-colors ${isSelected ? "text-accent-amber" : "text-zinc-100 group-hover:text-amber-300"}`}>
                                  {item.baseAsset}
                                </span>
                                <span className="text-[10px] text-zinc-500 font-mono">USDT</span>
                                {item.isTestnetSupported ? (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                                    ⚡ Testnet
                                  </span>
                                ) : (
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                                    🔒 Mainnet
                                  </span>
                                )}
                                {hasPairMatrix && item.allPairs.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => toggleCoinAccordion(item.symbol, e)}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center space-x-1 border transition-all ${
                                      isExpanded
                                        ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                                        : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-zinc-700"
                                    }`}
                                    title="View all pairwise exchange combinations"
                                  >
                                    <span>{item.allPairs.length} Pairs</span>
                                    {isExpanded ? (
                                      <ChevronUp className="w-3 h-3 text-amber-400" />
                                    ) : (
                                      <ChevronDown className="w-3 h-3 text-zinc-400" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 font-mono">
                              <div className="flex flex-col">
                                <div className="flex items-center space-x-1.5">
                                  <span className="font-bold text-accent-amber text-xs">
                                    +{rateDiff.toFixed(4)}%
                                  </span>
                                  {item.winningBadgeA && item.winningBadgeB && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                      ⭐ {item.winningBadgeA} ⇄ {item.winningBadgeB}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-zinc-400 font-semibold">
                                  +{item.spreadBps?.toFixed(1) || (rateDiff * 100).toFixed(1)} bps
                                </span>
                              </div>
                            </td>
                            {selectedExchanges.binance && (
                              <td className="py-2.5 font-mono">
                                {item.binanceRate !== undefined && item.binanceRate !== null ? (
                                  <span className={item.binanceRate >= 0 ? "text-amber-300 font-semibold" : "text-rose-400 font-semibold"}>
                                    {item.binanceRate >= 0 ? "+" : ""}{item.binanceRate.toFixed(5)}%
                                  </span>
                                ) : (
                                  <span className="text-zinc-600 text-xs">—</span>
                                )}
                              </td>
                            )}
                            {selectedExchanges.coindcx && (
                              <td className="py-2.5 font-mono">
                                {item.isCoinDcxSupported && cdxRateVal !== null && cdxRateVal !== undefined ? (
                                  <span className={cdxRateVal >= 0 ? "text-purple-300 font-semibold" : "text-rose-400 font-semibold"}>
                                    {cdxRateVal >= 0 ? "+" : ""}{cdxRateVal.toFixed(5)}%
                                  </span>
                                ) : (
                                  <span className="text-zinc-600 text-xs">—</span>
                                )}
                              </td>
                            )}
                            {selectedExchanges.bitget && (
                              <td className="py-2.5 font-mono">
                                {item.bitgetRate !== undefined && item.bitgetRate !== null ? (
                                  <span className={item.bitgetRate >= 0 ? "text-cyan-400 font-semibold" : "text-rose-400 font-semibold"}>
                                    {item.bitgetRate >= 0 ? "+" : ""}{item.bitgetRate.toFixed(5)}%
                                  </span>
                                ) : (
                                  <span className="text-zinc-600 text-xs">—</span>
                                )}
                              </td>
                            )}
                            {selectedExchanges.bybit && (
                              <td className="py-2.5 font-mono">
                                {item.isBybitSupported && item.bybitRate !== undefined && item.bybitRate !== null ? (
                                  <span className={item.bybitRate >= 0 ? "text-orange-400 font-semibold" : "text-rose-400 font-semibold"}>
                                    {item.bybitRate >= 0 ? "+" : ""}{item.bybitRate.toFixed(5)}%
                                  </span>
                                ) : (
                                  <span className="text-zinc-600 text-xs">—</span>
                                )}
                              </td>
                            )}
                            <td className="py-2.5 font-mono text-zinc-200">
                              <div className="flex items-center space-x-1.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border tracking-wider ${
                                  effInterval === 4
                                    ? "bg-purple-950/70 text-purple-300 border-purple-700/60"
                                    : "bg-blue-950/70 text-blue-300 border-blue-700/60"
                                }`}>
                                  {effInterval}H
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-[11px] text-zinc-200 font-semibold">
                                  {countdownDisplay}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 font-bold text-accent-emerald font-mono">
                              +{item.annualizedApr?.toFixed(1) || "0.0"}% APR
                            </td>
                            <td className="py-2.5 text-[11px]">
                              <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-200 border border-zinc-700 font-semibold">
                                <span>{item.directionLabel || "Hedge Corridor"}</span>
                              </span>
                            </td>
                            <td className="py-2.5 text-zinc-400 text-[11px] font-mono">
                              ${(item.volume24h / 1_000_000).toFixed(1)}M
                            </td>
                            <td className="py-2.5 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuickHedge(item);
                                  }}
                                  disabled={isExecuting}
                                  className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all flex items-center space-x-1 active:scale-95 ${
                                    isFilled
                                      ? "bg-emerald-500 text-zinc-950 shadow-md"
                                      : isError
                                      ? "bg-rose-900/90 text-rose-100 border border-rose-700"
                                      : isExecuting
                                      ? "bg-amber-600 text-white animate-pulse"
                                      : "bg-accent-amber hover:bg-amber-400 text-zinc-950 shadow-sm"
                                  }`}
                                >
                                  <Zap className="w-3 h-3" />
                                  <span>{isFilled ? "FILLED ✓" : isError ? "ERROR ✕" : isExecuting ? "HEDGING..." : "HEDGE"}</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectCoin(item.symbol, item.direction, multiItem);
                                  }}
                                  className={`px-2 py-1 text-[10px] font-bold rounded transition-all active:scale-95 ${
                                    isSelected
                                      ? "bg-amber-500/20 text-accent-amber border-amber-500/40"
                                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                                  }`}
                                >
                                  {isSelected ? "LOADED" : "LOAD"}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* ACCORDION EXPANSION: ALL PAIRWISE COMBINATIONS SIDE-BY-SIDE */}
                          {isExpanded && hasPairMatrix && (
                            <tr key={`tri-matrix-${item.symbol}`} className="bg-zinc-950/90 border-b border-zinc-800/80">
                              <td colSpan={colSpanCount} className="py-3 px-6">
                                <div className="bg-zinc-900/90 border border-zinc-800 rounded-lg p-3 shadow-inner">
                                  <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-zinc-800/80">
                                    <div className="flex items-center space-x-2">
                                      <span className="text-xs font-bold text-zinc-200">
                                        Pairwise Arbitrage Matrix: {item.baseAsset} USDT
                                      </span>
                                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-amber-400 border border-zinc-700 font-mono">
                                        {item.allPairs.length} Combinations Evaluated
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-zinc-400 font-mono">
                                      Best Corridor: <strong className="text-amber-300">{item.winningBadgeA} ⇄ {item.winningBadgeB}</strong> (+{rateDiff.toFixed(4)}%)
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {item.allPairs.map((pair: PairwiseCombination, pIdx: number) => {
                                      const isWinning = item.bestPair && item.bestPair.pairKey === pair.pairKey;
                                      return (
                                        <div
                                          key={`pair-card-${pair.pairKey}-${pIdx}`}
                                          className={`p-3 rounded-lg border transition-all ${
                                            isWinning
                                              ? "bg-amber-950/25 border-amber-500/40 shadow-sm shadow-amber-950/40"
                                              : "bg-zinc-850/60 border-zinc-800 hover:border-zinc-700"
                                          }`}
                                        >
                                          <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-bold text-zinc-100 flex items-center space-x-1.5">
                                              <span>{pair.label}</span>
                                            </span>
                                            {isWinning ? (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                                ⭐ BEST SPREAD
                                              </span>
                                            ) : (
                                              <span className="text-[10px] text-zinc-500 font-mono">
                                                Combo #{pIdx + 1}
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex items-center justify-between text-[11px] mb-2 font-mono bg-zinc-900/80 px-2 py-1 rounded border border-zinc-800/80">
                                            <span className="text-zinc-400">
                                              {pair.badgeA}: <strong className={pair.rateA >= 0 ? "text-emerald-400" : "text-rose-400"}>{pair.rateA >= 0 ? "+" : ""}{pair.rateA.toFixed(5)}%</strong>
                                            </span>
                                            <span className="text-zinc-600">vs</span>
                                            <span className="text-zinc-400">
                                              {pair.badgeB}: <strong className={pair.rateB >= 0 ? "text-emerald-400" : "text-rose-400"}>{pair.rateB >= 0 ? "+" : ""}{pair.rateB.toFixed(5)}%</strong>
                                            </span>
                                          </div>

                                          <div className="flex items-center justify-between text-xs font-mono font-bold pt-1.5 border-t border-zinc-800/80">
                                            <span className="text-accent-amber">
                                              +{pair.spreadPct.toFixed(4)}% <span className="text-[10px] text-zinc-400 font-normal">(+{pair.spreadBps.toFixed(1)} bps)</span>
                                            </span>
                                            <span className="text-accent-emerald text-[11px]">
                                              +{pair.annualizedApr.toFixed(1)}% APR
                                            </span>
                                          </div>

                                          <div className="flex items-center justify-between text-[10px] mt-2 pt-1">
                                            <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-semibold text-zinc-300">
                                              {pair.directionLabel}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleQuickHedgePair(item, pair);
                                              }}
                                              className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors flex items-center space-x-1 ${
                                                isWinning
                                                  ? "bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold shadow-sm"
                                                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                                              }`}
                                            >
                                              <Zap className="w-2.5 h-2.5" />
                                              <span>Hedge Pair</span>
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer Summary */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pt-3 mt-3 border-t border-border text-[10px] text-zinc-500 gap-2">
              <span>
                Displaying top {Math.min(processedItems.length, displayLimit)} of {processedItems.length} filtered items
                {activeExchangeCount === 1 && ` (Solo ${singleExchangeKey.toUpperCase()} — Pure Funding Rate Descending, Diff/Spread Hidden)`}
                {activeExchangeCount === 2 && ` (Dual ${dualConfig?.labelA} ⇄ ${dualConfig?.labelB} Arbitrage — Ranked by Spread)`}
                {activeExchangeCount === 3 && " (Tri-Exchange Scanner — Ranked by Max Spread)"}
                {activeExchangeCount === 4 && " (All 4 Exchanges — Ranked by Max Spread)"}
              </span>
              <div className="flex items-center space-x-3">
                {activeExchangeCount > 1 && <span>Click <strong>QUICK HEDGE</strong> for 1-click execution</span>}
                <span>Click <strong>LOAD</strong> to configure in Terminal</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
