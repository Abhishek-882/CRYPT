/**
 * Precision Funding Rate Difference and Cross-Exchange Arbitrage Utility
 *
 * Implements user-defined funding rate difference rules:
 * - Opposite sign: Add magnitudes |Rate_A| + |Rate_B|
 *   Example: +0.10% and -0.25% => 0.10 + 0.25 = 0.35%
 * - Same sign: Subtract magnitudes ||Rate_A| - |Rate_B||
 *   Example: -0.15% and -0.20% => |0.15 - 0.20| = 0.05%
 *   Example: +0.06% and +0.03% => |0.06 - 0.03| = 0.03%
 */

export const ROUNDTRIP_TAKER_FEE_PCT = 0.25; // 0.25% / 25 bps standard round-trip taker commissions + Indian GST
export const ROUNDTRIP_TAKER_FEE_BPS = 25.0;
export const MIN_GROSS_SPREAD_PCT = 0.35;    // 0.35% / 35 bps minimum gross funding spread required
export const MIN_GROSS_SPREAD_BPS = 35.0;

export interface VenueRateInfo {
  venue: "binance" | "bitget" | "coindcx" | "bybit";
  label: string;
  badge: string;
  color: string;
  rate: number; // in percentage, e.g. 0.01 for 0.01%
  intervalHours?: number;
  nextFundingTime?: number;
}

export interface AsymmetricYieldResult {
  macroHorizonHours: number;      // Macro synchronization horizon H = max(I_A, I_B)
  cyclesA: number;                // N_A = H / I_A
  cyclesB: number;                // N_B = H / I_B
  nominalRateA: number;           // Raw unweighted rate R_A (%)
  nominalRateB: number;           // Raw unweighted rate R_B (%)
  grossYieldPct: number;          // |N_A * R_A - N_B * R_B| (%)
  grossYieldBps: number;          // grossYieldPct * 100 (bps)
  netYieldBps: number;            // grossYieldBps - 35.0 (bps)
  clearsFeeHurdle: boolean;       // grossYieldBps >= 35.0
  recommendedDirection: "SHORT_A_LONG_B" | "LONG_A_SHORT_B";
}

export interface EvaluateArbitrageOptions {
  allowAsymmetric?: boolean;
  intervalMode?: "ALL_ASYMMETRIC" | "STRICT_SYNC_ONLY" | "CUSTOM";
  allowedIntervalPairs?: string[];
  minGrossSpreadBps?: number;
  roundTripFeeBps?: number; // Configurable round-trip taker commissions hurdle (default: 25 bps / 0.25%)
  timingMode?: string;
}

export interface PairwiseCombination {
  pairKey: string;           // e.g. "coindcx_bybit"
  label: string;             // e.g. "CoinDCX ⇄ Bybit"
  badgeA: string;
  badgeB: string;
  venueA: "binance" | "bitget" | "coindcx" | "bybit";
  venueB: "binance" | "bitget" | "coindcx" | "bybit";
  labelA: string;
  labelB: string;
  rateA: number;
  rateB: number;
  venueAIntervalHours?: number;
  venueBIntervalHours?: number;
  venueANextFundingTime?: number;
  venueBNextFundingTime?: number;
  isFundingSynchronized?: boolean;
  syncDisqualificationReason?: string;
  isAsymmetricFunding?: boolean;
  earliestNextFundingTime?: number;
  macroNextFundingTime?: number;
  asymmetricYield?: AsymmetricYieldResult;
  macroHorizonHours?: number;
  cyclesA?: number;
  cyclesB?: number;
  nominalSpreadPct?: number;
  nominalSpreadBps?: number;
  spreadPct: number;
  spreadBps: number;
  netSpreadPct?: number;     // gross spread - round-trip taker commissions (0.25% / 25 bps)
  netSpreadBps?: number;
  clearsFeeFilter?: boolean; // spreadPct >= 0.35 && netSpreadPct > 0
  clearsFeeHurdle?: boolean; // spreadBps >= 35.0
  annualizedApr: number;
  directionLabel: string;
  direction: "SHORT_A_LONG_B" | "LONG_A_SHORT_B";
}

export interface BestArbitrageResult {
  bestPair: PairwiseCombination | null;
  allPairs: PairwiseCombination[];
  maxSpreadPct: number;
  maxSpreadBps: number;
}

/**
 * Exact directional funding rate spread calculation:
 * - Opposite signs: |Rate_A| + |Rate_B|
 * - Same sign: ||Rate_A| - |Rate_B||
 */
