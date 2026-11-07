import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

/**
 * GET /api/bot/basis/radar
 * Route permanently decommissioned for rate limit protection.
 * 100% of exchange API rate limits are dedicated to STATARB-OU-PERP.
 */
export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);

  if (!user || user.role !== "admin") {
    return NextResponse.json(
      {
        success: false,
        error: "Forbidden: Administrative privileges required.",
        code: "ADMIN_AUTH_REQUIRED",
      },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Radar scanner permanently shut down. 100% of exchange API rate limits are reserved for STATARB-OU-PERP.",
    signals: {},
    summary: {
      totalMonitored: 0,
      qualifyingCount: 0,
      averageGrossBasisBps: 0,
      scannedAt: Date.now(),
    },
    rateLimitSavings: "Over 30 individual REST calls eliminated per sweep",
  });
}
