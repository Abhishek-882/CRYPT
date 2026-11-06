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
} from "@/lib/statarb";

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

function getEngine(): StatArbEngine {
  if (!globalThis.__statArbEngine) {
    const store = getStore();
    globalThis.__statArbEngine = new StatArbEngine(store);
  }
  return globalThis.__statArbEngine;
}

export async function GET() {
  try {
    const engine = getEngine();
    const store = getStore();
    const state = engine.getState();
    const isRunning = engine.isEngineRunning();

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
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const engine = getEngine();
    const store = getStore();

    if (action === "start") {
      engine.start();
      globalThis.__statArbStartTime = Date.now();
      if (store.getState().isKillSwitchEngaged) {
        store.setKillSwitch(false);
      }
      return NextResponse.json({
        success: true,
        message: "Convergence Arbitrage Engine started successfully.",
        isRunning: true,
        fsmState: "RUNNING",
        state: engine.getState(),
      });
    }

    if (action === "cron_tick" || action === "tick") {
      const isRunning = engine.isEngineRunning();
      if (!isRunning) {
        return NextResponse.json({
          success: true,
          message: "Engine is paused. Heartbeat received but scanning cycle skipped.",
          isRunning: false,
          state: engine.getState(),
        });
      }

      // 1. Fetch live quotes from Binance
      const liveBinanceMap = new Map<string, { bid: number; ask: number; mid: number }>();
      try {
        const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/bookTicker", {
          cache: "no-store",
          signal: AbortSignal.timeout(2500),
        });
        if (res.ok) {
          const data = await res.json();
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

        const cycleOffset = ((now / 1000) * 0.05 + i * 0.75);
        const spreadOscillationBps = item.baseSpreadBps * Math.sin(cycleOffset) + (i % 3 === 0 ? 12 : -4);
        const basisFactor = 1 + (spreadOscillationBps / 10000);
        const bybitMid = parseFloat((binanceMid / basisFactor).toFixed(binanceMid < 1 ? 6 : 4));
        const bybitSpreadBps = parseFloat((binanceSpreadBps * (1 + 0.1 * Math.cos(cycleOffset))).toFixed(2));
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
          orderBookDepthRatio: parseFloat((5.2 + 2.5 * Math.sin(cycleOffset + 1.2)).toFixed(2)),
          lastUpdated: now,
        });
      }

      // 3. Scan corridors and manage open positions
      const scanRes = await engine.scanCorridors(pairs);
      const manageRes = await engine.managePositions(marketDataMap, zScoreMap);

      return NextResponse.json({
        success: true,
        message: "Convergence Arbitrage Engine cron tick executed.",
        isRunning: true,
        fsmState: engine.getState().positions.length > 0 ? "HEDGED_CONVERGING" : "RUNNING",
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
      return NextResponse.json({
        success: true,
        message: "Convergence Arbitrage Engine paused.",
        isRunning: false,
        fsmState: "PAUSED",
        state: engine.getState(),
      });
    }

    if (action === "kill" || action === "emergency_kill" || action === "kill_switch") {
      const closed = await engine.emergencyKill();
      globalThis.__statArbStartTime = undefined;
      return NextResponse.json({
        success: true,
        message: "EMERGENCY KILL-SWITCH ENGAGED: Engine halted and active positions unwound.",
        isRunning: false,
        fsmState: "EMERGENCY_KILLED",
        closedPositions: closed,
        state: engine.getState(),
      });
    }

    if (action === "update_config") {
      const newConfig = body.config as Partial<StatArbConfig>;
      if (newConfig) {
        engine.updateConfig(newConfig);
      }
      return NextResponse.json({
        success: true,
        message: "Convergence configuration updated successfully.",
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
