import { NextRequest, NextResponse } from "next/server";
import { getCoinDcxAccount } from "@/lib/coindcxSigner";
import { logServerEvent } from "@/lib/logger";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const creds = resolveCallerCredentials(req);

    const noCacheHeaders = {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    };

    if (!creds.coindcxKey || !creds.coindcxSecret) {
      const errorMsg = creds.user && !creds.isAdmin
        ? "Personal CoinDCX API key and secret required. Please configure your credentials in the Profile Vault."
        : "Missing CoinDCX API credentials. Please configure keys in settings.";

      logServerEvent("WARN", "COINDCX", errorMsg);
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

    const coindcxCredentials = {
      apiKey: creds.coindcxKey,
      apiSecret: creds.coindcxSecret,
    };

    const account = await getCoinDcxAccount(coindcxCredentials);

    const keyMask = creds.coindcxKey.length >= 8
      ? `${creds.coindcxKey.slice(0, 4)}...${creds.coindcxKey.slice(-4)}`
      : "ACTIVE";

    if (account.success) {
      logServerEvent("INFO", "COINDCX", `Account synced [${keyMask}] (${account.venue}). Equity: $${account.equity}`);
    } else {
      logServerEvent("ERROR", "COINDCX", `Account error [${keyMask}]: ${account.error}`);
    }

    return NextResponse.json(
      {
        ...account,
        keyMask,
        isCustomKey: !creds.isAdmin,
        isAdmin: creds.isAdmin,
      },
      { headers: noCacheHeaders }
    );
  } catch (err: any) {
    logServerEvent("ERROR", "COINDCX", `Unexpected error: ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to fetch CoinDCX account" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}
