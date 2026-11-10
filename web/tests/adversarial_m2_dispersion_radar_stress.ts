/**
 * EMPIRICAL CHALLENGER: ADVERSARIAL STRESS TEST HARNESS FOR MILESTONE 2
 * Target: 24h Dispersion Scanner, Radar API, Gating Logic, and Boundary Math
 * 
 * Verifies:
 * 1. DDI24h Bounds Across Edge-Case Distributions:
 *    - All negative basis [-0.5, -0.1], [-1.0, -0.9], etc. (verifying strict [-1.000, +1.000] clamp)
 *    - All positive basis [0.1, 0.5], [0.0, 0.5], etc.
 *    - Exact zero [0, 0], [-0, +0]
 *    - Large extremes [-10.0, 10.0], [-1000.0, 1000.0], [-100.0, -50.0], [50.0, 100.0]
 *    - NaN, Infinity, -Infinity, MaxValue protections (guaranteeing finite bounded outputs in [-1.000, +1.000])
 *    - 50,000-iteration Monte Carlo Fuzzing
 * 2. Direction-Aware Carry Edge Cases:
 *    - Direction 1: Long BN, Short BYB (receives Bybit funding, pays BN ~0)
 *    - Direction 2: Short BN, Long BYB (pays Bybit funding, receives BN ~0)
 *    - Positive Bybit funding in Direction 2 -> negative carry drag
 *    - Negative Bybit funding in Direction 2 -> positive carry yield
 *    - Directional carry threshold boundaries (-0.030% vs -0.031%)
 * 3. 32-Vector Combinatorial Gate Truth Table:
 *    - All 32 permutations of (G1, G2, G3, G4, G5)
 *    - Assert only 11111 qualifies
 *    - Validate 5-tier statusReason priority ladder
 * 4. Exact Boundary Checks:
 *    - 0.399% vs 0.400% 24h dispersion
 *    - 0.100% vs 0.101% live compression (both positive and negative)
 *    - 5.000% vs 5.001% anti-collision disparity
 *    - +0.030% vs +0.031% runway buffer (Direction 1)
 *    - -0.030% vs -0.031% runway buffer (Direction 2)
 *    - -0.030% vs -0.031% carry feasibility
 * 5. Net Alpha & Guaranteed Zero-Loss Hurdle ($15.00 notional):
 *    - Net alpha calculation: target (0.380%) - fee (0.260%) + carry
 *    - Dollar profit verification >= +$0.0100 USDT floor
 * 6. Radar Route & Live Ingestion Integration:
 *    - X-Degraded-Feed header
 *    - Response schema contracts (RadarSummary: totalScanned, totalPairsScanned, qualifyingCount)
 */

import {
  calculateLiveBasisPercent,
  calculateDispersion24hPercent,
  calculateDDI24h,
  isAntiCollisionValid,
  evaluateCandidateGates,
  executeUniverseScan,
  getDivergenceRadarFeed,
  resetDivergenceScannerCache,
} from '../lib/divergence/scanner';
import {
  DEFAULT_DIVERGENCE_CONFIG,
  DIVERGENCE_HARD_LIMITS,
  DivergenceConfig,
  DivergenceCandidate,
  DivergenceDirection,
} from '../lib/divergence/types';
import { GET } from '../app/api/divergence/radar/route';
import { NextRequest } from 'next/server';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

function assertTest(suite: string, name: string, condition: boolean, details: string) {
  if (condition) {
    passCount++;
    results.push({ suite, name, passed: true, details });
    console.log(`  [PASS] [${suite}] ${name}`);
  } else {
    failCount++;
    results.push({ suite, name, passed: false, details });
    console.error(`  [FAIL] [${suite}] ${name} -> ${details}`);
  }
}

