/**
 * EMPIRICAL CHALLENGER VERIFICATION HARNESS (Milestone 1 Remediation - Iteration 2)
 *
 * Verifies:
 * 1. Capital hard limits ($15.00 USDT, max 1 position) cannot be bypassed under any circumstance.
 * 2. PAUSED mode default (isRunning: false, fsmState: 'PAUSED') across code, stores, and disk.
 * 3. Complete Vitest test suite execution (11 files, 149 tests).
 * 4. Regex audit for Zero BPS notation and Zero legacy strategy mentions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import {
  DivergenceStateStore,
  DEFAULT_DIVERGENCE_CONFIG,
  INITIAL_DIVERGENCE_STATE,
  DIVERGENCE_HARD_LIMITS,
} from '../lib/divergence/store/stateStore';

import { DivergencePosition } from '../lib/divergence/types';

interface CheckItem {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  details: string;
}

const checks: CheckItem[] = [];

function recordCheck(id: string, category: string, description: string, condition: boolean, details: string = '') {
  checks.push({
    id,
    category,
    description,
    passed: condition,
    details: details || (condition ? 'OK' : 'Assertion failed'),
  });
  const status = condition ? '[PASS]' : '[FAIL]';
  console.log(`  ${status} [${id}] ${category} — ${description} ${details ? `(${details})` : ''}`);
}

async function runEmpiricalVerification() {
  console.log('========================================================================');
  console.log('  CHALLENGER ITERATION 2: EMPIRICAL BOUNDARY & INVARIANT RE-VERIFICATION');
  console.log('========================================================================\n');

  const sandboxDir = path.resolve(__dirname, 'sandbox_challenger_m1_r2');
  const statePath = path.join(sandboxDir, 'test_divergence_state.json');
  const inflightPath = path.join(sandboxDir, 'test_divergence_inflight.json');

  const cleanSandbox = () => {
    try {
      if (fs.existsSync(sandboxDir)) {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      }
    } catch {}
  };

  cleanSandbox();
  fs.mkdirSync(sandboxDir, { recursive: true });

  // =========================================================================
  // TASK 1: CAPITAL HARD LIMITS ($15.00 USDT, MAX 1 POSITION) EMPIRICAL CHECKS
  // =========================================================================
  console.log('--- TASK 1: Capital Hard Limits ($15.00 USDT, max 1 position) Invariants ---');

  // 1.1 Constants check
  recordCheck(
    'T1.1',
    'Hard Limits Constants',
    'DIVERGENCE_HARD_LIMITS has exact constants',
    DIVERGENCE_HARD_LIMITS.MAX_CONCURRENT_POSITIONS === 1 &&
    DIVERGENCE_HARD_LIMITS.MAX_POSITIONS_PER_SYMBOL === 1 &&
    DIVERGENCE_HARD_LIMITS.MAX_CAPITAL_ALLOCATION_USDT === 15.00 &&
    DIVERGENCE_HARD_LIMITS.ORDER_NOTIONAL_USDT === 15.00,
    `maxPos=${DIVERGENCE_HARD_LIMITS.MAX_CONCURRENT_POSITIONS}, maxCap=$${DIVERGENCE_HARD_LIMITS.MAX_CAPITAL_ALLOCATION_USDT}`
  );

  const store = new DivergenceStateStore(statePath, inflightPath);
  store.clearState();

  // 1.2 updateConfig clamping tests: maxCapitalAllocationUsdt
  const boundariesCap = [15.01, 15.000001, 16, 50, 500, 99999, 1e9];
  let allCapClampedHigh = true;
  for (const val of boundariesCap) {
    const res = store.updateConfig({ maxCapitalAllocationUsdt: val });
    if (res.maxCapitalAllocationUsdt !== 15.00 || store.getState().config.maxCapitalAllocationUsdt !== 15.00) {
      allCapClampedHigh = false;
      break;
    }
  }
  recordCheck(
    'T1.2',
    'Config Clamping',
    'updateConfig clamps maxCapitalAllocationUsdt > 15.00 (15.01, 50, 99999, 1e9) to 15.00',
    allCapClampedHigh
  );

  const boundariesCapLow = [0, -0.0001, -1, -25, -9999];
  let allCapClampedLow = true;
  for (const val of boundariesCapLow) {
    const res = store.updateConfig({ maxCapitalAllocationUsdt: val });
    if (res.maxCapitalAllocationUsdt !== 15.00 || store.getState().config.maxCapitalAllocationUsdt !== 15.00) {
      allCapClampedLow = false;
      break;
    }
  }
  recordCheck(
    'T1.3',
    'Config Clamping',
    'updateConfig clamps maxCapitalAllocationUsdt <= 0 (0, -0.0001, -25, -9999) to 15.00',
    allCapClampedLow
  );

  // 1.3 updateConfig clamping: maxConcurrentPositions
  const posCounts = [0, -1, 2, 3, 5, 10, 100];
  let allPosClamped = true;
  for (const val of posCounts) {
    const res = store.updateConfig({ maxConcurrentPositions: val });
    if (res.maxConcurrentPositions !== 1 || store.getState().config.maxConcurrentPositions !== 1) {
      allPosClamped = false;
      break;
    }
  }
  recordCheck(
    'T1.4',
    'Config Clamping',
    'updateConfig clamps maxConcurrentPositions !== 1 (0, -1, 2, 5, 100) to 1',
    allPosClamped
  );

  // 1.4 updateConfig clamping: maxPositionsPerSymbol
  const symbolCounts = [0, -1, 2, 4, 99];
  let allSymbolPosClamped = true;
  for (const val of symbolCounts) {
    const res = store.updateConfig({ maxPositionsPerSymbol: val });
    if (res.maxPositionsPerSymbol !== 1 || store.getState().config.maxPositionsPerSymbol !== 1) {
      allSymbolPosClamped = false;
      break;
    }
  }
  recordCheck(
    'T1.5',
    'Config Clamping',
    'updateConfig clamps maxPositionsPerSymbol !== 1 (0, -1, 2, 99) to 1',
    allSymbolPosClamped
  );

  // 1.5 updateConfig clamping: orderNotionalUsdt
  const orderNotionals = [15.01, 100, 5000, 0, -10];
  let allOrderNotionalsClamped = true;
  for (const val of orderNotionals) {
    const res = store.updateConfig({ orderNotionalUsdt: val });
    if (res.orderNotionalUsdt !== 15.00 || store.getState().config.orderNotionalUsdt !== 15.00) {
      allOrderNotionalsClamped = false;
      break;
    }
  }
  recordCheck(
    'T1.6',
    'Config Clamping',
    'updateConfig clamps orderNotionalUsdt > 15.00 or <= 0 to 15.00',
    allOrderNotionalsClamped
  );

  // 1.6 On-disk tampering sanitization
  const maliciousOnDisk = {
    version: '1.0.0',
    isRunning: true,
    fsmState: 'IDLE',
    config: {
      maxConcurrentPositions: 88,
      maxPositionsPerSymbol: 88,
      maxCapitalAllocationUsdt: 888888.00,
      orderNotionalUsdt: 8888.00,
    },
    activePositions: {},
    closedPositions: [],
    telemetry: {},
    lastUpdated: Date.now(),
  };
  fs.writeFileSync(statePath, JSON.stringify(maliciousOnDisk), 'utf-8');
  const tamperedLoadedStore = new DivergenceStateStore(statePath, inflightPath);
  const loadedCfg = tamperedLoadedStore.getState().config;
  recordCheck(
    'T1.7',
    'On-Disk Sanitization',
    'Sanitizes malicious on-disk tampering of capital and position limits upon load',
    loadedCfg.maxConcurrentPositions === 1 &&
    loadedCfg.maxPositionsPerSymbol === 1 &&
    loadedCfg.maxCapitalAllocationUsdt === 15.00 &&
    loadedCfg.orderNotionalUsdt === 15.00,
    `maxConcurrent=${loadedCfg.maxConcurrentPositions}, maxCap=$${loadedCfg.maxCapitalAllocationUsdt}, orderNotional=$${loadedCfg.orderNotionalUsdt}`
  );

  // 1.7 Pre-Trade Gating canOpenPosition boundary stress
  tamperedLoadedStore.setRunning(true);

  // Test notional > 15.00
  const gate1501 = tamperedLoadedStore.canOpenPosition(15.01);
  recordCheck(
    'T1.8',
    'canOpenPosition Gating',
    'canOpenPosition rejects order notional > $15.00 (15.01)',
    gate1501.allowed === false && Boolean(gate1501.reason?.includes('Capital limit exceeded')),
    gate1501.reason || ''
  );

  // Test notional == 15.00 (exact boundary)
  const gate1500 = tamperedLoadedStore.canOpenPosition(15.00);
  recordCheck(
    'T1.9',
    'canOpenPosition Gating',
    'canOpenPosition permits order notional at exact $15.00 ceiling',
    gate1500.allowed === true
  );

  // Test notional <= 0
  const gateZero = tamperedLoadedStore.canOpenPosition(0);
  const gateNeg = tamperedLoadedStore.canOpenPosition(-15.00);
  recordCheck(
    'T1.10',
    'canOpenPosition Gating',
    'canOpenPosition rejects notional <= 0 (0, -15.00)',
    gateZero.allowed === false && gateNeg.allowed === false &&
    Boolean(gateZero.reason?.includes('Invalid notionalUsdt requested')) &&
    Boolean(gateNeg.reason?.includes('Invalid notionalUsdt requested'))
  );

  // Test notional NaN, Infinity, -Infinity
  const gateNaN = tamperedLoadedStore.canOpenPosition(NaN);
  const gateInf = tamperedLoadedStore.canOpenPosition(Infinity);
  const gateNegInf = tamperedLoadedStore.canOpenPosition(-Infinity);
  recordCheck(
    'T1.11',
    'canOpenPosition Gating',
    'canOpenPosition rejects non-finite / NaN notionals (NaN, Infinity, -Infinity)',
    gateNaN.allowed === false && gateInf.allowed === false && gateNegInf.allowed === false,
    `NaN reason: ${gateNaN.reason}`
  );

  // 1.8 Position Capacity Enforcement (maxConcurrentPositions = 1)
  const mockPosition: DivergencePosition = {
    id: 'div_pos_emp_01',
    canonicalSymbol: 'SUIUSDT',
    binanceSymbol: 'SUIUSDT',
    bybitSymbol: 'SUIUSDT',
    direction: 'LONG_BN_SHORT_BYB',
    status: 'OPEN',
    entryTimestamp: Date.now(),
    entryBinancePrice: 2.0,
    entryBybitPrice: 2.0,
    entryBasisPercent: 0.0,
    currentBasisPercent: 0.0,
    peakBasisPercent: 0.0,
    targetExpansionPercent: 0.380,
    stopLossBasisPercent: -0.150,
    notionalUsdt: 15.00,
    quantityBinance: 7.5,
    quantityBybit: 7.5,
    leg1: {
      venue: 'BINANCE',
      side: 'BUY',
      orderType: 'POST_ONLY_MAKER_GTX',
      orderId: 'ord1',
      clientOrderId: 'div1_emp_01',
      symbol: 'SUIUSDT',
      executedQty: 7.5,
      avgPrice: 2.0,
      feePercent: 0.020,
      feeUsdt: 0.003,
      latencyMs: 10,
      timestamp: Date.now(),
    },
    leg2: {
      venue: 'BYBIT',
      side: 'SELL',
      orderType: 'WS_IOC_TAKER',
      orderId: 'ord2',
      clientOrderId: 'div2_emp_01',
      symbol: 'SUIUSDT',
      executedQty: 7.5,
      avgPrice: 2.0,
      feePercent: 0.055,
      feeUsdt: 0.008,
      latencyMs: 20,
      timestamp: Date.now(),
    },
    currentBinancePrice: 2.0,
    currentBybitPrice: 2.0,
    relativeExpansionPercent: 0.0,
    unrealizedGrossPnlUsdt: 0.0,
    estimatedTotalFeesUsdt: 0.022,
    netPnlUsdt: -0.022,
    roiPercent: -0.147,
    holdDurationMinutes: 0,
    isHurdleMet: false,
    executionHash: 'mock_hash',
    stagnancyNominalDeadline: Date.now() + 180 * 60000,
    stagnancyCeilingDeadline: Date.now() + 360 * 60000,
    hasMomentumExtension: false,
    accumulatedCarryPercent: 0.0,
    lastUpdated: Date.now(),
  };

  const addFirst = tamperedLoadedStore.addPosition(mockPosition);
  recordCheck(
    'T1.12',
    'Position Capacity',
    'First position ($15.00 USDT) added cleanly within limits',
    addFirst === true && tamperedLoadedStore.getActivePositions().length === 1
  );

  // Attempt to add second position via addPosition
  const mockPosition2 = { ...mockPosition, id: 'div_pos_emp_02', canonicalSymbol: 'APTUSDT' };
  const addSecond = tamperedLoadedStore.addPosition(mockPosition2);
  recordCheck(
    'T1.13',
    'Position Capacity',
    'addPosition strictly rejects second position when capacity = 1 is reached',
    addSecond === false && tamperedLoadedStore.getActivePositions().length === 1
  );

  // canOpenPosition rejection when 1 position is active
  const gateFull = tamperedLoadedStore.canOpenPosition(15.00);
  recordCheck(
    'T1.14',
    'Position Capacity',
    'canOpenPosition rejects entry when 1 position is active',
    gateFull.allowed === false && Boolean(gateFull.reason?.includes('Max concurrent positions limit reached')),
    gateFull.reason || ''
  );

  // 1.9 Defense-in-depth: addPosition oversized / invalid notional rejection
  tamperedLoadedStore.clearState();
  tamperedLoadedStore.setRunning(true);

  const oversizedPos: any = {
    id: 'oversized_pos',
    symbol: 'BTCUSDT',
    canonicalSymbol: 'BTCUSDT',
    notionalUsdt: 5000.00,
  };
  const addOversized = tamperedLoadedStore.addPosition(oversizedPos);
  recordCheck(
    'T1.15',
    'Defense-in-Depth',
    'addPosition rejects oversized notional ($5,000.00 > $15.00)',
    addOversized === false && tamperedLoadedStore.getPositionById('oversized_pos') === undefined
  );

  const invalidNotionalPos: any = {
    id: 'invalid_notional_pos',
    symbol: 'BTCUSDT',
    canonicalSymbol: 'BTCUSDT',
    notionalUsdt: -10.00,
  };
  const addInvalidNotional = tamperedLoadedStore.addPosition(invalidNotionalPos);
  recordCheck(
    'T1.16',
    'Defense-in-Depth',
    'addPosition rejects negative / NaN notional',
    addInvalidNotional === false && tamperedLoadedStore.getPositionById('invalid_notional_pos') === undefined
  );

  // 1.10 In-memory heap immutability via deep cloning
  const stateSnapshot = tamperedLoadedStore.getState();
  (stateSnapshot.config as any).maxCapitalAllocationUsdt = 999999.00;
  (stateSnapshot.config as any).maxConcurrentPositions = 99;
  (stateSnapshot.activePositions as any)['injected_pos'] = { id: 'injected_pos', notionalUsdt: 99999 };

  const verifiedState = tamperedLoadedStore.getState();
  recordCheck(
    'T1.17',
    'Heap Immutability',
    'getState() returns deep clone preventing in-memory capital/position limit tampering',
    verifiedState.config.maxCapitalAllocationUsdt === 15.00 &&
    verifiedState.config.maxConcurrentPositions === 1 &&
    Object.keys(verifiedState.activePositions).length === 0
  );

  // =========================================================================
  // TASK 2: CONFIRM PAUSED MODE DEFAULT (isRunning: false, fsmState: 'PAUSED')
  // =========================================================================
  console.log('\n--- TASK 2: PAUSED Mode Default (isRunning: false, fsmState: "PAUSED") ---');

  // 2.1 INITIAL_DIVERGENCE_STATE constants
  recordCheck(
    'T2.1',
    'Code Default Constant',
    'INITIAL_DIVERGENCE_STATE has isRunning: false and fsmState: "PAUSED"',
    INITIAL_DIVERGENCE_STATE.isRunning === false && INITIAL_DIVERGENCE_STATE.fsmState === 'PAUSED',
    `isRunning=${INITIAL_DIVERGENCE_STATE.isRunning}, fsmState=${INITIAL_DIVERGENCE_STATE.fsmState}`
  );

  // 2.2 Fresh Store Initialization
  const freshStore = new DivergenceStateStore(
    path.join(sandboxDir, 'fresh_state.json'),
    path.join(sandboxDir, 'fresh_inflight.json')
  );
  const freshState = freshStore.getState();
  recordCheck(
    'T2.2',
    'Store Boot Default',
    'Fresh DivergenceStateStore initializes with isRunning: false and fsmState: "PAUSED"',
    freshState.isRunning === false && freshState.fsmState === 'PAUSED',
    `isRunning=${freshState.isRunning}, fsmState=${freshState.fsmState}`
  );

  // 2.3 Recovery from total file corruption defaults to PAUSED
  fs.writeFileSync(path.join(sandboxDir, 'corrupt_state.json'), 'CORRUPTED_GARBAGE_1', 'utf-8');
  fs.writeFileSync(path.join(sandboxDir, 'corrupt_state.json.backup'), 'CORRUPTED_GARBAGE_2', 'utf-8');
  const recoveredStore = new DivergenceStateStore(
    path.join(sandboxDir, 'corrupt_state.json'),
    path.join(sandboxDir, 'corrupt_inflight.json')
  );
  const recoveredState = recoveredStore.getState();
  recordCheck(
    'T2.3',
    'Disaster Recovery Default',
    'Dual-corruption disaster recovery initializes clean state in PAUSED mode',
    recoveredState.isRunning === false && recoveredState.fsmState === 'PAUSED',
    `isRunning=${recoveredState.isRunning}, fsmState=${recoveredState.fsmState}`
  );

  // 2.4 Production disk files
  const rootDataStatePath = path.resolve(process.cwd(), '..', 'data', 'divergence_state.json');
  const webDataStatePath = path.resolve(process.cwd(), 'data', 'divergence_state.json');

  let rootStateJson: any = null;
  if (fs.existsSync(rootDataStatePath)) {
    try {
      rootStateJson = JSON.parse(fs.readFileSync(rootDataStatePath, 'utf-8'));
    } catch {}
  }
  recordCheck(
    'T2.4',
    'Root State File',
    'data/divergence_state.json exists and is in PAUSED mode (isRunning: false, fsmState: "PAUSED")',
    rootStateJson !== null && rootStateJson.isRunning === false && rootStateJson.fsmState === 'PAUSED',
    rootStateJson ? `isRunning=${rootStateJson.isRunning}, fsmState=${rootStateJson.fsmState}` : 'File missing/unparseable'
  );

  let webStateJson: any = null;
  if (fs.existsSync(webDataStatePath)) {
    try {
      webStateJson = JSON.parse(fs.readFileSync(webDataStatePath, 'utf-8'));
    } catch {}
  }
  recordCheck(
    'T2.5',
    'Web State File',
    'web/data/divergence_state.json exists and is in PAUSED mode (isRunning: false, fsmState: "PAUSED")',
    webStateJson !== null && webStateJson.isRunning === false && webStateJson.fsmState === 'PAUSED',
    webStateJson ? `isRunning=${webStateJson.isRunning}, fsmState=${webStateJson.fsmState}` : 'File missing/unparseable'
  );

  // 2.5 canOpenPosition enforcement of PAUSED mode
  freshStore.setRunning(false);
  const pausedGate = freshStore.canOpenPosition(15.00);
  recordCheck(
    'T2.6',
    'PAUSED Gate Enforcement',
    'canOpenPosition strictly halts trading when engine is PAUSED (isRunning: false)',
    pausedGate.allowed === false && Boolean(pausedGate.reason?.includes('Engine is not running')),
    pausedGate.reason || ''
  );

  // =========================================================================
  // TASK 3: RUN THE COMPLETE VITEST TEST SUITE
  // =========================================================================
  console.log('\n--- TASK 3: Run Complete Vitest Test Suite (tests/unit/divergence/) ---');
  let vitestOutput = '';
  let vitestSuccess = false;
  try {
    vitestOutput = execSync('npx vitest run tests/unit/divergence/', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    vitestSuccess = true;
  } catch (err: any) {
    vitestOutput = (err.stdout || '') + '\n' + (err.stderr || '');
    vitestSuccess = false;
  }

  // Strip ANSI escape codes from Vitest output
  const cleanVitestOutput = vitestOutput.replace(/\u001b\[[0-9;]*m/g, '');
  const filesPassedMatch = cleanVitestOutput.match(/Test Files\s+(\d+)\s+passed/);
  const testsPassedMatch = cleanVitestOutput.match(/Tests\s+(\d+)\s+passed/);

  const testFilesPassed = filesPassedMatch ? parseInt(filesPassedMatch[1], 10) : 0;
  const testsPassed = testsPassedMatch ? parseInt(testsPassedMatch[1], 10) : 0;

  recordCheck(
    'T3.1',
    'Vitest Suite Execution',
    'Vitest divergence suite runs with zero test failures (exit code 0)',
    vitestSuccess,
    `exitCode=${vitestSuccess ? 0 : 1}`
  );

  recordCheck(
    'T3.2',
    'Vitest File Count',
    'All 11 divergence test files pass cleanly',
    testFilesPassed === 11,
    `filesPassed=${testFilesPassed}/11`
  );

  recordCheck(
    'T3.3',
    'Vitest Test Count',
    'All 149 divergence tests pass cleanly',
    testsPassed === 149,
    `testsPassed=${testsPassed}/149`
  );

  // =========================================================================
  // TASK 4: REGEX AUDIT FOR ZERO BPS NOTATION & ZERO LEGACY STRATEGY MENTIONS
  // =========================================================================
  console.log('\n--- TASK 4: Regex Audit: Zero BPS Notation & Zero Legacy Strategy Mentions ---');

  const prodFiles: string[] = [];
  const testFiles: string[] = [];

  function collectFiles(dir: string, targetList: string[], extensions: string[] = ['.ts', '.tsx', '.json', '.md']) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        collectFiles(fullPath, targetList, extensions);
      } else if (extensions.some(ext => ent.name.endsWith(ext))) {
        targetList.push(fullPath);
      }
    }
  }

  // Collect production files
  collectFiles(path.resolve(process.cwd(), 'lib', 'divergence'), prodFiles);
  if (fs.existsSync(rootDataStatePath)) prodFiles.push(rootDataStatePath);
  if (fs.existsSync(webDataStatePath)) prodFiles.push(webDataStatePath);
  const planPath = path.resolve(process.cwd(), '..', 'plans', 'divergence_bot_plan.md');
  if (fs.existsSync(planPath)) prodFiles.push(planPath);

  // Collect test files
  collectFiles(path.resolve(process.cwd(), 'tests', 'unit', 'divergence'), testFiles);

  // 4.1 BPS Notation Audit: Find any instances where spreads, hurdles, fees, or metrics use "bps"
  // Allowed exceptions: phrases explicitly declaring the rule like "Zero BPS", "zero-bps", "ZERO BPS NOTATION"
  const prodBpsViolations: Array<{ file: string; line: number; text: string }> = [];

  // Numerical pattern: e.g. "25 bps", "10bps", "0.5 bps"
  const numericalBpsRegex = /\b\d+(\.\d+)?\s*bps\b/i;
  // Field pattern: e.g. spreadBps, hurdleBps, netEdgeBps, etc.
  const fieldBpsRegex = /\b[a-zA-Z0-9_]*(bps|Bps)\b/;

  for (const file of prodFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip pure rule declarations, audit regex commands, or comments stating "Zero BPS notation"
      if (/zero\s*bps|zero-bps|no\s*bps|ban\s*bps|without\s*bps|-pattern\s+['"]\\bbps\\b['"]/i.test(line)) {
        continue;
      }

      if (numericalBpsRegex.test(line)) {
        prodBpsViolations.push({
          file: path.relative(path.resolve(process.cwd(), '..'), file),
          line: i + 1,
          text: line.trim(),
        });
      } else if (fieldBpsRegex.test(line)) {
        const match = line.match(fieldBpsRegex);
        if (match && !/ZeroBps|noBps/i.test(match[0])) {
          prodBpsViolations.push({
            file: path.relative(path.resolve(process.cwd(), '..'), file),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }
  }

  recordCheck(
    'T4.1',
    'Zero BPS Notation Audit',
    'Zero numerical BPS units or BPS property fields found across production code, state, and master plan',
    prodBpsViolations.length === 0,
    prodBpsViolations.length > 0 ? `Violations found: ${prodBpsViolations.length}: ${JSON.stringify(prodBpsViolations.slice(0, 3))}` : '0 violations'
  );

  // 4.2 Legacy Strategy Mentions Audit:
  // Strictly avoid naming, mentioning, or referencing any legacy basis bot (e.g. basisBot, basis_bot, basisBotEngine)
  const legacyViolations: Array<{ file: string; line: number; text: string }> = [];
  const legacyRegex = /\b(basisBot|basis_bot|basisBotEngine)\b/i;

  for (const file of prodFiles.concat(testFiles)) {
    const isTestFile = file.includes('tests');
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines stating the ban itself, e.g. "Strict ban on legacy basis bot"
      if (/ban\s+on\s+legacy|avoid\s+naming.*legacy|zero.*legacy\s+basis\s+bot/i.test(line)) {
        continue;
      }
      if (isTestFile && (/toMatch|\.test\(|legacyViolation|searchPattern|regex|terms/i.test(line))) {
        continue;
      }

      if (legacyRegex.test(line)) {
        legacyViolations.push({
          file: path.relative(path.resolve(process.cwd(), '..'), file),
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  recordCheck(
    'T4.2',
    'Zero Legacy Strategy Mentions',
    'Zero legacy basis bot references found across divergence code, state, test, and plan files',
    legacyViolations.length === 0,
    legacyViolations.length > 0 ? `Violations found: ${legacyViolations.length}: ${JSON.stringify(legacyViolations.slice(0, 3))}` : '0 violations'
  );

  // =========================================================================
  // SUMMARY & VERDICT
  // =========================================================================
  console.log('\n========================================================================');
  const passedCount = checks.filter(c => c.passed).length;
  const failedCount = checks.filter(c => !c.passed).length;
  const overallVerdict = failedCount === 0 ? 'APPROVE' : 'REJECT';

  console.log(`  EMPIRICAL CHALLENGER VERIFICATION COMPLETE:`);
  console.log(`  Total Checks: ${checks.length}`);
  console.log(`  Total Passed: ${passedCount}`);
  console.log(`  Total Failed: ${failedCount}`);
  console.log(`  VERDICT: ${overallVerdict}`);
  console.log('========================================================================\n');

  cleanSandbox();

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runEmpiricalVerification().catch(err => {
  console.error('Empirical harness crashed:', err);
  process.exit(1);
});
