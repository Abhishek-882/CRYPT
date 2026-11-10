/**
 * Empirical Challenger Test Suite: Milestone 1 Daemon Lock Scoping & Multi-Tenant Isolation
 * Roles: critic, specialist
 * Archetype: teamwork_challenger
 * 
 * Empirically challenges:
 * 1. Stale lock detection & recovery when PID dies while tenants were active
 * 2. Transparent delegation and backward compatibility for callers omitting userId
 * 3. Emergency force unlinking (releaseDaemonLock({ force: true }))
 * 4. Actual Child-Process Crash Recovery under live OS process death
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
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

describe("Empirical Challenger M1: Daemon Lock Multi-Tenant Isolation Stress Test", () => {
  const customLockName = "empirical_challenger_test.lock";
  const lockFilePath = getDaemonLockFilePath(customLockName);

  const cleanLock = () => {
    try {
      releaseDaemonLock({ lockFileName: customLockName, force: true });
    } catch {}
    if (fs.existsSync(lockFilePath)) {
      try {
        fs.unlinkSync(lockFilePath);
      } catch {}
    }
  };

  beforeEach(() => {
    cleanLock();
  });

  afterEach(() => {
    cleanLock();
  });

  // =========================================================================
  // SUITE 1: Stale Lock Detection & Recovery When PID Dies
  // =========================================================================
  describe("Suite 1: Stale Lock Detection & Recovery When PID Dies", () => {
    it("E1-01: detects dead PID and recovers lock when previous process died with active tenants", () => {
      // Simulate a crashed process: PID 999997 (non-existent dead PID)
      const deadPid = 999997;
      const deadPayload = {
        pid: deadPid,
        startedAt: Date.now() - 60000,
        heartbeat: Date.now() - 60000,
        hostname: os.hostname(),
        platform: process.platform,
        instanceUuid: "dead-instance-" + crypto.randomUUID(),
      };
      fs.writeFileSync(lockFilePath, JSON.stringify(deadPayload, null, 2), "utf-8");
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Verify that isDaemonLocked recognizes the lock is stale/dead
      expect(isDaemonLocked(customLockName)).toBe(false);
      expect(isDaemonLockHeldByCurrentProcess(customLockName)).toBe(false);

      // Now a new tenant tries to acquire the lock: acquireDaemonLockForTenant
      const result = acquireDaemonLockForTenant("usr_survivor_tenant", {
        lockFileName: customLockName,
        throwOnCollision: false,
      });

      expect(result.acquired).toBe(true);
      expect(result.pid).toBe(process.pid);
      expect(result.registeredTenants).toBe(1);

      // Verify disk lock now reflects the new live PID
      const info = getDaemonLockInfo(customLockName);
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(process.pid);
      expect(info!.instanceUuid).toBe(result.instanceUuid);
      expect(isDaemonLocked(customLockName)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(customLockName)).toBe(true);

      const activeTenants = getActiveTenantsForDaemonLock(customLockName);
      expect(activeTenants).toEqual(["usr_survivor_tenant"]);
    });

    it("E1-02: recovers from corrupted, zero-byte, or partial lockfile when PID dies", () => {
      // Write corrupted 0-byte lockfile
      fs.writeFileSync(lockFilePath, "", "utf-8");
      expect(fs.existsSync(lockFilePath)).toBe(true);

      expect(isDaemonLocked(customLockName)).toBe(false);
      expect(getDaemonLockInfo(customLockName)).toBeNull();

      // Acquire lock should handle 0-byte file cleanly
      const result = acquireDaemonLock({
        lockFileName: customLockName,
        throwOnCollision: false,
      });

      expect(result.acquired).toBe(true);
      expect(result.pid).toBe(process.pid);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      const info = getDaemonLockInfo(customLockName);
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(process.pid);
    });

    it("E1-03: clearStaleDaemonLock unlinks dead lock but preserves live process lock", () => {
      // 1. Live process lock
      const live = acquireDaemonLock({ lockFileName: customLockName });
      expect(live.acquired).toBe(true);
      // clearStaleDaemonLock on live process lock should NOT unlink
      const cleanedLive = clearStaleDaemonLock(customLockName);
      expect(cleanedLive).toBe(false);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Release cleanly
      releaseDaemonLock({ lockFileName: customLockName });
      expect(fs.existsSync(lockFilePath)).toBe(false);

      // 2. Dead process lock
      const deadPayload = {
        pid: 999996,
        startedAt: Date.now() - 30000,
        heartbeat: Date.now() - 30000,
        hostname: "dead-host",
        platform: "linux",
        instanceUuid: "dead-uuid-999996",
      };
      fs.writeFileSync(lockFilePath, JSON.stringify(deadPayload), "utf-8");

      // clearStaleDaemonLock should unlink the dead lock
      const cleanedDead = clearStaleDaemonLock(customLockName);
      expect(cleanedDead).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it("E1-04: live OS child process crash: parent detects dead PID and recovers lock with active tenant registration", async () => {
      // Spawn actual child Node process that writes its real PID into lockFilePath and hangs
      const childCode = `
        const fs = require('fs');
        const os = require('os');
        const crypto = require('crypto');
        const payload = {
          pid: process.pid,
          startedAt: Date.now(),
          heartbeat: Date.now(),
          hostname: os.hostname(),
          platform: process.platform,
          instanceUuid: crypto.randomUUID()
        };
        fs.writeFileSync(${JSON.stringify(lockFilePath)}, JSON.stringify(payload, null, 2));
        setInterval(() => {}, 1000);
      `;

      const child = spawn(process.execPath, ["-e", childCode], {
        stdio: "ignore",
      });

      // Wait for child to write lock
      const waitStart = Date.now();
      while (Date.now() - waitStart < 2000) {
        if (fs.existsSync(lockFilePath)) {
          const info = getDaemonLockInfo(customLockName);
          if (info && info.pid === child.pid) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const initialInfo = getDaemonLockInfo(customLockName);
      expect(initialInfo).not.toBeNull();
      expect(initialInfo!.pid).toBe(child.pid);
      expect(isDaemonLocked(customLockName)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(customLockName)).toBe(false);

      // Collision rejection while child process is alive
      const collisionTry = acquireDaemonLock({
        lockFileName: customLockName,
        throwOnCollision: false,
      });
      expect(collisionTry.acquired).toBe(false);
      expect(collisionTry.pid).toBe(child.pid);

      // Now abruptly kill child process (SIGKILL)
      child.kill("SIGKILL");

      // Wait for OS to terminate PID
      const killWait = Date.now();
      while (Date.now() - killWait < 2000) {
        try {
          process.kill(child.pid!, 0);
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          break; // PID is dead
        }
      }

      // PID is dead: isDaemonLocked must return false
      expect(isDaemonLocked(customLockName)).toBe(false);

      // Stale lock recovery: acquireDaemonLockForTenant evicts dead child PID and claims lock
      const recovered = acquireDaemonLockForTenant("usr_phoenix_tenant", {
        lockFileName: customLockName,
        throwOnCollision: false,
      });

      expect(recovered.acquired).toBe(true);
      expect(recovered.pid).toBe(process.pid);
      expect(recovered.registeredTenants).toBe(1);

      const postRecoveryInfo = getDaemonLockInfo(customLockName);
      expect(postRecoveryInfo!.pid).toBe(process.pid);
      expect(postRecoveryInfo!.instanceUuid).toBe(recovered.instanceUuid);
      expect(isDaemonLocked(customLockName)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(customLockName)).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 2: Transparent Delegation & Backward Compatibility
  // =========================================================================
  describe("Suite 2: Transparent Delegation & Backward Compatibility", () => {
    it("E2-01: releaseDaemonLock({ userId }) delegates to reference-counted tenant release", () => {
      acquireDaemonLockForTenant("usr_alpha", { lockFileName: customLockName });
      acquireDaemonLockForTenant("usr_beta", { lockFileName: customLockName });

      expect(getActiveTenantsForDaemonLock(customLockName)).toEqual(["usr_alpha", "usr_beta"]);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Caller invokes legacy signature releaseDaemonLock({ userId: "usr_alpha" })
      const relA = releaseDaemonLock({ userId: "usr_alpha", lockFileName: customLockName });
      expect(relA).toBe(false); // Should NOT unlink because usr_beta is still active
      expect(fs.existsSync(lockFilePath)).toBe(true);
      expect(isDaemonLocked(customLockName)).toBe(true);
      expect(getActiveTenantsForDaemonLock(customLockName)).toEqual(["usr_beta"]);

      // Second tenant invokes releaseDaemonLock({ userId: "usr_beta" })
      const relB = releaseDaemonLock({ userId: "usr_beta", lockFileName: customLockName });
      expect(relB).toBe(true); // Should unlink because 0 tenants remain
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked(customLockName)).toBe(false);
      expect(getActiveTenantsForDaemonLock(customLockName)).toEqual([]);
    });

    it("E2-02: legacy caller omitting userId releases process-level lock cleanly when no other callers", () => {
      // Legacy caller acquires without userId
      const acq = acquireDaemonLock({ lockFileName: customLockName });
      expect(acq.acquired).toBe(true);
      expect(getActiveTenantsForDaemonLock(customLockName)).toEqual([]);

      // Legacy caller releases without userId
      const rel = releaseDaemonLock({ lockFileName: customLockName });
      expect(rel).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked(customLockName)).toBe(false);
    });

    it("E2-03: handles boolean, string, and edge-case option types without crashing", () => {
      // String option as filename
      const acq = acquireDaemonLock(customLockName);
      expect(acq.acquired).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Boolean option in release
      const rel = releaseDaemonLock({ lockFileName: customLockName, force: false });
      expect(rel).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it("E2-04: legacy releaseDaemonLock() without userId when tenants ARE active unlinks lock (Process Master Release)", () => {
      // If tenants are registered, what happens when releaseDaemonLock() is called without userId?
      acquireDaemonLockForTenant("usr_1", { lockFileName: customLockName });
      acquireDaemonLockForTenant("usr_2", { lockFileName: customLockName });

      expect(getActiveTenantsForDaemonLock(customLockName).length).toBe(2);

      // A process master shutdown (e.g. process termination hook or master pause)
      const rel = releaseDaemonLock({ lockFileName: customLockName });
      expect(rel).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(getActiveTenantsForDaemonLock(customLockName)).toEqual([]);
    });

    it("E2-05: ignores empty string or whitespace userId and treats as process release", () => {
      acquireDaemonLock({ lockFileName: customLockName });
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Pass empty string userId
      const rel = releaseDaemonLock({ lockFileName: customLockName, userId: "   " } as any);
      expect(rel).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 3: Emergency Force Unlinking (releaseDaemonLock({ force: true }))
  // =========================================================================
  describe("Suite 3: Emergency Force Unlinking", () => {
    it("E3-01: force: true unlinks immediately when multiple active tenants are registered in same process", () => {
      acquireDaemonLockForTenant("usr_t1", { lockFileName: customLockName });
      acquireDaemonLockForTenant("usr_t2", { lockFileName: customLockName });
      acquireDaemonLockForTenant("usr_t3", { lockFileName: customLockName });

      expect(getActiveTenantsForDaemonLock(customLockName).length).toBe(3);
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Emergency force release
      const released = releaseDaemonLock({ lockFileName: customLockName, force: true });
      expect(released).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked(customLockName)).toBe(false);
      expect(getActiveTenantsForDaemonLock(customLockName)).toEqual([]);
    });

    it("E3-02: releaseDaemonLockForTenant with force: true unlinks immediately", () => {
      acquireDaemonLockForTenant("usr_t1", { lockFileName: customLockName });
      acquireDaemonLockForTenant("usr_t2", { lockFileName: customLockName });

      const res = releaseDaemonLockForTenant("usr_t1", {
        lockFileName: customLockName,
        force: true,
      });

      expect(res.released).toBe(true);
      expect(res.remainingTenants).toBe(0);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked(customLockName)).toBe(false);
    });

    it("E3-03: [EMPIRICAL INVESTIGATION] releaseDaemonLock({ force: true }) on foreign / unowned lock", () => {
      // Simulate an unowned foreign lockfile on disk
      const foreignPayload = {
        pid: 999995,
        startedAt: Date.now() - 10000,
        heartbeat: Date.now() - 10000,
        hostname: "foreign-cluster-node",
        platform: "linux",
        instanceUuid: "foreign-uuid-" + crypto.randomUUID(),
      };
      fs.writeFileSync(lockFilePath, JSON.stringify(foreignPayload, null, 2), "utf-8");
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Empirical observation of releaseDaemonLock({ force: true }) behavior:
      const forceResult = releaseDaemonLock({ lockFileName: customLockName, force: true });
      const fileStillExists = fs.existsSync(lockFilePath);

      // Finding: releaseDaemonLock requires isCurrentHolder === true and does NOT unlink foreign locks even with force: true.
      expect(forceResult).toBe(false);
      expect(fileStillExists).toBe(true);

      // To unlink unowned/dead lock, clearStaleDaemonLock or acquireDaemonLock({ force: true }) must be used:
      const cleaned = clearStaleDaemonLock(customLockName);
      expect(cleaned).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it("E3-04: acquireDaemonLock({ force: true }) successfully force-unlinks foreign lock upfront", () => {
      const foreignPayload = {
        pid: 999994,
        startedAt: Date.now() - 10000,
        heartbeat: Date.now() - 10000,
        hostname: "foreign-cluster-node",
        platform: "linux",
        instanceUuid: "foreign-uuid-" + crypto.randomUUID(),
      };
      fs.writeFileSync(lockFilePath, JSON.stringify(foreignPayload, null, 2), "utf-8");
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // acquireDaemonLock has explicit: if (force && fs.existsSync(lockFilePath)) { fs.unlinkSync(lockFilePath); }
      const acqResult = acquireDaemonLock({ lockFileName: customLockName, force: true });
      expect(acqResult.acquired).toBe(true);
      expect(acqResult.pid).toBe(process.pid);
      expect(fs.existsSync(lockFilePath)).toBe(true);
      const newInfo = getDaemonLockInfo(customLockName);
      expect(newInfo!.pid).toBe(process.pid);
    });
  });
});
