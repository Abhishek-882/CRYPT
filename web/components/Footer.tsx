"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink, ShieldCheck, Zap } from "lucide-react";

export default function Footer() {
  return (
    <footer className="w-full bg-[#09090b] border-t border-border mt-12 pt-8 pb-24 sm:pb-8 px-4 md:px-8 font-mono text-xs text-zinc-400">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Info & Attribution Row */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-border/80">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
              <span className="font-bold text-zinc-200 tracking-wide uppercase">
                SAFECOINER // HIGH-FREQUENCY ARBITRAGE TERMINAL
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Autonomous Delta-Neutral Basis Capture • Dual WebSockets Engine • Sub-250ms Execution Delta
            </p>
          </div>

          {/* Developer & Company Attribution */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] bg-surface px-3 py-2 rounded-lg border border-border">
            <div className="text-zinc-400">
              Developer: <span className="font-bold text-accent-amber"></span>
            </div>
            <span className="text-zinc-500">•</span>
            <div className="text-zinc-400">
              Company: <span className="font-bold text-accent-cyan">Safecoiner</span>
            </div>
            <span className="text-zinc-500">•</span>
            <div className="text-zinc-400">
              System: <span className="text-zinc-300">Production Build v2.4</span>
            </div>
          </div>
        </div>

        {/* Mandatory Regulatory & Risk Disclaimer */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/90 text-[11px] leading-relaxed text-zinc-300 space-y-2">
          <div className="flex items-center space-x-1.5 text-zinc-300 font-semibold uppercase tracking-wider text-[10px]">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>Institutional Trading & Execution Risk Disclaimer</span>
          </div>
          <p>
            High-frequency funding rate arbitrage and cryptocurrency derivative trading involve substantial risk of loss and are not suitable for every investor. While delta-neutral strategies aim to minimize directional exposure, execution risks such as slippage, exchange API latency divergence, liquidation hazards during rapid basis divergence, and connectivity failures may still occur. Past performance and simulated backtest results do not guarantee future returns.
          </p>
          <p className="text-zinc-400 text-[11px]">
            This software platform is an automated execution and mathematical telemetry tool provided for institutional research and qualified traders. It does not constitute financial, legal, tax, or investment advice. 
          </p>
        </div>

        {/* DPDP Act 2023 Statutory Grievance Redressal & DPO Publication */}
        <div className="p-4 rounded-xl bg-[#121215] border border-amber-500/20 text-[11px] text-zinc-300 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
              <span className="font-bold text-zinc-200 uppercase tracking-wider text-[10px]">
                Data Protection & Grievance Redressal (DPDP Act 2023, India)
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 font-mono">
              Statutory Resolution SLA: Within 30 Days (Rule 13)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
            <div>
              <span className="text-zinc-400">Grievance Officer:</span>{" "}
              <strong className="text-zinc-300"></strong>
            </div>
            <div>
              <span className="text-zinc-400">Official Email:</span>{" "}
              <a href="mailto:" className="text-accent-cyan hover:underline">
                
              </a>
            </div>
            <div>
              <span className="text-zinc-400">Escalation Body:</span>{" "}
              <span className="text-zinc-300">Data Protection Board of India</span>
            </div>
          </div>
        </div>

        {/* Bottom Credits & Quick Links */}
        <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-zinc-400 gap-3 pt-2">
          <div>
            © {new Date().getFullYear()} Safecoiner. All rights reserved.
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
            <Link href="/" className="hover:text-zinc-300 transition-colors">
              Platform Intro
            </Link>
            <Link href="/terminal" className="hover:text-zinc-300 transition-colors">
              Trading Terminal
            </Link>
            <Link href="/bot" className="hover:text-zinc-300 transition-colors">
              Autonomous Bot
            </Link>
            <Link href="/history" className="hover:text-zinc-300 transition-colors">
              Hedge History
            </Link>
            <Link href="/profile" className="hover:text-zinc-300 transition-colors">
              User Profile
            </Link>
            <Link href="/privacy" className="text-accent-amber hover:text-amber-300 transition-colors font-semibold">
              Privacy Notice
            </Link>
            <Link href="/terms" className="hover:text-zinc-300 transition-colors">
              Terms of Service
            </Link>
            <Link href="/data-rights" className="text-accent-cyan hover:text-cyan-300 transition-colors font-semibold">
              Data Rights
            </Link>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent("open-cookie-preferences"));
                }
              }}
              className="hover:text-zinc-300 transition-colors underline decoration-dotted text-zinc-400"
            >
              Consent Preferences
            </button>
            <a
              href="https://testnet.binancefuture.com"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-zinc-200 flex items-center space-x-1"
            >
              <span>Binance Testnet</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
