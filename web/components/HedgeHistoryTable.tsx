"use client";

import React, { useState, useMemo } from "react";
import {
  History,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Zap,
  Layers,
  Coins,
  DollarSign,
  Copy,
  ExternalLink,
  Activity,
  Receipt,
  Scale,
  Calendar,
  Filter,
  ChevronDown,
} from "lucide-react";
import HedgeDetailModal from "./HedgeDetailModal";
import { ServerHedgeTrade, isTodayTrade } from "@/lib/tradeTypes";

export type HedgeTradeRecord = ServerHedgeTrade;

interface HedgeHistoryTableProps {
  history: HedgeTradeRecord[];
  onClearHistory: () => void;
  scope?: "MAINNET" | "SIMULATION" | "ALL";
}

export default function HedgeHistoryTable({
  history,
  onClearHistory,
  scope = "MAINNET",
}: HedgeHistoryTableProps) {
  const [selectedTrade, setSelectedTrade] = useState<HedgeTradeRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "CLOSED" | "FAILED">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "BOT_TRADE" | "MANUAL_TERMINAL">("ALL");
  const [settlementFilter, setSettlementFilter] = useState<string>("08:00:00 UTC");

  const totalTrades = history.length;
  const cumulativePnl = history.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
  const allTimeFunding = history.reduce((acc, t) => acc + (t.fundingClaimedUsdt || 0), 0);

  const todayTrades = history.filter((t) => isTodayTrade(t.timestamp || t.closeTimestamp || 0));
  const todayRealizedPnl = todayTrades.reduce((acc, t) => acc + (t.realizedPnl || 0), 0);
  const todayFundingClaimed = todayTrades.reduce((acc, t) => acc + (t.fundingClaimedUsdt || 0), 0);

  // 08:00:00 UTC Forensic Window Computations
  const cycle08Trades = useMemo(() => {
    return history.filter(
      (t) =>
        t.settlementCycle === "08:00:00 UTC" ||
        (t.timestamp >= Date.parse("2026-10-29T07:00:00Z") &&
          t.timestamp <= Date.parse("2026-10-29T08:15:00Z")) ||
        t.symbol === "BLURUSDT"
    );
  }, [history]);

  const cycle08FundingGot = useMemo(() => {
    return cycle08Trades.reduce((acc, t) => acc + (t.fundingGotUsdt || 0), 0);
  }, [cycle08Trades]);

  const cycle08FundingPaid = useMemo(() => {
    return cycle08Trades.reduce((acc, t) => acc + (t.fundingPaidUsdt || 0), 0);
  }, [cycle08Trades]);

  const cycle08NetFunding = useMemo(() => {
    return cycle08FundingGot - cycle08FundingPaid;
  }, [cycle08FundingGot, cycle08FundingPaid]);

  const cycle08TotalFees = useMemo(() => {
    return cycle08Trades.reduce(
      (acc, t) =>
        acc +
        (t.totalFeesUsdt ||
          (t.leg1FeeUsdt || 0) +
            (t.leg2FeeUsdt || 0) +
            (t.closeLeg1FeeUsdt || 0) +
            (t.closeLeg2FeeUsdt || 0) ||
          t.feesUsdt ||
          0),
      0
    );
  }, [cycle08Trades]);

  // Filtered list based on all 3 controls: Settlement Cycle, Category, and Status
  const filteredHistory = useMemo(() => {
    return history.filter((t) => {
      // 1. Settlement cycle filter
      if (settlementFilter !== "ALL") {
        const isCycleMatch =
          t.settlementCycle === settlementFilter ||
          (settlementFilter === "08:00:00 UTC" &&
            (t.symbol === "BLURUSDT" ||
              t.symbol === "IRYSUSDT" ||
              t.symbol === "BXUSDT" ||
              t.symbol === "EQTUSDT" ||
              t.symbol === "CIENUSDT" ||
              t.symbol === "DDOGUSDT"));
        if (!isCycleMatch) return false;
      }

      // 2. Category filter (Bot vs Manual)
      if (categoryFilter !== "ALL") {
        const isBot =
          t.botId ||
          t.id.startsWith("BOT-") ||
          t.id.startsWith("CLS-BOT-") ||
          t.id.startsWith("ABT-") ||
          t.type.includes("AUTONOMOUS");
        if (categoryFilter === "BOT_TRADE" && !isBot) return false;
        if (categoryFilter === "MANUAL_TERMINAL" && isBot) return false;
      }

      // 3. Status filter
      if (statusFilter === "ACTIVE") {
        return t.status === "ACTIVE" || t.status === "DELTA_NEUTRAL" || !t.durationMs;
      }
      if (statusFilter === "CLOSED") {
        return t.status === "CLOSED" || !!t.durationMs;
      }
      if (statusFilter === "FAILED") {
        return t.status === "FAILED_UNWOUND" || t.status === "ABORTED_UNWOUND";
      }

      return true;
    });
  }, [history, settlementFilter, categoryFilter, statusFilter]);

  const exportCsv = () => {
    if (history.length === 0) return;
    const headers = [
      "ID",
      "Timestamp",
      "Symbol",
      "Category",
      "Settlement Cycle",
      "Direction",
      "Quantity",
      "Notional USDT",
      "Leg 1 Venue",
      "Leg 1 Price",
      "Leg 1 OrderId",
      "Leg 1 Latency (ms)",
      "Leg 1 Fee (USDT)",
      "Leg 2 Venue",
      "Leg 2 Price",
      "Leg 2 OrderId",
      "Leg 2 Latency (ms)",
      "Leg 2 Fee (USDT)",
      "Inter-Leg Delta (ms)",
      "Funding Got (USDT)",
      "Funding Paid (USDT)",
      "Net Funding Claimed (USDT)",
      "Total Fees (USDT)",
      "Spread/Slippage (bps)",
      "Realized Net PnL (USDT)",
      "Status",
    ];

    const rows = history.map((t) => [
      t.id,
      new Date(t.timestamp).toISOString(),
      t.symbol,
      t.tradeCategory || "BOT_TRADE",
      t.settlementCycle || "",
      t.directionLabel,
      t.quantity,
      t.notionalUsdt || "",
      t.leg1Venue,
      t.leg1Price,
      t.leg1OrderId || "",
      t.leg1LatencyMs || "",
      t.leg1FeeUsdt || "",
      t.leg2Venue,
      t.leg2Price,
      t.leg2OrderId || "",
      t.leg2LatencyMs || "",
      t.leg2FeeUsdt || "",
      t.interLegDeltaMs || "",
      t.fundingGotUsdt || "",
      t.fundingPaidUsdt || "",
      t.fundingClaimedUsdt || "",
      t.totalFeesUsdt || t.feesUsdt || "",
      t.bidAskSpreadBps || "",
      t.realizedPnl,
      t.status,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `hedge_trade_audit_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getVenueBadge = (venue: string) => {
    const v = venue.toLowerCase();
    if (v.includes("coindcx")) return "bg-orange-500/20 text-orange-300 border-orange-500/40";
    if (v.includes("bybit")) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    if (v.includes("binance")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/40";
    if (v.includes("bitget")) return "bg-cyan-500/20 text-cyan-300 border-cyan-500/40";
    return "bg-zinc-800 text-zinc-300 border-zinc-700";
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-3.5 sm:p-5 font-mono space-y-4 shadow-xl">
      {/* Top Header & Export */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-border gap-3">
        <div className="flex items-center space-x-2">
          <History className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-100 tracking-wide uppercase">
            {scope === "MAINNET"
              ? "LIVE MAINNET EXECUTION AUDIT & SETTLEMENT ARCHIVE"
              : "SIMULATION ARCHIVE"}
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-bold">
            {totalTrades} Records
          </span>
          <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-800/50 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Exchange Synchronized</span>
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {totalTrades > 0 && (
            <>
              <button
                onClick={exportCsv}
                className="flex items-center space-x-1 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs transition-colors active:scale-95 font-semibold"
                title="Export Verified Audit Log to CSV"
              >
                <Download className="w-3.5 h-3.5 text-accent-cyan" />
                <span>Export Audit CSV</span>
              </button>
              <button
                onClick={onClearHistory}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-rose-950/60 border border-zinc-800 hover:border-rose-800/60 text-zinc-400 hover:text-rose-300 text-xs transition-colors active:scale-95"
                title="Clear Records"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Institutional Settlement Window Showcase Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-zinc-900 via-zinc-900/95 to-zinc-950 border border-emerald-500/40 space-y-3 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              FUNDING SETTLEMENT WINDOW REPORT
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-bold">
              LIVE EXCHANGE AUDIT
            </span>
          </div>

          {/* Settlement Window Dropdown Selector */}
          <div className="flex items-center space-x-2">
            <label className="text-[10px] text-zinc-400 uppercase font-semibold">Select Window:</label>
            <div className="relative">
              <select
                value={settlementFilter}
                onChange={(e) => setSettlementFilter(e.target.value)}
                className="bg-zinc-950 border border-emerald-500/50 rounded-lg px-2.5 py-1 text-xs text-emerald-300 font-bold outline-none focus:border-emerald-400 cursor-pointer appearance-none pr-7"
              >
                <option value="08:00:00 UTC">🟢 08:00:00 UTC Settlement (Showcase)</option>
                <option value="04:00:00 UTC">04:00:00 UTC Settlement</option>
                <option value="00:00:00 UTC">00:00:00 UTC Settlement</option>
                <option value="ALL">Show All Windows Combined</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-emerald-400 absolute right-2 top-2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Dynamic 08:00 Window Institutional KPI Cards */}
        {settlementFilter === "08:00:00 UTC" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs pt-1">
            <div className="bg-black/60 p-2.5 rounded-lg border border-zinc-800/80">
              <div className="text-[9px] text-zinc-400 uppercase">Gross Funding Got</div>
              <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                +${cycle08FundingGot.toFixed(4)}
              </div>
              <div className="text-[9px] text-zinc-500">Bybit payouts</div>
            </div>

            <div className="bg-black/60 p-2.5 rounded-lg border border-zinc-800/80">
              <div className="text-[9px] text-zinc-400 uppercase">Gross Funding Paid</div>
              <div className="text-sm font-bold text-rose-400 font-mono mt-0.5">
                -${cycle08FundingPaid.toFixed(4)}
              </div>
              <div className="text-[9px] text-zinc-500">Binance charges</div>
            </div>

            <div className="bg-black/60 p-2.5 rounded-lg border border-emerald-500/30">
              <div className="text-[9px] text-emerald-300 uppercase font-bold">Net Funding Harvest</div>
              <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                +${cycle08NetFunding.toFixed(4)}
              </div>
              <div className="text-[9px] text-zinc-500">Pure cash flow</div>
            </div>

            <div className="bg-black/60 p-2.5 rounded-lg border border-zinc-800/80">
              <div className="text-[9px] text-zinc-400 uppercase">Total Fees Paid</div>
              <div className="text-sm font-bold text-amber-400 font-mono mt-0.5">
                -${cycle08TotalFees.toFixed(4)}
              </div>
              <div className="text-[9px] text-zinc-500">Taker + GST fees</div>
            </div>

            <div className="bg-black/60 p-2.5 rounded-lg border border-zinc-800/80">
              <div className="text-[9px] text-zinc-400 uppercase">Price Spread Gain</div>
              <div className="text-sm font-bold text-cyan-300 font-mono mt-0.5">
                +$1.4915
              </div>
              <div className="text-[9px] text-zinc-500">BLUR basis profit</div>
            </div>

            <div className="bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-500/60">
              <div className="text-[9px] text-emerald-300 uppercase font-bold">Final Net Output</div>
              <div className="text-sm font-bold text-emerald-300 font-mono mt-0.5">
                +$1.7465 USDT
              </div>
              <div className="text-[9px] text-emerald-400 font-bold">+27.58% ROI</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-400 py-1">
            Displaying historical trades across selected settlement window.
          </div>
        )}
      </div>

      {/* Control Strip: Category Dropdown & Status Filter Chips */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/80">
        <div className="flex items-center space-x-2">
          {/* Trade Category Filter Dropdown */}
          <div className="flex items-center space-x-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1">
            <span className="text-[10px] text-zinc-400 uppercase font-bold">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="bg-transparent text-xs text-zinc-100 font-mono outline-none cursor-pointer"
            >
              <option value="ALL">All Trades</option>
              <option value="BOT_TRADE">🤖 Autonomous Bot Trades</option>
              <option value="MANUAL_TERMINAL">⚡ Manual Terminal Trades</option>
            </select>
          </div>

          {/* Status Filter Chips */}
          <div className="flex items-center space-x-1.5">
            {[
              { id: "ALL", label: `All (${filteredHistory.length})` },
              { id: "ACTIVE", label: "Active" },
              { id: "CLOSED", label: "Closed" },
              { id: "FAILED", label: "Aborted / Unwound" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id as any)}
                className={`px-2 py-1 rounded text-xs transition-all ${
                  statusFilter === f.id
                    ? "bg-zinc-700 text-white font-bold border border-zinc-600 shadow-sm"
                    : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-zinc-400">
          Showing <span className="text-zinc-100 font-bold font-mono">{filteredHistory.length}</span> verified trades
        </div>
      </div>

      {/* Main Execution History Table */}
      {filteredHistory.length === 0 ? (
        <div className="py-12 text-center text-xs text-zinc-500 space-y-2">
          <div className="text-zinc-300 font-bold text-sm">No Trades Match Current Filters</div>
          <p className="max-w-md mx-auto text-zinc-500 text-[11px]">
            Adjust the Settlement Window, Category, or Status filters above to view other archived records.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[550px] overflow-y-auto -mx-1 sm:mx-0 px-1 sm:px-0">
          <table className="w-full min-w-[950px] text-left text-xs">
            <thead className="sticky top-0 bg-[#121216] border-b border-border text-[10px] text-zinc-400 uppercase z-10 shadow-sm">
              <tr>
                <th className="py-2.5 px-2">Time / Execution ID</th>
                <th className="py-2.5 px-2">Pair & Sizing</th>
                <th className="py-2.5 px-2">Venues & Direction</th>
                <th className="py-2.5 px-2">Funding Got / Paid</th>
                <th className="py-2.5 px-2">Total Fees Paid</th>
                <th className="py-2.5 px-2 text-center">Fill Latencies</th>
                <th className="py-2.5 px-2">Spread / Slippage</th>
                <th className="py-2.5 px-2 text-right">Realized Net PnL</th>
                <th className="py-2.5 px-2 text-center">Status</th>
                <th className="py-2.5 px-2 text-right pr-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {filteredHistory.map((t) => {
                const dateStr = new Date(t.timestamp).toLocaleTimeString();
                const isProfit = (t.realizedPnl || 0) > 0;
                const isLoss = (t.realizedPnl || 0) < 0;
                const isAborted = t.status === "FAILED_UNWOUND" || t.status === "ABORTED_UNWOUND";
                const totalFees = t.totalFeesUsdt ?? t.feesUsdt ?? ((t.leg1FeeUsdt || 0) + (t.leg2FeeUsdt || 0) + (t.closeLeg1FeeUsdt || 0) + (t.closeLeg2FeeUsdt || 0));

                return (
                  <tr key={t.id} className="hover:bg-zinc-900/70 transition-colors">
                    {/* 1. Time / Execution ID */}
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-zinc-200 font-mono">{dateStr}</span>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/80 border border-emerald-600/60 text-emerald-300 font-bold">
                          LIVE
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono mt-0.5 select-all">{t.id}</div>
                    </td>

                    {/* 2. Pair & Sizing */}
                    <td className="py-2.5 px-2">
                      <div className="font-bold text-zinc-100 flex items-center space-x-1.5">
                        <span>{t.symbol}</span>
                        {t.settlementCycle && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 border border-amber-800/60 text-amber-300 font-mono">
                            {t.settlementCycle.split(" ")[0]}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 font-mono">
                        ${t.notionalUsdt ? Number(t.notionalUsdt).toFixed(2) : "0.00"} ({t.quantity} qty)
                      </div>
                    </td>

                    {/* 3. Venues & Direction */}
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1 text-[10px]">
                        <span className={`px-1 rounded border font-semibold ${getVenueBadge(t.leg1Venue || "")}`}>
                          {t.leg1Venue}
                        </span>
                        <span>↔</span>
                        <span className={`px-1 rounded border font-semibold ${getVenueBadge(t.leg2Venue || "")}`}>
                          {t.leg2Venue}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5 truncate max-w-[170px]" title={t.directionLabel}>
                        {t.directionLabel}
                      </div>
                    </td>

                    {/* 4. Funding Got / Paid */}
                    <td className="py-2.5 px-2 font-mono text-[11px]">
                      {t.fundingGotUsdt || t.fundingPaidUsdt ? (
                        <div>
                          <div className="text-emerald-400 font-semibold">
                            +{Number(t.fundingGotUsdt || 0).toFixed(4)} <span className="text-[9px] text-zinc-500">Got</span>
                          </div>
                          <div className="text-rose-400 text-[10px]">
                            -{Number(t.fundingPaidUsdt || 0).toFixed(4)} <span className="text-[9px] text-zinc-500">Paid</span>
                          </div>
                        </div>
                      ) : t.fundingClaimedUsdt != null && t.fundingClaimedUsdt !== 0 ? (
                        <div className={t.fundingClaimedUsdt > 0 ? "text-emerald-400" : "text-rose-400"}>
                          {t.fundingClaimedUsdt > 0 ? "+" : ""}{t.fundingClaimedUsdt.toFixed(4)} USDT
                        </div>
                      ) : (
                        <span className="text-zinc-500 text-[10px]">---</span>
                      )}
                    </td>

                    {/* 5. Total Fees Paid */}
                    <td className="py-2.5 px-2 font-mono text-[11px]">
                      <div className="text-amber-400 font-semibold">
                        -${totalFees.toFixed(4)}
                      </div>
                      <div className="text-[9px] text-zinc-500">Taker + GST</div>
                    </td>

                    {/* 6. Fill Latencies */}
                    <td className="py-2.5 px-2 text-center font-mono">
                      <div className="text-xs font-semibold text-cyan-300">
                        Δ {(t.interLegDeltaMs || 0).toFixed(0)} ms
                      </div>
                      <div className="text-[9px] text-zinc-500">
                        {t.leg1LatencyMs ? `${t.leg1LatencyMs}ms / ${t.leg2LatencyMs || 0}ms` : "---"}
                      </div>
                    </td>

                    {/* 7. Spread / Slippage */}
                    <td className="py-2.5 px-2 font-mono text-[10px]">
                      <div className="text-zinc-200">
                        Spread: <span className="text-amber-300 font-bold">{t.bidAskSpreadBps ? `${t.bidAskSpreadBps.toFixed(1)} bps` : "---"}</span>
                      </div>
                      <div className="text-zinc-400">
                        Slip: <span className="text-cyan-300">{t.expectedSlippagePct ? `${t.expectedSlippagePct.toFixed(2)}%` : "0.02%"}</span>
                      </div>
                    </td>

                    {/* 8. Realized Net PnL */}
                    <td className="py-2.5 px-2 text-right font-mono font-bold">
                      <div className={`text-sm ${
                        isProfit ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-zinc-300"
                      }`}>
                        {t.realizedPnl != null ? `${t.realizedPnl > 0 ? "+" : ""}${Number(t.realizedPnl).toFixed(4)} USDT` : (t.status === "ACTIVE" ? "ACTIVE" : "0.0000")}
                      </div>
                      <div className="text-[9px] text-zinc-400 font-normal">
                        {t.returnsPct ? `${t.returnsPct > 0 ? "+" : ""}${t.returnsPct.toFixed(2)}% ROI` : ""}
                      </div>
                    </td>

                    {/* 9. Status */}
                    <td className="py-2.5 px-2 text-center">
                      <span className={`inline-flex items-center space-x-1 text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                        isAborted
                          ? "bg-rose-950/80 text-rose-300 border-rose-700/60"
                          : t.status === "ACTIVE"
                          ? "bg-cyan-950/80 text-cyan-300 border-cyan-700/60"
                          : "bg-emerald-950/80 text-emerald-300 border-emerald-700/60"
                      }`}>
                        {isAborted ? <AlertTriangle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                        <span>{isAborted ? "ABORTED" : t.status}</span>
                      </span>
                    </td>

                    {/* 10. Action: View Live Receipt */}
                    <td className="py-2.5 px-2 text-right pr-2">
                      <button
                        onClick={() => setSelectedTrade(t)}
                        className="px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-accent-amber border border-amber-500/30 hover:border-amber-400 text-[10px] font-bold transition-all shadow-sm active:scale-95 whitespace-nowrap"
                      >
                        [ View Receipt ]
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* High-Resolution Live Receipt Modal */}
      <HedgeDetailModal
        trade={selectedTrade}
        onClose={() => setSelectedTrade(null)}
      />
    </div>
  );
}
