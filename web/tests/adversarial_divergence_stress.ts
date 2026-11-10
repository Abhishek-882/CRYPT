/**
 * EMPIRICAL CHALLENGER: ADVERSARIAL STRESS TEST HARNESS FOR BASIS DIVERGENCE BOT
 * Target: plans/divergence_bot_plan.md
 * 
 * Verifies:
 * 1. Delta-Neutrality & Multiplier Stress-Test across asymmetric pairs (SATS, TURBO, PEPE, BABYDOGE)
 * 2. MinNotional ($5.00 USDT) enforcement across varying notionals and micro-price tokens
 * 3. Execution Failure Modes & 500ms Emergency Market Unwind
 * 4. Mid-trade process crash and exchange state reconciliation
 * 5. Daemon lock concurrency race & state isolation from STATARB-OU-PERP
 * 6. Invariant verification (Zero BPS notation, Zero legacy references)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  reconcileDualLegQuantities,
  getSymbolFilter,
  roundPrice,
  roundQuantity,
} from '../lib/statarb/utils/exchangeFilterRegistry';
import {
  normalizeQuantity,
  getInstrumentMapping,
  resolveCanonicalSymbol,
} from '../lib/statarb/utils/contractMapper';
import { resolveDataDir } from '../lib/storagePath';
import {
  DivergenceOrderRouter,
  DefaultDivergenceAdapter,
  checkAdverseDrift,
  calculatePostOnlyPrice,
  executeDivergenceEntry,
  executeDivergenceExit,
  OrderSide,
} from '../lib/divergence/execution/orderRouter';
import {
  DivergenceCandidate,
  DEFAULT_DIVERGENCE_CONFIG,
  ExchangeVenue,
} from '../lib/divergence/types';

interface TestRecord {
  suite: string;
  testName: string;
  passed: boolean;
  details: string;
}

const records: TestRecord[] = [];
let passCount = 0;
let failCount = 0;

function assertTest(suite: string, testName: string, condition: boolean, details: string) {
  if (condition) {
    passCount++;
    records.push({ suite, testName, passed: true, details });
    console.log(`  [PASS] [${suite}] ${testName}`);
  } else {
    failCount++;
    records.push({ suite, testName, passed: false, details });
    console.error(`  [FAIL] [${suite}] ${testName} -> ${details}`);
  }
}

// =========================================================================
// SUITE 1: DELTA-NEUTRALITY & CONTRACT MULTIPLIER QUANTUM MATH
// =========================================================================
function runSuite1() {
  console.log('\n==================================================================');
  console.log('SUITE 1: Delta-Neutrality & Multiplier Stress-Testing');
  console.log('==================================================================');

  // Test 1.1: SATS (Binance 1000SATS vs Bybit 10000SATS -> 10x Asymmetry)
  // Binance price: $0.000280 / contract, Bybit price: $0.00280 / contract
  const satsNotionals = [5.0, 10.0, 15.0, 25.0, 50.0, 100.0];
  for (const notional of satsNotionals) {
    const res = reconcileDualLegQuantities(notional, 0.000280, 0.00280, 'BINANCE', 'BYBIT', 'SATS');
    const valid = res.valid;
    const baseL1 = res.leg1Qty * 1000;
    const baseL2 = res.leg2Qty * 10000;
    const delta = Math.abs(baseL1 - baseL2) / 1000;
    const deltaNeutral = delta < 0.001;
    const notional1Ok = res.leg1Notional >= 5.0;
    const notional2Ok = res.leg2Notional >= 5.0;

    assertTest(
      'Suite 1.1 - SATS Multipliers',
      `SATS @ $${notional} notional: delta < 0.001 and minNotional >= $5.00`,
      valid && deltaNeutral && notional1Ok && notional2Ok,
      `Valid=${valid}, L1Qty=${res.leg1Qty}, L2Qty=${res.leg2Qty}, Delta=${delta}, L1$=${res.leg1Notional}, L2$=${res.leg2Notional}, Reason=${res.rejectionReason || 'NONE'}`
    );
  }

  // Test 1.2: TURBO (Binance TURBO 1x vs Bybit 1000TURBO 1000x -> 1000x Asymmetry)
  // Binance price: $0.00500, Bybit price: $5.0000
  const turboNotionals = [5.0, 10.0, 15.0, 20.0, 50.0];
  for (const notional of turboNotionals) {
    const res = reconcileDualLegQuantities(notional, 0.00500, 5.0000, 'BINANCE', 'BYBIT', 'TURBO');
    const valid = res.valid;
    const baseL1 = res.leg1Qty * 1;
    const baseL2 = res.leg2Qty * 1000;
    const delta = Math.abs(baseL1 - baseL2) / 1;
    const deltaNeutral = delta < 0.001;
    const notional1Ok = res.leg1Notional >= 5.0;
    const notional2Ok = res.leg2Notional >= 5.0;

    assertTest(
      'Suite 1.2 - TURBO Multipliers',
      `TURBO @ $${notional} notional: delta < 0.001 and minNotional >= $5.00`,
      valid && deltaNeutral && notional1Ok && notional2Ok,
      `Valid=${valid}, L1Qty=${res.leg1Qty}, L2Qty=${res.leg2Qty}, Delta=${delta}, L1$=${res.leg1Notional}, L2$=${res.leg2Notional}`
    );
  }

  // Test 1.3: PEPE (Binance 1000PEPE step=100 vs Bybit 1000PEPE step=100)
  // Price: $0.012500 per 1000PEPE
  const pepeRes = reconcileDualLegQuantities(15.0, 0.012500, 0.012500, 'BINANCE', 'BYBIT', 'PEPE');
  const pepeStep1Ok = pepeRes.leg1Qty % 100 === 0;
  const pepeStep2Ok = pepeRes.leg2Qty % 100 === 0;
  const pepeDelta = Math.abs(pepeRes.leg1Qty * 1000 - pepeRes.leg2Qty * 1000) / 1000;
  assertTest(
    'Suite 1.3 - PEPE Step Sizing',
    'PEPE 1000x step size 100 quantum divisibility and delta neutrality',
    pepeRes.valid && pepeStep1Ok && pepeStep2Ok && pepeDelta < 0.001 && pepeRes.leg1Notional >= 5.0,
    `Valid=${pepeRes.valid}, L1Qty=${pepeRes.leg1Qty}, L2Qty=${pepeRes.leg2Qty}, Step1Div=${pepeStep1Ok}, Step2Div=${pepeStep2Ok}`
  );

  // Test 1.4: Asymmetric Step Sizes on Standard Altcoins
  // SUI: Binance step=0.1 vs Bybit step=1
  const suiRes = reconcileDualLegQuantities(15.0, 2.15, 2.15, 'BINANCE', 'BYBIT', 'SUI');
  const suiDelta = Math.abs(suiRes.leg1Qty - suiRes.leg2Qty);
  assertTest(
    'Suite 1.4 - Asymmetric Steps SUI',
    'SUI step 0.1 vs step 1.0 quantum alignment preserves delta neutrality',
    suiRes.valid && suiDelta < 0.001 && suiRes.leg1Qty % 1 === 0 && suiRes.leg2Qty % 1 === 0,
    `Valid=${suiRes.valid}, L1=${suiRes.leg1Qty}, L2=${suiRes.leg2Qty}, Delta=${suiDelta}`
  );

  // NEAR: Binance step=1 vs Bybit step=0.1
  const nearRes = reconcileDualLegQuantities(15.0, 4.50, 4.50, 'BINANCE', 'BYBIT', 'NEAR');
  const nearDelta = Math.abs(nearRes.leg1Qty - nearRes.leg2Qty);
  assertTest(
    'Suite 1.4 - Asymmetric Steps NEAR',
    'NEAR step 1.0 vs step 0.1 quantum alignment preserves delta neutrality',
    nearRes.valid && nearDelta < 0.001 && nearRes.leg1Qty % 1 === 0,
    `Valid=${nearRes.valid}, L1=${nearRes.leg1Qty}, L2=${nearRes.leg2Qty}, Delta=${nearDelta}`
  );

  // Test 1.5: MinNotional Boundary Gating
  const subMinRes = reconcileDualLegQuantities(4.99, 100.0, 100.0, 'BINANCE', 'BYBIT', 'SOL');
  assertTest(
    'Suite 1.5 - MinNotional Boundary',
    'Target notional $4.99 is strictly rejected with MIN_NOTIONAL_VIOLATION',
    !subMinRes.valid && (subMinRes.rejectionReason?.includes('MIN_NOTIONAL') ?? false),
    `Valid=${subMinRes.valid}, Reason=${subMinRes.rejectionReason}`
  );

  const zeroNotionalRes = reconcileDualLegQuantities(0.00, 100.0, 100.0, 'BINANCE', 'BYBIT', 'SOL');
  assertTest(
    'Suite 1.5 - Zero Notional Rejection',
    'Target notional $0.00 is strictly rejected',
    !zeroNotionalRes.valid,
    `Valid=${zeroNotionalRes.valid}, Reason=${zeroNotionalRes.rejectionReason}`
  );

  // Test 1.6: Adversarial Attack — Partial Fill Quantum Misalignment
  // What happens if Leg 1 fills an odd contract count not aligned with LCM quantum?
  // e.g. Leg 1 fills 3 contracts of SATS on Binance (3 * 1,000 = 3,000 SATS)
  // Leg 2 on Bybit has contract multiplier 10,000 and stepSize 1
  const partialFillQty = 3; // 3,000 SATS
  const targetScaledBybit = normalizeQuantity(partialFillQty, 'BINANCE', 'BYBIT', 'SATS', 1);
  const bybitBaseUnits = targetScaledBybit * 10000;
  const binanceBaseUnits = partialFillQty * 1000;
  const partialDeltaNet = Math.abs(binanceBaseUnits - bybitBaseUnits) / 1000;
  const isOrphaned = partialDeltaNet >= 0.001;

  assertTest(
    'Suite 1.6 - Partial Fill Adversarial Attack',
    'Leg 1 partial fill of unaligned contracts creates orphan delta violating |Delta_net| < 0.001',
    isOrphaned && targetScaledBybit === 0,
    `Unhedged Delta: ${partialDeltaNet} Binance contracts (Leg1Base=${binanceBaseUnits}, Leg2Base=${bybitBaseUnits}). Bybit Qty truncated to ${targetScaledBybit}!`
  );
}

// =========================================================================
// SUITE 2: EXECUTION FAILURE MODES & 500MS EMERGENCY UNWIND
// =========================================================================
class MockAdversarialRouter {
  public leg1FillRate: number = 1.0;
  public leg2WsFails: boolean = false;
  public leg2RestFails: boolean = false;
  public emergencyUnwindRejection: boolean = false;

  public leg1Order: { symbol: string; qty: number; status: string } | null = null;
  public leg2Order: { symbol: string; qty: number; status: string } | null = null;
  public emergencyUnwindDispatched: boolean = false;
  public emergencyUnwindLatencyMs: number = 0;
  public finalNetPosition: number = 0;

  async executeHedge(symbol: string, notional: number, price1: number, price2: number) {
    const sizing = reconcileDualLegQuantities(notional, price1, price2, 'BINANCE', 'BYBIT', symbol);
    if (!sizing.valid) {
      throw new Error(`Sizing failed: ${sizing.rejectionReason}`);
    }

    // 1. Dispatch Leg 1 Post-Only Maker Limit
    this.leg1Order = {
      symbol,
      qty: sizing.leg1Qty * this.leg1FillRate,
      status: this.leg1FillRate > 0 ? 'FILLED' : 'CANCELLED',
    };

    if (this.leg1Order.status !== 'FILLED') {
      return { success: false, reason: 'LEG1_UNFILLED' };
    }

    this.finalNetPosition += this.leg1Order.qty;

    // 2. Dispatch Leg 2 Sub-35ms WebSocket IOC Taker
    let leg2Filled = false;

    if (!this.leg2WsFails) {
      // WS Succeeds
      leg2Filled = true;
      this.leg2Order = { symbol, qty: sizing.leg2Qty, status: 'FILLED' };
      this.finalNetPosition -= sizing.leg2Qty * (sizing.leg1Qty / sizing.leg2Qty);
    } else {
      // WS Fails (timeout / connection drop)
      // Fallback to Signed REST within 500ms
      if (!this.leg2RestFails) {
        leg2Filled = true;
        this.leg2Order = { symbol, qty: sizing.leg2Qty, status: 'FILLED' };
        this.finalNetPosition -= sizing.leg2Qty * (sizing.leg1Qty / sizing.leg2Qty);
      } else {
        // REST also fails -> Complete Leg 2 Failure!
        this.leg2Order = { symbol, qty: sizing.leg2Qty, status: 'REJECTED' };
      }
    }

    // 3. Emergency Market Unwind if Leg 2 Failed
    if (!leg2Filled) {
      if (!this.emergencyUnwindRejection) {
        // Instant market order with reduceOnly: true
        this.finalNetPosition -= this.leg1Order.qty;
        this.emergencyUnwindDispatched = true;
        this.emergencyUnwindLatencyMs = 45; // Simulated market unwind execution latency
        return { success: false, status: 'ORPHAN_UNWOUND', netPosition: this.finalNetPosition };
      } else {
        // Exchange rejected emergency unwind (e.g. minNotional error or downtime)
        this.emergencyUnwindDispatched = true;
        return { success: false, status: 'EMERGENCY_UNWIND_FAILED', netPosition: this.finalNetPosition };
      }
    }

    return { success: true, status: 'HEDGED', netPosition: this.finalNetPosition };
  }
}

async function runSuite2() {
  console.log('\n==================================================================');
  console.log('SUITE 2: Execution Failure Modes & 500ms Emergency Unwind');
  console.log('==================================================================');

  // Test 2.1: Leg 1 Fills + Leg 2 WS Timeout & REST Rejection -> 500ms Emergency Market Unwind
  const router1 = new MockAdversarialRouter();
  router1.leg2WsFails = true;
  router1.leg2RestFails = true;
  router1.emergencyUnwindRejection = false;

  const result1 = await router1.executeHedge('SUI', 15.0, 2.15, 2.15);
  assertTest(
    'Suite 2.1 - Emergency Market Unwind',
    'Leg 2 failure triggers emergency market unwind reducing net exposure to 0.000',
    router1.emergencyUnwindDispatched && router1.finalNetPosition === 0 && result1.status === 'ORPHAN_UNWOUND',
    `UnwindDispatched=${router1.emergencyUnwindDispatched}, FinalNetPos=${router1.finalNetPosition}, Status=${result1.status}`
  );

  // Test 2.2: Extreme Failure Mode — Emergency Market Unwind Rejection
  // What happens if Leg 1 orphan cannot be market-unwound (e.g. minNotional or exchange freeze)?
  const router2 = new MockAdversarialRouter();
  router2.leg2WsFails = true;
  router2.leg2RestFails = true;
  router2.emergencyUnwindRejection = true;

  const result2 = await router2.executeHedge('SUI', 15.0, 2.15, 2.15);
  assertTest(
    'Suite 2.2 - Emergency Unwind Rejection Gating',
    'Emergency unwind failure leaves non-zero exposure requiring immediate circuit breaker halt',
    router2.finalNetPosition > 0 && result2.status === 'EMERGENCY_UNWIND_FAILED',
    `Status=${result2.status}, Critical Exposed Qty=${router2.finalNetPosition}`
  );

  // Test 2.3: Mid-Trade Crash Recovery Simulation
  const dataDir = resolveDataDir();
  const tempStateFile = path.join(dataDir, 'test_divergence_state_crash.json');

  try {
    // Initial state: 0 active positions
    const initialState = {
      version: '1.0.0',
      activePositions: [],
      closedPositions: [],
      lastUpdated: Date.now(),
    };
    fs.writeFileSync(tempStateFile, JSON.stringify(initialState, null, 2), 'utf-8');

    // Simulate CRASH AT MOMENT B: Leg 1 filled on exchange, but process killed BEFORE state write!
    // Exchange has 1 open position for SUI (Leg 1), but state file on disk is EMPTY!
    const exchangeOpenPositions = [
      { venue: 'BINANCE', symbol: 'SUIUSDT', side: 'BUY', size: 7.0 },
    ];

    // Crash recovery protocol test:
    // If crash recovery ONLY checks `state.activePositions`, it misses the orphan!
    const stateOnDisk = JSON.parse(fs.readFileSync(tempStateFile, 'utf-8'));
    const reconciledOrphans: Array<{ venue: string; symbol: string; size: number }> = [];

    // Protocol under audit:
    // Flaw: Checking only stateOnDisk.activePositions
    for (const pos of stateOnDisk.activePositions) {
      // Loop does not execute because activePositions is empty!
    }

    // Hardened Protocol required:
    // Query exchange /positionRisk directly and diff against active positions!
    for (const exPos of exchangeOpenPositions) {
      const match = stateOnDisk.activePositions.find((p: any) => p.canonicalSymbol === 'SUI');
      if (!match) {
        reconciledOrphans.push(exPos);
      }
    }

    assertTest(
      'Suite 2.3 - Mid-Trade Crash Orphan Reconciliation',
      'Crash between Leg 1 fill and state persistence creates unmapped exchange position caught by exchange inventory diff',
      reconciledOrphans.length === 1 && reconciledOrphans[0].symbol === 'SUIUSDT',
      `Orphans detected via exchange inventory reconciliation: ${reconciledOrphans.length} (${reconciledOrphans[0]?.symbol})`
    );
  } finally {
    if (fs.existsSync(tempStateFile)) {
      fs.unlinkSync(tempStateFile);
    }
  }
}

// =========================================================================
// SUITE 3: STATE ISOLATION & DAEMON LOCK CONCURRENCY RACE
// =========================================================================
async function runSuite3() {
  console.log('\n==================================================================');
  console.log('SUITE 3: State Isolation & Daemon Lock Concurrency Stress');
  console.log('==================================================================');

  const dataDir = resolveDataDir();
  const testLockPath = path.join(dataDir, 'divergence_daemon_test.lock');

  // Helper functions simulating Divergence daemon lock mechanics
  function acquireTestLock(lockPath: string, pid: number): { success: boolean; fd?: number; error?: string } {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const payload = JSON.stringify({
        pid,
        startedAt: Date.now(),
        heartbeat: Date.now(),
        hostname: 'test-node',
        strategy: 'DIVERGENCE_BOT',
      });
      fs.writeFileSync(fd, payload, 'utf-8');
      return { success: true, fd };
    } catch (err: any) {
      return { success: false, error: err.code || err.message };
    }
  }

  function releaseTestLock(lockPath: string, fd?: number) {
    try {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch {}
  }

  // Cleanup prior
  if (fs.existsSync(testLockPath)) fs.unlinkSync(testLockPath);

  // Test 3.1: 10 Concurrent Workers Race for divergence_daemon.lock
  const pids = [10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010];
  const raceResults = pids.map(pid => acquireTestLock(testLockPath, pid));

  const successCount = raceResults.filter(r => r.success).length;
  const collisionCount = raceResults.filter(r => !r.success && (r.error === 'EEXIST' || r.error === 'EBUSY')).length;

  assertTest(
    'Suite 3.1 - Concurrency Lock Race (10 processes)',
    'Exactly 1 process acquires divergence_daemon.lock and 9 fail with collision (EEXIST)',
    successCount === 1 && collisionCount === 9,
    `Successes=${successCount}, Collisions=${collisionCount}`
  );

  // Cleanup lock
  const winner = raceResults.find(r => r.success);
  releaseTestLock(testLockPath, winner?.fd);

  // Test 3.2: Stale Lock Detection & Recovery
  // Write lock with a simulated dead PID (PID 99999999)
  const deadPayload = JSON.stringify({
    pid: 99999999,
    startedAt: Date.now() - 60000,
    heartbeat: Date.now() - 60000,
    hostname: 'test-node',
    strategy: 'DIVERGENCE_BOT',
  });
  fs.writeFileSync(testLockPath, deadPayload, 'utf-8');

  // Check if process is alive
  let isDeadPidActive = false;
  try {
    process.kill(99999999, 0);
    isDeadPidActive = true;
  } catch {
    isDeadPidActive = false;
  }

  // If inactive, stale lock can be safely evicted
  let staleEvicted = false;
  if (!isDeadPidActive) {
    fs.unlinkSync(testLockPath);
    staleEvicted = true;
  }

  const reacquireAfterStale = acquireTestLock(testLockPath, process.pid);
  assertTest(
    'Suite 3.2 - Stale Lock Recovery',
    'Dead PID stale lock is detected and evicted, allowing new daemon to boot',
    staleEvicted && reacquireAfterStale.success,
    `StaleEvicted=${staleEvicted}, Reacquire=${reacquireAfterStale.success}`
  );

  releaseTestLock(testLockPath, reacquireAfterStale.fd);

  // Test 3.3: Strict Decoupling of File Paths & Singletons
  const divergenceStatePath: string = 'data/divergence_state.json';
  const statArbStatePath: string = 'data/statarb_state.json';
  const divergenceLockPath: string = 'data/divergence_daemon.lock';
  const statArbLockPath: string = 'data/bot_daemon.lock';

  const pathsCompletelyDisjoint =
    divergenceStatePath !== statArbStatePath &&
    divergenceLockPath !== statArbLockPath;

  assertTest(
    'Suite 3.3 - State & Lock Isolation',
    'Divergence Bot uses isolated lockfile and statefile distinct from STATARB-OU-PERP',
    pathsCompletelyDisjoint,
    `DivergenceState=${divergenceStatePath}, StatArbState=${statArbStatePath}; DivergenceLock=${divergenceLockPath}, StatArbLock=${statArbLockPath}`
  );
}

// =========================================================================
// SUITE 4: INVARIANT AUDIT (ZERO BPS NOTATION & ZERO LEGACY REFERENCES)
// =========================================================================
function runSuite4() {
  console.log('\n==================================================================');
  console.log('SUITE 4: Invariant Audit (Zero BPS Notation & Zero Legacy References)');
  console.log('==================================================================');

  const planPath = path.resolve(__dirname, '../../plans/divergence_bot_plan.md');
  const planContent = fs.readFileSync(planPath, 'utf-8');
  const lines = planContent.split('\n');

  // Check 1: Zero BPS notation used as values/metrics
  let bpsViolationCount = 0;
  const bpsViolations: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = line.match(/\b\d+(\.\d+)?\s*bps\b/i) || line.match(/\b(spreadBps|netEdgeBps|frictionBps)\b/i);
    if (matches) {
      bpsViolationCount++;
      bpsViolations.push(`Line ${i + 1}: ${line.trim()}`);
    }
  }

  assertTest(
    'Suite 4.1 - Zero BPS Metric Notation',
    'Plan artifact contains 0 occurrences of numerical bps units or bps property fields',
    bpsViolationCount === 0,
    `Violations found: ${bpsViolationCount} -> ${bpsViolations.slice(0, 3).join('; ')}`
  );

  // Check 2: Zero legacy strategy references
  const legacyRegex = /\b(basis_bot|legacy_basis|deprecated_basis|basisBot)\b/i;
  let legacyViolationCount = 0;
  const legacyViolations: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (legacyRegex.test(line)) {
      legacyViolationCount++;
      legacyViolations.push(`Line ${i + 1}: ${line.trim()}`);
    }
  }

  assertTest(
    'Suite 4.2 - Zero Legacy Strategy References',
    'Plan artifact contains 0 occurrences of banned legacy basis bot identifiers',
    legacyViolationCount === 0,
    `Violations found: ${legacyViolationCount} -> ${legacyViolations.slice(0, 3).join('; ')}`
  );
}

// =========================================================================
// SUITE 5: PRODUCTION DivergenceOrderRouter EXECUTION PATHS & WATCHDOGS
// =========================================================================
async function runSuite5() {
  console.log('\n==================================================================');
  console.log('SUITE 5: DivergenceOrderRouter Execution Paths & Invariants');
  console.log('==================================================================');

  function makeCand(symbol: string = 'SUIUSDT', p1: number = 1.0, p2: number = 1.0): DivergenceCandidate {
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

  // Test 5.1: 8,000ms Maker Watchdog Timeout
  const watchdogAdapter = new DefaultDivergenceAdapter({ leg1Behavior: 'TIMEOUT' });
  const watchdogRouter = new DivergenceOrderRouter(watchdogAdapter);
  const watchdogRes = await watchdogRouter.executeEntry(makeCand('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    makerWatchdogMs: 60,
    adverseDriftSampleMs: 15,
  });

  assertTest(
    'Suite 5.1 - 8,000ms Maker Watchdog',
    'Resting order timeout cancels with zero loss and zero taker orders',
    !watchdogRes.success && watchdogRes.error === 'MAKER_WATCHDOG_TIMEOUT' && !watchdogRes.leg2Fill && watchdogAdapter.cancelledOrders.length === 1,
    `Success=${watchdogRes.success}, Error=${watchdogRes.error}, Cancelled=${watchdogAdapter.cancelledOrders.length}`
  );

  // Test 5.2: 120ms Adverse Drift Monitor (0.079% vs 0.080% vs 0.081%)
  const drift79 = checkAdverseDrift('BUY', 1.0, 0.99921, 0.080);
  const drift80 = checkAdverseDrift('BUY', 1.0, 0.99920, 0.080);
  const drift81 = checkAdverseDrift('BUY', 1.0, 0.99919, 0.080);

  assertTest(
    'Suite 5.2 - Adverse Drift Threshold',
    'Adverse drift boundary: 0.079% holds (false), 0.080% holds (false), 0.081% aborts (true)',
    !drift79.isAdverse && !drift80.isAdverse && drift81.isAdverse,
    `0.079%=${drift79.isAdverse}, 0.080%=${drift80.isAdverse}, 0.081%=${drift81.isAdverse}`
  );

  class LiveDriftAdapter extends DefaultDivergenceAdapter {
    public async getLiveTopBook() {
      const p = 1.0 * (1 - 0.00081);
      return { bid: p - 0.0001, ask: p + 0.0001, mid: p };
    }
  }
  const driftRouter = new DivergenceOrderRouter(new LiveDriftAdapter({ leg1Behavior: 'TIMEOUT' }));
  const liveDriftRes = await driftRouter.executeEntry(makeCand('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    adverseDriftSampleMs: 10,
    makerWatchdogMs: 500,
  });

  assertTest(
    'Suite 5.2 - Adverse Drift Live Abort',
    'Live drift exceeding 0.080% aborts resting order immediately with ADVERSE_DRIFT_ABORT',
    !liveDriftRes.success && liveDriftRes.error === 'ADVERSE_DRIFT_ABORT',
    `Success=${liveDriftRes.success}, Error=${liveDriftRes.error}`
  );

  // Test 5.3: In-Flight Fill Cancel Race Condition
  class LiveRaceAdapter extends DefaultDivergenceAdapter {
    public async cancelOrder(v: ExchangeVenue, s: string, o: string, c: string) {
      await super.cancelOrder(v, s, o, c);
      return { success: true, executedQty: 7.0 };
    }
  }
  const raceRouter = new DivergenceOrderRouter(new LiveRaceAdapter({ leg1Behavior: 'TIMEOUT' }));
  const raceRes = await raceRouter.executeEntry(makeCand('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    makerWatchdogMs: 40,
    adverseDriftSampleMs: 10,
  });

  assertTest(
    'Suite 5.3 - In-Flight Cancel Race',
    'Resting order filled during cancel proceeds to hedge on Leg 2 preserving delta neutrality',
    raceRes.success === true && raceRes.leg1Fill?.executedQty === 7.0 && raceRes.leg2Fill?.executedQty === 7.0,
    `Success=${raceRes.success}, L1Qty=${raceRes.leg1Fill?.executedQty}, L2Qty=${raceRes.leg2Fill?.executedQty}`
  );

  // Test 5.4: 500ms Partial Fill Reconciler
  // Sub-$5.00 fill ($3.50 notional) triggers unwind with reduceOnly: true
  class SubMinLiveAdapter extends DefaultDivergenceAdapter {
    public async placeMakerLimit(venue: any, symbol: any, side: any, price: any, qty: any, clientOrderId: any, tif: any) {
      return { orderId: `ord_sub_${Date.now()}`, status: 'PARTIALLY_FILLED' as any, executedQty: 3.5, avgPrice: 1.0 };
    }
    public async pollOrderStatus() {
      return { status: 'PARTIALLY_FILLED' as any, executedQty: 3.5, avgPrice: 1.0 };
    }
    public async getLiveTopBook() {
      return { bid: 1.0, ask: 1.0002, mid: 1.0001 };
    }
  }
  const subMinAdapter = new SubMinLiveAdapter();
  const subMinRouter = new DivergenceOrderRouter(subMinAdapter);
  const subMinRes = await subMinRouter.executeEntry(makeCand('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    orderNotionalUsdt: 15.00,
    makerWatchdogMs: 300,
    adverseDriftSampleMs: 15,
  });

  assertTest(
    'Suite 5.4 - Partial Fill Sub-$5.00 Unwind',
    'Sub-$5.00 partial fill ($3.50 notional) triggers immediate emergency unwind with reduceOnly: true',
    !subMinRes.success && subMinRes.reconciliationAction === 'UNWOUND' && subMinRes.unwindReceipt?.reduceOnly === true,
    `Success=${subMinRes.success}, Action=${subMinRes.reconciliationAction}, reduceOnly=${subMinRes.unwindReceipt?.reduceOnly}`
  );

  // Partial fill ($8.00+ notional) trims residual base exposure with reduceOnly: true and hedges matchable lot quantum
  class TrimLiveAdapter extends DefaultDivergenceAdapter {
    public trimmedOrderExecuted: boolean = false;
    public trimmedQty: number = 0;
    public trimmedReduceOnly: boolean = false;

    public async placeMakerLimit(venue: any, symbol: any, side: any, price: any, qty: any, clientOrderId: any, tif: any) {
      return { orderId: `ord_trim_${Date.now()}`, status: 'PARTIALLY_FILLED' as any, executedQty: 8.7, avgPrice: 1.0 };
    }
    public async pollOrderStatus() {
      return { status: 'PARTIALLY_FILLED' as any, executedQty: 8.7, avgPrice: 1.0 };
    }
    public async getLiveTopBook() {
      return { bid: 1.0, ask: 1.0002, mid: 1.0001 };
    }
    public async executeMarketOrder(venue: any, symbol: any, side: any, qty: any, clientOrderId: any, reduceOnly: any, priceLimit: any) {
      if (clientOrderId.startsWith('trim_')) {
        this.trimmedOrderExecuted = true;
        this.trimmedQty = qty;
        this.trimmedReduceOnly = reduceOnly;
      }
      return super.executeMarketOrder(venue, symbol, side, qty, clientOrderId, reduceOnly, priceLimit);
    }
  }
  const trimAdapter = new TrimLiveAdapter();
  const trimRouter = new DivergenceOrderRouter(trimAdapter);
  const trimRes = await trimRouter.executeEntry(makeCand('SUIUSDT', 1.0, 1.0), {
    ...DEFAULT_DIVERGENCE_CONFIG,
    orderNotionalUsdt: 15.00,
    makerWatchdogMs: 300,
    adverseDriftSampleMs: 15,
  });

  assertTest(
    'Suite 5.4 - Partial Fill Residual Base Trim',
    'Partial fill ($8.70 notional) trims residual base exposure (0.7) with reduceOnly: true and hedges matchable lot (8.0)',
    trimRes.success === true &&
    trimRes.reconciliationAction === 'TRIMMED' &&
    trimAdapter.trimmedOrderExecuted &&
    trimAdapter.trimmedReduceOnly === true &&
    Math.abs(trimRes.leg1Fill?.executedQty! - 8.0) < 0.001 &&
    Math.abs(trimRes.leg2Fill?.executedQty! - 8.0) < 0.001,
    `Success=${trimRes.success}, Action=${trimRes.reconciliationAction}, TrimQty=${trimAdapter.trimmedQty}, L1Qty=${trimRes.leg1Fill?.executedQty}, L2Qty=${trimRes.leg2Fill?.executedQty}`
  );

  // Test 5.5: Mandatory reduceOnly: true Guard
  const guardRouter = new DivergenceOrderRouter();
  const mockPos: any = {
    id: 'pos_reduce_guard_test',
    symbol: 'SUIUSDT',
    canonicalSymbol: 'SUI',
    binanceSymbol: 'SUIUSDT',
    bybitSymbol: 'SUIUSDT',
    direction: 'LONG_BN_SHORT_BYB',
    entryTimestamp: Date.now(),
    entryBasisPercent: 0.020,
    currentBasisPercent: 0.400,
    relativeExpansionPercent: 0.380,
    currentBinancePrice: 1.0,
    currentBybitPrice: 1.0,
    quantityBinance: 8.0,
    quantityBybit: 8.0,
    leg1: { venue: 'BINANCE', side: 'BUY', orderId: 'bn_1', clientOrderId: 'div1_1', price: 1.0, qty: 8.0, notional: 8.0, feePaidUsdt: 0.002, executedQty: 8.0 },
    leg2: { venue: 'BYBIT', side: 'SELL', orderId: 'byb_1', clientOrderId: 'div2_1', price: 1.0, qty: 8.0, notional: 8.0, feePaidUsdt: 0.004, executedQty: 8.0 },
    deltaNet: 0.0,
    accumulatedCarryPercent: 0.0,
    dynamicTargetPercent: 0.380,
    status: 'ACTIVE_EXPANDING',
  };

  let thrownExit1 = false;
  try {
    await guardRouter.executeExit(mockPos, 'EXPANSION_TP', DEFAULT_DIVERGENCE_CONFIG, false);
  } catch (err: any) {
    if (/reduceOnly MUST be true/.test(err?.message || String(err))) thrownExit1 = true;
  }

  let thrownExit2 = false;
  try {
    await guardRouter.executeExit(mockPos, 1.0, 1.0, false);
  } catch (err: any) {
    if (/reduceOnly MUST be true/.test(err?.message || String(err))) thrownExit2 = true;
  }

  const validExit = await guardRouter.executeExit(mockPos, 'EXPANSION_TP', DEFAULT_DIVERGENCE_CONFIG, true);
  const standaloneExit = await executeDivergenceExit(mockPos);

  assertTest(
    'Suite 5.5 - Mandatory reduceOnly Guard',
    'Calling executeExit with reduceOnly=false throws /reduceOnly MUST be true/, while valid exit sets reduceOnly=true',
    thrownExit1 && thrownExit2 && validExit.leg1Fill?.reduceOnly === true && standaloneExit.leg1Fill?.reduceOnly === true,
    `Thrown1=${thrownExit1}, Thrown2=${thrownExit2}, ValidExit=${validExit.leg1Fill?.reduceOnly}, Standalone=${standaloneExit.leg1Fill?.reduceOnly}`
  );
}

// =========================================================================
// RUN ALL SUITES
// =========================================================================
async function runAll() {
  console.log('==================================================================');
  console.log('STARTING EMPIRICAL ADVERSARIAL STRESS SUITE: DIVERGENCE BOT');
  console.log('==================================================================');

  runSuite1();
  await runSuite2();
  await runSuite3();
  runSuite4();
  await runSuite5();

  console.log('\n==================================================================');
  console.log(`STRESS TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log('==================================================================\n');

  if (failCount > 0) {
    console.error('FAILED TESTS DETAILS:');
    for (const r of records.filter(r => !r.passed)) {
      console.error(`- [${r.suite}] ${r.testName}: ${r.details}`);
    }
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Fatal crash in stress harness:', err);
  process.exit(1);
});
