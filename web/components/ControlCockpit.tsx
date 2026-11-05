"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Play,
  RefreshCw,
  ShieldAlert,
  XCircle,
  Sliders,
  CheckCircle2,
  Sparkles,
  Clock,
  Crosshair,
  Gauge,
  AlertTriangle,
  Lock,
  Unlock,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import TradingCockpitMeter from "@/components/TradingCockpitMeter";
import { formatCountdown, getDeterministicNextFundingTime } from "@/lib/settlementTime";
import {
  getCoinMaxLeverages,
  calculateSingleLegMatch,
  calculateAutoSplit,
} from "@/lib/exchangeLeverageMeta";
import { getCorridorStaggerDelays, StaggerPolicy } from "@/lib/latencyTracker";

export type SupportedAsset = string;

const DEFAULT_ASSET_CONFIGS: Record<string, { label: string; base: string; presets: string[]; step: string; defaultQty: string }> = {
  BTCUSDT: { label: "BTC", base: "BTC", presets: ["0.002", "0.005", "0.010", "0.020"], step: "0.001", defaultQty: "0.005" },
  ETHUSDT: { label: "ETH", base: "ETH", presets: ["0.02", "0.05", "0.10", "0.20"], step: "0.01", defaultQty: "0.05" },
  SOLUSDT: { label: "SOL", base: "SOL", presets: ["0.2", "0.5", "1.0", "2.0"], step: "0.1", defaultQty: "0.5" },
  DOGEUSDT: { label: "DOGE", base: "DOGE", presets: ["200", "500", "1000", "2000"], step: "10", defaultQty: "500" },
  XRPUSDT: { label: "XRP", base: "XRP", presets: ["50", "100", "200", "500"], step: "1", defaultQty: "100" },
};

function getAssetMeta(sym?: string) {
  const safeSym = String(sym || "BTCUSDT").toUpperCase();
  if (DEFAULT_ASSET_CONFIGS[safeSym]) return DEFAULT_ASSET_CONFIGS[safeSym];
  const base = safeSym.replace("USDT", "") || "BTC";
  return {
    label: base,
    base,
    presets: ["5", "10", "25", "50"],
    step: "1",
    defaultQty: "10",
  };
}

interface ControlCockpitProps {
  onRefresh?: () => void;
  onOrderSuccess?: (receipt: any) => void;
  onTradeExecuted?: (trade: any) => void;
  getVaultHeaders: () => Record<string, string>;
  selectedSymbol?: SupportedAsset;
  onSymbolChange?: (sym: SupportedAsset) => void;
  isAutopilotActive?: boolean;
  onToggleAutopilot?: (active: boolean) => void;
  autopilotState?: string;
  spreadBps?: number;
  minSpreadEntry?: number;
  onMinSpreadEntryChange?: (val: number) => void;
  exitSpreadTarget?: number;
  onExitSpreadTargetChange?: (val: number) => void;
  markPrice?: number;
  binancePrice?: number;
  bitgetPrice?: number;
  priceDiff?: number;
  priceDivergencePct?: number;
  binanceFundingRate?: number;
  bitgetFundingRate?: number;
  nextFundingTime?: number;
  fundingIntervalHours?: number;
  tradingMode?: "paper" | "testnet" | "mainnet";
  isMainnetArmed?: boolean;
  onRequestMainnetConfirm?: (tradeParams: any) => void;
  activeVenueA?: string;
  activeVenueB?: string;
  onVenuesChange?: (venueA: string, venueB: string) => void;
}

export type ExecutionCorridor =
  | "BINANCE_BITGET"
  | "BINANCE_COINDCX"
  | "BINANCE_BYBIT"
  | "COINDCX_BYBIT"
  | "COINDCX_BITGET"
  | "BITGET_BYBIT";

function getCorridorFromVenues(vA: string, vB: string): ExecutionCorridor {
  const a = (vA || "").toUpperCase();
  const b = (vB || "").toUpperCase();
  if ((a === "BINANCE" && b === "BITGET") || (a === "BITGET" && b === "BINANCE")) return "BINANCE_BITGET";
  if ((a === "BINANCE" && b === "COINDCX") || (a === "COINDCX" && b === "BINANCE")) return "BINANCE_COINDCX";
  if ((a === "BINANCE" && b === "BYBIT") || (a === "BYBIT" && b === "BINANCE")) return "BINANCE_BYBIT";
  if ((a === "COINDCX" && b === "BYBIT") || (a === "BYBIT" && b === "COINDCX")) return "COINDCX_BYBIT";
  if ((a === "COINDCX" && b === "BITGET") || (a === "BITGET" && b === "COINDCX")) return "COINDCX_BITGET";
  if ((a === "BITGET" && b === "BYBIT") || (a === "BYBIT" && b === "BITGET")) return "BITGET_BYBIT";
  return "COINDCX_BYBIT";
}

function getVenueVisuals(venue: string) {
  const norm = (venue || "").toLowerCase();
  if (norm === "binance") {
    return {
      name: "Binance",
      short: "BN",
      color: "text-accent-amber",
      accentBg: "bg-amber-500",
      border: "border-amber-500/40",
      bgSubtle: "bg-amber-500/10",
      sliderAccent: "accent-amber-400",
      badge: "🟡",
    };
  }
  if (norm === "coindcx") {
    return {
      name: "CoinDCX",
      short: "CDX",
      color: "text-purple-400",
      accentBg: "bg-purple-500",
      border: "border-purple-500/40",
      bgSubtle: "bg-purple-500/10",
      sliderAccent: "accent-purple-400",
      badge: "🟣",
    };
  }
  if (norm === "bybit") {
    return {
      name: "Bybit",
      short: "BYB",
      color: "text-orange-400",
      accentBg: "bg-orange-500",
      border: "border-orange-500/40",
      bgSubtle: "bg-orange-500/10",
      sliderAccent: "accent-orange-400",
      badge: "🟧",
    };
  }
  return {
    name: "Bitget",
    short: "BG",
    color: "text-cyan-400",
    accentBg: "bg-cyan-500",
    border: "border-cyan-500/40",
    bgSubtle: "bg-cyan-500/10",
    sliderAccent: "accent-cyan-400",
    badge: "🔵",
  };
}

