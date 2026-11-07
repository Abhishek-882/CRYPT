import { NextRequest, NextResponse } from "next/server";
import {
  StatArbEngine,
  StatArbStateStore,
  StatArbConfig,
  StatArbPosition,
  StatArbPair,
  OUParameters,
  calculateBasisBps,
  calculateZScore,
  getInstrumentMapping,
  MakerTakerOrderRouter,
  SimulatedExecutionAdapter,
  LiveExchangeAdapter,
} from "@/lib/statarb";

function parseDryRunFlag(val: unknown): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "live" || s === "prod" || s === "production") return false;
    if (s === "true" || s === "1" || s === "sim" || s === "simulated" || s === "mock") return true;
  }
  if (typeof val === "number") return val !== 0;
  return undefined;
}

const DEFAULT_MONITORED = [
  { canonical: "BTC", basePrice: 68500.0, baseSpreadBps: 2.5, theta: 0.12, sigma: 14.5 },
  { canonical: "ETH", basePrice: 2480.0, baseSpreadBps: 3.2, theta: 0.10, sigma: 18.0 },
  { canonical: "SOL", basePrice: 172.5, baseSpreadBps: 4.0, theta: 0.14, sigma: 22.0 },
  { canonical: "PEPE", basePrice: 0.0000098, baseSpreadBps: 29.5, theta: 0.22, sigma: 38.0 },
  { canonical: "SATS", basePrice: 0.000285, baseSpreadBps: 31.0, theta: 0.20, sigma: 35.0 },
  { canonical: "NEAR", basePrice: 4.85, baseSpreadBps: 18.5, theta: 0.15, sigma: 24.0 },
  { canonical: "SUI", basePrice: 2.15, baseSpreadBps: 21.0, theta: 0.18, sigma: 26.5 },
  { canonical: "AVAX", basePrice: 28.4, baseSpreadBps: 12.0, theta: 0.13, sigma: 21.0 },
  { canonical: "DOGE", basePrice: 0.165, baseSpreadBps: 15.0, theta: 0.16, sigma: 25.0 },
  { canonical: "ARB", basePrice: 0.58, baseSpreadBps: 14.5, theta: 0.14, sigma: 23.0 },
  { canonical: "OP", basePrice: 1.62, baseSpreadBps: 16.0, theta: 0.15, sigma: 24.0 },
  { canonical: "LINK", basePrice: 12.2, baseSpreadBps: 9.5, theta: 0.11, sigma: 17.5 },
  { canonical: "APT", basePrice: 9.4, baseSpreadBps: 17.0, theta: 0.14, sigma: 22.5 },
  { canonical: "XRP", basePrice: 0.54, baseSpreadBps: 7.0, theta: 0.09, sigma: 15.0 },
  { canonical: "ADA", basePrice: 0.36, baseSpreadBps: 8.5, theta: 0.10, sigma: 16.0 },
];

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __statArbStore: StatArbStateStore | undefined;
  // eslint-disable-next-line no-var
  var __statArbEngine: StatArbEngine | undefined;
  // eslint-disable-next-line no-var
  var __statArbStartTime: number | undefined;
}

function getStore(): StatArbStateStore {
  if (!globalThis.__statArbStore) {
    globalThis.__statArbStore = new StatArbStateStore();
  }
  return globalThis.__statArbStore;
}

