"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, Home } from "lucide-react";

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

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkError(error)) {
      const lastReload = safeGetSession("chunk_reload_ts");
      const now = Date.now();
      if (!lastReload || now - Number(lastReload) > 10000) {
        safeSetSession("chunk_reload_ts", String(now));
        window.location.reload();
      }
    }
    console.error("[App ErrorBoundary caught]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-zinc-100 flex flex-col items-center justify-center p-6 font-mono">
      <div className="max-w-md w-full bg-[#121215] border border-zinc-800 rounded-2xl p-6 shadow-2xl text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-accent-rose">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
            Application Runtime Notice
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            {error?.message || "An unexpected error occurred while loading this view."}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
              else reset();
            }}
            className="px-4 py-2 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors flex items-center space-x-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload View</span>
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-xl bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold transition-colors flex items-center space-x-1.5"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Return Home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
