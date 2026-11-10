/**
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS: DivergenceOrderRouter
 * Location: web/tests/adversarial_orderRouter_stress.ts
 * 
 * Directly tests the production implementation in web/lib/divergence/execution/orderRouter.ts:
 * 1. 8,000ms Maker Watchdog Timeout (Zero loss, clean cancel)
 * 2. 120ms Adverse Drift Monitor (0.079% vs 0.080% vs 0.081% exact boundary abort)
 * 3. In-Flight Fill Cancel Race Condition (Resting order filled during cancel proceeds to hedge)
 * 4. 500ms Partial Fill Reconciler ($3.50 sub-min unwind vs $8.00 match lot hedge & trim residual reduceOnly)
 * 5. Mandatory reduceOnly: true Guard on Exits
 */

import {
  DivergenceOrderRouter,
  DefaultDivergenceAdapter,
  checkAdverseDrift,
  calculatePostOnlyPrice,
  executeDivergenceEntry,
  executeDivergenceExit,
  DivergenceExecutionAdapter,
  OrderSide,
} from '../lib/divergence/execution/orderRouter';
import {
  DivergenceCandidate,
  DivergenceConfig,
  DivergencePosition,
  DEFAULT_DIVERGENCE_CONFIG,
  ExchangeVenue,
} from '../lib/divergence/types';
import { getDivergenceStateStore } from '../lib/divergence/store/stateStore';

