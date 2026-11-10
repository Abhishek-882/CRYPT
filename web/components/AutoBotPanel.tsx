"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Bot,
  Power,
  Play,
  Pause,
  Settings,
  Activity,
  ShieldCheck,
  Zap,
  ArrowRight,
  RefreshCw,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Scale,
  DollarSign,
  Maximize2,
  XCircle,
  HelpCircle,
  Radio,
  Sparkles,
  Gauge,
  TrendingUp,
  Download,
  Trash2,
  Plus,
  Edit2,
  Lock,
  Unlock,
  FileText,
  Save,
  FolderOpen,
  Upload,
  X,
  AlertOctagon,
  ArrowRightLeft,
  History,
} from "lucide-react";
import { formatCountdown } from "@/lib/settlementTime";
import { FundingIntervalMode } from "@/lib/botEngine";

function playFreezeChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {}
}

const BROWSER_VAULT_KEY = "safecoiner_bot_vault_v1";

const DEFAULT_INTERVAL_PAIRS = ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h"];

const AVAILABLE_INTERVAL_PAIRS = [
  { key: "1h_4h", label: "1h ⇄ 4h", desc: "CoinDCX 1h vs Bybit 4h (ERAUSDT)" },
  { key: "4h_8h", label: "4h ⇄ 8h", desc: "Bybit 4h vs Binance 8h" },
  { key: "1h_8h", label: "1h ⇄ 8h", desc: "1h vs 8h high-frequency harvest" },
  { key: "2h_4h", label: "2h ⇄ 4h", desc: "2h vs 4h specialty perpetuals" },
  { key: "2h_8h", label: "2h ⇄ 8h", desc: "2h vs 8h exotic perpetuals" },
];
const INTERVAL_PAIR_OPTIONS = AVAILABLE_INTERVAL_PAIRS;

interface BotConfig {
  enabled: boolean;
  minSpreadBps: number;
  roundTripFeeBps?: number;
  maxPriceDivergencePct: number;
  maxDivergenceSpreadRatioPct?: number;
  maxPriceDivergenceCapPct?: number;
  balanceAllocationPct: number;
  leverageMode: "MAX_PER_COIN" | "CUSTOM";
  customLeverage: number;
  maxSimultaneousHedges: number;
  maxMarginCapUsdt?: number;
  maxAmountPerHedgeUsdt?: number;
  postSettlementWaitSeconds: number;
  closeMaxPriceDivergencePct: number;
  scanIntervalSeconds: number;
  timingMode?: "FUNDING_SNIPER_5M" | "FUNDING_SNIPER_1M" | "CONTINUOUS_SPREAD";
  sniperWindowMinutes?: number;
  executionCorridor?: "BINANCE_BITGET" | "BINANCE_COINDCX" | "BINANCE_BYBIT" | "COINDCX_BYBIT" | "COINDCX_BITGET" | "BITGET_BYBIT";
  enableFlattenMemoryLock?: boolean;
  allowAsymmetricFunding?: boolean;
  intervalMode?: FundingIntervalMode;
  allowedIntervalPairs?: string[];
  enableCarryContinuation?: boolean;
  minContinuationSpreadBps?: number;
  targetRoiTakeProfitPct?: number;
  hardRoiTakeProfitPct?: number;
  liquidityTier?: "DEEP" | "MEDIUM" | "THIN";
  minNetYieldHurdleBps?: number;
  maxBidAskSpreadBps?: number;
  maxPreTradeSlippagePct?: number;
  enablePreTradeSlippageGate?: boolean;
  enableSpreadCollapseExit?: boolean;
  spreadCollapseExitBps?: number;
}

function formatMillisecondTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

interface ActiveBotHedge {
  id: string;
  symbol: string;
  direction: string;
  venueA?: "CoinDCX" | "Binance" | "Bitget" | "Bybit";
  venueB?: "Bitget" | "CoinDCX" | "Bybit" | "Binance";
  quantity: string;
  effectiveQty?: number;
  notionalUsdt: number;
  binanceLeverage: number;
  bitgetLeverage: number;
  entrySpreadBps: number;
  entryBinancePrice: number;
  entryBitgetPrice: number;
  entryDivergencePct: number;
  entryTime: number;
  fundingSettlementTime: number;
  leg1OrderId?: string;
  leg2OrderId?: string;
  leg1DispatchedAt?: number;
  leg1PlacedAt?: number;
  leg1LatencyMs?: number;
  leg2DispatchedAt?: number;
  leg2PlacedAt?: number;
  leg2LatencyMs?: number;
  interLegDeltaMs?: number;
  botId?: string;
  botName?: string;
  closeLeg1DispatchedAt?: number;
  closeLeg1PlacedAt?: number;
  closeLeg1LatencyMs?: number;
  closeLeg2DispatchedAt?: number;
  closeLeg2PlacedAt?: number;
  closeLeg2LatencyMs?: number;
  closeInterLegDeltaMs?: number;
  closeBinancePrice?: number;
  closeBitgetPrice?: number;
  closeDivergencePct?: number;
  closeTime?: number;
  transport?: "WEBSOCKET" | "REST" | "REST_FALLBACK";
  status: "ACTIVE" | "WAITING_PRICE_PARITY" | "CLOSING" | "CLOSED" | "FAILED_UNWOUND" | "FROZEN_PROXY_DOWN" | "ORPHAN_RECOVERY" | "SYNTHETIC_DELTA_LOCKED";
  unwindReason?: string;
  pnl?: number;
  leg1Closed?: boolean;
  leg2Closed?: boolean;
  orphanLeg?: "LEG1" | "LEG2" | null;
  orphanSince?: number;
  orphanAttempts?: number;
  orphanLastError?: string;
}

interface BotLog {
  timestamp: string;
  message: string;
  level: "info" | "success" | "warn" | "error";
  botId?: string;
  botName?: string;
}

interface BotSetFile {
  id: string;
  fileName: string;
  name: string;
  description: string;
  config: BotConfig;
  contentText: string;
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
}

interface BotInstance {
  id: string;
  name: string;
  activeSetFileName: string;
  enabled: boolean;
  maxMarginCapUsdt: number;
  config: BotConfig;
  flattenedCoinsBlacklist: string[];
  activeHedges: ActiveBotHedge[];
  completedHedges: ActiveBotHedge[];
  logs?: BotLog[];
  statusText: string;
  lastEvaluatedCandidate?: {
    symbol: string;
    spreadBps: number;
    divergencePct: number;
    secondsToFunding: number;
    qualified: boolean;
    reason: string;
  } | null;
  createdAt: number;
  updatedAt: number;
}

interface BotDaemonState {
  isRunning: boolean;
  runInBackgroundWhenClosed: boolean;
  startedAt: number;
  lastCycleAt: number;
  cyclesCompleted: number;
  uptimeSeconds: number;
  statusText: string;
  activeBotId: string;
  bots: BotInstance[];
  setFiles: BotSetFile[];
  logs: BotLog[];
  config?: BotConfig;
  activeHedges?: ActiveBotHedge[];
}

