"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  TrendingUp,
  Activity,
  Layers,
  Info,
  Maximize2,
  Crosshair,
  Sliders,
} from "lucide-react";

export interface DataPoint {
  timestamp: number;
  zScore: number;
  grossBasisBps: number;
  binancePrice: number;
  bybitPrice: number;
}

export interface ConvergenceZScoreChartProps {
  selectedPair?: string;
  onSelectPair?: (pair: string) => void;
  availablePairs?: string[];
  currentZScore?: number;
  currentBasisBps?: number;
}

// Generate realistic stochastic O-U trajectory for chart preview
function generateHistoricalTrajectory(
  canonical: string,
  initialZ: number,
  initialBasis: number,
  pointsCount = 60
): DataPoint[] {
  const points: DataPoint[] = [];
  const now = Date.now();
  const dtMs = 60 * 1000; // 1-minute steps

  let z = initialZ;
  let basis = initialBasis;
  const theta = 0.15;
  const sigma = 0.45;

  // Walk backwards from current time
  const trajectory: { z: number; basis: number }[] = [];
  trajectory.push({ z, basis });

  // Deterministic seed based on pair name
  let seed = 0;
  for (let i = 0; i < canonical.length; i++) {
    seed = (seed << 5) - seed + canonical.charCodeAt(i);
  }

  const pseudoRandom = (step: number) => {
    const x = Math.sin(seed + step * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1; // -1 to +1
  };

  for (let i = 1; i < pointsCount; i++) {
    const noise = pseudoRandom(i);
    // Reverse discrete O-U step
    z = z - (-theta * z * 0.1 + sigma * noise * 0.3);
    basis = z * 12.5;
    trajectory.unshift({ z, basis });
  }

  for (let i = 0; i < pointsCount; i++) {
    const t = now - (pointsCount - 1 - i) * dtMs;
    const pt = trajectory[i];
    const bPrice = 100 * (1 + (pt.basis / 20000));
    const byPrice = 100;
    points.push({
      timestamp: t,
      zScore: parseFloat(pt.z.toFixed(2)),
      grossBasisBps: parseFloat(pt.basis.toFixed(2)),
      binancePrice: bPrice,
      bybitPrice: byPrice,
    });
  }

  return points;
}

export default function ConvergenceZScoreChart({
  selectedPair = "PEPE",
  onSelectPair,
  availablePairs = ["PEPE", "BTC", "ETH", "SOL", "SATS", "NEAR", "SUI"],
  currentZScore = 2.34,
  currentBasisBps = 34.5,
}: ConvergenceZScoreChartProps) {
  const [mounted, setMounted] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"zScore" | "grossBasis">("zScore");
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Generate dynamic data points
  const dataPoints = useMemo(() => {
    return generateHistoricalTrajectory(selectedPair, currentZScore, currentBasisBps, 60);
  }, [selectedPair, currentZScore, currentBasisBps]);

  // Chart dimensions & coordinates
  const width = 800;
  const height = 240;
  const padLeft = 45;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  // Domain configuration
  const yMin = -3.5;
  const yMax = 3.5;

  const getX = (index: number) => {
    return padLeft + (index / (dataPoints.length - 1)) * plotWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    const normalized = (clamped - yMin) / (yMax - yMin);
    return padTop + (1 - normalized) * plotHeight;
  };

  // Pre-calculated horizontal threshold lines
  const yEntryUpper = getY(2.2); // +2.20 Entry (Short Binance / Long Bybit)
  const yEntryLower = getY(-2.2); // -2.20 Entry (Long Binance / Short Bybit)
  const yExitUpper = getY(0.35); // +0.35 Convergence Exit
  const yExitLower = getY(-0.35); // -0.35 Convergence Exit
  const yParity = getY(0.0); // 0.00 Parity Line

  // SVG Path generator
  const pathD = useMemo(() => {
    if (dataPoints.length === 0) return "";
    return dataPoints.reduce((acc, pt, idx) => {
      const x = getX(idx);
      const y = getY(viewMode === "zScore" ? pt.zScore : pt.grossBasisBps / 12.0);
      return idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }, "");
  }, [dataPoints, viewMode]);

  // Area under curve path
  const areaD = useMemo(() => {
    if (dataPoints.length === 0) return "";
    const firstX = getX(0);
    const lastX = getX(dataPoints.length - 1);
    return `${pathD} L ${lastX.toFixed(1)} ${yParity.toFixed(1)} L ${firstX.toFixed(1)} ${yParity.toFixed(1)} Z`;
  }, [pathD, yParity, dataPoints.length]);

  // Mouse interaction
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;
    const relativeX = svgX - padLeft;
    const index = Math.round((relativeX / plotWidth) * (dataPoints.length - 1));
    if (index >= 0 && index < dataPoints.length) {
      setHoverIndex(index);
    }
  };

  const activePoint = hoverIndex !== null && dataPoints[hoverIndex]
    ? dataPoints[hoverIndex]
    : dataPoints[dataPoints.length - 1];

  // Companion normal distribution bell curve calculation
  const bellWidth = 240;
  const bellHeight = 120;
  const bellPad = 15;
  const bellPlotW = bellWidth - bellPad * 2;
  const bellPlotH = bellHeight - bellPad * 2;

  const bellPointsCount = 50;
  const bellPath = useMemo(() => {
    let d = "";
    for (let i = 0; i <= bellPointsCount; i++) {
      const z = -3.5 + (i / bellPointsCount) * 7.0; // -3.5 to +3.5
      const density = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
      const maxDensity = 0.3989;
      const bx = bellPad + (i / bellPointsCount) * bellPlotW;
      const by = bellPad + (1 - density / maxDensity) * bellPlotH;
      d += i === 0 ? `M ${bx.toFixed(1)} ${by.toFixed(1)}` : ` L ${bx.toFixed(1)} ${by.toFixed(1)}`;
    }
    return d;
  }, [bellPlotW, bellPlotH]);

  // Current needle x on bell curve
  const currentNeedleX = useMemo(() => {
    const clampedZ = Math.max(-3.5, Math.min(3.5, currentZScore));
    return bellPad + ((clampedZ + 3.5) / 7.0) * bellPlotW;
  }, [currentZScore, bellPlotW]);

  const zEntryUpperBellX = bellPad + ((2.2 + 3.5) / 7.0) * bellPlotW;
  const zEntryLowerBellX = bellPad + ((-2.2 + 3.5) / 7.0) * bellPlotW;

  return (
    <div className="bg-[#18181c] border border-zinc-800 rounded-xl p-4 sm:p-5 shadow-xl shadow-black/50 font-mono">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-accent-amber">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
                Dynamic Ornstein-Uhlenbeck Z-Score & Basis Telemetry
              </h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-accent-amber border border-amber-500/30 font-bold">
                LIVE SDE
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Continuous Mean-Reversion Trajectory with Multi-Threshold Gating Corridor
            </p>
          </div>
        </div>

        {/* Pair selector & View toggles */}
        <div className="flex items-center space-x-2 self-end sm:self-auto">
          {/* Pair selector */}
          <div className="flex items-center space-x-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-xs">
            <span className="text-[10px] text-zinc-500 px-1.5">Pair:</span>
            <select
              value={selectedPair}
              onChange={(e) => onSelectPair && onSelectPair(e.target.value)}
              className="bg-transparent text-accent-amber font-bold text-xs focus:outline-none cursor-pointer pr-1"
            >
              {availablePairs.map((p) => (
                <option key={p} value={p} className="bg-zinc-900 text-zinc-200">
                  {p}/USDT
                </option>
              ))}
            </select>
          </div>

          {/* Metric View Mode Toggle */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-[11px]">
            <button
              onClick={() => setViewMode("zScore")}
              className={`px-2 py-0.5 rounded transition-all ${
                viewMode === "zScore"
                  ? "bg-amber-500/20 text-accent-amber font-bold border border-amber-500/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Z-Score (σ)
            </button>
            <button
              onClick={() => setViewMode("grossBasis")}
              className={`px-2 py-0.5 rounded transition-all ${
                viewMode === "grossBasis"
                  ? "bg-amber-500/20 text-accent-amber font-bold border border-amber-500/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Basis (bps)
            </button>
          </div>
        </div>
      </div>

      {/* Main Visualizer Area: Time Series SVG + Companion Normal Distribution Bell */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left 3 Cols: Responsive Time Series SVG */}
        <div className="lg:col-span-3 bg-[#0d0d10] border border-zinc-800/80 rounded-lg p-3 relative flex flex-col justify-between">
          {/* Interactive Hover Telemetry Pill */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1 text-[11px]">
            <div className="flex items-center space-x-3 text-zinc-400">
              <span>
                Timestamp:{" "}
                <span className="text-zinc-200 font-semibold">
                  {mounted && activePoint ? new Date(activePoint.timestamp).toLocaleTimeString() : "--:--:--"}
                </span>
              </span>
              <span>
                Corridor:{" "}
                <span className="text-cyan-400 font-bold">{selectedPair}/USDT</span>
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="flex items-center space-x-1">
                <span className="text-zinc-500">Z-Score:</span>
                <span
                  className={`font-bold ${
                    Math.abs(activePoint.zScore) >= 2.2
                      ? "text-amber-400"
                      : Math.abs(activePoint.zScore) <= 0.35
                      ? "text-cyan-400"
                      : "text-zinc-200"
                  }`}
                >
                  {activePoint.zScore > 0 ? `+${activePoint.zScore.toFixed(2)}` : activePoint.zScore.toFixed(2)}σ
                </span>
              </span>
              <span className="flex items-center space-x-1">
                <span className="text-zinc-500">Gross Basis:</span>
                <span className="text-emerald-400 font-bold">
                  +{activePoint.grossBasisBps.toFixed(1)} bps
                </span>
              </span>
            </div>
          </div>

          {/* SVG Canvas */}
          <div className="w-full overflow-hidden relative">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto select-none"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                {/* Area Gradient */}
                <linearGradient id="zScoreGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                  <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
                </linearGradient>

                {/* Exit Corridor Pattern */}
                <pattern id="cyanHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="8" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.15" />
                </pattern>
              </defs>

              {/* Grid Lines & Labels */}
              {[-3, -2, -1, 0, 1, 2, 3].map((val) => {
                const y = getY(val);
                return (
                  <g key={val}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="#27272a"
                      strokeWidth="1"
                      strokeDasharray={val === 0 ? "none" : "2 4"}
                    />
                    <text
                      x={padLeft - 6}
                      y={y + 3}
                      fill="#71717a"
                      fontSize="9"
                      textAnchor="end"
                      fontFamily="monospace"
                    >
                      {val > 0 ? `+${val}` : val}
                    </text>
                  </g>
                );
              })}

              {/* Distinct Exit Threshold Horizontal Band (+/- 0.35 sigma) */}
              <rect
                x={padLeft}
                y={yExitUpper}
                width={plotWidth}
                height={yExitLower - yExitUpper}
                fill="#06b6d4"
                fillOpacity="0.08"
                stroke="#06b6d4"
                strokeWidth="1"
                strokeDasharray="4 4"
                strokeOpacity="0.4"
              />
              <text
                x={width - padRight - 6}
                y={yExitUpper - 4}
                fill="#06b6d4"
                fontSize="8.5"
                textAnchor="end"
                fontWeight="bold"
              >
                +0.35σ CONVERGENCE EXIT
              </text>
              <text
                x={width - padRight - 6}
                y={yExitLower + 10}
                fill="#06b6d4"
                fontSize="8.5"
                textAnchor="end"
                fontWeight="bold"
              >
                -0.35σ CONVERGENCE EXIT
              </text>

              {/* Distinct Entry Threshold Horizontal Line (+2.20 sigma) */}
              <line
                x1={padLeft}
                y1={yEntryUpper}
                x2={width - padRight}
                y2={yEntryUpper}
                stroke="#f43f5e"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <text
                x={padLeft + 6}
                y={yEntryUpper - 4}
                fill="#f43f5e"
                fontSize="9"
                fontWeight="bold"
              >
                +2.20σ ENTRY GATE (SHORT BN / LONG BYBIT)
              </text>

              {/* Distinct Entry Threshold Horizontal Line (-2.20 sigma) */}
              <line
                x1={padLeft}
                y1={yEntryLower}
                x2={width - padRight}
                y2={yEntryLower}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <text
                x={padLeft + 6}
                y={yEntryLower + 11}
                fill="#10b981"
                fontSize="9"
                fontWeight="bold"
              >
                -2.20σ ENTRY GATE (LONG BN / SHORT BYBIT)
              </text>

              {/* Parity Line (0.00) */}
              <line
                x1={padLeft}
                y1={yParity}
                x2={width - padRight}
                y2={yParity}
                stroke="#52525b"
                strokeWidth="1"
                strokeDasharray="3 3"
              />

              {/* Area fill under curve */}
              <path d={areaD} fill="url(#zScoreGrad)" />

              {/* Dynamic trajectory line */}
              <path
                d={pathD}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Hover Crosshair & Dot */}
              {hoverIndex !== null && (
                <g>
                  <line
                    x1={getX(hoverIndex)}
                    y1={padTop}
                    x2={getX(hoverIndex)}
                    y2={height - padBottom}
                    stroke="#a1a1aa"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <circle
                    cx={getX(hoverIndex)}
                    y={getY(viewMode === "zScore" ? activePoint.zScore : activePoint.grossBasisBps / 12.0)}
                    r="5"
                    fill="#f59e0b"
                    stroke="#ffffff"
                    strokeWidth="2"
                    className="animate-pulse"
                  />
                </g>
              )}

              {/* Pulsing latest point marker */}
              {hoverIndex === null && dataPoints.length > 0 && (
                <g>
                  <circle
                    cx={getX(dataPoints.length - 1)}
                    y={getY(viewMode === "zScore" ? activePoint.zScore : activePoint.grossBasisBps / 12.0)}
                    r="6"
                    fill="#f59e0b"
                    fillOpacity="0.4"
                    className="animate-ping"
                  />
                  <circle
                    cx={getX(dataPoints.length - 1)}
                    y={getY(viewMode === "zScore" ? activePoint.zScore : activePoint.grossBasisBps / 12.0)}
                    r="4"
                    fill="#f59e0b"
                    stroke="#09090b"
                    strokeWidth="1.5"
                  />
                </g>
              )}
            </svg>
          </div>

          {/* Time axis legend */}
          <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1 pt-1 border-t border-zinc-800/60 mt-1">
            <span>T - 60 mins</span>
            <span>T - 30 mins</span>
            <span>T - 15 mins</span>
            <span className="text-accent-amber font-semibold">T (Now)</span>
          </div>
        </div>

        {/* Right 1 Col: Companion Normal Distribution Bell Curve Preview */}
        <div className="lg:col-span-1 bg-[#0d0d10] border border-zinc-800/80 rounded-lg p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider flex items-center space-x-1">
                <Info className="w-3 h-3 text-cyan-400" />
                <span>O-U Density</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-bold border border-cyan-500/20">
                GAUSSIAN
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2">
              Theoretical stationary standard normal distribution of normalized basis spread.
            </p>

            {/* Bell Curve Mini SVG */}
            <div className="w-full flex justify-center py-1">
              <svg viewBox={`0 0 ${bellWidth} ${bellHeight}`} className="w-full max-w-[220px] h-auto">
                {/* Shaded Entry Tail Regions (Left and Right |z| >= 2.2) */}
                <rect
                  x={bellPad}
                  y={bellPad}
                  width={zEntryLowerBellX - bellPad}
                  height={bellPlotH}
                  fill="#10b981"
                  fillOpacity="0.15"
                />
                <rect
                  x={zEntryUpperBellX}
                  y={bellPad}
                  width={bellWidth - bellPad - zEntryUpperBellX}
                  height={bellPlotH}
                  fill="#f43f5e"
                  fillOpacity="0.15"
                />

                {/* Shaded Exit Core Region (|z| <= 0.35) */}
                <rect
                  x={bellPad + (( -0.35 + 3.5) / 7.0) * bellPlotW}
                  y={bellPad}
                  width={(0.7 / 7.0) * bellPlotW}
                  height={bellPlotH}
                  fill="#06b6d4"
                  fillOpacity="0.18"
                />

                {/* Base Grid Line */}
                <line
                  x1={bellPad}
                  y1={bellHeight - bellPad}
                  x2={bellWidth - bellPad}
                  y2={bellHeight - bellPad}
                  stroke="#3f3f46"
                  strokeWidth="1"
                />

                {/* Entry threshold vertical markers */}
                <line
                  x1={zEntryLowerBellX}
                  y1={bellPad}
                  x2={zEntryLowerBellX}
                  y2={bellHeight - bellPad}
                  stroke="#10b981"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <line
                  x1={zEntryUpperBellX}
                  y1={bellPad}
                  x2={zEntryUpperBellX}
                  y2={bellHeight - bellPad}
                  stroke="#f43f5e"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />

                {/* Bell Curve Path */}
                <path
                  d={bellPath}
                  fill="none"
                  stroke="#a1a1aa"
                  strokeWidth="1.8"
                />

                {/* Dynamic Current Z-Score Needle */}
                <line
                  x1={currentNeedleX}
                  y1={bellPad - 4}
                  x2={currentNeedleX}
                  y2={bellHeight - bellPad}
                  stroke="#f59e0b"
                  strokeWidth="2.2"
                />
                <circle
                  cx={currentNeedleX}
                  y={bellPad - 4}
                  r="3.5"
                  fill="#f59e0b"
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              </svg>
            </div>

            {/* Sigma Axis Labels */}
            <div className="flex items-center justify-between text-[9px] text-zinc-500 px-2 mt-1">
              <span>-3σ</span>
              <span>-2.2σ</span>
              <span className="text-cyan-400 font-bold">0</span>
              <span>+2.2σ</span>
              <span>+3σ</span>
            </div>
          </div>

          {/* Current Z-Score Status Card */}
          <div className="mt-3 pt-2.5 border-t border-zinc-800/80 space-y-1 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Current Position:</span>
              <span className="text-accent-amber font-bold">
                {currentZScore > 0 ? `+${currentZScore.toFixed(2)}` : currentZScore.toFixed(2)}σ
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Probability Zone:</span>
              <span
                className={`font-semibold ${
                  Math.abs(currentZScore) >= 2.2
                    ? "text-emerald-400"
                    : Math.abs(currentZScore) <= 0.35
                    ? "text-cyan-400"
                    : "text-zinc-400"
                }`}
              >
                {Math.abs(currentZScore) >= 2.2
                  ? "EXTREME TAIL (≥2.2σ)"
                  : Math.abs(currentZScore) <= 0.35
                  ? "EQUILIBRIUM CORRIDOR"
                  : "DRIFTING"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
