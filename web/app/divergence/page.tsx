"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  DivergenceTelemetryHUD,
  DispersionRadar,
  CandidateFeed,
  ActivePositionsTable,
  DaemonControls,
  AuditLedger,
  AuditPositionItem,
} from "@/components/divergence";
import {
  DivergenceCandidate,
  DivergencePosition,
  DivergenceConfig,
  DivergenceFsmState,
} from "@/lib/divergence/types";
import {
  Activity,
  Zap,
  ShieldCheck,
  RefreshCw,
  Terminal,
  Radio,
  Clock,
  Crosshair,
  Sparkles,
  Lock,
} from "lucide-react";

export default function DivergenceCockpitPage() {
  const [mounted, setMounted] = useState(false);

  // Daemon telemetry state
  const [isRunning, setIsRunning] = useState(false);
  const [fsmState, setFsmState] = useState<DivergenceFsmState>("PAUSED");
  const [lockActive, setLockActive] = useState(false);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [config, setConfig] = useState<DivergenceConfig | undefined>(undefined);
  const [activePositions, setActivePositions] = useState<DivergencePosition[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Radar state
  const [candidates, setCandidates] = useState<DivergenceCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<DivergenceCandidate | null>(null);
  const [scannedUniverseCount, setScannedUniverseCount] = useState(0);
  const [primeCandidatesCount, setPrimeCandidatesCount] = useState(0);
  const [isRadarLoading, setIsRadarLoading] = useState(true);
  const [radarDegraded, setRadarDegraded] = useState(false);

  // Audit state
  const [closedPositions, setClosedPositions] = useState<AuditPositionItem[]>([]);
  const [auditMetrics, setAuditMetrics] = useState<{
    totalClosedTrades: number;
    winRatePercent: number;
    totalNetRealizedPnlUsdt: number;
    totalFeesPaidUsdt: number;
    averageHoldDurationMinutes: number;
    zeroLossCompliantCount: number;
  }>({
    totalClosedTrades: 0,
    winRatePercent: 0,
    totalNetRealizedPnlUsdt: 0,
    totalFeesPaidUsdt: 0,
    averageHoldDurationMinutes: 0,
    zeroLossCompliantCount: 0,
  });

  // Polling sync heartbeat
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(Date.now());
  const isFetchingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 1. Fetch Daemon Status
  const fetchDaemonState = useCallback(async () => {
    try {
      const res = await fetch("/api/divergence/daemon", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setIsRunning(data.isRunning);
          setFsmState(data.fsmState);
          setUptimeSeconds(data.uptimeSeconds || 0);
          setConfig(data.config);
          if (Array.isArray(data.activePositions)) {
            setActivePositions(data.activePositions);
          }
        }
      }
    } catch (err) {
      console.error("[Divergence] Daemon polling error:", err);
    }
  }, []);

  // 2. Fetch Radar Feed
  const fetchRadarFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/divergence/radar", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setScannedUniverseCount(data.candidatesCount || data.candidates.length);
          setRadarDegraded(Boolean(data.degraded));

          const primeCount = data.candidates.filter(
            (c: DivergenceCandidate) =>
              Math.abs(c.liveBasisPercent) <= 0.1 && c.dispersion24hPercent >= 0.4
          ).length;
          setPrimeCandidatesCount(primeCount);

          if (!selectedCandidate && data.candidates.length > 0) {
            // Default select first prime candidate or top DDI
            const topPrime = data.candidates.find(
              (c: DivergenceCandidate) =>
                Math.abs(c.liveBasisPercent) <= 0.1 && c.dispersion24hPercent >= 0.4
            );
            setSelectedCandidate(topPrime || data.candidates[0]);
          }
        }
      }
    } catch (err) {
      console.error("[Divergence] Radar feed error:", err);
    } finally {
      setIsRadarLoading(false);
    }
  }, [selectedCandidate]);

  // 3. Fetch Audit Ledger
  const fetchAuditLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/divergence/audit", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (Array.isArray(data.auditLedger)) {
            setClosedPositions(data.auditLedger);
          }
          if (data.summaryMetrics) {
            setAuditMetrics(data.summaryMetrics);
          }
        }
      }
    } catch (err) {
      console.error("[Divergence] Audit ledger polling error:", err);
    }
  }, []);

  // Synchronized Master Tick
  const syncAll = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsRefreshing(true);
    try {
      await Promise.allSettled([fetchDaemonState(), fetchRadarFeed(), fetchAuditLedger()]);
      setLastSyncTime(Date.now());
    } finally {
      setIsRefreshing(false);
      isFetchingRef.current = false;
    }
  }, [fetchDaemonState, fetchRadarFeed, fetchAuditLedger]);

  // Initial fetch and 2,500ms SWR polling loop
  useEffect(() => {
    syncAll();
    const interval = setInterval(() => {
      syncAll();
    }, 2500);
    return () => clearInterval(interval);
  }, [syncAll]);

  // Command Handlers
  const handleStartDaemon = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/divergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (data.success) {
        setIsRunning(true);
        setFsmState(data.fsmState || "SCANNING");
      }
      await syncAll();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePauseDaemon = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/divergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      const data = await res.json();
      if (data.success) {
        setIsRunning(false);
        setFsmState("PAUSED");
      }
      await syncAll();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmergencyKill = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/divergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "emergency_kill" }),
      });
      const data = await res.json();
      if (data.success) {
        setIsRunning(false);
        setFsmState("EMERGENCY_KILLED");
      }
      await syncAll();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTick = async () => {
    setIsSubmitting(true);
    try {
      await fetch("/api/divergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      await syncAll();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePosition = async (positionId: string) => {
    setIsSubmitting(true);
    try {
      await fetch("/api/divergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_position", positionId }),
      });
      await syncAll();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateConfig = async (newConfig: Partial<DivergenceConfig>) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/divergence/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_config", config: newConfig }),
      });
      const data = await res.json();
      if (data.success && data.config) {
        setConfig(data.config);
      }
      await syncAll();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeployCandidate = async (candidate: DivergenceCandidate) => {
    setSelectedCandidate(candidate);
    // Triggers a manual sweep tick which will pick up the qualified candidate if engine is armed
    await handleTick();
  };

  if (!mounted) {
    return null;
  }

  const capitalAllocated = activePositions.reduce((acc, p) => acc + p.notionalUsdt, 0);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono selection:bg-amber-500/30 selection:text-amber-200">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* Hero Title & Strategy Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl bg-zinc-950/70 border border-border/80 backdrop-blur-2xl shadow-2xl">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-accent-amber font-black text-sm">
                Δ
              </div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-white flex items-center space-x-2">
                <span>DIVERGENCE BASIS ENGINE</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold">
                  EXPANSION ALPHA
                </span>
              </h1>
            </div>
            <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
              Monetizes basis expansion from coiled-spring compressed baselines (|b| ≤ 0.100%) back
              toward 24h peak dispersion (Δb ≥ 0.400%). Operates 100% live on Binance USD-M Maker Limit +
              Bybit Linear IOC Taker with guaranteed zero-loss take-profit ratchets.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-xs flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
              <span className="text-zinc-400 font-semibold">REAL MONEY:</span>
              <span className="text-zinc-200 font-bold">BINANCE + BYBIT</span>
            </div>

            <div className="px-3 py-1.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-xs flex items-center space-x-2">
              <Lock className="w-3.5 h-3.5 text-accent-amber" />
              <span className="text-zinc-400 font-semibold">CAPITAL ALLOCATION:</span>
              <span className="text-accent-amber font-bold">$60.00 MAX (3 ORDERS)</span>
            </div>
          </div>
        </div>

        {/* Telemetry HUD */}
        <DivergenceTelemetryHUD
          isRunning={isRunning}
          fsmState={fsmState}
          activePositionsCount={activePositions.length}
          maxConcurrentPositions={config?.maxConcurrentPositions ?? 3}
          capitalAllocatedUsdt={capitalAllocated}
          maxCapitalAllocationUsdt={config?.maxCapitalAllocationUsdt ?? 60.0}
          scannedUniverseCount={scannedUniverseCount}
          primeCandidatesCount={primeCandidatesCount}
          totalRealizedNetPnlUsdt={auditMetrics.totalNetRealizedPnlUsdt}
          winRatePercent={auditMetrics.winRatePercent}
          uptimeSeconds={uptimeSeconds}
          lockActive={isRunning}
          onRefresh={syncAll}
          isRefreshing={isRefreshing}
          lastSyncTime={lastSyncTime}
        />

        {/* 2-Column Section: Dispersion Radar & Candidate Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 w-full">
            <DispersionRadar
              candidates={candidates}
              selectedCandidate={selectedCandidate}
              onSelectCandidate={(c) => setSelectedCandidate(c)}
              isLoading={isRadarLoading}
            />
          </div>

          <div className="lg:col-span-5 w-full">
            <CandidateFeed
              candidates={candidates}
              selectedCandidate={selectedCandidate}
              onSelectCandidate={(c) => setSelectedCandidate(c)}
              onDeployCandidate={handleDeployCandidate}
              isDeploying={isSubmitting}
            />
          </div>
        </div>

        {/* Active Positions Table */}
        <ActivePositionsTable
          positions={activePositions}
          onClosePosition={handleClosePosition}
          isClosing={isSubmitting}
        />

        {/* Daemon Controls & Circuit Breakers */}
        <DaemonControls
          isRunning={isRunning}
          fsmState={fsmState}
          config={config}
          onStart={handleStartDaemon}
          onStop={handlePauseDaemon}
          onEmergencyKill={handleEmergencyKill}
          onTick={handleTick}
          onUpdateConfig={handleUpdateConfig}
          isSubmitting={isSubmitting}
        />

        {/* Authentic Audit Ledger */}
        <AuditLedger
          closedPositions={closedPositions}
          summaryMetrics={auditMetrics}
          isLoading={isRefreshing}
        />
      </main>

      <Footer />
    </div>
  );
}
