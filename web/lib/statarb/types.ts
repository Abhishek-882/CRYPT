/**
 * STATARB-OU-PERP: Core Domain Type Definitions
 * Cross-Exchange Statistical Arbitrage & Ornstein-Uhlenbeck Price Convergence Sweeper
 * 
 * Target Corridor: Binance USD-M Perpetuals <-> Bybit Linear Perpetuals
 * Strictly standalone with zero dependencies on legacy bot engines.
 */

export type StatArbDirection = 'SHORT_BINANCE_LONG_BYBIT' | 'SHORT_BYBIT_LONG_BINANCE';

export type StatArbPositionStatus = 'OPEN' | 'CLOSING' | 'CLOSED' | 'CANCELLED';

export type SystemHealthStatus = 'HEALTHY' | 'DEGRADED' | 'HALTED';

/**
 * Continuous Ornstein-Uhlenbeck SDE Calibration Parameters
 * db_t = theta * (mu - b_t) * dt + sigma * dW_t
 */
export interface OUParameters {
  /** Rate of mean reversion (velocity in min^-1) */
  theta: number;
  /** Long-term equilibrium basis mean in basis points (bps) */
  mu: number;
  /** Continuous diffusion coefficient / volatility (bps) */
  sigma: number;
  /** Expected half-life of basis mean reversion in minutes: ln(2) / theta */
  halfLifeMinutes: number;
  /** Unconditional stationary standard deviation: sigma / sqrt(2 * theta) */
  equilibriumSigma: number;
  /** Discrete AR(1) ordinary least squares coefficient of determination (0 to 1) */
  rSquared: number;
  /** Number of discrete basis observation samples used for calibration */
  sampleCount: number;
  /** Timestamp when parameters were calibrated (UTC epoch ms) */
  lastUpdated: number;
}

/**
 * Orderbook Price Level [price, size/quantity]
 */
export type L2Level = [number, number];

/**
 * L2 Orderbook Snapshot for Depth Analysis
 */
export interface L2OrderBookSnapshot {
  bids: L2Level[];
  asks: L2Level[];
  timestamp: number;
}

/**
 * Evaluated Order Book Depth Result
 */
export interface BookDepthResult {
  bidDepthUsdt: number;
  askDepthUsdt: number;
  cumulativeDepthUsdt: number;
  depthRatio: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spreadBps: number;
  hasSufficientDepth: boolean;
}

/**
 * Cross-Exchange Pair Configuration & Live State
 */
export interface StatArbPair {
  /** Canonical instrument identifier, e.g. 'PEPE', 'SATS', 'BTC' */
  canonicalSymbol: string;
  /** Venue-specific symbol on Binance USD-M (e.g. '1000PEPEUSDT') */
  binanceSymbol: string;
  /** Venue-specific symbol on Bybit Linear (e.g. '1000PEPEUSDT') */
  bybitSymbol: string;
  /** Contract size / price multiplier ratio from Binance to Bybit */
  multiplier: number;
  /** Live midpoint price on Binance USD-M */
  binanceMid: number;
  /** Live midpoint price on Bybit Linear */
  bybitMid: number;
  /** Instantaneous cross-exchange gross basis in basis points: ((P_bn - P_byb) / P_byb) * 10000 */
  grossBasisBps: number;
  /** Available L2 liquidity ratio within 10 bps relative to target notional */
  orderBookDepthRatio: number;
  /** Top-of-book bid-ask spread on Binance USD-M in bps */
  binanceSpreadBps: number;
  /** Top-of-book bid-ask spread on Bybit Linear in bps */
  bybitSpreadBps: number;
  /** Timestamp of last telemetry update (UTC epoch ms) */
  lastUpdated: number;
}

/**
 * Configuration Parameters for Pre-Flight Entry Gating
 */
export interface EntryGateConfig {
  /** Minimum absolute z-score required for entry (default: 2.20) */
  minZScore: number;
  /** Minimum absolute gross basis spread in bps (default: 28.0 bps) */
  minGrossBasisBps: number;
  /** Minimum orderbook depth cushion within 10 bps relative to order size (default: 4.0x) */
  minDepthRatio: number;
  /** Maximum allowable bid-ask spread on either venue in bps (default: 8.0 bps) */
  maxSpreadBps: number;
  /** Minimum post-fee net edge required after all 4 execution legs (default: 12.0 bps) */
  minNetEdgeBps?: number;
  /** Estimated 4-leg roundtrip trading fee & slippage friction in bps (default: 17.0 bps) */
  roundtripFrictionBps?: number;
}