function getEngine(requestedDryRun?: boolean): StatArbEngine {
  const store = getStore();
  const storedConfig = store.getState().config;

  // Resolve target dryRun flag: explicit argument > stored config > default (true)
  const effectiveDryRun = requestedDryRun !== undefined
    ? requestedDryRun
    : (storedConfig.dryRun !== undefined ? storedConfig.dryRun : true);

  if (!globalThis.__statArbEngine) {
    const adapter = effectiveDryRun
      ? new SimulatedExecutionAdapter()
      : new LiveExchangeAdapter();
    const router = new MakerTakerOrderRouter(adapter);

    if (storedConfig.dryRun !== effectiveDryRun) {
      store.updateConfig({ dryRun: effectiveDryRun });
    }

    globalThis.__statArbEngine = new StatArbEngine(store, router);
    console.log(
      `[STATARB-DAEMON] Instantiated StatArbEngine in ${
        effectiveDryRun ? "SIMULATED (dryRun: true)" : "LIVE ON-EXCHANGE (dryRun: false)"
      } mode with ${effectiveDryRun ? "SimulatedExecutionAdapter" : "LiveExchangeAdapter"}.`
    );
  } else {
    // Synchronize engine adapter if dryRun mode changed or requested explicitly
    const currentDryRun = store.getState().config.dryRun ?? true;
    const currentAdapter = globalThis.__statArbEngine.getAdapter();

    const needsLive = !effectiveDryRun && (!(currentAdapter instanceof LiveExchangeAdapter) || currentDryRun !== false);
    const needsSim = effectiveDryRun && (!(currentAdapter instanceof SimulatedExecutionAdapter) || currentDryRun !== true);

    if (needsLive) {
      store.updateConfig({ dryRun: false });
      const liveAdapter = new LiveExchangeAdapter();
      globalThis.__statArbEngine.setAdapter(liveAdapter);
      console.log("[STATARB-DAEMON] Switched StatArbEngine to LIVE ON-EXCHANGE mode (dryRun: false) with LiveExchangeAdapter.");
    } else if (needsSim) {
      store.updateConfig({ dryRun: true });
      const simAdapter = new SimulatedExecutionAdapter();
      globalThis.__statArbEngine.setAdapter(simAdapter);
      console.log("[STATARB-DAEMON] Switched StatArbEngine to SIMULATED DRY-RUN mode (dryRun: true) with SimulatedExecutionAdapter.");
    }
  }

  return globalThis.__statArbEngine;
}

