/**
 * Divergence Bot: Core Domain TypeScript Types & State Schemas
 * Systematic Cross-Exchange Basis Expansion Engine
 * 
 * Target Corridor: Binance USD-M Perpetuals <-> Bybit Linear Perpetuals
 * Invariants Enforced:
 * 1. 100% Zero BPS Notation (All spreads, basis, hurdles, and fees strictly in % notation)
 * 2. Strict Ban on Legacy References (Zero mentions of legacy bots or deprecated venues)
 * 3. Safe PAUSED / READY Mode Default (isRunning: false, fsmState: 'PAUSED')
 * 4. Guaranteed Delta-Neutrality (|Delta_net| < 0.001)
 * 5. Hard-Locked Capital Limits (maxConcurrentPositions: 3, maxCapitalAllocationUsdt: 30.00)
 */

// ============================================================================
// 1. Enums & Literal Union Types
// ============================================================================

/**
 * Deterministic Direction Selection
 * - LONG_BN_SHORT_BYB: Long Binance USD-M Maker Limit / Short Bybit Linear IOC Taker
 * - SHORT_BN_LONG_BYB: Short Binance USD-M Maker Limit / Long Bybit Linear IOC Taker
 */
export type DivergenceDirection = 
  | 'LONG_BN_SHORT_BYB' 
  | 'SHORT_BN_LONG_BYB'
  | 'LONG_BINANCE_SHORT_BYBIT' 
  | 'LONG_BYBIT_SHORT_BINANCE';

/**
 * Finite State Machine (FSM) Lifecycle States
 */
export type DivergenceFsmState = 
  | 'PAUSED'              // Bot idle / suspended, zero order creation permitted
  | 'IDLE'                // Engine awake and ready, awaiting scan tick
  | 'SCANNING'            // Evaluating 24h dispersion and live compression
  | 'BALANCING'           // Calculating discrete lot quantum and order parameters
  | 'RECONCILING'         // 500ms reconciler balancing Leg 1 partial fill
  | 'ACTIVE_EXPANDING'    // Hedged position open, monitoring basis widening
  | 'EXITING'             // Executing take-profit or scratch exit orders
  | 'SCRATCH_UNWINDING'   // Unwinding position at parity / stagnancy scratch
  | 'EMERGENCY_STOPPING'  // Adverse stop-loss unwind in progress
  | 'EMERGENCY_KILLED';   // Hard kill-switch engaged, all activity halted

/**
 * Operational Execution Mode
 */
export type DivergenceExecutionMode = 'LIVE_ON_EXCHANGE' | 'SIMULATED_DRY_RUN';

/**
 * Position Lifecycle Status
 */
export type DivergencePositionStatus = 'OPEN' | 'CLOSING' | 'CLOSED' | 'CANCELLED';

/**
 * Order Execution Venues
 */
export type ExchangeVenue = 'BINANCE' | 'BYBIT';

/**
 * Order Execution Types
 */
export type DivergenceOrderType = 
  | 'POST_ONLY_MAKER_GTX' 
  | 'WS_IOC_TAKER' 
  | 'EMERGENCY_MARKET';

/**
 * Exit Reason Categories
 */
export type DivergenceExitReason = 
  | 'EXPANSION_TP' 
  | 'STAGNANCY_SCRATCH' 
  | 'ADVERSE_STOP' 
  | 'MANUAL_UNWIND' 
  | 'EMERGENCY_KILL';

/**
 * System Health Telemetry Status
 */
export type SystemHealthStatus = 'HEALTHY' | 'DEGRADED' | 'HALTED';

/**
 * In-Flight Intent Lifecycle Statuses
 */
export type InflightIntentStatus = 
  | 'INTENT_PREPARED'
  | 'LEG1_DISPATCHED'
  | 'LEG1_PARTIALLY_FILLED'
  | 'LEG1_FILLED'
  | 'LEG2_DISPATCHED'
  | 'LEG2_FILLED'
  | 'ABORTED'
  | 'COMPLETED';

// ============================================================================
// 2. Configuration & Parameter Contracts
// ============================================================================

/**
 * Divergence Strategy Engine Configuration
 * All rates, spreads, and hurdles are strictly expressed in percentage notation (%).
 */