/**
 * Evaluation Result from Entry Gate Verification
 */
export interface EntryGateResult {
  passed: boolean;
  zScore: number;
  grossBasisBps: number;
  netExpectedEdgeBps?: number;
  depthRatio: number;
  binanceSpreadBps: number;
  bybitSpreadBps: number;
  direction?: StatArbDirection;
  reasons: string[];
}

/**
 * Autonomous Trade Execution Signal
 */
export interface TradeSignal {
  id: string;
  pair: StatArbPair;
  timestamp: number;
  zScore: number;
  grossBasisBps: number;
  direction: StatArbDirection;
  passedGates: boolean;
  reasons: string[];
}

/**
 * Active or Historical Delta-Neutral Statistical Arbitrage Position
 */
export interface StatArbPosition {
  id: string;
  canonicalSymbol: string;
  binanceSymbol: string;
  bybitSymbol: string;
  direction: StatArbDirection;
  status: StatArbPositionStatus;
  entryTimestamp: number;
  entryBasisBps: number;
  entryBinancePrice: number;
  entryBybitPrice: number;
  quantity: number;
  notionalUsdt: number;
  currentBasisBps: number;
  currentBinancePrice: number;
  currentBybitPrice: number;
  currentZScore: number;
  realizedPnlUsdt: number;
  unrealizedPnlUsdt: number;
  totalFeesUsdt: number;
  netPnlUsdt: number;
  exitTimestamp?: number;
  exitReason?: string;
  holdDurationMinutes: number;
  /** Rolling window of divergence samples recorded every minute for Invariants 6 & 7 */
  divergenceHistory30m: number[];
  /** Optional pair object reference */
  pair?: StatArbPair;
  /** Authentic Exchange Order Identifiers & Execution Cryptographic Hash */
  leg1OrderId?: string;
  leg2OrderId?: string;
  leg1ClientOrderId?: string;
  leg2ClientOrderId?: string;
  executionHash?: string;
}

/**
 * Global Configuration for the STATARB-OU-PERP Strategy
 */
export interface StatArbConfig {
  enabled: boolean;
  dryRun: boolean;
  entryGate: EntryGateConfig;
  /** Exit threshold: basis compression percentage required (default: 0.75 for 75%) */
  exitConvergenceCompression: number;
  /** Exit threshold: z-score normalization target (default: 0.35) */
  exitZScoreThreshold: number;
  /** Strictly enforced Zero-Loss Invariant minimum net PnL after all fees (default: 0.01 USDT) */
  minNetProfitUsdt: number;
  /** Invariant 6 Maximum hold duration before persistence breaker triggers (default: 30 minutes) */
  maxPositionHoldMinutes: number;
  /** Maximum number of concurrent active positions across all corridors (default: 5) */
  maxConcurrentPositions: number;
  /** Standard order notional per leg in USDT (default: 15.0 USDT) */
  orderNotionalUsdt: number;
  /** Leg 1 Maker limit order timeout in milliseconds (default: 8000 ms) */
  makerTimeoutMs: number;
  /** Counterpart adverse drift abort threshold in bps (default: 8.0 bps) */
  adverseDriftThresholdBps: number;
}

/**
 * Real-Time Strategy Telemetry for Cockpit HUD & Monitoring Radar
 */
export interface StatArbTelemetry {
  activePositionsCount: number;
  totalPnlUsdt: number;
  winRate: number;
  averageHoldDurationMinutes: number;
  lastCalibrationTimestamp: number;
  monitoredPairsCount: number;
  qualifyingSignalsCount: number;
  systemStatus: SystemHealthStatus;
}

/**
 * Contract Mapping Specification for Cross-Venue Normalization
 */
export interface InstrumentMapping {
  canonicalSymbol: string;
  binanceSymbol: string;
  bybitSymbol: string;
  multiplier: number;
  isTradFiExcluded: boolean;
  description?: string;
}
