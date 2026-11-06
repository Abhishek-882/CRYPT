"use client";

import React, { useState, useMemo } from "react";
import {
  Activity,
  Layers,
  Search,
  Check,
  X,
  Eye,
  ArrowUpDown,
  Filter,
  Sparkles,
  Zap,
} from "lucide-react";

export interface RadarGateBadges {
  zScore: boolean;
  basis: boolean;
  depth: boolean;
  spread: boolean;
  invariant7: boolean;
  allPassed: boolean;
}

export interface RadarPair {
  canonicalSymbol: string;
  binanceSymbol: string;
  bybitSymbol: string;
  multiplier: number;
  tier: "TIER 1" | "HIGH BETA" | "MEME COIN";
  binanceMid: number;
  bybitMid: number;
  grossBasisBps: number;
  ouTheta: number;
  halfLifeMinutes: number;
  equilibriumSigma: number;
  zScore: number;
  depthRatio: number;
  binanceSpreadBps: number;
  bybitSpreadBps: number;
  direction: "SHORT_BINANCE_LONG_BYBIT" | "SHORT_BYBIT_LONG_BINANCE";
  gateBadges: RadarGateBadges;
  reasons?: string[];
  lastUpdated: number;
}

export interface ConvergenceRadarTableProps {
  pairs?: RadarPair[];
  onSelectPair?: (pair: string) => void;
  selectedPair?: string;
  isLoading?: boolean;
}

