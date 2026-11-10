"use client";

import React, { useState, useMemo } from "react";
import { DivergenceCandidate } from "@/lib/divergence/types";
import {
  Zap,
  CheckCircle2,
  XCircle,
  Filter,
  Search,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Percent,
} from "lucide-react";

export interface CandidateFeedProps {
  candidates: DivergenceCandidate[];
  selectedCandidate?: DivergenceCandidate | null;
  onSelectCandidate: (candidate: DivergenceCandidate) => void;
  onDeployCandidate?: (candidate: DivergenceCandidate) => void;
  isDeploying?: boolean;
}

export default function CandidateFeed({
  candidates = [],
  selectedCandidate = null,
  onSelectCandidate,
  onDeployCandidate,
  isDeploying = false,
}: CandidateFeedProps) {
  const [filterPrimeOnly, setFilterPrimeOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const matchesSearch =
        c.canonicalSymbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.symbol.toLowerCase().includes(searchQuery.toLowerCase());

      const isPrime =
        Math.abs(c.liveBasisPercent) <= 0.1 &&
        c.dispersion24hPercent >= 0.4;

      if (filterPrimeOnly) {
        return matchesSearch && isPrime;
      }
      return matchesSearch;
    });
  }, [candidates, filterPrimeOnly, searchQuery]);

  return (
    <div className="w-full rounded-2xl bg-zinc-950/80 border border-border/80 backdrop-blur-xl p-4 font-mono shadow-xl flex flex-col space-y-3">
      {/* Feed Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-accent-amber">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-zinc-100 uppercase tracking-wider flex items-center space-x-2">
              <span>CANDIDATE FEED</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                {"// 5-GATE OPPORTUNITY QUALIFIER"}
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Rank-ordered basis expansion opportunities from live exchange books
            </p>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search symbol..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-accent-amber transition-colors w-36 sm:w-48"
            />
          </div>

          <button
            onClick={() => setFilterPrimeOnly(!filterPrimeOnly)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
              filterPrimeOnly
                ? "bg-emerald-500/20 text-accent-emerald border-emerald-500/40 ring-1 ring-emerald-500/20"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Prime Only</span>
          </button>
        </div>
      </div>

      {/* Candidates List / Table */}
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded-xl border border-zinc-900 divide-y divide-zinc-900/80">
        {filteredCandidates.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs">
            No candidates matching current filter criteria.
          </div>
        ) : (
          filteredCandidates.map((c) => {
            const isPrime =
              Math.abs(c.liveBasisPercent) <= 0.1 &&
              c.dispersion24hPercent >= 0.4;
            const isSelected =
              selectedCandidate?.canonicalSymbol === c.canonicalSymbol;

            return (
              <div
                key={c.canonicalSymbol}
                onClick={() => onSelectCandidate(c)}
                className={`p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-all ${
                  isSelected
                    ? "bg-zinc-900/90 border-l-4 border-l-cyan-400 shadow-md"
                    : isPrime
                    ? "bg-zinc-950/40 hover:bg-zinc-900/50 border-l-2 border-l-emerald-500/50"
                    : "bg-zinc-950/20 hover:bg-zinc-900/30"
                }`}
              >
                {/* Left: Symbol & Badges */}
                <div className="flex items-center space-x-3 min-w-[180px]">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs ${
                      isPrime
                        ? "bg-emerald-500/10 border border-emerald-500/30 text-accent-emerald"
                        : "bg-zinc-900 border border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Δ
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-black text-zinc-100 text-sm">
                        {c.canonicalSymbol}
                      </span>
                      <span className="text-[10px] text-zinc-500">/ USDT</span>
                      {isPrime && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-accent-emerald border border-emerald-500/30 font-bold">
                          PRIME
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-400 flex items-center space-x-1.5">
                      <span className="text-zinc-500">Direction:</span>
                      <span
                        className={
                          c.suggestedDirection === "LONG_BN_SHORT_BYB" || c.suggestedDirection === "LONG_BINANCE_SHORT_BYBIT"
                            ? "text-cyan-400 font-semibold"
                            : "text-purple-400 font-semibold"
                        }
                      >
                        {c.suggestedDirection === "LONG_BN_SHORT_BYB" || c.suggestedDirection === "LONG_BINANCE_SHORT_BYBIT"
                          ? "Long BN / Short BYB"
                          : "Short BN / Long BYB"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Middle: Basis & Volatility Metrics */}
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div>
                    <div className="text-[10px] text-zinc-500">Current Basis</div>
                    <div
                      className={`font-bold ${
                        c.liveBasisPercent >= 0
                          ? "text-accent-emerald"
                          : "text-red-400"
                      }`}
                    >
                      {c.liveBasisPercent >= 0 ? "+" : ""}
                      {c.liveBasisPercent.toFixed(3)}%
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-500">24h Dispersion</div>
                    <div className="font-bold text-cyan-400">
                      {c.dispersion24hPercent.toFixed(3)}%
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-500">DDI Score</div>
                    <div className="font-bold text-accent-amber">
                      {c.ddi24h.toFixed(3)}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-500">Projected Alpha</div>
                    <div
                      className={`font-semibold ${
                        c.netAlphaProjectedPercent >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {c.netAlphaProjectedPercent >= 0 ? "+" : ""}
                      {c.netAlphaProjectedPercent.toFixed(4)}%
                    </div>
                  </div>
                </div>

                {/* Right: 5-Gate Badges & Deploy Action */}
                <div className="flex items-center space-x-3">
                  <div className="hidden md:flex items-center space-x-1 text-[10px]">
                    <span
                      title="Liquidity Gate: 24h Vol >= $5M"
                      className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300"
                    >
                      LIQ ✓
                    </span>
                    <span
                      title="Spread Gate: Top-of-book tight"
                      className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300"
                    >
                      SPR ✓
                    </span>
                    <span
                      title="Expansion Gate: Delta b >= 0.400%"
                      className={`px-1.5 py-0.5 rounded border ${
                        c.dispersion24hPercent >= 0.4
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold"
                          : "bg-zinc-900 border-zinc-800 text-zinc-500"
                      }`}
                    >
                      EXP {c.dispersion24hPercent >= 0.4 ? "✓" : "✗"}
                    </span>
                    <span
                      title="Carry Gate: Net funding favorable"
                      className={`px-1.5 py-0.5 rounded border ${
                        c.gatesPassed?.carryFeasibility
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-zinc-900 border-zinc-800 text-zinc-500"
                      }`}
                    >
                      CRY {c.gatesPassed?.carryFeasibility ? "✓" : "✗"}
                    </span>
                  </div>

                  {onDeployCandidate && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeployCandidate(c);
                      }}
                      disabled={isDeploying || !isPrime}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center space-x-1 ${
                        isPrime
                          ? "bg-accent-amber hover:bg-amber-400 text-zinc-950 shadow-sm shadow-amber-500/10"
                          : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      }`}
                      title={
                        isPrime
                          ? "Arm single-trade deployment"
                          : "Candidate requires |bt| <= 0.100% and Delta b >= 0.400%"
                      }
                    >
                      <span>Deploy</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
