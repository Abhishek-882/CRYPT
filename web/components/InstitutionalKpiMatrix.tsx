"use client";

import React from "react";
import { TrendingUp, ShieldCheck, Clock, Layers, Zap, Activity } from "lucide-react";

interface KpiTileProps {
  title: string;
  value: string;
  sub: string;
  delta?: string;
  isPositive?: boolean;
  icon?: React.ReactNode;
}

function KpiTile({ title, value, sub, delta, isPositive = true, icon }: KpiTileProps) {
  return (
    <div className="bg-[#0e0e12] p-4 rounded-xl border border-zinc-800/80 hover:border-zinc-700 transition-all font-mono space-y-2 group shadow-md">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span className="font-semibold uppercase text-[10px] tracking-wider">{title}</span>
        {icon && <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors">{icon}</span>}
      </div>

      <div className="flex items-baseline space-x-2">
        <span className="text-xl md:text-2xl font-black text-zinc-100 tracking-tight">{value}</span>
        {delta && (
          <span
            className={`text-xs font-bold px-1.5 py-0.5 rounded ${
              isPositive
                ? "bg-emerald-500/10 text-accent-emerald border border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            {delta}
          </span>
        )}
      </div>

      <div className="text-[10px] text-zinc-500 flex items-center space-x-1">
        <span>{sub}</span>
      </div>
    </div>
  );
}

interface InstitutionalKpiMatrixProps {
  totalTrades?: number;
  totalVolume?: string;
  realizedPnl?: string;
  todayRealizedPnl?: string;
  todayFunding?: string;
  avgLatencyMs?: number;
  activeFilter?: string;
  onFilterChange?: (filter: string) => void;
}

export function InstitutionalKpiMatrix({
  totalTrades = 0,
  totalVolume = "$14,250.00",
  realizedPnl = "+$42.80",
  todayRealizedPnl,
  todayFunding,
  avgLatencyMs = 184,
  activeFilter = "ALL",
  onFilterChange,
}: InstitutionalKpiMatrixProps) {
  const filters = [
    { id: "ALL", label: "All Receipts" },
    { id: "OPEN", label: "Active Corridors" },
    { id: "CLOSED", label: "Settled Cycles" },
    { id: "EMERGENCY", label: "Flattens" },
  ];

  const todayPnlVal = todayRealizedPnl || realizedPnl;
  const isTodayPositive = !todayPnlVal.startsWith("-");

  return (
    <div data-aos="fade-up" className="space-y-4">
      {/* 4-Column Tremor-Style KPI Metric Matrix */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          title="Today's Realized Net PnL"
          value={todayPnlVal}
          isPositive={isTodayPositive}
          sub={`All-Time: ${realizedPnl}`}
          icon={<TrendingUp className={`w-4 h-4 ${isTodayPositive ? "text-accent-emerald" : "text-accent-rose"}`} />}
        />

        <KpiTile
          title="Today's Funding Harvest"
          value={todayFunding || "+$0.0000"}
          isPositive={!(todayFunding || "").startsWith("-")}
          sub="Direct exchange funding payouts"
          icon={<Zap className="w-4 h-4 text-accent-cyan" />}
        />

        <KpiTile
          title="Total Volume Hedged"
          value={totalVolume}
          sub={`${totalTrades} dual-venue orders filled`}
          icon={<Layers className="w-4 h-4 text-accent-amber" />}
        />

        <KpiTile
          title="Avg Inter-Leg Latency"
          value={`${avgLatencyMs}ms`}
          sub="Cross-Exchange Execution Skew"
          icon={<Clock className="w-4 h-4 text-accent-cyan" />}
        />
      </div>

      {/* Query Filter Chips */}
      {onFilterChange && (
        <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none text-xs font-mono">
          <span className="text-zinc-500 text-[11px] uppercase font-bold pr-1">Filter:</span>
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => onFilterChange(f.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all active:scale-95 whitespace-nowrap ${
                activeFilter === f.id
                  ? "bg-amber-500/20 text-accent-amber border border-amber-500/40 shadow-sm"
                  : "bg-surface text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default InstitutionalKpiMatrix;
