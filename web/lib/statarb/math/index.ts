/**
 * STATARB-OU-PERP: Mathematical & Calibration Core Barrel
 * 
 * Re-exports continuous Ornstein-Uhlenbeck calibration, z-score gating,
 * and order book depth cushion analysis.
 */

export {
  calibrateOrnsteinUhlenbeck,
  simulateOUProcess,
  DEFAULT_OU_PRIORS,
} from './ouCalibrator';

export {
  calculateZScore,
  calculateBasisBps,
  evaluateEntryGates,
  generateTradeSignal,
  evaluateStrictDirectionality,
  computeLeg2IocBoundPrice,
  evaluateDynamicFrictionFloor,
  shouldAbortLeg1MakerOrder,
  evaluatePureStatArbEligibility,
  DEFAULT_ENTRY_GATE_CONFIG,
  type DynamicGatingResult,
} from './zScoreEngine';

export {
  analyzeOrderBookDepth,
  evaluateDualVenueDepth,
  calculateVwapSlippage,
  DEFAULT_DEPTH_CONFIG,
  type DualVenueDepthResult,
  type VwapSweepResult,
} from './bookDepthAnalyzer';
