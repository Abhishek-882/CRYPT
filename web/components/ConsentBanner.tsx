"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ShieldCheck, Cookie, Check, X, Settings2, ExternalLink } from "lucide-react";
import { DPDP_NOTICE_VERSION } from "@/lib/complianceConstants";

const CONSENT_STORAGE_KEY = "SAFECOINER_CONSENT_PREFERENCES";

export interface CookiePreferences {
  version: string;
  timestamp: string;
  strictlyNecessary: boolean;
  diagnosticsTelemetry: boolean;
  marketPreferenceCache: boolean;
}

export default function ConsentBanner() {
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Preference checkboxes (strictly opt-in: non-essential default to FALSE)
  const [diagnosticsTelemetry, setDiagnosticsTelemetry] = useState(false);
  const [marketPreferenceCache, setMarketPreferenceCache] = useState(false);

  useEffect(() => {
    // Check if preferences already established
    try {
      const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
      if (stored) {
        const parsed: CookiePreferences = JSON.parse(stored);
        if (parsed.version === DPDP_NOTICE_VERSION) {
          // Already consented for this notice version
          return;
        }
      }
      // If not stored or outdated notice version, show banner
      setIsOpen(true);
    } catch {
      setIsOpen(true);
    }

    // Listen for custom event to reopen preferences modal from footer
    const handleReopen = () => {
      setIsModalOpen(true);
    };
    window.addEventListener("open-cookie-preferences", handleReopen);
    return () => window.removeEventListener("open-cookie-preferences", handleReopen);
  }, []);

  const savePreferences = async (prefs: CookiePreferences) => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(prefs));
      document.cookie = `dpdp_consent=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=31536000; SameSite=Lax`;

      // Log decision with backend compliance API
      await fetch("/api/compliance/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consents: [
            {
              purpose: "PURPOSE_DIAGNOSTICS_TELEMETRY",
              status: prefs.diagnosticsTelemetry ? "GRANTED" : "WITHDRAWN",
            },
            {
              purpose: "PURPOSE_MARKET_CACHE",
              status: prefs.marketPreferenceCache ? "GRANTED" : "WITHDRAWN",
            },
          ],
        }),
      }).catch(() => {});
    } catch {}

    setIsOpen(false);
    setIsModalOpen(false);
  };

  const handleAcceptAll = () => {
    const prefs: CookiePreferences = {
      version: DPDP_NOTICE_VERSION,
      timestamp: new Date().toISOString(),
      strictlyNecessary: true,
      diagnosticsTelemetry: true,
      marketPreferenceCache: true,
    };
    savePreferences(prefs);
  };

  const handleRejectNonEssential = () => {
    const prefs: CookiePreferences = {
      version: DPDP_NOTICE_VERSION,
      timestamp: new Date().toISOString(),
      strictlyNecessary: true,
      diagnosticsTelemetry: false, // strictly blocked
      marketPreferenceCache: false, // strictly blocked
    };
    savePreferences(prefs);
  };

  const handleSaveCustom = () => {
    const prefs: CookiePreferences = {
      version: DPDP_NOTICE_VERSION,
      timestamp: new Date().toISOString(),
      strictlyNecessary: true,
      diagnosticsTelemetry,
      marketPreferenceCache,
    };
    savePreferences(prefs);
  };

  if (!isOpen && !isModalOpen) return null;

  return (
    <>
      {/* Floating Bottom Sticky Consent Banner */}
      {isOpen && !isModalOpen && (
        <div className="fixed bottom-14 sm:bottom-0 inset-x-0 z-50 p-3 sm:p-4 bg-[#121215]/95 backdrop-blur-md border-t border-amber-500/30 shadow-2xl font-mono animate-in slide-in-from-bottom duration-300">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1 max-w-4xl">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-accent-amber animate-pulse" />
                <span className="font-bold text-zinc-100 text-xs uppercase tracking-wide flex items-center space-x-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-accent-amber" />
                  <span>Statutory Consent & Tracker Control (DPDP Act 2023, India)</span>
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">v1.0</span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                In compliance with the <strong>Digital Personal Data Protection Act, 2023</strong>, non-essential
                diagnostic telemetry and tracking cookies are <strong>gated and disabled by default</strong>. Essential
                cookies are strictly used for authentication and security. You have the statutory right to choose which
                trackers you permit. See our{" "}
                <Link href="/privacy" className="text-accent-amber underline hover:text-amber-300">
                  Privacy Notice
                </Link>{" "}
                for full disclosures.
              </p>
            </div>

            {/* Banner Buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold transition-colors flex items-center space-x-1 border border-zinc-700"
              >
                <Settings2 className="w-3.5 h-3.5 text-zinc-400" />
                <span>Customize</span>
              </button>
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 font-semibold transition-colors"
              >
                Reject Non-Essential
              </button>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="px-4 py-1.5 rounded-lg bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold transition-colors shadow-md shadow-amber-500/10"
              >
                Accept All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Granular Preference Customization Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-mono animate-in fade-in duration-200">
          <div className="bg-[#121215] border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-5 p-6">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <Cookie className="w-4 h-4 text-accent-amber" />
                <h3 className="font-bold text-zinc-100 text-sm uppercase">Manage Tracking Preferences</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Category 1: Strictly Necessary */}
              <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-200">1. Strictly Necessary (Always Active)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">
                    REQUIRED
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Required for user authentication sessions, CSRF mitigation, and encrypted API communication. Cannot be deactivated.
                </p>
              </div>

              {/* Category 2: Diagnostics & Telemetry (Unticked by default) */}
              <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-200">2. WebSocket Diagnostics & Telemetry</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={diagnosticsTelemetry}
                      onChange={(e) => setDiagnosticsTelemetry(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-amber"></div>
                  </label>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Collects client network latency, order-fill roundtrip timestamps, and diagnostic error reports. Defaults to <strong>OFF</strong>.
                </p>
              </div>

              {/* Category 3: Market Preferences Cache */}
              <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-200">3. Market Watchlist & Filter Cache</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={marketPreferenceCache}
                      onChange={(e) => setMarketPreferenceCache(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-amber"></div>
                  </label>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Preserves selected coin filters, blacklist sorting, and layout preferences in your browser. Defaults to <strong>OFF</strong>.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCustom}
                className="px-4 py-2 rounded-lg bg-accent-amber hover:bg-amber-400 text-zinc-950 text-xs font-bold transition-colors"
              >
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