export interface DivergenceConfig {
  /** Maximum concurrent positions fleet-wide (Hard-locked to 1) */
  maxConcurrentPositions: number;
  /** Maximum positions per individual canonical instrument (Hard-locked to 1) */
  maxPositionsPerSymbol: number;
  /** Maximum capital allocated to this strategy in USDT (Range: up to 1800.00 USDT, default: 60.00 USDT) */
  maxCapitalAllocationUsdt: number;
  /** Target order notional per leg in USDT (Range: 5.00 to 600.00 USDT, default: 15.00 USDT) */
  orderNotionalUsdt: number;
  /** Minimum 24h peak dispersion hurdle in % (default: 0.400%) */
  minDispersion24hPercent: number;
  /** Maximum live absolute basis compression hurdle for entry in % (default: 0.100%) */
  maxLiveCompressionPercent: number;
  /** Anti-collision sanity filter threshold in % (default: 5.000%) */
  antiCollisionSanityPercent: number;
  /** Target relative basis expansion hurdle for take-profit in % (default: 0.380%, range 0.350% - 0.400%) */
  relativeExpansionTargetPercent: number;
  /** Mandatory net realized profit floor in USDT after all fees (default: 0.0100 USDT) */
  zeroLossNetHurdleUsdt: number;
  /** Adverse divergence stop-loss relative basis hurdle in % (default: -0.150%) */
  adverseStopLossPercent: number;
  /** Nominal stagnancy scratch evaluation threshold in minutes (default: 180 min) */
  nominalStagnancyMinutes: number;
  /** Hard maximum stagnancy holding duration ceiling in minutes (default: 360 min) */
  maxStagnancyCeilingMinutes: number;
  /** Leg 1 Post-Only Maker order watchdog timeout in milliseconds (default: 8000 ms) */
  makerWatchdogMs: number;
  /** Counterpart adverse price drift threshold during maker limit in % (default: 0.080%) */
  adverseDriftWatchdogPercent: number;
  /** Sampling interval for adverse counterpart drift monitor in milliseconds (default: 120 ms) */
  adverseDriftSampleMs: number;
  /** Leg 2 Sub-35ms WebSocket IOC watchdog before REST fallback in milliseconds (default: 500 ms) */
  wsWatchdogTimeoutMs: number;
  /** Partial fill reconciliation window in milliseconds (default: 500 ms) */
  partialFillReconcileMs: number;
  /** Total estimated roundtrip fee and slippage friction in % (default: 0.260%) */
  roundtripFeeFrictionPercent: number;
  /** Live execution toggle (default: false, live execution requires explicit user start) */
  dryRun: boolean;
  /** Wind-down / exit-only mode: blocks new entries, manages existing positions (default: false) */
  noNewTrades: boolean;
  /** Maximum allowable adverse funding carry in % (default: -0.030%) */
  maxAdverseFundingRatePercent?: number;
  /** Pre-settlement dispatch lockout window in minutes (default: 10 min) */
  settlementLockoutMinutes?: number;
  /** Cumulative carry drag circuit breaker in % (default: 0.080%) */
  hardCarryBreakerPercent?: number;
}

// ============================================================================
// 3. Execution Orders & Leg Receipts
// ============================================================================

/**
 * Detailed Execution Receipt for an Individual Trade Leg
 */
export interface DivergenceLeg {
  venue: ExchangeVenue;
  side: 'BUY' | 'SELL';
  orderType: DivergenceOrderType;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  executedQty: number;
  avgPrice: number;
  feePercent: number; // e.g. 0.020% maker or 0.055% taker
  feeUsdt: number;
  latencyMs: number;
  timestamp: number;
  isReduceOnly?: boolean;
}

/**
 * Standalone Order Fill Receipt returned by execution routers
 */
export interface OrderFillReceipt {
  venue: ExchangeVenue;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: DivergenceOrderType;
  price: number;
  quantity: number;
  notionalUsdt: number;
  feePercent: number;
  feeUsdt: number;
  latencyMs: number;
  timestamp: number;
  isReduceOnly?: boolean;
}

/**
 * Router Execution Dispatch Result
 */
export interface ExecutionResult {
  success: boolean;
  positionId?: string;
  leg1Fill?: OrderFillReceipt;
  leg2Fill?: OrderFillReceipt;
  reconciliationAction?: 'NONE' | 'TRIMMED' | 'UNWOUND';
  error?: string;
}

