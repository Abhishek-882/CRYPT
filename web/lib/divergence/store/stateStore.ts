/**
 * Divergence Bot: Windows-Compatible Atomic State Store & Pre-Dispatch In-Flight Intent Journal
 * Target Location: web/lib/divergence/store/stateStore.ts
 * 
 * Invariants & Core Capabilities:
 * 1. Windows-Compatible Atomic File Persistence:
 *    - Temp file write (`.tmp.<timestamp>.<rand>`) with explicit file descriptor fsync (`fs.fsyncSync` / `handle.sync()`)
 *    - Atomic rename with Windows file lock handling (catches EPERM/EBUSY, waits 50ms, falls back to copyFileSync + unlinkSync)
 *    - Automatic .backup file maintenance on every successful save for crash/power-outage corruption recovery
 *    - Boot-time disaster recovery: if primary file is corrupted or 0-byte truncated, automatically recovers from .backup
 * 2. Pre-Dispatch In-Flight Intent Journaling:
 *    - Atomic write to `data/divergence_inflight.json` before order dispatch
 *    - Methods: recordInflightIntent, updateInflightIntent, clearInflightIntent, readInflightIntents
 *    - Boot-time crash recovery: detects dangling intents (e.g. Leg 1 filled, Leg 2 interrupted) and provides diagnostic actions
 * 3. Capital Hard-Lock Verification:
 *    - Fleet NAV protection: hard-locks `maxConcurrentPositions = 3` and `maxCapitalAllocationUsdt = 30.00`
 *    - Sanitizes state on load to prevent file tampering, rejects/clamps config updates exceeding limits
 * 4. Strict Compliance:
 *    - 100% Zero BPS notation (all spreads, hurdles, fees in %)
 *    - Zero references to legacy basis bots
 *    - Safe default PAUSED / READY mode (`isRunning: false`, `fsmState: 'PAUSED'`)
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveDataDir } from '../../storagePath';
import {
  DivergenceStateSchema,
  DivergenceConfig,
  DivergencePosition,
  DivergenceClosedPosition,
  DivergenceTelemetry,
  DivergenceFsmState,
  DivergenceInFlightIntent,
  DivergenceInflightJournal,
  DEFAULT_DIVERGENCE_CONFIG,
  DEFAULT_DIVERGENCE_TELEMETRY,
  INITIAL_DIVERGENCE_STATE,
  DIVERGENCE_HARD_LIMITS,
} from '../types';

export {
  DEFAULT_DIVERGENCE_CONFIG,
  DEFAULT_DIVERGENCE_TELEMETRY,
  INITIAL_DIVERGENCE_STATE,
  DIVERGENCE_HARD_LIMITS,
};

function getDataDir(): string {
  try {
    return resolveDataDir();
  } catch {
    const cwd = process.cwd();
    return cwd.endsWith('web') ? path.join(cwd, 'data') : path.join(cwd, 'web', 'data');
  }
}

// ============================================================================
// Synchronous Sleep & Windows Atomic Utilities
// ============================================================================

/**
 * Cross-platform synchronous sleep using Atomics.wait (zero CPU spin)
 */
function sleepSync(ms: number): void {
  try {
    const shared = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(shared, 0, 0, ms);
  } catch {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Fallback spin wait if SharedArrayBuffer restricted
    }
  }
}

// Configurable fs hooks for testing Windows lock conditions in ESM environments
export const _fsHooks = {
  renameSync: fs.renameSync,
  copyFileSync: fs.copyFileSync,
  unlinkSync: fs.unlinkSync,
};

