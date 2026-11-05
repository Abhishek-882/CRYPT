"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  ArrowLeft,
  RefreshCw,
  KeyRound,
  User,
  Terminal,
  Server,
  Activity,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AutoBotPanel from "@/components/AutoBotPanel";
import SettingsModal from "@/components/SettingsModal";
import UserProfileModal from "@/components/UserProfileModal";
import ServerDaemonIndicator from "@/components/ServerDaemonIndicator";

export default function AutoBotPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Live daemon telemetry summary
  const [daemonSummary, setDaemonSummary] = useState<{
    isRunning: boolean;
    uptimeSeconds: number;
    cyclesCompleted: number;
    activeBotsCount: number;
    activeHedgesCount: number;
    statusText: string;
  }>({
    isRunning: true,
    uptimeSeconds: 0,
    cyclesCompleted: 0,
    activeBotsCount: 0,
    activeHedgesCount: 0,
    statusText: "CONNECTING...",
  });

  const verifyAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.isLoggedIn && data.user) {
        setCurrentUser(data.user);
        setIsAuthLoading(false);
      } else {
        router.push("/login");
      }
    } catch {
      router.push("/login");
    }
  }, [router]);

  const fetchDaemonTelemetry = useCallback(async () => {
    if (document.hidden) return;
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/bot/daemon", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.daemon) {
        const d = data.daemon;
        const activeBots = (d.bots || []).filter((b: any) => b.enabled).length;
        const totalActiveHedges = (d.bots || []).reduce(
          (acc: number, b: any) => acc + (b.activeHedges?.length || 0),
          0
        );
        setDaemonSummary({
          isRunning: d.isRunning,
          uptimeSeconds: d.uptimeSeconds || 0,
          cyclesCompleted: d.cyclesCompleted || 0,
          activeBotsCount: activeBots,
          activeHedgesCount: totalActiveHedges,
          statusText: d.statusText || (d.isRunning ? "24/7 ACTIVE SCANNING" : "PAUSED"),
        });
      }
    } catch {
      // Keep previous state
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    verifyAuth();
  }, [verifyAuth]);

  useEffect(() => {
    if (!currentUser) return;
    fetchDaemonTelemetry();
    const interval = setInterval(() => {
      if (!document.hidden) fetchDaemonTelemetry();
    }, 5000);
    return () => clearInterval(interval);
  }, [currentUser, fetchDaemonTelemetry]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-background text-zinc-100 flex flex-col font-mono">
        <Navbar />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="flex items-center space-x-3 text-zinc-400 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-accent-amber" />
            <span>Verifying autonomous quant engine access...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-8 pb-24 sm:pb-8 space-y-4 sm:space-y-6">
        {/* Breadcrumb & Navigation Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-5">
          <div className="space-y-1.5">
            {/* Breadcrumb Row */}
            <div className="flex items-center space-x-2 text-xs text-zinc-500">
              <Link
                href="/terminal"
                className="hover:text-accent-amber transition-colors flex items-center space-x-1"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>TERMINAL</span>
              </Link>
              <span>{"//"}</span>
              <span className="text-zinc-300 font-semibold flex items-center space-x-1.5">
                <Bot className="w-3.5 h-3.5 text-accent-amber" />
                <span>24/7 AUTONOMOUS BOT DAEMON</span>
              </span>
            </div>

            {/* Title & Engine Status */}
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight uppercase text-zinc-100">
                AUTOPILOT ARBITRAGE ENGINE
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold border flex items-center space-x-1.5 ${
                  daemonSummary.isRunning
                    ? "bg-emerald-500/10 text-accent-emerald border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    daemonSummary.isRunning ? "bg-accent-emerald animate-ping" : "bg-zinc-500"
                  }`}
                />
                <span>{daemonSummary.isRunning ? "SERVER DAEMON ACTIVE" : "DAEMON PAUSED"}</span>
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
                PERSISTENT NODE DAEMON
              </span>
            </div>

            <p className="text-[11px] text-zinc-500">
              Institutional Delta-Neutral Basis Capture • Background Execution Daemon • Binance USD-M & Bitget V3
            </p>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-start md:justify-end">
            <Link
              href="/terminal"
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 hover:text-white transition-colors"
              title="Return to Main Trading Terminal"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-accent-amber" />
              <span>Back to Terminal</span>
            </Link>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 transition-colors"
              title="Configure API Keys Vault"
            >
              <KeyRound className="w-3.5 h-3.5 text-accent-amber" />
              <span className="hidden sm:inline">Vault</span>
            </button>

            <button
              onClick={() => setIsProfileOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 transition-colors"
              title="View User Profile"
            >
              <User className="w-3.5 h-3.5 text-accent-amber" />
              <span className="hidden sm:inline">Profile</span>
            </button>

            <button
              onClick={fetchDaemonTelemetry}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Refresh Daemon Status"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? "animate-spin text-accent-amber" : ""}`}
              />
            </button>
          </div>
        </header>

        {/* Live Daemon Telemetry HUD Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 text-xs">
          <div className="p-3 rounded-xl bg-surface border border-border">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center space-x-1">
              <Activity className="w-3 h-3 text-accent-emerald" />
              <span>DAEMON STATUS</span>
            </div>
            <div className="font-bold text-sm text-zinc-100 font-mono mt-1 flex items-center space-x-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  daemonSummary.isRunning ? "bg-accent-emerald animate-pulse" : "bg-zinc-600"
                }`}
              />
              <span className="truncate">{daemonSummary.statusText}</span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Cycles: #{daemonSummary.cyclesCompleted}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-surface border border-border">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center space-x-1">
              <Cpu className="w-3 h-3 text-accent-amber" />
              <span>ENGINE UPTIME</span>
            </div>
            <div className="font-bold text-sm text-zinc-100 font-mono mt-1">
              {formatUptime(daemonSummary.uptimeSeconds)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Continuous 24/7 background mode
            </div>
          </div>

          <div className="p-3 rounded-xl bg-surface border border-border">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center space-x-1">
              <Bot className="w-3 h-3 text-accent-cyan" />
              <span>ACTIVE BOTS</span>
            </div>
            <div className="font-bold text-sm text-accent-cyan font-mono mt-1">
              {daemonSummary.activeBotsCount} INSTANCES
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Multi-preset execution slots
            </div>
          </div>

          <div className="p-3 rounded-xl bg-surface border border-border">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center space-x-1">
              <ShieldCheck className="w-3 h-3 text-accent-emerald" />
              <span>OPEN HEDGE LEGS</span>
            </div>
            <div className="font-bold text-sm text-accent-emerald font-mono mt-1">
              {daemonSummary.activeHedgesCount} POSITIONS
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Managed auto-settlements
            </div>
          </div>
        </div>

        {/* Complete Dedicated AutoBotPanel */}
        <div id="auto-bot-panel-section" className="w-full">
          <AutoBotPanel />
        </div>
      </main>

      <Footer />

      {/* Settings Modal (API Keys Vault) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={fetchDaemonTelemetry}
      />

      {/* Institutional User Profile Modal */}
      <UserProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />
    </div>
  );
}
