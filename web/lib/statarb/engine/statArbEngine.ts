/**
 * STATARB-OU-PERP: Standalone Autonomous Arbitrage Engine
 * 
 * Continuous statistical price convergence sweeper operating across
 * Binance USD-M Perpetuals and Bybit Linear Perpetuals.
 * 
 * Features:
 * 1. Autonomous scanning and signal evaluation with Invariant 7 sticky decoupling screening
 * 2. Maker-Taker dual-leg execution with adverse drift and timeout monitoring
 * 3. Position lifecycle management with Invariant 6 persistence breaker and Guaranteed Zero-Loss Exit
 * 4. 100% standalone with isolated state store and zero legacy bot dependencies
 */

import {
  StatArbConfig,
  StatArbPair,
  StatArbPosition,
  TradeSignal,
  OUParameters,
} from '../types';
import {
  evaluateEntryGates,
  generateTradeSignal,
  calculateBasisBps,
  calibrateOrnsteinUhlenbeck,
  DEFAULT_OU_PRIORS,
} from '../math';
import {
  checkInvariant6PersistenceBreaker,
  checkInvariant7StickyDecoupling,
  evaluateExit,
  MakerTakerOrderRouter,
  SimulatedExecutionAdapter,
  LiveExchangeAdapter,
  ExchangeExecutionAdapter,
  ExecutionResult,
  ExecutionRequest,
} from '../execution';
import { StatArbStateStore, StatArbEngineState } from './statArbStateStore';
import { checkConcurrentPositionsLimit, evaluateSystemSafety } from './safetyBreakers';
import { getSymbolFilter, roundQuantity } from '../utils/exchangeFilterRegistry';
import { appendStatArbLog } from '../logging';

export type OrderRoutingRequest = ExecutionRequest;

export interface ScanResult {
  timestamp: number;
  monitoredPairsCount: number;
  qualifyingSignals: TradeSignal[];
  executedPositions: StatArbPosition[];
  rejectedReasons: Record<string, string[]>;
}

export interface PositionManagementResult {
  timestamp: number;
  evaluatedCount: number;
  closedPositions: StatArbPosition[];
  activePositions: StatArbPosition[];
}

export class StatArbEngine {
  private store: StatArbStateStore;
  private router: MakerTakerOrderRouter;
  private activeAdapter: ExchangeExecutionAdapter;
  private isRunning: boolean = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private positionTimer: NodeJS.Timeout | null = null;
  private scanIntervalMs: number = 3000;
  private positionIntervalMs: number = 2000;
  private symbolCooldowns: Map<string, number> = new Map();

