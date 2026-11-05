"use client";

import React, { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

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

export default function GlobalError({
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
    console.error("[GlobalError caught]", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-center p-6 font-mono">
        <div className="max-w-md w-full bg-[#121215] border border-zinc-800 rounded-2xl p-6 shadow-2xl text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-accent-rose">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
              Interface Refresh Needed
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              A newer platform version is active. Please refresh to load updated modules.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
                else reset();
              }}
              className="px-4 py-2 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors flex items-center space-x-1.5 mx-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Platform</span>
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
