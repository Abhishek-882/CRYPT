import { NextRequest, NextResponse } from "next/server";
import { scanBasisDislocations, loadBasisBotState, HIGH_PRIORITY_PAIRS } from "@/lib/basisBotEngine";
import { getAuthenticatedUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

/**
 * GET /api/bot/basis/radar
 * Live Multi-Pair Dislocation Scanner & 5-Gate Telemetry Provider
 * Protected by Strict Admin Authentication
 */
export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);

  // Strict Admin Gate
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      {
        success: false,
        error: "Forbidden: Administrative privileges required to access the Basis Radar Scanner.",
        code: "ADMIN_AUTH_REQUIRED",
      },
      { status: 403 }
    );
  }

  try {
    const searchParams = req.nextUrl.searchParams;
    const symbolsParam = searchParams.get("symbols");
    const state = loadBasisBotState();

    const symbols = symbolsParam
      ? symbolsParam.split(",").map((s) => s.trim().toUpperCase())
      : state.config.targetPairs && state.config.targetPairs.length > 0
      ? state.config.targetPairs
      : HIGH_PRIORITY_PAIRS;

    // 1. Scan Bybit Spot vs Linear Perpetual dislocations and evaluate 5 gates
    const signals = await scanBasisDislocations(symbols, state.config);

    // 2. Query Binance Futures funding rates in parallel for cross-exchange arbitrage telemetry
    try {
      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, {
              cache: "no-store",
              signal: AbortSignal.timeout(3000),
            });
            const data = await res.json().catch(() => null);
            if (data && data.lastFundingRate !== undefined && signals[symbol]) {
              const binanceRate = parseFloat(data.lastFundingRate);
              signals[symbol].binanceFundingRate8h = binanceRate;
              // Funding delta in bps = (Bybit Rate - Binance Rate) * 10,000
              const delta = (signals[symbol].bybitFundingRate8h - binanceRate) * 10000;
              signals[symbol].fundingDeltaBps = Math.round(delta * 10) / 10;
            }
          } catch {
            // Silently fallback if Binance query fails
          }
        })
      );
    } catch {
      // Best-effort cross-exchange funding lookup
    }

    return NextResponse.json({
      success: true,
      signals,
      symbols,
      serverTime: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to scan basis dislocations" },
      { status: 500 }
    );
  }
}
