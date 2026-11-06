/**
 * Unit Test Suite: Continuous Ornstein-Uhlenbeck Parameter Calibrator
 * Target: web/lib/statarb/math/ouCalibrator.ts
 * 
 * Verifies:
 * - Tier 1: AR(1) OLS mathematical calibration, parameter recovery (theta, mu, sigma, tau, rSquared)
 * - Tier 2: Boundary & corner cases (sparse samples N < 5, zero variance, stationarity clamping beta in [0.01, 0.999], non-finite filtering)
 * - Tier 4: Stochastic Euler-Maruyama trajectory fitting across multiple market regimes
 */

import { describe, it, expect } from 'vitest';
import {
  calibrateOrnsteinUhlenbeck,
  DEFAULT_OU_PRIORS,
} from '@/lib/statarb/math/ouCalibrator';
import {
  generateEulerMaruyamaOU,
  generateDeterministicDecay,
  generateConstantSeries,
  generateLinearDrift,
  generateOscillatingSeries,
  STANDARD_OU_PROFILES,
} from './fixtures/ouGenerator';

describe('OU Parameter Calibrator (ouCalibrator.ts)', () => {
  // =========================================================================
  // TIER 1: CORE MATHEMATICAL CALIBRATION & RECOVERY
  // =========================================================================
  describe('Tier 1: Core Mathematical Calibration & Deterministic Recovery', () => {
    it('accurately recovers theta, mu, and tau from pure deterministic exponential decay', () => {
      const targetTheta = 0.10;
      const targetMu = 5.0; // 5 bps equilibrium basis
      const initialBasis = 45.0;
      const steps = 80;
      const dtMinutes = 1.0;

      // Pure decay: b_{k+1} = mu + (b_k - mu) * exp(-theta * dt)
      const cleanSeries = generateDeterministicDecay(
        targetTheta,
        targetMu,
        initialBasis,
        steps,
        dtMinutes
      );

      const params = calibrateOrnsteinUhlenbeck(cleanSeries, dtMinutes);

      // Beta should equal exp(-theta * dt) = exp(-0.10) ~= 0.904837
      const expectedBeta = Math.exp(-targetTheta * dtMinutes);
      const expectedTau = Math.LN2 / targetTheta; // ~= 6.931 minutes

      expect(params.sampleCount).toBe(steps);
      expect(params.theta).toBeCloseTo(targetTheta, 3);
      expect(params.mu).toBeCloseTo(targetMu, 2);
      expect(params.halfLifeMinutes).toBeCloseTo(expectedTau, 2);
      // Deterministic decay without noise should have near-perfect R^2
      expect(params.rSquared).toBeGreaterThan(0.999);
      // Residual variance without noise is near zero, sigma bounded by min floor
      expect(params.sigma).toBeGreaterThanOrEqual(0);
      expect(params.equilibriumSigma).toBeGreaterThanOrEqual(DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor);
    });

    it('scales theta inversely with dtMinutes when observations are identically spaced', () => {
      const targetTheta = 0.08;
      const initialBasis = 30.0;
      const mu = 0.0;
      const steps = 60;

      const seriesDt1 = generateDeterministicDecay(targetTheta, mu, initialBasis, steps, 1.0);
      const paramsDt1 = calibrateOrnsteinUhlenbeck(seriesDt1, 1.0);

      // If dt = 2.0 minutes for same beta, theta is halved: theta = -ln(beta) / 2.0
      const paramsDt2 = calibrateOrnsteinUhlenbeck(seriesDt1, 2.0);

      expect(paramsDt2.theta).toBeCloseTo(paramsDt1.theta / 2.0, 4);
      expect(paramsDt2.halfLifeMinutes).toBeCloseTo(paramsDt1.halfLifeMinutes * 2.0, 3);
    });

    it('enforces the mathematical invariant halfLifeMinutes == ln(2) / theta', () => {
      const syntheticSeries = generateEulerMaruyamaOU({
        theta: 0.12,
        mu: 1.5,
        sigma: 5.0,
        initialBasis: 25.0,
        steps: 100,
        seed: 777,
      });

      const params = calibrateOrnsteinUhlenbeck(syntheticSeries, 1.0);

      const calculatedHalfLife = Math.LN2 / params.theta;
      expect(params.halfLifeMinutes).toBeCloseTo(calculatedHalfLife, 4);
    });

    it('preserves equilibriumSigma == sigma / sqrt(2 * theta) when above floor', () => {
      const syntheticSeries = generateEulerMaruyamaOU({
        theta: 0.10,
        mu: 0.0,
        sigma: 8.0,
        initialBasis: 30.0,
        steps: 120,
        seed: 888,
      });

      const params = calibrateOrnsteinUhlenbeck(syntheticSeries, 1.0);

      const expectedEqSigma = params.sigma / Math.sqrt(2.0 * params.theta);
      expect(params.equilibriumSigma).toBeCloseTo(expectedEqSigma, 4);
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (SPARSE, ZERO-VAR, CLAMPING, DIRTY DATA)
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('Sparse Sample Fallback (N < 5)', () => {
      it('returns default prior parameters when observation series is empty (N = 0)', () => {
        const params = calibrateOrnsteinUhlenbeck([]);

        expect(params.sampleCount).toBe(0);
        expect(params.theta).toBe(DEFAULT_OU_PRIORS.theta);
        expect(params.halfLifeMinutes).toBe(DEFAULT_OU_PRIORS.halfLifeMinutes);
        expect(params.sigma).toBe(DEFAULT_OU_PRIORS.sigma);
        expect(params.equilibriumSigma).toBe(DEFAULT_OU_PRIORS.equilibriumSigma);
        expect(params.rSquared).toBe(0.0);
        expect(params.mu).toBe(0.0);
      });

      it('returns default prior parameters with single sample mean when N = 1', () => {
        const params = calibrateOrnsteinUhlenbeck([18.5]);

        expect(params.sampleCount).toBe(1);
        expect(params.theta).toBe(DEFAULT_OU_PRIORS.theta);
        expect(params.mu).toBe(18.5);
        expect(params.halfLifeMinutes).toBe(DEFAULT_OU_PRIORS.halfLifeMinutes);
        expect(params.sigma).toBe(DEFAULT_OU_PRIORS.sigma);
        expect(params.rSquared).toBe(0.0);
      });

      it('returns default prior parameters with sample mean when N = 4 (< 5)', () => {
        const sparseObs = [10.0, 12.0, 14.0, 16.0];
        const params = calibrateOrnsteinUhlenbeck(sparseObs);

        expect(params.sampleCount).toBe(4);
        expect(params.mu).toBe(13.0); // mean of 10, 12, 14, 16
        expect(params.theta).toBe(DEFAULT_OU_PRIORS.theta);
        expect(params.halfLifeMinutes).toBe(DEFAULT_OU_PRIORS.halfLifeMinutes);
        expect(params.equilibriumSigma).toBe(DEFAULT_OU_PRIORS.equilibriumSigma);
        expect(params.rSquared).toBe(0.0);
      });
    });

    describe('Zero Variance & Constant Series Handling', () => {
      it('handles frozen/constant basis feeds without division by zero or NaN', () => {
        const constantValue = 22.4;
        const constantSeries = generateConstantSeries(constantValue, 60);

        const params = calibrateOrnsteinUhlenbeck(constantSeries);

        expect(params.sampleCount).toBe(60);
        expect(params.mu).toBe(constantValue);
        expect(params.theta).toBe(DEFAULT_OU_PRIORS.theta);
        expect(params.halfLifeMinutes).toBe(DEFAULT_OU_PRIORS.halfLifeMinutes);
        expect(params.rSquared).toBe(0.0);
        expect(params.sigma).toBe(DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor);
        expect(params.equilibriumSigma).toBe(DEFAULT_OU_PRIORS.minEquilibriumSigmaFloor);
        expect(Number.isFinite(params.theta)).toBe(true);
        expect(Number.isFinite(params.mu)).toBe(true);
        expect(Number.isFinite(params.equilibriumSigma)).toBe(true);
      });
    });

    describe('Stationarity Safeguard & Clamping Behavior', () => {
      it('clamps explosive non-stationary series (raw beta >= 1.0) to betaCeil = 0.999', () => {
        // Pure upward drift: b_k = 10 + k * 2.0 -> raw beta >= 1.0
        const explosiveSeries = generateLinearDrift(10.0, 2.0, 60);

        const params = calibrateOrnsteinUhlenbeck(explosiveSeries);

        // Clamped beta = 0.999 -> theta = -ln(0.999) ~= 0.0010005 > 0
        expect(params.theta).toBeCloseTo(-Math.log(0.999), 4);
        expect(params.theta).toBeGreaterThan(0);
        expect(params.halfLifeMinutes).toBeCloseTo(Math.LN2 / -Math.log(0.999), 1);
        expect(Number.isFinite(params.mu)).toBe(true);
        expect(Number.isFinite(params.equilibriumSigma)).toBe(true);
      });

      it('clamps anti-persistent oscillating series (raw beta <= 0) to betaFloor = 0.01', () => {
        // Alternating +30, -30, +30, -30 -> raw beta ~= -1.0
        const oscillatingSeries = generateOscillatingSeries(30.0, 60);

        const params = calibrateOrnsteinUhlenbeck(oscillatingSeries);

        // Clamped beta = 0.01 -> theta = -ln(0.01) ~= 4.60517
        expect(params.theta).toBeCloseTo(-Math.log(0.01), 4);
        expect(params.halfLifeMinutes).toBeCloseTo(Math.LN2 / -Math.log(0.01), 3);
        expect(Number.isFinite(params.mu)).toBe(true);
        expect(Number.isFinite(params.equilibriumSigma)).toBe(true);
      });
    });

    describe('Dirty Data & Non-Finite Filtering', () => {
      it('filters out NaN, Infinity, -Infinity and retains valid numerical observations', () => {
        const dirtyData = [
          NaN,
          10.0,
          Infinity,
          12.0,
          -Infinity,
          14.0,
          null as unknown as number,
          16.0,
          undefined as unknown as number,
        ];

        const params = calibrateOrnsteinUhlenbeck(dirtyData);

        // Valid finite numbers are [10.0, 12.0, 14.0, 16.0] -> N = 4 (< 5, falls back to prior)
        expect(params.sampleCount).toBe(4);
        expect(params.mu).toBe(13.0);
        expect(params.theta).toBe(DEFAULT_OU_PRIORS.theta);
      });
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD STOCHASTIC TRAJECTORY FITTING
  // =========================================================================
  describe('Tier 4: Stochastic Euler-Maruyama Trajectory Parameter Recovery', () => {
    it('recovers mean reversion speed and equilibrium mean on FAST_REVERSION profile', () => {
      const profile = STANDARD_OU_PROFILES.FAST_REVERSION;
      const trajectory = generateEulerMaruyamaOU({
        theta: profile.theta,
        mu: profile.mu,
        sigma: profile.sigma,
        initialBasis: 35.0, // Start with a 35 bps basis dislocation
        steps: 600, // Long-sample asymptotic verification
        dtMinutes: 1.0,
        seed: 4242,
      });

      const params = calibrateOrnsteinUhlenbeck(trajectory, 1.0);

      expect(params.sampleCount).toBe(600);
      // Fast mean reversion (theta = 0.15): should recover theta within +/- 25% on 600 samples
      expect(params.theta).toBeGreaterThan(0.08);
      expect(params.theta).toBeLessThan(0.22);
      // Equilibrium mean should be close to 0 bps (+/- 3 bps)
      expect(params.mu).toBeGreaterThan(-3.0);
      expect(params.mu).toBeLessThan(3.0);
      // Stationary standard deviation should be positive and realistic
      expect(params.equilibriumSigma).toBeGreaterThan(5.0);
      expect(params.equilibriumSigma).toBeLessThan(20.0);
      expect(params.rSquared).toBeGreaterThan(0.05);
    });

    it('recovers moderate mean reversion dynamics on MODERATE_REVERSION profile', () => {
      const profile = STANDARD_OU_PROFILES.MODERATE_REVERSION;
      const trajectory = generateEulerMaruyamaOU({
        theta: profile.theta,
        mu: profile.mu,
        sigma: profile.sigma,
        initialBasis: -25.0,
        steps: 600,
        dtMinutes: 1.0,
        seed: 9999,
      });

      const params = calibrateOrnsteinUhlenbeck(trajectory, 1.0);

      expect(params.sampleCount).toBe(600);
      // Theta around 0.05 -> should be within [0.02, 0.10]
      expect(params.theta).toBeGreaterThan(0.02);
      expect(params.theta).toBeLessThan(0.10);
      // Half life around 14 minutes -> should be within [7, 35] minutes
      expect(params.halfLifeMinutes).toBeGreaterThan(7.0);
      expect(params.halfLifeMinutes).toBeLessThan(35.0);
      // Equilibrium mean should be near 2.0 bps
      expect(params.mu).toBeGreaterThan(-3.0);
      expect(params.mu).toBeLessThan(7.0);
    });

    it('retains structural stability on standard 60-minute window length', () => {
      // Production uses a 60-minute rolling window (N = 60)
      const windowSeries = generateEulerMaruyamaOU({
        theta: 0.12,
        mu: 1.0,
        sigma: 7.0,
        initialBasis: 28.0,
        steps: 60,
        dtMinutes: 1.0,
        seed: 5555,
      });

      const params = calibrateOrnsteinUhlenbeck(windowSeries, 1.0);

      expect(params.sampleCount).toBe(60);
      expect(Number.isFinite(params.theta)).toBe(true);
      expect(params.theta).toBeGreaterThan(0);
      expect(Number.isFinite(params.mu)).toBe(true);
      expect(Number.isFinite(params.halfLifeMinutes)).toBe(true);
      expect(Number.isFinite(params.equilibriumSigma)).toBe(true);
      expect(params.equilibriumSigma).toBeGreaterThan(0);
      expect(params.rSquared).toBeGreaterThanOrEqual(0);
      expect(params.rSquared).toBeLessThanOrEqual(1);
    });
  });
});
