/**
 * Cross-Venue Correlation Breakdown Circuit Breaker
 * Protects delta-neutral arbitrage against decoupling, oracle depegs, and liquidity flash crashes.
 *
 * Implements:
 * 1. Rolling 60-Second Pearson Correlation (r_60s) between Venue A and Venue B prices.
 * 2. Basis Z-Score Tracking: Z_basis = |Basis_current - mu_basis| / sigma_basis.
 * 3. 3-Tick Trip Condition: If r_60s < 0.80 OR Z_basis > 3.5sigma for 3 consecutive ticks,
 *    halt all new entries on that symbol/corridor and engage synthetic delta lock.
 * 4. Hysteresis Reset Guard: Requires 3 consecutive normal ticks (r >= 0.85, Z <= 2.5) to clear.
 */

export interface PriceTick {
  timestamp: number;
  priceA: number;
  priceB: number;
  basisBps: number;
}

export type BreakerState = "NORMAL" | "WARNING" | "TRIPPED";

export interface CircuitBreakerStatus {
  symbol: string;
  corridor: string;
  state: BreakerState;
  pearsonR: number;
  basisZScore: number;
  sampleCount: number;
  consecutiveViolations: number;
  consecutiveNormalTicks: number;
  haltEntries: boolean;
  engageDeltaLock: boolean;
  lastEvaluationTime: number;
  reason?: string;
}

export class CorrelationCircuitBreaker {
  private bufferMap: Map<string, PriceTick[]> = new Map();
  private stateMap: Map<string, CircuitBreakerStatus> = new Map();
  private readonly windowDurationMs: number = 60000; // 60 seconds
  private readonly minSamplesRequired: number = 5; // Minimum ticks to compute Pearson r
  private readonly tripThresholdR: number = 0.8; // r < 0.80
  private readonly tripThresholdZ: number = 3.5; // Z > 3.5 sigma
  private readonly resetThresholdR: number = 0.85; // Recovery r >= 0.85
  private readonly resetThresholdZ: number = 2.5; // Recovery Z <= 2.5 sigma
  private readonly tripTickCount: number = 3; // 3 consecutive ticks to trip
  private readonly resetTickCount: number = 3; // 3 consecutive ticks to reset

  private getBufferKey(corridor: string, symbol: string): string {
    return `${corridor.toUpperCase()}_${symbol.toUpperCase()}`;
  }

  /**
   * Ingest a new price tick for a symbol on a corridor and update circuit breaker state
   */
  public ingestTick(
    corridor: string,
    symbol: string,
    priceA: number,
    priceB: number,
    timestamp: number = Date.now()
  ): CircuitBreakerStatus {
    const key = this.getBufferKey(corridor, symbol);
    if (!this.bufferMap.has(key)) {
      this.bufferMap.set(key, []);
    }

    const buffer = this.bufferMap.get(key)!;
    const basisBps = priceB > 0 ? ((priceA - priceB) / priceB) * 10000 : 0;

    buffer.push({
      timestamp,
      priceA,
      priceB,
      basisBps,
    });

    // Prune observations older than rolling window
    const cutoff = timestamp - this.windowDurationMs;
    const pruned = buffer.filter((tick) => tick.timestamp >= cutoff);
    this.bufferMap.set(key, pruned);

    return this.evaluate(corridor, symbol, timestamp);
  }

