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
  acquireDaemonLockForTenant,
  releaseDaemonLockForTenant,
  registerTenantForDaemonLock,
  unregisterTenantForDaemonLock,
  getActiveTenantsForDaemonLock,
  syncActiveTenantsForDaemonLock,
  updateDaemonLockHeartbeat,
  clearStaleDaemonLock,
  getDaemonLockInfo,
  getDaemonLockFilePath,
  isDaemonLocked,
  isDaemonLockHeldByCurrentProcess,
  LockCollisionError,
} from "@/lib/daemonLockManager";
import { POST as botDaemonPostRoute } from "@/app/api/bot/daemon/route";

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

  describe("Multi-Tenant Reference-Counted Daemon Lock Scoping", () => {
    it("should retain active daemon lock when one tenant stops while others continue running", () => {
      // Tenant A starts and acquires host daemon lock
      const lockA = acquireDaemonLockForTenant("usr_tenant_alpha");
      expect(lockA.acquired).toBe(true);
      expect(lockA.registeredTenants).toBe(1);
      expect(fs.existsSync(lockFilePath)).toBe(true);
      expect(isDaemonLocked()).toBe(true);

      // Tenant B starts and joins existing host daemon lock
      const lockB = acquireDaemonLockForTenant("usr_tenant_beta");
      expect(lockB.acquired).toBe(true);
      expect(lockB.registeredTenants).toBe(2);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Tenant A stops: lock must remain active because Tenant B is still running
      const releaseA = releaseDaemonLockForTenant("usr_tenant_alpha");
      expect(releaseA.released).toBe(false);
      expect(releaseA.remainingTenants).toBe(1);
      expect(fs.existsSync(lockFilePath)).toBe(true);
      expect(isDaemonLocked()).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess()).toBe(true);

      // Tenant B stops: zero active tenants remain -> physical lockfile unlinked
      const releaseB = releaseDaemonLockForTenant("usr_tenant_beta");
      expect(releaseB.released).toBe(true);
      expect(releaseB.remainingTenants).toBe(0);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked()).toBe(false);
      expect(isDaemonLockHeldByCurrentProcess()).toBe(false);
    });

    it("should correctly track active tenants through register, unregister, and sync helpers", () => {
      acquireDaemonLock();
      expect(getActiveTenantsForDaemonLock()).toEqual([]);

      expect(registerTenantForDaemonLock("usr_tenant_1")).toBe(1);
      expect(registerTenantForDaemonLock("usr_tenant_2")).toBe(2);
      expect(registerTenantForDaemonLock("usr_tenant_3")).toBe(3);
      expect(getActiveTenantsForDaemonLock()).toEqual([
        "usr_tenant_1",
        "usr_tenant_2",
        "usr_tenant_3",
      ]);

      expect(unregisterTenantForDaemonLock("usr_tenant_2")).toBe(2);
      expect(getActiveTenantsForDaemonLock()).toEqual([
        "usr_tenant_1",
        "usr_tenant_3",
      ]);

      syncActiveTenantsForDaemonLock(["usr_tenant_x", "usr_tenant_y"]);
      expect(getActiveTenantsForDaemonLock()).toEqual([
        "usr_tenant_x",
        "usr_tenant_y",
      ]);

      const relX = releaseDaemonLockForTenant("usr_tenant_x");
      expect(relX.released).toBe(false);
      expect(relX.remainingTenants).toBe(1);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      const relY = releaseDaemonLockForTenant("usr_tenant_y");
      expect(relY.released).toBe(true);
      expect(relY.remainingTenants).toBe(0);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it("should honor remainingTenants override when external tenant engine states are evaluated", () => {
      acquireDaemonLock();
      registerTenantForDaemonLock("usr_tenant_1");

      // Stop tenant 1, but specify that 2 other external tenants are running on disk
      const res = releaseDaemonLockForTenant("usr_tenant_1", { remainingTenants: 2 });
      expect(res.released).toBe(false);
      expect(res.remainingTenants).toBe(2);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Final tenant stops with 0 external remaining tenants -> unlinks
      const finalRes = releaseDaemonLockForTenant("usr_tenant_last", { remainingTenants: 0 });
      expect(finalRes.released).toBe(true);
      expect(finalRes.remainingTenants).toBe(0);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it("should route releaseDaemonLock({ userId }) transparently to reference-counted tenant release", () => {
      acquireDaemonLockForTenant("usr_tenant_A");
      acquireDaemonLockForTenant("usr_tenant_B");

      // Calling releaseDaemonLock with userId for tenant A should not unlink
      const releasedA = releaseDaemonLock({ userId: "usr_tenant_A" });
      expect(releasedA).toBe(false);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Calling releaseDaemonLock with userId for last tenant should unlink
      const releasedB = releaseDaemonLock({ userId: "usr_tenant_B" });
      expect(releasedB).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it("should allow administrative force release regardless of registered active tenants", () => {
      acquireDaemonLockForTenant("usr_tenant_A");
      acquireDaemonLockForTenant("usr_tenant_B");
      acquireDaemonLockForTenant("usr_tenant_C");
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Emergency force release by administrator unlinks immediately
      const forceReleased = releaseDaemonLock({ force: true });
      expect(forceReleased).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked()).toBe(false);
      expect(getActiveTenantsForDaemonLock()).toEqual([]);
    });

    it("should integrate reference-counted lock release with POST /api/bot/daemon route", async () => {
      // Start daemon by acquiring lock for current process
      acquireDaemonLockForTenant("usr_admin_varsha");
      registerTenantForDaemonLock("usr_tenant_other");
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Call POST route with action: 'stop' for admin
      const req = new Request("http://localhost:3000/api/bot/daemon", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cron-secret": "internal_daemon_cron_secret_2026",
        },
        body: JSON.stringify({ action: "stop" }),
      });

      const res = await botDaemonPostRoute(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.isRunning).toBe(false);
      expect(typeof json.remainingActiveTenants).toBe("number");
    });
  });
});
