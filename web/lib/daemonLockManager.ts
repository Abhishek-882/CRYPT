import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { resolveDataFilePath } from "./storagePath";

export const DEFAULT_LOCK_FILE_NAME = "bot_daemon.lock";

export interface DaemonLockPayload {
  pid: number;
  startedAt: number;
  heartbeat: number;
  hostname: string;
  platform: string;
  instanceUuid: string;
}

export class LockCollisionError extends Error {
  public readonly pid: number;
  public readonly lockInfo?: DaemonLockPayload;

  constructor(pid: number, details?: string, lockInfo?: DaemonLockPayload) {
    const msg = `Lockfile collision: Daemon already running under PID ${pid}${details ? ` (${details})` : ""}`;
    super(msg);
    this.name = "LockCollisionError";
    this.pid = pid;
    this.lockInfo = lockInfo;
  }
}

export interface AcquireLockOptions {
  lockFileName?: string;
  force?: boolean;
  throwOnCollision?: boolean;
  userId?: string;
}

export interface ReleaseTenantLockOptions {
  lockFileName?: string;
  force?: boolean;
  throwOnCollision?: boolean;
  userId?: string;
  remainingTenants?: number;
}

export type DaemonLockOptions = AcquireLockOptions | ReleaseTenantLockOptions | boolean | string;

export interface AcquireLockResult {
  acquired: boolean;
  pid?: number;
  instanceUuid?: string;
  error?: string;
  lockInfo?: DaemonLockPayload;
}

export interface HeartbeatCronOptions {
  lockFileName?: string;
  intervalMs?: number;
}

export interface TenantDaemonLockRegistry {
  activeTenantIds: Set<string>;
  lockFileName: string;
}

// In-memory registry of active locks held by current process (keyed by resolved absolute lockfile path)
const activeLocks = new Map<string, DaemonLockPayload>();
// Active heartbeat cron timers (keyed by resolved absolute lockfile path)
const heartbeatTimers = new Map<string, NodeJS.Timeout>();
// In-memory registry of active tenants per lockfile (keyed by resolved absolute lockfile path)
const activeTenantsByLock = new Map<string, Set<string>>();

// Backward-compatibility reference for legacy inspections of active lock
let activeLockPayload: DaemonLockPayload | null = null;
let lifecycleHooksRegistered = false;

/**
 * Standardizes option inputs: object, boolean (force), string (lockFileName), or undefined.
 */
export function parseLockOptions(opts?: DaemonLockOptions): {
  lockFileName: string;
  force: boolean;
  throwOnCollision: boolean;
} {
  let lockFileName = DEFAULT_LOCK_FILE_NAME;
  let force = false;
  let throwOnCollision = true;

  if (typeof opts === "boolean") {
    force = opts;
  } else if (typeof opts === "string") {
    if (opts.trim() !== "") {
      lockFileName = opts.trim();
    }
  } else if (opts && typeof opts === "object") {
    if (typeof opts.lockFileName === "string" && opts.lockFileName.trim() !== "") {
      lockFileName = opts.lockFileName.trim();
    }
    if (typeof opts.force === "boolean") {
      force = opts.force;
    }
    if (typeof opts.throwOnCollision === "boolean") {
      throwOnCollision = opts.throwOnCollision;
    }
  }

  return { lockFileName, force, throwOnCollision };
}

/**
 * Checks whether a process with the given PID is currently active on the host OS.
 */