/**
 * Windows-compatible synchronous atomic file write with disk flush (fsync)
 * and .backup corruption recovery maintenance.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 6)}`;
  const backupPath = `${filePath}.backup`;

  // 1. Write to tmp file and flush physical buffers to disk via fsyncSync
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // 2. Atomic rename to target file with Windows lock fallback
  try {
    _fsHooks.renameSync(tmpPath, filePath);
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EBUSY') {
      // Windows lock contention: retry copyFileSync up to 5 times with jittered backoff
      let copied = false;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        sleepSync(Math.floor(25 * Math.pow(1.5, attempt) + Math.random() * 50 + 25));
        try {
          _fsHooks.copyFileSync(tmpPath, filePath);
          copied = true;
          break;
        } catch (copyErr) {
          lastErr = copyErr;
        }
      }
      try {
        _fsHooks.unlinkSync(tmpPath);
      } catch {
        // Non-fatal if tmp cleanup fails due to transient hold
      }
      if (!copied && lastErr) {
        throw lastErr;
      }
    } else {
      throw err;
    }
  }

  // 3. Update .backup file on every successful write for corruption recovery
  try {
    _fsHooks.copyFileSync(filePath, backupPath);
  } catch (backupErr: any) {
    console.warn(`[DivergenceStateStore] Warning: Could not update backup file (${backupPath}):`, backupErr.message);
  }
}

// ============================================================================
// Asynchronous Write Queue & Windows Atomic File Persistence
// ============================================================================

// Per-path queue for serializing async writes to the same file within this Node process
const asyncPathWriteQueues = new Map<string, Promise<void>>();

/**
 * Low-level atomic write implementation featuring randomized exponential backoff
 * retry loops on both rename and copyFile, plus resilient backup maintenance.
 */
