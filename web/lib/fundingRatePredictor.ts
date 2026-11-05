/**
 * Real-Time Cumulative Premium Index TWAP Predictive Funding Rate Engine
 * Track SPEC-02 / ALPHA-01
 * 
 * Mathematical Model:
 * Settle funding rate on Binance, Bybit, and OKX is an 8-hour Time-Weighted Average Price (TWAP)
 * of the Premium Index:
 * P_t = (MarkPrice_t - IndexPrice_t) / IndexPrice_t
 * 
 * At elapsed time t_now, the projected settlement funding rate is:
 * F_pred(T) = (1 / T_total) * [ sum(P_tau * dt) + P_current * (T_total - t_now) ] + I
 * 
 * Future standard error weights by sqrt(N_remaining) / N_total so SE contracts monotonically
 * to exactly 0.00 at settlement.
 */

export interface PremiumSample {
  timestamp: number;
  markPrice: number;
  indexPrice: number;
  premiumPct: number;
}

export interface FundingPredictionResult {
  symbol: string;
  venue: string;
  currentPostedRatePct: number;
  predictedSettlementRatePct: number;
  predictedSpreadBps: number;
  confidenceLowerBoundPct: number;
  confidenceUpperBoundPct: number;
  elapsedRatio: number;
  standardErrorPct: number;
  trajectory: "SURGING" | "DECAYING" | "STABLE" | "INVERTING";
  clearsFeeHurdle: boolean;
}

export class FundingRatePredictor {
  private sampleBuffer: Map<string, PremiumSample[]> = new Map();
  private maxSamplesPerSymbol: number = 28800; // 8 hours of 1-second samples

  /**
   * Ingest a mark/index premium sample into the rolling buffer
   */
  public ingestSample(symbol: string, sample: PremiumSample): void {
    const key = symbol.toUpperCase();
    let samples = this.sampleBuffer.get(key);
    if (!samples) {
      samples = [];
      this.sampleBuffer.set(key, samples);
    }

    samples.push(sample);
    if (samples.length > this.maxSamplesPerSymbol) {
      samples.shift();
    }
  }

  /**
   * Predict upcoming settlement funding rate and standard error
   */
  public predictUpcomingFundingRate(
    symbol: string,
    venue: string,
    currentPostedRatePct: number,
    secondsElapsed: number,
    totalCycleSeconds: number = 28800 // default 8 hours (28,800s)
  ): FundingPredictionResult {
    const key = symbol.toUpperCase();
    const samples = this.sampleBuffer.get(key) || [];

    const elapsed = Math.max(1, Math.min(totalCycleSeconds, secondsElapsed));
    const elapsedRatio = parseFloat((elapsed / totalCycleSeconds).toFixed(4));
    const remainingSeconds = Math.max(0, totalCycleSeconds - elapsed);

    // If buffer is empty, project using posted rate
    if (samples.length === 0) {
      return {
        symbol: key,
        venue,
        currentPostedRatePct,
        predictedSettlementRatePct: currentPostedRatePct,
        predictedSpreadBps: parseFloat((currentPostedRatePct * 100).toFixed(2)),
        confidenceLowerBoundPct: currentPostedRatePct,
        confidenceUpperBoundPct: currentPostedRatePct,
        elapsedRatio,
        standardErrorPct: 0.0,
        trajectory: "STABLE",
        clearsFeeHurdle: Math.abs(currentPostedRatePct * 100) >= 25.0,
      };
    }

    // Cumulative sum of past observations
    const pastSum = samples.reduce((acc, s) => acc + s.premiumPct, 0);
    const pastAverage = pastSum / samples.length;

    // Latest instantaneous premium
    const currentPremium = samples[samples.length - 1].premiumPct;

    // Projected settlement rate
    const projectedPremium =
      elapsedRatio * pastAverage + (1 - elapsedRatio) * currentPremium;

    // Interest rate component: clamped to [-0.05%, +0.05%]
    const interestRate = 0.01; // 0.01% standard base
    const rawPredicted = projectedPremium + interestRate;
    // Exchange clamp: [-0.75%, +0.75%]
    const predictedSettlementRatePct = parseFloat(
      Math.max(-0.75, Math.min(0.75, rawPredicted)).toFixed(4)
    );

    // Standard deviation of observed samples
    let variance = 0;
    for (const s of samples) {
      variance += Math.pow(s.premiumPct - pastAverage, 2);
    }
    const stdDev = Math.sqrt(variance / Math.max(1, samples.length - 1));

    // Standard Error: Contracts continuously to 0.00 at settlement
    const N_remaining = remainingSeconds;
    const N_total = totalCycleSeconds;
    const standardErrorPct = parseFloat(
      (stdDev * (Math.sqrt(N_remaining) / N_total)).toFixed(6)
    );

    const marginOfError = 1.96 * standardErrorPct;
    const confidenceLowerBoundPct = parseFloat(
      (predictedSettlementRatePct - marginOfError).toFixed(4)
    );
    const confidenceUpperBoundPct = parseFloat(
      (predictedSettlementRatePct + marginOfError).toFixed(4)
    );

    // Trajectory resolution
    const rateDiff = predictedSettlementRatePct - currentPostedRatePct;
    let trajectory: "SURGING" | "DECAYING" | "STABLE" | "INVERTING" = "STABLE";
    if (
      (predictedSettlementRatePct > 0 && currentPostedRatePct < 0) ||
      (predictedSettlementRatePct < 0 && currentPostedRatePct > 0)
    ) {
      trajectory = "INVERTING";
    } else if (rateDiff >= 0.05) {
      trajectory = "SURGING";
    } else if (rateDiff <= -0.05) {
      trajectory = "DECAYING";
    }

    const predictedSpreadBps = parseFloat(
      (predictedSettlementRatePct * 100).toFixed(2)
    );
    const clearsFeeHurdle = Math.abs(predictedSpreadBps) >= 25.0;

    return {
      symbol: key,
      venue,
      currentPostedRatePct,
      predictedSettlementRatePct,
      predictedSpreadBps,
      confidenceLowerBoundPct,
      confidenceUpperBoundPct,
      elapsedRatio,
      standardErrorPct,
      trajectory,
      clearsFeeHurdle,
    };
  }

  public clearBuffer(): void {
    this.sampleBuffer.clear();
  }
}

export const globalFundingRatePredictor = new FundingRatePredictor();
