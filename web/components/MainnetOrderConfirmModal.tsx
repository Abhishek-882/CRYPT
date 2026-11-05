"use client";

import React from "react";
import { AlertTriangle, ShieldCheck, Flame, X, ArrowRight } from "lucide-react";

interface MainnetOrderConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  symbol: string;
  direction: "STANDARD_CARRY" | "REVERSE_CARRY";
  quantity: string | number;
  notionalUsdt: number;
  binancePrice: number;
  bitgetPrice: number;
  spreadBps: number;
  leverage: number;
  isExecuting?: boolean;
}

export default function MainnetOrderConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  symbol,
  direction,
  quantity,
  notionalUsdt,
  binancePrice,
  bitgetPrice,
  spreadBps,
  leverage,
  isExecuting = false,
}: MainnetOrderConfirmModalProps) {
  if (!isOpen) return null;

  const bnSide = direction === "STANDARD_CARRY" ? "SELL (SHORT)" : "BUY (LONG)";
  const bgSide = direction === "STANDARD_CARRY" ? "BUY (LONG)" : "SELL (SHORT)";

  const marginPerLeg = notionalUsdt / Math.max(1, leverage);
  const totalMarginRequired = marginPerLeg * 2;
  const estimatedFees = notionalUsdt * (0.0005 + 0.0006); // BN 0.05% + BG 0.06%

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="max-w-md w-full bg-slate-900 border-2 border-rose-600 rounded-xl p-6 shadow-2xl space-y-4 text-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rose-900/40 pb-3">
          <div className="flex items-center gap-2.5 text-rose-400">
            <div className="p-2 bg-rose-950/80 border border-rose-700 rounded-lg">
              <Flame className="w-5 h-5 text-rose-400 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">LIVE MAINNET TRADE CONFIRMATION</h3>
              <p className="text-[11px] text-rose-300 font-mono">REAL CAPITAL DISPATCH</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning Banner */}
        <div className="p-2.5 bg-rose-950/50 border border-rose-800/60 rounded-lg flex items-start gap-2 text-rose-200 text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>
            You are placing real market orders on live exchanges. Verify parameters before confirming.
          </span>
        </div>

        {/* Order Breakdown Grid */}
        <div className="space-y-2.5 text-xs bg-slate-950/80 p-3.5 rounded-lg border border-slate-800 font-mono">
          <div className="flex justify-between items-center pb-2 border-b border-slate-800/80">
            <span className="text-slate-400">Target Asset:</span>
            <span className="font-bold text-sm text-cyan-400">{symbol}</span>
          </div>

          {/* Leg Breakdown */}
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between items-center p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-amber-400 font-semibold">Leg 1 (Binance):</span>
              <span className="text-right">
                <span className={bnSide.includes("SELL") ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                  {bnSide}
                </span>{" "}
                <span className="text-slate-300">{quantity} (~${binancePrice.toFixed(2)})</span>
              </span>
            </div>

            <div className="flex justify-between items-center p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-sky-400 font-semibold">Leg 2 (Bitget):</span>
              <span className="text-right">
                <span className={bgSide.includes("SELL") ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                  {bgSide}
                </span>{" "}
                <span className="text-slate-300">{quantity} (~${bitgetPrice.toFixed(2)})</span>
              </span>
            </div>
          </div>

          {/* Sizing & Risk Details */}
          <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Order Notional:</span>
              <span className="font-bold text-white">${notionalUsdt.toFixed(2)} USDT</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Margin Required:</span>
              <span className="text-amber-300 font-semibold">${totalMarginRequired.toFixed(2)} USDT ({leverage}x)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Current Spread:</span>
              <span className="text-emerald-400 font-semibold">+{spreadBps.toFixed(1)} bps</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Est. Roundtrip Fees:</span>
              <span className="text-slate-300">~${estimatedFees.toFixed(3)} USDT</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isExecuting}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.5)] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Dispatching Live Orders...
              </>
            ) : (
              <>
                <Flame className="w-3.5 h-3.5" />
                FIRE LIVE MAINNET HEDGE
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
