/**
 * STATARB-OU-PERP: Continuous Ornstein-Uhlenbeck Parameter Calibrator
 * Continuous Stochastic Differential Equation: db_t = theta * (mu - b_t) * dt + sigma * dW_t
 * 
 * Discrete AR(1) Mapping: b_{t+1} = a + beta * b_t + epsilon_t
 * Calibrates continuous SDE parameters from discrete basis observations using
 * Ordinary Least Squares (OLS) with robust stationarity clamping and fallback priors.
 */

import { OUParameters } from '../types';

/**
 * Default prior parameters utilized when sample history is sparse (N < 5)
 * or when market observations exhibit zero variance / structural degeneration.
 */
export const DEFAULT_OU_PRIORS = {
  theta: 0.0866, // Corresponds to tau = ln(2) / 0.0866 ~= 8.0 minutes
  halfLifeMinutes: 8.0,
  sigma: 5.0, // 5.0 bps baseline diffusion
  equilibriumSigma: 12.0, // 12.0 bps stationary spread
  minObservations: 30, // Minimum samples for fully unconstrained OLS
  sparseThreshold: 5, // Threshold below which sparse priors apply
  betaFloor: 0.01,
  betaCeil: 0.999,
  dtMinutes: 1.0,
  minEquilibriumSigmaFloor: 0.001, // Prevent division by zero in downstream z-score
} as const;

/**
 * Calibrates continuous Ornstein-Uhlenbeck parameters from a discrete time series
 * of basis observations b_0, b_1, ..., b_{N-1}.
 * 
 * @param observations Historical basis values in basis points (bps) ordered chronologically
 * @param dtMinutes Discrete time interval between consecutive observations in minutes (default: 1.0)
 * @returns Fully estimated OUParameters object
 */