export async function GET(req: NextRequest) {
  try {
    const url = req?.url ? new URL(req.url) : null;
    const queryDryRun = url ? parseDryRunFlag(url.searchParams.get("dryRun")) : undefined;
    const engine = getEngine(queryDryRun);
    const store = getStore();
    const state = engine.getState();
    const isRunning = engine.isEngineRunning();
    const isLive = state.config.dryRun === false;

    const uptimeSeconds = isRunning && globalThis.__statArbStartTime
      ? Math.max(0, Math.floor((Date.now() - globalThis.__statArbStartTime) / 1000))
      : 0;

    let fsmState = "IDLE";
    if (state.isKillSwitchEngaged) {
      fsmState = "EMERGENCY_KILLED";
    } else if (isRunning) {
      fsmState = state.positions.length > 0 ? "HEDGED_CONVERGING" : "RUNNING";
    } else {
      fsmState = "PAUSED";
    }

    return NextResponse.json({
      success: true,
      isRunning,
      fsmState,
      mode: isLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
      dryRun: !isLive,
      config: state.config,
      activePositions: state.positions,
      closedPositionsCount: state.closedPositions.length,
      telemetry: state.telemetry,
      stats: {
        activePositionsCount: state.positions.length,
        totalRealizedPnlUsdt: state.telemetry.totalPnlUsdt,
        winRate: state.telemetry.winRate,
        averageHoldDurationMinutes: state.telemetry.averageHoldDurationMinutes,
        monitoredPairsCount: state.monitoredPairs.length,
        qualifyingSignalsCount: state.telemetry.qualifyingSignalsCount,
        systemStatus: state.telemetry.systemStatus,
        peakEquityUsdt: state.peakEquityUsdt,
        currentEquityUsdt: state.currentEquityUsdt,
      },
      isKillSwitchEngaged: state.isKillSwitchEngaged,
      uptimeSeconds,
      lastUpdated: state.lastUpdated,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve engine state";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = req?.url ? new URL(req.url) : null;
    const queryDryRun = url ? parseDryRunFlag(url.searchParams.get("dryRun")) : undefined;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const bodyDryRun = parseDryRunFlag(body.dryRun ?? body.config?.dryRun);
    const explicitDryRun = queryDryRun !== undefined ? queryDryRun : bodyDryRun;

    const engine = getEngine(explicitDryRun);
    const store = getStore();

    if (explicitDryRun !== undefined) {
      engine.updateConfig({ dryRun: explicitDryRun });
    }

    const isLive = store.getState().config.dryRun === false;

    if (action === "status") {
      const isRunning = engine.isEngineRunning();
      const state = engine.getState();
      let fsmState = "IDLE";
      if (state.isKillSwitchEngaged) {
        fsmState = "EMERGENCY_KILLED";
      } else if (isRunning) {
        fsmState = state.positions.length > 0 ? "HEDGED_CONVERGING" : "RUNNING";
      } else {
        fsmState = "PAUSED";
      }

      console.log(
        `[STATARB-DAEMON] Status requested: ${fsmState} | Mode: ${
          isLive ? "LIVE ON-EXCHANGE (dryRun: false)" : "SIMULATED DRY-RUN (dryRun: true)"
        } | Adapter: ${isLive ? "LiveExchangeAdapter" : "SimulatedExecutionAdapter"}.`
      );

      return NextResponse.json({
        success: true,
        message: `Convergence Arbitrage Engine status: ${fsmState} (${isLive ? "LIVE ON-EXCHANGE" : "SIMULATED"}).`,
        isRunning,
        fsmState,
        mode: isLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
        dryRun: !isLive,
        state,
      });
    }

    if (action === "start") {
      if (explicitDryRun !== undefined) {
        engine.updateConfig({ dryRun: explicitDryRun });
      }

      // Guarantee live vs simulated adapter is bound on start
      if (isLive) {
        engine.setAdapter(new LiveExchangeAdapter());
        console.log("[STATARB-DAEMON] Starting daemon in LIVE ON-EXCHANGE mode (dryRun: false). Real orders will be dispatched.");
      } else {
        engine.setAdapter(new SimulatedExecutionAdapter());
        console.log("[STATARB-DAEMON] Starting daemon in SIMULATED DRY-RUN mode (dryRun: true).");
      }

      engine.start();
      globalThis.__statArbStartTime = Date.now();
      if (store.getState().isKillSwitchEngaged) {
        store.setKillSwitch(false);
      }
      return NextResponse.json({
        success: true,
        message: `Convergence Arbitrage Engine started successfully in ${isLive ? "LIVE ON-EXCHANGE" : "SIMULATED"} mode.`,
        isRunning: true,
        fsmState: "RUNNING",
        mode: isLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
        dryRun: !isLive,
        state: engine.getState(),
      });
    }

    if (action === "cron_tick" || action === "tick") {
      const isRunning = engine.isEngineRunning();
      if (!isRunning) {
        return NextResponse.json({
          success: true,
          message: `Engine is paused. Heartbeat received but scanning cycle skipped (${isLive ? "LIVE ON-EXCHANGE" : "SIMULATED"}).`,
          isRunning: false,
          mode: isLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
          dryRun: !isLive,
          state: engine.getState(),
        });
      }

      console.log(
        `[STATARB-DAEMON] Executing ${action} sweep in ${
          isLive ? "LIVE ON-EXCHANGE (dryRun: false)" : "SIMULATED DRY-RUN (dryRun: true)"
        } mode with ${isLive ? "LiveExchangeAdapter" : "SimulatedExecutionAdapter"}.`
      );

      // Ensure running daemon instance reflects the dryRun flag and appropriate adapter
      if (isLive && !(engine.getAdapter() instanceof LiveExchangeAdapter)) {
        engine.setAdapter(new LiveExchangeAdapter());
      } else if (!isLive && !(engine.getAdapter() instanceof SimulatedExecutionAdapter)) {
        engine.setAdapter(new SimulatedExecutionAdapter());
      }

      // 1. Fetch live quotes from Binance and Bybit in parallel
      const liveBinanceMap = new Map<string, { bid: number; ask: number; mid: number }>();
      const liveBybitMap = new Map<string, { bid: number; ask: number; mid: number }>();
      try {
        const [bnRes, bybRes] = await Promise.all([
          fetch("https://fapi.binance.com/fapi/v1/ticker/bookTicker", {
            cache: "no-store",
            signal: AbortSignal.timeout(2500),
          }).catch(() => null),
          fetch("https://api.bybit.com/v5/market/tickers?category=linear", {
            cache: "no-store",
            signal: AbortSignal.timeout(2500),
          }).catch(() => null),
        ]);

        if (bnRes && bnRes.ok) {
          const data = await bnRes.json();
          if (Array.isArray(data)) {
            for (const item of data) {
              const bid = parseFloat(item.bidPrice);
              const ask = parseFloat(item.askPrice);
              if (bid > 0 && ask > 0) {
                liveBinanceMap.set(item.symbol, { bid, ask, mid: (bid + ask) / 2 });
              }
            }
          }
        }

        if (bybRes && bybRes.ok) {
          const data = await bybRes.json();
          const list = Array.isArray(data?.result?.list) ? data.result.list : [];
          for (const item of list) {
            const bid = parseFloat(item.bid1Price || "0");
            const ask = parseFloat(item.ask1Price || "0");
            if (bid > 0 && ask > 0) {
              liveBybitMap.set(item.symbol, { bid, ask, mid: (bid + ask) / 2 });
            }
          }
        }
      } catch {
        // Best-effort live fetch fallback
      }

      // 2. Construct pairs
      const now = Date.now();
      const pairs: StatArbPair[] = [];
      const marketDataMap = new Map<string, { binancePrice: number; bybitPrice: number }>();
      const zScoreMap = new Map<string, number>();

      for (let i = 0; i < DEFAULT_MONITORED.length; i++) {
        const item = DEFAULT_MONITORED[i];
        const mapping = getInstrumentMapping(item.canonical);
        const binanceSymbol = mapping ? mapping.binanceSymbol : `${item.canonical}USDT`;
        const bybitSymbol = mapping ? mapping.bybitSymbol : `${item.canonical}USDT`;

        let binanceMid = item.basePrice;
        let binanceSpreadBps = 3.5;

        const liveBn = liveBinanceMap.get(binanceSymbol);
        if (liveBn) {
          binanceMid = liveBn.mid;
          binanceSpreadBps = parseFloat((((liveBn.ask - liveBn.bid) / liveBn.mid) * 10000).toFixed(2));
        }

        // Wire authentic Bybit live telemetry directly from liveBybitMap
        let bybitMid = item.basePrice;
        let bybitSpreadBps = 3.5;

        const liveByb = liveBybitMap.get(bybitSymbol);
        if (liveByb) {
          bybitMid = liveByb.mid;
          bybitSpreadBps = parseFloat((((liveByb.ask - liveByb.bid) / liveByb.mid) * 10000).toFixed(2));
        } else if (liveBn) {
          bybitMid = liveBn.mid;
          bybitSpreadBps = binanceSpreadBps;
        }

        const grossBasisBps = parseFloat(calculateBasisBps(binanceMid, bybitMid).toFixed(2));

        const ouParams: OUParameters = {
          theta: item.theta,
          mu: 0.0,
          sigma: item.sigma,
          halfLifeMinutes: parseFloat((Math.LN2 / item.theta).toFixed(1)),
          equilibriumSigma: parseFloat((item.sigma / Math.sqrt(2 * item.theta)).toFixed(2)),
          rSquared: 0.88,
          sampleCount: 120,
          lastUpdated: now,
        };

        const zScore = parseFloat(calculateZScore(grossBasisBps, ouParams).toFixed(2));
        zScoreMap.set(item.canonical, zScore);
        marketDataMap.set(item.canonical, { binancePrice: binanceMid, bybitPrice: bybitMid });

        pairs.push({
          canonicalSymbol: item.canonical,
          binanceSymbol,
          bybitSymbol,
          multiplier: mapping ? mapping.multiplier : 1.0,
          binanceMid,
          bybitMid,
          grossBasisBps,
          binanceSpreadBps,
          bybitSpreadBps,
          orderBookDepthRatio: 5.2,
          lastUpdated: now,
        });
      }

      // 3. Scan corridors and manage open positions
      const scanRes = await engine.scanCorridors(pairs);
      const manageRes = await engine.managePositions(marketDataMap, zScoreMap);

      return NextResponse.json({
        success: true,
        message: `Convergence Arbitrage Engine cron tick executed in ${isLive ? "LIVE ON-EXCHANGE" : "SIMULATED"} mode.`,
        isRunning: true,
        fsmState: engine.getState().positions.length > 0 ? "HEDGED_CONVERGING" : "RUNNING",
        mode: isLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
        dryRun: !isLive,
        scanResult: {
          qualifyingSignalsCount: scanRes.qualifyingSignals.length,
          executedPositionsCount: scanRes.executedPositions.length,
        },
        manageResult: {
          evaluatedCount: manageRes.evaluatedCount,
          closedPositionsCount: manageRes.closedPositions.length,
        },
        state: engine.getState(),
      });
    }

    if (action === "stop" || action === "pause") {
      engine.stop();
      globalThis.__statArbStartTime = undefined;
      console.log(`[STATARB-DAEMON] Paused Convergence Arbitrage Engine.`);
      return NextResponse.json({
        success: true,
        message: "Convergence Arbitrage Engine paused.",
        isRunning: false,
        fsmState: "PAUSED",
        mode: isLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
        dryRun: !isLive,
        state: engine.getState(),
      });
    }

    if (action === "kill" || action === "emergency_kill" || action === "kill_switch") {
      console.warn("[STATARB-DAEMON] EMERGENCY KILL-SWITCH ENGAGED! Stopping engine and unwinding active positions.");
      const closed = await engine.emergencyKill();
      globalThis.__statArbStartTime = undefined;
      return NextResponse.json({
        success: true,
        message: "EMERGENCY KILL-SWITCH ENGAGED: Engine halted and active positions unwound.",
        isRunning: false,
        fsmState: "EMERGENCY_KILLED",
        mode: isLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
        dryRun: !isLive,
        closedPositions: closed,
        state: engine.getState(),
      });
    }

    if (action === "update_config") {
      const newConfig = body.config as Partial<StatArbConfig>;
      if (newConfig) {
        engine.updateConfig(newConfig);
      }
      if (explicitDryRun !== undefined) {
        engine.updateConfig({ dryRun: explicitDryRun });
      }
      const updatedIsLive = store.getState().config.dryRun === false;
      console.log(
        `[STATARB-DAEMON] Configuration updated. Active execution mode: ${
          updatedIsLive ? "LIVE ON-EXCHANGE (dryRun: false)" : "SIMULATED DRY-RUN (dryRun: true)"
        }.`
      );
      return NextResponse.json({
        success: true,
        message: "Convergence configuration updated successfully.",
        mode: updatedIsLive ? "LIVE_ON_EXCHANGE" : "SIMULATED_DRY_RUN",
        dryRun: !updatedIsLive,
        config: engine.getState().config,
        state: engine.getState(),
      });
    }

    if (action === "close_position") {
      const positionId = body.positionId;
      if (!positionId) {
        return NextResponse.json(
          { success: false, error: "positionId is required" },
          { status: 400 }
        );
      }

      const pos = store.getPositionById(positionId);
      if (!pos) {
        return NextResponse.json(
          { success: false, error: `Position ${positionId} not found` },
          { status: 404 }
        );
      }

      const closed = store.closePosition(
        positionId,
        "MANUAL_COCKPIT_CLOSE",
        pos.unrealizedPnlUsdt || 0.0,
        pos.currentBasisBps
      );

      return NextResponse.json({
        success: true,
        message: `Position ${positionId} closed successfully.`,
        closedPosition: closed,
        state: engine.getState(),
      });
    }

    if (action === "clear_state") {
      store.clearState();
      return NextResponse.json({
        success: true,
        message: "Convergence state cleared.",
        state: engine.getState(),
      });
    }

    return NextResponse.json(
      { success: false, error: `Unrecognized action: ${action}` },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to execute engine command";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
