"use client";

import React, { useState } from "react";
import { ShieldCheck, Zap, Loader2, Info, Wallet, ChevronDown, ChevronUp, RotateCcw, Flame } from "lucide-react";

interface Position {
  venue?: string;
  symbol: string;
  amount: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  isPaper?: boolean;
  size?: number;
  side?: string;
  unrealisedPnl?: number;
}

interface PositionsTableProps {
  positions: Position[];
  currentSymbol?: string;
  liveBinancePrice?: number;
  liveBitgetPrice?: number;
  onClosePosition?: (symbol?: string) => void;
  tradingMode?: "paper" | "testnet" | "mainnet";
  paperWallet?: {
    totalBalance: number;
    availableBalance: number;
    lockedMargin: number;
    unrealizedPnl: number;
    realizedPnl: number;
    totalFeesPaid: number;
  } | null;
  onResetPaperWallet?: () => void;
}

export default function PositionsTable({
  positions = [],
  currentSymbol,
  liveBinancePrice,
  liveBitgetPrice,
  onClosePosition,
  tradingMode = "paper",
  paperWallet = null,
  onResetPaperWallet,
}: PositionsTableProps) {
  const [closingTarget, setClosingTarget] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);

  const safePositions = Array.isArray(positions) ? positions.filter(Boolean) : [];

  const enrichedPositions = safePositions.map((pos) => {
    const rawAmt = typeof pos.amount === "number" && !isNaN(pos.amount)
      ? pos.amount
      : typeof pos.size === "number" && !isNaN(pos.size)
      ? (pos.side === "Sell" ? -Math.abs(pos.size) : Math.abs(pos.size))
      : 0;
    const isLong = rawAmt > 0;
    const entryPrice = parseFloat(String(pos.entryPrice || 0)) || 0;
    const markPrice = parseFloat(String(pos.markPrice || entryPrice)) || entryPrice;
    let unrealizedPnl = parseFloat(String(pos.unrealizedPnl ?? pos.unrealisedPnl ?? 0)) || 0;
    const matchesCurrentAsset = Boolean(currentSymbol && pos.symbol === currentSymbol);
    const rawLivePrice = (pos.venue === "Bitget" ? liveBitgetPrice : liveBinancePrice) || 0;
    const baselinePrice = pos.markPrice || pos.entryPrice || 0;
    
    // Plausibility check: live price must be > 0 and within 20% of baseline price
    const isPricePlausible = Boolean(
      rawLivePrice > 0 &&
      baselinePrice > 0 &&
      Math.abs(rawLivePrice - baselinePrice) / baselinePrice < 0.20
    );

    const venueMarkPrice = (matchesCurrentAsset && isPricePlausible)
      ? rawLivePrice
      : baselinePrice;

    // Fallback: If unrealizedPnl is 0/missing but venueMarkPrice and entryPrice differ, dynamically compute PnL
    if (unrealizedPnl === 0 && entryPrice > 0 && venueMarkPrice > 0 && rawAmt !== 0 && venueMarkPrice !== entryPrice) {
      unrealizedPnl = (venueMarkPrice - entryPrice) * rawAmt;
    }

    const dynamicPnl = (matchesCurrentAsset && isPricePlausible && rawAmt !== 0 && entryPrice > 0)
      ? (venueMarkPrice - entryPrice) * rawAmt
      : unrealizedPnl;

    const isProfit = dynamicPnl >= 0;
    const notional = entryPrice * Math.abs(rawAmt);
    const leverage = pos.leverage || 20;
    const initialMargin = notional / leverage;
    const roePct = initialMargin > 0 ? (dynamicPnl / initialMargin) * 100 : 0;

    // Estimated liquidation distance
    const estLiqPrice = isLong
      ? pos.entryPrice * (1 - (1 / leverage) * 0.9)
      : pos.entryPrice * (1 + (1 / leverage) * 0.9);
    const liqBufferPct = venueMarkPrice > 0
      ? (Math.abs(venueMarkPrice - estLiqPrice) / venueMarkPrice) * 100
      : 5.0;

    const assetSymbol = String(pos.symbol || "").replace("USDT", "");

    return {
      ...pos,
      amount: rawAmt,
      isLong,
      assetSymbol,
      venueMarkPrice,
      dynamicPnl,
      isProfit,
      notional,
      leverage,
      initialMargin,
      roePct,
      estLiqPrice,
      liqBufferPct,
    };
  });

  const totalDynamicPnl = enrichedPositions.reduce((acc, p) => acc + (p.dynamicPnl || 0), 0);
  const totalExchangeMarkPnl = positions.reduce((acc, p) => acc + (p.unrealizedPnl || 0), 0);

  const longNotional = enrichedPositions
    .filter((p) => p.isLong)
    .reduce((acc, p) => acc + p.notional, 0);
  const shortNotional = enrichedPositions
    .filter((p) => !p.isLong)
    .reduce((acc, p) => acc + p.notional, 0);
  const notionalImbalance = Math.abs(longNotional - shortNotional);

  const handleClose = async (symbol?: string) => {
    const target = symbol || "ALL";
    setClosingTarget(target);
    try {
      await onClosePosition?.(symbol);
    } finally {
      setClosingTarget(null);
    }
  };

  const handleResetWallet = async () => {
    if (!onResetPaperWallet) return;
    setIsResetting(true);
    try {
      await onResetPaperWallet();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-3.5 sm:p-5 font-mono transition-all duration-300">
      {/* Paper Wallet Header Dashboard Card (Displayed in Paper Mode) */}
      {tradingMode === "paper" && paperWallet && (
        <div className="mb-4 p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-900/30 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-white uppercase tracking-wider text-xs flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                VIRTUAL PAPER WALLET
              </span>
              <span className="text-[10px] px-1.5 py-0.2 bg-emerald-900/60 border border-emerald-700/60 rounded text-emerald-300">
                Simulation Engine
              </span>
            </div>
            {onResetPaperWallet && (
              <button
                onClick={handleResetWallet}
                disabled={isResetting}
                className="px-2.5 py-1 text-[11px] rounded bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                title="Reset paper wallet balance back to initial $10,000.00 USDT"
              >
                <RotateCcw className={`w-3 h-3 ${isResetting ? "animate-spin" : ""}`} />
                <span>Reset $10,000 Wallet</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-zinc-500 block text-[9px] uppercase">Total Equity</span>
              <span className="font-bold text-white text-xs">
                ${paperWallet.totalBalance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-zinc-500 block text-[9px] uppercase">Available</span>
              <span className="font-bold text-emerald-400 text-xs">
                ${paperWallet.availableBalance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-zinc-500 block text-[9px] uppercase">Margin In Use</span>
              <span className="font-semibold text-amber-300 text-xs">
                ${paperWallet.lockedMargin?.toFixed(2)}
              </span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-zinc-500 block text-[9px] uppercase">Unrealized PnL</span>
              <span className={`font-bold text-xs ${paperWallet.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {paperWallet.unrealizedPnl >= 0 ? "+" : ""}${paperWallet.unrealizedPnl?.toFixed(4)}
              </span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-zinc-500 block text-[9px] uppercase">Realized PnL</span>
              <span className={`font-bold text-xs ${paperWallet.realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {paperWallet.realizedPnl >= 0 ? "+" : ""}${paperWallet.realizedPnl?.toFixed(4)}
              </span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
              <span className="text-zinc-500 block text-[9px] uppercase">Trading Fees</span>
              <span className="font-semibold text-zinc-400 text-xs">
                -${paperWallet.totalFeesPaid?.toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Position Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-border pb-3 mb-4 gap-2">
        <div className="flex items-center space-x-2">
          <span className={`w-2.5 h-2.5 rounded-full ${tradingMode === "mainnet" ? "bg-rose-500 animate-ping" : "bg-accent-emerald animate-pulse"}`} />
          <h2 className="text-sm font-semibold text-zinc-100 tracking-wide uppercase">
            {tradingMode === "paper" ? "PAPER POSITIONS" : tradingMode === "mainnet" ? "LIVE MAINNET POSITIONS" : "TESTNET POSITIONS"}
          </h2>
          {isCollapsed && positions.length > 0 && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ${
                totalDynamicPnl >= 0
                  ? "bg-emerald-500/10 text-accent-emerald border-emerald-500/30"
                  : "bg-rose-500/10 text-accent-rose border-rose-500/30"
              }`}
            >
              {totalDynamicPnl >= 0 ? "+" : ""}{totalDynamicPnl.toFixed(4)} USDT
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2 text-[10px] text-zinc-400">
          <span>Active: <strong className="text-zinc-200">{positions.length}</strong></span>
          {positions.length > 0 && (
            <>
              <span className="px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                DELTA NEUTRAL
              </span>
              <button
                onClick={() => handleClose("ALL")}
                disabled={closingTarget !== null}
                className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 font-semibold transition-colors flex items-center gap-1"
                title="Emergency close all open legs simultaneously"
              >
                {closingTarget === "ALL" ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                    <span>FLATTENING...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3 h-3 text-rose-400" />
                    <span>FLATTEN ALL</span>
                  </>
                )}
              </button>
            </>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors ml-1"
            title={isCollapsed ? "Expand Positions Panel" : "Collapse Positions Panel"}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isCollapsed ? "grid-rows-[0fr] opacity-0 pointer-events-none" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          {positions.length > 0 && (
            <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 text-xs bg-zinc-950/70 p-3 rounded-xl border border-zinc-800">
              <div>
                <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase">
                  <span>LIVE COMBINED PnL</span>
                  <span className="text-[9px] text-zinc-400 font-normal">TICKER-BASED</span>
                </div>
                <div className={`text-base font-bold font-mono mt-0.5 ${totalDynamicPnl >= 0 ? "text-accent-emerald" : "text-accent-rose"}`}>
                  {totalDynamicPnl >= 0 ? "+" : ""}{totalDynamicPnl.toFixed(4)} USDT
                </div>
                <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                  <span className="text-zinc-500">Exchange MTM Basis:</span>
                  <span className={`font-mono font-medium ${totalExchangeMarkPnl >= 0 ? "text-emerald-400" : "text-zinc-300"}`}>
                    {totalExchangeMarkPnl >= 0 ? "+" : ""}{totalExchangeMarkPnl.toFixed(4)} USDT
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[10px] text-zinc-500 uppercase">NOTIONAL BALANCE (LONG vs SHORT)</div>
                <div className="text-xs text-zinc-300 font-mono mt-0.5">
                  Long: ${longNotional.toFixed(2)} | Short: ${shortNotional.toFixed(2)}
                </div>
                <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                  <span className="text-zinc-500">Imbalance Delta:</span>
                  <span className={`font-mono font-medium ${notionalImbalance < 5 ? "text-emerald-400" : "text-amber-400"}`}>
                    ${notionalImbalance.toFixed(2)} USDT
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                  <Wallet className="w-3 h-3 text-accent-cyan" />
                  <span>FUNDING YIELD HARVEST</span>
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5 leading-tight">
                  Delta-neutral hedge. Funding fees are credited directly into <strong className="text-zinc-200">Cash Wallet Balance</strong> at 00:00, 08:00, 16:00 UTC (not position unrealized PnL).
                </div>
              </div>
            </div>
          )}

          {positions.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              {tradingMode === "paper"
                ? "No open paper positions. Select any coin from the 453-market scanner below and click 'QUICK HEDGE' to simulate a trade!"
                : "No open positions detected on Binance Futures or Bitget UTA."}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1 sm:mx-0 px-1 sm:px-0">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] text-zinc-400 uppercase">
                    <th className="pb-2">Symbol / Venue</th>
                    <th className="pb-2">Size</th>
                    <th className="pb-2">Entry Price</th>
                    <th className="pb-2">Mark Price</th>
                    <th className="pb-2">Dynamic PnL (4D)</th>
                    <th className="pb-2">Liq. Buffer</th>
                    <th className="pb-2">Leverage</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y border-border">
                  {enrichedPositions.map((pos) => {
                    const isProfit = pos.isProfit;

                    return (
                      <tr key={`${pos.venue || "pos"}-${pos.symbol}-${pos.amount}`} className="text-zinc-200">
                        <td className="py-2.5 font-bold flex items-center space-x-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${pos.isLong ? "bg-accent-emerald" : "bg-accent-rose"}`} />
                          <span>{pos.symbol}</span>
                          {pos.isPaper || tradingMode === "paper" ? (
                            <span className="text-[9px] px-1 py-0.5 rounded font-normal bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                              Paper {pos.venue || ""}
                            </span>
                          ) : pos.venue ? (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap ${
                              pos.venue === "Binance"
                                ? "bg-amber-950/60 text-accent-amber border border-amber-800/60"
                                : pos.venue === "CoinDCX"
                                ? "bg-purple-950/60 text-purple-400 border border-purple-800/60"
                                : pos.venue === "Bitget"
                                ? "bg-blue-950/60 text-blue-400 border border-blue-800/60"
                                : "bg-cyan-950/60 text-accent-cyan border border-cyan-800/60"
                            }`}>
                              {pos.venue}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5">
                          <span className={pos.isLong ? "text-accent-emerald font-semibold" : "text-accent-rose font-semibold"}>
                            {pos.isLong ? "+" : ""}{pos.amount} {pos.assetSymbol}
                          </span>
                          <div className="text-[10px] text-zinc-500 font-normal">
                            ${pos.notional.toFixed(2)} Notional
                          </div>
                        </td>
                        <td className="py-2.5">${pos.entryPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="py-2.5">
                          <div className="flex items-center space-x-1.5">
                            <span>${pos.venueMarkPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                              LIVE
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5">
                          <div className="flex flex-col">
                            <span className={`font-bold ${isProfit ? "text-accent-emerald" : "text-accent-rose"}`}>
                              {isProfit ? "+" : ""}{pos.dynamicPnl?.toFixed(4)} USDT
                            </span>
                            <span className={`text-[10px] ${pos.roePct >= 0 ? "text-accent-emerald" : "text-accent-rose"}`}>
                              ({pos.roePct >= 0 ? "+" : ""}{pos.roePct?.toFixed(2)}% ROE)
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5">
                          <span className={`text-[11px] font-semibold ${pos.liqBufferPct > 3 ? "text-emerald-400" : "text-amber-400"}`}>
                            +{pos.liqBufferPct.toFixed(1)}%
                          </span>
                          <div className="text-[9px] text-zinc-500">
                            Liq ~${pos.estLiqPrice.toFixed(1)}
                          </div>
                        </td>
                        <td className="py-2.5">{pos.leverage}x</td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => handleClose(pos.symbol)}
                            disabled={closingTarget !== null}
                            className="px-2.5 py-1 text-[10px] font-semibold rounded bg-zinc-800 hover:bg-rose-950/80 hover:text-rose-300 hover:border-rose-700 text-zinc-300 border border-zinc-700 transition-colors inline-flex items-center gap-1"
                            title={`Flatten ${pos.symbol}`}
                          >
                            {closingTarget === pos.symbol ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                                <span>Flattening...</span>
                              </>
                            ) : (
                              <>
                                <Zap className="w-2.5 h-2.5 text-accent-amber" />
                                <span>Flatten {pos.assetSymbol}</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
