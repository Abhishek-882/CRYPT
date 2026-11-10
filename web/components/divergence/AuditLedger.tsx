"use client";

import React, { useState } from "react";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Copy,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
  Percent,
  Clock,
} from "lucide-react";

export interface AuditPositionItem {
  id: string;
  canonicalSymbol: string;
  pair: string;
  direction: string;
  entryTimestamp: number;
  exitTimestamp: number;
  holdDurationMinutes: number;
  entryBasisPercent: number;
  exitBasisPercent: number;
  finalRelativeExpansionPercent: number;
  targetExpansionPercent: number;
  notionalUsdt: number;
  totalFeesUsdt: number;
  actualFeesUsdt: number;
  realizedGrossPnlUsdt: number;
  netRealizedPnlUsdt: number;
  realizedRoiPercent: number;
  accumulatedCarryPercent: number;
  exitReason: string;
  status: "CLOSED" | "CONFIRMED_ZERO_LOSS" | "STOPPED_OUT" | "SCRATCH_UNWOUND";
  executionHash: string;
}

export interface AuditLedgerProps {
  closedPositions: AuditPositionItem[];
  summaryMetrics?: {
    totalClosedTrades: number;
    winRatePercent: number;
    totalNetRealizedPnlUsdt: number;
    totalFeesPaidUsdt: number;
    averageHoldDurationMinutes: number;
    zeroLossCompliantCount: number;
  };
  isLoading?: boolean;
}

