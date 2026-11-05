"use client";

import React, { useState } from "react";
import { ArrowRight, TrendingUp, Sparkles, Activity, AlertTriangle, CheckCircle2, ShieldAlert, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

interface SpreadTrackerProps {
  symbol?: string;
  venueAName?: string;
  venueBName?: string;
  binanceFundingRate?: number;
  bitgetFundingRate?: number;
  spreadBps?: number;
  markPrice?: number;
  binancePrice?: number;
  bitgetPrice?: number;
  priceDiff?: number;
  priceDivergencePct?: number;
  fundingIntervalHours?: number;
}

export default function SpreadTracker({
  symbol = "BTCUSDT",
  venueAName = "Binance",
  venueBName = "Bitget",
  binanceFundingRate = 0.0001,
  bitgetFundingRate = 0.0002,
  spreadBps = 10.0,
  markPrice = 0,
  binancePrice = 0,
  bitgetPrice = 0,
  priceDiff,
  priceDivergencePct,
  fundingIntervalHours = 8,
}: SpreadTrackerProps) {
  const [copiedPrice, setCopiedPrice] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const formatRatePct = (rate: number): number => {
    if (!rate || isNaN(rate)) return 0;
    if (Math.abs(rate) >= 0.05) return rate;
    return rate * 100;
  };
  const binancePct = formatRatePct(binanceFundingRate || 0);
  const bitgetPct = formatRatePct(bitgetFundingRate || 0);
  const absSpread = Math.abs(spreadBps || 0);
  const intervalHours = fundingIntervalHours && fundingIntervalHours > 0 ? fundingIntervalHours : 8;
  const payoutsPerDay = 24 / intervalHours;
  const apy = ((absSpread * payoutsPerDay * 365) / 100).toFixed(1);

  // Cross-Exchange Mark Price Divergence Calculations
  const bnPrice = binancePrice > 0 ? binancePrice : markPrice > 0 ? markPrice : 0;
  const bgPrice = bitgetPrice > 0 ? bitgetPrice : markPrice > 0 ? markPrice : 0;
  const effectivePriceDiff = priceDiff !== undefined ? priceDiff : Math.abs(bnPrice - bgPrice);
  const effectiveDivergencePct =
    priceDivergencePct !== undefined
      ? priceDivergencePct
      : bnPrice > 0
      ? (effectivePriceDiff / bnPrice) * 100
      : 0;

  const isHighDivergence = effectiveDivergencePct > 0.35;
  const isModerateDivergence = effectiveDivergencePct > 0.15 && !isHighDivergence;

  // Corridor Status Calculation
  let corridorStatus = "COMPRESSED (< 3 bps)";
  let corridorBadge = "bg-amber-500/10 text-amber-400 border-amber-500/30";
  let barGradient = "from-amber-500 to-amber-400";
  let corridorPercent = Math.min(100, Math.max(8, (absSpread / 25) * 100));

  if (absSpread >= 12) {
    corridorStatus = "PRIME ARBITRAGE WINDOW (> 12 bps)";
    corridorBadge = "bg-emerald-500/10 text-accent-emerald border-emerald-500/30 animate-pulse";
    barGradient = "from-emerald-500 via-teal-400 to-emerald-300";
  } else if (absSpread >= 4) {
    corridorStatus = "MODERATE CORRIDOR (4 - 12 bps)";
    corridorBadge = "bg-cyan-500/10 text-accent-cyan border-cyan-500/30";
    barGradient = "from-cyan-500 to-blue-400";
  }

  const handleCopyPrice = (val: string, label: string) => {
    try {
      navigator.clipboard?.writeText(val).catch(() => {});
    } catch {}
    setCopiedPrice(label);
    setTimeout(() => setCopiedPrice(null), 1500);
  };

  return (
    <div className="bg-surface rounded-2xl border border-border p-4 sm:p-6 font-mono space-y-4 shadow-xl relative overflow-hidden transition-all duration-300">
      {/* Header with Live Mark Price & Cross-Exchange Price Divergence */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/80 pb-3.5 gap-2.5">
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-accent-amber" />
          <h2 className="text-sm font-bold text-zinc-100 tracking-wider uppercase">
            CROSS-EXCHANGE FUNDING SPREAD • {symbol}
          </h2>
        </div>

        {/* Live Cross-Exchange Price Divergence Badge & Spread Telemetry */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Live Funding Spread Basis Badge (Visible always, critical when collapsed) */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px]">
            <span className="text-zinc-500">SPREAD:</span>
            <strong className={`font-mono ${absSpread >= 12 ? "text-accent-emerald" : absSpread >= 4 ? "text-accent-cyan" : "text-accent-amber"}`}>
              {absSpread.toFixed(1)} bps
            </strong>
            <span className="text-zinc-400 font-mono">
              ({apy}% APY)
            </span>
          </div>

          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px]">
            <span className="text-zinc-500">PRICE GAP:</span>
            <strong className="text-zinc-200">
              ${effectivePriceDiff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </strong>
            <span
              className={`font-bold ml-1 ${
                isHighDivergence
                  ? "text-rose-400"
                  : isModerateDivergence
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}
            >
              ({effectiveDivergencePct.toFixed(2)}%)
            </span>
          </div>

          <span
            className={`text-[10px] px-2.5 py-1 rounded-lg border font-bold flex items-center space-x-1 ${
              isHighDivergence
                ? "bg-rose-500/15 text-rose-400 border-rose-500/40 animate-pulse"
                : isModerateDivergence
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                : "bg-emerald-500/10 text-accent-emerald border-emerald-500/30"
            }`}
          >
            {isHighDivergence ? (
              <>
                <AlertTriangle className="w-3 h-3" />
                <span>PRICE GAP RISK</span>
              </>
            ) : isModerateDivergence ? (
              <span>MODERATE GAP</span>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3" />
                <span>OPTIMAL BASIS MATCH</span>
              </>
            )}
          </span>

          <span className={`text-[10px] px-2.5 py-1 rounded-lg border font-bold ${corridorBadge}`}>
            {corridorStatus}
          </span>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors ml-1"
            title={isCollapsed ? "Expand Spread Panel" : "Collapse Spread Panel"}
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
        <div className="overflow-hidden space-y-4 pt-1">
          {/* 3-Column Rates, Mark Prices & Spread Basis */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 items-center">
        {/* Exchange A */}
        <div className="p-4 rounded-xl bg-surface-card border border-border hover:border-zinc-700 transition-all shadow-md group">
          <div className="text-[10px] text-zinc-400 uppercase mb-1 flex items-center justify-between">
            <span className="font-semibold">VENUE A: {venueAName.toUpperCase()}</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30 font-bold">
              PERP
            </span>
          </div>
          <div className="text-2xl font-black text-accent-amber tracking-tight">
            {binancePct >= 0 ? "+" : ""}{binancePct.toFixed(4)}%
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-2 pt-2 border-t border-border/60">
            <span>Annual: {(binancePct * 3 * 365).toFixed(1)}%</span>
            <button
              onClick={() => handleCopyPrice(String(bnPrice), "BN")}
              className="text-zinc-300 font-bold hover:text-white flex items-center space-x-1"
              title="Click to copy price"
            >
              <span>${bnPrice > 0 ? bnPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "..."}</span>
              {copiedPrice === "BN" ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-zinc-500" />}
            </button>
          </div>
        </div>

        {/* Spread Nexus */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-center relative overflow-hidden group shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 to-transparent pointer-events-none" />
          <div className="text-[10px] text-zinc-400 uppercase mb-1 flex items-center justify-center space-x-1.5 font-semibold">
            <span>NET SPREAD BASIS</span>
            <ArrowRight className="w-3 h-3 text-accent-amber" />
          </div>
          <div className="text-3xl font-black text-accent-amber tracking-tight font-mono">
            {(spreadBps || 0).toFixed(1)} <span className="text-sm text-zinc-400 font-normal">bps</span>
          </div>
          <div className="text-[11px] text-accent-emerald font-bold mt-1.5 flex items-center justify-center space-x-1.5">
            <Sparkles className="w-3 h-3" />
            <span>EST. ANNUAL YIELD: {apy}% APY</span>
          </div>
        </div>

        {/* Exchange B */}
        <div className="p-4 rounded-xl bg-surface-card border border-border hover:border-zinc-700 transition-all shadow-md group">
          <div className="text-[10px] text-zinc-400 uppercase mb-1 flex items-center justify-between">
            <span className="font-semibold">VENUE B: {venueBName.toUpperCase()}</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-bold">
              PERP
            </span>
          </div>
          <div className="text-2xl font-black text-cyan-400 tracking-tight">
            {bitgetPct >= 0 ? "+" : ""}{bitgetPct.toFixed(4)}%
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-2 pt-2 border-t border-border/60">
            <span>Annual: {(bitgetPct * 3 * 365).toFixed(1)}%</span>
            <button
              onClick={() => handleCopyPrice(String(bgPrice), "BG")}
              className="text-zinc-300 font-bold hover:text-white flex items-center space-x-1"
              title="Click to copy price"
            >
              <span>${bgPrice > 0 ? bgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "..."}</span>
              {copiedPrice === "BG" ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-zinc-500" />}
            </button>
          </div>
        </div>
      </div>

      {/* High Price Divergence Warning Alert Banner (If Applicable) */}
      {isHighDivergence && bnPrice > 0 && bgPrice > 0 && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2.5">
          <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 animate-bounce" />
          <div className="leading-relaxed">
            <strong className="text-rose-200">Price Divergence Alert ({effectiveDivergencePct.toFixed(2)}%):</strong>{" "}
            Binance (${bnPrice.toFixed(2)}) and Bitget (${bgPrice.toFixed(2)}) have a ${effectivePriceDiff.toFixed(2)} disparity. Entering now risks basis convergence drag. Auto-Wait Sniper will hold order until the price gap narrows.
          </div>
        </div>
      )}

      {/* Visual Arbitrage Opportunity Corridor Meter (Blueprint B from elite-web-ui-motion) */}
      <div className="pt-3 border-t border-border/80 space-y-2">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span className="flex items-center space-x-1.5 font-bold uppercase tracking-wider">
            <Activity className="w-3.5 h-3.5 text-accent-cyan" />
            <span>OPPORTUNITY CORRIDOR SPECTRUM</span>
          </span>
          <span className="font-mono text-zinc-300 font-semibold">
            {absSpread >= 12 ? "HIGH ALPHA CORRIDOR" : absSpread >= 4 ? "STANDARD CORRIDOR" : "COMPRESSED BASIS"}
          </span>
        </div>

        {/* Corridor Meter Bar with Glowing Needle */}
        <div className="relative w-full bg-zinc-950 rounded-full h-3.5 border border-zinc-800 p-[2px]">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-all duration-500 ease-out`}
            style={{ width: `${corridorPercent}%` }}
          />
          {/* Glowing Needle Indicator */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-accent-amber shadow-lg shadow-amber-500/80 transition-all duration-500 ease-out -ml-2"
            style={{ left: `${Math.min(99, Math.max(1, corridorPercent))}%` }}
            title={`Current Corridor Position: ${absSpread.toFixed(1)} bps`}
          />
        </div>

        <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
          <span>0 bps (Neutral)</span>
          <span className="text-zinc-400 font-bold">Bot Sniper Trigger: &ge; 5.0 bps</span>
          <span className="text-accent-amber font-bold">Prime Threshold: &ge; 12.0 bps</span>
          <span>25+ bps (Extreme Alpha)</span>
        </div>

        {/* Directional Cash Flow Engine */}
        <div className="mt-2.5 p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80 text-[10px] text-zinc-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-accent-amber animate-pulse" />
            <span>
              Cash Flow Engine:{" "}
              <strong className="text-zinc-200">
                {binanceFundingRate >= bitgetFundingRate
                  ? `Binance shorts collect +${binancePct.toFixed(4)}% vs Bitget longs pay +${bitgetPct.toFixed(4)}%`
                  : `Bitget shorts collect +${bitgetPct.toFixed(4)}% vs Binance longs pay +${binancePct.toFixed(4)}%`}
              </strong>
            </span>
          </div>
          <span className="text-accent-emerald font-black font-mono tracking-wider">
            Net Basis: +{absSpread.toFixed(1)} bps / {intervalHours}h (+{apy}% APY)
          </span>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
