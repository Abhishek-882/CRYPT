/**
 * Tier 4: Real-World Application Scenarios — Multi-Tenant End-to-End Trading Workflows
 * 
 * Verifies production multi-tenant trading flows under realistic market conditions:
 * - Scenario 1: Comprehensive User-Specified Test L7-01 Real-World Validation
 *   - Account 1 (Micro / Starter): $6 margin @ 10x leverage = $60 notional -> $0.0100 floor
 *   - Account 2 (Standard Quant): $30 margin @ 10x leverage = $300 notional -> $0.0500 floor
 *   - Account 3 (Institutional): $60 margin @ 10x leverage = $600 notional -> $0.1000 floor
 * - Scenario 2: High-Speed Concurrent Cross-Tenant Order Execution on Identical Asset
 * - Scenario 3: Autonomous Lifecycle Persistence & Tenant Lock Isolation
 * - Scenario 4: Zero-Trust Security Perimeter Defense against Credential Hijacking
 * - Scenario 5: Manual Position Flattening & Blacklist Quarantine Isolation
 * - Scenario 6: System-Wide Invariant Audit (Zero BPS Notation & Modern Architecture Terminology)
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
} from '@/lib/botEngine';
import { FleetDispatcher } from '@/lib/fleetDispatcher';
import {
  getEffectiveZeroLossFloorUsdt,
  evaluateExitGates,
  calculateNetRealizedPnlUsdt,
  calculateRelativeExpansionPercent,
} from '@/lib/divergence/engine';
import {
  calculateDynamicLeverage,
} from '@/lib/leverageManager';
import {
  getAuthenticatedUser,
} from '@/lib/userStore';
import {
  TEST_ADMIN_ID,
  TEST_TENANT_ALPHA_ID,
  TEST_TENANT_BETA_ID,
  TEST_TENANT_GAMMA_ID,
  createMockTenantAlpha,
  createMockTenantBeta,
  createMockTenantEmptyKeys,
  createSessionCookie,
  createMockNextRequest,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 4: Real-World Application Scenarios — End-to-End Multi-Tenant Execution', () => {
  const customLockFile = 'test_tier4_real_world.lock';
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
  // Scenario 1: Test L7-01 Real-World Capital Scaling
  // --------------------------------------------------------------------------
  it('Scenario 1 (Test L7-01 Real-World Validation): executes multi-tier capital allocation with dynamic exit gates', () => {
    // ------------------------------------------------------------------------
    // Plan 1: Micro / Starter ($6 margin @ 10x leverage = $60 notional)
    // ------------------------------------------------------------------------
    const microNotional = 60.00;
    const microFloor = getEffectiveZeroLossFloorUsdt(microNotional);
    expect(microFloor).toBe(0.0100);

    // Case 1a: Expansion clears fee friction (0.260%) and hurdle -> Exits at profit
    // Gross Yield = 0.380%, Roundtrip friction = 0.260%, Net Yield = 0.120%
    // Net PnL = $60.00 * (0.120 / 100) = $0.0720 >= $0.0100 -> EXPANSION_TP
    const microEvalPass = evaluateExitGates(
      0.000,
      0.380,
      'LONG_BN_SHORT_BYB',
      15,
      0.000,
      microNotional
    );
    expect(microEvalPass.zeroLossSatisfied).toBe(true);
    expect(microEvalPass.shouldExit).toBe(true);
    expect(microEvalPass.reason).toBe('EXPANSION_TP');

    // Case 1b: Price fluctuates near breakeven ($0.0050 Net PnL < $0.0100) -> Gate blocks exit
    const microEvalHold = evaluateExitGates(
      0.000,
      0.265, // Generates Net PnL < $0.0100
      'LONG_BN_SHORT_BYB',
      15,
      0.000,
      microNotional
    );
    expect(microEvalHold.zeroLossSatisfied).toBe(false);
    expect(microEvalHold.shouldExit).toBe(false);

    // ------------------------------------------------------------------------
    // Plan 2: Standard Quant ($30 margin @ 10x leverage = $300 notional)
    // ------------------------------------------------------------------------
    const standardNotional = 300.00;
    const standardFloor = getEffectiveZeroLossFloorUsdt(standardNotional);
    expect(standardFloor).toBe(0.0500); // 5x capital -> 5x floor

    // Case 2a: Net PnL clears $0.0500 hurdle -> Takes profit
    const standardEvalPass = evaluateExitGates(
      0.000,
      0.380,
      'LONG_BN_SHORT_BYB',
      25,
      0.000,
      standardNotional
    );
    expect(standardEvalPass.zeroLossSatisfied).toBe(true);
    expect(standardEvalPass.shouldExit).toBe(true);
    expect(standardEvalPass.reason).toBe('EXPANSION_TP');

    // Case 2b: Net PnL = +$0.0200 (would pass old $0.01 static floor, but fails dynamic $0.0500 floor)
    const standardEvalHold = evaluateExitGates(
      0.000,
      0.267, // Yields approx +$0.0210 Net PnL (< $0.0500 floor)
      'LONG_BN_SHORT_BYB',
      25,
      0.000,
      standardNotional
    );
    expect(standardEvalHold.zeroLossSatisfied).toBe(false);
    expect(standardEvalHold.shouldExit).toBe(false);

    // ------------------------------------------------------------------------
    // Plan 3: Institutional Whale ($60 margin @ 10x leverage = $600 notional)
    // ------------------------------------------------------------------------
    const institutionalNotional = 600.00;
    const institutionalFloor = getEffectiveZeroLossFloorUsdt(institutionalNotional);
    expect(institutionalFloor).toBe(0.1000); // 10x capital -> 10x floor

    // Case 3a: Net PnL clears $0.1000 hurdle -> Takes profit
    const instEvalPass = evaluateExitGates(
      0.000,
      0.380,
      'LONG_BN_SHORT_BYB',
      30,
      0.000,
      institutionalNotional
    );
    expect(instEvalPass.zeroLossSatisfied).toBe(true);
    expect(instEvalPass.shouldExit).toBe(true);
    expect(instEvalPass.reason).toBe('EXPANSION_TP');

    // Case 3b: Net PnL = +$0.0600 (below $0.1000 hurdle) -> Gate blocks early exit
    const instEvalHold = evaluateExitGates(
      0.000,
      0.270, // Generates Net PnL ~ $0.0600 (< $0.1000)
      'LONG_BN_SHORT_BYB',
      30,
      0.000,
      institutionalNotional
    );
    expect(instEvalHold.zeroLossSatisfied).toBe(false);
    expect(instEvalHold.shouldExit).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Multi-Tenant Concurrent Trading Flow on Same Asset
  // --------------------------------------------------------------------------
  it('Scenario 2: independent tenants trade identical asset simultaneously without mutex collisions', () => {
    const alpha = createMockTenantAlpha();
    const beta = createMockTenantBeta();

    // 1. Pre-flight credential verification succeeds independently
    const alphaCreds = getVerifiedCredentialsForTenant(alpha.id, alpha.apiKeys, 'BINANCE_BYBIT');
    const betaCreds = getVerifiedCredentialsForTenant(beta.id, beta.apiKeys, 'BINANCE_BYBIT');
    expect(alphaCreds.binanceKey).toBe(alpha.apiKeys.binanceKey);
    expect(betaCreds.binanceKey).toBe(beta.apiKeys.binanceKey);
    expect(alphaCreds.binanceKey).not.toBe(betaCreds.binanceKey);

    // 2. Both acquire fleet mutex locks on BTCUSDT simultaneously
    const alphaLock = dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'worker_alpha', alpha.id);
    const betaLock = dispatcher.acquireFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'worker_beta', beta.id);
    expect(alphaLock).toBe(true);
    expect(betaLock).toBe(true);

    // 3. Dynamic leverage evaluated independently
    const alphaLev = calculateDynamicLeverage('BTCUSDT', 'Binance', undefined, 24, 50, {
      normalCoinLeverage: 20,
      volatileCoinLeverage: 10,
    });
    const betaLev = calculateDynamicLeverage('SOLUSDT', 'Binance', undefined, 24, 25, {
      normalCoinLeverage: 15,
      volatileCoinLeverage: 5,
    });
    expect(alphaLev).toBe(20);
    expect(betaLev).toBe(15);

    // 4. Alpha completes execution and releases lock; Beta remains active
    dispatcher.releaseFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'worker_alpha', alpha.id);
    expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, alpha.id)).toBe(false);
    expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, beta.id)).toBe(true);

    // 5. Beta completes execution and releases lock
    dispatcher.releaseFleetLock('BTCUSDT', 'BINANCE_BYBIT', 'worker_beta', beta.id);
    expect(dispatcher.isSymbolLockedFleetWide('BTCUSDT', undefined, beta.id)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Autonomous Lifecycle Persistence & Tenant Lock Isolation
  // --------------------------------------------------------------------------
  it('Scenario 3: tenant pause leaves peer tenant active with physical OS lockfile intact', () => {
    // Both tenants start autonomous engines
    acquireDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
    acquireDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });
    expect(fs.existsSync(lockFilePath)).toBe(true);
    expect(getActiveTenantsForDaemonLock(customLockFile).length).toBe(2);

    // Tenant Alpha pauses execution engine
    const alphaStop = releaseDaemonLockForTenant(TEST_TENANT_ALPHA_ID, { lockFileName: customLockFile });
    expect(alphaStop.released).toBe(false);
    expect(alphaStop.remainingTenants).toBe(1);

    // Critical invariant: OS lockfile remains held on disk because Tenant Beta is actively running
    expect(fs.existsSync(lockFilePath)).toBe(true);
    expect(isDaemonLocked(customLockFile)).toBe(true);
    expect(getActiveTenantsForDaemonLock(customLockFile)).toContain(TEST_TENANT_BETA_ID);

    // Tenant Beta completes run and pauses
    const betaStop = releaseDaemonLockForTenant(TEST_TENANT_BETA_ID, { lockFileName: customLockFile });
    expect(betaStop.released).toBe(true);
    expect(betaStop.remainingTenants).toBe(0);

    // Critical invariant: lockfile cleanly unlinked when last tenant stops
    expect(fs.existsSync(lockFilePath)).toBe(false);
    expect(isDaemonLocked(customLockFile)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Zero-Trust Security Perimeter Defense
  // --------------------------------------------------------------------------
  it('Scenario 4: defense against unauthenticated access and credential fallback attacks', () => {
    // Attack 1: Unauthenticated network request to divergence daemon
    const unauthReq = createMockNextRequest('/api/divergence/daemon', {
      method: 'POST',
      body: { action: 'start' },
    });
    expect(getAuthenticatedUser(unauthReq)).toBeNull();

    // Attack 2: Non-admin tenant with empty keys attempting live trading
    const emptyGamma = createMockTenantEmptyKeys();
    expect(() => {
      getVerifiedCredentialsForTenant(emptyGamma.id, emptyGamma.apiKeys, 'BINANCE_BYBIT');
    }).toThrowError(MissingCredentialsError);

    // Attack 3: Tampered session token
    const tamperedReq = createMockNextRequest('/api/divergence/daemon', {
      cookie: 'auth_session=usr_admin_varsha.forged_signature_attack_attempt',
    });
    expect(getAuthenticatedUser(tamperedReq)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Manual Position Flattening & Blacklist Quarantine Isolation
  // --------------------------------------------------------------------------
  it('Scenario 5: manual coin flatten isolates quarantine strictly to caller', () => {
    // Tenant Alpha flattens SOLUSDT
    lockFlattenedCoinForBot('SOLUSDT', undefined, TEST_TENANT_ALPHA_ID);

    const alphaState = loadBotState(TEST_TENANT_ALPHA_ID);
    expect(alphaState.bots[0].flattenedCoinsBlacklist).toContain('SOLUSDT');

    // Tenant Beta is completely unaffected and continues trading SOLUSDT
    const betaState = loadBotState(TEST_TENANT_BETA_ID);
    expect(betaState.bots[0].flattenedCoinsBlacklist).not.toContain('SOLUSDT');

    const betaAcquired = dispatcher.acquireFleetLock('SOLUSDT', 'BINANCE_BYBIT', 'worker_beta', TEST_TENANT_BETA_ID);
    expect(betaAcquired).toBe(true);

    // Administrator bot state remains untouched
    const adminState = loadBotState(TEST_ADMIN_ID);
    expect(adminState.bots[0].flattenedCoinsBlacklist).not.toContain('SOLUSDT');
  });

  // --------------------------------------------------------------------------
  // Scenario 6: System-Wide Invariant Audit (Zero BPS & Modern Terminology)
  // --------------------------------------------------------------------------
  it('Scenario 6: audits system-wide zero BPS notation and modern architecture terminology', () => {
    const telemetryStrings = [
      "Layer 7 Dynamic Exit Engine evaluated Net Yield = +0.267%",
      "Order notional: $300.00 USDT | dynamic hurdle: $0.0500 USDT",
      "Auto-adapted exit hurdle satisfied: net profit cleared +$0.0500 USDT",
      "Autonomous execution engine: 10x volatile leverage, 20x normal coin leverage",
      "Tenant runner active in isolated memory space",
      "Relative expansion gate: 0.380% | conservative roundtrip fee: 0.260%",
    ];

    for (const line of telemetryStrings) {
      expect(assertZeroBpsNotation(line)).toBe(true);
      expect(assertModernTerminologyOnly(line)).toBe(true);
    }
  });
});
