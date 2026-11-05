import React from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Terminal, Bot, Home, History, AlertTriangle, ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <Navbar />

      <main className="flex-1 flex flex-col items-center justify-center p-4 relative text-center">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a15_1px,transparent_1px),linear-gradient(to_bottom,#27272a15_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none -z-10" />

        <div className="max-w-md w-full bg-[#121215] border border-zinc-800 rounded-2xl p-8 shadow-2xl space-y-6 relative z-10">
          {/* Badge */}
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>ERROR 404 // STATUS NOT_FOUND</span>
          </div>

          {/* ASCII / Monospace Error Display */}
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-zinc-100">
              Vector Unreachable
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              The requested trading route, order identifier, or contract matrix does not exist in the active liquidity corridors.
            </p>
          </div>

          {/* Glitch Code Block */}
          <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80 text-[11px] text-zinc-400 font-mono text-left space-y-1">
            <div>
              <span className="text-zinc-600">&gt; </span>
              <span className="text-rose-400">RESOLUTION_FAILED</span>: 0x404_NULL_POINTER
            </div>
            <div>
              <span className="text-zinc-600">&gt; </span>
              <span>PARITY_ENGINE</span>: 0 mutual order legs identified
            </div>
            <div>
              <span className="text-zinc-600">&gt; </span>
              <span className="text-accent-amber">FALLBACK_ACTION</span>: Route recovery advised
            </div>
          </div>

          {/* Recovery Actions */}
          <div className="space-y-2.5 pt-2">
            <Link
              href="/terminal"
              className="w-full py-3 px-4 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-amber-500/10 active:scale-95"
            >
              <Terminal className="w-4 h-4" />
              <span>Return to Trading Terminal</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/bot"
                className="py-2.5 px-3 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold transition-colors flex items-center justify-center space-x-1.5 active:scale-95"
              >
                <Bot className="w-3.5 h-3.5 text-accent-cyan" />
                <span>Auto-Bot</span>
              </Link>

              <Link
                href="/history"
                className="py-2.5 px-3 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold transition-colors flex items-center justify-center space-x-1.5 active:scale-95"
              >
                <History className="w-3.5 h-3.5 text-accent-emerald" />
                <span>Ledger</span>
              </Link>
            </div>

            <Link
              href="/"
              className="inline-flex items-center space-x-1 text-xs text-zinc-500 hover:text-zinc-300 pt-1 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Back to Overview Homepage</span>
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
