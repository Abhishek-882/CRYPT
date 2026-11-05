"use client";

import React from "react";
import { Zap, Activity, Clock } from "lucide-react";

interface TradingCockpitMeterProps {
  symbol?: string;
  spreadBps?: number;
  primeThresholdBps?: number;
  venueA?: string;
  venueB?: string;
  annualizedApr?: number;
  settlementHours?: number;
}

export function TradingCockpitMeter({
  symbol = "BTCUSDT",
  spreadBps = 14.5,
  primeThresholdBps = 12.0,
  venueA = "BINANCE",
  venueB = "BITGET",
  annualizedApr,
  settlementHours = 8,
}: TradingCockpitMeterProps) {
  const isPrime = Math.abs(spreadBps) >= primeThresholdBps;
  const absSpread = Math.abs(spreadBps);
  const percentage = Math.min(100, Math.max(0, (absSpread / 30) * 100));
  const computedApr = annualizedApr !== undefined ? annualizedApr : ((absSpread * (24 / settlementHours) * 365) / 100);

  return (
    <div className="rounded-xl border border-zinc-800/90 bg-[#0c0c10] p-3.5 font-mono shadow-md space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 font-bold tracking-tight">
            {symbol}
          </span>
          <span className="text-[11px] text-zinc-400">
            {venueA} ↔ {venueB}
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isPrime ? "bg-accent-emerald animate-pulse" : "bg-accent-amber"
            }`}
          />
          <span
            className={`text-sm font-bold ${
              isPrime ? "text-accent-emerald" : "text-accent-amber"
            }`}
          >
            {spreadBps >= 0 ? "+" : ""}{spreadBps.toFixed(1)} bps
          </span>
          <span className="text-[10px] text-zinc-500">
            ({computedApr.toFixed(1)}% APR)
          </span>
        </div>
      </div>

      {/* Zero-Lag Opportunity Corridor Gauge */}
      <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800/80">
        <div
          className={`h-full transition-all duration-300 ease-out ${
            isPrime
              ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
              : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]"
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex justify-between items-center text-[10px] text-zinc-500">
        <span>0.0 bps</span>
        <span className={`font-semibold ${isPrime ? "text-accent-emerald" : "text-zinc-400"}`}>
          {isPrime ? "⚡ PRIME HARVEST WINDOW (≥ 12 bps)" : "NORMAL SPREAD CORRIDOR"}
        </span>
        <span>30.0+ bps</span>
      </div>
    </div>
  );
}

export default TradingCockpitMeter;
