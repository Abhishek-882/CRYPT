import { NextRequest, NextResponse } from "next/server";
import {
  loadPaperWallet,
  resetPaperWallet,
  loadPaperPositions,
  closePaperPosition,
  updatePaperPositionsPrices,
} from "@/lib/paperTradingEngine";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const creds = resolveCallerCredentials(req);
  const userId = creds.user?.id || (creds.isAdmin ? "usr_admin_varsha" : "global_default");

  const wallet = loadPaperWallet(userId);
  const positions = loadPaperPositions(userId, "OPEN");

  return NextResponse.json({
    success: true,
    wallet,
    positions,
    count: positions.length,
  });
}

export async function POST(req: NextRequest) {
  const creds = resolveCallerCredentials(req);
  if (!creds.user && !creds.isAdmin) {
    return NextResponse.json(
      { success: false, error: "Authentication required for paper portfolio management." },
      { status: 401 }
    );
  }
  const userId = creds.user?.id || (creds.isAdmin ? "usr_admin_varsha" : "global_default");

  try {
    const body = await req.json();
    const action = body.action || "get";

    if (action === "reset") {
      const freshWallet = resetPaperWallet(userId);
      return NextResponse.json({
        success: true,
        message: "Paper wallet reset to $10,000.00 USDT successfully.",
        wallet: freshWallet,
        positions: [],
      });
    }

    if (action === "close") {
      const target = body.positionId || body.symbol || "ALL";
      const liveBnPrice = parseFloat(body.liveBnPrice || "0");
      const liveBgPrice = parseFloat(body.liveBgPrice || "0");

      const result = closePaperPosition(target, liveBnPrice, liveBgPrice, userId);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 400 });
      }

      const openPositions = loadPaperPositions(userId, "OPEN");
      return NextResponse.json({
        success: true,
        closedPosition: result.closedPosition,
        wallet: result.wallet,
        positions: openPositions,
      });
    }

    if (action === "update_ticks") {
      const priceMap = body.priceMap || {};
      const result = updatePaperPositionsPrices(priceMap, userId);
      return NextResponse.json({
        success: true,
        wallet: result.wallet,
        positions: result.positions,
      });
    }

    return NextResponse.json(
      { success: false, error: `Unsupported action '${action}'.` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to process paper trading request." },
      { status: 500 }
    );
  }
}
