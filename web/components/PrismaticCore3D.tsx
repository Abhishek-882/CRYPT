"use client";

import React, { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Clock, Pause, Play, RefreshCw, ShieldCheck, Sparkles, Zap, Eye } from "lucide-react";

interface PrismaticCoreProps {
  spreadBps?: number;
  symbol?: string;
  binancePrice?: number;
  bitgetPrice?: number;
  binanceFundingRate?: number;
  bitgetFundingRate?: number;
  nextFundingTime?: number;
  fundingIntervalHours?: number;
  isInspecting?: boolean;
  onToggleInspect?: () => void;
}

type VisualMode = "WAVEFORM" | "BRIDGE" | "RADAR";

export default function PrismaticCore3D({
  spreadBps = 12.5,
  symbol = "BTCUSDT",
  binancePrice = 0,
  bitgetPrice = 0,
  binanceFundingRate = 0.0001,
  bitgetFundingRate = 0.0002,
  nextFundingTime = 0,
  fundingIntervalHours = 8,
  isInspecting = false,
  onToggleInspect,
}: PrismaticCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<VisualMode>("WAVEFORM");
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // References for live 60fps render loop
  const historyRef = useRef<{ time: number; val: number }[]>([]);
  const initialSpreadRef = useRef<number>(spreadBps);
  const spreadBpsRef = useRef<number>(spreadBps);
  const markPriceBnRef = useRef<number>(binancePrice);
  const markPriceBgRef = useRef<number>(bitgetPrice);
  const fundingRateBnRef = useRef<number>(binanceFundingRate);
  const fundingRateBgRef = useRef<number>(bitgetFundingRate);
  const symbolRef = useRef<string>(symbol);
  const modeRef = useRef<VisualMode>(mode);
  const isPausedRef = useRef<boolean>(isPaused);
  const fundingIntervalHoursRef = useRef<number>(fundingIntervalHours);

  // Sync props to refs
  useEffect(() => {
    fundingIntervalHoursRef.current = fundingIntervalHours;
  }, [fundingIntervalHours]);

  useEffect(() => {
    spreadBpsRef.current = spreadBps;
  }, [spreadBps]);

  useEffect(() => {
    markPriceBnRef.current = binancePrice;
  }, [binancePrice]);

  useEffect(() => {
    markPriceBgRef.current = bitgetPrice;
  }, [bitgetPrice]);

  useEffect(() => {
    fundingRateBnRef.current = binanceFundingRate;
  }, [binanceFundingRate]);

  useEffect(() => {
    fundingRateBgRef.current = bitgetFundingRate;
  }, [bitgetFundingRate]);

  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Seed initial rolling waveform history
  useEffect(() => {
    const now = Date.now();
    const initial = [];
    const base = initialSpreadRef.current || 12;
    for (let i = 50; i >= 0; i--) {
      initial.push({
        time: now - i * 1000,
        val: base + Math.sin(i * 0.4) * 2.5 + (Math.random() - 0.5) * 1.2,
      });
    }
    historyRef.current = initial;
  }, []);

  // Update history buffer on spread change
  useEffect(() => {
    const list = historyRef.current;
    list.push({ time: Date.now(), val: spreadBps });
    if (list.length > 80) list.shift();
  }, [spreadBps]);

  // Canvas Animation Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let frame = 0;

    // Particles for Bridge mode
    const particles: { x: number; y: number; progress: number; speed: number; lane: number }[] = [];
    for (let i = 0; i < 28; i++) {
      particles.push({
        x: 0,
        y: 0,
        progress: Math.random(),
        speed: 0.004 + Math.random() * 0.006,
        lane: i % 3,
      });
    }

    const render = () => {
      if (document.hidden) {
        animId = requestAnimationFrame(render);
        return;
      }

      animId = requestAnimationFrame(render);
      if (isPausedRef.current) return;

      frame++;
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      const liveSpread = spreadBpsRef.current || 10;
      const currentMode = modeRef.current;

      // Subtle background grid
      ctx.strokeStyle = "rgba(39, 39, 42, 0.4)";
      ctx.lineWidth = 1;
      const gridSpacing = 40;
      for (let x = 0; x < w; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // ========================================================
      // MODE 1: LIVE BASIS SPREAD WAVEFORM (OSCILLOSCOPE)
      // ========================================================
      if (currentMode === "WAVEFORM") {
        const history = historyRef.current;
        if (history.length > 1) {
          // Compute scale
          let minVal = 0;
          let maxVal = 25;
          history.forEach((pt) => {
            if (pt.val < minVal) minVal = pt.val;
            if (pt.val > maxVal) maxVal = pt.val;
          });
          const valRange = Math.max(maxVal - minVal, 10);
          const paddingY = 40;
          const usableH = h - paddingY * 2;

          const getY = (val: number) => {
            const normalized = (val - minVal) / valRange;
            return h - paddingY - normalized * usableH;
          };

          const stepX = w / (history.length - 1);

          // Threshold guide: +12 bps Harvest Target
          const harvestY = getY(12);
          ctx.strokeStyle = "rgba(16, 185, 129, 0.45)";
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(0, harvestY);
          ctx.lineTo(w, harvestY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = "rgba(16, 185, 129, 0.75)";
          ctx.font = "10px monospace";
          ctx.fillText("HARVEST ZONE (+12 bps)", 12, harvestY - 4);

          // Threshold guide: +2 bps Exit Target
          const exitY = getY(2);
          ctx.strokeStyle = "rgba(6, 182, 212, 0.45)";
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, exitY);
          ctx.lineTo(w, exitY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = "rgba(6, 182, 212, 0.75)";
          ctx.font = "10px monospace";
          ctx.fillText("CONVERGENCE EXIT (<2 bps)", 12, exitY + 12);

          // Draw Gradient Area under curve
          const areaGrad = ctx.createLinearGradient(0, paddingY, 0, h - paddingY);
          areaGrad.addColorStop(0, "rgba(245, 158, 11, 0.35)");
          areaGrad.addColorStop(0.6, "rgba(245, 158, 11, 0.08)");
          areaGrad.addColorStop(1, "rgba(245, 158, 11, 0.0)");

          ctx.beginPath();
          ctx.moveTo(0, getY(history[0].val));
          for (let i = 1; i < history.length; i++) {
            const prevX = (i - 1) * stepX;
            const prevY = getY(history[i - 1].val);
            const currX = i * stepX;
            const currY = getY(history[i].val);
            const midX = (prevX + currX) / 2;
            ctx.bezierCurveTo(midX, prevY, midX, currY, currX, currY);
          }
          ctx.lineTo(w, h);
          ctx.lineTo(0, h);
          ctx.closePath();
          ctx.fillStyle = areaGrad;
          ctx.fill();

          // Draw Glowing Waveform Line
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 2.5;
          ctx.shadowColor = "#f59e0b";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(0, getY(history[0].val));
          for (let i = 1; i < history.length; i++) {
            const prevX = (i - 1) * stepX;
            const prevY = getY(history[i - 1].val);
            const currX = i * stepX;
            const currY = getY(history[i].val);
            const midX = (prevX + currX) / 2;
            ctx.bezierCurveTo(midX, prevY, midX, currY, currX, currY);
          }
          ctx.stroke();
          ctx.shadowBlur = 0; // Reset shadow

          // Leading edge cursor & expanding ripple blip
          const lastX = (history.length - 1) * stepX;
          const lastY = getY(history[history.length - 1].val);

          // Pulse ring
          const rippleRadius = (frame % 45) * 0.45;
          const rippleAlpha = Math.max(0, 1 - rippleRadius / 20);
          ctx.strokeStyle = `rgba(245, 158, 11, ${rippleAlpha})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(lastX, lastY, rippleRadius, 0, Math.PI * 2);
          ctx.stroke();

          // Center solid dot
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ========================================================
      // MODE 2: INTER-LEG ORDER FLOW & CASH FLOW BRIDGE
      // ========================================================
      else if (currentMode === "BRIDGE") {
        const leftX = 80;
        const rightX = w - 80;
        const centerY = h / 2;

        // Exchange Node 1: Binance (Amber)
        const nodeW = 100;
        const nodeH = 70;
        ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(245, 158, 11, 0.4)";
        ctx.shadowBlur = 12;
        ctx.strokeRect(leftX - nodeW / 2, centerY - nodeH / 2, nodeW, nodeH);
        ctx.fillRect(leftX - nodeW / 2, centerY - nodeH / 2, nodeW, nodeH);
        ctx.shadowBlur = 0;

        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText("BINANCE USD-M", leftX, centerY - 14);
        ctx.fillStyle = "#f4f4f5";
        ctx.font = "10px monospace";
        const bnPriceText = markPriceBnRef.current > 0 ? `$${markPriceBnRef.current.toFixed(1)}` : "SYNCING";
        ctx.fillText(bnPriceText, leftX, centerY + 4);
        ctx.fillStyle = "#10b981";
        ctx.font = "9px monospace";
        ctx.fillText(`Rate: +${((fundingRateBnRef.current || 0.0001) * 100).toFixed(4)}%`, leftX, centerY + 20);

        // Exchange Node 2: Bitget (Emerald/Cyan)
        ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(16, 185, 129, 0.4)";
        ctx.shadowBlur = 12;
        ctx.strokeRect(rightX - nodeW / 2, centerY - nodeH / 2, nodeW, nodeH);
        ctx.fillRect(rightX - nodeW / 2, centerY - nodeH / 2, nodeW, nodeH);
        ctx.shadowBlur = 0;

        ctx.fillStyle = "#10b981";
        ctx.font = "bold 11px monospace";
        ctx.fillText("BITGET V3 PERP", rightX, centerY - 14);
        ctx.fillStyle = "#f4f4f5";
        ctx.font = "10px monospace";
        const bgPriceText = markPriceBgRef.current > 0 ? `$${markPriceBgRef.current.toFixed(1)}` : "SYNCING";
        ctx.fillText(bgPriceText, rightX, centerY + 4);
        ctx.fillStyle = "#06b6d4";
        ctx.font = "9px monospace";
        ctx.fillText(`Rate: +${((fundingRateBgRef.current || 0.0002) * 100).toFixed(4)}%`, rightX, centerY + 20);

        // Connecting Conduit Lines
        const lanesY = [centerY - 16, centerY, centerY + 16];
        lanesY.forEach((laneY, idx) => {
          ctx.strokeStyle = idx === 1 ? "rgba(245, 158, 11, 0.5)" : "rgba(39, 39, 42, 0.7)";
          ctx.lineWidth = idx === 1 ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(leftX + nodeW / 2, laneY);
          ctx.lineTo(rightX - nodeW / 2, laneY);
          ctx.stroke();
        });

        // Kinetic Particles flowing along bridge
        particles.forEach((p) => {
          p.progress += p.speed;
          if (p.progress > 1) p.progress = 0;

          const startX = leftX + nodeW / 2;
          const endX = rightX - nodeW / 2;
          const posX = startX + (endX - startX) * p.progress;
          const posY = lanesY[p.lane];

          ctx.fillStyle = p.lane === 0 ? "#f59e0b" : p.lane === 1 ? "#10b981" : "#06b6d4";
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(posX, posY, 2.8, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.shadowBlur = 0;

        // Central Delta-Neutral Nexus Badge
        const midX = (leftX + rightX) / 2;
        ctx.fillStyle = "#09090b";
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(midX, centerY, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Rotating outer ring around nexus
        const ringAngle = (frame * 0.02) % (Math.PI * 2);
        ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(midX, centerY, 37, ringAngle, ringAngle + Math.PI * 1.2);
        ctx.stroke();

        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 9px monospace";
        ctx.fillText("DELTA", midX, centerY - 6);
        ctx.fillStyle = "#10b981";
        ctx.fillText("NEUTRAL", midX, centerY + 6);
        ctx.fillStyle = "#71717a";
        ctx.font = "8px monospace";
        ctx.fillText("< 250ms", midX, centerY + 17);
      }

      // ========================================================
      // MODE 3: 8-HOUR FUNDING SETTLEMENT RADAR
      // ========================================================
      else if (currentMode === "RADAR") {
        const centerX = w / 2;
        const centerY = h / 2;
        const maxRadius = Math.min(centerX, centerY) - 25;

        // Concentric radar circles
        [0.25, 0.5, 0.75, 1.0].forEach((ratio, idx) => {
          ctx.strokeStyle = idx === 3 ? "rgba(16, 185, 129, 0.6)" : "rgba(39, 39, 42, 0.8)";
          ctx.lineWidth = idx === 3 ? 1.5 : 1;
          ctx.beginPath();
          ctx.arc(centerX, centerY, maxRadius * ratio, 0, Math.PI * 2);
          ctx.stroke();
        });

        // Crosshairs
        ctx.strokeStyle = "rgba(39, 39, 42, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX - maxRadius, centerY);
        ctx.lineTo(centerX + maxRadius, centerY);
        ctx.moveTo(centerX, centerY - maxRadius);
        ctx.lineTo(centerX, centerY + maxRadius);
        ctx.stroke();

        // Rotating radar sweep line
        const sweepAngle = (frame * 0.025) % (Math.PI * 2);
        const sweepX = centerX + Math.cos(sweepAngle) * maxRadius;
        const sweepY = centerY + Math.sin(sweepAngle) * maxRadius;

        // Sweep gradient cone
        const sweepGrad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, maxRadius);
        sweepGrad.addColorStop(0, "rgba(16, 185, 129, 0.2)");
        sweepGrad.addColorStop(1, "rgba(16, 185, 129, 0.0)");

        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#10b981";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(sweepX, sweepY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Spread blip on radar
        const spreadRadiusRatio = Math.min(Math.max((liveSpread || 10) / 30, 0.15), 0.95);
        const blipAngle = sweepAngle - 0.5;
        const blipX = centerX + Math.cos(blipAngle) * (maxRadius * spreadRadiusRatio);
        const blipY = centerY + Math.sin(blipAngle) * (maxRadius * spreadRadiusRatio);

        ctx.fillStyle = "#f59e0b";
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(blipX, blipY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Center readout
        ctx.fillStyle = "#09090b";
        ctx.beginPath();
        ctx.arc(centerX, centerY, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${fundingIntervalHoursRef.current || 8}H UTC`, centerX, centerY - 2);
        ctx.fillStyle = "#10b981";
        ctx.font = "8px monospace";
        ctx.fillText("RADAR", centerX, centerY + 9);
      }
    };

    render();

    // Resize handler
    const handleResize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const absSpread = Math.abs(spreadBps || 0);
  const payoutsPerDay = Math.round(24 / (fundingIntervalHours || 8));
  const apy = ((absSpread * payoutsPerDay * 365) / 100).toFixed(1);

  return (
    <div className="relative w-full h-[220px] sm:h-[280px] bg-[#0c0c0e] rounded-xl border border-border overflow-hidden font-mono group select-none flex flex-col justify-between">
      {/* 60FPS Canvas Layer */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Top Cyber-Editorial Navigation & Mode Switcher HUD */}
      <div className="relative z-10 flex items-center justify-between p-3 border-b border-zinc-800/60 bg-gradient-to-b from-[#09090b]/90 to-transparent">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-accent-amber animate-pulse" />
          <span className="text-[11px] font-bold text-zinc-100 uppercase tracking-wider">
            ARBITRAGE BASIS VISUALIZER // {symbol}
          </span>
          <span className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold hidden sm:inline ${
            absSpread >= 12
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              : "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
          }`}>
            {absSpread >= 12 ? "PRIME HARVEST WINDOW" : "ACTIVE CORRIDOR"}
          </span>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex items-center space-x-1 bg-zinc-900/90 p-0.5 rounded-lg border border-zinc-800">
          <button
            onClick={() => setMode("WAVEFORM")}
            className={`px-2 py-1 text-[10px] rounded font-semibold transition-all flex items-center space-x-1 ${
              mode === "WAVEFORM"
                ? "bg-amber-500/20 text-accent-amber border border-amber-500/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            title="Real-Time Rolling Spread Oscilloscope"
          >
            <Activity className="w-3 h-3" />
            <span className="hidden sm:inline">Spread Wave</span>
          </button>

          <button
            onClick={() => setMode("BRIDGE")}
            className={`px-2 py-1 text-[10px] rounded font-semibold transition-all flex items-center space-x-1 ${
              mode === "BRIDGE"
                ? "bg-cyan-500/20 text-accent-cyan border border-cyan-500/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            title="Dual-Exchange Kinetic Order Flow Bridge"
          >
            <Zap className="w-3 h-3" />
            <span className="hidden sm:inline">Order Flow</span>
          </button>

          <button
            onClick={() => setMode("RADAR")}
            className={`px-2 py-1 text-[10px] rounded font-semibold transition-all flex items-center space-x-1 ${
              mode === "RADAR"
                ? "bg-emerald-500/20 text-accent-emerald border border-emerald-500/40 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            title={`${fundingIntervalHours || 8}-Hour Funding Settlement Sweep Radar`}
          >
            <Clock className="w-3 h-3" />
            <span className="hidden sm:inline">{fundingIntervalHours || 8}H Radar</span>
          </button>
        </div>
      </div>

      {/* Bottom Telemetry Info & Playback Controls HUD */}
      <div className="relative z-10 flex items-center justify-between p-3 border-t border-zinc-800/60 bg-gradient-to-t from-[#09090b]/90 to-transparent text-[10px]">
        <div className="flex items-center space-x-3 text-zinc-400">
          <span className="flex items-center space-x-1">
            <span className="text-zinc-500">Live Basis:</span>
            <strong className="text-accent-amber font-mono font-bold">
              {(spreadBps || 0).toFixed(1)} bps
            </strong>
          </span>
          <span className="hidden sm:inline text-zinc-600">•</span>
          <span className="hidden sm:inline text-accent-emerald font-semibold">
            +{apy}% Run-Rate APR
          </span>
          <span className="hidden sm:inline text-zinc-600">•</span>
          <span className="hidden sm:inline text-zinc-400">
            {mode === "WAVEFORM"
              ? "60s Oscilloscope • Green = Entry Zone (>12 bps)"
              : mode === "BRIDGE"
              ? "Binance ⇄ Bitget Order Flow • Sub-250ms Stagger"
              : `${fundingIntervalHours || 8}H UTC Settlement Boundary Polar Radar`}
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors"
            title={isPaused ? "Resume Animation" : "Pause Animation"}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-accent-amber" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          {onToggleInspect && (
            <button
              onClick={onToggleInspect}
              className="px-2 py-0.5 text-[9px] rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
            >
              {isInspecting ? "Exit Mode" : "Expand"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
