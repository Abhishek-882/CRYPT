/**
 * Vitest Adversarial Stress Test Suite: Reference-Counted Daemon Lock Engine
 * 
 * Specifically challenges:
 * 1. Multi-Tenant Churn Lifecycle (Sequential, Random Order, Multi-Wave Fuzzing)
 * 2. Massive Concurrent Stops (20+ and 50+ Tenants simultaneous release race condition)
 * 3. Mixed Concurrent Churn (Simultaneous Starts and Stops)
 * 4. Edge Cases: Idempotency, Double-Starts, Double-Stops, Phantom Tenants
 * 5. Administrative Emergency Force Release under active multi-tenant load
 * 6. Foreign Process Anti-Hijack Immunity under multi-tenant load
 * 7. Corrupted JSON Lockfile Crash Recovery under multi-tenant load
 * 8. Stale Dead-PID Lockfile Recovery
 * 9. Transparent Delegation (`releaseDaemonLock({ userId })`) under Multi-Tenant Churn
 * 10. Active Tenant Synchronization (`syncActiveTenantsForDaemonLock`) under Rapid Churn
 * 
 * Strictly uses isolated test lockfile names to guarantee zero interference
 * with host processes or production lockfiles.
 * 
 * Strict compliance: all rates/spreads formatted in % notation exclusively.
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

describe("Adversarial Stress Test: Reference-Counted Daemon Lock Manager", () => {
  const TEST_LOCK_NAME = "test_adversarial_daemon.lock";
  const testLockFilePath = getDaemonLockFilePath(TEST_LOCK_NAME);

  const cleanLock = () => {
    try {
      releaseDaemonLock({ lockFileName: TEST_LOCK_NAME, force: true });
    } catch {
      // ignore
    }
    if (fs.existsSync(testLockFilePath)) {
      try {
        fs.unlinkSync(testLockFilePath);
      } catch {
        // ignore
      }
    }
  };

  beforeEach(() => {
    cleanLock();
  });

  afterEach(() => {
    cleanLock();
  });

  // =========================================================================
  // SECTION 1: Multi-Tenant Churn Lifecycle
  // =========================================================================
  describe("Multi-Tenant Churn Lifecycle", () => {
    it("should strictly hold lock across sequential stops of Tenants A and B, unlinking ONLY when Tenant C stops", () => {
      const tenantA = "usr_tenant_alpha";
      const tenantB = "usr_tenant_beta";
      const tenantC = "usr_tenant_gamma";

      // 1. Tenant A starts
      const lockA = acquireDaemonLockForTenant(tenantA, { lockFileName: TEST_LOCK_NAME });
      expect(lockA.acquired).toBe(true);
      expect(lockA.registeredTenants).toBe(1);
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(TEST_LOCK_NAME)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([tenantA]);

      // 2. Tenant B starts
      const lockB = acquireDaemonLockForTenant(tenantB, { lockFileName: TEST_LOCK_NAME });
      expect(lockB.acquired).toBe(true);
      expect(lockB.registeredTenants).toBe(2);
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([tenantA, tenantB]);

      // 3. Tenant C starts
      const lockC = acquireDaemonLockForTenant(tenantC, { lockFileName: TEST_LOCK_NAME });
      expect(lockC.acquired).toBe(true);
      expect(lockC.registeredTenants).toBe(3);
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([tenantA, tenantB, tenantC]);

      // 4. Tenant A stops -> LOCK MUST REMAIN HELD
      const releaseA = releaseDaemonLockForTenant(tenantA, { lockFileName: TEST_LOCK_NAME });
      expect(releaseA.released).toBe(false);
      expect(releaseA.remainingTenants).toBe(2);
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(TEST_LOCK_NAME)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([tenantB, tenantC]);

      // 5. Tenant B stops -> LOCK MUST REMAIN HELD
      const releaseB = releaseDaemonLockForTenant(tenantB, { lockFileName: TEST_LOCK_NAME });
      expect(releaseB.released).toBe(false);
      expect(releaseB.remainingTenants).toBe(1);
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(TEST_LOCK_NAME)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([tenantC]);

      // 6. Tenant C stops -> LOCK MUST BE CLEANLY UNLINKED
      const releaseC = releaseDaemonLockForTenant(tenantC, { lockFileName: TEST_LOCK_NAME });
      expect(releaseC.released).toBe(true);
      expect(releaseC.remainingTenants).toBe(0);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(false);
      expect(isDaemonLockHeldByCurrentProcess(TEST_LOCK_NAME)).toBe(false);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([]);

      // 7. Tenant D starts after clean unlink -> verifies new lock cycle works smoothly
      const tenantD = "usr_tenant_delta";
      const lockD = acquireDaemonLockForTenant(tenantD, { lockFileName: TEST_LOCK_NAME });
      expect(lockD.acquired).toBe(true);
      expect(lockD.registeredTenants).toBe(1);
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(true);

      const releaseD = releaseDaemonLockForTenant(tenantD, { lockFileName: TEST_LOCK_NAME });
      expect(releaseD.released).toBe(true);
      expect(releaseD.remainingTenants).toBe(0);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
    });

    it("should survive 10 consecutive churn waves with randomized tenant departure orders", () => {
      const WAVES = 10;

      for (let wave = 1; wave <= WAVES; wave++) {
        const tenantCount = 3 + (wave % 3); // 3, 4, or 5 tenants
        const tenants = Array.from({ length: tenantCount }, (_, i) => `wave_${wave}_tenant_${i}`);

        // All tenants acquire lock
        for (let i = 0; i < tenants.length; i++) {
          const res = acquireDaemonLockForTenant(tenants[i], { lockFileName: TEST_LOCK_NAME });
          expect(res.acquired).toBe(true);
          expect(res.registeredTenants).toBe(i + 1);
          expect(fs.existsSync(testLockFilePath)).toBe(true);
        }

        // Shuffle tenants to simulate arbitrary stop orders
        const departureOrder = [...tenants].sort(() => Math.random() - 0.5);

        for (let i = 0; i < departureOrder.length; i++) {
          const tenant = departureOrder[i];
          const isLastTenant = i === departureOrder.length - 1;
          const expectedRemaining = departureOrder.length - 1 - i;

          const res = releaseDaemonLockForTenant(tenant, { lockFileName: TEST_LOCK_NAME });
          expect(res.remainingTenants).toBe(expectedRemaining);

          if (!isLastTenant) {
            expect(res.released).toBe(false);
            expect(fs.existsSync(testLockFilePath)).toBe(true);
            expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(true);
          } else {
            expect(res.released).toBe(true);
            expect(fs.existsSync(testLockFilePath)).toBe(false);
            expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(false);
            expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([]);
          }
        }
      }
    });

    it("should support transparent delegation via releaseDaemonLock({ userId }) during churn", () => {
      acquireDaemonLockForTenant("del_tenant_1", { lockFileName: TEST_LOCK_NAME });
      acquireDaemonLockForTenant("del_tenant_2", { lockFileName: TEST_LOCK_NAME });

      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME).length).toBe(2);

      // Delegated stop for tenant 1
      const res1 = releaseDaemonLock({ userId: "del_tenant_1", lockFileName: TEST_LOCK_NAME });
      expect(res1).toBe(false); // Lock not unlinked because tenant 2 is active
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual(["del_tenant_2"]);

      // Delegated stop for tenant 2 (last tenant)
      const res2 = releaseDaemonLock({ userId: "del_tenant_2", lockFileName: TEST_LOCK_NAME });
      expect(res2).toBe(true); // Lock unlinked cleanly
      expect(fs.existsSync(testLockFilePath)).toBe(false);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([]);
    });

    it("should maintain lock consistency during bulk synchronization (syncActiveTenantsForDaemonLock)", () => {
      acquireDaemonLock({ lockFileName: TEST_LOCK_NAME });
      expect(fs.existsSync(testLockFilePath)).toBe(true);

      syncActiveTenantsForDaemonLock(["sync_1", "sync_2", "sync_3"], { lockFileName: TEST_LOCK_NAME });
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME).length).toBe(3);

      // Re-sync with a subset
      syncActiveTenantsForDaemonLock(["sync_1", "sync_3"], { lockFileName: TEST_LOCK_NAME });
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual(["sync_1", "sync_3"]);

      const rel1 = releaseDaemonLockForTenant("sync_1", { lockFileName: TEST_LOCK_NAME });
      expect(rel1.released).toBe(false);
      expect(fs.existsSync(testLockFilePath)).toBe(true);

      const rel3 = releaseDaemonLockForTenant("sync_3", { lockFileName: TEST_LOCK_NAME });
      expect(rel3.released).toBe(true);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 2: Concurrent Stops Stress Harness
  // =========================================================================
  describe("Concurrent Stops Stress Harness", () => {
    it("should handle 20 simultaneous stop requests without ENOENT, unhandled rejections, or corrupt state", async () => {
      const TENANT_COUNT = 20;
      const tenants = Array.from({ length: TENANT_COUNT }, (_, i) => `concurrent_tenant_${i}`);

      // Register all 20 tenants
      for (const t of tenants) {
        const acq = acquireDaemonLockForTenant(t, { lockFileName: TEST_LOCK_NAME });
        expect(acq.acquired).toBe(true);
      }

      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME).length).toBe(TENANT_COUNT);

      // Concurrently trigger simultaneous stops for all 20 tenants
      const stopPromises = tenants.map((tenantId) => {
        return new Promise<{ tenantId: string; released: boolean; remainingTenants: number; error?: any }>((resolve) => {
          try {
            const result = releaseDaemonLockForTenant(tenantId, { lockFileName: TEST_LOCK_NAME });
            resolve({ tenantId, ...result });
          } catch (err: any) {
            resolve({ tenantId, released: false, remainingTenants: -1, error: err });
          }
        });
      });

      const results = await Promise.all(stopPromises);

      // Verification invariants:
      // 1. None threw an exception or returned an error
      for (const res of results) {
        expect(res.error).toBeUndefined();
      }

      // 2. Exactly one release call performed the physical unlink
      const releasedResults = results.filter((r) => r.released === true);
      expect(releasedResults.length).toBe(1);

      // 3. Exactly 19 calls returned released: false
      const nonReleasedResults = results.filter((r) => r.released === false);
      expect(nonReleasedResults.length).toBe(TENANT_COUNT - 1);

      // 4. Physical lockfile must be completely removed from disk
      expect(fs.existsSync(testLockFilePath)).toBe(false);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(false);
      expect(isDaemonLockHeldByCurrentProcess(TEST_LOCK_NAME)).toBe(false);

      // 5. In-memory tenant registry must be completely clean
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([]);
    });

    it("should sustain high-concurrency swarm of 50 simultaneous stop requests", async () => {
      const TENANT_COUNT = 50;
      const tenants = Array.from({ length: TENANT_COUNT }, (_, i) => `swarm_tenant_${i}`);

      for (const t of tenants) {
        acquireDaemonLockForTenant(t, { lockFileName: TEST_LOCK_NAME });
      }

      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME).length).toBe(TENANT_COUNT);

      const results = await Promise.all(
        tenants.map(async (t) => {
          return releaseDaemonLockForTenant(t, { lockFileName: TEST_LOCK_NAME });
        })
      );

      const unlinks = results.filter((r) => r.released === true);
      expect(unlinks.length).toBe(1);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([]);
    });

    it("should handle simultaneous stops when remainingTenants overrides are passed concurrently", async () => {
      const tenants = ["tenant_A", "tenant_B", "tenant_C", "tenant_D"];
      for (const t of tenants) {
        acquireDaemonLockForTenant(t, { lockFileName: TEST_LOCK_NAME });
      }

      // Simulate concurrent calls where callers evaluate external state
      const results = await Promise.all([
        Promise.resolve().then(() => releaseDaemonLockForTenant("tenant_A", { lockFileName: TEST_LOCK_NAME, remainingTenants: 2 })),
        Promise.resolve().then(() => releaseDaemonLockForTenant("tenant_B", { lockFileName: TEST_LOCK_NAME, remainingTenants: 1 })),
        Promise.resolve().then(() => releaseDaemonLockForTenant("tenant_C", { lockFileName: TEST_LOCK_NAME, remainingTenants: 0 })),
      ]);

      // tenant_C passed remainingTenants: 0 -> it successfully unlinked
      const unlinked = results.find((r) => r.released === true);
      expect(unlinked).toBeDefined();
      expect(fs.existsSync(testLockFilePath)).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 3: Mixed Concurrent Churn (Simultaneous Starts and Stops)
  // =========================================================================
  describe("Mixed Concurrent Churn", () => {
    it("should preserve the lock when 5 tenants stop while 5 new tenants start concurrently", async () => {
      const initialTenants = ["init_1", "init_2", "init_3", "init_4", "init_5"];
      const newTenants = ["new_1", "new_2", "new_3", "new_4", "new_5"];

      for (const t of initialTenants) {
        acquireDaemonLockForTenant(t, { lockFileName: TEST_LOCK_NAME });
      }
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME).length).toBe(5);

      // Concurrently execute 5 stops and 5 starts
      const mixedOps = [
        ...initialTenants.map((t) => () => releaseDaemonLockForTenant(t, { lockFileName: TEST_LOCK_NAME })),
        ...newTenants.map((t) => () => acquireDaemonLockForTenant(t, { lockFileName: TEST_LOCK_NAME })),
      ];

      // Shuffle operations
      mixedOps.sort(() => Math.random() - 0.5);

      const opResults = await Promise.all(mixedOps.map((op) => Promise.resolve().then(op)));

      // Since new tenants joined and registered, lock MUST remain active
      // Invariant: all operations succeeded without throwing
      expect(opResults.length).toBe(10);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(true);
      expect(fs.existsSync(testLockFilePath)).toBe(true);

      // Remaining active tenants must contain the new tenants
      const activeTenants = getActiveTenantsForDaemonLock(TEST_LOCK_NAME);
      for (const nt of newTenants) {
        expect(activeTenants).toContain(nt);
      }
    });
  });

  // =========================================================================
  // SECTION 4: Edge Cases, Idempotency, and Anti-Corruption
  // =========================================================================
  describe("Edge Cases and Robustness", () => {
    it("should gracefully handle a stop request from a tenant that was never registered (phantom tenant)", () => {
      // Lock held by tenant_valid
      acquireDaemonLockForTenant("tenant_valid", { lockFileName: TEST_LOCK_NAME });
      expect(fs.existsSync(testLockFilePath)).toBe(true);

      // Phantom tenant calls stop
      const phantomRes = releaseDaemonLockForTenant("phantom_tenant", { lockFileName: TEST_LOCK_NAME });
      expect(phantomRes.released).toBe(false);
      expect(phantomRes.remainingTenants).toBe(1);
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual(["tenant_valid"]);

      // Calling stop when no lock exists at all
      cleanLock();
      const noLockRes = releaseDaemonLockForTenant("phantom_tenant", { lockFileName: TEST_LOCK_NAME });
      expect(noLockRes.released).toBe(true);
      expect(noLockRes.remainingTenants).toBe(0);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
    });

    it("should be idempotent when a tenant calls start or stop multiple times (double start / double stop)", () => {
      // Double start
      const start1 = acquireDaemonLockForTenant("tenant_repeat", { lockFileName: TEST_LOCK_NAME });
      const start2 = acquireDaemonLockForTenant("tenant_repeat", { lockFileName: TEST_LOCK_NAME });
      expect(start1.acquired).toBe(true);
      expect(start2.acquired).toBe(true);
      // Set deduplication: size must still be 1
      expect(start2.registeredTenants).toBe(1);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual(["tenant_repeat"]);

      // First stop: unlinks cleanly
      const stop1 = releaseDaemonLockForTenant("tenant_repeat", { lockFileName: TEST_LOCK_NAME });
      expect(stop1.released).toBe(true);
      expect(stop1.remainingTenants).toBe(0);
      expect(fs.existsSync(testLockFilePath)).toBe(false);

      // Second stop: safe no-op
      const stop2 = releaseDaemonLockForTenant("tenant_repeat", { lockFileName: TEST_LOCK_NAME });
      expect(stop2.released).toBe(true);
      expect(stop2.remainingTenants).toBe(0);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
    });

    it("should clamp negative remainingTenants options to zero without throwing", () => {
      acquireDaemonLockForTenant("tenant_neg", { lockFileName: TEST_LOCK_NAME });

      const res = releaseDaemonLockForTenant("tenant_neg", {
        lockFileName: TEST_LOCK_NAME,
        remainingTenants: -5,
      });

      expect(res.released).toBe(true);
      expect(res.remainingTenants).toBe(0);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
    });

    it("should enforce immediate physical lock unlinking when administrative force release is executed", () => {
      acquireDaemonLockForTenant("tenant_1", { lockFileName: TEST_LOCK_NAME });
      acquireDaemonLockForTenant("tenant_2", { lockFileName: TEST_LOCK_NAME });
      acquireDaemonLockForTenant("tenant_3", { lockFileName: TEST_LOCK_NAME });
      expect(fs.existsSync(testLockFilePath)).toBe(true);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME).length).toBe(3);

      // Force release
      const res = releaseDaemonLockForTenant("tenant_1", {
        lockFileName: TEST_LOCK_NAME,
        force: true,
      });

      expect(res.released).toBe(true);
      expect(res.remainingTenants).toBe(0);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(false);
      expect(getActiveTenantsForDaemonLock(TEST_LOCK_NAME)).toEqual([]);
    });

    it("should protect lock from being released by a foreign process even if foreign process specifies active tenants", () => {
      // Simulate foreign lockfile on disk
      const foreignPayload = {
        pid: 888888, // Inactive / foreign PID
        startedAt: Date.now(),
        heartbeat: Date.now(),
        hostname: "adversarial-foreign-node",
        platform: "win32",
        instanceUuid: "foreign-uuid-9999",
      };
      fs.writeFileSync(testLockFilePath, JSON.stringify(foreignPayload));

      // Attempting to release foreign lockfile without owning it
      const rel = releaseDaemonLock({ lockFileName: TEST_LOCK_NAME });
      expect(rel).toBe(false);
      expect(fs.existsSync(testLockFilePath)).toBe(true);

      // clearStaleDaemonLock cleans it up because foreign PID is inactive
      const cleaned = clearStaleDaemonLock(TEST_LOCK_NAME);
      expect(cleaned).toBe(true);
      expect(fs.existsSync(testLockFilePath)).toBe(false);
    });

    it("should automatically recover from a corrupted (unparseable) lockfile older than 2000ms", () => {
      // Write corrupted data into lockfile with mtime in the past
      fs.writeFileSync(testLockFilePath, "{ unparseable_json_syntax_error : 123", "utf-8");
      const pastTime = new Date(Date.now() - 5000);
      fs.utimesSync(testLockFilePath, pastTime, pastTime);

      // Should automatically clean up stale/corrupted lock and acquire cleanly
      const result = acquireDaemonLock({ lockFileName: TEST_LOCK_NAME, throwOnCollision: false });
      expect(result.acquired).toBe(true);
      expect(result.pid).toBe(process.pid);
      expect(fs.existsSync(testLockFilePath)).toBe(true);

      const info = getDaemonLockInfo(TEST_LOCK_NAME);
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(process.pid);
    });

    it("should recover from a stale lock left by an inactive/dead PID", () => {
      const deadPayload = {
        pid: 777777, // dead PID
        startedAt: Date.now() - 60000,
        heartbeat: Date.now() - 60000,
        hostname: "dead-host",
        platform: "win32",
        instanceUuid: "dead-uuid-1111",
      };
      fs.writeFileSync(testLockFilePath, JSON.stringify(deadPayload), "utf-8");

      // Verify dead PID lock is detected as not locked by live process
      expect(isDaemonLocked(TEST_LOCK_NAME)).toBe(false);

      // acquireDaemonLock should clean up dead PID lock and acquire fresh
      const acq = acquireDaemonLock({ lockFileName: TEST_LOCK_NAME });
      expect(acq.acquired).toBe(true);
      expect(acq.pid).toBe(process.pid);

      const info = getDaemonLockInfo(TEST_LOCK_NAME);
      expect(info!.pid).toBe(process.pid);
      expect(info!.instanceUuid).toBe(acq.instanceUuid);
    });
  });
});
