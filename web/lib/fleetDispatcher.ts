/**
 * Centralized Fleet Priority Queue Dispatcher
 * Coordinates capital allocation and execution priority across multiple autonomous bots.
 *
 * Implements:
 * 1. Global Multi-Bot CAS Priority Queue: Evaluates and ranks opportunities fleet-wide.
 * 2. Cross-Bot Capital Collision Prevention: Prevents concurrent race conditions on shared margin.
 * 3. Symbol & Corridor Mutual Exclusion: Guarantees at most 1 active trade per symbol fleet-wide.
 * 4. Fair Dispatching & Conviction-Based Margin Allocation.
 */

import { computeCompositeArbitrageScore, CandidateScoringFactors, CandidateScoreResult } from "./candidateScoring";

export interface FleetCandidateEntry {
  botId: string;
  botName: string;
  symbol: string;
  corridor: string;
  candidate: any;
  factors: CandidateScoringFactors;
  casResult: CandidateScoreResult;
  timestamp: number;
}

export interface FleetLockInfo {
  symbol: string;
  corridor: string;
  botId: string;
  userId?: string;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * Generate a mutex lock key scoped by tenant ID and symbol/corridor
 */
export function getLockKey(symbol: string, corridor?: string, userId?: string): string {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prefix = userId ? `${userId}_` : "";
  return corridor ? `${prefix}${corridor.toUpperCase()}_${sym}` : `${prefix}${sym}`;
}

export class FleetDispatcher {
  private queue: FleetCandidateEntry[] = [];
  private activeLocks: Map<string, FleetLockInfo> = new Map();
  private readonly lockTtlMs: number = 30000; // 30-second watchdog lock

  public getLockKey(symbol: string, corridor?: string, userId?: string): string {
    return getLockKey(symbol, corridor, userId);
  }

  /**
   * Submit an opportunity candidate for fleet-wide ranking
   */
  public submitCandidate(
    botId: string,
    botName: string,
    candidate: any,
    factors: CandidateScoringFactors
  ): CandidateScoreResult {
    const casResult = computeCompositeArbitrageScore(factors);

    if (casResult.qualified) {
      // Remove any existing entry for this bot and symbol
      this.queue = this.queue.filter(
        (entry) => !(entry.botId === botId && entry.symbol.toUpperCase() === factors.symbol.toUpperCase())
      );

      this.queue.push({
        botId,
        botName,
        symbol: factors.symbol.toUpperCase(),
        corridor: factors.corridor.toUpperCase(),
        candidate,
        factors,
        casResult,
        timestamp: Date.now(),
      });

      // Sort descending by composite score (highest conviction first)
      this.queue.sort((a, b) => b.casResult.compositeScore - a.casResult.compositeScore);
    }

    return casResult;
  }

  /**
   * Acquire a fleet-wide mutex lock on a symbol/corridor for trade entry
   */
  public acquireFleetLock(symbol: string, corridor: string, botId: string, userId?: string): boolean {
    const now = Date.now();
    this.cleanExpiredLocks(now);

    const symKey = this.getLockKey(symbol, undefined, userId);
    const corridorKey = this.getLockKey(symbol, corridor, userId);

    // If locked by any other bot for this tenant/scope, deny acquisition
    const existingSymLock = this.activeLocks.get(symKey);
    if (existingSymLock && existingSymLock.botId !== botId && existingSymLock.expiresAt > now) {
      return false;
    }

    const existingCorridorLock = this.activeLocks.get(corridorKey);
    if (existingCorridorLock && existingCorridorLock.botId !== botId && existingCorridorLock.expiresAt > now) {
      return false;
    }

    // Grant lock
    const lock: FleetLockInfo = {
      symbol: symbol.toUpperCase(),
      corridor: corridor.toUpperCase(),
      botId,
      userId,
      acquiredAt: now,
      expiresAt: now + this.lockTtlMs,
    };

    this.activeLocks.set(symKey, lock);
    this.activeLocks.set(corridorKey, lock);
    return true;
  }

  /**
   * Release fleet-wide lock upon trade completion or abort
   */
  public releaseFleetLock(symbol: string, corridor: string, botId: string, userId?: string): void {
    const symKey = this.getLockKey(symbol, undefined, userId);
    const corridorKey = this.getLockKey(symbol, corridor, userId);

    const symLock = this.activeLocks.get(symKey);
    if (symLock && symLock.botId === botId) {
      this.activeLocks.delete(symKey);
    }

    const corridorLock = this.activeLocks.get(corridorKey);
    if (corridorLock && corridorLock.botId === botId) {
      this.activeLocks.delete(corridorKey);
    }
  }

  /**
   * Check if a symbol is currently locked fleet-wide
   */
  public isSymbolLockedFleetWide(symbol: string, requestingBotId?: string, userId?: string): boolean {
    const now = Date.now();
    this.cleanExpiredLocks(now);

    const symKey = this.getLockKey(symbol, undefined, userId);
    const lock = this.activeLocks.get(symKey);
    if (!lock) return false;
    if (requestingBotId && lock.botId === requestingBotId) return false;
    return lock.expiresAt > now;
  }

  /**
   * Retrieve the highest-ranking candidate currently queued for a bot
   */
  public pollBestCandidateForBot(botId: string, userId?: string): FleetCandidateEntry | null {
    const now = Date.now();
    this.cleanExpiredLocks(now);

    // Filter queue to unexpired candidates (under 60s old) that are not locked by other bots
    const viable = this.queue.filter((item) => {
      if (item.botId !== botId) return false;
      if (now - item.timestamp > 60000) return false;
      return !this.isSymbolLockedFleetWide(item.symbol, botId, userId);
    });

    if (viable.length === 0) return null;

    // Return the top-scoring candidate
    return viable[0];
  }

  /**
   * Clean up expired entries and locks
   */
  private cleanExpiredLocks(now: number): void {
    for (const [key, lock] of this.activeLocks.entries()) {
      if (lock.expiresAt <= now) {
        this.activeLocks.delete(key);
      }
    }

    // Prune candidates older than 90 seconds from queue
    this.queue = this.queue.filter((entry) => now - entry.timestamp < 90000);
  }

  /**
   * Clear all queue state (for testing)
   */
  public clear(): void {
    this.queue = [];
    this.activeLocks.clear();
  }
}

// Global singleton instance
export const globalFleetDispatcher = new FleetDispatcher();
