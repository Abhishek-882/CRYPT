/**
 * STATARB-OU-PERP: Engine Layer Barrel
 * 
 * Re-exports:
 * - Autonomous StatArbEngine
 * - Isolated StatArbStateStore and atomic persistence
 * - Safety Breakers & Capacity Limits
 */

export {
  StatArbEngine,
  type ScanResult,
  type PositionManagementResult,
} from './statArbEngine';

export {
  StatArbStateStore,
  DEFAULT_STATARB_CONFIG,
  DEFAULT_STATARB_TELEMETRY,
  type StatArbEngineState,
} from './statArbStateStore';

export {
  checkConcurrentPositionsLimit,
  checkDrawdownBreaker,
  evaluateSystemSafety,
  DEFAULT_MAX_CONCURRENT_POSITIONS,
  DEFAULT_MAX_DRAWDOWN_PCT,
  type PositionCapacityResult,
  type DrawdownBreakerResult,
  type SafetyCheckResult,
} from './safetyBreakers';

export {
  DynamicUniverseScanner,
  getDynamicUniverseScanner,
  DEFAULT_UNIVERSE_CONFIG,
  type UniverseScanOutput,
  type UniverseScannerConfig,
} from './dynamicUniverseScanner';
