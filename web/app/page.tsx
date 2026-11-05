"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AmbientHeroShader from "@/components/AmbientHeroShader";
import ThreeParticleCanvas from "@/components/ThreeParticleCanvas";
import IntroVideoPlayer from "@/components/IntroVideoPlayer";
import BentoInfrastructureGrid from "@/components/BentoInfrastructureGrid";
import AOS from "aos";
import { animate, spring } from "animejs";
import {
  TrendingUp,
  ArrowRight,
  Radio,
  Lock,
  Clock,
  Terminal,
  Activity,
  ChevronRight,
  ShieldCheck,
  Server,
  Zap,
  Cpu,
  Layers,
  Scale,
} from "lucide-react";

export default function IntroPage() {
  const [user, setUser] = useState<{ email: string; role: string; username: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.isLoggedIn && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {});

    // Refresh scroll animations once layout stabilizes
    const t1 = setTimeout(() => {
      AOS.refresh();
    }, 400);
    const t2 = setTimeout(() => {
      AOS.refreshHard();
    }, 1200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Anime.js tactile spring physics handlers
  const handleCtaMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    animate(e.currentTarget, {
      scale: 1.04,
      ease: spring({ bounce: 0.25, duration: 400 }),
    });
  };

  const handleCtaMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    animate(e.currentTarget, {
      scale: 1.0,
      ease: spring({ bounce: 0.25, duration: 400 }),
    });
  };

  const handleCardMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    animate(e.currentTarget, {
      scale: 1.02,
      y: -3,
      ease: spring({ bounce: 0.25, duration: 400 }),
    });
  };

  const handleCardMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    animate(e.currentTarget, {
      scale: 1.0,
      y: 0,
      ease: spring({ bounce: 0.25, duration: 400 }),
    });
  };

  const marketHighlights = [
    {
      symbol: "BTCUSDT",
      bnRate: "+0.0100%",
      bgRate: "+0.0245%",
      spread: "14.5 bps",
      apy: "15.9%",
      dir: "Short Binance • Long Bitget",
    },
    {
      symbol: "ETHUSDT",
      bnRate: "+0.0080%",
      bgRate: "+0.0215%",
      spread: "13.5 bps",
      apy: "14.8%",
      dir: "Short Binance • Long Bitget",
    },
    {
      symbol: "SOLUSDT",
      bnRate: "-0.0050%",
      bgRate: "+0.0185%",
      spread: "23.5 bps",
      apy: "25.7%",
      dir: "Short Binance • Long Bitget",
    },
    {
      symbol: "DOGEUSDT",
      bnRate: "+0.0120%",
      bgRate: "+0.0380%",
      spread: "26.0 bps",
      apy: "28.5%",
      dir: "Short Binance • Long Bitget",
    },
    {
      symbol: "SUIUSDT",
      bnRate: "+0.0150%",
      bgRate: "+0.0460%",
      spread: "31.0 bps",
      apy: "33.9%",
      dir: "Short Binance • Long Bitget",
    },
    {
      symbol: "NEARUSDT",
      bnRate: "+0.0090%",
      bgRate: "+0.0280%",
      spread: "19.0 bps",
      apy: "20.8%",
      dir: "Short Binance • Long Bitget",
    },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber overflow-x-hidden relative">
      <Navbar />

      {/* Top Institutional Status Ticker */}
      <div className="w-full bg-[#0c0c0f] border-b border-border/80 px-4 py-1.5 text-[10px] text-zinc-400 overflow-x-auto whitespace-nowrap scrollbar-none flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald animate__animated animate__pulse animate__infinite" />
            <span className="font-bold text-zinc-200">PRODUCTION ENGINE v2.5</span>
          </div>
          <span className="text-zinc-700">•</span>
          <div>
            VENUE A: <strong className="text-accent-amber font-mono">BINANCE USD-M</strong>
          </div>
          <span className="text-zinc-700">•</span>
          <div>
            VENUE B: <strong className="text-accent-cyan font-mono">BITGET V3 PERP</strong>
          </div>
          <span className="text-zinc-700">•</span>
          <div>
            VENUE C: <strong className="text-purple-400 font-mono">COINDCX FUTURES</strong>
          </div>
          <span className="text-zinc-700">•</span>
          <div>
            DAEMON: <strong className="text-accent-emerald font-mono animate__animated animate__pulse animate__infinite inline-block">24/7 BACKGROUND PERSISTENT</strong>
          </div>
        </div>

        <div className="hidden lg:flex items-center space-x-3 text-zinc-500">
          <span>SAFECOINER TECHNOLOGIES</span>
        </div>
      </div>

      <main className="flex-1 w-full pb-20 relative">
        {/* Ambient WebGPU Hero Shader & Three.js 60 FPS Particle Constellation */}
        <AmbientHeroShader />
        <ThreeParticleCanvas particleCount={110} />

        {/* Subtle Architectural Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a12_1px,transparent_1px),linear-gradient(to_bottom,#27272a12_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none -z-10" />

        {/* Hero Section */}
        <section data-aos="fade-up" className="max-w-5xl mx-auto px-4 md:px-8 pt-12 pb-14 md:pt-20 md:pb-16 text-center space-y-6">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-accent-amber text-[11px] font-bold tracking-wide">
            <span className="w-2 h-2 rounded-full bg-accent-emerald animate__animated animate__pulse animate__infinite" />
            <span>CROSS-EXCHANGE BASIS ARBITRAGE TERMINAL</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-zinc-100 max-w-4xl mx-auto leading-[1.12]">
            Capture Cross-Exchange Funding Rates with{" "}
            <span className="text-accent-amber underline decoration-amber-500/30 underline-offset-4">
              Simultaneous Hedging
            </span>
            .
          </h1>

          <p className="text-sm md:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            Automated funding rate arbitrage across <strong>Binance USD-M</strong>,{" "}
            <strong>Bitget Perpetuals</strong>, and <strong>CoinDCX Futures</strong>. Continuous multi-pair spread scanning, synchronized dual-order
            execution, and 24/7 autonomous server bot persistence.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
            <Link
              href="/terminal"
              onMouseEnter={handleCtaMouseEnter}
              onMouseLeave={handleCtaMouseLeave}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2.5 shadow-2xl shadow-amber-500/20 ring-1 ring-amber-400/50 hover:ring-amber-300 active:scale-95 group"
            >
              <Terminal className="w-4 h-4 text-zinc-950 group-hover:scale-110 transition-transform" />
              <span>{user ? "ENTER TRADING TERMINAL" : "LAUNCH ARBITRAGE TERMINAL"}</span>
              <ArrowRight className="w-4 h-4 text-zinc-950 group-hover:translate-x-1 transition-transform" />
            </Link>

            <Link
              href="/bot"
              className="w-full sm:w-auto px-6 py-4 rounded-xl bg-surface-card hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-zinc-700 text-xs font-bold transition-all flex items-center justify-center space-x-2 active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 text-accent-cyan" />
              <span>Autonomous 24/7 Bot</span>
            </Link>

            {!user && (
              <Link
                href="/login"
                className="w-full sm:w-auto px-5 py-4 rounded-xl bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 active:scale-95"
              >
                <Lock className="w-3.5 h-3.5 text-zinc-500" />
                <span>Sign In</span>
              </Link>
            )}
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            <span className="flex items-center space-x-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-accent-emerald" />
              <span>AES-256-GCM Vault At-Rest</span>
            </span>
            <span className="text-zinc-700">•</span>
            <span>Non-Custodial Multi-Tenant Engine</span>
            <span className="text-zinc-700">•</span>
            <span>Sub-Millisecond Execution</span>
          </div>
        </section>

        {/* Master Platform Walkthrough Intro Video */}
        <IntroVideoPlayer />

        {/* Live Opportunity Corridor Matrix */}
        <section className="max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-4">
          <div data-aos="fade-up" className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-accent-amber" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
                  Live Opportunity Corridor Matrix
                </h2>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Current funding rate divergence between Binance USD-M and Bitget Perpetual venues.
              </p>
            </div>

            <Link
              href="/terminal"
              className="text-xs font-semibold text-accent-amber hover:text-amber-300 flex items-center space-x-1 self-start sm:self-auto"
            >
              <span>Explore All 50+ Pairs in Terminal Scanner</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {marketHighlights.map((m, idx) => (
              <div
                key={m.symbol}
                data-aos="fade-up"
                data-aos-delay={((idx % 3) + 1) * 100}
                onMouseEnter={handleCardMouseEnter}
                onMouseLeave={handleCardMouseLeave}
                className="bg-surface/80 p-4 rounded-xl border border-border hover:border-zinc-700 transition-colors space-y-2 group cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-zinc-100">{m.symbol}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/20 font-bold">
                      {m.spread}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-zinc-500 text-[10px]">APR:</span>
                    <strong className="text-accent-emerald font-mono font-bold text-xs">{m.apy}</strong>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-800">
                    <div className="text-[9px] text-zinc-500 uppercase">Binance Rate</div>
                    <div className="font-mono font-bold text-zinc-200 mt-0.5">{m.bnRate}</div>
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded-lg border border-zinc-800">
                    <div className="text-[9px] text-zinc-500 uppercase">Bitget Rate</div>
                    <div className="font-mono font-bold text-accent-cyan mt-0.5">{m.bgRate}</div>
                  </div>
                </div>

                <div className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/60">
                  {m.dir}
                </div>
              </div>
            ))}
          </div>
        </section>


        {/* Institutional Bento Grid Feature Architecture (Aceternity UI Pattern) */}
        <BentoInfrastructureGrid />

        {/* Quantitative Methodology & Risks */}
        <section className="max-w-5xl mx-auto px-4 md:px-8 py-10 space-y-6">
          <div data-aos="fade-up" className="bg-surface/90 rounded-2xl border border-border p-6 md:p-8 space-y-6">
            <div className="flex items-center space-x-2 border-b border-zinc-800 pb-3">
              <Scale className="w-5 h-5 text-accent-amber" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
                Quantitative Methodology & Risk Management
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-zinc-400 leading-relaxed">
              <div data-aos="fade-up" data-aos-delay="100" className="space-y-2">
                <div className="font-bold text-zinc-200 uppercase text-[11px] flex items-center space-x-1">
                  <span className="text-accent-amber">01.</span>
                  <span>Basis Divergence</span>
                </div>
                <p>
                  Perpetual futures markets require funding fees to anchor derivative prices to spot index prices.
                  Because Binance and Bitget feature different trader imbalances, funding rates diverge by 10 to 30+ bps,
                  creating quantitative spread opportunities.
                </p>
              </div>

              <div data-aos="fade-up" data-aos-delay="200" className="space-y-2">
                <div className="font-bold text-zinc-200 uppercase text-[11px] flex items-center space-x-1">
                  <span className="text-accent-cyan">02.</span>
                  <span>Hedging Mechanics</span>
                </div>
                <p>
                  Taking a Short position on the higher-paying venue and an identical Long position on the lower-paying
                  venue offsets market price movements, enabling funding collection while maintaining balanced exposure.
                </p>
              </div>

              <div data-aos="fade-up" data-aos-delay="300" className="space-y-2">
                <div className="font-bold text-zinc-200 uppercase text-[11px] flex items-center space-x-1">
                  <span className="text-accent-emerald">03.</span>
                  <span>Execution & Risk Factors</span>
                </div>
                <p>
                  Real trading involves exchange slippage, API latency variation, and mark price divergence. The terminal
                  uses dynamic price-gap filters to avoid entering when venue prices are excessively disparate.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Launch CTA Strip */}
        <section data-aos="fade-up" className="max-w-4xl mx-auto px-4 md:px-8 py-14 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-zinc-100 tracking-tight">
            Launch Institutional Arbitrage
          </h2>

          <p className="text-xs sm:text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Real-time basis tables, 50-coin arbitrage matrix, millisecond order routing, 24/7 background server automation,
            and cryptographic trade history receipts.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/terminal"
              onMouseEnter={handleCtaMouseEnter}
              onMouseLeave={handleCtaMouseLeave}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs uppercase tracking-wider transition-colors shadow-xl shadow-amber-500/10 active:scale-95 flex items-center justify-center space-x-2"
            >
              <Terminal className="w-4 h-4" />
              <span>Launch Trading Terminal</span>
            </Link>

            <Link
              href="/login"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-surface hover:bg-zinc-800 text-zinc-200 border border-border text-xs font-semibold transition-all hover:border-zinc-700 active:scale-95 flex items-center justify-center space-x-2"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
