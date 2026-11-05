"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Calculator,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Scale,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
  Sparkles,
  Zap,
  ArrowRight,
} from "lucide-react";
import {
  simulatePreTradeExecution,
  formatPrice,
  formatCoins,
  formatUsdt,
  formatSignedUsdt,
  formatSignedBps,
  formatSignedPct,
  formatRoe,
  formatPriceDiff,
  type LiquidityTier,
} from "@/lib/slippageSimulator";

interface PreTradeSlippageSimulatorProps {
  symbol?: string;
  venueAName?: string;
  venueBName?: string;
  venueAPrice?: number;
  venueBPrice?: number;
  fundingSpreadBps?: number;
  defaultFeeBps?: number;
  initialIntervalA?: number;
  initialIntervalB?: number;
}

export default function PreTradeSlippageSimulator({
  symbol = "BTCUSDT",
  venueAName = "CoinDCX",
  venueBName = "Bybit",
  venueAPrice = 65000,
  venueBPrice = 65000,
  fundingSpreadBps = 35.0,
  defaultFeeBps = 24.0,
  initialIntervalA = 8,
  initialIntervalB = 8,
}: PreTradeSlippageSimulatorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showDetailedSteps, setShowDetailedSteps] = useState(false);
  const [showFrictionDetails, setShowFrictionDetails] = useState(false);
  const [showLegDetails, setShowLegDetails] = useState(false);

  // Margin Collateral Input ($) with presets: [$50, $100, $250, $500, $1,000]
  const [marginUsdt, setMarginUsdt] = useState<number>(250);
  // Leverage Selector (x) with presets: [1x, 2x, 5x, 10x, 20x, 30x, 50x]
  const [leverage, setLeverage] = useState<number>(10);

  const [roundtripFeeBps, setRoundtripFeeBps] = useState<number>(defaultFeeBps);
  const [customSpreadBps, setCustomSpreadBps] = useState<number | null>(null);
  const [liquidityTier, setLiquidityTier] = useState<LiquidityTier>("MEDIUM");

  // Synchronize custom spread when symbol changes
  useEffect(() => {
    setCustomSpreadBps(null);
  }, [symbol]);

  // Clean coin ticker extraction
  const coinTicker = useMemo(() => {
    return symbol.replace(/[-_]?(USDT|USDC|USD|PERP)$/i, "") || symbol;
  }, [symbol]);

  // Intelligent fallback prices if live feed is initializing
  const defaultFallbackPrice = useMemo(() => {
    const sym = symbol.toUpperCase();
    if (sym.includes("BTC")) return 65000;
    if (sym.includes("ETH")) return 3500;
    if (sym.includes("SOL")) return 180;
    if (sym.includes("PEPE") || sym.includes("SHIB") || sym.includes("BONK")) return 0.00002;
    if (sym.includes("DOGE") || sym.includes("XRP") || sym.includes("ADA")) return 0.50;
    return 100.0;
  }, [symbol]);

  const effectivePriceA = venueAPrice > 0 ? venueAPrice : defaultFallbackPrice;
  const effectivePriceB = venueBPrice > 0 ? venueBPrice : effectivePriceA;
  const effectiveSpreadBps = customSpreadBps !== null ? customSpreadBps : (fundingSpreadBps || 35.0);

  // Compute all simulation telemetry via mathematical engine
  const result = useMemo(() => {
    return simulatePreTradeExecution({
      marginUsdt,
      leverage,
      capitalUsdt: marginUsdt * leverage,
      priceA: effectivePriceA,
      priceB: effectivePriceB,
      fundingSpreadBps: effectiveSpreadBps,
      roundtripFeeBps,
      liquidityTier,
      intervalHoursA: initialIntervalA || 8,
      intervalHoursB: initialIntervalB || 8,
      timeRemainingSeconds: 8 * 3600,
    });
  }, [
    marginUsdt,
    leverage,
    effectivePriceA,
    effectivePriceB,
    effectiveSpreadBps,
    roundtripFeeBps,
    liquidityTier,
    initialIntervalA,
    initialIntervalB,
  ]);

  const marginPresets = [50, 100, 250, 500, 1000];
  const leveragePresets = [1, 2, 5, 10, 20, 30, 50];

  return (
    <div className="bg-zinc-950/90 rounded-2xl border border-zinc-800 p-4 sm:p-5 font-mono shadow-2xl space-y-4 relative overflow-hidden transition-all duration-300">
      {/* Background Ambient Glow */}
      <div
        className={`absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-20 transition-colors duration-500 ${
          result.marginUsdt === 0
            ? "bg-zinc-700"
            : result.isProfitable
            ? "bg-emerald-500"
            : "bg-rose-500"
        }`}
      />

      {/* Header Bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-zinc-800/80 pb-3 cursor-pointer select-none group"
      >
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-accent-amber shrink-0 group-hover:border-amber-400 transition-colors">
            <Calculator className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-zinc-100 uppercase tracking-wide group-hover:text-white transition-colors">
                PRE-TRADE SLIPPAGE, LIQUIDITY &amp; NET YIELD SIMULATOR
              </h3>
              <span className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase font-semibold">
                ANALYTICAL ONLY • BOT UNTOUCHED
              </span>
            </div>
            {!isExpanded ? (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30 font-bold">
                  {symbol}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
                  ${marginUsdt} ({leverage}x) = ${formatUsdt(result.notionalUsdt)} Notional
                </span>
                {result.marginUsdt > 0 && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold border font-mono ${
                      result.isProfitable
                        ? "bg-emerald-950/50 text-emerald-300 border-emerald-800/60"
                        : "bg-rose-950/50 text-rose-300 border-rose-800/60"
                    }`}
                  >
                    {result.isProfitable ? "PROFITABLE" : "UNPROFITABLE"}: {formatSignedBps(result.netYieldBps)} ({formatSignedUsdt(result.netPnLUsdt)})
                  </span>
                )}
                <span className="text-[10px] text-zinc-500 italic">
                  Click to slide open full simulator
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-400">
                Simulate order book depth impact &amp; verify if funding yield clears slippage + round-trip fees for{" "}
                <span className="text-accent-amber font-bold">{symbol}</span>.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto shrink-0">
          {/* Parity Status Indicator */}
          <span
            className={`text-[10px] px-2.5 py-1 rounded-md border font-bold flex items-center space-x-1 transition-all ${
              result.isParityMatched
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                : "bg-rose-500/15 text-rose-400 border-rose-500/40 animate-pulse"
            }`}
            title={`Expected price difference: ${result.priceDiffPct.toFixed(3)}% (Threshold <= 0.10%)`}
          >
            {result.isParityMatched ? (
              <>
                <CheckCircle2 className="w-3 h-3 mr-1" />
                <span>PARITY MATCHED (≤ 0.1%)</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3 h-3 mr-1" />
                <span>PRICE MISMATCH (&gt; 0.1%)</span>
              </>
            )}
          </span>

          {/* Quick Breakeven Spread Preview Badge */}
          {result.notionalUsdt > 0 && (
            <span
              className={`hidden sm:inline-flex text-[10px] px-2 py-1 rounded-md border font-mono ${
                result.fundingSpreadBps >= result.breakevenSpreadBps
                  ? "bg-emerald-950/40 text-emerald-300 border-emerald-800"
                  : "bg-amber-950/40 text-amber-300 border-amber-800"
              }`}
              title="Minimum funding spread required to cover fees + slippage"
            >
              Breakeven: {result.breakevenSpreadBps.toFixed(1)} bps
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title={isExpanded ? "Collapse Simulator to save space" : "Expand Simulator & Slide Bar"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Body with Vertical Slide Bar (Matching Order Execution Panel) */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          !isExpanded ? "grid-rows-[0fr] opacity-0 pointer-events-none" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto pr-1.5 space-y-4 text-xs scrollbar-thin scrollbar-thumb-zinc-700 hover:scrollbar-thumb-zinc-600 scrollbar-track-zinc-950/50 mt-3">
            {/* Margin Collateral & Leverage Controls Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/80">
              {/* Margin Collateral Input ($) */}
              <div className="md:col-span-4 space-y-1.5">
                <label className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center justify-between">
                  <span>MARGIN COLLATERAL (USDT)</span>
                  <span className="text-accent-amber font-bold">{formatUsdt(marginUsdt)} Collateral</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500">$</span>
                  <input
                    type="number"
                    min="0"
                    max="100000000"
                    step="10"
                    value={marginUsdt === 0 ? "" : marginUsdt}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setMarginUsdt(Number.isFinite(val) ? Math.min(100_000_000, Math.max(0, val)) : 0);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-6 pr-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-accent-amber"
                    placeholder="250"
                  />
                </div>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {marginPresets.map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setMarginUsdt(sz)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                        marginUsdt === sz
                          ? "bg-amber-500/20 text-accent-amber border-accent-amber font-bold"
                          : "bg-zinc-800/80 hover:bg-zinc-800 text-zinc-400 border-zinc-700"
                      }`}
                    >
                      ${sz >= 1000 ? `${sz / 1000}k` : sz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Leverage Selector (x) */}
              <div className="md:col-span-4 space-y-1.5">
                <label className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center justify-between">
                  <span>LEVERAGE MULTIPLIER</span>
                  <span className="text-accent-amber font-bold">{leverage}x Leverage</span>
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {leveragePresets.map((lev) => (
                    <button
                      key={lev}
                      onClick={() => setLeverage(lev)}
                      className={`py-1.5 px-1 rounded text-[10px] font-bold font-mono border text-center transition-all ${
                        leverage === lev
                          ? "bg-amber-500/20 text-accent-amber border-accent-amber ring-1 ring-amber-500/40"
                          : "bg-zinc-950 hover:bg-zinc-800 text-zinc-400 border-zinc-700/80"
                      }`}
                    >
                      {lev}x
                    </button>
                  ))}
                </div>
                <div className="text-[9px] text-zinc-500 flex items-center justify-between pt-0.5">
                  <span>Order depth sweeps full notional</span>
                  <span className="text-zinc-400 font-mono">1x to 50x supported</span>
                </div>
              </div>

              {/* Order Book Depth Profile */}
              <div className="md:col-span-4 space-y-1.5">
                <label className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center justify-between">
                  <span>ORDER BOOK DEPTH</span>
                  <span className="text-zinc-300 font-mono text-[9px]">
                    {liquidityTier} ({result.depthFactor}x)
                  </span>
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {(["DEEP", "MEDIUM", "THIN"] as const).map((tier) => (
                    <button
                      key={tier}
                      onClick={() => setLiquidityTier(tier)}
                      className={`py-1.5 px-2 rounded text-[10px] font-bold border transition-all ${
                        liquidityTier === tier
                          ? "bg-accent-amber/20 text-accent-amber border-accent-amber"
                          : "bg-zinc-950 hover:bg-zinc-800 text-zinc-400 border-zinc-700/60"
                      }`}
                    >
                      {tier === "DEEP" ? "Deep (BTC)" : tier === "MEDIUM" ? "Mid-Cap" : "Thin Alt"}
                    </button>
                  ))}
                </div>
                <div className="text-[9px] text-zinc-500 truncate">
                  {liquidityTier === "DEEP" && "Thick book: Low slippage impact"}
                  {liquidityTier === "MEDIUM" && "Standard book: Moderate impact"}
                  {liquidityTier === "THIN" && "Thin book: Sweeps multiple levels"}
                </div>
              </div>

              {/* Secondary Controls: Roundtrip Fees & Funding Spread */}
              <div className="md:col-span-12 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/60">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 uppercase font-semibold">
                    <span>ROUNDTRIP TAKER FEES</span>
                    <span className="text-zinc-300 font-mono text-[9px]">{roundtripFeeBps} bps</span>
                  </div>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="500"
                    value={roundtripFeeBps}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setRoundtripFeeBps(Number.isFinite(val) ? Math.min(500, Math.max(0, val)) : 0);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-accent-amber"
                    placeholder="24"
                  />
                  <span className="text-[9px] text-zinc-500 font-mono block text-right">Roundtrip Friction</span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 uppercase font-semibold">
                    <span>FUNDING SPREAD</span>
                    {customSpreadBps !== null && (
                      <button
                        onClick={() => setCustomSpreadBps(null)}
                        className="text-accent-amber hover:underline text-[9px] flex items-center space-x-0.5"
                        title="Reset to live websocket feed"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        <span>Reset Live</span>
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="1"
                    value={effectiveSpreadBps}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setCustomSpreadBps(Number.isFinite(val) ? val : 0);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-accent-amber"
                    placeholder="35"
                  />
                  <span className="text-[9px] text-zinc-500 font-mono block text-right">
                    {customSpreadBps !== null ? "Custom bps" : "Live websocket rate"}
                  </span>
                </div>
              </div>
            </div>

            {/* Side-by-side compact cards, expanding to full size when detailed button clicked */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Sequential Equation Breakdown Card (Steps 1-4 hidden behind toggle, Step 5 kept visible) */}
              <div className={`bg-zinc-900/80 rounded-xl border border-zinc-700/80 p-3.5 space-y-2.5 transition-all duration-300 flex flex-col justify-between ${showDetailedSteps ? "md:col-span-2" : "md:col-span-1"}`}>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider flex items-center space-x-1.5">
                  <Scale className="w-3.5 h-3.5 text-accent-amber" />
                  <span>FULL EQUATION BREAKDOWN</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowDetailedSteps(!showDetailedSteps)}
                  className="text-[10px] px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-mono transition-colors flex items-center space-x-1"
                >
                  <span>{showDetailedSteps ? "Hide Detailed Steps" : "Show Detailed Steps"}</span>
                  {showDetailedSteps ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              <div className={showDetailedSteps ? "grid grid-cols-2 md:grid-cols-5 gap-2 items-center" : "grid grid-cols-1 gap-2"}>
                {showDetailedSteps && (
                  <>
                    {/* Step 1: Initial Money Spent */}
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 relative">
                      <span className="text-[9px] text-zinc-500 uppercase font-semibold block">1. Initial Spent</span>
                      <strong className="text-xs sm:text-sm text-zinc-100 font-mono block">
                        {formatUsdt(result.marginUsdt)}
                      </strong>
                      <span className="text-[9px] text-zinc-400 font-mono truncate block">
                        {result.leverage}x → {formatUsdt(result.notionalUsdt)}
                      </span>
                    </div>

                    {/* Step 2: Coins Received */}
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 relative">
                      <span className="text-[9px] text-zinc-500 uppercase font-semibold block">2. Coins Received</span>
                      <strong className="text-xs sm:text-sm text-accent-amber font-mono block truncate" title={`${result.coinsReceivedA} ${coinTicker}`}>
                        {formatCoins(result.coinsReceivedA)} {coinTicker}
                      </strong>
                      <span className="text-[9px] text-zinc-500 font-mono truncate block">
                        @ {formatPrice(result.expectedBuyPriceA)}
                      </span>
                    </div>

                    {/* Step 3: Money Returned */}
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 relative">
                      <span className="text-[9px] text-zinc-500 uppercase font-semibold block">3. Money Returned</span>
                      <strong className="text-xs sm:text-sm text-zinc-200 font-mono block">
                        {formatUsdt(result.expectedMoneyReturned)}
                      </strong>
                      <span className="text-[9px] text-rose-400 font-mono truncate block">
                        {result.marginUsdt > 0 ? formatSignedUsdt(result.moneyReturnedDrawdownUsdt) : "$0.00"}
                      </span>
                    </div>

                    {/* Step 4: Funding Yield */}
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 relative">
                      <span className="text-[9px] text-zinc-500 uppercase font-semibold block">4. Funding Yield</span>
                      <strong className="text-xs sm:text-sm text-emerald-400 font-mono block">
                        {result.marginUsdt > 0 ? formatSignedUsdt(result.fundingYieldUsdt) : "$0.00"}
                      </strong>
                      <span className="text-[9px] text-emerald-400/80 font-mono truncate block">
                        {result.marginUsdt > 0 ? formatSignedBps(result.fundingSpreadBps) : "0.0 bps"}
                      </span>
                    </div>
                  </>
                )}

                {/* Step 5: Net PnL & ROE % (Always kept visible) */}
                <div
                  className={`p-2.5 rounded-lg border ${
                    result.marginUsdt === 0
                      ? "bg-zinc-900 border-zinc-800 text-zinc-400"
                      : result.isProfitable
                      ? "bg-emerald-950/40 border-emerald-500/40"
                      : "bg-rose-950/40 border-rose-500/40"
                  }`}
                >
                  <span className="text-[9px] text-zinc-400 uppercase font-semibold block">5. Net PnL</span>
                  <strong
                    className={`text-xs sm:text-sm font-mono block font-bold ${
                      result.marginUsdt === 0
                        ? "text-zinc-400"
                        : result.isProfitable
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {result.marginUsdt > 0 ? formatSignedUsdt(result.netPnLUsdt) : "$0.00"}
                  </strong>
                  <span
                    className={`text-[9px] font-mono block font-bold ${
                      result.marginUsdt === 0
                        ? "text-zinc-500"
                        : result.isProfitable
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {result.marginUsdt > 0 ? formatRoe(result.roePct) : "0.00% ROE"}
                  </span>
                </div>
              </div>
            </div>

              {/* ROE % & Loss-Impact Breakdown (Slippage/Fees hidden behind button, Net Estimated Outcome kept visible) */}
              <div className={`bg-zinc-900/70 rounded-xl border border-zinc-800 p-3.5 space-y-2.5 transition-all duration-300 flex flex-col justify-between ${showFrictionDetails ? "md:col-span-2" : "md:col-span-1"}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-zinc-800/80 pb-2">
                <div className="flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent-amber" />
                  <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">
                    RETURN ON EQUITY (ROE %) &amp; LOSS-IMPACT BREAKDOWN
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFrictionDetails(!showFrictionDetails)}
                  className="text-[10px] px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-mono transition-colors flex items-center space-x-1 self-start sm:self-auto"
                >
                  <span>{showFrictionDetails ? "Hide Friction Details" : "Show Friction Details"}</span>
                  {showFrictionDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              <div className={showFrictionDetails ? "grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-1" : "grid grid-cols-1 pt-1"}>
                {showFrictionDetails && (
                  <>
                    {/* Slippage Loss */}
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 space-y-1">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold block">Slippage Loss</span>
                      <div className="text-xs sm:text-sm font-mono font-bold text-rose-400">
                        -{formatUsdt(result.totalSlippageLossUsdt)}
                      </div>
                      <div className="text-[10px] text-rose-400/90 font-mono font-semibold">
                        -{result.slippageLossMarginPct.toFixed(2)}% of margin
                      </div>
                      <span className="text-[9px] text-zinc-500 block truncate">
                        Entry: -{formatUsdt(result.totalEntrySlippageUsdt)} | Exit: -{formatUsdt(result.totalExitSlippageUsdt)}
                      </span>
                    </div>

                    {/* Roundtrip Taker Fees */}
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 space-y-1">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold block">Roundtrip Taker Fees</span>
                      <div className="text-xs sm:text-sm font-mono font-bold text-rose-400">
                        -{formatUsdt(result.totalTradingFeesUsdt)}
                      </div>
                      <div className="text-[10px] text-rose-400/90 font-mono font-semibold">
                        -{result.roundtripFeeMarginPct.toFixed(2)}% of margin
                      </div>
                      <span className="text-[9px] text-zinc-500 block truncate">
                        {result.roundtripFeeBps} bps on {formatUsdt(result.notionalUsdt)}
                      </span>
                    </div>

                    {/* Gross Funding Yield */}
                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 space-y-1">
                      <span className="text-[9px] text-zinc-400 uppercase font-semibold block">Gross Funding Yield</span>
                      <div className="text-xs sm:text-sm font-mono font-bold text-emerald-400">
                        +{formatUsdt(result.fundingYieldUsdt)}
                      </div>
                      <div className="text-[10px] text-emerald-400/90 font-mono font-semibold">
                        +{result.fundingYieldMarginPct.toFixed(2)}% of margin
                      </div>
                      <span className="text-[9px] text-zinc-500 block truncate">
                        {result.fundingSpreadBps.toFixed(1)} bps on {formatUsdt(result.notionalUsdt)}
                      </span>
                    </div>
                  </>
                )}

                {/* Net Estimated Outcome (Always kept visible) */}
                <div
                  className={`p-2.5 rounded-lg border space-y-1 ${
                    result.marginUsdt === 0
                      ? "bg-zinc-950 border-zinc-800 text-zinc-400"
                      : result.isProfitable
                      ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/30 border-rose-500/40 text-rose-300"
                  }`}
                >
                  <span className="text-[9px] uppercase font-semibold block opacity-80">Net Estimated Outcome</span>
                  <div className="text-xs sm:text-sm font-mono font-bold">
                    {result.marginUsdt > 0 ? formatSignedUsdt(result.netPnLUsdt) : "$0.00"}
                  </div>
                  <div className="text-[10px] font-mono font-bold">
                    {result.marginUsdt > 0 ? formatRoe(result.roePct) : "0.00% ROE"}
                  </div>
                  <span className="text-[9px] opacity-70 block truncate">
                    {result.marginUsdt > 0 ? `Net yield: ${formatSignedBps(result.netYieldBps)}` : "Awaiting input"}
                  </span>
                </div>
              </div>
              </div>
            </div>

            {/* Actionable Profit Guidance & Strategy */}
            <div className="bg-gradient-to-r from-zinc-900/90 to-zinc-900/50 rounded-xl border border-amber-500/30 p-3.5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-zinc-800 pb-2">
                <div className="flex items-center space-x-1.5">
                  <Zap className="w-3.5 h-3.5 text-accent-amber" />
                  <span className="text-[11px] font-bold text-accent-amber uppercase tracking-wider">
                    ACTIONABLE PROFIT GUIDANCE &amp; STRATEGY
                  </span>
                </div>
                <span className="text-[9px] px-2 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30 uppercase font-semibold">
                  NO HARD BLOCKS • SOFT RISK GUIDANCE
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                {/* Breakeven Funding Spread Metric */}
                <div className="bg-zinc-950/80 p-3 rounded-lg border border-zinc-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                      BREAKEVEN FUNDING SPREAD
                    </span>
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold border ${
                        result.fundingSpreadBps >= result.breakevenSpreadBps
                          ? "bg-emerald-950/50 text-emerald-400 border-emerald-800"
                          : "bg-rose-950/50 text-rose-400 border-rose-800"
                      }`}
                    >
                      {result.fundingSpreadBps >= result.breakevenSpreadBps
                        ? "SPREAD CLEARS FRICTION"
                        : "FRICTION EXCEEDS SPREAD"}
                    </span>
                  </div>
                  <div className="text-base sm:text-lg font-mono font-bold text-zinc-100 flex items-center space-x-2">
                    <span>{result.breakevenSpreadBps.toFixed(1)} bps</span>
                    <span className="text-[11px] font-normal text-zinc-400">
                      (Current: {result.fundingSpreadBps.toFixed(1)} bps)
                    </span>
                  </div>
                </div>

                {/* Recommended Optimal Leverage Metric */}
                <div className="bg-zinc-950/80 p-3 rounded-lg border border-zinc-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400 uppercase font-semibold">
                      RECOMMENDED OPTIMAL LEVERAGE
                    </span>
                    {result.leverage !== result.optimalLeverage && (
                      <button
                        onClick={() => setLeverage(result.optimalLeverage)}
                        className="text-[9px] px-2 py-0.5 rounded bg-accent-amber/20 text-accent-amber border border-accent-amber hover:bg-accent-amber/30 transition-all font-bold flex items-center space-x-1"
                        title={`Apply ${result.optimalLeverage}x leverage`}
                      >
                        <span>Switch to {result.optimalLeverage}x</span>
                        <ArrowRight className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                  <div className="text-base sm:text-lg font-mono font-bold text-accent-amber flex items-center space-x-2">
                    <span>{result.optimalLeverage}x Leverage</span>
                    <span className="text-[11px] font-normal text-emerald-400">
                      (Max Net Profit: {formatSignedUsdt(result.optimalNetPnLUsdt)})
                    </span>
                  </div>
                </div>
              </div>

              {/* Strategy Guidance Narrative */}
              <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80 text-[11px] text-zinc-300">
                <span className="text-accent-amber font-semibold uppercase mr-1.5">Strategy Guidance:</span>
                {result.marginUsdt === 0 ? (
                  <span>Enter margin collateral to model projected returns and optimal leverage.</span>
                ) : result.isProfitable ? (
                  <span>
                    At <strong className="text-zinc-100">{result.leverage}x leverage</strong> (${formatUsdt(result.notionalUsdt)} position),
                    you retain a net profit of <strong className="text-emerald-400">{formatSignedUsdt(result.netPnLUsdt)}</strong> ({formatRoe(result.roePct)})
                    as the {result.fundingSpreadBps.toFixed(1)} bps funding spread overcomes {result.breakevenSpreadBps.toFixed(1)} bps of fees &amp; slippage friction.
                  </span>
                ) : (
                  <span>
                    Current spread is below total friction.
                    {result.optimalLeverage !== result.leverage && result.isAnyLeverageProfitable && (
                      <span className="text-accent-amber ml-1">
                        Tuning leverage to {result.optimalLeverage}x can turn this corridor profitable ({formatSignedUsdt(result.optimalNetPnLUsdt)}).
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-1.5">
                <span className="text-[10px] text-zinc-500 uppercase font-mono">
                  Dual Leg Execution &amp; Round-Trip Friction Breakdown
                </span>
                <button
                  type="button"
                  onClick={() => setShowLegDetails(!showLegDetails)}
                  className="text-[10px] px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-mono transition-colors flex items-center space-x-1"
                >
                  <span>{showLegDetails ? "Hide Detailed Breakdown" : "Show Detailed Breakdown"}</span>
                  {showLegDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              {showLegDetails && (
                <>
            {/* Dual Leg Execution & Expected Average Price Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Leg 1: Venue A Buy / Long */}
              <div className="bg-zinc-900/50 p-3.5 rounded-xl border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="font-bold text-emerald-400 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>LEG 1: {venueAName.toUpperCase()} (LONG BUY)</span>
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Mark: {formatPrice(effectivePriceA)}
                  </span>
                </div>

                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Order Book Ask Slippage:</span>
                    <span className="text-rose-400 font-bold font-mono">+{result.slippagePctA.toFixed(3)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-semibold">Expected Avg Buy Price:</span>
                    <strong className="text-zinc-100 font-mono">
                      {formatPrice(result.expectedBuyPriceA)}
                    </strong>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-zinc-800/60">
                    <span className="text-zinc-400 font-semibold">Coins Received:</span>
                    <span className="text-accent-amber font-mono font-bold">
                      {formatCoins(result.coinsReceivedA)} {coinTicker}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Mark Value of Coins:</span>
                    <span className="text-zinc-300 font-mono">
                      {formatUsdt(result.coinValueAtMarkA)}{" "}
                      <span className="text-rose-400 text-[10px]">(-{formatUsdt(result.entrySlippageCostA)} drag)</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Leg 2: Venue B Short / Sell */}
              <div className="bg-zinc-900/50 p-3.5 rounded-xl border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="font-bold text-rose-400 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span>LEG 2: {venueBName.toUpperCase()} (SHORT SELL)</span>
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Mark: {formatPrice(effectivePriceB)}
                  </span>
                </div>

                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Order Book Bid Slippage:</span>
                    <span className="text-rose-400 font-bold font-mono">-{result.slippagePctB.toFixed(3)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400 font-semibold">Expected Avg Short Price:</span>
                    <strong className="text-zinc-100 font-mono">
                      {formatPrice(result.expectedShortPriceB)}
                    </strong>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-zinc-800/60">
                    <span className="text-zinc-400">Cross-Venue Price Gap:</span>
                    <span className={`font-mono font-bold ${result.isParityMatched ? "text-emerald-400" : "text-rose-400"}`}>
                      {formatPriceDiff(result.priceDiffUsdt)} ({result.priceDiffPct.toFixed(3)}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Parity Rule (≤ 0.10%):</span>
                    <span className={`text-[10px] font-bold ${result.isParityMatched ? "text-emerald-400" : "text-rose-400"}`}>
                      {result.isParityMatched ? "MATCHED (PASS)" : "MISMATCH (FAIL)"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Complete Round-Trip Fee & Unwind Exit Value */}
            <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/80 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between text-zinc-300 font-semibold border-b border-zinc-800/60 pb-1">
                <span>ROUND-TRIP EXECUTION FRICTION &amp; EXIT UNWIND</span>
                <span className="text-zinc-400 font-mono">Net Returned: {formatUsdt(result.expectedMoneyReturned)} USDT</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center font-mono">
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase block">Entry Slippage</span>
                  <span className="text-rose-400 font-bold">-{formatUsdt(result.totalEntrySlippageUsdt)}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase block">Exit Unwind Slippage</span>
                  <span className="text-rose-400 font-bold">-{formatUsdt(result.totalExitSlippageUsdt)}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase block">Roundtrip Fees ({result.roundtripFeeBps} bps)</span>
                  <span className="text-rose-400 font-bold">-{formatUsdt(result.totalTradingFeesUsdt)}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase block">Total Friction</span>
                  <span className="text-rose-400 font-bold">-{formatUsdt(result.totalExecutionFrictionUsdt)}</span>
                </div>
              </div>
            </div>

            </>
              )}
            </div>

            {/* Final Verdict Banner */}
            <div
              className={`p-3.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner ${
                result.marginUsdt === 0
                  ? "bg-zinc-900/50 border-zinc-800 text-zinc-400"
                  : result.isProfitable
                  ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                  : "bg-rose-950/40 border-rose-500/40 text-rose-300"
              }`}
            >
              <div className="flex items-center space-x-2.5">
                {result.marginUsdt === 0 ? (
                  <Info className="w-5 h-5 text-zinc-500 shrink-0" />
                ) : result.isProfitable ? (
                  <TrendingUp className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-rose-400 shrink-0" />
                )}
                <div>
                  <div className="font-bold text-xs uppercase tracking-wide">
                    {result.marginUsdt === 0
                      ? "SIMULATOR READY: SELECT MARGIN COLLATERAL & LEVERAGE"
                      : result.isProfitable
                      ? "PROFITABLE TRADE: FUNDING RATE OVERCOMES ALL FRICTION"
                      : "LOSS WARNING: SLIPPAGE & ROUND-TRIP FEES EXCEED FUNDING RATE"}
                  </div>
                  <p className="text-[11px] opacity-85 mt-0.5">
                    {result.marginUsdt === 0
                      ? "Select margin presets ($50, $100, $250, $500, $1,000) and leverage (1x to 50x) above to simulate execution slippage and net yield."
                      : result.isProfitable
                      ? `At ${formatUsdt(result.marginUsdt)} margin (${result.leverage}x leverage = ${formatUsdt(result.notionalUsdt)} notional), you retain a net profit after paying ${formatUsdt(result.totalTradingFeesUsdt)} fees and ${formatUsdt(result.totalSlippageLossUsdt)} slippage drag.`
                      : `At ${formatUsdt(result.marginUsdt)} margin (${result.leverage}x leverage = ${formatUsdt(result.notionalUsdt)} notional), execution friction exceeds the funding payment.`}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div
                  className={`text-base sm:text-lg font-bold font-mono ${
                    result.marginUsdt === 0
                      ? "text-zinc-400"
                      : result.isProfitable
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {result.marginUsdt > 0 ? formatSignedUsdt(result.netPnLUsdt) : "$0.00"} USDT
                </div>
                <div className="flex items-center justify-end space-x-1.5 mt-0.5">
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      result.marginUsdt === 0
                        ? "bg-zinc-800 text-zinc-400"
                        : result.isProfitable
                        ? "bg-emerald-900/60 text-emerald-300"
                        : "bg-rose-900/60 text-rose-300"
                    }`}
                  >
                    {result.marginUsdt > 0 ? formatRoe(result.roePct) : "0.00% ROE"}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      result.marginUsdt === 0
                        ? "bg-zinc-800 text-zinc-500"
                        : "bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    {result.marginUsdt > 0 ? formatSignedBps(result.netYieldBps) : "0.0 bps"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
