/**
 * STATARB-OU-PERP: Execution Layer Barrel
 * 
 * Re-exports:
 * - Safety Invariant Guards (Invariant 6 30m Breaker, Invariant 7 Sticky Filter, Zero-Orphan)
 * - Guaranteed Zero-Loss Exit Optimizer (75% compression, |z|<=0.35, +$0.01 USDT net enforcer)
 * - Maker-Taker Limit Order Router (GTX post-only, adverse drift watchdog, sub-35ms WebSocket IOC)
 */

export {
  checkInvariant6PersistenceBreaker,
  checkInvariant7StickyDecoupling,
  checkInvariant4CatastrophicStopLoss,
  checkInvariant5AdverseCarryInversion,
  checkZeroOrphanInvariant,
  DEFAULT_PERSISTENCE_THRESHOLD_PCT,
  DEFAULT_PERSISTENCE_MINUTES,
  DEFAULT_CATASTROPHIC_ROI_PCT,
  DEFAULT_ADVERSE_CARRY_SPREAD_BPS,
  type Invariant6Result,
  type Invariant7Result,
  type Invariant4Result,
  type Invariant5Result,
  type ZeroOrphanResult,
} from './invariantGuard';

export {
  evaluateZeroLossExitGate,
  evaluateExit,
  calculateBasisCompression,
  isBasisCompressed,
  isZScoreNormalized,
  calculateGrossBasisPnL,
  calculateRoundtripFees,
  MIN_ZERO_LOSS_PROFIT_USDT,
  DEFAULT_COMPRESSION_THRESHOLD,
  DEFAULT_Z_SCORE_EXIT_THRESHOLD,
  DEFAULT_FEE_STRUCTURE,
  type FeeStructure,
  type ZeroLossGateResult,
  type ExitDecisionType,
  type ExitEvaluationResult,
} from './exitOptimizer';

export {
  MakerTakerOrderRouter,
  SimulatedExecutionAdapter,
  checkAdverseDrift,
  calculatePostOnlyPrice,
  type OrderSide,
  type ExchangeVenue,
  type DriftCheckResult,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionStatus,
  type LegExecutionDetail,
  type ExchangeExecutionAdapter,
} from './orderRouter';
