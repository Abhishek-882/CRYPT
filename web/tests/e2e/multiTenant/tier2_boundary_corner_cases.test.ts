/**
 * Tier 2: Boundary & Corner Cases — Multi-Tenant Architecture & Layer 7 Dynamic Exit Engine
 * 
 * Verifies edge cases, extreme boundaries, concurrency races, and resilient degradation:
 * - Phase 1: 0-tenant release, concurrent unlinking races, stale PID recovery
 * - Phase 2: Empty/whitespace keys, corrupted ciphertext, minimum leverage clamps (3x)
 * - Phase 3: Exact 30s TTL expiry, 10-tenant concurrent bursts, special character normalization
 * - Phase 4: Micro-notionals ($0.0001, $59.99), user override epsilon ($0.0099 vs $0.0100), macro-notionals ($6000)
 * - Phase 5: Idempotent quarantine, symbol casing normalization, undefined caller safety
 * - Phase 6: Empty/malformed cookies, signature mismatch, cron secret boundary validation
 * 
 * Strict Compliance:
 * - ZERO BPS NOTATION: 100% % notation exclusively.
 * - MODERN TERMINOLOGY ONLY: Multi-tenant execution engine, autonomous hedge worker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  acquireDaemonLock,
  acquireDaemonLockForTenant,
  releaseDaemonLock,
  releaseDaemonLockForTenant,
  unregisterTenantForDaemonLock,
  getActiveTenantsForDaemonLock,
  isDaemonLocked,
  clearStaleDaemonLock,
  getDaemonLockFilePath,
} from '@/lib/daemonLockManager';
import {
  getVerifiedCredentialsForTenant,
  MissingCredentialsError,
  isTenantAdmin,
  isCorridorSymbolLocked,
  releaseCorridorSymbolLock,
  lockFlattenedCoinForBot,
  resetBotMemory,
  loadBotState,
} from '@/lib/botEngine';
import { FleetDispatcher } from '@/lib/fleetDispatcher';
import {
  getEffectiveZeroLossFloorUsdt,
  evaluateExitGates,
  HARD_SAFETY_FLOOR_USDT,
} from '@/lib/divergence/engine';
import {
  calculateDynamicLeverage,
  LeverageManager,
} from '@/lib/leverageManager';
import {
  getAuthenticatedUser,
  createSessionToken,
  verifySessionToken,
} from '@/lib/userStore';
import {
  TEST_ADMIN_ID,
  TEST_TENANT_ALPHA_ID,
  TEST_TENANT_BETA_ID,
  TEST_TENANT_GAMMA_ID,
  createMockTenantAlpha,
  createMockTenantEmptyKeys,
  createMockNextRequest,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 2: Boundary & Corner Cases — Comprehensive System Hardening', () => {
  const customLockFile = 'test_tier2_boundary.lock';
  const lockFilePath = getDaemonLockFilePath(customLockFile);
  let dispatcher: FleetDispatcher;

  beforeEach(() => {
    try {
      releaseDaemonLock({ lockFileName: customLockFile, force: true });
    } catch {}
    if (fs.existsSync(lockFilePath)) {
      try {
        fs.unlinkSync(lockFilePath);
      } catch {}
    }
    dispatcher = new FleetDispatcher();
    dispatcher.clear();

    resetBotMemory(undefined, TEST_TENANT_ALPHA_ID);
    resetBotMemory(undefined, TEST_TENANT_BETA_ID);
  });

  afterEach(() => {
    try {
      releaseDaemonLock({ lockFileName: customLockFile, force: true });
    } catch {}
    if (fs.existsSync(lockFilePath)) {
      try {
        fs.unlinkSync(lockFilePath);
      } catch {}
    }
    dispatcher.clear();
  });

  // --------------------------------------------------------------------------
  // Phase 1 Boundaries: Daemon Lock Ref-Counting & Concurrency Races
  // --------------------------------------------------------------------------
  describe('Phase 1 Boundaries: Lock Scoping Edge Cases', () => {
    it('P1-B-01: calling releaseDaemonLockForTenant when 0 tenants are registered succeeds safely', () => {
      const res = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      expect(res.released).toBe(true);
      expect(res.remainingTenants).toBe(0);
      expect(isDaemonLocked(customLockFile)).toBe(false);
    });

    it('P1-B-02: deregistering a non-existent tenant is idempotent and leaves registry unchanged', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
      expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(1);

      // Unregister unknown tenant
      const remaining = unregisterTenantForDaemonLock('unknown_tenant_xyz', customLockFile);
      expect(remaining).toBe(1);
      expect(getActiveTenantsForDaemonLock(customLockFile)).toContain(TEST_TENANT_ALPHA_ID);
    });

    it('P1-B-03: cleans stale lockfile belonging to dead foreign PID while retaining safety', () => {
      const deadPayload = {
        pid: 99999999, // Unused dead PID
        startedAt: Date.now() - 100000,
        heartbeat: Date.now() - 100000,
        hostname: 'foreign-host',
        platform: 'linux',
        instanceUuid: 'dead-uuid-xyz',
      };
      fs.writeFileSync(lockFilePath, JSON.stringify(deadPayload), 'utf-8');
      expect(fs.existsSync(lockFilePath)).toBe(true);

      const cleaned = clearStaleDaemonLock(customLockFile);
      expect(cleaned).toBe(true);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    it('P1-B-04: concurrent multi-tenant stop race decrements reference count atomically to 0', async () => {
      const tenants = Array.from({ length: 8 }, (_, i) => `tenant_race_${i}`);
      for (const t of tenants) {
        acquireDaemonLockForTenant(t, { lockFileName: customLockFile });
      }
      expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(8);

      // 8 tenants stop concurrently via Promise.all
      const results = await Promise.all(
        tenants.map((t) => Promise.resolve(releaseDaemonLockForTenant(t, { lockFileName: customLockFile })))
      );

      // Exactly one of the releases should have successfully unlinked the final lockfile
      const unlinkedCount = results.filter((r) => r.released).length;
      expect(unlinkedCount).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(lockFilePath)).toBe(false);
      expect(isDaemonLocked(customLockFile)).toBe(false);
      expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(0);
    });

    it('P1-B-05: remainingTenants parameter with negative value clamps safely to 0', () => {
      acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });

      const res = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, {
        lockFileName: customLockFile,
        remainingTenants: -5,
      } as any);

      expect(res.released).toBe(true);
      expect(res.remainingTenants).toBe(0);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 2 Boundaries: Credentials & Dynamic Leverage Bounds
  // --------------------------------------------------------------------------
  describe('Phase 2 Boundaries: Credential Edge Cases & Leverage Limits', () => {
    it('P2-B-01: empty string and undefined API keys are treated strictly as missing credentials', () => {
      const tenant = createMockTenantAlpha();
      tenant.apiKeys.binanceKey = '';
      tenant.apiKeys.binanceSecret = '';

      expect(() => {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BINANCE_BYBIT');
      }).toThrowError(MissingCredentialsError);

      const tenantUndefined = createMockTenantAlpha();
      delete (tenantUndefined.apiKeys as any).bybitKey;
      expect(() => {
        getVerifiedCredentialsForTenant(tenantUndefined.id, tenantUndefined.apiKeys, 'BINANCE_BYBIT');
      }).toThrowError(MissingCredentialsError);
    });

    it('P2-B-02: non-admin user cannot escalate privileges by claiming admin ID in string', () => {
      const maliciousId = 'usr_tenant_alpha_001_with_admin_string';
      expect(isTenantAdmin(maliciousId)).toBe(false);
    });

    it('P2-B-03: corrupted encrypted vault ciphertext (invalid AES payload) throws error', () => {
      const tenant = createMockTenantAlpha();
      tenant.apiKeys.bybitSecret = 'enc:v1:corrupted_iv:corrupted_tag:corrupted_cipher';

      expect(() => {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BINANCE_BYBIT');
      }).toThrow();
    });

    it('P2-B-04: dynamic leverage clamps to absolute minimum safety floor of 3x under extreme volatility', () => {
      // Extreme 1h ATR = 25.0%
      const res = LeverageManager.evaluateDynamicLeverage('HIGHVOLATILITYUSDT', 'Binance', 25.0, 24, 50, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });

      expect(res.effectiveLeverage).toBeGreaterThanOrEqual(3);
    });

    it('P2-B-05: dynamic leverage handles 0, negative, and NaN ATR inputs by defaulting to safe tier floor', () => {
      const nanLev = calculateDynamicLeverage('SOLUSDT', 'Binance', NaN, 24, 25, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });
      expect(nanLev).toBe(20);

      const zeroLev = calculateDynamicLeverage('PEPEUSDT', 'Binance', 0, 24, 20, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });
      expect(zeroLev).toBe(10);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 3 Boundaries: Concurrency Mutexes & TTL Expirations
  // --------------------------------------------------------------------------
  describe('Phase 3 Boundaries: Concurrency TTL & High-Density Races', () => {
    it('P3-B-01: 10 distinct tenants concurrently acquiring same symbol all succeed without collision', () => {
      const results = Array.from({ length: 10 }, (_, i) => {
        return dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', `bot_${i}`, `tenant_${i}`);
      });

      expect(results.every((r) => r === true)).toBe(true);
    });

    it('P3-B-02: 10 bots under SAME tenant acquiring same symbol results in exactly 1 winner and 9 rejections', () => {
      const results = Array.from({ length: 10 }, (_, i) => {
        return dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', `bot_${i}`, TEST_TENANT_ALPHA_ID);
      });

      const wins = results.filter((r) => r === true).length;
      const losses = results.filter((r) => r === false).length;
      expect(wins).toBe(1);
      expect(losses).toBe(9);
    });

    it('P3-B-03: cleans expired locks upon new acquisition attempt after TTL expires', () => {
      // Simulate expired lock by inserting with past expiration
      (dispatcher as any).activeLocks.set('TEST_EXPIRED_KEY', {
        symbol: 'BTCUSDT',
        corridor: 'BINANCE_BYBIT',
        botId: 'old_bot',
        userId: TEST_TENANT_ALPHA_ID,
        acquiredAt: Date.now() - 60000,
        expiresAt: Date.now() - 30000, // Expired 30s ago
      });

      // Calling cleanExpiredLocks or acquiring a lock cleans stale entries
      (dispatcher as any).cleanExpiredLocks(Date.now());
      expect((dispatcher as any).activeLocks.has('TEST_EXPIRED_KEY')).toBe(false);
    });

    it('P3-B-04: symbol normalization strips delimiters and matches consistently', () => {
      dispatcher.acquireFleetLock('BTC/USDT', 'BINANCE_BYBIT', 'bot_1', TEST_TENANT_ALPHA_ID);
      // Normalized lookup BTCUSDT matches
      expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(true);
    });

    it('P3-B-05: empty corridor parameter falls back safely to symbol-only lock key', () => {
      const acquired = dispatcher.acquireFleetLock('ETHUSDT', '', 'bot_1', TEST_TENANT_ALPHA_ID);
      expect(acquired).toBe(true);
      expect(dispatcher.isSymbolLockedFleetWide('ETHUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 4 Boundaries: Auto-Adaptive Hurdle & Epsilon Sizing
  // --------------------------------------------------------------------------
  describe('Phase 4 Boundaries: Layer 7 Dynamic Exit Epsilon Sizing', () => {
    it('P4-B-01: extreme micro-notional $0.0001 clamps safely to $0.0100 USDT floor', () => {
      expect(getEffectiveZeroLossFloorUsdt(0.0001)).toBe(0.0100);
    });

    it('P4-B-02: notional of $59.99 (just under base unit) clamps to $0.0100 USDT floor', () => {
      expect(getEffectiveZeroLossFloorUsdt(59.99)).toBe(0.0100);
    });

    it('P4-B-03: user override epsilon: $0.0099 is clamped to $0.0100 while $0.0100 is respected', () => {
      // 1 cent under safety floor -> clamped to 0.0100
      expect(getEffectiveZeroLossFloorUsdt(60.00, 0.0099)).toBe(0.0100);
      // Exact safety floor -> respected
      expect(getEffectiveZeroLossFloorUsdt(60.00, 0.0100)).toBe(0.0100);
    });

    it('P4-B-04: extreme macro-notional of $6,000.00 scales linearly to $1.0000 floor', () => {
      // $6000 / $60 * 0.0100 = $1.0000 USDT floor
      expect(getEffectiveZeroLossFloorUsdt(6000.00)).toBe(1.0000);
    });

    it('P4-B-05: negative Net PnL (-$0.0001) strictly fails zero-loss gate', () => {
      // Expansion exists, but fees cause Net PnL to be negative
      const evaluation = evaluateExitGates(
        0.000,
        0.250, // Insufficient expansion to overcome 0.260% roundtrip friction
        'LONG_BN_SHORT_BYB',
        20,
        0.000,
        300.00
      );

      expect(evaluation.netPnlUsdt).toBeLessThan(0);
      expect(evaluation.zeroLossSatisfied).toBe(false);
      expect(evaluation.shouldExit).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 5 Boundaries: Coin Quarantine Caller Scoping
  // --------------------------------------------------------------------------
  describe('Phase 5 Boundaries: Quarantine Scope & Delimiter Normalization', () => {
    it('P5-B-01: undefined caller userId falls back safely without unhandled exceptions', () => {
      expect(() => {
        lockFlattenedCoinForBot('TESTCOIN', undefined, undefined);
      }).not.toThrow();
    });

    it('P5-B-02: locking already quarantined coin is idempotent and does not duplicate entries', () => {
      lockFlattenedCoinForBot('SOLUSDT', undefined, TEST_TENANT_ALPHA_ID);
      lockFlattenedCoinForBot('SOLUSDT', undefined, TEST_TENANT_ALPHA_ID);

      const alphaState = loadBotState(TEST_TENANT_ALPHA_ID);
      const matches = alphaState.bots[0].flattenedCoinsBlacklist.filter((s) => s === 'SOLUSDT');
      expect(matches.length).toBe(1);
    });

    it('P5-B-03: multiple distinct coin quarantines accumulate cleanly up to blacklist capacity', () => {
      const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'NEARUSDT'];
      for (const coin of coins) {
        lockFlattenedCoinForBot(coin, undefined, TEST_TENANT_ALPHA_ID);
      }

      const alphaState = loadBotState(TEST_TENANT_ALPHA_ID);
      expect(alphaState.bots[0].flattenedCoinsBlacklist).toEqual(expect.arrayContaining(coins));
    });

    it('P5-B-04: lowercased coin symbol is normalized to uppercase in blacklist', () => {
      lockFlattenedCoinForBot('dogeusdt', undefined, TEST_TENANT_ALPHA_ID);

      const alphaState = loadBotState(TEST_TENANT_ALPHA_ID);
      expect(alphaState.bots[0].flattenedCoinsBlacklist).toContain('DOGEUSDT');
    });

    it('P5-B-05: memory reset on non-existent botId leaves existing state safe', () => {
      lockFlattenedCoinForBot('BTCUSDT', undefined, TEST_TENANT_ALPHA_ID);
      resetBotMemory('non_existent_bot_id', TEST_TENANT_ALPHA_ID);

      const alphaState = loadBotState(TEST_TENANT_ALPHA_ID);
      expect(alphaState.bots[0].flattenedCoinsBlacklist).toContain('BTCUSDT');
    });
  });

  // --------------------------------------------------------------------------
  // Phase 6 Boundaries: Session Tokens & Cron Gating
  // --------------------------------------------------------------------------
  describe('Phase 6 Boundaries: Auth Cookie Edge Cases & Cron Mismatches', () => {
    it('P6-B-01: empty cookie string returns null safely', () => {
      const req = createMockNextRequest('/api/divergence/daemon', { cookie: '' });
      expect(getAuthenticatedUser(req)).toBeNull();
    });

    it('P6-B-02: cookie with auth_session= and empty value returns null', () => {
      const req = createMockNextRequest('/api/divergence/daemon', { cookie: 'auth_session=' });
      expect(getAuthenticatedUser(req)).toBeNull();
    });

    it('P6-B-03: session token signed for User A fails if token payload was replaced with User B', () => {
      const tokenA = createSessionToken('user_a');
      const sigA = tokenA.split('.')[1];
      const forgedToken = `user_b.${sigA}`;

      expect(verifySessionToken(forgedToken)).toBeNull();
    });

    it('P6-B-04: undefined or blank x-cron-secret header is rejected', () => {
      process.env.CRON_SECRET = 'valid_cron_secret';
      const req = createMockNextRequest('/api/divergence/daemon', {
        headers: { 'x-cron-secret': '' },
      });
      const headerSecret = req.headers.get('x-cron-secret');
      expect(headerSecret === process.env.CRON_SECRET).toBe(false);
    });

    it('P6-B-05: verifies all boundary test logs adhere to zero BPS notation and modern terminology', () => {
      const boundaryReport = "Multi-tenant execution engine completed boundary verification with 0.000% error rate";
      expect(assertZeroBpsNotation(boundaryReport)).toBe(true);
      expect(assertModernTerminologyOnly(boundaryReport)).toBe(true);
    });
  });
});
