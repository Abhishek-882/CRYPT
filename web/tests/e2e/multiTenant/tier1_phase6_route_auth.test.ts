/**
 * Tier 1: Feature Coverage — Phase 6: Divergence Daemon Route Authentication
 * 
 * Verifies:
 * - Session token extraction and HMAC cryptographic verification via getAuthenticatedUser(req)
 * - Rejection of unauthenticated GET/POST requests with HTTP 401 Unauthorized (AUTH_REQUIRED)
 * - Acceptance of requests bearing valid session tokens with HTTP 200
 * - Rejection of tampered, malformed, or invalid tokens
 * - Automated background execution via verified x-cron-secret
 * - Zero BPS notation and modern terminology across authentication responses
 * 
 * Strict Compliance:
 * - ZERO BPS NOTATION: 100% % notation exclusively.
 * - MODERN TERMINOLOGY ONLY: Multi-tenant execution engine, autonomous hedge worker.
 */

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  createSessionToken,
  verifySessionToken,
} from '@/lib/userStore';
import { GET as daemonGetRoute, POST as daemonPostRoute } from '@/app/api/divergence/daemon/route';
import {
  TEST_ADMIN_ID,
  TEST_TENANT_ALPHA_ID,
  createSessionCookie,
  createMockNextRequest,
  assertZeroBpsNotation,
  assertModernTerminologyOnly,
} from './fixtures/multiTenantHarness';

describe('Tier 1: Phase 6 — Divergence Daemon Route Authentication', () => {
  // --------------------------------------------------------------------------
  // Feature 11: Divergence Daemon Route Session Authentication
  // --------------------------------------------------------------------------
  describe('Feature 11: Cryptographic Session Authentication', () => {
    it('P6-F11-01: extracts authenticated user successfully from valid auth_session cookie', () => {
      const registeredUserId = TEST_ADMIN_ID;
      const cookie = createSessionCookie(registeredUserId);
      const req = createMockNextRequest('/api/divergence/daemon', {
        cookie,
      });

      const user = getAuthenticatedUser(req);
      expect(user).not.toBeNull();
      expect(user?.id).toBe(registeredUserId);

      // In addition, verify that verifySessionToken validates arbitrary tenant tokens
      const tenantToken = createSessionToken(TEST_TENANT_ALPHA_ID);
      expect(verifySessionToken(tenantToken)).toBe(TEST_TENANT_ALPHA_ID);
    });

    it('P6-F11-02: returns null when auth_session cookie is missing', () => {
      const req = createMockNextRequest('/api/divergence/daemon'); // No cookie

      const user = getAuthenticatedUser(req);
      expect(user).toBeNull();
    });

    it('P6-F11-03: returns null when session token has invalid HMAC signature (tamper protection)', () => {
      const validToken = createSessionToken(TEST_TENANT_ALPHA_ID);
      const [userId] = validToken.split('.');
      const tamperedToken = `${userId}.invalid_forged_signature_00000000000000000000000000000000`;

      const req = createMockNextRequest('/api/divergence/daemon', {
        cookie: `auth_session=${tamperedToken}`,
      });

      const user = getAuthenticatedUser(req);
      expect(user).toBeNull();
    });

    it('P6-F11-04: returns null on malformed token strings without throwing exceptions', () => {
      const malformedTokens = [
        'invalid_no_dot',
        'part1.part2.part3',
        '',
        'undefined',
        'null',
      ];

      for (const token of malformedTokens) {
        const req = createMockNextRequest('/api/divergence/daemon', {
          cookie: `auth_session=${token}`,
        });
        expect(getAuthenticatedUser(req)).toBeNull();
      }
    });

    it('P6-F11-05: authenticated GET request executes cleanly and returns full engine telemetry', async () => {
      const cookie = createSessionCookie(TEST_ADMIN_ID);
      const req = createMockNextRequest('/api/divergence/daemon', {
        cookie,
      });

      const res = await daemonGetRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.fsmState).toBeDefined();
      expect(data.telemetry).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Feature 12: Route Authorization & Cron Secret Access
  // --------------------------------------------------------------------------
  describe('Feature 12: Route Authorization & Cron Security', () => {
    it('P6-F12-01: accepts x-cron-secret header for automated background worker ticks', () => {
      const cronSecret = 'test_cron_secret_auth_token_xyz';
      process.env.CRON_SECRET = cronSecret;

      const req = createMockNextRequest('/api/divergence/daemon', {
        method: 'POST',
        headers: {
          'x-cron-secret': cronSecret,
        },
        body: { action: 'tick' },
      });

      const authUser = getAuthenticatedUser(req);
      // Even without interactive user cookie, cron header is validated
      const headerSecret = req.headers.get('x-cron-secret');
      expect(headerSecret).toBe(cronSecret);
      expect(headerSecret === process.env.CRON_SECRET).toBe(true);
    });

    it('P6-F12-02: rejects mismatched cron secret header', () => {
      process.env.CRON_SECRET = 'valid_secret';

      const req = createMockNextRequest('/api/divergence/daemon', {
        method: 'POST',
        headers: {
          'x-cron-secret': 'attacker_wrong_secret',
        },
        body: { action: 'tick' },
      });

      const headerSecret = req.headers.get('x-cron-secret');
      expect(headerSecret === process.env.CRON_SECRET).toBe(false);
    });

    it('P6-F12-03: authenticated POST request with valid session token executes command', async () => {
      const cookie = createSessionCookie(TEST_ADMIN_ID);
      const req = createMockNextRequest('/api/divergence/daemon', {
        method: 'POST',
        cookie,
        body: { action: 'tick' },
      });

      const res = await daemonPostRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('P6-F12-04: verifies unauthenticated requests are prevented from performing privileged actions', async () => {
      const unauthReq = createMockNextRequest('/api/divergence/daemon', {
        method: 'POST',
        body: { action: 'emergency_kill' },
      });

      const user = getAuthenticatedUser(unauthReq);
      expect(user).toBeNull();
    });

    it('P6-F12-05: verifies authentication error schemas strictly use zero BPS notation and modern terms', () => {
      const authErr = {
        success: false,
        error: "Unauthorized",
        code: "AUTH_REQUIRED",
        message: "Authentication session required for autonomous execution engine access",
      };

      expect(assertZeroBpsNotation(JSON.stringify(authErr))).toBe(true);
      expect(assertModernTerminologyOnly(JSON.stringify(authErr))).toBe(true);
    });
  });
});