export function calculateDirectionalSpread(rateA: number, rateB: number): number {
  if (isNaN(rateA) || isNaN(rateB)) return 0;
  const isOpposite = (rateA > 0 && rateB < 0) || (rateA < 0 && rateB > 0);
  if (isOpposite) {
    return parseFloat((Math.abs(rateA) + Math.abs(rateB)).toFixed(5));
  } else {
    return parseFloat(Math.abs(Math.abs(rateA) - Math.abs(rateB)).toFixed(5));
  }
}

/**
 * Calculates signed directional basis in basis points between two exchange prices.
 * Positive basis means the directional trade earns positive convergence profit on price differential.
 */
export function calculateSignedBasisBps(
  priceA: number,
  priceB: number,
  direction?: "SHORT_A_LONG_B" | "LONG_A_SHORT_B" | string
): number {
  if (priceA <= 0 || priceB <= 0) return 0;
  const isShortA = !direction || direction === "SHORT_A_LONG_B" || direction.includes("SHORT_A") || direction.includes("SHORT_BINANCE");
  const basis = isShortA ? (priceA - priceB) / priceB : (priceB - priceA) / priceA;
  return parseFloat((basis * 10000).toFixed(2));
}

/**
 * Universal Vice-Versa Asymmetric Macro Funding Yield Engine
 * Computes cycle-weighted macro yield, directional dominance, and 35 bps fee hurdle.
 * For funding sniper modes (FUNDING_SNIPER_*), cycles are capped at 1 to reflect single-settlement capture.
 */
export function calculateAsymmetricMacroYield(
  rateA: number,
  intervalA?: number,
  rateB?: number,
  intervalB?: number,
  timingMode?: string
): AsymmetricYieldResult {
  const rA = isNaN(rateA) ? 0 : rateA;
  const rB = (rateB === undefined || isNaN(rateB)) ? 0 : rateB;
  const intA = (typeof intervalA === "number" && intervalA > 0 && !isNaN(intervalA)) ? intervalA : 8;
  const intB = (typeof intervalB === "number" && intervalB > 0 && !isNaN(intervalB)) ? intervalB : 8;

  const isSniper = timingMode && (timingMode.startsWith("FUNDING_SNIPER") || timingMode === "FUNDING_SNIPER_5M" || timingMode === "FUNDING_SNIPER_1M");
  const macroHorizonHours = Math.max(intA, intB);
  // For sniper modes: cap at 1 cycle — captures single settlement cash flow, eliminating 8x phantom yield inflation
  const cyclesA = isSniper ? 1 : parseFloat((macroHorizonHours / intA).toFixed(4));
  const cyclesB = isSniper ? 1 : parseFloat((macroHorizonHours / intB).toFixed(4));

  const weightedRateA = cyclesA * rA;
  const weightedRateB = cyclesB * rB;

  const grossYieldPct = parseFloat(Math.abs(weightedRateA - weightedRateB).toFixed(5));
  const grossYieldBps = parseFloat((grossYieldPct * 100).toFixed(2));
  const netYieldBps = parseFloat((grossYieldBps - MIN_GROSS_SPREAD_BPS).toFixed(2));
  const clearsFeeHurdle = grossYieldBps >= MIN_GROSS_SPREAD_BPS;

  const recommendedDirection: "SHORT_A_LONG_B" | "LONG_A_SHORT_B" =
    weightedRateA >= weightedRateB ? "SHORT_A_LONG_B" : "LONG_A_SHORT_B";

  return {
    macroHorizonHours,
    cyclesA,
    cyclesB,
    nominalRateA: rA,
    nominalRateB: rB,
    grossYieldPct,
    grossYieldBps,
    netYieldBps,
    clearsFeeHurdle,
    recommendedDirection,
  };
}

/**
 * Evaluates all pairwise combinations among available venue rates and determines the best combination.
 * Incorporates cycle-weighted macro yields across unequal funding intervals (1h, 2h, 4h, 8h)
 * and enforces Option 1 (All Asymmetric) / Option 2 (Strict Sync Only) policies.
 */
