/**
 * Multi-Tenant Architecture & Layer 7 Dynamic Exit Engine E2E Test Harness
 * 
 * Provides synthetic tenant account fixtures, cryptographically signed session tokens,
 * isolated test environments, and mathematical oracle references.
 * 
 * Strict Invariants:
 * 1. ZERO BPS NOTATION: 100% of basis, fees, hurdles, and yields use % notation exclusively.
 * 2. MODERN TERMINOLOGY ONLY: Modern architectural terms (tenant runner, execution engine, autonomous hedge worker).
 * 3. OPAQUE-BOX VERIFICATION: Tests exercise public interface contracts and observable side effects.
 */

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'safecoiner_e2e_session_secret_1234567890';
}
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { UserAccount, UserApiKeys, createSessionToken } from '@/lib/userStore';

export const TEST_ADMIN_ID = 'usr_admin_varsha';
export const TEST_TENANT_ALPHA_ID = 'usr_tenant_alpha_001';
export const TEST_TENANT_BETA_ID = 'usr_tenant_beta_002';
export const TEST_TENANT_GAMMA_ID = 'usr_tenant_gamma_003';

export const HARD_SAFETY_FLOOR_USDT = 0.0100;
export const BASE_NOTIONAL_UNIT_USDT = 60.00; // $6 margin at 10x leverage

/**
 * Creates a mock UserAccount record conforming to UserAccount schema.
 */
export function createMockTenantUser(
  id: string,
  email: string,
  role: 'admin' | 'user' = 'user',
  apiKeys: Partial<UserApiKeys> = {}
): UserAccount {
  return {
    id,
    email,
    username: email.split('@')[0],
    password: 'mock_password_hash_sha256',
    role,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    apiKeys: {
      binanceKey: apiKeys.binanceKey || '',
      binanceSecret: apiKeys.binanceSecret || '',
      bitgetKey: apiKeys.bitgetKey || '',
      bitgetSecret: apiKeys.bitgetSecret || '',
      bybitKey: apiKeys.bybitKey || '',
      bybitSecret: apiKeys.bybitSecret || '',
      coindcxKey: apiKeys.coindcxKey || '',
      coindcxSecret: apiKeys.coindcxSecret || '',
      isPaper: false,
      ...apiKeys,
    },
  };
}

/**
 * Creates valid admin user fixture.
 */
export function createMockAdminUser(): UserAccount {
  return createMockTenantUser(
    TEST_ADMIN_ID,
    'admin@safecoiner.io',
    'admin',
    {
      binanceKey: 'admin_live_binance_key',
      binanceSecret: 'admin_live_binance_secret',
      bybitKey: 'admin_live_bybit_key',
      bybitSecret: 'admin_live_bybit_secret',
      bitgetKey: 'admin_live_bitget_key',
      bitgetSecret: 'admin_live_bitget_secret',
    }
  );
}

/**
 * Creates valid non-admin tenant user fixture with dedicated credentials.
 */
export function createMockTenantAlpha(): UserAccount {
  return createMockTenantUser(
    TEST_TENANT_ALPHA_ID,
    'alpha@tenant.org',
    'user',
    {
      binanceKey: 'tenant_alpha_binance_key',
      binanceSecret: 'tenant_alpha_binance_secret',
      bybitKey: 'tenant_alpha_bybit_key',
      bybitSecret: 'tenant_alpha_bybit_secret',
    }
  );
}

/**
 * Creates valid non-admin tenant user fixture with separate credentials.
 */
export function createMockTenantBeta(): UserAccount {
  return createMockTenantUser(
    TEST_TENANT_BETA_ID,
    'beta@tenant.org',
    'user',
    {
      binanceKey: 'tenant_beta_binance_key',
      binanceSecret: 'tenant_beta_binance_secret',
      bybitKey: 'tenant_beta_bybit_key',
      bybitSecret: 'tenant_beta_bybit_secret',
    }
  );
}

/**
 * Creates non-admin tenant user fixture with missing/empty credentials.
 */
export function createMockTenantEmptyKeys(): UserAccount {
  return createMockTenantUser(
    TEST_TENANT_GAMMA_ID,
    'gamma_empty@tenant.org',
    'user',
    {
      binanceKey: '',
      binanceSecret: '',
      bybitKey: '',
      bybitSecret: '',
    }
  );
}

/**
 * Formats signed session cookie string for HTTP requests.
 */
export function createSessionCookie(userId: string): string {
  const token = createSessionToken(userId);
  return `auth_session=${token}`;
}

/**
 * Creates a synthetic NextRequest with optional cookie headers.
 */
export function createMockNextRequest(
  url: string,
  options: {
    method?: string;
    body?: any;
    cookie?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const headers = new Headers();
  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }
  if (options.headers) {
    for (const [key, val] of Object.entries(options.headers)) {
      headers.set(key, val);
    }
  }

  const init: RequestInit = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body && options.method && options.method !== 'GET' && options.method !== 'HEAD') {
    headers.set('content-type', 'application/json');
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

/**
 * Mathematical Oracle: Layer 7 Dynamic Exit Floor calculation.
 * 
 * Linear scaling schedule:
 * - $60 notional ($6 margin @ 10x leverage) -> $0.0100 floor
 * - $300 notional ($30 margin @ 10x leverage) -> $0.0500 floor
 * - $600 notional ($60 margin @ 10x leverage) -> $0.1000 floor
 */
export function oracleDynamicExitFloor(
  orderNotionalUsdt: number,
  configuredFloorUsdt?: number
): number {
  if (configuredFloorUsdt !== undefined && configuredFloorUsdt >= HARD_SAFETY_FLOOR_USDT) {
    return configuredFloorUsdt;
  }
  const scaleFactor = Math.max(1.0, orderNotionalUsdt / BASE_NOTIONAL_UNIT_USDT);
  const autoAdaptedFloor = parseFloat((scaleFactor * HARD_SAFETY_FLOOR_USDT).toFixed(4));
  return Math.max(HARD_SAFETY_FLOOR_USDT, autoAdaptedFloor);
}

/**
 * Validates that an arbitrary string contains zero BPS notation instances.
 */
export function assertZeroBpsNotation(content: string): boolean {
  const bpsRegex = /\b\d+(\.\d+)?\s*bps\b/i;
  return !bpsRegex.test(content);
}

/**
 * Validates that an arbitrary string contains no banned legacy terms.
 */
export function assertModernTerminologyOnly(content: string): boolean {
  const banned = [/legacy_bot/i, /basis_bot/i, /deprecated_bot/i];
  return !banned.some((r) => r.test(content));
}
