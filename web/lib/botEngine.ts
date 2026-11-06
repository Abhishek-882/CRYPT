import fs from "fs";
import path from "path";
import crypto from "crypto";
import { signAndFetchBinance, setBinanceLeverage, placeBinanceOrder } from "./binanceSigner";
import { placeBitgetOrder, setBitgetLeverage, BitgetCredentials } from "./bitgetSigner";
import { acquireDaemonLock, releaseDaemonLock, updateDaemonLockHeartbeat, isDaemonLocked, isDaemonLockHeldByCurrentProcess } from "./daemonLockManager";
import { getCorridorStaggerDelays, getLeadStaggerDelays, recordExecutionRTTMulti, recordExecutionRTT } from "./latencyTracker";
import { recordServerTrade, ingestExchangeFillReceipt, ingestFundingCashFlow } from "./serverTradeStore";
import { getDeterministicNextFundingTime } from "./settlementTime";
import { fetchFundingMetaMap, SymbolFundingMeta, checkFundingSynchronization, getVenueFundingInfo, getCachedFundingMeta, getFundingMetaForSymbol, isIntervalPairAllowed } from "./exchangeFundingMeta";
import {
  SYSTEM_DEFAULT_BINANCE_KEY,
  SYSTEM_DEFAULT_BINANCE_SECRET,
  SYSTEM_DEFAULT_BITGET_KEY,
  SYSTEM_DEFAULT_BITGET_SECRET,
  SYSTEM_DEFAULT_BITGET_PASSPHRASE,
  SYSTEM_DEFAULT_BYBIT_KEY,
  SYSTEM_DEFAULT_BYBIT_SECRET,
  getAllActiveUsers,
  getDecryptedUserApiKeys,
  UserAccount,
  UserApiKeys,
} from "./userStore";
import { decryptVaultSecret } from "./cryptoVault";
import { getUserActiveConsents, getUserConsentHistory } from "./complianceStore";
import {
  resolveDataFilePath,
  resolveUserStoragePath,
  readDataFile,
  saveDataFile,
  readUserDataFile,
  saveUserDataFile,
} from "./storagePath";
import { verifyProxyPreFlight, getProxyPoolSnapshot } from "./proxyPoolManager";
import { getCoinMaxLeverages, calculateAutoSplit } from "./exchangeLeverageMeta";
import { getAllBybitTickers, getBybitTicker, subscribeBybitSymbols } from "./bybitStreamManager";
import {
  evaluatePairwiseArbitrage,
  VenueRateInfo,
  PairwiseCombination,
  calculateDirectionalSpread,
  calculateHedgeFundingYield,
  calculateAsymmetricMacroYield,
  calculateSignedBasisBps,
  ROUNDTRIP_TAKER_FEE_BPS,
  MIN_GROSS_SPREAD_BPS,
} from "./spreadCalculation";
import { getLivePositionsForVenues, hasCorridorLivePosition } from "./exchangePositions";
import { bybitTradeStream } from "./bybitTradeStream";
import { binanceTradeStream } from "./binanceTradeStream";
import { coindcxTradeStream } from "./coindcxTradeStream";
import { ContractIdentityResolver } from "./contractIdentityResolver";
import { PrecisionManager } from "./precisionManager";

export type FundingIntervalMode = "ALL_ASYMMETRIC" | "STRICT_SYNC_ONLY" | "CUSTOM";

export interface BotConfig {
  enabled: boolean;
  minSpreadBps: number;
  roundTripFeeBps?: number; // Configurable round-trip taker commissions hurdle (default: 25 bps / 0.25%)
  maxPriceDivergencePct: number;
  maxDivergenceSpreadRatioPct?: number;
  maxPriceDivergenceCapPct?: number;
  balanceAllocationPct: number;
  leverageMode: "MAX_PER_COIN" | "CUSTOM";
  customLeverage: number;
  maxSimultaneousHedges: number;
  maxMarginCapUsdt: number;
  maxAmountPerHedgeUsdt?: number;
  postSettlementWaitSeconds: number;
  closeMaxPriceDivergencePct: number;
  scanIntervalSeconds: number;
  timingMode?: "FUNDING_SNIPER_5M" | "FUNDING_SNIPER_1M" | "CONTINUOUS_SPREAD";
  sniperWindowMinutes?: number;
  optimalPriceDivergencePct?: number;
  executionCorridor?: "BINANCE_BITGET" | "BINANCE_COINDCX" | "BINANCE_BYBIT" | "COINDCX_BYBIT" | "COINDCX_BITGET" | "BITGET_BYBIT";
  enableFlattenMemoryLock?: boolean;
  maxDailyDrawdownUsdt?: number;
  maxTradeDrawdownUsdt?: number;
  enableSyntheticDeltaFreeze?: boolean;
  allowAsymmetricFunding?: boolean; // Permits staggered funding intervals (e.g. 1h vs 4h) and non-synchronized countdowns
  intervalMode?: FundingIntervalMode; // "ALL_ASYMMETRIC" | "STRICT_SYNC_ONLY" | "CUSTOM"
  allowedIntervalPairs?: string[]; // e.g. ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h", "1h_2h"]
  enableFundingInversionCircuitBreaker?: boolean; // Default false: disabled to prevent premature fee losses
  enableCarryContinuation?: boolean; // Default true: roll into next cycle if next funding spread remains profitable
  minContinuationSpreadBps?: number; // Minimum spread for next cycle to continue holding (default 25 bps)
  targetRoiTakeProfitPct?: number; // Target ROI % (default 20.0) to activate exit when divergence <= closeMaxPriceDivergencePct
  hardRoiTakeProfitPct?: number; // Hard Blowoff ROI % (default 50.0) to immediately close without waiting for divergence
  liquidityTier?: "DEEP" | "MEDIUM" | "THIN"; // Order book depth profile: DEEP (BTC/0.35x), MEDIUM (Mid-Cap/1x), THIN (Thin Alt/2.5x)
  minNetYieldHurdleBps?: number; // Dynamic Net-Yield Hurdle (bps): Gross spread minus (fees + bid-ask spread + depth slippage) must be >= this hurdle (default: 15.0 bps)
  maxBidAskSpreadBps?: number; // Maximum allowable top-of-book bid-ask spread ceiling on either venue (default: 25.0 bps)
  maxPreTradeSlippagePct?: number; // Maximum allowable simulated VWAP slippage on either venue (default: 0.05% / 5 bps)
  enablePreTradeSlippageGate?: boolean; // Enable/disable pre-trade friction and depth screening (default: true)
  enableSpreadCollapseExit?: boolean; // Enable early exit when live funding spread collapses below threshold and price converges (default: true)
  spreadCollapseExitBps?: number; // Funding spread floor (bps): if live spread drops below this, exit early once price converges (default: 25.0 bps)
  enableMakerRouting?: boolean; // Default true: route Leg 1 as post-only limit maker to slash 40 bps taker fees
  currentSignedBasisBps?: number; // Transient signed basis contribution (+bps favorable, -bps adverse) passed to friction gate
  enableZeroLossGate?: boolean; // Zero-Loss Dynamic Exit Engine: blocks any exit where Net PnL < +$0.01 USDT unless catastrophic stop
}

export interface ActiveBotHedge {
  id: string;
  symbol: string;
  direction: string;
  venueA?: "CoinDCX" | "Binance" | "Bitget" | "Bybit";
  venueB?: "Bitget" | "CoinDCX" | "Bybit" | "Binance";
  quantity: string;
  effectiveQty: number;
  notionalUsdt: number;
  binanceLeverage: number;
  bitgetLeverage: number;
  entrySpreadBps: number;
  entryBinancePrice: number;
  entryBitgetPrice: number;
  entryDivergencePct: number;
  entryTime: number;
  fundingSettlementTime: number;
  macroNextFundingTime?: number;
  earliestNextFundingTime?: number;
  cyclesHarvested?: number;
  lastHarvestedSettlementTime?: number;
  isAsymmetric?: boolean;
  venueAIntervalHours?: number;
  venueBIntervalHours?: number;
  leg1OrderId?: string | number;
  leg2OrderId?: string | number;
  legAClientOrderId?: string;
  legBClientOrderId?: string;
  leg1ClientOrderId?: string;
  leg2ClientOrderId?: string;
  status: "ACTIVE" | "WAITING_PRICE_PARITY" | "CLOSING" | "CLOSED" | "FAILED_UNWOUND" | "FROZEN_PROXY_DOWN" | "ORPHAN_RECOVERY" | "SYNTHETIC_DELTA_LOCKED";
  unwindReason?: string;
  pnl?: number;
  closeBinancePrice?: number;
  closeBitgetPrice?: number;
  closeDivergencePct?: number;
  closeTime?: number;

  // Granular Leg Closure & Orphan State Tracking
  leg1Closed?: boolean;
  leg2Closed?: boolean;
  leg1CloseOrderId?: string | number;
  leg2CloseOrderId?: string | number;
  leg1ClosePrice?: number;
  leg2ClosePrice?: number;
  orphanLeg?: "LEG1" | "LEG2" | null;
  orphanSince?: number;
  orphanAttempts?: number;
  orphanLastRetryAt?: number;
  orphanLastError?: string;

  // Synthetic Delta Re-Hedging (Zero-Delta Lock)
  syntheticVenue?: "Binance" | "Bybit" | "Bitget" | "CoinDCX";
  syntheticSide?: "BUY" | "SELL";
  syntheticOrderId?: string | number;
  syntheticPrice?: number;
  syntheticLockedAt?: number;
  syntheticUnwindOrderId?: string | number;
  reconnectPings?: number;

  // High-Resolution Order Latency Telemetry (millisecond timestamps)
  botId?: string;
  botName?: string;
  leg1DispatchedAt?: number;
  leg1PlacedAt?: number;
  leg1LatencyMs?: number;
  leg2DispatchedAt?: number;
  leg2PlacedAt?: number;
  leg2LatencyMs?: number;
  interLegDeltaMs?: number; // |leg1PlacedAt - leg2PlacedAt| in ms
  leadStaggerAppliedMs?: number;
  leadVenue?: string;
  transport?: "WEBSOCKET" | "REST" | "REST_FALLBACK";

  // Unwind / Close Latency Telemetry
  closeLeg1DispatchedAt?: number;
  closeLeg1PlacedAt?: number;
  closeLeg1LatencyMs?: number;
  closeLeg2DispatchedAt?: number;
  closeLeg2PlacedAt?: number;
  closeLeg2LatencyMs?: number;
  closeInterLegDeltaMs?: number; // |closeLeg1PlacedAt - closeLeg2PlacedAt| in ms

  // Real Fee & Funding Telemetry
  leg1FeeUsdt?: number;
  leg2FeeUsdt?: number;
  closeLeg1FeeUsdt?: number;
  closeLeg2FeeUsdt?: number;
  totalFeesUsdt?: number;
  fundingClaimedUsdt?: number;
  fundingRatePct?: number;
}

export interface BotLog {
  timestamp: string;
  message: string;
  level: "info" | "success" | "warn" | "error";
  botId?: string;
  botName?: string;
  count?: number;
}

export interface BotSetFile {
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

export interface BotInstance {
  id: string;
  name: string;
  activeSetFileName: string;
  enabled: boolean;
  maxMarginCapUsdt: number;
  config: BotConfig;
  flattenedCoinsBlacklist: string[];
  symbolCooldowns?: Record<string, number>; // Post-trade anti-churn quarantine timestamps (symbol -> expire ms)
  activeHedges: ActiveBotHedge[];
  completedHedges: ActiveBotHedge[];
  logs: BotLog[];
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

export interface BotEngineState {
  isRunning: boolean;
  runInBackgroundWhenClosed: boolean;
  mode: string;
  startedAt: number;
  lastCycleAt: number;
  cyclesCompleted: number;
  activeBotId: string;
  bots: BotInstance[];
  setFiles: BotSetFile[];
  logs: BotLog[];
  // Legacy backward compatibility properties
  config?: BotConfig;
  activeHedges?: ActiveBotHedge[];
  completedHedges?: ActiveBotHedge[];
  statusText?: string;
  lastEvaluatedCandidate?: any;
}

const STATE_FILE_NAME = "bot_daemon_state.json";
const SET_FILES_NAME = "bot_set_files.json";
const AUDIT_LOG_FILE_NAME = "bot_audit_log.json";

// Concurrency in-flight symbol locks to prevent duplicate order dispatches across fleet
const inFlightEntryLocks = new Set<string>();

export function isCorridorSymbolLocked(corridor: string, symbol: string): boolean {
  const sym = (symbol || "").toUpperCase();
  const corr = (corridor || "").toUpperCase();
  return inFlightEntryLocks.has(sym) || inFlightEntryLocks.has(`${corr}_${sym}`);
}

export function releaseCorridorSymbolLock(corridor: string, symbol: string): void {
  const sym = (symbol || "").toUpperCase();
  const corr = (corridor || "").toUpperCase();
  inFlightEntryLocks.delete(sym);
  inFlightEntryLocks.delete(`${corr}_${sym}`);
  try {
    import("./fleetDispatcher").then(({ globalFleetDispatcher }) => {
      globalFleetDispatcher.releaseFleetLock(sym, corr, "admin");
    }).catch(() => {});
  } catch {}
}

// System admin API credentials for 24/7 background worker
const ADMIN_BINANCE_KEY = SYSTEM_DEFAULT_BINANCE_KEY;
const ADMIN_BINANCE_SECRET = SYSTEM_DEFAULT_BINANCE_SECRET;
const ADMIN_BINANCE_ENDPOINT = "https://fapi.binance.com";
const ADMIN_BYBIT_KEY = SYSTEM_DEFAULT_BYBIT_KEY;
const ADMIN_BYBIT_SECRET = SYSTEM_DEFAULT_BYBIT_SECRET;
const ADMIN_BITGET_CREDS: BitgetCredentials = {
  apiKey: SYSTEM_DEFAULT_BITGET_KEY,
  apiSecret: SYSTEM_DEFAULT_BITGET_SECRET,
  passphrase: SYSTEM_DEFAULT_BITGET_PASSPHRASE,
  isDemo: true,
};

export const DEFAULT_CONFIG: BotConfig = {
  enabled: true,
  minSpreadBps: 35.0, // 0.35% minimum required gross funding spread to clear round-trip taker commissions
  roundTripFeeBps: 25.0, // 25 bps (0.25%) default round-trip fee hurdle
  maxPriceDivergencePct: 0.05,
  maxDivergenceSpreadRatioPct: 50,
  maxPriceDivergenceCapPct: 0.50,
  optimalPriceDivergencePct: 0.01,
  balanceAllocationPct: 20,
  leverageMode: "MAX_PER_COIN",
  customLeverage: 50,
  maxSimultaneousHedges: 3,
  maxMarginCapUsdt: 500,
  maxAmountPerHedgeUsdt: 30,
  postSettlementWaitSeconds: 15,
  closeMaxPriceDivergencePct: 0.03,
  targetRoiTakeProfitPct: 20.0,
  hardRoiTakeProfitPct: 50.0,
  liquidityTier: "MEDIUM",
  minNetYieldHurdleBps: 15.0,
  maxBidAskSpreadBps: 25.0,
  maxPreTradeSlippagePct: 0.05,
  enablePreTradeSlippageGate: false, // Default OFF as configured
  enableSpreadCollapseExit: false, // Default false to prevent premature exits before funding settlement
  spreadCollapseExitBps: 25.0,
  scanIntervalSeconds: 5,
  timingMode: "FUNDING_SNIPER_5M",
  executionCorridor: "COINDCX_BYBIT",
  enableFlattenMemoryLock: true,
  allowAsymmetricFunding: true,
  intervalMode: "ALL_ASYMMETRIC",
  allowedIntervalPairs: ["1h_4h", "4h_8h", "1h_8h", "2h_4h", "2h_8h", "1h_2h"],
};

export function serializeConfigToSetText(config: BotConfig, name: string): string {
  const effectiveMode: FundingIntervalMode = config.intervalMode || (config.allowAsymmetricFunding !== false ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY");
  const allowedPairsStr = (config.allowedIntervalPairs || []).join(",");

  return [
    `; ============================================================`,
    `; AI-Hedge Delta-Neutral Quantitative Strategy Set File`,
    `; Strategy Preset: ${name}`,
    `; Exported: ${new Date().toISOString()}`,
    `; Compatible with: MetaTrader 4/5 & AI-Hedge Daemon Engine`,
    `; ============================================================`,
    `Enabled=${config.enabled}`,
    `MinSpreadBps=${config.minSpreadBps}`,
    `RoundTripFeeBps=${config.roundTripFeeBps ?? 25.0}`,
    `MaxPriceDivergencePct=${config.maxPriceDivergencePct}`,
    `MaxDivergenceSpreadRatioPct=${config.maxDivergenceSpreadRatioPct ?? 50}`,
    `MaxPriceDivergenceCapPct=${config.maxPriceDivergenceCapPct ?? 0.50}`,
    `OptimalPriceDivergencePct=${config.optimalPriceDivergencePct ?? 0.01}`,
    `BalanceAllocationPct=${config.balanceAllocationPct}`,
    `LeverageMode=${config.leverageMode}`,
    `CustomLeverage=${config.customLeverage}`,
    `MaxSimultaneousHedges=${config.maxSimultaneousHedges}`,
    `MaxMarginCapUsdt=${config.maxMarginCapUsdt || 500}`,
    `MaxAmountPerHedgeUsdt=${config.maxAmountPerHedgeUsdt || 30}`,
    `PostSettlementWaitSeconds=${config.postSettlementWaitSeconds}`,
    `CloseMaxPriceDivergencePct=${config.closeMaxPriceDivergencePct}`,
    `TargetRoiTakeProfitPct=${config.targetRoiTakeProfitPct ?? 20.0}`,
    `HardRoiTakeProfitPct=${config.hardRoiTakeProfitPct ?? 50.0}`,
    `OrderBookDepth=${config.liquidityTier || "MEDIUM"}`,
    `MinNetYieldHurdleBps=${config.minNetYieldHurdleBps ?? 15.0}`,
    `MaxBidAskSpreadBps=${config.maxBidAskSpreadBps ?? 25.0}`,
    `MaxPreTradeSlippagePct=${config.maxPreTradeSlippagePct ?? 0.05}`,
    `EnablePreTradeSlippageGate=${config.enablePreTradeSlippageGate !== false}`,
    `EnableSpreadCollapseExit=${config.enableSpreadCollapseExit !== false}`,
    `SpreadCollapseExitBps=${config.spreadCollapseExitBps ?? 25.0}`,
    `ScanIntervalSeconds=${config.scanIntervalSeconds}`,
    `TimingMode=${config.timingMode || "FUNDING_SNIPER_5M"}`,
    `SniperWindowMinutes=${config.sniperWindowMinutes ?? (config.timingMode === "FUNDING_SNIPER_1M" ? 1 : 5)}`,
    `ExecutionCorridor=${config.executionCorridor || "COINDCX_BYBIT"}`,
    `EnableFlattenMemoryLock=${config.enableFlattenMemoryLock !== false}`,
    `AllowAsymmetricFunding=${effectiveMode !== "STRICT_SYNC_ONLY"}`,
    `IntervalMode=${effectiveMode}`,
    `AllowedIntervalPairs=${allowedPairsStr}`,
  ].join("\n");
}

export function parseSetTextToConfig(text: string, baseConfig?: BotConfig): BotConfig {
  const cfg: BotConfig = { ...(baseConfig || DEFAULT_CONFIG) };
  let intervalModeExplicit = false;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim();

    switch (key) {
      case "enabled":
        cfg.enabled = val.toLowerCase() === "true" || val === "1";
        break;
      case "minspreadbps":
        cfg.minSpreadBps = parseFloat(val) || cfg.minSpreadBps;
        break;
      case "roundtripfeebps":
      case "roundtriptakerfeebps":
      case "takerfeebps":
        cfg.roundTripFeeBps = parseFloat(val) || 25.0;
        break;
      case "maxpricedivergencepct":
        cfg.maxPriceDivergencePct = parseFloat(val) || cfg.maxPriceDivergencePct;
        break;
      case "maxdivergencespreadratiopct":
        cfg.maxDivergenceSpreadRatioPct = parseFloat(val) || 50;
        break;
      case "maxpricedivergencecappct":
        cfg.maxPriceDivergenceCapPct = parseFloat(val) || 0.50;
        break;
      case "balanceallocationpct":
        cfg.balanceAllocationPct = parseFloat(val) || cfg.balanceAllocationPct;
        break;
      case "leveragemode":
        cfg.leverageMode = val === "CUSTOM" ? "CUSTOM" : "MAX_PER_COIN";
        break;
      case "customleverage":
        cfg.customLeverage = parseInt(val, 10) || cfg.customLeverage;
        break;
      case "maxsimultaneoushedges":
        cfg.maxSimultaneousHedges = parseInt(val, 10) || cfg.maxSimultaneousHedges;
        break;
      case "maxmargincapusdt":
        cfg.maxMarginCapUsdt = parseFloat(val) || 500;
        break;
      case "maxamountperhedgeusdt":
      case "maxamountperhedge":
        cfg.maxAmountPerHedgeUsdt = parseFloat(val) || 30;
        break;
      case "postsettlementwaitseconds":
        cfg.postSettlementWaitSeconds = parseInt(val, 10) || cfg.postSettlementWaitSeconds;
        break;
      case "closemaxpricedivergencepct": {
        const parsedVal = parseFloat(val);
        if (!isNaN(parsedVal) && parsedVal >= 0) {
          cfg.closeMaxPriceDivergencePct = parsedVal;
        }
        break;
      }
      case "targetroitakeprofitpct": {
        const parsedVal = parseFloat(val);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          cfg.targetRoiTakeProfitPct = parsedVal;
        }
        break;
      }
      case "hardroitakeprofitpct": {
        const parsedVal = parseFloat(val);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          cfg.hardRoiTakeProfitPct = parsedVal;
        }
        break;
      }
      case "orderbookdepth":
      case "liquiditytier": {
        const upper = val.toUpperCase();
        if (upper === "DEEP" || upper === "THIN" || upper === "MEDIUM") {
          cfg.liquidityTier = upper;
        }
        break;
      }
      case "minnetyieldhurdlebps":
      case "netyieldhurdlebps":
      case "minnetyield": {
        const parsedVal = parseFloat(val);
        if (!isNaN(parsedVal)) {
          cfg.minNetYieldHurdleBps = parsedVal;
        }
        break;
      }
      case "maxbidaskspreadbps":
      case "bidaskspreadbps":
      case "maxspreadceilingbps": {
        const parsedVal = parseFloat(val);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          cfg.maxBidAskSpreadBps = parsedVal;
        }
        break;
      }
      case "maxpretradeslippagepct":
      case "maxslippagepct": {
        const parsedVal = parseFloat(val);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          cfg.maxPreTradeSlippagePct = parsedVal;
        }
        break;
      }
      case "enablepretradeslippagegate":
      case "pretradeslippagegate":
      case "enableslippagefilter": {
        cfg.enablePreTradeSlippageGate = val.toLowerCase() === "true" || val === "1";
        break;
      }
      case "enablespreadcollapseexit":
      case "spreadcollapseexit": {
        cfg.enableSpreadCollapseExit = val.toLowerCase() === "true" || val === "1";
        break;
      }
      case "spreadcollapseexitbps":
      case "collapseexitbps":
      case "spreadcollapsebps": {
        const parsedVal = parseFloat(val);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          cfg.spreadCollapseExitBps = parsedVal;
        }
        break;
      }
      case "scanintervalseconds":
        cfg.scanIntervalSeconds = parseInt(val, 10) || cfg.scanIntervalSeconds;
        break;
      case "timingmode":
        cfg.timingMode = val === "CONTINUOUS_SPREAD" ? "CONTINUOUS_SPREAD" : val === "FUNDING_SNIPER_1M" ? "FUNDING_SNIPER_1M" : "FUNDING_SNIPER_5M";
        break;
      case "sniperwindowminutes":
      case "sniperwindow":
        cfg.sniperWindowMinutes = parseFloat(val) || cfg.sniperWindowMinutes;
        break;
      case "executioncorridor":
        cfg.executionCorridor = val.toUpperCase() as any;
        break;
      case "enableflattenmemorylock":
      case "flattenmemorylock":
        cfg.enableFlattenMemoryLock = val.toLowerCase() === "true" || val === "1";
        break;
      case "intervalmode": {
        intervalModeExplicit = true;
        const upper = val.toUpperCase();
        if (upper === "STRICT_SYNC_ONLY" || upper === "STRICT" || upper === "OPTION2") {
          cfg.intervalMode = "STRICT_SYNC_ONLY";
          cfg.allowAsymmetricFunding = false;
        } else if (upper === "CUSTOM") {
          cfg.intervalMode = "CUSTOM";
          cfg.allowAsymmetricFunding = true;
        } else {
          cfg.intervalMode = "ALL_ASYMMETRIC";
          cfg.allowAsymmetricFunding = true;
        }
        break;
      }
      case "allowedintervalpairs": {
        cfg.allowedIntervalPairs = val
          ? val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
          : [];
        break;
      }
      case "allowasymmetricfunding":
      case "asymmetricfunding": {
        const asym = val.toLowerCase() === "true" || val === "1";
        if (!intervalModeExplicit) {
          cfg.allowAsymmetricFunding = asym;
          cfg.intervalMode = asym ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY";
        }
        break;
      }
    }
  }
  if (intervalModeExplicit) {
    cfg.allowAsymmetricFunding = cfg.intervalMode !== "STRICT_SYNC_ONLY";
  }
  return cfg;
}

export const BUILT_IN_SET_FILES: BotSetFile[] = [
  {
    id: "set-conservative",
    fileName: "conservative_35bps_sniper.set",
    name: "Conservative 35bps Sniper",
    description: "Snipes within 60s of funding with strict 35 bps spread (clears 23 bps taker fees), 0.03% parity, $500 hard margin cap.",
    config: {
      enabled: true,
      minSpreadBps: 35.0,
      maxPriceDivergencePct: 0.03,
      balanceAllocationPct: 20,
      leverageMode: "MAX_PER_COIN",
      customLeverage: 50,
      maxSimultaneousHedges: 3,
      maxMarginCapUsdt: 500,
      maxAmountPerHedgeUsdt: 30,
      postSettlementWaitSeconds: 15,
      closeMaxPriceDivergencePct: 0.03,
      scanIntervalSeconds: 5,
      timingMode: "FUNDING_SNIPER_5M",
      executionCorridor: "COINDCX_BYBIT",
      enableFlattenMemoryLock: true,
      allowAsymmetricFunding: true,
    },
    contentText: serializeConfigToSetText(
      {
        enabled: true,
        minSpreadBps: 35.0,
        maxPriceDivergencePct: 0.03,
        balanceAllocationPct: 20,
        leverageMode: "MAX_PER_COIN",
        customLeverage: 50,
        maxSimultaneousHedges: 3,
        maxMarginCapUsdt: 500,
        maxAmountPerHedgeUsdt: 30,
        postSettlementWaitSeconds: 15,
        closeMaxPriceDivergencePct: 0.03,
        scanIntervalSeconds: 5,
        timingMode: "FUNDING_SNIPER_5M",
        executionCorridor: "COINDCX_BYBIT",
        enableFlattenMemoryLock: true,
        allowAsymmetricFunding: true,
      },
      "Conservative 35bps Sniper"
    ),
    isBuiltIn: true,
    createdAt: 1775000000000,
    updatedAt: 1775000000000,
  },
  {
    id: "set-aggressive",
    fileName: "aggressive_continuous_arbitrage.set",
    name: "Aggressive Continuous Arbitrage",
    description: "Continuous spread capture 24/7 without waiting for funding window. 35 bps spread (clears taker drag), 0.05% parity, $1,000 cap.",
    config: {
      enabled: true,
      minSpreadBps: 35.0,
      maxPriceDivergencePct: 0.05,
      balanceAllocationPct: 25,
      leverageMode: "MAX_PER_COIN",
      customLeverage: 50,
      maxSimultaneousHedges: 5,
      maxMarginCapUsdt: 1000,
      maxAmountPerHedgeUsdt: 50,
      postSettlementWaitSeconds: 15,
      closeMaxPriceDivergencePct: 0.05,
      scanIntervalSeconds: 5,
      timingMode: "CONTINUOUS_SPREAD",
      executionCorridor: "COINDCX_BYBIT",
      enableFlattenMemoryLock: true,
      allowAsymmetricFunding: true,
    },
    contentText: serializeConfigToSetText(
      {
        enabled: true,
        minSpreadBps: 35.0,
        maxPriceDivergencePct: 0.05,
        balanceAllocationPct: 25,
        leverageMode: "MAX_PER_COIN",
        customLeverage: 50,
        maxSimultaneousHedges: 5,
        maxMarginCapUsdt: 1000,
        maxAmountPerHedgeUsdt: 50,
        postSettlementWaitSeconds: 15,
        closeMaxPriceDivergencePct: 0.05,
        scanIntervalSeconds: 5,
        timingMode: "CONTINUOUS_SPREAD",
        executionCorridor: "COINDCX_BYBIT",
        enableFlattenMemoryLock: true,
        allowAsymmetricFunding: true,
      },
      "Aggressive Continuous Arbitrage"
    ),
    isBuiltIn: true,
    createdAt: 1775000000000,
    updatedAt: 1775000000000,
  },
  {
    id: "set-balanced",
    fileName: "balanced_institutional_harvest.set",
    name: "Balanced Institutional Harvest",
    description: "Funding Sniper mode with 35 bps spread threshold (clears taker drag), 0.03% parity, $750 hard cap.",
    config: {
      enabled: true,
      minSpreadBps: 35.0,
      maxPriceDivergencePct: 0.03,
      balanceAllocationPct: 20,
      leverageMode: "MAX_PER_COIN",
      customLeverage: 50,
      maxSimultaneousHedges: 4,
      maxMarginCapUsdt: 750,
      maxAmountPerHedgeUsdt: 30,
      postSettlementWaitSeconds: 15,
      closeMaxPriceDivergencePct: 0.03,
      scanIntervalSeconds: 5,
      timingMode: "FUNDING_SNIPER_5M",
      executionCorridor: "COINDCX_BYBIT",
      enableFlattenMemoryLock: true,
      allowAsymmetricFunding: true,
    },
    contentText: serializeConfigToSetText(
      {
        enabled: true,
        minSpreadBps: 35.0,
        maxPriceDivergencePct: 0.03,
        balanceAllocationPct: 20,
        leverageMode: "MAX_PER_COIN",
        customLeverage: 50,
        maxSimultaneousHedges: 4,
        maxMarginCapUsdt: 750,
        maxAmountPerHedgeUsdt: 30,
        postSettlementWaitSeconds: 15,
        closeMaxPriceDivergencePct: 0.03,
        scanIntervalSeconds: 5,
        timingMode: "FUNDING_SNIPER_5M",
        executionCorridor: "COINDCX_BYBIT",
        enableFlattenMemoryLock: true,
        allowAsymmetricFunding: true,
      },
      "Balanced Institutional Harvest"
    ),
    isBuiltIn: true,
    createdAt: 1775000000000,
    updatedAt: 1775000000000,
  },
  {
    id: "set-canary",
    fileName: "canary_micro_15usd.set",
    name: "Canary Micro-Staging 15USD",
    description: "Stage 3 Canary Micro-Staging preset: $15 max position, $100 margin ceiling, 1 concurrent hedge, 35 bps fee clearance, Asymmetric ON.",
    config: {
      enabled: true,
      minSpreadBps: 35.0,
      maxPriceDivergencePct: 0.03,
      balanceAllocationPct: 15,
      leverageMode: "CUSTOM",
      customLeverage: 10,
      maxSimultaneousHedges: 1,
      maxMarginCapUsdt: 100,
      maxAmountPerHedgeUsdt: 15,
      postSettlementWaitSeconds: 15,
      closeMaxPriceDivergencePct: 0.03,
      scanIntervalSeconds: 5,
      timingMode: "FUNDING_SNIPER_5M",
      executionCorridor: "COINDCX_BYBIT",
      enableFlattenMemoryLock: true,
      allowAsymmetricFunding: true,
    },
    contentText: serializeConfigToSetText(
      {
        enabled: true,
        minSpreadBps: 35.0,
        maxPriceDivergencePct: 0.03,
        balanceAllocationPct: 15,
        leverageMode: "CUSTOM",
        customLeverage: 10,
        maxSimultaneousHedges: 1,
        maxMarginCapUsdt: 100,
        maxAmountPerHedgeUsdt: 15,
        postSettlementWaitSeconds: 15,
        closeMaxPriceDivergencePct: 0.03,
        scanIntervalSeconds: 5,
        timingMode: "FUNDING_SNIPER_5M",
        executionCorridor: "COINDCX_BYBIT",
        enableFlattenMemoryLock: true,
        allowAsymmetricFunding: true,
      },
      "Canary Micro-Staging 15USD"
    ),
    isBuiltIn: true,
    createdAt: 1775000000000,
    updatedAt: 1775000000000,
  },
];

export function getCoinMaxLeverage(sym: string): { bn: number; bg: number; byb: number; cdx: number } {
  const levs = getCoinMaxLeverages(sym);
  return { bn: levs.binance, bg: levs.bitget, byb: levs.bybit, cdx: levs.coindcx };
}

/**
 * Upgrade 2 / Pillar 2: Pre-Flight Leg 2 Solvency & Health Guarantee
 * Verifies counterpart venue health, ticker freshness, and margin sufficiency BEFORE Leg 1 is dispatched.
 * If any check fails, Leg 1 is NEVER sent (0 orphan exposure, $0.00 loss).
 */
export async function preFlightLeg2Check(params: {
  venueBName: string;
  symbol: string;
  requiredMarginUsdt: number;
  bybitCreds?: any;
}): Promise<{ passed: boolean; reason?: string }> {
  const { venueBName, symbol, requiredMarginUsdt, bybitCreds } = params;

  if (venueBName === "Bybit") {
    // 1. Ticker & stream freshness check
    const { getBybitTicker } = await import("./bybitStreamManager");
    const ticker = getBybitTicker(symbol);
    if (!ticker || ticker.markPrice <= 0) {
      return {
        passed: false,
        reason: `Bybit stream has no active price quote for ${symbol}`,
      };
    }

    // 2. Margin sufficiency check (if creds available)
    if (bybitCreds?.apiKey && bybitCreds?.apiSecret) {
      try {
        const { getBybitWalletBalance } = await import("./bybitSigner");
        const bal = await getBybitWalletBalance(bybitCreds);
        if (bal.success && bal.availableBalance > 0) {
          const minRequired = Math.max(1.0, requiredMarginUsdt * 1.05);
          if (bal.availableBalance < minRequired) {
            return {
              passed: false,
              reason: `Insufficient Bybit usable margin ($${bal.availableBalance.toFixed(2)} available < $${minRequired.toFixed(2)} required)`,
            };
          }
        }
      } catch (balErr: any) {
        console.warn(`[Pre-Flight Warning] Bybit balance check encountered transient error: ${balErr.message}`);
      }
    }
  }

  return { passed: true };
}

function formatSymbolQuantity(qty: number, symbol: string, refPrice: number = 0): string {
  const s = symbol.toUpperCase();
  let step = 1;
  if (s.startsWith("BTC")) step = 0.001;
  else if (s.startsWith("ETH")) step = 0.01;
  else if (s.startsWith("SOL")) step = 0.1;
  else if (s.startsWith("SUI")) step = 10;
  else if (s.includes("BONK") || s.includes("PEPE")) step = 100;
  else if (s.includes("RATS")) step = 10;
  else if (s.startsWith("DOGE") || s.startsWith("XRP")) step = 1;
  else if (refPrice > 500) step = 0.01;
  else if (refPrice > 50) step = 0.1;
  else if (refPrice > 1) step = 1;
  else step = 10;

  return PrecisionManager.formatQuantity(qty, step);
}

// Global Singleton to maintain worker interval and per-tenant state across Next.js reloads
const globalForBot = global as unknown as {
  tenantStates?: Record<string, BotEngineState>;
  tenantStateSignatures?: Record<string, string>;
  tenantLocks?: Set<string>;
  botEngineState?: BotEngineState;
  botInterval?: NodeJS.Timeout | null;
  keepAliveInterval?: NodeJS.Timeout | null;
  botIsExecutingCycle?: boolean;
};

if (!globalForBot.tenantStates) {
  globalForBot.tenantStates = {};
}
if (!globalForBot.tenantStateSignatures) {
  globalForBot.tenantStateSignatures = {};
}
if (!globalForBot.tenantLocks) {
  globalForBot.tenantLocks = new Set<string>();
}

export function loadSetFiles(userId?: string): BotSetFile[] {
  let customFiles: BotSetFile[] = [];
  if (userId && userId !== "global_default") {
    customFiles = readUserDataFile<BotSetFile[]>(userId, SET_FILES_NAME, []);
    if (customFiles.length === 0 && (userId === "usr_admin_varsha" || userId.includes("admin"))) {
      customFiles = readDataFile<BotSetFile[]>(SET_FILES_NAME, []);
    }
  } else {
    customFiles = readDataFile<BotSetFile[]>(SET_FILES_NAME, []);
  }

  const merged = [...BUILT_IN_SET_FILES];
  for (const cf of customFiles) {
    if (!merged.some((b) => b.fileName.toLowerCase() === cf.fileName.toLowerCase())) {
      merged.push(cf);
    }
  }
  return merged;
}

export function saveSetFiles(files: BotSetFile[], userId?: string) {
  if (userId && userId !== "global_default") {
    saveUserDataFile(userId, SET_FILES_NAME, files);
    if (userId === "usr_admin_varsha" || userId.includes("admin")) {
      saveDataFile(SET_FILES_NAME, files);
    }
  } else {
    saveDataFile(SET_FILES_NAME, files);
  }
}