export function evaluatePairwiseArbitrage(
  venues: VenueRateInfo[],
  intervalHours: number = 8,
  options?: EvaluateArbitrageOptions
): BestArbitrageResult {
  const mode = options?.intervalMode ?? (options?.allowAsymmetric === false ? "STRICT_SYNC_ONLY" : "ALL_ASYMMETRIC");
  const isStrictSyncOnly = mode === "STRICT_SYNC_ONLY";
  const minRequiredBps = options?.minGrossSpreadBps ?? MIN_GROSS_SPREAD_BPS;
  const allPairs: PairwiseCombination[] = [];

  for (let i = 0; i < venues.length; i++) {
    for (let j = i + 1; j < venues.length; j++) {
      const vA = venues[i];
      const vB = venues[j];

      // Resolve intervals for each venue, falling back to intervalHours or default 8
      const hasAInterval = typeof vA.intervalHours === "number" && vA.intervalHours > 0;
      const hasBInterval = typeof vB.intervalHours === "number" && vB.intervalHours > 0;
      const effIntervalA = hasAInterval ? vA.intervalHours! : (intervalHours || 8);
      const effIntervalB = hasBInterval ? vB.intervalHours! : (intervalHours || 8);

      // Compute cycle-weighted macro yield & directional dominance
      const asymYield = calculateAsymmetricMacroYield(vA.rate, effIntervalA, vB.rate, effIntervalB, options?.timingMode);

      // Unweighted nominal spread for telemetry & backward-reference
      const nominalSpreadPct = calculateDirectionalSpread(vA.rate, vB.rate);
      const nominalSpreadBps = parseFloat((nominalSpreadPct * 100).toFixed(2));

      // Macro-weighted spread metrics
      const spreadPct = asymYield.grossYieldPct;
      const spreadBps = asymYield.grossYieldBps;
      const feeBps = options?.roundTripFeeBps ?? ROUNDTRIP_TAKER_FEE_BPS;
      const feePct = feeBps / 100;
      const netSpreadPct = parseFloat((spreadPct - feePct).toFixed(5));
      const netSpreadBps = parseFloat((netSpreadPct * 100).toFixed(2));
      const clearsFeeHurdle = asymYield.clearsFeeHurdle;
      const clearsFeeFilter = spreadBps >= minRequiredBps && netSpreadPct > 0;

      // Annualized APR calculated across the macro synchronization horizon
      const macroPayoutsPerDay = 24 / asymYield.macroHorizonHours;
      const apr = parseFloat((spreadPct * macroPayoutsPerDay * 365).toFixed(2));

      // Direction logic driven by cycle-weighted yield dominance
      const direction = asymYield.recommendedDirection;
      const directionLabel =
        direction === "SHORT_A_LONG_B"
          ? `Short ${vA.badge} / Long ${vB.badge}`
          : `Long ${vA.badge} / Short ${vB.badge}`;

      // Synchronization analysis
      const intervalMatch = effIntervalA === effIntervalB;
      const hasATime = typeof vA.nextFundingTime === "number" && vA.nextFundingTime > 0;
      const hasBTime = typeof vB.nextFundingTime === "number" && vB.nextFundingTime > 0;
      const hasBothTimes = hasATime && hasBTime;
      const deltaMs = hasBothTimes ? Math.abs(vA.nextFundingTime! - vB.nextFundingTime!) : 0;
      const countdownSync = (!hasATime && !hasBTime) || (hasBothTimes && deltaMs <= 60000);

      const isAsymmetric = !intervalMatch || !countdownSync;
      let isFundingSynchronized = true;
      let syncDisqualificationReason: string | undefined;

      if (isStrictSyncOnly) {
        if (!intervalMatch) {
          isFundingSynchronized = false;
          syncDisqualificationReason = `[STRICT_SYNC_REJECTED] Interval mismatch: ${vA.label} (${effIntervalA}h) !== ${vB.label} (${effIntervalB}h)`;
        } else if (!countdownSync) {
          isFundingSynchronized = false;
          syncDisqualificationReason = `[STRICT_SYNC_REJECTED] Countdown desynchronization: |${vA.label} - ${vB.label}| = ${Math.round(deltaMs / 1000)}s delta > 60s`;
        }
      } else if (mode === "CUSTOM" && options?.allowedIntervalPairs && options.allowedIntervalPairs.length > 0) {
        const pairTag1 = `${effIntervalA}h_${effIntervalB}h`.toLowerCase();
        const pairTag2 = `${effIntervalB}h_${effIntervalA}h`.toLowerCase();
        const cleanList = options.allowedIntervalPairs.map((p) => p.trim().toLowerCase());
        const allowed = intervalMatch || cleanList.includes(pairTag1) || cleanList.includes(pairTag2);
        if (!allowed) {
          isFundingSynchronized = false;
          syncDisqualificationReason = `[CUSTOM_INTERVAL_FILTER] Permutation ${effIntervalA}h ⇄ ${effIntervalB}h not in allowed list`;
        }
      }

      const earliestNextFundingTime = hasBothTimes
        ? Math.min(vA.nextFundingTime!, vB.nextFundingTime!)
        : (vA.nextFundingTime || vB.nextFundingTime);

      const macroNextFundingTime = hasBothTimes
        ? Math.max(vA.nextFundingTime!, vB.nextFundingTime!)
        : (vA.nextFundingTime || vB.nextFundingTime);

      allPairs.push({
        pairKey: `${vA.venue}_${vB.venue}`,
        label: `${vA.label} ⇄ ${vB.label}`,
        badgeA: vA.badge,
        badgeB: vB.badge,
        venueA: vA.venue,
        venueB: vB.venue,
        labelA: vA.label,
        labelB: vB.label,
        rateA: vA.rate,
        rateB: vB.rate,
        venueAIntervalHours: vA.intervalHours,
        venueBIntervalHours: vB.intervalHours,
        venueANextFundingTime: vA.nextFundingTime,
        venueBNextFundingTime: vB.nextFundingTime,
        isFundingSynchronized,
        syncDisqualificationReason,
        isAsymmetricFunding: isAsymmetric,
        earliestNextFundingTime,
        macroNextFundingTime,
        asymmetricYield: asymYield,
        macroHorizonHours: asymYield.macroHorizonHours,
        cyclesA: asymYield.cyclesA,
        cyclesB: asymYield.cyclesB,
        nominalSpreadPct,
        nominalSpreadBps,
        spreadPct,
        spreadBps,
        netSpreadPct,
        netSpreadBps,
        clearsFeeFilter,
        clearsFeeHurdle,
        annualizedApr: apr,
        directionLabel,
        direction,
      });
    }
  }

  // Prioritize pairs that are both funding synchronized AND clear the fee filter
  const validPairs = allPairs.filter((p) => p.isFundingSynchronized !== false && p.clearsFeeFilter);
  validPairs.sort((a, b) => b.spreadPct - a.spreadPct);

  // Fallback sorting: valid pairs first, then descending spread
  allPairs.sort((a, b) => {
    const aQual = a.isFundingSynchronized !== false && a.clearsFeeFilter;
    const bQual = b.isFundingSynchronized !== false && b.clearsFeeFilter;
    if (aQual && !bQual) return -1;
    if (!aQual && bQual) return 1;
    return b.spreadPct - a.spreadPct;
  });

  const bestPair = validPairs.length > 0 ? validPairs[0] : (allPairs.length > 0 ? allPairs[0] : null);

  return {
    bestPair,
    allPairs,
    maxSpreadPct: bestPair ? bestPair.spreadPct : 0,
    maxSpreadBps: bestPair ? bestPair.spreadBps : 0,
  };
}

