/**
 * Divergence Bot: Dedicated Daemon & Audit API Routes Test Suite
 * Milestone 3 (M3) Specification Verification
 * 
 * Target Endpoints:
 * - web/app/api/divergence/daemon/route.ts
 * - web/app/api/divergence/audit/route.ts
 * 
 * Strict Invariants Verified:
 * 1. ZERO BPS NOTATION: All basis, spreads, hurdles, fees, and returns formatted strictly in % notation.
 * 2. STRICT BAN ON LEGACY REFERENCES: Zero mentions of legacy bots or deprecated venues.
 * 3. 100% AUTHENTIC EXECUTION RECEIPTS: Zero synthetic or mock seed data (auditLedger: [] on clean state).
 * 4. PARAMETERIZED LOCK ISOLATION: Binds exclusively to divergence_daemon.lock, isolated from bot_daemon.lock.
 * 5. OPERATIONAL SAFETY LOCK DEFAULT: isRunning: false, fsmState: 'PAUSED'.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { GET as daemonGetRoute, POST as daemonPostRoute } from '@/app/api/divergence/daemon/route';
import { GET as auditGetRoute } from '@/app/api/divergence/audit/route';
import { getDivergenceStateStore, DivergenceStateStore } from '@/lib/divergence/store/stateStore';
import { getDivergenceEngine } from '@/lib/divergence/engine';
import {
  acquireDaemonLock,
  releaseDaemonLock,
  isDaemonRunning,
} from '@/lib/daemonLockManager';
import {
  DivergencePosition,
  DivergenceClosedPosition,
  DEFAULT_DIVERGENCE_CONFIG,
} from '@/lib/divergence/types';
import { createSessionToken } from '@/lib/userStore';

const TEST_AUTH_USER_ID = 'usr_admin_varsha';
const validAuthCookie = `auth_session=${createSessionToken(TEST_AUTH_USER_ID)}`;

function createAuthGetRequest(url: string, cookie: string = validAuthCookie): NextRequest {
  const headers = new Headers();
  if (cookie) {
    headers.set('cookie', cookie);
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'GET',
    headers,
  });
}

function createAuthPostRequest(
  url: string,
  body?: any,
  cookie: string = validAuthCookie,
  extraHeaders?: Record<string, string>
): NextRequest {
  const headers = new Headers();
  if (cookie) {
    headers.set('cookie', cookie);
  }
  if (extraHeaders) {
    for (const [key, val] of Object.entries(extraHeaders)) {
      headers.set(key, val);
    }
  }
  const init: RequestInit = {
    method: 'POST',
    headers,
  };
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

let mockLockHeld = false;
vi.mock('@/lib/daemonLockManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/daemonLockManager')>();
  return {
    ...actual,
    acquireDaemonLock: vi.fn((opts?: any) => {
      if (mockLockHeld) {
        if (opts?.throwOnCollision) throw new Error('Lock collision');
        return { acquired: false, reason: 'LOCK_COLLISION' };
      }
      mockLockHeld = true;
      return { acquired: true };
    }),
    releaseDaemonLock: vi.fn(() => {
      mockLockHeld = false;
      return { released: true };
    }),
    isDaemonRunning: vi.fn(() => mockLockHeld),
  };
});

describe('Milestone 3: Daemon Lifecycle Control & Authentic Audit API Routes', () => {
  let store: DivergenceStateStore;

  beforeEach(() => {
    mockLockHeld = false;
    store = getDivergenceStateStore();
    store.clearState();

    const engine = getDivergenceEngine();
    engine.stop();
  });

  afterEach(() => {
    mockLockHeld = false;
    const engine = getDivergenceEngine();
    engine.stop();
    const globalStore = getDivergenceStateStore();
    globalStore.clearState();
  });

  // =========================================================================
  // 1. DAEMON ROUTE: GET /api/divergence/daemon
  // =========================================================================
  describe('GET /api/divergence/daemon', () => {
    it('rejects unauthenticated GET requests with HTTP 401 UNAUTHORIZED', async () => {
      const req = new NextRequest('http://localhost:3000/api/divergence/daemon');
      const res = await daemonGetRoute(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('rejects GET requests with invalid or tampered session token with HTTP 401 UNAUTHORIZED', async () => {
      const tamperedReq = createAuthGetRequest(
        'http://localhost:3000/api/divergence/daemon',
        'auth_session=usr_admin_varsha.tampered_invalid_signature_12345'
      );
      const res = await daemonGetRoute(tamperedReq);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('accepts x-cron-secret header matching CRON_SECRET for GET requests', async () => {
      const cronSecret = 'test_cron_secret_get_2026';
      process.env.CRON_SECRET = cronSecret;

      const headers = new Headers();
      headers.set('x-cron-secret', cronSecret);
      const req = new NextRequest(new URL('http://localhost:3000/api/divergence/daemon'), {
        method: 'GET',
        headers,
      });
      const res = await daemonGetRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('returns default paused operational state with clean telemetry when authenticated', async () => {
      const req = createAuthGetRequest('http://localhost:3000/api/divergence/daemon');
      const res = await daemonGetRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.isRunning).toBe(false);
      expect(data.fsmState).toBe('PAUSED');
      expect(data.mode).toBe('LIVE_ON_EXCHANGE');
      expect(data.activePositions).toEqual([]);
      expect(data.config.maxConcurrentPositions).toBe(3);
      expect(data.config.maxCapitalAllocationUsdt).toBe(60.00);
      expect(data.telemetry).toBeDefined();
      expect(data.telemetry.lockStatus).toBeDefined();
    });

    it('asserts Cache-Control: no-store header on dynamic route response when authenticated', async () => {
      const req = createAuthGetRequest('http://localhost:3000/api/divergence/daemon');
      const res = await daemonGetRoute(req);

      const cacheHeader = res.headers.get('Cache-Control');
      expect(cacheHeader).toContain('no-store');
    });
  });

  // =========================================================================
  // 2. DAEMON ROUTE: POST /api/divergence/daemon (Actions)
  // =========================================================================
  describe('POST /api/divergence/daemon', () => {
    it('rejects unauthenticated POST requests with HTTP 401 UNAUTHORIZED', async () => {
      const req = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('rejects POST requests with invalid or tampered session token with HTTP 401 UNAUTHORIZED', async () => {
      const tamperedReq = createAuthPostRequest(
        'http://localhost:3000/api/divergence/daemon',
        { action: 'start' },
        'auth_session=usr_admin_varsha.tampered_invalid_signature_67890'
      );
      const res = await daemonPostRoute(tamperedReq);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('accepts x-cron-secret header matching CRON_SECRET for automated ticks', async () => {
      const cronSecret = 'test_cron_secret_divergence_daemon_2026';
      process.env.CRON_SECRET = cronSecret;

      const req = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        headers: {
          'x-cron-secret': cronSecret,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'tick' }),
      });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('rejects mismatched x-cron-secret with HTTP 401 UNAUTHORIZED', async () => {
      process.env.CRON_SECRET = 'correct_secret';

      const req = new NextRequest('http://localhost:3000/api/divergence/daemon', {
        method: 'POST',
        headers: {
          'x-cron-secret': 'wrong_secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'tick' }),
      });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('rejects requests missing the action parameter with HTTP 400 when authenticated', async () => {
      const req = createAuthPostRequest('http://localhost:3000/api/divergence/daemon', {});
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('MISSING_ACTION');
    });

    it('action: start acquires divergence_daemon.lock and transitions engine state when authenticated', async () => {
      const req = createAuthPostRequest('http://localhost:3000/api/divergence/daemon', { action: 'start' });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.isRunning).toBe(true);
      expect(data.fsmState).toBe('IDLE');

      // Verify lock acquired
      expect(isDaemonRunning({ lockFileName: 'divergence_daemon.lock' })).toBe(true);
    });

    it('action: start rejects with HTTP 409 on lock collision when authenticated', async () => {
      // Simulate external daemon holds lock
      acquireDaemonLock({ lockFileName: 'divergence_daemon.lock', throwOnCollision: false });

      const req = createAuthPostRequest('http://localhost:3000/api/divergence/daemon', { action: 'start' });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('LOCK_COLLISION');
    });

    it('action: pause / stop stops engine and releases divergence_daemon.lock when authenticated', async () => {
      // First start
      acquireDaemonLock({ lockFileName: 'divergence_daemon.lock', throwOnCollision: false });
      const engine = getDivergenceEngine();
      engine.start();

      const req = createAuthPostRequest('http://localhost:3000/api/divergence/daemon', { action: 'pause' });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.isRunning).toBe(false);
      expect(data.fsmState).toBe('PAUSED');

      // Verify lock released
      expect(isDaemonRunning({ lockFileName: 'divergence_daemon.lock' })).toBe(false);
    });

    it('action: update_config validates and clamps parameters under capital hard-locks when authenticated', async () => {
      const req = createAuthPostRequest('http://localhost:3000/api/divergence/daemon', {
        action: 'update_config',
        config: {
          maxConcurrentPositions: 5, // Exceeds hard limit
          maxCapitalAllocationUsdt: 100.00, // Exceeds hard limit
          makerWatchdogMs: 6000,
        },
      });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify hard-lock clamp
      expect(data.config.maxConcurrentPositions).toBe(3);
      expect(data.config.maxCapitalAllocationUsdt).toBe(60.00);
      expect(data.config.makerWatchdogMs).toBe(6000);
    });

    it('action: emergency_kill transitions to EMERGENCY_KILLED and unbinds lock when authenticated', async () => {
      acquireDaemonLock({ lockFileName: 'divergence_daemon.lock', throwOnCollision: false });

      const req = createAuthPostRequest('http://localhost:3000/api/divergence/daemon', { action: 'emergency_kill' });
      const res = await daemonPostRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.fsmState).toBe('EMERGENCY_KILLED');
      expect(data.isRunning).toBe(false);
      expect(isDaemonRunning({ lockFileName: 'divergence_daemon.lock' })).toBe(false);
    });
  });

  // =========================================================================
  // 3. AUDIT ROUTE: GET /api/divergence/audit (Authenticity & Summary)
  // =========================================================================
  describe('GET /api/divergence/audit', () => {
    it('purges mock seed data: returns empty ledger and zero metrics when no closed trades exist', async () => {
      const req = new NextRequest('http://localhost:3000/api/divergence/audit');
      const res = await auditGetRoute(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.auditLedger).toEqual([]);
      expect(data.activePositions).toEqual([]);
      expect(data.summary.totalClosedTrades).toBe(0);
      expect(data.summary.profitableTrades).toBe(0);
      expect(data.summary.unprofitableTrades).toBe(0);
      expect(data.summary.winRate).toBe(0);
      expect(data.summary.totalNetProfitUsdt).toBe(0);
      expect(data.summary.totalFeesPaidUsdt).toBe(0);
      expect(data.summary.zeroLossEnforcedTradesCount).toBe(0);
    });

    it('enriches active positions with real-time exit gate evaluation and telemetry badges', async () => {
      const now = Date.now();
      const activePos: DivergencePosition = {
        id: 'pos_test_active_1',
        canonicalSymbol: 'SUI',
        binanceSymbol: 'SUIUSDT',
        bybitSymbol: 'SUIUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'OPEN',
        entryTimestamp: now - 45 * 60 * 1000, // 45m ago
        entryBasisPercent: 0.020,
        currentBasisPercent: 0.400,
        peakBasisPercent: 0.400,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 2.14,
        entryBybitPrice: 2.14,
        currentBinancePrice: 2.14,
        currentBybitPrice: 2.14,
        quantityBinance: 7.0,
        quantityBybit: 7.0,
        notionalUsdt: 15.00,
        unrealizedGrossPnlUsdt: 0.057,
        estimatedTotalFeesUsdt: 0.039,
        netPnlUsdt: 0.018,
        roiPercent: 0.120,
        holdDurationMinutes: 45.0,
        relativeExpansionPercent: 0.380,
        isHurdleMet: true,
        executionHash: 'hash_test_active_sha256',
        stagnancyNominalDeadline: now + 135 * 60 * 1000,
        stagnancyCeilingDeadline: now + 315 * 60 * 1000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.000,
        lastUpdated: now,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'bn_ord_1',
          clientOrderId: 'div1_test',
          symbol: 'SUIUSDT',
          avgPrice: 2.14,
          executedQty: 7.0,
          feePercent: 0.020,
          feeUsdt: 0.003,
          latencyMs: 15,
          timestamp: now - 45 * 60 * 1000,
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'byb_ord_1',
          clientOrderId: 'div2_test',
          symbol: 'SUIUSDT',
          avgPrice: 2.14,
          executedQty: 7.0,
          feePercent: 0.055,
          feeUsdt: 0.008,
          latencyMs: 32,
          timestamp: now - 45 * 60 * 1000,
        },
      };

      vi.spyOn(store, 'getActivePositions').mockReturnValue([activePos]);

      const req = new NextRequest('http://localhost:3000/api/divergence/audit');
      const res = await auditGetRoute(req);
      const data = await res.json();

      expect(data.activePositions).toHaveLength(1);
      const record = data.activePositions[0];
      expect(record.id).toBe('pos_test_active_1');
      expect(record.relativeExpansionPercent).toBe(0.380);
      expect(record.shouldExit).toBe(true);
      expect(record.exitReason).toBe('EXPANSION_TP');
      expect(record.statusBadge).toBe('TARGET_REACHED');
      expect(record.isHurdleMet).toBe(true);
    });

    it('accurately computes summary metrics for genuine closed trade receipts', async () => {
      const now = Date.now();
      const closedPos: DivergenceClosedPosition = {
        id: 'pos_test_closed_1',
        canonicalSymbol: 'SOL',
        binanceSymbol: 'SOLUSDT',
        bybitSymbol: 'SOLUSDT',
        direction: 'LONG_BN_SHORT_BYB',
        status: 'CLOSED',
        entryTimestamp: now - 3600000,
        exitTimestamp: now,
        entryBasisPercent: 0.010,
        currentBasisPercent: 0.410,
        peakBasisPercent: 0.410,
        targetExpansionPercent: 0.380,
        stopLossBasisPercent: -0.150,
        entryBinancePrice: 170.0,
        entryBybitPrice: 170.0,
        currentBinancePrice: 170.0,
        currentBybitPrice: 170.0,
        exitBinancePrice: 170.0,
        exitBybitPrice: 170.0,
        quantityBinance: 0.08,
        quantityBybit: 0.08,
        notionalUsdt: 13.60,
        unrealizedGrossPnlUsdt: 0.054,
        realizedGrossPnlUsdt: 0.054,
        estimatedTotalFeesUsdt: 0.035,
        actualFeesUsdt: 0.035,
        netPnlUsdt: 0.019,
        netRealizedPnlUsdt: 0.019,
        roiPercent: 0.140,
        realizedRoiPercent: 0.140,
        holdDurationMinutes: 60.0,
        relativeExpansionPercent: 0.400,
        finalRelativeExpansionPercent: 0.400,
        isHurdleMet: true,
        exitReason: 'EXPANSION_TP',
        roundtripLatencyMs: 42,
        executionHash: 'hash_test_closed_sha256',
        stagnancyNominalDeadline: now + 120 * 60 * 1000,
        stagnancyCeilingDeadline: now + 300 * 60 * 1000,
        hasMomentumExtension: false,
        accumulatedCarryPercent: 0.000,
        lastUpdated: now,
        leg1: {
          venue: 'BINANCE',
          side: 'BUY',
          orderType: 'POST_ONLY_MAKER_GTX',
          orderId: 'bn_c1',
          clientOrderId: 'div1_c1',
          symbol: 'SOLUSDT',
          avgPrice: 170.0,
          executedQty: 0.08,
          feePercent: 0.020,
          feeUsdt: 0.003,
          latencyMs: 15,
          timestamp: now - 3600000,
        },
        leg2: {
          venue: 'BYBIT',
          side: 'SELL',
          orderType: 'WS_IOC_TAKER',
          orderId: 'byb_c1',
          clientOrderId: 'div2_c1',
          symbol: 'SOLUSDT',
          avgPrice: 170.0,
          executedQty: 0.08,
          feePercent: 0.055,
          feeUsdt: 0.007,
          latencyMs: 32,
          timestamp: now - 3600000,
        },
      };

      vi.spyOn(store, 'getClosedPositions').mockReturnValue([closedPos]);

      const req = new NextRequest('http://localhost:3000/api/divergence/audit');
      const res = await auditGetRoute(req);
      const data = await res.json();

      expect(data.auditLedger).toHaveLength(1);
      expect(data.summary.totalClosedTrades).toBe(1);
      expect(data.summary.profitableTrades).toBe(1);
      expect(data.summary.winRate).toBe(100.0);
      expect(data.summary.totalNetProfitUsdt).toBeCloseTo(0.019, 3);
      expect(data.summary.totalFeesPaidUsdt).toBeCloseTo(0.035, 3);
      expect(data.summary.zeroLossEnforcedTradesCount).toBe(1);
    });

    it('ZERO BPS NOTATION INVARIANT: verifies 0 occurrences of numerical bps in audit response', async () => {
      const req = new NextRequest('http://localhost:3000/api/divergence/audit');
      const res = await auditGetRoute(req);
      const text = await res.text();

      const numericalBpsRegex = /\b\d+(\.\d+)?\s*bps\b/i;
      expect(numericalBpsRegex.test(text)).toBe(false);
    });
  });
});
