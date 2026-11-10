/**
 * Divergence Bot: Daemon Lifecycle Control & Telemetry API Route
 * Location: web/app/api/divergence/daemon/route.ts
 * 
 * Invariants Enforced:
 * 1. ZERO BPS NOTATION: All spreads, basis, hurdles, and fees formatted in % notation.
 * 2. STRICT BAN ON LEGACY REFERENCES: Zero mentions of legacy bots or deprecated venues.
 * 3. PARAMETERIZED LOCK ISOLATION: Exclusively binds data/divergence_daemon.lock.
 * 4. Next.js App Router TS2344 Compliance: export const dynamic = 'force-dynamic'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDivergenceStateStore } from '@/lib/divergence/store/stateStore';
import { getDivergenceEngine, DivergenceEngine } from '@/lib/divergence/engine';
import {
  DivergenceDaemonStatusResponse,
  DivergenceDaemonCommand,
  DivergenceStateSchema,
} from '@/lib/divergence/types';
import {
  acquireDaemonLock,
  releaseDaemonLock,
  updateDaemonLockHeartbeat,
  isDaemonRunning,
  startHeartbeatCron,
  stopHeartbeatCron,
} from '@/lib/daemonLockManager';
import { getAuthenticatedUser } from '@/lib/userStore';

export const dynamic = 'force-dynamic';

const DIVERGENCE_LOCK_FILE = 'divergence_daemon.lock';

declare global {
  // eslint-disable-next-line no-var
  var __divergenceStartTime: number | undefined;
}

function isAuthorized(req: NextRequest): boolean {
  const user = getAuthenticatedUser(req);
  if (user) {
    return true;
  }
  const cronSecretHeader = req.headers.get('x-cron-secret');
  const cronSecretEnv = process.env.CRON_SECRET;
  if (cronSecretEnv && cronSecretHeader && cronSecretHeader === cronSecretEnv) {
    return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const store = getDivergenceStateStore();
    const engine = getDivergenceEngine();
    const state: DivergenceStateSchema = store.getState();
    const isRunning = engine.isEngineRunning();
    const fsmState = engine.getFsmState();
    const activePositions = store.getActivePositions();
    const startTime = globalThis.__divergenceStartTime;
    const uptimeSeconds = isRunning && startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

    const lockActive = isDaemonRunning({ lockFileName: DIVERGENCE_LOCK_FILE });

    const telemetry = {
      ...state.telemetry,
      activePositionsCount: activePositions.length,
      closedPositionsCount: state.closedPositions.length,
      lockStatus: {
        isLocked: lockActive,
        pid: process.pid,
      },
    };

    const response: DivergenceDaemonStatusResponse = {
      success: true,
      isRunning,
      fsmState,
      mode: state.config.dryRun ? 'SIMULATED_DRY_RUN' : 'LIVE_ON_EXCHANGE',
      dryRun: state.config.dryRun ?? false,
      uptimeSeconds,
      cycleCount: state.telemetry.cycleCount || 0,
      activePositions,
      config: state.config,
      telemetry,
      lastUpdated: state.lastUpdated,
    };

    return NextResponse.json(response, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error in Divergence Daemon GET';
    return NextResponse.json(
      {
        success: false,
        isRunning: false,
        fsmState: 'PAUSED',
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as DivergenceDaemonCommand;
    const action = body.action;
    const store = getDivergenceStateStore();
    const engine = getDivergenceEngine();

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'MISSING_ACTION', message: 'Action parameter is required.' },
        { status: 400 }
      );
    }

    if (action === 'start') {
      // 1. Parameterized Concurrency Lock Acquisition
      const lockRes = acquireDaemonLock({
        lockFileName: DIVERGENCE_LOCK_FILE,
        throwOnCollision: false,
      });

      if (!lockRes.acquired) {
        return NextResponse.json(
          {
            success: false,
            error: 'LOCK_COLLISION',
            message: `Another Divergence daemon process is already active under PID ${lockRes.pid || 'unknown'}.`,
          },
          { status: 409 }
        );
      }

      // 2. Start Heartbeat Cron & Engine
      startHeartbeatCron({ lockFileName: DIVERGENCE_LOCK_FILE, intervalMs: 15000 });
      globalThis.__divergenceStartTime = Date.now();
      engine.start();

      return NextResponse.json({
        success: true,
        message: 'Divergence Strategy Engine started successfully.',
        isRunning: true,
        fsmState: engine.getFsmState(),
        state: store.getState(),
      });
    }

    if (action === 'stop' || action === 'pause') {
      engine.stop();
      globalThis.__divergenceStartTime = undefined;
      stopHeartbeatCron({ lockFileName: DIVERGENCE_LOCK_FILE });
      releaseDaemonLock({ lockFileName: DIVERGENCE_LOCK_FILE });

      return NextResponse.json({
        success: true,
        message: 'Divergence Strategy Engine paused.',
        isRunning: false,
        fsmState: 'PAUSED',
        state: store.getState(),
      });
    }

    if (action === 'tick') {
      updateDaemonLockHeartbeat({ lockFileName: DIVERGENCE_LOCK_FILE });
      const tickRes = await engine.tick();

      return NextResponse.json({
        success: true,
        message: 'Divergence Strategy Engine sweep cycle executed.',
        isRunning: engine.isEngineRunning(),
        fsmState: engine.getFsmState(),
        tickResult: tickRes,
        state: store.getState(),
      });
    }

    if (action === 'update_config') {
      if (!body.config || typeof body.config !== 'object') {
        return NextResponse.json(
          { success: false, error: 'INVALID_CONFIG', message: 'Config payload is required for update_config.' },
          { status: 400 }
        );
      }

      const updated = engine.updateConfig(body.config);

      return NextResponse.json({
        success: true,
        message: 'Divergence configuration updated and sanitized successfully.',
        config: updated,
      });
    }

    if (action === 'emergency_kill') {
      const closed = await engine.emergencyKill();
      globalThis.__divergenceStartTime = undefined;
      releaseDaemonLock({ lockFileName: DIVERGENCE_LOCK_FILE });

      return NextResponse.json({
        success: true,
        message: 'EMERGENCY KILL-SWITCH ENGAGED: Engine halted and all active positions unwound with reduceOnly: true.',
        isRunning: false,
        fsmState: 'EMERGENCY_KILLED',
        closedPositions: closed,
      });
    }

    if (action === 'close_position') {
      if (!body.positionId) {
        return NextResponse.json(
          { success: false, error: 'MISSING_POSITION_ID', message: 'positionId is required to close a specific position.' },
          { status: 400 }
        );
      }

      const closed = await engine.closePosition(body.positionId);
      if (!closed) {
        return NextResponse.json(
          { success: false, error: 'POSITION_NOT_FOUND', message: `Active position ${body.positionId} not found.` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Position ${body.positionId} closed with reduceOnly: true.`,
        closedPosition: closed,
      });
    }

    return NextResponse.json(
      { success: false, error: 'UNKNOWN_ACTION', message: `Action '${action}' is not supported.` },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error in Divergence Daemon POST';
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR', message },
      { status: 500 }
    );
  }
}
