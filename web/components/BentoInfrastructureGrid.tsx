"use client";

import React from "react";
import { Layers, Zap, Cpu, ShieldCheck, ArrowRight, Lock } from "lucide-react";

export function BentoInfrastructureGrid() {
  return (
    <section className="max-w-6xl mx-auto px-4 md:px-8 py-12 space-y-6">
      <div data-aos="fade-up" className="text-center space-y-2 max-w-2xl mx-auto">
        <h2 className="text-xs font-bold uppercase tracking-widest text-accent-cyan">
          SYSTEM ARCHITECTURE // PRODUCTION SPEC
        </h2>
        <p className="text-2xl sm:text-3xl font-extrabold text-zinc-100 tracking-tight">
          Institutional Core Infrastructure
        </p>
        <p className="text-xs text-zinc-400">
          Engineered for continuous delta-neutral yield harvesting without directional price speculation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
        {/* Bento Card 1: 50+ Coin Multi-Asset Scanner (Col Span 2) */}
        <div
          data-aos="fade-up"
          data-aos-delay="100"
          className="group relative md:col-span-2 bg-gradient-to-br from-[#121217] via-[#0d0d10] to-[#08080a] p-6 md:p-8 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all duration-300 shadow-xl overflow-hidden"
        >
          {/* Radiant Spotlight Beam */}
          <div className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-transparent" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-accent-amber font-bold text-sm">
                <Layers className="w-5 h-5" />
              </div>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-500/10 text-accent-amber border border-amber-500/20 font-bold uppercase tracking-wider">
                Real-Time Scanner
              </span>
            </div>

            <h3 className="text-lg md:text-xl font-bold text-zinc-100 tracking-tight">
              Full-Universe Multi-Asset Arbitrage Matrix
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
              Simultaneously monitors cross-listed perpetual futures contracts across Binance USD-M,
              Bitget Perpetuals, and CoinDCX Futures. Automatically ranks spreads, calculates directional basis yield, and flags prime harvest
              opportunities in sub-200ms refresh cycles.
            </p>

            <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center gap-3 text-xs font-mono">
              <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                Binance: 740+
              </span>
              <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                Bitget: 830+
              </span>
              <span className="px-2 py-0.5 rounded bg-zinc-900 text-purple-400 border border-purple-900/40">
                CoinDCX: 505+
              </span>
              <span className="text-accent-emerald font-semibold">
                Tri-Exchange Arbitrage
              </span>
            </div>
          </div>
        </div>

        {/* Bento Card 2: Synchronized Lead-Lag Execution */}
        <div
          data-aos="fade-up"
          data-aos-delay="200"
          className="group relative bg-[#0e0e12] p-6 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all duration-300 shadow-xl overflow-hidden space-y-4"
        >
          <div className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-b from-cyan-500/10 to-transparent" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-800/40 flex items-center justify-center text-accent-cyan font-bold text-sm">
                <Zap className="w-5 h-5" />
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-accent-cyan border border-cyan-800/40 font-bold uppercase">
                Execution
              </span>
            </div>

            <h3 className="text-base font-bold text-zinc-100">
              Synchronized Dual-Leg Fills
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Dispatches dual Market/Limit orders via high-speed API routes to Binance and Bitget. Sub-millisecond stagger
              minimizes leg slippage between venues.
            </p>

            <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-800 flex items-center justify-between font-mono">
              <span>Execution Skew:</span>
              <span className="text-accent-cyan font-semibold">&lt; 180ms</span>
            </div>
          </div>
        </div>

        {/* Bento Card 3: 24/7 Autopilot Server Daemon */}
        <div
          data-aos="fade-up"
          data-aos-delay="300"
          className="group relative bg-[#0e0e12] p-6 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all duration-300 shadow-xl overflow-hidden space-y-4"
        >
          <div className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-b from-emerald-500/10 to-transparent" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-800/40 flex items-center justify-center text-accent-emerald font-bold text-sm">
                <Cpu className="w-5 h-5" />
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-accent-emerald border border-emerald-800/40 font-bold uppercase animate-pulse">
                Active Daemon
              </span>
            </div>

            <h3 className="text-base font-bold text-zinc-100">
              24/7 Autonomous Server Bot
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Continuous background daemon executing even when browser is offline. Evaluates spread targets, auto-enters
              widening basis, locks flattened pairs, and protects margin.
            </p>

            <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-800 flex items-center justify-between font-mono">
              <span>Persistence:</span>
              <span className="text-accent-emerald font-semibold">100% Background</span>
            </div>
          </div>
        </div>

        {/* Bento Card 4: Multi-Tenant Key Vault (Col Span 2) */}
        <div
          data-aos="fade-up"
          data-aos-delay="400"
          className="group relative md:col-span-2 bg-gradient-to-br from-[#121217] via-[#0d0d10] to-[#08080a] p-6 md:p-8 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-all duration-300 shadow-xl overflow-hidden"
        >
          <div className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-emerald-500/10 via-cyan-500/10 to-transparent" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-accent-emerald font-bold text-sm">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-accent-emerald border border-emerald-500/20 font-bold uppercase">
                Client Vault
              </span>
            </div>

            <h3 className="text-lg md:text-xl font-bold text-zinc-100 tracking-tight">
              Institutional Security & Blank Key Isolation
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-xl">
              Strict separation between administrator and trader quant accounts. Individual accounts start with
              100% blank API keys and configure their own isolated credentials. Keys are encrypted at rest with
              AES-256-GCM vault isolation and non-destructive masking.
            </p>

            <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center gap-3 text-xs font-mono">
              <span className="text-accent-amber font-semibold">Admin Account Isolated</span>
              <span className="text-zinc-600">•</span>
              <span className="text-accent-cyan font-semibold">Quant Vaults: AES-256-GCM</span>
              <span className="text-zinc-600">•</span>
              <span className="text-accent-emerald font-semibold">Zero Frontend Secrets</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default BentoInfrastructureGrid;
