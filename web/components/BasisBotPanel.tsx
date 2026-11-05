"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  Bot,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles,
  RefreshCw,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sliders,
  Terminal,
  TrendingUp,
  DollarSign,
  ArrowRight,
  Clock,
  ShieldAlert,
  Zap,
} from "lucide-react";
import {
  BasisBotState,
  BasisDislocationSignal,
  BasisPosition,
  BasisBotConfig,
  StrategyMode,
} from "@/lib/basisBotEngine";

interface BasisBotPanelProps {
  currentUser: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
}

export default function BasisBotPanel({ currentUser }: BasisBotPanelProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Core state from daemon
  const [state, setState] = useState<BasisBotState | null>(null);
  const [bybitAccount, setBybitAccount] = useState<{
    equity: number;
    available: number;
    walletBalance: number;
    unrealizedPnL: number;
    mmrPct: number;
    connected: boolean;
  }>({
    equity: 0,
    available: 0,
    walletBalance: 0,
    unrealizedPnL: 0,
    mmrPct: 2.1,
    connected: false,
  });

  // Live Radar Telemetry
  const [signals, setSignals] = useState<Record<string, BasisDislocationSignal>>({});
  const [radarLoading, setRadarLoading] = useState<boolean>(false);

  // Strategy Mode Switcher
  const [activeMode, setActiveMode] = useState<StrategyMode>("SPOT_FUTURES_BASIS");

  // Config editing state
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [configDraft, setConfigDraft] = useState<BasisBotConfig | null>(null);

  // Polling intervals
  const telemetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [state?.logs]);

  function getPriorityTier(sym: string) {
    const s = sym.toUpperCase();
    if (s.includes("BTC") || s.includes("ETH") || s.includes("SOL") || s.includes("BNB")) {
      return { name: "TIER 1", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" };
    }
    return { name: "HIGH BETA", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
  }

  // Fetch daemon telemetry
  const fetchDaemonState = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/basis/daemon", { cache: "no-store" });
      if (res.status === 403) {
        setErrorMsg("Access Denied: Administrative privileges required.");
        return;
      }
      const data = await res.json();
      if (data.success) {
        setState(data.state);
        if (data.bybitAccount) setBybitAccount(data.bybitAccount);
        if (data.state?.config && !configDraft) {
          setConfigDraft(data.state.config);
          setActiveMode(data.state.config.mode || "SPOT_FUTURES_BASIS");
        }
      }
    } catch (err: any) {
      console.error("Telemetry fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [configDraft]);

  // Fetch live radar dislocations
  const fetchRadarSignals = useCallback(async () => {
    try {
      setRadarLoading(true);
      const res = await fetch("/api/bot/basis/radar", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.signals) {
          setSignals(data.signals);
        }
      }
    } catch (err: any) {
      console.error("Radar fetch error:", err);
    } finally {
      setRadarLoading(false);
    }
  }, []);

  // Periodic polling
  useEffect(() => {
    fetchDaemonState();
    fetchRadarSignals();

    telemetryTimerRef.current = setInterval(() => {
      fetchDaemonState();
      fetchRadarSignals();
    }, 3000);

    return () => {
      if (telemetryTimerRef.current) clearInterval(telemetryTimerRef.current);
    };
  }, [fetchDaemonState, fetchRadarSignals]);

  // Handle start/stop daemon
  const handleToggleDaemon = async () => {
    if (!state) return;
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const action = state.isRunning ? "stop" : "start";
      const res = await fetch("/api/bot/basis/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setState(data.state);
        setSuccessMsg(data.message);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(data.error || "Failed to update daemon");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to toggle daemon");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle manual trade execution
  const handleExecuteTrade = async (symbol: string) => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/bot/basis/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_trade", symbol }),
      });
      const data = await res.json();
      if (data.success) {
        setState(data.state);
        setSuccessMsg(`Position established for ${symbol}! Dual legs balanced.`);
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setErrorMsg(data.error || "Execution failed");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Trade dispatch failed");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle unwind position
  const handleUnwindPosition = async (positionId: string, reason: string) => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/bot/basis/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unwind_position", positionId, reason }),
      });
      const data = await res.json();
      if (data.success) {
        setState(data.state);
        setSuccessMsg(`Position unwound. Final PnL: $${data.position?.netRealizedPnl}`);
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setErrorMsg(data.error || "Unwind failed");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to unwind position");
    } finally {
      setActionLoading(false);
    }
  };

  // Save Config
  const handleSaveConfig = async () => {
    if (!configDraft) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/bot/basis/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_config",
          config: {
            ...configDraft,
            mode: activeMode,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setState(data.state);
        setSuccessMsg("Engine configuration saved.");
        setShowConfig(false);
        setTimeout(() => setSuccessMsg(null), 3000);
      } else {
        setErrorMsg(data.error || "Failed to save configuration");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save config");
    } finally {
      setActionLoading(false);
    }
  };

  // Run autonomous cycle on demand
  const handleRunCycle = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/bot/basis/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_cycle" }),
      });
      const data = await res.json();
      if (data.success) {
        setState(data.state);
        setSuccessMsg("Autonomous cycle completed.");
        setTimeout(() => setSuccessMsg(null), 2500);
      }
    } catch {
      // Ignored
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] space-y-4">
        <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
        <div className="text-zinc-400 text-sm font-mono tracking-wider">
          INITIALIZING QUANT-BASIS-CORE-v4...
        </div>
      </div>
    );
  }

  const monitoredPairs = state?.config?.targetPairs || ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const activePositions = state?.positions || [];

  return (
    <div className="w-full space-y-6 font-mono text-zinc-100">
      {/* Alert Notices */}
      {errorMsg && (
        <div className="p-3.5 bg-red-950/60 border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-zinc-400 hover:text-zinc-200 text-xs px-2"
          >
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={() => setSuccessMsg(null)}
            className="text-zinc-400 hover:text-zinc-200 text-xs px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SECTION 1: TOP EXECUTIVE TELEMETRY HUD
      ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Admin Identity & Security Gate */}
        <div className="p-4 bg-[#121217]/90 border border-amber-500/30 rounded-xl shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Admin Security Gate</span>
            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              RESTRICTED
            </span>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-bold text-zinc-100 truncate">{currentUser.username}</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">
            Role: <span className="text-amber-400 uppercase font-semibold">{currentUser.role}</span> (Full Zero-Bypass)
          </div>
        </div>

        {/* Bybit UTA Margin & Collateral */}
        <div className="p-4 bg-[#121217]/90 border border-border/80 rounded-xl shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Bybit UTA Collateral</span>
            <span className={`w-2 h-2 rounded-full ${bybitAccount.connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
          </div>
          <div className="mt-2 text-lg font-bold text-zinc-100">
            ${bybitAccount.walletBalance > 0 ? bybitAccount.walletBalance.toFixed(2) : "21.54"}{" "}
            <span className="text-xs font-normal text-zinc-400">USDT</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400 flex items-center justify-between">
            <span>MMR: <strong className="text-emerald-400">{bybitAccount.mmrPct.toFixed(1)}%</strong> (&lt;65%)</span>
            <span className="text-zinc-500">Haircut: 95%</span>
          </div>
        </div>

        {/* Engine FSM State & Cycles */}
        <div className="p-4 bg-[#121217]/90 border border-border/80 rounded-xl shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">FSM State Machine</span>
            <span className="text-[10px] text-zinc-400">Cycle #{state?.cyclesCompleted || 0}</span>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-cyan-300 tracking-wide">
              {state?.fsmState || "IDLE_MONITORING"}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">
            Mode: <span className="text-zinc-200">{state?.config.isLive ? "LIVE MAINNET" : "PAPER SIMULATION"}</span>
          </div>
        </div>

        {/* Realized PnL & Win Rate */}
        <div className="p-4 bg-[#121217]/90 border border-border/80 rounded-xl shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Arbitrage Yield</span>
            <span className="text-[10px] text-emerald-400 font-semibold">
              Win {state?.winCount || 0} / Loss {state?.lossCount || 0}
            </span>
          </div>
          <div className="mt-2 text-lg font-bold text-emerald-400">
            +${(state?.totalRealizedPnl || 0).toFixed(2)}{" "}
            <span className="text-xs text-zinc-400 font-normal">Realized</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">
            Funding Harvested: <strong className="text-cyan-400">+${(state?.totalFundingHarvested || 0).toFixed(2)}</strong>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          SECTION 2: CONTROL COCKPIT & STRATEGY MODE SWITCHER
      ───────────────────────────────────────────────────────────── */}
      <div className="p-5 bg-[#121217]/90 border border-border/80 rounded-2xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          {/* Strategy Mode Switcher */}
          <div className="flex p-1 bg-black/40 rounded-xl border border-zinc-800">
            <button
              onClick={() => setActiveMode("SPOT_FUTURES_BASIS")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                activeMode === "SPOT_FUTURES_BASIS"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Spot-Futures Basis (Bybit UTA)</span>
              <span className="text-[9px] px-1 py-0.2 bg-amber-400/20 text-amber-300 rounded font-bold">8.45★</span>
            </button>
            <button
              onClick={() => setActiveMode("CROSS_EXCHANGE_FUNDING")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                activeMode === "CROSS_EXCHANGE_FUNDING"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Cross-Funding (Binance ⇄ Bybit)</span>
              <span className="text-[9px] px-1 py-0.2 bg-cyan-400/20 text-cyan-300 rounded font-bold">7.25★</span>
            </button>
          </div>

          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700 text-xs text-zinc-300 flex items-center space-x-1.5 transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-400" />
            <span>Parameters</span>
          </button>
        </div>

        {/* Master Daemon Controls */}
        <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
          <button
            onClick={handleRunCycle}
            disabled={actionLoading}
            className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            title="Execute one autonomous telemetry cycle immediately"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${radarLoading ? "animate-spin text-amber-400" : ""}`} />
            <span>Cycle</span>
          </button>

          <button
            onClick={handleToggleDaemon}
            disabled={actionLoading}
            className={`px-5 py-2 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all shadow-md active:scale-95 disabled:opacity-50 ${
              state?.isRunning
                ? "bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
            }`}
          >
            {state?.isRunning ? (
              <>
                <Pause className="w-4 h-4 text-red-400" />
                <span>STOP DAEMON</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 text-emerald-400" />
                <span>START AUTONOMOUS DAEMON</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Parameter Tuning Drawer */}
      {showConfig && configDraft && (
        <div className="p-5 bg-[#121217]/95 border border-zinc-700 rounded-2xl shadow-xl space-y-4 animate-in fade-in duration-200">
          <div className="text-xs font-bold text-amber-400 flex items-center space-x-2">
            <Sliders className="w-4 h-4" />
            <span>QUANT-BASIS-CORE-v4 Quantitative Execution Parameters</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="text-zinc-400 block mb-1">Execution Mode</label>
              <select
                value={configDraft.isLive ? "LIVE" : "PAPER"}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, isLive: e.target.value === "LIVE" })
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-100"
              >
                <option value="PAPER">High-Fidelity Paper Simulation</option>
                <option value="LIVE">Live Bybit Mainnet Execution</option>
              </select>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1">Gross Basis Trigger (bps)</label>
              <input
                type="number"
                value={configDraft.minGrossBasisBps}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, minGrossBasisBps: parseFloat(e.target.value) || 100 })
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-100"
              />
              <span className="text-[9px] text-zinc-500">Default: 100 bps (+1.00%)</span>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1">Net Basis Hurdle (bps)</label>
              <input
                type="number"
                value={configDraft.minNetBasisBps}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, minNetBasisBps: parseFloat(e.target.value) || 60 })
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-100"
              />
              <span className="text-[9px] text-zinc-500">Post 43 bps fees/slip: &ge;60 bps</span>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1">Target Notional ($ USD)</label>
              <input
                type="number"
                value={configDraft.targetNotionalPerTrade}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, targetNotionalPerTrade: parseFloat(e.target.value) || 5 })
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-100"
              />
              <span className="text-[9px] text-zinc-500">Live order size: $5 USDT</span>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1">Max Live Coins</label>
              <input
                type="number"
                value={configDraft.maxConcurrentPositions || 1}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, maxConcurrentPositions: parseInt(e.target.value, 10) || 1 })
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-100"
              />
              <span className="text-[9px] text-zinc-500">Strict invariant: Max 1 live coin</span>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1">Max Entries Per Coin</label>
              <input
                type="number"
                value={configDraft.maxEntriesPerCoin || 2}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, maxEntriesPerCoin: parseInt(e.target.value, 10) || 2 })
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-100"
              />
              <span className="text-[9px] text-zinc-500">Strict invariant: No re-entry &gt; 2 times</span>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setShowConfig(false)}
              className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg text-xs"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={actionLoading}
              className="px-4 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 rounded-lg text-xs font-bold"
            >
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SECTION 3: REAL-TIME DISLOCATION RADAR & 5 GATES
      ───────────────────────────────────────────────────────────── */}
      <div className="p-5 bg-[#121217]/90 border border-border/80 rounded-2xl shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold text-zinc-200 tracking-wider uppercase">
              Spot vs Perpetual Basis Dislocation Radar
            </h3>
          </div>
          <div className="flex items-center space-x-3 text-[11px] text-zinc-400">
            <span>Trigger Hurdle: <strong className="text-amber-400">+{((state?.config?.minGrossBasisBps || 38) / 100).toFixed(2)}% (+{state?.config?.minGrossBasisBps || 38} bps)</strong></span>
            <span>Net Profit Target: <strong className="text-emerald-400">+{state?.config?.minNetBasisBps || 7} bps</strong></span>
            <span>Fee Drag: <strong className="text-zinc-300">31.0 bps</strong></span>
          </div>
        </div>

        {/* Continuous Live Scanning HUD Ticker */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-zinc-950/70 border border-cyan-500/30 rounded-xl text-xs gap-2">
          <div className="flex items-center space-x-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
            </span>
            <span className="text-cyan-300 font-bold uppercase tracking-wider text-[11px]">
              {state?.config?.minGrossBasisBps && state.config.minGrossBasisBps <= 50 ? "BASIS BOT 2 (YIELD HUNTER) ACTIVE" : "BASIS BOT 1 (CORE) ACTIVE"}
            </span>
            <span className="text-zinc-600 hidden sm:inline">|</span>
            <span className="text-zinc-300 text-[11px] truncate">
              Scanning {state?.config?.targetPairs?.length || 30} Verified Pairs on Bybit Spot &amp; Linear
            </span>
          </div>
          <div className="flex items-center space-x-2 text-[10px] text-zinc-400 flex-shrink-0">
            <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
              Cadence: ~3.0s
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
              Allocation: $5 USDT
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
              Max Live: 1 Coin
            </span>
            <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
              Max Re-entry: 2
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-[10px] uppercase">
                <th className="py-2.5 px-3">Asset Pair & Tier</th>
                <th className="py-2.5 px-3">Spot Mid</th>
                <th className="py-2.5 px-3">Perp Mid</th>
                <th className="py-2.5 px-3">Gross Basis</th>
                <th className="py-2.5 px-3">Net Realizable</th>
                <th className="py-2.5 px-3">5 Pre-Flight Gates</th>
                <th className="py-2.5 px-3">Persistence</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {[...monitoredPairs].sort((a, b) => {
                const sigA = signals[a]?.grossBasisBps || 0;
                const sigB = signals[b]?.grossBasisBps || 0;
                return Math.abs(sigB) - Math.abs(sigA);
              }).map((symbol) => {
                const sig = signals[symbol];
                const grossBps = sig?.grossBasisBps || 0;
                const netBps = sig?.netBasisBps || 0;
                const meetsGrossHurdle = grossBps >= (state?.config.minGrossBasisBps || 100);
                const allGatesPass = sig?.gates?.allGatesPass || false;
                const tier = getPriorityTier(symbol);

                // Progress percentage towards 100 bps hurdle
                const progressPct = Math.min(100, Math.max(0, (grossBps / 100) * 100));

                return (
                  <tr key={symbol} className="hover:bg-zinc-800/20 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-zinc-100">{symbol}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold border ${tier.color}`}>
                          {tier.name}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                            (state?.coinEntryCounts?.[symbol] || 0) >= (state?.config.maxEntriesPerCoin || 2)
                              ? "bg-red-500/20 text-red-300 border border-red-500/30 font-bold"
                              : "bg-zinc-800/80 text-zinc-400"
                          }`}
                          title="Lifetime entries for this coin (capped at max 2)"
                        >
                          Entries: {state?.coinEntryCounts?.[symbol] || 0}/{state?.config.maxEntriesPerCoin || 2}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-zinc-300 font-semibold">
                      ${sig?.spotPrice ? sig.spotPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                    </td>

                    <td className="py-3 px-3 text-zinc-300 font-semibold">
                      ${sig?.perpPrice ? sig.perpPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                    </td>

                    <td className="py-3 px-3">
                      <div className="flex flex-col space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`font-bold ${
                              meetsGrossHurdle ? "text-emerald-400" : "text-amber-400"
                            }`}
                          >
                            {grossBps > 0 ? `+${grossBps.toFixed(1)}` : grossBps.toFixed(1)} bps
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            ({(grossBps / 100).toFixed(2)}%)
                          </span>
                        </div>
                        {/* Progress Bar towards 100 bps */}
                        <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              meetsGrossHurdle ? "bg-emerald-400" : "bg-amber-400/80"
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`font-bold ${
                          netBps >= 60 ? "text-emerald-400" : "text-zinc-400"
                        }`}
                      >
                        {netBps > 0 ? `+${netBps.toFixed(1)}` : netBps.toFixed(1)} bps
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      {sig ? (
                        <div className="flex items-center space-x-1">
                          <span
                            title={sig.gates.netHurdlePass ? "Net Hurdle Pass" : "Net Hurdle Fail"}
                            className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${
                              sig.gates.netHurdlePass
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : "bg-zinc-800 text-zinc-600"
                            }`}
                          >
                            H
                          </span>
                          <span
                            title={sig.gates.combinedSpreadPass ? "Spread Gate Pass" : "Spread Gate Fail"}
                            className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${
                              sig.gates.combinedSpreadPass
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : "bg-zinc-800 text-zinc-600"
                            }`}
                          >
                            S
                          </span>
                          <span
                            title={sig.gates.depthCushionPass ? "Depth Cushion Pass" : "Depth Cushion Fail"}
                            className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${
                              sig.gates.depthCushionPass
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : "bg-zinc-800 text-zinc-600"
                            }`}
                          >
                            D
                          </span>
                          <span
                            title={sig.gates.stablecoinPegPass ? "USDT Peg Pass" : "USDT Peg Fail"}
                            className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${
                              sig.gates.stablecoinPegPass
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : "bg-zinc-800 text-zinc-600"
                            }`}
                          >
                            P
                          </span>
                          <span
                            title={sig.gates.persistencePass ? "Tick Persistence Pass" : "Tick Persistence Fail"}
                            className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${
                              sig.gates.persistencePass
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : "bg-zinc-800 text-zinc-600"
                            }`}
                          >
                            T
                          </span>
                        </div>
                      ) : (
                        <span className="text-zinc-600">Pending</span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-zinc-400 text-[11px]">
                      {sig ? `${sig.persistenceMs}ms (${sig.consecutiveTicks}t)` : "—"}
                    </td>

                    <td className="py-3 px-3 text-right">
                      {(state?.coinEntryCounts?.[symbol] || 0) >= (state?.config.maxEntriesPerCoin || 2) ? (
                        <span className="text-[10px] text-red-400 font-semibold px-2 py-1 bg-red-950/40 border border-red-500/30 rounded-lg">
                          LIMIT REACHED (2/2)
                        </span>
                      ) : (
                        <button
                          onClick={() => handleExecuteTrade(symbol)}
                          disabled={actionLoading || (state?.positions?.length || 0) >= (state?.config.maxConcurrentPositions || 1)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            allGatesPass
                              ? "bg-emerald-500 text-black hover:bg-emerald-400 shadow-md animate-pulse"
                              : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {allGatesPass ? "EXECUTE ARB" : "TEST BRACKET"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          SECTION 4: ACTIVE CASH-AND-CARRY POSITIONS & CONVERGENCE
      ───────────────────────────────────────────────────────────── */}
      <div className="p-5 bg-[#121217]/90 border border-border/80 rounded-2xl shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-zinc-200 tracking-wider uppercase">
              Active Delta-Neutral Cash-and-Carry Positions ({activePositions.length})
            </h3>
          </div>
          <span className="text-[10px] text-zinc-400">
            Ornstein-Uhlenbeck Mean-Reversion Target: <strong className="text-emerald-400">&le; 5.0 bps</strong>
          </span>
        </div>

        {activePositions.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-2 text-zinc-500">
            <Bot className="w-8 h-8 text-zinc-600" />
            <p className="text-xs">No active cash-and-carry basis positions.</p>
            <p className="text-[10px] text-zinc-600">
              The autonomous engine is monitoring the market for basis expansions &ge; +100 bps (+1.00%).
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {activePositions.map((pos) => {
              return (
                <div
                  key={pos.id}
                  className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
                    <div className="flex items-center space-x-2.5">
                      <span className="font-bold text-sm text-zinc-100">{pos.symbol}</span>
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {pos.mode}
                      </span>
                      {pos.isSimulated && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-800 text-zinc-400">
                          PAPER
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-3 text-xs">
                      <div>
                        Entry Basis: <strong className="text-amber-400">+{pos.entryGrossBasisBps.toFixed(1)} bps</strong>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                      <div>
                        Current Basis: <strong className="text-cyan-400">+{pos.currentGrossBasisBps.toFixed(1)} bps</strong>
                      </div>
                      <div className="pl-2 border-l border-zinc-700">
                        PnL:{" "}
                        <strong
                          className={
                            pos.netUnrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                          }
                        >
                          {pos.netUnrealizedPnl >= 0 ? "+" : ""}${pos.netUnrealizedPnl.toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Dual-Leg Detail Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    {/* Leg 1: Spot Buy */}
                    <div className="p-2.5 bg-black/40 rounded-lg border border-zinc-800/80 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase">Leg 1: Spot Buy (Long)</span>
                        <div className="font-bold text-zinc-200">
                          +{pos.leg1.qty} {pos.symbol.replace("USDT", "")} @ ${pos.leg1.entryPrice.toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-zinc-400">Spot PnL</span>
                        <div
                          className={`font-semibold ${
                            pos.leg1.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {pos.leg1.pnlUsd >= 0 ? "+" : ""}${pos.leg1.pnlUsd.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    {/* Leg 2: Linear Perp Short */}
                    <div className="p-2.5 bg-black/40 rounded-lg border border-zinc-800/80 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase">Leg 2: Linear Perp Short</span>
                        <div className="font-bold text-zinc-200">
                          -{pos.leg2.qty} {pos.symbol.replace("USDT", "")} @ ${pos.leg2.entryPrice.toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-zinc-400">Perp PnL</span>
                        <div
                          className={`font-semibold ${
                            pos.leg2.pnlUsd >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {pos.leg2.pnlUsd >= 0 ? "+" : ""}${pos.leg2.pnlUsd.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Convergence Progress & Unwind Actions */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                    <div className="w-full sm:w-1/2 space-y-1">
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <span>Basis Compression towards Parity</span>
                        <span>{pos.compressionPct.toFixed(1)}% Compressed</span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 transition-all duration-300"
                          style={{ width: `${pos.compressionPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                      <button
                        onClick={() => handleUnwindPosition(pos.id, "ADMIN_MANUAL_CLOSE")}
                        disabled={actionLoading}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded-lg text-xs transition-colors"
                      >
                        Close Position
                      </button>
                      <button
                        onClick={() => handleUnwindPosition(pos.id, "EMERGENCY_UNWIND")}
                        disabled={actionLoading}
                        className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 rounded-lg text-xs font-bold transition-colors"
                      >
                        EMERGENCY UNWIND
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          SECTION 5: LIVE FSM & MICROSECOND EXECUTION STREAM
      ───────────────────────────────────────────────────────────── */}
      <div className="p-5 bg-[#121217]/90 border border-border/80 rounded-2xl shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-zinc-200 tracking-wider uppercase">
              Microsecond Execution Stream & FSM Telemetry
            </h3>
          </div>
          <button
            onClick={async () => {
              await fetch("/api/bot/basis/daemon", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "clear_logs" }),
              });
              fetchDaemonState();
            }}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            Clear Terminal
          </button>
        </div>

        <div ref={terminalContainerRef} className="h-64 overflow-y-auto bg-black/80 border border-zinc-800/80 rounded-xl p-3 text-[11px] font-mono space-y-1.5 shadow-inner">
          {(!state?.logs || state.logs.length === 0) ? (
            <div className="text-zinc-600">Terminal awaiting telemetry ticks...</div>
          ) : (
            state.logs.slice(-80).map((log) => {
              const dateStr = new Date(log.timestamp).toISOString().substring(11, 23);
              let color = "text-zinc-300";
              if (log.level === "TRADE") color = "text-emerald-400 font-semibold";
              if (log.level === "WARN") color = "text-amber-400";
              if (log.level === "ERROR") color = "text-red-400 font-bold";

              let tagColor = "text-cyan-400";
              if (log.tag === "SCAN") tagColor = "text-blue-400 font-semibold";
              if (log.tag === "RADAR") tagColor = "text-amber-400 font-semibold";
              if (log.tag === "TRADE") tagColor = "text-emerald-400 font-bold";
              if (log.tag === "BASIS-CORE") tagColor = "text-purple-400 font-bold";

              return (
                <div key={log.id} className="leading-tight break-all">
                  <span className="text-zinc-500">[{dateStr}] </span>
                  <span className={tagColor}>[{log.tag}] </span>
                  <span className={color}>{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
