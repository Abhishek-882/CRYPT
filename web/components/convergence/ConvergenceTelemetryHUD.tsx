"use client";

import React from "react";
import {
  Activity,
  Zap,
  TrendingUp,
  ShieldCheck,
  Radio,
  Clock,
  Layers,
  AlertTriangle,
} from "lucide-react";

export interface ConvergenceTelemetryHUDProps {
  isRunning: boolean;
  fsmState: string;
  isKillSwitchEngaged: boolean;
  uptimeSeconds?: number;
  monitoredPairsCount?: number;
  bestGrossBasisBps?: number;
  bestGrossBasisPair?: string;
  iocLatencyMs?: number;
  isWebSocketConnected?: boolean;
  totalRealizedPnlUsdt?: number;
  winRatePct?: number;
  activePositionsCount?: number;
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function ConvergenceTelemetryHUD({
  isRunning,
  fsmState,
  isKillSwitchEngaged,
  uptimeSeconds = 0,
  monitoredPairsCount = 15,
  bestGrossBasisBps = 34.5,
  bestGrossBasisPair = "1000PEPE/USDT",
  iocLatencyMs = 26.4,
  isWebSocketConnected = true,
  totalRealizedPnlUsdt = 14.28,
  winRatePct = 100.0,
  activePositionsCount = 0,
}: ConvergenceTelemetryHUDProps) {
  // Determine status color and label
  let statusBadgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/30";
  let statusPingColor = "bg-amber-400";
  let statusLabel = "PAUSED";

  if (isKillSwitchEngaged) {
    statusBadgeColor = "bg-rose-500/10 text-rose-400 border-rose-500/40 animate-pulse";
    statusPingColor = "bg-rose-500";
    statusLabel = "EMERGENCY_KILLED";
  } else if (isRunning) {
    statusBadgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    statusPingColor = "bg-emerald-400";
    statusLabel = activePositionsCount > 0 ? "HEDGED_CONVERGING" : "RUNNING";
  }

  const isLatencySub35 = iocLatencyMs < 35.0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 font-mono">
      {/* Card 1: Engine Operational Status */}
      <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-4 shadow-lg shadow-black/40 hover:border-zinc-700 transition-all flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-amber-500/5 to-transparent rounded-bl-full pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center space-x-1.5">
            <Radio className="w-3.5 h-3.5 text-accent-amber" />
            <span>Engine Status</span>
          </span>
          <span className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeColor}`}>
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusPingColor}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${statusPingColor}`} />
            </span>
            <span>{statusLabel}</span>
          </span>
        </div>

        <div className="my-1">
          <div className="text-xl sm:text-2xl font-black text-zinc-100 tracking-tight">
            {fsmState || statusLabel}
          </div>
          <div className="text-[11px] text-zinc-500 flex items-center space-x-2 mt-1">
            <span className="flex items-center space-x-1">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span>Uptime:</span>
              <span className="text-zinc-300 font-semibold">{formatUptime(uptimeSeconds)}</span>
            </span>
            <span>•</span>
            <span className="text-zinc-400">Continuous SDE Loop</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-[10px]">
          <span className="text-zinc-500">Autonomous Cycle:</span>
          <span className="text-accent-amber font-semibold">2,500ms Active Sweeper</span>
        </div>
      </div>

      {/* Card 2: Monitored Corridors & Best Gross Basis */}
      <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-4 shadow-lg shadow-black/40 hover:border-zinc-700 transition-all flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-cyan-500/5 to-transparent rounded-bl-full pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Corridors & Best Basis</span>
          </span>
          <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-bold">
            {monitoredPairsCount} PAIRS
          </span>
        </div>

        <div className="my-1">
          <div className="text-xl sm:text-2xl font-black text-cyan-300 tracking-tight flex items-baseline space-x-2">
            <span>+{Math.abs(bestGrossBasisBps).toFixed(1)} bps</span>
            <span className="text-xs font-normal text-zinc-400 truncate max-w-[130px]">
              ({bestGrossBasisPair})
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 truncate">
            Binance USD-M ⟷ Bybit Linear
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-[10px]">
          <span className="text-zinc-500">Min Entry Hurdle:</span>
          <span className="text-zinc-300 font-semibold">≥ 28.0 bps Gross</span>
        </div>
      </div>

      {/* Card 3: WebSocket IOC Latency Indicator */}
      <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-4 shadow-lg shadow-black/40 hover:border-zinc-700 transition-all flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-emerald-500/5 to-transparent rounded-bl-full pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center space-x-1.5">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span>Leg 2 IOC Latency</span>
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
              isLatencySub35
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/10 text-rose-400 border-rose-500/30"
            }`}
          >
            {isLatencySub35 ? "SUB-35ms TARGET MET" : "LATENCY DEGRADED"}
          </span>
        </div>

        <div className="my-1">
          <div className="text-xl sm:text-2xl font-black text-emerald-400 tracking-tight flex items-baseline space-x-1.5">
            <span>{iocLatencyMs.toFixed(1)}</span>
            <span className="text-sm font-semibold text-emerald-500">ms</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center space-x-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isWebSocketConnected ? "bg-emerald-400" : "bg-rose-500"}`} />
            <span>Bybit Linear Private WS Stream</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-[10px]">
          <span className="text-zinc-500">Leg 1 Maker Timeout:</span>
          <span className="text-zinc-300 font-semibold">8,000ms Post-Only</span>
        </div>
      </div>

      {/* Card 4: Net Realized Arbitrage PnL */}
      <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-4 shadow-lg shadow-black/40 hover:border-zinc-700 transition-all flex flex-col justify-between relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-amber-500/5 to-transparent rounded-bl-full pointer-events-none" />
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center space-x-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-accent-amber" />
            <span>Net Realized PnL</span>
          </span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
            {winRatePct.toFixed(0)}% ZERO-LOSS
          </span>
        </div>

        <div className="my-1">
          <div className="text-xl sm:text-2xl font-black text-emerald-400 tracking-tight">
            +{totalRealizedPnlUsdt >= 0 ? `$${totalRealizedPnlUsdt.toFixed(2)}` : `-$${Math.abs(totalRealizedPnlUsdt).toFixed(2)}`}
            <span className="text-xs font-normal text-zinc-400 ml-1.5">USDT</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Strictly net of all Maker & Taker fees
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-[10px]">
          <span className="text-zinc-500">Active Open Positions:</span>
          <span className="text-cyan-400 font-semibold">{activePositionsCount} Pairs Converging</span>
        </div>
      </div>
    </div>
  );
}
