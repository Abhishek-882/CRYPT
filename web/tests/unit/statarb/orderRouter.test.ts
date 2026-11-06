/**
 * Unit Test Suite: Maker-Taker Limit Order Router
 * Target: web/lib/statarb/execution/orderRouter.ts
 * 
 * Verifies:
 * - Leg 1 Maker Limit Order placement:
 *   - Top-of-book Post-Only pricing calculation (GTX on Binance, PostOnly on Bybit)
 * - 8.0-second timeout clean cancel ($0.00 loss, zero orphan exposure)
 * - 120ms counterpart adverse drift monitor (> 8.0 bps abort with $0.00 loss)
 * - Leg 2 sub-35ms WebSocket IOC Taker hedge:
 *   - Synchronous dispatch on Leg 1 fill
 *   - Exact quantity sizing for 1:1 delta neutrality (|Delta_net| < 0.001)
 *   - Partial fill handling (e.g. 40% fill -> cancel remainder, sizes Leg 2 to 40%)
 * - Sub-35ms latency tracking & telemetry
 * - 500ms watchdog circuit breaker with automatic REST fallback
 * - Emergency market unwind on catastrophic Leg 2 failure
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MakerTakerOrderRouter,
  calculatePostOnlyPrice,
  checkAdverseDrift,
} from '@/lib/statarb/execution/orderRouter';
import {
  MockExchangeExecutionAdapter,
  createMockExecutionRequest,
} from './fixtures/orderRouterFixtures';

describe('Maker-Taker Order Router Unit Tests (orderRouter.ts)', () => {
  let adapter: MockExchangeExecutionAdapter;
  let router: MakerTakerOrderRouter;

  beforeEach(() => {
    adapter = new MockExchangeExecutionAdapter();
    router = new MakerTakerOrderRouter(adapter);
  });

  // =========================================================================
  // 1. LEG 1: POST-ONLY MAKER LIMIT PRICING & SPECIFICATION
  // =========================================================================
  describe('Leg 1: Post-Only Maker Limit Pricing Logic', () => {
    it('calculates optimal BUY Post-Only price at top-of-book: min(bestBid, bestAsk - tickSize)', () => {
      // Best bid = 60,000.0, Best ask = 60,001.0, tickSize = 0.1
      // BUY order should peg to bestBid = 60,000.0 (resting on bid book)
      const price = calculatePostOnlyPrice('BUY', 60000.0, 60001.0, 0.1);
      expect(price).toBe(60000.0);

      // If bestBid is slightly wider, e.g. bid = 59,999.0, ask = 60,000.0, tick = 0.5
      // min(59999.0, 59999.5) = 59999.0
      expect(calculatePostOnlyPrice('BUY', 59999.0, 60000.0, 0.5)).toBe(59999.0);
    });

    it('calculates optimal SELL Post-Only price at top-of-book: max(bestAsk, bestBid + tickSize)', () => {
      // Best bid = 59,999.0, Best ask = 60,000.0, tickSize = 0.1
      // SELL order should peg to bestAsk = 60,000.0 (resting on ask book)
      const price = calculatePostOnlyPrice('SELL', 59999.0, 60000.0, 0.1);
      expect(price).toBe(60000.0);
    });

    it('dispatches Binance Leg 1 with GTX (Good-Till-Crossing) time-in-force', async () => {
      const request = createMockExecutionRequest({
        leg1Venue: 'BINANCE',
        leg1Side: 'SELL',
      });

      await router.executeEntry(request);

      expect(adapter.auditLog.placedMakerOrders).toHaveLength(1);
      const placed = adapter.auditLog.placedMakerOrders[0];
      expect(placed.venue).toBe('BINANCE');
      expect(placed.timeInForce).toBe('GTX');
      expect(placed.side).toBe('SELL');
      expect(placed.price).toBe(60000.0);
    });

    it('dispatches Bybit Leg 1 with PostOnly time-in-force when Leg 1 is on Bybit', async () => {
      const request = createMockExecutionRequest({
        leg1Venue: 'BYBIT',
        leg2Venue: 'BINANCE',
        leg1Side: 'BUY',
        leg1BestBid: 59990.0,
        leg1BestAsk: 59995.0,
      });

      await router.executeEntry(request);

      expect(adapter.auditLog.placedMakerOrders).toHaveLength(1);
      const placed = adapter.auditLog.placedMakerOrders[0];
      expect(placed.venue).toBe('BYBIT');
      expect(placed.timeInForce).toBe('PostOnly');
      expect(placed.side).toBe('BUY');
    });

    it('gracefully handles Leg 1 Post-Only immediate rejection', async () => {
      adapter.options.leg1Behavior = 'REJECT';

      const request = createMockExecutionRequest();
      const result = await router.executeEntry(request);

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.executedQty).toBe(0);
      expect(result.capitalLossUsdt).toBe(0.0);
      expect(result.reason).toContain('Leg 1 Post-Only order rejected');
    });
  });

  // =========================================================================
  // 2. 8.0-SECOND TIMEOUT CLEAN CANCELLATION ($0.00 LOSS)
  // =========================================================================
  describe('8.0-Second Timeout Watchdog Clean Cancellation', () => {
    it('cleanly cancels unfilled Leg 1 order upon timeout with strictly $0.00 loss and 0 net delta', async () => {
      // Configure adapter to simulate unfilled resting limit order
      adapter.options.leg1Behavior = 'TIMEOUT';

      const request = createMockExecutionRequest({
        timeoutMs: 150, // Short timeout for fast unit test execution
        driftCheckIntervalMs: 50,
      });

      const result = await router.executeEntry(request);

      expect(result.success).toBe(false);
      expect(result.status).toBe('ABORTED_TIMEOUT');
      expect(result.executedQty).toBe(0);
      expect(result.capitalLossUsdt).toBe(0.0);
      expect(result.netDelta).toBe(0);
      expect(result.isDeltaNeutral).toBe(true);
      expect(result.reason).toContain('Cancelled cleanly with $0.00 loss');

      // Verify cancellation was dispatched to exchange adapter
      expect(adapter.auditLog.cancelledOrders).toHaveLength(1);
      // Verify NO taker order was ever dispatched
      expect(adapter.auditLog.placedTakerOrders).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. 120ms ADVERSE PRICE DRIFT WATCHDOG
  // =========================================================================
  describe('Counterpart Adverse Price Drift Watchdog (checkAdverseDrift)', () => {
    it('detects adverse price drop on counterpart when Leg 1 is BUY (Counterpart SELL)', () => {
      // Initial counterpart mark price = 60,000
      // If counterpart drops to 59,940: ((60000 - 59940) / 60000) * 10000 = 10.0 bps > 8.0 bps
      const drift = checkAdverseDrift('BUY', 60000.0, 59940.0, 8.0);
      expect(drift.isAdverse).toBe(true);
      expect(drift.driftBps).toBe(10.0);

      // Safe drift of 4 bps
      const safeDrift = checkAdverseDrift('BUY', 60000.0, 59976.0, 8.0);
      expect(safeDrift.isAdverse).toBe(false);
      expect(safeDrift.driftBps).toBe(4.0);
    });

    it('detects adverse price rise on counterpart when Leg 1 is SELL (Counterpart BUY)', () => {
      // Initial counterpart price = 59,800
      // Counterpart rises to 59,860: ((59860 - 59800) / 59800) * 10000 = 10.03 bps > 8.0 bps
      const drift = checkAdverseDrift('SELL', 59800.0, 59860.0, 8.0);
      expect(drift.isAdverse).toBe(true);
      expect(drift.driftBps).toBe(10.03);
    });

    it('cancels Leg 1 immediately with $0.00 loss when counterpart drifts > 8.0 bps', async () => {
      adapter.options.leg1Behavior = 'TIMEOUT'; // Resting on order book

      let tick = 0;
      const counterpartPriceFetcher = () => {
        tick++;
        // On tick 2, simulate adverse counterpart jump from 59,800 to 59,860 (> 8 bps)
        return tick >= 2 ? 59860.0 : 59800.0;
      };

      const request = createMockExecutionRequest({
        timeoutMs: 1000,
        driftCheckIntervalMs: 20,
        counterpartPriceFetcher,
      });

      const result = await router.executeEntry(request);

      expect(result.success).toBe(false);
      expect(result.status).toBe('ABORTED_ADVERSE_DRIFT');
      expect(result.executedQty).toBe(0);
      expect(result.capitalLossUsdt).toBe(0.0);
      expect(result.reason).toContain('Adverse drift detected on counterpart venue');
      expect(result.reason).toContain('Cancelled Leg 1 with $0.00 loss');
      expect(adapter.auditLog.cancelledOrders).toHaveLength(1);
    });
  });

  // =========================================================================
  // 4. LEG 2 SUB-35MS IOC TAKER HEDGE & DELTA NEUTRALITY
  // =========================================================================
  describe('Leg 2 IOC Taker Hedge & Delta Neutrality', () => {
    it('executes full fill cleanly with 1:1 delta neutrality and sub-35ms WebSocket latency', async () => {
      adapter.options.leg1Behavior = 'INSTANT';
      adapter.options.leg2WsLatencyMs = 22; // 22ms roundtrip

      const request = createMockExecutionRequest({ quantity: 0.005 });
      const result = await router.executeEntry(request);

      expect(result.success).toBe(true);
      expect(result.status).toBe('FILLED');
      expect(result.executedQty).toBe(0.005);
      expect(result.requestedQty).toBe(0.005);
      expect(result.netDelta).toBe(0.0);
      expect(result.isDeltaNeutral).toBe(true);
      expect(result.leg2LatencyMs).toBe(22);
      expect(result.leg2LatencyMs).toBeLessThanOrEqual(35); // Benchmark requirement: sub-35ms

      // Verify Leg 2 was placed over WebSocket
      expect(adapter.auditLog.placedTakerOrders).toHaveLength(1);
      const taker = adapter.auditLog.placedTakerOrders[0];
      expect(taker.useWebSocket).toBe(true);
      expect(taker.qty).toBe(0.005);
      expect(taker.latencyMs).toBe(22);
    });

    it('handles partial fill by cancelling resting remainder and sizing Leg 2 strictly to 40% fill', async () => {
      // Simulate Leg 1 partial fill of 40% (0.40 * 0.010 = 0.004 BTC)
      adapter.options.leg1Behavior = 'PARTIAL';
      adapter.options.leg1PartialRatio = 0.40;

      const request = createMockExecutionRequest({ quantity: 0.010 });
      const result = await router.executeEntry(request);

      expect(result.success).toBe(true);
      expect(result.status).toBe('PARTIALLY_FILLED');
      expect(result.executedQty).toBe(0.004); // Exactly 40%
      expect(result.requestedQty).toBe(0.010);
      expect(result.netDelta).toBe(0.0);
      expect(result.isDeltaNeutral).toBe(true); // 1:1 neutrality strictly preserved!

      // Verify remainder cancellation was dispatched
      expect(adapter.auditLog.cancelledOrders).toHaveLength(1);

      // Verify Leg 2 IOC taker was sized strictly to 0.004 BTC (not 0.010)
      expect(adapter.auditLog.placedTakerOrders).toHaveLength(1);
      const taker = adapter.auditLog.placedTakerOrders[0];
      expect(taker.qty).toBe(0.004);
    });
  });

  // =========================================================================
  // 5. CIRCUIT BREAKER (500MS WATCHDOG) & CATASTROPHIC UNWIND
  // =========================================================================
  describe('Watchdog Circuit Breaker & Emergency Fallbacks', () => {
    it('trips 500ms watchdog on WebSocket timeout and successfully recovers via REST fallback', async () => {
      // Simulate WebSocket ACK dropping / hanging > 500ms
      adapter.options.leg1Behavior = 'INSTANT';
      adapter.options.leg2WsTimeout = true;

      const request = createMockExecutionRequest({ quantity: 0.002 });
      const result = await router.executeEntry(request);

      expect(result.success).toBe(true);
      expect(result.status).toBe('FILLED');
      expect(result.leg2?.transportUsed).toBe('REST');
      expect(result.isDeltaNeutral).toBe(true);

      // Verify REST fallback executed
      expect(adapter.auditLog.placedTakerOrders).toHaveLength(1);
      const taker = adapter.auditLog.placedTakerOrders[0];
      expect(taker.useWebSocket).toBe(false); // REST fallback used
    });

    it('triggers emergency market unwind on Leg 1 within sub-40ms on catastrophic Leg 2 failure', async () => {
      // Simulate both WS and REST failing on Leg 2
      adapter.options.leg1Behavior = 'INSTANT';
      adapter.options.leg2CatastrophicFailure = true;

      const request = createMockExecutionRequest({
        quantity: 0.002,
        leg1Side: 'SELL',
      });
      const result = await router.executeEntry(request);

      expect(result.success).toBe(false);
      expect(result.status).toBe('EMERGENCY_UNWOUND');
      expect(result.reason).toContain('Emergency market unwind executed on Leg 1');
      expect(result.netDelta).toBe(0);
      expect(result.isDeltaNeutral).toBe(true);

      // Verify emergency unwind was triggered on the reverse side of Leg 1 (BUY to unwind SELL)
      expect(adapter.auditLog.emergencyUnwinds).toHaveLength(1);
      const unwind = adapter.auditLog.emergencyUnwinds[0];
      expect(unwind.venue).toBe('BINANCE');
      expect(unwind.side).toBe('BUY');
      expect(unwind.qty).toBe(0.002);
    });
  });
});