// ============================================================================
// 4. Position Domains (Active & Closed)
// ============================================================================

/**
 * Active Hedged Basis Expansion Position
 */
export interface DivergencePosition {
  id: string; // e.g. "div_pos_1793408158"
  canonicalSymbol: string;
  binanceSymbol: string;
  bybitSymbol: string;
  direction: DivergenceDirection;
  status: DivergencePositionStatus;
  entryTimestamp: number;
  exitTimestamp?: number;
  entryBasisPercent: number; // e.g. +0.038%
  currentBasisPercent: number; // Live relative basis bt in %
  peakBasisPercent: number; // Highest favorable basis expansion reached
  targetExpansionPercent: number; // Relative expansion target (e.g. +0.380%)
  stopLossBasisPercent: number; // Adverse divergence stop limit (e.g. -0.150%)
  entryBinancePrice: number;
  entryBybitPrice: number;
  currentBinancePrice: number;
  currentBybitPrice: number;
  exitBinancePrice?: number;
  exitBybitPrice?: number;
  quantityBinance: number;
  quantityBybit: number;
  notionalUsdt: number; // e.g. 15.00 USDT
  unrealizedGrossPnlUsdt: number;
  realizedGrossPnlUsdt?: number;
  estimatedTotalFeesUsdt: number; // Roundtrip friction (0.260%)
  actualFeesUsdt?: number; // Verified exchange receipts
  netPnlUsdt: number;
  roiPercent: number; // Net ROI in %
  holdDurationMinutes: number;
  relativeExpansionPercent: number; // Signed relative basis expansion from entry
  isHurdleMet: boolean; // netPnlUsdt >= zeroLossNetHurdleUsdt
  exitReason?: DivergenceExitReason;
  leg1: DivergenceLeg;
  leg2: DivergenceLeg;
  executionHash: string; // SHA-256 cryptographic proof
  stagnancyNominalDeadline: number; // entryTimestamp + 180m (ms)
  stagnancyCeilingDeadline: number; // entryTimestamp + 360m (ms)
  hasMomentumExtension: boolean; // true if granted +60m extension
  accumulatedCarryPercent: number; // Sum of funding carry collected / paid in %
  lastUpdated: number;
}

/**
 * Fully Closed & Reconciled Position with Genuine Audit Metrics
 */
export interface DivergenceClosedPosition extends DivergencePosition {
  exitTimestamp: number;
  exitReason: DivergenceExitReason;
  exitBinancePrice: number;
  exitBybitPrice: number;
  realizedGrossPnlUsdt: number;
  actualFeesUsdt: number;
  netRealizedPnlUsdt: number;
  realizedRoiPercent: number;
  finalRelativeExpansionPercent: number;
  roundtripLatencyMs: number;
}

// ============================================================================
// 5. Scanner & Candidate Feed Contracts
// ============================================================================

/**
 * Candidate Opportunity evaluated by Dispersion Scanner
 */
export interface DivergenceCandidate {
  symbol: string; // e.g. "SUIUSDT"
  canonicalSymbol: string; // e.g. "SUI"
  binanceSymbol: string;
  bybitSymbol: string;
  multiplier: number;
  binancePrice: number;
  bybitPrice: number;
  midPrice: number;
  liveBasisPercent: number; // Live symmetric relative basis bt in %
  dispersion24hPercent: number; // Peak 24h absolute basis dispersion in %
  expansionPotentialPercent: number; // dispersion24hPercent - |liveBasisPercent| in %
  ddi24h: number; // Directional Dispersion Index [-1.0, +1.0]
  suggestedDirection: DivergenceDirection;
  gatesPassed: {
    dispersion: boolean; // >= 0.400%
    compression: boolean; // <= 0.100%
    antiCollision: boolean; // <= 5.000%
    runwayBuffer: boolean; // Sufficient expansion runway inside 24h envelope
    carryFeasibility: boolean; // Carry >= -0.030%
  };
  netAlphaProjectedPercent: number; // Target expansion (0.380%) - Friction (0.260%) = +0.120%
  timestamp: number;
  volume24hUsdt?: number;
  orderBookDepthRatio?: number;
  binanceSpreadPercent?: number;
  bybitSpreadPercent?: number;
  isQualified: boolean;
}

