import { NextRequest, NextResponse } from "next/server";
import { getBitgetAccount } from "@/lib/bitgetSigner";
import { logServerEvent } from "@/lib/logger";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const creds = resolveCallerCredentials(req);

    const noCacheHeaders = {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    };

    if (!creds.bitgetKey || !creds.bitgetSecret || !creds.bitgetPassphrase) {
      const errorMsg = creds.user && !creds.isAdmin
        ? "Personal Bitget API key and passphrase required. Non-admin accounts must configure their own API keys in Profile or Vault settings."
        : "Missing Bitget API credentials. Please sign in or configure API keys.";

      logServerEvent("WARN", "BITGET", errorMsg);
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

    const bitgetCredentials = {
      apiKey: creds.bitgetKey,
      apiSecret: creds.bitgetSecret,
      passphrase: creds.bitgetPassphrase,
      isDemo: creds.bitgetEnv === "demo",
    };

    const account = await getBitgetAccount(bitgetCredentials);

    const keyMask = creds.bitgetKey.length >= 8
      ? `${creds.bitgetKey.slice(0, 4)}...${creds.bitgetKey.slice(-4)}`
      : "ACTIVE";

    if (account.success) {
      logServerEvent("INFO", "BITGET", `Account synced [${keyMask}] (${account.venue}). Equity: $${account.equity}`);
    } else {
      logServerEvent("ERROR", "BITGET", `Account error [${keyMask}]: ${account.error}`);
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
    logServerEvent("ERROR", "BITGET", `Unexpected error: ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to fetch Bitget account" },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}
