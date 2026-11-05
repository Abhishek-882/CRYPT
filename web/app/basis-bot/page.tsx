"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShieldAlert,
  ArrowLeft,
  Lock,
  RefreshCw,
  Sparkles,
  Bot,
  Terminal,
  Activity,
  Layers,
  Zap,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BasisBotPanel from "@/components/BasisBotPanel";

export default function BasisBotPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isDenied, setIsDenied] = useState<boolean>(false);

  const verifyAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.isLoggedIn && data.user) {
        if (data.user.role === "admin") {
          setCurrentUser(data.user);
          setIsDenied(false);
        } else {
          // Explicit Non-Admin Block
          setIsDenied(true);
          setTimeout(() => {
            router.push("/bot");
          }, 3000);
        }
      } else {
        router.push("/login");
      }
    } catch {
      router.push("/login");
    } finally {
      setIsAuthLoading(false);
    }
  }, [router]);

  useEffect(() => {
    verifyAuth();
  }, [verifyAuth]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono">
        <Navbar />
        <main className="flex-1 flex flex-col items-center justify-center space-y-4">
          <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
          <div className="text-zinc-400 text-sm tracking-wider uppercase">
            Verifying Admin Session Security Gate...
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Non-Admin 403 Forbidden Screen
  if (isDenied) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md w-full p-6 bg-red-950/30 border border-red-500/40 rounded-2xl shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-black text-red-300 uppercase tracking-wider">
              HTTP 403: Forbidden
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This terminal is strictly restricted to administrative operators with full zero-bypass privileges.
              Redirecting you to the general cockpit...
            </p>
            <div className="pt-2">
              <Link
                href="/bot"
                className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Auto-Bot</span>
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-8 py-8 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/80 pb-5">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Link
                href="/bot"
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Back to Auto-Bot"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <h1 className="text-xl font-black tracking-wider text-zinc-100 uppercase flex items-center space-x-2">
                <span>Spot-Futures Basis & Funding Arbitrage</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  ADMIN ONLY
                </span>
              </h1>
            </div>
            <p className="text-xs text-zinc-400">
              QUANT-BASIS-CORE-v4 Institutional Cash-and-Carry on Bybit UTA & Cross-Exchange Funding Capture
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
              Target Hurdle: <strong className="text-amber-400">&ge; +1.0%</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
              OU Half-Life: <strong className="text-cyan-400">6.9h (BTC)</strong>
            </span>
          </div>
        </div>

        {/* Cockpit Panel */}
        {currentUser && <BasisBotPanel currentUser={currentUser} />}
      </main>

      <Footer />
    </div>
  );
}
