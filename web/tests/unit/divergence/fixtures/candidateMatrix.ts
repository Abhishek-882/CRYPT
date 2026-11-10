/**
 * Candidate Matrix & Combinatorial Gating Fixture
 * Target: Opaque-Box E2E Testing for 24h Dispersion Scanner & Radar API
 * 
 * Primary Invariants:
 * - ZERO BPS NOTATION: All spreads, basis, hurdles, fees strictly in % notation.
 * - STRICT BAN ON LEGACY REFERENCES: Avoid naming or referencing legacy bot.
 * - DELTA-NEUTRALITY: Sizing matches delta balance |Delta_net| < 0.001.
 */

export {
  calculateLiveBasisPercent,
  calculateDispersion24hPercent,
  calculateDDI24h,
  isAntiCollisionValid,
  evaluateCandidateGates,
  type DivergenceCandidate,
} from '@/lib/divergence/scanner';

import {
  evaluateCandidateGates,
  DivergenceCandidate,
} from '@/lib/divergence/scanner';

/**
 * Exact boundary test cases for verification
 */
export const BOUNDARY_TEST_CASES = {
  // 1. Dispersion 0.399% vs 0.400%
  dispersionBelow: { pBn: 100.0, pByb: 100.02, dispersion: 0.399, ddi: 0.5, carry: 0.0 },
  dispersionAtMin: { pBn: 100.0, pByb: 100.02, dispersion: 0.400, ddi: 0.5, carry: 0.0 },

  // 2. Live Compression 0.100% vs 0.101%
  compressionAtMax: { pBn: 100.10, pByb: 100.00, dispersion: 0.650, ddi: 0.5, carry: 0.0 }, // bt = +0.100%
  compressionAbove: { pBn: 100.101, pByb: 100.00, dispersion: 0.650, ddi: 0.5, carry: 0.0 }, // bt = +0.101%

  // 3. Anti-Collision 5.000% vs 5.001%
  antiCollisionAtMax: { pBn: 105.00, pByb: 100.00, dispersion: 6.0, ddi: 0.5, carry: 0.0 }, // ~4.878%
  antiCollisionDisjoint: { pBn: 106.00, pByb: 100.00, dispersion: 6.0, ddi: 0.5, carry: 0.0 }, // ~5.825%

  // 4. Parity zero basis
  exactParity: { pBn: 100.00, pByb: 100.00, dispersion: 0.550, ddi: 0.35, carry: 0.0 },

  // 5. Carry -0.030% vs -0.031%
  carryAtLimit: { pBn: 100.01, pByb: 100.00, dispersion: 0.500, ddi: 0.4, carry: -0.030 },
  carryExceeded: { pBn: 100.01, pByb: 100.00, dispersion: 0.500, ddi: 0.4, carry: -0.031 },
};

/**
 * Generates full combinatorial truth table matrix across all 5 binary conditions (2^5 = 32 test vectors)
 */
export function generateCombinatorialCandidateMatrix(): Array<{
  id: string;
  dispersionPass: boolean;
  compressionPass: boolean;
  antiCollisionPass: boolean;
  runwayBufferPass: boolean;
  carryPass: boolean;
  expectedOverallPass: boolean;
  candidate: DivergenceCandidate;
}> {
  const vectors = [];

  for (let i = 0; i < 32; i++) {
    const dispersionPass = Boolean((i & 16) !== 0);
    const compressionPass = Boolean((i & 8) !== 0);
    const antiCollisionPass = Boolean((i & 4) !== 0);
    const runwayBufferPass = Boolean((i & 2) !== 0);
    const carryPass = Boolean((i & 1) !== 0);

    const dispersion = dispersionPass ? 0.450 : 0.350;
    const pBn = antiCollisionPass ? (compressionPass ? (runwayBufferPass ? 100.02 : 100.08) : 100.25) : 110.0;
    const pByb = 100.0;
    const ddi = 0.40;
    const carry = carryPass ? 0.005 : -0.045;

    const cand = evaluateCandidateGates(pBn, pByb, dispersion, ddi, carry);
    const expectedOverallPass =
      dispersionPass && compressionPass && antiCollisionPass && runwayBufferPass && carryPass;

    vectors.push({
      id: `COMB_VEC_${i.toString(2).padStart(5, '0')}`,
      dispersionPass,
      compressionPass,
      antiCollisionPass,
      runwayBufferPass,
      carryPass,
      expectedOverallPass,
      candidate: cand,
    });
  }

  return vectors;
}
