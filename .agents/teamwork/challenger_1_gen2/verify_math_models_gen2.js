/**
 * EMPIRICAL & MATHEMATICAL CHALLENGER RE-VERIFICATION HARNESS (GEN 2)
 * File: .agents/teamwork/challenger_1_gen2/verify_math_models_gen2.js
 * Author: Challenger 1 (Gen 2) (teamwork_challenger)
 * 
 * Deep stress-testing, boundary analysis, and Monte Carlo oracles for:
 * 1. TWAP standard error & confidence interval convergence
 * 2. Fractional Kelly sizing hurdle guard, unit parity & scaling dynamics
 * 3. Volatility-adjusted dynamic leverage empirical evaluation across market tiers
 * 4. Exit utility directional basis formulation & convergence economics
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. TWAP SE & CONFIDENCE INTERVAL RE-VERIFICATION & MONTE CARLO ORACLE
// ============================================================================
function computeTwapSe(sigmaP, nRemaining, nTotal) {
  if (nTotal <= 0) throw new Error("nTotal must be positive");
  if (nRemaining < 0) throw new Error("nRemaining cannot be negative");
  if (nRemaining > nTotal) throw new Error("nRemaining cannot exceed nTotal");
  return (sigmaP * Math.sqrt(nRemaining)) / nTotal;
}

function computeTwapCi(predSettlementRate, se, z = 1.96) {
  return {
    lower: predSettlementRate - z * se,
    upper: predSettlementRate + z * se,
    halfWidth: z * se
  };
}

function runTwapSuite() {
  console.log("\n================================================================================");
  console.log("   SUITE 1: TWAP SE CONVERGENCE & MONTE CARLO ORACLE");
  console.log("================================================================================");
  const results = [];
  const nTotal = 28800; // 8 hours * 3600 seconds
  const sigmaP = 0.0005; // 5 bps standard deviation
  const predRate = 0.0004; // 4 bps projected rate

  // Test 1.1: Boundary condition at settlement (nRemaining = 0)
  const seAtSettlement = computeTwapSe(sigmaP, 0, nTotal);
  const ciAtSettlement = computeTwapCi(predRate, seAtSettlement);
  const pass1_1 = seAtSettlement === 0.0 && ciAtSettlement.lower === predRate && ciAtSettlement.upper === predRate;
  console.log(`[TWAP 1.1] Settlement Boundary (nRem = 0):`);
  console.log(`  SE = ${seAtSettlement}, CI Half-width = ${ciAtSettlement.halfWidth}`);
  console.log(`  Pass: ${pass1_1} (Strictly zero uncertainty at settlement, no division by zero)`);
  results.push({ name: "TWAP SE exact zero at settlement", pass: pass1_1 });

  // Test 1.2: Strict Monotonicity test across countdown
  let isMonotonic = true;
  let prevSe = Infinity;
  for (let rem = nTotal; rem >= 0; rem -= 100) {
    const currentSe = computeTwapSe(sigmaP, rem, nTotal);
    if (currentSe > prevSe) {
      isMonotonic = false;
      break;
    }
    prevSe = currentSe;
  }
  console.log(`[TWAP 1.2] Monotonic Uncertainty Contraction:`);
  console.log(`  Contraction from t=0 (SE=${computeTwapSe(sigmaP, nTotal, nTotal).toExponential(4)}) to t=T (SE=0): ${isMonotonic}`);
  results.push({ name: "TWAP SE strictly monotonic contraction", pass: isMonotonic });

  // Test 1.3: Monte Carlo Oracle Validation
  // Simulate 5,000 independent paths of premium index with known sigma_P
  // Compare empirical standard error of the resulting TWAP with the formula prediction
  const numSims = 5000;
  const nPast = 21600; // 6 hours past (75% elapsed)
  const nRem = nTotal - nPast; // 7,200 remaining (2 hours)
  const pastSum = 0.0004 * nPast; // deterministic past sum

  const simulatedTwaps = [];
  for (let s = 0; s < numSims; s++) {
    // Generate sum of nRem independent random increments with mean 0.0004 and std sigmaP
    // Using Central Limit Theorem approximation for speed: sum of nRem variables has mean nRem*mu, std sqrt(nRem)*sigmaP
    const normalRandom = (Math.random() + Math.random() + Math.random() + Math.random() + Math.random() + Math.random() - 3.0) * Math.sqrt(2.0);
    const futureSum = nRem * 0.0004 + normalRandom * Math.sqrt(nRem) * sigmaP;
    const finalTwap = (pastSum + futureSum) / nTotal;
    simulatedTwaps.push(finalTwap);
  }

  // Calculate empirical sample standard deviation of simulated TWAPs
  const meanTwap = simulatedTwaps.reduce((a, b) => a + b, 0) / numSims;
  const varTwap = simulatedTwaps.reduce((a, b) => a + Math.pow(b - meanTwap, 2), 0) / (numSims - 1);
  const empiricalSe = Math.sqrt(varTwap);
  const theoreticalSe = computeTwapSe(sigmaP, nRem, nTotal);
  const relativeSeError = Math.abs(empiricalSe - theoreticalSe) / theoreticalSe;

  console.log(`[TWAP 1.3] Monte Carlo Oracle (5,000 simulations @ 75% elapsed):`);
  console.log(`  Theoretical Formula SE: ${theoreticalSe.toExponential(5)}`);
  console.log(`  Empirical Monte Carlo SE: ${empiricalSe.toExponential(5)}`);
  console.log(`  Relative Error: ${(relativeSeError * 100).toFixed(2)}% (Expected < 5%)`);
  const pass1_3 = relativeSeError < 0.05;
  results.push({ name: "TWAP SE matches Monte Carlo empirical oracle within 5%", pass: pass1_3 });

  return results;
}

// ============================================================================
// 2. FRACTIONAL KELLY SIZING RE-VERIFICATION & UNIT PARITY HARNESS
// ============================================================================
function evaluateKellyAllocation(mu, variance, hurdle = 0.0, lambda = 0.25, minClamp = 0.10, maxClamp = 0.35) {
  if (variance <= 0 || isNaN(variance) || isNaN(mu)) {
    return { allocation: 0.0, reason: "INVALID_VARIANCE_OR_INPUT" };
  }
  if (mu <= hurdle) {
    return { allocation: 0.0, rawKelly: (lambda * mu) / variance, reason: "HURDLE_NOT_CLEARED" };
  }
  const rawKelly = (lambda * mu) / variance;
  const clampedKelly = Math.max(minClamp, Math.min(maxClamp, rawKelly));
  return { allocation: clampedKelly, rawKelly, reason: "ACTIVE_ALLOCATION" };
}

function runKellySuite() {
  console.log("\n================================================================================");
  console.log("   SUITE 2: FRACTIONAL KELLY HURDLE GATE & UNIT PARITY STRESS");
  console.log("================================================================================");
  const results = [];

  // Test 2.1: Negative Net Spread
  const negSpread = evaluateKellyAllocation(-5.0, 400, 0.0);
  console.log(`[KELLY 2.1] Negative Spread (mu = -5 bps):`);
  console.log(`  Allocation: ${negSpread.allocation} (${negSpread.reason})`);
  results.push({ name: "Negative spread strictly receives 0.00 allocation", pass: negSpread.allocation === 0.0 });

  // Test 2.2: Below-Hurdle Spread
  const belowHurdle = evaluateKellyAllocation(8.0, 400, 10.0); // 8 bps spread against 10 bps fee hurdle
  console.log(`[KELLY 2.2] Below Hurdle Spread (mu = 8 bps, hurdle = 10 bps):`);
  console.log(`  Allocation: ${belowHurdle.allocation} (${belowHurdle.reason})`);
  results.push({ name: "Sub-hurdle spread strictly receives 0.00 allocation", pass: belowHurdle.allocation === 0.0 });

  // Test 2.3: Zero Variance Guard
  const zeroVar = evaluateKellyAllocation(35.0, 0.0, 0.0);
  console.log(`[KELLY 2.3] Zero Variance Defense:`);
  console.log(`  Allocation: ${zeroVar.allocation} (${zeroVar.reason})`);
  results.push({ name: "Zero variance handled cleanly with 0.00 allocation", pass: zeroVar.allocation === 0.0 });

  // Test 2.4: Unit Scaling Sensitivity Analysis (bps vs decimal domain)
  // Let spread = 35 bps (0.0035 decimal) and basis std = 20 bps (0.0020 decimal -> var = 0.000004)
  const kellyBps = evaluateKellyAllocation(35, 400, 0.0);
  const kellyDec = evaluateKellyAllocation(0.0035, 0.000004, 0.0);
  console.log(`[KELLY 2.4] Unit Domain Scaling Analysis:`);
  console.log(`  bps domain: mu=35, var=400 -> Raw Kelly = ${kellyBps.rawKelly.toFixed(4)}, Clamped = ${kellyBps.allocation}`);
  console.log(`  decimal domain: mu=0.0035, var=4e-6 -> Raw Kelly = ${kellyDec.rawKelly.toFixed(2)}, Clamped = ${kellyDec.allocation}`);
  console.log(`  Scaling ratio between decimal and bps raw Kelly: ${(kellyDec.rawKelly / kellyBps.rawKelly).toFixed(0)}x (10,000x!)`);
  // Note: in bps domain, rawKelly = 0.0219 (clamped to 0.10). In decimal domain, rawKelly = 218.75 (clamped to 0.35).
  // Both are clamped within [0.10, 0.35], but unit domain determines whether allocation hits floor or ceiling!
  results.push({ name: "Unit domain sensitivity documented and clamped safely", pass: kellyBps.allocation === 0.10 && kellyDec.allocation === 0.35 });

  return results;
}

// ============================================================================
// 3. VOLATILITY-ADJUSTED DYNAMIC LEVERAGE EVALUATION ACROSS TIERS
// ============================================================================
function evaluateSpecLeverage(tierBufferPct, atr1hPct, maxExchangeLev = 50, minLev = 3) {
  if (!atr1hPct || isNaN(atr1hPct) || atr1hPct <= 0) return minLev;
  const clampedAtr = Math.max(0.20, atr1hPct);
  const rawLev = Math.floor(tierBufferPct / clampedAtr);
  return Math.max(minLev, Math.min(maxExchangeLev, rawLev));
}

function evaluateCorrectedLeverage(tierBufferPct, atr1hPct, maxExchangeLev = 50, minLev = 3) {
  // Correct mathematical formulation where leverage L = 100% / LiquidationDistanceBuffer
  // If tierBufferPct is the liquidation distance buffer in percent (e.g. 1.6% for BTC, 3.0% for Large Caps, 5.0% for Alts):
  // Or if leverage scales inversely with ATR: L = floor(TierConstant / ATR)
  // Let's test the inverse formulation: L = floor(100 / (BufferMultiplier * ATR))
  // Or: TierConstant / ATR where TierConstant = 20 for Tier 1, etc.
  if (!atr1hPct || isNaN(atr1hPct) || atr1hPct <= 0) return minLev;
  const clampedAtr = Math.max(0.20, atr1hPct);
  // If Tier 1 buffer is 1.6% liquidation distance, then max leverage at buffer is floor(100 / 1.6) = 62x -> clamped to 50x
  // Under typical ATR 0.40%, requiring 4x ATR buffer gives buffer = 1.6% -> 100 / 1.6% = 62x (50x).
  return Math.max(minLev, Math.min(maxExchangeLev, Math.floor(100 / (tierBufferPct * (clampedAtr / 0.40)))));
}

function runLeverageSuite() {
  console.log("\n================================================================================");
  console.log("   SUITE 3: VOLATILITY-ADJUSTED DYNAMIC LEVERAGE EMPIRICAL AUDIT");
  console.log("================================================================================");
  const results = [];

  // Audit Tier 1: BTC/ETH (Spec says TierBuffer = 1.6%, resolves to 25x-50x under ATR 0.30% - 0.60%)
  const btcAtrPoints = [0.30, 0.40, 0.50, 0.60];
  console.log(`[LEV 3.1] Spec Formula Audit on Tier 1 (BTC/ETH, TierBuffer = 1.6%):`);
  let allBtcBelow8 = true;
  for (let atr of btcAtrPoints) {
    const lev = evaluateSpecLeverage(1.6, atr, 50, 3);
    console.log(`  ATR = ${atr.toFixed(2)}% -> Formula L_dyn = floor(1.6 / ${atr.toFixed(2)}) = ${lev}x (Claimed: 25x-50x)`);
    if (lev > 8) allBtcBelow8 = false;
  }
  console.log(`  EMPIRICAL FINDING: Spec formula floor(1.6 / ATR) yields strictly 3x to 5x across all typical ATRs!`);
  console.log(`  It CANNOT exceed 8x even at the minimum clamp floor of 0.20% ATR.`);
  results.push({ name: "Empirically proved formula floor(1.6/ATR) yields 3x-5x, not 25x-50x", pass: allBtcBelow8 });

  // Audit Tier 2: Large Caps (Spec says TierBuffer = 3.0%, resolves to 15x-25x under ATR 0.80% - 1.50%)
  const largeCapAtrPoints = [0.80, 1.00, 1.20, 1.50];
  console.log(`[LEV 3.2] Spec Formula Audit on Tier 2 (SOL/BNB, TierBuffer = 3.0%):`);
  for (let atr of largeCapAtrPoints) {
    const lev = evaluateSpecLeverage(3.0, atr, 50, 3);
    console.log(`  ATR = ${atr.toFixed(2)}% -> Formula L_dyn = floor(3.0 / ${atr.toFixed(2)}) = ${lev}x (Claimed: 15x-25x)`);
  }

  // Audit Tier 3: Altcoins (Spec says TierBuffer = 5.0%, resolves to 3x-10x under ATR 2.0% - 4.0%)
  const altAtrPoints = [2.00, 3.00, 4.00];
  console.log(`[LEV 3.3] Spec Formula Audit on Tier 3 (Alts, TierBuffer = 5.0%):`);
  for (let atr of altAtrPoints) {
    const lev = evaluateSpecLeverage(5.0, atr, 50, 3);
    console.log(`  ATR = ${atr.toFixed(2)}% -> Formula L_dyn = floor(5.0 / ${atr.toFixed(2)}) = ${lev}x (Claimed: 3x-10x)`);
  }

  // Test 3.4: Defensive Fallback on <14 candles or NaN
  const fallbackNaN = evaluateSpecLeverage(1.6, NaN, 50, 3);
  const fallbackZero = evaluateSpecLeverage(1.6, 0.0, 50, 3);
  console.log(`[LEV 3.4] Defensive Fallback on Invalid ATR:`);
  console.log(`  NaN ATR: ${fallbackNaN}x | Zero ATR: ${fallbackZero}x`);
  results.push({ name: "Defensive fallback correctly limits to minLeverage (3x)", pass: fallbackNaN === 3 && fallbackZero === 3 });

  return results;
}

// ============================================================================
// 4. EXIT UTILITY DIRECTIONAL BASIS HARNESS
// ============================================================================
function computeExitUtility(harvestedFundingUsd, entryBasisBps, currentBasisBps, notionalUsd, estExitFeesUsd, isLongA, opportunityCostUsd = 0.0) {
  const sideLegA = isLongA ? 1.0 : -1.0;
  const basisChangeBps = currentBasisBps - entryBasisBps;
  const basisPnlBps = sideLegA * basisChangeBps;
  const basisPnlUsd = (basisPnlBps / 10000.0) * notionalUsd;
  const netExitUtilityUsd = harvestedFundingUsd + basisPnlUsd - estExitFeesUsd - opportunityCostUsd;
  return {
    basisPnlBps,
    basisPnlUsd,
    netExitUtilityUsd,
    shouldExit: netExitUtilityUsd > 0.0
  };
}

function runExitUtilitySuite() {
  console.log("\n================================================================================");
  console.log("   SUITE 4: EXIT UTILITY DIRECTIONAL BASIS & CONVERGENCE ECONOMICS");
  console.log("================================================================================");
  const results = [];
  const notional = 1000.0;
  const fundingHarvested = 4.50; // $4.50 funding earned
  const exitFees = 0.80; // $0.80 exit fees

  // Case 4.1: Long A, Short B with favorable convergence (-30 bps -> -5 bps)
  const u1 = computeExitUtility(fundingHarvested, -30.0, -5.0, notional, exitFees, true);
  console.log(`[EXIT 4.1] Long A / Short B Convergence (-30 bps -> -5 bps):`);
  console.log(`  Basis PnL: +${u1.basisPnlBps} bps ($${u1.basisPnlUsd.toFixed(2)})`);
  console.log(`  Net Utility: $${u1.netExitUtilityUsd.toFixed(2)} (Should Exit: ${u1.shouldExit})`);
  results.push({ name: "Favorable basis convergence generates positive basis PnL", pass: u1.basisPnlUsd === 2.50 && u1.netExitUtilityUsd === 6.20 });

  // Case 4.2: Short A, Long B with favorable convergence (+30 bps -> +5 bps)
  const u2 = computeExitUtility(fundingHarvested, +30.0, +5.0, notional, exitFees, false);
  console.log(`[EXIT 4.2] Short A / Long B Convergence (+30 bps -> +5 bps):`);
  console.log(`  Basis PnL: +${u2.basisPnlBps} bps ($${u2.basisPnlUsd.toFixed(2)})`);
  console.log(`  Net Utility: $${u2.netExitUtilityUsd.toFixed(2)} (Should Exit: ${u2.shouldExit})`);
  results.push({ name: "Short A favorable basis convergence generates positive basis PnL", pass: u2.basisPnlUsd === 2.50 && u2.netExitUtilityUsd === 6.20 });

  // Case 4.3: Adverse Divergence (-30 bps -> -60 bps)
  const u3 = computeExitUtility(fundingHarvested, -30.0, -60.0, notional, exitFees, true);
  console.log(`[EXIT 4.3] Adverse Divergence Widening (-30 bps -> -60 bps):`);
  console.log(`  Basis PnL: ${u3.basisPnlBps} bps ($${u3.basisPnlUsd.toFixed(2)})`);
  console.log(`  Net Utility: $${u3.netExitUtilityUsd.toFixed(2)} (Should Exit: ${u3.shouldExit})`);
  results.push({ name: "Adverse divergence penalizes exit utility", pass: u3.basisPnlUsd === -3.00 && u3.netExitUtilityUsd === 0.70 });

  return results;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
function runAllGen2Verifications() {
  console.log("================================================================================");
  console.log("   AI_HEDGE_COCKPIT: MATHEMATICAL CHALLENGER (GEN 2) RE-VERIFICATION SUITE     ");
  console.log("================================================================================");

  const t1 = runTwapSuite();
  const t2 = runKellySuite();
  const t3 = runLeverageSuite();
  const t4 = runExitUtilitySuite();

  const allTests = [...t1, ...t2, ...t3, ...t4];
  const passed = allTests.filter(t => t.pass).length;
  const total = allTests.length;

  console.log("\n================================================================================");
  console.log(`   GEN 2 EMPIRICAL SUMMARY: ${passed} / ${total} TESTS PASSED (${((passed / total) * 100).toFixed(1)}%)`);
  console.log("================================================================================");

  return { passed, total, allTests };
}

runAllGen2Verifications();