export function isProcessActive(pid: number): boolean {
  if (!pid || typeof pid !== "number" || isNaN(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

/**
 * Resolves the absolute path to a daemon lockfile.
 * - Defaults to 'bot_daemon.lock' (preserving existing web/bot_daemon.lock location).
 * - For 'divergence_daemon.lock', maps to data/divergence_daemon.lock per PROJECT.md.
 * - Supports custom filenames and relative paths inside data/.
 */
export function getDaemonLockFilePath(opts?: DaemonLockOptions): string {
  const { lockFileName } = parseLockOptions(opts);

  if (path.isAbsolute(lockFileName)) {
    return lockFileName;
  }

  // If explicit relative directory given (e.g. "data/divergence_daemon.lock")
  if (lockFileName.startsWith("data/") || lockFileName.startsWith("data\\")) {
    return resolveDataFilePath(lockFileName);
  }

  // Default bot_daemon.lock
  if (lockFileName === DEFAULT_LOCK_FILE_NAME) {
    return resolveDataFilePath(lockFileName);
  }

  // Divergence daemon lock: target data/ subdirectory
  if (lockFileName === "divergence_daemon.lock") {
    const dataLockPath = resolveDataFilePath(path.join("data", lockFileName));
    return dataLockPath;
  }

  // Other custom filenames
  const dataPath = resolveDataFilePath(path.join("data", lockFileName));
  const directPath = resolveDataFilePath(lockFileName);
  if (fs.existsSync(dataPath)) return dataPath;
  if (fs.existsSync(directPath)) return directPath;
  return directPath;
}

/**
 * Reads the current lockfile metadata if it exists on disk.
 */
export function getDaemonLockInfo(opts?: DaemonLockOptions): DaemonLockPayload | null {
  const lockFilePath = getDaemonLockFilePath(opts);
  try {
    if (fs.existsSync(lockFilePath)) {
      const raw = fs.readFileSync(lockFilePath, "utf-8");
      return JSON.parse(raw) as DaemonLockPayload;
    }
  } catch {
    // Corrupted or unparseable JSON
  }
  return null;
}

/**
 * Alias for getDaemonLockInfo adhering to PROJECT.md interface contract.
 */
export function readDaemonLock(opts?: DaemonLockOptions): DaemonLockPayload | null {
  return getDaemonLockInfo(opts);
}

/**
 * Checks if the daemon lock is actively held by a live OS process.
 */
export function isDaemonLocked(opts?: DaemonLockOptions): boolean {
  const info = getDaemonLockInfo(opts);
  if (!info || !info.pid) return false;
  return isProcessActive(info.pid);
}

/**
 * Alias for isDaemonLocked supporting options object / boolean / string.
 */
export function isDaemonRunning(opts?: DaemonLockOptions): boolean {
  return isDaemonLocked(opts);
}

/**
 * Checks if the daemon lock is currently held by this specific running process.
 */
export function isDaemonLockHeldByCurrentProcess(opts?: DaemonLockOptions): boolean {
  const lockFilePath = getDaemonLockFilePath(opts);
  const resolvedKey = path.resolve(lockFilePath);
  const activePayload = activeLocks.get(resolvedKey) || (lockFilePath === getDaemonLockFilePath() ? activeLockPayload : null);
  if (!activePayload) return false;

  const info = getDaemonLockInfo(opts);
  return Boolean(
    info &&
    info.pid === process.pid &&
    info.instanceUuid === activePayload.instanceUuid
  );
}

/**
 * Acquires exclusive kernel-level file lock.
 * Uses fs.openSync with flag 'wx' (O_CREAT | O_EXCL) for atomic kernel exclusivity.
 */
export function acquireDaemonLock(opts?: DaemonLockOptions): AcquireLockResult {
  const { lockFileName, force, throwOnCollision } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  // Ensure parent directory exists before attempting openSync
  const dir = path.dirname(lockFilePath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }

  // Register process lifecycle hooks once
  registerDaemonLifecycleHooks();

  // If force flag is enabled, unlink any existing lockfile upfront
  if (force && fs.existsSync(lockFilePath)) {
    try {
      fs.unlinkSync(lockFilePath);
    } catch (unlinkErr: any) {
      console.warn(`[DAEMON LOCK] Could not unlink lock during force acquisition: ${unlinkErr.message}`);
    }
  }

  // Atomic creation attempt with 'wx'
  let fd: number | null = null;
  try {
    fd = fs.openSync(lockFilePath, "wx");
  } catch (err: any) {
    if (err.code !== "EEXIST") {
      throw err;
    }
    // File exists -> proceed to liveness check
  }

  if (fd !== null) {
    // Lock acquired cleanly on first try
    const payload: DaemonLockPayload = {
      pid: process.pid,
      startedAt: Date.now(),
      heartbeat: Date.now(),
      hostname: os.hostname(),
      platform: process.platform,
      instanceUuid: crypto.randomUUID(),
    };
    try {
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2), "utf-8");
    } finally {
      fs.closeSync(fd);
    }
    activeLocks.set(resolvedKey, payload);
    if (lockFileName === DEFAULT_LOCK_FILE_NAME) {
      activeLockPayload = payload;
    }
    if (opts && typeof opts === "object" && "userId" in opts && opts.userId) {
      let tenantSet = activeTenantsByLock.get(resolvedKey);
      if (!tenantSet) {
        tenantSet = new Set<string>();
        activeTenantsByLock.set(resolvedKey, tenantSet);
      }
      tenantSet.add(opts.userId);
    }
    return {
      acquired: true,
      pid: payload.pid,
      instanceUuid: payload.instanceUuid,
      lockInfo: payload,
    };
  }

  // File exists: inspect existing lock info
  let existingLock = getDaemonLockInfo(lockFileName);

  // TOCTOU defense: if file is 0-byte or unparseable and was modified within the last 2000ms,
  // another process is currently writing its payload. Wait with backoff before declaring stale.
  if (!existingLock && fs.existsSync(lockFilePath)) {
    try {
      const stat = fs.statSync(lockFilePath);
      if (Date.now() - stat.mtimeMs < 2000) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const delayStart = Date.now();
          while (Date.now() - delayStart < 35) {} // 35ms synchronous backoff
          existingLock = getDaemonLockInfo(lockFileName);
          if (existingLock) break;
        }
      }
    } catch {
      // File may have been removed or changed
    }
  }

  const existingPid = existingLock?.pid;
  const active = existingPid ? isProcessActive(existingPid) : false;

  if (active) {
    // If the active process holding the lock is the CURRENT process itself (process.pid):
    // This is NOT a collision with another daemon; it is the same node process managing multiple tenants.
    if (existingPid === process.pid) {
      if (existingLock) {
        activeLocks.set(resolvedKey, existingLock);
        if (lockFileName === DEFAULT_LOCK_FILE_NAME) {
          activeLockPayload = existingLock;
        }
      }
      if (opts && typeof opts === "object" && "userId" in opts && opts.userId) {
        let tenantSet = activeTenantsByLock.get(resolvedKey);
        if (!tenantSet) {
          tenantSet = new Set<string>();
          activeTenantsByLock.set(resolvedKey, tenantSet);
        }
        tenantSet.add(opts.userId);
      }
      return {
        acquired: true,
        pid: process.pid,
        instanceUuid: existingLock?.instanceUuid,
        lockInfo: existingLock || undefined,
      };
    }

    const errorMsg = `Lockfile collision: Daemon already running under PID ${existingPid}${
      existingLock?.startedAt ? ` (started at ${new Date(existingLock.startedAt).toISOString()})` : ""
    }`;
    if (throwOnCollision) {
      throw new LockCollisionError(existingPid!, errorMsg, existingLock || undefined);
    }
    return {
      acquired: false,
      pid: existingPid,
      error: errorMsg,
      lockInfo: existingLock || undefined,
    };
  }

  // PID is dead or invalid -> Stale lock recovery
  console.warn(
    `[DAEMON LOCK] Detected stale lockfile for dead PID ${existingPid || "unknown"} at ${lockFilePath}. Verifying before stale lock cleanup...`
  );

  // TOCTOU Race Defense: Re-verify lock on disk before unlinking to prevent clobbering another process
  if (fs.existsSync(lockFilePath)) {
    const currentOnDisk = getDaemonLockInfo(lockFileName);
    if (currentOnDisk) {
      // Re-verify that the file on disk still belongs to the dead PID and exact instanceUuid we evaluated
      const matchesOriginalStale =
        Boolean(existingLock) &&
        currentOnDisk.pid === existingPid &&
        currentOnDisk.instanceUuid === existingLock?.instanceUuid;

      if (!matchesOriginalStale) {
        // The lock was modified or acquired by another process between detection and unlinking
        const activePid = currentOnDisk.pid || 0;
        const collisionMsg = `Lockfile collision: Daemon lock changed during stale recovery; active under PID ${activePid}${
          currentOnDisk.startedAt ? ` (started at ${new Date(currentOnDisk.startedAt).toISOString()})` : ""
        }`;
        if (throwOnCollision) {
          throw new LockCollisionError(activePid, collisionMsg, currentOnDisk);
        }
        return {
          acquired: false,
          pid: activePid,
          error: collisionMsg,
          lockInfo: currentOnDisk,
        };
      }
    } else if (existingLock) {
      // We had a valid stale lock earlier, but now the file is unparseable or being written by another process
      try {
        const stat = fs.statSync(lockFilePath);
        if (Date.now() - stat.mtimeMs < 2000) {
          const collisionMsg = `Lockfile collision: Daemon lock currently being updated by another process`;
          if (throwOnCollision) {
            throw new LockCollisionError(0, collisionMsg);
          }
          return {
            acquired: false,
            pid: 0,
            error: collisionMsg,
          };
        }
      } catch {
        // File may have been unlinked in the interim; proceed to openSync('wx')
      }
    }
  }

  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch (unlinkErr: any) {
    console.warn(`[DAEMON LOCK] Could not unlink stale lock: ${unlinkErr.message}`);
  }

  // Atomic retry after stale lock cleanup
  let retryFd: number | null = null;
  try {
    retryFd = fs.openSync(lockFilePath, "wx");
  } catch (retryErr: any) {
    if (retryErr.code === "EEXIST") {
      // Race condition: another process acquired it in the interim
      const rechecked = getDaemonLockInfo(lockFileName);
      const recheckedPid = rechecked?.pid || 0;
      const collisionMsg = `Lockfile collision: Daemon already running under PID ${recheckedPid}`;
      if (throwOnCollision) {
        throw new LockCollisionError(recheckedPid, collisionMsg, rechecked || undefined);
      }
      return {
        acquired: false,
        pid: recheckedPid,
        error: collisionMsg,
        lockInfo: rechecked || undefined,
      };
    }
    throw retryErr;
  }

  const payload: DaemonLockPayload = {
    pid: process.pid,
    startedAt: Date.now(),
    heartbeat: Date.now(),
    hostname: os.hostname(),
    platform: process.platform,
    instanceUuid: crypto.randomUUID(),
  };
  try {
    fs.writeFileSync(retryFd, JSON.stringify(payload, null, 2), "utf-8");
  } finally {
    fs.closeSync(retryFd);
  }
  activeLocks.set(resolvedKey, payload);
  if (lockFileName === DEFAULT_LOCK_FILE_NAME) {
    activeLockPayload = payload;
  }
  if (opts && typeof opts === "object" && "userId" in opts && opts.userId) {
    let tenantSet = activeTenantsByLock.get(resolvedKey);
    if (!tenantSet) {
      tenantSet = new Set<string>();
      activeTenantsByLock.set(resolvedKey, tenantSet);
    }
    tenantSet.add(opts.userId);
  }
  return {
    acquired: true,
    pid: payload.pid,
    instanceUuid: payload.instanceUuid,
    lockInfo: payload,
  };
}

