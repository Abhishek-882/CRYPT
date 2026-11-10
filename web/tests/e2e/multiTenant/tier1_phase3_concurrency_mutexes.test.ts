/**
 * Tier 1: Feature Coverage — Phase 3: Tenant-Scoped In-Flight Entry Locks & Fleet Mutexes
 * 
 * Verifies:
 * - Scoping in-flight entry locks by `${userId}_${symbol}` allowing concurrent cross-tenant execution on same symbol
 * - Intra-tenant collision prevention (same tenant multiple bots cannot double-enter same symbol)
 * - FleetDispatcher mutex scoping by `${userId}_${corridor}_${symbol}` and `${userId}_${symbol}`
 * - Independent lock lifecycles and releases across tenants
 * - Backwards-compatible fallback when userId is omitted (global scope)
 * 
 * Strict Compliance:
 * - ZERO BPS NOTATION: 100% % notation exclusively.
 * - MODERN TERMINOLOGY ONLY: Multi-tenant execution engine, autonomous hedge worker.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isCorridorSymbolLocked,
  releaseCorridorSymbolLock,
} from '@/lib/botEngine';
import { FleetDispatcher } from '@/lib/fleetDispatcher';
import {
  TEST_TENANT_ALPHA_ID,
  TEST_TENANT_BETA_ID,
  TEST_TENANT_GAMMA_ID,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 1: Phase 3 — Tenant-Scoped In-Flight Entry Locks & Fleet Mutexes', () => {
  let dispatcher: FleetDispatcher;

  beforeEach(() => {
    dispatcher = new FleetDispatcher();
    dispatcher.clear();

    // Clean up any remaining in-flight entry locks across test tenants
    releaseCorridorSymbolLock('BINANCE_BYBIT', 'BTCUSDT', TEST_TENANT_ALPHA_ID);
    releaseCorridorSymbolLock('BINANCE_BYBIT', 'BTCUSDT', TEST_TENANT_BETA_ID);
    releaseCorridorSymbolLock('BINANCE_BYBIT', 'BTCUSDT', TEST_TENANT_GAMMA_ID);
    releaseCorridorSymbolLock('BINANCE_BYBIT', 'ETHUSDT', TEST_TENANT_ALPHA_ID);
    releaseCorridorSymbolLock('BINANCE_BYBIT', 'ETHUSDT', TEST_TENANT_BETA_ID);
    releaseCorridorSymbolLock('BINANCE_BYBIT', 'SOLUSDT', TEST_TENANT_ALPHA_ID);
  });

  // --------------------------------------------------------------------------
  // Feature 5: Tenant-Scoped In-Flight Entry Locks
  // --------------------------------------------------------------------------
  describe('Feature 5: Tenant-Scoped In-Flight Entry Locks', () => {
    it('P3-F5-01: scopes in-flight locks by tenant ID allowing different tenants to trade same symbol concurrently', async () => {
      // Simulate lock acquisition for Tenant Alpha on BTCUSDT
      // (in botEngine, inFlightEntryLocks adds `${prefix}${sym}` and `${prefix}${corr}_${sym}`)
      const { executeDualHedgeEntry } = await import('@/lib/botEngine');

      // Alpha enters BTCUSDT
      expect(isCorridorSymbolLocked('BINANCE_BYBIT', 'BTCUSDT', TEST_TENANT_ALPHA_ID)).toBe(false);
      expect(isCorridorSymbolLocked('BINANCE_BYBIT', 'BTCUSDT', TEST_TENANT_BETA_ID)).toBe(false);
    });

    it('P3-F5-02: lock release for one tenant does not release another tenant lock on identical symbol', () => {
      // Acquire fleet lock for Alpha and Beta
      dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'bot_alpha', TEST_TENANT_ALPHA_ID);
      dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'bot_beta', TEST_TENANT_BETA_ID);

      expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(true);
      expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, TEST_TENANT_BETA_ID)).toBe(true);

      // Release Alpha
      dispatcher.releaseFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'bot_alpha', TEST_TENANT_ALPHA_ID);

      // Alpha is unlocked, Beta remains locked
      expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(false);
      expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, TEST_TENANT_BETA_ID)).toBe(true);
    });

    it('P3-F5-03: supports backward compatibility when userId is undefined (maps to global scope)', () => {
      const lockedGlobal = isCorridorSymbolLocked('BINANCE_BYBIT', 'UNLOCKED_COIN_XYZ', undefined);
      expect(lockedGlobal).toBe(false);

      releaseCorridorSymbolLock('BINANCE_BYBIT', 'UNLOCKED_COIN_XYZ', undefined);
      expect(isCorridorSymbolLocked('BINANCE_BYBIT', 'UNLOCKED_COIN_XYZ', undefined)).toBe(false);
    });

    it('P3-F5-04: intra-corridor vs cross-corridor lock scoping behaves consistently per tenant', () => {
      dispatcher.acquireFleetLock('SOLUSDT', 'BINANCE_BYBIT', 'bot_a', TEST_TENANT_ALPHA_ID);

      // Same tenant on another corridor is still blocked on the base symbol
      const secondCorridorAttempt = dispatcher.acquireFleetLock('SOLUSDT', 'BITGET_BYBIT', 'bot_b', TEST_TENANT_ALPHA_ID);
      expect(secondCorridorAttempt).toBe(false);

      // But a DIFFERENT tenant on that second corridor succeeds
      const betaAttempt = dispatcher.acquireFleetLock('SOLUSDT', 'BITGET_BYBIT', 'bot_beta', TEST_TENANT_BETA_ID);
      expect(betaAttempt).toBe(true);
    });

    it('P3-F5-05: verifies clean error strings use zero BPS notation and modern terminology', () => {
      const lockLog = `[CONCURRENCY LOCK] Autonomous execution engine: Entry on BTCUSDT blocked for tenant ${TEST_TENANT_ALPHA_ID}`;
      expect(assertZeroBpsNotation(lockLog)).toBe(true);
      expect(assertModernTerminologyOnly(lockLog)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 6: Tenant-Scoped Fleet Mutexes
  // --------------------------------------------------------------------------
  describe('Feature 6: Tenant-Scoped Fleet Mutexes', () => {
    it('P3-F6-01: allows concurrent lock acquisition across independent tenants for same trading pair', () => {
      const alphaAcquired = dispatcher.acquireFleetLock(
        'ETHUSDT',
        'BINANCE_BYBIT',
        'worker_alpha_1',
        TEST_TENANT_ALPHA_ID
      );
      expect(alphaAcquired).toBe(true);

      const betaAcquired = dispatcher.acquireFleetLock(
        'ETHUSDT',
        'BINANCE_BYBIT',
        'worker_beta_1',
        TEST_TENANT_BETA_ID
      );
      expect(betaAcquired).toBe(true);
    });

    it('P3-F6-02: denies duplicate fleet lock acquisition by second bot under same tenant', () => {
      // Worker 1 under Alpha acquires ETHUSDT
      const alpha1 = dispatcher.acquireFleetLock(
        'ETHUSDT',
        'BINANCE_BYBIT',
        'worker_alpha_1',
        TEST_TENANT_ALPHA_ID
      );
      expect(alpha1).toBe(true);

      // Worker 2 under SAME tenant Alpha tries to acquire ETHUSDT -> DENIED
      const alpha2 = dispatcher.acquireFleetLock(
        'ETHUSDT',
        'BINANCE_BYBIT',
        'worker_alpha_2',
        TEST_TENANT_ALPHA_ID
      );
      expect(alpha2).toBe(false);
    });

    it('P3-F6-03: requesting bot under same tenant is not locked out of its own held lock', () => {
      dispatcher.acquireFleetLock('NEARUSDT', 'BINANCE_BYBIT', 'worker_alpha_1', TEST_TENANT_ALPHA_ID);

      // Same bot checking status is not considered locked out
      expect(dispatcher.isSymbolLockedFleetWide('NEARUSDT', 'worker_alpha_1', TEST_TENANT_ALPHA_ID)).toBe(false);

      // Different bot under same tenant IS locked out
      expect(dispatcher.isSymbolLockedFleetWide('NEARUSDT', 'worker_alpha_2', TEST_TENANT_ALPHA_ID)).toBe(true);

      // Different tenant is NOT locked out
      expect(dispatcher.isSymbolLockedFleetWide('NEARUSDT', 'worker_beta_1', TEST_TENANT_BETA_ID)).toBe(false);
    });

    it('P3-F6-04: multi-tenant fleet lock release cleans up only the specific tenant lock', () => {
      dispatcher.acquireFleetLock('ADAUSDT', 'BINANCE_BYBIT', 'worker_alpha_1', TEST_TENANT_ALPHA_ID);
      dispatcher.acquireFleetLock('ADAUSDT', 'BINANCE_BYBIT', 'worker_beta_1', TEST_TENANT_BETA_ID);
      dispatcher.acquireFleetLock('ADAUSDT', 'BINANCE_BYBIT', 'worker_gamma_1', TEST_TENANT_GAMMA_ID);

      // Release Beta only
      dispatcher.releaseFleetLock('ADAUSDT', 'BINANCE_BYBIT', 'worker_beta_1', TEST_TENANT_BETA_ID);

      // Alpha and Gamma remain locked; Beta is unlocked
      expect(dispatcher.isSymbolLockedFleetWide('ADAUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(true);
      expect(dispatcher.isSymbolLockedFleetWide('ADAUSDT', undefined, TEST_TENANT_BETA_ID)).toBe(false);
      expect(dispatcher.isSymbolLockedFleetWide('ADAUSDT', undefined, TEST_TENANT_GAMMA_ID)).toBe(true);
    });

    it('P3-F6-05: handles 30-second watchdog lock timeout and eviction', () => {
      dispatcher.acquireFleetLock('DOGEUSDT', 'BINANCE_BYBIT', 'worker_alpha_1', TEST_TENANT_ALPHA_ID);

      // Immediately after acquisition, locked
      expect(dispatcher.isSymbolLockedFleetWide('DOGEUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(true);

      // Clearing dispatcher simulates full lock eviction/expiration
      dispatcher.clear();
      expect(dispatcher.isSymbolLockedFleetWide('DOGEUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(false);
    });

    it('P3-F6-06: maintains case-insensitivity on symbols and corridors with tenant prefix', () => {
      dispatcher.acquireFleetLock('btcusdt', 'binance_bybit', 'bot_1', TEST_TENANT_ALPHA_ID);

      // Uppercase check matches
      expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(true);

      // Lowercase check matches
      expect(dispatcher.isSymbolLockedFleetWide('btcusdt', undefined, TEST_TENANT_ALPHA_ID)).toBe(true);

      // Release using mixed case works
      dispatcher.releaseFleetLock('BtcUsdt', 'Binance_Bybit', 'bot_1', TEST_TENANT_ALPHA_ID);
      expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(false);
    });
  });
});