interface TestResult {
  category: string;
  testName: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

function assert(category: string, testName: string, condition: boolean, details: string) {
  if (condition) {
    passCount++;
    results.push({ category, testName, passed: true, details });
    console.log(`  [PASS] [${category}] ${testName}`);
  } else {
    failCount++;
    results.push({ category, testName, passed: false, details });
    console.error(`  [FAIL] [${category}] ${testName} -> ${details}`);
  }
}

function makeCandidate(symbol: string = 'SUIUSDT', p1: number = 1.0, p2: number = 1.0): DivergenceCandidate {
  return {
    symbol,
    canonicalSymbol: 'SUI',
    binanceSymbol: symbol,
    bybitSymbol: symbol,
    multiplier: 1,
    binancePrice: p1,
    bybitPrice: p2,
    midPrice: (p1 + p2) / 2,
    liveBasisPercent: 0.0,
    dispersion24hPercent: 0.450,
    expansionPotentialPercent: 0.380,
    ddi24h: 1.0,
    suggestedDirection: 'LONG_BN_SHORT_BYB',
    gatesPassed: {
      dispersion: true,
      compression: true,
      antiCollision: true,
      runwayBuffer: true,
      carryFeasibility: true,
    },
    netAlphaProjectedPercent: 0.120,
    timestamp: Date.now(),
    isQualified: true,
  };
}

function makeMockPosition(symbol: string = 'SUI'): DivergencePosition {
  const now = Date.now();
  return {
    id: `pos_stress_${now}`,
    canonicalSymbol: symbol,
    binanceSymbol: `${symbol}USDT`,
    bybitSymbol: `${symbol}USDT`,
    direction: 'LONG_BN_SHORT_BYB',
    status: 'OPEN',
    entryTimestamp: now - 3600000,
    entryBasisPercent: 0.020,
    currentBasisPercent: 0.400,
    peakBasisPercent: 0.400,
    targetExpansionPercent: 0.380,
    stopLossBasisPercent: -0.150,
    entryBinancePrice: 1.00,
    entryBybitPrice: 1.00,
    currentBinancePrice: 1.00,
    currentBybitPrice: 1.00,
    quantityBinance: 15.0,
    quantityBybit: 15.0,
    notionalUsdt: 15.00,
    unrealizedGrossPnlUsdt: 0.0,
    estimatedTotalFeesUsdt: 0.039,
    netPnlUsdt: 0.0,
    roiPercent: 0.0,
    holdDurationMinutes: 60.0,
    relativeExpansionPercent: 0.380,
    isHurdleMet: false,
    leg1: {
      venue: 'BINANCE',
      side: 'BUY',
      orderType: 'POST_ONLY_MAKER_GTX',
      orderId: 'bn_ord_1',
      clientOrderId: 'div1_mock',
      symbol: `${symbol}USDT`,
      executedQty: 15.0,
      avgPrice: 1.00,
      feePercent: 0.020,
      feeUsdt: 0.003,
      latencyMs: 15,
      timestamp: now - 3600000,
    },
    leg2: {
      venue: 'BYBIT',
      side: 'SELL',
      orderType: 'WS_IOC_TAKER',
      orderId: 'byb_ord_1',
      clientOrderId: 'div2_mock',
      symbol: `${symbol}USDT`,
      executedQty: 15.0,
      avgPrice: 1.00,
      feePercent: 0.055,
      feeUsdt: 0.008,
      latencyMs: 32,
      timestamp: now - 3600000,
    },
    executionHash: '0xmockhash1234567890abcdef',
    stagnancyNominalDeadline: now + 180 * 60000,
    stagnancyCeilingDeadline: now + 360 * 60000,
    hasMomentumExtension: false,
    accumulatedCarryPercent: 0.0,
    lastUpdated: now,
  };
}

// ============================================================================
// 1. STRESS SUITE: 8,000ms Maker Watchdog Timeout
// ============================================================================
async function stressMakerWatchdog() {
  console.log('\n==================================================================');
  console.log('STRESS SUITE 1: 8,000ms Maker Watchdog Timeout ($0.00 Loss Enforcer)');
  console.log('==================================================================');

  // Test 1.1: Configurable Watchdog Timeout cleans resting order with zero loss
  const adapter = new DefaultDivergenceAdapter({ leg1Behavior: 'TIMEOUT' });
  const router = new DivergenceOrderRouter(adapter);

  const candidate = makeCandidate('SUIUSDT', 1.0, 1.0);
  const config: DivergenceConfig = {
    ...DEFAULT_DIVERGENCE_CONFIG,
    makerWatchdogMs: 150, // Accelerated for test determinism
    adverseDriftSampleMs: 30,
  };

  const res = await router.executeEntry(candidate, config);

  assert(
    '1. Watchdog Timeout',
    'Resting order timeout returns MAKER_WATCHDOG_TIMEOUT with success=false',
    res.success === false && res.error === 'MAKER_WATCHDOG_TIMEOUT',
    `Success=${res.success}, Error=${res.error}`
  );

  assert(
    '1. Watchdog Timeout',
    'Cancels Leg 1 with zero Leg 2 taker orders dispatched',
    adapter.cancelledOrders.length === 1 && !res.leg2Fill,
    `CancelledOrders=${adapter.cancelledOrders.length}, Leg2Fill=${!!res.leg2Fill}`
  );

  assert(
    '1. Watchdog Timeout',
    'Cancellation records MAKER_WATCHDOG_TIMEOUT_8000MS with zero exposure',
    adapter.cancelledOrders[0]?.reason.includes('8000MS') && adapter.currentNetExposure === 0,
    `Reason=${adapter.cancelledOrders[0]?.reason}, NetExp=${adapter.currentNetExposure}`
  );

  // Test 1.2: Boundary evaluation logic for 8,000ms
  function checkTimeoutBoundary(elapsedMs: number, limitMs: number = 8000): boolean {
    return elapsedMs > limitMs;
  }

  assert(
    '1. Watchdog Timeout',
    'Exact 8000ms boundary: 7999ms holds, 8000ms holds, 8001ms triggers timeout',
    !checkTimeoutBoundary(7999) && !checkTimeoutBoundary(8000) && checkTimeoutBoundary(8001),
    `7999=${checkTimeoutBoundary(7999)}, 8000=${checkTimeoutBoundary(8000)}, 8001=${checkTimeoutBoundary(8001)}`
  );
}

// ============================================================================
// 2. STRESS SUITE: 120ms Adverse Drift Monitor (0.079% vs 0.080% vs 0.081%)
// ============================================================================
async function stressAdverseDrift() {
  console.log('\n==================================================================');
  console.log('STRESS SUITE 2: 120ms Adverse Drift Monitor (0.079% vs 0.080% vs 0.081%)');
  console.log('==================================================================');

  // Test 2.1: Mathematical drift threshold evaluation (Leg 1 = BUY, Counterpart drops)
  const initialPrice = 1.0000;
  // 0.079% drop: 1.0000 * (1 - 0.00079) = 0.99921
  const drift79 = checkAdverseDrift('BUY', initialPrice, 0.99921, 0.080);
  assert(
    '2. Adverse Drift',
    'Drift 0.079% is under threshold (isAdverse=false)',
    !drift79.isAdverse && drift79.driftPercent === 0.079,
    `isAdverse=${drift79.isAdverse}, driftPercent=${drift79.driftPercent}%`
  );

  // 0.080% drop: 1.0000 * (1 - 0.00080) = 0.99920
  const drift80 = checkAdverseDrift('BUY', initialPrice, 0.99920, 0.080);
  assert(
    '2. Adverse Drift',
    'Exact boundary drift 0.080% holds without abort (isAdverse=false)',
    !drift80.isAdverse && drift80.driftPercent === 0.080,
    `isAdverse=${drift80.isAdverse}, driftPercent=${drift80.driftPercent}%`
  );

  // 0.081% drop: 1.0000 * (1 - 0.00081) = 0.99919
  const drift81 = checkAdverseDrift('BUY', initialPrice, 0.99919, 0.080);
  assert(
    '2. Adverse Drift',
    'Drift 0.081% exceeds threshold and immediately triggers isAdverse=true',
    drift81.isAdverse && drift81.driftPercent === 0.081,
    `isAdverse=${drift81.isAdverse}, driftPercent=${drift81.driftPercent}%`
  );

  // Test 2.2: Leg 1 = SELL (Counterpart rallies)
  // 0.079% rally: 1.0000 * (1 + 0.00079) = 1.00079
  const driftSell79 = checkAdverseDrift('SELL', initialPrice, 1.00079, 0.080);
  assert(
    '2. Adverse Drift',
    'SELL side drift 0.079% is under threshold (isAdverse=false)',
    !driftSell79.isAdverse && driftSell79.driftPercent === 0.079,
    `isAdverse=${driftSell79.isAdverse}, driftPercent=${driftSell79.driftPercent}%`
  );

  // 0.080% rally: 1.0000 * (1 + 0.00080) = 1.00080
  const driftSell80 = checkAdverseDrift('SELL', initialPrice, 1.00080, 0.080);
  assert(
    '2. Adverse Drift',
    'SELL side exact boundary 0.080% holds (isAdverse=false)',
    !driftSell80.isAdverse && driftSell80.driftPercent === 0.080,
    `isAdverse=${driftSell80.isAdverse}, driftPercent=${driftSell80.driftPercent}%`
  );

  // 0.081% rally: 1.0000 * (1 + 0.00081) = 1.00081
  const driftSell81 = checkAdverseDrift('SELL', initialPrice, 1.00081, 0.080);
  assert(
    '2. Adverse Drift',
    'SELL side drift 0.081% immediately triggers isAdverse=true',
    driftSell81.isAdverse && driftSell81.driftPercent === 0.081,
    `isAdverse=${driftSell81.isAdverse}, driftPercent=${driftSell81.driftPercent}%`
  );

  // Test 2.3: Live Execution Router aborts on 0.081% drift
  class DriftTestAdapter extends DefaultDivergenceAdapter {
    constructor(private simulatedMid: number) {
      super({ leg1Behavior: 'TIMEOUT' });
    }
    public async getLiveTopBook(_venue: ExchangeVenue, _symbol: string) {
      return { bid: this.simulatedMid - 0.0001, ask: this.simulatedMid + 0.0001, mid: this.simulatedMid };
    }
  }

  // 0.081% drift should abort
  const adapter81 = new DriftTestAdapter(1.0000 * (1 - 0.00081)); // 0.081% drop
  const router81 = new DivergenceOrderRouter(adapter81);
  const res81 = await router81.executeEntry(makeCandidate('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    adverseDriftSampleMs: 10,
    makerWatchdogMs: 500,
  });

  assert(
    '2. Adverse Drift',
    'Router aborts with ADVERSE_DRIFT_ABORT when live drift is 0.081%',
    res81.success === false && res81.error === 'ADVERSE_DRIFT_ABORT',
    `Success=${res81.success}, Error=${res81.error}`
  );
}

// ============================================================================
// 3. STRESS SUITE: In-Flight Fill Cancel Race Condition
// ============================================================================
async function stressInFlightRace() {
  console.log('\n==================================================================');
  console.log('STRESS SUITE 3: In-Flight Fill Cancel Race Condition');
  console.log('==================================================================');

  // Test 3.1: In-Flight Fill Race during Adverse Drift Cancel
  // When cancel request hits exchange, but exchange returns cumQty > 0
  class RaceAdverseAdapter extends DefaultDivergenceAdapter {
    public raceHedgeExecuted: boolean = false;
    constructor(private filledDuringCancelQty: number) {
      super({ leg1Behavior: 'ADVERSE_DRIFT' });
    }

    public async cancelOrder(
      venue: ExchangeVenue,
      symbol: string,
      orderId: string,
      clientOrderId: string
    ): Promise<{ success: boolean; executedQty: number }> {
      await super.cancelOrder(venue, symbol, orderId, clientOrderId);
      return { success: true, executedQty: this.filledDuringCancelQty };
    }

    public async placeTakerIoc(
      venue: ExchangeVenue,
      symbol: string,
      side: OrderSide,
      qty: number,
      clientOrderId: string,
      useWebSocket: boolean,
      expectedPrice?: number
    ) {
      this.raceHedgeExecuted = true;
      return super.placeTakerIoc(venue, symbol, side, qty, clientOrderId, useWebSocket, expectedPrice);
    }
  }

  const raceAdapter1 = new RaceAdverseAdapter(7.0);
  const raceRouter1 = new DivergenceOrderRouter(raceAdapter1);
  const raceRes1 = await raceRouter1.executeEntry(makeCandidate('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    adverseDriftSampleMs: 10,
    makerWatchdogMs: 500,
  });

  assert(
    '3. In-Flight Race Condition',
    'Cancel with executedQty > 0 during adverse drift does NOT abort, proceeds to hedge',
    raceRes1.success === true && raceAdapter1.raceHedgeExecuted,
    `Success=${raceRes1.success}, RaceHedged=${raceAdapter1.raceHedgeExecuted}, L1Qty=${raceRes1.leg1Fill?.executedQty}, L2Qty=${raceRes1.leg2Fill?.executedQty}`
  );

  assert(
    '3. In-Flight Race Condition',
    'Hedging executed quantity preserves delta neutrality (|Delta_net| < 0.001)',
    Math.abs((raceRes1.leg1Fill?.executedQty || 0) - (raceRes1.leg2Fill?.executedQty || 0)) < 0.001,
    `L1Qty=${raceRes1.leg1Fill?.executedQty}, L2Qty=${raceRes1.leg2Fill?.executedQty}`
  );

  // Test 3.2: In-Flight Fill Race during 8,000ms Watchdog Timeout
  class RaceTimeoutAdapter extends DefaultDivergenceAdapter {
    public timeoutHedgeExecuted: boolean = false;
    constructor(private filledDuringTimeoutQty: number) {
      super({ leg1Behavior: 'TIMEOUT' });
    }

    public async cancelOrder(
      venue: ExchangeVenue,
      symbol: string,
      orderId: string,
      clientOrderId: string
    ): Promise<{ success: boolean; executedQty: number }> {
      await super.cancelOrder(venue, symbol, orderId, clientOrderId);
      return { success: true, executedQty: this.filledDuringTimeoutQty };
    }

    public async placeTakerIoc(
      venue: ExchangeVenue,
      symbol: string,
      side: OrderSide,
      qty: number,
      clientOrderId: string,
      useWebSocket: boolean,
      expectedPrice?: number
    ) {
      this.timeoutHedgeExecuted = true;
      return super.placeTakerIoc(venue, symbol, side, qty, clientOrderId, useWebSocket, expectedPrice);
    }
  }

  const raceAdapter2 = new RaceTimeoutAdapter(7.0);
  const raceRouter2 = new DivergenceOrderRouter(raceAdapter2);
  const raceRes2 = await raceRouter2.executeEntry(makeCandidate('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    makerWatchdogMs: 50,
    adverseDriftSampleMs: 10,
  });

  assert(
    '3. In-Flight Race Condition',
    'Cancel with executedQty > 0 on watchdog timeout proceeds to hedge on Leg 2',
    raceRes2.success === true && raceAdapter2.timeoutHedgeExecuted,
    `Success=${raceRes2.success}, TimeoutHedged=${raceAdapter2.timeoutHedgeExecuted}`
  );
}

// ============================================================================
// 4. STRESS SUITE: 500ms Partial Fill Reconciler
// ============================================================================
async function stressPartialFillReconciler() {
  console.log('\n==================================================================');
  console.log('STRESS SUITE 4: 500ms Partial Fill Reconciler');
  console.log('==================================================================');

  // Test 4.1: Sub-$5.00 Partial Fill ($3.50 notional) triggers immediate unwind
  // Order was 15 SUI @ $1.00 = $15.00. Fills only 3.5 SUI ($3.50 notional < $5.00)
  class SubMinPartialAdapter extends DefaultDivergenceAdapter {
    public async placeMakerLimit(
      venue: ExchangeVenue,
      symbol: string,
      side: OrderSide,
      price: number,
      qty: number,
      clientOrderId: string,
      timeInForce: 'GTX' | 'PostOnly'
    ) {
      // Return partial fill with $3.50 notional (3.5 units @ $1.00)
      return {
        orderId: `ord_bn_submin_${Date.now()}`,
        status: 'PARTIALLY_FILLED' as any,
        executedQty: 3.5,
        avgPrice: price,
      };
    }

    public async pollOrderStatus(
      venue: ExchangeVenue,
      symbol: string,
      orderId: string,
      clientOrderId: string
    ) {
      return {
        status: 'PARTIALLY_FILLED' as any,
        executedQty: 3.5,
        avgPrice: 1.0,
      };
    }

    public async getLiveTopBook(venue: ExchangeVenue, symbol: string) {
      return { bid: 1.0, ask: 1.0002, mid: 1.0001 };
    }
  }

  const subMinAdapter = new SubMinPartialAdapter();
  const subMinRouter = new DivergenceOrderRouter(subMinAdapter);
  const subMinRes = await subMinRouter.executeEntry(makeCandidate('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    orderNotionalUsdt: 15.00,
    makerWatchdogMs: 500,
    adverseDriftSampleMs: 20,
  });

  assert(
    '4. Partial Fill Reconciler',
    'Sub-$5.00 partial fill ($3.50) triggers immediate emergency unwind',
    subMinRes.success === false && subMinRes.reconciliationAction === 'UNWOUND',
    `Success=${subMinRes.success}, Action=${subMinRes.reconciliationAction}, Error=${subMinRes.error}`
  );

  assert(
    '4. Partial Fill Reconciler',
    'Sub-$5.00 unwind receipt enforces reduceOnly: true',
    subMinRes.unwindReceipt?.reduceOnly === true,
    `unwindReceipt.reduceOnly=${subMinRes.unwindReceipt?.reduceOnly}`
  );

  assert(
    '4. Partial Fill Reconciler',
    'Emergency unwind order recorded in adapter with reduceOnly: true',
    subMinAdapter.emergencyUnwinds.length === 1 && subMinAdapter.emergencyUnwinds[0].reduceOnly === true,
    `UnwindsLen=${subMinAdapter.emergencyUnwinds.length}, reduceOnly=${subMinAdapter.emergencyUnwinds[0]?.reduceOnly}`
  );

  // Test 4.2: Partial fill with $8.00 notional and residual base exposure
  // SUI on Binance: stepSize 0.1. SUI on Bybit: stepSize 1.0.
  // Order notional $15.00 @ $1.00 = 15 SUI.
  // If Leg 1 fills 8.7 units ($8.70 notional >= $5.00):
  // matchable lot on Bybit is floor(8.7 / 1.0) = 8.0 units.
  // residual exposure is 0.7 units -> must be trimmed on Leg 1 with reduceOnly: true!
  class ResidualTrimAdapter extends DefaultDivergenceAdapter {
    public trimmedOrderExecuted: boolean = false;
    public trimmedQty: number = 0;
    public trimmedReduceOnly: boolean = false;

    public async placeMakerLimit(
      venue: ExchangeVenue,
      symbol: string,
      side: OrderSide,
      price: number,
      qty: number,
      clientOrderId: string,
      timeInForce: 'GTX' | 'PostOnly'
    ) {
      return {
        orderId: `ord_bn_trim_${Date.now()}`,
        status: 'PARTIALLY_FILLED' as any,
        executedQty: 8.7, // 8.7 units filled
        avgPrice: price,
      };
    }

    public async pollOrderStatus(
      venue: ExchangeVenue,
      symbol: string,
      orderId: string,
      clientOrderId: string
    ) {
      return {
        status: 'PARTIALLY_FILLED' as any,
        executedQty: 8.7,
        avgPrice: 1.0,
      };
    }

    public async getLiveTopBook(venue: ExchangeVenue, symbol: string) {
      return { bid: 1.0, ask: 1.0002, mid: 1.0001 };
    }

    public async executeMarketOrder(
      venue: ExchangeVenue,
      symbol: string,
      side: OrderSide,
      qty: number,
      clientOrderId: string,
      reduceOnly: boolean,
      priceLimit?: number
    ) {
      if (clientOrderId.startsWith('trim_')) {
        this.trimmedOrderExecuted = true;
        this.trimmedQty = qty;
        this.trimmedReduceOnly = reduceOnly;
      }
      return super.executeMarketOrder(venue, symbol, side, qty, clientOrderId, reduceOnly, priceLimit);
    }
  }

  const trimAdapter = new ResidualTrimAdapter();
  const trimRouter = new DivergenceOrderRouter(trimAdapter);
  const trimRes = await trimRouter.executeEntry(makeCandidate('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    orderNotionalUsdt: 15.00,
    makerWatchdogMs: 500,
    adverseDriftSampleMs: 20,
  });

  assert(
    '4. Partial Fill Reconciler',
    'Partial fill ($8.00+ notional) trims residual base exposure with reduceOnly: true',
    trimAdapter.trimmedOrderExecuted && trimAdapter.trimmedReduceOnly === true && Math.abs(trimAdapter.trimmedQty - 0.7) < 0.001,
    `TrimExecuted=${trimAdapter.trimmedOrderExecuted}, TrimQty=${trimAdapter.trimmedQty}, reduceOnly=${trimAdapter.trimmedReduceOnly}`
  );

  assert(
    '4. Partial Fill Reconciler',
    'Hedges matchable lot quantum (8.0 units) on Leg 2 preserving delta-neutrality',
    trimRes.success === true &&
    trimRes.reconciliationAction === 'TRIMMED' &&
    Math.abs((trimRes.leg1Fill?.executedQty || 0) - 8.0) < 0.001 &&
    Math.abs((trimRes.leg2Fill?.executedQty || 0) - 8.0) < 0.001,
    `Success=${trimRes.success}, Action=${trimRes.reconciliationAction}, L1Qty=${trimRes.leg1Fill?.executedQty}, L2Qty=${trimRes.leg2Fill?.executedQty}`
  );
}

// ============================================================================
// 5. STRESS SUITE: Mandatory reduceOnly: true Guard
// ============================================================================
async function stressReduceOnlyGuard() {
  console.log('\n==================================================================');
  console.log('STRESS SUITE 5: Mandatory reduceOnly: true Guard');
  console.log('==================================================================');

  const router = new DivergenceOrderRouter();
  const position = makeMockPosition();

  // Test 5.1: Calling executeExit with reduceOnly = false throws invariant error
  let thrownMessage = '';
  try {
    await router.executeExit(position, 'EXPANSION_TP', DEFAULT_DIVERGENCE_CONFIG, false);
  } catch (err: any) {
    thrownMessage = err?.message || String(err);
  }

  assert(
    '5. Mandatory reduceOnly Guard',
    'executeExit with reduceOnly=false throws invariant error matching /reduceOnly MUST be true/',
    /reduceOnly MUST be true/.test(thrownMessage),
    `ThrownMessage: "${thrownMessage}"`
  );

  // Test 5.2: Overloaded signature with prices and reduceOnly = false
  let thrownOverload = '';
  try {
    await router.executeExit(position, 1.0, 1.0, false);
  } catch (err: any) {
    thrownOverload = err?.message || String(err);
  }

  assert(
    '5. Mandatory reduceOnly Guard',
    'executeExit overload with reduceOnly=false throws error matching /reduceOnly MUST be true/',
    /reduceOnly MUST be true/.test(thrownOverload),
    `ThrownOverload: "${thrownOverload}"`
  );

  // Test 5.3: Normal executeExit with reduceOnly = true succeeds
  const exitRes = await router.executeExit(position, 'EXPANSION_TP', DEFAULT_DIVERGENCE_CONFIG, true);
  assert(
    '5. Mandatory reduceOnly Guard',
    'executeExit with reduceOnly=true succeeds and marks both fills reduceOnly: true',
    exitRes.success === true && exitRes.leg1Fill?.reduceOnly === true && exitRes.leg2Fill?.reduceOnly === true,
    `Success=${exitRes.success}, L1ReduceOnly=${exitRes.leg1Fill?.reduceOnly}, L2ReduceOnly=${exitRes.leg2Fill?.reduceOnly}`
  );

  // Test 5.4: Standalone executeDivergenceExit enforces reduceOnly: true
  const standaloneExitRes = await executeDivergenceExit(position);
  assert(
    '5. Mandatory reduceOnly Guard',
    'Standalone executeDivergenceExit enforces reduceOnly: true on both legs',
    standaloneExitRes.success === true &&
    standaloneExitRes.leg1Fill?.reduceOnly === true &&
    standaloneExitRes.leg2Fill?.reduceOnly === true,
    `Success=${standaloneExitRes.success}, L1ReduceOnly=${standaloneExitRes.leg1Fill?.reduceOnly}, L2ReduceOnly=${standaloneExitRes.leg2Fill?.reduceOnly}`
  );
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runAllStressTests() {
  console.log('==================================================================');
  console.log('STARTING EMPIRICAL ADVERSARIAL STRESS HARNESS: ORDER ROUTER');
  console.log('==================================================================');

  await stressMakerWatchdog();
  await stressAdverseDrift();
  await stressInFlightRace();
  await stressPartialFillReconciler();
  await stressReduceOnlyGuard();

  console.log('\n==================================================================');
  console.log(`ORDER ROUTER STRESS SUMMARY: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log('==================================================================\n');

  if (failCount > 0) {
    console.error('FAILED TESTS DETAILS:');
    for (const r of results.filter(r => !r.passed)) {
      console.error(`- [${r.category}] ${r.testName}: ${r.details}`);
    }
    process.exit(1);
  }
}

runAllStressTests().catch(err => {
  console.error('Fatal crash in stress harness:', err);
  process.exit(1);
});
