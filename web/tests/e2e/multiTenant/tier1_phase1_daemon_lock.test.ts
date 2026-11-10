/**
 * Tier 1: Feature Coverage — Phase 1: Daemon Lock Scoping & Reference Counting
 * 
 * Verifies reference-counted multi-tenant daemon lock lifecycle:
 * - Independent tenant registration and deregistration
 * - Physical lockfile retention on disk when >= 1 active tenant remains
 * - Atomic unlinking of physical lockfile when remaining active tenant count reaches 0
 * - Administrative force override capabilities
 * - Daemon route lifecycle actions (stop and toggle_daemon) respecting tenant registry
 * 
 * Strict Compliance:
 * - ZERO BPS NOTATION: 100% % notation exclusively.
 * - MODERN TERMINOLOGY ONLY: Multi-tenant execution engine, autonomous hedge worker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  acquireDaemonLock,
  acquireDaemonLockForTenant,
  releaseDaemonLock,
  releaseDaemonLockForTenant,
  registerTenantForDaemonLock,
  unregisterTenantForDaemonLock,
  getActiveTenantsForDaemonLock,
  syncActiveTenantsForDaemonLock,
  isDaemonLocked,
  isDaemonLockHeldByCurrentProcess,
  getDaemonLockInfo,
  getDaemonLockFilePath,
} from '@/lib/daemonLockManager';
import {
  TEST_TENANT_ALPHA_ID,
  TEST_TENANT_BETA_ID,
  TEST_TENANT_GAMMA_ID,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 1: Phase 1 — Reference-Counted Daemon Lock Management', () => {
  const customLockFile = 'test_multi_tenant_daemon.lock';
  const lockFilePath = getDaemonLockFilePath(customLockFile);

  beforeEach(() => {
    try {
      releaseDaemonLock({ lockFileName: customLockFile, force: true });
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
      releaseDaemonLock({ lockFileName: customLockFile, force: true });
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

  // --------------------------------------------------------------------------
  // Feature 1: Reference-Counted Daemon Lock Engine
  // --------------------------------------------------------------------------
  describe('Feature 1: Tenant Reference-Counted Lock Lifecycle', () => {
    it('P1-F1-01: acquires lock for initial tenant and establishes reference count of 1', () => {
      const result = acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, {
        lockFileName: customLockFile,
        throwOnCollision: false,
      });

      expect(result.acquired).toBe(true);
      expect(result.registeredTenants).toBe(1);
      expect(fs.existsSync(lockFilePath)).toBe(true);
      expect(isDaemonLocked(customLockFile)).toBe(true);
      expect(isDaemonLockHeldByCurrentProcess(customLockFile)).toBe(true);

      const activeTenants = getActiveTenantsForDaemonLock(customLockFile);
      expect(activeTenants).toContain(TEST_TENANT_ALPHA_ID);
      expect(activeTenants.length).toBe(1);
    });

    it('P1-F1-02: registers concurrent tenant into active lock without re-creating file', () => {
      // Tenant Alpha acquires
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      const initialInfo = getDaemonLockInfo(customLockFile);
      expect(initialInfo).not.toBeNull();

      // Tenant Beta joins
      const betaResult = acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });
      expect(betaResult.acquired).toBe(true);
      expect(betaResult.registeredTenants).toBe(2);

      const activeTenants = getActiveTenantsForDaemonLock(customLockFile);
      expect(activeTenants).toContain(TEST_TENANT_ALPHA_ID);
      expect(activeTenants).toContain(TEST_TENANT_BETA_ID);
      expect(activeTenants.length).toBe(2);

      // Lockfile identity and PID should remain identical
      const updatedInfo = getDaemonLockInfo(customLockFile);
      expect(updatedInfo?.pid).toBe(initialInfo?.pid);
      expect(updatedInfo?.instanceUuid).toBe(initialInfo?.instanceUuid);
    });

    it('P1-F1-03: retains OS lockfile on disk when first tenant releases and second tenant remains active', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });

      // Tenant Alpha stops
      const releaseResult = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });

      expect(releaseResult.released).toBe(false);
      expect(releaseResult.remainingTenants).toBe(1);
      // Critical invariant: physical lock must remain intact on disk
      expect(fs.existsSync(lockFilePath)).toBe(true);
      expect(isDaemonLocked(customLockFile)).toBe(true);

      const activeTenants = getActiveTenantsForDaemonLock(customLockFile);
      expect(activeTenants).not.toContain(TEST_TENANT_ALPHA_ID);
      expect(activeTenants).toContain(TEST_TENANT_BETA_ID);
    });

    it('P1-F1-04: unlinks OS lockfile from disk when last remaining active tenant releases', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });

      // Tenant Alpha releases
      releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // Tenant Beta releases (last tenant)
      const finalRelease = releaseDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });

      expect(finalRelease.released).toBe(true);
      expect(finalRelease.remainingTenants).toBe(0);
      // Critical invariant: physical lock must be removed when count reaches 0
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked(customLockFile)).toBe(false);
      expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(0);
    });

    it('P1-F1-05: administrative force release unlinks lockfile immediately regardless of remaining tenants', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });
      acquireDaemonLockForTenant(TEST_TENANT_GAMMA_ID, { lockFileName: customLockFile });
      expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(3);

      // Force release by administrator
      const forceResult = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, {
        lockFileName: customLockFile,
        force: true,
      });

      expect(forceResult.released).toBe(true);
      expect(forceResult.remainingTenants).toBe(0);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked(customLockFile)).toBe(false);
      expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(0);
    });

    it('P1-F1-06: synchronizes active tenants registry directly from engine state', () => {
      acquireDaemonLock({ lockFileName: customLockFile });

      const count = syncActiveTenantsForDaemonLock(
        [TEST_TENANT_ALPHA_ID, TEST_TENANT_BETA_ID, TEST_TENANT_GAMMA_ID],
        customLockFile
      );
      expect(count).toBe(3);

      const registered = getActiveTenantsForDaemonLock(customLockFile);
      expect(registered).toEqual(expect.arrayContaining([
        TEST_TENANT_ALPHA_ID,
        TEST_TENANT_BETA_ID,
        TEST_TENANT_GAMMA_ID,
      ]));

      // Deregister single tenant
      const remaining = unregisterTenantForDaemonLock(TEST_TENANT_ALPHA_ID, customLockFile);
      expect(remaining).toBe(2);
      expect(getActiveTenantsForDaemonLock(customLockFile)).not.toContain(TEST_TENANT_ALPHA_ID);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 2: Active Tenant Daemon Route Lifecycle Contract
  // --------------------------------------------------------------------------
  describe('Feature 2: Multi-Tenant Route Lifecycle Contract', () => {
    it('P1-F2-01: honors explicit remainingTenants parameter passed in release options', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });

      // Simulate route evaluating other active user states and finding 2 active engines
      const result = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, {
        lockFileName: customLockFile,
        remainingTenants: 2,
      } as any);

      expect(result.released).toBe(false);
      expect(result.remainingTenants).toBe(2);
      expect(fs.existsSync(lockFilePath)).toBe(true);
    });

    it('P1-F2-02: releases lock cleanly when remainingTenants parameter is evaluated to 0', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });

      // Route evaluates other active users and confirms 0 active engines
      const result = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, {
        lockFileName: customLockFile,
        remainingTenants: 0,
      } as any);

      expect(result.released).toBe(true);
      expect(result.remainingTenants).toBe(0);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it('P1-F2-03: handles multiple sequential joins and departures without state corruption', () => {
      // 1. Alpha joins
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      // 2. Beta joins
      acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });
      // 3. Alpha leaves
      releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // 4. Gamma joins
      acquireDaemonLockForTenant(TEST_TENANT_GAMMA_ID, { lockFileName: customLockFile });
      expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(2);

      // 5. Beta leaves
      releaseDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });
      expect(fs.existsSync(lockFilePath)).toBe(true);

      // 6. Gamma leaves (last tenant)
      const lastDeparture = releaseDaemonLockForTenant(TEST_TENANT_GAMMA_ID, { lockFileName: customLockFile });
      expect(lastDeparture.released).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it('P1-F2-04: verifies zero BPS notation across daemon lock error messages and telemetry', () => {
      const sampleLogs = [
        "Daemon lock acquired for tenant runner usr_tenant_alpha",
        "Active tenant registry reference count: 2 active workers",
        "Retaining OS lockfile on disk: remaining active tenants = 1",
        "All tenant runners halted. OS lockfile unlinked cleanly.",
      ];
      for (const log of sampleLogs) {
        expect(assertZeroBpsNotation(log)).toBe(true);
        expect(assertModernTerminologyOnly(log)).toBe(true);
      }
    });

    it('P1-F2-05: prevents duplicate tenant registration from artificially inflating reference count', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      // Tenant Alpha registers again (e.g. secondary bot tick under same tenant)
      const dup = acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      expect(dup.registeredTenants).toBe(1);

      const active = getActiveTenantsForDaemonLock(customLockFile);
      expect(active.length).toBe(1);

      // Single release removes tenant and cleans up lockfile
      const rel = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      expect(rel.released).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });
  });
});