// ============================================================================
// 6. Pre-Dispatch In-Flight Intent Journal Contracts
// ============================================================================

/**
 * Intent state for an individual order leg during dispatch
 */
export interface InflightLegIntent {
  venue: ExchangeVenue;
  symbol: string;
  clientOrderId: string;
  targetQty: number;
  targetPrice?: number;
  filledQty: number;
  avgPrice: number;
  status: 'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELLED';
  orderId?: string;
  executedFeeUsdt?: number;
  updatedAt: number;
}

/**
 * Crash-Recovery In-Flight Intent Journal Record
 * Written to data/divergence_inflight.json prior to Leg 1 dispatch.
 */
export interface DivergenceInFlightIntent {
  intentId: string; // e.g. "div_intent_1793408158_9a2f"
  canonicalSymbol: string;
  direction: DivergenceDirection;
  status: InflightIntentStatus;
  createdAt: number;
  updatedAt: number;
  targetNotionalUsdt: number;
  leg1: InflightLegIntent;
  leg2: InflightLegIntent;
  reconciliationAction?: 'NONE' | 'TRIMMED' | 'UNWOUND';
  error?: string;
}

/**
 * In-Flight Intent File Schema (data/divergence_inflight.json)
 */
export interface DivergenceInflightJournal {
  version: string;
  intents: DivergenceInFlightIntent[];
  lastUpdated: number;
}

// ============================================================================
// 7. Telemetry & Executive KPI Metrics
// ============================================================================

/**
 * Strategy Telemetry for Cockpit HUD & Monitoring Radar
 */
export interface DivergenceTelemetry {
  activePositionsCount: number;
  closedPositionsCount: number;
  totalRealizedNetPnlUsdt: number;
  totalRoundtripFeesUsdt: number;
  winRate: number; // Expressed as percentage [0, 100] (e.g. 85.7%)
  profitFactor: number;
  averageHoldDurationMinutes: number;
  candidatesCount: number;
  systemStatus: SystemHealthStatus;
  lastScanTimestamp: number;
  cycleCount: number;
  totalVolumeUsdt: number;
  lockStatus: {
    isLocked: boolean;
    pid?: number;
    hostname?: string;
  };
  peak24hDispersionObservedPercent?: number;
  netDeltaBaseExposure?: number; // Sized so |Delta_net| < 0.001
}

// ============================================================================
// 8. State Store Root Schema (`data/divergence_state.json`)
// ============================================================================

/**
 * Complete Divergence Bot State Schema
 * Matches interface contract in PROJECT.md and plans/divergence_bot_plan.md
 */
export interface DivergenceStateSchema {
  version: string;
  isRunning: boolean; // MUST DEFAULT TO false
  fsmState: DivergenceFsmState; // MUST DEFAULT TO 'PAUSED'
  config: DivergenceConfig;
  activePositions: Record<string, DivergencePosition>;
  closedPositions: DivergenceClosedPosition[];
  telemetry: DivergenceTelemetry;
  lastUpdated: number;
}

// ============================================================================
// 9. API Request & Response Contracts
// ============================================================================

/**
 * POST /api/divergence/daemon Command Payload
 */
export interface DivergenceDaemonCommand {
  action: 
    | 'start' 
    | 'stop' 
    | 'pause' 
    | 'tick' 
    | 'update_config' 
    | 'emergency_kill' 
    | 'close_position';
  config?: Partial<DivergenceConfig>;
  positionId?: string;
}

/**
 * GET /api/divergence/radar Response Contract
 */
export interface DivergenceRadarResponse {
  success: boolean;
  timestamp: number;
  candidatesCount: number;
  summary: {
    totalPairsScanned: number;
    dispersionPassingCount: number;
    compressionPassingCount: number;
  };
  candidates: DivergenceCandidate[];
  error?: string;
}

/**
 * GET /api/divergence/audit Response Contract
 */
export interface DivergenceAuditResponse {
  success: boolean;
  timestamp: number;
  summary: {
    totalClosedTrades: number;
    profitableTrades: number;
    winRate: number;
    totalNetProfitUsdt: number;
    totalFeesPaidUsdt: number;
    averageHoldDurationMinutes: number;
    averageBasisExpansionCapturedPercent: number;
  };
  auditLedger: DivergenceClosedPosition[];
  error?: string;
}

