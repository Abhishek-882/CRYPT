/**
 * STATARB-OU-PERP: LiveExchangeAdapter Comprehensive Unit Verification Suite
 * Target: web/lib/statarb/execution/liveExchangeAdapter.ts
 * 
 * Verifies:
 * 1. Leg 1: placeMakerLimit
 *    - Binance Post-Only GTX limit order formatting
 *    - Bybit Post-Only limit order formatting
 *    - Dynamic 1-tick micro-repricing upon book-cross rejections (-2010 on Binance, 110007 on Bybit)
 *    - Up to 2 retries before returning REJECTED status
 * 2. cancelOrder
 *    - Executed quantity reporting and in-flight fill detection on Binance and Bybit
 *    - Resilient error recovery polling status if cancel throws
 * 3. pollOrderStatus
 *    - Authoritative mapping of exchange statuses to ExchangeOrderStatus (NEW, PARTIALLY_FILLED, FILLED, CANCELLED)
 * 4. Leg 2: placeTakerIoc
 *    - Sub-35ms WebSocket IOC taker order placement when streams are healthy
 *    - 500ms watchdog circuit breaker falling back cleanly to signed REST API
 *    - Direct REST dispatch when useWebSocket is false
 * 5. emergencyMarketUnwind
 *    - Aggressive MARKET order with reduceOnly: true on Leg 1 venue to eliminate orphan legs
 * 6. Credential Decryption
 *    - getDecryptedExchangeCredentials loading usr_admin_varsha or environment fallback
 *    - AES-256-GCM vault decryption handling enc:v1: secrets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LiveExchangeAdapter,
  getDecryptedExchangeCredentials,
} from '@/lib/statarb/execution/liveExchangeAdapter';
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
import { getCockpitVaultKey, decryptVaultSecret } from '@/lib/cryptoVault';
import { findUserById, getDecryptedUserApiKeys } from '@/lib/userStore';

// Mock dependencies
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
  decryptVaultSecret: vi.fn((cipherText: string) => cipherText.replace('enc:v1:mock_encrypted_', '')),
}));

vi.mock('@/lib/userStore', () => ({
  findUserById: vi.fn(),
  getDecryptedUserApiKeys: vi.fn(),
}));

describe('LiveExchangeAdapter Unit Test Suite (liveExchangeAdapter.ts)', () => {
  let adapter: LiveExchangeAdapter;

  const mockCreds = {
    binanceKey: 'test-bn-key-123',
    binanceSecret: 'test-bn-secret-456',
    binanceEndpoint: 'https://fapi.binance.com',
    bybitKey: 'test-bybit-key-789',
    bybitSecret: 'test-bybit-secret-abc',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LiveExchangeAdapter(mockCreds);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. LEG 1: PLACE MAKER LIMIT & DYNAMIC MICRO-REPRICING
  // =========================================================================
  describe('1. placeMakerLimit: Post-Only Formatting & Micro-Repricing', () => {
    it('formats and dispatches Binance Post-Only GTX limit order correctly', async () => {
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 987654321,
          symbol: 'BTCUSDT',
          status: 'NEW',
          clientOrderId: 'custom_cid_101',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.placeMakerLimit(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        60000.0,
        0.005,
        'custom_cid_101',
        'GTX'
      );

      expect(res).toEqual({ orderId: '987654321', status: 'NEW' });
      expect(signAndFetchBinance).toHaveBeenCalledTimes(1);
      expect(signAndFetchBinance).toHaveBeenCalledWith(
        mockCreds.binanceKey,
        mockCreds.binanceSecret,
        'POST',
        '/fapi/v1/order',
        {
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'LIMIT',
          timeInForce: 'GTX',
          quantity: '0.005',
          price: '60000.0', // BTCUSDT on Binance has 1 decimal (tickSize 0.1)
          newClientOrderId: 'custom_cid_101',
        },
        true,
        mockCreds.binanceEndpoint
      );
    });

    it('formats and dispatches Bybit Post-Only limit order correctly', async () => {
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'bybit_order_777',
          orderLinkId: 'custom_link_202',
        },
      });

      const res = await adapter.placeMakerLimit(
        'BYBIT',
        'ETHUSDT',
        'SELL',
        3000.0,
        0.1,
        'custom_link_202',
        'PostOnly'
      );

      expect(res).toEqual({ orderId: 'bybit_order_777', status: 'NEW' });
      expect(sendBybitRequest).toHaveBeenCalledTimes(1);
      expect(sendBybitRequest).toHaveBeenCalledWith(
        '/v5/order/create',
        'POST',
        { apiKey: mockCreds.bybitKey, apiSecret: mockCreds.bybitSecret },
        {
          category: 'linear',
          symbol: 'ETHUSDT',
          side: 'Sell',
          orderType: 'Limit',
          price: '3000.00',
          qty: '0.1',
          timeInForce: 'PostOnly',
          orderFilter: 'Order',
          orderLinkId: 'custom_link_202',
          positionIdx: 0,
        }
      );
    });

    it('performs dynamic 1-tick micro-repricing on Binance upon -2010 book-cross error and succeeds on retry', async () => {
      // BTCUSDT filter: tickSize = 0.1, priceDecimals = 1
      // Attempt 0: Book cross rejection (-2010)
      vi.mocked(signAndFetchBinance).mockRejectedValueOnce(
        new Error('[-2010] Order would immediately match and take as a taker.')
      );

      // Attempt 1 (Retry 1): BUY order repriced down by 1 tick (60000.0 -> 59999.9) succeeds
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 11223344,
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
        0.002,
        'cid_reprice_test',
        'GTX'
      );

      expect(res).toEqual({ orderId: '11223344', status: 'NEW' });
      expect(signAndFetchBinance).toHaveBeenCalledTimes(2);

      // Verify Attempt 0 price (60000.0)
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        1,
        mockCreds.binanceKey,
        mockCreds.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '60000.0',
          newClientOrderId: 'cid_reprice_test',
        }),
        true,
        mockCreds.binanceEndpoint
      );

      // Verify Attempt 1 repriced price (60000.0 - 0.1 = 59999.9) and _r1 appended to clientOrderId
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        2,
        mockCreds.binanceKey,
        mockCreds.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '59999.9',
          newClientOrderId: 'cid_reprice_test_r1',
        }),
        true,
        mockCreds.binanceEndpoint
      );
    });

    it('performs dynamic 1-tick micro-repricing on SELL side (price + tickSize) on Binance', async () => {
      // SELL order on BTCUSDT: price increases by tickSize (60000.0 -> 60000.1)
      vi.mocked(signAndFetchBinance).mockRejectedValueOnce(
        new Error('Order would immediately match and take')
      );
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: { orderId: 556677, status: 'NEW' },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.placeMakerLimit(
        'BINANCE',
        'BTCUSDT',
        'SELL',
        60000.0,
        0.002,
        'cid_sell_reprice',
        'GTX'
      );

      expect(res.status).toBe('NEW');
      expect(signAndFetchBinance).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.any(String),
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          price: '60000.1',
          newClientOrderId: 'cid_sell_reprice_r1',
        }),
        true,
        expect.any(String)
      );
    });

    it('exhausts max 2 micro-repricing retries on Binance and returns REJECTED status', async () => {
      vi.mocked(signAndFetchBinance)
        .mockRejectedValueOnce(new Error('[-2010] Order would immediately match and take'))
        .mockRejectedValueOnce(new Error('[-2010] Order would immediately match and take'))
        .mockRejectedValueOnce(new Error('[-2010] Order would immediately match and take'));

      const res = await adapter.placeMakerLimit(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        60000.0,
        0.002,
        'cid_exhaust_test',
        'GTX'
      );

      expect(res.status).toBe('REJECTED');
      expect(res.orderId).toBe('');
      expect(res.rejectReason).toContain('[-2010]');
      expect(signAndFetchBinance).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('performs dynamic 1-tick micro-repricing on Bybit upon retCode 110007', async () => {
      // ETHUSDT: tickSize = 0.01, priceDecimals = 2
      // Attempt 0: retCode 110007 (order would immediately trigger or cross)
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 110007,
        retMsg: 'order would immediately trigger or cross book as PostOnly',
      });

      // Attempt 1: Repriced BUY order (3000.00 - 0.01 = 2999.99) succeeds
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 0,
        retMsg: 'OK',
        result: {
          orderId: 'bybit_reprice_success',
        },
      });

      const res = await adapter.placeMakerLimit(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        3000.0,
        0.5,
        'link_reprice_bybit',
        'PostOnly'
      );

      expect(res).toEqual({ orderId: 'bybit_reprice_success', status: 'NEW' });
      expect(sendBybitRequest).toHaveBeenCalledTimes(2);

      // Verify Attempt 1 price (2999.99)
      expect(sendBybitRequest).toHaveBeenNthCalledWith(
        2,
        '/v5/order/create',
        'POST',
        expect.any(Object),
        expect.objectContaining({
          price: '2999.99',
          orderLinkId: 'link_reprice_bybit_r1',
        })
      );
    });

    it('exhausts max retries on Bybit when retCode 110007 persists', async () => {
      vi.mocked(sendBybitRequest).mockResolvedValue({
        retCode: 110007,
        retMsg: 'order would cross book (110007)',
      });

      const res = await adapter.placeMakerLimit(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        3000.0,
        0.5,
        'link_bybit_fail',
        'PostOnly'
      );

      expect(res.status).toBe('REJECTED');
      expect(res.orderId).toBe('');
      expect(res.rejectReason).toContain('110007');
      expect(sendBybitRequest).toHaveBeenCalledTimes(3);
    });

    it('fails immediately without retrying on non-book-cross error', async () => {
      vi.mocked(signAndFetchBinance).mockRejectedValueOnce(
        new Error('[-2019] Margin is insufficient.')
      );

      const res = await adapter.placeMakerLimit(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        60000.0,
        1.0,
        'cid_margin_error',
        'GTX'
      );

      expect(res.status).toBe('REJECTED');
      expect(res.rejectReason).toContain('[-2019]');
      expect(signAndFetchBinance).toHaveBeenCalledTimes(1); // No retries
    });
  });

  // =========================================================================
  // 2. CANCEL ORDER & IN-FLIGHT FILL DETECTION
  // =========================================================================
  describe('2. cancelOrder: Executed Quantity Reporting & In-Flight Fill Detection', () => {
    it('cancels Binance order and accurately parses executed quantity', async () => {
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          symbol: 'BTCUSDT',
          orderId: 98765,
          status: 'CANCELED',
          executedQty: '0.0450',
          cumQty: '0.0450',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.cancelOrder('BINANCE', 'BTCUSDT', '98765', 'cid_98765');

      expect(res).toEqual({ success: true, executedQty: 0.045 });
      expect(signAndFetchBinance).toHaveBeenCalledWith(
        mockCreds.binanceKey,
        mockCreds.binanceSecret,
        'DELETE',
        '/fapi/v1/order',
        { symbol: 'BTCUSDT', orderId: '98765' },
        true,
        mockCreds.binanceEndpoint
      );
    });

    it('cancels Bybit order and queries pollOrderStatus for true executed quantity', async () => {
      // 1. Cancel call
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 0,
        retMsg: 'OK',
        result: { orderId: 'bb_cancel_1' },
      });

      // 2. Status check poll
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        retCode: 0,
        result: {
          list: [
            {
              orderId: 'bb_cancel_1',
              orderStatus: 'PartiallyFilled',
              cumExecQty: '0.120',
              avgPrice: '3005.50',
            },
          ],
        },
      });

      const res = await adapter.cancelOrder('BYBIT', 'ETHUSDT', 'bb_cancel_1', 'link_bb_1');

      expect(res).toEqual({ success: true, executedQty: 0.12 });
      expect(sendBybitRequest).toHaveBeenNthCalledWith(
        1,
        '/v5/order/cancel',
        'POST',
        expect.any(Object),
        { category: 'linear', symbol: 'ETHUSDT', orderId: 'bb_cancel_1' }
      );
      expect(sendBybitRequest).toHaveBeenNthCalledWith(
        2,
        '/v5/order/realtime',
        'GET',
        expect.any(Object),
        { category: 'linear', symbol: 'ETHUSDT', orderId: 'bb_cancel_1' }
      );
    });

    it('recovers in-flight fill via pollOrderStatus when cancellation throws', async () => {
      // e.g. Order already completely filled right as cancellation arrived
      vi.mocked(signAndFetchBinance)
        .mockRejectedValueOnce(new Error('[-2011] Unknown order sent / already filled'))
        .mockResolvedValueOnce({
          data: {
            status: 'FILLED',
            executedQty: '0.0500',
            avgPrice: '60120.00',
          },
          endpoint: 'https://fapi.binance.com',
        });

      const res = await adapter.cancelOrder('BINANCE', 'BTCUSDT', '999888', 'cid_in_flight');

      expect(res).toEqual({ success: true, executedQty: 0.05 });
      expect(signAndFetchBinance).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // 3. POLL ORDER STATUS MAPPING
  // =========================================================================
  describe('3. pollOrderStatus: Exchange Status Mapping', () => {
    it('maps Binance order statuses correctly', async () => {
      // NEW
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: { status: 'NEW', executedQty: '0', avgPrice: '0' },
        endpoint: 'https://fapi.binance.com',
      });
      let status = await adapter.pollOrderStatus('BINANCE', 'BTCUSDT', '101', 'cid_101');
      expect(status).toEqual({ status: 'NEW', executedQty: 0, avgPrice: 0 });

      // PARTIALLY_FILLED
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: { status: 'PARTIALLY_FILLED', executedQty: '0.02', avgPrice: '60000.0' },
        endpoint: 'https://fapi.binance.com',
      });
      status = await adapter.pollOrderStatus('BINANCE', 'BTCUSDT', '101', 'cid_101');
      expect(status).toEqual({ status: 'PARTIALLY_FILLED', executedQty: 0.02, avgPrice: 60000.0 });

      // FILLED
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: { status: 'FILLED', cumQty: '0.05', avgPrice: '60050.0' },
        endpoint: 'https://fapi.binance.com',
      });
      status = await adapter.pollOrderStatus('BINANCE', 'BTCUSDT', '101', 'cid_101');
      expect(status).toEqual({ status: 'FILLED', executedQty: 0.05, avgPrice: 60050.0 });

      // CANCELED -> CANCELLED
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: { status: 'CANCELED', executedQty: '0.01', avgPrice: '60000.0' },
        endpoint: 'https://fapi.binance.com',
      });
      status = await adapter.pollOrderStatus('BINANCE', 'BTCUSDT', '101', 'cid_101');
      expect(status.status).toBe('CANCELLED');

      // EXPIRED -> CANCELLED
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: { status: 'EXPIRED', executedQty: '0', avgPrice: '0' },
        endpoint: 'https://fapi.binance.com',
      });
      status = await adapter.pollOrderStatus('BINANCE', 'BTCUSDT', '101', 'cid_101');
      expect(status.status).toBe('CANCELLED');

      // REJECTED -> CANCELLED
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: { status: 'REJECTED', executedQty: '0', avgPrice: '0' },
        endpoint: 'https://fapi.binance.com',
      });
      status = await adapter.pollOrderStatus('BINANCE', 'BTCUSDT', '101', 'cid_101');
      expect(status.status).toBe('CANCELLED');
    });

    it('maps Bybit order statuses correctly', async () => {
      // New -> NEW
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        result: { list: [{ orderStatus: 'New', cumExecQty: '0', avgPrice: '0' }] },
      });
      let status = await adapter.pollOrderStatus('BYBIT', 'ETHUSDT', '202', 'link_202');
      expect(status).toEqual({ status: 'NEW', executedQty: 0, avgPrice: 0 });

      // PartiallyFilled -> PARTIALLY_FILLED
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        result: { list: [{ orderStatus: 'PartiallyFilled', cumExecQty: '0.2', avgPrice: '3000' }] },
      });
      status = await adapter.pollOrderStatus('BYBIT', 'ETHUSDT', '202', 'link_202');
      expect(status).toEqual({ status: 'PARTIALLY_FILLED', executedQty: 0.2, avgPrice: 3000 });

      // Filled -> FILLED
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        result: { list: [{ orderStatus: 'Filled', cumExecQty: '0.5', avgPrice: '3005' }] },
      });
      status = await adapter.pollOrderStatus('BYBIT', 'ETHUSDT', '202', 'link_202');
      expect(status).toEqual({ status: 'FILLED', executedQty: 0.5, avgPrice: 3005 });

      // Cancelled -> CANCELLED
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        result: { list: [{ orderStatus: 'Cancelled', cumExecQty: '0', avgPrice: '0' }] },
      });
      status = await adapter.pollOrderStatus('BYBIT', 'ETHUSDT', '202', 'link_202');
      expect(status.status).toBe('CANCELLED');

      // Deactivated -> CANCELLED
      vi.mocked(sendBybitRequest).mockResolvedValueOnce({
        result: { list: [{ orderStatus: 'Deactivated', cumExecQty: '0', avgPrice: '0' }] },
      });
      status = await adapter.pollOrderStatus('BYBIT', 'ETHUSDT', '202', 'link_202');
      expect(status.status).toBe('CANCELLED');
    });
  });

  // =========================================================================
  // 4. LEG 2: PLACE TAKER IOC & WATCHDOG CIRCUIT BREAKER
  // =========================================================================
  describe('4. placeTakerIoc: WebSocket Routing & 500ms Watchdog Circuit Breaker', () => {
    it('dispatches sub-35ms WebSocket IOC taker on Binance when stream is healthy', async () => {
      vi.mocked(binanceTradeStream.isHealthy).mockReturnValue(true);
      vi.mocked(binanceTradeStream.placeOrder).mockResolvedValueOnce({
        success: true,
        orderId: 'ws_bn_order_123',
        symbol: 'BTCUSDT',
        side: 'SELL',
        quantity: 0.05,
        avgPrice: 60100.0,
        executionLatencyMs: 18,
        venue: 'Binance',
        transport: 'WEBSOCKET',
      });

      const res = await adapter.placeTakerIoc(
        'BINANCE',
        'BTCUSDT',
        'SELL',
        0.05,
        'ioc_cid_ws_bn',
        true,
        60100.0
      );

      expect(res.orderId).toBe('ws_bn_order_123');
      expect(res.executedQty).toBe(0.05);
      expect(res.avgPrice).toBe(60100.0);
      expect(res.latencyMs).toBe(18);
      // Fee: 0.05 * 60100 * 0.00055 = 1.65275 -> 1.6528 USDT
      expect(res.feeUsdt).toBe(1.6528);
      expect(binanceTradeStream.placeOrder).toHaveBeenCalledTimes(1);
      expect(signAndFetchBinance).not.toHaveBeenCalled();
    });

    it('dispatches sub-35ms WebSocket IOC taker on Bybit when stream is healthy', async () => {
      vi.mocked(bybitTradeStream.isHealthy).mockReturnValue(true);
      vi.mocked(bybitTradeStream.placeOrder).mockResolvedValueOnce({
        success: true,
        orderId: 'ws_bybit_order_456',
        orderLinkId: 'link_1',
        category: 'linear',
        symbol: 'ETHUSDT',
        side: 'Buy',
        quantity: 0.1,
        avgPrice: 3000.0,
        executionLatencyMs: 22,
        venue: 'BYBIT',
        isSimulated: false,
      } as any);

      const res = await adapter.placeTakerIoc(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        0.1,
        'ioc_link_ws_bb',
        true,
        3000.0
      );

      expect(res.orderId).toBe('ws_bybit_order_456');
      expect(res.executedQty).toBe(0.1);
      expect(res.avgPrice).toBe(3000.0);
      expect(res.latencyMs).toBe(22);
      // Fee: 0.1 * 3000 * 0.00055 = 0.165 USDT
      expect(res.feeUsdt).toBe(0.165);
      expect(bybitTradeStream.placeOrder).toHaveBeenCalledTimes(1);
      expect(sendBybitRequest).not.toHaveBeenCalled();
    });

    it('dispatches Bybit WebSocket IOC taker with BybitOrderResult and resolves orderLinkId when orderId is absent', async () => {
      vi.mocked(bybitTradeStream.isHealthy).mockReturnValue(true);
      vi.mocked(bybitTradeStream.placeOrder).mockResolvedValueOnce({
        success: true,
        orderLinkId: 'link_1',
        category: 'linear',
        symbol: 'ETHUSDT',
        side: 'Buy',
        quantity: 0.1,
        avgPrice: 3000.0,
        executionLatencyMs: 25,
        venue: 'BYBIT',
        isSimulated: false,
      } as any);

      const res = await adapter.placeTakerIoc(
        'BYBIT',
        'ETHUSDT',
        'BUY',
        0.1,
        'link_1',
        true,
        3000.0
      );

      expect(res.orderId).toBe('link_1');
      expect(res.executedQty).toBe(0.1);
      expect(res.avgPrice).toBe(3000.0);
      expect(res.latencyMs).toBe(25);
      expect(bybitTradeStream.placeOrder).toHaveBeenCalledTimes(1);
      expect(sendBybitRequest).not.toHaveBeenCalled();
    });

    it('trips 500ms watchdog circuit breaker on Binance WebSocket timeout and falls back cleanly to signed REST', async () => {
      vi.mocked(binanceTradeStream.isHealthy).mockReturnValue(true);
      // Hanging WebSocket that takes 1000ms (exceeds 500ms watchdog)
      vi.mocked(binanceTradeStream.placeOrder).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      // REST fallback mock
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 77889900,
          executedQty: '0.05',
          avgPrice: '60000.00',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.placeTakerIoc(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        0.05,
        'ioc_timeout_cid',
        true,
        60000.0
      );

      expect(res.orderId).toBe('77889900');
      expect(res.executedQty).toBe(0.05);
      expect(res.avgPrice).toBe(60000.0);
      expect(signAndFetchBinance).toHaveBeenCalledTimes(1);
      expect(signAndFetchBinance).toHaveBeenCalledWith(
        mockCreds.binanceKey,
        mockCreds.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          symbol: 'BTCUSDT',
          type: 'LIMIT',
          timeInForce: 'IOC',
          quantity: '0.05',
          price: '60000',
        }),
        true,
        mockCreds.binanceEndpoint
      );
    });

    it('trips 500ms watchdog circuit breaker on Bybit WebSocket error and falls back cleanly to signed REST', async () => {
      vi.mocked(bybitTradeStream.isHealthy).mockReturnValue(true);
      vi.mocked(bybitTradeStream.placeOrder).mockRejectedValueOnce(
        new Error('WebSocket connection reset by peer')
      );

      // REST fallback mock
      vi.mocked(sendBybitRequest)
        .mockResolvedValueOnce({
          retCode: 0,
          retMsg: 'OK',
          result: { orderId: 'bb_rest_ioc_id' },
        })
        .mockResolvedValueOnce({
          result: {
            list: [
              {
                orderId: 'bb_rest_ioc_id',
                orderStatus: 'Filled',
                cumExecQty: '0.1',
                avgPrice: '3000',
              },
            ],
          },
        });

      const res = await adapter.placeTakerIoc(
        'BYBIT',
        'ETHUSDT',
        'SELL',
        0.1,
        'ioc_ws_fail_link',
        true,
        3000.0
      );

      expect(res.orderId).toBe('bb_rest_ioc_id');
      expect(res.executedQty).toBe(0.1);
      expect(res.avgPrice).toBe(3000.0);
      expect(sendBybitRequest).toHaveBeenCalled();
    });

    it('directly dispatches via signed REST API when useWebSocket is false', async () => {
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 991122,
          executedQty: '0.02',
          avgPrice: '60000.00',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.placeTakerIoc(
        'BINANCE',
        'BTCUSDT',
        'BUY',
        0.02,
        'ioc_rest_direct',
        false, // skip WebSocket
        60000.0
      );

      expect(res.orderId).toBe('991122');
      expect(binanceTradeStream.placeOrder).not.toHaveBeenCalled();
      expect(signAndFetchBinance).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 5. EMERGENCY MARKET UNWIND
  // =========================================================================
  describe('5. emergencyMarketUnwind: Orphan Exposure Elimination', () => {
    it('dispatches aggressive Binance MARKET order with reduceOnly: true', async () => {
      vi.mocked(signAndFetchBinance).mockResolvedValueOnce({
        data: {
          orderId: 12345,
          executedQty: '0.05',
          avgPrice: '59950.00',
          status: 'FILLED',
        },
        endpoint: 'https://fapi.binance.com',
      });

      const res = await adapter.emergencyMarketUnwind('BINANCE', 'BTCUSDT', 'SELL', 0.05);

      expect(res).toEqual({
        success: true,
        executedQty: 0.05,
        avgPrice: 59950.0,
      });

      expect(signAndFetchBinance).toHaveBeenCalledWith(
        mockCreds.binanceKey,
        mockCreds.binanceSecret,
        'POST',
        '/fapi/v1/order',
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          type: 'MARKET',
          quantity: '0.05',
          reduceOnly: 'true',
        }),
        true,
        mockCreds.binanceEndpoint
      );
    });

    it('dispatches aggressive Bybit Market order with reduceOnly: true', async () => {
      vi.mocked(sendBybitRequest)
        .mockResolvedValueOnce({
          retCode: 0,
          result: { orderId: 'unwind_bybit_1' },
        })
        .mockResolvedValueOnce({
          result: {
            list: [
              {
                orderId: 'unwind_bybit_1',
                orderStatus: 'Filled',
                cumExecQty: '0.1',
                avgPrice: '3010.0',
              },
            ],
          },
        });

      const res = await adapter.emergencyMarketUnwind('BYBIT', 'ETHUSDT', 'BUY', 0.1);

      expect(res).toEqual({
        success: true,
        executedQty: 0.1,
        avgPrice: 3010.0,
      });

      expect(sendBybitRequest).toHaveBeenCalledWith(
        '/v5/order/create',
        'POST',
        expect.any(Object),
        expect.objectContaining({
          category: 'linear',
          symbol: 'ETHUSDT',
          side: 'Buy',
          orderType: 'Market',
          qty: '0.1',
          reduceOnly: true,
        })
      );
    });

    it('handles emergency unwind failure gracefully and returns success: false', async () => {
      vi.mocked(signAndFetchBinance).mockRejectedValueOnce(
        new Error('Network disconnected / timeout')
      );

      const res = await adapter.emergencyMarketUnwind('BINANCE', 'BTCUSDT', 'BUY', 0.05);

      expect(res).toEqual({
        success: false,
        executedQty: 0,
        avgPrice: 0,
      });
    });
  });

  // =========================================================================
  // 6. CREDENTIAL DECRYPTION & VAULT INTEGRATION
  // =========================================================================
  describe('6. Credential Decryption & Vault Integration', () => {
    it('loads and decrypts user credentials for usr_admin_varsha from userStore', () => {
      vi.mocked(findUserById).mockReturnValueOnce({
        id: 'usr_admin_varsha',
        username: 'admin',
        role: 'admin',
      } as any);

      vi.mocked(getDecryptedUserApiKeys).mockReturnValueOnce({
        binanceKey: 'vault_bn_key',
        binanceSecret: 'enc:v1:mock_encrypted_secret_bn',
        binanceEndpoint: 'https://fapi.binance.com',
        bybitKey: 'vault_bybit_key',
        bybitSecret: 'enc:v1:mock_encrypted_secret_bb',
      } as any);

      const creds = getDecryptedExchangeCredentials('usr_admin_varsha');

      expect(findUserById).toHaveBeenCalledWith('usr_admin_varsha');
      expect(creds.binanceKey).toBe('vault_bn_key');
      expect(creds.binanceSecret).toBe('secret_bn');
      expect(creds.bybitKey).toBe('vault_bybit_key');
      expect(creds.bybitSecret).toBe('secret_bb');
    });

    it('falls back cleanly to environment variables when userStore is unavailable', () => {
      vi.mocked(findUserById).mockReturnValueOnce(undefined);

      const originalEnv = { ...process.env };
      process.env.BINANCE_API_KEY = 'env_bn_key';
      process.env.BINANCE_API_SECRET = 'env_bn_secret';
      process.env.BYBIT_API_KEY = 'env_bybit_key';
      process.env.BYBIT_API_SECRET = 'env_bybit_secret';

      const creds = getDecryptedExchangeCredentials('usr_non_existent');

      expect(creds.binanceKey).toBe('env_bn_key');
      expect(creds.binanceSecret).toBe('env_bn_secret');
      expect(creds.bybitKey).toBe('env_bybit_key');
      expect(creds.bybitSecret).toBe('env_bybit_secret');

      // Restore env
      process.env = originalEnv;
    });

    it('provides static helper LiveExchangeAdapter.decryptCredentials', () => {
      vi.mocked(findUserById).mockReturnValueOnce(undefined);
      const creds = LiveExchangeAdapter.decryptCredentials();
      expect(creds).toBeDefined();
      expect(creds.binanceEndpoint).toBe('https://fapi.binance.com');
    });
  });
});
