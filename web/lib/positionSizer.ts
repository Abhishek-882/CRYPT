/**
 * Fractional Kelly Position Sizer & Dynamic Capital Allocator
 * Institutional Capital Allocation Engine for Delta-Neutral Arbitrage
 *
 * Implements:
 * 1. Hurdle-Gated Quarter-Kelly:
 *    f* = clamp(lambda_Kelly * (mu_net / sigma^2_basis), 0.10, 0.35) if mu_net > hurdle else 0.0
 * 2. Strict Unit Parity between expected spread (bps) and basis variance (bps^2)
 * 3. Asymmetric Margin Balancer: L_A / L_B = FreeMargin_B / FreeMargin_A (max ratio 3.0)
 * 4. Liquidation Buffer and Notional Parity Enforcer
 */

import { calculateDynamicLeverage } from "./leverageManager";

export interface DynamicAllocationParams {
  corridor: string;
  symbol: string;
  venueAFreeBalance: number;
  venueBFreeBalance: number;
  expectedNetSpreadBps: number;
  basisVariance: number; // In bps^2 (e.g. if std dev is 20 bps, variance is 400)
  atr1hPct?: number; // In percent, e.g. 1.5 for 1.5%
  maxExchangeLeverageA?: number;
  maxExchangeLeverageB?: number;
  totalPortfolioNav: number;
  minHurdleBps?: number; // Default: 0.0 bps
  fractionalMultiplier?: number; // Default: 0.25 (Quarter-Kelly)
}

export interface DynamicAllocationResult {
  allocatedMarginTotal: number;
  allocatedMarginA: number;
  allocatedMarginB: number;
  leverageA: number;
  leverageB: number;
  matchedNotionalUsd: number;
  liquidationBufferPctA: number;
  liquidationBufferPctB: number;
  kellyFraction: number;
  hurdleCleared: boolean;
  reason?: string;
}

export class PositionSizer {
  /**
   * Computes Hurdle-Gated Fractional Kelly Fraction
   *
   * @param muNetSpreadBps Net expected spread in basis points (gross spread minus dynamic fees)
   * @param basisVarianceBpsSq Variance of the basis in (basis points)^2
   * @param lambda Fractional Kelly multiplier (default: 0.25 for Quarter-Kelly)
   * @param minHurdleBps Minimum net spread hurdle (default: 0.0 bps)
   * @returns Optimal allocation fraction f* in [0.0, 0.35]
   */
  public static calculateKellyFraction(
    muNetSpreadBps: number,
    basisVarianceBpsSq: number,
    lambda: number = 0.25,
    minHurdleBps: number = 0.0
  ): { fraction: number; hurdleCleared: boolean; reason: string } {
    // 1. Explicit Hurdle Check: If expected net spread does not exceed hurdle, do NOT trade
    if (muNetSpreadBps <= minHurdleBps) {
      return {
        fraction: 0.0,
        hurdleCleared: false,
        reason: `HURDLE_REJECTED: Net spread (${muNetSpreadBps.toFixed(2)} bps) <= hurdle (${minHurdleBps.toFixed(2)} bps)`,
      };
    }

    // 2. Variance Guard: Variance must be strictly positive and finite
    if (
      !isFinite(basisVarianceBpsSq) ||
      basisVarianceBpsSq <= 0 ||
      isNaN(basisVarianceBpsSq)
    ) {
      return {
        fraction: 0.0,
        hurdleCleared: false,
        reason: `INVALID_VARIANCE: Basis variance (${basisVarianceBpsSq}) <= 0 or invalid`,
      };
    }

    // 3. Raw Kelly Fraction computation with strict unit parity
    // mu in bps, sigma^2 in bps^2 -> mu / sigma^2
    const rawKelly = muNetSpreadBps / basisVarianceBpsSq;
    const fractionalKelly = lambda * rawKelly;

    // 4. Institutional Clamping: Clamp between 10% (0.10) and 35% (0.35)
    // Ensures meaningful position size while bounding single-trade risk
    const clamped = Math.max(0.1, Math.min(0.35, fractionalKelly));

    return {
      fraction: clamped,
      hurdleCleared: true,
      reason: `KELLY_OPTIMIZED: Raw=${rawKelly.toFixed(4)}, Frac=${fractionalKelly.toFixed(4)}, Clamped=${clamped.toFixed(4)}`,
    };
  }