/**
 * Reference-counted daemon lock release for multi-tenant isolation.
 * Unregisters the specified tenant and only unlinks the physical OS lockfile
 * if zero active tenants remain.
 */
export function releaseDaemonLockForTenant(
  userId: string,
  opts?: DaemonLockOptions
): { released: boolean; remainingTenants: number } {
  const { lockFileName, force } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  let tenantSet = activeTenantsByLock.get(resolvedKey);
  if (!tenantSet) {
    tenantSet = new Set<string>();
    activeTenantsByLock.set(resolvedKey, tenantSet);
  }

  // Remove the tenant from the active registry
  tenantSet.delete(userId);

  // Check if remainingTenants was explicitly passed in opts
  let remainingCount = tenantSet.size;
  if (
    opts &&
    typeof opts === "object" &&
    "remainingTenants" in opts &&
    typeof (opts as any).remainingTenants === "number"
  ) {
    remainingCount = Math.max(0, (opts as any).remainingTenants);
  }

  const cleanOpts = typeof opts === "object" ? { ...opts, userId: undefined } : opts;

  // If force flag is enabled, unlink immediately regardless of active tenants
  if (force) {
    const released = releaseDaemonLock(cleanOpts);
    activeTenantsByLock.delete(resolvedKey);
    return { released, remainingTenants: 0 };
  }

  // If other active tenants are still running, leave the physical OS lockfile intact
  if (remainingCount > 0) {
    return {
      released: false,
      remainingTenants: remainingCount,
    };
  }

  // Zero active tenants remaining -> unlink the physical OS lockfile
  const released = releaseDaemonLock(cleanOpts);
  activeTenantsByLock.delete(resolvedKey);

  return {
    released,
    remainingTenants: 0,
  };
}

