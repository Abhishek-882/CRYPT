"use client";

import React, { useState, useMemo } from "react";
import { DivergenceCandidate } from "@/lib/divergence/types";
import { Zap, Crosshair, HelpCircle, Eye, Info } from "lucide-react";

export interface DispersionRadarProps {
  candidates: DivergenceCandidate[];
  selectedCandidate?: DivergenceCandidate | null;
  onSelectCandidate: (candidate: DivergenceCandidate) => void;
  isLoading?: boolean;
}

export default function DispersionRadar({
  candidates = [],
  selectedCandidate = null,
  onSelectCandidate,
  isLoading = false,
}: DispersionRadarProps) {
  const [hoveredCandidate, setHoveredCandidate] = useState<DivergenceCandidate | null>(null);

  // SVG Chart Dimensions
  const width = 800;
  const height = 450;
  const padding = { top: 30, right: 30, bottom: 45, left: 55 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // Chart Coordinate Scales
  // X: Current Basis bt% (e.g. -0.50% to +0.50%)
  const minX = -0.5;
  const maxX = 0.5;

  // Y: 24h Dispersion Delta b 24h% (e.g. 0.0% to 1.2%)
  const minY = 0.0;
  const maxY = 1.2;

  const scaleX = (val: number) => {
    const clamped = Math.max(minX, Math.min(maxX, val));
    return padding.left + ((clamped - minX) / (maxX - minX)) * innerWidth;
  };

  const scaleY = (val: number) => {
    const clamped = Math.max(minY, Math.min(maxY, val));
    return padding.top + innerHeight - ((clamped - minY) / (maxY - minY)) * innerHeight;
  };

  // Prime Expansion Zone Dimensions in SVG units
  // |bt| <= 0.100%, Delta b >= 0.400%
  const primeZone = useMemo(() => {
    const x1 = scaleX(-0.1);
    const x2 = scaleX(0.1);
    const yTop = scaleY(maxY);
    const yBottom = scaleY(0.4);
    return {
      x: x1,
      y: yTop,
      width: x2 - x1,
      height: yBottom - yTop,
    };
  }, [innerWidth, innerHeight]);

  // Candidates categorized by quadrant
  const primeCandidates = useMemo(
    () =>
      candidates.filter(
        (c) =>
          Math.abs(c.liveBasisPercent) <= 0.1 && c.dispersion24hPercent >= 0.4
      ),
    [candidates]
  );

  return (
    <div className="w-full rounded-2xl bg-zinc-950/80 border border-border/80 backdrop-blur-xl p-4 font-mono shadow-xl flex flex-col space-y-3">
      {/* Header & Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Crosshair className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-zinc-100 uppercase tracking-wider flex items-center space-x-2">
              <span>DISPERSION RADAR</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                {"// COILED-SPRING BASIS EXPANSION MAP"}
              </span>
            </h2>
            <p className="text-[11px] text-zinc-400">
              Interactive 2D space: Current Basis (X) vs 24h Dispersion Volatility (Y)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-accent-emerald text-[11px]">
            <span className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
            <span>PRIME COILED: {primeCandidates.length}</span>
          </div>
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-[11px]">
            <span>TOTAL PAIRS: {candidates.length}</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div className="relative w-full aspect-[16/9] min-h-[340px] max-h-[460px] bg-zinc-950 rounded-xl overflow-hidden border border-zinc-900 flex items-center justify-center">
        {isLoading && candidates.length === 0 ? (
          <div className="flex flex-col items-center space-y-2 text-zinc-500">
            <Zap className="w-6 h-6 animate-spin text-accent-amber" />
            <span className="text-xs">Scanning 670+ crypto perpetual pairs...</span>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full select-none"
          >
            <defs>
              <radialGradient id="primeGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
              </radialGradient>
              <pattern
                id="radarGrid"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="#27272a"
                  strokeWidth="0.5"
                  strokeOpacity="0.4"
                />
              </pattern>
            </defs>

            {/* Background Grid */}
            <rect
              x={padding.left}
              y={padding.top}
              width={innerWidth}
              height={innerHeight}
              fill="url(#radarGrid)"
            />

            {/* Prime Expansion Target Zone (|bt| <= 0.100%, Delta b >= 0.400%) */}
            <rect
              x={primeZone.x}
              y={primeZone.y}
              width={primeZone.width}
              height={primeZone.height}
              fill="url(#primeGlow)"
              stroke="#10b981"
              strokeWidth="1.2"
              strokeDasharray="4 2"
              strokeOpacity="0.8"
            />
            <text
              x={primeZone.x + primeZone.width / 2}
              y={primeZone.y + 18}
              fill="#10b981"
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              className="tracking-wider uppercase"
            >
              PRIME EXPANSION ZONE (|b| ≤ 0.100%, Δb ≥ 0.400%)
            </text>

            {/* Threshold Line: Delta b 24h = 0.400% */}
            <line
              x1={padding.left}
              y1={scaleY(0.4)}
              x2={padding.left + innerWidth}
              y2={scaleY(0.4)}
              stroke="#f59e0b"
              strokeWidth="1"
              strokeDasharray="3 3"
              strokeOpacity="0.7"
            />
            <text
              x={padding.left + innerWidth - 5}
              y={scaleY(0.4) - 4}
              fill="#f59e0b"
              fontSize="9"
              textAnchor="end"
              fontWeight="600"
            >
              Expansion Threshold: 0.400%
            </text>

            {/* Parity Line (bt = 0.000%) */}
            <line
              x1={scaleX(0.0)}
              y1={padding.top}
              x2={scaleX(0.0)}
              y2={padding.top + innerHeight}
              stroke="#38bdf8"
              strokeWidth="1.2"
              strokeOpacity="0.5"
            />
            <text
              x={scaleX(0.0)}
              y={padding.top + innerHeight + 14}
              fill="#38bdf8"
              fontSize="9"
              textAnchor="middle"
              fontWeight="bold"
            >
              Parity (0.00%)
            </text>

            {/* Horizontal Axis Ticks (Current Basis bt%) */}
            {[-0.4, -0.2, 0.2, 0.4].map((tick) => (
              <g key={`xtick-${tick}`}>
                <line
                  x1={scaleX(tick)}
                  y1={padding.top + innerHeight}
                  x2={scaleX(tick)}
                  y2={padding.top + innerHeight + 4}
                  stroke="#52525b"
                  strokeWidth="1"
                />
                <text
                  x={scaleX(tick)}
                  y={padding.top + innerHeight + 14}
                  fill="#71717a"
                  fontSize="9"
                  textAnchor="middle"
                >
                  {tick > 0 ? `+${tick.toFixed(1)}%` : `${tick.toFixed(1)}%`}
                </text>
              </g>
            ))}

            {/* Vertical Axis Ticks (24h Dispersion Delta b%) */}
            {[0.2, 0.6, 0.8, 1.0].map((tick) => (
              <g key={`ytick-${tick}`}>
                <line
                  x1={padding.left - 4}
                  y1={scaleY(tick)}
                  x2={padding.left}
                  y2={scaleY(tick)}
                  stroke="#52525b"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 7}
                  y={scaleY(tick) + 3}
                  fill="#71717a"
                  fontSize="9"
                  textAnchor="end"
                >
                  {tick.toFixed(1)}%
                </text>
              </g>
            ))}

            {/* Axis Titles */}
            <text
              x={padding.left + innerWidth / 2}
              y={height - 8}
              fill="#a1a1aa"
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              className="tracking-wider uppercase"
            >
              Current Relative Basis bt (%)
            </text>

            <text
              x={14}
              y={padding.top + innerHeight / 2}
              fill="#a1a1aa"
              fontSize="10"
              fontWeight="bold"
              textAnchor="middle"
              transform={`rotate(-90 14 ${padding.top + innerHeight / 2})`}
              className="tracking-wider uppercase"
            >
              24h Dispersion Volatility Δb24h (%)
            </text>

            {/* Candidate Scatter Points */}
            {candidates.map((c) => {
              const cx = scaleX(c.liveBasisPercent);
              const cy = scaleY(c.dispersion24hPercent);
              const isPrime =
                Math.abs(c.liveBasisPercent) <= 0.1 &&
                c.dispersion24hPercent >= 0.4;
              const isSelected =
                selectedCandidate?.canonicalSymbol === c.canonicalSymbol;
              const isHovered =
                hoveredCandidate?.canonicalSymbol === c.canonicalSymbol;

              let fillColor = "#71717a";
              let strokeColor = "#3f3f46";
              let radius = 3.5;

              if (isPrime) {
                fillColor = "#10b981";
                strokeColor = "#059669";
                radius = isSelected ? 6.5 : 5.0;
              } else if (c.dispersion24hPercent >= 0.4) {
                fillColor = "#f59e0b";
                strokeColor = "#d97706";
                radius = 4.0;
              }

              if (isSelected) {
                strokeColor = "#38bdf8";
                radius = 7.0;
              }

              return (
                <g
                  key={c.canonicalSymbol}
                  className="cursor-pointer transition-transform duration-200"
                  onClick={() => onSelectCandidate(c)}
                  onMouseEnter={() => setHoveredCandidate(c)}
                  onMouseLeave={() => setHoveredCandidate(null)}
                >
                  {/* Outer pulse ring for Prime or Selected */}
                  {(isPrime || isSelected) && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius + 3}
                      fill="none"
                      stroke={isSelected ? "#38bdf8" : "#10b981"}
                      strokeWidth="1.2"
                      opacity={isSelected ? "0.9" : "0.5"}
                      strokeDasharray={isPrime ? "2 2" : undefined}
                    />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth="1"
                  />
                  {/* Symbol Label for Prime or Selected or Hovered */}
                  {(isPrime || isSelected || isHovered) && (
                    <text
                      x={cx}
                      y={cy - radius - 3}
                      fill={
                        isSelected
                          ? "#38bdf8"
                          : isPrime
                          ? "#10b981"
                          : "#f59e0b"
                      }
                      fontSize="9"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {c.canonicalSymbol}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Floating Tooltip Card */}
        {hoveredCandidate && (
          <div className="absolute top-3 right-3 p-3 rounded-xl bg-zinc-950/95 border border-zinc-700 shadow-2xl backdrop-blur-md pointer-events-none text-xs space-y-1.5 z-20 max-w-[240px]">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1">
              <span className="font-black text-zinc-100 flex items-center space-x-1.5">
                <span className="text-accent-amber">
                  {hoveredCandidate.canonicalSymbol}
                </span>
                <span className="text-[10px] text-zinc-500">/ USDT</span>
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                  Math.abs(hoveredCandidate.liveBasisPercent) <= 0.1 &&
                  hoveredCandidate.dispersion24hPercent >= 0.4
                    ? "bg-emerald-500/20 text-accent-emerald border border-emerald-500/40"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {Math.abs(hoveredCandidate.liveBasisPercent) <= 0.1 &&
                hoveredCandidate.dispersion24hPercent >= 0.4
                  ? "PRIME COILED"
                  : "UNQUALIFIED"}
              </span>
            </div>
            <div className="text-[11px] space-y-0.5 text-zinc-300">
              <div className="flex justify-between">
                <span className="text-zinc-500">Current Basis:</span>
                <span
                  className={
                    hoveredCandidate.liveBasisPercent >= 0
                      ? "text-accent-emerald font-bold"
                      : "text-red-400 font-bold"
                  }
                >
                  {hoveredCandidate.liveBasisPercent >= 0 ? "+" : ""}
                  {hoveredCandidate.liveBasisPercent.toFixed(3)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">24h Dispersion:</span>
                <span className="text-cyan-400 font-bold">
                  {hoveredCandidate.dispersion24hPercent.toFixed(3)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">DDI Score:</span>
                <span className="text-accent-amber font-bold">
                  {hoveredCandidate.ddi24h.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Direction:</span>
                <span className="text-zinc-200">
                  {hoveredCandidate.suggestedDirection === "LONG_BN_SHORT_BYB" || hoveredCandidate.suggestedDirection === "LONG_BINANCE_SHORT_BYBIT"
                    ? "Long BN / Short BYB"
                    : "Short BN / Long BYB"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Projected Alpha:</span>
                <span
                  className={
                    hoveredCandidate.netAlphaProjectedPercent >= 0
                      ? "text-accent-emerald font-bold"
                      : "text-red-400 font-bold"
                  }
                >
                  {hoveredCandidate.netAlphaProjectedPercent >= 0 ? "+" : ""}
                  {hoveredCandidate.netAlphaProjectedPercent.toFixed(4)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend & Guide Footer */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-400 pt-1 gap-2">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-emerald" />
            <span>Prime Coiled Candidate (|b| ≤ 0.100%, Δb ≥ 0.400%)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-amber" />
            <span>High Dispersion Only (Extended Spread)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
            <span>Compressed / Low Vol</span>
          </div>
        </div>
        <div className="text-zinc-500 flex items-center space-x-1">
          <Info className="w-3 h-3 text-zinc-500" />
          <span>Click any node to select candidate for deployment analysis</span>
        </div>
      </div>
    </div>
  );
}
