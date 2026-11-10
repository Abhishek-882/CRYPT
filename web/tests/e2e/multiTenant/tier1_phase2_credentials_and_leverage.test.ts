/**
 * Tier 1: Feature Coverage — Phase 2: Credential Isolation & Leverage Configuration
 * 
 * Verifies:
 * - Strict non-admin tenant credential isolation
 * - Stripping of ADMIN_* and SYSTEM_DEFAULT_* secret fallbacks for non-admin accounts
 * - Explicit typed MissingCredentialsError on missing corridor keys
 * - Administrator account fallback preservation for root maintenance
 * - User-configurable leverage: 20x normal coins, 10x volatile/meme coins, and custom overrides
 * 
 * Strict Compliance:
 * - ZERO BPS NOTATION: 100% % notation exclusively.
 * - MODERN TERMINOLOGY ONLY: Multi-tenant execution engine, autonomous hedge worker.
 */

import { describe, it, expect } from 'vitest';
import {
  getVerifiedCredentialsForTenant,
  MissingCredentialsError,
  isTenantAdmin,
  DEFAULT_CONFIG,
  BotConfig,
} from '@/lib/botEngine';
import {
  calculateDynamicLeverage,
  LeverageManager,
} from '@/lib/leverageManager';
import {
  encryptVaultSecret,
} from '@/lib/cryptoVault';
import {
  TEST_ADMIN_ID,
  TEST_TENANT_ALPHA_ID,
  TEST_TENANT_GAMMA_ID,
  createMockAdminUser,
  createMockTenantAlpha,
  createMockTenantEmptyKeys,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 1: Phase 2 — Strict Credential Isolation & Leverage Configuration', () => {
  // --------------------------------------------------------------------------
  // Feature 3: Strict Non-Admin Key Isolation & Admin Secret Fallback Stripping
  // --------------------------------------------------------------------------
  describe('Feature 3: Strict Credential Isolation', () => {
    it('P2-F3-01: non-admin tenant with valid corridor keys successfully resolves verified credentials', () => {
      const alpha = createMockTenantAlpha();
      const creds = getVerifiedCredentialsForTenant(
        alpha.id,
        alpha.apiKeys,
        'BINANCE_BYBIT'
      );

      expect(creds.isAdmin).toBe(false);
      expect(creds.binanceKey).toBe(alpha.apiKeys.binanceKey);
      expect(creds.binanceSecret).toBe(alpha.apiKeys.binanceSecret);
      expect(creds.bybitKey).toBe(alpha.apiKeys.bybitKey);
      expect(creds.bybitSecret).toBe(alpha.apiKeys.bybitSecret);
    });

    it('P2-F3-02: non-admin tenant never falls back to admin secrets for unused venues', () => {
      const alpha = createMockTenantAlpha();
      // Alpha only configured Binance and Bybit; Bitget and CoinDCX are empty
      const creds = getVerifiedCredentialsForTenant(
        alpha.id,
        alpha.apiKeys,
        'BINANCE_BYBIT'
      );

      expect(creds.bitgetKey).toBe('');
      expect(creds.bitgetSecret).toBe('');
      expect(creds.coindcxKey).toBe('');
      expect(creds.coindcxSecret).toBe('');
    });

    it('P2-F3-03: admin user correctly resolves system default credentials when custom keys are omitted', () => {
      const admin = createMockAdminUser();
      const adminCreds = getVerifiedCredentialsForTenant(
        admin.id,
        undefined, // No custom keys provided
        'BINANCE_BYBIT'
      );

      expect(adminCreds.isAdmin).toBe(true);
      expect(adminCreds.binanceKey).toBeDefined();
      expect(adminCreds.binanceKey.length).toBeGreaterThan(0);
      expect(adminCreds.bybitKey).toBeDefined();
      expect(adminCreds.bybitKey.length).toBeGreaterThan(0);
    });

    it('P2-F3-04: decrypts encrypted vault secrets (enc:v1:...) cleanly for tenant credentials', () => {
      const plainSecret = 'super_secret_bybit_pass_123';
      const encSecret = encryptVaultSecret(plainSecret);
      expect(encSecret.startsWith('enc:v1:')).toBe(true);

      const alpha = createMockTenantAlpha();
      alpha.apiKeys.bybitSecret = encSecret;

      const creds = getVerifiedCredentialsForTenant(
        alpha.id,
        alpha.apiKeys,
        'BINANCE_BYBIT'
      );

      expect(creds.bybitSecret).toBe(plainSecret);
    });

    it('P2-F3-05: verifies role isolation function distinguishes admin from tenant correctly', () => {
      expect(isTenantAdmin(TEST_ADMIN_ID)).toBe(true);
      expect(isTenantAdmin('usr_admin_varsha')).toBe(true);
      expect(isTenantAdmin('admin')).toBe(true);
      expect(isTenantAdmin(TEST_TENANT_ALPHA_ID)).toBe(false);
      expect(isTenantAdmin(TEST_TENANT_GAMMA_ID)).toBe(false);
      expect(isTenantAdmin(undefined)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 4: Explicit Credential Verification & Error Generation
  // --------------------------------------------------------------------------
  describe('Feature 4: Explicit Credential Error Verification', () => {
    it('P2-F4-01: non-admin tenant with missing Bybit keys throws MissingCredentialsError for BINANCE_BYBIT', () => {
      const tenant = createMockTenantAlpha();
      tenant.apiKeys.bybitKey = '';
      tenant.apiKeys.bybitSecret = '';

      expect(() => {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BINANCE_BYBIT');
      }).toThrowError(MissingCredentialsError);

      try {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BINANCE_BYBIT');
      } catch (err: any) {
        expect(err.code).toBe('MISSING_EXCHANGE_CREDENTIALS');
        expect(err.venue).toBe('Bybit');
        expect(err.userId).toBe(tenant.id);
      }
    });

    it('P2-F4-02: non-admin tenant with missing Binance keys throws MissingCredentialsError for BINANCE_BITGET', () => {
      const tenant = createMockTenantAlpha();
      tenant.apiKeys.binanceKey = '';
      tenant.apiKeys.binanceSecret = '';
      tenant.apiKeys.bitgetKey = 'bitget_key';
      tenant.apiKeys.bitgetSecret = 'bitget_secret';
      tenant.apiKeys.bitgetPassphrase = 'bitget_passphrase';

      expect(() => {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BINANCE_BITGET');
      }).toThrowError(MissingCredentialsError);

      try {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BINANCE_BITGET');
      } catch (err: any) {
        expect(err.code).toBe('MISSING_EXCHANGE_CREDENTIALS');
        expect(err.venue).toBe('Binance');
      }
    });

    it('P2-F4-03: non-admin tenant with missing Bitget passphrase throws MissingCredentialsError for BITGET_BYBIT', () => {
      const tenant = createMockTenantAlpha();
      tenant.apiKeys.bitgetKey = 'bg_key';
      tenant.apiKeys.bitgetSecret = 'bg_sec';
      tenant.apiKeys.bitgetPassphrase = ''; // Empty passphrase

      expect(() => {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BITGET_BYBIT');
      }).toThrowError(MissingCredentialsError);

      try {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'BITGET_BYBIT');
      } catch (err: any) {
        expect(err.code).toBe('MISSING_EXCHANGE_CREDENTIALS');
        expect(err.venue).toBe('Bitget');
      }
    });

    it('P2-F4-04: non-admin tenant with missing CoinDCX keys throws MissingCredentialsError for COINDCX_BYBIT', () => {
      const tenant = createMockTenantAlpha();
      tenant.apiKeys.coindcxKey = '';
      tenant.apiKeys.coindcxSecret = '';

      expect(() => {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'COINDCX_BYBIT');
      }).toThrowError(MissingCredentialsError);

      try {
        getVerifiedCredentialsForTenant(tenant.id, tenant.apiKeys, 'COINDCX_BYBIT');
      } catch (err: any) {
        expect(err.code).toBe('MISSING_EXCHANGE_CREDENTIALS');
        expect(err.venue).toBe('CoinDCX');
      }
    });

    it('P2-F4-05: tenant with completely empty credentials throws before attempting any exchange communication', () => {
      const emptyTenant = createMockTenantEmptyKeys();

      expect(() => {
        getVerifiedCredentialsForTenant(emptyTenant.id, emptyTenant.apiKeys, 'BINANCE_BYBIT');
      }).toThrowError(MissingCredentialsError);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 4b: Leverage Configuration & Dynamic Leverage Integration
  // --------------------------------------------------------------------------
  describe('Feature 4b: Leverage Configuration & Dynamic Leverage Integration', () => {
    it('P2-F4b-01: verifies default BotConfig provides normalCoinLeverage: 20 and volatileCoinLeverage: 10', () => {
      expect((DEFAULT_CONFIG as any).normalCoinLeverage).toBe(20);
      expect((DEFAULT_CONFIG as any).volatileCoinLeverage).toBe(10);
    });

    it('P2-F4b-02: calculateDynamicLeverage assigns default 20x for normal large-cap coins (BTC, SOL)', () => {
      const btcLev = calculateDynamicLeverage('BTCUSDT', 'Binance', undefined, 24, 50, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });
      expect(btcLev).toBe(20);

      const solLev = calculateDynamicLeverage('SOLUSDT', 'Binance', undefined, 24, 25, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });
      expect(solLev).toBe(20);
    });

    it('P2-F4b-03: calculateDynamicLeverage assigns default 10x for Tier 3 volatile/meme coins (PEPE, DOGE)', () => {
      const pepeLev = calculateDynamicLeverage('PEPEUSDT', 'Binance', undefined, 24, 20, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });
      expect(pepeLev).toBe(10);

      const memeLev = calculateDynamicLeverage('WIFUSDT', 'Bybit', undefined, 24, 20, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });
      expect(memeLev).toBe(10);
    });

    it('P2-F4b-04: user override for normalCoinLeverage (15x) and volatileCoinLeverage (5x) is honored', () => {
      const customConfig: Partial<BotConfig> = {
        normalCoinLeverage: 15,
        volatileCoinLeverage: 5,
      };

      const customNormal = calculateDynamicLeverage('ETHUSDT', 'Binance', undefined, 24, 50, {
        normalCoinLeverage: customConfig.normalCoinLeverage,
        volatileCoinLeverage: customConfig.volatileCoinLeverage,
      });
      expect(customNormal).toBe(20); // Tier 1 has Math.max(normalLev, 20) = 20

      const customLargeCap = calculateDynamicLeverage('AVAXUSDT', 'Binance', undefined, 24, 25, {
        normalCoinLeverage: customConfig.normalCoinLeverage,
        volatileCoinLeverage: customConfig.volatileCoinLeverage,
      });
      expect(customLargeCap).toBe(15);

      const customVolatile = calculateDynamicLeverage('FLOKIUSDT', 'Binance', undefined, 24, 20, {
        normalCoinLeverage: customConfig.normalCoinLeverage,
        volatileCoinLeverage: customConfig.volatileCoinLeverage,
      });
      expect(customVolatile).toBe(5);
    });

    it('P2-F4b-05: volatile coin leverage is safely clamped within exchange maximum leverage bounds', () => {
      // Exchange maximum is only 7x, but volatile target is 10x
      const clampedLev = calculateDynamicLeverage('THINCOINUSDT', 'Bitget', undefined, 24, 7, {
        normalCoinLeverage: 20,
        volatileCoinLeverage: 10,
      });
      expect(clampedLev).toBe(7); // Must clamp to exchange maximum
    });

    it('P2-F4b-06: verifies zero BPS notation and modern terminology across leverage and credential error strings', () => {
      const err = new MissingCredentialsError('Bybit', 'usr_alpha');
      expect(assertZeroBpsNotation(err.message)).toBe(true);
      expect(assertModernTerminologyOnly(err.message)).toBe(true);

      const evalRes = LeverageManager.evaluateDynamicLeverage('BTCUSDT', 'Binance');
      expect(assertZeroBpsNotation(evalRes.reason)).toBe(true);
      expect(assertModernTerminologyOnly(evalRes.reason)).toBe(true);
    });
  });
});
