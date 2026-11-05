"use client";

import React, { useState, useEffect } from "react";
import { Server, Activity } from "lucide-react";
import { useRouter } from "next/navigation";

interface ServerDaemonIndicatorProps {
  onOpenProfile?: () => void;
}

export default function ServerDaemonIndicator({ onOpenProfile }: ServerDaemonIndicatorProps) {
  const router = useRouter();
  const [daemonState, setDaemonState] = useState<{
    isRunning: boolean;
    isBotActive: boolean;
    activeCorridor: string;
    uptimeSeconds: number;
    cyclesCompleted: number;
  }>({
    isRunning: true,
    isBotActive: false,
    activeCorridor: "COINDCX_BYBIT",
    uptimeSeconds: 0,
    cyclesCompleted: 0,
  });

  const fetchStatus = async () => {
    // Only poll daemon if authenticated session exists (prevents 401 console spam in spectator mode)
    if (typeof document !== "undefined" && !document.cookie.includes("auth_session=")) {
      setDaemonState((prev) => ({ ...prev, isRunning: false, isBotActive: false }));
      return;
    }
    try {
      const res = await fetch("/api/bot/daemon", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDaemonState((prev) => ({ ...prev, isRunning: false, isBotActive: false }));
        return;
      }
      const data = await res.json();
      if (data.success && data.daemon) {
        const isBotEnabled = Boolean(data.daemon.bots?.some((b: any) => b.enabled));
        const activeBot = data.daemon.bots?.find((b: any) => b.id === data.daemon.activeBotId) || data.daemon.bots?.[0];
        setDaemonState({
          isRunning: data.daemon.isRunning,
          isBotActive: isBotEnabled,
          activeCorridor: activeBot?.config?.executionCorridor || "COINDCX_BYBIT",
          uptimeSeconds: data.daemon.uptimeSeconds || 0,
          cyclesCompleted: data.daemon.cyclesCompleted || 0,
        });
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleClick = () => {
    router.push("/bot");
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg border text-[11px] font-mono transition-all shadow-sm ${
        daemonState.isBotActive
          ? "bg-emerald-950/50 text-emerald-300 border-emerald-500/60 hover:bg-emerald-900/50 shadow-emerald-950/40 ring-1 ring-emerald-500/30"
          : "bg-amber-950/30 text-amber-300 border-amber-500/40 hover:bg-amber-900/30 shadow-amber-950/30"
      }`}
      title="Click to open Live Autonomous Bot Terminal"
    >
      <span className="relative flex h-2 w-2">
        {daemonState.isBotActive && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            daemonState.isBotActive ? "bg-emerald-400" : "bg-amber-400"
          }`}
        ></span>
      </span>
      <Server className="w-3.5 h-3.5" />
      <span className="font-semibold hidden sm:inline">AUTOPILOT:</span>
      <span className="font-bold">
        {daemonState.isBotActive ? "LIVE SCANNING" : "ARMED (STANDBY)"}
      </span>
      {daemonState.isBotActive && daemonState.cyclesCompleted > 0 && (
        <span className="text-[9px] text-zinc-400 hidden md:inline">
          #{daemonState.cyclesCompleted}
        </span>
      )}
    </button>
  );
}
