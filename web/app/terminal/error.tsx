"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, Terminal, Home } from "lucide-react";

function isChunkError(error: any): boolean {
  if (!error) return false;
  const name = String(error?.name || "");
  const msg = String(error?.message || "");
  return (
    name.includes("ChunkLoadError") ||
    msg.includes("ChunkLoadError") ||
    msg.includes("Loading chunk") ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Loading CSS chunk") ||
    msg.includes("CSS_CHUNK_LOAD_FAILED")
  );
}

function safeGetSession(key: string): string | null {
  try {
    return typeof window !== "undefined" ? sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetSession(key: string, val: string): void {
  try {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(key, val);
    }
  } catch {}
}

export default function TerminalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkError(error)) {
      const lastReload = safeGetSession("terminal_chunk_reload_ts");
      const now = Date.now();
      if (!lastReload || now - Number(lastReload) > 10000) {
        safeSetSession("terminal_chunk_reload_ts", String(now));
        window.location.reload();
      }
    }
    console.error("[Terminal ErrorBoundary caught]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-center p-6 font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <div className="max-w-md w-full bg-[#121215] border border-amber-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl text-center space-y-5">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-accent-amber">
          <Terminal className="w-7 h-7" />
        </div>
        <div>
          <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-accent-amber border border-amber-500/30 font-bold mb-2">
            <span>TERMINAL COCKPIT RECOVERY</span>
          </div>
          <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
            Arbitrage Terminal Notice
          </h2>
          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
            {error?.message || "A runtime desynchronization occurred while rendering the cockpit."}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
              else reset();
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors flex items-center justify-center space-x-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Terminal</span>
          </button>
          <Link
            href="/"
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold transition-colors flex items-center justify-center space-x-1.5"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Return Home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
