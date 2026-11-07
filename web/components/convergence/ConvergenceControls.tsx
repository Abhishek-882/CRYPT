"use client";

import React, { useState } from "react";
import {
  Play,
  Pause,
  AlertOctagon,
  Settings,
  RotateCcw,
  CheckCircle2,
  Sliders,
  ShieldAlert,
  Zap,
  X,
  RefreshCw,
} from "lucide-react";
import { StatArbConfig } from "@/lib/statarb";

export interface ConvergenceControlsProps {
  isRunning: boolean;
  isKillSwitchEngaged: boolean;
  config?: StatArbConfig;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onKillSwitch: () => Promise<void>;
  onUpdateConfig: (config: Partial<StatArbConfig>) => Promise<void>;
  onClearQuarantine?: () => Promise<void>;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export default function ConvergenceControls({
  isRunning,
  isKillSwitchEngaged,
  config,
  onStart,
  onStop,
  onKillSwitch,
  onUpdateConfig,
  onClearQuarantine,
  onRefresh,
  isRefreshing = false,
}: ConvergenceControlsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isKillConfirmOpen, setIsKillConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearSuccess, setClearSuccess] = useState(false);

  // Form local state initialized from config
  const [minZScore, setMinZScore] = useState<number>(config?.entryGate?.minZScore ?? 2.2);
  const [minGrossBasisBps, setMinGrossBasisBps] = useState<number>(config?.entryGate?.minGrossBasisBps ?? 28.0);
  const [minDepthRatio, setMinDepthRatio] = useState<number>(config?.entryGate?.minDepthRatio ?? 4.0);
  const [maxSpreadBps, setMaxSpreadBps] = useState<number>(config?.entryGate?.maxSpreadBps ?? 8.0);
  const [minNetEdgeBps, setMinNetEdgeBps] = useState<number>(config?.entryGate?.minNetEdgeBps ?? 8.0);
  const [minNetProfitUsdt, setMinNetProfitUsdt] = useState<number>(config?.minNetProfitUsdt ?? 0.01);
  const [exitConvergenceCompression, setExitConvergenceCompression] = useState<number>(
    config?.exitConvergenceCompression ? config.exitConvergenceCompression * 100 : 75
  );
  const [exitZScoreThreshold, setExitZScoreThreshold] = useState<number>(config?.exitZScoreThreshold ?? 0.35);
  const [orderNotionalUsdt, setOrderNotionalUsdt] = useState<number>(config?.orderNotionalUsdt ?? 15.0);
  const [invariant6Enabled, setInvariant6Enabled] = useState<boolean>(true);
  const [invariant7Enabled, setInvariant7Enabled] = useState<boolean>(true);

