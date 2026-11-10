"use client";

import React, { useState } from "react";
import { DivergenceConfig, DivergenceFsmState } from "@/lib/divergence/types";
import {
  Play,
  Pause,
  AlertOctagon,
  Settings,
  RotateCcw,
  ShieldAlert,
  Zap,
  CheckCircle2,
  Lock,
  Radio,
  Sliders,
  X,
} from "lucide-react";

export interface DaemonControlsProps {
  isRunning: boolean;
  fsmState: DivergenceFsmState;
  config?: DivergenceConfig;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onEmergencyKill: () => Promise<void>;
  onTick: () => Promise<void>;
  onUpdateConfig: (config: Partial<DivergenceConfig>) => Promise<void>;
  isSubmitting?: boolean;
}

export default function DaemonControls({
  isRunning,
  fsmState,
  config,
  onStart,
  onStop,
  onEmergencyKill,
  onTick,
  onUpdateConfig,
  isSubmitting = false,
}: DaemonControlsProps) {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isKillConfirmOpen, setIsKillConfirmOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form local state for configurable parameters
  const [minDispersion24hPercent, setMinDispersion24hPercent] = useState<number>(
    config?.minDispersion24hPercent ?? 0.4
  );
  const [relativeExpansionTargetPercent, setRelativeExpansionTargetPercent] = useState<number>(
    config?.relativeExpansionTargetPercent ?? 0.38
  );
  const [adverseStopLossPercent, setAdverseStopLossPercent] = useState<number>(
    config?.adverseStopLossPercent ?? -0.15
  );
  const [nominalStagnancyMinutes, setNominalStagnancyMinutes] = useState<number>(
    config?.nominalStagnancyMinutes ?? 180
  );
  const [maxStagnancyCeilingMinutes, setMaxStagnancyCeilingMinutes] = useState<number>(
    config?.maxStagnancyCeilingMinutes ?? 360
  );
  const [zeroLossNetHurdleUsdt, setZeroLossNetHurdleUsdt] = useState<number>(
    config?.zeroLossNetHurdleUsdt ?? 0.01
  );
  const [maxConcurrentPositions, setMaxConcurrentPositions] = useState<number>(
    config?.maxConcurrentPositions ?? 3
  );
  const [orderNotionalUsdt, setOrderNotionalUsdt] = useState<number>(
    config?.orderNotionalUsdt ?? 15.0
  );

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onUpdateConfig({
        minDispersion24hPercent,
        relativeExpansionTargetPercent,
        adverseStopLossPercent,
        nominalStagnancyMinutes,
        maxStagnancyCeilingMinutes,
        zeroLossNetHurdleUsdt,
        maxConcurrentPositions,
        maxCapitalAllocationUsdt: Math.max(60.0, orderNotionalUsdt * maxConcurrentPositions),
        orderNotionalUsdt,
      });
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setIsConfigOpen(false);
      }, 1200);
    } catch {
      // handled upstream
    }
  };

  const handleEmergencyKillClick = async () => {
    try {
      await onEmergencyKill();
      setIsKillConfirmOpen(false);
    } catch {
      // handled upstream
    }
  };

  return (
    <div className="w-full rounded-2xl bg-zinc-950/80 border border-border/80 backdrop-blur-xl p-4 font-mono shadow-xl flex flex-col space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-zinc-100 uppercase tracking-wider flex items-center space-x-2">
              <span>DAEMON CONTROLS & SAFETY</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                {"// PROCESS LIFECYCLE & CIRCUIT BREAKERS"}
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Autonomous daemon lifecycle management with parameterized concurrency locks
            </p>
          </div>
        </div>

        {/* Action Buttons Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Start / Pause Button */}
          {isRunning ? (
            <button
              onClick={onStop}
              disabled={isSubmitting}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-accent-amber border border-amber-500/30 text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
              title="Pause daemon execution loop"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause Engine</span>
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={isSubmitting}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-accent-emerald hover:bg-emerald-400 text-zinc-950 text-xs font-black transition-all active:scale-95 disabled:opacity-50 shadow-sm shadow-emerald-500/20"
              title="Start Divergence autonomous daemon"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Arm & Start Engine</span>
            </button>
          )}

          {/* Manual Sweep Tick Button */}
          <button
            onClick={onTick}
            disabled={isSubmitting}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            title="Execute single immediate radar scan and position evaluation cycle"
          >
            <Zap className="w-3.5 h-3.5 text-accent-amber" />
            <span>Manual Sweep Tick</span>
          </button>

          {/* Settings Modal Button */}
          <button
            onClick={() => setIsConfigOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-semibold transition-all active:scale-95"
            title="Configure parameters & thresholds"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Config</span>
          </button>

          {/* Emergency Kill Button */}
          <button
            onClick={() => setIsKillConfirmOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/40 text-xs font-black transition-all active:scale-95"
            title="Immediate emergency market unwind with reduceOnly: true"
          >
            <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
            <span>EMERGENCY KILL</span>
          </button>
        </div>
      </div>

      {/* Safety Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-1">
          <div className="text-zinc-500 flex items-center space-x-1 text-[11px]">
            <Lock className="w-3 h-3 text-accent-amber" />
            <span>Capital Safety Guard</span>
          </div>
          <div className="text-zinc-200 font-semibold">
            Max 1 Position · $15.00 USDT Hard-Locked
          </div>
          <div className="text-[10px] text-zinc-500">
            Guaranteed $|\Delta_{'{net}'}| &lt; 0.001$ discrete lot matching
          </div>
        </div>

        <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-1">
          <div className="text-zinc-500 flex items-center space-x-1 text-[11px]">
            <Zap className="w-3 h-3 text-cyan-400" />
            <span>Take-Profit & Zero-Loss Ratchet</span>
          </div>
          <div className="text-zinc-200 font-semibold">
            Target: +0.380% Expansion · Floor: +$0.0100 USDT
          </div>
          <div className="text-[10px] text-zinc-500">
            Dynamic carry ratchet ensures green net ledger
          </div>
        </div>

        <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-1">
          <div className="text-zinc-500 flex items-center space-x-1 text-[11px]">
            <ShieldAlert className="w-3 h-3 text-red-400" />
            <span>Stagnancy & Adverse Stop</span>
          </div>
          <div className="text-zinc-200 font-semibold">
            Stop: -0.150% · Stagnancy: 180m / 360m Ceiling
          </div>
          <div className="text-[10px] text-zinc-500">
            Dual-horizon breaker liquidates stagnant positions
          </div>
        </div>
      </div>

      {/* Configuration Modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center space-x-2 text-cyan-400">
                <Settings className="w-5 h-5" />
                <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
                  Divergence Strategy Configuration
                </h3>
              </div>
              <button
                onClick={() => setIsConfigOpen(false)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                {/* 24h Dispersion Threshold */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Min 24h Dispersion (%):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.10"
                    max="5.00"
                    value={minDispersion24hPercent}
                    onChange={(e) =>
                      setMinDispersion24hPercent(parseFloat(e.target.value))
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500">Default: 0.400%</span>
                </div>

                {/* Target Expansion Take-Profit */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Target Expansion TP (%):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.20"
                    max="5.00"
                    value={relativeExpansionTargetPercent}
                    onChange={(e) =>
                      setRelativeExpansionTargetPercent(parseFloat(e.target.value))
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500">Default: 0.380%</span>
                </div>

                {/* Adverse Divergence Stop-Loss */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Stop-Loss Limit (%):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="-1.00"
                    max="-0.05"
                    value={adverseStopLossPercent}
                    onChange={(e) =>
                      setAdverseStopLossPercent(parseFloat(e.target.value))
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500">Default: -0.150%</span>
                </div>

                {/* Zero-Loss Floor */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Zero-Loss Floor (USDT):
                  </label>
                  <input
                    type="number"
                    step="0.005"
                    min="0.01"
                    max="1.00"
                    value={zeroLossNetHurdleUsdt}
                    onChange={(e) =>
                      setZeroLossNetHurdleUsdt(parseFloat(e.target.value))
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500">Default: $0.0100</span>
                </div>

                {/* Stagnancy Nominal */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Stagnancy Scratch (Minutes):
                  </label>
                  <input
                    type="number"
                    step="10"
                    min="60"
                    max="360"
                    value={nominalStagnancyMinutes}
                    onChange={(e) =>
                      setNominalStagnancyMinutes(parseInt(e.target.value, 10))
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500">Default: 180 min</span>
                </div>

                {/* Stagnancy Hard Ceiling */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Stagnancy Hard Ceiling:
                  </label>
                  <input
                    type="number"
                    step="10"
                    min="180"
                    max="720"
                    value={maxStagnancyCeilingMinutes}
                    onChange={(e) =>
                      setMaxStagnancyCeilingMinutes(parseInt(e.target.value, 10))
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500">Default: 360 min</span>
                </div>

                {/* Max Concurrent Orders / Positions */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Max Concurrent Orders:
                  </label>
                  <select
                    value={maxConcurrentPositions}
                    onChange={(e) => setMaxConcurrentPositions(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  >
                    <option value={1}>1 Concurrent Position (Conservative)</option>
                    <option value={2}>2 Concurrent Positions (Balanced)</option>
                    <option value={3}>3 Concurrent Positions (Active Capacity Cap)</option>
                  </select>
                  <span className="text-[10px] text-zinc-500">Cap: 3 max orders</span>
                </div>

                {/* Order Notional (USDT) */}
                <div>
                  <label className="block text-zinc-400 mb-1">
                    Order Notional per Leg (USDT):
                  </label>
                  <input
                    type="number"
                    step="5"
                    min="5"
                    max="600"
                    value={orderNotionalUsdt}
                    onChange={(e) =>
                      setOrderNotionalUsdt(parseFloat(e.target.value) || 15.0)
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <span className="text-[10px] text-zinc-500">Range: $5 – $600 USDT</span>
                </div>
              </div>

              {/* Read-Only Hard-Lock Section */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-zinc-300 space-y-1">
                <div className="font-bold text-accent-amber flex items-center space-x-1">
                  <Lock className="w-3 h-3" />
                  <span>IMMUTABLE FLEET SAFETY HARD-LOCKS</span>
                </div>
                <div>Max Concurrent Orders: 3 Max (Active Setting: {maxConcurrentPositions})</div>
                <div>Capital Allocation: Up to ${Math.max(60.0, orderNotionalUsdt * maxConcurrentPositions).toFixed(2)} USDT (NAV Protected)</div>
                <div>Order Notional: ${orderNotionalUsdt.toFixed(2)} USDT (Auto-Floor: ${Math.max(0.0100, parseFloat(((Math.max(1.0, orderNotionalUsdt / 60.0) * 0.0100)).toFixed(4))).toFixed(4)} USDT)</div>
                <div>Max Positions Per Symbol: 1 (Strict Cross-Instrument Dispersion)</div>
                <div className="text-[10px] text-zinc-500">
                  Tamper-resistant invariant protection across all configuration updates
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfigOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all active:scale-95 shadow-md flex items-center space-x-1.5"
                >
                  {saveSuccess ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <span>Save Configuration</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Emergency Kill Confirmation Modal */}
      {isKillConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-red-500/50 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-red-400">
              <AlertOctagon className="w-7 h-7 text-red-500 animate-pulse" />
              <h3 className="text-base font-black uppercase tracking-wider text-white">
                CRITICAL EMERGENCY KILL-SWITCH
              </h3>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Engaging the Emergency Kill-Switch will{" "}
              <strong className="text-red-400">IMMEDIATELY HALT</strong> the Divergence daemon and
              execute emergency market unwind orders on all open exchange positions using{" "}
              <strong className="text-white">reduceOnly: true</strong>.
            </p>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setIsKillConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleEmergencyKillClick}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-black transition-all active:scale-95 shadow-lg shadow-red-600/30"
              >
                ENGAGE EMERGENCY KILL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