/**
 * Acquires or joins the daemon lock for a specific tenant.
 * If the lock is already held by the current process, registers the tenant into the reference counter.
 */
export function acquireDaemonLockForTenant(
  userId: string,
  opts?: DaemonLockOptions
): AcquireLockResult & { registeredTenants: number } {
  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  let lockResult: AcquireLockResult;

  if (!isDaemonLockHeldByCurrentProcess(opts)) {
    lockResult = acquireDaemonLock(opts);
    if (!lockResult.acquired) {
      const tenantSet = activeTenantsByLock.get(resolvedKey);
      return {
        ...lockResult,
        registeredTenants: tenantSet ? tenantSet.size : 0,
      };
    }
  } else {
    const payload = activeLocks.get(resolvedKey) || (lockFileName === DEFAULT_LOCK_FILE_NAME ? activeLockPayload : null);
    lockResult = {
      acquired: true,
      pid: payload?.pid || process.pid,
      instanceUuid: payload?.instanceUuid,
      lockInfo: payload || undefined,
    };
  }

  let tenantSet = activeTenantsByLock.get(resolvedKey);
  if (!tenantSet) {
    tenantSet = new Set<string>();
    activeTenantsByLock.set(resolvedKey, tenantSet);
  }
  tenantSet.add(userId);

  return {
    ...lockResult,
    registeredTenants: tenantSet.size,
  };
}