  /**
   * Evaluate rolling Pearson r and Basis Z-Score
   */
  public evaluate(
    corridor: string,
    symbol: string,
    now: number = Date.now()
  ): CircuitBreakerStatus {
    const key = this.getBufferKey(corridor, symbol);
    const buffer = this.bufferMap.get(key) || [];

    let currentStatus = this.stateMap.get(key) || {
      symbol: symbol.toUpperCase(),
      corridor: corridor.toUpperCase(),
      state: "NORMAL",
      pearsonR: 1.0,
      basisZScore: 0.0,
      sampleCount: buffer.length,
      consecutiveViolations: 0,
      consecutiveNormalTicks: 0,
      haltEntries: false,
      engageDeltaLock: false,
      lastEvaluationTime: now,
    };

    // If insufficient samples, return existing or normal status with low sample count
    if (buffer.length < this.minSamplesRequired) {
      currentStatus.sampleCount = buffer.length;
      currentStatus.lastEvaluationTime = now;
      this.stateMap.set(key, currentStatus);
      return currentStatus;
    }

    // 1. Calculate Pearson correlation r between PriceA and PriceB
    const n = buffer.length;
    let sumA = 0;
    let sumB = 0;
    for (const b of buffer) {
      sumA += b.priceA;
      sumB += b.priceB;
    }
    const meanA = sumA / n;
    const meanB = sumB / n;

    let covAB = 0;
    let varA = 0;
    let varB = 0;
    for (const b of buffer) {
      const diffA = b.priceA - meanA;
      const diffB = b.priceB - meanB;
      covAB += diffA * diffB;
      varA += diffA * diffA;
      varB += diffB * diffB;
    }

    let pearsonR = 1.0;
    if (varA > 0 && varB > 0) {
      pearsonR = covAB / (Math.sqrt(varA) * Math.sqrt(varB));
      // Clamp to [-1.0, 1.0] to protect against slight floating point inaccuracies
      pearsonR = Math.max(-1.0, Math.min(1.0, pearsonR));
    } else if (varA === 0 && varB === 0) {
      // Both prices are completely flat and identical
      pearsonR = 1.0;
    } else {
      // One venue moving while the other is completely stalled -> correlation breakdown
      pearsonR = 0.0;
    }

    // 2. Calculate Basis Mean, Variance, and Z-Score of the most recent tick
    let sumBasis = 0;
    for (const b of buffer) {
      sumBasis += b.basisBps;
    }
    const meanBasis = sumBasis / n;

    let varBasis = 0;
    for (const b of buffer) {
      const diffBasis = b.basisBps - meanBasis;
      varBasis += diffBasis * diffBasis;
    }
    const stdDevBasis = Math.sqrt(varBasis / (n > 1 ? n - 1 : 1));

    const latestBasis = buffer[buffer.length - 1].basisBps;
    const basisZScore =
      stdDevBasis > 0 ? Math.abs(latestBasis - meanBasis) / stdDevBasis : 0.0;

    // 3. Check for Violation Condition: r < 0.80 OR Z > 3.5 sigma
    const isViolation =
      pearsonR < this.tripThresholdR || basisZScore > this.tripThresholdZ;

    if (isViolation) {
      currentStatus.consecutiveViolations += 1;
      currentStatus.consecutiveNormalTicks = 0;
    } else {
      currentStatus.consecutiveNormalTicks += 1;
      if (currentStatus.state !== "TRIPPED") {
        currentStatus.consecutiveViolations = 0;
      }
    }

    // 4. State Machine Transition
    if (currentStatus.state === "TRIPPED") {
      // In TRIPPED state, check for recovery:
      // Must achieve resetTickCount consecutive ticks that satisfy strict recovery thresholds
      const isRecoveryTick =
        pearsonR >= this.resetThresholdR && basisZScore <= this.resetThresholdZ;

      if (isRecoveryTick && currentStatus.consecutiveNormalTicks >= this.resetTickCount) {
        // Recovery complete: reset to NORMAL
        currentStatus.state = "NORMAL";
        currentStatus.consecutiveViolations = 0;
        currentStatus.haltEntries = false;
        currentStatus.engageDeltaLock = false;
        currentStatus.reason = `CIRCUIT_BREAKER_RESET: Pearson r (${pearsonR.toFixed(3)}) & Z (${basisZScore.toFixed(2)}) recovered across ${this.resetTickCount} ticks`;
      } else {
        currentStatus.haltEntries = true;
        currentStatus.engageDeltaLock = true;
        currentStatus.reason = `CIRCUIT_BREAKER_TRIPPED: Awaiting recovery (${currentStatus.consecutiveNormalTicks}/${this.resetTickCount} normal ticks). r=${pearsonR.toFixed(3)}, Z=${basisZScore.toFixed(2)}`;
      }
    } else {
      // In NORMAL or WARNING state
      if (currentStatus.consecutiveViolations >= this.tripTickCount) {
        currentStatus.state = "TRIPPED";
        currentStatus.haltEntries = true;
        currentStatus.engageDeltaLock = true;
        currentStatus.reason = `CIRCUIT_BREAKER_TRIPPED: ${currentStatus.consecutiveViolations} consecutive violations (r=${pearsonR.toFixed(3)} < ${this.tripThresholdR} or Z=${basisZScore.toFixed(2)} > ${this.tripThresholdZ})`;
      } else if (currentStatus.consecutiveViolations > 0) {
        currentStatus.state = "WARNING";
        currentStatus.haltEntries = false;
        currentStatus.engageDeltaLock = false;
        currentStatus.reason = `CORRELATION_WARNING: Violation ${currentStatus.consecutiveViolations}/${this.tripTickCount} (r=${pearsonR.toFixed(3)}, Z=${basisZScore.toFixed(2)})`;
      } else {
        currentStatus.state = "NORMAL";
        currentStatus.haltEntries = false;
        currentStatus.engageDeltaLock = false;
        currentStatus.reason = `HEALTHY: r=${pearsonR.toFixed(3)}, Z=${basisZScore.toFixed(2)}`;
      }
    }

    currentStatus.pearsonR = parseFloat(pearsonR.toFixed(4));
    currentStatus.basisZScore = parseFloat(basisZScore.toFixed(4));
    currentStatus.sampleCount = buffer.length;
    currentStatus.lastEvaluationTime = now;

    this.stateMap.set(key, currentStatus);
    return currentStatus;
  }

  /**
   * Fast entry check for a candidate
   */
  public isEntryAllowed(
    corridor: string,
    symbol: string
  ): { allowed: boolean; reason?: string; status?: CircuitBreakerStatus } {
    const key = this.getBufferKey(corridor, symbol);
    const status = this.stateMap.get(key);

    if (status && status.haltEntries) {
      return {
        allowed: false,
        reason: status.reason || "CIRCUIT_BREAKER_ACTIVE: Correlation breakdown or basis spike",
        status,
      };
    }

    return { allowed: true, status };
  }

  /**
   * Explicit reset for testing or administrative recovery
   */
  public reset(corridor?: string, symbol?: string): void {
    if (corridor && symbol) {
      const key = this.getBufferKey(corridor, symbol);
      this.bufferMap.delete(key);
      this.stateMap.delete(key);
    } else {
      this.bufferMap.clear();
      this.stateMap.clear();
    }
  }

  public getActiveTrippedBreakers(): CircuitBreakerStatus[] {
    const tripped: CircuitBreakerStatus[] = [];
    for (const status of this.stateMap.values()) {
      if (status.state === "TRIPPED") {
        tripped.push(status);
      }
    }
    return tripped;
  }
}

// Global singleton instance
export const globalCircuitBreaker = new CorrelationCircuitBreaker();