function formatPrice(val: number): string {
  if (!val || val <= 0) return "$0.00";
  if (val >= 1000) {
    return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (val >= 1) {
    return `$${val.toFixed(4)}`;
  }
  if (val >= 0.001) {
    return `$${val.toFixed(6)}`;
  }
  return `$${val.toFixed(8)}`;
}

export default function ConvergenceRadarTable({
  pairs = [],
  onSelectPair,
  selectedPair = "PEPE",
  isLoading = false,
}: ConvergenceRadarTableProps) {
  const [search, setSearch] = useState("");
  const [filterQualifyingOnly, setFilterQualifyingOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"zScore" | "grossBasis" | "halfLife">("zScore");
  const [sortAsc, setSortAsc] = useState(false);

  // Filter and sort
  const processedPairs = useMemo(() => {
    let result = [...pairs];

    if (search.trim()) {
      const q = search.trim().toUpperCase();
      result = result.filter(
        (p) =>
          p.canonicalSymbol.includes(q) ||
          p.binanceSymbol.includes(q) ||
          p.bybitSymbol.includes(q)
      );
    }

    if (filterQualifyingOnly) {
      result = result.filter((p) => p.gateBadges.allPassed);
    }

    result.sort((a, b) => {
      let valA = 0;
      let valB = 0;
      if (sortBy === "zScore") {
        valA = Math.abs(a.zScore);
        valB = Math.abs(b.zScore);
      } else if (sortBy === "grossBasis") {
        valA = Math.abs(a.grossBasisBps);
        valB = Math.abs(b.grossBasisBps);
      } else if (sortBy === "halfLife") {
        valA = a.halfLifeMinutes;
        valB = b.halfLifeMinutes;
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return result;
  }, [pairs, search, filterQualifyingOnly, sortBy, sortAsc]);

  const handleSort = (field: "zScore" | "grossBasis" | "halfLife") => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-4 sm:p-5 shadow-xl shadow-black/50 font-mono">
      {/* Table Header & Search Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
                Cross-Exchange Spread Radar & 5-Gate Evaluation
              </h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-bold">
                {pairs.length} MONITORED
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Real-time Ornstein-Uhlenbeck calibration and multi-stage entry gate verification
            </p>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Search box */}
          <div className="relative flex-1 sm:w-44">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
            />
          </div>

          {/* Qualifying filter button */}
          <button
            onClick={() => setFilterQualifyingOnly(!filterQualifyingOnly)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              filterQualifyingOnly
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Filter className="w-3 h-3" />
            <span>Qualifying ({pairs.filter((p) => p.gateBadges.allPassed).length})</span>
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800/80">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-900/90 text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
              <th className="py-2.5 px-3 font-semibold">Instrument & Tier</th>
              <th className="py-2.5 px-3 font-semibold text-right">Binance Mid</th>
              <th className="py-2.5 px-3 font-semibold text-right">Bybit Mid</th>
              <th
                onClick={() => handleSort("grossBasis")}
                className="py-2.5 px-3 font-semibold text-right cursor-pointer hover:text-accent-amber transition-colors"
              >
                <div className="flex items-center justify-end space-x-1">
                  <span>Gross Basis (bps)</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-2.5 px-3 font-semibold text-right">OU Theta (θ)</th>
              <th
                onClick={() => handleSort("halfLife")}
                className="py-2.5 px-3 font-semibold text-right cursor-pointer hover:text-accent-amber transition-colors"
              >
                <div className="flex items-center justify-end space-x-1">
                  <span>Half-Life (τ)</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th
                onClick={() => handleSort("zScore")}
                className="py-2.5 px-3 font-semibold text-right cursor-pointer hover:text-accent-amber transition-colors"
              >
                <div className="flex items-center justify-end space-x-1">
                  <span>Z-Score (σ)</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-2.5 px-3 font-semibold text-center">
                5 Entry Gate Badges
              </th>
              <th className="py-2.5 px-3 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
            {isLoading && pairs.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-zinc-500">
                  <Activity className="w-5 h-5 animate-spin mx-auto mb-2 text-accent-amber" />
                  <span>Scanning cross-exchange corridors...</span>
                </td>
              </tr>
            ) : processedPairs.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-zinc-500">
                  No corridors matched current filters.
                </td>
              </tr>
            ) : (
              processedPairs.map((p) => {
                const isSelected = selectedPair === p.canonicalSymbol;
                const isQualifying = p.gateBadges.allPassed;

                let tierColor = "bg-zinc-800 text-zinc-400 border-zinc-700";
                if (p.tier === "TIER 1") tierColor = "bg-blue-500/10 text-blue-400 border-blue-500/20";
                if (p.tier === "HIGH BETA") tierColor = "bg-purple-500/10 text-purple-400 border-purple-500/20";
                if (p.tier === "MEME COIN") tierColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";

                return (
                  <tr
                    key={p.canonicalSymbol}
                    className={`transition-colors ${
                      isSelected
                        ? "bg-amber-500/5 hover:bg-amber-500/10"
                        : "hover:bg-zinc-900/60"
                    } ${isQualifying ? "border-l-2 border-l-emerald-400" : ""}`}
                  >
                    {/* Symbol & Tier */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-zinc-100">{p.canonicalSymbol}</span>
                        <span className="text-[9px] text-zinc-500">/USDT</span>
                        <span className={`text-[9px] px-1 py-0.2 rounded font-bold border ${tierColor}`}>
                          {p.tier}
                        </span>
                        {p.multiplier !== 1.0 && (
                          <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                            {p.multiplier}x
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Binance Mid */}
                    <td className="py-2.5 px-3 text-right text-zinc-300 font-medium">
                      {formatPrice(p.binanceMid)}
                    </td>

                    {/* Bybit Mid */}
                    <td className="py-2.5 px-3 text-right text-zinc-300 font-medium">
                      {formatPrice(p.bybitMid)}
                    </td>

                    {/* Gross Basis (bps) */}
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`font-bold ${
                          Math.abs(p.grossBasisBps) >= 28.0
                            ? "text-accent-amber"
                            : p.grossBasisBps > 0
                            ? "text-emerald-400"
                            : "text-zinc-300"
                        }`}
                      >
                        {p.grossBasisBps > 0 ? `+${p.grossBasisBps.toFixed(1)}` : p.grossBasisBps.toFixed(1)}
                      </span>
                    </td>

                    {/* OU Theta */}
                    <td className="py-2.5 px-3 text-right text-zinc-400">
                      {p.ouTheta.toFixed(2)} min⁻¹
                    </td>

                    {/* Half-Life */}
                    <td className="py-2.5 px-3 text-right text-zinc-400">
                      {p.halfLifeMinutes.toFixed(1)}m
                    </td>

                    {/* Z-Score */}
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                          Math.abs(p.zScore) >= 2.2
                            ? "bg-amber-500/20 text-accent-amber border border-amber-500/40"
                            : Math.abs(p.zScore) <= 0.35
                            ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                            : "text-zinc-400"
                        }`}
                      >
                        {p.zScore > 0 ? `+${p.zScore.toFixed(2)}` : p.zScore.toFixed(2)}σ
                      </span>
                    </td>

                    {/* 5 Gate Badges */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-center space-x-1 text-[9px]">
                        {/* Gate 1: |z| >= 2.2 */}
                        <span
                          className={`px-1 py-0.5 rounded font-bold border flex items-center space-x-0.5 ${
                            p.gateBadges.zScore
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : "bg-zinc-900 text-zinc-600 border-zinc-800"
                          }`}
                          title={p.gateBadges.zScore ? "Z-Score Gate Passed (≥2.20σ)" : "Z-Score Below 2.20σ"}
                        >
                          {p.gateBadges.zScore ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                          <span>|z|≥2.2</span>
                        </span>

                        {/* Gate 2: Basis >= 28 */}
                        <span
                          className={`px-1 py-0.5 rounded font-bold border flex items-center space-x-0.5 ${
                            p.gateBadges.basis
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : "bg-zinc-900 text-zinc-600 border-zinc-800"
                          }`}
                          title={p.gateBadges.basis ? "Gross Basis Gate Passed (≥28 bps)" : "Basis Below 28 bps"}
                        >
                          {p.gateBadges.basis ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                          <span>B≥28</span>
                        </span>

                        {/* Gate 3: Depth >= 4x */}
                        <span
                          className={`px-1 py-0.5 rounded font-bold border flex items-center space-x-0.5 ${
                            p.gateBadges.depth
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : "bg-zinc-900 text-zinc-600 border-zinc-800"
                          }`}
                          title={p.gateBadges.depth ? `Depth Gate Passed (${p.depthRatio}x ≥ 4x)` : "Depth Cushion Insufficient"}
                        >
                          {p.gateBadges.depth ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                          <span>D≥4x</span>
                        </span>

                        {/* Gate 4: Spread <= 8 */}
                        <span
                          className={`px-1 py-0.5 rounded font-bold border flex items-center space-x-0.5 ${
                            p.gateBadges.spread
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : "bg-zinc-900 text-zinc-600 border-zinc-800"
                          }`}
                          title={p.gateBadges.spread ? "Spread Filter Passed (≤8 bps)" : "Spread Exceeds 8 bps"}
                        >
                          {p.gateBadges.spread ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                          <span>S≤8</span>
                        </span>

                        {/* Gate 5: Invariant 7 Passed */}
                        <span
                          className={`px-1 py-0.5 rounded font-bold border flex items-center space-x-0.5 ${
                            p.gateBadges.invariant7
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : "bg-rose-500/20 text-rose-400 border-rose-500/40"
                          }`}
                          title={p.gateBadges.invariant7 ? "Invariant 7 Sticky Filter Passed" : "Invariant 7 Failed (Sticky Decoupling)"}
                        >
                          {p.gateBadges.invariant7 ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                          <span>INV7</span>
                        </span>
                      </div>
                    </td>

                    {/* Action Button */}
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => onSelectPair && onSelectPair(p.canonicalSymbol)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold transition-all inline-flex items-center space-x-1 ${
                          isSelected
                            ? "bg-amber-500/20 text-accent-amber border border-amber-500/40"
                            : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/60"
                        }`}
                        title="Focus Z-Score Chart"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Chart</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