/**
 * Calculates a slippage-bounded limit price for order execution or close.
 * Enforces the rule that slippage must not consume more than 20% of the gross funding profit.
 */
export function calculateSlippageBoundedLimit(
  side: "BUY" | "SELL" | "Buy" | "Sell",
  markPrice: number,
  grossSpreadBps: number = 30
): { limitPrice: number; maxSlippageBps: number } {
  if (!markPrice || markPrice <= 0) {
    return { limitPrice: markPrice || 0, maxSlippageBps: 15 };
  }
  // Bounded between 5 bps (minimum buffer) and 25 bps (maximum cap), or 20% of the funding spread
  const maxSlippageBps = Math.min(25, Math.max(5, Math.round(grossSpreadBps * 0.20)));
  const slippageFraction = maxSlippageBps / 10000;

  const isBuy = side.toUpperCase() === "BUY";
  const rawLimit = isBuy
    ? markPrice * (1 + slippageFraction)
    : markPrice * (1 - slippageFraction);

  // Preserve up to 8 decimal places or 4 significant digits
  const precision = markPrice > 10 ? 2 : (markPrice > 0.01 ? 4 : 6);
  const factor = Math.pow(10, precision);
  const limitPrice = Math.round(rawLimit * factor) / factor;

  return { limitPrice, maxSlippageBps };
}

/**
 * Calculates net expected funding yield percentage for an active dual-leg hedge.
 * Evaluates whether rate sign flips or spread inversions cause adverse funding debit.
 */
export function calculateHedgeFundingYield(
  direction: string,
  venueARate: number,
  venueBRate: number
): {
  expectedYieldPct: number;
  expectedYieldBps: number;
  isInverted: boolean;
  isNegativeYield: boolean;
} {
  const upperDir = (direction || "").toUpperCase();
  const isShortA =
    upperDir.includes("SHORT_A") ||
    upperDir.includes("SHORT_BINANCE") ||
    upperDir.includes("SHORT_COINDCX") ||
    upperDir.startsWith("SHORT");

  const leg1Yield = isShortA ? venueARate : -venueARate;
  const leg2Yield = isShortA ? -venueBRate : venueBRate;

  const expectedYieldPct = parseFloat((leg1Yield + leg2Yield).toFixed(5));
  const expectedYieldBps = parseFloat((expectedYieldPct * 100).toFixed(2));
  const isNegativeYield = expectedYieldPct < 0;
  const isInverted = expectedYieldPct < -0.05;

  return {
    expectedYieldPct,
    expectedYieldBps,
    isInverted,
    isNegativeYield,
  };
}

