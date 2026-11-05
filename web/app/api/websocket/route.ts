import { NextRequest, NextResponse } from "next/server";
import { bybitTradeStream } from "@/lib/bybitTradeStream";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

const noCacheHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

export async function GET(req: NextRequest) {
  const status = bybitTradeStream.getStatus();
  return NextResponse.json(
    {
      success: true,
      data: status,
    },
    { headers: noCacheHeaders }
  );
}

export async function POST(req: NextRequest) {
  const creds = resolveCallerCredentials(req);
  if (!creds.authorized) {
    return NextResponse.json(
      { success: false, error: "Authentication required to manage WebSocket controls." },
      { status: 401, headers: noCacheHeaders }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "reconnect") {
      const byCreds = {
        apiKey: creds.bybitKey || "",
        apiSecret: creds.bybitSecret || "",
        proxyUrl: creds.bybitProxy,
        baseUrl: creds.bybitBaseUrl,
        backupProxyUrl: creds.bybitBackupProxy,
        backupBaseUrl: creds.bybitBackupBaseUrl,
      };
      const result = await bybitTradeStream.manualReconnect(byCreds);
      return NextResponse.json(
        {
          success: result.success,
          latencyMs: result.latencyMs,
          error: result.error,
          status: bybitTradeStream.getStatus(),
        },
        { headers: noCacheHeaders }
      );
    }

    if (action === "force_trip") {
      bybitTradeStream.forceTrip(body.reason || "Manual trip test from /websocket diagnostics UI");
      return NextResponse.json(
        {
          success: true,
          message: "Watchdog circuit breaker successfully tripped. WebSocket path killed; route reverted to REST.",
          status: bybitTradeStream.getStatus(),
        },
        { headers: noCacheHeaders }
      );
    }

    if (action === "ping") {
      const pingRes = await bybitTradeStream.sendTestPing();
      return NextResponse.json(
        {
          success: pingRes.success,
          latencyMs: pingRes.latencyMs,
          error: pingRes.error,
          status: bybitTradeStream.getStatus(),
        },
        { headers: noCacheHeaders }
      );
    }

    if (action === "reset") {
      const byCreds = {
        apiKey: creds.bybitKey || "",
        apiSecret: creds.bybitSecret || "",
        proxyUrl: creds.bybitProxy,
        baseUrl: creds.bybitBaseUrl,
        backupProxyUrl: creds.bybitBackupProxy,
        backupBaseUrl: creds.bybitBackupBaseUrl,
      };
      await bybitTradeStream.manualReconnect(byCreds);
      return NextResponse.json(
        {
          success: true,
          message: "Watchdog circuit breaker reset and WebSocket route re-engaged.",
          status: bybitTradeStream.getStatus(),
        },
        { headers: noCacheHeaders }
      );
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400, headers: noCacheHeaders }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to execute WebSocket command" },
      { status: 500, headers: noCacheHeaders }
    );
  }
}
