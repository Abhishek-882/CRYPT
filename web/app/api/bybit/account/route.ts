import { NextRequest, NextResponse } from "next/server";
import { fetchBybitAccount } from "@/lib/bybitSigner";
import { logServerEvent } from "@/lib/logger";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const creds = resolveCallerCredentials(req);
    const tradingMode = (
      req.headers.get("x-trading-mode") ||
      req.nextUrl.searchParams.get("mode") ||
      "live"
    ).toLowerCase();

    const noCacheHeaders = {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    };

    const keyMask = creds.bybitKey && creds.bybitKey.length >= 8
      ? `${creds.bybitKey.slice(0, 4)}...${creds.bybitKey.slice(-4)}`
      : "ACTIVE";

    // 1. Paper Mode Simulation Fast-Path
    if (tradingMode === "paper") {
      return NextResponse.json(
        {
          success: true,
          venue: "Bybit-Paper",
          equity: 5000.0,
          available: 5000.0,
          walletBalance: 5000.0,
          unrealizedPnL: 0.0,
          positions: [],
          isSimulated: true,
          keyMask,
          isCustomKey: !creds.isAdmin,
          isAdmin: creds.isAdmin,
        },
        { headers: noCacheHeaders }
      );
    }

    // 2. Validate API Keys for Live Mode
    if (!creds.bybitKey || !creds.bybitSecret) {
      const errorMsg = creds.user && !creds.isAdmin
        ? "Personal Bybit API key and secret required. Please configure your credentials in the Profile Vault."
        : "Missing Bybit API credentials. Please configure keys in settings.";

      logServerEvent("WARN", "BYBIT", errorMsg);
      return NextResponse.json(
        {
          success: false,
          error: errorMsg,
          requiresKeys: true,
          isAdmin: creds.isAdmin,
        },
        { status: 401, headers: noCacheHeaders }
      );
    }

    const bybitCredentials = {
      apiKey: creds.bybitKey,
      apiSecret: creds.bybitSecret,
      proxyUrl: creds.bybitProxy,
      baseUrl: creds.bybitBaseUrl,
      backupProxyUrl: creds.bybitBackupProxy,
      backupBaseUrl: creds.bybitBackupBaseUrl,
    };

    const account = await fetchBybitAccount(bybitCredentials);

    if (account.success) {
      logServerEvent("INFO", "BYBIT", `Account synced [${keyMask}] (${account.venue}). Equity: $${account.equity}, Available: $${account.available}`);
    } else {
      logServerEvent("WARN", "BYBIT", `Account warning [${keyMask}]: ${account.error}`);
    }

    return NextResponse.json(
      {
        ...account,
        keyMask,
        requiresKeys: false, // Keys are present; error is proxy/network/geo-block
        isCustomKey: !creds.isAdmin,
        isAdmin: creds.isAdmin,
      },
      { headers: noCacheHeaders }
    );
  } catch (err: any) {
    logServerEvent("ERROR", "BYBIT", `Unexpected error: ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message, requiresKeys: false },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}