// ============================================================================
// SUITE 1: DDI24H BOUNDS ACROSS EDGE-CASE DISTRIBUTIONS & MONTE CARLO FUZZING
// ============================================================================
function runSuite1() {
  console.log('\n==================================================================');
  console.log('SUITE 1: DDI24h Bounds Across Edge-Case Distributions & Fuzzing');
  console.log('==================================================================');

  // Test 1.1: All Negative Basis
  const negCases = [
    { bMax: -0.1, bMin: -0.5, expected: -1.0 },
    { bMax: -0.9, bMin: -1.0, expected: -1.0 },
    { bMax: -0.001, bMin: -0.002, expected: -1.0 },
    { bMax: -0.0001, bMin: -0.5000, expected: -1.0 },
    { bMax: -5.0, bMin: -10.0, expected: -1.0 },
  ];
  for (const c of negCases) {
    const val = calculateDDI24h(c.bMax, c.bMin);
    assertTest(
      'Suite 1.1 - All Negative Basis',
      `bMax=${c.bMax}, bMin=${c.bMin} clamped to [-1.0, +1.0] (got ${val})`,
      val >= -1.0 && val <= 1.0 && val === c.expected,
      `Calculated: ${val}, Expected: ${c.expected}`
    );
  }

  // Test 1.2: All Positive Basis
  const posCases = [
    { bMax: 0.5, bMin: 0.1, expected: 0.800 },
    { bMax: 0.5, bMin: 0.0, expected: 1.000 },
    { bMax: 10.0, bMin: 5.0, expected: 0.500 },
    { bMax: 0.400, bMin: 0.200, expected: 0.500 },
    { bMax: 0.100, bMin: 0.099, expected: 0.010 },
  ];
  for (const c of posCases) {
    const val = calculateDDI24h(c.bMax, c.bMin);
    assertTest(
      'Suite 1.2 - All Positive Basis',
      `bMax=${c.bMax}, bMin=${c.bMin} within bounds (got ${val})`,
      val >= -1.0 && val <= 1.0 && Math.abs(val - c.expected) < 0.0015,
      `Calculated: ${val}, Expected: ${c.expected}`
    );
  }

  // Test 1.3: Exact Zero
  const zeroCases = [
    { bMax: 0.0, bMin: 0.0 },
    { bMax: -0.0, bMin: +0.0 },
    { bMax: 0, bMin: 0 },
  ];
  for (const c of zeroCases) {
    const val = calculateDDI24h(c.bMax, c.bMin);
    assertTest(
      'Suite 1.3 - Exact Zero',
      `bMax=${c.bMax}, bMin=${c.bMin} yields 0.000`,
      val === 0.000,
      `Calculated: ${val}`
    );
  }

  // Test 1.4: Large Extremes and Symmetric Envelopes
  const extremeCases = [
    { bMax: 10.0, bMin: -10.0, expected: 0.000 },
    { bMax: 1000.0, bMin: -1000.0, expected: 0.000 },
    { bMax: 100.0, bMin: 0.0, expected: 1.000 },
    { bMax: 0.0, bMin: -100.0, expected: -1.000 },
    { bMax: -50.0, bMin: -100.0, expected: -1.000 },
    { bMax: 100.0, bMin: 50.0, expected: 0.500 },
    { bMax: 0.50, bMin: -0.25, expected: 0.500 },
    { bMax: 0.25, bMin: -0.50, expected: -0.500 },
  ];
  for (const c of extremeCases) {
    const val = calculateDDI24h(c.bMax, c.bMin);
    assertTest(
      'Suite 1.4 - Large Extremes',
      `bMax=${c.bMax}, bMin=${c.bMin} -> ${val} (expected ${c.expected})`,
      val >= -1.0 && val <= 1.0 && Math.abs(val - c.expected) < 0.0015,
      `Calculated: ${val}, Expected: ${c.expected}`
    );
  }

  // Test 1.5: NaN / Infinity / Unsafe Types Protection
  const invalidCases = [
    { bMax: NaN, bMin: 0.5, desc: 'bMax NaN' },
    { bMax: 0.5, bMin: NaN, desc: 'bMin NaN' },
    { bMax: NaN, bMin: NaN, desc: 'both NaN' },
    { bMax: Infinity, bMin: -Infinity, desc: 'Infinity and -Infinity' },
    { bMax: 10.0, bMin: -Infinity, desc: 'finite and -Infinity' },
    { bMax: -Infinity, bMin: -10.0, desc: '-Infinity and finite' },
    { bMax: Number.POSITIVE_INFINITY, bMin: 0, desc: '+Infinity and 0' },
    { bMax: 0, bMin: Number.NEGATIVE_INFINITY, desc: '0 and -Infinity' },
    { bMax: Number.MAX_VALUE, bMin: -Number.MAX_VALUE, desc: 'MAX_VALUE extremes' },
  ];
  for (const c of invalidCases) {
    const val = calculateDDI24h(c.bMax, c.bMin);
    const isProtected = Number.isFinite(val) && !isNaN(val) && val >= -1.0 && val <= 1.0;
    assertTest(
      'Suite 1.5 - NaN / Infinity Protection',
      `Protected execution for ${c.desc}: bMax=${c.bMax}, bMin=${c.bMin} -> ${val} in [-1.0, +1.0]`,
      isProtected,
      `Calculated: ${val}, IsFinite: ${Number.isFinite(val)}`
    );
  }

  // Test 1.6: 50,000-Iteration Monte Carlo Fuzzing
  let fuzzPassed = true;
  let worstValue = 0;
  for (let i = 0; i < 50000; i++) {
    const r1 = (Math.random() - 0.5) * 2000;
    const r2 = (Math.random() - 0.5) * 2000;
    const bMax = Math.max(r1, r2);
    const bMin = Math.min(r1, r2);

    const ddi = calculateDDI24h(bMax, bMin);
    if (!Number.isFinite(ddi) || isNaN(ddi) || ddi < -1.000 || ddi > 1.000) {
      fuzzPassed = false;
      worstValue = ddi;
      break;
    }
  }
  assertTest(
    'Suite 1.6 - Monte Carlo Fuzzing',
    '50,000 random permutations across [-1000, 1000] stay strictly within [-1.000, +1.000]',
    fuzzPassed,
    `Fuzzing result: ${fuzzPassed ? 'ALL PASSED' : 'FAILED with ' + worstValue}`
  );
}

