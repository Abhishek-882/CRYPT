/**
 * Vitest Unit Tests: Kernel Daemon Lock Manager
 * 
 * Verifies OS-level concurrency locking:
 * - Atomic file creation via O_CREAT | O_EXCL ('wx')
 * - Collision rejection with active lock detection
 * - Heartbeat timestamp updates
 * - Safe release with strict ownership verification (PID + UUID)
 * - Anti-hijack protection against foreign processes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import {
  acquireDaemonLock,
  releaseDaemonLock,
  updateDaemonLockHeartbeat,
  clearStaleDaemonLock,
  getDaemonLockInfo,
  getDaemonLockFilePath,
  isDaemonLocked,
  isDaemonLockHeldByCurrentProcess,
  LockCollisionError,
} from "@/lib/daemonLockManager";

describe("DaemonLockManager Kernel Concurrency Engine", () => {
  const lockFilePath = getDaemonLockFilePath();

  beforeEach(() => {
    // Ensure clean state before each test
    try {
      releaseDaemonLock();
    } catch {
      // ignore
    }
    if (fs.existsSync(lockFilePath)) {
      try {
        fs.unlinkSync(lockFilePath);
      } catch {
        // ignore
      }
    }
  });

  afterEach(() => {
    try {
      releaseDaemonLock();
    } catch {
      // ignore
    }
    if (fs.existsSync(lockFilePath)) {
      try {
        fs.unlinkSync(lockFilePath);
      } catch {
        // ignore
      }
    }
  });

  it("should acquire lock cleanly when no lockfile exists", () => {
    const result = acquireDaemonLock({ throwOnCollision: false });
    expect(result.acquired).toBe(true);
    expect(result.pid).toBe(process.pid);
    expect(result.instanceUuid).toBeDefined();
    expect(typeof result.instanceUuid).toBe("string");
    expect(fs.existsSync(lockFilePath)).toBe(true);
    expect(isDaemonLocked()).toBe(true);
    expect(isDaemonLockHeldByCurrentProcess()).toBe(true);
  });

  it("should reject duplicate lock acquisition within the same or conflicting process", () => {
    const first = acquireDaemonLock({ throwOnCollision: false });
    expect(first.acquired).toBe(true);

    // Second attempt should fail
    const second = acquireDaemonLock({ throwOnCollision: false });
    expect(second.acquired).toBe(false);
    expect(second.error).toContain("Lockfile collision");

    // Second attempt with throwOnCollision should throw LockCollisionError
    expect(() => {
      acquireDaemonLock({ throwOnCollision: true });
    }).toThrow(LockCollisionError);
  });

  it("should update daemon heartbeat without altering PID or instanceUuid", () => {
    const initial = acquireDaemonLock({ throwOnCollision: false });
    expect(initial.acquired).toBe(true);

    const infoBefore = getDaemonLockInfo();
    expect(infoBefore).not.toBeNull();
    const initialHeartbeat = infoBefore!.heartbeat;

    // Call updateDaemonLockHeartbeat
    const updated = updateDaemonLockHeartbeat();
    expect(updated).toBe(true);

    const infoAfter = getDaemonLockInfo();
    expect(infoAfter).not.toBeNull();
    expect(infoAfter!.pid).toBe(process.pid);
    expect(infoAfter!.instanceUuid).toBe(initial.instanceUuid);
    expect(infoAfter!.heartbeat).toBeGreaterThanOrEqual(initialHeartbeat);
  });

  it("should release lock safely when owned by current process", () => {
    const lock = acquireDaemonLock({ throwOnCollision: false });
    expect(lock.acquired).toBe(true);
    expect(fs.existsSync(lockFilePath)).toBe(true);

    const released = releaseDaemonLock();
    expect(released).toBe(true);
    expect(fs.existsSync(lockFilePath)).toBe(false);
    expect(isDaemonLocked()).toBe(false);
    expect(isDaemonLockHeldByCurrentProcess()).toBe(false);
  });

  it("should refuse to release lock if owned by a foreign process (anti-hijack invariant)", () => {
    // Write fake lock belonging to foreign PID
    const foreignPayload = {
      pid: 999999, // Highly improbable foreign PID
      startedAt: Date.now(),
      heartbeat: Date.now(),
      hostname: "foreign-host",
      platform: "linux",
      instanceUuid: "foreign-uuid-12345",
    };
    fs.writeFileSync(lockFilePath, JSON.stringify(foreignPayload));

    // Release should return false because current process does not own it
    const normalRelease = releaseDaemonLock();
    expect(normalRelease).toBe(false);
    expect(fs.existsSync(lockFilePath)).toBe(true);

    // Stale lock cleanup should remove it when foreign PID is dead
    const staleCleaned = clearStaleDaemonLock();
    expect(staleCleaned).toBe(true);
    expect(fs.existsSync(lockFilePath)).toBe(false);
  });
});
