import { NextRequest, NextResponse } from "next/server";
import {
  loadBasisBotState,
  saveBasisBotState,
  appendBasisLog,
  runAutonomousBasisCycle,
  executeBasisTrade,
  unwindBasisPosition,
  scanBasisDislocations,
  BasisBotConfig,
} from "@/lib/basisBotEngine";
import { getAuthenticatedUser, getDecryptedUserApiKeys } from "@/lib/userStore";
import { fetchBybitAccount, BybitCredentials } from "@/lib/bybitSigner";

export const dynamic = "force-dynamic";

/**
 * Global background worker interval permanently deactivated for rate limit protection.
 * 100% of exchange API rate limits are reserved for STATARB-OU-PERP.
 */
let basisDaemonTimer: NodeJS.Timeout | null = null;

function ensureBasisDaemonWorker() {
  if (basisDaemonTimer) {
    clearInterval(basisDaemonTimer);
    basisDaemonTimer = null;
  }
}

// Ensure timer is cleared
ensureBasisDaemonWorker();

/**
 * GET /api/bot/basis/daemon
 * Strict Admin Authentication Gate
 */
export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);

  // Strict Admin Gate: Only admin users (role === "admin") can access this endpoint
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      {
        success: false,
        error: "Forbidden: Administrative privileges required to access the Basis Arbitrage Engine.",
        code: "ADMIN_AUTH_REQUIRED",
      },
      { status: 403 }
    );
  }

  try {
    ensureBasisDaemonWorker();
    const state = loadBasisBotState();

    // Fetch live Bybit Unified Trading Account margin and collateral telemetry
    let bybitAccountSummary = {
      equity: 0,
      available: 0,
      walletBalance: 0,
      unrealizedPnL: 0,
      mmrPct: 2.1, // Safe default MMR
      connected: false,
    };

    try {
      const creds = getDecryptedUserApiKeys(user);
      if (creds?.bybitKey && creds?.bybitSecret) {
        const bybitCreds: BybitCredentials = {
          apiKey: creds.bybitKey,
          apiSecret: creds.bybitSecret,
          proxyUrl: creds.bybitProxy,
          baseUrl: creds.bybitBaseUrl,
        };
        const acct = await fetchBybitAccount(bybitCreds);
        if (acct.success) {
          bybitAccountSummary = {
            equity: acct.equity,
            available: acct.available,
            walletBalance: acct.walletBalance,
            unrealizedPnL: acct.unrealizedPnL,
            mmrPct: acct.walletBalance > 0 ? Math.min(99, Math.max(1, (acct.unrealizedPnL < 0 ? Math.abs(acct.unrealizedPnL) / acct.walletBalance * 100 : 2.1))) : 2.1,
            connected: true,
          };
        }
      }
    } catch {
      // Soft-fail balance lookup so telemetry doesn't break
    }

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, role: user.role },
      state,
      bybitAccount: bybitAccountSummary,
      uptimeSeconds: state.isRunning && state.startedAt > 0 ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to retrieve basis bot state" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bot/basis/daemon
 * Strict Admin Control Endpoint
 */
export async function POST(req: NextRequest) {
  const user = getAuthenticatedUser(req);

  // Strict Admin Gate
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      {
        success: false,
        error: "Forbidden: Administrative privileges required to control the Basis Arbitrage Engine.",
        code: "ADMIN_AUTH_REQUIRED",
      },
      { status: 403 }
    );
  }

  try {
    ensureBasisDaemonWorker();
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const state = loadBasisBotState();

    if (action === "start") {
      state.isRunning = true;
      state.startedAt = Date.now();
      state.fsmState = state.positions.length > 0 ? "POSITION_MANAGEMENT" : "IDLE_MONITORING";
      appendBasisLog("INFO", "BASIS-CORE", "Basis Arbitrage Daemon STARTED by administrator.", state);
      saveBasisBotState(state);

      // Trigger first cycle immediately in background
      runAutonomousBasisCycle().catch(() => {});

      return NextResponse.json({
        success: true,
        message: "Basis Arbitrage Daemon started successfully.",
        state,
      });
    }

    if (action === "stop") {
      state.isRunning = false;
      state.fsmState = "IDLE_MONITORING";
      appendBasisLog("INFO", "BASIS-CORE", "Basis Arbitrage Daemon STOPPED by administrator.", state);
      saveBasisBotState(state);

      return NextResponse.json({
        success: true,
        message: "Basis Arbitrage Daemon stopped.",
        state,
      });
    }

    if (action === "update_config") {
      const newConfig = body.config as Partial<BasisBotConfig>;
      if (newConfig) {
        state.config = {
          ...state.config,
          ...newConfig,
        };
        appendBasisLog(
          "INFO",
          "BASIS-CORE",
          `Engine configuration updated (Live=${state.config.isLive}, MinGross=${state.config.minGrossBasisBps} bps, MinNet=${state.config.minNetBasisBps} bps)`,
          state
        );
        saveBasisBotState(state);
      }
      return NextResponse.json({
        success: true,
        message: "Configuration saved successfully.",
        config: state.config,
        state,
      });
    }

    if (action === "execute_trade") {
      const symbol = body.symbol || "BTCUSDT";
      const signals = await scanBasisDislocations([symbol], state.config);
      const signal = signals[symbol];

      if (!signal) {
        return NextResponse.json(
          { success: false, error: `Could not fetch live orderbook and ticker for ${symbol}` },
          { status: 400 }
        );
      }

      const tradeResult = await executeBasisTrade(symbol, signal, state.config, user.id);
      if (tradeResult.success && tradeResult.position) {
        state.positions.push(tradeResult.position);
        state.fsmState = "POSITION_MANAGEMENT";
        saveBasisBotState(state);
        return NextResponse.json({
          success: true,
          message: `Cash-and-carry trade executed for ${symbol}.`,
          position: tradeResult.position,
          state,
        });
      } else {
        return NextResponse.json(
          { success: false, error: tradeResult.error || "Execution failed" },
          { status: 400 }
        );
      }
    }

    if (action === "unwind_position") {
      const positionId = body.positionId;
      const reason = body.reason || "ADMIN_MANUAL_UNWIND";

      if (!positionId) {
        return NextResponse.json({ success: false, error: "positionId is required" }, { status: 400 });
      }

      const result = await unwindBasisPosition(positionId, reason, user.id);
      if (result.success) {
        const freshState = loadBasisBotState();
        return NextResponse.json({
          success: true,
          message: `Position ${positionId} unwound successfully.`,
          position: result.position,
          state: freshState,
        });
      } else {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }
    }

    if (action === "clear_logs") {
      state.logs = [];
      saveBasisBotState(state);
      return NextResponse.json({ success: true, message: "Logs cleared.", state });
    }

    if (action === "run_cycle") {
      await runAutonomousBasisCycle();
      const freshState = loadBasisBotState();
      return NextResponse.json({ success: true, message: "Autonomous cycle executed.", state: freshState });
    }

    return NextResponse.json(
      { success: false, error: `Unrecognized action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to process daemon command" },
      { status: 500 }
    );
  }
}