// ============================================================================
// SUITE 2: DIRECTION-AWARE CARRY FORMULATION & ECONOMIC EDGE CASES
// ============================================================================
function runSuite2() {
  console.log('\n==================================================================');
  console.log('SUITE 2: Direction-Aware Carry Formulation & Economic Edge Cases');
  console.log('==================================================================');

  const config = { ...DEFAULT_DIVERGENCE_CONFIG };

  // Helper function mimicking scanner.ts direction and carry determination
  function computeDirectionalCarry(
    ddi24h: number,
    liveBasisPercent: number,
    rawBybitFunding: number
  ): { initialDirection: DivergenceDirection; projectedCarryPercent: number } {
    let initialDirection: DivergenceDirection = 'LONG_BN_SHORT_BYB';
    if (ddi24h > 0.200) {
      initialDirection = 'LONG_BN_SHORT_BYB';
    } else if (ddi24h < -0.200) {
      initialDirection = 'SHORT_BN_LONG_BYB';
    } else {
      initialDirection = liveBasisPercent >= 0 ? 'LONG_BN_SHORT_BYB' : 'SHORT_BN_LONG_BYB';
    }

    const projectedCarryPercent = initialDirection === 'LONG_BN_SHORT_BYB'
      ? rawBybitFunding
      : -rawBybitFunding;

    return { initialDirection, projectedCarryPercent };
  }

  // Test 2.1: Direction 1 (LONG_BN_SHORT_BYB) with Positive Bybit Funding
  // Long Binance, Short Bybit -> Being short on Bybit receives funding -> Positive yield!
  const d1Pos = computeDirectionalCarry(0.50, 0.020, 0.050);
  assertTest(
    'Suite 2.1 - Direction 1 Positive Funding',
    'Direction 1 with +0.050% Bybit funding yields +0.050% carry income',
    d1Pos.initialDirection === 'LONG_BN_SHORT_BYB' && d1Pos.projectedCarryPercent === 0.050,
    `Direction=${d1Pos.initialDirection}, Carry=${d1Pos.projectedCarryPercent}%`
  );

  // Evaluate candidate gates for Direction 1 with positive funding
  const evalD1Pos = evaluateCandidateGates(100.010, 99.990, 0.500, 0.50, d1Pos.projectedCarryPercent, config);
  assertTest(
    'Suite 2.1 - Direction 1 Positive Funding Gating',
    'Gate 5 passes and netAlphaProjectedPercent includes positive carry (+0.170%)',
    evalD1Pos.gatesPassed.carryFeasibility && evalD1Pos.netAlphaProjectedPercent === 0.170,
    `Gate5=${evalD1Pos.gatesPassed.carryFeasibility}, NetAlpha=${evalD1Pos.netAlphaProjectedPercent}%`
  );

  // Test 2.2: Direction 1 (LONG_BN_SHORT_BYB) with Negative Bybit Funding
  // Long Binance, Short Bybit -> Being short on Bybit pays negative funding -> Drag!
  const d1Neg = computeDirectionalCarry(0.50, 0.020, -0.050);
  assertTest(
    'Suite 2.2 - Direction 1 Negative Funding Drag',
    'Direction 1 with -0.050% Bybit funding incurs -0.050% carry drag',
    d1Neg.initialDirection === 'LONG_BN_SHORT_BYB' && d1Neg.projectedCarryPercent === -0.050,
    `Direction=${d1Neg.initialDirection}, Carry=${d1Neg.projectedCarryPercent}%`
  );

  const evalD1Neg = evaluateCandidateGates(100.010, 99.990, 0.500, 0.50, d1Neg.projectedCarryPercent, config);
  assertTest(
    'Suite 2.2 - Direction 1 Negative Funding Rejection',
    'Direction 1 with -0.050% carry drag fails Gate 5 (threshold -0.030%) with REJECTED_ADVERSE_CARRY',
    !evalD1Neg.gatesPassed.carryFeasibility && !evalD1Neg.overallPassed && evalD1Neg.statusReason === 'REJECTED_ADVERSE_CARRY',
    `Gate5=${evalD1Neg.gatesPassed.carryFeasibility}, Status=${evalD1Neg.statusReason}`
  );

  // Test 2.3: Direction 2 (SHORT_BN_LONG_BYB) with Positive Bybit Funding
  // Short Binance, Long Bybit -> Being long on Bybit pays positive funding -> Drag!
  const d2Pos = computeDirectionalCarry(-0.50, -0.020, 0.050);
  assertTest(
    'Suite 2.3 - Direction 2 Positive Funding Drag',
    'Direction 2 with +0.050% Bybit funding correctly inverts to -0.050% carry drag',
    d2Pos.initialDirection === 'SHORT_BN_LONG_BYB' && d2Pos.projectedCarryPercent === -0.050,
    `Direction=${d2Pos.initialDirection}, Carry=${d2Pos.projectedCarryPercent}%`
  );

  const evalD2Pos = evaluateCandidateGates(99.990, 100.010, 0.500, -0.50, d2Pos.projectedCarryPercent, config);
  assertTest(
    'Suite 2.3 - Direction 2 Positive Funding Rejection',
    'Direction 2 with +0.050% Bybit funding fails Gate 5 and is rejected with REJECTED_ADVERSE_CARRY',
    !evalD2Pos.gatesPassed.carryFeasibility && !evalD2Pos.overallPassed && evalD2Pos.statusReason === 'REJECTED_ADVERSE_CARRY',
    `Gate5=${evalD2Pos.gatesPassed.carryFeasibility}, Status=${evalD2Pos.statusReason}`
  );

  // Test 2.4: Direction 2 (SHORT_BN_LONG_BYB) with Negative Bybit Funding
  // Short Binance, Long Bybit -> Being long on Bybit receives negative funding -> Yield!
  const d2Neg = computeDirectionalCarry(-0.50, -0.020, -0.050);
  assertTest(
    'Suite 2.4 - Direction 2 Negative Funding Yield',
    'Direction 2 with -0.050% Bybit funding correctly inverts to +0.050% carry income',
    d2Neg.initialDirection === 'SHORT_BN_LONG_BYB' && d2Neg.projectedCarryPercent === 0.050,
    `Direction=${d2Neg.initialDirection}, Carry=${d2Neg.projectedCarryPercent}%`
  );

  const evalD2Neg = evaluateCandidateGates(99.990, 100.010, 0.500, -0.50, d2Neg.projectedCarryPercent, config);
  assertTest(
    'Suite 2.4 - Direction 2 Negative Funding Approval',
    'Direction 2 with -0.050% Bybit funding passes Gate 5 with prime qualification',
    evalD2Neg.gatesPassed.carryFeasibility && evalD2Neg.overallPassed && evalD2Neg.statusReason === 'QUALIFIED_PRIME_ZONE',
    `Gate5=${evalD2Neg.gatesPassed.carryFeasibility}, Status=${evalD2Neg.statusReason}, NetAlpha=${evalD2Neg.netAlphaProjectedPercent}%`
  );

  // Test 2.5: Exact Boundary Carry in Direction 2 (+0.030% vs +0.031% Bybit Funding)
  // Bybit funding +0.030% -> carry -0.030% (exact threshold) -> PASS
  const d2BoundaryPass = computeDirectionalCarry(-0.50, -0.020, 0.030);
  const evalD2BoundPass = evaluateCandidateGates(99.990, 100.010, 0.500, -0.50, d2BoundaryPass.projectedCarryPercent, config);
  assertTest(
    'Suite 2.5 - Direction 2 Exact Boundary Carry (-0.030%)',
    'Direction 2 with +0.030% Bybit funding (drag -0.030%) exactly passes Gate 5',
    evalD2BoundPass.gatesPassed.carryFeasibility && evalD2BoundPass.overallPassed,
    `Gate5=${evalD2BoundPass.gatesPassed.carryFeasibility}, Overall=${evalD2BoundPass.overallPassed}`
  );

  // Bybit funding +0.031% -> carry -0.031% (breaches threshold) -> FAIL
  const d2BoundaryFail = computeDirectionalCarry(-0.50, -0.020, 0.031);
  const evalD2BoundFail = evaluateCandidateGates(99.990, 100.010, 0.500, -0.50, d2BoundaryFail.projectedCarryPercent, config);
  assertTest(
    'Suite 2.5 - Direction 2 Sub-Boundary Carry (-0.031%)',
    'Direction 2 with +0.031% Bybit funding (drag -0.031%) fails Gate 5',
    !evalD2BoundFail.gatesPassed.carryFeasibility && !evalD2BoundFail.overallPassed && evalD2BoundFail.statusReason === 'REJECTED_ADVERSE_CARRY',
    `Gate5=${evalD2BoundFail.gatesPassed.carryFeasibility}, Status=${evalD2BoundFail.statusReason}`
  );
}

