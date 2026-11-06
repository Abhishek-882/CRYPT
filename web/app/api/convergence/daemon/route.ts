import { NextRequest, NextResponse } from "next/server";
import {
  StatArbEngine,
  StatArbStateStore,
  StatArbConfig,
  StatArbPosition,
} from "@/lib/statarb";

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
