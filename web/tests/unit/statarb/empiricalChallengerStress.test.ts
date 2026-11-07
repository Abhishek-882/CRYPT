/**
 * STATARB-OU-PERP: Empirical Challenger Stress Test Suite
 * Archetype: teamwork_challenger
 * Roles: critic, specialist
 * 
 * Empirically challenges and stress-tests:
 * 1. Leg 1 Maker Limit micro-repricing upon Binance -2010 and Bybit 110007:
 *    - 1-tick price adjustments away from book on each retry (BUY -tick, SELL +tick)
 *    - Strict 2-retry cap (exactly 3 attempts total) before cleanly returning REJECTED
 *    - Non-book-cross error fail-fast (0 retries)
 * 2. Leg 2 WebSocket IOC Taker & 500ms Watchdog Circuit Breaker:
 *    - Injected hanging/delayed WebSocket promise (>500ms) aborting cleanly
 *    - Instant fallback to signed REST API without hanging or leaking timers
 *    - Unhealthy WebSocket stream instant fallback
 * 3. Emergency Market Unwind:
 *    - Complete Leg 2 failure triggers Leg 1 emergency market unwind
 *    - Verification of reduceOnly: true (Binance: 'true', Bybit: true)
 *    - Opposite side execution, exact quantity matching, zero-orphan preservation
 * 4. Gate 5 Net Edge Precision & Sparse Config Fallback:
 *    - Strict boundary test: 7.99% edge fails Gate 5, 8.00% edge passes Gate 5
 *    - Sparse config omitting minNetEdgeBps defaults strictly to 0.080%
 *    - Negative basis directional symmetry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LiveExchangeAdapter,
} from '@/lib/statarb/execution/liveExchangeAdapter';
import {
  MakerTakerOrderRouter,
  OrderSide,
} from '@/lib/statarb/execution/orderRouter';
import {
  signAndFetchBinance,
  validateOrGenerateBinanceClientOrderId,
} from '@/lib/binanceSigner';
import {
  sendBybitRequest,
  validateOrGenerateBybitOrderLinkId,
} from '@/lib/bybitSigner';
import { binanceTradeStream } from '@/lib/binanceTradeStream';
import { bybitTradeStream } from '@/lib/bybitTradeStream';
import { evaluateEntryGates, DEFAULT_ENTRY_GATE_CONFIG } from '@/lib/statarb/math/zScoreEngine';
import { StatArbPair, OUParameters } from '@/lib/statarb/types';

// Mock Signers and TradeStreams
vi.mock('@/lib/binanceSigner', () => ({
  signAndFetchBinance: vi.fn(),
  validateOrGenerateBinanceClientOrderId: vi.fn((id?: string) => id || 'mock-bn-client-id'),
}));

vi.mock('@/lib/bybitSigner', () => ({
  sendBybitRequest: vi.fn(),
  validateOrGenerateBybitOrderLinkId: vi.fn((id?: string) => id || 'mock-bybit-order-link-id'),
}));

vi.mock('@/lib/binanceTradeStream', () => ({
  binanceTradeStream: {
    isHealthy: vi.fn(),
    placeOrder: vi.fn(),
  },
}));

vi.mock('@/lib/bybitTradeStream', () => ({
  bybitTradeStream: {
    isHealthy: vi.fn(),
    placeOrder: vi.fn(),
  },
}));

vi.mock('@/lib/cryptoVault', () => ({
  getCockpitVaultKey: vi.fn(),
  decryptVaultSecret: vi.fn((cipherText: string) => cipherText.replace('enc:v1:mock_', '')),
}));

vi.mock('@/lib/userStore', () => ({
  findUserById: vi.fn(),
  getDecryptedUserApiKeys: vi.fn(),
}));

describe('STATARB Empirical Challenger Stress Verification Suite', () => {
  let adapter: LiveExchangeAdapter;

  const mockCredentials = {
    binanceKey: 'challenger-bn-key',
    binanceSecret: 'challenger-bn-secret',
    binanceEndpoint: 'https://fapi.binance.com',
    bybitKey: 'challenger-bybit-key',
    bybitSecret: 'challenger-bybit-secret',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LiveExchangeAdapter(mockCredentials);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // TASK 1: EMPIRICAL VERIFICATION OF MAKER LIMIT MICRO-REPRICING
  // =========================================================================
  describe('Task 1: Maker Limit Micro-Repricing (-2010 and 110007)', () => {
    it('verifies Binance BUY order micro-repricing steps 1 tickSize away from book on -2010 up to 2 retries', async () => {
      // BTCUSDT: tickSize = 0.1, priceDecimals = 1
      // Attempt 0: 60000.0 -> fails with -2010
      vi.mocked(signAndFetchBinance).mockRejectedValueOnce(
        new Error('[-2010] Order would immediately match and take as a taker.')
      );
      // Attempt 1: 59999.9 -> fails with -2010
      vi.mocked(signAndFetchBinance).mockRejectedValueOnce(
        new Error('[-2010] Order would immediately match and take as a taker.')
      );
      // Attempt 2 (Retry 2): 59999.8 -> succeeds
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 9911001,
          symbol: 'BTCUSDT',
          status: 'NEW',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.placeMakerLimit(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        60000.0,
        0.005,
        'cid_stress_reprice_buy',
        'GTX'
      );

      expect(res.status).toBe('NEW');
      expect(res.orderId).toBe('9911001');
      expect(signAndFetchBinance).toHaveBeenCalledTimes(3);

      // Verify Attempt 0
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        1,
        mockCredentials.binanceKey,
        mockCredentials.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '60000.0',
          newClientOrderId: 'cid_stress_reprice_buy',
        }),
        true,
        mockCredentials.binanceEndpoint
      );

      // Verify Attempt 1 (price decremented by 0.1 tick to 59999.9, _r1 appended)
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        2,
        mockCredentials.binanceKey,
        mockCredentials.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '59999.9',
          newClientOrderId: 'cid_stress_reprice_buy_r1',
        }),
        true,
        mockCredentials.binanceEndpoint
      );

      // Verify Attempt 2 (price decremented by another 0.1 tick to 59999.8, _r2 appended)
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        3,
        mockCredentials.binanceKey,
        mockCredentials.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '59999.8',
          newClientOrderId: 'cid_stress_reprice_buy_r2',
        }),
        true,
        mockCredentials.binanceEndpoint
      );
    });

    it('verifies Binance SELL order micro-repricing steps 1 tickSize upwards away from book on -2010', async () => {
      // BTCUSDT: tickSize = 0.1, priceDecimals = 1
      // Attempt 0: 60000.0 -> fails with -2010
      vi.mocked(signAndFetchBinance).mockRejectedValueOnce(
        new Error('[-2010] Order would immediately match and take as a taker.')
      );
      // Attempt 1: 60000.1 -> succeeds
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 9911002,
          symbol: 'BTCUSDT',
          status: 'NEW',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.placeMakerLimit(
        'BINANCE',
        'BTCUSDT',
        'SELL',
        60000.0,
        0.005,
        'cid_stress_reprice_sell',
        'GTX'
      );

      expect(res.status).toBe('NEW');
      expect(res.orderId).toBe('9911002');
      expect(signAndFetchBinance).toHaveBeenCalledTimes(2);

      // Attempt 0: 60000.0
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        1,
        mockCredentials.binanceKey,
        mockCredentials.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '60000.0',
          side: 'SELL',
        }),
        true,
        mockCredentials.binanceEndpoint
      );

      // Attempt 1: 60000.1 (incremented by 0.1 tick away from book)
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        2,
        mockCredentials.binanceKey,
        mockCredentials.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '60000.1',
          side: 'SELL',
          newClientOrderId: 'cid_stress_reprice_sell_r1',
        }),
        true,
        mockCredentials.binanceEndpoint
      );
    });

    it('asserts that Binance cleanly returns REJECTED status after capping at exactly 2 retries (3 calls)', async () => {
      // 3 consecutive book-cross rejections
      vi.mocked(signAndFetchBinance)
        .mockRejectedValueOnce(new Error('[-2010] Order would immediately match and take'))
        .mockRejectedValueOnce(new Error('[-2010] Order would immediately match and take'))
        .mockRejectedValueOnce(new Error('[-2010] Order would immediately match and take'));

      const res = await adapter.placeMakerLimit(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        60000.0,
        0.005,
        'cid_exhaust_test',
        'GTX'
      );

      expect(res.status).toBe('REJECTED');
      expect(res.orderId).toBe('');
      expect(res.rejectReason).toContain('[-2010]');
      // Exactly 3 attempts: attempt 0, attempt 1 (retry 1), attempt 2 (retry 2). Never a 4th.
      expect(signAndFetchBinance).toHaveBeenCalledTimes(3);
    });

    it('verifies Bybit micro-repricing on retCode 110007 steps 1 tickSize away from book on each retry', async () => {
      // ETHUSDT: tickSize = 0.01, priceDecimals = 2
      // Attempt 0: 3000.00 -> retCode 110007
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 110007,
        retMsg: 'order would immediately trigger or cross (110007)',
      });
      // Attempt 1: 2999.99 -> retCode 110007
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 110007,
        retMsg: 'order would immediately trigger or cross (110007)',
      });
      // Attempt 2: 2999.98 -> retCode 0 (Success)
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'bybit_order_retry2',
        },
      });

      const res = await adapter.placeMakerLimit(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        3000.0,
        0.2,
        'link_bybit_stress',
        'PostOnly'
      );

      expect(res.status).toBe('NEW');
      expect(res.orderId).toBe('bybit_order_retry2');
      expect(sendBybitRequest).toHaveBeenCalledTimes(3);

      // Verify Attempt 0: 3000.00
      expect(sendBybitRequest).toHaveBeenNthCalledWith(
        1,
        '/v5/order/create',
        'POST',
        expect.any(Object),
        expect.objectContaining({
          price: '3000.00',
          orderLinkId: 'link_bybit_stress',
        })
      );

      // Verify Attempt 1: 2999.99 (price - 0.01)
      expect(sendBybitRequest).toHaveBeenNthCalledWith(
        2,
        '/v5/order/create',
        'POST',
        expect.any(Object),
        expect.objectContaining({
          price: '2999.99',
          orderLinkId: 'link_bybit_stress_r1',
        })
      );

      // Verify Attempt 2: 2999.98 (price - 0.01)
      expect(sendBybitRequest).toHaveBeenNthCalledWith(
        3,
        '/v5/order/create',
        'POST',
        expect.any(Object),
        expect.objectContaining({
          price: '2999.98',
          orderLinkId: 'link_bybit_stress_r2',
        })
      );
    });

    it('asserts that Bybit cleanly returns REJECTED status after capping at exactly 2 retries (3 calls)', async () => {
      vi.mocked(sendBybitRequest).mockResolvedValue({
        retCode: 110007,
        retMsg: 'order would immediately cross book (110007)',
      });

      const res = await adapter.placeMakerLimit(
        'BYBIT',
        'ETHUSDT',
        'SELL',
        3000.0,
        0.2,
        'link_bybit_exhaust',
        'PostOnly'
      );

      expect(res.status).toBe('REJECTED');
      expect(res.orderId).toBe('');
      expect(res.rejectReason).toContain('110007');
      expect(sendBybitRequest).toHaveBeenCalledTimes(3);
    });

    it('fails immediately without retrying when non-book-cross error occurs', async () => {
      // Bybit retCode 10001 (Parameter error)
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 10001,
        retMsg: 'params error: qty exceeds limit',
      });

      const res = await adapter.placeMakerLimit(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        3000.0,
        99999.0,
        'link_param_err',
        'PostOnly'
      );

      expect(res.status).toBe('REJECTED');
      expect(res.rejectReason).toBe('params error: qty exceeds limit');
      expect(sendBybitRequest).toHaveBeenCalledTimes(1); // 0 retries
    });
  });

  // =========================================================================
  // TASK 2: EMPIRICALLY STRESS-TEST LEG 2 WEBSOCKET IOC TAKER & 500MS WATCHDOG
  // =========================================================================
  describe('Task 2: WebSocket IOC Taker & 500ms Watchdog Circuit Breaker', () => {
    it('aborts hanging Binance WebSocket promise (>500ms) within watchdog window and falls back cleanly to signed REST', async () => {
      vi.mocked(binanceTradeStream.isHealthy).mockReturnValue(true);
      
      // Inject hanging WebSocket promise (1200ms delay)
      vi.mocked(binanceTradeStream.placeOrder).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1200))
      );

      // Mock REST fallback response
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 88223344,
          executedQty: '0.05',
          avgPrice: '60000.00',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const startTime = Date.now();
      const res = await adapter.placeTakerIoc(
        'BINANCE',
        'BTCUSDT',
        'SELL',
        0.05,
        'ioc_watchdog_stress',
        true, // useWebSocket
        60000.0
      );
      const elapsedMs = Date.now() - startTime;

      // Assert watchdog aborted around 500ms (well before 1200ms)
      expect(elapsedMs).toBeGreaterThanOrEqual(480);
      expect(elapsedMs).toBeLessThan(1000);

      // Assert clean fallback to signed REST
      expect(res.orderId).toBe('88223344');
      expect(res.executedQty).toBe(0.05);
      expect(res.avgPrice).toBe(60000.0);
      expect(signAndFetchBinance).toHaveBeenCalledTimes(1);
      expect(signAndFetchBinance).toHaveBeenCalledWith(
        mockCredentials.binanceKey,
        mockCredentials.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          type: 'LIMIT',
          timeInForce: 'IOC',
          quantity: '0.05',
          price: '60000',
        }),
        true,
        mockCredentials.binanceEndpoint
      );
    });

    it('aborts hanging Bybit WebSocket promise (>500ms) within watchdog window and falls back cleanly to signed REST', async () => {
      vi.mocked(bybitTradeStream.isHealthy).mockReturnValue(true);

      // Inject hanging WebSocket promise (1500ms delay)
      vi.mocked(bybitTradeStream.placeOrder).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1500))
      );

      // Mock REST fallback
      vi.mocked(sendBybitRequest)
        .mockResolvedValueOnce({
          retCode: 0,
          result: { orderId: 'bb_rest_ioc_recovered' },
        })
        .mockResolvedValueOnce({
          result: {
            list: [
              {
                orderId: 'bb_rest_ioc_recovered',
                orderStatus: 'Filled',
                cumExecQty: '0.2',
                avgPrice: '3000.00',
              },
            ],
          },
        });

      const startTime = Date.now();
      const res = await adapter.placeTakerIoc(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        0.2,
        'ioc_bb_watchdog_stress',
        true,
        3000.0
      );
      const elapsedMs = Date.now() - startTime;

      expect(elapsedMs).toBeGreaterThanOrEqual(480);
      expect(elapsedMs).toBeLessThan(1000);

      expect(res.orderId).toBe('bb_rest_ioc_recovered');
      expect(res.executedQty).toBe(0.2);
      expect(res.avgPrice).toBe(3000.0);
      expect(sendBybitRequest).toHaveBeenCalledWith(
        '/v5/order/create',
        'POST',
        expect.any(Object),
        expect.objectContaining({
          category: 'linear',
          symbol: 'ETHUSDT',
          side: 'Buy',
          timeInForce: 'IOC',
        })
      );
    });

    it('falls back immediately to REST when WebSocket trade stream is unhealthy (0ms delay)', async () => {
      vi.mocked(binanceTradeStream.isHealthy).mockReturnValue(false); // Disconnected stream

      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 771122,
          executedQty: '0.01',
          avgPrice: '60000.00',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const startTime = Date.now();
      const res = await adapter.placeTakerIoc(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        0.01,
        'ioc_unhealthy_test',
        true,
        60000.0
      );
      const elapsedMs = Date.now() - startTime;

      // Does not wait 500ms; executes immediately
      expect(elapsedMs).toBeLessThan(100);
      expect(binanceTradeStream.placeOrder).not.toHaveBeenCalled();
      expect(signAndFetchBinance).toHaveBeenCalledTimes(1);
      expect(res.orderId).toBe('771122');
    });
  });

  // =========================================================================
  // TASK 3: EMPIRICALLY TEST EMERGENCY MARKET UNWIND
  // =========================================================================
  describe('Task 3: Emergency Market Unwind with reduceOnly: true', () => {
    it('verifies emergencyMarketUnwind issues signed REST order with reduceOnly: true on Binance', async () => {
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 998877,
          executedQty: '0.05',
          avgPrice: '59980.00',
          status: 'FILLED',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.emergencyMarketUnwind(
        'BINANCE',
        'BTCUSDT',
        'SELL',
        0.05
      );

      expect(res.success).toBe(true);
      expect(res.executedQty).toBe(0.05);
      expect(res.avgPrice).toBe(59980.0);

      expect(signAndFetchBinance).toHaveBeenCalledWith(
        mockCredentials.binanceKey,
        mockCredentials.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          type: 'MARKET',
          quantity: '0.05',
          reduceOnly: 'true', // Binance expects string 'true'
        }),
        true,
        mockCredentials.binanceEndpoint
      );
    });

    it('verifies emergencyMarketUnwind issues signed REST order with reduceOnly: true on Bybit', async () => {
      vi.mocked(sendBybitRequest)
        .mockResolvedValueOnce({
          retCode: 0,
          result: { orderId: 'unwind_bybit_123' },
        })
        .mockResolvedValueOnce({
          result: {
            list: [
              {
                orderId: 'unwind_bybit_123',
                orderStatus: 'Filled',
                cumExecQty: '0.15',
                avgPrice: '3002.50',
              },
            ],
          },
        });

      const res = await adapter.emergencyMarketUnwind(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        0.15
      );

      expect(res.success).toBe(true);
      expect(res.executedQty).toBe(0.15);
      expect(res.avgPrice).toBe(3002.5);

      expect(sendBybitRequest).toHaveBeenCalledWith(
        '/v5/order/create',
        'POST',
        expect.any(Object),
        expect.objectContaining({
          category: 'linear',
          symbol: 'ETHUSDT',
          side: 'Buy',
          orderType: 'Market',
          qty: '0.15',
          reduceOnly: true, // Bybit expects boolean true
        })
      );
    });

    it('verifies MakerTakerOrderRouter triggers emergencyMarketUnwind on Leg 1 venue when Leg 2 fails completely', async () => {
      // Create OrderRouter with custom mock adapter
      const mockAdapter = {
        placeMakerLimit: vi.fn().mockResolvedValue({ orderId: 'leg1_maker_fill', status: 'NEW' }),
        cancelOrder: vi.fn().mockResolvedValue({ success: true, executedQty: 0.1 }),
        pollOrderStatus: vi.fn().mockResolvedValue({ status: 'FILLED', executedQty: 0.1, avgPrice: 60000.0 }),
        placeTakerIoc: vi.fn().mockRejectedValue(new Error('Catastrophic failure on both WS and REST')),
        emergencyMarketUnwind: vi.fn().mockResolvedValue({ success: true, executedQty: 0.1, avgPrice: 59990.0 }),
      };

      const router = new MakerTakerOrderRouter(mockAdapter as any);

      const mockPair: StatArbPair = {
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        multiplier: 1,
        binanceMid: 60000.0,
        bybitMid: 60000.0,
        grossBasisBps: 30.0,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 2.0,
        bybitSpreadBps: 2.0,
        lastUpdated: Date.now(),
      };

      const result = await router.executeEntry({
        pair: mockPair,
        direction: 'SHORT_BINANCE_LONG_BYBIT',
        notionalUsdt: 6000.0,
        quantity: 0.1,
        leg1Venue: 'BINANCE',
        leg2Venue: 'BYBIT',
        leg1Symbol: 'BTCUSDT',
        leg2Symbol: 'BTCUSDT',
        leg1Side: 'SELL',
        leg2Side: 'BUY',
        leg1BestBid: 59999.0,
        leg1BestAsk: 60001.0,
        leg2InitialPrice: 60000.0,
        timeoutMs: 1000,
        isDryRun: false,
      });

      // Assert router returned EMERGENCY_UNWOUND status
      expect(result.status).toBe('EMERGENCY_UNWOUND');
      expect(result.success).toBe(false);
      expect(result.isDeltaNeutral).toBe(true);
      expect(result.netDelta).toBe(0);

      // Assert emergencyMarketUnwind was invoked on Leg 1 (BINANCE) with opposite side (BUY)
      expect(mockAdapter.emergencyMarketUnwind).toHaveBeenCalledTimes(1);
      expect(mockAdapter.emergencyMarketUnwind).toHaveBeenCalledWith(
        'BINANCE',
        'BTCUSDT',
        'BUY', // Leg 1 was SELL, so unwind is BUY
        0.1
      );
    });
  });

  // =========================================================================
  // TASK 4: EMPIRICALLY TEST GATE 5 NET EDGE PRECISION (7.99 vs 8.00) & DEFAULTS
  // =========================================================================
  describe('Task 4: Gate 5 Net Edge Precision (0.0799% vs 0.0800%) & Sparse Config Default', () => {
    const baseOUParams: OUParameters = {
      theta: 0.05,
      mu: 0.0,
      sigma: 1.2,
      halfLifeMinutes: 13.86,
      equilibriumSigma: 8.0,
      rSquared: 0.92,
      sampleCount: 100,
      lastUpdated: Date.now(),
    };

    function makeTestPair(grossBasisBps: number): StatArbPair {
      return {
        canonicalSymbol: 'BTC',
        binanceSymbol: 'BTCUSDT',
        bybitSymbol: 'BTCUSDT',
        multiplier: 1,
        binanceMid: 60000.0,
        bybitMid: 60000.0,
        grossBasisBps,
        orderBookDepthRatio: 5.0,
        binanceSpreadBps: 2.0,
        bybitSpreadBps: 2.0,
        lastUpdated: Date.now(),
      };
    }

    it('asserts that exactly 7.99% net edge (0.0799%) FAILS Gate 5', () => {
      // Gross 24.99% - Friction 17.00% = 7.99% net edge
      // z-score = 24.99 / 8.0 = 3.12 (exceeds 2.2 hurdle)
      const pair799 = makeTestPair(24.99);
      const config = {
        ...DEFAULT_ENTRY_GATE_CONFIG,
        minGrossBasisBps: 20.0, // lower gate 2 so Gate 5 is isolated
        minNetEdgeBps: 8.0,
        roundtripFrictionBps: 17.0,
      };

      const result = evaluateEntryGates(pair799, baseOUParams, config);

      expect(result.netExpectedEdgeBps).toBe(7.99);
      expect(result.passed).toBe(false);
      expect(result.reasons.some((r) => r.includes('Gate 5') && r.includes('[FAIL]'))).toBe(true);
    });

    it('asserts that exactly 8.00% net edge (0.0800%) PASSES Gate 5', () => {
      // Gross 25.00% - Friction 17.00% = 8.00% net edge
      const pair800 = makeTestPair(25.00);
      const config = {
        ...DEFAULT_ENTRY_GATE_CONFIG,
        minGrossBasisBps: 20.0,
        minNetEdgeBps: 8.0,
        roundtripFrictionBps: 17.0,
      };

      const result = evaluateEntryGates(pair800, baseOUParams, config);

      expect(result.netExpectedEdgeBps).toBe(8.00);
      expect(result.passed).toBe(true);
      expect(result.reasons.some((r) => r.includes('Gate 5') && r.includes('[PASS]'))).toBe(true);
    });

    it('asserts that 8.01% net edge (0.0801%) PASSES Gate 5', () => {
      // Gross 25.01% - Friction 17.00% = 8.01% net edge
      const pair801 = makeTestPair(25.01);
      const config = {
        ...DEFAULT_ENTRY_GATE_CONFIG,
        minGrossBasisBps: 20.0,
        minNetEdgeBps: 8.0,
        roundtripFrictionBps: 17.0,
      };

      const result = evaluateEntryGates(pair801, baseOUParams, config);

      expect(result.netExpectedEdgeBps).toBe(8.01);
      expect(result.passed).toBe(true);
      expect(result.reasons.some((r) => r.includes('Gate 5') && r.includes('[PASS]'))).toBe(true);
    });

    it('asserts that sparse configs missing minNetEdgeBps default strictly to 8.0 (0.080%)', () => {
      // Config with minNetEdgeBps omitted / undefined
      const sparseConfig = {
        minZScore: 2.2,
        minGrossBasisBps: 20.0,
        minDepthRatio: 4.0,
        maxSpreadBps: 8.0,
        roundtripFrictionBps: 17.0,
        // minNetEdgeBps is intentionally undefined
      };

      // Case A: 24.99 gross - 17.0 friction = 7.99 net edge -> MUST FAIL
      const pairFail = makeTestPair(24.99);
      const resFail = evaluateEntryGates(pairFail, baseOUParams, sparseConfig as any);
      expect(resFail.passed).toBe(false);
      expect(resFail.netExpectedEdgeBps).toBe(7.99);
      expect(resFail.reasons.some((r) => r.includes('Gate 5') && r.includes('[FAIL]'))).toBe(true);

      // Case B: 25.00 gross - 17.0 friction = 8.00 net edge -> MUST PASS
      const pairPass = makeTestPair(25.00);
      const resPass = evaluateEntryGates(pairPass, baseOUParams, sparseConfig as any);
      expect(resPass.passed).toBe(true);
      expect(resPass.netExpectedEdgeBps).toBe(8.00);
      expect(resPass.reasons.some((r) => r.includes('Gate 5') && r.includes('[PASS]'))).toBe(true);
    });

    it('asserts directional symmetry on negative gross basis (Bybit rich, Binance cheap)', () => {
      const config = {
        ...DEFAULT_ENTRY_GATE_CONFIG,
        minGrossBasisBps: 20.0,
        minNetEdgeBps: 8.0,
        roundtripFrictionBps: 17.0,
      };

      // -24.99 gross basis: abs(gross) = 24.99 - 17.0 = 7.99 net edge -> MUST FAIL
      const pairNegFail = makeTestPair(-24.99);
      const resFail = evaluateEntryGates(pairNegFail, baseOUParams, config);
      expect(resFail.passed).toBe(false);
      expect(resFail.netExpectedEdgeBps).toBe(7.99);

      // -25.00 gross basis: abs(gross) = 25.00 - 17.0 = 8.00 net edge -> MUST PASS
      const pairNegPass = makeTestPair(-25.00);
      const resPass = evaluateEntryGates(pairNegPass, baseOUParams, config);
      expect(resPass.passed).toBe(true);
      expect(resPass.netExpectedEdgeBps).toBe(8.00);
      expect(resPass.direction).toBe('SHORT_BYBIT_LONG_BINANCE');
    });
  });
});