// ============================================================================
// SUITE 3: 32-VECTOR COMBINATORIAL GATE TRUTH TABLE & STATUS LADDER
// ============================================================================
function runSuite3() {
  console.log('\n==================================================================');
  console.log('SUITE 3: 32-Vector Combinatorial Gate Truth Table & Priority Ladder');
  console.log('==================================================================');

  const config = { ...DEFAULT_DIVERGENCE_CONFIG };

  let count11111Passed = 0;
  let countNon11111Passed = 0;

  for (let i = 0; i < 32; i++) {
    const g1 = (i & 16) !== 0; // bit 4: Dispersion (>= 0.400%)
    const g2 = (i & 8) !== 0;  // bit 3: Live Compression (<= 0.100%)
    const g3 = (i & 4) !== 0;  // bit 2: Anti-Collision (<= 5.000%)
    const g4 = (i & 2) !== 0;  // bit 1: Runway Buffer (<= +0.030% for Dir 1)
    const g5 = (i & 1) !== 0;  // bit 0: Carry Feasibility (>= -0.030%)

    const vector = `${g1 ? 1 : 0}${g2 ? 1 : 0}${g3 ? 1 : 0}${g4 ? 1 : 0}${g5 ? 1 : 0}`;

    // Configure test parameters to toggle each gate deterministically:
    const testConfig: DivergenceConfig = {
      ...config,
      minDispersion24hPercent: g1 ? 0.400 : 0.500,
      antiCollisionSanityPercent: g3 ? 5.000 : 0.010,
      maxAdverseFundingRatePercent: g5 ? -0.030 : 0.050,
      maxLiveCompressionPercent: g2 ? 0.100 : 0.005,
    };

    // When g4 is true, bt = +0.020% (<= +0.030%, passes runway buffer)
    // When g4 is false, bt = +0.050% (> +0.030%, fails runway buffer)
    const pBn = g4 ? 100.010 : 100.025;
    const pByb = g4 ? 99.990 : 99.975;

    const dispersion = 0.450;
    const ddi = 0.50; // Dir 1
    const carry = 0.000;

    const evaluated = evaluateCandidateGates(pBn, pByb, dispersion, ddi, carry, testConfig);

    const matchG1 = evaluated.gatesPassed.dispersion === g1;
    const matchG2 = evaluated.gatesPassed.compression === g2;
    const matchG3 = evaluated.gatesPassed.antiCollision === g3;
    const matchG4 = evaluated.gatesPassed.runwayBuffer === g4;
    const matchG5 = evaluated.gatesPassed.carryFeasibility === g5;

    if (vector === '11111') {
      const qualifies = evaluated.overallPassed && evaluated.isQualified && evaluated.statusReason === 'QUALIFIED_PRIME_ZONE';
      if (qualifies) count11111Passed++;
      assertTest(
        'Suite 3 - Gate Vector 11111',
        'Vector 11111 successfully qualifies and enters QUALIFIED_PRIME_ZONE',
        qualifies && matchG1 && matchG2 && matchG3 && matchG4 && matchG5,
        `OverallPassed=${evaluated.overallPassed}, Status=${evaluated.statusReason}`
      );
    } else {
      if (evaluated.overallPassed) countNon11111Passed++;
      assertTest(
        'Suite 3 - Non-11111 Vectors',
        `Vector ${vector} strictly rejected (status: ${evaluated.statusReason})`,
        !evaluated.overallPassed && !evaluated.isQualified && evaluated.statusReason !== 'QUALIFIED_PRIME_ZONE' &&
        matchG1 && matchG2 && matchG3 && matchG4 && matchG5,
        `Vector=${vector}, OverallPassed=${evaluated.overallPassed}, StatusReason=${evaluated.statusReason}`
      );
    }
  }

  assertTest(
    'Suite 3 - Combinatorial Completeness',
    `Exactly 1 vector out of 32 qualified (11111=${count11111Passed}, non-11111 passed=${countNon11111Passed})`,
    count11111Passed === 1 && countNon11111Passed === 0,
    `11111=${count11111Passed}, non-11111=${countNon11111Passed}`
  );
}

