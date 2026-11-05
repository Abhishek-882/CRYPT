import fs from "fs";
import os from "os";
import crypto from "crypto";
import { resolveDataFilePath } from "./storagePath";

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

let activeLockPayload: DaemonLockPayload | null = null;
let lifecycleHooksRegistered = false;

/**
 * Checks whether a process with the given PID is currently active on the host OS.
 * Uses process.kill(pid, 0) cross-platform signal test:
 * - Returns true if the process is alive.
 * - Returns true on EPERM (process exists across privilege barrier).
 * - Returns false on ESRCH or invalid PID (process is dead).
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
 * Resolves the absolute path to bot_daemon.lock via bulletproof storagePath resolver.
 */
export function getDaemonLockFilePath(): string {
  return resolveDataFilePath("bot_daemon.lock");
}

/**
 * Reads the current lockfile metadata if it exists on disk.
 */
export function getDaemonLockInfo(): DaemonLockPayload | null {
  const lockFilePath = getDaemonLockFilePath();
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
 * Checks if the daemon lock is actively held by a live OS process.
 */
export function isDaemonLocked(): boolean {
  const info = getDaemonLockInfo();
  if (!info || !info.pid) return false;
  return isProcessActive(info.pid);
}

/**
 * Checks if the daemon lock is currently held by this specific running process.
 */
export function isDaemonLockHeldByCurrentProcess(): boolean {
  if (!activeLockPayload) return false;
  const info = getDaemonLockInfo();
  return Boolean(
    info &&
    info.pid === process.pid &&
    info.instanceUuid === activeLockPayload.instanceUuid
  );
}

/**
 * Acquires exclusive kernel-level file lock (bot_daemon.lock).
 * Uses fs.openSync with flag 'wx' (O_CREAT | O_EXCL) for atomic kernel exclusivity.
 *
 * If the lockfile already exists:
 * - If PID is active -> throws LockCollisionError (or returns failure if throwOnCollision === false).
 * - If PID is dead (ESRCH) -> cleans stale lock, atomically re-acquires, and logs warning.
 */
export function acquireDaemonLock(options?: {
  throwOnCollision?: boolean;
  force?: boolean;
}): {
  acquired: boolean;
  pid?: number;
  instanceUuid?: string;
  error?: string;
  lockInfo?: DaemonLockPayload;
} {
  const throwOnCollision = options?.throwOnCollision ?? true;
  const lockFilePath = getDaemonLockFilePath();

  // Register process lifecycle hooks once
  registerDaemonLifecycleHooks();

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
    activeLockPayload = payload;
    return {
      acquired: true,
      pid: payload.pid,
      instanceUuid: payload.instanceUuid,
      lockInfo: payload,
    };
  }

  // File exists: inspect existing lock info
  let existingLock = getDaemonLockInfo();

  // TOCTOU defense: if file is 0-byte or unparseable and was modified within the last 2000ms,
  // another process is currently writing its payload. Wait with backoff before declaring stale.
  if (!existingLock && fs.existsSync(lockFilePath)) {
    try {
      const stat = fs.statSync(lockFilePath);
      if (Date.now() - stat.mtimeMs < 2000) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const delayStart = Date.now();
          while (Date.now() - delayStart < 35) {} // 35ms synchronous backoff
          existingLock = getDaemonLockInfo();
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
    `[DAEMON LOCK] Detected stale lockfile for dead PID ${existingPid || "unknown"}. Removing stale lock and re-acquiring...`
  );
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
      const rechecked = getDaemonLockInfo();
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
  activeLockPayload = payload;
  return {
    acquired: true,
    pid: payload.pid,
    instanceUuid: payload.instanceUuid,
    lockInfo: payload,
  };
}

/**
 * Releases the daemon lock by unlinking bot_daemon.lock,
 * IF AND ONLY IF the lock is held by the current process PID and instanceUuid.
 */
export function releaseDaemonLock(): boolean {
  const lockFilePath = getDaemonLockFilePath();
  try {
    if (!fs.existsSync(lockFilePath)) {
      activeLockPayload = null;
      return true;
    }

    const raw = fs.readFileSync(lockFilePath, "utf-8");
    const data = JSON.parse(raw) as DaemonLockPayload;

    // Strict conjunction: Must match BOTH active process PID AND instanceUuid
    const isCurrentHolder = Boolean(
      activeLockPayload &&
      data.pid === process.pid &&
      data.instanceUuid === activeLockPayload.instanceUuid
    );

    if (isCurrentHolder) {
      fs.unlinkSync(lockFilePath);
      activeLockPayload = null;
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
export function updateDaemonLockHeartbeat(): boolean {
  const lockFilePath = getDaemonLockFilePath();
  try {
    if (!fs.existsSync(lockFilePath) || !activeLockPayload) {
      return false;
    }

    const raw = fs.readFileSync(lockFilePath, "utf-8");
    const data = JSON.parse(raw) as DaemonLockPayload;

    if (
      data.pid === process.pid &&
      data.instanceUuid === activeLockPayload.instanceUuid
    ) {
      data.heartbeat = Date.now();
      fs.writeFileSync(lockFilePath, JSON.stringify(data, null, 2), "utf-8");
      activeLockPayload.heartbeat = data.heartbeat;
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
export function clearStaleDaemonLock(): boolean {
  const lockFilePath = getDaemonLockFilePath();
  try {
    if (!fs.existsSync(lockFilePath)) return true;
    const info = getDaemonLockInfo();
    if (!info || !info.pid || !isProcessActive(info.pid)) {
      fs.unlinkSync(lockFilePath);
      activeLockPayload = null;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Registers process lifecycle exit handlers to clean up the lockfile automatically.
 */
export function registerDaemonLifecycleHooks(): void {
  if (lifecycleHooksRegistered) return;
  lifecycleHooksRegistered = true;

  process.on("exit", () => {
    try {
      releaseDaemonLock();
    } catch {}
  });

  process.on("SIGINT", () => {
    try {
      releaseDaemonLock();
    } catch {}
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    try {
      releaseDaemonLock();
    } catch {}
    process.exit(0);
  });
}

// Auto-register lifecycle hooks on module load
registerDaemonLifecycleHooks();
