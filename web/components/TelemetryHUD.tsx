"use client";

import React, { useEffect, useState } from "react";
import { Clock, Zap } from "lucide-react";
import { getDeterministicNextFundingTime, formatCountdown } from "@/lib/settlementTime";

interface TelemetryHUDProps {
  spreadBps?: number;
  nextFundingTime?: number;
  symbol?: string;
  fundingIntervalHours?: number;
}

export default function TelemetryHUD({
  spreadBps = 0,
  nextFundingTime = 0,
  symbol = "BTCUSDT",
  fundingIntervalHours = 8,
}: TelemetryHUDProps) {
  const intervalHours = fundingIntervalHours && fundingIntervalHours > 0 ? fundingIntervalHours : 8;
  const payoutsPerDay = 24 / intervalHours;

  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const normalizedTarget =
    nextFundingTime > 0 && nextFundingTime < 1e11 ? nextFundingTime * 1000 : nextFundingTime;

  const currentTarget =
    normalizedTarget > nowMs
      ? normalizedTarget
      : getDeterministicNextFundingTime(nowMs, intervalHours);

  const countdown = formatCountdown(currentTarget, nowMs, intervalHours);

  const baseAsset = String(symbol || "BTCUSDT").replace("USDT", "") || "BTC";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 font-mono">
      {/* 1. Settlement Countdown (Real Dynamic Countdown) */}
      <div className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 flex flex-col justify-between hover:border-zinc-700 transition-all duration-200 shadow-lg relative overflow-hidden group">
        <div className="flex items-center justify-between text-zinc-400 text-[10px] sm:text-xs">
          <span className="font-semibold tracking-wider text-zinc-400">SETTLEMENT COUNTDOWN</span>
          <Clock className="w-3.5 h-3.5 text-accent-cyan" />
        </div>
        <div className="mt-2 text-xl sm:text-2xl font-black tracking-tight text-zinc-100 flex items-center space-x-1.5">
          <span>{countdown}</span>
        </div>
        <div className="mt-1.5 text-[9px] sm:text-[10px] text-zinc-500 flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span>{baseAsset} {intervalHours}h settlement cycle ({payoutsPerDay}x/day)</span>
        </div>
      </div>

      {/* 2. Live Basis Spread (Real Dynamic Spread in bps) */}
      <div className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 flex flex-col justify-between hover:border-zinc-700 transition-all duration-200 shadow-lg relative overflow-hidden group">
        <div className="flex items-center justify-between text-zinc-400 text-[10px] sm:text-xs">
          <span className="font-semibold tracking-wider text-zinc-400">NET BASIS SPREAD</span>
          <Zap className="w-3.5 h-3.5 text-accent-amber" />
        </div>
        <div className="mt-2 text-xl sm:text-2xl font-black tracking-tight text-accent-amber">
          {(spreadBps || 0).toFixed(1)} <span className="text-xs text-zinc-400 font-semibold">bps</span>
        </div>
        <div className="mt-1.5 text-[9px] sm:text-[10px] text-zinc-500 flex items-center space-x-1">
          <span className="text-zinc-400">Binance ↔ Bitget delta</span>
        </div>
      </div>
    </div>
  );
}