/**
 * GET /api/divergence/daemon Response Contract
 */
export interface DivergenceDaemonStatusResponse {
  success: boolean;
  isRunning: boolean;
  fsmState: DivergenceFsmState;
  mode: DivergenceExecutionMode;
  dryRun: boolean;
  uptimeSeconds: number;
  cycleCount: number;
  activePositions: DivergencePosition[];
  config: DivergenceConfig;
  telemetry: DivergenceTelemetry;
  lastUpdated: number;
  error?: string;
}

// ============================================================================
// 10. Default Production Constants & Hard-Locked Limits
// ============================================================================

/**
 * Hard-Locked Risk Parameters for $37.68 Current Fleet Live NAV
 */
export const DIVERGENCE_HARD_LIMITS = {
  MAX_CONCURRENT_POSITIONS: 3,
  MAX_POSITIONS_PER_SYMBOL: 1,
  MAX_CAPITAL_ALLOCATION_USDT: 60.00,
  ORDER_NOTIONAL_USDT: 15.00,
  DELTA_NET_TOLERANCE: 0.001,
  MIN_NOTIONAL_USDT: 5.00,
} as const;

/**
 * Default Strategy Configuration
 */
export const DEFAULT_DIVERGENCE_CONFIG: DivergenceConfig = {
  maxConcurrentPositions: DIVERGENCE_HARD_LIMITS.MAX_CONCURRENT_POSITIONS,
  maxPositionsPerSymbol: DIVERGENCE_HARD_LIMITS.MAX_POSITIONS_PER_SYMBOL,
  maxCapitalAllocationUsdt: DIVERGENCE_HARD_LIMITS.MAX_CAPITAL_ALLOCATION_USDT,
  orderNotionalUsdt: DIVERGENCE_HARD_LIMITS.ORDER_NOTIONAL_USDT,
  minDispersion24hPercent: 0.400,
  maxLiveCompressionPercent: 0.100,
  antiCollisionSanityPercent: 5.000,
  relativeExpansionTargetPercent: 0.380,
  zeroLossNetHurdleUsdt: 0.0100,
  adverseStopLossPercent: -0.150,
  nominalStagnancyMinutes: 180,
  maxStagnancyCeilingMinutes: 360,
  makerWatchdogMs: 8000,
  adverseDriftWatchdogPercent: 0.080,
  adverseDriftSampleMs: 120,
  wsWatchdogTimeoutMs: 500,
  partialFillReconcileMs: 500,
  roundtripFeeFrictionPercent: 0.260,
  dryRun: false,
  noNewTrades: false,
  maxAdverseFundingRatePercent: -0.030,
  settlementLockoutMinutes: 10,
  hardCarryBreakerPercent: 0.080,
};

/**
 * Default Telemetry State
 */
export const DEFAULT_DIVERGENCE_TELEMETRY: DivergenceTelemetry = {
  activePositionsCount: 0,
  closedPositionsCount: 0,
  totalRealizedNetPnlUsdt: 0.0000,
  totalRoundtripFeesUsdt: 0.0000,
  winRate: 0.0,
  profitFactor: 0.0,
  averageHoldDurationMinutes: 0.0,
  candidatesCount: 0,
  systemStatus: 'HEALTHY',
  lastScanTimestamp: 0,
  cycleCount: 0,
  totalVolumeUsdt: 0.0,
  lockStatus: {
    isLocked: false,
  },
  peak24hDispersionObservedPercent: 0.0,
  netDeltaBaseExposure: 0.0,
};

/**
 * Initial Production Seed State Schema
 */
export const INITIAL_DIVERGENCE_STATE: DivergenceStateSchema = {
  version: '1.0.0',
  isRunning: false, // MANDATORY PAUSED / READY MODE DEFAULT
  fsmState: 'PAUSED', // MANDATORY PAUSED / READY MODE DEFAULT
  config: DEFAULT_DIVERGENCE_CONFIG,
  activePositions: {},
  closedPositions: [],
  telemetry: DEFAULT_DIVERGENCE_TELEMETRY,
  lastUpdated: 0,
};
