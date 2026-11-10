/**
 * Empirical Challenger M2: 5-Gate Boundary Conditions & Candidate Classification Test Suite
 * Author: teamwork_challenger (Milestone 2 Challenger 2)
 * Target: web/lib/divergence/scanner.ts
 * 
 * Verifies:
 * 1. 5-Gate boundary conditions:
 *    - Dispersion envelope: Delta_b_24h = 0.399% vs 0.400%
 *    - Live compression: |bt| = 0.100% vs 0.101%
 *    - Anti-collision disparity: 5.000% vs 5.001%
 *    - Runway buffer: bt = +0.030% vs +0.031% (Dir 1) and bt = -0.030% vs -0.031% (Dir 2)
 *    - Carry feasibility: r_carry = -0.030% vs -0.031%
 * 2. All 32 combinatorial permutations: only vector 11111 passes overall.
 * 3. Net alpha calculations: +0.120% net edge, +$0.0180 USDT on $15.00 notional (>= +$0.0100 USDT floor).
 * 4. Regex audits: Zero BPS notation (% strictly) and Zero legacy bot references.
 * 5. Extreme adversarial cases: NaN/Infinity/<=0 mid prices, empty histories, DDI bounds.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculateLiveBasisPercent,
  calculateDispersion24hPercent,
  calculateDDI24h,
  isAntiCollisionValid,
  evaluateCandidateGates,
  BASELINE_SEED_CORRIDOR,
  resetDivergenceScannerCache,
} from '@/lib/divergence/scanner';
import {
  DEFAULT_DIVERGENCE_CONFIG,
  DIVERGENCE_HARD_LIMITS,
  DivergenceConfig,
} from '@/lib/divergence/types';

describe('Challenger M2: 5-Gate Boundary Conditions & Candidate Classification', () => {
  const config: DivergenceConfig = { ...DEFAULT_DIVERGENCE_CONFIG };

  // ==========================================================================
  // SECTION 1: 5-Gate Boundary Conditions
  // ==========================================================================
  describe('1. 5-Gate Boundary Conditions', () => {
    // Gate 1: 24h Peak Dispersion (0.399% vs 0.400%)
    describe('Gate 1: 24h Peak Dispersion (0.399% vs 0.400%)', () => {
      it('rejects dispersion at 0.399% (< 0.400% threshold)', () => {
        // bt = 0, DDI = +0.50 (Dir 1), carry = 0
        const result = evaluateCandidateGates(100.0, 100.0, 0.399, 0.50, 0.000, config);
        expect(result.gatesPassed.dispersion).toBe(false);
        expect(result.overallPassed).toBe(false);
        expect(result.isQualified).toBe(false);
        expect(result.statusReason).toBe('REJECTED_LOW_DISPERSION_24H');
      });

      it('accepts dispersion at 0.400% (exact 0.400% boundary)', () => {
        const result = evaluateCandidateGates(100.0, 100.0, 0.400, 0.50, 0.000, config);
        expect(result.gatesPassed.dispersion).toBe(true);
        expect(result.overallPassed).toBe(true);
        expect(result.isQualified).toBe(true);
        expect(result.statusReason).toBe('QUALIFIED_PRIME_ZONE');
      });

      it('accepts dispersion at 0.401% (> 0.400% boundary)', () => {
        const result = evaluateCandidateGates(100.0, 100.0, 0.401, 0.50, 0.000, config);
        expect(result.gatesPassed.dispersion).toBe(true);
        expect(result.overallPassed).toBe(true);
      });

      it('evaluates calculateDispersion24hPercent 4-decimal boundary clamping', () => {
        expect(calculateDispersion24hPercent([0.399, -0.200, 0.100])).toBe(0.399);
        expect(calculateDispersion24hPercent([-0.400, 0.150])).toBe(0.400);
        expect(calculateDispersion24hPercent([0.000, -0.3999])).toBe(0.3999);
        expect(calculateDispersion24hPercent([0.000, -0.40001])).toBe(0.4000);
      });
    });

    // Gate 2: Live Compression (|bt| = 0.100% vs 0.101%)
    describe('Gate 2: Live Compression (|bt| = 0.100% vs 0.101%)', () => {
      it('accepts positive live compression at exact +0.100% boundary', () => {
        // mid = 100.0, bn = 100.05, byb = 99.95 -> bt = +0.1000%
        const result = evaluateCandidateGates(100.05, 99.95, 0.500, 0.50, 0.000, config);
        expect(result.liveBasisPercent).toBe(0.100);
        expect(result.gatesPassed.compression).toBe(true);
      });

      it('accepts negative live compression at exact -0.100% boundary', () => {
        // mid = 100.0, bn = 99.95, byb = 100.05 -> bt = -0.1000%
        const result = evaluateCandidateGates(99.95, 100.05, 0.500, -0.50, 0.000, config);
        expect(result.liveBasisPercent).toBe(-0.100);
        expect(result.gatesPassed.compression).toBe(true);
      });

      it('rejects positive live compression at +0.101% (> 0.100% boundary)', () => {
        // mid = 100.0, bn = 100.0505, byb = 99.9495 -> bt = +0.1010%
        const result = evaluateCandidateGates(100.0505, 99.9495, 0.500, 0.50, 0.000, config);
        expect(result.liveBasisPercent).toBe(0.101);
        expect(result.gatesPassed.compression).toBe(false);
        expect(result.overallPassed).toBe(false);
        expect(result.statusReason).toBe('AWAITING_COMPRESSION');
      });

      it('rejects negative live compression at -0.101% (< -0.100% boundary)', () => {
        // mid = 100.0, bn = 99.9495, byb = 100.0505 -> bt = -0.1010%
        const result = evaluateCandidateGates(99.9495, 100.0505, 0.500, -0.50, 0.000, config);
        expect(result.liveBasisPercent).toBe(-0.101);
        expect(result.gatesPassed.compression).toBe(false);
        expect(result.overallPassed).toBe(false);
        expect(result.statusReason).toBe('AWAITING_COMPRESSION');
      });
    });

    // Gate 3: Anti-Collision Sanity (5.000% vs 5.001%)
    describe('Gate 3: Anti-Collision Sanity (5.000% vs 5.001%)', () => {
      it('accepts cross-venue disparity at exact 5.000% boundary', () => {
        // mid = 100.0, diff = 5.00 -> 5.000%
        const pBn = 102.50;
        const pByb = 97.50;
        expect(isAntiCollisionValid(pBn, pByb, 5.000)).toBe(true);
        expect(isAntiCollisionValid(pByb, pBn, 5.000)).toBe(true);

        const result = evaluateCandidateGates(pBn, pByb, 0.500, 0.50, 0.000, config);
        expect(result.gatesPassed.antiCollision).toBe(true);
      });

      it('rejects cross-venue disparity at 5.001% (> 5.000% boundary)', () => {
        // mid = 100.0, diff = 5.001 -> 5.001%
        const pBn = 102.5005;
        const pByb = 97.4995;
        expect(isAntiCollisionValid(pBn, pByb, 5.000)).toBe(false);
        expect(isAntiCollisionValid(pByb, pBn, 5.000)).toBe(false);

        const result = evaluateCandidateGates(pBn, pByb, 0.500, 0.50, 0.000, config);
        expect(result.gatesPassed.antiCollision).toBe(false);
        expect(result.overallPassed).toBe(false);
        expect(result.statusReason).toBe('REJECTED_ANTI_COLLISION_SANITY');
      });
    });

    // Gate 4: Compression Runway Buffer Guard (+0.030% vs +0.031% and -0.030% vs -0.031%)
    describe('Gate 4: Compression Runway Buffer Guard', () => {
      it('Direction 1 (LONG_BN_SHORT_BYB): accepts bt = +0.030% (exact boundary)', () => {
        // mid = 100.0, diff = 0.030 -> bt = +0.0300%
        // DDI = +0.50 -> suggestedDirection = LONG_BN_SHORT_BYB
        const result = evaluateCandidateGates(100.015, 99.985, 0.500, 0.50, 0.000, config);
        expect(result.suggestedDirection).toBe('LONG_BN_SHORT_BYB');
        expect(result.liveBasisPercent).toBe(0.030);
        expect(result.gatesPassed.runwayBuffer).toBe(true);
        expect(result.overallPassed).toBe(true);
        expect(result.statusReason).toBe('QUALIFIED_PRIME_ZONE');
      });

      it('Direction 1 (LONG_BN_SHORT_BYB): rejects bt = +0.031% (> +0.030% boundary)', () => {
        // mid = 100.0, diff = 0.031 -> bt = +0.0310%
        const result = evaluateCandidateGates(100.0155, 99.9845, 0.500, 0.50, 0.000, config);
        expect(result.suggestedDirection).toBe('LONG_BN_SHORT_BYB');
        expect(result.liveBasisPercent).toBe(0.031);
        expect(result.gatesPassed.runwayBuffer).toBe(false);
        expect(result.overallPassed).toBe(false);
        expect(result.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');
      });

      it('Direction 1 (LONG_BN_SHORT_BYB): accepts negative bt (e.g. -0.050%) as ample headroom', () => {
        // For Dir 1 (+0.380% target), starting from negative basis (-0.050%) offers even more expansion room
        const result = evaluateCandidateGates(99.975, 100.025, 0.500, 0.50, 0.000, config);
        expect(result.suggestedDirection).toBe('LONG_BN_SHORT_BYB');
        expect(result.liveBasisPercent).toBe(-0.050);
        expect(result.gatesPassed.runwayBuffer).toBe(true);
        expect(result.overallPassed).toBe(true);
      });

      it('Direction 2 (SHORT_BN_LONG_BYB): accepts bt = -0.030% (exact boundary)', () => {
        // mid = 100.0, diff = -0.030 -> bt = -0.0300%
        // DDI = -0.50 -> suggestedDirection = SHORT_BN_LONG_BYB
        const result = evaluateCandidateGates(99.985, 100.015, 0.500, -0.50, 0.000, config);
        expect(result.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
        expect(result.liveBasisPercent).toBe(-0.030);
        expect(result.gatesPassed.runwayBuffer).toBe(true);
        expect(result.overallPassed).toBe(true);
      });

      it('Direction 2 (SHORT_BN_LONG_BYB): rejects bt = -0.031% (< -0.030% boundary)', () => {
        // mid = 100.0, diff = -0.031 -> bt = -0.0310%
        const result = evaluateCandidateGates(99.9845, 100.0155, 0.500, -0.50, 0.000, config);
        expect(result.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
        expect(result.liveBasisPercent).toBe(-0.031);
        expect(result.gatesPassed.runwayBuffer).toBe(false);
        expect(result.overallPassed).toBe(false);
        expect(result.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');
      });

      it('Direction 2 (SHORT_BN_LONG_BYB): accepts positive bt (e.g. +0.050%) as ample headroom', () => {
        const result = evaluateCandidateGates(100.025, 99.975, 0.500, -0.50, 0.000, config);
        expect(result.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
        expect(result.liveBasisPercent).toBe(0.050);
        expect(result.gatesPassed.runwayBuffer).toBe(true);
        expect(result.overallPassed).toBe(true);
      });
    });

    // Gate 5: Carry Feasibility (-0.030% vs -0.031%)
    describe('Gate 5: Carry Feasibility (-0.030% vs -0.031%)', () => {
      it('accepts carry at exact -0.030% boundary', () => {
        const result = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, -0.030, config);
        expect(result.gatesPassed.carryFeasibility).toBe(true);
        expect(result.overallPassed).toBe(true);
        expect(result.statusReason).toBe('QUALIFIED_PRIME_ZONE');
      });

      it('rejects carry at -0.031% (< -0.030% boundary)', () => {
        const result = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, -0.031, config);
        expect(result.gatesPassed.carryFeasibility).toBe(false);
        expect(result.overallPassed).toBe(false);
        expect(result.statusReason).toBe('REJECTED_ADVERSE_CARRY');
      });

      it('accepts carry at 0.000% and positive carry (e.g. +0.050%)', () => {
        const resZero = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, 0.000, config);
        expect(resZero.gatesPassed.carryFeasibility).toBe(true);

        const resPos = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, 0.050, config);
        expect(resPos.gatesPassed.carryFeasibility).toBe(true);
      });
    });
  });

  // ==========================================================================
  // SECTION 2: All 32 Combinatorial Permutations
  // ==========================================================================
  describe('2. Combinatorial Permutation Verification (32 Permutations)', () => {
    it('verifies that ONLY vector 11111 passes overall, and all other 31 vectors fail', () => {
      // 5 Gates:
      // g1: dispersionPassed (dispersion >= 0.400%)
      // g2: compressionPassed (|bt| <= 0.100%)
      // g3: antiCollisionPassed (disparity <= 5.000%)
      // g4: runwayBufferPassed (bt <= +0.030% for Dir 1)
      // g5: carryFeasibilityPassed (carry >= -0.030%)

      let vector11111PassedCount = 0;
      let non11111PassedCount = 0;
      const permutationResults: Array<{
        vector: string;
        overallPassed: boolean;
        isQualified: boolean;
        statusReason: string;
      }> = [];

      // Test all 32 combinations: i from 0 to 31
      for (let i = 0; i < 32; i++) {
        const g1 = (i & 16) !== 0; // bit 4: dispersion
        const g2 = (i & 8) !== 0;  // bit 3: compression
        const g3 = (i & 4) !== 0;  // bit 2: antiCollision
        const g4 = (i & 2) !== 0;  // bit 1: runwayBuffer
        const g5 = (i & 1) !== 0;  // bit 0: carryFeasibility

        const vector = `${g1 ? 1 : 0}${g2 ? 1 : 0}${g3 ? 1 : 0}${g4 ? 1 : 0}${g5 ? 1 : 0}`;

        const testConfig: DivergenceConfig = {
          ...config,
          minDispersion24hPercent: g1 ? 0.400 : 0.500,
          antiCollisionSanityPercent: g3 ? 5.000 : 0.010,
          maxAdverseFundingRatePercent: g5 ? -0.030 : 0.050,
        };

        // When g4 is true, bt = +0.020% (<= +0.030%, passes runway buffer)
        // When g4 is false, bt = +0.050% (> +0.030%, fails runway buffer)
        const pBn = g4 ? 100.010 : 100.025;
        const pByb = g4 ? 99.990 : 99.975;

        // When g2 is true, maxLiveCompression is 0.100% (so bt = 0.020% or 0.050% both pass compression)
        // When g2 is false, maxLiveCompression is 0.005% (so bt = 0.020% or 0.050% both fail compression)
        testConfig.maxLiveCompressionPercent = g2 ? 0.100 : 0.005;

        const dispersion = 0.450;
        const ddi = 0.50; // Dir 1
        const carry = 0.000;

        const evaluated = evaluateCandidateGates(pBn, pByb, dispersion, ddi, carry, testConfig);

        expect(evaluated.gatesPassed.dispersion).toBe(g1);
        expect(evaluated.gatesPassed.compression).toBe(g2);
        expect(evaluated.gatesPassed.antiCollision).toBe(g3);
        expect(evaluated.gatesPassed.runwayBuffer).toBe(g4);
        expect(evaluated.gatesPassed.carryFeasibility).toBe(g5);

        if (vector === '11111') {
          expect(evaluated.overallPassed).toBe(true);
          expect(evaluated.isQualified).toBe(true);
          expect(evaluated.statusReason).toBe('QUALIFIED_PRIME_ZONE');
          vector11111PassedCount++;
        } else {
          expect(evaluated.overallPassed).toBe(false);
          expect(evaluated.isQualified).toBe(false);
          expect(evaluated.statusReason).not.toBe('QUALIFIED_PRIME_ZONE');
          if (evaluated.overallPassed) non11111PassedCount++;
        }

        permutationResults.push({
          vector,
          overallPassed: evaluated.overallPassed,
          isQualified: evaluated.isQualified,
          statusReason: evaluated.statusReason,
        });
      }

      expect(vector11111PassedCount).toBe(1);
      expect(non11111PassedCount).toBe(0);
      expect(permutationResults.length).toBe(32);
    });

    it('verifies statusReason priority ladder across all combinations', () => {
      // Priority in scanner.ts:
      // 1. !antiCollisionPassed -> 'REJECTED_ANTI_COLLISION_SANITY'
      // 2. !dispersionPassed -> 'REJECTED_LOW_DISPERSION_24H'
      // 3. !compressionPassed -> 'AWAITING_COMPRESSION'
      // 4. !runwayBufferPassed -> 'AWAITING_COMPRESSION_BUFFER'
      // 5. !carryFeasibilityPassed -> 'REJECTED_ADVERSE_CARRY'
      // 6. all pass -> 'QUALIFIED_PRIME_ZONE'

      // Case 1: Anti-collision fails along with others -> Anti-collision takes precedence
      const r1 = evaluateCandidateGates(110.0, 90.0, 0.200, 0.50, -0.050, config);
      expect(r1.statusReason).toBe('REJECTED_ANTI_COLLISION_SANITY');

      // Case 2: Anti-collision passes, but dispersion and compression fail -> Dispersion takes precedence
      const r2 = evaluateCandidateGates(100.20, 99.80, 0.200, 0.50, -0.050, config);
      expect(r2.statusReason).toBe('REJECTED_LOW_DISPERSION_24H');

      // Case 3: Anti-collision and dispersion pass, but compression fails -> Compression takes precedence
      const r3 = evaluateCandidateGates(100.10, 99.90, 0.500, 0.50, -0.050, config); // bt = +0.200% > 0.100%
      expect(r3.statusReason).toBe('AWAITING_COMPRESSION');

      // Case 4: Anti-collision, dispersion, compression pass, but runway buffer fails -> Runway buffer takes precedence
      const r4 = evaluateCandidateGates(100.025, 99.975, 0.500, 0.50, -0.050, config); // bt = +0.050% <= 0.100%, but > 0.030%
      expect(r4.statusReason).toBe('AWAITING_COMPRESSION_BUFFER');

      // Case 5: Anti-collision, dispersion, compression, runway buffer pass, but carry fails -> Carry takes precedence
      const r5 = evaluateCandidateGates(100.010, 99.990, 0.500, 0.50, -0.050, config); // bt = +0.020% <= 0.030%, carry = -0.050% < -0.030%
      expect(r5.statusReason).toBe('REJECTED_ADVERSE_CARRY');

      // Case 6: All pass -> Prime zone
      const r6 = evaluateCandidateGates(100.010, 99.990, 0.500, 0.50, 0.000, config);
      expect(r6.statusReason).toBe('QUALIFIED_PRIME_ZONE');
    });
  });

  // ==========================================================================
  // SECTION 3: Net Alpha Calculation & Zero-Loss Floor
  // ==========================================================================
  describe('3. Net Alpha Calculation & Zero-Loss Floor', () => {
    it('calculates +0.120% net edge with zero carry', () => {
      // Net alpha = 0.380% (target) - 0.260% (fee friction) + 0.000% (carry) = +0.120%
      const candidate = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, 0.000, config);
      expect(candidate.overallPassed).toBe(true);
      expect(candidate.netAlphaProjectedPercent).toBe(0.120);
    });

    it('verifies +$0.0180 USDT dollar net profit on $15.00 notional satisfies zero-loss floor (>= +$0.0100 USDT)', () => {
      const candidate = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, 0.000, config);
      const notional = DIVERGENCE_HARD_LIMITS.ORDER_NOTIONAL_USDT; // 15.00 USDT
      const dollarProfit = notional * (candidate.netAlphaProjectedPercent / 100.0);
      const roundedDollarProfit = Math.round(dollarProfit * 10000) / 10000;

      expect(notional).toBe(15.00);
      expect(roundedDollarProfit).toBe(0.0180);
      expect(roundedDollarProfit).toBeGreaterThanOrEqual(config.zeroLossNetHurdleUsdt);
      expect(config.zeroLossNetHurdleUsdt).toBe(0.0100);

      // Margin of safety above zero-loss floor
      const surplus = roundedDollarProfit - config.zeroLossNetHurdleUsdt;
      expect(surplus).toBeCloseTo(0.0080, 4); // +80% margin over minimum hurdle
    });

    it('verifies worst-case allowable carry (-0.030%) still satisfies zero-loss floor', () => {
      // Net alpha = 0.380% - 0.260% - 0.030% = +0.090%
      const candidate = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, -0.030, config);
      expect(candidate.overallPassed).toBe(true);
      expect(candidate.netAlphaProjectedPercent).toBe(0.090);

      const notional = 15.00;
      const dollarProfit = notional * (candidate.netAlphaProjectedPercent / 100.0);
      const roundedDollarProfit = Math.round(dollarProfit * 10000) / 10000;

      expect(roundedDollarProfit).toBe(0.0135);
      expect(roundedDollarProfit).toBeGreaterThanOrEqual(config.zeroLossNetHurdleUsdt);
      expect(roundedDollarProfit - config.zeroLossNetHurdleUsdt).toBeCloseTo(0.0035, 4);
    });

    it('verifies positive carry increases net alpha accordingly', () => {
      // Net alpha = 0.380% - 0.260% + 0.050% = +0.170%
      const candidate = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, 0.050, config);
      expect(candidate.netAlphaProjectedPercent).toBe(0.170);

      const dollarProfit = 15.00 * (0.170 / 100.0);
      expect(Math.round(dollarProfit * 10000) / 10000).toBe(0.0255);
    });

    it('sets netAlphaProjectedPercent to 0.000% when candidate fails qualification', () => {
      const candidate = evaluateCandidateGates(100.0, 100.0, 0.200, 0.50, 0.000, config); // dispersion fail
      expect(candidate.overallPassed).toBe(false);
      expect(candidate.netAlphaProjectedPercent).toBe(0.000);
    });
  });

  // ==========================================================================
  // SECTION 4: Regex Audits: Zero BPS & Zero Legacy References
  // ==========================================================================
  describe('4. Codebase Hygiene & Invariant Regex Audits', () => {
    const scannerPath = path.resolve(process.cwd(), 'lib/divergence/scanner.ts');
    const routePath = path.resolve(process.cwd(), 'app/api/divergence/radar/route.ts');
    const typesPath = path.resolve(process.cwd(), 'lib/divergence/types.ts');

    it('strictly enforces Zero Numerical BPS Units across divergence files', () => {
      // Forbids any numerical values expressed in bps (e.g. "25 bps", "10.5 Bps")
      const forbiddenNumericBps = /\b\d+(\.\d+)?\s*bps\b/i;

      for (const p of [scannerPath, routePath, typesPath]) {
        const content = fs.readFileSync(p, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          expect(forbiddenNumericBps.test(line)).toBe(false);
        }
      }
    });

    it('audits occurrences of the token "bps" to ensure it only appears in invariant declarations', () => {
      const tokenRegex = /\bbps\b/i;

      for (const p of [scannerPath, routePath, typesPath]) {
        const content = fs.readFileSync(p, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (tokenRegex.test(line)) {
            // Must strictly be an invariant declaration comment, not operational code
            expect(line.toLowerCase()).toMatch(/zero bps notation/);
            expect(line.trim().startsWith('*')).toBe(true);
          }
        }
      }
    });

    it('strictly enforces Zero Legacy Bot References in scanner.ts and route.ts', () => {
      const legacyRegex = /\b(legacy_bot|deprecated_bot|basis_bot|statarb_bot|legacy_basis|deprecated_basis)\b/i;

      const scannerContent = fs.readFileSync(scannerPath, 'utf8');
      expect(scannerContent.match(legacyRegex)).toBeNull();

      const routeContent = fs.readFileSync(routePath, 'utf8');
      expect(routeContent.match(legacyRegex)).toBeNull();

      const typesContent = fs.readFileSync(typesPath, 'utf8');
      expect(typesContent.match(legacyRegex)).toBeNull();
    });
  });

  // ==========================================================================
  // SECTION 5: Extreme Adversarial & Numerical Robustness
  // ==========================================================================
  describe('5. Extreme Adversarial & Numerical Robustness', () => {
    it('handles zero, negative, NaN, and infinite prices safely in calculateLiveBasisPercent', () => {
      expect(calculateLiveBasisPercent(0, 0)).toBe(0.000);
      expect(calculateLiveBasisPercent(-10, 10)).toBe(0.000);
      expect(calculateLiveBasisPercent(NaN, 100)).toBe(0.000);
      expect(calculateLiveBasisPercent(100, Infinity)).toBe(0.000);
      expect(calculateLiveBasisPercent(-100, -100)).toBe(0.000);
    });

    it('handles empty, null, and all-zero basis histories safely in calculateDispersion24hPercent', () => {
      expect(calculateDispersion24hPercent([])).toBe(0.000);
      // @ts-expect-error testing null
      expect(calculateDispersion24hPercent(null)).toBe(0.000);
      expect(calculateDispersion24hPercent([0, 0, 0])).toBe(0.000);
      expect(calculateDispersion24hPercent([NaN, Infinity, 0.25])).toBe(0.25);
    });

    it('handles zero, negative, and infinite envelopes safely in calculateDDI24h', () => {
      expect(calculateDDI24h(0, 0)).toBe(0.000);
      expect(calculateDDI24h(NaN, 0.5)).toBe(0.000);
      expect(calculateDDI24h(Infinity, -Infinity)).toBe(0.000);

      // Symmetry tests:
      // Perfectly symmetric envelope [-0.50, +0.50] -> DDI = 0.000
      expect(calculateDDI24h(0.50, -0.50)).toBe(0.000);
      // Pure positive envelope [+0.50, 0.00] -> DDI = +1.000
      expect(calculateDDI24h(0.50, 0.00)).toBe(1.000);
      // Pure negative envelope [0.00, -0.50] -> DDI = -1.000
      expect(calculateDDI24h(0.00, -0.50)).toBe(-1.000);
    });

    it('verifies DDI directional routing boundaries at +/- 0.200', () => {
      // DDI > +0.200 -> LONG_BN_SHORT_BYB
      // DDI = +0.201 -> Dir 1
      const resPos = evaluateCandidateGates(100.0, 100.0, 0.500, 0.201, 0.000, config);
      expect(resPos.suggestedDirection).toBe('LONG_BN_SHORT_BYB');

      // DDI < -0.200 -> SHORT_BN_LONG_BYB
      // DDI = -0.201 -> Dir 2
      const resNeg = evaluateCandidateGates(100.0, 100.0, 0.500, -0.201, 0.000, config);
      expect(resNeg.suggestedDirection).toBe('SHORT_BN_LONG_BYB');

      // DDI = +0.200 (exact threshold) -> falls back to live basis tie-breaker
      // If bt >= 0 -> Dir 1
      const resTiePos = evaluateCandidateGates(100.01, 100.00, 0.500, 0.200, 0.000, config);
      expect(resTiePos.suggestedDirection).toBe('LONG_BN_SHORT_BYB');

      // If bt < 0 -> Dir 2
      const resTieNeg = evaluateCandidateGates(100.00, 100.01, 0.500, 0.200, 0.000, config);
      expect(resTieNeg.suggestedDirection).toBe('SHORT_BN_LONG_BYB');
    });

    it('handles zero, negative, NaN prices safely in isAntiCollisionValid', () => {
      expect(isAntiCollisionValid(0, 0)).toBe(false);
      expect(isAntiCollisionValid(-100, 100)).toBe(false);
      expect(isAntiCollisionValid(NaN, 100)).toBe(false);
      expect(isAntiCollisionValid(100, Infinity)).toBe(false);
    });
  });
});