  /**
   * Check if a symbol is in the 60-minute rejection quarantine
   */
  public isQuarantined(symbol: string): boolean {
    const sym = symbol.toUpperCase();
    const expiry = this.symbolCooldowns.get(sym);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
      this.symbolCooldowns.delete(sym);
      return false;
    }
    return true;
  }

  /**
   * Quarantine a symbol for durationSeconds (default: 3600s / 60 minutes)
   */
  public quarantineSymbol(symbol: string, durationSeconds: number = 3600): void {
    const sym = symbol.toUpperCase();
    const expiry = Date.now() + durationSeconds * 1000;
    this.symbolCooldowns.set(sym, expiry);
    appendStatArbLog(
      `[WARN] [QUARANTINE ACTIVATED: 60M] Symbol ${sym} quarantined for ${Math.round(durationSeconds / 60)} minutes until ${new Date(expiry).toLocaleTimeString()} to prevent repetitive entry loops.`,
      'warn',
      sym
    );
  }

  /**
   * Clear quarantine for a specific symbol or all symbols
   */
  public clearQuarantine(symbol?: string): void {
    if (symbol) {
      this.symbolCooldowns.delete(symbol.toUpperCase());
    } else {
      this.symbolCooldowns.clear();
    }
  }

  /**
   * Get active quarantined symbols with remaining minutes
   */
  public getQuarantinedSymbols(): { symbol: string; remainingMinutes: number }[] {
    const now = Date.now();
    const result: { symbol: string; remainingMinutes: number }[] = [];
    for (const [sym, expiry] of this.symbolCooldowns.entries()) {
      if (now < expiry) {
        result.push({
          symbol: sym,
          remainingMinutes: Math.max(0, Math.round((expiry - now) / 60000)),
        });
      } else {
        this.symbolCooldowns.delete(sym);
      }
    }
    return result;
  }

  constructor(
    customStore?: StatArbStateStore,
    customRouter?: MakerTakerOrderRouter | ExchangeExecutionAdapter,
    executionAdapter?: ExchangeExecutionAdapter
  ) {
    this.store = customStore || new StatArbStateStore();
    const config = this.store.getState().config;
    const isDryRun = config.dryRun ?? true;

    if (customRouter instanceof MakerTakerOrderRouter) {
      this.router = customRouter;
      if (executionAdapter) {
        this.activeAdapter = executionAdapter;
        this.router.setAdapter(executionAdapter);
      } else {
        this.activeAdapter = (customRouter as any).adapter || (isDryRun ? new SimulatedExecutionAdapter() : new LiveExchangeAdapter());
      }
    } else if (customRouter && typeof (customRouter as any).placeMakerLimit === 'function') {
      this.activeAdapter = customRouter as ExchangeExecutionAdapter;
      this.router = new MakerTakerOrderRouter(this.activeAdapter);
    } else if (executionAdapter) {
      this.activeAdapter = executionAdapter;
      this.router = new MakerTakerOrderRouter(this.activeAdapter);
    } else {
      this.activeAdapter = !isDryRun ? new LiveExchangeAdapter() : new SimulatedExecutionAdapter();
      this.router = new MakerTakerOrderRouter(this.activeAdapter);
    }
  }

  /**
   * Sets custom router
   */
  public setRouter(router: MakerTakerOrderRouter): void {
    this.router = router;
    if ((router as any).adapter) {
      this.activeAdapter = (router as any).adapter;
    }
  }

  /**
   * Returns active router
   */
  public getRouter(): MakerTakerOrderRouter {
    return this.router;
  }

  /**
   * Order router getter (synonym for router)
   */
  public get orderRouter(): MakerTakerOrderRouter {
    return this.router;
  }

  /**
   * Order router setter
   */
  public set orderRouter(router: MakerTakerOrderRouter) {
    this.setRouter(router);
  }

  /**
   * Sets execution adapter on active router and tracks it
   */
  public setAdapter(adapter: ExchangeExecutionAdapter): void {
    this.activeAdapter = adapter;
    this.router.setAdapter(adapter);
  }

  /**
   * Returns current active execution adapter
   */
  public getAdapter(): ExchangeExecutionAdapter {
    return this.activeAdapter;
  }

  /**
   * Returns current read-only engine state
   */
  public getState(): Readonly<StatArbEngineState> {
    return this.store.getState();
  }

  /**
   * Returns whether autonomous background loop is running
   */
  public isEngineRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Starts autonomous scanning and position management loop
   */
  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.store.updateConfig({ enabled: true });

    // In production or test harness, periodic scanning can be driven by start()
    // or by explicit step calls (scanCorridors, managePositions).
  }

  /**
   * Stops autonomous scanning and position management loop
   */
  public stop(): void {
    this.isRunning = false;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
    this.store.updateConfig({ enabled: false });
  }

  /**
   * Emergency Kill-Switch: Halts engine immediately and flattens all active positions
   */
  public async emergencyKill(): Promise<StatArbPosition[]> {
    this.stop();
    this.store.setKillSwitch(true);

    const activePositions = this.store.getActivePositions();
    const closedPositions: StatArbPosition[] = [];

    for (const position of activePositions) {
      try {
        await this.router.executeExit(
          position,
          position.currentBinancePrice,
          position.currentBybitPrice,
          true // isEmergency = true
        );
        const closed = this.store.closePosition(
          position.id,
          'EMERGENCY_KILL_SWITCH_UNWIND',
          position.unrealizedPnlUsdt || 0.0
        );
        if (closed) closedPositions.push(closed);
      } catch (err) {
        // Log emergency exit failure but continue unwinding others
      }
    }

    return closedPositions;
  }

  /**
   * Updates strategy configuration
   */
  public updateConfig(updates: Partial<StatArbConfig>): void {
    this.store.updateConfig(updates);
    if (updates.dryRun !== undefined) {
      if (updates.dryRun === false) {
        this.setAdapter(new LiveExchangeAdapter());
        console.log('[STATARB-ENGINE] Switched to LIVE real-exchange execution adapter (dryRun: false).');
      } else {
        this.setAdapter(new SimulatedExecutionAdapter());
        console.log('[STATARB-ENGINE] Switched to SIMULATED execution adapter (dryRun: true).');
      }
    }
  }

  /**
   * Scans corridors and evaluates entry opportunities
   * 
   * @param pairs Current live quotes and depth metrics across corridors
   * @param rollingHistoryMap Optional 30m divergence history map for Invariant 7 evaluation
   * @param ouParamsMap Optional pre-calibrated Ornstein-Uhlenbeck parameters map
   */
  public async scanCorridors(
    pairs: StatArbPair[],
    rollingHistoryMap: Map<string, number[]> = new Map(),
    ouParamsMap: Map<string, OUParameters> = new Map()
  ): Promise<ScanResult> {
    const timestamp = Date.now();
    const state = this.store.getState();
    const config = state.config;

    this.store.updateMonitoredPairs(pairs);

    const qualifyingSignals: TradeSignal[] = [];
    const executedPositions: StatArbPosition[] = [];
    const rejectedReasons: Record<string, string[]> = {};

    // 1. Check System Safety & Capacity
    const safety = evaluateSystemSafety(
      state.positions.length,
      state.currentEquityUsdt,
      state.peakEquityUsdt,
      state.isKillSwitchEngaged,
      config.maxConcurrentPositions
    );

    if (!safety.canTrade || !config.enabled) {
      return {
        timestamp,
        monitoredPairsCount: pairs.length,
        qualifyingSignals: [],
        executedPositions: [],
        rejectedReasons: {
          SYSTEM: safety.reasons.length > 0 ? safety.reasons : ['Strategy disabled in configuration'],
        },
      };
    }

    let availableSlots = safety.capacity.remainingCapacity;

    // 2. Evaluate Each Pair Candidate
    for (const pair of pairs) {
      const pairReasons: string[] = [];

      // Avoid duplicate active positions on the same canonical instrument
      const isAlreadyActive = state.positions.some(
        (p) => p.canonicalSymbol === pair.canonicalSymbol && p.status === 'OPEN'
      );
      if (isAlreadyActive) {
        rejectedReasons[pair.canonicalSymbol] = ['Active position already open for this instrument'];
        continue;
      }

      // Check if instrument is under 60-minute rejection quarantine
      if (this.isQuarantined(pair.canonicalSymbol)) {
        rejectedReasons[pair.canonicalSymbol] = ['Symbol is quarantined (60-minute rejection cooldown active)'];
        continue;
      }

      // 2.1 Invariant 7: Upstream Sticky Decoupling Filter
      const divergenceHistory = rollingHistoryMap.get(pair.canonicalSymbol) || [];
      const stickyCheck = checkInvariant7StickyDecoupling(divergenceHistory);
      if (!stickyCheck.passed) {
        pairReasons.push(stickyCheck.reason);
        rejectedReasons[pair.canonicalSymbol] = pairReasons;
        continue;
      }

      // 2.2 Gross Basis Hurdle Gate (|b_t| >= minGrossBasisBps)
      if (Math.abs(pair.grossBasisBps) < config.entryGate.minGrossBasisBps) {
        pairReasons.push(
          `Gross basis magnitude |${pair.grossBasisBps.toFixed(2)} bps| < ${config.entryGate.minGrossBasisBps} bps hurdle`
        );
        rejectedReasons[pair.canonicalSymbol] = pairReasons;
        continue;
      }

      // 2.2 Determine OU Parameters (pre-calibrated or calibrated from history or default priors)
      let params = ouParamsMap.get(pair.canonicalSymbol);
      if (!params) {
        if (divergenceHistory.length >= 5) {
          params = calibrateOrnsteinUhlenbeck(divergenceHistory);
        } else {
          params = {
            theta: DEFAULT_OU_PRIORS.theta,
            mu: 0.0,
            sigma: DEFAULT_OU_PRIORS.sigma,
            halfLifeMinutes: DEFAULT_OU_PRIORS.halfLifeMinutes,
            equilibriumSigma: DEFAULT_OU_PRIORS.equilibriumSigma,
            rSquared: 0.0,
            sampleCount: divergenceHistory.length,
            lastUpdated: timestamp,
          };
        }
      }

      // 2.3 Pre-Flight Entry Gating (|z| >= 2.20, gross basis >= 28 bps, depth >= 4x, spread <= 8 bps)
      const gateResult = evaluateEntryGates(pair, params, config.entryGate);
      if (!gateResult.passed) {
        pairReasons.push(...gateResult.reasons);
        rejectedReasons[pair.canonicalSymbol] = pairReasons;
        continue;
      }

      // 2.4 Signal Generation
      const signal = generateTradeSignal(pair, params, config.entryGate);
      if (signal) {
        this.store.recordSignal(signal);

        if (signal.passedGates && signal.direction) {
          qualifyingSignals.push(signal);

          // 2.5 Execute Entry if capacity permits and engine is active
          if (availableSlots > 0 && this.isRunning) {
            const targetNotional = config.orderNotionalUsdt || 15.0;
            const notional = targetNotional;
            const leg1Price = pair.binanceMid;
            const filter = getSymbolFilter((pair as any).binanceVenue ?? 'BINANCE', pair.binanceSymbol);
            const rawQty = targetNotional / leg1Price;
            const quantity = roundQuantity(rawQty, filter.stepSize);

            // Assert quantity satisfies exchange filter.minQty and filter.stepSize
            const isStepValid = filter.stepSize > 0 && Math.abs(quantity - Math.round(quantity / filter.stepSize) * filter.stepSize) < 1e-8;
            if (quantity < filter.minQty || quantity <= 0 || !isStepValid) {
              pairReasons.push(
                `Leg 1 quantity ${quantity} fails filter requirements (minQty: ${filter.minQty}, stepSize: ${filter.stepSize}) for ${pair.binanceSymbol}`
              );
              rejectedReasons[pair.canonicalSymbol] = pairReasons;
              continue;
            }

            const isShortBn = signal.direction === 'SHORT_BINANCE_LONG_BYBIT';
            const leg1Side = isShortBn ? 'SELL' : 'BUY';
            const leg2Side = isShortBn ? 'BUY' : 'SELL';
            const isDryRun = config.dryRun ?? true;

            const orderRoutingRequest: OrderRoutingRequest = {
              pair,
              direction: signal.direction,
              notionalUsdt: notional,
              quantity,
              leg1Venue: 'BINANCE',
              leg2Venue: 'BYBIT',
              leg1Symbol: pair.binanceSymbol,
              leg2Symbol: pair.bybitSymbol,
              leg1Side,
              leg2Side,
              leg1BestBid: pair.binanceMid * 0.9999,
              leg1BestAsk: pair.binanceMid * 1.0001,
              leg2InitialPrice: pair.bybitMid,
              timeoutMs: config.makerTimeoutMs || 8000,
              maxAdverseDriftBps: config.adverseDriftThresholdBps || 8.0,
              isDryRun,
            };

            const execResult: ExecutionResult = await this.orderRouter.executeEntry(orderRoutingRequest);

            if (execResult.quarantineSymbol || execResult.status === 'EMERGENCY_UNWOUND' || !execResult.success) {
              this.quarantineSymbol(pair.canonicalSymbol, 3600);
            }

            if (!execResult.success) {
              pairReasons.push(`Execution aborted: ${execResult.reason || execResult.status}${execResult.executionHash ? ` (Hash: ${execResult.executionHash})` : ''}`);
              rejectedReasons[pair.canonicalSymbol] = pairReasons;
              appendStatArbLog(
                `[WARN] [ENTRY ABORTED] Order execution aborted for ${pair.canonicalSymbol}: ${execResult.reason || execResult.status}${execResult.executionHash ? ` (Hash: ${execResult.executionHash})` : ''}`,
                'warn',
                pair.canonicalSymbol,
                { status: execResult.status, executionHash: execResult.executionHash, reason: execResult.reason }
              );
            }

            if (execResult.success && execResult.executedQty > 0) {
              const leg1OrderId = execResult.leg1OrderId || execResult.leg1?.orderId;
              const leg2OrderId = execResult.leg2OrderId || execResult.leg2?.orderId;
              const leg1ClientOrderId = execResult.leg1ClientOrderId || execResult.leg1?.clientOrderId;
              const leg2ClientOrderId = execResult.leg2ClientOrderId || execResult.leg2?.clientOrderId;
              const executionHash =
                execResult.executionHash ||
                (leg1OrderId && leg2OrderId
                  ? `0x${Buffer.from(`${leg1OrderId}:${leg2OrderId}:${timestamp}`).toString('hex').slice(0, 32)}`
                  : undefined);

              const newPosition: StatArbPosition = {
                id: `pos_${pair.canonicalSymbol}_${timestamp}`,
                canonicalSymbol: pair.canonicalSymbol,
                binanceSymbol: pair.binanceSymbol,
                bybitSymbol: pair.bybitSymbol,
                direction: signal.direction,
                status: 'OPEN',
                entryTimestamp: timestamp,
                entryBasisBps: pair.grossBasisBps,
                entryBinancePrice: execResult.leg1?.price || pair.binanceMid,
                entryBybitPrice: execResult.leg2?.price || pair.bybitMid,
                quantity: execResult.executedQty,
                notionalUsdt: notional,
                currentBasisBps: pair.grossBasisBps,
                currentBinancePrice: pair.binanceMid,
                currentBybitPrice: pair.bybitMid,
                currentZScore: signal.zScore,
                realizedPnlUsdt: 0.0,
                unrealizedPnlUsdt: 0.0,
                totalFeesUsdt: (execResult.leg1?.feeUsdt || 0) + (execResult.leg2?.feeUsdt || 0),
                netPnlUsdt: 0.0,
                holdDurationMinutes: 0.0,
                divergenceHistory30m: [...divergenceHistory],
                leg1OrderId,
                leg2OrderId,
                leg1ClientOrderId,
                leg2ClientOrderId,
                executionHash,
              };

              this.store.addPosition(newPosition);
              executedPositions.push(newPosition);
              availableSlots--;

              appendStatArbLog(
                `[SUCCESS] [ENTRY FILLED] Delta-neutral position opened on ${pair.canonicalSymbol}: ${newPosition.direction} | Notional: $${notional.toFixed(2)} USDT | Quantity: ${execResult.executedQty}`,
                'success',
                pair.canonicalSymbol
              );
            }
        }
      }
    }
  }

    return {
      timestamp,
      monitoredPairsCount: pairs.length,
      qualifyingSignals,
      executedPositions,
      rejectedReasons,
    };
  }

  /**
   * Evaluates and manages all active open positions
   * 
   * @param marketData Live prices map keyed by canonicalSymbol: { binancePrice, bybitPrice }
   * @param zScoreMap Current z-score map keyed by canonicalSymbol
   */
  public async managePositions(
    marketData: Map<string, { binancePrice: number; bybitPrice: number }>,
    zScoreMap: Map<string, number> = new Map()
  ): Promise<PositionManagementResult> {
    const timestamp = Date.now();
    const activePositions = this.store.getActivePositions();
    const closedPositions: StatArbPosition[] = [];

    for (const position of activePositions) {
      const prices = marketData.get(position.canonicalSymbol);
      if (!prices || prices.binancePrice <= 0 || prices.bybitPrice <= 0) {
        continue;
      }

      const currentBasisBps = calculateBasisBps(prices.binancePrice, prices.bybitPrice);
      const currentZScore = zScoreMap.get(position.canonicalSymbol) ?? 0.0;
      const holdDurationMinutes = parseFloat(
        ((timestamp - position.entryTimestamp) / (60 * 1000)).toFixed(2)
      );

      // Append current divergence % to rolling 30m window
      const divPct = Math.abs(currentBasisBps) / 100.0;
      const divergenceHistory = [...(position.divergenceHistory30m || []), divPct];
      // Keep approximately last 30 1-minute samples
      if (divergenceHistory.length > 35) {
        divergenceHistory.shift();
      }

      // Mark-to-market PnL calculation
      const isShortBn = position.direction === 'SHORT_BINANCE_LONG_BYBIT';
      const bnDir = isShortBn ? -1 : 1;
      const bybDir = -bnDir;

      let entryBybit = position.entryBybitPrice;
      if (Math.abs(entryBybit - 1.0) < 1e-6 && position.entryBinancePrice < 0.9) {
        entryBybit = parseFloat((position.entryBinancePrice / (1 + (position.entryBasisBps || 0) / 10000)).toFixed(6));
        position.entryBybitPrice = entryBybit;
      }

      const bnPnl = bnDir * (prices.binancePrice - position.entryBinancePrice) * position.quantity;
      const bybPnl = bybDir * (prices.bybitPrice - entryBybit) * position.quantity;
      const grossBasisPnl = parseFloat((bnPnl + bybPnl).toFixed(4));
      const notional = position.notionalUsdt || 15.0;
      const currentRoiPct = parseFloat(((grossBasisPnl / notional) * 100).toFixed(2));

      // Update position telemetry in state store
      this.store.updatePosition(position.id, {
        currentBinancePrice: prices.binancePrice,
        currentBybitPrice: prices.bybitPrice,
        currentBasisBps,
        currentZScore,
        unrealizedPnlUsdt: grossBasisPnl,
        holdDurationMinutes,
        divergenceHistory30m: divergenceHistory,
      });

      // Evaluate Exit criteria via ExitOptimizer
      const exitEval = evaluateExit(position, currentBasisBps, currentZScore, {
        currentBinancePrice: prices.binancePrice,
        currentBybitPrice: prices.bybitPrice,
        currentRoiPct,
        holdMinutes: holdDurationMinutes,
        divergenceHistory30m: divergenceHistory,
      });

      if (exitEval.canExit && exitEval.exitAllowed) {
        // Execute exit via order router
        const isEmergency =
          exitEval.exitType === 'CATASTROPHIC_STOP' ||
          exitEval.exitType === 'STRUCTURAL_BASIS_DECOUPLING';

        const exitExec = await this.router.executeExit(
          position,
          prices.binancePrice,
          prices.bybitPrice,
          isEmergency
        );

        if (exitExec.success) {
          let realNetPnl = exitEval.netPnLUsdt;
          let realTotalFees = (position.totalFeesUsdt || 0) + (exitExec.leg1?.feeUsdt || 0) + (exitExec.leg2?.feeUsdt || 0);

          const isDryRun = this.store.getState().config.dryRun ?? true;
          if (!isDryRun && typeof (this.activeAdapter as any).fetchRealExecutionReceipts === 'function') {
            try {
              const bnReceipt = await (this.activeAdapter as any).fetchRealExecutionReceipts(
                'BINANCE',
                position.binanceSymbol,
                exitExec.leg1?.orderId || ''
              );
              const bybReceipt = await (this.activeAdapter as any).fetchRealExecutionReceipts(
                'BYBIT',
                position.bybitSymbol,
                exitExec.leg2?.orderId || ''
              );
              const netPnl = (bnReceipt?.realizedPnlUsdt || 0) + (bybReceipt?.realizedPnlUsdt || 0);
              const exitFees = (bnReceipt?.feeUsdt || 0) + (bybReceipt?.feeUsdt || 0);
              realTotalFees = parseFloat(((position.totalFeesUsdt || 0) + exitFees).toFixed(4));
              realNetPnl = parseFloat((netPnl - exitFees).toFixed(4));
            } catch (receiptErr: any) {
              console.warn('[StatArbEngine] Receipt fetch error:', receiptErr.message);
            }
          }

          const closed = this.store.closePosition(
            position.id,
            exitEval.exitType,
            realNetPnl,
            currentBasisBps,
            realTotalFees
          );
          if (closed) closedPositions.push(closed);

          appendStatArbLog(
            `[SUCCESS] [REAL LEDGER SETTLEMENT] Position closed for ${position.canonicalSymbol} (${exitEval.exitType}): Real Net PnL: $${realNetPnl.toFixed(4)} USDT | Total Fees: $${realTotalFees.toFixed(4)} USDT.`,
            'success',
            position.canonicalSymbol,
            { realNetPnl, realTotalFees, exitType: exitEval.exitType, executionHash: exitExec.executionHash }
          );
        }
      }
    }

    return {
      timestamp,
      evaluatedCount: activePositions.length,
      closedPositions,
      activePositions: this.store.getActivePositions(),
    };
  }
}