  // Sync state when config changes
  React.useEffect(() => {
    if (config) {
      setMinZScore(config.entryGate?.minZScore ?? 2.2);
      setMinGrossBasisBps(config.entryGate?.minGrossBasisBps ?? 28.0);
      setMinDepthRatio(config.entryGate?.minDepthRatio ?? 4.0);
      setMaxSpreadBps(config.entryGate?.maxSpreadBps ?? 8.0);
      setMinNetEdgeBps(config.entryGate?.minNetEdgeBps ?? 8.0);
      setMinNetProfitUsdt(config.minNetProfitUsdt ?? 0.01);
      setExitConvergenceCompression(
        config.exitConvergenceCompression ? config.exitConvergenceCompression * 100 : 75
      );
      setExitZScoreThreshold(config.exitZScoreThreshold ?? 0.35);
      setOrderNotionalUsdt(config.orderNotionalUsdt ?? 15.0);
      setInvariant6Enabled(config.invariant6Enabled !== false);
      setInvariant7Enabled(config.invariant7Enabled !== false);
    }
  }, [config]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onUpdateConfig({
        entryGate: {
          minZScore: Number(minZScore),
          minGrossBasisBps: Number(minGrossBasisBps),
          minDepthRatio: Number(minDepthRatio),
          maxSpreadBps: Number(maxSpreadBps),
          minNetEdgeBps: Number(minNetEdgeBps),
        },
        minNetProfitUsdt: Number(minNetProfitUsdt),
        exitConvergenceCompression: Number(exitConvergenceCompression) / 100,
        exitZScoreThreshold: Number(exitZScoreThreshold),
        orderNotionalUsdt: Number(orderNotionalUsdt),
        invariant6Enabled: Boolean(invariant6Enabled),
        invariant7Enabled: Boolean(invariant7Enabled),
      });
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setIsModalOpen(false);
      }, 900);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDefaults = () => {
    setMinZScore(2.2);
    setMinGrossBasisBps(28.0);
    setMinDepthRatio(4.0);
    setMaxSpreadBps(8.0);
    setMinNetEdgeBps(8.0);
    setMinNetProfitUsdt(0.01);
    setExitConvergenceCompression(75);
    setExitZScoreThreshold(0.35);
    setOrderNotionalUsdt(15.0);
    setInvariant6Enabled(true);
    setInvariant7Enabled(true);
  };

  return (
    <>
      {/* Primary Action Button Bar */}
      <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-3 sm:p-4 shadow-lg shadow-black/40 flex flex-wrap items-center justify-between gap-3 font-mono">
        {/* Left: Engine Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Start Button */}
          <button
            onClick={onStart}
            disabled={isRunning || isSubmitting}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm ${
              isRunning
                ? "bg-zinc-800/60 text-zinc-500 border border-zinc-700/40 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-500 text-zinc-950 border border-emerald-400 active:scale-95 shadow-emerald-500/20"
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>START ENGINE</span>
          </button>

          {/* Pause Button */}
          <button
            onClick={onStop}
            disabled={!isRunning || isSubmitting}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm ${
              !isRunning
                ? "bg-zinc-800/60 text-zinc-500 border border-zinc-700/40 cursor-not-allowed"
                : "bg-amber-500 hover:bg-amber-400 text-zinc-950 border border-amber-300 active:scale-95 shadow-amber-500/20"
            }`}
          >
            <Pause className="w-3.5 h-3.5 fill-current" />
            <span>PAUSE ENGINE</span>
          </button>

          {/* Emergency Kill-Switch */}
          <button
            onClick={() => setIsKillConfirmOpen(true)}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm ${
              isKillSwitchEngaged
                ? "bg-rose-950 text-rose-300 border border-rose-600 animate-pulse"
                : "bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 shadow-rose-600/30 active:scale-95"
            }`}
            title="Emergency Kill-Switch: Halt scanning and unwind active legs"
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>EMERGENCY KILL-SWITCH</span>
          </button>
        </div>

        {/* Right: Modal Settings & Refresh */}
        <div className="flex items-center space-x-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-300 text-xs transition-colors active:scale-95"
              title="Refresh Telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-accent-amber" : ""}`} />
            </button>
          )}

          {onClearQuarantine && (
            <button
              type="button"
              onClick={async () => {
                if (isClearing) return;
                setIsClearing(true);
                try {
                  await onClearQuarantine();
                  setClearSuccess(true);
                  setTimeout(() => setClearSuccess(false), 2000);
                } finally {
                  setIsClearing(false);
                }
              }}
              disabled={isClearing}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-amber-500/40 text-amber-400 hover:text-amber-300 text-xs font-semibold transition-colors active:scale-95 shadow-sm"
              title="Clear all symbol cooldowns and 60m quarantine locks"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isClearing ? "animate-spin" : ""}`} />
              <span>{clearSuccess ? "COOLDOWNS CLEARED!" : "RESET COOLDOWNS"}</span>
            </button>
          )}

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-200 text-xs font-semibold transition-colors active:scale-95"
          >
            <Settings className="w-3.5 h-3.5 text-accent-amber" />
            <span>TUNING & INVARIANTS</span>
          </button>
        </div>
      </div>

      {/* Emergency Kill Confirmation Dialog */}
      {isKillConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-mono">
          <div className="bg-[#18181c] border border-rose-500/80 rounded-2xl p-6 max-w-md w-full shadow-2xl shadow-rose-950/80 text-zinc-100">
            <div className="flex items-center space-x-3 text-rose-400 mb-4">
              <ShieldAlert className="w-8 h-8 text-rose-500 flex-shrink-0" />
              <div>
                <h3 className="text-base font-black uppercase tracking-wider text-rose-400">
                  ENGAGE EMERGENCY KILL-SWITCH?
                </h3>
                <p className="text-xs text-zinc-400">
                  Immediate strategy halt & position unwind
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed mb-6 bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
              Engaging the kill-switch will immediately cancel all pending Leg 1 Maker orders and execute emergency market IOC unwinds on all active hedging legs across Binance and Bybit.
            </p>

            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={() => setIsKillConfirmOpen(false)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold"
              >
                CANCEL
              </button>
              <button
                onClick={async () => {
                  setIsKillConfirmOpen(false);
                  await onKillSwitch();
                }}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/40"
              >
                YES, ENGAGE KILL-SWITCH
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parameter Configuration Drawer / Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm font-mono overflow-y-auto">
          <div className="bg-[#18181c] border border-zinc-700 rounded-2xl p-5 sm:p-6 max-w-xl w-full shadow-2xl shadow-black/80 text-zinc-100 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
              <div className="flex items-center space-x-2.5">
                <Sliders className="w-5 h-5 text-accent-amber" />
                <h3 className="text-sm sm:text-base font-bold text-zinc-100 uppercase tracking-wider">
                  STATARB-OU-PERP Parameter Tuning
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
              {/* Row 1: Entry Z-Score & Gross Basis Hurdle */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Entry Z-Score (|z_t| Threshold)
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.05"
                      min="1.5"
                      max="4.0"
                      value={minZScore}
                      onChange={(e) => setMinZScore(parseFloat(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-accent-amber font-bold focus:outline-none focus:border-amber-400"
                    />
                    <span className="text-zinc-500 font-bold">σ</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">Default: 2.20σ</span>
                </div>

                <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Min Gross Basis Hurdle
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.010"
                      min="0.050"
                      max="1.000"
                      value={parseFloat((minGrossBasisBps / 100).toFixed(3))}
                      onChange={(e) => setMinGrossBasisBps(parseFloat((parseFloat(e.target.value) * 100).toFixed(1)))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-cyan-400 font-bold focus:outline-none focus:border-cyan-400"
                    />
                    <span className="text-zinc-500 font-bold">%</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">Default: 0.280%</span>
                </div>
              </div>

              {/* Row 2: Book Depth Ratio & Bid-Ask Spread Cap */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Order Book Depth Cushion
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.5"
                      min="2.0"
                      max="10.0"
                      value={minDepthRatio}
                      onChange={(e) => setMinDepthRatio(parseFloat(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-emerald-400 font-bold focus:outline-none focus:border-emerald-400"
                    />
                    <span className="text-zinc-500 font-bold">x</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">Depth within 0.100% ≥ 4.0x</span>
                </div>

                <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Max Bid-Ask Spread Cap
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.005"
                      min="0.010"
                      max="0.200"
                      value={parseFloat((maxSpreadBps / 100).toFixed(3))}
                      onChange={(e) => setMaxSpreadBps(parseFloat((parseFloat(e.target.value) * 100).toFixed(1)))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 font-bold focus:outline-none focus:border-zinc-400"
                    />
                    <span className="text-zinc-500 font-bold">%</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">Max allowable spread: 0.080%</span>
                </div>
              </div>

              {/* Row 3: Gate 5 Net-Edge Hurdle & Zero-Loss Net Hurdle */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Gate 5: Min Net-Edge Hurdle
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.005"
                      min="0.010"
                      max="0.500"
                      value={parseFloat((minNetEdgeBps / 100).toFixed(3))}
                      onChange={(e) => setMinNetEdgeBps(parseFloat((parseFloat(e.target.value) * 100).toFixed(1)))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-emerald-400 font-bold focus:outline-none focus:border-emerald-400"
                    />
                    <span className="text-zinc-500 font-bold">%</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">Default: 0.080% net edge (Gross - 0.170% friction)</span>
                </div>

                <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Zero-Loss Exit Net Hurdle
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.005"
                      min="0.005"
                      max="1.0"
                      value={minNetProfitUsdt}
                      onChange={(e) => setMinNetProfitUsdt(parseFloat(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-emerald-400 font-bold focus:outline-none focus:border-emerald-400"
                    />
                    <span className="text-zinc-500 font-bold">USDT</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">Strict floor: +$0.0100 net of all fees</span>
                </div>
              </div>

              {/* Row 4: Trade Notional Per Leg */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                  <label className="block text-zinc-400 font-semibold mb-1">
                    Trade Notional Per Leg
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="1.0"
                      min="5.0"
                      max="100.0"
                      value={orderNotionalUsdt}
                      onChange={(e) => setOrderNotionalUsdt(parseFloat(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 font-bold focus:outline-none focus:border-zinc-400"
                    />
                    <span className="text-zinc-500 font-bold">USDT</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block">Default size: 15.0 USDT</span>
                </div>
              </div>

              {/* Invariant Safety Toggles */}
              <div className="bg-zinc-900/60 p-3 rounded-lg border border-zinc-800 space-y-2.5 pt-3">
                <div className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider mb-1">
                  Autonomous Invariant Protections
                </div>

                {/* Invariant 6 Toggle */}
                <label className="flex items-center justify-between cursor-pointer py-1">
                  <div>
                    <span className="text-zinc-200 font-semibold">
                      Invariant 6: 30-Min Low-Watermark Persistence Breaker
                    </span>
                    <p className="text-[10px] text-zinc-500">
                      Force-unwinds positions if divergence persists ≥1.0% for 30 continuous minutes.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={invariant6Enabled}
                    onChange={(e) => setInvariant6Enabled(e.target.checked)}
                    className="w-4 h-4 text-accent-amber rounded border-zinc-700 bg-zinc-900 focus:ring-0 cursor-pointer ml-3"
                  />
                </label>

                {/* Invariant 7 Toggle */}
                <label className="flex items-center justify-between cursor-pointer py-1 border-t border-zinc-800/80">
                  <div>
                    <span className="text-zinc-200 font-semibold">
                      Invariant 7: Upstream Sticky Decoupling Filter
                    </span>
                    <p className="text-[10px] text-zinc-500">
                      Screens out pairs that fail to touch &lt;1.0% divergence within 30 minutes.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={invariant7Enabled}
                    onChange={(e) => setInvariant7Enabled(e.target.checked)}
                    className="w-4 h-4 text-accent-amber rounded border-zinc-700 bg-zinc-900 focus:ring-0 cursor-pointer ml-3"
                  />
                </label>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors shadow-sm"
                  >
                    {saveSuccess ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Saved!</span>
                      </>
                    ) : (
                      <span>Save Parameters</span>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