// ============================================================================
// SUITE 4: EXACT BOUNDARY CHECKS
// ============================================================================
function runSuite4() {
  console.log('\n==================================================================');
  console.log('SUITE 4: Exact Boundary Condition Checks');
  console.log('==================================================================');

  const config = { ...DEFAULT_DIVERGENCE_CONFIG };

  // Boundary 4.1: 0.399% vs 0.400% 24h Dispersion
  const dispFail = evaluateCandidateGates(100.0, 100.0, 0.399, 0.50, 0.000, config);
  const dispPass = evaluateCandidateGates(100.0, 100.0, 0.400, 0.50, 0.000, config);
  assertTest(
    'Suite 4.1 - Dispersion Boundary',
    'Dispersion 0.399% fails Gate 1 while 0.400% passes Gate 1',
    !dispFail.gatesPassed.dispersion && dispPass.gatesPassed.dispersion,
    `0.399% passed=${dispFail.gatesPassed.dispersion}, 0.400% passed=${dispPass.gatesPassed.dispersion}`
  );

  // Boundary 4.2: 0.100% vs 0.101% Live Compression
  // Positive boundary
  const compPosPass = evaluateCandidateGates(100.05, 99.95, 0.500, 0.50, 0.000, config); // bt = +0.1000%
  const compPosFail = evaluateCandidateGates(100.0505, 99.9495, 0.500, 0.50, 0.000, config); // bt = +0.1010%
  assertTest(
    'Suite 4.2 - Positive Compression Boundary',
    '+0.100% compression passes while +0.101% fails',
    compPosPass.gatesPassed.compression && !compPosFail.gatesPassed.compression,
    `+0.100%=${compPosPass.gatesPassed.compression}, +0.101%=${compPosFail.gatesPassed.compression}`
  );

  // Negative boundary
  const compNegPass = evaluateCandidateGates(99.95, 100.05, 0.500, -0.50, 0.000, config); // bt = -0.1000%
  const compNegFail = evaluateCandidateGates(99.9495, 100.0505, 0.500, -0.50, 0.000, config); // bt = -0.1010%
  assertTest(
    'Suite 4.2 - Negative Compression Boundary',
    '-0.100% compression passes while -0.101% fails',
    compNegPass.gatesPassed.compression && !compNegFail.gatesPassed.compression,
    `-0.100%=${compNegPass.gatesPassed.compression}, -0.101%=${compNegFail.gatesPassed.compression}`
  );

  // Boundary 4.3: 5.000% vs 5.001% Anti-Collision Disparity
  const acPass = isAntiCollisionValid(102.50, 97.50, 5.000); // 5.000%
  const acFail = isAntiCollisionValid(102.5005, 97.4995, 5.000); // 5.001%
  assertTest(
    'Suite 4.3 - Anti-Collision Disparity Boundary',
    '5.000% disparity passes while 5.001% disparity fails',
    acPass === true && acFail === false,
    `5.000%=${acPass}, 5.001%=${acFail}`
  );

  // Boundary 4.4: +0.030% vs +0.031% Runway Buffer (Direction 1)
  const runD1Pass = evaluateCandidateGates(100.015, 99.985, 0.500, 0.50, 0.000, config); // bt = +0.0300%
  const runD1Fail = evaluateCandidateGates(100.0155, 99.9845, 0.500, 0.50, 0.000, config); // bt = +0.0310%
  assertTest(
    'Suite 4.4 - Direction 1 Runway Buffer Boundary',
    'Direction 1: bt=+0.030% passes while bt=+0.031% fails with AWAITING_COMPRESSION_BUFFER',
    runD1Pass.gatesPassed.runwayBuffer && !runD1Fail.gatesPassed.runwayBuffer && runD1Fail.statusReason === 'AWAITING_COMPRESSION_BUFFER',
    `+0.030%=${runD1Pass.gatesPassed.runwayBuffer}, +0.031%=${runD1Fail.gatesPassed.runwayBuffer}, Reason=${runD1Fail.statusReason}`
  );

  // Boundary 4.5: -0.030% vs -0.031% Runway Buffer (Direction 2)
  const runD2Pass = evaluateCandidateGates(99.985, 100.015, 0.500, -0.50, 0.000, config); // bt = -0.0300%
  const runD2Fail = evaluateCandidateGates(99.9845, 100.0155, 0.500, -0.50, 0.000, config); // bt = -0.0310%
  assertTest(
    'Suite 4.5 - Direction 2 Runway Buffer Boundary',
    'Direction 2: bt=-0.030% passes while bt=-0.031% fails with AWAITING_COMPRESSION_BUFFER',
    runD2Pass.gatesPassed.runwayBuffer && !runD2Fail.gatesPassed.runwayBuffer && runD2Fail.statusReason === 'AWAITING_COMPRESSION_BUFFER',
    `-0.030%=${runD2Pass.gatesPassed.runwayBuffer}, -0.031%=${runD2Fail.gatesPassed.runwayBuffer}, Reason=${runD2Fail.statusReason}`
  );

  // Boundary 4.6: -0.030% vs -0.031% Carry Feasibility
  const carryPass = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, -0.030, config);
  const carryFail = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, -0.031, config);
  assertTest(
    'Suite 4.6 - Carry Feasibility Boundary',
    'Carry -0.030% passes Gate 5 while -0.031% fails Gate 5 with REJECTED_ADVERSE_CARRY',
    carryPass.gatesPassed.carryFeasibility && !carryFail.gatesPassed.carryFeasibility && carryFail.statusReason === 'REJECTED_ADVERSE_CARRY',
    `-0.030%=${carryPass.gatesPassed.carryFeasibility}, -0.031%=${carryFail.gatesPassed.carryFeasibility}, Reason=${carryFail.statusReason}`
  );
}