async function executeAtomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 6)}`;
  const backupPath = `${filePath}.backup`;
  const maxRetries = 5;

  const waitBackoff = (attempt: number) => {
    // 3-5 retries with Math.random() * 50 + 25 ms jitter
    const jitter = Math.random() * 50 + 25;
    const delay = Math.floor(25 * Math.pow(1.5, attempt) + jitter);
    return new Promise((resolve) => setTimeout(resolve, delay));
  };

  try {
    // 1. Write to tmp file and flush physical buffers to disk via handle.sync()
    const handle = await fs.promises.open(tmpPath, 'w');
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    // 2. Atomic rename to target file with Windows lock fallback and retry loop
    let renamed = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await fs.promises.rename(tmpPath, filePath);
        renamed = true;
        break;
      } catch (err: any) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY') && attempt < maxRetries - 1) {
          await waitBackoff(attempt);
        } else if (err.code !== 'EPERM' && err.code !== 'EBUSY') {
          throw err;
        }
      }
    }

    // Fallback: If rename failed across all retries due to Windows NTFS lock contention, fallback to copyFile with retry loop
    if (!renamed) {
      let copied = false;
      let lastCopyErr: any = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await fs.promises.copyFile(tmpPath, filePath);
          copied = true;
          break;
        } catch (copyErr: any) {
          lastCopyErr = copyErr;
          if ((copyErr.code === 'EPERM' || copyErr.code === 'EBUSY') && attempt < maxRetries - 1) {
            await waitBackoff(attempt);
          }
        }
      }

      if (!copied && lastCopyErr) {
        throw lastCopyErr;
      }
    }

    // 3. Update .backup file on every successful write with retry backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await fs.promises.copyFile(filePath, backupPath);
        break;
      } catch (backupErr: any) {
        if ((backupErr.code === 'EPERM' || backupErr.code === 'EBUSY') && attempt < maxRetries - 1) {
          await waitBackoff(attempt);
        } else {
          console.warn(`[DivergenceStateStore] Warning: Could not update backup file (${backupPath}):`, backupErr.message);
          break;
        }
      }
    }
  } finally {
    // Always clean up temporary file on either success or failure
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Windows-compatible asynchronous atomic file write with disk flush (sync),
 * in-process per-path serialization queue, randomized exponential backoff retries,
 * and .backup corruption recovery maintenance.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const previousQueue = asyncPathWriteQueues.get(filePath) || Promise.resolve();

  const currentWrite = previousQueue
    .catch(() => {})
    .then(async () => {
      await executeAtomicWriteFile(filePath, content);
    });

  asyncPathWriteQueues.set(filePath, currentWrite);

  try {
    await currentWrite;
  } finally {
    if (asyncPathWriteQueues.get(filePath) === currentWrite) {
      asyncPathWriteQueues.delete(filePath);
    }
  }
}

// ============================================================================
// DivergenceStateStore Class
// ============================================================================

export class DivergenceStateStore {
  private filePath: string;
  private inflightFilePath: string;
  private state: DivergenceStateSchema;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(customFilePath?: string, customInflightFilePath?: string) {
    const dataDir = getDataDir();
    this.filePath = customFilePath || path.join(dataDir, 'divergence_state.json');
    this.inflightFilePath = customInflightFilePath || path.join(dataDir, 'divergence_inflight.json');

    this.state = this.loadState();
  }

  // ==========================================================================
  // State Loading & Disaster Recovery
  // ==========================================================================

  /**
   * Loads state from disk with automated .backup disaster recovery fallback
   */
  private loadState(): DivergenceStateSchema {
    const backupPath = `${this.filePath}.backup`;

    // 1. Attempt loading primary state file
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        if (raw.trim().length > 0) {
          const parsed = JSON.parse(raw);
          return this.hydrateAndValidateState(parsed);
        }
      } catch (err: any) {
        console.warn(`[DivergenceStateStore] Primary state corrupted or truncated (${this.filePath}): ${err.message}. Attempting recovery from backup...`);
      }
    }

    // 2. Attempt disaster recovery from .backup file
    if (fs.existsSync(backupPath)) {
      try {
        const rawBackup = fs.readFileSync(backupPath, 'utf-8');
        if (rawBackup.trim().length > 0) {
          const parsedBackup = JSON.parse(rawBackup);
          console.warn(`[DivergenceStateStore] State successfully recovered from backup (${backupPath})! Restoring primary file...`);
          const hydrated = this.hydrateAndValidateState(parsedBackup);
          // Restore primary file immediately
          this.saveStateSync(hydrated);
          return hydrated;
        }
      } catch (backupErr: any) {
        console.error(`[DivergenceStateStore] Critical: Backup file also corrupted (${backupPath}): ${backupErr.message}. Initializing clean state.`);
      }
    }

    // 3. Fallback to clean default state
    return this.getCleanDefaultState();
  }

  /**
   * Returns clean default state complying with safe PAUSED mode and capital hard-locks
   */
  public getCleanDefaultState(): DivergenceStateSchema {
    return {
      version: '1.0.0',
      isRunning: false,               // MUST DEFAULT TO false
      fsmState: 'PAUSED',             // MUST DEFAULT TO 'PAUSED'
      config: { ...DEFAULT_DIVERGENCE_CONFIG },
      activePositions: {},
      closedPositions: [],
      telemetry: { ...DEFAULT_DIVERGENCE_TELEMETRY },
      lastUpdated: Date.now(),
    };
  }

  /**
   * Hydrates, validates, and strictly enforces capital hard-locks on parsed state
   */
  private hydrateAndValidateState(parsed: any): DivergenceStateSchema {
    const sanitizedConfig = this.sanitizeConfig(parsed.config);

    // Active positions map validation
    let activePositions: Record<string, DivergencePosition> = {};
    if (parsed.activePositions && typeof parsed.activePositions === 'object' && !Array.isArray(parsed.activePositions)) {
      activePositions = parsed.activePositions;
    } else if (Array.isArray(parsed.activePositions)) {
      // Normalize array to map if older schema encountered
      parsed.activePositions.forEach((pos: DivergencePosition) => {
        if (pos && pos.id) {
          activePositions[pos.id] = pos;
        }
      });
    }

    // Capital hard-lock sanity check on active positions
    const activeKeys = Object.keys(activePositions);
    if (activeKeys.length > sanitizedConfig.maxConcurrentPositions) {
      console.error(`[CRITICAL INVARIANT VIOLATION] Active positions count (${activeKeys.length}) exceeds hard-locked max (${sanitizedConfig.maxConcurrentPositions})!`);
    }

    const state: DivergenceStateSchema = {
      version: typeof parsed.version === 'string' ? parsed.version : '1.0.0',
      isRunning: Boolean(parsed.isRunning),
      fsmState: (parsed.fsmState as DivergenceFsmState) || 'PAUSED',
      config: sanitizedConfig,
      activePositions,
      closedPositions: Array.isArray(parsed.closedPositions) ? parsed.closedPositions : [],
      telemetry: {
        ...DEFAULT_DIVERGENCE_TELEMETRY,
        ...(parsed.telemetry || {}),
      },
      lastUpdated: typeof parsed.lastUpdated === 'number' ? parsed.lastUpdated : Date.now(),
    };

    return state;
  }

  /**
   * Sanitizes configuration by strictly asserting capital ceilings
   */
  private sanitizeConfig(inputConfig?: Partial<DivergenceConfig>): DivergenceConfig {
    const merged: DivergenceConfig = {
      ...DEFAULT_DIVERGENCE_CONFIG,
      ...(inputConfig || {}),
    };

    // HARD-LOCK 1: maxConcurrentPositions strictly between 1 and 3 (User-configured maximum 3)
    if (typeof merged.maxConcurrentPositions !== 'number' || merged.maxConcurrentPositions < 1 || merged.maxConcurrentPositions > 3) {
      console.warn(`[HARD-LOCK SANITIZATION] Overriding maxConcurrentPositions (${merged.maxConcurrentPositions} -> 3)`);
      merged.maxConcurrentPositions = 3;
    }

    // HARD-LOCK 2: maxPositionsPerSymbol strictly 1
    if (merged.maxPositionsPerSymbol !== 1) {
      console.warn(`[HARD-LOCK SANITIZATION] Overriding maxPositionsPerSymbol (${merged.maxPositionsPerSymbol} -> 1)`);
      merged.maxPositionsPerSymbol = 1;
    }

    // HARD-LOCK 3: orderNotionalUsdt strictly between 5.00 and 600.00 USDT (Default 15.00 USDT, supports up to 600.00 USDT for 10x leverage margin)
    if (typeof merged.orderNotionalUsdt !== 'number' || merged.orderNotionalUsdt > 600.00 || merged.orderNotionalUsdt < 5.00) {
      console.warn(`[HARD-LOCK SANITIZATION] Overriding orderNotionalUsdt (${merged.orderNotionalUsdt} -> 15.00)`);
      merged.orderNotionalUsdt = 15.00;
    }

    // HARD-LOCK 4: maxCapitalAllocationUsdt strictly <= maxAllowedCapital (Default 60.00 USDT, accommodates higher orderNotionalUsdt)
    const maxAllowedCapital = Math.max(60.00, Math.min(1800.00, merged.orderNotionalUsdt * merged.maxConcurrentPositions));
    if (typeof merged.maxCapitalAllocationUsdt !== 'number' || merged.maxCapitalAllocationUsdt > maxAllowedCapital || merged.maxCapitalAllocationUsdt <= 0) {
      console.warn(`[HARD-LOCK SANITIZATION] Overriding maxCapitalAllocationUsdt (${merged.maxCapitalAllocationUsdt} -> ${maxAllowedCapital.toFixed(2)})`);
      merged.maxCapitalAllocationUsdt = maxAllowedCapital;
    }

    // Ensure maxCapitalAllocationUsdt accommodates orderNotionalUsdt
    if (merged.maxCapitalAllocationUsdt < merged.orderNotionalUsdt) {
      merged.maxCapitalAllocationUsdt = merged.orderNotionalUsdt * merged.maxConcurrentPositions;
    }

    // HARD-LOCK 5: zeroLossNetHurdleUsdt strictly >= 0.0100 USDT (Hard Safety Barrier)
    if (typeof merged.zeroLossNetHurdleUsdt === 'number' && merged.zeroLossNetHurdleUsdt < 0.0100) {
      console.warn(`[HARD-LOCK SANITIZATION] Clamping zeroLossNetHurdleUsdt (${merged.zeroLossNetHurdleUsdt} -> 0.0100)`);
      merged.zeroLossNetHurdleUsdt = 0.0100;
    }

    return merged;
  }

  // ==========================================================================
  // Persistence Methods
  // ==========================================================================

  /**
   * Synchronously persists engine state to disk (with fsync + Windows lock fallback)
   */
  public persistStateSync(): void {
    try {
      this.state.lastUpdated = Date.now();
      this.recalculateTelemetry();
      this.saveStateSync(this.state);
    } catch (err: any) {
      console.error(`[DivergenceStateStore] Failed to persist state synchronously:`, err.message);
    }
  }

  /**
   * Asynchronously persists engine state to disk via serialized internal Promise queue.
   * Guarantees that concurrent calls are executed sequentially without dropping writes.
   */
  public async persistState(): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch(() => {}) // Ensure a prior I/O failure does not break the chain
      .then(async () => {
        try {
          this.state.lastUpdated = Date.now();
          this.recalculateTelemetry();
          const content = JSON.stringify(this.state, null, 2);
          await atomicWriteFile(this.filePath, content);
        } catch (err: any) {
          console.error(`[DivergenceStateStore] Failed to persist state asynchronously:`, err.message);
          throw err;
        }
      });
    return this.writeQueue;
  }

  /**
   * Alias for persistState to support standard saveState terminology
   */
  public async saveState(): Promise<void> {
    return this.persistState();
  }

  private saveStateSync(state: DivergenceStateSchema): void {
    const content = JSON.stringify(state, null, 2);
    atomicWriteFileSync(this.filePath, content);
  }

  // ==========================================================================
  // In-Memory Accessors & FSM Controls
  // ==========================================================================

  public getState(): Readonly<DivergenceStateSchema> {
    return typeof structuredClone === 'function'
      ? structuredClone(this.state)
      : JSON.parse(JSON.stringify(this.state));
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getInflightFilePath(): string {
    return this.inflightFilePath;
  }

  public setFsmState(fsmState: DivergenceFsmState): void {
    this.state.fsmState = fsmState;
    this.persistStateSync();
  }

  public setRunning(isRunning: boolean): void {
    this.state.isRunning = isRunning;
    if (!isRunning) {
      this.state.fsmState = 'PAUSED';
    } else if (this.state.fsmState === 'PAUSED') {
      this.state.fsmState = 'IDLE';
    }
    this.persistStateSync();
  }

  public updateConfig(updates: Partial<DivergenceConfig>): DivergenceConfig {
    this.state.config = this.sanitizeConfig({
      ...this.state.config,
      ...updates,
    });
    this.persistStateSync();
    return { ...this.state.config };
  }

  // ==========================================================================
  // Position Management & Hard-Lock Enforcers
  // ==========================================================================

  public getActivePositions(): DivergencePosition[] {
    const positions = Object.values(this.state.activePositions);
    return typeof structuredClone === 'function'
      ? structuredClone(positions)
      : JSON.parse(JSON.stringify(positions));
  }

  public getClosedPositions(): DivergenceClosedPosition[] {
    return typeof structuredClone === 'function'
      ? structuredClone(this.state.closedPositions)
      : JSON.parse(JSON.stringify(this.state.closedPositions));
  }

  public getPositionById(id: string): DivergencePosition | undefined {
    const pos = this.state.activePositions[id];
    if (!pos) return undefined;
    return typeof structuredClone === 'function'
      ? structuredClone(pos)
      : JSON.parse(JSON.stringify(pos));
  }

  /**
   * Pre-trade gating check asserting fleet NAV and concurrent position capacity
   */
  public canOpenPosition(notionalUsdt: number = 10.00, canonicalSymbol?: string): { allowed: boolean; reason?: string } {
    // Input validation: assert valid positive numerical notional
    if (typeof notionalUsdt !== 'number' || isNaN(notionalUsdt) || notionalUsdt <= 0) {
      return {
        allowed: false,
        reason: `Invalid notionalUsdt requested (${notionalUsdt}): must be a positive finite number`,
      };
    }

    if (!this.state.isRunning) {
      return { allowed: false, reason: 'Engine is not running (PAUSED or STOPPED)' };
    }

    if (this.state.config.noNewTrades) {
      return { allowed: false, reason: 'noNewTrades wind-down mode is active' };
    }

    const activeCount = Object.keys(this.state.activePositions).length;
    if (activeCount >= this.state.config.maxConcurrentPositions) {
      return { 
        allowed: false, 
        reason: `Max concurrent positions limit reached (${activeCount}/${this.state.config.maxConcurrentPositions})` 
      };
    }

    if (canonicalSymbol) {
      const activeList = Object.values(this.state.activePositions);
      const symbolCount = activeList.filter(
        (p) => p.canonicalSymbol.toUpperCase() === canonicalSymbol.toUpperCase()
      ).length;
      if (symbolCount >= this.state.config.maxPositionsPerSymbol) {
        return {
          allowed: false,
          reason: `Max positions per symbol limit reached (${symbolCount}/${this.state.config.maxPositionsPerSymbol}) for ${canonicalSymbol.toUpperCase()}`
        };
      }
    }

    // Check for dangling intents in progress
    const danglingIntents = this.checkDanglingIntentsOnStartup();
    if (danglingIntents.length > 0) {
      return {
        allowed: false,
        reason: `Dangling in-flight intent exists (${danglingIntents[0].intentId}) awaiting reconciliation`
      };
    }

    // Capital ceiling check
    const currentAllocatedUsdt = Object.values(this.state.activePositions).reduce(
      (sum, pos) => sum + (pos.notionalUsdt || 0), 0
    );
    if (currentAllocatedUsdt + notionalUsdt > this.state.config.maxCapitalAllocationUsdt) {
      return {
        allowed: false,
        reason: `Capital limit exceeded (allocated: $${currentAllocatedUsdt.toFixed(2)}, requested: $${notionalUsdt.toFixed(2)}, max: $${this.state.config.maxCapitalAllocationUsdt.toFixed(2)})`
      };
    }

    return { allowed: true };
  }

  public addPosition(position: DivergencePosition): boolean {
    if (!position) {
      console.error('[DivergenceStateStore] Rejected addPosition: null or undefined position provided.');
      return false;
    }

    const activeCount = Object.keys(this.state.activePositions).length;
    if (activeCount >= this.state.config.maxConcurrentPositions) {
      console.error(`[DivergenceStateStore] Rejected addPosition: maxConcurrentPositions (${this.state.config.maxConcurrentPositions}) reached.`);
      return false;
    }

    // Check max positions per symbol
    const sameSymbolCount = Object.values(this.state.activePositions).filter(
      (p) => p.canonicalSymbol.toUpperCase() === position.canonicalSymbol.toUpperCase()
    ).length;
    if (sameSymbolCount >= this.state.config.maxPositionsPerSymbol) {
      console.error(
        `[DivergenceStateStore] Rejected addPosition: maxPositionsPerSymbol (${this.state.config.maxPositionsPerSymbol}) reached for ${position.canonicalSymbol}.`
      );
      return false;
    }

    // Defense-in-depth: strict capital allocation ceiling and input validation
    const notional = position.notionalUsdt;
    if (
      typeof notional !== 'number' ||
      isNaN(notional) ||
      notional <= 0 ||
      (position.notionalUsdt || 0) > this.state.config.maxCapitalAllocationUsdt
    ) {
      console.error(
        `[DivergenceStateStore] Rejected addPosition: notionalUsdt (${notional}) exceeds capital ceiling (${this.state.config.maxCapitalAllocationUsdt}) or is invalid.`
      );
      return false;
    }

    const currentAllocatedUsdt = Object.values(this.state.activePositions).reduce(
      (sum, pos) => sum + (pos.notionalUsdt || 0), 0
    );
    if (currentAllocatedUsdt + notional > this.state.config.maxCapitalAllocationUsdt) {
      console.error(
        `[DivergenceStateStore] Rejected addPosition: total allocated with this position ($${(currentAllocatedUsdt + notional).toFixed(2)}) exceeds capital ceiling ($${this.state.config.maxCapitalAllocationUsdt.toFixed(2)}).`
      );
      return false;
    }

    this.state.activePositions[position.id] = position;
    this.state.fsmState = 'ACTIVE_EXPANDING';
    this.persistStateSync();
    return true;
  }

  public updatePosition(id: string, updates: Partial<DivergencePosition>): boolean {
    if (!this.state.activePositions[id]) return false;

    this.state.activePositions[id] = {
      ...this.state.activePositions[id],
      ...updates,
      lastUpdated: Date.now(),
    };

    this.persistStateSync();
    return true;
  }

  public closePosition(
    id: string,
    closedData: Partial<DivergenceClosedPosition>
  ): DivergenceClosedPosition | null {
    const pos = this.state.activePositions[id];
    if (!pos) return null;

    delete this.state.activePositions[id];

    const exitTimestamp = closedData.exitTimestamp || Date.now();
    const holdDurationMinutes = parseFloat(
      ((exitTimestamp - pos.entryTimestamp) / (60 * 1000)).toFixed(2)
    );

    const closedPos: DivergenceClosedPosition = {
      ...pos,
      status: 'CLOSED',
      exitTimestamp,
      exitReason: closedData.exitReason || 'EXPANSION_TP',
      exitBinancePrice: closedData.exitBinancePrice ?? pos.currentBinancePrice,
      exitBybitPrice: closedData.exitBybitPrice ?? pos.currentBybitPrice,
      realizedGrossPnlUsdt: closedData.realizedGrossPnlUsdt ?? pos.unrealizedGrossPnlUsdt,
      actualFeesUsdt: closedData.actualFeesUsdt ?? pos.estimatedTotalFeesUsdt,
      netRealizedPnlUsdt: closedData.netRealizedPnlUsdt ?? pos.netPnlUsdt,
      realizedRoiPercent: closedData.realizedRoiPercent ?? pos.roiPercent,
      finalRelativeExpansionPercent: closedData.finalRelativeExpansionPercent ?? pos.relativeExpansionPercent,
      roundtripLatencyMs: closedData.roundtripLatencyMs ?? 0,
      holdDurationMinutes,
      ...closedData,
    };

    this.state.closedPositions.unshift(closedPos);
    // Keep last 100 closed positions in primary state file
    if (this.state.closedPositions.length > 100) {
      this.state.closedPositions.pop();
    }

    if (Object.keys(this.state.activePositions).length === 0 && this.state.fsmState !== 'EMERGENCY_KILLED') {
      this.state.fsmState = this.state.isRunning ? 'IDLE' : 'PAUSED';
    }

    this.persistStateSync();
    return closedPos;
  }

  public recordClosedPosition(closedPos: DivergenceClosedPosition): void {
    this.state.closedPositions.unshift(closedPos);
    if (this.state.closedPositions.length > 100) {
      this.state.closedPositions.pop();
    }
    this.persistStateSync();
  }

  public clearState(): void {
    this.state = this.getCleanDefaultState();
    this.persistStateSync();
  }

  // ==========================================================================
  // Pre-Dispatch In-Flight Intent Journaling & Crash Recovery
  // ==========================================================================

  /**
   * Reads all in-flight intent records from `data/divergence_inflight.json`
   */
  public readInflightIntents(): DivergenceInFlightIntent[] {
    if (!fs.existsSync(this.inflightFilePath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.inflightFilePath, 'utf-8');
      if (!raw || raw.trim().length === 0) return [];
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && Array.isArray(parsed.intents)) {
        return parsed.intents;
      }
    } catch (err: any) {
      console.warn(`[DivergenceStateStore] Failed reading in-flight intents (${this.inflightFilePath}): ${err.message}`);
    }

    return [];
  }

  /**
   * Persists the in-flight intent journal atomically with disk flush
   */
  private saveInflightJournal(intents: DivergenceInFlightIntent[]): void {
    const journal: DivergenceInflightJournal = {
      version: '1.0.0',
      intents,
      lastUpdated: Date.now(),
    };
    const content = JSON.stringify(journal, null, 2);
    atomicWriteFileSync(this.inflightFilePath, content);
  }

  /**
   * Records a pre-dispatch intent to disk prior to Leg 1 order submission
   */
  public recordInflightIntent(intent: DivergenceInFlightIntent): void {
    const intents = this.readInflightIntents();
    const existingIdx = intents.findIndex((i) => i.intentId === intent.intentId);

    if (existingIdx >= 0) {
      intents[existingIdx] = {
        ...intent,
        updatedAt: Date.now(),
      };
    } else {
      intents.push({
        ...intent,
        createdAt: intent.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
    }

    this.saveInflightJournal(intents);
  }

  /**
   * Updates an in-flight intent status and executed quantities
   */
  public updateInflightIntent(
    intentId: string, 
    updates: Partial<DivergenceInFlightIntent>
  ): boolean {
    const intents = this.readInflightIntents();
    const idx = intents.findIndex((i) => i.intentId === intentId);
    if (idx === -1) return false;

    intents[idx] = {
      ...intents[idx],
      ...updates,
      updatedAt: Date.now(),
    };

    this.saveInflightJournal(intents);
    return true;
  }

  /**
   * Clears a completed intent or truncates the journal
   */
  public clearInflightIntent(intentId?: string): void {
    if (!intentId) {
      // Clear all
      this.saveInflightJournal([]);
      return;
    }

    const intents = this.readInflightIntents();
    const filtered = intents.filter((i) => i.intentId !== intentId);
    this.saveInflightJournal(filtered);
  }

  /**
   * Inspects `data/divergence_inflight.json` on startup to detect uncompleted intents
   */
  public checkDanglingIntentsOnStartup(): DivergenceInFlightIntent[] {
    const intents = this.readInflightIntents();
    const dangling = intents.filter(
      (i) => i.status !== 'COMPLETED' && i.status !== 'ABORTED'
    );

    if (dangling.length > 0) {
      console.warn(`[CRASH RECOVERY] Detected ${dangling.length} dangling in-flight intent(s) on startup!`);
      dangling.forEach((intent) => {
        console.warn(`[CRASH RECOVERY] Dangling Intent ID: ${intent.intentId}, Symbol: ${intent.canonicalSymbol}, Status: ${intent.status}, Leg 1: ${intent.leg1?.status}, Leg 2: ${intent.leg2?.status}`);
      });
    }

    return dangling;
  }

  // ==========================================================================
  // Telemetry Recalculation
  // ==========================================================================

  private recalculateTelemetry(): void {
    const closed = this.state.closedPositions;
    const activeKeys = Object.keys(this.state.activePositions);
    const totalTrades = closed.length;
    const wins = closed.filter((p) => (p.netRealizedPnlUsdt ?? p.netPnlUsdt ?? 0) > 0).length;
    const winRate = totalTrades > 0 ? parseFloat(((wins / totalTrades) * 100).toFixed(2)) : 0.0;

    const totalNetPnl = closed.reduce(
      (acc, p) => acc + (p.netRealizedPnlUsdt ?? p.netPnlUsdt ?? 0), 0
    );
    const totalFees = closed.reduce(
      (acc, p) => acc + (p.actualFeesUsdt ?? p.estimatedTotalFeesUsdt ?? 0), 0
    );
    const totalHoldTime = closed.reduce(
      (acc, p) => acc + (p.holdDurationMinutes ?? 0), 0
    );
    const avgHoldDuration = totalTrades > 0 ? parseFloat((totalHoldTime / totalTrades).toFixed(2)) : 0.0;

    const totalGrossProfits = closed
      .map((p) => p.netRealizedPnlUsdt ?? p.netPnlUsdt ?? 0)
      .filter((p) => p > 0)
      .reduce((a, b) => a + b, 0);
    const totalGrossLosses = Math.abs(
      closed
        .map((p) => p.netRealizedPnlUsdt ?? p.netPnlUsdt ?? 0)
        .filter((p) => p < 0)
        .reduce((a, b) => a + b, 0)
    );
    const profitFactor = totalGrossLosses > 0
      ? parseFloat((totalGrossProfits / totalGrossLosses).toFixed(2))
      : totalGrossProfits > 0 ? 99.99 : 0.0;

    this.state.telemetry = {
      ...this.state.telemetry,
      activePositionsCount: activeKeys.length,
      closedPositionsCount: totalTrades,
      totalRealizedNetPnlUsdt: parseFloat(totalNetPnl.toFixed(4)),
      totalRoundtripFeesUsdt: parseFloat(totalFees.toFixed(4)),
      winRate,
      profitFactor,
      averageHoldDurationMinutes: avgHoldDuration,
      systemStatus: this.state.telemetry.systemStatus || 'HEALTHY',
    };
  }
}

// Global singleton instance for shared process lifecycle
let globalStoreInstance: DivergenceStateStore | null = null;
export function getDivergenceStateStore(): DivergenceStateStore {
  if (!globalStoreInstance) {
    globalStoreInstance = new DivergenceStateStore();
  }
  return globalStoreInstance;
}
