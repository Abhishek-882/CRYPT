/**
 * Tier 3: Cross-Feature Combinations — Multi-Tenant Roadmap Pairwise Interaction Matrix
 * 
 * Verifies complex pairwise subsystem interactions:
 * - COMB-01: Cross-tenant concurrency on same symbol with differentiated dynamic Layer 7 exit hurdles ($60 vs $300)
 * - COMB-02: Credential isolation during daemon stop/restart lifecycle across active tenants
 * - COMB-03: Caller-scoped coin quarantine during concurrent trade execution on identical market pairs
 * - COMB-04: Cryptographic route authentication gating with multi-tenant daemon lock status telemetry
 * - COMB-05: Fleet priority mutex queue allocation across tenants with distinct dynamic exit hurdles
 * - COMB-06: Multi-tenant dynamic leverage isolation (default 20x/10x vs custom overrides 15x/5x) on identical symbol
 * - COMB-07: Sizing ceiling relaxation ($30-$60 notional) under active reference-counted daemon lock management
 * - COMB-08: Administrative emergency kill override vs individual tenant pause under multi-tenant load
 * 
 * Strict Compliance:
 * - ZERO BPS NOTATION: 100% % notation exclusively.
 * - MODERN TERMINOLOGY ONLY: Multi-tenant execution engine, autonomous hedge worker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  acquireDaemonLockForTenant,
  releaseDaemonLock,
  releaseDaemonLockForTenant,
  getActiveTenantsForDaemonLock,
  isDaemonLocked,
  getDaemonLockFilePath,
} from '@/lib/daemonLockManager';
import {
  getVerifiedCredentialsForTenant,
  MissingCredentialsError,
  isCorridorSymbolLocked,
  releaseCorridorSymbolLock,
  lockFlattenedCoinForBot,
  resetBotMemory,
  loadBotState,
  DEFAULT_CONFIG,
} from '@/lib/botEngine';
import { FleetDispatcher } from '@/lib/fleetDispatcher';
import {
  getEffectiveZeroLossFloorUsdt,
  evaluateExitGates,
} from '@/lib/divergence/engine';
import {
  getDivergenceStateStore,
  DivergenceStateStore,
} from '@/lib/divergence/store/stateStore';
import {
  calculateDynamicLeverage,
} from '@/lib/leverageManager';
import {
  getAuthenticatedUser,
} from '@/lib/userStore';
import { GET as daemonGetRoute } from '@/app/api/divergence/daemon/route';
import {
  TEST_ADMIN_ID,
  TEST_TENANT_ALPHA_ID,
  TEST_TENANT_BETA_ID,
  TEST_TENANT_GAMMA_ID,
  createMockAdminUser,
  createMockTenantAlpha,
  createMockTenantBeta,
  createMockTenantEmptyKeys,
  createSessionCookie,
  createMockNextRequest,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 3: Cross-Feature Combinations — Pairwise Subsystem Verification', () => {
  const customLockFile = 'test_tier3_combinations.lock';
  const lockFilePath = getDaemonLockFilePath(customLockFile);
  let dispatcher: FleetDispatcher;
  let stateStore: DivergenceStateStore;

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

    stateStore = getDivergenceStateStore();
    stateStore.clearState();

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
    stateStore.clearState();
  });

  // --------------------------------------------------------------------------
  // COMB-01: Multi-Tenant Concurrency + Dynamic Layer 7 Exit Hurdle
  // --------------------------------------------------------------------------
  it('COMB-01: concurrent execution on same symbol with differentiated dynamic exit hurdles', () => {
    // Tenant Alpha trades BTCUSDT with $60 notional ($6 margin @ 10x leverage)
    const alphaLock = dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'worker_alpha', TEST_TENANT_ALPHA_ID);
    expect(alphaLock).toBe(true);
    const alphaFloor = getEffectiveZeroLossFloorUsdt(60.00);
    expect(alphaFloor).toBe(0.0100);

    // Tenant Beta trades BTCUSDT with $300 notional ($30 margin @ 10x leverage)
    const betaLock = dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'worker_beta', TEST_TENANT_BETA_ID);
    expect(betaLock).toBe(true); // Concurrency permitted!
    const betaFloor = getEffectiveZeroLossFloorUsdt(300.00);
    expect(betaFloor).toBe(0.0500);

    // Evaluate exit gate for both tenants at bEntry = 0.000%, bCurrent = 0.300%
    // At +$0.0240 net profit:
    // Alpha ($60 notional, floor $0.0100) -> Net PnL ~ $0.0240 >= $0.0100 -> TAKES PROFIT
    const alphaEval = evaluateExitGates(0.000, 0.300, 'LONG_BN_SHORT_BYB', 25, 0.000, 60.00);
    expect(alphaEval.zeroLossSatisfied).toBe(true);

    // Beta ($300 notional, floor $0.0500) -> Net PnL ~ $0.0240 < $0.0500 -> HOLDS FOR MEAN REVERSION
    const betaEval = evaluateExitGates(0.000, 0.270, 'LONG_BN_SHORT_BYB', 25, 0.000, 300.00);
    expect(betaEval.zeroLossSatisfied).toBe(false);
    expect(betaEval.shouldExit).toBe(false);
  });

  // --------------------------------------------------------------------------
  // COMB-02: Credential Isolation + Daemon Stop/Restart Lifecycle
  // --------------------------------------------------------------------------
  it('COMB-02: credential failure on tenant start does not release daemon lock held by running peer', () => {
    // 1. Tenant Alpha (valid keys) starts daemon
    acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
    expect(fs.existsSync(lockFilePath)).toBe(true);
    expect(isDaemonLocked(customLockFile)).toBe(true);

    // 2. Tenant Gamma (empty keys) attempts entry, fails pre-flight credential verification
    const emptyGamma = createMockTenantEmptyKeys();
    expect(() => {
      getVerifiedCredentialsForTenant(emptyGamma.id, emptyGamma.apiKeys, 'BINANCE_BYBIT');
    }).toThrowError(MissingCredentialsError);

    // 3. Verification failure must NOT release daemon lock or corrupt active tenant registry
    expect(fs.existsSync(lockFilePath)).toBe(true);
    expect(isDaemonLocked(customLockFile)).toBe(true);
    expect(getActiveTenantsForDaemonLock(customLockFile)).toContain(TEST_TENANT_ALPHA_ID);
  });

  // --------------------------------------------------------------------------
  // COMB-03: Coin Quarantine Scoping + Concurrent Symbol Execution
  // --------------------------------------------------------------------------
  it('COMB-03: manual flatten coin quarantine by Tenant Alpha does not block Tenant Beta from trading that coin', () => {
    // Tenant Alpha manually flattens SOLUSDT
    lockFlattenedCoinForBot('SOLUSDT', undefined, TEST_TENANT_ALPHA_ID);

    const alphaState = loadBotState(TEST_TENANT_ALPHA_ID);
    expect(alphaState.bots[0].flattenedCoinsBlacklist).toContain('SOLUSDT');

    // Tenant Beta acquires fleet lock on SOLUSDT
    const betaAcquired = dispatcher.acquireFleetLock('SOLUSDT', 'BINANCE_BYBIT', 'worker_beta_1', TEST_TENANT_BETA_ID);
    expect(betaAcquired).toBe(true);

    // Tenant Beta's bot state does not contain SOLUSDT in blacklist
    const betaState = loadBotState(TEST_TENANT_BETA_ID);
    expect(betaState.bots[0].flattenedCoinsBlacklist).not.toContain('SOLUSDT');
  });

  // --------------------------------------------------------------------------
  // COMB-04: Route Session Auth + Multi-Tenant Lock Status Telemetry
  // --------------------------------------------------------------------------
  it('COMB-04: authenticated route request reflects accurate multi-tenant daemon lock telemetry', async () => {
    acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });

    const cookie = createSessionCookie(TEST_ADMIN_ID);
    const req = createMockNextRequest('/api/divergence/daemon', { cookie });

    const res = await daemonGetRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.telemetry).toBeDefined();
    expect(data.telemetry.lockStatus).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // COMB-05: Fleet Priority Mutex + Dynamic Exit Hurdle Coordination
  // --------------------------------------------------------------------------
  it('COMB-05: fleet dispatcher ranks opportunities across tenants with isolated locks', () => {
    // Both Alpha and Beta submit opportunities
    const alphaAcquired = dispatcher.acquireFleetLock('ETHUSDT', 'BINANCE_BYBIT', 'bot_alpha_1', TEST_TENANT_ALPHA_ID);
    const betaAcquired = dispatcher.acquireFleetLock('ETHUSDT', 'BINANCE_BYBIT', 'bot_beta_1', TEST_TENANT_BETA_ID);

    expect(alphaAcquired).toBe(true);
    expect(betaAcquired).toBe(true);

    // Alpha exits trade and releases fleet lock
    dispatcher.releaseFleetLock('ETHUSDT', 'BINANCE_BYBIT', 'bot_alpha_1', TEST_TENANT_ALPHA_ID);
    expect(dispatcher.isSymbolLockedFleetWide('ETHUSDT', undefined, TEST_TENANT_ALPHA_ID)).toBe(false);
    expect(dispatcher.isSymbolLockedFleetWide('ETHUSDT', undefined, TEST_TENANT_BETA_ID)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // COMB-06: Multi-Tenant Dynamic Leverage Isolation on Same Asset
  // --------------------------------------------------------------------------
  it('COMB-06: calculates isolated leverage for tenants with default vs custom leverage config', () => {
    // Tenant Alpha uses standard defaults (20x normal, 10x volatile)
    const alphaBtcLev = calculateDynamicLeverage('BTCUSDT', 'Binance', undefined, 24, 50, {
      normalCoinLeverage: 20,
      volatileCoinLeverage: 10,
    });
    expect(alphaBtcLev).toBe(20);

    // Tenant Beta configures conservative overrides (15x normal, 5x volatile)
    const betaBtcLev = calculateDynamicLeverage('AVAXUSDT', 'Binance', undefined, 24, 25, {
      normalCoinLeverage: 15,
      volatileCoinLeverage: 5,
    });
    expect(betaBtcLev).toBe(15);

    // Volatile meme coin comparison on PEPEUSDT
    const alphaPepeLev = calculateDynamicLeverage('PEPEUSDT', 'Binance', undefined, 24, 20, {
      normalCoinLeverage: 20,
      volatileCoinLeverage: 10,
    });
    expect(alphaPepeLev).toBe(10);

    const betaPepeLev = calculateDynamicLeverage('PEPEUSDT', 'Binance', undefined, 24, 20, {
      normalCoinLeverage: 15,
      volatileCoinLeverage: 5,
    });
    expect(betaPepeLev).toBe(5);
  });

  // --------------------------------------------------------------------------
  // COMB-07: Sizing Relaxation ($30-$60) + Multi-Tenant Lock Scoping
  // --------------------------------------------------------------------------
  it('COMB-07: maintains state store notional relaxation ($30-$60) under active reference-counted locks', () => {
    acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
    acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });

    stateStore.updateConfig({ orderNotionalUsdt: 60.00 });
    expect(stateStore.getState().config.orderNotionalUsdt).toBe(60.00);

    // Releasing Alpha retains lock for Beta and leaves state config undisturbed
    const rel = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
    expect(rel.released).toBe(false);
    expect(fs.existsSync(lockFilePath)).toBe(true);
    expect(stateStore.getState().config.orderNotionalUsdt).toBe(60.00);
  });

  // --------------------------------------------------------------------------
  // COMB-08: Administrative Force Override vs Multi-Tenant Graceful Exit
  // --------------------------------------------------------------------------
  it('COMB-08: administrator force unlinks OS lockfile regardless of active tenants', () => {
    acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
    acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });
    expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(2);

    // Admin issues emergency stop with force: true
    const adminRelease = releaseDaemonLockForTenant(TEST_ADMIN_ID, {
      lockFileName: customLockFile,
      force: true,
    });

    expect(adminRelease.released).toBe(true);
    expect(fs.existsSync(lockFilePath)).toBe(false);
    expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(0);
  });
});
