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
  DEFAULT_ENTRY_GATE_CONFIG,
} from './zScoreEngine';

export {
  analyzeOrderBookDepth,
  evaluateDualVenueDepth,
  calculateVwapSlippage,
  DEFAULT_DEPTH_CONFIG,
  type DualVenueDepthResult,
  type VwapSweepResult,
} from './bookDepthAnalyzer';
