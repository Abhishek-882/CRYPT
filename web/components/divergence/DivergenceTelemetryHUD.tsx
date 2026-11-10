"use client";

import React from "react";
import {
  Activity,
  Shield,
  Lock,
  Radio,
  Zap,
  TrendingUp,
  Clock,
  Layers,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { DivergenceFsmState } from "@/lib/divergence/types";

export interface DivergenceTelemetryHUDProps {
  isRunning: boolean;
  fsmState: DivergenceFsmState;
  activePositionsCount: number;
  maxConcurrentPositions: number;
  capitalAllocatedUsdt: number;
  maxCapitalAllocationUsdt: number;
  scannedUniverseCount: number;
  primeCandidatesCount: number;
  totalRealizedNetPnlUsdt: number;
  winRatePercent: number;
  uptimeSeconds: number;
  lockActive: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  lastSyncTime: number;
}

export default function DivergenceTelemetryHUD({
  isRunning,
  fsmState,
  activePositionsCount,
  maxConcurrentPositions = 3,
  capitalAllocatedUsdt = 0,
  maxCapitalAllocationUsdt = 60.0,
  scannedUniverseCount = 0,
  primeCandidatesCount = 0,
  totalRealizedNetPnlUsdt = 0,
  winRatePercent = 0,
  uptimeSeconds = 0,
  lockActive = false,
  onRefresh,
  isRefreshing,
  lastSyncTime,
}: DivergenceTelemetryHUDProps) {
  const formatUptime = (sec: number) => {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const getFsmBadgeColor = (state: DivergenceFsmState) => {
    switch (state) {
      case "ACTIVE_EXPANDING":
        return "text-accent-emerald bg-emerald-500/10 border-emerald-500/30 ring-emerald-500/20";
      case "EXITING":
      case "SCRATCH_UNWINDING":
        return "text-accent-amber bg-amber-500/10 border-amber-500/30 ring-amber-500/20";
      case "EMERGENCY_STOPPING":
      case "EMERGENCY_KILLED":
        return "text-red-400 bg-red-500/10 border-red-500/30 ring-red-500/20 animate-pulse";
      case "SCANNING":
      case "BALANCING":
        return "text-cyan-400 bg-cyan-500/10 border-cyan-500/30 ring-cyan-500/20";
      case "PAUSED":
      default:
        return "text-zinc-400 bg-zinc-800/40 border-zinc-700/50 ring-zinc-500/10";
    }
  };

  return (
    <div className="w-full space-y-3 font-mono">
      {/* Top Banner Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-zinc-950/80 border border-border/80 backdrop-blur-xl shadow-lg">
        {/* Left: Engine Mode & FSM State */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isRunning ? "bg-accent-emerald animate-pulse" : "bg-zinc-600"
              }`}
            />
            <span className="text-zinc-400 font-semibold">ENGINE:</span>
            <span
              className={`font-black ${
                isRunning ? "text-accent-emerald" : "text-zinc-400"
              }`}
            >
              {isRunning ? "ARMED (READY)" : "PAUSED"}
            </span>
          </div>

          <div
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-bold ring-1 transition-all ${getFsmBadgeColor(
              fsmState
            )}`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>FSM: {fsmState}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-[11px] text-zinc-400">
            <Lock className="w-3 h-3 text-accent-amber" />
            <span>LOCK:</span>
            <span className={lockActive ? "text-accent-emerald" : "text-zinc-500"}>
              {lockActive ? "HELD (EXCLUSIVE)" : "UNLOCKED"}
            </span>
          </div>

          <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-[11px] text-zinc-400">
            <Radio className="w-3 h-3 text-cyan-400" />
            <span>VENUE:</span>
            <span className="text-zinc-200 font-semibold">BINANCE + BYBIT REAL LIVE</span>
          </div>
        </div>

        {/* Right: Sync Status & Refresh Button */}
        <div className="flex items-center space-x-2.5 text-xs text-zinc-400">
          <div className="flex items-center space-x-1.5 text-[11px]">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>UPTIME: {formatUptime(uptimeSeconds)}</span>
          </div>
          <span className="text-zinc-700">|</span>
          <div className="text-[11px] text-zinc-500 hidden sm:inline">
            SYNC: {Math.max(0, Math.floor((Date.now() - lastSyncTime) / 1000))}s ago
          </div>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center min-h-[36px] min-w-[36px]"
            title="Force SWR Radar Refresh"
            aria-label="Refresh telemetry"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-accent-amber" : ""}`} />
          </button>
        </div>
      </div>

      {/* Metric Cards Matrix */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Card 1: Capital Hard-Lock Allocation */}
        <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-border/80 backdrop-blur-md flex flex-col justify-between shadow-md group hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="flex items-center space-x-1.5">
              <Shield className="w-3.5 h-3.5 text-accent-amber" />
              <span>CAPITAL HARD-LOCK</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30">
              1 POS MAX
            </span>
          </div>
          <div className="flex items-baseline space-x-2 my-1">
            <span className="text-xl font-black text-zinc-100 tracking-tight">
              ${capitalAllocatedUsdt.toFixed(2)}
            </span>
            <span className="text-xs text-zinc-500">
              / ${maxCapitalAllocationUsdt.toFixed(2)} USDT
            </span>
          </div>
          <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden mt-1">
            <div
              className="bg-accent-amber h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(
                  100,
                  (capitalAllocatedUsdt / maxCapitalAllocationUsdt) * 100
                )}%`,
              }}
            />
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 flex justify-between">
            <span>Utilization</span>
            <span>{((capitalAllocatedUsdt / maxCapitalAllocationUsdt) * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Card 2: Monitored Universe & Prime Candidates */}
        <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-border/80 backdrop-blur-md flex flex-col justify-between shadow-md group hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>EXPANSION RADAR</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              SWR 2.5s
            </span>
          </div>
          <div className="flex items-baseline space-x-2 my-1">
            <span className="text-xl font-black text-cyan-400 tracking-tight">
              {primeCandidatesCount}
            </span>
            <span className="text-xs text-zinc-500">
              prime / {scannedUniverseCount} pairs
            </span>
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
            <span>Prime Coiled Zone:</span>
            <span className="text-emerald-400 font-bold">|b| ≤ 0.100%, Δb ≥ 0.400%</span>
          </div>
        </div>

        {/* Card 3: Active Position Progress */}
        <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-border/80 backdrop-blur-md flex flex-col justify-between shadow-md group hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-accent-emerald" />
              <span>ACTIVE POSITIONS</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-accent-emerald border border-emerald-500/30">
              {activePositionsCount} / {maxConcurrentPositions}
            </span>
          </div>
          <div className="flex items-baseline space-x-2 my-1">
            <span className="text-xl font-black text-zinc-100 tracking-tight">
              {activePositionsCount === 0 ? "FLAT" : `${activePositionsCount} ACTIVE`}
            </span>
            <span className="text-xs text-zinc-500">
              {activePositionsCount === 0 ? "(Zero Naked Risk)" : "(Delta-Neutral)"}
            </span>
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
            <span>Target Take-Profit:</span>
            <span className="text-accent-amber font-bold">≥ +0.380% (+$0.0100 Net)</span>
          </div>
        </div>

        {/* Card 4: Certified Cumulative Net PnL */}
        <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-border/80 backdrop-blur-md flex flex-col justify-between shadow-md group hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="flex items-center space-x-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-accent-emerald" />
              <span>REALIZED NET PNL</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              WIN {winRatePercent.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-baseline space-x-2 my-1">
            <span
              className={`text-xl font-black tracking-tight ${
                totalRealizedNetPnlUsdt >= 0 ? "text-accent-emerald" : "text-red-400"
              }`}
            >
              {totalRealizedNetPnlUsdt >= 0 ? "+" : ""}
              ${totalRealizedNetPnlUsdt.toFixed(4)}
            </span>
            <span className="text-xs text-zinc-500">USDT</span>
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
            <span>Zero-Loss Floor:</span>
            <span className="text-emerald-400 font-bold">≥ +$0.0100 USDT</span>
          </div>
        </div>
      </div>
    </div>
  );
}
