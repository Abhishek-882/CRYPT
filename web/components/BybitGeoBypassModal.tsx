"use client";

import React, { useState } from "react";
import {
  X,
  ShieldAlert,
  Globe,
  Zap,
  Settings,
  Copy,
  Check,
  ExternalLink,
  Server,
  ArrowRight,
} from "lucide-react";

interface BybitGeoBypassModalProps {
  onClose: () => void;
  onSwitchPaper: () => void;
  onOpenSettings: () => void;
}

export function BybitGeoBypassModal({
  onClose,
  onSwitchPaper,
  onOpenSettings,
}: BybitGeoBypassModalProps) {
  const [copied, setCopied] = useState(false);

  const workerCodeSnippet = `export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = new URL(\`https://api.bybit.com\${url.pathname}\${url.search}\`);
    const headers = new Headers(request.headers);
    headers.set("Host", "api.bybit.com");
    // Strip client origin IP headers so AWS CloudFront does not block
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.delete("client-ip");
    headers.delete("true-client-ip");
    const init = { method: request.method, headers, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(targetUrl.toString(), init);
  }
};`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(workerCodeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-surface border border-border p-5 sm:p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Close Modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <span>Bybit CloudFront Geo-Bypass Assistant</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-normal">
                Action Required
              </span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Your API keys are valid (<span className="text-amber-400 font-bold">Lctw...V9bv</span>), but Bybit REST API is geo-blocked by CloudFront on US hosting.
            </p>
          </div>
        </div>

        {/* Explanation Alert */}
        <div className="p-3 rounded-xl bg-surface-card border border-border text-xs text-zinc-300 space-y-2 mb-5">
          <div className="flex items-start gap-2">
            <Globe className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-zinc-200">Why am I seeing this?</span>
              <p className="text-zinc-400 mt-1 leading-relaxed">
                Bybit enforces AWS CloudFront regional IP restrictions. Direct REST requests from US datacenter IPs return HTTP 403 Forbidden. Public & Private WebSockets connect without restriction, but REST balance and order queries require an outbound egress proxy.
              </p>
            </div>
          </div>
        </div>

        {/* Action Options */}
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-bold">
            Select Resolution Path:
          </div>

          {/* Option 1: Switch to Paper Mode */}
          <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 hover:border-emerald-500/50 transition-all">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-400">Option 1: Instant Paper Trading Mode</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                    Zero Setup • 100% Free
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Immediately activates simulated $5,000.00 USDT balances across all 4 venues (Binance, Bitget, CoinDCX, Bybit). Test funding rate scanners, spreads, and multi-leg order execution with zero risk and no proxy needed.
                </p>
              </div>
              <button
                onClick={onSwitchPaper}
                className="shrink-0 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-500/20"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Switch to Paper</span>
              </button>
            </div>
          </div>

          {/* Option 2: Configure Existing Non-US Proxy */}
          <div className="p-3.5 rounded-xl bg-surface-card border border-border hover:border-zinc-700 transition-all">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-200">Option 2: Connect Non-US Forward Proxy</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                    Europe / Asia
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  If you have a proxy in Europe (Germany, Netherlands, Poland, UK) or Asia (Singapore, Japan) from Webshare, BrightData, or Smartproxy, enter it in Settings.
                </p>
              </div>
              <button
                onClick={onOpenSettings}
                className="shrink-0 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Open Settings</span>
              </button>
            </div>
          </div>

          {/* Option 3: Free Cloudflare Worker Proxy */}
          <div className="p-3.5 rounded-xl bg-surface-card border border-border space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-400">Option 3: Free Cloudflare Worker Proxy</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                  Turnkey &lt; 60s
                </span>
              </div>
              <button
                onClick={handleCopyCode}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 bg-zinc-800 px-2 py-1 rounded border border-zinc-700"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Worker Code</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Create a free worker on <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer" className="text-amber-400 underline decoration-dotted inline-flex items-center gap-0.5">Cloudflare Dashboard <ExternalLink className="w-2.5 h-2.5" /></a>, paste this code, enable Smart Placement (or non-US location), and paste the Worker URL in Settings.
            </p>
            <pre className="p-2.5 rounded-lg bg-black/60 border border-border text-[10px] text-zinc-400 overflow-x-auto max-h-32">
              <code>{workerCodeSnippet}</code>
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-border flex items-center justify-between text-[11px] text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-zinc-400" />
            <span>Strict Delta-Neutral Pre-Flight Lock protects live capital.</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