export default function ControlCockpit({
  onRefresh,
  onOrderSuccess,
  onTradeExecuted,
  getVaultHeaders,
  selectedSymbol = "BTCUSDT",
  onSymbolChange,
  isAutopilotActive = false,
  onToggleAutopilot,
  autopilotState = "IDLE_SCANNING",
  spreadBps = 10.0,
  minSpreadEntry = 12,
  onMinSpreadEntryChange,
  exitSpreadTarget = 2,
  onExitSpreadTargetChange,
  markPrice = 0,
  binancePrice = 0,
  bitgetPrice = 0,
  priceDiff,
  priceDivergencePct,
  binanceFundingRate,
  bitgetFundingRate,
  nextFundingTime = 0,
  fundingIntervalHours = 8,
  tradingMode = "paper",
  isMainnetArmed = false,
  onRequestMainnetConfirm,
  activeVenueA = "CoinDCX",
  activeVenueB = "Bybit",
  onVenuesChange,
}: ControlCockpitProps) {
  const currentAsset = selectedSymbol || "BTCUSDT";
  const assetMeta = getAssetMeta(currentAsset);

  const [quantity, setQuantity] = useState<string>(assetMeta.defaultQty);
  const [selectedNotional, setSelectedNotional] = useState<number | null>(null);
  const [internalMinSpread, setInternalMinSpread] = useState<number>(12);
  const [internalExitTarget, setInternalExitTarget] = useState<number>(2);
  const [cockpitError, setCockpitError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // 1-second live countdown ticker
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Cross-Exchange Mark Price Divergence Calculations
  const bnPrice = binancePrice > 0 ? binancePrice : markPrice > 0 ? markPrice : 1;
  const bgPrice = bitgetPrice > 0 ? bitgetPrice : markPrice > 0 ? markPrice : 1;
  const effectivePriceDiff = priceDiff !== undefined ? priceDiff : Math.abs(bnPrice - bgPrice);
  const effectiveDivergencePct =
    priceDivergencePct !== undefined
      ? priceDivergencePct
      : bnPrice > 0
      ? (effectivePriceDiff / bnPrice) * 100
      : 0;

  // Auto-Wait Limit Sniper State
  const [maxPriceDivergencePct, setMaxPriceDivergencePct] = useState<number>(0.25);
  const [sniperWaitingDirection, setSniperWaitingDirection] = useState<"SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET" | null>(null);

  // Dynamic Venues & Corridor Resolution
  const venueAName = activeVenueA || "CoinDCX";
  const venueBName = activeVenueB || "Bybit";
  const executionCorridor: ExecutionCorridor = getCorridorFromVenues(venueAName, venueBName);
  const visualsA = getVenueVisuals(venueAName);
  const visualsB = getVenueVisuals(venueBName);

  const getVenueLimit = (venue: string, limits: any) => {
    const norm = (venue || "").toLowerCase();
    if (norm === "binance") return limits.binance;
    if (norm === "coindcx") return limits.coindcx;
    if (norm === "bybit") return limits.bybit;
    return limits.bitget;
  };

  // Dynamic Leverage Engine State
  const coinLimits = getCoinMaxLeverages(currentAsset);
  const venueAMaxLev = getVenueLimit(venueAName, coinLimits);
  const venueBMaxLev = getVenueLimit(venueBName, coinLimits);
  const highestCorridorLev = Math.max(venueAMaxLev, venueBMaxLev);
  const highestCorridorVenue = venueAMaxLev >= venueBMaxLev ? venueAName : venueBName;

  const [leveragePreset, setLeveragePreset] = useState<"MAX" | "50" | "30" | "20" | "10" | "5" | "CUSTOM">("MAX");
  const [venueALeverage, setVenueALeverage] = useState<number>(venueAMaxLev);
  const [venueBLeverage, setVenueBLeverage] = useState<number>(venueBMaxLev);
  const binanceLeverage = venueALeverage; // backward-compatibility alias
  const bitgetLeverage = venueBLeverage;  // backward-compatibility alias
  const [showCustomSplit, setShowCustomSplit] = useState<boolean>(false);

  // Interactive Margin Calculator State
  const [calcMode, setCalcMode] = useState<"AUTO_SPLIT" | "SINGLE_LEG">("AUTO_SPLIT");
  const [autoSplitBudget, setAutoSplitBudget] = useState<number>(30);
  const [singleLegInputMargin, setSingleLegInputMargin] = useState<number>(50);
  const [singleLegInputVenue, setSingleLegInputVenue] = useState<"A" | "B">("A");

  // Sync leverage when coin changes, corridor/venues change, or preset changes
  useEffect(() => {
    const limits = getCoinMaxLeverages(currentAsset);
    const maxA = getVenueLimit(venueAName, limits);
    const maxB = getVenueLimit(venueBName, limits);

    if (leveragePreset === "MAX") {
      setVenueALeverage(maxA);
      setVenueBLeverage(maxB);
    } else if (leveragePreset !== "CUSTOM") {
      const target = parseInt(leveragePreset, 10);
      setVenueALeverage(Math.min(target, maxA));
      setVenueBLeverage(Math.min(target, maxB));
    } else {
      setVenueALeverage((prev) => Math.min(prev, maxA));
      setVenueBLeverage((prev) => Math.min(prev, maxB));
    }
  }, [currentAsset, venueAName, venueBName, leveragePreset]);

  // Auto-expand when user changes asset
  useEffect(() => {
    setIsCollapsed(false);
  }, [selectedSymbol]);

  const effectiveVenueALeverage = Math.max(1, venueALeverage);
  const effectiveVenueBLeverage = Math.max(1, venueBLeverage);
  const effectiveBinanceLeverage = effectiveVenueALeverage; // backward-compatibility alias
  const effectiveBitgetLeverage = effectiveVenueBLeverage;  // backward-compatibility alias

  const handlePresetSelect = (preset: "MAX" | "50" | "30" | "20" | "10" | "5") => {
    setLeveragePreset(preset);
    const limits = getCoinMaxLeverages(currentAsset);
    const maxA = getVenueLimit(venueAName, limits);
    const maxB = getVenueLimit(venueBName, limits);

    if (preset === "MAX") {
      setVenueALeverage(maxA);
      setVenueBLeverage(maxB);
      setShowCustomSplit(false);
    } else {
      const val = parseInt(preset, 10);
      setVenueALeverage(Math.min(val, maxA));
      setVenueBLeverage(Math.min(val, maxB));
    }
  };

  const handleEqualizeMax = () => {
    const limits = getCoinMaxLeverages(currentAsset);
    const maxA = getVenueLimit(venueAName, limits);
    const maxB = getVenueLimit(venueBName, limits);
    setLeveragePreset("MAX");
    setVenueALeverage(maxA);
    setVenueBLeverage(maxB);
    setShowCustomSplit(false);
  };

  const handleCorridorSelect = (corridor: ExecutionCorridor) => {
    if (tradingMode === "mainnet" && corridor.includes("BITGET")) {
      console.warn("Bitget corridors are disabled on live mainnet (demo-only account).");
      return;
    }
    let vA = "CoinDCX";
    let vB = "Bybit";
    if (corridor === "COINDCX_BYBIT") { vA = "CoinDCX"; vB = "Bybit"; }
    else if (corridor === "BINANCE_COINDCX") { vA = "Binance"; vB = "CoinDCX"; }
    else if (corridor === "BINANCE_BYBIT") { vA = "Binance"; vB = "Bybit"; }
    else if (corridor === "COINDCX_BITGET") { vA = "CoinDCX"; vB = "Bitget"; }
    else if (corridor === "BITGET_BYBIT") { vA = "Bitget"; vB = "Bybit"; }
    else if (corridor === "BINANCE_BITGET") { vA = "Binance"; vB = "Bitget"; }
    if (onVenuesChange) {
      onVenuesChange(vA, vB);
    }
  };

  // Helper to apply calculated notional directly to quantity
  const applyNotionalToQuantity = (notionalDollars: number) => {
    const effectivePrice = bnPrice > 0 ? bnPrice : markPrice > 0 ? markPrice : (bitgetPrice > 0 ? bitgetPrice : 1);
    if (notionalDollars <= 0 || effectivePrice <= 0) return;
    const rawQty = notionalDollars / effectivePrice;
    let stepDecimals = 0;
    if (assetMeta.step.includes(".")) {
      stepDecimals = assetMeta.step.split(".")[1].length;
    }
    const formatted = stepDecimals > 0 ? rawQty.toFixed(stepDecimals) : Math.max(1, Math.round(rawQty)).toString();
    setSelectedNotional(Math.round(notionalDollars));
    setQuantity(formatted);
  };

  // Immediate reactive budget handler (Margin Balancer -> Order Sizing)
  const handleBudgetChange = (newBudget: number) => {
    setAutoSplitBudget(newBudget);
    if (newBudget > 0) {
      const split = calculateAutoSplit(newBudget, effectiveVenueALeverage, effectiveVenueBLeverage);
      applyNotionalToQuantity(split.matchedNotional);
    }
  };

  // Immediate reactive single-leg margin handler
  const handleSingleLegMarginChange = (newMargin: number, venue = singleLegInputVenue) => {
    setSingleLegInputMargin(newMargin);
    if (newMargin > 0) {
      const single = calculateSingleLegMatch(newMargin, venue, effectiveVenueALeverage, effectiveVenueBLeverage);
      applyNotionalToQuantity(single.matchedNotional);
    }
  };

  // Bidirectional manual quantity handler (Order Sizing -> Margin Balancer)
  const handleQuantityManualChange = (newQtyStr: string) => {
    setQuantity(newQtyStr);
    const num = parseFloat(newQtyStr) || 0;
    const effectivePrice = bnPrice > 0 ? bnPrice : markPrice > 0 ? markPrice : (bitgetPrice > 0 ? bitgetPrice : 1);
    const notional = num * effectivePrice;
    setSelectedNotional(Math.round(notional));
    if (notional > 0 && effectiveVenueALeverage > 0 && effectiveVenueBLeverage > 0) {
      const reqMarginA = notional / effectiveVenueALeverage;
      const reqMarginB = notional / effectiveVenueBLeverage;
      setAutoSplitBudget(parseFloat((reqMarginA + reqMarginB).toFixed(2)));
    }
  };

  // Continuous auto-sync: when coin, leverages, or price changes, immediately update quantity from active budget
  useEffect(() => {
    if (autoSplitBudget > 0 && (bnPrice > 0 || markPrice > 0 || bitgetPrice > 0)) {
      if (calcMode === "AUTO_SPLIT") {
        const split = calculateAutoSplit(autoSplitBudget, effectiveVenueALeverage, effectiveVenueBLeverage);
        applyNotionalToQuantity(split.matchedNotional);
      } else {
        const single = calculateSingleLegMatch(singleLegInputMargin, singleLegInputVenue, effectiveVenueALeverage, effectiveVenueBLeverage);
        applyNotionalToQuantity(single.matchedNotional);
      }
    }
  }, [currentAsset, venueAName, venueBName, effectiveVenueALeverage, effectiveVenueBLeverage, bnPrice, markPrice, bitgetPrice]);

  // Emergency Kill Switch Safety State
  const [isKillSwitchArmed, setIsKillSwitchArmed] = useState<boolean>(false);

  // Stagger Strategy State
  const [staggerPolicy, setStaggerPolicy] = useState<StaggerPolicy>("auto_ewma");
  const [manualDelayMs, setManualDelayMs] = useState<number>(120);
  const [manualVenue, setManualVenue] = useState<string>("Bitget");

  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<any>(null);

  // Auto-expand if a trade receipt arrives or an error is raised
  useEffect(() => {
    if (cockpitError || lastReceipt) {
      setIsCollapsed(false);
    }
  }, [cockpitError, lastReceipt]);

  // Reset error banners when selectedSymbol updates (retains budget-calculated quantity)
  useEffect(() => {
    if (selectedSymbol) {
      setCockpitError(null);
    }
  }, [selectedSymbol]);

  const handleNotionalSelect = (dollars: number) => {
    setSelectedNotional(dollars);
    if (markPrice && markPrice > 0) {
      const rawQty = dollars / markPrice;
      let stepDecimals = 0;
      if (assetMeta.step.includes(".")) {
        stepDecimals = assetMeta.step.split(".")[1].length;
      }
      const formatted = stepDecimals > 0 ? rawQty.toFixed(stepDecimals) : Math.max(1, Math.round(rawQty)).toString();
      setQuantity(formatted);
    } else {
      if (dollars <= 25) setQuantity(assetMeta.presets[0]);
      else if (dollars <= 50) setQuantity(assetMeta.presets[1] || assetMeta.presets[0]);
      else if (dollars <= 100) setQuantity(assetMeta.presets[2] || assetMeta.presets[1]);
      else setQuantity(assetMeta.presets[3] || assetMeta.presets[2]);
    }
  };

  const handleAssetSelect = (sym: SupportedAsset) => {
    if (onSymbolChange) {
      onSymbolChange(sym);
    }
    setSniperWaitingDirection(null);
    if (autoSplitBudget > 0 && calcMode === "AUTO_SPLIT") {
      const split = calculateAutoSplit(autoSplitBudget, effectiveVenueALeverage, effectiveVenueBLeverage);
      applyNotionalToQuantity(split.matchedNotional);
    } else {
      const meta = getAssetMeta(sym);
      setQuantity(meta.defaultQty);
    }
  };

  const executeHedge = async (
    direction: "SHORT_BINANCE_LONG_BITGET" | "LONG_BINANCE_SHORT_BITGET",
    bypassSniper = false
  ) => {
    // Check if live divergence exceeds threshold and sniper is not bypassed
    if (!bypassSniper && effectiveDivergencePct > maxPriceDivergencePct) {
      setSniperWaitingDirection(direction);
      return;
    }

    // Mainnet Defensive Arming Gate: Trigger pre-flight confirmation modal if in mainnet mode
    if (tradingMode === "mainnet" && onRequestMainnetConfirm && !bypassSniper) {
      onRequestMainnetConfirm({
        symbol: currentAsset,
        direction: direction === "SHORT_BINANCE_LONG_BITGET" ? "STANDARD_CARRY" : "REVERSE_CARRY",
        quantity,
        notionalUsdt: notionalDollars,
        binancePrice: bnPrice,
        bitgetPrice: bgPrice,
        spreadBps,
        leverage: effectiveBinanceLeverage,
        onConfirmed: () => executeHedge(direction, true),
      });
      return;
    }

    setLoadingAction(direction);
    try {
      const leg1Side = direction === "SHORT_BINANCE_LONG_BITGET" ? "SELL" : "BUY";
      const res = await fetch("/api/hedge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-trading-mode": tradingMode,
          "x-mainnet-armed": isMainnetArmed ? "true" : "false",
          ...getVaultHeaders(),
        },
        body: JSON.stringify({
          action: "entry",
          symbol: currentAsset,
          quantity: parseFloat(quantity),
          notional: notionalDollars,
          leg1Side,
          mode: tradingMode,
          isArmed: isMainnetArmed,
          staggerPolicy,
          manualDelayMs,
          manualVenue,
          maxPriceDivergencePct,
          bypassSniper,
          venueALeverage: effectiveVenueALeverage,
          venueBLeverage: effectiveVenueBLeverage,
          binanceLeverage: effectiveVenueALeverage,
          bitgetLeverage: effectiveVenueBLeverage,
          leverage: effectiveVenueALeverage,
          liveBnPrice: bnPrice,
          liveBgPrice: bgPrice,
          bnRate: binanceFundingRate,
          bgRate: bitgetFundingRate,
          nextFundingTime,
          corridor: executionCorridor,
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
      if (!data.success) {
        if (data.sniperPending) {
          setSniperWaitingDirection(direction);
          setCockpitError(null);
          return;
        }
        throw new Error(data.error || "Hedge execution failed");
      }
      setSniperWaitingDirection(null);
      setCockpitError(null);
      setLastReceipt({
        type: "HEDGE_ENTRY",
        direction,
        data,
      });
      if (onTradeExecuted) {
        onTradeExecuted({
          id: `HDG-${Date.now().toString().slice(-6)}`,
          timestamp: Date.now(),
          symbol: currentAsset,
          type: "HEDGE_ENTRY",
          directionLabel: direction === "SHORT_BINANCE_LONG_BITGET" ? `Short ${venueAName} + Long ${venueBName}` : `Long ${venueAName} + Short ${venueBName}`,
          quantity,
          leg1Venue: venueAName,
          leg1Side: leg1Side,
          leg1Price: data.leg1?.price || 0,
          leg1OrderId: data.leg1?.orderId,
          leg2Venue: venueBName,
          leg2Side: leg1Side === "SELL" ? "BUY" : "SELL",
          leg2Price: data.leg2?.price || 0,
          leg2OrderId: data.leg2?.orderId,
          interLegDeltaMs: data.interLegDeltaMs || 0,
          realizedPnl: 0,
          status: "ACTIVE",
        });
      }
      if (onOrderSuccess) onOrderSuccess(data);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      if (!err.message?.includes("Sniper Hold")) {
        setCockpitError(`Hedge Entry Failed: ${err.message}`);
        setTimeout(() => setCockpitError(null), 8000);
      }
    } finally {
      setLoadingAction(null);
    }
  };

  // Stable ref for executeHedge to avoid resetting the sniper countdown timer on form changes
  const executeHedgeRef = useRef(executeHedge);
  useEffect(() => {
    executeHedgeRef.current = executeHedge;
  });

  const isWithinTolerance = effectiveDivergencePct <= maxPriceDivergencePct;

  // Auto-Wait Limit Sniper Loop with 1.2s Hysteresis Dwell Confirmation
  useEffect(() => {
    if (!sniperWaitingDirection || loadingAction) return;

    if (isWithinTolerance) {
      // Basis gap is within tolerance - require it to hold steady for 1.2s before firing
      const dwellTimer = setTimeout(() => {
        const dir = sniperWaitingDirection;
        setSniperWaitingDirection(null);
        executeHedgeRef.current(dir, true);
      }, 1200);

      return () => clearTimeout(dwellTimer);
    }
  }, [sniperWaitingDirection, isWithinTolerance, loadingAction]);

  const executeCloseAll = async () => {
    setLoadingAction("CLOSE");
    try {
      const res = await fetch("/api/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getVaultHeaders(),
        },
        body: JSON.stringify({ symbol: "ALL", corridor: executionCorridor }),
      });
      const rawText = await res.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        const titleMatch = rawText.match(/<title>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";
        throw new Error(
          title ? `Server error (${res.status}): ${title}` : `Server returned HTTP ${res.status}`
        );
      }
      if (!data.success) throw new Error(data.error || data.message || "Close failed");
      setLastReceipt({
        type: "CLOSE",
        message: data.message,
        data,
      });
      setIsKillSwitchArmed(false);
      if (onTradeExecuted) {
        onTradeExecuted({
          id: `CLS-${Date.now().toString().slice(-6)}`,
          timestamp: Date.now(),
          symbol: currentAsset,
          type: "MANUAL_CLOSE",
          directionLabel: "Dual Flatten / Close All",
          quantity,
          leg1Venue: "Binance",
          leg1Side: "CLOSE",
          leg1Price: 0,
          leg1OrderId: data.binance?.orders?.[0]?.orderId,
          leg2Venue: "Bitget",
          leg2Side: "CLOSE",
          leg2Price: 0,
          leg2OrderId: data.bitget?.orders?.[0]?.orderId,
          interLegDeltaMs: data.interLegCloseDeltaMs || 0,
          realizedPnl: 0,
          status: "CLOSED",
        });
      }
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setCockpitError(`Close Failed: ${err.message}`);
      setTimeout(() => setCockpitError(null), 8000);
    } finally {
      setLoadingAction(null);
    }
  };

  const executeHedgeBenchmark = async () => {
    setLoadingAction("HEDGE_BENCHMARK");
    try {
      const res = await fetch("/api/hedge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getVaultHeaders(),
        },
        body: JSON.stringify({
          action: "benchmark",
          symbol: currentAsset,
          quantity: parseFloat(quantity),
          leg1Side: "SELL",
          staggerPolicy,
          manualDelayMs,
          manualVenue,
          bypassSniper: true,
          binanceLeverage: effectiveBinanceLeverage,
          bitgetLeverage: effectiveBitgetLeverage,
          leverage: effectiveBinanceLeverage,
          corridor: executionCorridor,
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
          title ? `Server error (${res.status}): ${title}` : `Server returned HTTP ${res.status}`
        );
      }
      if (!data.success) throw new Error(data.error || "Benchmark failed");
      setLastReceipt({
        type: "HEDGE_BENCHMARK",
        data,
      });
      if (onTradeExecuted) {
        onTradeExecuted({
          id: `BMK-${Date.now().toString().slice(-6)}`,
          timestamp: Date.now(),
          symbol: currentAsset,
          type: "BENCHMARK",
          directionLabel: `Short ${venueAName} + Long ${venueBName} (1.2s Auto-Closed)`,
          quantity,
          leg1Venue: venueAName,
          leg1Side: "SELL -> BUY",
          leg1Price: data.entry?.leg1?.price || 0,
          leg1OrderId: data.entry?.leg1?.orderId,
          leg2Venue: venueBName,
          leg2Side: "BUY -> SELL",
          leg2Price: data.entry?.leg2?.price || 0,
          leg2OrderId: data.entry?.leg2?.orderId,
          interLegDeltaMs: data.entry?.interLegDeltaMs || 0,
          realizedPnl: data.pnl?.netPnl || 0,
          status: "DELTA_NEUTRAL",
        });
      }
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setCockpitError(`Hedge Benchmark Failed: ${err.message}`);
      setTimeout(() => setCockpitError(null), 8000);
    } finally {
      setLoadingAction(null);
    }
  };

  const numQty = parseFloat(quantity || "0") || 0;
  const effectivePrice = bnPrice > 0 ? bnPrice : markPrice > 0 ? markPrice : (bitgetPrice > 0 ? bitgetPrice : 1);
  const notionalDollars = numQty * effectivePrice;
  const estMarginBinance = notionalDollars / effectiveVenueALeverage;
  const estMarginVenueB = notionalDollars / effectiveVenueBLeverage;
  const estMarginBitget = estMarginVenueB;
  const totalMargin = estMarginBinance + estMarginVenueB;

  const hasDisparity = effectiveVenueALeverage !== effectiveVenueBLeverage;
  const disparityRatio = hasDisparity
    ? Math.max(effectiveVenueALeverage, effectiveVenueBLeverage) / Math.min(effectiveVenueALeverage, effectiveVenueBLeverage)
    : 1;
  const lowerLeverageVenue = effectiveVenueALeverage < effectiveVenueBLeverage
    ? venueAName
    : effectiveVenueBLeverage < effectiveVenueALeverage
    ? venueBName
    : null;

  // Real-time interactive calculation results
  const autoSplitResult = calculateAutoSplit(autoSplitBudget, effectiveVenueALeverage, effectiveVenueBLeverage);
  const singleLegResult = calculateSingleLegMatch(singleLegInputMargin, singleLegInputVenue, effectiveVenueALeverage, effectiveVenueBLeverage);

  const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT"];
  const normalizedCurrent = currentAsset.toUpperCase().endsWith("USDT")
    ? currentAsset.toUpperCase()
    : `${currentAsset.toUpperCase()}USDT`;
  const isCustomAsset = !DEFAULT_SYMBOLS.includes(normalizedCurrent);

  return (
    <div className="bg-surface rounded-xl border border-border p-3.5 sm:p-5 flex flex-col justify-between font-mono transition-all duration-300">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-accent-amber animate-pulse" />
          <h2 className="text-sm font-semibold text-zinc-100 tracking-wide uppercase">
            ORDER EXECUTION PANEL
          </h2>
          {isCollapsed && (
            <div className="flex flex-wrap items-center gap-1.5 ml-2">
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30 font-bold">
                {normalizedCurrent}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
                {effectiveVenueALeverage}x / {effectiveVenueBLeverage}x LEV
              </span>
              {notionalDollars > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-accent-cyan border border-zinc-700 font-mono">
                  ${notionalDollars.toFixed(0)} Notional
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span className={`px-2 py-0.5 rounded text-[9px] font-bold border font-mono ${visualsA.bgSubtle} ${visualsA.color} ${visualsA.border}`}>
            {venueAName.toUpperCase()} + {venueBName.toUpperCase()}
          </span>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors ml-1"
            title={isCollapsed ? "Expand Execution Panel" : "Collapse Execution Panel"}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Cockpit Error Banner (Always visible if present) */}
      {cockpitError && (
        <div className="my-3 px-3.5 py-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center justify-between shadow-lg shadow-rose-950/30 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{cockpitError}</span>
          </div>
          <button
            onClick={() => setCockpitError(null)}
            className="text-zinc-400 hover:text-zinc-100 text-xs px-2 py-0.5 rounded hover:bg-rose-900/50 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isCollapsed ? "grid-rows-[0fr] opacity-0 pointer-events-none" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden space-y-4">
          {/* Live Zero-Lag FinTech Opportunity Corridor Gauge (Skill Blueprint B) */}
          <div className="mt-3">
            <TradingCockpitMeter
              symbol={normalizedCurrent}
              spreadBps={spreadBps}
              primeThresholdBps={internalMinSpread}
              venueA={venueAName.toUpperCase()}
              venueB={venueBName.toUpperCase()}
              annualizedApr={((Math.abs(spreadBps) * 3 * 365) / 100)}
              settlementHours={fundingIntervalHours}
            />
          </div>

          {/* Multi-Asset Selector Bar */}
          <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-zinc-400 uppercase font-semibold">
              SELECT TRADING ASSET
            </label>
            <span className="text-[10px] text-accent-amber font-mono">
              LOADED: {normalizedCurrent}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {DEFAULT_SYMBOLS.map((sym) => {
              const isSelected = normalizedCurrent === sym;
              const label = sym.replace("USDT", "");
              return (
                <button
                  key={sym}
                  onClick={() => handleAssetSelect(sym)}
                  className={`py-1.5 px-2 rounded text-xs font-bold transition-all ${
                    isSelected
                      ? "bg-accent-amber text-zinc-950 shadow-md font-black ring-1 ring-amber-400"
                      : "bg-surface-card hover:bg-zinc-800 border border-border text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {label}
                </button>
              );
            })}
            {isCustomAsset ? (
              <button
                onClick={() => handleAssetSelect(normalizedCurrent)}
                className="py-1.5 px-2 rounded text-xs font-bold bg-accent-amber text-zinc-950 shadow-md font-black ring-1 ring-amber-400 truncate flex items-center justify-center space-x-1"
                title={`Active custom asset: ${normalizedCurrent}`}
              >
                <span>{normalizedCurrent.replace("USDT", "")}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-950 animate-pulse shrink-0" />
              </button>
            ) : (
              <div
                className="py-1.5 px-2 rounded text-[10px] text-zinc-600 bg-zinc-900/40 border border-dashed border-zinc-800 flex items-center justify-center select-none"
                title="Select any ranked coin from the scanner table below"
              >
                + COIN
              </div>
            )}
          </div>
        </div>

        {/* DYNAMIC LEVERAGE CONTROL ENGINE & COLLATERAL BALANCER */}
        <div className="mt-4 p-3.5 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-3 font-mono">
          {/* Header with Max Leverage comparison and highest badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pb-2 border-b border-zinc-800/80">
            <div className="flex items-center space-x-2">
              <Gauge className="w-4 h-4 text-accent-amber shrink-0" />
              <div>
                <span className="text-zinc-200 font-bold text-xs tracking-wide uppercase">
                  DYNAMIC LEVERAGE &amp; MARGIN BALANCER
                </span>
                <div className="flex items-center space-x-1.5 mt-0.5">
                  <span className="text-[10px] text-zinc-400">
                    {venueAName}: <strong className="text-accent-amber">{venueAMaxLev}x max</strong> • {venueBName}:{" "}
                    <strong className="text-cyan-400">{venueBMaxLev}x max</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-accent-amber border border-amber-500/30 flex items-center space-x-1 shadow-sm">
                <Sparkles className="w-3 h-3 text-accent-amber animate-pulse" />
                <span>MAX AVAILABLE: <strong>{highestCorridorLev}x</strong> ({highestCorridorVenue})</span>
              </span>
              <button
                onClick={() => setShowCustomSplit((prev) => !prev)}
                className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors ${
                  showCustomSplit
                    ? "bg-amber-500/20 text-accent-amber border-amber-500/40"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                }`}
                title="Toggle independent venue leverage split sliders"
              >
                ⚡ {showCustomSplit ? "Hide Split" : "Custom Split"}
              </button>
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="grid grid-cols-6 gap-1.5">
            {(["MAX", "50", "30", "20", "10", "5"] as const).map((m) => {
              const isSelected = leveragePreset === m && !showCustomSplit;
              return (
                <button
                  key={m}
                  onClick={() => handlePresetSelect(m)}
                  className={`py-1 rounded text-[10px] font-bold transition-all border ${
                    isSelected
                      ? "bg-amber-500/20 text-accent-amber border-amber-500/50 shadow-sm"
                      : "bg-surface-card border-border text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                  }`}
                >
                  {m === "MAX" ? "MAX LEV" : `${m}x`}
                </button>
              );
            })}
          </div>

          {/* Expandable Custom Venue Split Panel */}
          {showCustomSplit && (
            <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 space-y-3 text-[10px] animate-fadeIn">
              <div className="flex items-center justify-between text-zinc-300 font-bold border-b border-zinc-800 pb-1.5">
                <span className="flex items-center space-x-1.5">
                  <Sliders className="w-3.5 h-3.5 text-accent-amber" />
                  <span>INDEPENDENT VENUE LEVERAGE SPLIT</span>
                </span>
                <button
                  onClick={handleEqualizeMax}
                  className="px-2 py-0.5 rounded bg-amber-500 text-zinc-950 font-black text-[9px] hover:bg-amber-400 transition-colors shadow-sm"
                >
                  ⚡ Use Coin Max ({venueAMaxLev}x / {venueBMaxLev}x)
                </button>
              </div>

              {/* Venue A Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
                    <span>{venueAName} Leverage:</span>
                  </span>
                  <div className="flex items-center space-x-1">
                    <strong className={`${visualsA.color} font-mono text-xs`}>{venueALeverage}x</strong>
                    <span className="text-zinc-500 text-[9px]">(Max {venueAMaxLev}x)</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="range"
                    min="1"
                    max={venueAMaxLev}
                    step="1"
                    value={venueALeverage}
                    onChange={(e) => {
                      setVenueALeverage(parseInt(e.target.value, 10));
                      setLeveragePreset("CUSTOM");
                    }}
                    className="w-full accent-amber-400 h-1.5 bg-zinc-800 rounded cursor-pointer"
                  />
                  <div className="flex space-x-1 shrink-0">
                    {[10, 20, 30, venueAMaxLev].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
                      <button
                        key={v}
                        onClick={() => {
                          setVenueALeverage(v);
                          setLeveragePreset("CUSTOM");
                        }}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                          venueALeverage === v
                            ? `${visualsA.bgSubtle} ${visualsA.color} ${visualsA.border}`
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {v}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Venue B Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    <span>{venueBName} Leverage:</span>
                  </span>
                  <div className="flex items-center space-x-1">
                    <strong className={`${visualsB.color} font-mono text-xs`}>{venueBLeverage}x</strong>
                    <span className="text-zinc-500 text-[9px]">(Max {venueBMaxLev}x)</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="range"
                    min="1"
                    max={venueBMaxLev}
                    step="1"
                    value={venueBLeverage}
                    onChange={(e) => {
                      setVenueBLeverage(parseInt(e.target.value, 10));
                      setLeveragePreset("CUSTOM");
                    }}
                    className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded cursor-pointer"
                  />
                  <div className="flex space-x-1 shrink-0">
                    {[10, 20, 30, venueBMaxLev].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
                      <button
                        key={v}
                        onClick={() => {
                          setVenueBLeverage(v);
                          setLeveragePreset("CUSTOM");
                        }}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                          venueBLeverage === v
                            ? `${visualsB.bgSubtle} ${visualsB.color} ${visualsB.border}`
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {v}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* INTERACTIVE ASYMMETRIC MARGIN BALANCING CALCULATOR */}
          <div className="p-3.5 rounded-lg bg-zinc-900/90 border border-amber-500/30 space-y-3">
            {/* Mode Switch Tabs */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-xs font-bold text-zinc-200 flex items-center space-x-1.5">
                <Sliders className="w-3.5 h-3.5 text-accent-amber" />
                <span>MARGIN BALANCING CALCULATOR</span>
              </span>
              <div className="flex items-center space-x-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setCalcMode("AUTO_SPLIT")}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${
                    calcMode === "AUTO_SPLIT"
                      ? "bg-accent-amber text-zinc-950 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  ⚡ Auto-Split Total Budget
                </button>
                <button
                  type="button"
                  onClick={() => setCalcMode("SINGLE_LEG")}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${
                    calcMode === "SINGLE_LEG"
                      ? "bg-accent-amber text-zinc-950 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  🎯 Single-Leg Matcher
                </button>
              </div>
            </div>

            {/* TAB 1: AUTO-SPLIT TOTAL BUDGET */}
            {calcMode === "AUTO_SPLIT" && (
              <div className="space-y-2.5 text-[10px] animate-fadeIn">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5">
                  <span className="text-zinc-400">
                    Enter total USD capital budget. Auto-splits across {effectiveVenueALeverage}x &amp; {effectiveVenueBLeverage}x to guarantee 100% equal notional hedge sizing:
                  </span>
                  <div className="flex items-center space-x-1">
                    {[20, 25, 30, 50, 100, 200, 500].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => handleBudgetChange(b)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                          autoSplitBudget === b
                            ? "bg-amber-500/20 text-accent-amber border-amber-500/40"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        ${b}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-zinc-400 font-semibold shrink-0">Total Budget ($):</span>
                  <input
                    type="number"
                    min="1"
                    step="5"
                    value={autoSplitBudget}
                    onChange={(e) => handleBudgetChange(parseFloat(e.target.value) || 0)}
                    className="w-32 px-2.5 py-1 text-xs bg-zinc-950 border border-zinc-700 rounded font-mono text-zinc-100 focus:outline-none focus:border-accent-amber"
                    placeholder="e.g. 30"
                  />
                  <span className="text-zinc-500 text-[9px]">USDT Capital</span>
                </div>

                {/* Auto-Split Visual Breakdown Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <div className="p-2.5 rounded bg-zinc-950/80 border border-amber-500/30 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 font-bold flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
                        <span>{venueAName} Margin ({effectiveVenueALeverage}x):</span>
                      </span>
                      <strong className={`${visualsA.color} font-mono text-xs`}>
                        ${autoSplitResult.marginA.toFixed(2)} USDT
                      </strong>
                    </div>
                    <div className="text-[9px] text-zinc-500 flex justify-between">
                      <span>Resulting Notional:</span>
                      <span className="text-zinc-300 font-mono font-bold">
                        ${autoSplitResult.matchedNotional.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-zinc-950/80 border border-cyan-500/30 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 font-bold flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <span>{venueBName} Margin ({effectiveVenueBLeverage}x):</span>
                      </span>
                      <strong className={`${visualsB.color} font-mono text-xs`}>
                        ${autoSplitResult.marginB.toFixed(2)} USDT
                      </strong>
                    </div>
                    <div className="text-[9px] text-zinc-500 flex justify-between">
                      <span>Resulting Notional:</span>
                      <span className="text-zinc-300 font-mono font-bold">
                        ${autoSplitResult.matchedNotional.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Combined Summary & Auto-Applied Status */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-zinc-950/90 border border-zinc-800 text-[10px]">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>
                      1:1 Equal Notional: <strong className="text-emerald-400 font-mono text-xs">${autoSplitResult.matchedNotional.toFixed(2)}</strong> • Total Collateral: <strong className="text-zinc-100 font-mono">${autoSplitResult.totalMargin.toFixed(2)}</strong>
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-bold text-[9px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>⚡ Auto-Applied to Order ({quantity} {assetMeta.base})</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SINGLE-LEG MARGIN MATCHER */}
            {calcMode === "SINGLE_LEG" && (
              <div className="space-y-2.5 text-[10px] animate-fadeIn">
                <div className="text-zinc-400">
                  Enter margin placed on one exchange. The engine calculates how much margin you MUST place on the counterpart exchange to match leverage and eliminate directional exposure:
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center space-x-1 bg-zinc-950 p-0.5 rounded border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setSingleLegInputVenue("A")}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        singleLegInputVenue === "A"
                          ? "bg-accent-amber text-zinc-950"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Placing on {venueAName} ({effectiveVenueALeverage}x)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSingleLegInputVenue("B")}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        singleLegInputVenue === "B"
                          ? "bg-cyan-500 text-zinc-950"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Placing on {venueBName} ({effectiveVenueBLeverage}x)
                    </button>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <span className="text-zinc-400 font-semibold">Margin:</span>
                    <input
                      type="number"
                      min="1"
                      step="5"
                      value={singleLegInputMargin}
                      onChange={(e) => handleSingleLegMarginChange(parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 text-xs bg-zinc-950 border border-zinc-700 rounded font-mono text-zinc-100 focus:outline-none focus:border-accent-amber"
                      placeholder="e.g. 20"
                    />
                    <span className="text-zinc-500 text-[9px]">USDT</span>
                  </div>

                  <div className="flex items-center space-x-1">
                    {[20, 25, 30, 50, 100, 200, 500].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleSingleLegMarginChange(m)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                          singleLegInputMargin === m
                            ? "bg-amber-500/20 text-accent-amber border-amber-500/40"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        ${m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Single-Leg Matcher Visual Breakdown Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <div className="p-2.5 rounded bg-zinc-950/80 border border-zinc-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 font-bold flex items-center space-x-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${singleLegResult.inputVenue === "A" ? "bg-accent-amber" : "bg-cyan-400"}`} />
                        <span>Input Leg ({singleLegResult.inputVenue === "A" ? venueAName : venueBName}):</span>
                      </span>
                      <strong className={`font-mono text-xs ${singleLegResult.inputVenue === "A" ? visualsA.color : visualsB.color}`}>
                        ${(singleLegResult.inputVenue === "A" ? singleLegResult.marginA : singleLegResult.marginB).toFixed(2)} USDT
                      </strong>
                    </div>
                    <div className="text-[9px] text-zinc-500 flex justify-between">
                      <span>Notional Generated ({singleLegResult.inputVenue === "A" ? effectiveVenueALeverage : effectiveVenueBLeverage}x):</span>
                      <span className="text-zinc-300 font-mono font-bold">
                        ${singleLegResult.matchedNotional.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded bg-emerald-950/30 border border-emerald-500/40 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-300 font-bold flex items-center space-x-1">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>REQUIRED on {singleLegResult.inputVenue === "A" ? venueBName : venueAName}:</span>
                      </span>
                      <strong className="text-emerald-400 font-mono text-xs">
                        ${(singleLegResult.inputVenue === "A" ? singleLegResult.marginB : singleLegResult.marginA).toFixed(2)} USDT
                      </strong>
                    </div>
                    <div className="text-[9px] text-emerald-200/80 flex justify-between">
                      <span>Matches Notional ({singleLegResult.inputVenue === "A" ? effectiveVenueBLeverage : effectiveVenueALeverage}x):</span>
                      <span className="text-emerald-300 font-mono font-bold">
                        ${singleLegResult.matchedNotional.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Combined Summary & Auto-Applied Status */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-zinc-950/90 border border-zinc-800 text-[10px]">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>
                      Total Required Collateral: <strong className="text-accent-amber font-mono text-xs">${singleLegResult.totalMargin.toFixed(2)}</strong> (Equal Notional: <strong className="text-zinc-200 font-mono">${singleLegResult.matchedNotional.toFixed(2)}</strong>)
                    </span>
                  </div>
                  <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-bold text-[9px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>⚡ Auto-Applied to Order ({quantity} {assetMeta.base})</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Adaptable Collateral Margin Breakdown for Current Order Quantity */}
          <div className="grid grid-cols-2 gap-2 text-[10px] pt-1 border-t border-zinc-800/80">
            <div className="p-2 rounded bg-zinc-900 border border-zinc-800 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-zinc-400 font-medium">{venueAName} Margin ({effectiveVenueALeverage}x):</span>
                <span className="text-[9px] text-zinc-500 font-mono">Notional: ${notionalDollars.toFixed(2)}</span>
              </div>
              <strong className={`${visualsA.color} font-mono text-xs`}>${estMarginBinance.toFixed(2)}</strong>
            </div>
            <div className="p-2 rounded bg-zinc-900 border border-zinc-800 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-zinc-400 font-medium">{venueBName} Margin ({effectiveVenueBLeverage}x):</span>
                <span className="text-[9px] text-zinc-500 font-mono">Notional: ${notionalDollars.toFixed(2)}</span>
              </div>
              <strong className={`${visualsB.color} font-mono text-xs`}>${estMarginVenueB.toFixed(2)}</strong>
            </div>
          </div>

          {/* Combined Margin Requirement */}
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-zinc-900/60 border border-zinc-800/60 text-[10px]">
            <span className="text-zinc-400 flex items-center space-x-1.5">
              <span>Total Current Order Collateral:</span>
              <span className="text-[9px] text-zinc-500">({venueAName} + {venueBName})</span>
            </span>
            <strong className="text-zinc-100 font-mono text-xs">${totalMargin.toFixed(2)}</strong>
          </div>

          {/* Collateral Parity / Disparity Analyzer */}
          {!hasDisparity ? (
            <div className="px-2.5 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-between">
              <span className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>1:1 Leverage Parity ({effectiveVenueALeverage}x) — Equal capital utilization (${estMarginBinance.toFixed(2)} each)</span>
              </span>
              <span className="font-bold font-mono text-[9px] uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                1:1 MATCH
              </span>
            </div>
          ) : (
            <div className="px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] flex items-center justify-between gap-2">
              <div className="flex items-center space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  Disparity ({disparityRatio.toFixed(1)}x): {lowerLeverageVenue} ({Math.min(effectiveVenueALeverage, effectiveVenueBLeverage)}x) consumes{" "}
                  <strong>{disparityRatio.toFixed(1)}x more margin</strong> (${(lowerLeverageVenue === venueAName ? estMarginBinance : estMarginVenueB).toFixed(2)}) due to lower leverage.
                </span>
              </div>
              <button
                onClick={handleEqualizeMax}
                className="px-2 py-0.5 rounded bg-amber-500 text-zinc-950 font-black text-[9px] whitespace-nowrap hover:bg-amber-400 transition-colors shadow-sm shrink-0"
                title="Equalize to coin max leverage to minimize margin commitment"
              >
                ⚡ Use Max
              </button>
            </div>
          )}
        </div>

        {/* AUTO-WAIT LIMIT SNIPER & PRICE DIVERGENCE GUARD */}
        <div className="mt-4 p-3 rounded-lg bg-surface-card border border-border space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-300 font-bold flex items-center space-x-1.5 text-[11px]">
              <Crosshair className="w-3.5 h-3.5 text-accent-cyan" />
              <span>AUTO-WAIT BASIS SNIPER</span>
            </span>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                effectiveDivergencePct > maxPriceDivergencePct
                  ? "bg-rose-500/10 text-rose-400 border-rose-500/30 font-bold animate-pulse"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              }`}
            >
              Gap: {effectiveDivergencePct.toFixed(2)}% {effectiveDivergencePct > maxPriceDivergencePct ? "⚠️ (EXCEEDS LIMIT)" : "✓ (OPTIMAL)"}
            </span>
          </div>

          <div className="flex items-center space-x-3 text-[10px]">
            <span className="text-zinc-400 whitespace-nowrap">Tolerance:</span>
            <input
              type="range"
              min="0.05"
              max="1.50"
              step="0.05"
              value={maxPriceDivergencePct}
              onChange={(e) => setMaxPriceDivergencePct(parseFloat(e.target.value))}
              className="flex-1 accent-amber-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
            />
            <span className="font-mono text-accent-amber font-bold w-12 text-right">
              {maxPriceDivergencePct.toFixed(2)}%
            </span>
          </div>

          <div className="flex items-center justify-between gap-1.5 pt-1 text-[9px]">
            <span className="text-zinc-500">Presets:</span>
            <div className="flex gap-1.5">
              {[
                { label: "Tight 0.10%", val: 0.1 },
                { label: "Normal 0.25%", val: 0.25 },
                { label: "Relaxed 0.50%", val: 0.5 },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => setMaxPriceDivergencePct(p.val)}
                  className={`px-2 py-0.5 rounded border transition-colors ${
                    maxPriceDivergencePct === p.val
                      ? "bg-accent-amber/20 text-accent-amber border-amber-500/40"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ACTIVE TRADEABLE ORDER SIZING (DIRECT AUTO-SYNC WITH MARGIN BALANCER) */}
        <div className="mt-4 p-3 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <label className="text-[11px] font-bold text-zinc-200 tracking-wide uppercase">
                ACTIVE TRADEABLE ORDER SIZING
              </label>
            </div>
            <div className="flex items-center space-x-2 text-[10px]">
              <span className="text-zinc-400">Notional:</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono font-bold text-xs">
                ${notionalDollars.toFixed(2)} USDT
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
            {/* Direct Coin Units Field (Two-Way Synced) */}
            <div className="sm:col-span-6 flex items-center space-x-2 bg-zinc-900/90 p-2 rounded-lg border border-zinc-700/80">
              <span className="text-[10px] text-zinc-400 font-bold uppercase shrink-0">
                Trade Units ({assetMeta.base}):
              </span>
              <input
                type="number"
                step={assetMeta.step}
                value={quantity}
                onChange={(e) => handleQuantityManualChange(e.target.value)}
                className="w-full px-2 py-1 text-sm bg-zinc-950 border border-zinc-700 rounded font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-400"
                placeholder={`Enter ${assetMeta.base}`}
              />
            </div>

            {/* Collateral Allocation Breakdown */}
            <div className="sm:col-span-6 flex flex-col justify-center px-2.5 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 font-medium">Required Collateral:</span>
                <strong className="text-zinc-100 font-mono text-xs">${totalMargin.toFixed(2)} Total</strong>
              </div>
              <div className="text-[9px] text-zinc-500 font-mono flex items-center justify-between pt-0.5">
                <span>{venueAName} ({effectiveVenueALeverage}x): <strong className={visualsA.color}>${estMarginBinance.toFixed(2)}</strong></span>
                <span>+</span>
                <span>{venueBName} ({effectiveVenueBLeverage}x): <strong className={visualsB.color}>${estMarginVenueB.toFixed(2)}</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* ACTIVE SNIPER WAITING BANNER (IF ARMED) */}
        {sniperWaitingDirection && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs space-y-2 animate-pulse">
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center space-x-1.5">
                <Crosshair className="w-4 h-4 text-accent-amber animate-spin" />
                <span>SNIPER ARMED: WAITING FOR BASIS COMPRESSION</span>
              </span>
              <span className="font-mono text-[10px] bg-zinc-950/80 px-2 py-0.5 rounded border border-amber-500/30">
                Gap: {effectiveDivergencePct.toFixed(2)}% &gt; {maxPriceDivergencePct.toFixed(2)}%
              </span>
            </div>
            <p className="text-[10px] text-zinc-300">
              Holding entry until Binance (${bnPrice.toFixed(2)}) and Bitget (${bgPrice.toFixed(2)}) prices converge within {maxPriceDivergencePct.toFixed(2)}% tolerance.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => executeHedge(sniperWaitingDirection, true)}
                className="flex-1 py-1.5 px-3 rounded bg-amber-500 text-zinc-950 font-bold text-[10px] hover:bg-amber-400 transition-colors"
              >
                ⚡ FORCE EXECUTE NOW (Bypass Sniper)
              </button>
              <button
                onClick={() => setSniperWaitingDirection(null)}
                className="py-1.5 px-3 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] hover:text-white"
              >
                ✕ Cancel
              </button>
            </div>
          </div>
        )}

        {/* Dual-Leg Real-Time Hedging Execution Controls */}
        {(() => {
          const isShortBnOptimal =
            binanceFundingRate !== undefined && bitgetFundingRate !== undefined
              ? binanceFundingRate >= bitgetFundingRate
              : spreadBps >= 0;

          return (
            <div className="mt-4">
              {/* Execution Corridor Selector */}
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] text-zinc-400 uppercase font-semibold">
                  LIVE PERSISTENT HEDGE ENTRY ({venueAName.toUpperCase()} ⇄ {venueBName.toUpperCase()})
                </label>
                <span className="text-[9px] text-emerald-400 font-mono">
                  Positions reflect in Live Table
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  onClick={() => executeHedge("SHORT_BINANCE_LONG_BITGET")}
                  disabled={!!loadingAction}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all disabled:opacity-50 text-xs font-bold relative active:scale-[0.98] ${
                    isShortBnOptimal
                      ? "bg-amber-500/20 border-amber-500/50 text-accent-amber ring-1 ring-amber-500/40 shadow-lg shadow-amber-500/10"
                      : "bg-surface-card border-border text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                  }`}
                >
                  {isShortBnOptimal && (
                    <span className="text-[8px] px-1.5 py-0.2 rounded bg-accent-amber text-zinc-950 font-black mb-1">
                      ★ RECOMMENDED HARVEST
                    </span>
                  )}
                  {loadingAction === "SHORT_BINANCE_LONG_BITGET" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mb-1" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 mb-1" />
                  )}
                  <span>SHORT {venueAName.toUpperCase()}</span>
                  <span className={`text-[10px] font-medium ${visualsB.color}`}>
                    + LONG {venueBName.toUpperCase()} ({quantity} {assetMeta.base} • ${notionalDollars.toFixed(0)} Notional)
                  </span>
                  <span className="text-[9px] text-zinc-400 mt-0.5">Keep Open In Table</span>
                </button>

                <button
                  onClick={() => executeHedge("LONG_BINANCE_SHORT_BITGET")}
                  disabled={!!loadingAction}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all disabled:opacity-50 text-xs font-bold relative active:scale-[0.98] ${
                    !isShortBnOptimal
                      ? "bg-cyan-500/20 border-cyan-500/50 text-accent-cyan ring-1 ring-cyan-500/40 shadow-lg shadow-cyan-500/10"
                      : "bg-surface-card border-border text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                  }`}
                >
                  {!isShortBnOptimal && (
                    <span className="text-[8px] px-1.5 py-0.2 rounded font-black mb-1 bg-accent-cyan text-zinc-950">
                      ★ RECOMMENDED HARVEST
                    </span>
                  )}
                  {loadingAction === "LONG_BINANCE_SHORT_BITGET" ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mb-1" />
                  ) : (
                    <ArrowUpRight className="w-4 h-4 mb-1" />
                  )}
                  <span>LONG {venueAName.toUpperCase()}</span>
                  <span className={`text-[10px] font-medium ${visualsB.color}`}>
                    + SHORT {venueBName.toUpperCase()} ({quantity} {assetMeta.base} • ${notionalDollars.toFixed(0)} Notional)
                  </span>
                  <span className="text-[9px] text-zinc-400 mt-0.5">Keep Open In Table</span>
                </button>
              </div>
            </div>
          );
        })()}

        {/* DEDICATED EMERGENCY RISK CONTROLS PANEL (SEPARATED FROM SPEED TESTS) */}
        <div className="mt-5 p-3.5 rounded-xl bg-gradient-to-br from-rose-950/20 via-zinc-950 to-zinc-950 border border-rose-900/40 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-400 flex items-center space-x-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-accent-rose" />
              <span>EMERGENCY RISK CONTROLS</span>
            </span>
            <span className="text-[9px] text-zinc-500 font-mono">
              Global Position Unwind
            </span>
          </div>

          {/* Safety Arming Tick Checkbox */}
          <label className="flex items-center space-x-2 text-[10px] cursor-pointer select-none py-1 px-2 rounded bg-zinc-900/80 border border-zinc-800">
            <input
              type="checkbox"
              checked={isKillSwitchArmed}
              onChange={(e) => setIsKillSwitchArmed(e.target.checked)}
              className="rounded border-zinc-700 text-rose-600 focus:ring-rose-500 bg-zinc-950 cursor-pointer"
            />
            <span className={isKillSwitchArmed ? "text-rose-300 font-bold flex items-center gap-1" : "text-zinc-400 flex items-center gap-1"}>
              {isKillSwitchArmed ? <Unlock className="w-3 h-3 text-rose-400" /> : <Lock className="w-3 h-3 text-zinc-500" />}
              <span>Arm Emergency Kill Switch (Check to unlock instant total liquidation)</span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={executeCloseAll}
              disabled={!!loadingAction}
              className="py-2 px-3 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs flex items-center justify-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>FLATTEN ALL</span>
            </button>

            <button
              onClick={executeCloseAll}
              disabled={!isKillSwitchArmed || !!loadingAction}
              className={`py-2 px-3 rounded text-xs flex items-center justify-center space-x-1.5 transition-all font-bold ${
                isKillSwitchArmed
                  ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/60 ring-2 ring-rose-400 cursor-pointer active:scale-95 animate-pulse"
                  : "bg-zinc-900/50 border border-zinc-800 text-zinc-600 cursor-not-allowed opacity-40"
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{isKillSwitchArmed ? "🚨 EXECUTE KILL SWITCH" : "KILL SWITCH (LOCKED)"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Transaction Receipt */}
      {lastReceipt && (
        <div className="mt-4 p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 space-y-1">
          <div className="font-semibold text-zinc-200 uppercase flex justify-between">
            <span>RECEIPT: {lastReceipt.type} ({lastReceipt.data?.symbol || currentAsset})</span>
            <span className="text-accent-emerald flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              CONFIRMED
            </span>
          </div>
          {lastReceipt.data?.orderId && (
            <div>Order ID: {lastReceipt.data.orderId} • Status: {lastReceipt.data.status}</div>
          )}
          {lastReceipt.type === "HEDGE_ENTRY" && lastReceipt.data && (
            <div className="text-accent-cyan flex flex-wrap gap-x-1.5">
              <span>Arrival Delta: {lastReceipt.data.interLegDeltaMs}ms</span>
              <span>•</span>
              <span>Total Entry: {lastReceipt.data.totalEntryMs}ms</span>
              {lastReceipt.data.leadStaggerAppliedMs > 0 && (
                <>
                  <span>•</span>
                  <span className="text-accent-amber">Stagger: {lastReceipt.data.leadStaggerAppliedMs}ms ({lastReceipt.data.staggerVenue})</span>
                </>
              )}
            </div>
          )}
          {lastReceipt.data?.entry && (
            <div className="text-accent-cyan flex flex-wrap gap-x-1.5">
              <span>Inter-Leg Delta: {lastReceipt.data.entry.interLegDeltaMs}ms</span>
              <span>•</span>
              <span>Dual-Close: {lastReceipt.data.exit?.dualCloseLatencyMs}ms</span>
              {lastReceipt.data.entry.leadStaggerAppliedMs > 0 && (
                <>
                  <span>•</span>
                  <span className="text-accent-amber">Stagger: {lastReceipt.data.entry.leadStaggerAppliedMs}ms ({lastReceipt.data.entry.staggerVenue})</span>
                </>
              )}
            </div>
          )}
          {lastReceipt.data?.interLegCloseDeltaMs !== undefined && (
            <div className="text-accent-cyan flex flex-wrap gap-x-1.5">
              <span>Dual-Close Latency: {lastReceipt.data.dualCloseLatencyMs}ms</span>
              <span>•</span>
              <span>Inter-Leg Close Delta: {lastReceipt.data.interLegCloseDeltaMs}ms</span>
            </div>
          )}
          {lastReceipt.data?.pnl && (
            <div className="text-accent-emerald font-bold">
              Net Directional PnL: ${lastReceipt.data.pnl.netPnl} USDT (Delta Neutral: {String(lastReceipt.data.pnl.deltaNeutralSuccess)})
            </div>
          )}
          {lastReceipt.message && <div>{lastReceipt.message}</div>}
        </div>
      )}
      </div>
    </div>
  );
}
