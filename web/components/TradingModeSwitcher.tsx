"use client";

import React, { useState } from "react";
import { ShieldCheck, AlertTriangle, Zap, Lock, Unlock, Check, X } from "lucide-react";

export type TradingMode = "paper" | "testnet" | "mainnet";

interface TradingModeSwitcherProps {
  currentMode: TradingMode;
  onModeChange: (mode: TradingMode) => void;
  isMainnetArmed: boolean;
  onMainnetArmedChange: (armed: boolean) => void;
}

export default function TradingModeSwitcher({
  currentMode,
  onModeChange,
  isMainnetArmed,
  onMainnetArmedChange,
}: TradingModeSwitcherProps) {
  const [showArmingModal, setShowArmingModal] = useState(false);

  const handleSelectMode = (mode: TradingMode) => {
    if (mode === "mainnet") {
      if (!isMainnetArmed) {
        setShowArmingModal(true);
        return;
      }
      onModeChange("mainnet");
    } else {
      onModeChange(mode);
    }
  };

  const handleConfirmArmMainnet = () => {
    onMainnetArmedChange(true);
    onModeChange("mainnet");
    setShowArmingModal(false);
  };

  const handleDisarmMainnet = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMainnetArmedChange(!isMainnetArmed);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-lg backdrop-blur-md shadow-inner text-xs font-semibold select-none">
        {/* Live Mainnet (Primary & Default) */}
        <button
          onClick={() => handleSelectMode("mainnet")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
            currentMode === "mainnet"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/60 shadow-[0_0_14px_rgba(16,185,129,0.3)]"
              : "text-emerald-400/80 hover:text-emerald-300 hover:bg-emerald-950/30"
          }`}
          title="Live Mainnet Execution: Real Capital across CoinDCX, Bybit, Binance & Bitget"
        >
          {isMainnetArmed ? (
            <Unlock className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Lock className="w-3.5 h-3.5 text-slate-500" />
          )}
          <span className="font-bold">Live Mainnet</span>
          {isMainnetArmed ? (
            <span className="text-[9px] px-1.5 py-0.2 bg-emerald-950 border border-emerald-600 rounded text-emerald-200 font-bold uppercase tracking-wider">
              Armed
            </span>
          ) : (
            <span className="text-[9px] px-1.5 py-0.2 bg-slate-800 border border-slate-700 rounded text-slate-400 font-medium">
              Locked
            </span>
          )}
        </button>

        {/* Paper Mode (Shutdown/Off by default) */}
        <button
          onClick={() => handleSelectMode("paper")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
            currentMode === "paper"
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-[0_0_12px_rgba(59,130,246,0.3)]"
              : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 opacity-70 hover:opacity-100"
          }`}
          title="Simulated Paper Trading (Virtual $10,000 Wallet) — Off by Default"
        >
          <span className={`w-2 h-2 rounded-full ${currentMode === "paper" ? "bg-blue-400 animate-pulse" : "bg-slate-600"}`} />
          <span>Paper Mode</span>
          <span className="text-[10px] px-1 py-0.2 bg-slate-900 border border-slate-700/60 rounded text-slate-400">
            {currentMode === "paper" ? "Active" : "Off"}
          </span>
        </button>

        {/* Testnet Sandbox (Shutdown/Off by default) */}
        <button
          onClick={() => handleSelectMode("testnet")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
            currentMode === "testnet"
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
              : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 opacity-70 hover:opacity-100"
          }`}
          title="Binance Testnet & Bitget Demo Sandbox — Off by Default"
        >
          <span className={`w-2 h-2 rounded-full ${currentMode === "testnet" ? "bg-amber-400 animate-pulse" : "bg-slate-600"}`} />
          <span>Testnet Sandbox</span>
          <span className="text-[10px] px-1 py-0.2 bg-slate-900 border border-slate-700/60 rounded text-slate-400">
            {currentMode === "testnet" ? "Active" : "Off"}
          </span>
        </button>
      </div>

      {/* Arming Confirmation Modal */}
      {showArmingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="max-w-md w-full bg-slate-900 border-2 border-rose-600/60 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-3 bg-rose-950/60 border border-rose-700 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-rose-400 animate-bounce" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Arm Live Mainnet Execution</h3>
                <p className="text-xs text-rose-300/80 font-mono">REAL CAPITAL RISK ACKNOWLEDGMENT</p>
              </div>
            </div>

            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-xs space-y-2 text-slate-300 leading-relaxed">
              <p>
                You are about to switch to <strong className="text-rose-400">LIVE MAINNET</strong>.
                Orders placed in this mode will be dispatched directly to:
              </p>
              <ul className="list-disc pl-4 space-y-1 font-mono text-slate-400 text-[11px]">
                <li><span className="text-amber-400">Binance Futures</span> (<code className="text-slate-300">fapi.binance.com</code>)</li>
                <li><span className="text-sky-400">Bitget UTA V3</span> (<code className="text-slate-300">api.bitget.com</code> live)</li>
              </ul>
              <div className="p-2 bg-rose-950/40 border border-rose-800/40 rounded text-rose-200 text-[11px]">
                🛡️ <strong>Safety Safeguards Active:</strong>
                <ul className="list-disc pl-3 mt-1 space-y-0.5">
                  <li>Maximum order notional hard cap: <strong>$250.00 USDT</strong></li>
                  <li>Minimum order notional: <strong>$15.00 USDT</strong></li>
                  <li>Leverage restricted to conservative bounds (max 5x)</li>
                  <li>Atomic auto-unwind circuit breaker on counter-leg rejection</li>
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowArmingModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Cancel (Keep Paper Mode)
              </button>
              <button
                type="button"
                onClick={handleConfirmArmMainnet}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.4)] transition-all flex items-center gap-1.5"
              >
                <Unlock className="w-3.5 h-3.5" />
                I Understand, Arm Mainnet
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