export default function AuditLedger({
  closedPositions = [],
  summaryMetrics,
  isLoading = false,
}: AuditLedgerProps) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const handleCopyHash = (hash: string) => {
    if (!hash) return;
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  const getStatusBadge = (status: AuditPositionItem["status"]) => {
    switch (status) {
      case "CONFIRMED_ZERO_LOSS":
        return (
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-accent-emerald border border-emerald-500/40 text-[10px] font-bold">
            CONFIRMED ZERO-LOSS
          </span>
        );
      case "STOPPED_OUT":
        return (
          <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 text-[10px] font-bold">
            STOPPED OUT
          </span>
        );
      case "SCRATCH_UNWOUND":
        return (
          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-accent-amber border border-amber-500/40 text-[10px] font-bold">
            SCRATCH UNWOUND
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-semibold">
            CLOSED
          </span>
        );
    }
  };

  return (
    <div className="w-full rounded-2xl bg-zinc-950/80 border border-border/80 backdrop-blur-xl p-4 font-mono shadow-xl flex flex-col space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-zinc-100 uppercase tracking-wider flex items-center space-x-2">
              <span>AUTHENTIC EXECUTION AUDIT LEDGER</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                {"// ZERO SYNTHETIC SEEDS"}
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Immutable trade receipts reconciled against Binance & Bybit execution feeds
            </p>
          </div>
        </div>

        {summaryMetrics && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px]">
              TRADES: {summaryMetrics.totalClosedTrades}
            </span>
            <span className="px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-accent-emerald text-[11px]">
              ZERO-LOSS: {summaryMetrics.zeroLossCompliantCount} / {summaryMetrics.totalClosedTrades}
            </span>
            <span className="px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px]">
              WIN: {summaryMetrics.winRatePercent.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Audit Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-900">
        {closedPositions.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-xs flex flex-col items-center space-y-2">
            <FileText className="w-6 h-6 text-zinc-700" />
            <span>No closed trades recorded yet. All fills will appear here authentically.</span>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-900 text-[11px]">
              <tr>
                <th className="py-2.5 px-3">Symbol / Pair</th>
                <th className="py-2.5 px-3">Direction</th>
                <th className="py-2.5 px-3">Basis Trajectory</th>
                <th className="py-2.5 px-3">Expansion</th>
                <th className="py-2.5 px-3">Hold Time</th>
                <th className="py-2.5 px-3">Exchange Fees</th>
                <th className="py-2.5 px-3">Net Realized PnL</th>
                <th className="py-2.5 px-3">Settlement Status</th>
                <th className="py-2.5 px-3 text-right">Proof Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/70">
              {closedPositions.map((pos) => {
                const isProfitable = pos.netRealizedPnlUsdt >= 0;

                return (
                  <tr key={pos.id} className="hover:bg-zinc-900/40 transition-colors">
                    {/* Symbol */}
                    <td className="py-3 px-3">
                      <div className="font-black text-zinc-100 flex items-center space-x-1">
                        <span className="text-accent-amber">{pos.canonicalSymbol}</span>
                        <span className="text-[10px] text-zinc-500">/ USDT</span>
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        ${pos.notionalUsdt.toFixed(2)} notional
                      </div>
                    </td>

                    {/* Direction */}
                    <td className="py-3 px-3">
                      <span
                        className={`text-[10px] font-semibold ${
                          pos.direction === "LONG_BN_SHORT_BYB" || pos.direction === "LONG_BINANCE_SHORT_BYBIT" || pos.direction === "DIRECTION_1"
                            ? "text-cyan-400"
                            : "text-purple-400"
                        }`}
                      >
                        {pos.direction === "LONG_BN_SHORT_BYB" || pos.direction === "LONG_BINANCE_SHORT_BYBIT" || pos.direction === "DIRECTION_1"
                          ? "Long BN / Short BYB"
                          : "Short BN / Long BYB"}
                      </span>
                    </td>

                    {/* Basis Trajectory */}
                    <td className="py-3 px-3">
                      <div className="text-zinc-200">
                        {pos.entryBasisPercent >= 0 ? "+" : ""}
                        {pos.entryBasisPercent.toFixed(3)}% →{" "}
                        {pos.exitBasisPercent >= 0 ? "+" : ""}
                        {pos.exitBasisPercent.toFixed(3)}%
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Carry: {pos.accumulatedCarryPercent >= 0 ? "+" : ""}
                        {pos.accumulatedCarryPercent.toFixed(4)}%
                      </div>
                    </td>

                    {/* Relative Expansion */}
                    <td className="py-3 px-3">
                      <span
                        className={`font-bold ${
                          pos.finalRelativeExpansionPercent >= pos.targetExpansionPercent
                            ? "text-accent-emerald"
                            : "text-zinc-300"
                        }`}
                      >
                        +{pos.finalRelativeExpansionPercent.toFixed(3)}%
                      </span>
                      <div className="text-[10px] text-zinc-500">
                        Target: +{pos.targetExpansionPercent.toFixed(3)}%
                      </div>
                    </td>

                    {/* Hold Time */}
                    <td className="py-3 px-3 text-zinc-300">
                      <div>{pos.holdDurationMinutes.toFixed(1)}m</div>
                      <div className="text-[10px] text-zinc-500">
                        Exit: {pos.exitReason}
                      </div>
                    </td>

                    {/* Fees */}
                    <td className="py-3 px-3 text-zinc-400">
                      <div>${pos.actualFeesUsdt.toFixed(4)}</div>
                      <div className="text-[10px] text-zinc-500">USDT total</div>
                    </td>

                    {/* Net Realized PnL */}
                    <td className="py-3 px-3">
                      <div
                        className={`text-sm font-black ${
                          isProfitable ? "text-accent-emerald" : "text-red-400"
                        }`}
                      >
                        {isProfitable ? "+" : ""}
                        ${pos.netRealizedPnlUsdt.toFixed(4)}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {pos.realizedRoiPercent >= 0 ? "+" : ""}
                        {pos.realizedRoiPercent.toFixed(2)}% ROI
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3">{getStatusBadge(pos.status)}</td>

                    {/* Proof Hash */}
                    <td className="py-3 px-3 text-right">
                      {pos.executionHash ? (
                        <button
                          onClick={() => handleCopyHash(pos.executionHash)}
                          className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-colors text-[10px]"
                          title="Copy SHA-256 Execution Proof"
                        >
                          <span>{pos.executionHash.slice(0, 8)}...</span>
                          {copiedHash === pos.executionHash ? (
                            <CheckCircle2 className="w-3 h-3 text-accent-emerald" />
                          ) : (
                            <Copy className="w-3 h-3 text-zinc-500" />
                          )}
                        </button>
                      ) : (
                        <span className="text-zinc-600 text-[10px]">N/A</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
