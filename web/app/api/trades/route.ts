import { NextRequest, NextResponse } from "next/server";
import { loadTrades, saveTrades, recordServerTrade, isRealMainnetTrade } from "@/lib/serverTradeStore";
import { getAuthenticatedUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required to view trade history." }, { status: 401 });
  }
  const userId = user.id;
  const trades = loadTrades(userId, true);

  const mainnetTrades = trades.filter((t) => isRealMainnetTrade(t));
  const simulationTrades = trades.filter((t) => !isRealMainnetTrade(t));

  const now = new Date();
  const isToday = (ts: number) => {
    if (!ts) return false;
    const d = new Date(ts);
    const isSameUtcDay =
      d.getUTCFullYear() === now.getUTCFullYear() &&
      d.getUTCMonth() === now.getUTCMonth() &&
      d.getUTCDate() === now.getUTCDate();
    const isSameLocalDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return isSameUtcDay || isSameLocalDay || (now.getTime() - ts <= 86400000);
  };

  const todayMainnetTrades = mainnetTrades.filter((t) => isToday(t.closeTimestamp || t.timestamp || 0));
  const todayRealizedPnl = parseFloat(todayMainnetTrades.reduce((acc, t) => acc + (t.realizedPnl || 0), 0).toFixed(4));
  const todayFundingClaimed = parseFloat(todayMainnetTrades.reduce((acc, t) => acc + (t.fundingClaimedUsdt || 0), 0).toFixed(4));
  const todayNotional = parseFloat(todayMainnetTrades.reduce((acc, t) => acc + (t.notionalUsdt || 0), 0).toFixed(2));

  return NextResponse.json(
    {
      success: true,
      count: trades.length,
      trades,
      mainnetTrades,
      simulationTrades,
      mainnetCount: mainnetTrades.length,
      simulationCount: simulationTrades.length,
      todaySummary: {
        realizedPnl: todayRealizedPnl,
        fundingClaimed: todayFundingClaimed,
        notional: todayNotional,
        tradesCount: todayMainnetTrades.length,
      },
      userId,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const user = getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ success: false, error: "Authentication required to record or clear trades." }, { status: 401 });
    }
    const userId = user.id;
    const body = await req.json();

    if (body.action === "clear_simulation" || body.action === "clear_paper") {
      const current = loadTrades(userId);
      const remaining = current.filter((t) => isRealMainnetTrade(t));
      saveTrades(remaining, userId);
      return NextResponse.json({ success: true, count: remaining.length, trades: remaining, userId });
    }

    if (body.action === "clear_mainnet") {
      const current = loadTrades(userId);
      const remaining = current.filter((t) => !isRealMainnetTrade(t));
      saveTrades(remaining, userId);
      return NextResponse.json({ success: true, count: remaining.length, trades: remaining, userId });
    }

    if (body.action === "clear") {
      saveTrades([], userId);
      return NextResponse.json({ success: true, count: 0, trades: [], userId });
    }

    const trade = recordServerTrade(body, userId);

    return NextResponse.json({
      success: true,
      trade,
      userId,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