/**
 * Registers an active tenant ID for reference-counted daemon lock management.
 */
export function registerTenantForDaemonLock(
  userId: string,
  opts?: DaemonLockOptions
): number {
  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  let tenantSet = activeTenantsByLock.get(resolvedKey);
  if (!tenantSet) {
    tenantSet = new Set<string>();
    activeTenantsByLock.set(resolvedKey, tenantSet);
  }
  tenantSet.add(userId);
  return tenantSet.size;
}

/**
 * Unregisters an active tenant ID from reference-counted daemon lock management.
 */
export function unregisterTenantForDaemonLock(
  userId: string,
  opts?: DaemonLockOptions
): number {
  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  const tenantSet = activeTenantsByLock.get(resolvedKey);
  if (tenantSet) {
    tenantSet.delete(userId);
    return tenantSet.size;
  }
  return 0;
}

/**
 * Returns an array of tenant IDs currently registered on the specified daemon lock.
 */
export function getActiveTenantsForDaemonLock(opts?: DaemonLockOptions): string[] {
  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  const tenantSet = activeTenantsByLock.get(resolvedKey);
  return tenantSet ? Array.from(tenantSet) : [];
}

/**
 * Synchronizes or resets the active tenant IDs registered on the specified daemon lock.
 */
export function syncActiveTenantsForDaemonLock(
  tenantIds: string[],
  opts?: DaemonLockOptions
): number {
  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  const tenantSet = new Set<string>(tenantIds);
  activeTenantsByLock.set(resolvedKey, tenantSet);
  return tenantSet.size;
}

