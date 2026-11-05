"use client";

import React, { useState, useEffect } from "react";
import { User, ShieldCheck, Server, Power, LogOut, X, CheckCircle, RefreshCw, Key } from "lucide-react";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout?: () => void;
}

export default function UserProfileModal({ isOpen, onClose, onLogout }: UserProfileModalProps) {
  const [daemonState, setDaemonState] = useState<{
    isRunning: boolean;
    runInBackgroundWhenClosed: boolean;
    uptimeSeconds: number;
    cyclesCompleted: number;
    activeHedges: number;
  }>({
    isRunning: true,
    runInBackgroundWhenClosed: true,
    uptimeSeconds: 0,
    cyclesCompleted: 0,
    activeHedges: 0,
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchDaemon = async () => {
    try {
      const res = await fetch("/api/bot/daemon", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemonState(data.daemon);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      fetchDaemon();
      const interval = setInterval(fetchDaemon, 4000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const toggleDaemon = async () => {
    setIsLoading(true);
    try {
      const action = daemonState.isRunning ? "stop" : "start";
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemonState(data.daemon);
        setMsg(
          action === "start"
            ? "24/7 Server Autonomous Bot is ACTIVE (Runs continuously when browser is closed)"
            : "Server Autonomous Bot paused."
        );
      }
    } catch {
      setMsg("Failed to update bot state");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleBackgroundMode = async () => {
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_background" }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemonState(data.daemon);
      }
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-mono animate-in fade-in duration-200">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-accent-amber/20 border border-accent-amber/40 flex items-center justify-center text-accent-amber font-bold">
              IQ
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100">Institutional Quant Profile</h2>
              <p className="text-xs text-zinc-400">demo@quantfunds.io</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 text-xs text-zinc-300 max-h-[75vh] overflow-y-auto">
          {/* Status Message */}
          {msg && (
            <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 flex items-center space-x-2 text-[11px]">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{msg}</span>
            </div>
          )}

          {/* Account Details Box */}
          <div className="bg-zinc-900/70 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <span className="text-zinc-400">Account Role</span>
              <span className="font-semibold text-zinc-200">Lead Arbitrage Portfolio Manager</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <span className="text-zinc-400">Trading Tier</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30 font-semibold">
                VIP Institutional (Zero Maker Fee)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Connected Exchanges</span>
              <div className="flex items-center space-x-2">
                <span className="inline-flex items-center space-x-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/50 text-emerald-400 border border-emerald-800/40">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Binance Testnet</span>
                </span>
                <span className="inline-flex items-center space-x-1 text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-400 border border-cyan-800/40">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Bitget V3 Demo</span>
                </span>
              </div>
            </div>
          </div>

          {/* 24/7 Server Autonomous Daemon Box */}
          <div className="bg-zinc-900/70 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-accent-cyan" />
                <span className="font-semibold text-zinc-200 text-sm">24/7 Server Autonomous Bot</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  daemonState.isRunning
                    ? "bg-emerald-950/80 text-emerald-400 border-emerald-700 animate-pulse"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                {daemonState.isRunning ? "ACTIVE (SERVER 24/7)" : "STANDBY"}
              </span>
            </div>

            <p className="text-[11px] text-zinc-400">
              When active, the arbitrage execution engine runs non-stop on the backend server. The bot scans
              funding rates and manages delta-neutral hedges even if you close this website or log out.
            </p>

            {/* Telemetry info */}
            <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
              <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[9px]">SERVER UPTIME</div>
                <div className="font-bold text-zinc-200 mt-0.5">{daemonState.uptimeSeconds}s</div>
              </div>
              <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[9px]">CYCLES RUN</div>
                <div className="font-bold text-zinc-200 mt-0.5">#{daemonState.cyclesCompleted}</div>
              </div>
              <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                <div className="text-zinc-500 text-[9px]">ACTIVE HEDGES</div>
                <div className="font-bold text-accent-amber mt-0.5">{daemonState.activeHedges}</div>
              </div>
            </div>

            {/* Toggle background checkbox */}
            <div className="pt-2 flex items-center justify-between">
              <label className="flex items-center space-x-2 cursor-pointer text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={daemonState.runInBackgroundWhenClosed}
                  onChange={toggleBackgroundMode}
                  className="rounded border-zinc-700 text-accent-amber focus:ring-0 w-3.5 h-3.5 bg-zinc-900"
                />
                <span>Run continuously when browser is closed / user offline</span>
              </label>

              <button
                onClick={toggleDaemon}
                disabled={isLoading}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 ${
                  daemonState.isRunning
                    ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40"
                    : "bg-accent-emerald text-zinc-950 hover:bg-emerald-400 font-bold"
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                <span>{daemonState.isRunning ? "Pause Daemon" : "Start 24/7 Engine"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-zinc-900/50 flex items-center justify-between">
          <button
            onClick={() => {
              if (onLogout) onLogout();
              onClose();
            }}
            className="px-3 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-950/30 border border-rose-900/40 transition-colors flex items-center space-x-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
