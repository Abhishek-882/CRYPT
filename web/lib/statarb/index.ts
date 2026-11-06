/**
 * STATARB-OU-PERP: Clean Public Strategy Facade
 * Cross-Exchange Statistical Arbitrage & Ornstein-Uhlenbeck Price Convergence Sweeper
 * 
 * Target Corridor: Binance USD-M Perpetuals <-> Bybit Linear Perpetuals
 * 
 * Exposes:
 * - Domain Types (StatArbPair, StatArbPosition, StatArbConfig, TradeSignal, etc.)
 * - Continuous Ornstein-Uhlenbeck SDE Calibration & Gating Math
 * - Safety Invariants & Sticky Decoupling Filters (Invariants 6, 7, 4, 5, 0)
 * - Guaranteed Zero-Loss Exit Optimizer (+0.0100 USDT net profit enforcer)
 * - Maker-Taker Limit Order Router with adverse drift and timeout watchdogs
 * - Standalone Autonomous Trading Engine with isolated atomic state persistence
 * 
 * 100% standalone with zero legacy bot dependencies.
 */

// Domain Types
export * from './types';

// Mathematical & Calibration Core
export * from './math';

// Execution, Invariants & Exit Optimizer
export * from './execution';

// Standalone Engine & Isolated State Store
export * from './engine';

// Instrument Mapping & TradFi Exclusion Normalizer
export * from './utils/contractMapper';

// Exchange Filter Registry & Lot Sizing Reconciler
export * from './utils/exchangeFilterRegistry';