// ============================================================================
// SUITE 5: NET ALPHA & GUARANTEED ZERO-LOSS HURDLE
// ============================================================================
function runSuite5() {
  console.log('\n==================================================================');
  console.log('SUITE 5: Net Alpha & Guaranteed Zero-Loss Hurdle Verification');
  console.log('==================================================================');

  const config = { ...DEFAULT_DIVERGENCE_CONFIG };
  const notional = DIVERGENCE_HARD_LIMITS.ORDER_NOTIONAL_USDT; // 15.00 USDT

  // Test 5.1: Zero carry net alpha (+0.120% edge)
  const cZero = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, 0.000, config);
  const dollarZero = notional * (cZero.netAlphaProjectedPercent / 100.0);
  assertTest(
    'Suite 5.1 - Zero Carry Dollar Profit',
    '$15.00 notional with +0.120% net alpha produces +$0.0180 USDT (>= +$0.0100 hurdle)',
    cZero.netAlphaProjectedPercent === 0.120 && Math.round(dollarZero * 10000) / 10000 === 0.0180 && dollarZero >= config.zeroLossNetHurdleUsdt,
    `NetAlpha=${cZero.netAlphaProjectedPercent}%, DollarProfit=$${dollarZero.toFixed(4)}, Hurdle=$${config.zeroLossNetHurdleUsdt}`
  );

  // Test 5.2: Worst allowable carry (-0.030%)
  const cWorst = evaluateCandidateGates(100.0, 100.0, 0.500, 0.50, -0.030, config);
  const dollarWorst = notional * (cWorst.netAlphaProjectedPercent / 100.0);
  assertTest(
    'Suite 5.2 - Worst Allowable Carry Dollar Profit',
    '$15.00 notional with -0.030% carry produces +$0.0135 USDT (>= +$0.0100 hurdle)',
    cWorst.netAlphaProjectedPercent === 0.090 && Math.round(dollarWorst * 10000) / 10000 === 0.0135 && dollarWorst >= config.zeroLossNetHurdleUsdt,
    `NetAlpha=${cWorst.netAlphaProjectedPercent}%, DollarProfit=$${dollarWorst.toFixed(4)}, Hurdle=$${config.zeroLossNetHurdleUsdt}`
  );
}

