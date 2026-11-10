"use client";

import React, { useState } from "react";
import { DivergencePosition } from "@/lib/divergence/types";
import {
  Layers,
  Clock,
  TrendingUp,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  ArrowRight,
  Percent,
} from "lucide-react";

export interface ActivePositionsTableProps {
  positions: DivergencePosition[];
  onClosePosition: (positionId: string) => Promise<void>;
  isClosing?: boolean;
}

export default function ActivePositionsTable({
  positions = [],
  onClosePosition,
  isClosing = false,
}: ActivePositionsTableProps) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [confirmPosition, setConfirmPosition] = useState<DivergencePosition | null>(null);

  const handleClose = async (pos: DivergencePosition) => {
    setClosingId(pos.id);
    try {
      await onClosePosition(pos.id);
    } finally {
      setClosingId(null);
      setConfirmPosition(null);
    }
  };

  const getStagnancyStatus = (pos: DivergencePosition) => {
    const now = Date.now();
    const remainingNominalMs = pos.stagnancyNominalDeadline - now;
    const remainingCeilingMs = pos.stagnancyCeilingDeadline - now;

    if (remainingCeilingMs <= 0) {
      return { label: "CEILING EXPIRED", color: "text-red-400 bg-red-500/10 border-red-500/30", minutes: 0 };
    }
    if (remainingNominalMs <= 0) {
      const mins = Math.max(0, Math.floor(remainingCeilingMs / 60000));
      return { label: `EXTENDED (${mins}m)`, color: "text-accent-amber bg-amber-500/10 border-amber-500/30", minutes: mins };
    }
    const mins = Math.max(0, Math.floor(remainingNominalMs / 60000));
    return { label: `NOMINAL (${mins}m)`, color: "text-zinc-400 bg-zinc-900 border-zinc-800", minutes: mins };
  };

  return (
    <div className="w-full rounded-2xl bg-zinc-950/80 border border-border/80 backdrop-blur-xl p-4 font-mono shadow-xl flex flex-col space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-accent-emerald">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-zinc-100 uppercase tracking-wider flex items-center space-x-2">
              <span>ACTIVE POSITIONS</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                {"// LIVE DELTA-NEUTRAL INVENTORY"}
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Real-time monitored positions with relative expansion progress and dual-horizon stagnancy
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <span className="text-[11px] px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300">
            CAPACITY: {positions.length} / 1 HARD-LOCKED
          </span>
        </div>
      </div>

      {/* Positions Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-900">
        {positions.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs flex flex-col items-center space-y-2">
            <Layers className="w-6 h-6 text-zinc-700" />
            <span>No active positions currently open. Fleet is 100% Flat (Zero Naked Risk).</span>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-900 text-[11px]">
              <tr>
                <th className="py-2.5 px-3">Pair / Direction</th>
                <th className="py-2.5 px-3">Entry Basis</th>
                <th className="py-2.5 px-3">Current Basis</th>
                <th className="py-2.5 px-3">Relative Expansion</th>
                <th className="py-2.5 px-3">Hold / Stagnancy</th>
                <th className="py-2.5 px-3">Funding Carry</th>
                <th className="py-2.5 px-3">Est. Net PnL</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/70">
              {positions.map((pos) => {
                const stagnancy = getStagnancyStatus(pos);
                const expansionProgress = Math.min(
                  100,
                  Math.max(0, (pos.relativeExpansionPercent / pos.targetExpansionPercent) * 100)
                );
                const isProfitable = pos.netPnlUsdt >= 0.01;

                return (
                  <tr key={pos.id} className="hover:bg-zinc-900/40 transition-colors">
                    {/* Pair & Direction */}
                    <td className="py-3 px-3">
                      <div className="font-black text-zinc-100 flex items-center space-x-1.5">
                        <span className="text-accent-amber">{pos.canonicalSymbol}</span>
                        <span className="text-[10px] text-zinc-500">/ USDT</span>
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        <span
                          className={
                            pos.direction === "LONG_BN_SHORT_BYB" || pos.direction === "LONG_BINANCE_SHORT_BYBIT"
                              ? "text-cyan-400 font-semibold"
                              : "text-purple-400 font-semibold"
                          }
                        >
                          {pos.direction === "LONG_BN_SHORT_BYB" || pos.direction === "LONG_BINANCE_SHORT_BYBIT"
                            ? "Long BN Maker / Short BYB Taker"
                            : "Short BN Maker / Long BYB Taker"}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Notional: ${pos.notionalUsdt.toFixed(2)} USDT
                      </div>
                    </td>

                    {/* Entry Basis */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-zinc-200">
                        {pos.entryBasisPercent >= 0 ? "+" : ""}
                        {pos.entryBasisPercent.toFixed(3)}%
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        BN: ${pos.entryBinancePrice.toFixed(4)}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        BYB: ${pos.entryBybitPrice.toFixed(4)}
                      </div>
                    </td>

                    {/* Current Basis */}
                    <td className="py-3 px-3">
                      <div
                        className={`font-bold ${
                          pos.currentBasisPercent >= 0
                            ? "text-accent-emerald"
                            : "text-red-400"
                        }`}
                      >
                        {pos.currentBasisPercent >= 0 ? "+" : ""}
                        {pos.currentBasisPercent.toFixed(3)}%
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Peak: +{pos.peakBasisPercent.toFixed(3)}%
                      </div>
                    </td>

                    {/* Relative Expansion Progress */}
                    <td className="py-3 px-3 min-w-[140px]">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span
                          className={`font-bold ${
                            pos.relativeExpansionPercent >= 0
                              ? "text-accent-emerald"
                              : "text-red-400"
                          }`}
                        >
                          {pos.relativeExpansionPercent >= 0 ? "+" : ""}
                          {pos.relativeExpansionPercent.toFixed(3)}%
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          / {pos.targetExpansionPercent.toFixed(3)}%
                        </span>
                      </div>
                      <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            pos.relativeExpansionPercent >= pos.targetExpansionPercent
                              ? "bg-accent-emerald"
                              : "bg-accent-amber"
                          }`}
                          style={{ width: `${expansionProgress}%` }}
                        />
                      </div>
                    </td>

                    {/* Hold / Stagnancy */}
                    <td className="py-3 px-3">
                      <div className="text-zinc-300 font-semibold">
                        {pos.holdDurationMinutes.toFixed(0)}m elapsed
                      </div>
                      <span
                        className={`inline-block text-[9px] px-1.5 py-0.2 rounded font-bold border mt-0.5 ${stagnancy.color}`}
                      >
                        {stagnancy.label}
                      </span>
                    </td>

                    {/* Funding Carry */}
                    <td className="py-3 px-3">
                      <div
                        className={`font-bold ${
                          pos.accumulatedCarryPercent >= 0
                            ? "text-accent-emerald"
                            : "text-red-400"
                        }`}
                      >
                        {pos.accumulatedCarryPercent >= 0 ? "+" : ""}
                        {pos.accumulatedCarryPercent.toFixed(4)}%
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Directional carry
                      </div>
                    </td>

                    {/* Est Net PnL */}
                    <td className="py-3 px-3">
                      <div
                        className={`text-sm font-black ${
                          pos.netPnlUsdt >= 0.01
                            ? "text-accent-emerald"
                            : pos.netPnlUsdt >= 0
                            ? "text-zinc-300"
                            : "text-red-400"
                        }`}
                      >
                        {pos.netPnlUsdt >= 0 ? "+" : ""}
                        ${pos.netPnlUsdt.toFixed(4)}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {pos.roiPercent >= 0 ? "+" : ""}
                        {pos.roiPercent.toFixed(2)}% ROI
                      </div>
                      {isProfitable && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                          ZERO-LOSS MET
                        </span>
                      )}
                    </td>

                    {/* Close Action */}
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => setConfirmPosition(pos)}
                        disabled={isClosing || closingId === pos.id}
                        className="px-2.5 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                        title="Unwind dual-leg position with mandatory reduceOnly: true"
                      >
                        {closingId === pos.id ? "Unwinding..." : "Close"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmPosition && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-amber-400">
              <ShieldAlert className="w-6 h-6 text-accent-amber" />
              <h3 className="text-base font-black uppercase tracking-wider text-zinc-100">
                Confirm Manual Position Unwind
              </h3>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to manually unwind the live delta-neutral position for{" "}
              <strong className="text-accent-amber">
                {confirmPosition.canonicalSymbol}/USDT
              </strong>
              ?
            </p>
            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs space-y-1 text-zinc-400">
              <div className="flex justify-between">
                <span>Current Net PnL:</span>
                <span
                  className={
                    confirmPosition.netPnlUsdt >= 0
                      ? "text-accent-emerald font-bold"
                      : "text-red-400 font-bold"
                  }
                >
                  {confirmPosition.netPnlUsdt >= 0 ? "+" : ""}
                  ${confirmPosition.netPnlUsdt.toFixed(4)} USDT
                </span>
              </div>
              <div className="flex justify-between">
                <span>Order Execution:</span>
                <span className="text-zinc-200">Mandatory reduceOnly: true</span>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setConfirmPosition(null)}
                className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleClose(confirmPosition)}
                disabled={closingId === confirmPosition.id}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all active:scale-95 shadow-md"
              >
                {closingId === confirmPosition.id ? "Unwinding..." : "Confirm Unwind"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