/**
 * Releases the daemon lock by unlinking the lockfile,
 * IF AND ONLY IF the lock is held by the current process PID and instanceUuid.
 */
export function releaseDaemonLock(opts?: DaemonLockOptions): boolean {
  // If opts specifies a tenant without force, route through reference-counted tenant release
  if (
    opts &&
    typeof opts === "object" &&
    "userId" in opts &&
    typeof (opts as any).userId === "string" &&
    (opts as any).userId.trim() !== "" &&
    !(opts as any).force
  ) {
    const tenantId = (opts as any).userId;
    const cleanOpts = { ...opts, userId: undefined };
    return releaseDaemonLockForTenant(tenantId, cleanOpts).released;
  }

  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  // Stop heartbeat timer if active
  stopHeartbeatCron(lockFileName);

  try {
    if (!fs.existsSync(lockFilePath)) {
      activeLocks.delete(resolvedKey);
      activeTenantsByLock.delete(resolvedKey);
      if (lockFileName === DEFAULT_LOCK_FILE_NAME) {
        activeLockPayload = null;
      }
      return true;
    }

    const raw = fs.readFileSync(lockFilePath, "utf-8");
    const data = JSON.parse(raw) as DaemonLockPayload;

    const activePayload = activeLocks.get(resolvedKey) || (lockFileName === DEFAULT_LOCK_FILE_NAME ? activeLockPayload : null);

    // Strict conjunction: Must match BOTH active process PID AND instanceUuid
    const isCurrentHolder = Boolean(
      activePayload &&
      data.pid === process.pid &&
      data.instanceUuid === activePayload.instanceUuid
    );

    if (isCurrentHolder) {
      fs.unlinkSync(lockFilePath);
      activeLocks.delete(resolvedKey);
      activeTenantsByLock.delete(resolvedKey);
      if (lockFileName === DEFAULT_LOCK_FILE_NAME) {
        activeLockPayload = null;
      }
      return true;
    }

    // Lock is held by another process or instance; do not unlink!
    return false;
  } catch (err: any) {
    return false;
  }
}

/**
 * Updates the lockfile's heartbeat timestamp to the current time.
 * Only updates if held by the current process.
 */
