"use client";

import React from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ShieldCheck, ArrowRight, Zap, CheckCircle2 } from "lucide-react";

export default function HistoryDecommissionedPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono">
      <Navbar />

      <main className="flex-1 max-w-4xl mx-auto px-4 py-16 flex flex-col items-center justify-center text-center">
        <div className="p-4 rounded-full bg-emerald-950/40 border border-emerald-800/60 mb-6">
          <ShieldCheck className="w-12 h-12 text-emerald-400" />
        </div>

        <span className="px-3 py-1 rounded-full text-xs font-bold bg-cyan-950 text-cyan-400 border border-cyan-800/60 mb-4 tracking-wider uppercase">
          Invariant 8: Pure Real-Exchange Ledger Telemetry
        </span>

        <h1 className="text-3xl font-extrabold tracking-tight mb-4 text-white">
          History Route Decommissioned for Ground-Truth Auditing
        </h1>

        <p className="text-zinc-400 text-sm max-w-xl mb-8 leading-relaxed">
          The legacy history polling loop (1-second high-speed poll) has been deactivated. In accordance with Invariant 8, all completed trade receipts, exact execution commissions, fill prices, and net realized PnL are now sourced directly from live exchange ledgers and rendered in the <strong className="text-cyan-400">Convergence Execution Audit Table</strong>.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl mb-10 text-left">
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="text-[10px] text-zinc-500 uppercase font-semibold mb-1">Exchange Quota</div>
            <div className="text-lg font-bold text-emerald-400">99.0% Free</div>
            <div className="text-xs text-zinc-400">No 1-second poll loop</div>
          </div>
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="text-[10px] text-zinc-500 uppercase font-semibold mb-1">Telemetry Source</div>
            <div className="text-lg font-bold text-cyan-400">On-Exchange Ledgers</div>
            <div className="text-xs text-zinc-400">Zero formula estimates</div>
          </div>
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="text-[10px] text-zinc-500 uppercase font-semibold mb-1">Audit Stream</div>
            <div className="text-lg font-bold text-amber-400">24/7 Live Stream</div>
            <div className="text-xs text-zinc-400">Full lifecycle & error logs</div>
          </div>
        </div>

        <Link
          href="/convergence"
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold transition-all shadow-lg shadow-cyan-900/30 flex items-center space-x-2 text-sm"
        >
          <span>Open Convergence Audit Table</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </main>

      <Footer />
    </div>
  );
}
