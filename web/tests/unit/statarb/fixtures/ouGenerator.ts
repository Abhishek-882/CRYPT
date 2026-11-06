/**
 * Synthetic Euler-Maruyama Stochastic Ornstein-Uhlenbeck Fixture Generator
 * Discretization: b_{k+1} = b_k + theta * (mu - b_k) * dt + sigma * sqrt(dt) * Z_k
 * 
 * Provides deterministic, seedable stochastic trajectories and controlled edge-case series
 * for mathematical validation of AR(1) OLS calibration and parameter recovery.
 */

export interface OUGeneratorConfig {
  theta: number;
  mu: number;
  sigma: number;
  initialBasis: number;
  steps: number;
  dtMinutes?: number;
  seed?: number;
}

export interface OUProfile {
  name: string;
  theta: number;
  mu: number;
  sigma: number;
  expectedHalfLife: number;
  expectedEqSigma: number;
}

/**
 * Standard testing profiles representing realistic cryptocurrency basis dynamics
 */
export const STANDARD_OU_PROFILES: Record<string, OUProfile> = {
  FAST_REVERSION: {
    name: 'Fast Reversion (tau ~ 4.6m)',
    theta: 0.15,
    mu: 0.0,
    sigma: 6.0,
    expectedHalfLife: Math.LN2 / 0.15, // ~4.62 minutes
    expectedEqSigma: 6.0 / Math.sqrt(2 * 0.15), // ~10.95 bps
  },
  MODERATE_REVERSION: {
    name: 'Moderate Reversion (tau ~ 13.9m)',
    theta: 0.05,
    mu: 2.0,
    sigma: 8.0,
    expectedHalfLife: Math.LN2 / 0.05, // ~13.86 minutes
    expectedEqSigma: 8.0 / Math.sqrt(2 * 0.05), // ~25.30 bps
  },
  PERSISTENT_DRIFT: {
    name: 'Slow Persistent Drift (tau ~ 69.3m)',
    theta: 0.01,
    mu: -4.0,
    sigma: 4.0,
    expectedHalfLife: Math.LN2 / 0.01, // ~69.31 minutes
    expectedEqSigma: 4.0 / Math.sqrt(2 * 0.01), // ~28.28 bps
  },
};

/**
 * High-performance deterministic 32-bit pseudo-random number generator (Mulberry32).
 * Ensures tests produce identical numerical values across CPU architectures and OS runners.
 */
export function createMulberry32(seed: number = 42): () => number {
  let s = Math.floor(seed) >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller transform generating standard normal N(0, 1) variates from uniform PRNG.
 */
export function generateNormalVariate(prng: () => number): number {
  let u1 = prng();
  while (u1 <= 1e-12) {
    u1 = prng();
  }
  const u2 = prng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Generates an Euler-Maruyama discrete stochastic trajectory of an OU process:
 * b_{k+1} = b_k + theta * (mu - b_k) * dt + sigma * sqrt(dt) * Z_k
 */
export function generateEulerMaruyamaOU(config: OUGeneratorConfig): number[] {
  const {
    theta,
    mu,
    sigma,
    initialBasis,
    steps,
    dtMinutes = 1.0,
    seed = 12345,
  } = config;

  if (steps <= 0) return [];
  const trajectory: number[] = [initialBasis];
  const prng = createMulberry32(seed);
  const sqrtDt = Math.sqrt(dtMinutes);

  let current = initialBasis;
  for (let k = 1; k < steps; k++) {
    const z = generateNormalVariate(prng);
    const drift = theta * (mu - current) * dtMinutes;
    const diffusion = sigma * sqrtDt * z;
    current = current + drift + diffusion;
    trajectory.push(current);
  }

  return trajectory;
}

/**
 * Generates a pure deterministic exponential decay trajectory (zero diffusion noise):
 * b_{k+1} = mu + (b_k - mu) * exp(-theta * dt)
 * Useful for verifying pure regression slope without stochastic sampling variance.
 */
export function generateDeterministicDecay(
  theta: number,
  mu: number,
  initialBasis: number,
  steps: number,
  dtMinutes: number = 1.0
): number[] {
  if (steps <= 0) return [];
  const trajectory: number[] = [initialBasis];
  const decay = Math.exp(-theta * dtMinutes);

  let current = initialBasis;
  for (let k = 1; k < steps; k++) {
    current = mu + (current - mu) * decay;
    trajectory.push(current);
  }

  return trajectory;
}

/**
 * Generates a series with constant identical values (zero variance).
 */
export function generateConstantSeries(value: number, steps: number): number[] {
  return Array.from({ length: steps }, () => value);
}

/**
 * Generates a linear upward or downward drift series (explosive / non-stationary):
 * b_{k} = initial + k * stepSize
 */
export function generateLinearDrift(
  initial: number,
  stepSize: number,
  steps: number
): number[] {
  return Array.from({ length: steps }, (_, k) => initial + k * stepSize);
}

/**
 * Generates an alternating / anti-persistent oscillating series:
 * e.g., +20, -20, +20, -20, ... (beta < 0)
 */
export function generateOscillatingSeries(
  amplitude: number,
  steps: number
): number[] {
  return Array.from({ length: steps }, (_, k) => (k % 2 === 0 ? amplitude : -amplitude));
}
