"use client";

import React, { useState, useEffect, useCallback } from "react";
import { KeyRound, Shield, Check, X, RefreshCw, AlertCircle, Server, Layers, Trash2, Sparkles, Lock } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function SettingsModal({ isOpen, onClose, onSaved }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"binance" | "bitget" | "coindcx" | "bybit">("binance");

  // Binance State
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [binanceEndpoint, setBinanceEndpoint] = useState("auto");

  // Bitget State
  const [bitgetKey, setBitgetKey] = useState("");
  const [bitgetSecret, setBitgetSecret] = useState("");
  const [bitgetPassphrase, setBitgetPassphrase] = useState("");
  const [bitgetEnv, setBitgetEnv] = useState("demo");

  // CoinDCX State
  const [coindcxKey, setCoinDcxKey] = useState("");
  const [coindcxSecret, setCoinDcxSecret] = useState("");

  // Bybit State
  const [bybitKey, setBybitKey] = useState("");
  const [bybitSecret, setBybitSecret] = useState("");
  const [bybitProxy, setBybitProxy] = useState("");
  const [bybitBaseUrl, setBybitBaseUrl] = useState("");
  const [bybitBackupProxy, setBybitBackupProxy] = useState("");
  const [bybitBackupBaseUrl, setBybitBackupBaseUrl] = useState("");

  const [hasServerKeys, setHasServerKeys] = useState<{
    binance: boolean;
    bitget: boolean;
    coindcx: boolean;
    bybit: boolean;
  }>({ binance: false, bitget: false, coindcx: false, bybit: false });

  const [testingStatus, setTestingStatus] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isMasked = (s: string) => !s || s.trim().startsWith("•••") || s.includes("••••");

  // Purge legacy browser localStorage to guarantee zero browser persistence
  const purgeBrowserStorage = useCallback(() => {
    if (typeof window !== "undefined") {
      [
        "BINANCE_KEY",
        "BINANCE_SECRET",
        "BINANCE_ENDPOINT",
        "BITGET_KEY",
        "BITGET_SECRET",
        "BITGET_PASSPHRASE",
        "BITGET_ENV",
        "COINDCX_KEY",
        "COINDCX_SECRET",
        "BYBIT_KEY",
        "BYBIT_SECRET",
        "BYBIT_PROXY",
        "BYBIT_BASE_URL",
      ].forEach((k) => {
        try {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        } catch {}
      });
    }
  }, []);

  // Fetch keys from authenticated user account on server (auto-load)
  const loadUserVault = useCallback(async () => {
    purgeBrowserStorage();
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.isLoggedIn && data.user?.apiKeys) {
        const keys = data.user.apiKeys;
        setBinanceKey(keys.binanceKey || "");
        setBinanceSecret(keys.binanceSecret || "");
        setBinanceEndpoint(keys.binanceEndpoint || "auto");

        setBitgetKey(keys.bitgetKey || "");
        setBitgetSecret(keys.bitgetSecret || "");
        setBitgetPassphrase(keys.bitgetPassphrase || "");
        setBitgetEnv(keys.bitgetEnv || "demo");

        setCoinDcxKey(keys.coindcxKey || "");
        setCoinDcxSecret(keys.coindcxSecret || "");

        setBybitKey(keys.bybitKey || "");
        setBybitSecret(keys.bybitSecret || "");
        setBybitProxy(keys.bybitProxy || "");
        setBybitBaseUrl(keys.bybitBaseUrl || "");
        setBybitBackupProxy(keys.bybitBackupProxy || "");
        setBybitBackupBaseUrl(keys.bybitBackupBaseUrl || "");

        setHasServerKeys({
          binance: Boolean(keys.binanceKey || keys.hasBinanceSecret),
          bitget: Boolean(keys.bitgetKey || keys.hasBitgetSecret),
          coindcx: Boolean(keys.coindcxKey || keys.hasCoinDcxSecret),
          bybit: Boolean(keys.bybitKey || keys.hasBybitSecret),
        });
      }
    } catch (err) {
      console.error("[SettingsModal] Failed to load keys from user account:", err);
    }
  }, [purgeBrowserStorage]);

  useEffect(() => {
    if (isOpen) {
      loadUserVault();
      setTestResult(null);
    }
  }, [isOpen, loadUserVault]);

  if (!isOpen) return null;

  const testBinance = async () => {
    if (!binanceKey.trim() && !hasServerKeys.binance) {
      setTestResult({ success: false, msg: "Enter Binance API Key and Secret first." });
      return;
    }
    setTestingStatus("binance");
    setTestResult(null);
    try {
      const headers: Record<string, string> = {};
      if (binanceKey.trim() && !isMasked(binanceKey)) headers["x-binance-key"] = binanceKey.trim();
      if (binanceSecret.trim() && !isMasked(binanceSecret)) headers["x-binance-secret"] = binanceSecret.trim();
      if (binanceEndpoint !== "auto") headers["x-binance-endpoint"] = binanceEndpoint;

      const res = await fetch(`/api/account?_t=${Date.now()}`, {
        headers,
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          msg: `Binance Connected [${data.keyMask}]! Balance: $${data.totalWalletBalance?.toLocaleString()} USDT (${data.endpoint.replace("https://", "")})`,
        });
      } else {
        setTestResult({
          success: false,
          msg: data.error || "Failed to authenticate Binance keys.",
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, msg: `Network Error: ${err.message}` });
    } finally {
      setTestingStatus(null);
    }
  };

  const testBitget = async () => {
    if (!bitgetKey.trim() && !hasServerKeys.bitget) {
      setTestResult({ success: false, msg: "Enter Bitget API Key, Secret, and Passphrase." });
      return;
    }
    setTestingStatus("bitget");
    setTestResult(null);
    try {
      const headers: Record<string, string> = {};
      if (bitgetKey.trim() && !isMasked(bitgetKey)) headers["x-bitget-key"] = bitgetKey.trim();
      if (bitgetSecret.trim() && !isMasked(bitgetSecret)) headers["x-bitget-secret"] = bitgetSecret.trim();
      if (bitgetPassphrase.trim() && !isMasked(bitgetPassphrase)) headers["x-bitget-passphrase"] = bitgetPassphrase.trim();
      headers["x-bitget-env"] = bitgetEnv;

      const res = await fetch(`/api/bitget/account?_t=${Date.now()}`, {
        headers,
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          msg: `Bitget Connected! Equity: $${data.equity?.toLocaleString()} USDT (${data.venue})`,
        });
      } else {
        setTestResult({
          success: false,
          msg: data.error || "Failed to authenticate Bitget credentials.",
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, msg: `Network Error: ${err.message}` });
    } finally {
      setTestingStatus(null);
    }
  };

  const testCoinDcx = async () => {
    if (!coindcxKey.trim() && !hasServerKeys.coindcx) {
      setTestResult({ success: false, msg: "Enter CoinDCX API Key and Secret." });
      return;
    }
    setTestingStatus("coindcx");
    setTestResult(null);
    try {
      const headers: Record<string, string> = {};
      if (coindcxKey.trim() && !isMasked(coindcxKey)) headers["x-coindcx-key"] = coindcxKey.trim();
      if (coindcxSecret.trim() && !isMasked(coindcxSecret)) headers["x-coindcx-secret"] = coindcxSecret.trim();

      const res = await fetch(`/api/coindcx/account?_t=${Date.now()}`, {
        headers,
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          msg: `CoinDCX Connected! Equity: $${data.equity?.toLocaleString()} USDT (${data.venue})`,
        });
      } else {
        setTestResult({
          success: false,
          msg: data.error || "Failed to authenticate CoinDCX credentials.",
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, msg: `Network Error: ${err.message}` });
    } finally {
      setTestingStatus(null);
    }
  };

  const testBybit = async () => {
    if (!bybitKey.trim() && !hasServerKeys.bybit) {
      setTestResult({ success: false, msg: "Enter Bybit API Key and Secret first." });
      return;
    }
    setTestingStatus("bybit");
    setTestResult(null);
    try {
      const headers: Record<string, string> = {};
      if (bybitKey.trim() && !isMasked(bybitKey)) headers["x-bybit-key"] = bybitKey.trim();
      if (bybitSecret.trim() && !isMasked(bybitSecret)) headers["x-bybit-secret"] = bybitSecret.trim();
      if (bybitProxy.trim()) headers["x-bybit-proxy"] = bybitProxy.trim();
      if (bybitBaseUrl.trim()) headers["x-bybit-base-url"] = bybitBaseUrl.trim();
      if (bybitBackupProxy.trim()) headers["x-bybit-backup-proxy"] = bybitBackupProxy.trim();
      if (bybitBackupBaseUrl.trim()) headers["x-bybit-backup-base-url"] = bybitBackupBaseUrl.trim();

      const res = await fetch("/api/bybit/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          apiKey: bybitKey.trim(),
          apiSecret: isMasked(bybitSecret) ? undefined : bybitSecret.trim(),
          proxyUrl: bybitProxy.trim() || undefined,
          baseUrl: bybitBaseUrl.trim() || undefined,
          backupProxyUrl: bybitBackupProxy.trim() || undefined,
          backupBaseUrl: bybitBackupBaseUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          msg: `Bybit Connected! Latency: ${data.latencyMs}ms | Route: ${data.activeRoute || "Active"} | Equity: $${data.equity?.toLocaleString() ?? 0} USDT | Proxy: ${data.proxyActive ? "Active" : "Direct"}`,
        });
      } else {
        setTestResult({
          success: false,
          msg: data.error || "Failed to authenticate Bybit credentials.",
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, msg: `Network Error: ${err.message}` });
    } finally {
      setTestingStatus(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    purgeBrowserStorage();
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_keys",
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
            bybitBackupProxy: bybitBackupProxy.trim(),
            bybitBackupBaseUrl: bybitBackupBaseUrl.trim(),
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSavedSuccess(true);
        setHasServerKeys({
          binance: Boolean(binanceKey.trim()),
          bitget: Boolean(bitgetKey.trim()),
          coindcx: Boolean(coindcxKey.trim()),
          bybit: Boolean(bybitKey.trim()),
        });
        setTimeout(() => {
          setSavedSuccess(false);
          if (onSaved) onSaved();
          onClose();
        }, 800);
      } else {
        setTestResult({ success: false, msg: data.error || "Failed to save keys to account." });
      }
    } catch (err: any) {
      setTestResult({ success: false, msg: `Save error: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearTab = async () => {
    purgeBrowserStorage();
    const updatePayload: Record<string, string> = {};
    if (activeTab === "binance") {
      updatePayload.binanceKey = "";
      updatePayload.binanceSecret = "";
      setBinanceKey("");
      setBinanceSecret("");
      setBinanceEndpoint("auto");
      setHasServerKeys((prev) => ({ ...prev, binance: false }));
    } else if (activeTab === "bitget") {
      updatePayload.bitgetKey = "";
      updatePayload.bitgetSecret = "";
      updatePayload.bitgetPassphrase = "";
      setBitgetKey("");
      setBitgetSecret("");
      setBitgetPassphrase("");
      setBitgetEnv("demo");
      setHasServerKeys((prev) => ({ ...prev, bitget: false }));
    } else if (activeTab === "coindcx") {
      updatePayload.coindcxKey = "";
      updatePayload.coindcxSecret = "";
      setCoinDcxKey("");
      setCoinDcxSecret("");
      setHasServerKeys((prev) => ({ ...prev, coindcx: false }));
    } else if (activeTab === "bybit") {
      updatePayload.bybitKey = "";
      updatePayload.bybitSecret = "";
      updatePayload.bybitProxy = "";
      updatePayload.bybitBaseUrl = "";
      setBybitKey("");
      setBybitSecret("");
      setBybitProxy("");
      setBybitBaseUrl("");
      setHasServerKeys((prev) => ({ ...prev, bybit: false }));
    }

    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_keys",
          apiKeys: updatePayload,
        }),
      });
      setTestResult({ success: true, msg: `Keys for ${activeTab.toUpperCase()} removed from server vault.` });
      if (onSaved) onSaved();
    } catch {}
  };

  const handleClearAll = async () => {
    purgeBrowserStorage();
    setBinanceKey("");
    setBinanceSecret("");
    setBinanceEndpoint("auto");
    setBitgetKey("");
    setBitgetSecret("");
    setBitgetPassphrase("");
    setBitgetEnv("demo");
    setCoinDcxKey("");
    setCoinDcxSecret("");
    setBybitKey("");
    setBybitSecret("");
    setBybitProxy("");
    setBybitBaseUrl("");
    setHasServerKeys({ binance: false, bitget: false, coindcx: false, bybit: false });

    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_keys",
          apiKeys: {
            binanceKey: "",
            binanceSecret: "",
            bitgetKey: "",
            bitgetSecret: "",
            bitgetPassphrase: "",
            coindcxKey: "",
            coindcxSecret: "",
            bybitKey: "",
            bybitSecret: "",
            bybitProxy: "",
            bybitBaseUrl: "",
          },
        }),
      });
      setTestResult({ success: true, msg: "All exchange keys purged from server vault." });
      if (onSaved) onSaved();
    } catch {}
  };

  const handleLoadDemoPresets = () => {
    if (activeTab === "binance") {
      setBinanceKey("YOUR_BINANCE_API_KEY");
      setBinanceSecret("YOUR_BINANCE_API_SECRET");
      setBinanceEndpoint("https://demo-fapi.binance.com");
    } else if (activeTab === "bitget") {
      setBitgetKey("YOUR_BITGET_API_KEY");
      setBitgetSecret("YOUR_BITGET_API_SECRET");
      setBitgetPassphrase("ArbitrageBot2027");
      setBitgetEnv("demo");
    }
    setTestResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-surface border border-border p-4 sm:p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-200"
          title="Close Settings"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-2.5 mb-2">
          <KeyRound className="w-5 h-5 text-accent-amber" />
          <h3 className="text-base font-bold text-zinc-100">ENCRYPTED USER VAULT</h3>
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
            <Lock className="w-3 h-3" />
            <span>AES-256-GCM Server Vault</span>
          </span>
        </div>

        <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
          Keys are stored <strong className="text-zinc-200">encrypted per-user on the server</strong> and auto-loaded whenever you log in. <span className="text-emerald-400 font-semibold">Zero keys saved in browser storage.</span>
        </p>

        {/* Tab Switcher */}
        <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
          <div className="flex space-x-2">
            <button
              onClick={() => {
                setActiveTab("binance");
                setTestResult(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg font-semibold flex items-center space-x-1.5 transition-colors ${
                activeTab === "binance"
                  ? "bg-accent-amber/20 text-accent-amber border border-accent-amber/40"
                  : "bg-surface-card text-zinc-400 hover:text-zinc-200 border border-transparent"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Binance Futures</span>
              {hasServerKeys.binance && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-1" title="Active on account" />}
            </button>
            <button
              onClick={() => {
                setActiveTab("bitget");
                setTestResult(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg font-semibold flex items-center space-x-1.5 transition-colors ${
                activeTab === "bitget"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                  : "bg-surface-card text-zinc-400 hover:text-zinc-200 border border-transparent"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Bitget Perpetuals</span>
              {hasServerKeys.bitget && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 ml-1" title="Active on account" />}
            </button>
            <button
              onClick={() => {
                setActiveTab("coindcx");
                setTestResult(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg font-semibold flex items-center space-x-1.5 transition-colors ${
                activeTab === "coindcx"
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/40"
                  : "bg-surface-card text-zinc-400 hover:text-zinc-200 border border-transparent"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>CoinDCX</span>
              {hasServerKeys.coindcx && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 ml-1" title="Active on account" />}
            </button>
            <button
              onClick={() => {
                setActiveTab("bybit");
                setTestResult(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg font-semibold flex items-center space-x-1.5 transition-colors ${
                activeTab === "bybit"
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  : "bg-surface-card text-zinc-400 hover:text-zinc-200 border border-transparent"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Bybit</span>
              {hasServerKeys.bybit && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-1" title="Active on account" />}
            </button>
          </div>

          <button
            onClick={handleLoadDemoPresets}
            title="Load shared demo credentials for rapid testing"
            className="text-[11px] text-zinc-500 hover:text-amber-400 flex items-center space-x-1 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
          >
            <Sparkles className="w-3 h-3" />
            <span>Load Demo Presets</span>
          </button>
        </div>

        {/* TAB 1: BINANCE */}
        {activeTab === "binance" && (
          <div className="space-y-4">
            <div className="p-2.5 rounded-lg bg-surface-card border border-border text-[11px] text-zinc-400 flex items-center justify-between">
              <div>
                <span className="font-semibold text-zinc-300">Status: </span>
                {hasServerKeys.binance ? (
                  <span className="text-emerald-400 font-bold">✓ Encrypted Key Active on Your Account</span>
                ) : (
                  <span className="text-amber-400">Using Server Default (Configure to override)</span>
                )}
              </div>
              {hasServerKeys.binance && (
                <button
                  onClick={handleClearTab}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center space-x-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove Custom Key</span>
                </button>
              )}
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Binance API Key</span>
                {binanceKey && <span className="text-[10px] text-zinc-500">({binanceKey.length} chars)</span>}
              </label>
              <input
                type="text"
                value={binanceKey}
                onChange={(e) => {
                  setBinanceKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your Binance API Key..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-accent-amber font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Binance API Secret</span>
                {binanceSecret && <span className="text-[10px] text-zinc-500">({binanceSecret.length} chars)</span>}
              </label>
              <input
                type="password"
                value={binanceSecret}
                onChange={(e) => {
                  setBinanceSecret(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your Binance API Secret (or leave masked to keep existing)..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-accent-amber font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5 text-zinc-500" />
                <span>Target Environment</span>
              </label>
              <select
                value={binanceEndpoint}
                onChange={(e) => {
                  setBinanceEndpoint(e.target.value);
                  setTestResult(null);
                }}
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-accent-amber"
              >
                <option value="auto">Auto-Detect (Classic Testnet or Demo Trading)</option>
                <option value="https://testnet.binancefuture.com">Classic Testnet (testnet.binancefuture.com)</option>
                <option value="https://demo-fapi.binance.com">Demo Trading (demo-fapi.binance.com)</option>
                <option value="https://fapi.binance.com">Production Live (fapi.binance.com)</option>
              </select>
            </div>
          </div>
        )}

        {/* TAB 2: BITGET */}
        {activeTab === "bitget" && (
          <div className="space-y-4">
            <div className="p-2.5 rounded-lg bg-surface-card border border-border text-[11px] text-zinc-400 flex items-center justify-between">
              <div>
                <span className="font-semibold text-zinc-300">Status: </span>
                {hasServerKeys.bitget ? (
                  <span className="text-cyan-400 font-bold">✓ Encrypted Key Active on Your Account</span>
                ) : (
                  <span className="text-amber-400">Using Server Default (Configure to override)</span>
                )}
              </div>
              {hasServerKeys.bitget && (
                <button
                  onClick={handleClearTab}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center space-x-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove Custom Key</span>
                </button>
              )}
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Bitget API Key</span>
                {bitgetKey && <span className="text-[10px] text-zinc-500">({bitgetKey.length} chars)</span>}
              </label>
              <input
                type="text"
                value={bitgetKey}
                onChange={(e) => {
                  setBitgetKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your Bitget API Key (e.g. bg_...)..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Bitget API Secret</span>
                {bitgetSecret && <span className="text-[10px] text-zinc-500">({bitgetSecret.length} chars)</span>}
              </label>
              <input
                type="password"
                value={bitgetSecret}
                onChange={(e) => {
                  setBitgetSecret(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your Bitget API Secret (or leave masked)..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Bitget API Passphrase (API Token)</span>
                <span className="text-[10px] text-amber-400">Required by Bitget</span>
              </label>
              <input
                type="password"
                value={bitgetPassphrase}
                onChange={(e) => {
                  setBitgetPassphrase(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Enter the Passphrase you set on Bitget..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-cyan-400 font-mono"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                ℹ️ The 8–32 character passphrase chosen when generating this key.
              </p>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5 text-zinc-500" />
                <span>Bitget Trading Mode</span>
              </label>
              <select
                value={bitgetEnv}
                onChange={(e) => {
                  setBitgetEnv(e.target.value);
                  setTestResult(null);
                }}
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-cyan-400"
              >
                <option value="live">Bitget Live Production (api.bitget.com - Classic & UTA)</option>
                <option value="demo">Bitget V2 Paper Trading (Demo Mode)</option>
              </select>
            </div>
          </div>
        )}

        {/* TAB 3: COINDCX */}
        {activeTab === "coindcx" && (
          <div className="space-y-4">
            <div className="p-2.5 rounded-lg bg-surface-card border border-border text-[11px] text-zinc-400 flex items-center justify-between">
              <div>
                <span className="font-semibold text-zinc-300">Status: </span>
                {hasServerKeys.coindcx ? (
                  <span className="text-purple-400 font-bold">✓ Encrypted Key Active on Your Account</span>
                ) : (
                  <span className="text-zinc-500">No Key Stored (Simulation Mode Active)</span>
                )}
              </div>
              {hasServerKeys.coindcx && (
                <button
                  onClick={handleClearTab}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center space-x-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove Custom Key</span>
                </button>
              )}
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>CoinDCX API Key</span>
                {coindcxKey && <span className="text-[10px] text-zinc-500">({coindcxKey.length} chars)</span>}
              </label>
              <input
                type="text"
                value={coindcxKey}
                onChange={(e) => {
                  setCoinDcxKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your CoinDCX API Key..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-purple-400 font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>CoinDCX API Secret</span>
                {coindcxSecret && <span className="text-[10px] text-zinc-500">({coindcxSecret.length} chars)</span>}
              </label>
              <input
                type="password"
                value={coindcxSecret}
                onChange={(e) => {
                  setCoinDcxSecret(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your CoinDCX API Secret (or leave masked)..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-purple-400 font-mono"
              />
            </div>

            <div className="p-2.5 rounded-lg bg-purple-950/20 border border-purple-500/20 text-[11px] text-zinc-400 space-y-1">
              <div className="text-purple-300 font-bold flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5" />
                <span>CoinDCX Derivatives (Mainnet)</span>
              </div>
              <div>Direct integration with 505+ perpetual pairs. Encrypted at rest with AES-256-GCM on the server. Zero plaintext storage in browser.</div>
            </div>
          </div>
        )}

        {/* TAB 4: BYBIT */}
        {activeTab === "bybit" && (
          <div className="space-y-4">
            <div className="p-2.5 rounded-lg bg-surface-card border border-border text-[11px] text-zinc-400 flex items-center justify-between">
              <div>
                <span className="font-semibold text-zinc-300">Status: </span>
                {hasServerKeys.bybit ? (
                  <span className="text-amber-400 font-bold">✓ Encrypted Key Active on Your Account</span>
                ) : (
                  <span className="text-zinc-500">No Key Stored (Simulation Mode Active)</span>
                )}
              </div>
              {hasServerKeys.bybit && (
                <button
                  onClick={handleClearTab}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center space-x-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove Key</span>
                </button>
              )}
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Bybit API Key (Mainnet)</span>
                {bybitKey && <span className="text-[10px] text-zinc-500">({bybitKey.length} chars)</span>}
              </label>
              <input
                type="text"
                value={bybitKey}
                onChange={(e) => {
                  setBybitKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your Bybit API Key (e.g. LctwamyAeiOTODV9bv)..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-amber-400 font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Bybit API Secret</span>
                {bybitSecret && <span className="text-[10px] text-zinc-500">({bybitSecret.length} chars)</span>}
              </label>
              <input
                type="password"
                value={bybitSecret}
                onChange={(e) => {
                  setBybitSecret(e.target.value);
                  setTestResult(null);
                }}
                placeholder="Paste your Bybit API Secret (or leave masked)..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-amber-400 font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Primary Proxy / Worker URL (Bypass CloudFront Geo-Block)</span>
                {bybitProxy || bybitBaseUrl ? (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                    Primary Active
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-500">Optional</span>
                )}
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
                  setTestResult(null);
                }}
                placeholder="https://bybit-proxy.workers.dev OR http://user:pass@host:port"
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-amber-400 font-mono"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">
                Primary route: Free Cloudflare Worker URL or HTTP/SOCKS5 proxy. CloudFront blocks direct US server requests.
              </span>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 block mb-1 flex items-center justify-between">
                <span>Backup Proxy / Worker URL (Automatic Failover Pool)</span>
                {bybitBackupProxy || bybitBackupBaseUrl ? (
                  <span className="text-[10px] text-cyan-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block animate-pulse"></span>
                    Backup Standby
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-500">Optional (Recommended)</span>
                )}
              </label>
              <input
                type="text"
                value={bybitBackupProxy || bybitBackupBaseUrl}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.startsWith("http://") || val.startsWith("socks5://") || val.includes("@")) {
                    setBybitBackupProxy(val);
                    setBybitBackupBaseUrl("");
                  } else {
                    setBybitBackupBaseUrl(val);
                    setBybitBackupProxy("");
                  }
                  setTestResult(null);
                }}
                placeholder="https://backup-bybit-proxy.workers.dev OR socks5://backup:port"
                className="w-full px-3 py-2 text-xs rounded-lg bg-surface-card border border-border text-zinc-200 focus:outline-none focus:border-cyan-400 font-mono"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">
                Secondary route for automated zero-downtime failover. Health daemon polls both routes every 5s; if primary drops, requests auto-route to backup with instant 100ms micro-retry.
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/20 text-[11px] text-zinc-400 space-y-1">
              <div className="text-amber-300 font-bold flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5" />
                <span>Bybit Resilient Proxy Pool &amp; Strict Delta-Neutral Freeze</span>
              </div>
              <div>Dual proxy pool active with 5s background health sweeps, pre-flight order gates, single 100ms micro-retry with &lt;150ms emergency IOC market unwind, and Strict Delta-Neutral Freeze protection on exit. Turnkey worker template in scripts/bybit-proxy-worker.js.</div>
            </div>
          </div>
        )}

        {/* Live Test Feedback */}
        {testResult && (
          <div
            className={`mt-4 p-3 rounded-lg text-xs border ${
              testResult.success
                ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                : "bg-rose-950/40 border-rose-800 text-rose-300"
            }`}
          >
            <div className="flex items-start space-x-2">
              {testResult.success ? (
                <Check className="w-4 h-4 text-accent-emerald shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-accent-rose shrink-0 mt-0.5" />
              )}
              <span className="leading-snug">{testResult.msg}</span>
            </div>
          </div>
        )}

        {/* Modal Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleClearAll}
              title="Remove all custom keys and revert to system defaults"
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center space-x-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>Reset All</span>
            </button>
            <button
              onClick={
                activeTab === "binance"
                  ? testBinance
                  : activeTab === "bitget"
                  ? testBitget
                  : activeTab === "coindcx"
                  ? testCoinDcx
                  : testBybit
              }
              disabled={!!testingStatus}
              className="px-3 py-1.5 text-xs rounded border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            >
              {testingStatus ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying {activeTab}...</span>
                </>
              ) : (
                <span>
                  Test{" "}
                  {activeTab === "binance"
                    ? "Binance"
                    : activeTab === "bitget"
                    ? "Bitget"
                    : activeTab === "coindcx"
                    ? "CoinDCX"
                    : "Bybit"}
                </span>
              )}
            </button>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-xs rounded-lg bg-accent-amber hover:bg-amber-400 text-black font-bold flex items-center space-x-1.5 transition-colors disabled:opacity-60"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Encrypting & Saving...</span>
                </>
              ) : savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Vault Updated!</span>
                </>
              ) : (
                <>
                  <Shield className="w-3.5 h-3.5" />
                  <span>Save to Encrypted Vault</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