// ============================================================================
// SUITE 6: RADAR ROUTE & LIVE INGESTION INTEGRATION
// ============================================================================
async function runSuite6() {
  console.log('\n==================================================================');
  console.log('SUITE 6: Radar Route & Live Ingestion Integration Probe');
  console.log('==================================================================');

  // Test 6.1: Live Exchange Universe Scan
  resetDivergenceScannerCache();
  const scan = await executeUniverseScan();
  assertTest(
    'Suite 6.1 - Live Universe Scan Execution',
    'executeUniverseScan executes cleanly without unhandled exceptions',
    scan !== null && typeof scan.candidatesCount === 'number' && scan.candidatesCount > 0,
    `CandidatesCount=${scan?.candidatesCount}, Degraded=${scan?.degraded}, Warning=${scan?.warning || 'none'}`
  );

  // Test 6.2: GET /api/divergence/radar route handler probe
  const req = new NextRequest('http://localhost:3000/api/divergence/radar');
  const res = await GET(req);
  const data = await res.json();

  assertTest(
    'Suite 6.2 - Radar Route Response Status',
    'GET /api/divergence/radar returns HTTP 200',
    res.status === 200,
    `Status=${res.status}`
  );

  assertTest(
    'Suite 6.2 - Observability Header',
    "Response contains 'X-Degraded-Feed' header",
    res.headers.has('x-degraded-feed'),
    `X-Degraded-Feed=${res.headers.get('x-degraded-feed')}`
  );

  assertTest(
    'Suite 6.2 - Response Schema Compliance',
    'Radar response contains valid summary, candidates, and timestamp',
    data.success === true &&
    Array.isArray(data.candidates) &&
    typeof data.summary?.totalPairsScanned === 'number' &&
    typeof data.summary?.qualifyingCount === 'number',
    `Success=${data.success}, CandidatesLen=${data.candidates?.length}, TotalPairsScanned=${data.summary?.totalPairsScanned}, Qualifying=${data.summary?.qualifyingCount}`
  );
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function main() {
  console.log('==================================================================');
  console.log('STARTING EMPIRICAL CHALLENGER ADVERSARIAL STRESS SUITE: MILESTONE 2');
  console.log('==================================================================');

  runSuite1();
  runSuite2();
  runSuite3();
  runSuite4();
  runSuite5();
  await runSuite6();

  console.log('\n==================================================================');
  console.log(`STRESS TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log('==================================================================\n');

  if (failCount > 0) {
    console.error('FAILED TESTS DETAILS:');
    for (const r of results.filter(r => !r.passed)) {
      console.error(`- [${r.suite}] ${r.name}: ${r.details}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal crash in stress harness:', err);
  process.exit(1);
});