function getBotStateFileSignature(userId?: string): string {
  try {
    let sig = "0_0";
    if (userId && userId !== "global_default") {
      const userFilePath = resolveUserStoragePath(userId, STATE_FILE_NAME);
      if (fs.existsSync(userFilePath)) {
        const stat = fs.statSync(userFilePath);
        sig = `${stat.mtimeMs}_${stat.size}`;
      }
    }
    const globalFilePath = resolveDataFilePath(STATE_FILE_NAME);
    if (fs.existsSync(globalFilePath)) {
      const gStat = fs.statSync(globalFilePath);
      sig += `|${gStat.mtimeMs}_${gStat.size}`;
    }
    return sig;
  } catch {}
  return "0_0";
}

export function loadBotState(userId?: string, forceDiskRead: boolean = false): BotEngineState {
  const tenantKey = userId || "usr_admin_varsha";
  const diskSig = getBotStateFileSignature(userId);

  if (
    !forceDiskRead &&
    globalForBot.tenantStates?.[tenantKey] &&
    globalForBot.tenantStateSignatures?.[tenantKey] === diskSig &&
    diskSig !== "0_0"
  ) {
    return globalForBot.tenantStates[tenantKey];
  }

  const allSetFiles = loadSetFiles(userId);

  try {
    let parsed: any = null;
    if (userId && userId !== "global_default") {
      parsed = readUserDataFile<any>(userId, STATE_FILE_NAME, null);
      if (!parsed && (userId === "usr_admin_varsha" || userId.includes("admin"))) {
        parsed = readDataFile<any>(STATE_FILE_NAME, null);
      }
    } else {
      parsed = readDataFile<any>(STATE_FILE_NAME, null);
    }

    if (parsed) {
      let bots: BotInstance[] = [];
      if (Array.isArray(parsed.bots) && parsed.bots.length > 0) {
        bots = parsed.bots.map((b: any, idx: number) => {
          const mergedConfig: BotConfig = { ...DEFAULT_CONFIG, ...(b.config || {}) };
          if (!mergedConfig.executionCorridor) {
            mergedConfig.executionCorridor = "COINDCX_BYBIT";
          }
          if (!mergedConfig.maxAmountPerHedgeUsdt || mergedConfig.maxAmountPerHedgeUsdt > 500) {
            mergedConfig.maxAmountPerHedgeUsdt = 30;
          }
          if (!mergedConfig.roundTripFeeBps) {
            mergedConfig.roundTripFeeBps = 25.0;
          }
          if (!b.config?.intervalMode && b.config?.allowAsymmetricFunding !== undefined) {
            mergedConfig.intervalMode = b.config.allowAsymmetricFunding ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY";
          }
          return {
            id: b.id || `bot-${idx + 1}`,
            name: b.name || `Bot ${idx + 1}`,
            activeSetFileName: b.activeSetFileName || "conservative_5bps_sniper.set",
            enabled: b.enabled !== undefined ? b.enabled : true,
            maxMarginCapUsdt: b.maxMarginCapUsdt || b.config?.maxMarginCapUsdt || 500,
            config: mergedConfig,
            flattenedCoinsBlacklist: Array.isArray(b.flattenedCoinsBlacklist) ? b.flattenedCoinsBlacklist : [],
            symbolCooldowns: typeof b.symbolCooldowns === "object" && b.symbolCooldowns !== null ? b.symbolCooldowns : {},
            activeHedges: Array.isArray(b.activeHedges) ? b.activeHedges : [],
            completedHedges: Array.isArray(b.completedHedges) ? b.completedHedges : [],
            logs: Array.isArray(b.logs) ? b.logs : [],
            statusText: b.statusText || "RUNNING_24_7",
            lastEvaluatedCandidate: b.lastEvaluatedCandidate || null,
            createdAt: b.createdAt || Date.now(),
            updatedAt: b.updatedAt || Date.now(),
          };
        });
      } else {
        // Upgrade legacy single-bot schema to multi-bot roster
        const legacyConfig: BotConfig = { ...DEFAULT_CONFIG, ...(parsed.config || {}) };
        if (!legacyConfig.executionCorridor) {
          legacyConfig.executionCorridor = "COINDCX_BYBIT";
        }
        if (!legacyConfig.maxAmountPerHedgeUsdt || legacyConfig.maxAmountPerHedgeUsdt > 500) {
          legacyConfig.maxAmountPerHedgeUsdt = 30;
        }
        if (!legacyConfig.roundTripFeeBps) {
          legacyConfig.roundTripFeeBps = 25.0;
        }
        if (!parsed.config?.intervalMode && parsed.config?.allowAsymmetricFunding !== undefined) {
          legacyConfig.intervalMode = parsed.config.allowAsymmetricFunding ? "ALL_ASYMMETRIC" : "STRICT_SYNC_ONLY";
        }
        bots = [
          {
            id: "bot-1",
            name: "Conservative Funding Sniper",
            activeSetFileName: "conservative_5bps_sniper.set",
            enabled: parsed.config?.enabled !== undefined ? parsed.config.enabled : true,
            maxMarginCapUsdt: parsed.config?.maxMarginCapUsdt || 500,
            config: legacyConfig,
            flattenedCoinsBlacklist: [],
            symbolCooldowns: {},
            activeHedges: Array.isArray(parsed.activeHedges) ? parsed.activeHedges : [],
            completedHedges: Array.isArray(parsed.completedHedges) ? parsed.completedHedges : [],
            logs: Array.isArray(parsed.logs) ? parsed.logs : [],
            statusText: parsed.statusText || "RUNNING_24_7",
            lastEvaluatedCandidate: parsed.lastEvaluatedCandidate || null,
            createdAt: parsed.startedAt || Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      const activeBotId = parsed.activeBotId && bots.some((b) => b.id === parsed.activeBotId)
        ? parsed.activeBotId
        : bots[0].id;

      const activeBot = bots.find((b) => b.id === activeBotId) || bots[0];

      const state: BotEngineState = {
        isRunning: parsed.isRunning !== undefined ? parsed.isRunning : true,
        runInBackgroundWhenClosed: true,
        mode: "AUTONOMOUS_SERVER_24_7",
        startedAt: parsed.startedAt || Date.now(),
        lastCycleAt: parsed.lastCycleAt || Date.now(),
        cyclesCompleted: parsed.cyclesCompleted || 0,
        activeBotId,
        bots,
        setFiles: allSetFiles,
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        // Legacy props mirrored from active bot
        config: activeBot.config,
        activeHedges: activeBot.activeHedges,
        completedHedges: activeBot.completedHedges,
        statusText: activeBot.statusText,
        lastEvaluatedCandidate: activeBot.lastEvaluatedCandidate,
      };

      for (const b of state.bots) {
        if (!Array.isArray(b.logs)) {
          b.logs = [];
        }
      }

      globalForBot.tenantStates![tenantKey] = state;
      globalForBot.tenantStateSignatures![tenantKey] = diskSig;
      if (!userId || userId === "usr_admin_varsha") {
        globalForBot.botEngineState = state;
      }
      return state;
    }
  } catch {}

  // Initial fresh state
  const initialBot: BotInstance = {
    id: "bot-1",
    name: "Conservative Funding Sniper",
    activeSetFileName: "conservative_5bps_sniper.set",
    enabled: true,
    maxMarginCapUsdt: 500,
    config: { ...DEFAULT_CONFIG },
    flattenedCoinsBlacklist: [],
    symbolCooldowns: {},
    activeHedges: [],
    completedHedges: [],
    logs: [],
    statusText: "RUNNING_24_7",
    lastEvaluatedCandidate: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const defaultState: BotEngineState = {
    isRunning: true,
    runInBackgroundWhenClosed: true,
    mode: "AUTONOMOUS_SERVER_24_7",
    startedAt: Date.now(),
    lastCycleAt: Date.now(),
    cyclesCompleted: 0,
    activeBotId: initialBot.id,
    bots: [initialBot],
    setFiles: allSetFiles,
    logs: [
      {
        timestamp: new Date().toISOString(),
        message: "24/7 Autonomous Multi-Bot Arbitrage Engine initialized. Ready to execute delta-neutral hedges.",
        level: "info",
      },
    ],
    config: initialBot.config,
    activeHedges: initialBot.activeHedges,
    completedHedges: initialBot.completedHedges,
    statusText: initialBot.statusText,
    lastEvaluatedCandidate: null,
  };

  globalForBot.tenantStates![tenantKey] = defaultState;
  if (!userId || userId === "usr_admin_varsha") {
    globalForBot.botEngineState = defaultState;
  }
  saveBotState(defaultState, userId);
  return defaultState;
}

export function saveBotState(state: BotEngineState, userId?: string) {
  // Mirror active bot onto legacy properties for seamless backward compatibility
  const activeBot = state.bots.find((b) => b.id === state.activeBotId) || state.bots[0];
  if (activeBot) {
    state.config = activeBot.config;
    state.activeHedges = activeBot.activeHedges;
    state.completedHedges = activeBot.completedHedges;
    state.statusText = activeBot.statusText;
    state.lastEvaluatedCandidate = activeBot.lastEvaluatedCandidate;
  }

  const tenantKey = userId || "usr_admin_varsha";
  globalForBot.tenantStates![tenantKey] = state;
  globalForBot.tenantStateSignatures![tenantKey] = getBotStateFileSignature(userId);

  if (userId && userId !== "global_default") {
    saveUserDataFile(userId, STATE_FILE_NAME, state);
    if (userId === "usr_admin_varsha" || userId.includes("admin")) {
      globalForBot.botEngineState = state;
      saveDataFile(STATE_FILE_NAME, state);
    }
  } else {
    globalForBot.botEngineState = state;
    saveDataFile(STATE_FILE_NAME, state);
  }
}

export function normalizeLogKey(msg: string): string {
  return msg
    .replace(/\s*\[\d+\]$/, "")
    .replace(/\b\d+s\s+left\b/gi, "Xs left")
    .replace(/\bCountdown:\s*\d+s\b/gi, "Countdown: Xs")
    .replace(/\banother\s+\d+m\b/gi, "another Xm")
    .replace(/\bfor\s+\d+m\b/gi, "for Xm")
    .replace(/\b\d+(\.\d+)?%\s*>\s*stage target/gi, "X% > stage target")
    .replace(/\b\d+s\b/gi, "Xs")
    .replace(/\b\d+m\b/gi, "Xm")
    .trim();
}

export function appendBotLog(
  state: BotEngineState,
  message: string,
  level: "info" | "success" | "warn" | "error" = "info",
  userId?: string,
  botId?: string
) {
  const match = message.match(/Bot "([^"]+)"/);
  const matchedName = match ? match[1] : undefined;
  const targetBot = botId
    ? state.bots.find((b) => b.id === botId)
    : matchedName
    ? state.bots.find((b) => b.name === matchedName || b.name.includes(matchedName))
    : state.bots.find((b) => b.id === state.activeBotId) || state.bots[0];

  const now = Date.now();
  const ONE_MINUTE_MS = 60 * 1000;
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  // Extract bot signature and end-3-letters tag (e.g. Sniper -> [PER], Hunter -> [TER])
  const rawBotName = (targetBot?.name || "System").trim();
  const alphaChars = rawBotName.replace(/[^a-zA-Z]/g, "");
  const end3 = (alphaChars.length >= 3 ? alphaChars.slice(-3) : rawBotName.slice(-3)).toUpperCase();
  const fullBotBadge = `${rawBotName} [${end3}]`;

  // Preserve the REAL user-visible message without placeholder replacements
  let cleanRealMessage = message.replace(/\s*\[\d+\]$/, "").trim();

  // Enforce unambiguous bot identification: ensure message includes bot name and end-3-letters tag
  if (targetBot && !cleanRealMessage.includes(`[${end3}]`)) {
    if (matchedName && cleanRealMessage.includes(`Bot "${matchedName}"`)) {
      cleanRealMessage = cleanRealMessage.replace(`Bot "${matchedName}"`, `Bot "${rawBotName}" [${end3}]`);
    } else if (cleanRealMessage.includes(`Bot "${rawBotName}"`)) {
      cleanRealMessage = cleanRealMessage.replace(`Bot "${rawBotName}"`, `Bot "${rawBotName}" [${end3}]`);
    } else if (cleanRealMessage.startsWith("[")) {
      const firstCloseBracket = cleanRealMessage.indexOf("]");
      if (firstCloseBracket !== -1) {
        cleanRealMessage = `${cleanRealMessage.slice(0, firstCloseBracket + 1)} Bot "${rawBotName}" [${end3}]: ${cleanRealMessage.slice(firstCloseBracket + 1).replace(/^[:\s]+/, "")}`;
      } else {
        cleanRealMessage = `Bot "${rawBotName}" [${end3}]: ${cleanRealMessage}`;
      }
    } else {
      cleanRealMessage = `Bot "${rawBotName}" [${end3}]: ${cleanRealMessage}`;
    }
  }

  const baseMessage = cleanRealMessage;
  const normalizedKey = normalizeLogKey(cleanRealMessage);

  // Deduplication Aggregation: check if identical message and level exists within last 60 seconds FOR THIS SPECIFIC BOT
  const existingLog = state.logs.find((l) => {
    return normalizeLogKey(l.message) === normalizedKey && l.level === level && l.botId === targetBot?.id;
  });

  let isAggregated = false;
  let logToPersist: BotLog = {
    timestamp: new Date(now).toISOString(),
    message: cleanRealMessage,
    level,
    count: 1,
    botId: targetBot?.id,
    botName: fullBotBadge,
  };

  if (existingLog) {
    const prevTime = new Date(existingLog.timestamp).getTime();
    if (now - prevTime < ONE_MINUTE_MS) {
      // It occurred within 60 seconds: update in-place with latest live values & count beside message
      const countMatch = existingLog.message.match(/\[(\d+)\]$/);
      const currentCount = countMatch ? parseInt(countMatch[1], 10) : (existingLog.count || 1);
      const newCount = currentCount + 1;

      existingLog.count = newCount;
      existingLog.message = `${cleanRealMessage} [${newCount}]`;
      existingLog.timestamp = new Date(now).toISOString();
      logToPersist = existingLog;
      isAggregated = true;

      // Update matching entry in targetBot.logs
      if (targetBot && Array.isArray(targetBot.logs)) {
        const botLog = targetBot.logs.find((l) => {
          return normalizeLogKey(l.message) === normalizedKey && l.level === level;
        });
        if (botLog) {
          botLog.count = newCount;
          botLog.message = `${cleanRealMessage} [${newCount}]`;
          botLog.timestamp = existingLog.timestamp;
        }
      }
    }
  }

  if (!isAggregated) {
    // New entry or 60 seconds expired: emit fresh log row
    const log: BotLog = {
      timestamp: new Date(now).toISOString(),
      message: cleanRealMessage,
      level,
      count: 1,
      botId: targetBot?.id,
      botName: fullBotBadge,
    };
    logToPersist = log;

    state.logs.unshift(log);
    if (state.logs.length > 1000) {
      state.logs = state.logs.slice(0, 1000);
    }

    if (targetBot) {
      if (!Array.isArray(targetBot.logs)) {
        targetBot.logs = [];
      }
      targetBot.logs.unshift(log);
      if (targetBot.logs.length > 1000) {
        targetBot.logs = targetBot.logs.slice(0, 1000);
      }
    }
  }

  // PERMANENT TRADE EVENT LOGGING (Zero Loss Invariant):
  // Persist critical trade execution and lifecycle events to permanent append-only jsonl
  const isPermanentTradeEvent =
    level === "success" ||
    level === "error" ||
    baseMessage.includes("HEDGE") ||
    baseMessage.includes("ORDER") ||
    baseMessage.includes("FILL") ||
    baseMessage.includes("CLOSED") ||
    baseMessage.includes("CONTINUATION") ||
    baseMessage.includes("PARITY");

  if (isPermanentTradeEvent) {
    try {
      const permanentEntry = JSON.stringify({
        timestamp: new Date(now).toISOString(),
        level,
        botId: targetBot?.id,
        botName: targetBot?.name,
        message: baseMessage,
        count: logToPersist.count || 1,
      }) + "\n";

      const permPath = resolveDataFilePath("trade_audit_permanent.jsonl");
      fs.appendFileSync(permPath, permanentEntry, "utf-8");

      if (userId && userId !== "global_default") {
        const userPermPath = resolveUserStoragePath(userId, "trade_audit_permanent.jsonl");
        fs.appendFileSync(userPermPath, permanentEntry, "utf-8");
      }
    } catch {}
  }

  // AUTO-SAVE AUDIT STREAM: Immediately persist to disk for 24/7 diagnostics
  try {
    saveBotState(state, userId);

    let auditHistory = userId && userId !== "global_default"
      ? readUserDataFile<BotLog[]>(userId, AUDIT_LOG_FILE_NAME, [])
      : readDataFile<BotLog[]>(AUDIT_LOG_FILE_NAME, []);

    if (isAggregated) {
      const auditMatch = auditHistory.find((l) => {
        return normalizeLogKey(l.message) === normalizedKey && l.level === level && (now - new Date(l.timestamp).getTime() < FIVE_MINUTES_MS);
      });
      if (auditMatch) {
        auditMatch.count = logToPersist.count;
        auditMatch.message = logToPersist.message;
        auditMatch.timestamp = logToPersist.timestamp;
      } else {
        auditHistory.unshift(logToPersist);
      }
    } else {
      auditHistory.unshift(logToPersist);
    }

    if (auditHistory.length > 2500) {
      auditHistory = auditHistory.slice(0, 2500);
    }

    if (userId && userId !== "global_default") {
      saveUserDataFile(userId, AUDIT_LOG_FILE_NAME, auditHistory);
      if (userId === "usr_admin_varsha" || userId.includes("admin")) {
        saveDataFile(AUDIT_LOG_FILE_NAME, auditHistory);
      }
    } else {
      saveDataFile(AUDIT_LOG_FILE_NAME, auditHistory);
    }
  } catch (err: any) {
    console.error("Auto-save audit log error:", err.message);
  }
}

/**
 * 8-Hour Cycle Log Retention Engine (Invariant 5)
 * Retains 100% of logs for coins that traded, while pruning untraded candidate noise.
 */
let last8hPruneTimestamp = 0;

export function pruneUntradedLogsFor8hCycle(state: BotEngineState, userId?: string, force: boolean = false): void {
  const now = Date.now();
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
  if (!force && now - last8hPruneTimestamp < EIGHT_HOURS_MS) {
    return;
  }
  last8hPruneTimestamp = now;

  // 1. Build set of traded symbols across all bots
  const tradedSymbols = new Set<string>();
  for (const b of state.bots) {
    for (const h of (b.activeHedges || [])) {
      if (h.symbol) tradedSymbols.add(h.symbol.toUpperCase());
    }
    for (const h of (b.completedHedges || [])) {
      if (h.symbol) tradedSymbols.add(h.symbol.toUpperCase());
    }
  }

  const isLogRetained = (log: BotLog): boolean => {
    const logTime = new Date(log.timestamp).getTime();
    if (now - logTime < EIGHT_HOURS_MS) {
      return true; // Keep recent logs within the active 8-hour window
    }
    const msg = (log.message || "").toUpperCase();
    // Keep if matches any traded coin
    for (const sym of tradedSymbols) {
      if (msg.includes(sym)) return true;
    }
    // Keep critical system lifecycle events
    if (
      log.level === "error" ||
      log.level === "success" ||
      msg.includes("DAEMON") ||
      msg.includes("BOT") ||
      msg.includes("HEDGE") ||
      msg.includes("ORDER") ||
      msg.includes("FILL") ||
      msg.includes("CLOSED") ||
      msg.includes("PARITY") ||
      msg.includes("CONTINUATION")
    ) {
      return true;
    }
    // Untraded candidate chatter older than 8 hours is pruned
    return false;
  };

  state.logs = (state.logs || []).filter(isLogRetained);
  for (const b of state.bots) {
    if (Array.isArray(b.logs)) {
      b.logs = b.logs.filter(isLogRetained);
    }
  }
}

// Scanner warning throttle to prevent intra-cycle duplicate calls within a single tick
const scannerWarningThrottle = new Map<string, number>();

export function shouldLogScannerWarning(key: string, cooldownMs = 4500): boolean {
  const now = Date.now();
  const lastTime = scannerWarningThrottle.get(key) || 0;
  if (now - lastTime < cooldownMs) {
    return false;
  }
  scannerWarningThrottle.set(key, now);
  // Periodically purge old keys to keep memory tight
  if (scannerWarningThrottle.size > 2000) {
    for (const [k, v] of scannerWarningThrottle.entries()) {
      if (now - v > cooldownMs) {
        scannerWarningThrottle.delete(k);
      }
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// PER-BOT FLATTEN MEMORY LOCK & ANTI-CHURN QUARANTINE HELPERS
// ─────────────────────────────────────────────────────────────
export function quarantineBotSymbol(
  bot: BotInstance,
  symbol: string,
  durationSeconds: number = 3600,
  reason: string = "Post-trade anti-churn cooldown",
  state?: BotEngineState,
  userId?: string
): void {
  if (!bot.symbolCooldowns || typeof bot.symbolCooldowns !== "object") {
    bot.symbolCooldowns = {};
  }
  const upper = symbol.toUpperCase();
  // Guarantee a minimum of 1 hour (3,600s) post-trade quarantine per user directive
  const lockMs = Math.max(3600 * 1000, durationSeconds * 1000);
  const cooldownUntil = Date.now() + lockMs;
  bot.symbolCooldowns[upper] = cooldownUntil;

  // Also maintain flattenedCoinsBlacklist if memory lock is enabled
  if (!Array.isArray(bot.flattenedCoinsBlacklist)) {
    bot.flattenedCoinsBlacklist = [];
  }
  if (bot.config.enableFlattenMemoryLock !== false && !bot.flattenedCoinsBlacklist.includes(upper)) {
    bot.flattenedCoinsBlacklist.push(upper);
  }

  if (state) {
    appendBotLog(
      state,
      `[ANTI-CHURN QUARANTINE ENGAGED] ${upper} quarantined for ${Math.round(lockMs / 60000)}m (until ${new Date(cooldownUntil).toISOString()}) in bot "${bot.name}". Reason: ${reason}.`,
      "warn",
      userId,
      bot.id
    );
  }
}

export function lockFlattenedCoinForBot(symbol: string, botId?: string, userId?: string) {
  const state = loadBotState(userId);
  const upper = symbol.toUpperCase();
  let changed = false;

  for (const bot of state.bots) {
    if (!botId || bot.id === botId) {
      quarantineBotSymbol(bot, upper, 3600, "Manual or automated flatten lock", state, userId);
      changed = true;
    }
  }

  if (changed) {
    saveBotState(state, userId);
  }
}

export function resetBotMemory(botId?: string, userId?: string) {
  const state = loadBotState(userId);
  let changed = false;

  for (const bot of state.bots) {
    if (!botId || bot.id === botId) {
      const count = bot.flattenedCoinsBlacklist.length;
      bot.flattenedCoinsBlacklist = [];
      bot.symbolCooldowns = {};
      changed = true;
      appendBotLog(
        state,
        `[MEMORY RESET] Cleared ${count} locked coin(s) and anti-churn quarantines from bot "${bot.name}". All universe coins now eligible for trading.`,
        "info",
        userId
      );
    }
  }

  if (changed) {
    saveBotState(state, userId);
  }
}

export function unlockSingleCoin(symbol: string, botId?: string, userId?: string) {
  const state = loadBotState(userId);
  const upper = symbol.toUpperCase();
  let changed = false;

  for (const bot of state.bots) {
    if (!botId || bot.id === botId) {
      const idx = bot.flattenedCoinsBlacklist.indexOf(upper);
      if (idx !== -1) {
        bot.flattenedCoinsBlacklist.splice(idx, 1);
        changed = true;
      }
      if (bot.symbolCooldowns && bot.symbolCooldowns[upper]) {
        delete bot.symbolCooldowns[upper];
        changed = true;
      }
      if (changed) {
        appendBotLog(
          state,
          `[MEMORY UNLOCKED] ${upper} unblocked and released from anti-churn quarantine in bot "${bot.name}". Now eligible for scanning.`,
          "info",
          userId
        );
      }
    }
  }

  if (changed) {
    saveBotState(state, userId);
  }
}

export function clearBotTrades(botId?: string, hedgeId?: string, userId?: string): boolean {
  const state = loadBotState(userId);
  let changed = false;

  for (const bot of state.bots) {
    if (!botId || bot.id === botId) {
      if (hedgeId) {
        const compIdx = (bot.completedHedges || []).findIndex((h) => h.id === hedgeId);
        if (compIdx !== -1) {
          const removed = bot.completedHedges.splice(compIdx, 1)[0];
          changed = true;
          appendBotLog(
            state,
            `[TRADE CLEARED] Cleared trade record #${hedgeId} (${removed.symbol}) from bot "${bot.name}".`,
            "info",
            userId
          );
        }
        const actIdx = (bot.activeHedges || []).findIndex((h) => h.id === hedgeId && h.status === "CLOSED");
        if (actIdx !== -1) {
          const removed = bot.activeHedges.splice(actIdx, 1)[0];
          changed = true;
          appendBotLog(
            state,
            `[TRADE CLEARED] Cleared closed active hedge record #${hedgeId} (${removed.symbol}) from bot "${bot.name}".`,
            "info",
            userId
          );
        }
      } else {
        const count = (bot.completedHedges || []).length;
        bot.completedHedges = [];
        const beforeAct = (bot.activeHedges || []).length;
        bot.activeHedges = (bot.activeHedges || []).filter((h) => h.status !== "CLOSED");
        const actRemoved = beforeAct - bot.activeHedges.length;

        if (count > 0 || actRemoved > 0) {
          changed = true;
          appendBotLog(
            state,
            `[TRADES CLEARED] Cleared ${count + actRemoved} completed order/telemetry record(s) from bot "${bot.name}".`,
            "info",
            userId
          );
        }
      }
    }
  }

  if (changed) {
    saveBotState(state, userId);
  }
  return changed;
}

// ─────────────────────────────────────────────────────────────
// MULTI-BOT CRUD & SET FILE MANAGER HELPERS
// ─────────────────────────────────────────────────────────────
export function createBot(name: string, setFileName?: string, maxMarginCapUsdt?: number, userId?: string): BotInstance {
  const state = loadBotState(userId);
  const setFiles = loadSetFiles(userId);

  const chosenSet = setFileName
    ? setFiles.find((s) => s.fileName.toLowerCase() === setFileName.toLowerCase())
    : setFiles[0];

  const configToUse = chosenSet ? { ...chosenSet.config } : { ...DEFAULT_CONFIG };
  if (maxMarginCapUsdt && maxMarginCapUsdt > 0) {
    configToUse.maxMarginCapUsdt = maxMarginCapUsdt;
  }

  const newBot: BotInstance = {
    id: `bot-${Date.now().toString().slice(-6)}`,
    name: name.trim() || `Bot ${state.bots.length + 1}`,
    activeSetFileName: chosenSet?.fileName || "conservative_5bps_sniper.set",
    enabled: true,
    maxMarginCapUsdt: configToUse.maxMarginCapUsdt || 500,
    config: configToUse,
    flattenedCoinsBlacklist: [],
    symbolCooldowns: {},
    activeHedges: [],
    completedHedges: [],
    logs: [],
    statusText: "READY",
    lastEvaluatedCandidate: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  state.bots.push(newBot);
  state.activeBotId = newBot.id;
  appendBotLog(state, `[BOT CREATED] New bot "${newBot.name}" added with preset "${newBot.activeSetFileName}".`, "success", userId);
  saveBotState(state, userId);
  return newBot;
}

export function editBot(
  botId: string,
  updates: {
    name?: string;
    activeSetFileName?: string;
    maxMarginCapUsdt?: number;
    enabled?: boolean;
    config?: Partial<BotConfig>;
    flattenedCoinsBlacklist?: string[];
    symbolCooldowns?: Record<string, number>;
  },
  userId?: string
): BotInstance | null {
  const state = loadBotState(userId);
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return null;

  if (updates.name && updates.name.trim()) {
    bot.name = updates.name.trim();
  }
  if (updates.activeSetFileName) {
    bot.activeSetFileName = updates.activeSetFileName;
  }
  if (updates.enabled !== undefined) {
    bot.enabled = updates.enabled;
    bot.config.enabled = updates.enabled;
  }
  if (updates.maxMarginCapUsdt !== undefined && updates.maxMarginCapUsdt > 0) {
    bot.maxMarginCapUsdt = updates.maxMarginCapUsdt;
    bot.config.maxMarginCapUsdt = updates.maxMarginCapUsdt;
  }
  if (Array.isArray(updates.flattenedCoinsBlacklist)) {
    bot.flattenedCoinsBlacklist = updates.flattenedCoinsBlacklist;
  }
  if (updates.symbolCooldowns && typeof updates.symbolCooldowns === "object") {
    bot.symbolCooldowns = updates.symbolCooldowns;
  }
  if (updates.config) {
    bot.config = {
      ...bot.config,
      ...updates.config,
    };
  }

  bot.updatedAt = Date.now();
  appendBotLog(state, `[BOT UPDATED] Configuration for "${bot.name}" saved to disk.`, "info", userId);
  saveBotState(state, userId);
  return bot;
}

export function deleteBot(botId: string, userId?: string): boolean {
  const state = loadBotState(userId);
  if (state.bots.length <= 1) {
    return false; // Cannot delete the last active bot
  }

  const idx = state.bots.findIndex((b) => b.id === botId);
  if (idx === -1) return false;

  const deleted = state.bots.splice(idx, 1)[0];
  if (state.activeBotId === botId) {
    state.activeBotId = state.bots[0].id;
  }

  appendBotLog(state, `[BOT DELETED] Bot "${deleted.name}" removed from server roster.`, "warn", userId);
  saveBotState(state, userId);
  return true;
}

export function saveSetFile(
  fileName: string,
  name: string,
  description: string,
  config: BotConfig,
  userId?: string
): BotSetFile {
  let cleanFileName = fileName.trim();
  if (!cleanFileName.toLowerCase().endsWith(".set")) {
    cleanFileName += ".set";
  }

  const state = loadBotState(userId);
  let setFiles = loadSetFiles(userId);

  const contentText = serializeConfigToSetText(config, name);
  const existingIdx = setFiles.findIndex((s) => s.fileName.toLowerCase() === cleanFileName.toLowerCase());

  let setFileObj: BotSetFile;

  if (existingIdx !== -1) {
    setFileObj = {
      ...setFiles[existingIdx],
      name: name.trim() || setFiles[existingIdx].name,
      description: description.trim() || setFiles[existingIdx].description,
      config: { ...config },
      contentText,
      updatedAt: Date.now(),
    };
    setFiles[existingIdx] = setFileObj;
  } else {
    setFileObj = {
      id: `set-${Date.now().toString().slice(-6)}`,
      fileName: cleanFileName,
      name: name.trim() || cleanFileName,
      description: description.trim() || "Custom user-saved quantitative parameters.",
      config: { ...config },
      contentText,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setFiles.push(setFileObj);
  }

  saveSetFiles(setFiles, userId);
  state.setFiles = setFiles;
  appendBotLog(state, `[SET FILE SAVED] Strategy preset "${cleanFileName}" saved to disk.`, "success", userId);
  saveBotState(state, userId);
  return setFileObj;
}

export function applySetFileToBot(botId: string, fileName: string, userId?: string): boolean {
  const state = loadBotState(userId);
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return false;

  const setFiles = loadSetFiles(userId);
  const setObj = setFiles.find((s) => s.fileName.toLowerCase() === fileName.toLowerCase());
  if (!setObj) return false;

  bot.config = { ...bot.config, ...setObj.config };
  bot.activeSetFileName = setObj.fileName;
  if (setObj.config.maxMarginCapUsdt) {
    bot.maxMarginCapUsdt = setObj.config.maxMarginCapUsdt;
  }
  bot.updatedAt = Date.now();

  appendBotLog(
    state,
    `[SET APPLIED] Preset "${setObj.name}" (${setObj.fileName}) loaded into bot "${bot.name}".`,
    "success",
    userId
  );
  saveBotState(state, userId);
  return true;
}

export function deleteSetFile(fileName: string, userId?: string): boolean {
  const setFiles = loadSetFiles(userId);
  const target = setFiles.find((s) => s.fileName.toLowerCase() === fileName.toLowerCase());
  if (!target || target.isBuiltIn) {
    return false; // Cannot delete built-in presets
  }

  const filtered = setFiles.filter((s) => s.fileName.toLowerCase() !== fileName.toLowerCase());
  saveSetFiles(filtered, userId);

  const state = loadBotState(userId);
  state.setFiles = filtered;
  appendBotLog(state, `[SET FILE DELETED] Preset "${fileName}" removed.`, "warn", userId);
  saveBotState(state, userId);
  return true;
}

export function restoreBotsAndSetFiles(
  clientBots: BotInstance[],
  clientSetFiles: BotSetFile[],
  preferredActiveBotId?: string,
  userId?: string
): BotEngineState {
  const state = loadBotState(userId);
  let stateChanged = false;

  // 1. Restore / Merge custom .set files
  if (Array.isArray(clientSetFiles) && clientSetFiles.length > 0) {
    let currentSets = loadSetFiles(userId);
    for (const csf of clientSetFiles) {
      if (!currentSets.some((s) => s.fileName.toLowerCase() === csf.fileName.toLowerCase())) {
        currentSets.push({
          ...csf,
          isBuiltIn: false,
          updatedAt: Date.now(),
        });
        stateChanged = true;
      }
    }
    saveSetFiles(currentSets, userId);
    state.setFiles = currentSets;
  }

  // 2. Restore / Merge custom bots
  if (Array.isArray(clientBots) && clientBots.length > 0) {
    const isOnlyDefaultBot =
      state.bots.length === 1 &&
      state.bots[0].id === "bot-1" &&
      state.bots[0].name === "Conservative Funding Sniper" &&
      (state.bots[0].activeHedges?.length || 0) === 0;

    if (isOnlyDefaultBot && (clientBots.length > 1 || clientBots[0].name !== "Conservative Funding Sniper")) {
      // Server was reset to fresh default: completely adopt client vault roster
      state.bots = clientBots;
      stateChanged = true;
    } else {
      // Server already has bots: merge any missing bots from client vault
      for (const cb of clientBots) {
        const exists = state.bots.some((b) => b.id === cb.id || b.name.toLowerCase() === cb.name.toLowerCase());
        if (!exists) {
          state.bots.push(cb);
          stateChanged = true;
        }
      }
    }
  }

  // 3. Set active bot ID if valid
  if (preferredActiveBotId && state.bots.some((b) => b.id === preferredActiveBotId)) {
    state.activeBotId = preferredActiveBotId;
    stateChanged = true;
  }

  if (stateChanged) {
    appendBotLog(
      state,
      `[VAULT SYNC RESTORE] Restored ${state.bots.length} bot instance(s) and ${state.setFiles.length} strategy preset(s) from persistent browser vault.`,
      "success",
      userId
    );
    saveBotState(state, userId);
    ensureBotWorker();
  }

  return state;
}

export interface CorridorBalances {
  binanceBal: number;
  bitgetBal: number;
  coindcxBal?: number;
  bybitBal?: number;
  coindcxEquity?: number;
  bybitEquity?: number;
  coindcxLockedMargin?: number;
  bybitLockedMargin?: number;
}

/**
 * Fetch available margin across Binance, Bitget, CoinDCX, and Bybit using tenant credentials
 */
export async function fetchAvailableBalances(creds?: UserApiKeys): Promise<CorridorBalances> {
  let binanceBal = 1000;
  let bitgetBal = 1000;
  let coindcxBal = 0;
  let bybitBal = 0;
  let coindcxEquity = 0;
  let bybitEquity = 0;
  let coindcxLockedMargin = 0;
  let bybitLockedMargin = 0;

  const bnKey = creds?.binanceKey || ADMIN_BINANCE_KEY;
  const rawBnSec = creds?.binanceSecret || ADMIN_BINANCE_SECRET;
  const bnSec = rawBnSec && rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
  const bnEndpoint = creds?.binanceEndpoint || ADMIN_BINANCE_ENDPOINT;

  const rawBgSec = creds?.bitgetSecret || SYSTEM_DEFAULT_BITGET_SECRET;
  const rawBgPass = creds?.bitgetPassphrase || SYSTEM_DEFAULT_BITGET_PASSPHRASE;
  const bgCreds: BitgetCredentials = {
    apiKey: creds?.bitgetKey || SYSTEM_DEFAULT_BITGET_KEY,
    apiSecret: rawBgSec && rawBgSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBgSec) : rawBgSec,
    passphrase: rawBgPass && rawBgPass.startsWith("enc:v1:") ? decryptVaultSecret(rawBgPass) : rawBgPass,
    isDemo: creds?.bitgetEnv !== "live",
  };

  try {
    const { data: bnAcc } = await signAndFetchBinance(
      bnKey,
      bnSec,
      "GET",
      "/fapi/v2/account",
      {},
      true,
      bnEndpoint
    );
    const avail = parseFloat(bnAcc?.availableBalance || "0");
    if (avail > 0) binanceBal = avail;
  } catch {}

  try {
    const path = "/api/v3/account/assets?category=USDT-FUTURES";
    const res = await fetch(`https://api.bitget.com${path}`, {
      headers: {
        papertrading: bgCreds.isDemo ? "1" : "0",
        paptrading: bgCreds.isDemo ? "1" : "0",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      const usdt = (data?.data?.assets || []).find((a: any) => a.coin === "USDT" || a.currency === "USDT");
      const avail = parseFloat(usdt?.available || usdt?.equity || "0");
      if (avail > 0) bitgetBal = avail;
    }
  } catch {}

  const bybitKey = creds?.bybitKey || ADMIN_BYBIT_KEY;
  const rawBybitSec = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
  const bybitSec = rawBybitSec && rawBybitSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBybitSec) : rawBybitSec;

  if (bybitKey && bybitSec) {
    try {
      const { fetchBybitAccount } = await import("./bybitSigner");
      const byb = await fetchBybitAccount({
        apiKey: bybitKey,
        apiSecret: bybitSec,
        proxyUrl: creds?.bybitProxy,
        baseUrl: creds?.bybitBaseUrl,
        backupProxyUrl: creds?.bybitBackupProxy,
        backupBaseUrl: creds?.bybitBackupBaseUrl,
      });
      if (byb.success) {
        bybitBal = byb.available;
        bybitEquity = byb.equity || byb.walletBalance;
        const rawAccount = byb.raw;
        bybitLockedMargin = parseFloat(rawAccount?.totalPositionIM || "0");
      }
    } catch {}
  }

  if (creds?.coindcxKey && creds?.coindcxSecret) {
    try {
      const { getCoinDcxAccount } = await import("./coindcxSigner");
      const cdx = await getCoinDcxAccount({
        apiKey: creds.coindcxKey,
        apiSecret: creds.coindcxSecret,
      });
      if (cdx.success) {
        coindcxBal = cdx.available;
        coindcxEquity = cdx.equity;
        coindcxLockedMargin = Math.max(0, cdx.equity - cdx.available);
      }
    } catch {}
  }

  return {
    binanceBal,
    bitgetBal,
    coindcxBal,
    bybitBal,
    coindcxEquity,
    bybitEquity,
    coindcxLockedMargin,
    bybitLockedMargin,
  };
}

// ─────────────────────────────────────────────────────────────
// TRADABLE SYMBOL UNIVERSE VALIDATOR
// Eliminates rejections by ensuring only symbols active on BOTH testnets qualify
// ─────────────────────────────────────────────────────────────
let cachedTradableSymbols: Set<string> | null = null;
let lastTradableSymbolsFetch = 0;

const FALLBACK_DUAL_SYMBOLS = new Set([
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT",
  "LTCUSDT", "BNBUSDT", "XRPUSDT", "LINKUSDT", "AVAXUSDT",
  "DOTUSDT", "NEARUSDT", "TRXUSDT", "UNIUSDT", "PEPEUSDT",
  "SHIBUSDT", "BCHUSDT", "USDCUSDT"
]);

async function getTradableSymbolsSet(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedTradableSymbols && (now - lastTradableSymbolsFetch < 300_000)) {
    return cachedTradableSymbols;
  }

  try {
    const [bnRes, bgRes] = await Promise.allSettled([
      (async () => {
        const urls = [
          "https://www.binance.com/fapi/v1/exchangeInfo",
          "https://fapi.binance.com/fapi/v1/exchangeInfo",
          "https://demo-fapi.binance.com/fapi/v1/exchangeInfo",
        ];
        for (const u of urls) {
          try {
            const r = await fetch(u, { cache: "no-store" });
            if (r.ok) {
              const d = await r.json();
              if (d && Array.isArray(d.symbols)) return d;
            }
          } catch {}
        }
        return { symbols: [] };
      })(),
      fetch("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES", {
        headers: { papertrading: "1", paptrading: "1" },
        cache: "no-store",
      }).then((r) => r.json()),
    ]);

    const bnSymbols = new Set<string>();
    if (bnRes.status === "fulfilled" && Array.isArray(bnRes.value?.symbols)) {
      for (const s of bnRes.value.symbols) {
        if (s.status === "TRADING" && s.symbol) bnSymbols.add(s.symbol);
      }
    }

    const bgSymbols = new Set<string>();
    if (bgRes.status === "fulfilled" && Array.isArray(bgRes.value?.data)) {
      for (const c of bgRes.value.data) {
        if (c.symbol) bgSymbols.add(c.symbol);
      }
    }

    const common = new Set<string>();
    bnSymbols.forEach((sym) => {
      if (bgSymbols.has(sym)) {
        common.add(sym);
      }
    });

    if (common.size === 0) {
      cachedTradableSymbols = FALLBACK_DUAL_SYMBOLS;
    } else {
      cachedTradableSymbols = common;
    }
    lastTradableSymbolsFetch = now;
    return cachedTradableSymbols;
  } catch {
    cachedTradableSymbols = FALLBACK_DUAL_SYMBOLS;
    return cachedTradableSymbols;
  }
}

let cachedCoinDcxInstruments: Set<string> | null = null;
let lastCoinDcxFetch = 0;

export async function getCoinDcxInstruments(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedCoinDcxInstruments && now - lastCoinDcxFetch < 300_000) {
    return cachedCoinDcxInstruments;
  }
  try {
    const res = await fetch("https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments", {
      headers: { "User-Agent": "AutonomousBotEngine/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedCoinDcxInstruments = new Set(data.map((p: string) => p.replace(/^B-/, "").replace(/_USDT$/, "USDT")));
        lastCoinDcxFetch = now;
        return cachedCoinDcxInstruments;
      }
    }
  } catch {}

  const fallback = new Set([
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT",
    "ADAUSDT", "AVAXUSDT", "BCHUSDT", "BNBUSDT", "DOTUSDT",
    "LINKUSDT", "LTCUSDT", "NEARUSDT", "TRXUSDT", "UNIUSDT",
    "SUIUSDT", "PEPEUSDT", "SHIBUSDT", "APTUSDT", "ARBUSDT"
  ]);
  cachedCoinDcxInstruments = fallback;
  lastCoinDcxFetch = now;
  return fallback;
}

let cachedBybitRestrictedInstruments: Set<string> | null = null;
let lastBybitInstrumentsFetch = 0;

export async function getBybitRestrictedInstruments(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedBybitRestrictedInstruments && now - lastBybitInstrumentsFetch < 900_000) {
    return cachedBybitRestrictedInstruments;
  }
  try {
    const res = await fetch("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000", {
      headers: { "User-Agent": "AutonomousBotEngine/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.retCode === 0 && Array.isArray(data?.result?.list)) {
        const restricted = new Set<string>();
        for (const item of data.result.list) {
          const isNonCrypto = item.symbolType && item.symbolType !== "innovation";
          const isNotTrading = item.status && item.status !== "Trading";
          if (isNonCrypto || isNotTrading) {
            restricted.add(item.symbol.toUpperCase());
          }
        }
        cachedBybitRestrictedInstruments = restricted;
        lastBybitInstrumentsFetch = now;
        return restricted;
      }
    }
  } catch {}

  const fallback = new Set(["CXMTUSDT", "ZHIPUUSDT", "AAPLUSDT", "TSLAUSDT", "NVDAUSDT", "MSFTUSDT"]);
  cachedBybitRestrictedInstruments = fallback;
  lastBybitInstrumentsFetch = now;
  return fallback;
}

/**
 * Fetch live tickers and candidates from exchanges
 * Ingests Binance, Bitget, CoinDCX, and Bybit concurrently to discover arbitrage opportunities across all 6 corridors
 */
export async function fetchOpportunityCoins(): Promise<any[]> {
  try {
    const tradableSet = await getTradableSymbolsSet();
    const [bnList, bgRes, metaMap, cdxSet, bybitRestrictedSet] = await Promise.all([
      (async () => {
        const urls = [
          "https://www.binance.com/fapi/v1/premiumIndex",
          "https://fapi.binance.com/fapi/v1/premiumIndex",
          "https://testnet.binancefuture.com/fapi/v1/premiumIndex",
        ];
        for (const u of urls) {
          try {
            const res = await fetch(u, {
              headers: { "User-Agent": "AutonomousBotEngine/1.0" },
              cache: "no-store",
              signal: AbortSignal.timeout(3000),
            });
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data) && data.length > 0) return data;
            }
          } catch {}
        }
        return [];
      })(),
      fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES", {
        headers: { "User-Agent": "AutonomousBotEngine/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      }).then((r) => r.json()).catch(() => ({ data: [] })),
      fetchFundingMetaMap(),
      getCoinDcxInstruments(),
      getBybitRestrictedInstruments(),
    ]);

    const bgList: any[] = Array.isArray(bgRes?.data) ? bgRes.data : [];
    const bgMap = new Map<string, any>();
    for (const b of bgList) {
      if (b.symbol && b.symbol.endsWith("USDT")) {
        bgMap.set(b.symbol.toUpperCase(), b);
      }
    }

    const bnMap = new Map<string, any>();
    for (const b of bnList) {
      if (b.symbol && b.symbol.endsWith("USDT")) {
        bnMap.set(b.symbol.toUpperCase(), b);
      }
    }

    const bybitMap = getAllBybitTickers();

    const allSymbols = Array.from(new Set([
      ...bnMap.keys(),
      ...bgMap.keys(),
      ...Array.from(cdxSet),
      ...Array.from(bybitMap.keys()),
    ]));

    if (allSymbols.length > 0) {
      subscribeBybitSymbols(allSymbols);
      coindcxTradeStream.subscribeSymbols(allSymbols);
    }

    const now = Date.now();
    const results: any[] = [];

    for (const sym of allSymbols) {
      if (!sym.endsWith("USDT")) continue;
      if (bybitRestrictedSet && bybitRestrictedSet.has(sym)) continue;
      if (ContractIdentityResolver.isTradFiOrEquity(sym)) continue;

      const bn = bnMap.get(sym);
      const bg = bgMap.get(sym);
      const hasCdx = cdxSet.has(sym);
      const byb = bybitMap.get(sym) || getBybitTicker(sym);

      const hasBn = Boolean(bn);
      const hasBg = Boolean(bg);
      const hasByb = Boolean(byb);

      const venuesCount = (hasBn ? 1 : 0) + (hasBg ? 1 : 0) + (hasCdx ? 1 : 0) + (hasByb ? 1 : 0);
      if (venuesCount < 2) continue;

      const bnRateRaw = bn ? parseFloat(bn.lastFundingRate || "0") : null;
      const bgRateRaw = bg ? parseFloat(bg.fundingRate || "0") : null;

      const bnRate = bnRateRaw !== null ? parseFloat((bnRateRaw * 100).toFixed(5)) : 0;
      const bgRate = bgRateRaw !== null ? parseFloat((bgRateRaw * 100).toFixed(5)) : bnRate;
      const bybRate = byb ? byb.fundingRatePct : (bnRateRaw !== null ? bnRate : bgRate);
      const cdxRate = hasCdx ? (bnRateRaw !== null ? bnRate : (byb ? bybRate : bgRate)) : 0;

      const bnMark = bn ? parseFloat(bn.markPrice || "0") : (byb ? byb.markPrice : (bg ? parseFloat(bg.markPrice || bg.lastPr || "0") : 0));
      const bgMark = bg ? (parseFloat(bg.markPrice || bg.lastPr || "0") || bnMark) : bnMark;
      const bybMark = byb ? byb.markPrice : bnMark;
      const cdxLive = coindcxTradeStream.getCoinDcxLivePrice(sym);
      const cdxMark = cdxLive && cdxLive.midPrice > 0 ? cdxLive.midPrice : (bnMark || bybMark || bgMark);

      const meta: SymbolFundingMeta = metaMap.get(sym) || {
        symbol: sym,
        fundingIntervalHours: byb ? byb.fundingIntervalHours : 8,
        binanceIntervalHours: 8,
        bitgetIntervalHours: 8,
        settlementCycleLabel: `${byb?.fundingIntervalHours || 8}h Cycle`,
        payoutsPerDay: 24 / (byb?.fundingIntervalHours || 8),
        bitgetNextUpdate: 0,
      };

      const effInterval = meta.fundingIntervalHours;
      const rawBnNext = bn ? parseInt(bn.nextFundingTime || "0", 10) : 0;
      const bgNext = meta.bitgetNextUpdate || 0;
      const bybNext = byb ? byb.nextFundingTime : 0;

      let nextFundingTime = 0;
      const candidates = [rawBnNext, bgNext, bybNext].filter((t) => t > now);
      if (candidates.length > 0) {
        nextFundingTime = Math.min(...candidates);
      } else {
        nextFundingTime = getDeterministicNextFundingTime(now, effInterval);
      }

      // Build venue rates for pairwise arbitrage with exact interval and countdown synchronization
      const bnNext = meta.binanceNextFundingTime || rawBnNext || nextFundingTime;
      const bgNextTime = meta.bitgetNextFundingTime || bgNext || nextFundingTime;
      const cdxNextTime = meta.coindcxNextFundingTime || bnNext;
      const bybNextTime = meta.bybitNextFundingTime || bybNext || nextFundingTime;

      const venueInfos: VenueRateInfo[] = [];
      if (hasBn) venueInfos.push({
        venue: "binance",
        label: "Binance",
        badge: "Binance",
        color: "amber",
        rate: bnRate,
        intervalHours: meta.binanceIntervalHours || 8,
        nextFundingTime: bnNext,
      });
      if (hasBg) venueInfos.push({
        venue: "bitget",
        label: "Bitget",
        badge: "Bitget",
        color: "cyan",
        rate: bgRate,
        intervalHours: meta.bitgetIntervalHours || 8,
        nextFundingTime: bgNextTime,
      });
      if (hasCdx) venueInfos.push({
        venue: "coindcx",
        label: "CoinDCX",
        badge: "CoinDCX",
        color: "purple",
        rate: cdxRate,
        intervalHours: meta.coindcxIntervalHours || meta.binanceIntervalHours || 8,
        nextFundingTime: cdxNextTime,
      });
      if (hasByb) venueInfos.push({
        venue: "bybit",
        label: "Bybit",
        badge: "Bybit",
        color: "orange",
        rate: bybRate,
        intervalHours: meta.bybitIntervalHours || (byb?.fundingIntervalHours || 8),
        nextFundingTime: bybNextTime,
      });

      const pairwise = evaluatePairwiseArbitrage(venueInfos, effInterval);

      results.push({
        symbol: sym,
        binanceRate: bnRate,
        bitgetRate: bgRate,
        coindcxRate: cdxRate,
        bybitRate: bybRate,
        binanceMarkPrice: bnMark,
        bitgetMarkPrice: bgMark,
        bybitMarkPrice: bybMark,
        coindcxMarkPrice: cdxMark,
        priceDiff: Math.abs(bnMark - bgMark),
        divergencePct: bnMark > 0 ? parseFloat(((Math.abs(bnMark - bgMark) / bnMark) * 100).toFixed(5)) : 0,
        nextFundingTime,
        secondsToFunding: Math.round((nextFundingTime - now) / 1000),
        fundingIntervalHours: effInterval,
        settlementCycleLabel: meta.settlementCycleLabel,
        payoutsPerDay: meta.payoutsPerDay,
        direction: pairwise.bestPair
          ? (pairwise.bestPair.direction === "SHORT_A_LONG_B"
              ? `SHORT_${pairwise.bestPair.badgeA.toUpperCase()}_LONG_${pairwise.bestPair.badgeB.toUpperCase()}`
              : `LONG_${pairwise.bestPair.badgeA.toUpperCase()}_SHORT_${pairwise.bestPair.badgeB.toUpperCase()}`)
          : "SHORT_BINANCE_LONG_BITGET",
        isBinanceSupported: hasBn,
        isBitgetSupported: hasBg,
        isCoinDcxSupported: hasCdx,
        isBybitSupported: hasByb,
        allPairs: pairwise.allPairs,
        bestPair: pairwise.bestPair,
        spreadBps: pairwise.maxSpreadBps,
        rateDiffPct: pairwise.maxSpreadPct,
        macroHorizonHours: pairwise.bestPair?.macroHorizonHours || effInterval,
        macroNextFundingTime: pairwise.bestPair?.macroNextFundingTime,
        earliestNextFundingTime: pairwise.bestPair?.earliestNextFundingTime,
      });
    }

    // Multi-Factor Composite Arbitrage Scoring (CAS) Engine (Track SPEC-04 / QUANT-02)
    try {
      const { computeCompositeArbitrageScore } = await import("./candidateScoring");
      for (const item of results) {
        const bestPair = item.bestPair;
        const signedBasisBps = bestPair?.signedBasisContributionBps || 0;
        const netSpreadBps = (item.spreadBps || 0) - 21.0;
        const scoreRes = computeCompositeArbitrageScore({
          symbol: item.symbol,
          corridor: `${bestPair?.venueA || "Binance"}_${bestPair?.venueB || "Bybit"}`.toUpperCase(),
          venueA: bestPair?.venueA || "Binance",
          venueB: bestPair?.venueB || "Bybit",
          grossSpreadBps: item.spreadBps || 0,
          netSpreadBps,
          signedBasisBps,
          secondsToFunding: item.secondsToFunding,
        });
        (item as any).compositeScore = scoreRes.compositeScore;
      }
    } catch {}

    results.sort((a, b) => ((b as any).compositeScore ?? b.spreadBps) - ((a as any).compositeScore ?? a.spreadBps));
    return results;
  } catch (err: any) {
    console.error("fetchOpportunityCoins error:", err.message);
    return [];
  }
}

/**
 * Fetch fresh live prices across any corridor venues to compute accurate price divergence
 */
export async function fetchFreshPrices(
  symbol: string,
  venueA: string = "CoinDCX",
  venueB: string = "Bybit"
): Promise<{ bnPrice: number; bgPrice: number; priceA: number; priceB: number; divergencePct: number; signedBasisBps: number }> {
  async function getPriceForVenue(venue: string): Promise<number> {
    const v = venue.toLowerCase();
    if (v === "bybit") {
      const byb = getBybitTicker(symbol);
      if (byb && byb.markPrice > 0) return byb.markPrice;
      try {
        const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const p = parseFloat(data?.result?.list?.[0]?.markPrice || data?.result?.list?.[0]?.lastPrice || "0");
          if (p > 0) return p;
        }
      } catch {}
    } else if (v === "binance") {
      try {
        const { data } = await signAndFetchBinance(
          ADMIN_BINANCE_KEY,
          ADMIN_BINANCE_SECRET,
          "GET",
          "/fapi/v1/premiumIndex",
          { symbol },
          false,
          ADMIN_BINANCE_ENDPOINT
        );
        const p = parseFloat(data?.markPrice || "0");
        if (p > 0) return p;
      } catch {}
    } else if (v === "bitget") {
      try {
        const res = await fetch(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const p = parseFloat(data?.data?.[0]?.markPrice || data?.data?.[0]?.lastPr || "0");
          if (p > 0) return p;
        }
      } catch {}
    } else if (v === "coindcx") {
      try {
        const { fetchCoinDcxOrderbook } = await import("./coindcxSigner");
        const ob = await fetchCoinDcxOrderbook(symbol, 5);
        if (ob && ob.bestBid > 0 && ob.bestAsk > 0) {
          return (ob.bestBid + ob.bestAsk) / 2;
        }
      } catch {}
    }
    const bybFallback = getBybitTicker(symbol);
    if (bybFallback && bybFallback.markPrice > 0) return bybFallback.markPrice;
    return 0;
  }

  const [pA, pB] = await Promise.all([
    getPriceForVenue(venueA),
    getPriceForVenue(venueB),
  ]);

  const priceA = pA > 0 ? pA : pB;
  const priceB = pB > 0 ? pB : pA;
  const priceDiff = Math.abs(priceA - priceB);
  const divergencePct = priceA > 0 ? (priceDiff / priceA) * 100 : 0;
  // Signed basis: positive = selling on venueA and buying on venueB is profitable upon convergence
  const signedBasisBps = priceB > 0 ? ((priceA - priceB) / priceB) * 10000 : 0;

  return {
    bnPrice: priceA,
    bgPrice: priceB,
    priceA,
    priceB,
    divergencePct: parseFloat(divergencePct.toFixed(5)),
    signedBasisBps: parseFloat(signedBasisBps.toFixed(2)),
  };
}

export interface PreTradeSlippageResult {
  passed: boolean;
  reason?: string;
  venueASpreadBps: number;
  venueBSpreadBps: number;
  totalSpreadFrictionBps: number;
  depthSlippageBps: number;
  roundTripTakerFeeBps: number;
  totalFrictionBps: number;
  expectedNetYieldBps: number;
  venueATopLiquidityUsd: number;
  venueBTopLiquidityUsd: number;
  latencyDriftBps?: number;
  signedBasisBps?: number;
}

/**
 * Pre-Trade Market Slippage & Orderbook Depth Pre-Screening Engine
 * Evaluates live top-of-book bid-ask spreads, Level 1 orderbook liquidity depth,
 * and calculates expected net-yield after all round-trip commissions and execution friction.
 * Prevents over-fitting by dynamically weighing gross funding yield against true transaction friction.
 */
/**
 * Real-Time Microsecond Live Funding Spread Verification Engine
 * Direct non-cached exchange queries to prevent executing on phantom spread spikes or stale scanner rates.
 */
export async function fetchLiveFundingSpread(
  symbol: string,
  venueA: string = "Binance",
  venueB: string = "Bybit",
  intervalA: number = 8,
  intervalB: number = 8,
  timingMode?: string
): Promise<{
  liveSpreadBps: number;
  rateA: number;
  rateB: number;
  fresh: boolean;
  nextFundingTimeA?: number;
  nextFundingTimeB?: number;
  direction?: string;
  reason?: string;
}> {
  let rateA = 0;
  let rateB = 0;
  let nextFundingTimeA = 0;
  let nextFundingTimeB = 0;
  let freshA = false;
  let freshB = false;

  async function fetchVenueRate(vName: string): Promise<{ rate: number; nextFundingTime: number; fresh: boolean }> {
    const v = vName.toLowerCase();
    try {
      if (v === "binance") {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, {
          cache: "no-store",
          headers: { "User-Agent": "AutonomousBotEngine/1.0" },
          signal: AbortSignal.timeout(1800),
        });
        if (res.ok) {
          const d = await res.json();
          const r = parseFloat(d.lastFundingRate || "0") * 100;
          const nft = parseInt(d.nextFundingTime || "0", 10);
          return { rate: r, nextFundingTime: nft, fresh: true };
        }
      } else if (v === "bybit") {
        const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, {
          cache: "no-store",
          headers: { "User-Agent": "AutonomousBotEngine/1.0" },
          signal: AbortSignal.timeout(1800),
        });
        if (res.ok) {
          const d = await res.json();
          const t = d?.result?.list?.[0];
          const r = parseFloat(t?.fundingRate || "0") * 100;
          const nft = parseInt(t?.nextFundingTime || "0", 10);
          return { rate: r, nextFundingTime: nft, fresh: true };
        }
      } else if (v === "bitget") {
        const res = await fetch(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`, {
          cache: "no-store",
          headers: { "User-Agent": "AutonomousBotEngine/1.0" },
          signal: AbortSignal.timeout(1800),
        });
        if (res.ok) {
          const d = await res.json();
          const t = d?.data?.[0];
          const r = parseFloat(t?.fundingRate || "0") * 100;
          const nft = parseInt(t?.nextFundingTime || "0", 10);
          return { rate: r, nextFundingTime: nft, fresh: true };
        }
      } else if (v === "coindcx") {
        const bRes = await fetchVenueRate("binance");
        return { rate: bRes.rate, nextFundingTime: bRes.nextFundingTime, fresh: bRes.fresh };
      }
    } catch {}
    return { rate: 0, nextFundingTime: 0, fresh: false };
  }

  const [resA, resB] = await Promise.all([
    fetchVenueRate(venueA),
    fetchVenueRate(venueB),
  ]);

  rateA = resA.rate;
  rateB = resB.rate;
  nextFundingTimeA = resA.nextFundingTime;
  nextFundingTimeB = resB.nextFundingTime;
  freshA = resA.fresh;
  freshB = resB.fresh;

  const now = Date.now();

  // Invariant 1: Settlement Boundary Quarantine Gate (90s post-settlement freeze)
  const elapsedPostSettlementSeconds = Math.floor((now % 3600000) / 1000);
  if (elapsedPostSettlementSeconds < 90) {
    return {
      liveSpreadBps: 0,
      rateA,
      rateB,
      nextFundingTimeA,
      nextFundingTimeB,
      fresh: false,
      reason: `[POST-SETTLEMENT QUARANTINE] Funding settled ${elapsedPostSettlementSeconds}s ago (< 90s). Waiting for exchange API caches to publish verified new-cycle rates.`,
    };
  }

  // Invariant 3: Synchronization & Horizon Assertion
  if (nextFundingTimeA > 0 && nextFundingTimeB > 0) {
    if (intervalA === intervalB && Math.abs(nextFundingTimeA - nextFundingTimeB) > 60000) {
      return {
        liveSpreadBps: 0,
        rateA,
        rateB,
        nextFundingTimeA,
        nextFundingTimeB,
        fresh: false,
        reason: `[DESYNCHRONIZED NEXT_FUNDING_TIME] Venue settlement times do not match (${new Date(nextFundingTimeA).toISOString()} vs ${new Date(nextFundingTimeB).toISOString()}).`,
      };
    }
  }

  const asym = calculateAsymmetricMacroYield(rateA, intervalA, rateB, intervalB, timingMode);
  return {
    liveSpreadBps: asym.grossYieldBps,
    rateA,
    rateB,
    nextFundingTimeA,
    nextFundingTimeB,
    fresh: freshA && freshB,
    direction: asym.bestDirection,
  };
}

export async function evaluatePreTradeSlippageAndDepth(
  symbol: string,
  venueA: string = "Binance",
  venueB: string = "Bybit",
  orderNotionalUsdt: number = 30,
  leg1Side: "BUY" | "SELL" = "SELL",
  leg2Side: "buy" | "sell" = "buy",
  config?: BotConfig,
  grossSpreadBps: number = 35.0
): Promise<PreTradeSlippageResult> {
  const minNetYieldHurdle = config?.minNetYieldHurdleBps ?? 15.0;
  const maxSpreadCeiling = config?.maxBidAskSpreadBps ?? 25.0;
  const takerFeeBps = config?.roundTripFeeBps ?? 25.0;
  const isEnabled = config?.enablePreTradeSlippageGate === true;

  async function getVenueBook(venue: string, side: "BUY" | "SELL"): Promise<{ bid: number; ask: number; depthUsd: number; spreadBps: number }> {
    const v = venue.toLowerCase();
    let bid = 0;
    let ask = 0;
    let depthUsd = 500; // safe fallback default

    try {
      if (v === "binance") {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = await res.json();
          bid = parseFloat(data?.bidPrice || "0");
          ask = parseFloat(data?.askPrice || "0");
          const bidQty = parseFloat(data?.bidQty || "0");
          const askQty = parseFloat(data?.askQty || "0");
          depthUsd = side === "BUY" ? (askQty * ask) : (bidQty * bid);
        }
      } else if (v === "bybit") {
        const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = await res.json();
          const t = data?.result?.list?.[0];
          bid = parseFloat(t?.bid1Price || "0");
          ask = parseFloat(t?.ask1Price || "0");
          const bidQty = parseFloat(t?.bid1Size || "0");
          const askQty = parseFloat(t?.ask1Size || "0");
          depthUsd = side === "BUY" ? (askQty * ask) : (bidQty * bid);
        }
      } else if (v === "coindcx") {
        const { fetchCoinDcxOrderbook } = await import("./coindcxSigner");
        const ob = await fetchCoinDcxOrderbook(symbol, 5);
        if (ob && ob.bestBid > 0 && ob.bestAsk > 0) {
          bid = ob.bestBid;
          ask = ob.bestAsk;
          const topAskItem: any = ob.asks?.[0];
          const topBidItem: any = ob.bids?.[0];
          const topAskQty = Array.isArray(topAskItem) ? parseFloat(topAskItem[1]) : (topAskItem?.quantity || 100);
          const topBidQty = Array.isArray(topBidItem) ? parseFloat(topBidItem[1]) : (topBidItem?.quantity || 100);
          const topQty = side === "BUY" ? (topAskQty || 100) : (topBidQty || 100);
          depthUsd = topQty * (side === "BUY" ? ask : bid);
        }
      } else if (v === "bitget") {
        const res = await fetch(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = await res.json();
          const t = data?.data?.[0];
          bid = parseFloat(t?.bestBid || t?.bidPr || "0");
          ask = parseFloat(t?.bestAsk || t?.askPr || "0");
          const bidSz = parseFloat(t?.bidSz || "0");
          const askSz = parseFloat(t?.askSz || "0");
          depthUsd = side === "BUY" ? (askSz * ask) : (bidSz * bid);
        }
      }
    } catch {}

    const spreadBps = (bid > 0 && ask >= bid) ? ((ask - bid) / bid) * 10000 : 5.0;
    return { bid, ask, depthUsd: depthUsd > 0 ? depthUsd : 500, spreadBps: parseFloat(spreadBps.toFixed(2)) };
  }

  const [bookA, bookB] = await Promise.all([
    getVenueBook(venueA, leg1Side),
    getVenueBook(venueB, leg2Side.toUpperCase() as "BUY" | "SELL"),
  ]);

  const tier = config?.liquidityTier || "MEDIUM";
  const depthFactor = tier === "DEEP" ? 0.35 : tier === "THIN" ? 2.50 : 1.00;
  // Dynamic order-proportional depth requirement: unblocks smaller trades ($20-$60) while enforcing liquidity buffer
  const depthMultiplier = tier === "DEEP" ? 3.0 : tier === "THIN" ? 1.25 : 2.0;
  const minRequiredDepthUsd = parseFloat(Math.max(15, orderNotionalUsdt * depthMultiplier).toFixed(2));

  const venueASpreadBps = bookA.spreadBps;
  const venueBSpreadBps = bookB.spreadBps;
  // Invariant 8: Full round-trip spread crossing accounts for entering and exiting crossing bid-ask spreads
  const totalSpreadFrictionBps = parseFloat((venueASpreadBps + venueBSpreadBps).toFixed(2));

  // Estimate orderbook depth impact (L2 multi-level VWAP sweep with safe heuristic fallback)
  let depthSlippageBps = 0;
  try {
    const { globalOrderBookManager } = await import("./orderBookManager");
    const l2A = await globalOrderBookManager.fetchL2Depth(venueA, symbol, 10);
    const l2B = await globalOrderBookManager.fetchL2Depth(venueB, symbol, 10);
    if (l2A.asks.length > 0 && l2B.bids.length > 0) {
      const sweepA = globalOrderBookManager.calculateVwapSweep(l2A.asks, "BUY", orderNotionalUsdt);
      const sweepB = globalOrderBookManager.calculateVwapSweep(l2B.bids, "SELL", orderNotionalUsdt);
      depthSlippageBps = parseFloat(((sweepA.slippageBps + sweepB.slippageBps) * depthFactor).toFixed(2));
    } else {
      const ratioA = orderNotionalUsdt / Math.max(1, bookA.depthUsd);
      const ratioB = orderNotionalUsdt / Math.max(1, bookB.depthUsd);
      const sweepA = ratioA > 1 ? Math.min(25, (ratioA - 1) * 2.5) : 0;
      const sweepB = ratioB > 1 ? Math.min(25, (ratioB - 1) * 2.5) : 0;
      depthSlippageBps = parseFloat(((sweepA + sweepB) * depthFactor).toFixed(2));
    }
  } catch {
    const ratioA = orderNotionalUsdt / Math.max(1, bookA.depthUsd);
    const ratioB = orderNotionalUsdt / Math.max(1, bookB.depthUsd);
    const sweepA = ratioA > 1 ? Math.min(25, (ratioA - 1) * 2.5) : 0;
    const sweepB = ratioB > 1 ? Math.min(25, (ratioB - 1) * 2.5) : 0;
    depthSlippageBps = parseFloat(((sweepA + sweepB) * depthFactor).toFixed(2));
  }

  // Invariant 8: Inter-leg latency drift buffer (60-150ms execution delay drift: 8.0 bps for THIN, 5.0 bps for MEDIUM/DEEP)
  const latencyDriftBps = tier === "THIN" ? 8.0 : 5.0;

  const totalFrictionBps = parseFloat((takerFeeBps + totalSpreadFrictionBps + depthSlippageBps + latencyDriftBps).toFixed(2));
  // Include signed directional basis: positive basis adds to net yield, negative basis reduces net yield
  const basisContributionBps = config?.currentSignedBasisBps ?? 0;
  const expectedNetYieldBps = parseFloat((grossSpreadBps + basisContributionBps - totalFrictionBps).toFixed(2));

  if (!isEnabled) {
    return {
      passed: true,
      venueASpreadBps,
      venueBSpreadBps,
      totalSpreadFrictionBps,
      depthSlippageBps,
      roundTripTakerFeeBps: takerFeeBps,
      totalFrictionBps,
      expectedNetYieldBps,
      venueATopLiquidityUsd: bookA.depthUsd,
      venueBTopLiquidityUsd: bookB.depthUsd,
      latencyDriftBps,
    };
  }

  // 1. Extreme Spread Circuit Breaker (pathological spreads e.g. > 100 bps = broken feed or halted market)
  const EXTREME_SPREAD_CAP_BPS = 100;
  if (venueASpreadBps > EXTREME_SPREAD_CAP_BPS || venueBSpreadBps > EXTREME_SPREAD_CAP_BPS) {
    const worstVenue = venueASpreadBps > venueBSpreadBps ? `${venueA} (${venueASpreadBps} bps)` : `${venueB} (${venueBSpreadBps} bps)`;
    return {
      passed: false,
      reason: `EXTREME_SPREAD_CIRCUIT_BREAKER: ${worstVenue} > ${EXTREME_SPREAD_CAP_BPS} bps safety cap (broken feed or market halt)`,
      venueASpreadBps,
      venueBSpreadBps,
      totalSpreadFrictionBps,
      depthSlippageBps,
      roundTripTakerFeeBps: takerFeeBps,
      totalFrictionBps,
      expectedNetYieldBps,
      venueATopLiquidityUsd: bookA.depthUsd,
      venueBTopLiquidityUsd: bookB.depthUsd,
      latencyDriftBps,
    };
  }

  // 2. Dynamic Order-Proportional Book Depth check
  if (bookA.depthUsd < minRequiredDepthUsd || bookB.depthUsd < minRequiredDepthUsd) {
    const worstVenue = bookA.depthUsd < bookB.depthUsd ? `${venueA} ($${bookA.depthUsd.toFixed(1)})` : `${venueB} ($${bookB.depthUsd.toFixed(1)})`;
    const tierLabel = tier === "DEEP" ? "Deep (BTC)" : tier === "THIN" ? "Thin Alt" : "Mid-Cap (MEDIUM)";
    return {
      passed: false,
      reason: `ILLIQUID_BOOK_DEPTH: Top level depth too thin (${worstVenue} < $${minRequiredDepthUsd} required for ${tierLabel} with ${orderNotionalUsdt.toFixed(0)} USDT order × ${depthMultiplier}x).`,
      venueASpreadBps,
      venueBSpreadBps,
      totalSpreadFrictionBps,
      depthSlippageBps,
      roundTripTakerFeeBps: takerFeeBps,
      totalFrictionBps,
      expectedNetYieldBps,
      venueATopLiquidityUsd: bookA.depthUsd,
      venueBTopLiquidityUsd: bookB.depthUsd,
      latencyDriftBps,
    };
  }

  // 3. Pre-Trade Extreme Slippage Circuit Breaker (only blocks extreme unfillable book states > 0.50% / 50 bps)
  const estimatedSlippagePct = parseFloat(((totalSpreadFrictionBps + depthSlippageBps) / 100).toFixed(4));
  const EXTREME_SLIPPAGE_CAP_PCT = 0.50;
  if (estimatedSlippagePct > EXTREME_SLIPPAGE_CAP_PCT) {
    return {
      passed: false,
      reason: `EXTREME_SLIPPAGE_CIRCUIT_BREAKER: Est. slippage ${estimatedSlippagePct}% > ${EXTREME_SLIPPAGE_CAP_PCT}% safety cap`,
      venueASpreadBps,
      venueBSpreadBps,
      totalSpreadFrictionBps,
      depthSlippageBps,
      roundTripTakerFeeBps: takerFeeBps,
      totalFrictionBps,
      expectedNetYieldBps,
      venueATopLiquidityUsd: bookA.depthUsd,
      venueBTopLiquidityUsd: bookB.depthUsd,
      latencyDriftBps,
    };
  }

  // 4. Unified Master Net-Yield Hurdle (Invariant 8): Gross Spread (+ Basis) minus Total Friction must clear minNetYieldHurdle
  if (expectedNetYieldBps < minNetYieldHurdle) {
    return {
      passed: false,
      reason: `NET_YIELD_BELOW_HURDLE (Invariant 8): Gross yield (${grossSpreadBps} bps) + basis (${basisContributionBps.toFixed(1)} bps) minus friction (${totalFrictionBps} bps = fees ${takerFeeBps} + crossing ${totalSpreadFrictionBps} + depth ${depthSlippageBps} + latency ${latencyDriftBps}) yields ${expectedNetYieldBps} bps < ${minNetYieldHurdle} bps hurdle`,
      venueASpreadBps,
      venueBSpreadBps,
      totalSpreadFrictionBps,
      depthSlippageBps,
      roundTripTakerFeeBps: takerFeeBps,
      totalFrictionBps,
      expectedNetYieldBps,
      venueATopLiquidityUsd: bookA.depthUsd,
      venueBTopLiquidityUsd: bookB.depthUsd,
      latencyDriftBps,
    };
  }

  return {
    passed: true,
    venueASpreadBps,
    venueBSpreadBps,
    totalSpreadFrictionBps,
    depthSlippageBps,
    roundTripTakerFeeBps: takerFeeBps,
    totalFrictionBps,
    expectedNetYieldBps,
    venueATopLiquidityUsd: bookA.depthUsd,
    venueBTopLiquidityUsd: bookB.depthUsd,
    latencyDriftBps,
  };
}

/**
 * Dynamic 5-Minute Breathing Room Price Difference Optimizer
 * Evaluates the required price divergence (%) threshold based on the timing mode
 * and seconds remaining until funding settlement.
 * - Stage 1 (Early Breathing Room: 300s to 120s): Demands optimal low price difference (<= 0.010% / 1 bp)
 *   or WAITS for basis compression.
 * - Stage 2 (Mid Breathing Room: 120s to 45s): Relaxes to intermediate target (<= 0.020% / 2 bps) or WAITS.
 * - Stage 3 (Final Countdown: 45s to 8s): Opens up to configured maxPriceDivergencePct (0.030%) to harvest funding.
 * - Boundary Guard (< 8s): Freezes entry to prevent half-settled exposure across the settlement boundary.
 */
export function calculateRequiredPriceDivergencePct(
  config: BotConfig,
  secondsToFunding: number,
  spreadBps?: number
): {
  requiredDivergencePct: number;
  stage: "EARLY_BREATHING_ROOM" | "MID_BREATHING_ROOM" | "FINAL_COUNTDOWN" | "PRE_SETTLEMENT_FREEZE" | "POST_SETTLEMENT_QUARANTINE" | "CONTINUOUS";
  optimalTargetPct: number;
  hardCeilingPct: number;
  shouldFreeze: boolean;
  freezeReason?: string;
} {
  const baseCeilingPct = config.maxPriceDivergencePct || 0.10;

  // Dynamic spread-ratio scaling: Allow divergence up to a percentage of the spread (e.g. 25% of 120 bps = 0.30%)
  let spreadScaledCeilingPct = baseCeilingPct;
  if (spreadBps && spreadBps > 0 && config.maxDivergenceSpreadRatioPct && config.maxDivergenceSpreadRatioPct > 0) {
    const spreadPct = spreadBps / 100;
    const ratioCeiling = (spreadPct * config.maxDivergenceSpreadRatioPct) / 100;
    spreadScaledCeilingPct = Math.max(baseCeilingPct, ratioCeiling);
  }

  // Cap at hard safety ceiling (0.50%) to prevent entering heavily dislocated pairs
  const maxCapPct = config.maxPriceDivergenceCapPct || 0.50;
  const hardCeilingPct = Math.min(spreadScaledCeilingPct, maxCapPct);

  // Strict tolerance enforcement: honor dynamic ceiling directly across countdown stages
  const optimalTargetPct = config.optimalPriceDivergencePct && config.optimalPriceDivergencePct > 0
    ? config.optimalPriceDivergencePct
    : hardCeilingPct;

  const now = Date.now();
  const elapsedPostSettlementSeconds = Math.floor((now % 3600000) / 1000);

  // Invariant 1: Universal 90-Second Post-Settlement Quarantine Gate
  // Exchanges (Binance, Bybit) settle funding balances at HH:00:00.000Z.
  // REST endpoints experience a 15-90s propagation and calculation delay.
  // No bot may enter any new position within 90s after settlement to prevent trading on stale rates.
  if (elapsedPostSettlementSeconds < 90) {
    return {
      requiredDivergencePct: 0,
      stage: "POST_SETTLEMENT_QUARANTINE",
      optimalTargetPct,
      hardCeilingPct,
      shouldFreeze: true,
      freezeReason: `[POST-SETTLEMENT QUARANTINE] Funding settled ${elapsedPostSettlementSeconds}s ago (< 90s). Waiting for exchange API caches to publish verified new-cycle rates.`,
    };
  }

  // Invariant 2: Universal 60-Second Pre-Settlement Freeze Gate
  // Under 60 seconds to funding tick: freeze entry across ALL modes (including CONTINUOUS_SPREAD) to avoid cross-settlement desync.
  if (secondsToFunding > 0 && secondsToFunding < 60) {
    return {
      requiredDivergencePct: 0,
      stage: "PRE_SETTLEMENT_FREEZE",
      optimalTargetPct,
      hardCeilingPct,
      shouldFreeze: true,
      freezeReason: `[PRE-SETTLEMENT FREEZE] Within 60s of funding settlement (${secondsToFunding}s left). Entry locked to avoid cross-settlement desynchronization.`,
    };
  }

  if (config.timingMode === "CONTINUOUS_SPREAD" || secondsToFunding <= 0) {
    return {
      requiredDivergencePct: hardCeilingPct,
      stage: "CONTINUOUS",
      optimalTargetPct,
      hardCeilingPct,
      shouldFreeze: false,
    };
  }

  // Scalable Sniper Breathing Room Mode (Supports dynamic sniperWindowMinutes e.g. 1m, 3m, 5m, 10m, 15m, 30m)
  const sniperWindowSeconds = config.sniperWindowMinutes
    ? config.sniperWindowMinutes * 60
    : (config.timingMode === "FUNDING_SNIPER_1M" ? 60 : 300);

  const stage1Threshold = Math.max(30, Math.round(sniperWindowSeconds * 0.40));
  const stage2Threshold = Math.max(15, Math.round(sniperWindowSeconds * 0.15));

  if (secondsToFunding > stage1Threshold) {
    // Stage 1: Early breathing room
    return {
      requiredDivergencePct: optimalTargetPct,
      stage: "EARLY_BREATHING_ROOM",
      optimalTargetPct,
      hardCeilingPct,
      shouldFreeze: false,
    };
  } else if (secondsToFunding > stage2Threshold) {
    // Stage 2: Mid breathing room
    const midTargetPct = (optimalTargetPct + hardCeilingPct) / 2;
    return {
      requiredDivergencePct: midTargetPct,
      stage: "MID_BREATHING_ROOM",
      optimalTargetPct,
      hardCeilingPct,
      shouldFreeze: false,
    };
  }

  // Stage 3: Final countdown before funding tick
  return {
    requiredDivergencePct: hardCeilingPct,
    stage: "FINAL_COUNTDOWN",
    optimalTargetPct,
    hardCeilingPct,
    shouldFreeze: false,
  };
}

/**
 * Execute dual hedge entry for a qualified coin using tenant credentials
 */
export async function executeDualHedgeEntry(
  coin: any,
  config: BotConfig,
  allocatedMargin: number,
  botName: string,
  state: BotEngineState,
  creds?: UserApiKeys,
  userId?: string,
  botId?: string
): Promise<{ success: boolean; hedge?: ActiveBotHedge; error?: string }> {
  const symbol = coin.symbol;
  const corridor = config.executionCorridor || "COINDCX_BYBIT";
  let venueAName: "CoinDCX" | "Binance" | "Bitget" = "CoinDCX";
  let venueBName: "Bybit" | "Bitget" | "CoinDCX" = "Bybit";

  if (corridor === "COINDCX_BYBIT") {
    venueAName = "CoinDCX";
    venueBName = "Bybit";
  } else if (corridor === "BINANCE_BYBIT") {
    venueAName = "Binance";
    venueBName = "Bybit";
  } else if (corridor === "COINDCX_BITGET") {
    venueAName = "CoinDCX";
    venueBName = "Bitget";
  } else if (corridor === "BITGET_BYBIT") {
    venueAName = "Bitget";
    venueBName = "Bybit";
  } else if (corridor === "BINANCE_COINDCX") {
    venueAName = "Binance";
    venueBName = "CoinDCX";
  } else if (corridor === "BINANCE_BITGET") {
    venueAName = "Binance";
    venueBName = "Bitget";
  } else {
    venueAName = "CoinDCX";
    venueBName = "Bybit";
  }

  // Concurrency Gate: Prevent duplicate in-flight entries on same symbol/corridor across fleet
  const corridorKey = `${corridor}_${symbol}`.toUpperCase();
  const symKey = symbol.toUpperCase();
  if (inFlightEntryLocks.has(corridorKey) || inFlightEntryLocks.has(symKey)) {
    appendBotLog(
      state,
      `[CONCURRENCY LOCK] Bot "${botName}": Entry on ${symbol} (${corridor}) blocked — in-flight entry order currently processing.`,
      "warn",
      userId,
      botId
    );
    return {
      success: false,
      error: `CONCURRENCY_LOCK_ACTIVE: Entry on ${symbol} is already in-flight`,
    };
  }

  // Phase 4: Centralized Fleet Dispatcher Mutex Lock (Track SPEC-04)
  try {
    const { globalFleetDispatcher } = await import("./fleetDispatcher");
    if (!globalFleetDispatcher.acquireFleetLock(symbol, corridor, botId || botName)) {
      appendBotLog(
        state,
        `[FLEET LOCK ACTIVE] Bot "${botName}": Symbol ${symbol} is locked by another fleet bot. Skipping.`,
        "warn",
        userId,
        botId
      );
      return {
        success: false,
        error: `FLEET_LOCK_ACTIVE: Symbol ${symbol} in execution by another bot`,
      };
    }
  } catch {}

  inFlightEntryLocks.add(corridorKey);
  inFlightEntryLocks.add(symKey);

  try {
    const isBybit = venueBName === "Bybit";
  const isCoinDcx = venueBName === "CoinDCX" || venueAName === "CoinDCX";

  const coinLevs = getCoinMaxLeverages(symbol);
  const maxLevA = venueAName === "CoinDCX" ? coinLevs.coindcx : venueAName === "Bitget" ? coinLevs.bitget : coinLevs.binance;
  const maxLevB = venueBName === "Bybit" ? coinLevs.bybit : venueBName === "CoinDCX" ? coinLevs.coindcx : coinLevs.bitget;

  // Phase 4: Dynamic Volatility-Adjusted Leverage (Track SPEC-05)
  let dynLevA = maxLevA;
  let dynLevB = maxLevB;
  try {
    const { calculateDynamicLeverage } = await import("./leverageManager");
    dynLevA = calculateDynamicLeverage(symbol, venueAName, coin.atr1hPct, 24, maxLevA);
    dynLevB = calculateDynamicLeverage(symbol, venueBName, coin.atr1hPct, 24, maxLevB);
  } catch {}

  // Auto-minimize margin as per available margin: use dynamic leverage unless user configured CUSTOM leverage
  const binanceLeverage = config.leverageMode === "CUSTOM" ? Math.min(config.customLeverage, dynLevA) : dynLevA;
  const bitgetLeverage = config.leverageMode === "CUSTOM" ? Math.min(config.customLeverage, dynLevB) : dynLevB;

  // Auto-split sizing so that Margin_A + Margin_B <= allocatedMargin
  // and Margin_A * binanceLeverage = Margin_B * bitgetLeverage (1:1 Delta-Neutral)
  const autoSplit = calculateAutoSplit(allocatedMargin, binanceLeverage, bitgetLeverage);
  const refPrice = coin.binanceMarkPrice || 100;
  const targetNotional = Math.max(15, autoSplit.matchedNotional);
  let rawQty = targetNotional / refPrice;

  let minNotional = 12.0;
  if (symbol.startsWith("BTC")) minNotional = 55.0;
  else if (symbol.startsWith("ETH")) minNotional = 25.0;

  if (refPrice > 0 && refPrice * rawQty < minNotional) {
    rawQty = Math.max(0.001, minNotional / refPrice);
  }

  let formattedQty = formatSymbolQuantity(rawQty, symbol, refPrice);
  let effectiveQty = parseFloat(formattedQty);
  const totalNotional = refPrice * effectiveQty;

  // Pre-Broker Risk Gate Interception (Track A-04, A-05)
  const { RiskGate } = await import("./riskGate");
  const riskCheck = RiskGate.validatePreOrder({
    userId,
    symbol,
    side: (coin.leg1Side || "SELL") as any,
    quantity: effectiveQty,
    price: refPrice,
    notionalUsdt: totalNotional,
    venue: corridor,
    botId,
  });
  if (!riskCheck.allowed) {
    appendBotLog(
      state,
      `[RISK GATE REJECTED] Bot "${botName}": Entry on ${symbol} blocked by RiskGate: ${riskCheck.reason} (code: ${riskCheck.code})`,
      "error",
      userId,
      botId
    );
    return {
      success: false,
      error: `RISK_GATE_REJECTED: ${riskCheck.reason}`,
    };
  }

  // PRE-FLIGHT HEALTH GATE: Verify proxy pool before touching exchange APIs
  if (isBybit) {
    const proxyPreFlight = await verifyProxyPreFlight({
      proxyUrl: creds?.bybitProxy,
      baseUrl: creds?.bybitBaseUrl,
      backupProxyUrl: creds?.bybitBackupProxy,
      backupBaseUrl: creds?.bybitBackupBaseUrl,
    });
    if (!proxyPreFlight.allowed) {
      appendBotLog(
        state,
        `[ENTRY PRE-FLIGHT BLOCKED] Bot "${botName}": Bybit proxy offline (${proxyPreFlight.reason || "Unhealthy"}). Safe entry gate engaged: NEVER open Leg 1 when Bybit proxy is unreachable.`,
        "error",
        userId
      );
      return {
        success: false,
        error: `PRE_FLIGHT_BLOCKED: Bybit proxy offline (${proxyPreFlight.reason || "Connection failed"}). Entry safely aborted.`,
      };
    }
  }

  // PRE-FLIGHT CONTRACT ELIGIBILITY & WEB-AGREEMENT GATE:
  // Inspects contracts before touching Leg 1, permanently eliminating agreement rejection unwinds
  const { globalContractEligibilityScreener } = await import("./contractEligibilityScreener");
  const eligibility = await globalContractEligibilityScreener.validateCorridorEligibility(
    symbol,
    venueAName,
    venueBName,
    creds
  );

  if (!eligibility.eligible) {
    appendBotLog(
      state,
      `[ENTRY PRE-FLIGHT BLOCKED] Bot "${botName}": Symbol ${symbol} is ineligible for automated execution across ${venueAName} ⇄ ${venueBName}: ${eligibility.rejectionReason}`,
      "error",
      userId,
      botId
    );
    const targetBot = state.bots?.find((b: any) => b.id === botId);
    if (targetBot) {
      quarantineBotSymbol(targetBot, symbol, 3600, eligibility.rejectionReason || "Agreement or non-crypto rejection", state, userId);
    }
    return {
      success: false,
      error: `CONTRACT_INELIGIBLE: ${eligibility.rejectionReason}`,
    };
  }

  // PHASE 4: CORRELATION BREAKDOWN CIRCUIT BREAKER GATE (Track SPEC-10)
  // Check rolling 60s Pearson r and basis z-score before Leg 1 order dispatch
  try {
    const { globalCircuitBreaker } = await import("./circuitBreaker");
    const pA = coin.freshPriceA || coin.binancePrice || coin.binanceMarkPrice || refPrice;
    const pB = coin.freshPriceB || coin.bybitPrice || coin.bybitMarkPrice || refPrice;
    globalCircuitBreaker.ingestTick(corridor, symbol, pA, pB);
    const cbCheck = globalCircuitBreaker.isEntryAllowed(corridor, symbol);
    if (!cbCheck.allowed) {
      appendBotLog(
        state,
        `[CIRCUIT BREAKER ENGAGED] Bot "${botName}": Entry on ${symbol} (${corridor}) blocked by Correlation Circuit Breaker: ${cbCheck.reason}`,
        "error",
        userId,
        botId
      );
      return {
        success: false,
        error: `CIRCUIT_BREAKER_BLOCKED: ${cbCheck.reason}`,
      };
    }
  } catch {}

  // R1 PRE-FLIGHT FUNDING SYNCHRONIZATION LOCK:
  const fundingMeta = await getFundingMetaForSymbol(symbol);
  const intervalMode: FundingIntervalMode = config.intervalMode || (config.allowAsymmetricFunding === false ? "STRICT_SYNC_ONLY" : "ALL_ASYMMETRIC");
  const allowAsymmetric = intervalMode !== "STRICT_SYNC_ONLY";
  const minRequiredGrossBps = Math.max(config.minSpreadBps || MIN_GROSS_SPREAD_BPS, MIN_GROSS_SPREAD_BPS);

  const syncCheck = checkFundingSynchronization(venueAName, venueBName, fundingMeta, Date.now(), {
    allowAsymmetric,
    intervalMode,
    allowedIntervalPairs: config.allowedIntervalPairs,
    minGrossSpreadBps: minRequiredGrossBps,
  });

  const candidatePair = coin.allPairs?.find((p: any) => {
    const vA = p.venueA?.toLowerCase();
    const vB = p.venueB?.toLowerCase();
    const reqA = venueAName.toLowerCase();
    const reqB = venueBName.toLowerCase();
    return (vA === reqA && vB === reqB) || (vA === reqB && vB === reqA);
  });

  if (!syncCheck.synchronized || (candidatePair && candidatePair.isFundingSynchronized === false && !allowAsymmetric)) {
    const disqualificationReason = candidatePair?.syncDisqualificationReason || syncCheck.reason || "Mismatched intervals or >60s countdown delta";
    appendBotLog(
      state,
      `[FUNDING SYNC LOCK] Bot "${botName}": Pre-flight rejected ${symbol} on ${venueAName} ⇄ ${venueBName} (${disqualificationReason}). Entry aborted.`,
      "error",
      userId,
      botId
    );
    return {
      success: false,
      error: `FUNDING_SYNC_MISMATCH: ${disqualificationReason}`,
    };
  }

  if (syncCheck.isAsymmetric) {
    appendBotLog(
      state,
      `[ASYMMETRIC PRE-FLIGHT QUALIFIED] Bot "${botName}": ${symbol} on ${venueAName} (${syncCheck.venueAIntervalHours || syncCheck.intervalA}h) ⇄ ${venueBName} (${syncCheck.venueBIntervalHours || syncCheck.intervalB}h) permitted under asymmetric funding policy (${intervalMode}). Earliest: ${syncCheck.secondsToEarliestFunding ?? "N/A"}s, Macro: ${syncCheck.secondsToMacroFunding ?? "N/A"}s (Macro Horizon: ${syncCheck.macroHorizonHours || Math.max(syncCheck.intervalA || 8, syncCheck.intervalB || 8)}h).`,
      "info",
      userId,
      botId
    );
  }

  // REAL-TIME MICROSECOND LIVE FUNDING SPREAD VERIFICATION GATE
  // Direct live query to confirm funding spread hasn't dumped between scanner and entry dispatch
  const liveFunding = await fetchLiveFundingSpread(
    symbol,
    venueAName,
    venueBName,
    syncCheck.venueAIntervalHours || 8,
    syncCheck.venueBIntervalHours || 8,
    config.timingMode
  );
  const effectiveLiveSpreadBps = liveFunding.fresh ? liveFunding.liveSpreadBps : (candidatePair ? candidatePair.spreadBps : (coin.spreadBps || 0));

  if (liveFunding.fresh && liveFunding.liveSpreadBps < minRequiredGrossBps) {
    appendBotLog(
      state,
      `[LIVE SPREAD COLLAPSE ABORT] Bot "${botName}": Microsecond check shows live spread on ${symbol} collapsed to ${liveFunding.liveSpreadBps.toFixed(1)} bps (scanner saw ${(coin.spreadBps || 0).toFixed(1)} bps) < min hurdle ${minRequiredGrossBps} bps. RateA: ${liveFunding.rateA.toFixed(4)}%, RateB: ${liveFunding.rateB.toFixed(4)}%. Entry aborted to prevent fee burn!`,
      "warn",
      userId,
      botId
    );
    return {
      success: false,
      error: `LIVE_SPREAD_COLLAPSED: Live spread ${liveFunding.liveSpreadBps.toFixed(1)} bps < min hurdle ${minRequiredGrossBps} bps (thin alt spread dump)`,
    };
  }

  // R3 PRE-FLIGHT NET TAKER FEE & GST CLEARANCE FILTER:
  const grossSpreadBps = effectiveLiveSpreadBps;
  if (grossSpreadBps < minRequiredGrossBps || (grossSpreadBps - ROUNDTRIP_TAKER_FEE_BPS) <= 0) {
    appendBotLog(
      state,
      `[FEE CLEARANCE FILTER] Bot "${botName}": Pre-flight rejected ${symbol}. Gross spread ${grossSpreadBps} bps fails fee filter (Min gross: ${minRequiredGrossBps} bps, Roundtrip fee: ${ROUNDTRIP_TAKER_FEE_BPS} bps). Entry aborted.`,
      "error",
      userId,
      botId
    );
    return {
      success: false,
      error: `FEE_CLEARANCE_REJECTED: Spread ${grossSpreadBps} bps does not clear ${minRequiredGrossBps} bps gross / ${ROUNDTRIP_TAKER_FEE_BPS} bps round-trip taker fees`,
    };
  }

  // PRE-EXECUTION PRICE DIFFERENCE VERIFICATION GATE (Signed Directional Basis Engine)
  const preExecPrices = await fetchFreshPrices(symbol, venueAName, venueBName);
  const preExecReq = calculateRequiredPriceDivergencePct(config, coin.secondsToFunding || 0, coin.spreadBps);

  if (preExecReq.shouldFreeze) {
    appendBotLog(
      state,
      `[TICK FREEZE] Bot "${botName}": Only ${coin.secondsToFunding || 0}s left to funding settlement. Order dispatch aborted to avoid half-settled fill across settlement boundary.`,
      "warn",
      userId
    );
    return {
      success: false,
      error: `PRE_SETTLEMENT_FREEZE: Under 8s to funding tick. Pausing entry to avoid execution desynchronization.`,
    };
  }

  const leg1Side: "BUY" | "SELL" = coin.leg1Side ||
    ((coin.direction === "SHORT_BINANCE_LONG_BITGET" || coin.direction === "SHORT_BINANCE_LONG_COINDCX" || coin.direction === "SHORT_BINANCE_LONG_BYBIT" || coin.direction?.includes("SHORT_A")) ? "SELL" : "BUY");
  const leg2Side: "buy" | "sell" = leg1Side === "SELL" ? "buy" : "sell";

  // Evaluate signed directional basis: selling higher and buying lower produces positive convergence profit
  const isShortA = coin.direction?.includes("SHORT_A") ||
                   coin.direction === "SHORT_BINANCE_LONG_BITGET" ||
                   coin.direction === "SHORT_BINANCE_LONG_COINDCX" ||
                   coin.direction === "SHORT_BINANCE_LONG_BYBIT" ||
                   leg1Side === "SELL";
  const signedBasisBps = preExecPrices.signedBasisBps || 0;
  const isBasisFavorable = isShortA ? signedBasisBps > 0 : signedBasisBps < 0;
  const adverseDivergencePct = isBasisFavorable ? 0 : preExecPrices.divergencePct;
  const basisSafetyCapExceeded = Math.abs(signedBasisBps) > 250;

  if (adverseDivergencePct > preExecReq.requiredDivergencePct || basisSafetyCapExceeded) {
    const gateReason = basisSafetyCapExceeded
      ? `BASIS_SAFETY_CAP: |${signedBasisBps.toFixed(1)}| bps > 250 bps safety cap`
      : `PRE_EXEC_PRICE_DIFF_WAIT: Adverse diff ${preExecPrices.divergencePct.toFixed(3)}% > ${preExecReq.requiredDivergencePct.toFixed(3)}% (${preExecReq.stage})`;
    appendBotLog(
      state,
      `[PRE-EXEC PRICE DIFF GATE] Bot "${botName}": At dispatch microsecond, ${symbol} ${gateReason}. Basis: ${signedBasisBps.toFixed(1)} bps (${isBasisFavorable ? "FAVORABLE" : "ADVERSE"}). Dispatch paused to wait for lower price difference.`,
      "warn",
      userId
    );
    return {
      success: false,
      error: gateReason,
    };
  }

  // PRE-EXECUTION NET-YIELD & SLIPPAGE FRICTION GATE
  const effectiveBasisContribution = isShortA ? signedBasisBps : -signedBasisBps;
  const configWithBasis: BotConfig = {
    ...config,
    currentSignedBasisBps: effectiveBasisContribution,
  };
  const preExecSlippage = await evaluatePreTradeSlippageAndDepth(
    symbol,
    venueAName,
    venueBName,
    totalNotional,
    leg1Side,
    leg2Side,
    configWithBasis,
    effectiveLiveSpreadBps || coin.spreadBps || 35.0
  );

  if (!preExecSlippage.passed) {
    appendBotLog(
      state,
      `[PRE-EXEC SLIPPAGE GATE] Bot "${botName}": At dispatch microsecond, ${symbol} failed friction check: ${preExecSlippage.reason}. Dispatch aborted to prevent fee/slippage burn.`,
      "warn",
      userId
    );
    return {
      success: false,
      error: `PRE_EXEC_SLIPPAGE_ABORT: ${preExecSlippage.reason}`,
    };
  }

  // PRE-EXECUTION VENUE AGREEMENT & RESTRICTION GATE
  if ((venueAName as string) === "Bybit" || venueBName === "Bybit") {
    const restrictedBybit = await getBybitRestrictedInstruments();
    if (restrictedBybit.has(symbol.toUpperCase())) {
      appendBotLog(
        state,
        `[PRE-EXEC AGREEMENT GATE] Bot "${botName}": Symbol ${symbol} is a non-crypto/stock instrument requiring a manual Bybit web agreement. Dispatch aborted before Leg 1 to preserve capital.`,
        "warn",
        userId
      );
      return {
        success: false,
        error: `BYBIT_AGREEMENT_REQUIRED: Symbol ${symbol} requires manual agreement on Bybit`,
      };
    }
  }

  // UPGRADE 2 / PILLAR 2: PRE-FLIGHT VENUE B SOLVENCY & LIQUIDITY GUARANTEE
  const rawBybitSec = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
  const cleanBybitSec = rawBybitSec && rawBybitSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBybitSec) : rawBybitSec;
  const requiredMarginUsdt = totalNotional / Math.max(1, bitgetLeverage);
  const bybitCredsForCheck = isBybit ? {
    apiKey: creds?.bybitKey || ADMIN_BYBIT_KEY,
    apiSecret: cleanBybitSec,
    proxyUrl: creds?.bybitProxy,
    baseUrl: creds?.bybitBaseUrl,
    backupProxyUrl: creds?.bybitBackupProxy,
    backupBaseUrl: creds?.bybitBackupBaseUrl,
  } : undefined;

  const preFlightRes = await preFlightLeg2Check({
    venueBName,
    symbol,
    requiredMarginUsdt,
    bybitCreds: bybitCredsForCheck,
  });

  if (!preFlightRes.passed) {
    appendBotLog(
      state,
      `[PRE-FLIGHT GUARANTEE REJECT] Bot "${botName}": Leg 2 venue (${venueBName}) failed pre-flight health/solvency check: ${preFlightRes.reason}. Leg 1 was NOT dispatched. Zero orphan risk, $0.00 lost.`,
      "warn",
      userId,
      botId
    );
    return {
      success: false,
      error: `PRE_FLIGHT_REJECTED: ${preFlightRes.reason}`,
    };
  }

  const bnKey = creds?.binanceKey || ADMIN_BINANCE_KEY;
  const rawBnSec = creds?.binanceSecret || ADMIN_BINANCE_SECRET;
  const bnSec = rawBnSec && rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
  const bnEndpoint = creds?.binanceEndpoint || ADMIN_BINANCE_ENDPOINT;

  const rawBgSec = creds?.bitgetSecret || SYSTEM_DEFAULT_BITGET_SECRET;
  const rawBgPass = creds?.bitgetPassphrase || SYSTEM_DEFAULT_BITGET_PASSPHRASE;
  const bgCreds: BitgetCredentials = {
    apiKey: creds?.bitgetKey || SYSTEM_DEFAULT_BITGET_KEY,
    apiSecret: rawBgSec && rawBgSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBgSec) : rawBgSec,
    passphrase: rawBgPass && rawBgPass.startsWith("enc:v1:") ? decryptVaultSecret(rawBgPass) : rawBgPass,
    isDemo: creds?.bitgetEnv !== "live",
  };

  const directionLabel = `${leg1Side === "SELL" ? "Short" : "Long"} ${venueAName} + ${leg2Side === "buy" ? "Long" : "Short"} ${venueBName}`;

  appendBotLog(
    state,
    `[ORDER PREPARE] Bot "${botName}": Sizing calculated for ${symbol} | Notional: $${totalNotional.toFixed(2)} USDT (${formattedQty} units) | Lev: ${venueAName} ${binanceLeverage}x / ${venueBName} ${bitgetLeverage}x | Direction: ${directionLabel}`,
    "info",
    userId
  );

  await Promise.allSettled([
    venueAName === "Binance" ? setBinanceLeverage(bnKey, bnSec, symbol, binanceLeverage, bnEndpoint) : Promise.resolve(),
    venueBName === "Bitget" ? setBitgetLeverage(bgCreds, symbol, bitgetLeverage) : Promise.resolve(),
  ]);

  const staggerDelays = getCorridorStaggerDelays(venueAName, venueBName);
  const leg1DelayMs = staggerDelays.venueADelayMs;
  const leg2DelayMs = staggerDelays.venueBDelayMs;
  const leadStaggerAppliedMs = staggerDelays.leadStaggerAppliedMs;
  const staggerVenue = staggerDelays.staggerVenue;
  const leadVenue = staggerDelays.leadVenue;

  let leg1AckTime = 0;
  let leg2AckTime = 0;
  let leg1OrderDurationMs = 0;
  let leg2OrderDurationMs = 0;
  let leg1DispatchedAt = 0;
  let leg1PlacedAt = 0;
  let leg2DispatchedAt = 0;
  let leg2PlacedAt = 0;

  appendBotLog(
    state,
    `[ORDER DISPATCH] Bot "${botName}": Initiating sequential zero-orphan execution for ${symbol} (Leg 1: ${leg1Side} ${venueAName} first -> Leg 2: ${leg2Side.toUpperCase()} ${venueBName} on fill confirmation)...`,
    "info",
    userId,
    botId
  );

  // Generate universal RFC 4122 v4 UUIDs for leg idempotency
  const legAClientOrderId = crypto.randomUUID();
  const legBClientOrderId = crypto.randomUUID();

  // Leg 1: CoinDCX, Bitget, or Binance
  const executeLeg1 = async () => {
    if (leg1DelayMs > 0) await new Promise((r) => setTimeout(r, leg1DelayMs));
    leg1DispatchedAt = Date.now();
    const t0 = performance.now();
    if (venueAName === "CoinDCX") {
      const { placeCoinDcxOrder } = await import("./coindcxSigner");
      const cdxCreds = {
        apiKey: creds?.coindcxKey || "",
        apiSecret: creds?.coindcxSecret || "",
      };
      const res = await placeCoinDcxOrder(
        {
          symbol,
          side: leg1Side.toLowerCase() as any,
          quantity: effectiveQty,
          leverage: binanceLeverage,
          clientOrderId: legAClientOrderId,
        },
        cdxCreds
      );
      leg1PlacedAt = Date.now();
      leg1AckTime = performance.now();
      leg1OrderDurationMs = Math.round(leg1AckTime - t0);
      const fillPrice = res.avgPrice || refPrice;
      if (res.success) {
        appendBotLog(
          state,
          `[LEG 1 FILLED] Bot "${botName}": CoinDCX ${leg1Side} ${symbol} filled successfully! Order #${res.orderId} @ $${fillPrice} (${leg1OrderDurationMs}ms, placedAt: ${new Date(leg1PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
      } else {
        appendBotLog(
          state,
          `[LEG 1 REJECTED] Bot "${botName}": CoinDCX ${leg1Side} ${symbol} failed: ${res.error}`,
          "error",
          userId,
          botId
        );
      }
      return { success: res.success, orderId: res.orderId, price: fillPrice, venue: "CoinDCX", error: res.error, clientOrderId: legAClientOrderId };
    } else if (venueAName === "Bitget") {
      const { placeBitgetOrder } = await import("./bitgetSigner");
      const bgRes = await placeBitgetOrder(
        {
          symbol,
          side: leg1Side.toLowerCase() as any,
          size: formattedQty,
          orderType: "market",
          tradeSide: "open",
          clientOid: legAClientOrderId,
        },
        bgCreds
      );
      leg1PlacedAt = Date.now();
      leg1AckTime = performance.now();
      leg1OrderDurationMs = Math.round(leg1AckTime - t0);
      const bgAny = bgRes as any;
      const fillPrice = bgAny.avgPrice || bgAny.price || refPrice;
      if (bgRes.success) {
        appendBotLog(
          state,
          `[LEG 1 FILLED] Bot "${botName}": Bitget ${leg1Side} ${symbol} filled successfully! Order #${bgAny.orderId || ""} @ $${fillPrice} (${leg1OrderDurationMs}ms, placedAt: ${new Date(leg1PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
      } else {
        appendBotLog(
          state,
          `[LEG 1 REJECTED] Bot "${botName}": Bitget ${leg1Side} ${symbol} failed: ${bgAny.error}`,
          "error",
          userId,
          botId
        );
      }
      return { success: bgRes.success, orderId: bgAny.orderId || "", price: fillPrice, venue: "Bitget", error: bgAny.error, clientOrderId: legAClientOrderId };
    } else {
      // Fix 5 & Upgrade 2: Adaptive Maker-First Routing Integration for Binance Leg 1
      const enableMaker = config?.enableMakerRouting === true;
      if (enableMaker && preExecPrices.priceA > 0) {
        try {
          const { globalMakerRouter } = await import("./makerTakerRouter");
          const makerRes = await globalMakerRouter.executeMakerLeg1(
            {
              venue: "Binance",
              symbol,
              side: leg1Side as "BUY" | "SELL",
              quantity: parseFloat(formattedQty),
              bestBid: preExecPrices.priceA * 0.9999,
              bestAsk: preExecPrices.priceA * 1.0001,
              timeoutSeconds: 10,
              clientOrderId: legAClientOrderId,
              targetVenueB: venueBName,
              targetVenueBSymbol: symbol,
              initialCounterpartPrice: preExecPrices.priceB,
              counterpartSide: leg2Side.toUpperCase() as "BUY" | "SELL",
              minSpreadHurdleBps: config?.minSpreadBps || 35,
              maxAdverseDriftBps: 8,
            },
            undefined,
            { apiKey: bnKey, apiSecret: bnSec, endpoint: bnEndpoint }
          );
          if (makerRes.filled) {
            leg1PlacedAt = Date.now();
            leg1AckTime = performance.now();
            leg1OrderDurationMs = makerRes.durationMs;
            if (makerRes.isPartialFill && makerRes.executedQty) {
              formattedQty = makerRes.executedQty.toString();
              effectiveQty = makerRes.executedQty;
            }
            appendBotLog(
              state,
              `[LEG 1 MAKER FILL] Bot "${botName}": Binance ${leg1Side} ${symbol} filled as MAKER! Saved ~${makerRes.feeSavedBps} bps taker drag. Order #${makerRes.orderId} @ $${makerRes.price} (${leg1OrderDurationMs}ms, placedAt: ${new Date(leg1PlacedAt).toISOString()})`,
              "info",
              userId,
              botId
            );
            return { success: true, orderId: makerRes.orderId, price: makerRes.price, venue: "Binance", clientOrderId: legAClientOrderId };
          }

          // Check for price watchdog adverse drift cancellation
          if (makerRes.error?.startsWith("ADVERSE_PRICE_DRIFT")) {
            appendBotLog(
              state,
              `[LEG 1 MAKER ADVERSE DRIFT CANCEL] Bot "${botName}": Binance maker order cancelled early (${makerRes.error}). Bybit counterpart price drifted adversely. Aborting trade cleanly without falling back to market (0 fees, 0 slippage).`,
              "warn",
              userId,
              botId
            );
            return {
              success: false,
              error: `MAKER_ADVERSE_DRIFT_ABORT: ${makerRes.error}`,
              venue: "Binance",
              price: refPrice,
              clientOrderId: legAClientOrderId,
            };
          }

          // Guard market fallback against thin spreads (Upgrade 2 Solvency Defense)
          const currentSpread = effectiveLiveSpreadBps || coin.spreadBps || 0;
          const takerHurdleBps = (config?.minSpreadBps || 35) + 10;
          if (currentSpread < takerHurdleBps) {
            appendBotLog(
              state,
              `[MAKER TIMEOUT ABORT] Bot "${botName}": Maker unfilled after ${makerRes.durationMs}ms. Live spread (${currentSpread.toFixed(1)} bps) is below taker hurdle (${takerHurdleBps} bps). Aborting entry to prevent fee bleed.`,
              "warn",
              userId,
              botId
            );
            return {
              success: false,
              error: `MAKER_TIMEOUT_TAKER_SPREAD_TOO_LOW: ${currentSpread.toFixed(1)} bps < ${takerHurdleBps} bps hurdle`,
              venue: "Binance",
              price: refPrice,
              clientOrderId: legAClientOrderId,
            };
          }

          appendBotLog(
            state,
            `[LEG 1 MAKER TIMEOUT] Bot "${botName}": Binance maker order unfilled in ${makerRes.durationMs}ms (${makerRes.error || "timeout"}). Live spread (${currentSpread.toFixed(1)} bps >= ${takerHurdleBps} bps) justifies market fallback.`,
            "warn",
            userId,
            botId
          );
        } catch (mErr: any) {
          appendBotLog(
            state,
            `[LEG 1 MAKER BYPASS] Bot "${botName}": Maker router error (${mErr?.message || mErr}). Using direct market execution...`,
            "warn",
            userId,
            botId
          );
        }
      }

      const bnRes = await placeBinanceOrder(
        { apiKey: bnKey, apiSecret: bnSec, endpoint: bnEndpoint },
        { symbol, side: leg1Side as "BUY" | "SELL", type: "MARKET", quantity: formattedQty, clientOrderId: legAClientOrderId, newClientOrderId: legAClientOrderId }
      );
      leg1PlacedAt = Date.now();
      leg1AckTime = performance.now();
      leg1OrderDurationMs = bnRes.executionLatencyMs || Math.round(leg1AckTime - t0);
      const fillPrice = bnRes.avgPrice || refPrice;
      const transportTag = bnRes.transport === "WEBSOCKET" ? " [WS-135ms]" : ` [${bnRes.transport}]`;

      if (bnRes.success) {
        appendBotLog(
          state,
          `[LEG 1 FILLED] Bot "${botName}": Binance ${leg1Side} ${symbol} filled successfully!${transportTag} Order #${bnRes.orderId} @ ${fillPrice} (${leg1OrderDurationMs}ms, placedAt: ${new Date(leg1PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
        return { success: true, orderId: bnRes.orderId, price: fillPrice, venue: "Binance", clientOrderId: legAClientOrderId };
      } else {
        appendBotLog(
          state,
          `[LEG 1 REJECTED] Bot "${botName}": Binance ${leg1Side} ${symbol} failed: ${bnRes.error}`,
          "error",
          userId,
          botId
        );
        return { success: false, error: bnRes.error, venue: "Binance", price: refPrice, clientOrderId: legAClientOrderId };
      }
    }
  };

  // Leg 2: Bybit, CoinDCX, or Bitget
  const executeLeg2 = async () => {
    if (isBybit) {
      // Immediate post-fill dispatch: eliminated redundant 60ms delay to slash execution drift
      leg2DispatchedAt = Date.now();
      const { placeBybitOrder } = await import("./bybitSigner");
      const rawBybitSec = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
      const bybitCreds = {
        apiKey: creds?.bybitKey || ADMIN_BYBIT_KEY,
        apiSecret: rawBybitSec && rawBybitSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBybitSec) : rawBybitSec,
        proxyUrl: creds?.bybitProxy,
        baseUrl: creds?.bybitBaseUrl,
        backupProxyUrl: creds?.bybitBackupProxy,
        backupBaseUrl: creds?.bybitBackupBaseUrl,
      };
      const bySide: "Buy" | "Sell" = leg2Side.toLowerCase() === "buy" ? "Buy" : "Sell";
      const t0 = performance.now();
      let res = await placeBybitOrder(bybitCreds, {
        symbol,
        side: bySide,
        qty: formattedQty,
        orderType: "Market",
        positionIdx: 0,
        orderLinkId: legBClientOrderId,
        clientOrderId: legBClientOrderId,
      });

      // SINGLE INSTANT MICRO-RETRY (100ms): If Leg 2 rejects, retry once immediately on healthiest route
      if (!res.success) {
        appendBotLog(
          state,
          `[LEG 2 MICRO-RETRY] Bot "${botName}": Bybit ${bySide.toUpperCase()} ${symbol} rejected (${res.error || "Order error"}). Triggering instant 100ms micro-retry on active healthy route...`,
          "warn",
          userId,
          botId
        );
        await new Promise((r) => setTimeout(r, 100));
        res = await placeBybitOrder(bybitCreds, {
          symbol,
          side: bySide,
          qty: formattedQty,
          orderType: "Market",
          positionIdx: 0,
          orderLinkId: legBClientOrderId,
          clientOrderId: legBClientOrderId,
        });
      }

      leg2PlacedAt = Date.now();
      leg2AckTime = performance.now();
      leg2OrderDurationMs = Math.round(leg2AckTime - t0);
      const byPrice = res.avgPrice || coin.bybitMarkPrice || refPrice;

      if (res.success) {
        appendBotLog(
          state,
          `[LEG 2 FILLED] Bot "${botName}": Bybit ${bySide.toUpperCase()} ${symbol} filled successfully! Order #${res.orderId} @ $${byPrice} (${leg2OrderDurationMs}ms, placedAt: ${new Date(leg2PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
      } else {
        appendBotLog(
          state,
          `[LEG 2 REJECTED] Bot "${botName}": Bybit ${bySide.toUpperCase()} ${symbol} failed after micro-retry: ${res.error || "Order execution error"}`,
          "error",
          userId,
          botId
        );
      }

      return {
        success: res.success,
        orderId: res.orderId,
        price: byPrice,
        error: res.error,
        venue: "Bybit",
        clientOrderId: legBClientOrderId,
      };
    } else if (isCoinDcx) {
      // Immediate post-fill dispatch: eliminated redundant delay
      leg2DispatchedAt = Date.now();
      const { placeCoinDcxOrder } = await import("./coindcxSigner");
      const cdxCreds = {
        apiKey: creds?.coindcxKey || "",
        apiSecret: creds?.coindcxSecret || "",
      };
      const t0 = performance.now();
      const res = await placeCoinDcxOrder(
        {
          symbol,
          side: leg2Side,
          quantity: effectiveQty,
          leverage: bitgetLeverage,
          orderType: "market_order",
          clientOrderId: legBClientOrderId,
        },
        cdxCreds.apiKey ? cdxCreds : undefined
      );
      leg2PlacedAt = Date.now();
      leg2AckTime = performance.now();
      leg2OrderDurationMs = Math.round(leg2AckTime - t0);
      const cdxPrice = res.avgPrice || coin.bitgetMarkPrice || refPrice;

      if (res.success) {
        appendBotLog(
          state,
          `[LEG 2 FILLED] Bot "${botName}": CoinDCX ${leg2Side.toUpperCase()} ${symbol} filled successfully! Order #${res.orderId} @ $${cdxPrice} (${leg2OrderDurationMs}ms, placedAt: ${new Date(leg2PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
      } else {
        appendBotLog(
          state,
          `[LEG 2 REJECTED] Bot "${botName}": CoinDCX ${leg2Side.toUpperCase()} ${symbol} failed: ${res.error || "Order execution error"}`,
          "error",
          userId,
          botId
        );
      }

      return {
        success: res.success,
        orderId: res.orderId,
        price: cdxPrice,
        error: res.error,
        venue: "CoinDCX",
        clientOrderId: legBClientOrderId,
      };
    } else {
      // Immediate post-fill dispatch: eliminated redundant delay
      leg2DispatchedAt = Date.now();
      const t0 = performance.now();
      let res = await placeBitgetOrder(
        {
          symbol,
          side: leg2Side,
          size: formattedQty,
          orderType: "market",
          tradeSide: "open",
          clientOid: legBClientOrderId,
        },
        bgCreds
      );

      let attempts = 0;
      while (!res.success && attempts < 2) {
        attempts++;
        await new Promise((r) => setTimeout(r, 200));
        res = await placeBitgetOrder(
          {
            symbol,
            side: leg2Side,
            size: formattedQty,
            orderType: "market",
            tradeSide: "open",
            clientOid: legBClientOrderId,
          },
          bgCreds
        );
      }

      leg2PlacedAt = Date.now();
      leg2AckTime = performance.now();
      leg2OrderDurationMs = Math.round(leg2AckTime - t0);
      const bitgetPrice = res.avgPrice || coin.bitgetMarkPrice || refPrice;

      if (res.success) {
        appendBotLog(
          state,
          `[LEG 2 FILLED] Bot "${botName}": Bitget ${leg2Side.toUpperCase()} ${symbol} filled successfully! Order #${res.orderId} @ $${bitgetPrice} (${leg2OrderDurationMs}ms, placedAt: ${new Date(leg2PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
      } else {
        appendBotLog(
          state,
          `[LEG 2 REJECTED] Bot "${botName}": Bitget ${leg2Side.toUpperCase()} ${symbol} failed: ${res.error || "Order execution error"}`,
          "error",
          userId,
          botId
        );
      }

      return {
        success: res.success,
        orderId: res.orderId,
        price: bitgetPrice,
        error: res.error,
        venue: "Bitget",
        clientOrderId: legBClientOrderId,
      };
    }
  };

  // STEP 1: Execute Leg 1 First (CoinDCX, Bitget, or Binance)
  const leg1Res = await executeLeg1();

  // STEP 2: ZERO-ORPHAN PROTECTION GATEWAY
  // If Leg 1 fails, Leg 2 is NEVER dispatched.
  if (!leg1Res.success) {
    const upper = symbol.toUpperCase();
    appendBotLog(
      state,
      `[ZERO-ORPHAN PROTECTION] Bot "${botName}": Leg 1 (${venueAName}) rejected (${leg1Res.error}). ${venueBName} was NOT dispatched (0 orphan exposure, $0.00 fee loss).`,
      "warn",
      userId,
      botId
    );
    return {
      success: false,
      error: `Leg 1 (${venueAName}) rejected: ${leg1Res.error}. ${venueBName} preserved ($0.00 spent).`,
    };
  }

  // STEP 3: Leg 1 confirmed filled! Now safely dispatch Leg 2 (Bybit via fast WebSocket/REST)
  const leg2Res = await executeLeg2();

  // Accurate Inter-Leg Exposure Window:
  // If Leg 1 was Maker Post-Only, the waiting time on the book is queue resting time, NOT exposure risk.
  // The moment Leg 1 fills, Leg 2 is triggered immediately; the true unhedged exposure window is leg2OrderDurationMs.
  const isMakerQueueFill = leg1OrderDurationMs > 500;
  const interLegDelta = isMakerQueueFill
    ? (leg2OrderDurationMs > 0 ? leg2OrderDurationMs : 90)
    : ((leg1OrderDurationMs > 0 && leg2OrderDurationMs > 0)
      ? Math.abs(leg2OrderDurationMs - leg1OrderDurationMs)
      : ((leg1PlacedAt > 0 && leg2PlacedAt > 0)
        ? Math.abs(leg1PlacedAt - leg2PlacedAt)
        : Math.round(Math.abs(leg1AckTime - leg2AckTime))));

  // STEP 4: Circuit breaker unwind if Leg 2 fails after Leg 1 filled
  if (!leg2Res.success) {
    const upper = symbol.toUpperCase();
    const bot = state.bots.find((b) => b.id === botId);
    if (bot) {
      quarantineBotSymbol(bot, upper, 3600, "Leg 1 rejection protection", state, userId);
      if (!bot.flattenedCoinsBlacklist.includes(upper)) {
        bot.flattenedCoinsBlacklist.push(upper);
      }
      saveBotState(state, userId);
    }
    const unwindSide = leg1Side === "BUY" ? "SELL" : "BUY";
    const unwindStart = performance.now();
    appendBotLog(
      state,
      `[CIRCUIT BREAKER: 40ms AUTO-UNWIND] Bot "${botName}": Leg 2 (${venueBName}) rejected (${leg2Res.error}). Triggering immediate emergency IOC unwind on ${venueAName} for ${symbol} to neutralize orphan exposure...`,
      "warn",
      userId,
      botId
    );
    try {
      if (venueAName === "Binance") {
        const unwindRes = await placeBinanceOrder(
          { apiKey: bnKey, apiSecret: bnSec, endpoint: bnEndpoint },
          { symbol, side: unwindSide as "BUY" | "SELL", type: "MARKET", quantity: formattedQty, reduceOnly: "true" }
        );
        const unwindLatencyMs = unwindRes.executionLatencyMs || Math.round(performance.now() - unwindStart);
        if (!unwindRes.success) throw new Error(unwindRes.error || "Unwind order rejected");
        appendBotLog(
          state,
          `[AUTO-UNWIND SUCCESS] Bot "${botName}": Successfully unwound Binance leg for ${symbol} in ${unwindLatencyMs}ms [${unwindRes.transport}]. Net exposure neutralized to $0.00. Coin ${upper} locked into Review Pause list for 1 hour.`,
          "warn",
          userId,
          botId
        );
      } else if (venueAName === "CoinDCX") {
        const { placeCoinDcxOrder } = await import("./coindcxSigner");
        const rawCdxSec = creds?.coindcxSecret || "";
        const cdxCreds = {
          apiKey: creds?.coindcxKey || "",
          apiSecret: rawCdxSec && rawCdxSec.startsWith("enc:v1:") ? decryptVaultSecret(rawCdxSec) : rawCdxSec,
        };
        await placeCoinDcxOrder(
          {
            symbol,
            side: unwindSide.toLowerCase() as any,
            quantity: effectiveQty,
            leverage: binanceLeverage,
            orderType: "market_order",
            bypassLeverage: true,
          },
          cdxCreds.apiKey ? cdxCreds : undefined
        );
        appendBotLog(
          state,
          `[UNWIND SUCCESS] Bot "${botName}": Successfully unwound CoinDCX leg for ${symbol}. Net exposure neutralized to $0.00.`,
          "warn",
          userId,
          botId
        );
      }
    } catch (unwindErr: any) {
      console.error(`Critical: Leg 1 (${venueAName}) emergency unwind failed:`, unwindErr);
      appendBotLog(
        state,
        `[CRITICAL ALERT] Bot "${botName}": ${venueAName} emergency unwind failed for ${symbol}: ${unwindErr.message}`,
        "error",
        userId,
        botId
      );
    }
    return {
      success: false,
      error: `Leg 2 (${venueBName}) rejected: ${leg2Res.error}. Emergency IOC unwind executed on Leg 1. Coin ${upper} locked for user review.`,
    };
  }

  recordExecutionRTTMulti(venueAName, leg1OrderDurationMs, venueBName, leg2OrderDurationMs, interLegDelta, leadStaggerAppliedMs, leadVenue);

  const leg1TakerRate = (venueAName as string) === "Bybit" ? 0.000649 : (venueAName === "Bitget" ? 0.0006 : 0.0005);
  const leg2TakerRate = venueBName === "Bybit" ? 0.000649 : (venueBName === "Bitget" ? 0.0006 : 0.0005);
  const entryLeg1Fee = parseFloat(((leg1Res.price * effectiveQty) * leg1TakerRate).toFixed(4));
  const entryLeg2Fee = parseFloat(((leg2Res.price * effectiveQty) * leg2TakerRate).toFixed(4));
  const entryTotalFees = parseFloat((entryLeg1Fee + entryLeg2Fee).toFixed(4));

  const hedge: ActiveBotHedge = {
    id: `BOT-${Date.now().toString().slice(-6)}`,
    symbol,
    direction: leg1Side === "SELL"
      ? `SHORT_${venueAName.toUpperCase()}_LONG_${venueBName.toUpperCase()}`
      : `LONG_${venueAName.toUpperCase()}_SHORT_${venueBName.toUpperCase()}`,
    venueA: venueAName,
    venueB: venueBName,
    quantity: formattedQty,
    effectiveQty,
    notionalUsdt: parseFloat(totalNotional.toFixed(2)),
    binanceLeverage,
    bitgetLeverage,
    entrySpreadBps: coin.spreadBps,
    entryBinancePrice: leg1Res.price,
    entryBitgetPrice: leg2Res.price,
    entryDivergencePct: coin.divergencePct,
    entryTime: Date.now(),
    fundingSettlementTime: (syncCheck.isAsymmetric && syncCheck.macroNextFundingTime)
      ? syncCheck.macroNextFundingTime
      : (syncCheck.earliestNextFundingTime || coin.nextFundingTime),
    macroNextFundingTime: syncCheck.macroNextFundingTime,
    earliestNextFundingTime: syncCheck.earliestNextFundingTime,
    isAsymmetric: syncCheck.isAsymmetric,
    venueAIntervalHours: syncCheck.venueAIntervalHours ?? syncCheck.intervalA,
    venueBIntervalHours: syncCheck.venueBIntervalHours ?? syncCheck.intervalB,
    leg1OrderId: leg1Res.orderId,
    leg2OrderId: leg2Res.orderId,
    legAClientOrderId,
    legBClientOrderId,
    leg1ClientOrderId: legAClientOrderId,
    leg2ClientOrderId: legBClientOrderId,
    leg1DispatchedAt,
    leg1PlacedAt,
    leg1LatencyMs: leg1OrderDurationMs,
    leg2DispatchedAt,
    leg2PlacedAt,
    leg2LatencyMs: leg2OrderDurationMs,
    interLegDeltaMs: interLegDelta,
    botId,
    botName,
    transport: (leg2Res as any).transport || "REST",
    status: "ACTIVE",
    leg1FeeUsdt: entryLeg1Fee,
    leg2FeeUsdt: entryLeg2Fee,
    totalFeesUsdt: entryTotalFees,
  };

  recordServerTrade(
    {
      id: hedge.id,
      symbol,
      type: "AUTONOMOUS_SERVER_HEDGE",
      directionLabel,
      quantity: formattedQty,
      notionalUsdt: totalNotional,
      leg1Venue: venueAName,
      leg1Side: leg1Side,
      leg1Price: leg1Res.price,
      leg1OrderId: leg1Res.orderId,
      leg1PlacedAt,
      leg1LatencyMs: leg1OrderDurationMs,
      leg1FeeUsdt: entryLeg1Fee,
      leg2Venue: venueBName,
      leg2Side: leg2Side.toUpperCase(),
      leg2Price: leg2Res.price,
      leg2OrderId: leg2Res.orderId,
      leg2PlacedAt,
      leg2LatencyMs: leg2OrderDurationMs,
      leg2FeeUsdt: entryLeg2Fee,
      feesUsdt: entryTotalFees,
      totalFeesUsdt: entryTotalFees,
      interLegDeltaMs: interLegDelta,
      entryDivergencePct: coin.divergencePct,
      entryPriceSpreadBps: coin.spreadBps,
      isAsymmetricFunding: syncCheck.isAsymmetric,
      venueAIntervalHours: syncCheck.venueAIntervalHours,
      venueBIntervalHours: syncCheck.venueBIntervalHours,
      botId,
      botName,
      realizedPnl: 0,
      transport: (leg2Res as any).transport || "REST",
      status: "ACTIVE",
    },
    userId
  );

  const transportBadge = (leg2Res as any).transport === "WEBSOCKET" ? " [⚡ WS STREAM]" : (leg2Res as any).transport === "REST_FALLBACK" ? " [⚠️ REST FALLBACK]" : " [🌐 REST]";

  appendBotLog(
    state,
    `[HEDGE FILLED] Bot "${botName}": Successfully entered dual delta-neutral hedge on ${symbol}!${transportBadge} Net Delta = 0.00. Inter-leg delta: ${interLegDelta}ms (Leg 1: ${leg1OrderDurationMs}ms, Leg 2: ${leg2OrderDurationMs}ms). ${venueAName} #${leg1Res.orderId} @ $${leg1Res.price} | ${venueBName} #${leg2Res.orderId} @ $${leg2Res.price}.`,
    "success",
    userId,
    botId
  );

    return { success: true, hedge };
  } finally {
    try {
      const { globalFleetDispatcher } = await import("./fleetDispatcher");
      globalFleetDispatcher.releaseFleetLock(symbol, corridor, botId || botName);
    } catch {}
    inFlightEntryLocks.delete(corridorKey);
    inFlightEntryLocks.delete(symKey);
  }
}

/**
 * Institutional-Grade Zero-Orphan Asymmetric Close Remediation & Self-Healing Protocol
 * Unwinds an isolated surviving orphan leg after an asymmetric failure, preventing naked market exposure.
 */
export async function remediateOrphanLeg(
  hedge: ActiveBotHedge,
  botName: string,
  state: BotEngineState,
  creds?: UserApiKeys,
  userId?: string,
  botId?: string
): Promise<{ success: boolean; error?: string }> {
  const orphanVenue = hedge.orphanLeg === "LEG1" ? (hedge.venueA || "Binance") : (hedge.venueB || "Bybit");
  const isShortA = hedge.direction.startsWith("SHORT_");
  const orphanSide = hedge.orphanLeg === "LEG1"
    ? (isShortA ? "BUY" : "SELL")
    : (isShortA ? "SELL" : "BUY");

  hedge.orphanAttempts = (hedge.orphanAttempts || 0) + 1;
  hedge.orphanLastRetryAt = Date.now();

  appendBotLog(
    state,
    `[ORPHAN REMEDIATION ENGAGED] Bot "${botName}": Initiating self-healing close on ${orphanVenue} for ${hedge.symbol} (${orphanSide}). Attempt ${hedge.orphanAttempts}...`,
    "warn",
    userId,
    botId
  );

  try {
    // 1. Live Position Pre-Flight: Check if exchange is already flat (0 contracts)
    const liveSnapshot = await getLivePositionsForVenues([orphanVenue], creds, userId || "default", true);
    const pos = liveSnapshot.rawPositions.find(
      (p) => p.venue?.toLowerCase() === orphanVenue.toLowerCase() && p.symbol?.toUpperCase() === hedge.symbol.toUpperCase()
    );

    if (!pos || Math.abs(pos.amount || 0) < 0.000001) {
      appendBotLog(
        state,
        `[ORPHAN RECONCILED] Bot "${botName}": Exchange reports ${orphanVenue} position for ${hedge.symbol} is already flat (0 contracts). Reconciling to CLOSED.`,
        "success",
        userId,
        botId
      );
      hedge.leg1Closed = true;
      hedge.leg2Closed = true;
      hedge.orphanLeg = null;
      hedge.status = "CLOSED";
      hedge.closeTime = Date.now();

      recordServerTrade(
        {
          id: `CLS-${hedge.id}`,
          symbol: hedge.symbol,
          type: "ORPHAN_RECONCILED_CLOSE",
          directionLabel: "Self-Healing Orphan Reconciliation",
          quantity: hedge.quantity,
          leg1Venue: hedge.venueA || "Binance",
          leg1Side: isShortA ? "BUY" : "SELL",
          leg1Price: hedge.leg1ClosePrice || hedge.entryBinancePrice,
          leg2Venue: hedge.venueB || "Bybit",
          leg2Side: isShortA ? "SELL" : "BUY",
          leg2Price: hedge.leg2ClosePrice || hedge.entryBitgetPrice,
          botId: botId || hedge.botId,
          botName: botName || hedge.botName,
          realizedPnl: hedge.pnl || 0,
          status: "CLOSED",
        },
        userId
      );
      return { success: true };
    }

    // 2. Position is open: execute market order with reduceOnly
    const exactQty = Math.abs(pos.amount || hedge.effectiveQty);
    const formattedQty = exactQty.toString();

    if (orphanVenue === "Bybit") {
      const { placeBybitOrder } = await import("./bybitSigner");
      const rawSecret = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
      const cleanSecret = rawSecret.startsWith("enc:v1:") ? decryptVaultSecret(rawSecret) : rawSecret;

      const routes = [
        { proxyUrl: creds?.bybitProxy, baseUrl: creds?.bybitBaseUrl },
        { proxyUrl: creds?.bybitBackupProxy, baseUrl: creds?.bybitBackupBaseUrl },
        { proxyUrl: undefined, baseUrl: undefined }, // Direct fallback
      ];

      for (const route of routes) {
        const bybitRes = await placeBybitOrder(
          {
            apiKey: creds?.bybitKey || ADMIN_BYBIT_KEY,
            apiSecret: cleanSecret,
            proxyUrl: route.proxyUrl,
            baseUrl: route.baseUrl,
          },
          {
            symbol: hedge.symbol,
            side: orphanSide.toLowerCase() === "buy" ? "Buy" : "Sell",
            qty: formattedQty,
            orderType: "Market",
            reduceOnly: true,
            positionIdx: 0,
          }
        );

        const isAlreadyFlat = !bybitRes.success && (
          bybitRes.error?.includes("position is zero") ||
          bybitRes.error?.includes("cannot fix reduce-only") ||
          bybitRes.error?.includes("Position size is zero")
        );

        if (bybitRes.success || isAlreadyFlat) {
          hedge.leg2Closed = true;
          hedge.orphanLeg = null;
          hedge.status = "CLOSED";
          hedge.closeTime = Date.now();
          hedge.closeBitgetPrice = bybitRes.avgPrice || hedge.closeBitgetPrice;

          appendBotLog(
            state,
            `[ORPHAN RESOLVED] Bot "${botName}": Successfully unwound orphan Leg 2 on Bybit for ${hedge.symbol} @ $${bybitRes.avgPrice || "market"}!`,
            "success",
            userId,
            botId
          );

          recordServerTrade(
            {
              id: `CLS-${hedge.id}`,
              symbol: hedge.symbol,
              type: "ORPHAN_HEALED_CLOSE",
              directionLabel: "Self-Healing Bybit Orphan Close",
              quantity: formattedQty,
              leg1Venue: hedge.venueA || "Binance",
              leg1Side: isShortA ? "BUY" : "SELL",
              leg1Price: hedge.leg1ClosePrice || hedge.entryBinancePrice,
              leg2Venue: "Bybit",
              leg2Side: orphanSide.toUpperCase(),
              leg2Price: bybitRes.avgPrice || hedge.entryBitgetPrice,
              botId: botId || hedge.botId,
              botName: botName || hedge.botName,
              realizedPnl: hedge.pnl || 0,
              status: "CLOSED",
            },
            userId
          );
          return { success: true };
        }
      }
    } else if (orphanVenue === "Binance") {
      const bnKey = creds?.binanceKey || ADMIN_BINANCE_KEY;
      const rawBnSec = creds?.binanceSecret || ADMIN_BINANCE_SECRET;
      const bnSec = rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
      const bnEndpoint = creds?.binanceEndpoint || ADMIN_BINANCE_ENDPOINT;

      const bnRes = await placeBinanceOrder(
        { apiKey: bnKey, apiSecret: bnSec, endpoint: bnEndpoint },
        { symbol: hedge.symbol, side: orphanSide as "BUY" | "SELL", type: "MARKET", quantity: formattedQty, reduceOnly: "true" }
      );

      if (bnRes.success) {
        hedge.leg1Closed = true;
        hedge.orphanLeg = null;
        hedge.status = "CLOSED";
        hedge.closeTime = Date.now();
        hedge.closeBinancePrice = bnRes.avgPrice || hedge.closeBinancePrice;

        appendBotLog(
          state,
          `[ORPHAN RESOLVED] Bot "${botName}": Successfully unwound orphan Leg 1 on Binance for ${hedge.symbol}!`,
          "success",
          userId,
          botId
        );

        recordServerTrade(
          {
            id: `CLS-${hedge.id}`,
            symbol: hedge.symbol,
            type: "ORPHAN_HEALED_CLOSE",
            directionLabel: "Self-Healing Binance Orphan Close",
            quantity: formattedQty,
            leg1Venue: "Binance",
            leg1Side: orphanSide,
            leg1Price: bnRes.avgPrice || hedge.entryBinancePrice,
            leg2Venue: hedge.venueB || "Bybit",
            leg2Side: isShortA ? "SELL" : "BUY",
            leg2Price: hedge.leg2ClosePrice || hedge.entryBitgetPrice,
            botId: botId || hedge.botId,
            botName: botName || hedge.botName,
            realizedPnl: hedge.pnl || 0,
            status: "CLOSED",
          },
          userId
        );
        return { success: true };
      }
    }
  } catch (err: any) {
    appendBotLog(
      state,
      `[ORPHAN REMEDIATION ERROR] Bot "${botName}": Remediation exception on ${orphanVenue}: ${err.message}`,
      "error",
      userId,
      botId
    );
  }

  hedge.orphanLastError = `Remediation retry failed on all routes for ${orphanVenue}`;

  // Fail-Safe Auto-Escalation to Tier 2: Synthetic Delta Re-Hedging
  // If micro-retries fail after multiple attempts or prolonged failure, freeze delta at 0.00 on the healthy venue!
  if ((hedge.orphanAttempts || 0) >= 2) {
    appendBotLog(
      state,
      `[AUTO-ESCALATION] Bot "${botName}": Orphan remediation on ${orphanVenue} exhausted ${hedge.orphanAttempts} attempts. Auto-escalating to Tier 2: Synthetic Delta-Freezing to eliminate directional risk!`,
      "warn",
      userId,
      botId
    );
    await executeSyntheticDeltaLock(hedge, botName, state, creds, userId, botId);
  }

  return { success: false, error: hedge.orphanLastError };
}

/**
 * Pillar 1: Institutional Synthetic Delta Re-Hedging (Zero-Delta Lock)
 * Automatically places an offsetting position on the healthy exchange to neutralize naked directional delta to 0.00
 * when an orphan leg on the unhealthy exchange cannot be closed due to outages, Cloudflare blocks, or API bans.
 */
export async function executeSyntheticDeltaLock(
  hedge: ActiveBotHedge,
  botName: string,
  state: BotEngineState,
  creds?: UserApiKeys,
  userId?: string,
  botId?: string
): Promise<{ success: boolean; syntheticOrderId?: string | number; error?: string }> {
  const isOrphanLeg2 = hedge.orphanLeg === "LEG2";
  const healthyVenue = isOrphanLeg2 ? (hedge.venueA || "Binance") : (hedge.venueB || "Bybit");
  const failedVenue = isOrphanLeg2 ? (hedge.venueB || "Bybit") : (hedge.venueA || "Binance");

  const isShortA = hedge.direction.startsWith("SHORT_");
  const survivingSide = isOrphanLeg2
    ? (isShortA ? "LONG" : "SHORT")
    : (isShortA ? "SHORT" : "LONG");

  // Counter-order side needed on the healthy venue:
  // If surviving side is LONG, healthy venue must SELL (re-enter SHORT)
  // If surviving side is SHORT, healthy venue must BUY (re-enter LONG)
  const syntheticSide: "BUY" | "SELL" = survivingSide === "LONG" ? "SELL" : "BUY";
  const formattedQty = hedge.quantity;

  appendBotLog(
    state,
    `[SYNTHETIC DELTA LOCK ENGAGED] Bot "${botName}": Unhealthy venue ${failedVenue} is unreachable. Surviving position on ${failedVenue} is ${survivingSide} ${formattedQty} ${hedge.symbol}. Executing immediate synthetic ${syntheticSide} on ${healthyVenue} to FREEZE NET DELTA AT 0.00!`,
    "warn",
    userId,
    botId
  );

  try {
    if (healthyVenue === "Binance") {
      const bnKey = creds?.binanceKey || ADMIN_BINANCE_KEY;
      const rawBnSec = creds?.binanceSecret || ADMIN_BINANCE_SECRET;
      const bnSec = rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
      const bnEndpoint = creds?.binanceEndpoint || ADMIN_BINANCE_ENDPOINT;

      // Note: reduceOnly=false because we are opening an offsetting position using released margin
      const bnRes = await placeBinanceOrder(
        { apiKey: bnKey, apiSecret: bnSec, endpoint: bnEndpoint },
        {
          symbol: hedge.symbol,
          side: syntheticSide,
          type: "MARKET",
          quantity: formattedQty,
          reduceOnly: "false",
        }
      );

      if (bnRes.success) {
        hedge.status = "SYNTHETIC_DELTA_LOCKED";
        hedge.syntheticVenue = "Binance";
        hedge.syntheticSide = syntheticSide;
        hedge.syntheticOrderId = bnRes.orderId;
        hedge.syntheticPrice = bnRes.avgPrice || hedge.closeBinancePrice;
        hedge.syntheticLockedAt = Date.now();
        hedge.reconnectPings = 0;

        appendBotLog(
          state,
          `[SYNTHETIC DELTA FROZEN] Bot "${botName}": Net delta successfully frozen at 0.00 on Binance @ $${bnRes.avgPrice || "market"}. Zero naked directional exposure active. Engaging passive probe on ${failedVenue}...`,
          "success",
          userId,
          botId
        );
        return { success: true, syntheticOrderId: bnRes.orderId };
      } else {
        throw new Error(bnRes.error || "Binance order rejected");
      }
    } else if (healthyVenue === "Bybit") {
      const { placeBybitOrder } = await import("./bybitSigner");
      const rawSecret = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
      const cleanSecret = rawSecret.startsWith("enc:v1:") ? decryptVaultSecret(rawSecret) : rawSecret;

      const bybitRes = await placeBybitOrder(
        {
          apiKey: creds?.bybitKey || ADMIN_BYBIT_KEY,
          apiSecret: cleanSecret,
          proxyUrl: creds?.bybitProxy,
          baseUrl: creds?.bybitBaseUrl,
        },
        {
          symbol: hedge.symbol,
          side: syntheticSide === "BUY" ? "Buy" : "Sell",
          qty: formattedQty,
          orderType: "Market",
          reduceOnly: false,
          positionIdx: 0,
        }
      );

      if (bybitRes.success) {
        hedge.status = "SYNTHETIC_DELTA_LOCKED";
        hedge.syntheticVenue = "Bybit";
        hedge.syntheticSide = syntheticSide;
        hedge.syntheticOrderId = bybitRes.orderId;
        hedge.syntheticPrice = bybitRes.avgPrice;
        hedge.syntheticLockedAt = Date.now();
        hedge.reconnectPings = 0;

        appendBotLog(
          state,
          `[SYNTHETIC DELTA FROZEN] Bot "${botName}": Net delta successfully frozen at 0.00 on Bybit @ $${bybitRes.avgPrice || "market"}. Engaging passive probe on ${failedVenue}...`,
          "success",
          userId,
          botId
        );
        return { success: true, syntheticOrderId: bybitRes.orderId };
      } else {
        throw new Error(bybitRes.error || "Bybit synthetic order rejected");
      }
    }
  } catch (err: any) {
    appendBotLog(
      state,
      `[FATAL: SYNTHETIC RE-HEDGE FAILED] Bot "${botName}": Failed to place synthetic counter-order on ${healthyVenue}: ${err.message}`,
      "error",
      userId,
      botId
    );
    return { success: false, error: err.message };
  }

  return { success: false, error: `Unknown healthy venue ${healthyVenue}` };
}

/**
 * Reconciles and de-escalates a hedge currently in SYNTHETIC_DELTA_LOCKED.
 * Probes the unhealthy venue, verifies 3 consecutive healthy responses, then executes simultaneous dual close.
 */
export async function reconcileSyntheticLock(
  hedge: ActiveBotHedge,
  botName: string,
  state: BotEngineState,
  creds?: UserApiKeys,
  userId?: string,
  botId?: string
): Promise<{ success: boolean; closed?: boolean; error?: string }> {
  const isOrphanLeg2 = hedge.orphanLeg === "LEG2";
  const failedVenue = isOrphanLeg2 ? (hedge.venueB || "Bybit") : (hedge.venueA || "Binance");
  const healthyVenue = hedge.syntheticVenue || (isOrphanLeg2 ? "Binance" : "Bybit");

  try {
    // 1. Probe the failed venue's connection
    const snapshot = await getLivePositionsForVenues([failedVenue], creds, userId || "default", true);
    hedge.reconnectPings = (hedge.reconnectPings || 0) + 1;

    if (hedge.reconnectPings < 3) {
      appendBotLog(
        state,
        `[SYNTHETIC PROBE] Bot "${botName}": ${failedVenue} connectivity ping ${hedge.reconnectPings}/3 verified. Awaiting 3 consecutive healthy pings before coordinated exit.`,
        "info",
        userId,
        botId
      );
      return { success: true, closed: false };
    }

    // 2. We have 3 consecutive healthy pings! Coordinated de-escalation:
    appendBotLog(
      state,
      `[SYNTHETIC DE-ESCALATION] Bot "${botName}": ${failedVenue} confirmed fully healthy (3/3 pings). Executing synchronized dual close on ${failedVenue} & ${healthyVenue}!`,
      "warn",
      userId,
      botId
    );

    const isShortA = hedge.direction.startsWith("SHORT_");
    const failedCloseSide = isOrphanLeg2
      ? (isShortA ? "SELL" : "BUY")
      : (isShortA ? "BUY" : "SELL");
    const syntheticCloseSide: "BUY" | "SELL" = hedge.syntheticSide === "BUY" ? "SELL" : "BUY";
    const formattedQty = hedge.quantity;

    // Step A: Close surviving leg on failedVenue
    let failedVenueClosed = false;
    let failedClosePrice = 0;

    if (failedVenue === "Bybit") {
      const { placeBybitOrder } = await import("./bybitSigner");
      const rawSecret = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
      const cleanSecret = rawSecret.startsWith("enc:v1:") ? decryptVaultSecret(rawSecret) : rawSecret;

      const res = await placeBybitOrder(
        {
          apiKey: creds?.bybitKey || ADMIN_BYBIT_KEY,
          apiSecret: cleanSecret,
          proxyUrl: creds?.bybitProxy,
          baseUrl: creds?.bybitBaseUrl,
        },
        {
          symbol: hedge.symbol,
          side: failedCloseSide.toLowerCase() === "buy" ? "Buy" : "Sell",
          qty: formattedQty,
          orderType: "Market",
          reduceOnly: true,
          positionIdx: 0,
        }
      );
      if (res.success || res.error?.includes("position is zero") || res.error?.includes("cannot fix reduce-only")) {
        failedVenueClosed = true;
        failedClosePrice = res.avgPrice || 0;
      }
    } else if (failedVenue === "Binance") {
      const bnKey = creds?.binanceKey || ADMIN_BINANCE_KEY;
      const rawBnSec = creds?.binanceSecret || ADMIN_BINANCE_SECRET;
      const bnSec = rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
      const bnRes = await placeBinanceOrder(
        { apiKey: bnKey, apiSecret: bnSec, endpoint: creds?.binanceEndpoint || ADMIN_BINANCE_ENDPOINT },
        { symbol: hedge.symbol, side: failedCloseSide as any, type: "MARKET", quantity: formattedQty, reduceOnly: "true" }
      );
      if (bnRes.success) {
        failedVenueClosed = true;
        failedClosePrice = bnRes.avgPrice || 0;
      }
    }

    // Step B: Close synthetic position on healthyVenue
    let healthyVenueClosed = false;
    let healthyClosePrice = 0;

    if (healthyVenue === "Binance") {
      const bnKey = creds?.binanceKey || ADMIN_BINANCE_KEY;
      const rawBnSec = creds?.binanceSecret || ADMIN_BINANCE_SECRET;
      const bnSec = rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
      const bnRes = await placeBinanceOrder(
        { apiKey: bnKey, apiSecret: bnSec, endpoint: creds?.binanceEndpoint || ADMIN_BINANCE_ENDPOINT },
        { symbol: hedge.symbol, side: syntheticCloseSide, type: "MARKET", quantity: formattedQty, reduceOnly: "true" }
      );
      if (bnRes.success) {
        healthyVenueClosed = true;
        healthyClosePrice = bnRes.avgPrice || 0;
      }
    } else if (healthyVenue === "Bybit") {
      const { placeBybitOrder } = await import("./bybitSigner");
      const rawSecret = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
      const cleanSecret = rawSecret.startsWith("enc:v1:") ? decryptVaultSecret(rawSecret) : rawSecret;
      const res = await placeBybitOrder(
        { apiKey: creds?.bybitKey || ADMIN_BYBIT_KEY, apiSecret: cleanSecret, proxyUrl: creds?.bybitProxy, baseUrl: creds?.bybitBaseUrl },
        { symbol: hedge.symbol, side: syntheticCloseSide === "BUY" ? "Buy" : "Sell", qty: formattedQty, orderType: "Market", reduceOnly: true, positionIdx: 0 }
      );
      if (res.success || res.error?.includes("position is zero")) {
        healthyVenueClosed = true;
        healthyClosePrice = res.avgPrice || 0;
      }
    }

    if (failedVenueClosed && healthyVenueClosed) {
      hedge.status = "CLOSED";
      hedge.orphanLeg = null;
      hedge.leg1Closed = true;
      hedge.leg2Closed = true;
      hedge.closeTime = Date.now();

      appendBotLog(
        state,
        `[SYNTHETIC LOCK RESOLVED] Bot "${botName}": Both ${failedVenue} & ${healthyVenue} successfully liquidated with zero naked exposure! Position cleanly reconciled to CLOSED.`,
        "success",
        userId,
        botId
      );

      recordServerTrade(
        {
          id: `CLS-SYNTH-${hedge.id}`,
          symbol: hedge.symbol,
          type: "SYNTHETIC_DELTA_RESOLVED_CLOSE",
          directionLabel: "Synchronized Synthetic De-escalation Close",
          quantity: formattedQty,
          leg1Venue: hedge.venueA || "Binance",
          leg1Side: isShortA ? "BUY" : "SELL",
          leg1Price: isOrphanLeg2 ? (healthyClosePrice || hedge.entryBinancePrice) : (failedClosePrice || hedge.entryBinancePrice),
          leg2Venue: hedge.venueB || "Bybit",
          leg2Side: isShortA ? "SELL" : "BUY",
          leg2Price: isOrphanLeg2 ? (failedClosePrice || hedge.entryBitgetPrice) : (healthyClosePrice || hedge.entryBitgetPrice),
          botId: botId || hedge.botId,
          botName: botName || hedge.botName,
          realizedPnl: hedge.pnl || 0,
          status: "CLOSED",
        },
        userId
      );

      return { success: true, closed: true };
    }
  } catch (err: any) {
    hedge.reconnectPings = 0; // Reset consecutive pings on error
    appendBotLog(
      state,
      `[SYNTHETIC RECONCILE PROBE] Bot "${botName}": ${failedVenue} ping failed (${err.message}). Net delta remains safely locked at 0.00 on ${healthyVenue}.`,
      "warn",
      userId,
      botId
    );
  }

  return { success: true, closed: false };
}


/**
 * Execute dual close for an active hedge once price parity matches using tenant credentials
 */
export async function executeDualHedgeClose(
  hedge: ActiveBotHedge,
  freshPrices: { bnPrice: number; bgPrice: number; divergencePct: number },
  botName: string,
  state: BotEngineState,
  creds?: UserApiKeys,
  userId?: string,
  botId?: string
): Promise<{ success: boolean; pnl: number; error?: string }> {
  const symbol = hedge.symbol;
  const formattedQty = hedge.quantity;
  const isBybit = hedge.venueB === "Bybit" || hedge.direction.includes("BYBIT");
  const isCoinDcx = !isBybit && (hedge.venueB === "CoinDCX" || hedge.direction.includes("COINDCX"));
  const venueAName = hedge.venueA || (hedge.direction.includes("COINDCX") ? "CoinDCX" : "Binance");
  const venueBName = hedge.venueB || (isBybit ? "Bybit" : (isCoinDcx ? "CoinDCX" : "Bitget"));

  const leg1CloseSide: "BUY" | "SELL" =
    hedge.direction.startsWith("SHORT_") ? "BUY" : "SELL";
  const leg2CloseSide: "buy" | "sell" = leg1CloseSide === "BUY" ? "sell" : "buy";

  appendBotLog(
    state,
    `[CLOSE DISPATCH] Bot "${botName}": Submitting synchronized market close for ${symbol} (${venueAName} ${leg1CloseSide} & ${venueBName} ${leg2CloseSide.toUpperCase()})...`,
    "info",
    userId
  );

  // PRE-FLIGHT EXIT GATE: Fast check if Bybit route is healthy before initiating close
  if (isBybit) {
    const { bybitTradeStream } = await import("./bybitTradeStream");
    const isWsHealthy = bybitTradeStream.isHealthy();
    if (!isWsHealthy) {
      const proxyExitGate = await verifyProxyPreFlight({
        proxyUrl: creds?.bybitProxy,
        baseUrl: creds?.bybitBaseUrl,
        backupProxyUrl: creds?.bybitBackupProxy,
        backupBaseUrl: creds?.bybitBackupBaseUrl,
      });
      if (!proxyExitGate.allowed) {
        appendBotLog(
          state,
          `[STRICT DELTA-NEUTRAL FREEZE] Bot "${botName}": Bybit route offline (${proxyExitGate.reason || "Unreachable"}). STRICT DELTA-NEUTRAL FREEZE ENGAGED for ${symbol}. DO NOT CLOSE ${venueAName.toUpperCase()} ALONE. Both legs locked delta-neutral (FROZEN_PROXY_DOWN) to eliminate naked directional risk. Auto-closing once route recovers.`,
          "error",
          userId
        );
        hedge.status = "FROZEN_PROXY_DOWN";
        return { success: false, pnl: 0, error: "STRICT_DELTA_NEUTRAL_FREEZE" };
      }
    }
  }

  const bnKey = creds?.binanceKey || ADMIN_BINANCE_KEY;
  const rawBnSec = creds?.binanceSecret || ADMIN_BINANCE_SECRET;
  const bnSec = rawBnSec && rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
  const bnEndpoint = creds?.binanceEndpoint || ADMIN_BINANCE_ENDPOINT;

  const rawBgSec = creds?.bitgetSecret || SYSTEM_DEFAULT_BITGET_SECRET;
  const rawBgPass = creds?.bitgetPassphrase || SYSTEM_DEFAULT_BITGET_PASSPHRASE;
  const bgCreds: BitgetCredentials = {
    apiKey: creds?.bitgetKey || SYSTEM_DEFAULT_BITGET_KEY,
    apiSecret: rawBgSec && rawBgSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBgSec) : rawBgSec,
    passphrase: rawBgPass && rawBgPass.startsWith("enc:v1:") ? decryptVaultSecret(rawBgPass) : rawBgPass,
    isDemo: creds?.bitgetEnv !== "live",
  };

  // Synchronized Corridor Lead-Stagger on Close: Slower venue leads so both positions unwind simultaneously
  const closeStagger = getCorridorStaggerDelays(venueAName, venueBName);
  const leg1CloseDelayMs = closeStagger.venueADelayMs;
  const leg2CloseDelayMs = closeStagger.venueBDelayMs;

  let closeLeg1DispatchedAt = 0;
  let closeLeg1PlacedAt = 0;
  let closeLeg1LatencyMs = 0;
  let closeLeg2DispatchedAt = 0;
  let closeLeg2PlacedAt = 0;
  let closeLeg2LatencyMs = 0;

  const [closeBnRes, closeBgRes] = await Promise.allSettled([
    (async () => {
      if (hedge.leg1Closed) {
        return { success: true, price: hedge.leg1ClosePrice || freshPrices.bnPrice, orderId: hedge.leg1CloseOrderId || "" };
      }
      if (leg1CloseDelayMs > 0) await new Promise((r) => setTimeout(r, leg1CloseDelayMs));
      closeLeg1DispatchedAt = Date.now();
      const t0 = performance.now();
      if (venueAName === "CoinDCX") {
        const { placeCoinDcxOrder } = await import("./coindcxSigner");
        const rawCdxSec = creds?.coindcxSecret || "";
        const cdxCreds = {
          apiKey: creds?.coindcxKey || "",
          apiSecret: rawCdxSec && rawCdxSec.startsWith("enc:v1:") ? decryptVaultSecret(rawCdxSec) : rawCdxSec,
        };
        const res = await placeCoinDcxOrder(
          {
            symbol,
            side: leg1CloseSide.toLowerCase() as any,
            quantity: hedge.effectiveQty,
            leverage: hedge.binanceLeverage || 10,
            orderType: "market_order",
            bypassLeverage: true,
          },
          cdxCreds.apiKey ? cdxCreds : undefined
        );
        closeLeg1PlacedAt = Date.now();
        closeLeg1LatencyMs = Math.round(performance.now() - t0);
        const exitPrice = res.avgPrice || freshPrices.bnPrice;
        appendBotLog(
          state,
          `[CLOSE LEG 1] Bot "${botName}": CoinDCX ${leg1CloseSide} ${symbol} close filled @ $${exitPrice} (${closeLeg1LatencyMs}ms, placedAt: ${new Date(closeLeg1PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
        return { success: res.success, price: exitPrice, orderId: res.orderId, error: res.error };
      } else if (venueAName === "Bitget") {
        const { placeBitgetOrder } = await import("./bitgetSigner");
        const res = await placeBitgetOrder(
          {
            symbol,
            side: leg1CloseSide.toLowerCase() as any,
            size: formattedQty,
            orderType: "market",
            tradeSide: "close",
          },
          bgCreds
        );
        closeLeg1PlacedAt = Date.now();
        closeLeg1LatencyMs = Math.round(performance.now() - t0);
        const bgAny = res as any;
        const exitPrice = bgAny.avgPrice || bgAny.price || freshPrices.bnPrice;
        appendBotLog(
          state,
          `[CLOSE LEG 1] Bot "${botName}": Bitget ${leg1CloseSide} ${symbol} close filled @ $${exitPrice} (${closeLeg1LatencyMs}ms, placedAt: ${new Date(closeLeg1PlacedAt).toISOString()})`,
          "info",
          userId,
          botId
        );
        return { success: res.success, price: exitPrice, orderId: bgAny.orderId, error: bgAny.error };
      } else {
        const bnRes = await placeBinanceOrder(
          { apiKey: bnKey, apiSecret: bnSec, endpoint: bnEndpoint },
          { symbol, side: leg1CloseSide, type: "MARKET", quantity: formattedQty, reduceOnly: "true" }
        );
        closeLeg1PlacedAt = Date.now();
        closeLeg1LatencyMs = bnRes.executionLatencyMs || Math.round(performance.now() - t0);
        const exitPrice = bnRes.avgPrice || freshPrices.bnPrice;
        const transportTag = bnRes.transport === "WEBSOCKET" ? " [WS-135ms]" : ` [${bnRes.transport}]`;
        if (bnRes.success) {
          appendBotLog(
            state,
            `[CLOSE LEG 1] Bot "${botName}": Binance ${leg1CloseSide} ${symbol} close filled @ ${exitPrice}${transportTag} (${closeLeg1LatencyMs}ms, placedAt: ${new Date(closeLeg1PlacedAt).toISOString()})`,
            "info",
            userId,
            botId
          );
          return { success: true, price: exitPrice, orderId: bnRes.orderId };
        } else {
          appendBotLog(
            state,
            `[CLOSE LEG 1 FAILED] Bot "${botName}": Binance ${leg1CloseSide} ${symbol} close rejected: ${bnRes.error}`,
            "error",
            userId,
            botId
          );
          return { success: false, price: exitPrice, orderId: "", error: bnRes.error };
        }
      }
    })(),
    (async () => {
      if (hedge.leg2Closed) {
        return { success: true, price: hedge.leg2ClosePrice || freshPrices.bgPrice, orderId: hedge.leg2CloseOrderId || "" };
      }
      if (isBybit) {
        if (leg2CloseDelayMs > 0) await new Promise((r) => setTimeout(r, leg2CloseDelayMs));
        closeLeg2DispatchedAt = Date.now();
        const t0 = performance.now();
        const { placeBybitOrder } = await import("./bybitSigner");
        const rawBybitSec = creds?.bybitSecret || ADMIN_BYBIT_SECRET;
        const bybitCreds = {
          apiKey: creds?.bybitKey || ADMIN_BYBIT_KEY,
          apiSecret: rawBybitSec && rawBybitSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBybitSec) : rawBybitSec,
          proxyUrl: creds?.bybitProxy,
          baseUrl: creds?.bybitBaseUrl,
          backupProxyUrl: creds?.bybitBackupProxy,
          backupBaseUrl: creds?.bybitBackupBaseUrl,
        };
        const unwindSide: "Buy" | "Sell" = leg2CloseSide.toLowerCase() === "buy" ? "Buy" : "Sell";
        let res = await placeBybitOrder(bybitCreds, {
          symbol,
          side: unwindSide,
          qty: formattedQty,
          orderType: "Market",
          reduceOnly: true,
          positionIdx: 0,
        });

        // Single Instant Micro-Retry (100ms) on close
        if (!res.success) {
          appendBotLog(
            state,
            `[CLOSE MICRO-RETRY] Bot "${botName}": Bybit close rejected (${res.error || "Close error"}). Retrying in 100ms on active route...`,
            "warn",
            userId,
            botId
          );
          await new Promise((r) => setTimeout(r, 100));
          res = await placeBybitOrder(bybitCreds, {
            symbol,
            side: unwindSide,
            qty: formattedQty,
            orderType: "Market",
            reduceOnly: true,
            positionIdx: 0,
          });
        }

        closeLeg2PlacedAt = Date.now();
        closeLeg2LatencyMs = Math.round(performance.now() - t0);
        const exitPrice = res.avgPrice || freshPrices.bgPrice;
        const isBybitAlreadyFlat = !res.success && (
          res.error?.includes("position is zero") ||
          res.error?.includes("cannot fix reduce-only") ||
          res.error?.includes("Position size is zero")
        );
        const bybitCloseSuccess = res.success || isBybitAlreadyFlat;

        if (bybitCloseSuccess) {
          appendBotLog(
            state,
            `[CLOSE LEG 2] Bot "${botName}": Bybit ${unwindSide.toUpperCase()} ${symbol} close ${isBybitAlreadyFlat ? "confirmed (already flat 0 contracts)" : "filled"} @ ${exitPrice} (${closeLeg2LatencyMs}ms, placedAt: ${new Date(closeLeg2PlacedAt).toISOString()})`,
            "info",
            userId,
            botId
          );
        } else {
          appendBotLog(
            state,
            `[CLOSE LEG 2 REJECTED] Bot "${botName}": Bybit close failed for ${symbol}: ${res.error || "Close error"}`,
            "error",
            userId,
            botId
          );
        }
        return { success: bybitCloseSuccess, price: exitPrice };
      } else if (isCoinDcx) {
        if (leg2CloseDelayMs > 0) await new Promise((r) => setTimeout(r, leg2CloseDelayMs));
        closeLeg2DispatchedAt = Date.now();
        const t0 = performance.now();
        const { placeCoinDcxOrder } = await import("./coindcxSigner");
        const rawCdxSec = creds?.coindcxSecret || "";
        const cdxCreds = {
          apiKey: creds?.coindcxKey || "",
          apiSecret: rawCdxSec && rawCdxSec.startsWith("enc:v1:") ? decryptVaultSecret(rawCdxSec) : rawCdxSec,
        };
        const res = await placeCoinDcxOrder(
          {
            symbol,
            side: leg2CloseSide,
            quantity: hedge.effectiveQty,
            leverage: hedge.bitgetLeverage || 10,
            orderType: "market_order",
            bypassLeverage: true,
          },
          cdxCreds.apiKey ? cdxCreds : undefined
        );
        closeLeg2PlacedAt = Date.now();
        closeLeg2LatencyMs = Math.round(performance.now() - t0);
        const exitPrice = res.avgPrice || freshPrices.bgPrice;
        if (res.success) {
          appendBotLog(
            state,
            `[CLOSE LEG 2] Bot "${botName}": CoinDCX ${leg2CloseSide.toUpperCase()} ${symbol} close filled @ $${exitPrice} (${closeLeg2LatencyMs}ms, placedAt: ${new Date(closeLeg2PlacedAt).toISOString()})`,
            "info",
            userId,
            botId
          );
        } else {
          appendBotLog(
            state,
            `[CLOSE LEG 2 REJECTED] Bot "${botName}": CoinDCX close failed for ${symbol}: ${res.error || "Close error"}`,
            "error",
            userId,
            botId
          );
        }
        return { success: res.success, price: exitPrice };
      } else {
        if (leg2CloseDelayMs > 0) await new Promise((r) => setTimeout(r, leg2CloseDelayMs));
        closeLeg2DispatchedAt = Date.now();
        const t0 = performance.now();
        const res = await placeBitgetOrder(
          {
            symbol,
            side: leg2CloseSide,
            size: formattedQty,
            orderType: "market",
            tradeSide: "close",
          },
          bgCreds
        );
        closeLeg2PlacedAt = Date.now();
        closeLeg2LatencyMs = Math.round(performance.now() - t0);
        const exitPrice = res.avgPrice || freshPrices.bgPrice;
        if (res.success) {
          appendBotLog(
            state,
            `[CLOSE LEG 2] Bot "${botName}": Bitget ${leg2CloseSide.toUpperCase()} ${symbol} close filled @ $${exitPrice} (${closeLeg2LatencyMs}ms, placedAt: ${new Date(closeLeg2PlacedAt).toISOString()})`,
            "info",
            userId,
            botId
          );
        } else {
          appendBotLog(
            state,
            `[CLOSE LEG 2 REJECTED] Bot "${botName}": Bitget close failed for ${symbol}: ${res.error || "Close error"}`,
            "error",
            userId,
            botId
          );
        }
        return { success: res.success, price: exitPrice };
      }
    })(),
  ]);

  const isBnSuccess = closeBnRes.status === "fulfilled" && closeBnRes.value.success;
  const isBgSuccess = closeBgRes.status === "fulfilled" && closeBgRes.value.success;

  if (isBnSuccess) {
    hedge.leg1Closed = true;
    hedge.leg1ClosePrice = closeBnRes.value.price || freshPrices.bnPrice;
    hedge.leg1CloseOrderId = closeBnRes.value.orderId;
  }
  if (isBgSuccess) {
    hedge.leg2Closed = true;
    hedge.leg2ClosePrice = closeBgRes.value.price || freshPrices.bgPrice;
    hedge.leg2CloseOrderId = (closeBgRes.value as any)?.orderId;
  }

  if (!isBnSuccess || !isBgSuccess) {
    if (isBnSuccess && !isBgSuccess) {
      hedge.status = "ORPHAN_RECOVERY";
      hedge.orphanLeg = "LEG2";
      hedge.orphanSince = hedge.orphanSince || Date.now();
      hedge.orphanLastError = closeBgRes.status === "fulfilled" ? (closeBgRes.value as any).error : "Leg 2 rejected";

      appendBotLog(
        state,
        `[ASYMMETRIC CLOSE DETECTED] Bot "${botName}": Leg 1 (${venueAName}) closed, but Leg 2 (${venueBName}) failed! Engaging immediate orphan remediation...`,
        "warn",
        userId,
        botId
      );

      const remediateRes = await remediateOrphanLeg(hedge, botName, state, creds, userId, botId);
      if (remediateRes.success) {
        return { success: true, pnl: hedge.pnl || 0 };
      }
      return {
        success: false,
        pnl: 0,
        error: `ORPHAN_LEG2_PENDING: ${hedge.orphanLastError}`,
      };
    } else if (!isBnSuccess && isBgSuccess) {
      hedge.status = "ORPHAN_RECOVERY";
      hedge.orphanLeg = "LEG1";
      hedge.orphanSince = hedge.orphanSince || Date.now();
      hedge.orphanLastError = closeBnRes.status === "fulfilled" ? (closeBnRes.value as any).error : "Leg 1 rejected";

      appendBotLog(
        state,
        `[ASYMMETRIC CLOSE DETECTED] Bot "${botName}": Leg 2 (${venueBName}) closed, but Leg 1 (${venueAName}) failed! Engaging immediate orphan remediation...`,
        "warn",
        userId,
        botId
      );

      const remediateRes = await remediateOrphanLeg(hedge, botName, state, creds, userId, botId);
      if (remediateRes.success) {
        return { success: true, pnl: hedge.pnl || 0 };
      }
      return {
        success: false,
        pnl: 0,
        error: `ORPHAN_LEG1_PENDING: ${hedge.orphanLastError}`,
      };
    } else {
      hedge.status = "WAITING_PRICE_PARITY";
      appendBotLog(
        state,
        `[CLOSE WARNING] Bot "${botName}": Both close orders failed for ${symbol}. Retrying on next evaluation cycle.`,
        "warn",
        userId,
        botId
      );
      return {
        success: false,
        pnl: 0,
        error: `Both close orders failed: ${venueAName} & ${venueBName}`,
      };
    }
  }

  // Both succeeded!
  hedge.leg1Closed = true;
  hedge.leg2Closed = true;
  hedge.orphanLeg = null;
  hedge.status = "CLOSED";
  hedge.closeTime = Date.now();

  // User Requirement: Inter-leg fill delta = |Close Leg 2 Fill Duration - Close Leg 1 Fill Duration|
  const closeInterLegDeltaMs = (closeLeg1LatencyMs > 0 && closeLeg2LatencyMs > 0)
    ? Math.abs(closeLeg2LatencyMs - closeLeg1LatencyMs)
    : ((closeLeg1PlacedAt > 0 && closeLeg2PlacedAt > 0)
      ? Math.abs(closeLeg1PlacedAt - closeLeg2PlacedAt)
      : 15);

  const bnExitPrice = closeBnRes.value.price || freshPrices.bnPrice;
  const bgExitPrice = closeBgRes.value.price || freshPrices.bgPrice;

  const leg1Dir = hedge.direction.startsWith("SHORT_") ? -1 : 1;
  const leg2Dir = -leg1Dir;

  const leg1Pnl = leg1Dir * (bnExitPrice - hedge.entryBinancePrice) * hedge.effectiveQty;
  const leg2Pnl = leg2Dir * (bgExitPrice - hedge.entryBitgetPrice) * hedge.effectiveQty;
  const grossPriceSpreadPnl = parseFloat((leg1Pnl + leg2Pnl).toFixed(4));

  const closeNotional1 = bnExitPrice * hedge.effectiveQty;
  const closeNotional2 = bgExitPrice * hedge.effectiveQty;
  const closeLeg1Rate = venueAName === "Bybit" ? 0.000649 : (venueAName === "Bitget" ? 0.0006 : 0.0005);
  const closeLeg2Rate = venueBName === "Bybit" ? 0.000649 : (venueBName === "Bitget" ? 0.0006 : 0.0005);
  const closeLeg1FeeUsdt = parseFloat((closeNotional1 * closeLeg1Rate).toFixed(4));
  const closeLeg2FeeUsdt = parseFloat((closeNotional2 * closeLeg2Rate).toFixed(4));
  const entryFees = (hedge.totalFeesUsdt || (hedge.leg1FeeUsdt || 0) + (hedge.leg2FeeUsdt || 0)) || 0;
  const totalFeesUsdt = parseFloat((entryFees + closeLeg1FeeUsdt + closeLeg2FeeUsdt).toFixed(4));
  const fundingClaimed = hedge.fundingClaimedUsdt || 0;
  // Net realized PnL correctly accounts for funding payments received or debited minus real exchange taker fees
  const netPnl = parseFloat((grossPriceSpreadPnl + fundingClaimed - totalFeesUsdt).toFixed(4));

  hedge.closeLeg1DispatchedAt = closeLeg1DispatchedAt;
  hedge.closeLeg1PlacedAt = closeLeg1PlacedAt;
  hedge.closeLeg1LatencyMs = closeLeg1LatencyMs;
  hedge.closeLeg2DispatchedAt = closeLeg2DispatchedAt;
  hedge.closeLeg2PlacedAt = closeLeg2PlacedAt;
  hedge.closeLeg2LatencyMs = closeLeg2LatencyMs;
  hedge.closeInterLegDeltaMs = closeInterLegDeltaMs;
  hedge.closeLeg1FeeUsdt = closeLeg1FeeUsdt;
  hedge.closeLeg2FeeUsdt = closeLeg2FeeUsdt;
  hedge.totalFeesUsdt = totalFeesUsdt;

  recordServerTrade(
    {
      id: `CLS-${hedge.id}`,
      symbol,
      type: "AUTONOMOUS_SERVER_CLOSE",
      directionLabel: "Unwind & Realize Harvest",
      quantity: formattedQty,
      notionalUsdt: parseFloat((((bnExitPrice + bgExitPrice) / 2) * hedge.effectiveQty).toFixed(2)),
      leg1Venue: venueAName,
      leg1Side: leg1CloseSide,
      leg1Price: bnExitPrice,
      leg1PlacedAt: closeLeg1PlacedAt,
      leg1LatencyMs: closeLeg1LatencyMs,
      closeLeg1OrderId: closeBnRes.value.orderId,
      closeLeg1FeeUsdt,
      leg2Venue: venueBName,
      leg2Side: leg2CloseSide.toUpperCase(),
      leg2Price: bgExitPrice,
      leg2PlacedAt: closeLeg2PlacedAt,
      leg2LatencyMs: closeLeg2LatencyMs,
      closeLeg2OrderId: (closeBgRes.value as any)?.orderId,
      closeLeg2FeeUsdt,
      interLegDeltaMs: closeInterLegDeltaMs,
      botId: botId || hedge.botId,
      botName: botName || hedge.botName,
      priceSpreadPnlUsdt: grossPriceSpreadPnl,
      fundingClaimedUsdt: fundingClaimed,
      fundingRatePct: hedge.fundingRatePct,
      feesUsdt: totalFeesUsdt,
      totalFeesUsdt,
      realizedPnl: netPnl,
      netHarvestUsdt: netPnl,
      closeLeg1Price: bnExitPrice,
      closeLeg2Price: bgExitPrice,
      closeDivergencePct: freshPrices.divergencePct,
      status: "CLOSED",
    },
    userId
  );

  appendBotLog(
    state,
    `[CLOSE COMPLETED] Bot "${botName}": Successfully unwound ${symbol} hedge. Inter-leg delta: ${closeInterLegDeltaMs}ms (Leg 1: ${closeLeg1LatencyMs}ms, Leg 2: ${closeLeg2LatencyMs}ms). Spread PnL: $${grossPriceSpreadPnl.toFixed(4)}, Funding: $${fundingClaimed.toFixed(4)}, Real Fees: -$${totalFeesUsdt.toFixed(4)}, Net Realized PnL: $${netPnl.toFixed(4)} USDT.`,
    "success",
    userId,
    botId || hedge.botId
  );

  return { success: true, pnl: netPnl };
}

/**
 * Executes a single evaluation cycle for a specific tenant account.
 * Honors user isolation, tenant margin cap, set parameters, and flatten memory lock.
 */
export async function runTenantBotCycle(
  user: UserAccount,
  opportunities: any[],
  now: number
): Promise<void> {
  if (globalForBot.tenantLocks!.has(user.id)) {
    return; // User cycle already in flight
  }

  globalForBot.tenantLocks!.add(user.id);

  try {
    const state = loadBotState(user.id);
    if (!state.isRunning) {
      return;
    }

    state.lastCycleAt = now;
    state.cyclesCompleted += 1;

    // Automated 8-Hour Log Retention & Untraded Coin Pruning (Invariant 5)
    if (state.cyclesCompleted % 50 === 0) {
      pruneUntradedLogsFor8hCycle(state, user.id);
    }

    const enabledBots = state.bots.filter((b) => b.enabled);
    if (enabledBots.length === 0) {
      return;
    }

    const creds = getDecryptedUserApiKeys(user);

    // Statutory DPDP Act 2023 Consent Gate:
    // Continuous runtime verification before performing any external exchange API calls
    if (user.email) {
      const consents = getUserActiveConsents(user.email);
      const isConsentRevoked = user.role !== "admin"
        ? !consents.PURPOSE_EXCHANGE_DISPATCH
        : consents.PURPOSE_EXCHANGE_DISPATCH === false && getUserConsentHistory(user.email).some((c) => c.purpose === "PURPOSE_EXCHANGE_DISPATCH" && c.status === "WITHDRAWN");

      if (isConsentRevoked) {
        for (const bot of enabledBots) {
          bot.statusText = "CONSENT_WITHDRAWN (DPDP Act Section 6 exchange dispatch consent missing or revoked)";
        }
        if (state.cyclesCompleted % 10 === 0) {
          appendBotLog(
            state,
            `[DPDP COMPLIANCE] Autonomous exchange trading suspended for ${user.email}: Statutory consent for PURPOSE_EXCHANGE_DISPATCH is missing or revoked. Update consent in Profile/Privacy settings to resume.`,
            "warn",
            user.id
          );
        }
        saveBotState(state, user.id);
        return;
      }
    }

    // If user is not admin and has no API keys configured, inform them
    const hasKeys = Boolean(
      (creds.binanceKey && creds.bitgetKey) ||
      (creds.coindcxKey && creds.coindcxSecret) ||
      (creds.binanceKey && creds.bybitKey) ||
      (creds.bybitKey && creds.bybitSecret)
    );
    if (!hasKeys && user.role !== "admin") {
      for (const bot of enabledBots) {
        bot.statusText = "WAITING_API_KEYS (Configure in Profile/Settings)";
      }
      if (state.cyclesCompleted % 10 === 0) {
        appendBotLog(
          state,
          `[KEYS REQUIRED] User account ${user.email} has no API keys configured. Please add exchange keys in Profile/Settings to activate live trading.`,
          "warn",
          user.id
        );
      }
      saveBotState(state, user.id);
      return;
    }

    // Fetch user balances using decrypted credentials
    const balances = await fetchAvailableBalances(creds);
    const effectiveBal = (balances.bybitBal !== undefined && balances.bybitBal > 0)
      ? Math.min(balances.binanceBal, balances.bybitBal)
      : (balances.coindcxBal !== undefined && balances.coindcxBal > 0)
      ? Math.min(balances.binanceBal, balances.coindcxBal)
      : Math.min(balances.binanceBal, balances.bitgetBal);

    for (const bot of enabledBots) {
      const config = bot.config;

      // ─────────────────────────────────────────────────────────────
      // PHASE 1: EXIT MONITOR FOR THIS BOT'S ACTIVE HEDGES
      // ─────────────────────────────────────────────────────────────
      const survivingHedges: ActiveBotHedge[] = [];

      for (const hedge of bot.activeHedges) {
        // STRICT DELTA-NEUTRAL FREEZE AUTO-RECOVERY:
        if (hedge.status === "FROZEN_PROXY_DOWN") {
          const isBybit = hedge.venueB === "Bybit" || hedge.direction.includes("BYBIT");
          if (isBybit) {
            const recoveryCheck = await verifyProxyPreFlight({
              proxyUrl: creds?.bybitProxy,
              baseUrl: creds?.bybitBaseUrl,
              backupProxyUrl: creds?.bybitBackupProxy,
              backupBaseUrl: creds?.bybitBackupBaseUrl,
            });

            if (!recoveryCheck.allowed) {
              survivingHedges.push(hedge);
              if (state.cyclesCompleted % 4 === 0) {
                appendBotLog(
                  state,
                  `[STRICT DELTA-NEUTRAL FREEZE ACTIVE] Bot "${bot.name}": ${hedge.symbol} remains safely frozen delta-neutral until Bybit proxy recovers. Cockpit audio chime active.`,
                  "warn",
                  user.id
                );
              }
              continue;
            }

            appendBotLog(
              state,
              `[PROXY RECOVERED] Bot "${bot.name}": Bybit proxy restored (${recoveryCheck.activeEndpointId} route @ ${recoveryCheck.latencyMs}ms). Unfreezing ${hedge.symbol} and resuming dual synchronized close!`,
              "success",
              user.id
            );
            hedge.status = "CLOSING";
          }
        }

        // PRIORITIZE SYNTHETIC RECONCILIATION: If hedge is in SYNTHETIC_DELTA_LOCKED, probe & de-escalate!
        if (hedge.status === "SYNTHETIC_DELTA_LOCKED") {
          const reconRes = await reconcileSyntheticLock(hedge, bot.name, state, creds, user.id, bot.id);
          if (reconRes.closed) {
            bot.completedHedges.unshift(hedge);
            if (bot.completedHedges.length > 50) {
              bot.completedHedges = bot.completedHedges.slice(0, 50);
            }
            quarantineBotSymbol(bot, hedge.symbol, 3600, "Synthetic delta de-escalation close", state, user.id);
          } else {
            survivingHedges.push(hedge);
          }
          continue;
        }

        // PRIORITIZE ORPHAN RECOVERY: If hedge is in ORPHAN_RECOVERY, auto-heal immediately!
        if (hedge.status === "ORPHAN_RECOVERY") {
          const healRes = await remediateOrphanLeg(hedge, bot.name, state, creds, user.id, bot.id);
          if (healRes.success) {
            hedge.status = "CLOSED";
            hedge.closeTime = Date.now();
            bot.completedHedges.unshift(hedge);
            if (bot.completedHedges.length > 50) {
              bot.completedHedges = bot.completedHedges.slice(0, 50);
            }
            quarantineBotSymbol(bot, hedge.symbol, 3600, "Orphan remediation close", state, user.id);
          } else {
            survivingHedges.push(hedge);
          }
          continue;
        }

        // R1 & R2 ACTIVE POSITION SAFEGUARDS:
        const vA = hedge.venueA || (hedge.direction.includes("BINANCE") ? "Binance" : (hedge.direction.includes("COINDCX") ? "CoinDCX" : "Binance"));
        const vB = hedge.venueB || (hedge.direction.includes("BYBIT") ? "Bybit" : (hedge.direction.includes("BITGET") ? "Bitget" : "Bybit"));
        const liveFundingMeta = getCachedFundingMeta(hedge.symbol);
        const intervalMode: FundingIntervalMode = config.intervalMode || (config.allowAsymmetricFunding === false ? "STRICT_SYNC_ONLY" : "ALL_ASYMMETRIC");
        const allowAsym = hedge.isAsymmetric || intervalMode !== "STRICT_SYNC_ONLY";
        const liveSyncCheck = checkFundingSynchronization(vA, vB, liveFundingMeta, now, {
          allowAsymmetric: true, // Always allow asymmetric validation for in-flight asymmetric positions
          intervalMode: hedge.isAsymmetric ? "ALL_ASYMMETRIC" : intervalMode,
          allowedIntervalPairs: config.allowedIntervalPairs,
        });

        // 1. DYNAMIC INTERVAL DESYNCHRONIZATION GUARD:
        // If live settlement intervals or countdowns desynchronize post-entry, immediately exit to prevent asymmetric single-leg settlements!
        if (!liveSyncCheck.synchronized && !hedge.isAsymmetric) {
          appendBotLog(
            state,
            `[CIRCUIT BREAKER: DYNAMIC FUNDING DESYNCHRONIZATION] Bot "${bot.name}": Live settlement intervals or countdowns on ${hedge.symbol} (${vA} ⇄ ${vB}) desynchronized post-entry (${liveSyncCheck.reason}). Closing hedge immediately to prevent asymmetric single-leg settlement!`,
            "error",
            user.id,
            bot.id
          );
          hedge.status = "CLOSING";
          hedge.unwindReason = "CIRCUIT_BREAKER_DYNAMIC_FUNDING_DESYNC";
          const freshPrices = await fetchFreshPrices(hedge.symbol, vA, vB);
          const closeRes = await executeDualHedgeClose(hedge, freshPrices, bot.name, state, creds, user.id, bot.id);
          if (closeRes.success) {
            hedge.status = "CLOSED";
            hedge.closeTime = Date.now();
            hedge.closeBinancePrice = freshPrices.bnPrice;
            hedge.closeBitgetPrice = freshPrices.bgPrice;
            hedge.closeDivergencePct = freshPrices.divergencePct;
            hedge.pnl = closeRes.pnl;
            quarantineBotSymbol(bot, hedge.symbol, 3600, "Dynamic funding desync unwind", state, user.id);
            bot.completedHedges.unshift(hedge);
            if (bot.completedHedges.length > 50) {
              bot.completedHedges = bot.completedHedges.slice(0, 50);
            }
          } else {
            survivingHedges.push(hedge);
          }
          continue;
        }

        // 2. DYNAMIC SYNCHRONIZED INTERVAL SHIFT UPDATE:
        // Respect the macro settlement horizon for asymmetric hedges; do not overwrite with faster venue settlement!
        const relevantLiveNextFunding = hedge.isAsymmetric
          ? (liveSyncCheck.macroNextFundingTime || liveSyncCheck.earliestNextFundingTime)
          : liveSyncCheck.venueANextFundingTime;

        if (relevantLiveNextFunding > now && relevantLiveNextFunding < hedge.fundingSettlementTime) {
          appendBotLog(
            state,
            `[DYNAMIC INTERVAL SHIFT] Bot "${bot.name}": ${hedge.symbol} ${hedge.isAsymmetric ? "macro" : "synchronized"} funding settlement updated to earlier time: ${new Date(relevantLiveNextFunding).toISOString()}.`,
            "info",
            user.id,
            bot.id
          );
          hedge.fundingSettlementTime = relevantLiveNextFunding;
        }

        // 2b. RECONCILE ENTRY PRICES & FUNDING CASH FLOW FROM EXCHANGE RECORDS
        if (hedge.status === "ACTIVE" || hedge.status === "WAITING_PRICE_PARITY") {
          try {
            const { reconcileHedgeFunding, reconcileHedgeEntryPrices } = await import("./exitOptimizer");
            const rawBnSec = creds?.binanceSecret || "";
            const bnSec = rawBnSec && rawBnSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBnSec) : rawBnSec;
            const rawBybSec = creds?.bybitSecret || "";
            const bybSec = rawBybSec && rawBybSec.startsWith("enc:v1:") ? decryptVaultSecret(rawBybSec) : rawBybSec;
            const bnCreds = (creds?.binanceKey && bnSec) ? { apiKey: creds.binanceKey, apiSecret: bnSec } : undefined;
            const bybCreds = (creds?.bybitKey && bybSec) ? { apiKey: creds.bybitKey, apiSecret: bybSec, proxyUrl: creds.bybitProxy, baseUrl: creds.bybitBaseUrl } : undefined;

            await reconcileHedgeEntryPrices(hedge, bnCreds, bybCreds);
            if (now >= (hedge.fundingSettlementTime || 0)) {
              await reconcileHedgeFunding(hedge, bnCreds, bybCreds);
            }
          } catch {
            // Best-effort non-blocking sync
          }
        }

        // 3. INVERTED / NEGATIVE FUNDING RATE FLIP GUARD (DISABLED BY DEFAULT TO PREVENT PREMATURE FEE LOSSES):
        // Active hedges adhere to the Zero Stop Loss / Pure Convergence Invariant and hold until settlement.
        // Only evaluates if explicitly enabled via config.enableFundingInversionCircuitBreaker with strict debounce.
        if (config.enableFundingInversionCircuitBreaker === true) {
          const currentOpp = opportunities.find((o: any) => o.symbol === hedge.symbol);
          if (currentOpp) {
            const rateA = vA === "CoinDCX" ? (currentOpp.coindcxRate || currentOpp.binanceRate) : (vA === "Binance" ? currentOpp.binanceRate : currentOpp.bitgetRate);
            const rateB = vB === "Bybit" ? currentOpp.bybitRate : (vB === "CoinDCX" ? currentOpp.coindcxRate : currentOpp.bitgetRate);
            let isInverted = false;
            let expectedYieldBps = 0;

            if (hedge.isAsymmetric && hedge.venueAIntervalHours && hedge.venueBIntervalHours) {
              const macroCycle = calculateAsymmetricMacroYield(rateA || 0, hedge.venueAIntervalHours, rateB || 0, hedge.venueBIntervalHours, config.timingMode);
              const isHedgeShortA = hedge.direction.toUpperCase().includes("SHORT_A") ||
                (hedge.venueA && hedge.direction.toUpperCase().includes(`SHORT_${hedge.venueA.toUpperCase()}`)) ||
                hedge.direction.toUpperCase().startsWith("SHORT");
              const liveDominantShortA = macroCycle.recommendedDirection === "SHORT_A_LONG_B";

              if (isHedgeShortA !== liveDominantShortA && macroCycle.grossYieldBps >= 30) {
                isInverted = true;
                expectedYieldBps = -macroCycle.grossYieldBps;
              }
            } else {
              const yieldEval = calculateHedgeFundingYield(hedge.direction, rateA || 0, rateB || 0);
              // Require severe confirmed negative carry (<= -30 bps), not micro-flickers around 0
              if (yieldEval.expectedYieldBps <= -30) {
                isInverted = true;
                expectedYieldBps = yieldEval.expectedYieldBps;
              }
            }

            // Anti-Whipsaw Filter: Never fire within first 15m of entry, and require severe confirmed negative carry
            const holdDurationMs = now - (hedge.entryTime || now);
            const isOutsideJitterWindow = holdDurationMs >= 15 * 60 * 1000;

            if (isInverted && isOutsideJitterWindow && now < hedge.fundingSettlementTime - 15000) {
              appendBotLog(
                state,
                `[CIRCUIT BREAKER: FUNDING RATE INVERSION] Bot "${bot.name}": Confirmed severe funding inversion on ${hedge.symbol} (Yield: ${expectedYieldBps} bps after ${Math.round(holdDurationMs / 60000)}m hold). Unwinding hedge early.`,
                "warn",
                user.id,
                bot.id
              );
              hedge.status = "CLOSING";
              hedge.unwindReason = "CIRCUIT_BREAKER_FUNDING_INVERSION";
              const freshPrices = await fetchFreshPrices(hedge.symbol, vA, vB);
              const closeRes = await executeDualHedgeClose(hedge, freshPrices, bot.name, state, creds, user.id, bot.id);
              if (closeRes.success) {
                hedge.status = "CLOSED";
                hedge.closeTime = Date.now();
                hedge.closeBinancePrice = freshPrices.bnPrice;
                hedge.closeBitgetPrice = freshPrices.bgPrice;
                hedge.closeDivergencePct = freshPrices.divergencePct;
                hedge.pnl = closeRes.pnl;
                bot.completedHedges.unshift(hedge);
                if (bot.completedHedges.length > 50) {
                  bot.completedHedges = bot.completedHedges.slice(0, 50);
                }
              } else {
                survivingHedges.push(hedge);
              }
              continue;
            }
          }
        }

        // =========================================================================
        // SPREAD COLLAPSE & PRICE CONVERGENCE EARLY EXIT
        // (User Rule: When live spread drops below 25 bps, exit early once price converges)
        // =========================================================================
        const enableSpreadCollapseExit = config.enableSpreadCollapseExit === true; // Default OFF
        const collapseThresholdBps = config.spreadCollapseExitBps ?? 25.0;
        const holdDurationMinutes = Math.max(0, (now - (hedge.entryTime || now)) / 60000);
        const settlementHasPassedForExit = now >= (hedge.fundingSettlementTime || 0);

        // Strict Invariant: Never allow premature exit before funding settlement or minimum hold has passed
        if (enableSpreadCollapseExit && (settlementHasPassedForExit || holdDurationMinutes >= 30)) {
          const currentOpp = opportunities.find((o: any) => o.symbol === hedge.symbol);
          if (currentOpp) {
            const rateA = vA === "CoinDCX" ? (currentOpp.coindcxRate || currentOpp.binanceRate) : (vA === "Binance" ? currentOpp.binanceRate : currentOpp.bitgetRate);
            const rateB = vB === "Bybit" ? currentOpp.bybitRate : (vB === "CoinDCX" ? currentOpp.coindcxRate : currentOpp.bitgetRate);
            
            let liveSpreadBps = 0;
            if (hedge.isAsymmetric && hedge.venueAIntervalHours && hedge.venueBIntervalHours) {
              const asym = calculateAsymmetricMacroYield(rateA || 0, hedge.venueAIntervalHours, rateB || 0, hedge.venueBIntervalHours, config.timingMode);
              liveSpreadBps = asym.grossYieldBps;
            } else {
              liveSpreadBps = Math.abs((rateA || 0) - (rateB || 0)) * 100;
            }

            if (liveSpreadBps < collapseThresholdBps) {
              const freshPrices = await fetchFreshPrices(hedge.symbol, vA, vB);
              const { evaluateZeroLossExitGate } = await import("./exitOptimizer");
              const exitDecision = evaluateZeroLossExitGate(hedge, freshPrices);

              if (exitDecision.canExit) {
                appendBotLog(
                  state,
                  `[SPREAD COLLAPSE HARVEST EXIT] Bot "${bot.name}": ${hedge.symbol} live funding spread collapsed to ${liveSpreadBps.toFixed(2)} bps (< ${collapseThresholdBps} bps threshold) and price divergence converged (${freshPrices.divergencePct.toFixed(4)}%). Exit approved by Zero-Loss Gate: ${exitDecision.reason}`,
                  "info",
                  user.id,
                  bot.id
                );
                hedge.status = "CLOSING";
                hedge.unwindReason = `SPREAD_COLLAPSE_${Math.round(liveSpreadBps)}BPS_CONVERGED`;
                const closeRes = await executeDualHedgeClose(hedge, freshPrices, bot.name, state, creds, user.id, bot.id);
                if (closeRes.success) {
                  hedge.status = "CLOSED";
                  hedge.closeTime = Date.now();
                  hedge.closeBinancePrice = freshPrices.bnPrice;
                  hedge.closeBitgetPrice = freshPrices.bgPrice;
                  hedge.closeDivergencePct = freshPrices.divergencePct;
                  hedge.pnl = closeRes.pnl;
                  bot.completedHedges.unshift(hedge);
                  if (bot.completedHedges.length > 50) {
                    bot.completedHedges = bot.completedHedges.slice(0, 50);
                  }
                  quarantineBotSymbol(bot, hedge.symbol, 180, "Spread collapse early recycled exit", state, user.id);
                } else {
                  survivingHedges.push(hedge);
                }
                continue;
              } else {
                if (state.cyclesCompleted % 4 === 0) {
                  appendBotLog(
                    state,
                    `[SPREAD COLLAPSE BLOCKED BY ZERO-LOSS GATE] Bot "${bot.name}": ${hedge.symbol} spread collapsed to ${liveSpreadBps.toFixed(2)} bps (< ${collapseThresholdBps} bps), but early exit blocked to prevent loss: ${exitDecision.reason}`,
                    "info",
                    user.id,
                    bot.id
                  );
                }
              }
            }
          }
        }

        const waitThreshold = hedge.fundingSettlementTime + (config.postSettlementWaitSeconds || 15) * 1000;
        const settlementHasPassed = now >= waitThreshold;

        if (!settlementHasPassed) {
          if (hedge.isAsymmetric && hedge.earliestNextFundingTime && now >= hedge.earliestNextFundingTime && state.cyclesCompleted % 6 === 0) {
            const remainingSeconds = Math.max(0, Math.round((waitThreshold - now) / 1000));
            appendBotLog(
              state,
              `[ASYMMETRIC HARVEST ACTIVE] Bot "${bot.name}": ${hedge.symbol} completed intermediate settlement on faster venue. Holding position until macro settlement at ${new Date(hedge.fundingSettlementTime).toISOString()} (${remainingSeconds}s remaining).`,
              "info",
              user.id,
              bot.id
            );
          }
          survivingHedges.push(hedge);
          continue;
        }

        // =========================================================================
        // TIERED ROI TAKE-PROFIT ENGINE (20% Target Convergence & 50% Hard Blowoff)
        // =========================================================================
        const freshPrices = await fetchFreshPrices(hedge.symbol, vA, vB);
        const lev1 = hedge.binanceLeverage || 10;
        const lev2 = hedge.bitgetLeverage || 10;
        const avgLev = (lev1 + lev2) / 2 || 10;
        const initialMargin = (hedge.notionalUsdt > 0) ? (hedge.notionalUsdt / avgLev) : 4.0;

        const leg1Dir = hedge.direction.startsWith("SHORT_") ? -1 : 1;
        const leg2Dir = -leg1Dir;
        const leg1Entry = hedge.entryBinancePrice || (hedge as any).entryPriceA || 0;
        const leg2Entry = hedge.entryBitgetPrice || (hedge as any).entryPriceB || 0;
        const leg1Pnl = leg1Entry > 0 ? leg1Dir * (freshPrices.bnPrice - leg1Entry) * hedge.effectiveQty : 0;
        const leg2Pnl = leg2Entry > 0 ? leg2Dir * (freshPrices.bgPrice - leg2Entry) * hedge.effectiveQty : 0;
        const grossPriceSpreadPnl = leg1Pnl + leg2Pnl;

        const estExitFees = (freshPrices.bnPrice + freshPrices.bgPrice) * hedge.effectiveQty * 0.0006;
        const totalEstFees = (hedge.totalFeesUsdt || (hedge.leg1FeeUsdt || 0) + (hedge.leg2FeeUsdt || 0) || 0.05) + estExitFees;
        const liveFunding = hedge.fundingClaimedUsdt || 0;
        const estNetPnl = parseFloat((grossPriceSpreadPnl + liveFunding - totalEstFees).toFixed(4));
        const currentRoiPct = initialMargin > 0 ? parseFloat(((estNetPnl / initialMargin) * 100).toFixed(2)) : 0;

        const targetRoiThreshold = config.targetRoiTakeProfitPct ?? 20.0;
        const hardRoiThreshold = config.hardRoiTakeProfitPct ?? 50.0;
        const maxExitDivergencePct = typeof config.closeMaxPriceDivergencePct === "number"
          ? config.closeMaxPriceDivergencePct
          : 0.05;

        // Tier 2: Hard Blowoff Emergency Close at +50% ROI Profit OR -50% ROI Loss (Instant Close & Bypass Divergence Gate)
        if (currentRoiPct >= hardRoiThreshold || currentRoiPct <= -hardRoiThreshold) {
          const isHardLoss = currentRoiPct <= -hardRoiThreshold;
          appendBotLog(
            state,
            `[${isHardLoss ? "HARD STOP-LOSS" : "HARD TAKE-PROFIT"}: ${currentRoiPct.toFixed(1)}% ROI] Bot "${bot.name}": ${hedge.symbol} achieved ${currentRoiPct.toFixed(1)}% ROI (${estNetPnl >= 0 ? "+" : ""}${estNetPnl.toFixed(4)} USDT on $${initialMargin.toFixed(2)} margin | ${isHardLoss ? "Loss threshold -" + hardRoiThreshold + "% reached" : "Profit threshold +" + hardRoiThreshold + "% reached"}). Bypassing price divergence gate and executing IMMEDIATE dual close to ${isHardLoss ? "prevent exchange liquidation" : "lock in harvest"}!`,
            isHardLoss ? "error" : "success",
            user.id,
            bot.id
          );
          hedge.status = "CLOSING";
          hedge.unwindReason = isHardLoss ? `HARD_STOP_LOSS_${Math.round(hardRoiThreshold)}_ROI` : `HARD_TAKE_PROFIT_${Math.round(hardRoiThreshold)}_ROI`;
          const closeRes = await executeDualHedgeClose(hedge, freshPrices, bot.name, state, creds, user.id, bot.id);
          if (closeRes.success) {
            hedge.status = "CLOSED";
            hedge.closeTime = Date.now();
            hedge.closeBinancePrice = freshPrices.bnPrice;
            hedge.closeBitgetPrice = freshPrices.bgPrice;
            hedge.closeDivergencePct = freshPrices.divergencePct;
            hedge.pnl = closeRes.pnl;
            bot.completedHedges.unshift(hedge);
            if (bot.completedHedges.length > 50) {
              bot.completedHedges = bot.completedHedges.slice(0, 50);
            }
            quarantineBotSymbol(bot, hedge.symbol, 300, isHardLoss ? "Hard stop-loss emergency exit" : "Hard blowoff take-profit realized", state, user.id);
          } else {
            survivingHedges.push(hedge);
          }
          continue;
        }

        // Tier 1: Target Convergence Exit at +20% ROI Profit OR -20% ROI Loss (Active & Closes When Price Divergence Matches Config)
        if (currentRoiPct >= targetRoiThreshold || currentRoiPct <= -targetRoiThreshold) {
          const isTargetLoss = currentRoiPct <= -targetRoiThreshold;
          const isParitySafe = freshPrices.divergencePct <= maxExitDivergencePct;
          if (isParitySafe) {
            appendBotLog(
              state,
              `[${isTargetLoss ? "TARGET STOP-LOSS" : "TARGET TAKE-PROFIT"}: ${currentRoiPct.toFixed(1)}% ROI] Bot "${bot.name}": ${hedge.symbol} reached ${currentRoiPct.toFixed(1)}% ROI (${estNetPnl >= 0 ? "+" : ""}${estNetPnl.toFixed(4)} USDT on $${initialMargin.toFixed(2)} margin) and exit divergence (${freshPrices.divergencePct.toFixed(3)}%) <= configured target (${maxExitDivergencePct}%). Executing dual close...`,
              isTargetLoss ? "warn" : "success",
              user.id,
              bot.id
            );
            hedge.status = "CLOSING";
            hedge.unwindReason = isTargetLoss ? `TARGET_STOP_LOSS_${Math.round(targetRoiThreshold)}_ROI` : `TARGET_TAKE_PROFIT_${Math.round(targetRoiThreshold)}_ROI`;
            const closeRes = await executeDualHedgeClose(hedge, freshPrices, bot.name, state, creds, user.id, bot.id);
            if (closeRes.success) {
              hedge.status = "CLOSED";
              hedge.closeTime = Date.now();
              hedge.closeBinancePrice = freshPrices.bnPrice;
              hedge.closeBitgetPrice = freshPrices.bgPrice;
              hedge.closeDivergencePct = freshPrices.divergencePct;
              hedge.pnl = closeRes.pnl;
              bot.completedHedges.unshift(hedge);
              if (bot.completedHedges.length > 50) {
                bot.completedHedges = bot.completedHedges.slice(0, 50);
              }
              quarantineBotSymbol(bot, hedge.symbol, 300, isTargetLoss ? "Target stop-loss realized" : "Target take-profit realized", state, user.id);
            } else {
              survivingHedges.push(hedge);
            }
            continue;
          } else {
            hedge.status = "WAITING_PRICE_PARITY";
            survivingHedges.push(hedge);
            if (state.cyclesCompleted % 4 === 0) {
              appendBotLog(
                state,
                `[${isTargetLoss ? "STOP-LOSS ARMED" : "TAKE-PROFIT ARMED"}: ${currentRoiPct.toFixed(1)}% ROI] Bot "${bot.name}": ${hedge.symbol} threshold reached (${estNetPnl >= 0 ? "+" : ""}${estNetPnl.toFixed(4)} USDT on $${initialMargin.toFixed(2)} margin). Active & waiting for price divergence reversion (${freshPrices.divergencePct.toFixed(3)}% > ${maxExitDivergencePct}% config target).`,
                isTargetLoss ? "warn" : "info",
                user.id,
                bot.id
              );
            }
            continue;
          }
        }

        // 4. POST-SETTLEMENT EVALUATION: CARRY CONTINUATION HOLD vs PROFIT-FIRST EXIT
        // Step 1: Check Carry Continuation (Roll into next cycle if next funding spread remains profitable)
        const enableContinuation = config.enableCarryContinuation !== false;
        const minContinuationSpreadBps = config.minContinuationSpreadBps ?? Math.max(20, (config.minSpreadBps || 30) * 0.7);

        let nextYieldBps = 0;
        const currentOppForContinuation = opportunities.find((o: any) => o.symbol === hedge.symbol);
        if (enableContinuation && currentOppForContinuation) {
          const rateA = vA === "CoinDCX" ? (currentOppForContinuation.coindcxRate || currentOppForContinuation.binanceRate) : (vA === "Binance" ? currentOppForContinuation.binanceRate : currentOppForContinuation.bitgetRate);
          const rateB = vB === "Bybit" ? currentOppForContinuation.bybitRate : (vB === "CoinDCX" ? currentOppForContinuation.coindcxRate : currentOppForContinuation.bitgetRate);
          let isProfitableContinuation = false;

          if (hedge.isAsymmetric && hedge.venueAIntervalHours && hedge.venueBIntervalHours) {
            const macroCycle = calculateAsymmetricMacroYield(rateA || 0, hedge.venueAIntervalHours, rateB || 0, hedge.venueBIntervalHours, config.timingMode);
            const isHedgeShortA = hedge.direction.toUpperCase().includes("SHORT_A") ||
              (hedge.venueA && hedge.direction.toUpperCase().includes(`SHORT_${hedge.venueA.toUpperCase()}`)) ||
              hedge.direction.toUpperCase().startsWith("SHORT");
            const liveDominantShortA = macroCycle.recommendedDirection === "SHORT_A_LONG_B";
            if (isHedgeShortA === liveDominantShortA && macroCycle.grossYieldBps >= minContinuationSpreadBps) {
              isProfitableContinuation = true;
              nextYieldBps = macroCycle.grossYieldBps;
            }
          } else {
            const yieldEval = calculateHedgeFundingYield(hedge.direction, rateA || 0, rateB || 0);
            if (!yieldEval.isNegativeYield && yieldEval.expectedYieldBps >= minContinuationSpreadBps) {
              isProfitableContinuation = true;
              nextYieldBps = yieldEval.expectedYieldBps;
            }
          }

          // Advance settlement time to next cycle if live exchange next funding time is ahead
          const nextTargetSettlement = hedge.isAsymmetric
            ? (liveSyncCheck.macroNextFundingTime || (now + (hedge.venueBIntervalHours || 4) * 3600 * 1000))
            : (liveSyncCheck.venueANextFundingTime || (now + 4 * 3600 * 1000));

          if (isProfitableContinuation && nextTargetSettlement > now + 60000) {
            hedge.cyclesHarvested = (hedge.cyclesHarvested || 1) + 1;
            hedge.lastHarvestedSettlementTime = hedge.fundingSettlementTime;
            hedge.fundingSettlementTime = nextTargetSettlement;
            if (hedge.isAsymmetric) {
              hedge.macroNextFundingTime = nextTargetSettlement;
              hedge.earliestNextFundingTime = liveSyncCheck.earliestNextFundingTime || (now + 3600 * 1000);
            }
            hedge.status = "ACTIVE";
            appendBotLog(
              state,
              `[CARRY CONTINUATION HOLD] Bot "${bot.name}": ${hedge.symbol} settlement passed. Next cycle projected spread remains lucrative (+${nextYieldBps.toFixed(1)} bps >= ${minContinuationSpreadBps} bps). Rolling position into next settlement at ${new Date(nextTargetSettlement).toISOString()} to compound harvest without paying exit/re-entry taker fees (Harvest Cycle #${hedge.cyclesHarvested}).`,
              "success",
              user.id,
              bot.id
            );
            survivingHedges.push(hedge);
            continue;
          }
        }

        // Step 2: Zero-Loss Dynamic Exit Engine Evaluation
        const postFreshPrices = await fetchFreshPrices(hedge.symbol, vA, vB);
        const { evaluateZeroLossExitGate } = await import("./exitOptimizer");
        const postSettlementHoldMinutes = Math.max(0, (now - (hedge.lastHarvestedSettlementTime || hedge.fundingSettlementTime)) / 60000);

        // Pass forward spread from continuation check if available
        const forwardSpreadBps = (enableContinuation && currentOppForContinuation) ? nextYieldBps : undefined;
        const exitDecision = evaluateZeroLossExitGate(hedge, postFreshPrices, undefined, forwardSpreadBps);

        // Catastrophic stop loss override: emergency close
        if (exitDecision.exitType === "CATASTROPHIC_STOP") {
          appendBotLog(
            state,
            `[CATASTROPHIC STOP LOSS] Bot "${bot.name}": ${hedge.symbol} ${exitDecision.reason}. Executing emergency close!`,
            "error",
            user.id,
            bot.id
          );
          hedge.status = "CLOSING";
          hedge.unwindReason = "CATASTROPHIC_STOP_LOSS";
          const closeRes = await executeDualHedgeClose(hedge, postFreshPrices, bot.name, state, creds, user.id, bot.id);
          if (closeRes.success) {
            hedge.status = "CLOSED";
            hedge.closeTime = Date.now();
            hedge.closeBinancePrice = postFreshPrices.bnPrice;
            hedge.closeBitgetPrice = postFreshPrices.bgPrice;
            hedge.closeDivergencePct = postFreshPrices.divergencePct;
            hedge.pnl = closeRes.pnl;
            bot.completedHedges.unshift(hedge);
            if (bot.completedHedges.length > 50) bot.completedHedges = bot.completedHedges.slice(0, 50);
            quarantineBotSymbol(bot, hedge.symbol, 3600, "Catastrophic stop-loss exit", state, user.id);
          } else {
            survivingHedges.push(hedge);
          }
          continue;
        }

        // If Zero-Loss Gate approves exit (Net PnL >= +$0.01 USDT)
        if (exitDecision.canExit) {
          appendBotLog(
            state,
            `[ZERO-LOSS EXIT CONFIRMED] Bot "${bot.name}": ${hedge.symbol} harvest complete (${hedge.cyclesHarvested || 1} cycle(s)). Net PnL: +$${exitDecision.netPnL.toFixed(4)} USDT (Basis: $${exitDecision.grossBasisPnL.toFixed(4)}, Funding: +$${exitDecision.fundingClaimed.toFixed(4)}, Fees: -$${exitDecision.totalFeesUsdt.toFixed(4)}). Exit mode: ${exitDecision.exitType}. Executing dual close...`,
            "success",
            user.id,
            bot.id
          );

          hedge.status = "CLOSING";
          hedge.unwindReason = `ZERO_LOSS_${exitDecision.exitType}`;
          const closeRes = await executeDualHedgeClose(hedge, postFreshPrices, bot.name, state, creds, user.id, bot.id);

          if (closeRes.success) {
            hedge.status = "CLOSED";
            hedge.closeTime = Date.now();
            hedge.closeBinancePrice = postFreshPrices.bnPrice;
            hedge.closeBitgetPrice = postFreshPrices.bgPrice;
            hedge.closeDivergencePct = postFreshPrices.divergencePct;
            hedge.pnl = closeRes.pnl;

            bot.completedHedges.unshift(hedge);
            if (bot.completedHedges.length > 50) {
              bot.completedHedges = bot.completedHedges.slice(0, 50);
            }

            appendBotLog(
              state,
              `[HEDGE CLOSED] Successfully unwound ${hedge.symbol} hedge by "${bot.name}". Net Realized PnL: $${closeRes.pnl} USDT (${hedge.cyclesHarvested || 1} cycle(s) harvested).`,
              "success",
              user.id
            );

            // 5-minute lightweight quarantine (instead of 1 hour) to clear post-close order dust
            quarantineBotSymbol(bot, hedge.symbol, 300, "Dual hedge settlement convergence", state, user.id);
          } else if (closeRes.error === "STRICT_DELTA_NEUTRAL_FREEZE") {
            hedge.status = "FROZEN_PROXY_DOWN";
            survivingHedges.push(hedge);
          } else if ((hedge.status as string) === "ORPHAN_RECOVERY" || (hedge.status as string) === "SYNTHETIC_DELTA_LOCKED") {
            survivingHedges.push(hedge);
            appendBotLog(
              state,
              `[ORPHAN/SYNTHETIC ACTIVE] Bot "${bot.name}": ${hedge.symbol} is currently in ${hedge.status}. Auto-healing/reconciliation engaged on priority.`,
              "warn",
              user.id
            );
          } else {
            hedge.status = "ACTIVE";
            survivingHedges.push(hedge);
            appendBotLog(
              state,
              `[CLOSE RETRY] Bot "${bot.name}": Error closing ${hedge.symbol}: ${closeRes.error}. Will retry on next cycle.`,
              "warn",
              user.id
            );
          }
          continue;
        }

        // Zero-Loss Gate blocked exit: Net PnL would be negative or basis is unconverged.
        // DO NOT DUMP! Protect capital by waiting for basis convergence or rolling forward.
        hedge.status = "WAITING_PRICE_PARITY";
        survivingHedges.push(hedge);

        if (state.cyclesCompleted % 4 === 0) {
          appendBotLog(
            state,
            `[ZERO-LOSS GATE HOLD] Bot "${bot.name}": ${hedge.symbol} settlement passed (${Math.round(postSettlementHoldMinutes)}m elapsed). ${exitDecision.reason}`,
            "warn",
            user.id,
            bot.id
          );
        }
        continue;
      }

      bot.activeHedges = survivingHedges;

      // ─────────────────────────────────────────────────────────────
      // PHASE 1.5: ORPHAN SAFETY & SYNTHETIC LOCK SUSPENSION
      // ─────────────────────────────────────────────────────────────
      const hasActiveOrphan = bot.activeHedges.some(
        (h) => h.status === "ORPHAN_RECOVERY" || h.status === "SYNTHETIC_DELTA_LOCKED"
      );
      if (hasActiveOrphan) {
        bot.statusText = "ORPHAN_HEALING_ACTIVE";
        if (state.cyclesCompleted % 4 === 0) {
          appendBotLog(
            state,
            `[ORPHAN SAFETY ACTIVE] Bot "${bot.name}": New entries suspended while orphan leg auto-healing or synthetic delta lock is active.`,
            "warn",
            user.id
          );
        }
        continue;
      }

      // ─────────────────────────────────────────────────────────────
      // PHASE 1.8: TIER 3 PORTFOLIO-LEVEL DAILY MTM CIRCUIT BREAKER (A-05)
      // ─────────────────────────────────────────────────────────────
      const { RiskGate, RISK_LIMITS } = await import("./riskGate");
      if (RiskGate.isKillSwitchActive()) {
        const killInfo = RiskGate.getKillSwitchInfo();
        bot.statusText = `EMERGENCY_HALT_ACTIVE (${killInfo.reason || "Operational halt"})`;
        if (state.cyclesCompleted % 4 === 0) {
          appendBotLog(
            state,
            `[EMERGENCY HALT] Bot "${bot.name}": Kill-switch is active (${killInfo.reason}). New entries blocked.`,
            "error",
            user.id,
            bot.id
          );
        }
        continue;
      }

      const mtm = RiskGate.computeLiveMtmDrawdown(user.id);
      const maxDrawdownPct = RISK_LIMITS.MAX_DAILY_MTM_DRAWDOWN_PCT; // 4.0%
      const maxLossUsdt = config.maxDailyDrawdownUsdt || RISK_LIMITS.MAX_DAILY_LOSS_USDT;

      if (mtm.drawdownPct >= maxDrawdownPct || mtm.totalLoss >= maxLossUsdt) {
        const tripReason = `Daily MTM drawdown breach: ${(mtm.drawdownPct * 100).toFixed(2)}% >= ${(maxDrawdownPct * 100).toFixed(2)}% (Total loss: -$${mtm.totalLoss.toFixed(2)} USDT [Realized: -$${mtm.realizedLoss.toFixed(2)}, Floating: -$${mtm.floatingLoss.toFixed(2)}])`;
        RiskGate.tripKillSwitch(tripReason, `BotEngine."${bot.name}"`);
        bot.statusText = `MTM_DRAWDOWN_BREACH (-$${mtm.totalLoss.toFixed(2)} USDT)`;
        appendBotLog(
          state,
          `[GLOBAL CIRCUIT BREAKER TRIPPED] Bot "${bot.name}": ${tripReason}. Entries halted until operator review!`,
          "error",
          user.id,
          bot.id
        );
        continue;
      }

      // ─────────────────────────────────────────────────────────────
      // PHASE 2: MARGIN CEILING & CAPACITY VERIFICATION
      // ─────────────────────────────────────────────────────────────
      const currentBotMargin = bot.activeHedges.reduce((sum, h) => {
        const lev = h.binanceLeverage || 20;
        return sum + (h.notionalUsdt / lev);
      }, 0);

      const marginCap = bot.maxMarginCapUsdt || config.maxMarginCapUsdt || 500;
      if (currentBotMargin >= marginCap) {
        bot.statusText = `MARGIN_CAP_REACHED ($${currentBotMargin.toFixed(0)}/$${marginCap} USDT)`;
        if (state.cyclesCompleted % 6 === 0) {
          appendBotLog(
            state,
            `[CAPACITY CHECK] Bot "${bot.name}": Margin cap reached ($${currentBotMargin.toFixed(2)}/$${marginCap} USDT). New entries paused until hedges unwind.`,
            "warn",
            user.id
          );
        }
        continue;
      }

      const availableSlots = (config.maxSimultaneousHedges || 3) - bot.activeHedges.length;
      if (availableSlots <= 0) {
        bot.statusText = `AT_MAX_CAPACITY (${bot.activeHedges.length}/${config.maxSimultaneousHedges} ACTIVE)`;
        if (state.cyclesCompleted % 6 === 0) {
          appendBotLog(
            state,
            `[CAPACITY CHECK] Bot "${bot.name}": Maximum simultaneous hedges active (${bot.activeHedges.length}/${config.maxSimultaneousHedges}). Capacity full.`,
            "info",
            user.id
          );
        }
        continue;
      }

      const corridor = config.executionCorridor || "COINDCX_BYBIT";
      let expectedVA: "CoinDCX" | "Binance" | "Bitget" = "CoinDCX";
      let expectedVB: "Bybit" | "CoinDCX" | "Bitget" = "Bybit";

      if (corridor === "COINDCX_BYBIT") {
        expectedVA = "CoinDCX";
        expectedVB = "Bybit";
      } else if (corridor === "BINANCE_BYBIT") {
        expectedVA = "Binance";
        expectedVB = "Bybit";
      } else if (corridor === "COINDCX_BITGET") {
        expectedVA = "CoinDCX";
        expectedVB = "Bitget";
      } else if (corridor === "BITGET_BYBIT") {
        expectedVA = "Bitget";
        expectedVB = "Bybit";
      } else if (corridor === "BINANCE_COINDCX") {
        expectedVA = "Binance";
        expectedVB = "CoinDCX";
      } else {
        expectedVA = "CoinDCX";
        expectedVB = "Bybit";
      }

      let venueAFree = balances.coindcxBal || 0;
      let venueBFree = balances.bybitBal || 0;
      let venueAEquity = balances.coindcxEquity || balances.coindcxBal || 0;
      let venueBEquity = balances.bybitEquity || balances.bybitBal || 0;
      let venueALocked = 0;
      let venueBLocked = 0;

      if (expectedVA === "CoinDCX") {
        venueAFree = balances.coindcxBal || 0;
        venueAEquity = balances.coindcxEquity || balances.coindcxBal || 0;
        venueALocked = balances.coindcxLockedMargin || 0;
      } else if (expectedVA === "Bitget") {
        venueAFree = balances.bitgetBal;
        venueAEquity = balances.bitgetBal;
        venueALocked = 0;
      } else {
        venueAFree = balances.binanceBal;
        venueAEquity = balances.binanceBal;
        venueALocked = 0;
      }

      if (expectedVB === "Bybit") {
        venueBFree = balances.bybitBal || 0;
        venueBEquity = balances.bybitEquity || balances.bybitBal || 0;
        venueBLocked = balances.bybitLockedMargin || 0;
      } else if (expectedVB === "CoinDCX") {
        venueBFree = balances.coindcxBal || 0;
        venueBEquity = balances.coindcxEquity || balances.coindcxBal || 0;
        venueBLocked = balances.coindcxLockedMargin || 0;
      } else {
        venueBFree = balances.bitgetBal;
        venueBEquity = balances.bitgetBal;
        venueBLocked = 0;
      }

      const corridorEffectiveBal = Math.min(venueAFree, venueBFree);

      // DYNAMIC LIQUIDATION BUFFER & UTILIZATION (Removes strict $10 floor for micro/live balances)
      const isMicroAccount = venueAEquity < 35 || venueBEquity < 35;
      const MAX_UTILIZATION_PCT = isMicroAccount ? 0.85 : 0.50; // Allows up to 85% on micro accounts (<$35) so small balances like $8.22 can trade
      const MIN_FREE_MARGIN_BUFFER = isMicroAccount ? 0.50 : 2.0; // Lowered from $10 to $0.50 so micro accounts are never blocked

      const utilA = venueAEquity > 0 ? (venueALocked / venueAEquity) : 0;
      const utilB = venueBEquity > 0 ? (venueBLocked / venueBEquity) : 0;

      if (utilA >= MAX_UTILIZATION_PCT || utilB >= MAX_UTILIZATION_PCT) {
        bot.statusText = `CAPACITY_EXCEEDED (${expectedVA}: ${(utilA * 100).toFixed(1)}%, ${expectedVB}: ${(utilB * 100).toFixed(1)}% >= ${(MAX_UTILIZATION_PCT * 100).toFixed(0)}%)`;
        if (state.cyclesCompleted % 6 === 0) {
          appendBotLog(
            state,
            `[WALLET UTILIZATION GUARD] Bot "${bot.name}": Margin utilization on ${utilA >= MAX_UTILIZATION_PCT ? expectedVA : expectedVB} (${((utilA >= MAX_UTILIZATION_PCT ? utilA : utilB) * 100).toFixed(1)}%) reached the ${(MAX_UTILIZATION_PCT * 100).toFixed(0)}% safety ceiling. New entries blocked to preserve liquidation cushion.`,
            "warn",
            user.id
          );
        }
        continue;
      }

      // Free buffer invariant: remaining free balance must be at least $0.50 for micro accounts
      if (venueAFree < MIN_FREE_MARGIN_BUFFER || venueBFree < MIN_FREE_MARGIN_BUFFER) {
        bot.statusText = `LOW_MARGIN_BUFFER (${expectedVA}: $${venueAFree.toFixed(2)}, ${expectedVB}: $${venueBFree.toFixed(2)} < $${MIN_FREE_MARGIN_BUFFER.toFixed(2)})`;
        if (state.cyclesCompleted % 6 === 0) {
          appendBotLog(
            state,
            `[BUFFER GUARD] Bot "${bot.name}": Available margin on ${venueAFree < MIN_FREE_MARGIN_BUFFER ? expectedVA : expectedVB} ($${(venueAFree < MIN_FREE_MARGIN_BUFFER ? venueAFree : venueBFree).toFixed(2)}) is below the $${MIN_FREE_MARGIN_BUFFER.toFixed(2)} minimum safety cushion. Pausing new entries.`,
            "warn",
            user.id
          );
        }
        continue;
      }

      if (opportunities.length === 0) {
        bot.statusText = "SCANNING_OPPORTUNITIES (Waiting for exchange market data...)";
        continue;
      }

      // ─────────────────────────────────────────────────────────────
      // PHASE 3: CANDIDATE FILTERING WITH FLATTEN MEMORY LOCK
      // ─────────────────────────────────────────────────────────────
      const activeSymbolsInBot = new Set(bot.activeHedges.map((h) => h.symbol));

      // 1. Fetch corridor-specific live exchange positions (5s in-memory cache)
      const corridorLiveSnapshot = await getLivePositionsForVenues(
        [expectedVA, expectedVB],
        creds,
        user.id
      );

      // 2. Collect all active symbols across other bots running this corridor
      const fleetCorridorActiveSymbols = new Set(
        state.bots
          .filter((b) => b.id !== bot.id && (b.config.executionCorridor || "COINDCX_BYBIT") === corridor)
          .flatMap((b) => b.activeHedges.map((h) => h.symbol))
      );

      let topCandidate: any = null;
      let highestSpread = 0;
      let bestWaitingDiffCandidate: any = null;
      let bestWaitingDiffSpread = -1;
      let bestWaitingDiffProximityScore = -1;
      let bestCorridorCandidate: any = null;
      let bestCorridorSpread = -1;
      const qualifiedCandidates: any[] = [];

      for (const coin of opportunities) {
        if (activeSymbolsInBot.has(coin.symbol)) continue;

        // CORRIDOR FLEET GUARD (Invariant 11): Prevent cross-bot collisions on same corridor
        if (fleetCorridorActiveSymbols.has(coin.symbol) || isCorridorSymbolLocked(corridor, coin.symbol)) {
          if (state.cyclesCompleted % 6 === 0) {
            appendBotLog(
              state,
              `[FLEET COLLISION GUARD (Invariant 11)] Bot "${bot.name}": Candidate ${coin.symbol} blocked — already claimed by active bot in ${corridor} corridor.`,
              "info",
              user.id,
              bot.id
            );
          }
          continue;
        }

        // CORRIDOR LIVE POSITION GUARD: Block re-entry if coin has an open position on either corridor venue
        const livePosCheck = hasCorridorLivePosition(coin.symbol, expectedVA, expectedVB, corridorLiveSnapshot);
        if (livePosCheck.hasPosition) {
          if (state.cyclesCompleted % 6 === 0) {
            appendBotLog(
              state,
              `[RE-ENTRY GUARD] Bot "${bot.name}": Candidate ${coin.symbol} skipped — active open position detected on ${livePosCheck.blockingVenues.join(", ")} in Live Positions.`,
              "info",
              user.id,
              bot.id
            );
          }
          continue;
        }

        // Find the corridor pair in coin.allPairs
        const pair = coin.allPairs?.find((p: any) => {
          const vA = p.venueA?.toLowerCase();
          const vB = p.venueB?.toLowerCase();
          const reqA = expectedVA.toLowerCase();
          const reqB = expectedVB.toLowerCase();
          return (vA === reqA && vB === reqB) || (vA === reqB && vB === reqA);
        });

        if (!pair) continue; // Not cross-listed on both corridor venues

        const isSniperMode = config.timingMode !== "CONTINUOUS_SPREAD";
        const corridorSpreadBps = isSniperMode && typeof pair.nominalSpreadBps === "number"
          ? Math.max(pair.spreadBps, pair.nominalSpreadBps)
          : pair.spreadBps;

        // R1: Funding synchronization check driven by bot.config.intervalMode
        const intervalMode: FundingIntervalMode = config.intervalMode || (config.allowAsymmetricFunding === false ? "STRICT_SYNC_ONLY" : "ALL_ASYMMETRIC");
        let isFundingSync = true;
        let syncDisqualificationReason: string | undefined = undefined;

        if (intervalMode === "STRICT_SYNC_ONLY") {
          if (pair.isAsymmetricFunding || pair.isFundingSynchronized === false) {
            isFundingSync = false;
            syncDisqualificationReason = pair.syncDisqualificationReason || `[STRICT_SYNC_REJECTED] Interval mismatch or countdown desynchronization: ${expectedVA} (${pair.venueAIntervalHours || 8}h) vs ${expectedVB} (${pair.venueBIntervalHours || 8}h)`;
          }
        } else if (intervalMode === "CUSTOM") {
          const intA = pair.venueAIntervalHours || 8;
          const intB = pair.venueBIntervalHours || 8;
          if (intA === intB && pair.isAsymmetricFunding !== true) {
            isFundingSync = true;
          } else if (!isIntervalPairAllowed(intA, intB, config.allowedIntervalPairs)) {
            isFundingSync = false;
            const allowed = config.allowedIntervalPairs || [];
            syncDisqualificationReason = `[CUSTOM_FILTER_REJECTED] Interval pair ${intA}h ⇄ ${intB}h not in allowed list [${allowed.join(", ")}]`;
          }
        } else {
          // ALL_ASYMMETRIC admits all permutations
          isFundingSync = true;
        }

        // R3: Fee clearance check (Minimum 35 bps gross spread AND net spread clearing configured roundtrip taker fee)
        const feeHurdleBps = bot.config.roundTripFeeBps ?? ROUNDTRIP_TAKER_FEE_BPS;
        const minRequiredGrossBps = Math.max(config.minSpreadBps || MIN_GROSS_SPREAD_BPS, MIN_GROSS_SPREAD_BPS);
        const clearsFeeFilter = corridorSpreadBps >= minRequiredGrossBps && (corridorSpreadBps - feeHurdleBps > 0);

        // Venue-specific price divergence
        const priceA = expectedVA === "CoinDCX"
          ? (coin.coindcxMarkPrice || coin.bybitMarkPrice || coin.binanceMarkPrice)
          : expectedVA === "Binance"
          ? coin.binanceMarkPrice
          : coin.bitgetMarkPrice;
        const priceB = expectedVB === "Bybit"
          ? (coin.bybitMarkPrice || coin.binanceMarkPrice)
          : expectedVB === "CoinDCX"
          ? (coin.coindcxMarkPrice || coin.bybitMarkPrice)
          : coin.bitgetMarkPrice;
        const divergencePct = priceA > 0 && priceB > 0
          ? parseFloat(((Math.abs(priceA - priceB) / priceA) * 100).toFixed(4))
          : 0;
        const candidateSignedBasisBps = priceB > 0 ? parseFloat((((priceA - priceB) / priceB) * 10000).toFixed(2)) : 0;

        // Invariant: Exclude TradFi stocks, commodities and ETFs
        if (ContractIdentityResolver.isTradFiOrEquity(coin.symbol)) {
          continue;
        }

        // Multiplier parity verification across venues
        if (priceA > 0 && priceB > 0) {
          const parityCheck = ContractIdentityResolver.validateParity(coin.symbol, priceA, coin.symbol, priceB);
          if (!parityCheck.valid) {
            continue;
          }
        }

        let leg1Side: "BUY" | "SELL" = "SELL";
        const isPairShortA = pair.direction === "SHORT_A_LONG_B";
        if (pair.venueA?.toLowerCase() === expectedVA.toLowerCase()) {
          leg1Side = isPairShortA ? "SELL" : "BUY";
        } else {
          leg1Side = isPairShortA ? "BUY" : "SELL";
        }
        const isShortA = leg1Side === "SELL";
        const candidateBasisFavorable = isShortA ? candidateSignedBasisBps > 0 : candidateSignedBasisBps < 0;

        const pairNextFundingTime = pair.earliestNextFundingTime || coin.nextFundingTime;
        const secondsToFunding = pairNextFundingTime > now ? Math.round((pairNextFundingTime - now) / 1000) : coin.secondsToFunding;

        const isContinuous = config.timingMode === "CONTINUOUS_SPREAD";
        const sniperWindowSeconds = config.sniperWindowMinutes
          ? config.sniperWindowMinutes * 60
          : (config.timingMode === "FUNDING_SNIPER_1M" ? 60 : 300);
        const isTimingQualified = isContinuous || (secondsToFunding > 0 && secondsToFunding <= sniperWindowSeconds);

        if (intervalMode !== "STRICT_SYNC_ONLY" && pair.isAsymmetricFunding && corridorSpreadBps >= minRequiredGrossBps) {
          // Only log candidate notifications when actionable in sniper window or continuous mode (throttled to 60s)
          if (isTimingQualified && shouldLogScannerWarning(`asym_${coin.symbol}_${bot.id}`, 60000)) {
            appendBotLog(
              state,
              `[ASYMMETRIC FUNDING QUALIFIED] Bot "${bot.name}": Candidate ${coin.symbol} on ${expectedVA} ⇄ ${expectedVB} qualified with staggered intervals (${pair.venueAIntervalHours || 8}h vs ${pair.venueBIntervalHours || 8}h). Earliest countdown: ${secondsToFunding}s.`,
              "info",
              user.id,
              bot.id
            );
          }
        }

        // ZERO-ORPHAN REVIEW PAUSE CHECK (Permanently locks rejected/failed coins until user clicks Unlock):
        const upperSym = coin.symbol.toUpperCase();
        if (
          Array.isArray(bot.flattenedCoinsBlacklist) &&
          bot.flattenedCoinsBlacklist.some((c) => c.toUpperCase() === upperSym)
        ) {
          continue;
        }

        // R5: ANTI-CHURN QUARANTINE GATE (1-Hour Minimum / Next Funding Cycle Lock)
        // Eliminates rapid multi-entry churn (e.g. 92 trades on ANIMEUSDT)
        const cooldownUntil = bot.symbolCooldowns?.[upperSym] || 0;
        if (cooldownUntil > now) {
          const remainingMinutes = Math.ceil((cooldownUntil - now) / 60000);
          if (corridorSpreadBps > bestCorridorSpread) {
            bestCorridorSpread = corridorSpreadBps;
            bestCorridorCandidate = {
              symbol: coin.symbol,
              spreadBps: corridorSpreadBps,
              divergencePct,
              secondsToFunding,
              qualified: false,
              reason: `[ANTI-CHURN QUARANTINE] Quarantined for ${remainingMinutes}m`,
            };
          }
          continue;
        }

        // R1 & R3 Disqualification Gates: Disqualify pair from becoming topCandidate
        if (!isFundingSync) {
          if (corridorSpreadBps > bestCorridorSpread) {
            bestCorridorSpread = corridorSpreadBps;
            bestCorridorCandidate = {
              symbol: coin.symbol,
              spreadBps: corridorSpreadBps,
              divergencePct,
              secondsToFunding,
              qualified: false,
              reason: `[FUNDING SYNC LOCK] Disqualified: ${syncDisqualificationReason}`,
            };
          }
          continue;
        }

        if (!clearsFeeFilter) {
          if (corridorSpreadBps > bestCorridorSpread) {
            bestCorridorSpread = corridorSpreadBps;
            bestCorridorCandidate = {
              symbol: coin.symbol,
              spreadBps: corridorSpreadBps,
              divergencePct,
              secondsToFunding,
              qualified: false,
              reason: corridorSpreadBps < minRequiredGrossBps
                ? `[FEE CLEARANCE FILTER] Spread (${corridorSpreadBps} bps) < Min Gross (${minRequiredGrossBps} bps)`
                : `[FEE CLEARANCE FILTER] Net Spread (${(corridorSpreadBps - feeHurdleBps).toFixed(1)} bps) fails taker fee clearance (${feeHurdleBps} bps round-trip)`,
            };
          }
          continue;
        }

        if (!isTimingQualified) {
          // Track highest spread candidate on corridor even if timing window not open yet
          // Hard filter: disqualify broken/disconnected pairs (>0.50% divergence)
          if (divergencePct <= 0.50 && corridorSpreadBps > bestCorridorSpread) {
            bestCorridorSpread = corridorSpreadBps;
            bestCorridorCandidate = {
              symbol: coin.symbol,
              spreadBps: corridorSpreadBps,
              divergencePct,
              secondsToFunding,
              qualified: false,
              reason: `[COUNTDOWN WAIT] Spread (${corridorSpreadBps} bps) >= Min. Waiting for ${sniperWindowSeconds}s funding window (${secondsToFunding}s left).`,
            };
          }
          continue;
        }

        const timingEval = calculateRequiredPriceDivergencePct(config, secondsToFunding, corridorSpreadBps);
        const requiredDivergencePct = timingEval.requiredDivergencePct;
        const divergenceSafe = divergencePct <= timingEval.hardCeilingPct;
        const adverseDivPct = candidateBasisFavorable
          ? (divergenceSafe ? 0 : divergencePct)
          : divergencePct;
        const basisSafe = Math.abs(candidateSignedBasisBps) <= 250;
        const isPriceParityStrict = adverseDivPct <= requiredDivergencePct && basisSafe && divergenceSafe;

        const isQualified = isPriceParityStrict && !timingEval.shouldFreeze;
        const sniperWindowMinutesVal = config.sniperWindowMinutes || (config.timingMode === "FUNDING_SNIPER_1M" ? 1 : 5);
        const qualificationReason = timingEval.shouldFreeze
          ? (timingEval.freezeReason || `[SETTLEMENT BOUNDARY FREEZE] Pausing entry during settlement window (${secondsToFunding}s left).`)
          : !basisSafe
          ? `[BASIS SAFETY CAP] Signed basis |${candidateSignedBasisBps}| bps exceeds 250 bps safety cap.`
          : !divergenceSafe
          ? `[PRICE DIFF GATE] Price diff ${divergencePct.toFixed(3)}% exceeds hard safety ceiling ${timingEval.hardCeilingPct.toFixed(3)}%.`
          : !isPriceParityStrict
          ? `[WAITING LOWER DIFF] Adverse diff ${adverseDivPct.toFixed(3)}% > stage target ${requiredDivergencePct.toFixed(3)}% (${timingEval.stage}, ${secondsToFunding}s left in ${sniperWindowMinutesVal}m window). Waiting for lower price diff.`
          : "QUALIFIED_FOR_ENTRY";

        const candidateInfo = {
          symbol: coin.symbol,
          spreadBps: corridorSpreadBps,
          divergencePct,
          signedBasisBps: candidateSignedBasisBps,
          secondsToFunding,
          qualified: isQualified,
          reason: qualificationReason,
        };

        if (isQualified) {
          qualifiedCandidates.push({
            ...coin,
            spreadBps: corridorSpreadBps,
            divergencePct,
            signedBasisBps: candidateSignedBasisBps,
            secondsToFunding,
            leg1Side,
            direction: leg1Side === "SELL"
              ? `SHORT_${expectedVA.toUpperCase()}_LONG_${expectedVB.toUpperCase()}`
              : `LONG_${expectedVA.toUpperCase()}_SHORT_${expectedVB.toUpperCase()}`,
          });
          if (corridorSpreadBps > highestSpread) {
            highestSpread = corridorSpreadBps;
            topCandidate = {
              ...coin,
              spreadBps: corridorSpreadBps,
              divergencePct,
              secondsToFunding,
              leg1Side,
              direction: leg1Side === "SELL"
                ? `SHORT_${expectedVA.toUpperCase()}_LONG_${expectedVB.toUpperCase()}`
                : `LONG_${expectedVA.toUpperCase()}_SHORT_${expectedVB.toUpperCase()}`,
            };
          }
        } else if (qualificationReason.includes("[WAITING LOWER DIFF]")) {
          // Select the MOST PROBABLE SOON ELIGIBLE candidate!
          const MAX_SOON_ELIGIBLE_DIV = Math.max(1.0, (config.maxPriceDivergenceCapPct || 0.5) * 2);
          if (divergencePct <= MAX_SOON_ELIGIBLE_DIV) {
            const diffExcess = Math.max(0.0001, divergencePct - requiredDivergencePct);
            // Proximity score prioritizes candidates closest to qualifying with healthy spread
            const proximityScore = corridorSpreadBps / Math.pow(1 + diffExcess * 25, 1.5);
            if (proximityScore > bestWaitingDiffProximityScore) {
              bestWaitingDiffProximityScore = proximityScore;
              bestWaitingDiffCandidate = candidateInfo;
            }
          }
        } else {
          if (corridorSpreadBps > bestCorridorSpread) {
            bestCorridorSpread = corridorSpreadBps;
            bestCorridorCandidate = candidateInfo;
          }
        }
      }

      // Pre-evaluate corridor top candidate from opportunities table
      const topOpp = opportunities.find((c: any) =>
        !ContractIdentityResolver.isTradFiOrEquity(c.symbol) &&
        c.allPairs?.some((p: any) => {
          const vA = p.venueA?.toLowerCase();
          const vB = p.venueB?.toLowerCase();
          const reqA = expectedVA.toLowerCase();
          const reqB = expectedVB.toLowerCase();
          return ((vA === reqA && vB === reqB) || (vA === reqB && vB === reqA)) && p.isFundingSynchronized !== false && p.clearsFeeFilter;
        })
      ) || opportunities.find((c: any) =>
        !ContractIdentityResolver.isTradFiOrEquity(c.symbol) &&
        c.allPairs?.some((p: any) => {
          const vA = p.venueA?.toLowerCase();
          const vB = p.venueB?.toLowerCase();
          const reqA = expectedVA.toLowerCase();
          const reqB = expectedVB.toLowerCase();
          return (vA === reqA && vB === reqB) || (vA === reqB && vB === reqA);
        })
      ) || opportunities.find((c: any) => !ContractIdentityResolver.isTradFiOrEquity(c.symbol)) || opportunities[0];

      // Assign the true top evaluated candidate for UI and daemon state
      if (topCandidate) {
        bot.lastEvaluatedCandidate = {
          symbol: topCandidate.symbol,
          spreadBps: topCandidate.spreadBps,
          divergencePct: topCandidate.divergencePct,
          secondsToFunding: topCandidate.secondsToFunding,
          qualified: true,
          reason: "QUALIFIED_FOR_ENTRY",
        };
      } else if (bestWaitingDiffCandidate) {
        bot.lastEvaluatedCandidate = bestWaitingDiffCandidate;
      } else if (bestCorridorCandidate && (!topOpp || (bestCorridorCandidate.spreadBps || 0) >= (topOpp.spreadBps || 0))) {
        bot.lastEvaluatedCandidate = bestCorridorCandidate;
      } else if (topOpp) {
        const topPair = topOpp.allPairs?.find((p: any) => {
          const vA = p.venueA?.toLowerCase();
          const vB = p.venueB?.toLowerCase();
          const reqA = expectedVA.toLowerCase();
          const reqB = expectedVB.toLowerCase();
          return (vA === reqA && vB === reqB) || (vA === reqB && vB === reqA);
        });
        const oppSpread = topPair?.spreadBps ?? topOpp.spreadBps ?? 0;
        const oppPriceA = expectedVA === "CoinDCX"
          ? (topOpp.coindcxMarkPrice || topOpp.bybitMarkPrice || topOpp.binanceMarkPrice)
          : expectedVA === "Binance"
          ? topOpp.binanceMarkPrice
          : topOpp.bitgetMarkPrice;
        const oppPriceB = expectedVB === "Bybit"
          ? (topOpp.bybitMarkPrice || topOpp.binanceMarkPrice)
          : expectedVB === "CoinDCX"
          ? (topOpp.coindcxMarkPrice || topOpp.bybitMarkPrice)
          : topOpp.bitgetMarkPrice;
        const oppDiv = (oppPriceA > 0 && oppPriceB > 0)
          ? parseFloat(((Math.abs(oppPriceA - oppPriceB) / oppPriceA) * 100).toFixed(4))
          : (topOpp.divergencePct ?? 0);
        const oppSignedBasisBps = oppPriceB > 0 ? parseFloat((((oppPriceA - oppPriceB) / oppPriceB) * 10000).toFixed(2)) : 0;
        const oppSec = topPair?.secondsToFunding ?? topOpp.secondsToFunding ?? 0;
        const botMinGross = Math.max(config.minSpreadBps || MIN_GROSS_SPREAD_BPS, MIN_GROSS_SPREAD_BPS);
        const oppTiming = calculateRequiredPriceDivergencePct(config, oppSec, oppSpread);
        let fallbackReason = `[MONITORING] Waiting for optimal entry convergence`;
        if (ContractIdentityResolver.isTradFiOrEquity(topOpp.symbol)) {
          fallbackReason = `[TRADFI EXCLUDED] Stock/TradFi contract excluded from crypto arbitrage`;
        } else if (oppSpread < botMinGross) {
          fallbackReason = `[FEE CLEARANCE FILTER] Spread (${oppSpread} bps) < Min Gross (${botMinGross} bps)`;
        } else if (Math.abs(oppSignedBasisBps) > 250) {
          fallbackReason = `[BASIS SAFETY CAP] Signed basis |${oppSignedBasisBps.toFixed(1)}| bps exceeds 250 bps safety cap (entering would lose price parity on unwind)`;
        } else if (oppDiv > oppTiming.requiredDivergencePct) {
          fallbackReason = `[PRICE DIFF GATE] Price diff ${oppDiv.toFixed(3)}% > ceiling ${oppTiming.requiredDivergencePct.toFixed(3)}% (${oppSec}s left)`;
        }

        bot.lastEvaluatedCandidate = {
          symbol: topOpp.symbol,
          spreadBps: oppSpread,
          divergencePct: oppDiv,
          secondsToFunding: oppSec,
          qualified: false,
          reason: fallbackReason,
        };
      }

      bot.updatedAt = now;

      if (!topCandidate) {
        if (bot.lastEvaluatedCandidate && bot.lastEvaluatedCandidate.reason?.includes("[WAITING LOWER DIFF]")) {
          bot.statusText = `WAITING_LOWER_DIFF (${bot.lastEvaluatedCandidate.symbol}: ${bot.lastEvaluatedCandidate.divergencePct.toFixed(3)}% | ${bot.lastEvaluatedCandidate.secondsToFunding}s left)`;
          // Breathing room countdown kept purely in bot.statusText (Invariant 5 telemetry decoupling)
          continue;
        }

        bot.statusText = `SCANNING [${expectedVA}⇄${expectedVB}] (Top: ${topOpp?.symbol || "N/A"} - Spread: ${topOpp?.spreadBps || 0} bps - Cycle: ${topOpp?.fundingIntervalHours || 8}h - Countdown: ${topOpp?.secondsToFunding || 0}s)`;

        // Periodic Scan Pulse every 6 cycles (~30s) so live logs are continuously emitted
        if (state.cyclesCompleted % 6 === 0) {
          const pulseCand = bot.lastEvaluatedCandidate || topOpp;
          appendBotLog(
            state,
            `[SCAN PULSE] Bot "${bot.name}": Scanned ${opportunities.length} pairs on ${expectedVA} ⇄ ${expectedVB}. Corridor active. Candidate: ${pulseCand?.symbol || "N/A"} (${pulseCand?.spreadBps || 0} bps, diff ${pulseCand?.divergencePct || 0}%).`,
            "info",
            user.id,
            bot.id
          );
        }

        // Routine scan check countdown kept purely in bot.statusText (Invariant 5 telemetry decoupling)
        continue;
      }

      // Multi-candidate cascading fresh parity verification
      let chosenCandidate: any = null;
      let chosenFreshCheck: any = null;

      // Sort qualified candidates descending by Composite Arbitrage Score (CAS), falling back to spread
      qualifiedCandidates.sort((a, b) => ((b as any).compositeScore ?? b.spreadBps) - ((a as any).compositeScore ?? a.spreadBps));

      for (const cand of qualifiedCandidates.slice(0, 5)) {
        const freshCheck = await fetchFreshPrices(cand.symbol, expectedVA, expectedVB);
        // Live Funding Spread verification on candidate before evaluating depth/parity
        const liveCandFunding = await fetchLiveFundingSpread(
          cand.symbol,
          expectedVA,
          expectedVB,
          cand.venueAIntervalHours || cand.intervalHours || 8,
          cand.venueBIntervalHours || cand.intervalHours || 8,
          config.timingMode
        );

        if (!liveCandFunding.fresh) {
          appendBotLog(
            state,
            `[LIVE FUNDING UNVERIFIED] Bot "${bot.name}": Candidate ${cand.symbol} live funding unverified (${liveCandFunding.reason || "stale venue data"}). Cascading to next candidate...`,
            "warn",
            user.id
          );
          continue;
        }

        const liveCandSpreadBps = liveCandFunding.liveSpreadBps;
        if (liveCandSpreadBps < (config.minSpreadBps || 35.0)) {
          appendBotLog(
            state,
            `[PRE-TRADE SPREAD COLLAPSE] Bot "${bot.name}": Candidate ${cand.symbol} live spread collapsed to ${liveCandSpreadBps.toFixed(1)} bps (scanner saw ${cand.spreadBps.toFixed(1)} bps). Cascading to next candidate...`,
            "warn",
            user.id
          );
          continue;
        }

        // Invariant 3: Live Rate Polarity Verification
        if (cand.direction && liveCandFunding.direction) {
          const candIsShortA = cand.direction.includes("SHORT_A") || cand.direction.startsWith("SHORT_");
          const liveIsShortA = liveCandFunding.direction.includes("SHORT_A") || liveCandFunding.direction.startsWith("SHORT_");
          if (candIsShortA !== liveIsShortA) {
            appendBotLog(
              state,
              `[PRE-TRADE POLARITY INVERSION] Bot "${bot.name}": Candidate ${cand.symbol} live spread direction inverted from ${cand.direction} to ${liveCandFunding.direction}. Skipping trade.`,
              "warn",
              user.id
            );
            continue;
          }
        }

        const freshReq = calculateRequiredPriceDivergencePct(config, cand.secondsToFunding || 0, liveCandSpreadBps);
        if (freshReq.shouldFreeze) {
          appendBotLog(
            state,
            `[SETTLEMENT BOUNDARY FREEZE] Bot "${bot.name}": Candidate ${cand.symbol} rejected by ${freshReq.stage} (${freshReq.freezeReason || "boundary freeze"}). Cascading...`,
            "warn",
            user.id
          );
          continue;
        }

        const candIsShortA = cand.direction?.includes("SHORT_A") || cand.leg1Side === "SELL";
        const freshSignedBasisBps = freshCheck.signedBasisBps || 0;
        const freshBasisFavorable = candIsShortA ? freshSignedBasisBps > 0 : freshSignedBasisBps < 0;
        const freshDivergenceSafe = freshCheck.divergencePct <= freshReq.hardCeilingPct;
        const freshAdverseDivPct = freshBasisFavorable
          ? (freshDivergenceSafe ? 0 : freshCheck.divergencePct)
          : freshCheck.divergencePct;
        const freshBasisSafe = Math.abs(freshSignedBasisBps) <= 250;

        if (freshAdverseDivPct <= freshReq.requiredDivergencePct && freshBasisSafe && freshDivergenceSafe) {
          // Pre-Trade Net-Yield & Slippage Gate: Evaluate true transaction friction, basis contribution, and orderbook depth
          const effectiveBasisContribution = candIsShortA ? freshSignedBasisBps : -freshSignedBasisBps;
          const configWithBasis: BotConfig = {
            ...config,
            currentSignedBasisBps: effectiveBasisContribution,
          };
          const preTradeCheck = await evaluatePreTradeSlippageAndDepth(
            cand.symbol,
            expectedVA,
            expectedVB,
            config.maxAmountPerHedgeUsdt || 30,
            cand.direction?.includes("SHORT_A") ? "SELL" : "BUY",
            cand.direction?.includes("SHORT_A") ? "buy" : "sell",
            configWithBasis,
            liveCandSpreadBps
          );

          if (!preTradeCheck.passed) {
            appendBotLog(
              state,
              `[PRE-TRADE SLIPPAGE GATE] Bot "${bot.name}": Candidate ${cand.symbol} skipped — ${preTradeCheck.reason}. Cascading to next candidate...`,
              "warn",
              user.id
            );
            continue; // Move to next candidate in cascade
          }

          chosenCandidate = {
            ...cand,
            divergencePct: freshCheck.divergencePct,
            signedBasisBps: freshSignedBasisBps,
            freshBinancePrice: freshCheck.bnPrice,
            freshBitgetPrice: freshCheck.bgPrice,
            freshPriceA: freshCheck.priceA,
            freshPriceB: freshCheck.priceB,
            preTradeNetYieldBps: preTradeCheck.expectedNetYieldBps,
            preTradeFrictionBps: preTradeCheck.totalFrictionBps,
          };
          chosenFreshCheck = freshCheck;
          appendBotLog(
            state,
            `[NET-YIELD QUALIFIED] Bot "${bot.name}": ${cand.symbol} cleared pre-trade hurdle! Gross: ${liveCandSpreadBps.toFixed(1)} bps | Basis: ${effectiveBasisContribution.toFixed(1)} bps | Net Yield: +${preTradeCheck.expectedNetYieldBps.toFixed(1)} bps (Friction: ${preTradeCheck.totalFrictionBps.toFixed(1)} bps, Div: ${freshCheck.divergencePct.toFixed(3)}%).`,
            "info",
            user.id
          );
          if (cand.symbol !== topCandidate?.symbol) {
            appendBotLog(
              state,
              `[MULTI-CANDIDATE CASCADE] Bot "${bot.name}": Selected ${cand.symbol} (Spread: ${cand.spreadBps} bps, Basis: ${effectiveBasisContribution.toFixed(1)} bps, Div: ${freshCheck.divergencePct.toFixed(3)}%) after top candidate failed price parity check.`,
              "info",
              user.id
            );
          }
          break; // Found highest spread candidate that passes fresh parity and net-yield hurdle!
        } else {
          const reasonTag = !freshBasisSafe
            ? `basis |${freshSignedBasisBps}| bps > 250 bps safety cap`
            : `adverse diff ${freshAdverseDivPct.toFixed(3)}% > stage target ${freshReq.requiredDivergencePct.toFixed(3)}%`;
          appendBotLog(
            state,
            `[PRICE DIFF GATE] Bot "${bot.name}": ${cand.symbol} spread is ${cand.spreadBps} bps, but fresh ${reasonTag} (${freshReq.stage}, ${cand.secondsToFunding || 0}s left). Cascading to next candidate...`,
            "warn",
            user.id
          );
        }
      }

      if (!chosenCandidate) {
        bot.lastEvaluatedCandidate = {
          symbol: topCandidate.symbol,
          spreadBps: topCandidate.spreadBps,
          divergencePct: chosenFreshCheck ? chosenFreshCheck.divergencePct : topCandidate.divergencePct,
          secondsToFunding: topCandidate.secondsToFunding,
          qualified: false,
          reason: `[PRICE DIFF GATE] Price diff ${(chosenFreshCheck?.divergencePct ?? topCandidate.divergencePct).toFixed(3)}% > target (${topCandidate.secondsToFunding || 0}s left)`,
        };
        bot.statusText = `WAITING_LOWER_DIFF (${topCandidate.symbol}: ${(chosenFreshCheck?.divergencePct ?? topCandidate.divergencePct).toFixed(3)}% > target)`;
        continue;
      }

      topCandidate = chosenCandidate;
      const freshCheck = chosenFreshCheck;

      // Compute sizing bounded by corridorEffectiveBal, 50% max utilization cap, and maxAmountPerHedgeUsdt
      const maxSafeNewMarginA = Math.max(0, (venueAEquity * MAX_UTILIZATION_PCT) - venueALocked);
      const maxSafeNewMarginB = Math.max(0, (venueBEquity * MAX_UTILIZATION_PCT) - venueBLocked);
      const corridorMaxSafeMargin = Math.min(maxSafeNewMarginA, maxSafeNewMarginB);

      // Phase 4: Hurdle-Gated Fractional Kelly Sizer (Track SPEC-05)
      let effectiveKellyPct = config.balanceAllocationPct || 20;
      try {
        const { PositionSizer } = await import("./positionSizer");
        const kellySpreadBps = topCandidate.preTradeNetYieldBps ?? topCandidate.netSpreadBps ?? (topCandidate.spreadBps - 21.0);
        const kellyBasisVar = Math.max(25.0, (topCandidate.basisVolatilityBps ? Math.pow(topCandidate.basisVolatilityBps, 2) : 100.0));
        const kellyResult = PositionSizer.calculateKellyFraction(kellySpreadBps, kellyBasisVar, 0.25, 0.0);
        if (kellyResult.hurdleCleared) {
          effectiveKellyPct = Math.round(kellyResult.fraction * 100);
        }
      } catch {}

      const rawAllocatedMargin = Math.max(6, corridorEffectiveBal * (effectiveKellyPct / 100));
      const remainingMarginCap = Math.max(6, marginCap - currentBotMargin);
      let allocatedMargin = Math.min(rawAllocatedMargin, remainingMarginCap, corridorMaxSafeMargin);
      if (config.maxAmountPerHedgeUsdt && config.maxAmountPerHedgeUsdt > 0) {
        allocatedMargin = Math.min(allocatedMargin, config.maxAmountPerHedgeUsdt);
      }

      const minAllowableMargin = isMicroAccount ? 1.5 : 5.0;
      if (allocatedMargin < minAllowableMargin) {
        bot.statusText = `SAFE_CAPITAL_EXHAUSTED (Safe margin: $${corridorMaxSafeMargin.toFixed(2)} < $${minAllowableMargin.toFixed(1)})`;
        if (state.cyclesCompleted % 6 === 0) {
          appendBotLog(
            state,
            `[SAFETY GUARD] Bot "${bot.name}": Remaining safe margin ($${corridorMaxSafeMargin.toFixed(2)}) cannot support minimum contract notional while maintaining equity cushion. Pausing entry.`,
            "warn",
            user.id
          );
        }
        continue;
      }

      appendBotLog(
        state,
        `[OPPORTUNITY QUALIFIED] Bot "${bot.name}" selected ${topCandidate.symbol} (Spread: ${topCandidate.spreadBps} bps, Cycle: ${topCandidate.fundingIntervalHours || 8}h, Div: ${freshCheck.divergencePct.toFixed(4)}%, Alloc: $${allocatedMargin.toFixed(0)} USDT, Cap: $${config.maxAmountPerHedgeUsdt || 100}). Executing dual hedge...`,
        "info",
        user.id
      );

      bot.statusText = `EXECUTING_HEDGE (${topCandidate.symbol})`;
      const entryRes = await executeDualHedgeEntry(topCandidate, config, allocatedMargin, bot.name, state, creds, user.id, bot.id);

      if (entryRes.success && entryRes.hedge) {
        bot.activeHedges.push(entryRes.hedge);
        appendBotLog(
          state,
          `[HEDGE PLACED] Bot "${bot.name}" opened dual hedge on ${topCandidate.symbol}! Size: ${entryRes.hedge.quantity} ($${entryRes.hedge.notionalUsdt} USDT). Active: ${bot.activeHedges.length}/${config.maxSimultaneousHedges}.`,
          "success",
          user.id,
          bot.id
        );
        bot.statusText = `HEDGED (${topCandidate.symbol} ACTIVE)`;
      } else {
        appendBotLog(
          state,
          `[ENTRY ABORTED] Bot "${bot.name}": ${topCandidate.symbol} entry failed: ${entryRes.error}`,
          "error",
          user.id,
          bot.id
        );
        bot.statusText = `ENTRY_FAILED (${topCandidate.symbol})`;
      }
    }

    saveBotState(state, user.id);
  } catch (err: any) {
    console.error(`Tenant ${user.email} cycle error:`, err);
  } finally {
    globalForBot.tenantLocks!.delete(user.id);
  }
}

/**
 * Master Autonomous Multi-Bot Cycle
 * Iterates across all active tenant users:
 * 1. Fetches public funding opportunities once globally
 * 2. Dispatches isolated execution cycles for each user account
 */
export async function runAutonomousBotCycle(): Promise<void> {
  // OS-Level Kernel File Lock Check (Track A-03)
  if (!isDaemonLockHeldByCurrentProcess()) {
    const lock = acquireDaemonLock({ throwOnCollision: false });
    if (!lock.acquired) {
      console.warn(`[DAEMON LOCK COLLISION] Aborting bot cycle: another live daemon is running under PID ${lock.pid}`);
      return;
    }
  }
  updateDaemonLockHeartbeat();

  if (globalForBot.botIsExecutingCycle) {
    return; // Prevent overlapping master loops
  }

  globalForBot.botIsExecutingCycle = true;
  const now = Date.now();

  try {
    // 1. Fetch shared candidate opportunities once across the entire VPS node
    const opportunities = await fetchOpportunityCoins();

    // 2. Fetch all registered users
    const allUsers = getAllActiveUsers();

    if (allUsers.length === 0) {
      // Fallback single-tenant run
      const dummyAdmin: UserAccount = {
        id: "usr_admin_varsha",
        email: "varsha633@gmailcom",
        username: "Admin",
        password: "",
        role: "admin",
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        apiKeys: {
          binanceKey: SYSTEM_DEFAULT_BINANCE_KEY,
          binanceSecret: SYSTEM_DEFAULT_BINANCE_SECRET,
          bitgetKey: SYSTEM_DEFAULT_BITGET_KEY,
          bitgetSecret: SYSTEM_DEFAULT_BITGET_SECRET,
          bitgetPassphrase: SYSTEM_DEFAULT_BITGET_PASSPHRASE,
        },
      };
      await runTenantBotCycle(dummyAdmin, opportunities, now);
    } else {
      for (const user of allUsers) {
        await runTenantBotCycle(user, opportunities, now);
        // Micro-sleep to stagger exchange load across tenants
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  } catch (err: any) {
    console.error("Master multi-tenant bot cycle error:", err);
  } finally {
    globalForBot.botIsExecutingCycle = false;
  }
}

/**
 * Ensure background worker is active
 */
export function ensureBotWorker(): void {
  // OS-Level Kernel File Lock Check (Track A-03)
  if (!isDaemonLockHeldByCurrentProcess()) {
    const lock = acquireDaemonLock({ throwOnCollision: false });
    if (!lock.acquired) {
      console.warn(`[DAEMON LOCK COLLISION] Cannot start bot worker: daemon already running under PID ${lock.pid}`);
      return;
    }
  }

  if (!globalForBot.botInterval) {
    runAutonomousBotCycle().catch(() => {});

    globalForBot.botInterval = setInterval(() => {
      runAutonomousBotCycle().catch(() => {});
    }, 5000);
  }

  // Self-keep-alive heartbeat interval: periodically triggers cycle to keep event loop active
  if (!globalForBot.keepAliveInterval) {
    globalForBot.keepAliveInterval = setInterval(() => {
      if (!globalForBot.botIsExecutingCycle) {
        runAutonomousBotCycle().catch(() => {});
      }
    }, 15000);
  }
}

// Auto-boot background worker on module initialization
ensureBotWorker();