export function calibrateOrnsteinUhlenbeck(
  observations: number[],
  dtMinutes: number = DEFAULT_OU_PRIORS.dtMinutes
): OUParameters {
  const now = Date.now();
  const dt = dtMinutes > 0 ? dtMinutes : DEFAULT_OU_PRIORS.dtMinutes;

  // Filter out any non-finite observations
  const cleanObs = observations.filter((val) => typeof val === 'number' && Number.isFinite(val));
  const N = cleanObs.length;

  // Edge Case 1: Sparse observations (N < 5) - Return robust prior baseline
  if (N < DEFAULT_OU_PRIORS.sparseThreshold) {
    const sampleMean = N > 0 ? cleanObs.reduce((sum, v) => sum + v, 0) / N : 0.0;
    return {
      theta: DEFAULT_OU_PRIORS.theta,
      mu: sampleMean,
      sigma: DEFAULT_OU_PRIORS.sigma,
      halfLifeMinutes: DEFAULT_OU_PRIORS.halfLifeMinutes,
      equilibriumSigma: DEFAULT_OU_PRIORS.equilibriumSigma,
      rSquared: 0.0,
      sampleCount: N,
      lastUpdated: now,
    };
  }

  // Construct lagged regression pairs:
  // x_i = b_i (t), y_i = b_{i+1} (t+1) for i = 0 ... N - 2
  const M = N - 1;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < M; i++) {
    sumX += cleanObs[i];
    sumY += cleanObs[i + 1];
  }

  const meanX = sumX / M;
  const meanY = sumY / M;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (let i = 0; i < M; i++) {
    const dx = cleanObs[i] - meanX;
    const dy = cleanObs[i + 1] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Edge Case 2: Zero variance in series (e.g. constant basis, frozen feeds)
  if (sxx <= 1e-12 || syy <= 1e-12) {
    const constantMean = cleanObs[0];
    return {
      theta: DEFAULT_OU_PRIORS.theta,
      mu: constantMean,
      sigma: DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor,
      halfLifeMinutes: DEFAULT_OU_PRIORS.halfLifeMinutes,
      equilibriumSigma: DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor,
      rSquared: 0.0,
      sampleCount: N,
      lastUpdated: now,
    };
  }

  // Calculate unconstrained OLS beta and alpha
  const rawBeta = sxy / sxx;
  const rawAlpha = meanY - rawBeta * meanX;

  // Stationarity Safeguard: Clamp beta to [0.01, 0.999]
  // In a discrete AR(1) process, 0 < beta < 1 is required for stationary mean reversion.
  // Clamping prevents division by zero in (1 - beta), negative theta, or explosive variance.
  const beta = Math.min(
    DEFAULT_OU_PRIORS.betaCeil,
    Math.max(DEFAULT_OU_PRIORS.betaFloor, rawBeta)
  );

  // Compute regression residuals and Sum of Squared Errors (SSE)
  let sse = 0;
  for (let i = 0; i < M; i++) {
    const fitted = rawAlpha + rawBeta * cleanObs[i];
    const residual = cleanObs[i + 1] - fitted;
    sse += residual * residual;
  }

  // Unbiased residual variance estimate sigma_epsilon^2
  const dof = M > 2 ? M - 2 : M;
  const residualVariance = Math.max(0, sse / dof);
  const sigmaEpsilon = Math.sqrt(residualVariance);

  // R^2 coefficient of determination: 1 - SSE / SST
  const rSquared = syy > 1e-12 ? Math.max(0, Math.min(1, 1 - sse / syy)) : 0.0;

  // Discrete-to-continuous parameter conversion
  // 1. Reversion velocity: theta = -ln(beta) / dt
  const theta = -Math.log(beta) / dt;

  // 2. Expected half-life: tau = ln(2) / theta
  const halfLifeMinutes = theta > 1e-6 ? Math.LN2 / theta : 120.0;

  // 3. Equilibrium mean: mu = a / (1 - beta)
  // Use clamped beta for numerical stability
  const mu = rawAlpha / (1.0 - beta);

  // 4. Continuous volatility / diffusion coefficient:
  // sigma = sigma_epsilon * sqrt(2 * theta / (1 - beta^2))
  const denominator = Math.max(1e-12, 1.0 - beta * beta);
  const continuousDiffusion = sigmaEpsilon * Math.sqrt((2.0 * theta) / denominator);

  // 5. Stationary unconditional standard deviation:
  // equilibriumSigma = sigma / sqrt(2 * theta) = sigma_epsilon / sqrt(1 - beta^2)
  const calculatedEqSigma = sigmaEpsilon / Math.sqrt(denominator);
  const equilibriumSigma = Math.max(
    DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor,
    calculatedEqSigma
  );

  return {
    theta,
    mu,
    sigma: continuousDiffusion,
    halfLifeMinutes,
    equilibriumSigma,
    rSquared,
    sampleCount: N,
    lastUpdated: now,
  };
}

/**
 * Synthesizes a discrete trajectory of an Ornstein-Uhlenbeck process via
 * the exact transition density (or Euler-Maruyama integration).
 * Useful for mathematical validation, simulation, and synthetic unit testing.
 * 
 * Transition formula:
 * b_{t+dt} = b_t * exp(-theta * dt) + mu * (1 - exp(-theta * dt)) + N(0, sigma^2 * (1 - exp(-2*theta*dt)) / (2*theta))
 */
export function simulateOUProcess(
  theta: number,
  mu: number,
  sigma: number,
  initialBasis: number,
  steps: number,
  dtMinutes: number = 1.0,
  randomSource: () => number = Math.random
): number[] {
  const trajectory: number[] = [initialBasis];
  let current = initialBasis;

  const expDecay = Math.exp(-theta * dtMinutes);
  const conditionalMeanFactor = 1.0 - expDecay;
  const varianceFactor = (sigma * sigma * (1.0 - Math.exp(-2.0 * theta * dtMinutes))) / (2.0 * theta);
  const stdDev = Math.sqrt(Math.max(0, varianceFactor));

  for (let i = 1; i < steps; i++) {
    // Box-Muller transform for standard normal sample
    const u1 = Math.max(1e-10, randomSource());
    const u2 = randomSource();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    current = current * expDecay + mu * conditionalMeanFactor + stdDev * z;
    trajectory.push(current);
  }

  return trajectory;
}