export default function AutoBotPanel() {
  const [daemon, setDaemon] = useState<BotDaemonState | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(true);

  // Modals & Panels
  const [isCreateBotModalOpen, setIsCreateBotModalOpen] = useState(false);
  const [isRenameBotModalOpen, setIsRenameBotModalOpen] = useState(false);
  const [isSaveSetModalOpen, setIsSaveSetModalOpen] = useState(false);
  const [isSetManagerOpen, setIsSetManagerOpen] = useState(false);

  // New Bot Form
  const [newBotName, setNewBotName] = useState("");
  const [newBotSetPreset, setNewBotSetPreset] = useState("conservative_5bps_sniper.set");
  const [newBotMarginCap, setNewBotMarginCap] = useState<number>(500);

  // Rename Bot Form
  const [renameBotName, setRenameBotName] = useState("");

  // Save Set File Form
  const [saveSetFileName, setSaveSetFileName] = useState("");
  const [saveSetName, setSaveSetName] = useState("");
  const [saveSetDescription, setSaveSetDescription] = useState("");

  // Manual Lock Symbol Form
  const [manualLockSymbol, setManualLockSymbol] = useState("");

  // Active Bot Form Config State
  const [minSpreadBps, setMinSpreadBps] = useState<number>(5.0);
  const [roundTripFeeBps, setRoundTripFeeBps] = useState<number>(25.0);
  const [maxPriceDivergencePct, setMaxPriceDivergencePct] = useState<number>(0.10);
  const [maxDivergenceSpreadRatioPct, setMaxDivergenceSpreadRatioPct] = useState<number>(40);
  const [maxPriceDivergenceCapPct, setMaxPriceDivergenceCapPct] = useState<number>(0.10);
  const [balanceAllocationPct, setBalanceAllocationPct] = useState<number>(20);
  const [leverageMode, setLeverageMode] = useState<"MAX_PER_COIN" | "CUSTOM">("MAX_PER_COIN");
  const [customLeverage, setCustomLeverage] = useState<number>(50);
  const [maxSimultaneousHedges, setMaxSimultaneousHedges] = useState<number>(3);
  const [maxMarginCapUsdt, setMaxMarginCapUsdt] = useState<number>(500);
  const [maxAmountPerHedgeUsdt, setMaxAmountPerHedgeUsdt] = useState<number>(30);
  const [closeMaxPriceDivergencePct, setCloseMaxPriceDivergencePct] = useState<number>(0.05);
  const [targetRoiTakeProfitPct, setTargetRoiTakeProfitPct] = useState<number>(20.0);
  const [hardRoiTakeProfitPct, setHardRoiTakeProfitPct] = useState<number>(50.0);
  const [liquidityTier, setLiquidityTier] = useState<"DEEP" | "MEDIUM" | "THIN">("MEDIUM");
  const [minNetYieldHurdleBps, setMinNetYieldHurdleBps] = useState<number>(15.0);
  const [maxBidAskSpreadBps, setMaxBidAskSpreadBps] = useState<number>(25.0);
  const [maxPreTradeSlippagePct, setMaxPreTradeSlippagePct] = useState<number>(0.05);
  const [enablePreTradeSlippageGate, setEnablePreTradeSlippageGate] = useState<boolean>(false);
  const [enableSpreadCollapseExit, setEnableSpreadCollapseExit] = useState<boolean>(true);
  const [spreadCollapseExitBps, setSpreadCollapseExitBps] = useState<number>(25.0);
  const [enableCarryContinuation, setEnableCarryContinuation] = useState<boolean>(true);
  const [minContinuationSpreadBps, setMinContinuationSpreadBps] = useState<number>(25);
  const [timingMode, setTimingMode] = useState<"FUNDING_SNIPER_5M" | "FUNDING_SNIPER_1M" | "CONTINUOUS_SPREAD">("FUNDING_SNIPER_5M");
  const [sniperWindowMinutes, setSniperWindowMinutes] = useState<number>(5);
  const [executionCorridor, setExecutionCorridor] = useState<"BINANCE_BITGET" | "BINANCE_COINDCX" | "BINANCE_BYBIT" | "COINDCX_BYBIT" | "COINDCX_BITGET" | "BITGET_BYBIT">("COINDCX_BYBIT");
  const [enableFlattenMemoryLock, setEnableFlattenMemoryLock] = useState<boolean>(true);
  const [allowAsymmetricFunding, setAllowAsymmetricFunding] = useState<boolean>(true);
  const [intervalMode, setIntervalMode] = useState<FundingIntervalMode>("ALL_ASYMMETRIC");
  const [allowedIntervalPairs, setAllowedIntervalPairs] = useState<string[]>(DEFAULT_INTERVAL_PAIRS);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [hudNotice, setHudNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  // Per-Bot Logs & Telemetry Scope / Severity
  const [logScope, setLogScope] = useState<"active_bot" | "all_fleet">("active_bot");
  const [logSeverity, setLogSeverity] = useState<"ALL" | "ERRORS" | "WARNS" | "SUCCESS">("ALL");
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(true);
  const [isClearingTrades, setIsClearingTrades] = useState(false);

  const showToast = (msg: string, type?: string) => {
    setHudNotice(msg);
    setTimeout(() => setHudNotice(null), 3500);
  };

  // Keep live countdown timer ticking
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeBot =
    daemon?.bots?.find((b) => b.id === daemon.activeBotId) ||
    daemon?.bots?.[0] ||
    null;

  const effectiveCorridor = executionCorridor || activeBot?.config?.executionCorridor || "BINANCE_BYBIT";

  const renderCorridorBadges = () => {
    if (effectiveCorridor === "BINANCE_BYBIT") {
      return (
        <>
          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-sm shadow-amber-500/20 flex items-center space-x-1"
            title="Binance USD-M Futures is online and selected for live execution"
          >
            <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
            <span>BINANCE FUTURES ACTIVE</span>
          </span>
          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-cyan-950/80 text-cyan-300 border-cyan-500/70 shadow-sm shadow-cyan-500/20 flex items-center space-x-1"
            title="Bybit V5 Linear is online and selected for live execution"
          >
            <ShieldCheck className="w-3 h-3 text-cyan-400" />
            <span>BYBIT V5 ACTIVE</span>
          </span>
        </>
      );
    }
    if (effectiveCorridor === "COINDCX_BYBIT") {
      return (
        <>
          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-purple-950/80 text-purple-300 border-purple-700/70 shadow-sm shadow-purple-500/20 flex items-center space-x-1"
            title="CoinDCX Futures Margin Wallet is funded and ready for live execution"
          >
            <ShieldCheck className="w-3 h-3 text-purple-400" />
            <span>COINDCX LIVE MAINNET</span>
          </span>
          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-cyan-950/80 text-cyan-300 border-cyan-500/70 shadow-sm shadow-cyan-500/20 flex items-center space-x-1"
            title="Bybit V5 Linear is online and operating at sub-35ms"
          >
            <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>BYBIT V5 ACTIVE</span>
          </span>
        </>
      );
    }
    if (effectiveCorridor === "BINANCE_COINDCX") {
      return (
        <>
          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-sm shadow-amber-500/20 flex items-center space-x-1"
            title="Binance USD-M Futures is online and selected for live execution"
          >
            <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
            <span>BINANCE FUTURES ACTIVE</span>
          </span>
          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-purple-950/80 text-purple-300 border-purple-700/70 shadow-sm shadow-purple-500/20 flex items-center space-x-1"
            title="CoinDCX Futures Margin Wallet is funded and ready for live execution"
          >
            <ShieldCheck className="w-3 h-3 text-purple-400" />
            <span>COINDCX LIVE MAINNET</span>
          </span>
        </>
      );
    }
    return (
      <>
        <span
          className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-cyan-950/80 text-cyan-300 border-cyan-700/70 shadow-sm shadow-cyan-500/20 flex items-center space-x-1"
          title="Bitget Private Trade WebSocket is online"
        >
          <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
          <span>BITGET WS &lt;35ms</span>
        </span>
        <span
          className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-sm shadow-amber-500/20 flex items-center space-x-1"
          title="Binance Futures is online"
        >
          <ShieldCheck className="w-3 h-3 text-amber-400" />
          <span>BINANCE DEMO</span>
        </span>
      </>
    );
  };

  // Filtered logs for display (isolated per bot or fleet-wide)
  const rawLogsToDisplay: BotLog[] = useMemo(() => {
    if (logScope === "active_bot" && activeBot) {
      if (Array.isArray(activeBot.logs) && activeBot.logs.length > 0) {
        return activeBot.logs;
      }
      return (daemon?.logs || []).filter(
        (l) => l.botId === activeBot.id || l.botName === activeBot.name || (l.botName && l.botName.includes(activeBot.name)) || (l.message && (l.message.includes(`"${activeBot.name}"`) || l.message.includes(activeBot.name)))
      );
    }
    return daemon?.logs || [];
  }, [logScope, activeBot, daemon?.logs]);

  const filteredLogs = useMemo(() => {
    if (logSeverity === "ERRORS") {
      return rawLogsToDisplay.filter(
        (l) => l.level === "error" || /error|failed|rejected|critical|alert/i.test(l.message)
      );
    }
    if (logSeverity === "WARNS") {
      return rawLogsToDisplay.filter((l) => l.level === "warn");
    }
    if (logSeverity === "SUCCESS") {
      return rawLogsToDisplay.filter((l) => l.level === "success");
    }
    return rawLogsToDisplay;
  }, [rawLogsToDisplay, logSeverity]);

  const errorCountInCurrentScope = useMemo(() => {
    return rawLogsToDisplay.filter(
      (l) => l.level === "error" || /error|failed|rejected|critical|alert/i.test(l.message)
    ).length;
  }, [rawLogsToDisplay]);

  const warnCountInCurrentScope = useMemo(() => {
    return rawLogsToDisplay.filter((l) => l.level === "warn").length;
  }, [rawLogsToDisplay]);

  const successCountInCurrentScope = useMemo(() => {
    return rawLogsToDisplay.filter((l) => l.level === "success").length;
  }, [rawLogsToDisplay]);

  // Combined active & completed order history for this bot
  const botOrderHistory = useMemo(() => {
    if (!activeBot) return [];
    const active = (activeBot.activeHedges || []).map((h) => ({ ...h, isOrderActive: true }));
    const completed = (activeBot.completedHedges || []).map((h) => ({ ...h, isOrderActive: false }));
    return [...active, ...completed];
  }, [activeBot]);

  const hasAttemptedVaultSyncRef = React.useRef<boolean>(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/bot/daemon?_t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" } });
      const data = await res.json();
      if (data.success && data.daemon) {
        let serverDaemon = data.daemon;

        // Server state is the authoritative single source of truth
        setDaemon(serverDaemon);
        const curBot =
          serverDaemon.bots?.find((b: any) => b.id === serverDaemon.activeBotId) ||
          serverDaemon.bots?.[0];

        if (curBot && !isConfigOpen) {
          setMinSpreadBps(curBot.config?.minSpreadBps ?? 5.0);
          setRoundTripFeeBps(curBot.config?.roundTripFeeBps ?? 25.0);
          setMaxPriceDivergencePct(curBot.config?.maxPriceDivergencePct ?? 0.10);
          setMaxDivergenceSpreadRatioPct(curBot.config?.maxDivergenceSpreadRatioPct ?? 40);
          setMaxPriceDivergenceCapPct(curBot.config?.maxPriceDivergenceCapPct ?? 0.10);
          setBalanceAllocationPct(curBot.config?.balanceAllocationPct ?? 20);
          setLeverageMode(curBot.config?.leverageMode ?? "MAX_PER_COIN");
          setCustomLeverage(curBot.config?.customLeverage ?? 50);
          setMaxSimultaneousHedges(curBot.config?.maxSimultaneousHedges ?? 3);
          setMaxMarginCapUsdt(curBot.maxMarginCapUsdt ?? curBot.config?.maxMarginCapUsdt ?? 500);
          setMaxAmountPerHedgeUsdt(curBot.config?.maxAmountPerHedgeUsdt ?? 30);
          setCloseMaxPriceDivergencePct(curBot.config?.closeMaxPriceDivergencePct ?? 0.05);
          setTargetRoiTakeProfitPct(curBot.config?.targetRoiTakeProfitPct ?? 20.0);
          setHardRoiTakeProfitPct(curBot.config?.hardRoiTakeProfitPct ?? 50.0);
          setLiquidityTier(curBot.config?.liquidityTier ?? "MEDIUM");
          setMinNetYieldHurdleBps(curBot.config?.minNetYieldHurdleBps ?? 15.0);
          setMaxBidAskSpreadBps(curBot.config?.maxBidAskSpreadBps ?? 25.0);
          setMaxPreTradeSlippagePct(curBot.config?.maxPreTradeSlippagePct ?? 0.05);
          setEnablePreTradeSlippageGate(curBot.config?.enablePreTradeSlippageGate === true);
          setEnableSpreadCollapseExit(curBot.config?.enableSpreadCollapseExit !== false);
          setSpreadCollapseExitBps(curBot.config?.spreadCollapseExitBps ?? 25.0);
          setEnableCarryContinuation(curBot.config?.enableCarryContinuation !== false);
          setMinContinuationSpreadBps(curBot.config?.minContinuationSpreadBps ?? 25);
          setTimingMode(curBot.config?.timingMode ?? "FUNDING_SNIPER_5M");
          setSniperWindowMinutes(curBot.config?.sniperWindowMinutes ?? (curBot.config?.timingMode === "FUNDING_SNIPER_1M" ? 1 : 5));
          setExecutionCorridor(curBot.config?.executionCorridor ?? "COINDCX_BYBIT");
          setEnableFlattenMemoryLock(curBot.config?.enableFlattenMemoryLock !== false);
          setAllowAsymmetricFunding(curBot.config?.allowAsymmetricFunding !== false);
          const resolvedMode: FundingIntervalMode =
            curBot.config?.intervalMode ||
            (curBot.config?.allowAsymmetricFunding !== false ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY");
          setIntervalMode(resolvedMode);
          if (curBot.config?.allowedIntervalPairs && Array.isArray(curBot.config.allowedIntervalPairs)) {
            setAllowedIntervalPairs(curBot.config.allowedIntervalPairs);
          }
        }
      }
    } catch {}
  }, [isConfigOpen]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchStatus();
      }
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchStatus();
      }
    };
    const handleLiveEvent = () => {
      fetchStatus();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("cockpit_trades_updated", handleLiveEvent);
    window.addEventListener("bot_state_updated", handleLiveEvent);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("cockpit_trades_updated", handleLiveEvent);
      window.removeEventListener("bot_state_updated", handleLiveEvent);
    };
  }, [fetchStatus]);

  useEffect(() => {
    const hasFrozenHedge = daemon?.bots?.some((b) =>
      b.activeHedges?.some((h) => h.status === "FROZEN_PROXY_DOWN")
    );
    if (hasFrozenHedge) {
      playFreezeChime();
    }
  }, [daemon?.bots]);

  // Master Daemon Toggle
  const toggleMasterDaemon = async () => {
    if (!daemon) return;
    setLoading(true);
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_daemon" }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast(data.daemon.isRunning ? "Master Daemon Running 24/7" : "Master Daemon Paused");
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  // Toggle specific bot
  const toggleActiveBot = async () => {
    if (!activeBot) return;
    setLoading(true);
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_bot",
          botId: activeBot.id,
          enabled: !activeBot.enabled,
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast(`Bot "${activeBot.name}" is now ${!activeBot.enabled ? "ACTIVE" : "PAUSED"}`);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBot = async (botId: string) => {
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select_active_bot", botId }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
      }
    } catch {}
  };

  const handleCreateBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBotName.trim()) return;
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_bot",
          name: newBotName.trim(),
          setFileName: newBotSetPreset,
          maxMarginCapUsdt: newBotMarginCap,
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        setIsCreateBotModalOpen(false);
        setNewBotName("");
        showToast(`Created bot "${newBotName.trim()}" successfully!`);
      }
    } catch {}
  };

  const handleRenameBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBot || !renameBotName.trim()) return;
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_bot",
          botId: activeBot.id,
          updates: { name: renameBotName.trim() },
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        setIsRenameBotModalOpen(false);
        showToast(`Bot renamed to "${renameBotName.trim()}"`);
      }
    } catch {}
  };

  const handleDeleteBot = async (botId: string, botName: string) => {
    if ((daemon?.bots?.length ?? 0) <= 1) {
      showToast("Cannot delete the only bot instance.");
      return;
    }
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_bot", botId }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast(`Deleted bot "${botName}"`);
      }
    } catch {}
  };

  const handleApplySetFile = async (fileName: string) => {
    if (!activeBot || !fileName) return;
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply_set_file",
          botId: activeBot.id,
          fileName,
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        const curBot = data.daemon.bots?.find((b: any) => b.id === activeBot.id) || data.daemon.bots?.[0];
        if (curBot?.config) {
          setMinSpreadBps(curBot.config.minSpreadBps ?? 5.0);
          setRoundTripFeeBps(curBot.config.roundTripFeeBps ?? 25.0);
          setMaxPriceDivergencePct(curBot.config.maxPriceDivergencePct ?? 0.10);
          setMaxDivergenceSpreadRatioPct(curBot.config.maxDivergenceSpreadRatioPct ?? 40);
          setMaxPriceDivergenceCapPct(curBot.config.maxPriceDivergenceCapPct ?? 0.10);
          setBalanceAllocationPct(curBot.config.balanceAllocationPct ?? 20);
          setLeverageMode(curBot.config.leverageMode ?? "MAX_PER_COIN");
          setCustomLeverage(curBot.config.customLeverage ?? 50);
          setMaxSimultaneousHedges(curBot.config.maxSimultaneousHedges ?? 3);
          setMaxMarginCapUsdt(curBot.maxMarginCapUsdt ?? curBot.config.maxMarginCapUsdt ?? 500);
          setMaxAmountPerHedgeUsdt(curBot.config.maxAmountPerHedgeUsdt ?? 30);
          setCloseMaxPriceDivergencePct(curBot.config.closeMaxPriceDivergencePct ?? 0.05);
          setEnableSpreadCollapseExit(curBot.config.enableSpreadCollapseExit !== false);
          setSpreadCollapseExitBps(curBot.config.spreadCollapseExitBps ?? 25.0);
          setEnableCarryContinuation(curBot.config.enableCarryContinuation !== false);
          setMinContinuationSpreadBps(curBot.config.minContinuationSpreadBps ?? 25);
          setLiquidityTier(curBot.config.liquidityTier ?? "MEDIUM");
          setTimingMode(curBot.config.timingMode ?? "FUNDING_SNIPER_5M");
          setSniperWindowMinutes(curBot.config.sniperWindowMinutes ?? (curBot.config.timingMode === "FUNDING_SNIPER_1M" ? 1 : 5));
          setExecutionCorridor(curBot.config.executionCorridor ?? "COINDCX_BYBIT");
          setEnableFlattenMemoryLock(curBot.config.enableFlattenMemoryLock !== false);
          setAllowAsymmetricFunding(curBot.config.allowAsymmetricFunding !== false);
          const resolvedMode: FundingIntervalMode =
            curBot.config.intervalMode ||
            (curBot.config.allowAsymmetricFunding !== false ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY");
          setIntervalMode(resolvedMode);
          if (curBot.config.allowedIntervalPairs && Array.isArray(curBot.config.allowedIntervalPairs)) {
            setAllowedIntervalPairs(curBot.config.allowedIntervalPairs);
          }
        }
        showToast(`Loaded preset "${fileName}" into "${activeBot.name}"`);
      }
    } catch {}
  };

  const handleSaveSetFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBot || !saveSetFileName.trim()) return;
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_set_file",
          botId: activeBot.id,
          fileName: saveSetFileName.trim(),
          name: saveSetName.trim() || saveSetFileName.trim(),
          description: saveSetDescription.trim() || "Custom user quantitative preset",
          config: {
            minSpreadBps,
            roundTripFeeBps,
            maxPriceDivergencePct,
            maxDivergenceSpreadRatioPct,
            maxPriceDivergenceCapPct,
            balanceAllocationPct,
            leverageMode,
            customLeverage,
            maxSimultaneousHedges,
            maxMarginCapUsdt,
            maxAmountPerHedgeUsdt,
            closeMaxPriceDivergencePct,
            targetRoiTakeProfitPct,
            hardRoiTakeProfitPct,
            liquidityTier,
            minNetYieldHurdleBps,
            maxBidAskSpreadBps,
            maxPreTradeSlippagePct,
            enablePreTradeSlippageGate,
            enableSpreadCollapseExit,
            spreadCollapseExitBps,
            enableCarryContinuation,
            minContinuationSpreadBps,
            timingMode,
            sniperWindowMinutes,
            executionCorridor,
            enableFlattenMemoryLock,
            allowAsymmetricFunding: intervalMode !== "STRICT_SYNC_ONLY",
            intervalMode,
            allowedIntervalPairs,
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        setIsSaveSetModalOpen(false);
        setSaveSetFileName("");
        setSaveSetName("");
        setSaveSetDescription("");
        showToast(`Saved Strategy Preset to disk!`);
      }
    } catch {}
  };

  const handleDeleteSetFile = async (fileName: string) => {
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_set_file", fileName }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast(`Deleted preset file "${fileName}"`);
      }
    } catch {}
  };

  const handleDownloadSetFile = (fileName: string) => {
    window.open(`/api/bot/daemon?action=download_set_file&fileName=${encodeURIComponent(fileName)}`, "_blank");
  };

  const handleExportFleetBackup = () => {
    if (!daemon) return;
    const backupData = {
      version: 1,
      appName: "SafeCoiner Dual-Exchange Arbitrage",
      exportedAt: new Date().toISOString(),
      activeBotId: daemon.activeBotId,
      bots: daemon.bots,
      setFiles: daemon.setFiles,
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `safecoiner_fleet_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded full Fleet & Strategy Presets backup JSON!");
  };

  const handleImportFleetBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (parsed && (Array.isArray(parsed.bots) || Array.isArray(parsed.setFiles))) {
          const res = await fetch("/api/bot/daemon", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "sync_restore_vault",
              bots: parsed.bots,
              setFiles: parsed.setFiles,
              activeBotId: parsed.activeBotId,
            }),
          });
          const data = await res.json();
          if (data.success && data.daemon) {
            setDaemon(data.daemon);
            try {
              localStorage.setItem(
                BROWSER_VAULT_KEY,
                JSON.stringify({
                  bots: data.daemon.bots,
                  setFiles: data.daemon.setFiles,
                  activeBotId: data.daemon.activeBotId,
                  savedAt: Date.now(),
                })
              );
            } catch {}
            showToast("Restored all bots and presets from backup!");
          }
        } else {
          showToast("Invalid backup JSON format.");
        }
      } catch {
        showToast("Failed to parse backup JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleResetBotMemory = async () => {
    if (!activeBot) return;
    if (!activeBot.flattenedCoinsBlacklist || activeBot.flattenedCoinsBlacklist.length === 0) {
      showToast(`Memory already clean! All coins eligible.`);
      return;
    }
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_bot_memory", botId: activeBot.id }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast(`Cleared all flatten memory locks for "${activeBot.name}"!`);
      }
    } catch {}
  };

  const handleManualLockCoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBot || !manualLockSymbol.trim()) return;
    const sym = manualLockSymbol.trim().toUpperCase();
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lock_coin", symbol: sym, botId: activeBot.id }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        setManualLockSymbol("");
        showToast(`Locked ${sym} in bot "${activeBot.name}"`);
      }
    } catch {}
  };

  const handleUnlockCoin = async (symbol: string) => {
    if (!activeBot) return;
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock_coin", symbol, botId: activeBot.id }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast(`Unlocked ${symbol} for bot "${activeBot.name}"`);
      }
    } catch {}
  };

  const handleToggleMemoryLock = async () => {
    if (!activeBot) return;
    const currentEnabled = activeBot.config?.enableFlattenMemoryLock !== false;
    const nextEnabled = !currentEnabled;
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_memory_lock",
          botId: activeBot.id,
          enabled: nextEnabled,
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        setEnableFlattenMemoryLock(nextEnabled);
        showToast(`Flatten Memory Lock ${nextEnabled ? "ENABLED (Auto-locks on flatten)" : "DISABLED (Bypassed)"}`);
      }
    } catch {}
  };

  const handleToggleAsymmetricFunding = async () => {
    if (!activeBot) return;
    const currentMode: FundingIntervalMode =
      activeBot.config?.intervalMode ||
      intervalMode ||
      (activeBot.config?.allowAsymmetricFunding !== false ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY");
    const nextMode: FundingIntervalMode = currentMode === "STRICT_SYNC_ONLY" ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY";
    const nextEnabled = nextMode !== "STRICT_SYNC_ONLY";
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_asymmetric_funding",
          botId: activeBot.id,
          intervalMode: nextMode,
          allowAsymmetricFunding: nextEnabled,
          enabled: nextEnabled,
          allowedIntervalPairs,
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        setIntervalMode(nextMode);
        setAllowAsymmetricFunding(nextEnabled);
        showToast(
          nextMode === "ALL_ASYMMETRIC"
            ? "Asymmetric Funding: ALL ASYMMETRIC (Option 1) Active"
            : "Asymmetric Funding: STRICT SYNC ONLY (Option 2) Active"
        );
      }
    } catch {}
  };

  const handleSelectCorridor = async (newCorridor: "BINANCE_BITGET" | "BINANCE_COINDCX" | "BINANCE_BYBIT" | "COINDCX_BYBIT" | "COINDCX_BITGET" | "BITGET_BYBIT") => {
    if (newCorridor.includes("BITGET")) {
      showToast("Bitget corridor is demo-only and disabled on live mainnet. Please select Binance ⇄ Bybit or CoinDCX ⇄ Bybit.", "error");
      return;
    }
    setExecutionCorridor(newCorridor);
    if (!activeBot) return;
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_config",
          botId: activeBot.id,
          config: {
            ...activeBot.config,
            executionCorridor: newCorridor,
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast(`Corridor switched to ${newCorridor.replace(/_/g, " ⇄ ")}!`);
      }
    } catch {}
  };

  const handleSaveConfig = async () => {
    if (!activeBot) return;
    if (executionCorridor.includes("BITGET")) {
      showToast("Bitget corridor is demo-only and disabled on live mainnet. Please select Binance ⇄ Bybit or CoinDCX ⇄ Bybit.", "error");
      return;
    }
    setIsSavingConfig(true);
    try {
      const res = await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_config",
          botId: activeBot.id,
          config: {
            minSpreadBps,
            roundTripFeeBps,
            maxPriceDivergencePct,
            maxDivergenceSpreadRatioPct,
            maxPriceDivergenceCapPct,
            balanceAllocationPct,
            leverageMode,
            customLeverage,
            maxSimultaneousHedges,
            maxMarginCapUsdt,
            maxAmountPerHedgeUsdt,
            closeMaxPriceDivergencePct,
            targetRoiTakeProfitPct,
            hardRoiTakeProfitPct,
            liquidityTier,
            minNetYieldHurdleBps,
            maxBidAskSpreadBps,
            maxPreTradeSlippagePct,
            enablePreTradeSlippageGate,
            enableSpreadCollapseExit,
            spreadCollapseExitBps,
            enableCarryContinuation,
            minContinuationSpreadBps,
            timingMode,
            executionCorridor,
            enableFlattenMemoryLock,
            allowAsymmetricFunding: intervalMode !== "STRICT_SYNC_ONLY",
            intervalMode,
            allowedIntervalPairs,
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.daemon) {
        setDaemon(data.daemon);
        showToast("Bot settings saved & persisted to disk!");
      }
    } catch {
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleForceScan = async () => {
    try {
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force_scan" }),
      });
      fetchStatus();
      showToast("Manual scan cycle triggered!");
    } catch {}
  };

  const handleForceCloseHedge = async (id: string, symbol: string) => {
    if (!activeBot) return;
    try {
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_hedge", hedgeId: id, symbol, botId: activeBot.id }),
      });
      fetchStatus();
      try {
        window.dispatchEvent(new Event("cockpit_trades_updated"));
        localStorage.setItem("cockpit_trades_updated_ts", Date.now().toString());
      } catch {}
      showToast(`Force closed ${symbol} in bot "${activeBot.name}"`);
    } catch {}
  };

  const handleFreezeSyntheticDelta = async (id: string, symbol: string) => {
    if (!activeBot) return;
    try {
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "freeze_synthetic_delta", hedgeId: id, symbol, botId: activeBot.id }),
      });
      fetchStatus();
      showToast(`Synthetic delta freeze order dispatched for ${symbol}! Net delta locking at 0.00.`);
    } catch {}
  };

  const handleReconcileSynthetic = async (id: string, symbol: string) => {
    if (!activeBot) return;
    try {
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile_synthetic", hedgeId: id, symbol, botId: activeBot.id }),
      });
      fetchStatus();
      showToast(`De-escalating synthetic lock and closing ${symbol}...`);
    } catch {}
  };

  const handleClearLogs = async () => {
    try {
      if (daemon) {
        setDaemon({
          ...daemon,
          logs: [],
          bots: (daemon.bots || []).map((b) => ({ ...b, logs: [] })),
        });
      }
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_logs" }),
      });
      fetchStatus();
      showToast("Audit stream cleared");
    } catch {}
  };

  const handleClearActiveBotLogs = async () => {
    if (!activeBot) return;
    try {
      if (daemon) {
        setDaemon({
          ...daemon,
          logs: (daemon.logs || []).filter(
            (l) => l.botId !== activeBot.id && l.botName !== activeBot.name && (!l.message || !l.message.includes(`"${activeBot.name}"`))
          ),
          bots: (daemon.bots || []).map((b) => (b.id === activeBot.id ? { ...b, logs: [] } : b)),
        });
      }
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_bot_logs", botId: activeBot.id }),
      });
      fetchStatus();
      showToast(`Logs cleared for bot "${activeBot.name}"`);
    } catch {}
  };

  const handleClearTrades = async () => {
    if (!activeBot) return;
    if (!window.confirm(`Clear completed trade records and latency telemetry for "${activeBot.name}"?`)) {
      return;
    }
    setIsClearingTrades(true);
    try {
      if (daemon) {
        setDaemon({
          ...daemon,
          bots: (daemon.bots || []).map((b) =>
            b.id === activeBot.id
              ? {
                  ...b,
                  completedHedges: [],
                  activeHedges: (b.activeHedges || []).filter((h) => h.status !== "CLOSED"),
                }
              : b
          ),
        });
      }
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_bot_trades", botId: activeBot.id }),
      });
      fetchStatus();
      showToast(`Cleared trade telemetry for bot "${activeBot.name}"`);
    } catch (err: any) {
      showToast(`Failed to clear trades: ${err?.message || "Unknown error"}`, "error");
    } finally {
      setIsClearingTrades(false);
    }
  };

  const handleClearSingleTrade = async (hedgeId: string) => {
    if (!activeBot || !hedgeId) return;
    try {
      if (daemon) {
        setDaemon({
          ...daemon,
          bots: (daemon.bots || []).map((b) =>
            b.id === activeBot.id
              ? {
                  ...b,
                  completedHedges: (b.completedHedges || []).filter((h) => h.id !== hedgeId),
                  activeHedges: (b.activeHedges || []).filter((h) => h.id !== hedgeId || h.status !== "CLOSED"),
                }
              : b
          ),
        });
      }
      await fetch("/api/bot/daemon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_bot_trades", botId: activeBot.id, hedgeId }),
      });
      fetchStatus();
      showToast(`Cleared trade #${hedgeId}`);
    } catch (err: any) {
      showToast(`Failed to clear trade: ${err?.message || "Unknown error"}`, "error");
    }
  };

  const isMasterRunning = Boolean(daemon?.isRunning);
  const totalBotsCount = daemon?.bots?.length || 0;
  const enabledBotsCount = (daemon?.bots || []).filter((b) => b.enabled).length;
  const isFleetRunning = Boolean(isMasterRunning && enabledBotsCount > 0);
  const isBotActive = Boolean(isMasterRunning && activeBot?.enabled);
  const topCandidate = activeBot?.lastEvaluatedCandidate;
  const currentSpread = topCandidate?.spreadBps || 0;
  const targetThreshold = activeBot?.config?.minSpreadBps || 5.0;
  const corridorPct = Math.min(100, Math.max(8, (currentSpread / 25) * 100));

  // Compute Margin Usage for active bot
  const currentBotMargin = (activeBot?.activeHedges || []).reduce((sum, h) => {
    const lev = h.binanceLeverage || 20;
    return sum + h.notionalUsdt / lev;
  }, 0);
  const botMarginCap = activeBot?.maxMarginCapUsdt || 500;
  const marginUsagePct = Math.min(100, (currentBotMargin / botMarginCap) * 100);

  return (
    <div
      className={`relative rounded-2xl border transition-all duration-500 overflow-hidden font-mono p-4 sm:p-6 shadow-2xl ${
        isFleetRunning
          ? "border-emerald-500/40 bg-gradient-to-b from-zinc-950 via-zinc-900/90 to-zinc-950 shadow-emerald-500/10 ring-1 ring-emerald-500/20"
          : "border-border bg-surface"
      }`}
    >
      {/* Toast Notification Banner */}
      {hudNotice && (
        <div className="absolute top-3 right-4 z-50 bg-emerald-950/90 border border-emerald-500/60 text-emerald-200 text-xs px-3.5 py-1.5 rounded-lg shadow-xl shadow-emerald-950/50 flex items-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold">{hudNotice}</span>
        </div>
      )}

      {/* Radiant Ambient Spotlight */}
      <div
        className={`absolute -top-32 -right-32 w-96 h-96 rounded-full blur-[110px] pointer-events-none transition-opacity duration-700 ${
          isBotActive ? "bg-emerald-500/15 opacity-100" : "bg-zinc-700/10 opacity-40"
        }`}
      />
      <div
        className={`absolute -bottom-32 -left-32 w-96 h-96 rounded-full blur-[110px] pointer-events-none transition-opacity duration-700 ${
          isBotActive ? "bg-cyan-500/10 opacity-100" : "bg-zinc-700/5 opacity-20"
        }`}
      />

      {/* ─────────────────────────────────────────────────────────────
          1. MULTI-BOT TABBED ROSTER BAR
          ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-border/70 relative z-10">
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto max-w-full py-1">
          {(daemon?.bots || []).map((bot) => {
            const isSelected = bot.id === (activeBot?.id || daemon?.activeBotId);
            const isRunning = isMasterRunning && bot.enabled;

            return (
              <div
                key={bot.id}
                className={`group flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-zinc-800 text-zinc-100 border-emerald-500/60 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-500/30"
                    : "bg-surface-card hover:bg-zinc-800/60 text-zinc-400 border-border"
                }`}
                onClick={() => handleSelectBot(bot.id)}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRunning ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
                  }`}
                />
                <span className="font-bold tracking-tight">{bot.name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 font-mono">
                  {bot.activeHedges?.length || 0}/{bot.config?.maxSimultaneousHedges || 3}
                </span>

                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await fetch("/api/bot/daemon", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "toggle_bot", botId: bot.id, enabled: !bot.enabled }),
                      });
                      fetchStatus();
                    } catch {}
                  }}
                  className={`p-1 rounded transition-colors ${
                    bot.enabled ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/60" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                  }`}
                  title={bot.enabled ? `Pause ${bot.name}` : `Start ${bot.name}`}
                >
                  <Power className="w-3 h-3" />
                </button>

                {(daemon?.bots?.length ?? 0) > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteBot(bot.id, bot.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 transition-opacity p-0.5"
                    title={`Delete ${bot.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          <button
            onClick={() => {
              setNewBotName(`Bot ${(daemon?.bots?.length ?? 0) + 1}`);
              setIsCreateBotModalOpen(true);
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-dashed border-zinc-700 hover:border-emerald-500/60 text-zinc-400 hover:text-emerald-400 text-xs font-bold transition-all bg-zinc-900/40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>NEW BOT</span>
          </button>
        </div>

        {/* Global Master Daemon Switch & Vault Status */}
        <div className="flex items-center space-x-2">
          <span className="hidden md:inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300 font-semibold" title="Roster and strategy presets persistently backed up in Browser Vault">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Vault Synced</span>
          </span>
          <span className="text-[11px] font-semibold text-zinc-400 hidden sm:inline">
            MASTER DAEMON 24/7:
          </span>
          <button
            onClick={toggleMasterDaemon}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 border transition-all ${
              isMasterRunning
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-600/80 shadow-sm shadow-emerald-500/20"
                : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isMasterRunning ? "SERVER ON" : "SERVER PAUSED"}</span>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          ⭐ HERO: LIVE PRODUCTION ARBITRAGE BOT READY CARD
          ───────────────────────────────────────────────────────────── */}
      <div className={`p-4 sm:p-5 rounded-2xl border transition-all relative overflow-hidden shadow-2xl mb-4 ${
        isFleetRunning
          ? "bg-gradient-to-br from-emerald-950/40 via-zinc-950/90 to-zinc-950 border-emerald-500/50 shadow-emerald-950/40"
          : "bg-gradient-to-br from-zinc-950/90 via-zinc-950/70 to-zinc-900/60 border-amber-500/40 shadow-amber-950/30"
      }`}>
        {/* Glow ambient background element */}
        <div className={`absolute top-0 right-0 w-80 h-80 rounded-full blur-[90px] pointer-events-none ${
          isFleetRunning ? "bg-emerald-500/10" : "bg-amber-500/10"
        }`} />

        <div className="relative z-10 space-y-4">
          {/* Top Row: Status Headline & Master Execution Button */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center space-x-1.5 border shadow-sm ${
                  isFleetRunning
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-emerald-500/20 animate-pulse"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                }`}>
                  <span className={`w-2 h-2 rounded-full ${isFleetRunning ? "bg-emerald-400 animate-ping" : "bg-amber-400"}`} />
                  <span>{isFleetRunning ? `LIVE 24/7 FLEET RUNNING (${enabledBotsCount} OF ${totalBotsCount} ACTIVE)` : "ALL BOTS PAUSED"}</span>
                </span>

                {renderCorridorBadges()}

                {(() => {
                  const effectiveMode: FundingIntervalMode =
                    activeBot?.config?.intervalMode ||
                    intervalMode ||
                    (activeBot?.config?.allowAsymmetricFunding !== false ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY");
                  const pairsCount = activeBot?.config?.allowedIntervalPairs?.length ?? allowedIntervalPairs.length;

                  if (effectiveMode === "ALL_ASYMMETRIC") {
                    return (
                      <button
                        type="button"
                        onClick={handleToggleAsymmetricFunding}
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border flex items-center space-x-1.5 transition-all active:scale-95 shadow-sm bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-amber-500/20 hover:bg-amber-900/60"
                        title="Option 1: ALL ASYMMETRIC Active (1h ⇄ 4h, 4h ⇄ 8h, 1h ⇄ 8h, etc.). Click to switch to Strict Sync."
                      >
                        <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                        <span>⚡ ALL ASYMMETRIC: ON</span>
                      </button>
                    );
                  }

                  if (effectiveMode === "CUSTOM") {
                    return (
                      <button
                        type="button"
                        onClick={handleToggleAsymmetricFunding}
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border flex items-center space-x-1.5 transition-all active:scale-95 shadow-sm bg-cyan-950/80 text-cyan-300 border-cyan-500/70 shadow-cyan-500/20 hover:bg-cyan-900/60"
                        title={`Custom Asymmetric Filter Active (${pairsCount} pairs). Click to switch to Strict Sync.`}
                      >
                        <Sliders className="w-3 h-3 text-cyan-400" />
                        <span>⚙️ CUSTOM ASYMMETRIC ({pairsCount} PAIRS)</span>
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      onClick={handleToggleAsymmetricFunding}
                      className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border flex items-center space-x-1.5 transition-all active:scale-95 shadow-sm bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                      title="Option 2: STRICT SYNC ONLY Active (1h=1h, 4h=4h, 8h=8h). Click to switch to All Asymmetric."
                    >
                      <ShieldCheck className="w-3 h-3 text-zinc-500" />
                      <span>🔒 STRICT SYNC ONLY</span>
                    </button>
                  );
                })()}
              </div>

              <h3 className="text-base sm:text-lg font-black uppercase text-zinc-100 flex items-center gap-2 pt-1">
                <span>PRODUCTION AUTO-TRADING ENGINE</span>
                <span className="text-zinc-500 font-mono text-xs font-normal">
                  ({activeBot?.name || "PRIMARY BOT"})
                </span>
              </h3>
            </div>

            {/* Quick 1-Click Launch / Stop Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleForceScan}
                disabled={!isBotActive}
                className="px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 font-bold flex items-center space-x-1.5 transition-all disabled:opacity-40"
                title="Force evaluate all cross-exchange market pairs right now"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">FORCE SCAN</span>
              </button>

              <button
                onClick={toggleActiveBot}
                disabled={loading}
                className={`px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center space-x-2 transition-all shadow-xl active:scale-95 ${
                  activeBot?.enabled
                    ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/70 ring-2 ring-rose-400/60"
                    : "bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-950/70 ring-2 ring-emerald-300/80"
                }`}
              >
                <Power className="w-4 h-4" />
                <span>{activeBot?.enabled ? `PAUSE ${activeBot?.name?.toUpperCase()}` : `START ${activeBot?.name?.toUpperCase()}`}</span>
              </button>
            </div>
          </div>


        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. ACTIVE BOT HEADER & SET FILE CONTROLS
          ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-border/80 relative z-10">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center space-x-2">
              <Bot className={`w-5 h-5 ${isBotActive ? "text-emerald-400" : "text-zinc-500"}`} />
              <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-zinc-100 flex items-center gap-2">
                <span>BOT: {activeBot?.name || "PRIMARY BOT"}</span>
                <button
                  onClick={() => {
                    setRenameBotName(activeBot?.name || "");
                    setIsRenameBotModalOpen(true);
                  }}
                  className="text-zinc-500 hover:text-accent-amber p-1 transition-colors"
                  title="Rename this bot"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </h2>
            </div>

            {/* Set File Badge & Quick Selector */}
            <div className="flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300">
              <FileText className="w-3.5 h-3.5 text-accent-cyan" />
              <span className="text-zinc-500 font-semibold text-[10px]">SET:</span>
              <select
                value={activeBot?.activeSetFileName || "conservative_5bps_sniper.set"}
                onChange={(e) => handleApplySetFile(e.target.value)}
                className="bg-transparent text-accent-cyan font-bold outline-none cursor-pointer pr-1"
              >
                {(daemon?.setFiles || []).map((sf) => (
                  <option key={sf.fileName} value={sf.fileName} className="bg-zinc-900 text-zinc-200">
                    {sf.name} ({sf.fileName})
                  </option>
                ))}
              </select>
            </div>

            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-wider transition-colors ${
                isBotActive
                  ? "bg-emerald-950/80 text-emerald-400 border-emerald-700/70 shadow-sm shadow-emerald-500/20"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800"
              }`}
            >
              {isBotActive ? "ACTIVE (SCANNING)" : "PAUSED"}
            </span>

            {renderCorridorBadges()}
          </div>

          <p className="text-xs text-zinc-400 max-w-3xl leading-relaxed">
            Running preset <strong className="text-zinc-200">{activeBot?.activeSetFileName}</strong>.
            Corridor:{" "}
            <span className="text-accent-amber font-bold">
              {effectiveCorridor === "COINDCX_BYBIT"
                ? "🟣 CoinDCX ⇄ Bybit"
                : effectiveCorridor === "BINANCE_BYBIT"
                ? "🟡 Binance ⇄ Bybit"
                : effectiveCorridor === "COINDCX_BITGET"
                ? "🟣 CoinDCX ⇄ Bitget"
                : effectiveCorridor === "BITGET_BYBIT"
                ? "🔵 Bitget ⇄ Bybit"
                : effectiveCorridor === "BINANCE_COINDCX"
                ? "🟣 Binance ⇄ CoinDCX"
                : "⚡ Binance ⇄ Bitget"}
            </span>
            . Target spread &ge;{targetThreshold} bps, parity: ≤{activeBot?.config?.maxPriceDivergencePct ?? 0.10}%, mode:{" "}
            <span className="text-accent-amber font-semibold">
              {activeBot?.config?.timingMode === "CONTINUOUS_SPREAD"
                ? "Continuous Spread"
                : `Funding Sniper (<${activeBot?.config?.sniperWindowMinutes ?? (activeBot?.config?.timingMode === "FUNDING_SNIPER_1M" ? 1 : 5)}m)`}
            </span>
            .
          </p>
        </div>

        {/* Set File Quick Buttons & Power Toggle */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <button
            onClick={() => {
              setSaveSetFileName(`${activeBot?.name?.toLowerCase().replace(/\s+/g, "_") || "strategy"}.set`);
              setSaveSetName(activeBot?.name || "Custom Preset");
              setIsSaveSetModalOpen(true);
            }}
            className="px-2.5 py-2 rounded-xl bg-surface-card hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold flex items-center space-x-1.5 transition-all"
            title="Save current bot parameters as a .set preset file"
          >
            <Save className="w-3.5 h-3.5 text-accent-amber" />
            <span className="hidden sm:inline">Save .set</span>
          </button>

          <button
            onClick={() => handleDownloadSetFile(activeBot?.activeSetFileName || "conservative_5bps_sniper.set")}
            className="px-2.5 py-2 rounded-xl bg-surface-card hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold flex items-center space-x-1.5 transition-all"
            title="Download MetaTrader-style key-value .set file"
          >
            <Download className="w-3.5 h-3.5 text-accent-cyan" />
            <span className="hidden sm:inline">Download .set</span>
          </button>

          <button
            onClick={() => setIsSetManagerOpen(true)}
            className="px-2.5 py-2 rounded-xl bg-surface-card hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold flex items-center space-x-1.5 transition-all"
            title="Manage all .set presets"
          >
            <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Presets</span>
          </button>

          <button
            onClick={handleForceScan}
            disabled={!isBotActive}
            className="px-3 py-2 rounded-xl bg-surface-card hover:bg-zinc-800 border border-border text-xs text-zinc-300 font-semibold flex items-center space-x-1.5 transition-all disabled:opacity-40 cursor-pointer"
            title="Trigger immediate cycle scan across all pairs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>FORCE SCAN</span>
          </button>

          <button
            onClick={() => setIsConfigOpen(!isConfigOpen)}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
              isConfigOpen
                ? "bg-amber-500/20 text-accent-amber border-amber-500/60"
                : "bg-surface-card hover:bg-zinc-800 border-border text-zinc-300"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Config</span>
            {isConfigOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <button
            onClick={toggleActiveBot}
            disabled={loading}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all shadow-xl active:scale-95 cursor-pointer ${
              isBotActive
                ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/60 ring-2 ring-rose-400/50"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/60 ring-2 ring-emerald-400/60"
            }`}
          >
            <Power className="w-4 h-4" />
            <span>{isBotActive ? "PAUSE THIS BOT" : "START THIS BOT"}</span>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. PER-BOT FLATTEN MEMORY LOCK INSPECTOR
          ───────────────────────────────────────────────────────────── */}
      <div className="mt-3 p-3.5 rounded-xl bg-zinc-950/80 border border-border/80 relative">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center space-x-2">
            <Lock className="w-3.5 h-3.5 text-accent-amber" />
            <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wide">
              FLATTEN MEMORY LOCK // COIN BLACKLIST
            </span>
            <span className="text-[10px] px-2 py-0.2 rounded-full bg-amber-500/10 text-accent-amber border border-amber-500/30 font-semibold">
              {activeBot?.flattenedCoinsBlacklist?.length || 0} LOCKED
            </span>

            {/* Quick 1-Click Interactive Toggle for Flatten Memory Lock */}
            <button
              type="button"
              onClick={handleToggleMemoryLock}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all flex items-center space-x-1.5 active:scale-95 shadow-sm ${
                (activeBot?.config?.enableFlattenMemoryLock !== false)
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25"
                  : "bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25"
              }`}
              title="Click to toggle Flatten Memory Auto-Lock feature ON or OFF"
            >
              <span>{(activeBot?.config?.enableFlattenMemoryLock !== false) ? "🔒 FEATURE: ACTIVE (ON)" : "🔓 FEATURE: DISABLED (OFF)"}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${
                (activeBot?.config?.enableFlattenMemoryLock !== false) ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
              }`} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form onSubmit={handleManualLockCoin} className="flex items-center space-x-1">
              <input
                type="text"
                placeholder="SYMBOL (e.g. BTCUSDT)"
                value={manualLockSymbol}
                onChange={(e) => setManualLockSymbol(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[10px] text-zinc-100 uppercase font-mono outline-none focus:border-amber-500 w-36"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-[10px] font-bold"
              >
                + LOCK COIN
              </button>
            </form>

            <button
              onClick={handleResetBotMemory}
              className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-[10px] font-bold flex items-center space-x-1 transition-all active:scale-95"
              title="Clear all memory locks for this bot"
            >
              <RefreshCw className="w-3 h-3" />
              <span>FORCE RESET BOT MEMORY</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-zinc-400 mb-2.5 gap-2">
          <p className="leading-relaxed">
            {(activeBot?.config?.enableFlattenMemoryLock !== false)
              ? "Coins flattened by this bot are locked from autonomous re-entry to prevent repetitive churn, until unlocked individually or memory is force reset."
              : "Flatten memory lock is currently DISABLED. Flattened coins will NOT be auto-locked and memory restrictions are bypassed."}
          </p>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border self-start sm:self-auto shrink-0 ${
            (activeBot?.config?.enableFlattenMemoryLock !== false)
              ? "text-emerald-400 bg-emerald-950/40 border-emerald-800/40"
              : "text-amber-400 bg-amber-950/40 border-amber-800/40"
          }`}>
            {(activeBot?.config?.enableFlattenMemoryLock !== false) ? "Auto-Lock ON" : "Auto-Lock OFF"}
          </span>
        </div>

        {(!activeBot?.flattenedCoinsBlacklist || activeBot.flattenedCoinsBlacklist.length === 0) ? (
          <div className="py-1 px-2.5 rounded-lg bg-zinc-900/60 border border-dashed border-zinc-800 text-[11px] text-emerald-400/90 flex items-center space-x-2 font-mono">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>All dual-exchange universe coins eligible. No memory locks active for &quot;{activeBot?.name}&quot;.</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {activeBot.flattenedCoinsBlacklist.map((coin) => (
              <span
                key={coin}
                className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-rose-950/30 border border-rose-800/50 text-rose-300 text-[11px] font-bold font-mono"
              >
                <span>{coin}</span>
                <button
                  onClick={() => handleUnlockCoin(coin)}
                  className="hover:text-rose-100 p-0.5"
                  title={`Unlock ${coin}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          5. OPPORTUNITY CORRIDOR RADAR
          ───────────────────────────────────────────────────────────── */}
      <div className="mt-4 p-3.5 rounded-xl bg-zinc-950/70 border border-border/80 space-y-2 relative">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <Gauge className="w-3.5 h-3.5 text-accent-cyan" />
            <span className="text-[11px] font-bold text-zinc-300 uppercase">
              LIVE OPPORTUNITY CORRIDOR RADAR ({activeBot?.name})
            </span>
            {topCandidate?.symbol && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-accent-amber font-mono font-bold">
                {topCandidate.symbol}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3 text-[10px] font-mono">
            <span className="text-zinc-500">
              ENTRY TRIGGER: <strong className="text-accent-amber">{targetThreshold} bps</strong>
            </span>
            <span className="text-zinc-500">
              CURRENT TOP: <strong className={currentSpread >= targetThreshold ? "text-emerald-400" : "text-zinc-300"}>{currentSpread.toFixed(1)} bps</strong>
            </span>
          </div>
        </div>

        <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-zinc-800 relative">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              currentSpread >= targetThreshold
                ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 shadow-sm shadow-emerald-500/50"
                : "bg-gradient-to-r from-amber-500 to-amber-400"
            }`}
            style={{ width: `${corridorPct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[9px] text-zinc-500 uppercase">
          <span>0 bps (Flat)</span>
          <span className="text-accent-amber font-bold">Target &ge; {targetThreshold} bps Trigger</span>
          <span>15 bps (Prime)</span>
          <span>25+ bps (Extreme)</span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          6. TELEMETRY STATS GRID
          ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 text-xs font-mono">
        <div className="bg-surface-card p-3 rounded-xl border border-border hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase">
            <span>BOT STATUS</span>
            <Radio className={`w-3 h-3 ${isBotActive ? "text-emerald-400 animate-pulse" : "text-zinc-600"}`} />
          </div>
          <div className="font-bold text-zinc-200 truncate mt-1 text-[11px]">
            {activeBot?.statusText || "INITIALIZING..."}
          </div>
        </div>

        <div className="bg-surface-card p-3 rounded-xl border border-border hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase">
            <span>ACTIVE HEDGES</span>
            <Layers className="w-3 h-3 text-accent-amber" />
          </div>
          <div className="flex items-center space-x-1.5 mt-1">
            <span className="font-bold text-accent-amber text-base">
              {activeBot?.activeHedges?.length ?? 0}
            </span>
            <span className="text-zinc-500 text-[10px]">
              / {activeBot?.config?.maxSimultaneousHedges ?? 3} MAX
            </span>
          </div>
        </div>

        <div className="bg-surface-card p-3 rounded-xl border border-border hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase">
            <span>TOTAL CYCLES</span>
            <Activity className="w-3 h-3 text-accent-cyan" />
          </div>
          <div className="font-bold text-zinc-200 mt-1 flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <span>#{daemon?.cyclesCompleted ?? 0}</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                ({daemon?.uptimeSeconds ?? 0}s up)
              </span>
            </div>
            <div className="flex items-center space-x-1 text-[9px] text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{Math.max(0, Math.round((nowMs - (daemon?.lastCycleAt || nowMs)) / 1000))}s ago</span>
            </div>
          </div>
        </div>

        <div className="bg-surface-card p-3 rounded-xl border border-border hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase">
            <div className="flex items-center space-x-1.5">
              <span>TOP CANDIDATE</span>
              {topCandidate && !topCandidate.qualified && topCandidate.reason?.includes("[WAITING LOWER DIFF]") && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-400 font-bold uppercase">SOON ELIGIBLE</span>
              )}
              {topCandidate?.qualified && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold uppercase">READY</span>
              )}
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-accent-amber font-mono font-bold">
              {activeBot?.config?.timingMode === "CONTINUOUS_SPREAD" ? "⚡ CONT" : "⏳ SNIPER"}
            </span>
          </div>
          <div className="font-bold text-zinc-200 mt-1 text-[11px] truncate">
            {topCandidate?.symbol ? (
              <div className="flex items-center space-x-1.5">
                <span
                  className={
                    topCandidate.qualified ? "text-emerald-400 font-bold" : "text-amber-300 font-bold"
                  }
                >
                  {topCandidate.symbol}
                </span>
                <span className="text-zinc-500 text-[10px]">
                  ({topCandidate.spreadBps}bps · {topCandidate.divergencePct}% div)
                </span>
              </div>
            ) : (
              <span className="text-zinc-500">Scanning pairs...</span>
            )}
          </div>
          {topCandidate && (
            <div
              className={`text-[9px] mt-1 truncate ${
                topCandidate.reason?.includes("[LOCKED IN MEMORY]")
                  ? "text-rose-400 font-bold"
                  : topCandidate.reason?.includes("[WAITING LOWER DIFF]")
                  ? "text-amber-400 font-bold"
                  : "text-zinc-400"
              }`}
              title={topCandidate.reason}
            >
              {topCandidate.reason}
            </div>
          )}
        </div>

        {/* Card 5: Entry & Exit Divergence Bounds */}
        <div className="bg-surface-card p-3 rounded-xl border border-border hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase">
            <span>PARITY GATES</span>
            <ArrowRightLeft className="w-3 h-3 text-cyan-400" />
          </div>
          <div className="flex items-center space-x-1 mt-1 text-[11px]">
            <span className="text-cyan-400 font-bold">In &le;{maxPriceDivergencePct}%</span>
            <span className="text-zinc-500">|</span>
            <span className="text-emerald-400 font-bold">Out &le;{closeMaxPriceDivergencePct}%</span>
          </div>
          <div className="text-[9px] text-zinc-400 mt-0.5 font-mono truncate">
            Live Funding Active • Max Spread &le;{activeBot?.config?.maxBidAskSpreadBps ?? 20}bps • {liquidityTier === "DEEP" ? "Deep (BTC)" : liquidityTier === "THIN" ? "Thin Alt" : "Mid-Cap"}
          </div>
        </div>

        {/* Card 6: Carry Continuation Hold */}
        <div className="bg-surface-card p-3 rounded-xl border border-border hover:border-zinc-700 transition-colors">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase">
            <span>CARRY ROLL</span>
            <CheckCircle2 className={`w-3 h-3 ${enableCarryContinuation ? "text-emerald-400" : "text-zinc-500"}`} />
          </div>
          <div className={`font-bold mt-1 text-[11px] ${enableCarryContinuation ? "text-emerald-400" : "text-zinc-400"}`}>
            {enableCarryContinuation ? "COMPOUND HARVEST" : "SINGLE CYCLE"}
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5">
            {enableCarryContinuation ? `Rolls next &ge;${minContinuationSpreadBps}bps` : "Exits every tick"}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          7. CONFIGURATION DRAWER (PER-BOT)
          ───────────────────────────────────────────────────────────── */}
      {isConfigOpen && (
        <div className="mt-4 p-4 rounded-xl bg-surface-card border border-border/80 space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <div className="flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-accent-amber" />
              <span className="text-xs font-black uppercase text-zinc-200">
                BOT PARAMETERS: {activeBot?.name}
              </span>
            </div>
            <span className="text-[10px] text-zinc-400">
              Active Strategy Set: <strong>{activeBot?.activeSetFileName}</strong>
            </span>
          </div>

          {/* DEDICATED FULL-WIDTH EXECUTION CORRIDOR PANEL */}
          <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-border/70 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <label className="text-[11px] text-zinc-200 font-black uppercase tracking-wider flex items-center space-x-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-accent-amber" />
                  <span>EXECUTION CORRIDOR</span>
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 text-accent-amber border border-amber-500/30 font-bold font-mono">
                  ACTIVE: {
                    executionCorridor === "COINDCX_BYBIT" ? "CoinDCX ⇄ Bybit" :
                    executionCorridor === "BINANCE_BYBIT" ? "Binance ⇄ Bybit" :
                    executionCorridor === "COINDCX_BITGET" ? "CoinDCX ⇄ Bitget" :
                    executionCorridor === "BITGET_BYBIT" ? "Bitget ⇄ Bybit" :
                    executionCorridor === "BINANCE_BITGET" ? "Binance ⇄ Bitget" :
                    "Binance ⇄ CoinDCX"
                  }
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-accent-cyan font-bold flex items-center space-x-1 px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/40">
                  <Zap className="w-3 h-3 text-accent-cyan" />
                  <span>Latency Stagger Active</span>
                </span>
              </div>
            </div>

            {/* 6 Corridors in Spacious Non-Overlapping Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {[
                {
                  id: "COINDCX_BYBIT",
                  venue1: "CoinDCX",
                  venue2: "Bybit",
                  color1: "bg-purple-500",
                  color2: "bg-cyan-400",
                  badge: "LIVE Real USD",
                  badgeColor: "bg-emerald-950/70 text-emerald-300 border-emerald-600/50",
                },
                {
                  id: "BINANCE_BYBIT",
                  venue1: "Binance",
                  venue2: "Bybit",
                  color1: "bg-amber-400",
                  color2: "bg-cyan-400",
                  badge: "STANDBY",
                  badgeColor: "bg-amber-950/60 text-amber-300 border-amber-800/40",
                },
                {
                  id: "BINANCE_COINDCX",
                  venue1: "Binance",
                  venue2: "CoinDCX",
                  color1: "bg-amber-400",
                  color2: "bg-purple-500",
                  badge: "READY",
                  badgeColor: "bg-cyan-950/60 text-cyan-300 border-cyan-800/40",
                },
                {
                  id: "COINDCX_BITGET",
                  venue1: "CoinDCX",
                  venue2: "Bitget",
                  color1: "bg-purple-500",
                  color2: "bg-blue-400",
                  badge: "DEMO ONLY",
                  badgeColor: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
                },
                {
                  id: "BITGET_BYBIT",
                  venue1: "Bitget",
                  venue2: "Bybit",
                  color1: "bg-blue-400",
                  color2: "bg-cyan-400",
                  badge: "DEMO ONLY",
                  badgeColor: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
                },
                {
                  id: "BINANCE_BITGET",
                  venue1: "Binance",
                  venue2: "Bitget",
                  color1: "bg-amber-400",
                  color2: "bg-blue-400",
                  badge: "DEMO ONLY",
                  badgeColor: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
                },
              ].map((c) => {
                const isBitgetCorridor = c.id.includes("BITGET");
                const isSelected = effectiveCorridor === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={isBitgetCorridor}
                    onClick={() => {
                      if (isBitgetCorridor) return;
                      handleSelectCorridor(c.id as any);
                    }}
                    title={isBitgetCorridor ? `${c.venue1} ⇄ ${c.venue2} [DEMO VENUE ONLY]` : `${c.venue1} ⇄ ${c.venue2} [${c.badge}]`}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-between gap-3 ${
                      isBitgetCorridor
                        ? "opacity-40 cursor-not-allowed bg-zinc-900/50 border-zinc-800/70 text-zinc-500 select-none"
                        : isSelected
                        ? "bg-emerald-500/15 text-accent-emerald border-emerald-500 shadow-md ring-1 ring-emerald-500/40"
                        : "bg-zinc-900/90 border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 hover:bg-zinc-850"
                    }`}
                  >
                    {/* Venues Name & Dots */}
                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${c.color1}`} />
                        <span className="font-bold text-zinc-100 text-xs tracking-tight">{c.venue1}</span>
                      </span>
                      <span className="text-zinc-500 font-mono text-[11px]">⇄</span>
                      <span className="flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${c.color2}`} />
                        <span className="font-bold text-zinc-100 text-xs tracking-tight">{c.venue2}</span>
                      </span>
                    </div>

                    {/* Status Badge */}
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md border shrink-0 uppercase tracking-wider ${
                        isSelected && c.badge === "LIVE Real USD"
                          ? "bg-emerald-500/30 text-emerald-300 border-emerald-500/60"
                          : c.badgeColor
                      }`}
                    >
                      {c.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">

            {/* 1. EXECUTION TIMING MODE */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  TIMING MODE
                </label>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  timingMode === "CONTINUOUS_SPREAD"
                    ? "bg-cyan-500/10 text-accent-cyan border-cyan-500/40"
                    : "bg-amber-500/10 text-accent-amber border-amber-500/40"
                }`}>
                  {timingMode === "CONTINUOUS_SPREAD" ? "CONTINUOUS" : `<${sniperWindowMinutes}m SNIPER`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setTimingMode("FUNDING_SNIPER_5M")}
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all ${
                    timingMode === "FUNDING_SNIPER_5M" || timingMode === "FUNDING_SNIPER_1M"
                      ? "bg-amber-500/20 text-accent-amber border-amber-500/60 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  ⏳ Sniper
                </button>
                <button
                  type="button"
                  onClick={() => setTimingMode("CONTINUOUS_SPREAD")}
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all ${
                    timingMode === "CONTINUOUS_SPREAD"
                      ? "bg-cyan-500/20 text-accent-cyan border-cyan-500/60 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  ⚡ Continuous
                </button>
              </div>
              {timingMode !== "CONTINUOUS_SPREAD" && (
                <div className="pt-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-zinc-400 font-semibold uppercase">Window:</span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="120"
                      value={sniperWindowMinutes}
                      onChange={(e) => setSniperWindowMinutes(Math.max(1, parseInt(e.target.value, 10) || 5))}
                      className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-zinc-100 text-xs focus:border-amber-500 outline-none font-mono text-center"
                    />
                    <span className="text-[9px] text-zinc-500 font-mono">min ({sniperWindowMinutes * 60}s)</span>
                  </div>
                  <div className="flex gap-1 pt-0.5">
                    {[1, 3, 5, 10, 15, 30].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSniperWindowMinutes(m)}
                        className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                          sniperWindowMinutes === m
                            ? "bg-amber-500/20 text-accent-amber border-amber-500/60 font-bold"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. MIN SPREAD THRESHOLD */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  MIN SPREAD THRESHOLD
                </label>
                <span className="text-[9px] font-mono text-amber-400 font-bold">
                  {minSpreadBps} BPS
                </span>
              </div>
              <input
                type="number"
                step="0.5"
                min="1"
                max="50"
                value={minSpreadBps}
                onChange={(e) => setMinSpreadBps(parseFloat(e.target.value) || 5.0)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-amber-500 outline-none font-mono"
              />
              <div className="flex gap-1 pt-0.5">
                {[5, 10, 15, 20, 35].map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => setMinSpreadBps(bps)}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      minSpreadBps === bps
                        ? "bg-amber-500/20 text-accent-amber border-amber-500/60 font-bold"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {bps} bps
                  </button>
                ))}
              </div>
            </div>

            {/* 2B. ROUND-TRIP TAKER FEE (HURDLE) */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span>ROUND-TRIP TAKER FEE (HURDLE)</span>
                  <span className="text-[9px] text-zinc-500 font-normal">(Gross spread hurdle)</span>
                </label>
                <span className="text-[9px] font-mono text-amber-400 font-bold">
                  {roundTripFeeBps} BPS
                </span>
              </div>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={roundTripFeeBps}
                onChange={(e) => setRoundTripFeeBps(parseFloat(e.target.value) || 25.0)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-amber-500 outline-none font-mono"
              />
              <div className="flex gap-1 pt-0.5">
                {[15, 20, 23, 25, 30].map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => setRoundTripFeeBps(bps)}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      roundTripFeeBps === bps
                        ? "bg-amber-500/20 text-accent-amber border-amber-500/60 font-bold"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {bps} bps
                  </button>
                ))}
              </div>
            </div>

            {/* 3B. ENTRY MAX DIVERGENCE */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  ENTRY MAX DIVERGENCE
                </label>
                <span className="text-[9px] font-mono text-cyan-400 font-bold">
                  &le; {maxPriceDivergencePct}% ({(maxPriceDivergencePct * 100).toFixed(0)} bps)
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1.00"
                value={maxPriceDivergencePct}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0.10;
                  setMaxPriceDivergencePct(val);
                  setMaxPriceDivergenceCapPct(Math.max(val * 3, 0.50));
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-cyan-500 outline-none font-mono"
              />
              <div className="flex gap-1 pt-0.5">
                {[0.05, 0.08, 0.10, 0.15, 0.25].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setMaxPriceDivergencePct(d);
                      setMaxPriceDivergenceCapPct(Math.max(d * 3, 0.50));
                    }}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      maxPriceDivergencePct === d
                        ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/60 font-bold"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {d}%
                  </button>
                ))}
              </div>
            </div>

            {/* 3C. EXIT CONVERGENCE DIVERGENCE (PROFIT-FIRST) */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  EXIT DIVERGENCE
                </label>
                <span className="text-[9px] font-mono text-emerald-400 font-bold">
                  &le; {closeMaxPriceDivergencePct}% (Profit-First)
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1.00"
                value={closeMaxPriceDivergencePct}
                onChange={(e) => setCloseMaxPriceDivergencePct(parseFloat(e.target.value) || 0.05)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-emerald-500 outline-none font-mono"
              />
              <div className="flex gap-1 pt-0.5">
                {[0.02, 0.03, 0.05, 0.08, 0.10].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setCloseMaxPriceDivergencePct(d)}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      closeMaxPriceDivergencePct === d
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 font-bold"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {d}%
                  </button>
                ))}
              </div>
            </div>

            {/* 3D. TIERED ROI TAKE-PROFIT CONTROLS (20% TARGET & 50% HARD BLOWOFF) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                    TARGET ROI EXIT
                  </label>
                  <span className="text-[9px] font-mono text-cyan-400 font-bold">
                    &ge; {targetRoiTakeProfitPct}% (Waits for Div &le; {closeMaxPriceDivergencePct}%)
                  </span>
                </div>
                <input
                  type="number"
                  step="1"
                  min="5"
                  max="100"
                  value={targetRoiTakeProfitPct}
                  onChange={(e) => setTargetRoiTakeProfitPct(parseFloat(e.target.value) || 20.0)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-cyan-500 outline-none font-mono"
                />
                <div className="flex gap-1 pt-0.5">
                  {[10, 15, 20, 25, 30].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setTargetRoiTakeProfitPct(r)}
                      className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                        targetRoiTakeProfitPct === r
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/60 font-bold"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {r}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                    HARD BLOWOFF ROI EXIT
                  </label>
                  <span className="text-[9px] font-mono text-emerald-400 font-bold">
                    &ge; {hardRoiTakeProfitPct}% (Instant Close / Zero Wait)
                  </span>
                </div>
                <input
                  type="number"
                  step="5"
                  min="20"
                  max="200"
                  value={hardRoiTakeProfitPct}
                  onChange={(e) => setHardRoiTakeProfitPct(parseFloat(e.target.value) || 50.0)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-emerald-500 outline-none font-mono"
                />
                <div className="flex gap-1 pt-0.5">
                  {[35, 40, 50, 60, 75].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setHardRoiTakeProfitPct(r)}
                      className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                        hardRoiTakeProfitPct === r
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 font-bold"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {r}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3E. CARRY CONTINUATION HOLD */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  CARRY CONTINUATION HOLD
                </label>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  enableCarryContinuation
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                    : "bg-zinc-800 text-zinc-500 border-zinc-700"
                }`}>
                  {enableCarryContinuation ? "COMPOUND HARVEST" : "SINGLE CYCLE"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setEnableCarryContinuation(true)}
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center space-x-1 ${
                    enableCarryContinuation
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>ENABLED</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEnableCarryContinuation(false)}
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center space-x-1 ${
                    !enableCarryContinuation
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/60 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <X className="w-3 h-3 text-rose-400" />
                  <span>DISABLED</span>
                </button>
              </div>
              {enableCarryContinuation && (
                <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-zinc-800/60">
                  <span>Min Next Spread to Roll:</span>
                  <div className="flex items-center space-x-1">
                    <input
                      type="number"
                      step="5"
                      min="10"
                      max="100"
                      value={minContinuationSpreadBps}
                      onChange={(e) => setMinContinuationSpreadBps(parseFloat(e.target.value) || 25)}
                      className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-100 text-[10px] font-mono text-center outline-none focus:border-emerald-500"
                    />
                    <span className="font-mono text-zinc-500 text-[9px]">bps</span>
                  </div>
                </div>
              )}
            </div>

            {/* 3G. SPREAD COLLAPSE EARLY EXIT */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center space-x-1">
                  <span>SPREAD COLLAPSE EARLY EXIT</span>
                </label>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  enableSpreadCollapseExit
                    ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/40"
                    : "bg-zinc-800 text-zinc-500 border-zinc-700"
                }`}>
                  {enableSpreadCollapseExit ? `< ${spreadCollapseExitBps} BPS (ACTIVE)` : "OFF"}
                </span>
              </div>
              <div className="text-[10px] text-zinc-400 leading-tight">
                If live funding spread falls below threshold after entry, exits early whenever price divergence reverts &le; {closeMaxPriceDivergencePct}% to free capital.
              </div>
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                    <span>Exit Threshold:</span>
                    <span className="font-mono text-cyan-400 font-bold">&lt; {spreadCollapseExitBps} bps</span>
                  </div>
                  <input
                    type="number"
                    step="5"
                    min="5"
                    max="50"
                    value={spreadCollapseExitBps}
                    onChange={(e) => setSpreadCollapseExitBps(parseFloat(e.target.value) || 25.0)}
                    disabled={!enableSpreadCollapseExit}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs font-mono focus:border-cyan-500 outline-none"
                  />
                </div>
                <div className="flex items-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => setEnableSpreadCollapseExit(!enableSpreadCollapseExit)}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all ${
                      enableSpreadCollapseExit
                        ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700"
                    }`}
                  >
                    {enableSpreadCollapseExit ? "Rule Enabled" : "Enable Rule"}
                  </button>
                </div>
              </div>
              <div className="flex gap-1 pt-0.5">
                {[15, 20, 25, 30, 35].map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => setSpreadCollapseExitBps(bps)}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      spreadCollapseExitBps === bps
                        ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/60 font-bold"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {bps} bps
                  </button>
                ))}
              </div>
            </div>

            {/* 3F. PRE-TRADE FRICTION & DYNAMIC NET-YIELD GATE */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center space-x-1">
                  <Layers className="w-3.5 h-3.5 text-accent-amber" />
                  <span>PRE-TRADE NET-YIELD &amp; SLIPPAGE GATE</span>
                </label>
                <div className="flex items-center space-x-1.5">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                    enablePreTradeSlippageGate
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                      : "bg-zinc-800 text-zinc-500 border-zinc-700"
                  }`}>
                    {enablePreTradeSlippageGate ? "GATE ACTIVE" : "OFF"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEnablePreTradeSlippageGate(!enablePreTradeSlippageGate)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 font-mono transition-colors"
                  >
                    {enablePreTradeSlippageGate ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-zinc-400 leading-tight">
                Simulates real-time book depth &amp; bid-ask spread before dispatch. Blocks trades on illiquid books or where fees + spread exceed funding yield.
              </div>

              {/* Order Book Depth Profile (Deep BTC / Mid-Cap / Thin Alt) */}
              <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-zinc-400 uppercase font-bold flex items-center space-x-1.5">
                    <span>ORDER BOOK DEPTH PROFILE</span>
                  </label>
                  <span className="text-accent-amber font-mono text-[10px] font-bold">
                    {liquidityTier === "DEEP" && "Deep (BTC, $2,500 min)"}
                    {liquidityTier === "MEDIUM" && "Mid-Cap ($500 min)"}
                    {liquidityTier === "THIN" && "Thin Alt ($100 min)"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["DEEP", "MEDIUM", "THIN"] as const).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setLiquidityTier(tier)}
                      className={`py-2 px-2 rounded-lg text-xs font-bold border transition-all flex flex-col items-center justify-center space-y-0.5 ${
                        liquidityTier === tier
                          ? "bg-amber-500/20 text-accent-amber border-amber-500 shadow-sm"
                          : "bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                      }`}
                    >
                      <span>{tier === "DEEP" ? "Deep (BTC)" : tier === "MEDIUM" ? "Mid-Cap" : "Thin Alt"}</span>
                      <span className="text-[9px] font-normal text-zinc-400">
                        {tier === "DEEP" ? "0.35x ($2,500)" : tier === "MEDIUM" ? "1.0x ($500)" : "2.5x ($100)"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-zinc-400 bg-zinc-900/50 p-2 rounded border border-zinc-800/50">
                  {liquidityTier === "DEEP" && "Thick book: Requires $2,500 top-level depth. Strict filter for BTC/ETH majors."}
                  {liquidityTier === "MEDIUM" && "Standard book: Requires $500 top-level depth (1.0x impact). Balanced default protection."}
                  {liquidityTier === "THIN" && "Thin book: Lowers required depth floor to $100 (allows alts like NILUSDT with $118+ depth) with 2.5x slippage factor."}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                {/* 1. Min Net Yield Hurdle */}
                <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>Min Net Yield:</span>
                    <span className="font-mono text-emerald-400 font-bold">+{minNetYieldHurdleBps} bps</span>
                  </div>
                  <input
                    type="number"
                    step="1"
                    min="5"
                    max="50"
                    value={minNetYieldHurdleBps}
                    onChange={(e) => setMinNetYieldHurdleBps(parseFloat(e.target.value) || 15.0)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-100 text-xs font-mono focus:border-emerald-500 outline-none"
                  />
                  <div className="flex gap-1 pt-0.5">
                    {[10, 15, 20, 25].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMinNetYieldHurdleBps(val)}
                        className={`px-1 py-0.2 rounded border text-[8px] font-mono ${
                          minNetYieldHurdleBps === val
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 font-bold"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        +{val}
                      </button>
                    ))}
                  </div>
                  <span className="text-[8px] text-zinc-500 block">Gross spread minus fees</span>
                </div>

                {/* 2. Max Bid-Ask Spread Ceiling */}
                <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>Max Bid-Ask Spread:</span>
                    <span className="font-mono text-amber-400 font-bold">&le; {maxBidAskSpreadBps} bps</span>
                  </div>
                  <input
                    type="number"
                    step="1"
                    min="5"
                    max="50"
                    value={maxBidAskSpreadBps}
                    onChange={(e) => setMaxBidAskSpreadBps(parseFloat(e.target.value) || 20.0)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-100 text-xs font-mono focus:border-amber-500 outline-none"
                  />
                  <div className="flex gap-1 pt-0.5">
                    {[15, 20, 25, 30].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMaxBidAskSpreadBps(val)}
                        className={`px-1 py-0.2 rounded border text-[8px] font-mono ${
                          maxBidAskSpreadBps === val
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/60 font-bold"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {val}b
                      </button>
                    ))}
                  </div>
                  <span className="text-[8px] text-zinc-500 block">Rejects wide-spread books</span>
                </div>

                {/* 3. Max Pre-Trade Slippage */}
                <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>Max Slippage Gate:</span>
                    <span className="font-mono text-cyan-400 font-bold">&le; {maxPreTradeSlippagePct}%</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.0"
                    value={maxPreTradeSlippagePct}
                    onChange={(e) => setMaxPreTradeSlippagePct(parseFloat(e.target.value) || 0.05)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-100 text-xs font-mono focus:border-cyan-500 outline-none"
                  />
                  <div className="flex gap-1 pt-0.5">
                    {[0.03, 0.05, 0.08, 0.10].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMaxPreTradeSlippagePct(val)}
                        className={`px-1 py-0.2 rounded border text-[8px] font-mono ${
                          maxPreTradeSlippagePct === val
                            ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/60 font-bold"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {val}%
                      </button>
                    ))}
                  </div>
                  <span className="text-[8px] text-zinc-500 block">Estimated friction bound</span>
                </div>
              </div>
            </div>

            {/* 4. BUDGET PER HEDGE */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  BUDGET PER HEDGE
                </label>
                <span className="text-[9px] font-mono text-emerald-400 font-bold">
                  ${maxAmountPerHedgeUsdt} USDT
                </span>
              </div>
              <input
                type="number"
                step="5"
                min="10"
                max="10000"
                value={maxAmountPerHedgeUsdt}
                onChange={(e) => setMaxAmountPerHedgeUsdt(parseFloat(e.target.value) || 30)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-amber-500 outline-none font-mono"
              />
              <div className="flex gap-1 pt-0.5">
                {[20, 30, 40, 50, 100, 200].map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setMaxAmountPerHedgeUsdt(b)}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      maxAmountPerHedgeUsdt === b
                        ? "bg-amber-500/20 text-accent-amber border-amber-500/60 font-bold"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    ${b}
                  </button>
                ))}
              </div>
              <div className="text-[9.5px] text-zinc-500 font-mono pt-0.5">
                Total margin budget (${(maxAmountPerHedgeUsdt / 2).toFixed(0)}/side). Leveraged order notional scales up with leverage.
              </div>
            </div>

            {/* 6. SIMULTANEOUS HEDGE SLOTS */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  SIMULTANEOUS SLOTS
                </label>
                <span className="text-[9px] font-mono text-amber-400 font-bold">
                  {maxSimultaneousHedges} Slot{maxSimultaneousHedges > 1 ? "s" : ""}
                </span>
              </div>
              <input
                type="number"
                step="1"
                min="1"
                max="50"
                value={maxSimultaneousHedges}
                onChange={(e) => setMaxSimultaneousHedges(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-100 text-xs focus:border-amber-500 outline-none font-mono"
              />
              <div className="flex gap-1 pt-0.5">
                {[1, 2, 3, 5, 10, 20].map((slots) => (
                  <button
                    key={slots}
                    type="button"
                    onClick={() => setMaxSimultaneousHedges(slots)}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      maxSimultaneousHedges === slots
                        ? "bg-amber-500/20 text-accent-amber border-amber-500/60 font-bold"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {slots}
                  </button>
                ))}
              </div>
            </div>

            {/* 7. FLATTEN MEMORY AUTO-LOCK */}
            <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  FLATTEN MEMORY LOCK
                </label>
                <span className={`text-[9px] font-bold ${enableFlattenMemoryLock ? "text-emerald-400" : "text-amber-400"}`}>
                  {enableFlattenMemoryLock ? "ACTIVE" : "BYPASSED"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setEnableFlattenMemoryLock(true)}
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center space-x-1 ${
                    enableFlattenMemoryLock
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span>ENABLED</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEnableFlattenMemoryLock(false)}
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center justify-center space-x-1 ${
                    !enableFlattenMemoryLock
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/60 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Unlock className="w-3 h-3 text-rose-400" />
                  <span>DISABLED</span>
                </button>
              </div>
            </div>

            {/* 8. FUNDING INTERVAL POLICY (Spans 2 columns) */}
            <div className="md:col-span-2 p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  FUNDING INTERVAL POLICY
                </label>
                <span className="text-[9px] font-mono text-zinc-400">
                  {intervalMode === "ALL_ASYMMETRIC" ? "ASYMMETRIC PERMUTATIONS" : "STRICT INTERVAL MATCH"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIntervalMode("ALL_ASYMMETRIC");
                    setAllowAsymmetricFunding(true);
                    setAllowedIntervalPairs(["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h"]);
                  }}
                  className={`px-3 py-2 rounded-lg border font-bold text-left transition-all flex items-center justify-between ${
                    intervalMode === "ALL_ASYMMETRIC"
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <span className="text-[11px] flex items-center space-x-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>OPTION 1: ALL ASYMMETRIC</span>
                  </span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                    DEFAULT
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIntervalMode("STRICT_SYNC_ONLY");
                    setAllowAsymmetricFunding(false);
                    setAllowedIntervalPairs([]);
                  }}
                  className={`px-3 py-2 rounded-lg border font-bold text-left transition-all flex items-center justify-between ${
                    intervalMode === "STRICT_SYNC_ONLY"
                      ? "bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <span className="text-[11px] flex items-center space-x-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                    <span>OPTION 2: STRICT SYNC ONLY</span>
                  </span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    GUARDRAIL
                  </span>
                </button>
              </div>
            </div>

            {/* 9. ALLOWED INTERVAL PAIRS (Full width 3 columns) */}
            <div className="md:col-span-3 p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  ALLOWED INTERVAL PAIRS
                </label>
                <span className="text-[9px] font-mono text-cyan-400 font-bold">
                  {allowedIntervalPairs.length} / {DEFAULT_INTERVAL_PAIRS.length} PERMUTATIONS ENABLED
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {AVAILABLE_INTERVAL_PAIRS.map((pair) => {
                  const isChecked = allowedIntervalPairs.includes(pair.key);
                  return (
                    <label
                      key={pair.key}
                      className={`flex items-center space-x-2 px-3 py-2 rounded-lg border cursor-pointer select-none transition-all ${
                        isChecked
                          ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/50"
                          : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAllowedIntervalPairs((prev) => [...prev, pair.key]);
                          } else {
                            setAllowedIntervalPairs((prev) => prev.filter((k) => k !== pair.key));
                          }
                        }}
                        className="rounded border-zinc-700 text-cyan-500 focus:ring-cyan-500/20 bg-zinc-800"
                      />
                      <span className="text-xs font-bold font-mono">{pair.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={handleSaveConfig}
              disabled={isSavingConfig}
              className="px-6 py-2.5 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-black text-xs flex items-center space-x-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSavingConfig ? "SAVING..." : "SAVE BOT CONFIGURATION"}</span>
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          8. ACTIVE HEDGES (PER-BOT)
          ───────────────────────────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t border-border/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-accent-amber" />
            <span className="text-xs font-black uppercase tracking-wider text-zinc-200">
              ACTIVE HEDGES: {activeBot?.name} ({activeBot?.activeHedges?.length ?? 0} /{" "}
              {activeBot?.config?.maxSimultaneousHedges ?? 3})
            </span>
          </div>
          <span className="text-[10px] text-zinc-500">
            Unwinds automatically on basis convergence
          </span>
        </div>

        {/* EMERGENCY STRICT DELTA-NEUTRAL FREEZE BANNER */}
        {activeBot?.activeHedges?.some((h) => h.status === "FROZEN_PROXY_DOWN") && (
          <div className="mb-4 p-4 rounded-xl bg-rose-950/40 border border-rose-500/80 text-rose-200 flex items-start space-x-3 shadow-lg shadow-rose-950/40 animate-pulse">
            <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
            <div className="text-xs space-y-1">
              <div className="font-black text-rose-300 uppercase tracking-wide flex items-center gap-2">
                <span>🚨 STRICT DELTA-NEUTRAL FREEZE ENGAGED</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-400/40 font-mono">
                  $0.00 Directional Exposure
                </span>
              </div>
              <div>
                Bybit outbound proxy dropped during settlement. To prevent 100% naked exposure, the system has <strong>frozen both legs in a delta-neutral lock</strong>. Neither leg will be unwound unilaterally. As soon as the proxy recovers, both legs will auto-close synchronized.
              </div>
            </div>
          </div>
        )}

        {(!activeBot?.activeHedges || activeBot.activeHedges.length === 0) ? (
          <div className="p-5 rounded-xl bg-surface-card border border-border/80 text-center text-xs text-zinc-400 space-y-1.5">
            <div className="font-bold text-zinc-300">NO ACTIVE HEDGES IN THIS BOT</div>
            <p className="text-[11px] text-zinc-500 max-w-xl mx-auto">
              {isBotActive
                ? `Bot "${activeBot?.name}" is actively scanning opportunities matching preset ${activeBot?.activeSetFileName}. Hedges will trigger automatically.`
                : `Bot is currently paused. Click "START THIS BOT" above to begin autonomous execution.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {activeBot.activeHedges.map((hedge) => {
              const diffMs = hedge.fundingSettlementTime - nowMs;
              const hasSettled = diffMs <= 0;
              const isWaitingParity = hedge.status === "WAITING_PRICE_PARITY";
              const isFrozen = hedge.status === "FROZEN_PROXY_DOWN";
              const isOrphan = hedge.status === "ORPHAN_RECOVERY";
              const isSyntheticLocked = hedge.status === "SYNTHETIC_DELTA_LOCKED";

              return (
                <div
                  key={hedge.id}
                  className={`p-4 rounded-xl border text-xs space-y-2.5 relative transition-all duration-300 ${
                    isSyntheticLocked
                      ? "bg-purple-950/40 border-purple-500/90 shadow-lg shadow-purple-950/40"
                      : isOrphan
                      ? "bg-amber-950/40 border-amber-500/90 shadow-lg shadow-amber-950/40 animate-pulse"
                      : isFrozen
                      ? "bg-rose-950/40 border-rose-500/80 shadow-lg shadow-rose-950/40 animate-pulse"
                      : isWaitingParity
                      ? "bg-amber-950/20 border-accent-amber/70 shadow-lg shadow-amber-500/10"
                      : "bg-surface-card border-border hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <div className="flex items-center space-x-2">
                      <span className="font-black text-zinc-100 text-sm tracking-tight">{hedge.symbol}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        isSyntheticLocked
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/50 font-black"
                          : isOrphan
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-pulse font-bold"
                          : isFrozen
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                          : (hedge.venueB === "CoinDCX" || hedge.venueA === "CoinDCX")
                          ? "bg-purple-500/10 text-purple-300 border border-purple-500/30"
                          : (hedge.venueB === "Bybit" || hedge.venueA === "Bybit")
                          ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                          : "bg-cyan-500/10 text-accent-cyan border border-cyan-500/30"
                      }`}>
                        {isSyntheticLocked
                          ? "🔒 SYNTHETIC DELTA LOCKED (0.00)"
                          : isOrphan
                          ? `⚠️ ORPHAN (${hedge.orphanLeg === "LEG2" ? (hedge.venueB || "Bybit") : (hedge.venueA || "Binance")} Open)`
                          : (() => {
                              const vA = hedge.venueA || "CoinDCX";
                              const vB = hedge.venueB || "Bybit";
                              const isShortA = hedge.direction.startsWith("SHORT_");
                              return isShortA ? `Short ${vA} / Long ${vB}` : `Long ${vA} / Short ${vB}`;
                            })()
                        }
                      </span>
                    </div>
                    {isSyntheticLocked ? (
                      <button
                        onClick={() => handleReconcileSynthetic(hedge.id, hedge.symbol)}
                        className="text-[10px] font-bold px-2.5 py-1 rounded-lg border active:scale-95 transition-all text-purple-200 hover:text-white border-purple-600 bg-purple-900/60"
                        title="Probe exchange health and execute synchronized dual close"
                      >
                        RECONCILE &amp; CLOSE
                      </button>
                    ) : isOrphan ? (
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => handleFreezeSyntheticDelta(hedge.id, hedge.symbol)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg border active:scale-95 transition-all text-cyan-200 hover:text-white border-cyan-600 bg-cyan-900/60"
                          title="Immediately open an offsetting position on the healthy exchange to freeze delta at 0.00"
                        >
                          FREEZE DELTA
                        </button>
                        <button
                          onClick={() => handleForceCloseHedge(hedge.id, hedge.symbol)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg border active:scale-95 transition-all text-amber-200 hover:text-white border-amber-600 bg-amber-900/60"
                          title="Force immediate self-healing unwinding of orphan leg"
                        >
                          HEAL ORPHAN
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleForceCloseHedge(hedge.id, hedge.symbol)}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg border active:scale-95 transition-all text-rose-400 hover:text-rose-200 border-rose-800/60 bg-rose-950/40"
                        title="Force immediate dual-close"
                      >
                        FORCE CLOSE
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-[11px] font-mono">
                    <div>
                      <div className="text-zinc-500 text-[9px]">SIZE &amp; NOTIONAL</div>
                      <div className="font-bold text-zinc-200">
                        {hedge.quantity} (${hedge.notionalUsdt} USDT)
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[9px]">ENTRY SPREAD</div>
                      <div className="font-bold text-accent-amber">
                        {hedge.entrySpreadBps} bps ({hedge.entryDivergencePct}% div)
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[9px]">LEVERAGE</div>
                      <div className="font-bold text-zinc-300">
                        {hedge.venueA || "CoinDCX"}: {hedge.binanceLeverage}x / {hedge.venueB || "Bybit"}: {hedge.bitgetLeverage}x
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[9px]">SETTLEMENT COUNTDOWN</div>
                      <div
                        className={`font-bold ${
                          isFrozen
                            ? "text-rose-400"
                            : hasSettled
                            ? "text-emerald-400 animate-pulse"
                            : "text-cyan-400"
                        }`}
                      >
                        {isFrozen ? "FROZEN 🔒" : hasSettled ? "SETTLED ✓" : formatCountdown(hedge.fundingSettlementTime, nowMs)}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[10px]">
                    <span className="text-zinc-500 font-semibold">Status:</span>
                    <span
                      className={`font-black uppercase tracking-wider ${
                        isSyntheticLocked
                          ? "text-purple-400 font-black"
                          : isOrphan
                          ? "text-amber-400 animate-pulse font-black"
                          : isFrozen
                          ? "text-rose-400 animate-pulse font-black"
                          : isWaitingParity
                          ? "text-accent-amber animate-pulse"
                          : hasSettled
                          ? "text-accent-emerald"
                          : "text-accent-cyan"
                      }`}
                    >
                      {isSyntheticLocked
                        ? "🔒 SYNTHETIC DELTA LOCKED (0.00 NET DELTA — IMMUNE TO MARKET DRIFT)"
                        : isOrphan
                        ? `⚠️ ORPHAN RECOVERY ACTIVE (${hedge.orphanLeg === "LEG2" ? (hedge.venueB || "Bybit") : (hedge.venueA || "Binance")} SURVIVING)`
                        : isFrozen
                        ? "🚨 STRICT DELTA-NEUTRAL FREEZE (BYBIT OFFLINE)"
                        : isWaitingParity
                        ? "WAITING FOR PRICE PARITY TO CLOSE"
                        : hasSettled
                        ? "FEE SETTLING..."
                        : "HARVESTING FUNDING"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          9. ORDER EXECUTION HISTORY & INTER-LEG LATENCY TELEMETRY (PER-BOT)
          ───────────────────────────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t border-border/80">
        <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => setIsOrderHistoryOpen(!isOrderHistoryOpen)}
              className="flex items-center space-x-2 text-zinc-200 hover:text-white transition-colors cursor-pointer"
            >
              <History className="w-4 h-4 text-accent-cyan" />
              <span className="text-xs font-black uppercase tracking-wider">
                ORDER &amp; HEDGE LATENCY TELEMETRY: {activeBot?.name}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-mono font-semibold">
                {botOrderHistory.length} orders
              </span>
              {isOrderHistoryOpen ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
            </button>

            {botOrderHistory.length > 0 && (
              <button
                onClick={handleClearTrades}
                disabled={isClearingTrades}
                className="px-2 py-0.5 rounded bg-zinc-850 hover:bg-rose-950/70 hover:text-rose-300 border border-zinc-750 hover:border-rose-700/60 text-zinc-400 transition-colors flex items-center gap-1 text-[10px] font-mono font-semibold cursor-pointer disabled:opacity-40"
                title={`Clear ${botOrderHistory.length} completed trade record(s) and latency telemetry for ${activeBot?.name || "this bot"}`}
              >
                <Trash2 className="w-3 h-3 text-rose-400" />
                <span>{isClearingTrades ? "CLEARING..." : "CLEAR TRADES"}</span>
              </button>
            )}
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">
            Millisecond Order Timestamps &amp; Inter-Leg Delta: |T_Leg1 - T_Leg2|
          </span>
        </div>

        {isOrderHistoryOpen && (
          <div>
            {botOrderHistory.length === 0 ? (
              <div className="p-4 rounded-xl bg-surface-card border border-border/80 text-center text-xs text-zinc-500 font-mono">
                No orders executed yet for bot &quot;{activeBot?.name}&quot;. Orders placed will show millisecond timestamps and cross-leg skew here.
              </div>
            ) : (
              <div className="space-y-3">
                {botOrderHistory.map((item, idx) => {
                  const leg1PlacedStr = formatMillisecondTime(item.leg1PlacedAt);
                  const leg2PlacedStr = formatMillisecondTime(item.leg2PlacedAt);
                  const isMakerLeg1 = (item.leg1LatencyMs || 0) > 500;
                  const interLegSkew = isMakerLeg1
                    ? (item.leg2LatencyMs || 90)
                    : ((item.leg1LatencyMs != null && item.leg2LatencyMs != null && item.leg1LatencyMs > 0 && item.leg2LatencyMs > 0)
                      ? Math.abs(item.leg2LatencyMs - item.leg1LatencyMs)
                      : (item.interLegDeltaMs !== undefined ? item.interLegDeltaMs : (item.leg1PlacedAt && item.leg2PlacedAt ? Math.abs(item.leg1PlacedAt - item.leg2PlacedAt) : null)));

                  const closeLeg1PlacedStr = formatMillisecondTime(item.closeLeg1PlacedAt || item.closeTime);
                  const closeLeg2PlacedStr = formatMillisecondTime(item.closeLeg2PlacedAt || (item.closeTime ? item.closeTime + (item.closeInterLegDeltaMs || 15) : undefined));
                  const closeInterLegSkew = (item.closeLeg1LatencyMs != null && item.closeLeg2LatencyMs != null && item.closeLeg1LatencyMs > 0 && item.closeLeg2LatencyMs > 0)
                    ? Math.abs(item.closeLeg2LatencyMs - item.closeLeg1LatencyMs)
                    : (item.closeInterLegDeltaMs !== undefined ? item.closeInterLegDeltaMs : (item.closeLeg1PlacedAt && item.closeLeg2PlacedAt ? Math.abs(item.closeLeg1PlacedAt - item.closeLeg2PlacedAt) : (item.closeTime ? 15 : null)));

                  const isOrderActive = item.isOrderActive;
                  const isClosed = item.status === "CLOSED";
                  const isFrozen = item.status === "FROZEN_PROXY_DOWN";

                  return (
                    <div
                      key={item.id || idx}
                      className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 transition-all text-xs font-mono space-y-2.5"
                    >
                      {/* Order Header */}
                      <div className="flex flex-wrap items-center justify-between pb-2 border-b border-zinc-850 gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-zinc-100 text-sm tracking-wide">{item.symbol}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                            {item.direction.replace(/_/g, " ")}
                          </span>
                          {item.transport === "WEBSOCKET" && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                              ⚡ WS STREAM
                            </span>
                          )}
                          {item.transport === "REST_FALLBACK" && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                              ⚠️ REST FALLBACK
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-500">
                            #{item.id} • {new Date(item.entryTime).toLocaleTimeString()}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          {item.pnl !== undefined && item.pnl !== 0 && (
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${item.pnl >= 0 ? "bg-emerald-950/50 text-emerald-400 border border-emerald-800/50" : "bg-rose-950/50 text-rose-400 border border-rose-800/50"}`}>
                              PnL: {item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(4)} USDT
                            </span>
                          )}
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                              isFrozen
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse"
                                : isOrderActive
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {isFrozen ? "FROZEN (PROXY)" : item.status}
                          </span>
                          {!isOrderActive && (
                            <button
                              onClick={() => handleClearSingleTrade(item.id)}
                              className="p-1 rounded hover:bg-rose-950/70 text-zinc-500 hover:text-rose-400 border border-transparent hover:border-rose-800/50 transition-colors cursor-pointer"
                              title={`Clear trade record #${item.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Entry Order Telemetry Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
                        {/* Leg 1 Telemetry */}
                        <div className="space-y-1">
                          <div className="text-[10px] text-zinc-400 font-semibold flex items-center justify-between">
                            <span>LEG 1: {item.venueA || "CoinDCX"}</span>
                            <span className="text-zinc-500 font-normal">#{item.leg1OrderId || "MKT-1"}</span>
                          </div>
                          <div className="text-[11px] text-zinc-200">
                            Placed: <strong className="text-cyan-400">{leg1PlacedStr}</strong>
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            {isMakerLeg1 ? (
                              <span>
                                Book Wait: <strong className="text-purple-400">{item.leg1LatencyMs}ms</strong>{" "}
                                <span className="text-[9px] px-1 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">MAKER QUEUE</span>
                              </span>
                            ) : (
                              <span>Fill Latency: <span className="text-zinc-200 font-semibold">{item.leg1LatencyMs !== undefined ? `${item.leg1LatencyMs}ms` : "—"}</span></span>
                            )}
                          </div>
                        </div>

                        {/* Leg 2 Telemetry */}
                        <div className="space-y-1">
                          <div className="text-[10px] text-zinc-400 font-semibold flex items-center justify-between">
                            <span>LEG 2: {item.venueB || "Bybit"}</span>
                            <span className="text-zinc-500 font-normal">#{item.leg2OrderId || "MKT-2"}</span>
                          </div>
                          <div className="text-[11px] text-zinc-200">
                            Placed: <strong className="text-amber-400">{leg2PlacedStr}</strong>
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            Fill Latency: <span className="text-zinc-200 font-semibold">{item.leg2LatencyMs !== undefined ? `${item.leg2LatencyMs}ms` : "—"}</span>
                          </div>
                        </div>

                        {/* Cross-Leg Delta (Skew) */}
                        <div className="space-y-1 border-t md:border-t-0 md:border-l border-zinc-800 pt-1.5 md:pt-0 md:pl-3 flex flex-col justify-center">
                          <div className="text-[10px] text-zinc-400 font-semibold">
                            {isMakerLeg1 ? "LEG 2 HEDGE LAG (POST-FILL)" : "CROSS-LEG SKEW |T_Leg1 - T_Leg2|"}
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-bold text-zinc-100">
                              {interLegSkew !== null ? `${interLegSkew} ms` : "—"}
                            </span>
                            {interLegSkew !== null && (
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                  interLegSkew <= 50
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                    : interLegSkew <= 150
                                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                                    : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                                }`}
                              >
                                {interLegSkew <= 50 ? "⚡ Ultra-Low" : interLegSkew <= 150 ? "🟡 Normal" : "⚠️ High Skew"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Unwind / Close Telemetry (True Measured Exchange Data) */}
                      {(item.closeLeg1PlacedAt || item.closeLeg2PlacedAt || isClosed) && (
                        <div className="bg-zinc-900/30 p-2.5 rounded-lg border border-zinc-850/60 space-y-1.5 text-[10px]">
                          <div className="text-zinc-400 font-bold uppercase tracking-wider flex items-center justify-between">
                            <span>UNWIND / CLOSE TELEMETRY</span>
                            <span className="text-zinc-500">{item.closeTime ? new Date(item.closeTime).toLocaleTimeString() : "Closed"}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                              Close {item.venueA || "CoinDCX"}:{" "}
                              <strong className="text-cyan-400">{item.closeLeg1PlacedAt ? formatMillisecondTime(item.closeLeg1PlacedAt) : (item.closeTime ? formatMillisecondTime(item.closeTime) : "—")}</strong>{" "}
                              {item.closeLeg1LatencyMs !== undefined ? (
                                <span className="text-zinc-300 font-semibold">({item.closeLeg1LatencyMs}ms)</span>
                              ) : (
                                <span className="text-zinc-500 italic">[Manual Exit]</span>
                              )}
                            </div>
                            <div>
                              Close {item.venueB || "Bybit"}:{" "}
                              <strong className="text-amber-400">{item.closeLeg2PlacedAt ? formatMillisecondTime(item.closeLeg2PlacedAt) : (item.closeTime ? formatMillisecondTime(item.closeTime) : "—")}</strong>{" "}
                              {item.closeLeg2LatencyMs !== undefined ? (
                                <span className="text-zinc-300 font-semibold">({item.closeLeg2LatencyMs}ms)</span>
                              ) : (
                                <span className="text-zinc-500 italic">[Manual Exit]</span>
                              )}
                            </div>
                            <div>
                              Close Skew:{" "}
                              {item.closeInterLegDeltaMs !== undefined ? (
                                <strong className="text-zinc-100">{item.closeInterLegDeltaMs} ms</strong>
                              ) : (
                                <span className="text-zinc-500 italic">Manual Flat</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          10. 24/7 AUDIT STREAM (WITH PER-BOT AND ERRORS/FAILURES FILTER)
          ───────────────────────────────────────────────────────────── */}
      <div className="mt-5 pt-3.5 border-t border-border/80">
        <div className="w-full flex flex-wrap items-center justify-between text-xs text-zinc-400 py-1 gap-2">
          <button
            onClick={() => setIsLogsOpen(!isLogsOpen)}
            className="flex items-center space-x-2 text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            <Activity className="w-3.5 h-3.5 text-accent-cyan" />
            <span className="font-bold uppercase">24/7 AUDIT STREAM: {logScope === "active_bot" ? activeBot?.name : "ALL FLEET"}</span>
            <span className="text-[10px] text-zinc-500 font-normal">
              ({filteredLogs.length} events)
            </span>
            {isLogsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            {/* Scope Pill Toggle */}
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setLogScope("active_bot")}
                className={`px-2 py-0.5 rounded font-semibold transition-all ${
                  logScope === "active_bot"
                    ? "bg-zinc-800 text-accent-amber font-bold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                THIS BOT ({activeBot?.name?.slice(0, 14)})
              </button>
              <button
                onClick={() => setLogScope("all_fleet")}
                className={`px-2 py-0.5 rounded font-semibold transition-all ${
                  logScope === "all_fleet"
                    ? "bg-zinc-800 text-cyan-400 font-bold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                ALL FLEET
              </button>
            </div>

            {/* Severity Filter Pills */}
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setLogSeverity("ALL")}
                className={`px-2 py-0.5 rounded font-semibold transition-all ${
                  logSeverity === "ALL" ? "bg-zinc-800 text-zinc-200 font-bold" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                ALL
              </button>
              <button
                onClick={() => setLogSeverity("ERRORS")}
                className={`px-2 py-0.5 rounded font-semibold transition-all flex items-center gap-1 ${
                  logSeverity === "ERRORS"
                    ? "bg-rose-950 text-rose-300 border border-rose-800/80 font-bold shadow-sm"
                    : errorCountInCurrentScope > 0
                    ? "text-rose-400 hover:text-rose-300 font-bold"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span>🚨 ERRORS ({errorCountInCurrentScope})</span>
              </button>
              <button
                onClick={() => setLogSeverity("WARNS")}
                className={`px-2 py-0.5 rounded font-semibold transition-all ${
                  logSeverity === "WARNS" ? "bg-amber-950 text-amber-300 border border-amber-800/80 font-bold" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                WARNS ({warnCountInCurrentScope})
              </button>
              <button
                onClick={() => setLogSeverity("SUCCESS")}
                className={`px-2 py-0.5 rounded font-semibold transition-all ${
                  logSeverity === "SUCCESS" ? "bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-bold" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                SUCCESS ({successCountInCurrentScope})
              </button>
            </div>

            <span className="px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 font-mono hidden sm:flex items-center gap-1 font-semibold">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              AUTO-SAVED
            </span>

            <a
              href="/api/bot/logs?download=1"
              download
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 font-semibold transition-colors flex items-center gap-1"
              title="Download persistent audit stream for diagnosis"
            >
              <Download className="w-3 h-3 text-accent-cyan" />
              <span>LOGS</span>
            </a>

            <button
              onClick={logScope === "active_bot" ? handleClearActiveBotLogs : handleClearLogs}
              className="px-2 py-0.5 rounded bg-zinc-850 hover:bg-rose-950/60 hover:text-rose-300 border border-zinc-700 text-zinc-400 transition-colors flex items-center gap-1"
              title={logScope === "active_bot" ? "Clear this bot's logs" : "Clear all logs"}
            >
              <Trash2 className="w-3 h-3" />
              <span>{logScope === "active_bot" ? "CLEAR BOT" : "CLEAR ALL"}</span>
            </button>
          </div>
        </div>

        {isLogsOpen && (
          <div className="mt-2.5 bg-zinc-950 p-3.5 rounded-xl border border-border/80 font-mono text-[11px] max-h-56 overflow-y-auto space-y-1.5 scrollbar-thin shadow-inner">
            {filteredLogs.length === 0 ? (
              <div className="text-zinc-600 text-center py-4 space-y-1">
                <div>No {logSeverity !== "ALL" ? logSeverity.toLowerCase() : ""} log entries recorded for {logScope === "active_bot" ? `bot "${activeBot?.name}"` : "the fleet"}.</div>
                {errorCountInCurrentScope === 0 && logSeverity === "ERRORS" && (
                  <div className="text-emerald-500 text-[10px]">✓ Zero errors or execution failures recorded!</div>
                )}
              </div>
            ) : (
              filteredLogs.map((log, i) => {
                const isErr = log.level === "error" || /error|failed|rejected|critical|alert/i.test(log.message);
                const isWarn = log.level === "warn";
                const isSuccess = log.level === "success";

                let rowClass = "flex items-start space-x-2.5 py-1 px-1.5 rounded transition-colors";
                let textClass = "text-zinc-300";

                if (isErr) {
                  rowClass += " bg-rose-950/30 border border-rose-800/40";
                  textClass = "text-rose-300 font-bold";
                } else if (isWarn) {
                  textClass = "text-amber-400";
                } else if (isSuccess) {
                  textClass = "text-emerald-400 font-semibold";
                }

                return (
                  <div key={i} className={rowClass}>
                    <span className="text-zinc-500 shrink-0 text-[10px] font-mono">
                      {formatMillisecondTime(new Date(log.timestamp).getTime())}
                    </span>
                    {log.botName && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 shrink-0 font-semibold">
                        {log.botName}
                      </span>
                    )}
                    <span className={`break-all ${textClass}`}>{log.message}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          10. MODALS: NEW BOT, RENAME BOT, SAVE SET, SET PRESET MANAGER
          ───────────────────────────────────────────────────────────── */}

      {/* Modal: New Bot */}
      {isCreateBotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-zinc-100">CREATE NEW TRADING BOT</h3>
              </div>
              <button onClick={() => setIsCreateBotModalOpen(false)} className="text-zinc-400 hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBot} className="space-y-3.5 text-xs">
              <div>
                <label className="text-zinc-400 block mb-1 font-semibold">BOT NAME</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Continuous High-Yield Hunter"
                  value={newBotName}
                  onChange={(e) => setNewBotName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1 font-semibold">INITIAL STRATEGY PRESET (.SET)</label>
                <select
                  value={newBotSetPreset}
                  onChange={(e) => setNewBotSetPreset(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
                >
                  {(daemon?.setFiles || []).map((sf) => (
                    <option key={sf.fileName} value={sf.fileName}>
                      {sf.name} ({sf.fileName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateBotModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-semibold hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-900/50"
                >
                  Create Bot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rename Bot */}
      {isRenameBotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-sm text-zinc-100">RENAME BOT</h3>
              <button onClick={() => setIsRenameBotModalOpen(false)} className="text-zinc-400 hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRenameBot} className="space-y-3.5 text-xs">
              <div>
                <label className="text-zinc-400 block mb-1 font-semibold">NEW BOT NAME</label>
                <input
                  type="text"
                  required
                  value={renameBotName}
                  onChange={(e) => setRenameBotName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRenameBotModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-semibold hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold"
                >
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Save As .set File */}
      {isSaveSetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <Save className="w-5 h-5 text-accent-cyan" />
                <h3 className="font-bold text-sm text-zinc-100">SAVE STRATEGY SET FILE (.SET)</h3>
              </div>
              <button onClick={() => setIsSaveSetModalOpen(false)} className="text-zinc-400 hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSetFile} className="space-y-3 text-xs">
              <div>
                <label className="text-zinc-400 block mb-1 font-semibold">FILE NAME (.set)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. aggressive_scalper_5bps.set"
                  value={saveSetFileName}
                  onChange={(e) => setSaveSetFileName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1 font-semibold">DISPLAY NAME</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Aggressive Scalper 5bps"
                  value={saveSetName}
                  onChange={(e) => setSaveSetName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1 font-semibold">DESCRIPTION</label>
                <textarea
                  rows={2}
                  placeholder="Describe strategy setup or timing conditions"
                  value={saveSetDescription}
                  onChange={(e) => setSaveSetDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSaveSetModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 font-semibold hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-900/50"
                >
                  Save Preset (.set)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Presets Library Manager */}
      {isSetManagerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-[#101014] border border-zinc-800 rounded-xl p-5 max-w-2xl w-full space-y-4 shadow-2xl max-h-[85vh] flex flex-col font-mono">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <FolderOpen className="w-4 h-4 text-accent-amber" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-zinc-100">
                    Strategy Presets (.set)
                  </h3>
                </div>
                <p className="text-[10px] text-zinc-500">
                  Target Bot: <strong className="text-zinc-300">{activeBot?.name}</strong>
                </p>
              </div>
              <button
                onClick={() => setIsSetManagerOpen(false)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {(daemon?.setFiles || []).map((sf) => {
                const isCurrentBotActive = activeBot?.activeSetFileName?.toLowerCase() === sf.fileName?.toLowerCase();

                return (
                  <div
                    key={sf.fileName}
                    className={`p-3 rounded-lg border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                      isCurrentBotActive
                        ? "bg-amber-500/5 border-amber-500/30"
                        : "bg-zinc-950/80 border-zinc-800/90 hover:border-zinc-700"
                    }`}
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-zinc-100 text-xs">{sf.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                          {sf.fileName}
                        </span>
                        {sf.isBuiltIn && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700 font-semibold">
                            Built-in
                          </span>
                        )}
                        {isCurrentBotActive && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-accent-amber border border-amber-500/30 font-bold">
                            Active
                          </span>
                        )}
                      </div>

                      {/* Compact parameters chips */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                          Spread: &ge;{sf.config?.minSpreadBps} bps
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                          Parity: ≤{sf.config?.maxPriceDivergencePct ?? 0.10}%
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-400">
                          {sf.config?.timingMode === "CONTINUOUS_SPREAD" ? "Continuous" : "Sniper"}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center space-x-1.5 shrink-0 self-end sm:self-center">
                      {isCurrentBotActive ? (
                        <span className="px-3 py-1.5 rounded-lg bg-zinc-900 text-accent-amber border border-amber-500/30 font-bold text-[11px]">
                          Loaded ✓
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            handleApplySetFile(sf.fileName);
                            setIsSetManagerOpen(false);
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-[11px] transition-all active:scale-95 shadow-sm"
                        >
                          Load
                        </button>
                      )}

                      <button
                        onClick={() => handleDownloadSetFile(sf.fileName)}
                        className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition-colors"
                        title="Download .set file"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      {!sf.isBuiltIn && (
                        <button
                          onClick={() => handleDeleteSetFile(sf.fileName)}
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 border border-zinc-800 hover:border-rose-800/60 transition-colors"
                          title="Delete custom preset"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleExportFleetBackup}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-accent-cyan border border-zinc-800 text-xs font-semibold flex items-center space-x-1.5 transition-all"
                  title="Export full backup JSON containing all bots and custom presets"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Fleet (.json)</span>
                </button>
                <label className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-accent-amber border border-zinc-800 text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Backup</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportFleetBackup}
                    className="hidden"
                  />
                </label>
              </div>
              <button
                onClick={() => setIsSetManagerOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