  /**
   * Calculate asymmetric margin allocation and matched notional
   * Solves:
   *   Margin_A * Lev_A = Margin_B * Lev_B = MatchedNotional
   *   Margin_A + Margin_B <= TargetMargin
   *   Margin_A <= Free_A, Margin_B <= Free_B
   */
  public static calculateDynamicAllocation(
    params: DynamicAllocationParams
  ): DynamicAllocationResult {
    const {
      corridor,
      symbol,
      venueAFreeBalance,
      venueBFreeBalance,
      expectedNetSpreadBps,
      basisVariance,
      atr1hPct,
      maxExchangeLeverageA = 50,
      maxExchangeLeverageB = 50,
      totalPortfolioNav,
      minHurdleBps = 0.0,
      fractionalMultiplier = 0.25,
    } = params;

    // Step 1: Compute Kelly Fraction
    const kelly = this.calculateKellyFraction(
      expectedNetSpreadBps,
      basisVariance,
      fractionalMultiplier,
      minHurdleBps
    );

    if (!kelly.hurdleCleared || kelly.fraction <= 0) {
      return {
        allocatedMarginTotal: 0,
        allocatedMarginA: 0,
        allocatedMarginB: 0,
        leverageA: 1,
        leverageB: 1,
        matchedNotionalUsd: 0,
        liquidationBufferPctA: 100,
        liquidationBufferPctB: 100,
        kellyFraction: 0,
        hurdleCleared: false,
        reason: kelly.reason,
      };
    }

    // Step 2: Determine Base Dynamic Leverages via Volatility-Adjusted Engine
    const parts = corridor.split("_");
    const venueA = parts[0] || "Binance";
    const venueB = parts[1] || "Bybit";

    let levA = calculateDynamicLeverage(symbol, venueA, atr1hPct, 24, maxExchangeLeverageA);
    let levB = calculateDynamicLeverage(symbol, venueB, atr1hPct, 24, maxExchangeLeverageB);

    // Step 3: Asymmetric Balancing based on Free Balances
    // If one venue has significantly less free margin, scale up leverage on that venue
    // up to a 3.0 ratio to avoid idling capital on the richer venue
    const safeFreeA = Math.max(1, venueAFreeBalance);
    const safeFreeB = Math.max(1, venueBFreeBalance);

    if (safeFreeA > 0 && safeFreeB > 0) {
      const balanceRatio = safeFreeB / safeFreeA; // e.g. FreeB = $20, FreeA = $10 -> ratio = 2.0
      if (balanceRatio > 1.25) {
        // Venue A has less free balance, can boost LevA relative to LevB
        const maxBoost = Math.min(3.0, balanceRatio);
        levA = Math.min(maxExchangeLeverageA, Math.round(levB * maxBoost));
      } else if (balanceRatio < 0.8) {
        // Venue B has less free balance, can boost LevB relative to LevA
        const maxBoost = Math.min(3.0, 1.0 / balanceRatio);
        levB = Math.min(maxExchangeLeverageB, Math.round(levA * maxBoost));
      }
    }

    // Ensure leverages are at least 1 and within max limits
    levA = Math.max(1, Math.min(maxExchangeLeverageA, levA));
    levB = Math.max(1, Math.min(maxExchangeLeverageB, levB));

    // Step 4: Budget Sizing from Portfolio NAV and Venue Free Balances
    const navBudget = totalPortfolioNav * kelly.fraction;
    // Bounded by available free margins on both sides
    // Sum of margins cannot exceed total available free balance
    const combinedFree = safeFreeA + safeFreeB;
    const targetBudget = Math.min(navBudget, combinedFree * 0.8); // 80% max utilization

    // Auto-split target budget:
    // Margin_A = C * Lev_B / (Lev_A + Lev_B)
    // Margin_B = C * Lev_A / (Lev_A + Lev_B)
    const sumLev = levA + levB;
    let marginA = targetBudget * (levB / sumLev);
    let marginB = targetBudget * (levA / sumLev);

    // Step 5: Enforce strict per-venue free balance caps
    // If marginA > safeFreeA * 0.85, clamp and recalculate marginB for equal notional
    if (marginA > safeFreeA * 0.85) {
      marginA = safeFreeA * 0.85;
      const notionalA = marginA * levA;
      marginB = notionalA / levB;
    }
    if (marginB > safeFreeB * 0.85) {
      marginB = safeFreeB * 0.85;
      const notionalB = marginB * levB;
      marginA = notionalB / levA;
    }

    // Step 6: Compute Matched Notional and Liquidation Buffers
    const matchedNotionalUsd = Math.min(marginA * levA, marginB * levB);
    const totalAllocatedMargin = marginA + marginB;

    // Liquidation buffer ~ (1 / Leverage) * 100% minus 0.5% maintenance margin
    const liqBufferA = Math.max(0.1, (1.0 / levA - 0.005) * 100);
    const liqBufferB = Math.max(0.1, (1.0 / levB - 0.005) * 100);

    return {
      allocatedMarginTotal: parseFloat(totalAllocatedMargin.toFixed(4)),
      allocatedMarginA: parseFloat(marginA.toFixed(4)),
      allocatedMarginB: parseFloat(marginB.toFixed(4)),
      leverageA: levA,
      leverageB: levB,
      matchedNotionalUsd: parseFloat(matchedNotionalUsd.toFixed(2)),
      liquidationBufferPctA: parseFloat(liqBufferA.toFixed(2)),
      liquidationBufferPctB: parseFloat(liqBufferB.toFixed(2)),
      kellyFraction: parseFloat(kelly.fraction.toFixed(4)),
      hurdleCleared: true,
      reason: kelly.reason,
    };
  }
}

export function calculateDynamicAllocation(
  params: DynamicAllocationParams
): DynamicAllocationResult {
  return PositionSizer.calculateDynamicAllocation(params);
}
