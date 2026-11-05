"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { KeyRound, RefreshCw, Wallet, ShieldCheck, ExternalLink, Activity, Radio, History, User, AlertCircle, ArrowRight, Flame, Bot, Zap } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import TelemetryHUD from "@/components/TelemetryHUD";
import SpreadTracker from "@/components/SpreadTracker";
import PreTradeSlippageSimulator from "@/components/PreTradeSlippageSimulator";
import ControlCockpit, { SupportedAsset } from "@/components/ControlCockpit";
import PositionsTable from "@/components/PositionsTable";
import AllCoinsScanner from "@/components/AllCoinsScanner";
import SettingsModal from "@/components/SettingsModal";
import UserProfileModal from "@/components/UserProfileModal";
import ServerDaemonIndicator from "@/components/ServerDaemonIndicator";
import TradingModeSwitcher, { TradingMode } from "@/components/TradingModeSwitcher";
import MainnetOrderConfirmModal from "@/components/MainnetOrderConfirmModal";
import { useDualExchangeWebSockets } from "@/hooks/useDualExchangeWebSockets";
import { getDeterministicNextFundingTime } from "@/lib/settlementTime";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BybitGeoBypassModal } from "@/components/BybitGeoBypassModal";

export default function TerminalPage() {
  const router = useRouter();
  const [selectedSymbol, setSelectedSymbol] = useState<SupportedAsset>("BTCUSDT");
  const [showBybitGeoModal, setShowBybitGeoModal] = useState(false);
  const [selectedCoinFundingTime, setSelectedCoinFundingTime] = useState<number | null>(null);
  const [selectedCoinInterval, setSelectedCoinInterval] = useState<number>(8);
  const [selectedCoinSeed, setSelectedCoinSeed] = useState<any>(null);
  const [loadedPulse, setLoadedPulse] = useState(false);
  const [isScannerExpanded, setIsScannerExpanded] = useState(true);

  // Hydrate scanner full-width preference from localStorage (defaulting to true)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("SCANNER_FULL_WIDTH");
      if (saved !== null) {
        setIsScannerExpanded(saved === "true");
      } else {
        setIsScannerExpanded(true);
      }
    } catch {}
  }, []);

  const handleToggleScannerExpand = useCallback((expanded: boolean) => {
    setIsScannerExpanded(expanded);
    try {
      localStorage.setItem("SCANNER_FULL_WIDTH", String(expanded));
    } catch {}
  }, []);

  // Trading Mode State (Defaults to Live Mainnet)
  const [tradingMode, setTradingMode] = useState<TradingMode>("mainnet");
  const [isMainnetArmed, setIsMainnetArmed] = useState(true);
  const [paperWallet, setPaperWallet] = useState<any>(null);
  const [mainnetModalParams, setMainnetModalParams] = useState<any | null>(null);
  const [isExecutingMainnet, setIsExecutingMainnet] = useState(false);

  // Active Cross-Exchange Corridor Venues (Synchronized with Scanner & Cockpit)
  const [activeVenueA, setActiveVenueA] = useState<string>("CoinDCX");
  const [activeVenueB, setActiveVenueB] = useState<string>("Bybit");

  // Live Dual-Exchange WebSockets Stream with instantaneous seed hydration
  const wsData = useDualExchangeWebSockets(selectedSymbol, selectedCoinSeed);

  const [account, setAccount] = useState<any>(null);
  const [bitgetAccount, setBitgetAccount] = useState<any>(null);
  const [coindcxAccount, setCoinDcxAccount] = useState<any>(null);
  const [bybitAccount, setBybitAccount] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [bitgetError, setBitgetError] = useState<string | null>(null);
  const [coindcxError, setCoinDcxError] = useState<string | null>(null);
  const [bybitError, setBybitError] = useState<string | null>(null);
  const [accountEndpoint, setAccountEndpoint] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Today's Realized Net PnL and Funding Telemetry
  const [todayRealizedPnl, setTodayRealizedPnl] = useState<number>(0);
  const [todayFundingClaimed, setTodayFundingClaimed] = useState<number>(0);
  const [todayTradesCount, setTodayTradesCount] = useState<number>(0);

  // 24/7 Autonomous Autopilot State
  const [isAutopilotActive, setIsAutopilotActive] = useState(false);
  const [autopilotState, setAutopilotState] = useState<string>("IDLE_SCANNING");
  const [minSpreadEntry, setMinSpreadEntry] = useState<number>(12);
  const [exitSpreadTarget, setExitSpreadTarget] = useState<number>(2);
  const lastAutopilotActionRef = useRef<number>(0);

  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Check auth on load
  const verifyAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.isLoggedIn && data.user) {
        setCurrentUser(data.user);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    verifyAuth();
  }, [verifyAuth]);

  // Synchronize live funding interval and next funding settlement when selectedSymbol changes
  useEffect(() => {
    if (selectedCoinSeed?.symbol === selectedSymbol && selectedCoinFundingTime && selectedCoinFundingTime > Date.now()) {
      return;
    }

    let cancelled = false;
    fetch(`/api/ticker?symbol=${selectedSymbol}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || !data.success) return;
        const normFundingTime =
          data.nextFundingTime > 0 && data.nextFundingTime < 1e11
            ? data.nextFundingTime * 1000
            : data.nextFundingTime;
        if (normFundingTime > Date.now()) {
          setSelectedCoinFundingTime(normFundingTime);
        } else {
          setSelectedCoinFundingTime(null);
        }
        setSelectedCoinInterval(data.fundingIntervalHours || 8);
        setSelectedCoinSeed({
          symbol: data.symbol,
          binancePrice: data.binancePrice || data.markPrice || 0,
          bitgetPrice: data.bitgetPrice || data.binancePrice || 0,
          binanceFundingRate: data.binanceFundingRate || 0,
          bitgetFundingRate: data.bitgetFundingRate || 0,
          spreadBps: data.spreadBps || 0,
          annualizedYieldPct: data.annualizedYieldPct || 0,
          nextFundingTime: normFundingTime || 0,
          fundingIntervalHours: data.fundingIntervalHours || 8,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol]);

  const handleSelectCoinFromScanner = useCallback((symbol: string, direction?: string, coin?: any) => {
    setSelectedSymbol(symbol as any);
    if (coin) {
      const vA = coin.venueA || coin.winningVenueA || coin.bestPair?.venueA?.label || coin.bestPair?.venueA;
      const vB = coin.venueB || coin.winningVenueB || coin.bestPair?.venueB?.label || coin.bestPair?.venueB;
      if (vA && vB) {
        setActiveVenueA(vA);
        setActiveVenueB(vB);
      }
      if (coin.nextFundingTime && coin.nextFundingTime > 0) {
        setSelectedCoinFundingTime(coin.nextFundingTime);
      }
      setSelectedCoinInterval(coin.fundingIntervalHours || 8);
      const bPrice = coin.binanceMarkPrice || (coin.exchange === "Binance" ? coin.markPrice : 0) || coin.binancePrice || coin.markPrice || 0;
      const bgPrice = coin.bitgetMarkPrice || (coin.exchange === "Bitget" ? coin.markPrice : 0) || coin.bitgetPrice || bPrice || coin.markPrice || 0;
      const bRate = typeof coin.binanceRate === "number"
        ? coin.binanceRate / 100
        : (coin.exchange === "Binance" && typeof coin.fundingRate === "number" ? coin.fundingRate / 100 : (coin.exchange === "Bitget" && typeof coin.counterpartRate === "number" ? coin.counterpartRate / 100 : 0.0001));
      const bgRate = typeof coin.bitgetRate === "number"
        ? coin.bitgetRate / 100
        : (coin.exchange === "Bitget" && typeof coin.fundingRate === "number" ? coin.fundingRate / 100 : (coin.exchange === "Binance" && typeof coin.counterpartRate === "number" ? coin.counterpartRate / 100 : 0.0002));
      const sprBps = typeof coin.spreadBps === "number" ? coin.spreadBps : 0;
      const annApr = typeof coin.annualizedApr === "number" ? coin.annualizedApr : (typeof coin.annualizedYieldPct === "number" ? coin.annualizedYieldPct : 0);

      setSelectedCoinSeed({
        symbol,
        binancePrice: bPrice,
        bitgetPrice: bgPrice > 0 ? bgPrice : bPrice,
        binanceFundingRate: bRate,
        bitgetFundingRate: bgRate,
        spreadBps: sprBps,
        annualizedYieldPct: annApr,
        nextFundingTime: coin.nextFundingTime || 0,
        fundingIntervalHours: coin.fundingIntervalHours || 8,
      });
    } else {
      setSelectedCoinFundingTime(null);
      setSelectedCoinInterval(8);
    }
    setLoadedPulse(true);
    setTimeout(() => setLoadedPulse(false), 2000);
    // On mobile viewports where columns stack vertically, smoothly scroll to Order Execution Panel
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      const el = document.getElementById("execution-cockpit-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, []);

  const handleExchangesChangeFromScanner = useCallback((exchanges: any, vA: string, vB: string) => {
    if (vA && vB) {
      setActiveVenueA(vA);
      setActiveVenueB(vB);
    }
  }, []);

  // Institutional Security: Purge any legacy plaintext API keys from browser localStorage
  useEffect(() => {
    try {
      ["BINANCE_KEY", "BINANCE_SECRET", "BITGET_KEY", "BITGET_SECRET", "BITGET_PASSPHRASE", "COINDCX_KEY", "COINDCX_SECRET"].forEach((k) => {
        try {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        } catch {}
      });
    } catch {}
  }, []);

  const getVaultHeaders = useCallback((): Record<string, string> => {
    if (typeof window === "undefined") return {};
    const headers: Record<string, string> = {};

    // API secrets are managed strictly in server-side AES-256-GCM vault (zero frontend secret leakage)
    if (currentUser?.email) {
      headers["x-user-email"] = currentUser.email;
    }
    if (currentUser?.id) {
      headers["x-user-id"] = currentUser.id;
    }

    const byKey = localStorage.getItem("BYBIT_KEY");
    const bySecret = localStorage.getItem("BYBIT_SECRET");
    const byProxy = localStorage.getItem("BYBIT_PROXY");
    const byBaseUrl = localStorage.getItem("BYBIT_BASE_URL");
    if (byKey) headers["x-bybit-key"] = byKey;
    if (bySecret) headers["x-bybit-secret"] = bySecret;
    if (byProxy) headers["x-bybit-proxy"] = byProxy;
    if (byBaseUrl) headers["x-bybit-base-url"] = byBaseUrl;

    return headers;
  }, [currentUser]);

  const fetchPaperData = useCallback(async () => {
    try {
      const res = await fetch("/api/paper", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setPaperWallet(data.wallet);
        if (tradingMode === "paper") {
          const paperBalance = data.wallet?.totalBalance || 5000.0;
          setAccount({
            totalWalletBalance: paperBalance,
            availableBalance: paperBalance,
            positions: [],
          });
          setAccountError(null);

          setBitgetAccount({
            success: true,
            venue: "Bitget-Simulation",
            equity: paperBalance,
            available: paperBalance,
            positions: [],
            isSimulated: true,
          });
          setBitgetError(null);

          setCoinDcxAccount({
            success: true,
            venue: "CoinDCX-Paper",
            equity: paperBalance,
            available: paperBalance,
            positions: [],
            isSimulated: true,
          });
          setCoinDcxError(null);

          setBybitAccount({
            success: true,
            venue: "Bybit-Paper",
            equity: paperBalance,
            available: paperBalance,
            walletBalance: paperBalance,
            unrealizedPnL: 0,
            positions: [],
            isSimulated: true,
            keyMask: "PAPER-SIM",
          });
          setBybitError(null);

          const mappedPositions = (data.positions || []).flatMap((pos: any) => [
            {
              symbol: pos.symbol,
              venue: pos.leg1?.venue || "Binance",
              amount: pos.leg1?.side === "BUY" ? pos.leg1?.quantity : -pos.leg1?.quantity,
              entryPrice: pos.leg1?.entryPrice,
              markPrice: pos.leg1?.currentPrice,
              unrealizedPnl: pos.leg1?.unrealizedPnl,
              leverage: pos.leverage,
              isPaper: true,
            },
            {
              symbol: pos.symbol,
              venue: pos.leg2?.venue || "Bitget",
              amount: pos.leg2?.side === "BUY" ? pos.leg2?.quantity : -pos.leg2?.quantity,
              entryPrice: pos.leg2?.entryPrice,
              markPrice: pos.leg2?.currentPrice,
              unrealizedPnl: pos.leg2?.unrealizedPnl,
              leverage: pos.leverage,
              isPaper: true,
            },
          ]);
          setPositions(mappedPositions);
        }
      }
    } catch {}
  }, [tradingMode]);

  const handleResetPaperWallet = async () => {
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const data = await res.json();
      if (data.success) {
        setPaperWallet(data.wallet);
        setPositions([]);
      }
    } catch {}
  };

  const fetchData = useCallback(async () => {
    if (document.hidden) return;
    setIsRefreshing(true);
    try {
      if (tradingMode === "paper") {
        await fetchPaperData();
        return;
      }

      const headers = getVaultHeaders();
      const ts = Date.now();

      let binancePositions: any[] = [];
      let bitgetPositions: any[] = [];

      // 1. Binance Account & Positions
      try {
        const accountRes = await fetch(`/api/account?_t=${ts}`, { headers, cache: "no-store" });
        const accountData = await accountRes.json();
        if (accountData.success) {
          setAccount(accountData);
          binancePositions = (accountData.positions || []).map((p: any) => ({ ...p, venue: p.venue || "Binance" }));
          setAccountError(null);
          if (accountData.endpoint) setAccountEndpoint(accountData.endpoint);
        } else {
          setAccount(null);
          setAccountError(accountData.error || "Failed to authenticate with Binance");
          if (accountData.endpoint) setAccountEndpoint(accountData.endpoint);
        }
      } catch (err: any) {
        setAccount(null);
        setAccountError(err.message || "Network error fetching Binance");
      }

      // 2. Bitget Account
      try {
        const bitgetRes = await fetch(`/api/bitget/account?_t=${ts}`, { headers, cache: "no-store" });
        const bitgetData = await bitgetRes.json();
        if (bitgetData.success) {
          setBitgetAccount(bitgetData);
          bitgetPositions = (bitgetData.positions || []).map((p: any) => ({ ...p, venue: p.venue || "Bitget" }));
          setBitgetError(null);
        } else {
          setBitgetAccount(null);
          setBitgetError(bitgetData.error || "Failed to authenticate with Bitget");
        }
      } catch (err: any) {
        setBitgetAccount(null);
        setBitgetError(err.message || "Network error fetching Bitget");
      }

      // 3. CoinDCX Account
      let coindcxPositions: any[] = [];
      try {
        const cdxRes = await fetch(`/api/coindcx/account?_t=${ts}`, { headers, cache: "no-store" });
        const cdxData = await cdxRes.json();
        if (cdxData.success) {
          setCoinDcxAccount(cdxData);
          coindcxPositions = (cdxData.positions || []).map((p: any) => ({ ...p, venue: p.venue || "CoinDCX" }));
          setCoinDcxError(null);
        } else {
          setCoinDcxAccount(cdxData);
          setCoinDcxError(cdxData.error || "Failed to reach CoinDCX");
        }
      } catch (err: any) {
        setCoinDcxAccount(null);
        setCoinDcxError(err.message || "Network error fetching CoinDCX");
      }

      // 4. Bybit Account
      let bybitPositions: any[] = [];
      try {
        const bybitRes = await fetch(`/api/bybit/account?_t=${ts}`, { headers, cache: "no-store" });
        const bybitData = await bybitRes.json();
        if (bybitData.success) {
          setBybitAccount(bybitData);
          bybitPositions = (bybitData.positions || []).map((p: any) => {
            const rawSize = parseFloat(p.size ?? p.amount ?? "0");
            const amt = typeof p.amount === "number" ? p.amount : (p.side === "Sell" ? -Math.abs(rawSize) : Math.abs(rawSize));
            return {
              ...p,
              venue: p.venue || "Bybit",
              amount: amt,
              unrealizedPnl: parseFloat(p.unrealizedPnl ?? p.unrealisedPnl ?? "0"),
            };
          });
          setBybitError(null);
        } else {
          setBybitAccount(bybitData);
          setBybitError(bybitData.error || "Failed to reach Bybit");
        }
      } catch (err: any) {
        setBybitAccount(null);
        setBybitError(err.message || "Network error fetching Bybit");
      }

      setPositions([...binancePositions, ...bitgetPositions, ...coindcxPositions, ...bybitPositions]);

      // 5. Today's Realized Net PnL and Funding Harvest Telemetry
      try {
        const tradesRes = await fetch(`/api/trades?_t=${ts}`, { cache: "no-store" });
        const tradesData = await tradesRes.json();
        if (tradesData.success && tradesData.todaySummary) {
          setTodayRealizedPnl(tradesData.todaySummary.realizedPnl || 0);
          setTodayFundingClaimed(tradesData.todaySummary.fundingClaimed || 0);
          setTodayTradesCount(tradesData.todaySummary.tradesCount || 0);
        }
      } catch {}
    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [getVaultHeaders, tradingMode, fetchPaperData]);

  useEffect(() => {
    fetchData();
    // 2-second accelerated polling for live balances & trades, pauses when tab is hidden
    const interval = setInterval(() => {
      if (!document.hidden) fetchData();
    }, 2000);

    const onTradesUpdated = () => {
      fetchData();
    };
    window.addEventListener("cockpit_trades_updated", onTradesUpdated);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "cockpit_trades_updated_ts") {
        fetchData();
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      clearInterval(interval);
      window.removeEventListener("cockpit_trades_updated", onTradesUpdated);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [fetchData]);

  const activeCorridor = activeVenueA && activeVenueB
    ? `${activeVenueA.toUpperCase()}_${activeVenueB.toUpperCase()}`
    : "COINDCX_BYBIT";

  const handleClosePosition = async (targetSymbol?: string) => {
    if (tradingMode === "paper") {
      try {
        const res = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close", symbol: targetSymbol }),
        });
        const data = await res.json();
        if (data.success) {
          setCloseError(null);
          await fetchPaperData();
        } else {
          setCloseError(data.error || "Failed to close paper position");
          setTimeout(() => setCloseError(null), 6000);
        }
      } catch (err: any) {
        setCloseError(err.message || "Failed to close paper position");
        setTimeout(() => setCloseError(null), 6000);
      }
      return;
    }

    try {
      const res = await fetch("/api/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getVaultHeaders(),
        },
        body: JSON.stringify({
          symbol: targetSymbol || "ALL",
          corridor: activeCorridor || "COINDCX_BYBIT",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCloseError(null);
        fetchData();
        try { window.dispatchEvent(new Event("cockpit_trades_updated")); localStorage.setItem("cockpit_trades_updated_ts", Date.now().toString()); } catch {}
      } else {
        const errMsg = data.error || data.message || "Failed to close position";
        setCloseError(errMsg);
        setTimeout(() => setCloseError(null), 6000);
      }
    } catch (err: any) {
      setCloseError(`Error: ${err.message}`);
      setTimeout(() => setCloseError(null), 6000);
    }
  };

  const handleConfirmMainnetOrder = async () => {
    if (!mainnetModalParams?.onConfirmed) return;
    setIsExecutingMainnet(true);
    try {
      await mainnetModalParams.onConfirmed();
      setMainnetModalParams(null);
      fetchData();
      try { window.dispatchEvent(new Event("cockpit_trades_updated")); localStorage.setItem("cockpit_trades_updated_ts", Date.now().toString()); } catch {}
    } catch (err: any) {
      setCloseError(err.message || "Failed to execute mainnet order");
    } finally {
      setIsExecutingMainnet(false);
    }
  };

  // Dynamic real-time combined unrealized PnL
  const dynamicNetPnl = (positions || []).reduce((acc, pos) => {
    if (!pos) return acc;
    const isCurrentAsset = Boolean(selectedSymbol && pos.symbol === selectedSymbol);
    const rawLivePrice = pos.venue === "Bitget" ? wsData.bitgetPrice : wsData.binancePrice;
    const baselinePrice = pos.markPrice || pos.entryPrice || 0;
    const isPlausible = Boolean(
      rawLivePrice > 0 &&
      baselinePrice > 0 &&
      Math.abs(rawLivePrice - baselinePrice) / baselinePrice < 0.20
    );
    const liveMarkPrice = (isCurrentAsset && isPlausible) ? rawLivePrice : baselinePrice;
    const pnl = (isCurrentAsset && isPlausible && pos.amount !== 0 && pos.entryPrice > 0)
      ? (liveMarkPrice - pos.entryPrice) * pos.amount
      : (pos.unrealizedPnl || 0);
    return isFinite(pnl) ? acc + pnl : acc;
  }, 0);

  const isNonAdminBlankKeys = Boolean(currentUser && currentUser.role?.toLowerCase() !== "admin" && (!account?.totalWalletBalance && !bitgetAccount?.equity));

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-background text-zinc-100 flex flex-col font-mono">
        <Navbar />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="flex items-center space-x-3 text-zinc-400 text-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-accent-amber" />
            <span>Verifying institutional quant session...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-zinc-100 flex flex-col font-mono selection:bg-accent-amber/20 selection:text-accent-amber">
      <Navbar />

      <main className="flex-1 max-w-7xl 2xl:max-w-[1600px] w-full mx-auto p-3 sm:p-4 md:p-8 pb-24 sm:pb-8 space-y-4 sm:space-y-6">
        {/* Top Header Bar */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-5">
          <div className="w-full md:w-auto">
            {/* Row 1: Title & Trading Mode Switcher */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${tradingMode === "mainnet" ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"}`} />
              <h1 className="text-base sm:text-lg md:text-xl font-bold tracking-tight uppercase text-zinc-100">
                CROSS-EXCHANGE FUNDING ARBITRAGE
              </h1>
              <TradingModeSwitcher
                currentMode={tradingMode}
                onModeChange={setTradingMode}
                isMainnetArmed={isMainnetArmed}
                onMainnetArmedChange={setIsMainnetArmed}
              />
            </div>

            {/* Row 2: Secondary Telemetry Status Bar (Zero Tag Overlap) */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2 pt-2 border-t border-border/40 text-[10px] font-mono">
              {/* WebSocket Connectivity Pills */}
              <span className={`px-2 py-0.5 rounded flex items-center space-x-1 border ${
                wsData.binanceWsConnected
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800"
              }`}>
                <Radio className={`w-2.5 h-2.5 ${wsData.binanceWsConnected ? "text-amber-400 animate-pulse" : "text-zinc-600"}`} />
                <span>BN WS</span>
              </span>

              <span className={`px-2 py-0.5 rounded flex items-center space-x-1 border ${
                wsData.bitgetWsConnected
                  ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800"
              }`} title="Bitget Private Trade WebSocket online (<35ms latency)">
                <Zap className={`w-2.5 h-2.5 ${wsData.bitgetWsConnected ? "text-cyan-400 animate-pulse" : "text-zinc-600"}`} />
                <span>BG WS &lt;35ms</span>
              </span>

              {/* 1-Click Live Bot Quick Nav & Status Pill */}
              <Link
                href="/bot"
                className="px-2.5 py-0.5 rounded bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 text-emerald-300 border border-emerald-500/40 hover:border-emerald-400 flex items-center space-x-1 transition-all shadow-sm active:scale-95 group"
                title="Open 24/7 Live Autonomous Bot Terminal"
              >
                <Bot className="w-2.5 h-2.5 text-emerald-400 group-hover:animate-bounce" />
                <span className="font-bold">LIVE BOT READY</span>
                <span className="text-[9px] text-emerald-400 font-mono">→</span>
              </Link>

              {/* API Key Vault Status */}
              {account?.keyMask && (
                <span className={`px-2 py-0.5 rounded border ${
                  account.isCustomKey
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800"
                }`}>
                  BN: {account.keyMask} {account.isCustomKey ? "(VAULT)" : "(ADMIN)"}
                </span>
              )}

              {bitgetAccount?.keyMask && (
                <span className={`px-2 py-0.5 rounded border ${
                  bitgetAccount.isCustomKey
                    ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800"
                }`}>
                  BG: {bitgetAccount.keyMask} {bitgetAccount.isCustomKey ? "(VAULT)" : "(ADMIN)"}
                </span>
              )}

              {coindcxAccount?.keyMask && (
                <span className={`px-2 py-0.5 rounded border ${
                  coindcxAccount.isCustomKey
                    ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800"
                }`}>
                  CDX: {coindcxAccount.keyMask} {coindcxAccount.isCustomKey ? "(VAULT)" : "(ADMIN)"}
                </span>
              )}

              {bybitAccount?.keyMask && (
                <span className={`px-2 py-0.5 rounded border ${
                  bybitAccount.isCustomKey
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800"
                }`}>
                  BYB: {bybitAccount.keyMask} {bybitAccount.isCustomKey ? "(VAULT)" : "(ADMIN)"}
                </span>
              )}

              {/* Admin / User Identity Badge */}
              {currentUser?.email ? (
                <span className="px-2 py-0.5 rounded bg-zinc-900/90 text-zinc-300 border border-zinc-800 flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{currentUser.role?.toUpperCase() === "ADMIN" ? "Admin" : "User"}: {currentUser.email}</span>
                </span>
              ) : (
                <Link
                  href="/login"
                  className="px-2 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30 flex items-center space-x-1 hover:bg-amber-500/20 transition-colors"
                  title="Sign in to execute trades and configure API keys"
                >
                  <KeyRound className="w-2.5 h-2.5" />
                  <span>Spectator • Sign In</span>
                </Link>
              )}
            </div>

            <p className="text-[11px] text-zinc-500 mt-1.5 hidden sm:block">
              Delta-Neutral Basis Capture • Multi-Stream WebSockets • Binance, Bitget, CoinDCX & Bybit Perpetuals
            </p>
          </div>

          {/* Live Wallet & Account Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:flex-wrap items-center gap-2 sm:gap-3 w-full lg:w-auto">
            {/* Binance Wallet */}
            <div className="flex items-center space-x-2 bg-surface px-2.5 py-2 sm:px-3 rounded-lg border border-border text-xs">
              <Wallet className={`w-4 h-4 ${accountError ? "text-accent-rose" : "text-accent-amber"}`} />
              <div>
                <div className="text-[10px] text-zinc-500">BINANCE WALLET</div>
                <div className="font-bold text-zinc-200">
                  {account?.totalWalletBalance !== undefined
                    ? (
                      <div className="flex items-center gap-1.5">
                        <span>${account.totalWalletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT</span>
                        {account?.isStandby && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-accent-amber border border-amber-500/20 font-mono">STANDBY</span>
                        )}
                      </div>
                    )
                    : !currentUser
                    ? <Link href="/login" className="text-zinc-400 hover:text-accent-amber underline decoration-dotted text-[11px]">SIGN IN</Link>
                    : accountError
                    ? <span className="text-accent-rose">AUTH REQUIRED</span>
                    : "SYNCING..."}
                </div>
              </div>
            </div>

            {/* Bitget Equity */}
            <div className="flex items-center space-x-2 bg-surface px-2.5 py-2 sm:px-3 rounded-lg border border-border text-xs">
              <Wallet className={`w-4 h-4 ${bitgetError ? "text-accent-rose" : "text-cyan-400"}`} />
              <div>
                <div className="text-[10px] text-zinc-500">BITGET EQUITY</div>
                <div className="font-bold text-zinc-200">
                  {bitgetAccount?.equity !== undefined
                    ? `$${bitgetAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`
                    : !currentUser
                    ? <Link href="/login" className="text-zinc-400 hover:text-cyan-400 underline decoration-dotted text-[11px]">SIGN IN</Link>
                    : bitgetError
                    ? <span className="text-accent-rose">AUTH REQUIRED</span>
                    : "SYNCING..."}
                </div>
              </div>
            </div>

            {/* CoinDCX Equity */}
            <div className="flex items-center space-x-2 bg-surface px-2.5 py-2 sm:px-3 rounded-lg border border-border text-xs">
              <Wallet className={`w-4 h-4 ${coindcxError ? (coindcxAccount?.requiresKeys ? "text-accent-rose" : "text-amber-400") : "text-purple-400"}`} />
              <div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <span>COINDCX EQUITY</span>
                  {coindcxAccount?.keyMask && (
                    <span className="text-[9px] text-zinc-400 font-mono">({coindcxAccount.keyMask})</span>
                  )}
                </div>
                <div className="font-bold text-zinc-200">
                  {tradingMode === "paper"
                    ? `$${(coindcxAccount?.equity ?? paperWallet?.totalBalance ?? 5000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`
                    : coindcxAccount?.equity !== undefined && coindcxAccount?.equity !== null && !coindcxError
                    ? `$${coindcxAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`
                    : coindcxAccount?.requiresKeys
                    ? <span className="text-accent-rose">AUTH REQUIRED</span>
                    : coindcxError
                    ? (
                      <span className="text-amber-400 text-[11px] font-mono cursor-pointer" title={coindcxError}>
                        {coindcxError.toLowerCase().includes("auth") || coindcxError.toLowerCase().includes("key")
                          ? "INVALID KEY"
                          : "GATEWAY OFFLINE"}
                      </span>
                    )
                    : !currentUser
                    ? <Link href="/login" className="text-zinc-400 hover:text-purple-400 underline decoration-dotted text-[11px]">SIGN IN</Link>
                    : "SYNCING..."}
                </div>
              </div>
            </div>

            {/* Bybit Equity */}
            <div className="flex items-center space-x-2 bg-surface px-2.5 py-2 sm:px-3 rounded-lg border border-border text-xs">
              <Wallet className={`w-4 h-4 ${bybitError ? (bybitAccount?.requiresKeys ? "text-accent-rose" : "text-amber-400") : "text-amber-400"}`} />
              <div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <span>BYBIT EQUITY</span>
                  {bybitAccount?.keyMask && (
                    <span className="text-[9px] text-zinc-400 font-mono">({bybitAccount.keyMask})</span>
                  )}
                </div>
                <div className="font-bold text-zinc-200">
                  {tradingMode === "paper"
                    ? `$${(bybitAccount?.equity ?? paperWallet?.totalBalance ?? 5000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`
                    : bybitAccount?.equity !== undefined && bybitAccount?.equity !== null && !bybitError
                    ? `$${bybitAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`
                    : bybitAccount?.requiresKeys
                    ? <span className="text-accent-rose">AUTH REQUIRED</span>
                    : bybitError
                    ? (
                      <button
                        onClick={() => setShowBybitGeoModal(true)}
                        className="text-amber-400 hover:text-amber-300 text-[11px] font-mono cursor-pointer underline decoration-dotted text-left flex items-center gap-1 transition-colors"
                        title="Click to view CloudFront Geo-Bypass & resolution options"
                      >
                        <span>
                          {bybitError.toLowerCase().includes("unmatched ip") || bybitError.toLowerCase().includes("bound ip")
                            ? "WHITELIST VPS IP (15.252.200.246)"
                            : bybitError.toLowerCase().includes("limit") || bybitError.toLowerCase().includes("bandwidth")
                            ? "PROXY BANDWIDTH EXCEEDED"
                            : bybitError.toLowerCase().includes("cloudfront") || bybitError.toLowerCase().includes("geo-block")
                            ? "GEO-BLOCKED (CloudFront)"
                            : bybitError.toLowerCase().includes("timeout") || bybitError.toLowerCase().includes("connect")
                            ? "PROXY OFFLINE"
                            : bybitError.toLowerCase().includes("invalid api") || bybitError.toLowerCase().includes("error sign")
                            ? "INVALID KEY"
                            : "GATEWAY OFFLINE"}
                        </span>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-sans font-bold">
                          FIX
                        </span>
                      </button>
                    )
                    : !currentUser
                    ? <Link href="/login" className="text-zinc-400 hover:text-amber-400 underline decoration-dotted text-[11px]">SIGN IN</Link>
                    : "SYNCING..."}
                </div>
              </div>
            </div>

            {/* Unrealized PnL */}
            <div className="col-span-2 sm:col-span-1 flex items-center space-x-2 bg-surface px-2.5 py-2 sm:px-3 rounded-lg border border-border text-xs">
              <ShieldCheck className="w-4 h-4 text-accent-emerald" />
              <div>
                <div className="text-[10px] text-zinc-500">NET UNREALIZED PnL</div>
                <div className={`font-bold ${dynamicNetPnl >= 0 ? "text-accent-emerald" : "text-accent-rose"}`}>
                  {positions.length > 0
                    ? `${dynamicNetPnl >= 0 ? "+" : ""}$${dynamicNetPnl.toFixed(4)} USDT`
                    : "$0.0000 USDT"}
                </div>
              </div>
            </div>

            {/* Today's Realized Net PnL */}
            <div className="col-span-2 sm:col-span-1 flex items-center space-x-2 bg-surface px-2.5 py-2 sm:px-3 rounded-lg border border-border text-xs">
              <Activity className={`w-4 h-4 ${todayRealizedPnl >= 0 ? "text-accent-emerald" : "text-accent-rose"}`} />
              <div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <span>TODAY&apos;S REALIZED PnL</span>
                  {todayTradesCount > 0 && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-300 font-mono">
                      {todayTradesCount} trade{todayTradesCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className={`font-bold font-mono ${todayRealizedPnl >= 0 ? "text-accent-emerald" : "text-accent-rose"}`}>
                  {todayRealizedPnl >= 0 ? "+" : ""}${todayRealizedPnl.toFixed(4)} USDT
                </div>
              </div>
            </div>

            {/* Action buttons & controls row */}
            <div className="col-span-2 sm:col-span-3 lg:col-span-auto flex items-center justify-between sm:justify-start gap-1.5 sm:gap-2 pt-1 sm:pt-0">
              {/* 24/7 Server Autonomous Bot Status Indicator */}
              <ServerDaemonIndicator onOpenProfile={() => setIsProfileOpen(true)} />

              <Link
                href="/bot"
                className="flex items-center space-x-1.5 px-2.5 py-2 sm:px-3 rounded-lg bg-surface hover:bg-amber-500/10 border border-amber-500/40 text-xs text-amber-300 hover:text-accent-amber font-semibold transition-all shadow-sm"
                title="Open Dedicated 24/7 Autonomous Bot Dashboard"
              >
                <Bot className="w-3.5 h-3.5 text-accent-amber" />
                <span>Auto-Bot &rarr;</span>
              </Link>

              <Link
                href="/history"
                className="flex items-center space-x-1.5 px-2.5 py-2 sm:px-3 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 transition-colors"
                title="View Complete Trade History Log"
              >
                <History className="w-3.5 h-3.5 text-accent-cyan" />
                <span className="hidden sm:inline">History</span>
              </Link>

              <Link
                href="/profile"
                className="flex items-center space-x-1.5 px-2.5 py-2 sm:px-3 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 transition-colors"
                title="Quant Profile & API Keys Vault"
              >
                <User className="w-3.5 h-3.5 text-accent-amber" />
                <span className="hidden sm:inline">Profile</span>
              </Link>

              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex items-center space-x-1.5 px-2.5 py-2 sm:px-3 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-xs text-zinc-300 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5 text-accent-amber" />
                <span>Vault</span>
              </button>

              <button
                onClick={fetchData}
                disabled={isRefreshing}
                className="p-2 rounded-lg bg-surface hover:bg-zinc-800 border border-border text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-accent-amber" : ""}`} />
              </button>
            </div>
          </div>
        </header>

        {/* Trading Mode Status Bar */}
        {tradingMode === "mainnet" ? (
          <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/30 text-xs flex flex-wrap items-center justify-between gap-3 shadow-md font-mono text-zinc-200">
            <div className="flex items-center space-x-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div>
                <span className="font-bold text-emerald-400 uppercase tracking-wide">
                  LIVE MAINNET TRADING ENGAGED • REAL FUNDS
                </span>
                <p className="text-zinc-400 text-[11px] mt-0.5">
                  Direct execution corridor active across CoinDCX, Bybit, Binance & Bitget. Atomic auto-unwind protection active.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2.5 py-1 rounded bg-emerald-900/60 border border-emerald-600/60 text-emerald-300 font-bold uppercase tracking-wider">
                🛡️ Live Mainnet Armed
              </span>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-950/30 text-xs flex flex-wrap items-center justify-between gap-3 shadow-md font-mono text-zinc-200">
            <div className="flex items-center space-x-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div>
                <span className="font-bold text-amber-400 uppercase tracking-wide">
                  {tradingMode === "paper" ? "PAPER SIMULATION MODE (VIRTUAL WALLET)" : "TESTNET SANDBOX MODE"}
                </span>
                <p className="text-zinc-400 text-[11px] mt-0.5">
                  Simulation only. Real mainnet capital is not affected.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setIsMainnetArmed(true);
                setTradingMode("mainnet");
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-sm"
            >
              Switch to Live Mainnet
            </button>
          </div>
        )}

        {/* Informational Key Requirement Notice for Non-Admin accounts */}
        {isNonAdminBlankKeys && (
          <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-accent-amber shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-amber-300">Personal API Keys Required:</span>
                <p className="text-zinc-300 text-[11px] mt-0.5">
                  You are signed in as a standard quant account. Standard accounts start with blank API keys and must supply their own exchange credentials. Please enter your Binance and Bitget keys in your Profile or Vault.
                </p>
              </div>
            </div>
            <Link
              href="/profile"
              className="px-3 py-1.5 rounded-lg bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs whitespace-nowrap transition-colors flex items-center space-x-1 self-start sm:self-center"
            >
              <span>Setup Keys in Profile</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Account Error / Diagnostic Alert Banner */}
        {(accountError || bitgetError) && !isNonAdminBlankKeys && currentUser && !account?.isStandby && !accountError?.toLowerCase().includes("sign in") && !accountError?.toLowerCase().includes("standby") && !bitgetError?.toLowerCase().includes("sign in") && (
          <div className="p-4 rounded-xl border border-rose-500/40 bg-rose-500/10 space-y-3 text-xs">
            {accountError && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1 w-full">
                  <div className="font-bold text-rose-300 flex items-center gap-1.5">
                    <span>⚠️ Binance Authentication Issue:</span>
                  </div>
                  <div className="text-zinc-300 font-mono text-[11px] bg-zinc-950/60 p-2 rounded border border-rose-500/20 max-w-3xl overflow-x-auto">
                    {accountError}
                  </div>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="px-3 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 font-semibold whitespace-nowrap transition-colors self-start sm:self-center"
                >
                  Open Vault Settings
                </button>
              </div>
            )}

            {bitgetError && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-rose-500/20">
                <div className="space-y-1 w-full">
                  <div className="font-bold text-rose-300 flex items-center gap-1.5">
                    <span>⚠️ Bitget Authentication Issue:</span>
                  </div>
                  <div className="text-zinc-300 font-mono text-[11px] bg-zinc-950/60 p-2 rounded border border-rose-500/20 max-w-3xl overflow-x-auto">
                    {bitgetError}
                  </div>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="px-3 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 font-semibold whitespace-nowrap transition-colors self-start sm:self-center"
                >
                  Open Vault Settings
                </button>
              </div>
            )}
          </div>
        )}

        {/* Trending Asset Quick-Explorer Strip */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none text-xs">
          <span className="text-[10px] text-zinc-500 uppercase font-semibold shrink-0 flex items-center space-x-1">
            <Flame className="w-3.5 h-3.5 text-accent-amber animate-pulse" />
            <span>QUICK EXPLORE:</span>
          </span>
          {[
            { sym: "BTCUSDT", label: "BTC" },
            { sym: "ETHUSDT", label: "ETH" },
            { sym: "SOLUSDT", label: "SOL" },
            { sym: "DOGEUSDT", label: "DOGE" },
            { sym: "LTCUSDT", label: "LTC" },
            { sym: "XRPUSDT", label: "XRP" },
            { sym: "PEPEUSDT", label: "PEPE" },
            { sym: "SUIUSDT", label: "SUI" },
          ].map((item) => {
            const isSelected = selectedSymbol === item.sym;
            return (
              <button
                key={item.sym}
                onClick={() => {
                  setSelectedSymbol(item.sym as any);
                  setSelectedCoinFundingTime(null);
                  setSelectedCoinSeed(null);
                  setLoadedPulse(true);
                  setTimeout(() => setLoadedPulse(false), 2000);
                }}
                className={`px-3 py-1.5 rounded-lg border font-mono font-bold text-xs transition-all shrink-0 active:scale-95 flex items-center space-x-1.5 ${
                  isSelected
                    ? "bg-amber-500/20 text-accent-amber border-accent-amber shadow-sm shadow-amber-500/20 ring-1 ring-amber-500/40"
                    : "bg-surface hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-border"
                }`}
                title={`Explore ${item.sym}`}
              >
                <span>{item.label}</span>
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />}
              </button>
            );
          })}
        </div>

        {(() => {
          const isMatchingSeed = selectedCoinSeed?.symbol === selectedSymbol;
          const isMatchingWs = wsData.symbol === selectedSymbol;
          const effectiveInterval = selectedCoinInterval || wsData.fundingIntervalHours || 8;

          const effectiveFundingTime =
            selectedCoinFundingTime && selectedCoinFundingTime > Date.now()
              ? selectedCoinFundingTime
              : isMatchingWs && wsData.nextFundingTime && wsData.nextFundingTime > Date.now()
              ? wsData.nextFundingTime
              : getDeterministicNextFundingTime(Date.now(), effectiveInterval);

          const liveBnPrice = isMatchingWs && wsData.binancePrice > 0
            ? wsData.binancePrice
            : isMatchingSeed && selectedCoinSeed.binancePrice > 0
            ? selectedCoinSeed.binancePrice
            : 0;

          const liveBgPrice = isMatchingWs && wsData.bitgetPrice > 0
            ? wsData.bitgetPrice
            : isMatchingSeed && selectedCoinSeed.bitgetPrice > 0
            ? selectedCoinSeed.bitgetPrice
            : liveBnPrice;

          const livePriceDiff = Math.abs(liveBnPrice - liveBgPrice);
          const livePriceDivergencePct = liveBnPrice > 0 ? (livePriceDiff / liveBnPrice) * 100 : 0;

          return (
            <>
              {/* Telemetry HUD: Real-time Quantitative Telemetry Cards */}
              <div>
                <TelemetryHUD
                  spreadBps={wsData.spreadBps}
                  nextFundingTime={effectiveFundingTime}
                  symbol={selectedSymbol}
                  fundingIntervalHours={effectiveInterval}
                />
              </div>

              {/* Main Trading Cockpit & Live Spread Corridor Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Live Cross-Exchange Funding Spread Tracker, Docked Positions Table, and Full-Market Funding Scanner */}
                <div className="lg:col-span-7 xl:col-span-7 2xl:col-span-8 space-y-6">
                  <SpreadTracker
                    symbol={selectedSymbol}
                    venueAName={activeVenueA}
                    venueBName={activeVenueB}
                    binanceFundingRate={wsData.binanceFundingRate}
                    bitgetFundingRate={wsData.bitgetFundingRate}
                    spreadBps={wsData.spreadBps}
                    markPrice={liveBnPrice}
                    binancePrice={liveBnPrice}
                    bitgetPrice={liveBgPrice}
                    priceDiff={livePriceDiff}
                    priceDivergencePct={livePriceDivergencePct}
                    fundingIntervalHours={effectiveInterval}
                  />

                  {/* Pre-Trade Slippage & Net Yield Simulator (Visual testing without bot interference) */}
                  <PreTradeSlippageSimulator
                    symbol={selectedSymbol}
                    venueAName={activeVenueA}
                    venueBName={activeVenueB}
                    venueAPrice={liveBnPrice}
                    venueBPrice={liveBgPrice}
                    fundingSpreadBps={wsData.spreadBps}
                  />


                  {/* Docked Full-Market Funding Arbitrage Scanner (Directly Under Positions & to the Left of Execution Panel) */}
                  {!isScannerExpanded && (
                    <div id="all-coins-scanner-section">
                      <AllCoinsScanner
                        onSelectCoin={handleSelectCoinFromScanner}
                        selectedSymbol={selectedSymbol}
                        getVaultHeaders={getVaultHeaders}
                        tradingMode={tradingMode}
                        isMainnetArmed={isMainnetArmed}
                        onRequestMainnetConfirm={(params) => setMainnetModalParams(params)}
                        onExchangesChange={handleExchangesChangeFromScanner}
                        activeVenueA={activeVenueA}
                        activeVenueB={activeVenueB}
                        isExpanded={false}
                        onToggleExpand={() => handleToggleScannerExpand(true)}
                      />

                    </div>
                  )}
                </div>

                {/* Right Column: Execution Panel on top, Live Mainnet Positions below the panel */}
                <div className="lg:col-span-5 xl:col-span-5 2xl:col-span-4 space-y-6">
                  {/* Order Execution Panel */}
                  <div
                    id="execution-cockpit-section"
                    className={`space-y-6 rounded-xl transition-all duration-300 ${
                      loadedPulse ? "ring-2 ring-accent-amber shadow-xl shadow-amber-500/20" : ""
                    }`}
                  >
                  <ControlCockpit
                    onRefresh={fetchData}
                    getVaultHeaders={getVaultHeaders}
                    selectedSymbol={selectedSymbol}
                    activeVenueA={activeVenueA}
                    activeVenueB={activeVenueB}
                    onVenuesChange={(vA, vB) => {
                      setActiveVenueA(vA);
                      setActiveVenueB(vB);
                    }}
                    onSymbolChange={(sym) => {
                      setSelectedSymbol(sym);
                      setSelectedCoinFundingTime(null);
                      setSelectedCoinInterval(8);
                      setSelectedCoinSeed(null);
                    }}
                    isAutopilotActive={isAutopilotActive}
                    onToggleAutopilot={setIsAutopilotActive}
                    autopilotState={autopilotState}
                    spreadBps={wsData.spreadBps}
                    minSpreadEntry={minSpreadEntry}
                    onMinSpreadEntryChange={setMinSpreadEntry}
                    exitSpreadTarget={exitSpreadTarget}
                    onExitSpreadTargetChange={setExitSpreadTarget}
                    markPrice={liveBnPrice}
                    binancePrice={liveBnPrice}
                    bitgetPrice={liveBgPrice}
                    priceDiff={livePriceDiff}
                    priceDivergencePct={livePriceDivergencePct}
                    binanceFundingRate={wsData.binanceFundingRate}
                    bitgetFundingRate={wsData.bitgetFundingRate}
                    nextFundingTime={effectiveFundingTime}
                    fundingIntervalHours={effectiveInterval}
                    tradingMode={tradingMode}
                    isMainnetArmed={isMainnetArmed}
                    onRequestMainnetConfirm={(params) => setMainnetModalParams(params)}
                  />
                  </div>

                  {/* Live Mainnet Positions - Positioned Below the Order Execution Panel */}
                  <PositionsTable
                    positions={positions}
                    currentSymbol={selectedSymbol}
                    liveBinancePrice={wsData.binancePrice}
                    liveBitgetPrice={wsData.bitgetPrice}
                    onClosePosition={handleClosePosition}
                    tradingMode={tradingMode}
                    paperWallet={paperWallet}
                    onResetPaperWallet={handleResetPaperWallet}
                  />
                </div>
              </div>
            </>
          );
        })()}

        {closeError && (
          <div className="px-4 py-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-2">
              <span className="font-bold">⚠️ Execution Notice:</span>
              <span>{closeError}</span>
            </div>
            <button
              onClick={() => setCloseError(null)}
              className="text-rose-400 hover:text-rose-200 text-xs font-mono ml-4 px-1.5 py-0.5 rounded border border-rose-800/60"
            >
              ✕
            </button>
          </div>
        )}

        {/* Expanded Full-Width Scanner (When Toggled to Full Screen by User) */}
        {isScannerExpanded && (
          <div id="all-coins-scanner-section" className="mt-6">
            <AllCoinsScanner
              onSelectCoin={handleSelectCoinFromScanner}
              selectedSymbol={selectedSymbol}
              getVaultHeaders={getVaultHeaders}
              tradingMode={tradingMode}
              isMainnetArmed={isMainnetArmed}
              onRequestMainnetConfirm={(params) => setMainnetModalParams(params)}
              onExchangesChange={handleExchangesChangeFromScanner}
              activeVenueA={activeVenueA}
              activeVenueB={activeVenueB}
              isExpanded={true}
              onToggleExpand={() => handleToggleScannerExpand(false)}
            />
          </div>
        )}
      </main>

      <Footer />

      {/* Mainnet Pre-Flight Order Confirmation Modal */}
      <MainnetOrderConfirmModal
        isOpen={mainnetModalParams !== null}
        onClose={() => setMainnetModalParams(null)}
        onConfirm={handleConfirmMainnetOrder}
        symbol={mainnetModalParams?.symbol || ""}
        direction={mainnetModalParams?.direction || "STANDARD_CARRY"}
        quantity={mainnetModalParams?.quantity || ""}
        notionalUsdt={mainnetModalParams?.notionalUsdt || 0}
        binancePrice={mainnetModalParams?.binancePrice || 0}
        bitgetPrice={mainnetModalParams?.bitgetPrice || 0}
        spreadBps={mainnetModalParams?.spreadBps || 0}
        leverage={mainnetModalParams?.leverage || 10}
        isExecuting={isExecutingMainnet}
      />

      {/* Settings Modal (Client Session Vault) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={fetchData}
      />

      {/* Institutional User Profile & 24/7 Autonomous Bot Modal */}
      <UserProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />

      {/* Bybit CloudFront Geo-Bypass & Resolution Modal */}
      {showBybitGeoModal && (
        <BybitGeoBypassModal
          onClose={() => setShowBybitGeoModal(false)}
          onSwitchPaper={() => {
            setTradingMode("paper");
            setShowBybitGeoModal(false);
          }}
          onOpenSettings={() => {
            setShowBybitGeoModal(false);
            setIsSettingsOpen(true);
          }}
        />
      )}
    </div>
  );
}