export function updateDaemonLockHeartbeat(opts?: DaemonLockOptions): boolean {
  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);
  const activePayload = activeLocks.get(resolvedKey) || (lockFileName === DEFAULT_LOCK_FILE_NAME ? activeLockPayload : null);

  try {
    if (!fs.existsSync(lockFilePath) || !activePayload) {
      return false;
    }

    const raw = fs.readFileSync(lockFilePath, "utf-8");
    const data = JSON.parse(raw) as DaemonLockPayload;

    if (
      data.pid === process.pid &&
      data.instanceUuid === activePayload.instanceUuid
    ) {
      data.heartbeat = Date.now();
      fs.writeFileSync(lockFilePath, JSON.stringify(data, null, 2), "utf-8");
      activePayload.heartbeat = data.heartbeat;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Force cleanup of stale lock if PID is dead.
 */
export function clearStaleDaemonLock(opts?: DaemonLockOptions): boolean {
  const { lockFileName } = parseLockOptions(opts);
  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  try {
    if (!fs.existsSync(lockFilePath)) return true;
    const info = getDaemonLockInfo(lockFileName);
    if (!info || !info.pid || !isProcessActive(info.pid)) {
      // Re-verify before unlinking to prevent clobbering an active lock acquired concurrently
      const rechecked = getDaemonLockInfo(lockFileName);
      if (rechecked && rechecked.pid && isProcessActive(rechecked.pid)) {
        return false;
      }
      fs.unlinkSync(lockFilePath);
      activeLocks.delete(resolvedKey);
      activeTenantsByLock.delete(resolvedKey);
      if (lockFileName === DEFAULT_LOCK_FILE_NAME) {
        activeLockPayload = null;
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Starts a recurring background cron timer that updates the lockfile heartbeat.
 * Default cadence: 10,000ms.
 */
export function startHeartbeatCron(
  opts?: DaemonLockOptions | HeartbeatCronOptions,
  intervalMs: number = 10_000
): NodeJS.Timeout | null {
  const lockFileName = typeof opts === "string"
    ? opts
    : (opts && typeof opts === "object" && "lockFileName" in opts && opts.lockFileName ? opts.lockFileName : DEFAULT_LOCK_FILE_NAME);

  const resolvedInterval = (opts && typeof opts === "object" && "intervalMs" in opts && typeof opts.intervalMs === "number")
    ? opts.intervalMs
    : intervalMs;

  const lockFilePath = getDaemonLockFilePath(lockFileName);
  const resolvedKey = path.resolve(lockFilePath);

  // Stop any existing heartbeat cron for this lock file to prevent leaks
  stopHeartbeatCron(lockFileName);

  // Only start cron if we currently hold the lock
  if (!isDaemonLockHeldByCurrentProcess(lockFileName)) {
    return null;
  }

  // Initial immediate heartbeat update
  updateDaemonLockHeartbeat(lockFileName);

  const timer = setInterval(() => {
    try {
      if (!isDaemonLockHeldByCurrentProcess(lockFileName)) {
        stopHeartbeatCron(lockFileName);
        return;
      }
      updateDaemonLockHeartbeat(lockFileName);
    } catch (err: any) {
      console.warn(`[DAEMON LOCK] Heartbeat cron error for ${lockFileName}:`, err.message);
    }
  }, resolvedInterval);

  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }

  heartbeatTimers.set(resolvedKey, timer);
  return timer;
}

/**
 * Stops the recurring heartbeat cron timer for the specified lockfile.
 */
export function stopHeartbeatCron(opts?: DaemonLockOptions): boolean {
  const lockFilePath = getDaemonLockFilePath(opts);
  const resolvedKey = path.resolve(lockFilePath);

  const timer = heartbeatTimers.get(resolvedKey);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(resolvedKey);
    return true;
  }
  return false;
}

/**
 * Releases all locks held by the current process across all filenames.
 */
function releaseAllHeldLocks(): void {
  for (const [resolvedKey, payload] of Array.from(activeLocks.entries())) {
    try {
      if (fs.existsSync(resolvedKey)) {
        const raw = fs.readFileSync(resolvedKey, "utf-8");
        const data = JSON.parse(raw) as DaemonLockPayload;
        if (data.pid === process.pid && data.instanceUuid === payload.instanceUuid) {
          fs.unlinkSync(resolvedKey);
        }
      }
    } catch {}
    activeLocks.delete(resolvedKey);
    activeTenantsByLock.delete(resolvedKey);
  }

  for (const [resolvedKey, timer] of Array.from(heartbeatTimers.entries())) {
    try {
      clearInterval(timer);
    } catch {}
    heartbeatTimers.delete(resolvedKey);
  }

  activeLockPayload = null;
}

/**
 * Registers process lifecycle exit handlers to clean up all lockfiles automatically.
 */
export function registerDaemonLifecycleHooks(): void {
  if (lifecycleHooksRegistered) return;
  lifecycleHooksRegistered = true;

  process.on("exit", () => {
    try {
      releaseAllHeldLocks();
    } catch {}
  });

  process.on("SIGINT", () => {
    try {
      releaseAllHeldLocks();
    } catch {}
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    try {
      releaseAllHeldLocks();
    } catch {}
    process.exit(0);
  });
}

// Auto-register lifecycle hooks on module load
registerDaemonLifecycleHooks();
