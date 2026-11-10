"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  User,
  ShieldCheck,
  KeyRound,
  Server,
  Power,
  LogOut,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";

export default function ProfilePage() {
  const router = useRouter();

  const [user, setUser] = useState<{
    id: string;
    email: string;
    username: string;
    role: "admin" | "user";
    apiKeys?: any;
    createdAt?: string;
  } | null>(null);

  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Exchange Keys State
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [binanceEndpoint, setBinanceEndpoint] = useState("https://demo-fapi.binance.com");

  const [bitgetKey, setBitgetKey] = useState("");
  const [bitgetSecret, setBitgetSecret] = useState("");
  const [bitgetPassphrase, setBitgetPassphrase] = useState("");
  const [bitgetEnv, setBitgetEnv] = useState("demo");

  const [coindcxKey, setCoinDcxKey] = useState("");
  const [coindcxSecret, setCoinDcxSecret] = useState("");

  const [bybitKey, setBybitKey] = useState("");
  const [bybitSecret, setBybitSecret] = useState("");
  const [bybitProxy, setBybitProxy] = useState("");
  const [bybitBaseUrl, setBybitBaseUrl] = useState("");

  // Show/hide secrets
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);
  const [showBitgetSecret, setShowBitgetSecret] = useState(false);
  const [showBitgetPass, setShowBitgetPass] = useState(false);
  const [showCoinDcxSecret, setShowCoinDcxSecret] = useState(false);
  const [showBybitSecret, setShowBybitSecret] = useState(false);

  // Status feedback
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // 24/7 Daemon state
  const [daemon, setDaemon] = useState<{
    isRunning: boolean;
    uptimeSeconds: number;
    cyclesCompleted: number;
    activeHedges: number;
  }>({
    isRunning: true,
    uptimeSeconds: 0,
    cyclesCompleted: 0,
    activeHedges: 0,
  });

  // 1. Fetch current authenticated user
  const fetchAuthUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.isLoggedIn && data.user) {
        setUser(data.user);

        // Load API keys securely from authenticated user record
        setBinanceKey(data.user.apiKeys?.binanceKey || "");
        setBinanceSecret(data.user.apiKeys?.binanceSecret || "");
        setBinanceEndpoint(data.user.apiKeys?.binanceEndpoint || "https://testnet.binancefuture.com");
        setBitgetKey(data.user.apiKeys?.bitgetKey || "");
        setBitgetSecret(data.user.apiKeys?.bitgetSecret || "");
        setBitgetPassphrase(data.user.apiKeys?.bitgetPassphrase || "");
        setBitgetEnv(data.user.apiKeys?.bitgetEnv || "demo");
        setCoinDcxKey(data.user.apiKeys?.coindcxKey || "");
        setCoinDcxSecret(data.user.apiKeys?.coindcxSecret || "");
        setBybitKey(data.user.apiKeys?.bybitKey || "");
        setBybitSecret(data.user.apiKeys?.bybitSecret || "");
        setBybitProxy(data.user.apiKeys?.bybitProxy || "");
        setBybitBaseUrl(data.user.apiKeys?.bybitBaseUrl || "");
      } else {
        router.push("/login");
      }
    } catch (err) {
      console.error("[Profile] Failed to fetch authenticated user:", err);
      router.push("/login");
    } finally {
      setIsLoadingAuth(false);
    }
  }, [router]);

  const fetchDaemonState = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/daemon", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
      }
    } catch (err) {
      console.error("[Profile] Failed to fetch daemon state:", err);
    }
  }, []);

  useEffect(() => {
    fetchAuthUser();
    fetchDaemonState();
  }, [fetchAuthUser, fetchDaemonState]);

  const isMasked = (s: string) => !s || s.trim().startsWith("•••") || s.includes("••••");

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessMsg(null);
    setTestResult(null);

    // Form Validation
    if (binanceEndpoint && !binanceEndpoint.startsWith("http://") && !binanceEndpoint.startsWith("https://")) {
      setTestResult({
        success: false,
        message: "Binance endpoint must be a valid URL starting with https://",
      });
      return;
    }

    // Save to user store on server
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_keys",
          userId: user?.id,
          apiKeys: {
            binanceKey: binanceKey.trim(),
            ...(isMasked(binanceSecret) ? {} : { binanceSecret: binanceSecret.trim() }),
            binanceEndpoint,
            bitgetKey: bitgetKey.trim(),
            ...(isMasked(bitgetSecret) ? {} : { bitgetSecret: bitgetSecret.trim() }),
            ...(isMasked(bitgetPassphrase) ? {} : { bitgetPassphrase: bitgetPassphrase.trim() }),
            bitgetEnv,
            coindcxKey: coindcxKey.trim(),
            ...(isMasked(coindcxSecret) ? {} : { coindcxSecret: coindcxSecret.trim() }),
            bybitKey: bybitKey.trim(),
            ...(isMasked(bybitSecret) ? {} : { bybitSecret: bybitSecret.trim() }),
            bybitProxy: bybitProxy.trim(),
            bybitBaseUrl: bybitBaseUrl.trim(),
          },
        }),
      });

      // Record statutory consent update under DPDP Act 2023
      if (user?.email) {
        await fetch("/api/compliance/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: user.email,
            purpose: "PURPOSE_EXCHANGE_DISPATCH",
            status: "GRANTED",
          }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[Profile] Failed to save keys to server:", err);
    }

    setSaveSuccessMsg("API Keys saved successfully! Your trading terminal is now calibrated.");
    setTimeout(() => setSaveSuccessMsg(null), 5000);
  };

  const handleTestConnections = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const headers: Record<string, string> = {
        "x-binance-endpoint": binanceEndpoint,
        "x-bitget-env": bitgetEnv,
      };

      if (binanceKey.trim()) headers["x-binance-key"] = binanceKey.trim();
      if (!isMasked(binanceSecret)) headers["x-binance-secret"] = binanceSecret.trim();

      if (bitgetKey.trim()) headers["x-bitget-key"] = bitgetKey.trim();
      if (!isMasked(bitgetSecret)) headers["x-bitget-secret"] = bitgetSecret.trim();
      if (!isMasked(bitgetPassphrase)) headers["x-bitget-passphrase"] = bitgetPassphrase.trim();

      if (coindcxKey.trim()) headers["x-coindcx-key"] = coindcxKey.trim();
      if (!isMasked(coindcxSecret)) headers["x-coindcx-secret"] = coindcxSecret.trim();

      if (bybitKey.trim()) headers["x-bybit-key"] = bybitKey.trim();
      if (!isMasked(bybitSecret)) headers["x-bybit-secret"] = bybitSecret.trim();
      if (bybitProxy.trim()) headers["x-bybit-proxy"] = bybitProxy.trim();
      if (bybitBaseUrl.trim()) headers["x-bybit-base-url"] = bybitBaseUrl.trim();

      const [bnRes, bgRes, cdxRes, byRes] = await Promise.all([
        fetch(`/api/account?_t=${Date.now()}`, { headers, cache: "no-store" }),
        fetch(`/api/bitget/account?_t=${Date.now()}`, { headers, cache: "no-store" }),
        fetch(`/api/coindcx/account?_t=${Date.now()}`, { headers, cache: "no-store" }),
        fetch(`/api/bybit/account?_t=${Date.now()}`, { headers, cache: "no-store" }),
      ]);

      const bnData = await bnRes.json();
      const bgData = await bgRes.json();
      const cdxData = await cdxRes.json();
      const byData = await byRes.json();

      const parts: string[] = [];
      let allOk = true;

      if (bnData.success) {
        parts.push(`Binance: $${bnData.totalWalletBalance?.toFixed(2) || "0.00"}`);
      } else {
        parts.push(`Binance: ⚠️ ${bnData.error || "Auth fail"}`);
        allOk = false;
      }

      if (bgData.success) {
        parts.push(`Bitget: $${bgData.equity?.toFixed(2) || "0.00"}`);
      } else {
        parts.push(`Bitget: ⚠️ ${bgData.error || "Auth fail"}`);
        allOk = false;
      }

      if (cdxData.success) {
        parts.push(`CoinDCX: $${cdxData.equity?.toFixed(2) || "0.00"}`);
      } else {
        parts.push(`CoinDCX: ⚠️ ${cdxData.error || "Auth fail"}`);
        allOk = false;
      }

      if (byData.success) {
        parts.push(`Bybit: $${byData.equity?.toFixed(2) || "0.00"}`);
      } else {
        parts.push(`Bybit: ⚠️ ${byData.error || "Auth fail"}`);
        allOk = false;
      }

      setTestResult({
        success: allOk,
        message: parts.join(" • "),
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Network Error: ${err.message}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      } else {
        router.push("/login");
      }
    } catch (err) {
      console.error("[Profile] Logout network error:", err);
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      } else {
        router.push("/login");
      }
    }
  };

  const isAdmin = user?.role === "admin";

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-background text-zinc-100 flex flex-col font-mono">
        <Navbar />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="flex items-center space-x-3 text-zinc-400 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-accent-amber" />
            <span>Loading Quant Profile...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-8 pb-24 sm:pb-8 space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center space-x-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isAdmin ? "bg-accent-amber" : "bg-accent-cyan"} animate-pulse`} />
              <h1 className="text-xl md:text-2xl font-bold tracking-tight uppercase">
                QUANT PROFILE // CREDENTIAL VAULT
              </h1>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Account Security • Multi-Exchange API Isolation • 24/7 Autonomous Daemon Status
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-surface hover:bg-rose-950/40 text-rose-300 border border-border hover:border-rose-900/60 text-xs font-semibold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

        {/* User Identity & Role Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Identity Card */}
          <div className="bg-surface p-5 rounded-2xl border border-border space-y-3">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                isAdmin ? "bg-amber-500/20 text-accent-amber border border-amber-500/40" : "bg-cyan-500/20 text-accent-cyan border border-cyan-500/40"
              }`}>
                {isAdmin ? "ADM" : "QNT"}
              </div>
              <div>
                <div className="font-bold text-zinc-100 text-sm">{user?.username}</div>
                <div className="text-xs text-zinc-400">{user?.email}</div>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800 space-y-1.5 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Account Role:</span>
                <span className={`font-semibold ${isAdmin ? "text-accent-amber" : "text-accent-cyan"}`}>
                  {isAdmin ? "Admin / Fund Master" : "Standard Quant User"}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>API Key Policy:</span>
                <span className="font-semibold text-zinc-200">
                  {isAdmin ? "Pre-configured System Keys" : "Strict Personal Keys (Blank)"}
                </span>
              </div>
            </div>
          </div>

          {/* Role Status Explanation */}
          <div className="md:col-span-2 bg-surface p-5 rounded-2xl border border-border flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className={`w-4 h-4 ${isAdmin ? "text-accent-amber" : "text-accent-cyan"}`} />
                <span className="text-xs font-bold text-zinc-200 uppercase tracking-wide">
                  {isAdmin ? "ADMIN PRIVILEGES ACTIVE" : "STANDARD TRADER KEY ISOLATION"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {isAdmin ? (
                  <>
                    Logged in as Primary Administrator (<strong className="text-zinc-200">admin@safecoiner.com</strong>). You have unrestricted access to system-managed testnet credentials, global rate throttles, and autonomous background execution.
                  </>
                ) : (
                  <>
                    In accordance with institutional security protocols, all non-admin accounts operate under strict credential isolation. Your exchange API keys start completely <strong className="text-zinc-200">blank</strong> and are never shared with or fall back to system accounts. You must configure your personal keys below to execute live hedges.
                  </>
                )}
              </p>
            </div>

            <div className="pt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                <span>Encryption: AES-256 Client Vault</span>
              </span>
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                <span>Rate Limits: 12 req / 5s</span>
              </span>
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                <span>Zero Browser Alerts</span>
              </span>
            </div>
          </div>
        </div>

        {/* Feedback Banners */}
        {saveSuccessMsg && (
          <div className="p-4 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-xs flex items-center space-x-2.5">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {testResult && (
          <div className={`p-4 rounded-xl border text-xs flex items-center space-x-2.5 ${
            testResult.success
              ? "bg-emerald-950/50 border-emerald-800/60 text-emerald-300"
              : "bg-rose-950/50 border-rose-800/60 text-rose-300"
          }`}>
            {testResult.success ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Exchange API Keys Form */}
        <form onSubmit={handleSaveKeys} className="bg-surface rounded-2xl border border-border p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div className="flex items-center space-x-2.5">
              <KeyRound className="w-4 h-4 text-accent-amber" />
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                Exchange API Key Vault Configuration
              </h2>
            </div>
            <span className="text-[10px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              {isAdmin ? "Admin Defaults Available" : "Personal Keys Required (Blank Default)"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {/* Binance Column */}
            <div className="bg-zinc-900/60 p-5 rounded-xl border border-amber-500/20 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <span className="text-xs font-bold text-amber-400 uppercase">Binance USD-M Futures</span>
                <span className="text-[10px] text-zinc-500">Testnet / Live</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Binance API Key
                </label>
                <input
                  type="text"
                  value={binanceKey}
                  onChange={(e) => setBinanceKey(e.target.value)}
                  placeholder={isAdmin ? "System default key loaded" : "Enter personal Binance API Key"}
                  className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent-amber font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Binance API Secret
                </label>
                <div className="relative">
                  <input
                    type={showBinanceSecret ? "text" : "password"}
                    value={binanceSecret}
                    onChange={(e) => setBinanceSecret(e.target.value)}
                    placeholder={
                      isAdmin
                        ? "System default secret loaded"
                        : user?.apiKeys?.hasBinanceSecret
                        ? "Secret safely stored in vault (leave blank to keep)"
                        : "Enter personal Binance Secret"
                    }
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent-amber font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBinanceSecret(!showBinanceSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showBinanceSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  API Endpoint URL
                </label>
                <select
                  value={binanceEndpoint}
                  onChange={(e) => setBinanceEndpoint(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 focus:outline-none focus:border-accent-amber font-mono"
                >
                  <option value="https://testnet.binancefuture.com">https://testnet.binancefuture.com (Testnet - Recommended)</option>
                  <option value="https://demo-fapi.binance.com">https://demo-fapi.binance.com (Demo FAPI)</option>
                  <option value="https://fapi.binance.com">https://fapi.binance.com (Production Mainnet)</option>
                </select>
              </div>
            </div>

            {/* Bitget Column */}
            <div className="bg-zinc-900/60 p-5 rounded-xl border border-cyan-500/20 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <span className="text-xs font-bold text-cyan-400 uppercase">Bitget Perpetuals V3</span>
                <span className="text-[10px] text-zinc-500">Demo / Live</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Bitget API Key
                </label>
                <input
                  type="text"
                  value={bitgetKey}
                  onChange={(e) => setBitgetKey(e.target.value)}
                  placeholder={isAdmin ? "System default key loaded" : "Enter personal Bitget API Key"}
                  className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent-cyan font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Bitget API Secret
                </label>
                <div className="relative">
                  <input
                    type={showBitgetSecret ? "text" : "password"}
                    value={bitgetSecret}
                    onChange={(e) => setBitgetSecret(e.target.value)}
                    placeholder={
                      isAdmin
                        ? "System default secret loaded"
                        : user?.apiKeys?.hasBitgetSecret
                        ? "Secret safely stored in vault (leave blank to keep)"
                        : "Enter personal Bitget Secret"
                    }
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent-cyan font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBitgetSecret(!showBitgetSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showBitgetSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Bitget API Passphrase
                </label>
                <div className="relative">
                  <input
                    type={showBitgetPass ? "text" : "password"}
                    value={bitgetPassphrase}
                    onChange={(e) => setBitgetPassphrase(e.target.value)}
                    placeholder={
                      isAdmin
                        ? "ArbitrageBot2027"
                        : user?.apiKeys?.hasBitgetPassphrase
                        ? "Passphrase safely stored in vault (leave blank to keep)"
                        : "Enter personal Passphrase"
                    }
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-accent-cyan font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBitgetPass(!showBitgetPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showBitgetPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* CoinDCX Column */}
            <div className="bg-zinc-900/60 p-5 rounded-xl border border-purple-500/25 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <span className="text-xs font-bold text-purple-400 uppercase">CoinDCX Derivatives</span>
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">Mainnet Ready</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  CoinDCX API Key
                </label>
                <input
                  type="text"
                  value={coindcxKey}
                  onChange={(e) => setCoinDcxKey(e.target.value)}
                  placeholder="Enter personal CoinDCX API Key"
                  className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  CoinDCX API Secret
                </label>
                <div className="relative">
                  <input
                    type={showCoinDcxSecret ? "text" : "password"}
                    value={coindcxSecret}
                    onChange={(e) => setCoinDcxSecret(e.target.value)}
                    placeholder={
                      user?.apiKeys?.hasCoinDcxSecret
                        ? "Secret safely stored in vault (leave blank to keep)"
                        : "Enter personal CoinDCX Secret"
                    }
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-400 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCoinDcxSecret(!showCoinDcxSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showCoinDcxSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80 text-[10px] text-zinc-400 space-y-1">
                <div className="text-zinc-300 font-bold">505+ Perpetual Contracts Supported</div>
                <div>USDT/INR settlement, HMAC-SHA256 authenticated, direct liquidity execution.</div>
              </div>
            </div>

            {/* Bybit Column */}
            <div className="bg-zinc-900/60 p-5 rounded-xl border border-amber-500/25 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <span className="text-xs font-bold text-amber-400 uppercase">Bybit Linear (UTA)</span>
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">Mainnet Ready</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Bybit API Key
                </label>
                <input
                  type="text"
                  value={bybitKey}
                  onChange={(e) => setBybitKey(e.target.value)}
                  placeholder="Enter personal Bybit API Key"
                  className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Bybit API Secret
                </label>
                <div className="relative">
                  <input
                    type={showBybitSecret ? "text" : "password"}
                    value={bybitSecret}
                    onChange={(e) => setBybitSecret(e.target.value)}
                    placeholder={
                      user?.apiKeys?.hasBybitSecret
                        ? "Secret safely stored in vault (leave blank to keep)"
                        : "Enter personal Bybit Secret"
                    }
                    className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBybitSecret(!showBybitSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showBybitSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 uppercase">
                  Proxy / Worker URL (Bypass CloudFront)
                </label>
                <input
                  type="text"
                  value={bybitProxy || bybitBaseUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith("http://") || val.startsWith("socks5://") || val.includes("@")) {
                      setBybitProxy(val);
                      setBybitBaseUrl("");
                    } else {
                      setBybitBaseUrl(val);
                      setBybitProxy("");
                    }
                  }}
                  placeholder="Worker URL or forward proxy"
                  className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-400 font-mono"
                />
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80 text-[10px] text-zinc-400 space-y-1">
                <div className="text-zinc-300 font-bold">480+ Linear Contracts Supported</div>
                <div>Unified Trading Account, HMAC-SHA256 authenticated, dual-proxy enabled.</div>
              </div>
            </div>
          </div>

          {/* DPDP Act 2023 Statutory Consent & Data Rights Reference */}
          <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-zinc-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-accent-amber shrink-0" />
              <span>
                <strong>DPDP Act 2023 Compliance:</strong> Saving credentials updates your consent audit log for AES-256-GCM vault encryption and external order dispatch.
              </span>
            </div>
            <a
              href="/data-rights"
              className="text-accent-amber hover:underline text-[10px] font-bold shrink-0 flex items-center space-x-1"
            >
              <span>Manage Rights & Consents →</span>
            </a>
          </div>

          {/* Form Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border">
            <div className="text-[11px] text-zinc-500">
              Keys are securely stored in your personal vault session and authenticated on every trade.
            </div>

            <div className="flex items-center space-x-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleTestConnections}
                disabled={isTesting}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-semibold transition-colors flex items-center justify-center space-x-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? "animate-spin text-accent-cyan" : ""}`} />
                <span>{isTesting ? "Testing Keys..." : "Test Connections"}</span>
              </button>

              <button
                type="submit"
                className="flex-1 sm:flex-initial px-5 py-2 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors shadow-md shadow-amber-500/10"
              >
                Save Vault Keys
              </button>
            </div>
          </div>
        </form>

        {/* 24/7 Autonomous Server Bot Status Card */}
        <div className="bg-surface rounded-2xl border border-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Server className="w-4 h-4 text-accent-cyan" />
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                24/7 Server Autonomous Execution Engine
              </h2>
            </div>
            <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold border ${
              daemon.isRunning
                ? "bg-emerald-950/80 text-emerald-400 border-emerald-700 animate-pulse"
                : "bg-zinc-800 text-zinc-400 border-zinc-700"
            }`}>
              {daemon.isRunning ? "ACTIVE (SERVER 24/7)" : "STANDBY"}
            </span>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            The autonomous delta-neutral arbitrage engine runs non-stop on the backend server. The bot scans funding rate spreads and manages delta-neutral hedges even if you close this website or log out.
          </p>

          <div className="grid grid-cols-3 gap-3 pt-2 font-mono text-xs">
            <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <div className="text-zinc-500 text-[10px]">SERVER UPTIME</div>
              <div className="font-bold text-zinc-200 mt-1">{daemon.uptimeSeconds}s</div>
            </div>
            <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <div className="text-zinc-500 text-[10px]">CYCLES COMPLETED</div>
              <div className="font-bold text-zinc-200 mt-1">#{daemon.cyclesCompleted}</div>
            </div>
            <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <div className="text-zinc-500 text-[10px]">ACTIVE HEDGES</div>
              <div className="font-bold text-accent-amber mt-1">{Array.isArray(daemon.activeHedges) ? daemon.activeHedges.length : (typeof daemon.activeHedges === "number" ? daemon.activeHedges : 0)}</div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
