import { NextRequest, NextResponse } from "next/server";
import { testBybitConnectivity, BybitCredentials } from "@/lib/bybitSigner";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const credsResolved = resolveCallerCredentials(req);
    const body = await req.json().catch(() => ({}));

    // Support credentials passed via body, headers, or server vault
    const apiKey = body.apiKey || credsResolved.bybitKey || req.headers.get("x-bybit-key");
    const apiSecret = body.apiSecret || credsResolved.bybitSecret || req.headers.get("x-bybit-secret");
    const proxyUrl = body.proxyUrl || req.headers.get("x-bybit-proxy") || credsResolved.bybitProxy || process.env.BYBIT_PROXY_URL;
    const baseUrl = body.baseUrl || req.headers.get("x-bybit-base-url") || credsResolved.bybitBaseUrl || process.env.BYBIT_BASE_URL;
    const backupProxyUrl = body.backupProxyUrl || req.headers.get("x-bybit-backup-proxy") || credsResolved.bybitBackupProxy || process.env.BYBIT_BACKUP_PROXY_URL;
    const backupBaseUrl = body.backupBaseUrl || req.headers.get("x-bybit-backup-base-url") || credsResolved.bybitBackupBaseUrl || process.env.BYBIT_BACKUP_BASE_URL;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        {
          success: false,
          error: "Bybit API Key and Secret are required to test connection.",
          reachable: false,
          proxyActive: Boolean(proxyUrl || baseUrl || backupProxyUrl || backupBaseUrl),
        },
        { status: 400 }
      );
    }

    const creds: BybitCredentials = {
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      proxyUrl: proxyUrl ? proxyUrl.trim() : undefined,
      baseUrl: baseUrl ? baseUrl.trim() : undefined,
      backupProxyUrl: backupProxyUrl ? backupProxyUrl.trim() : undefined,
      backupBaseUrl: backupBaseUrl ? backupBaseUrl.trim() : undefined,
    };

    const result = await testBybitConnectivity(creds);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to execute Bybit connectivity test",
        reachable: false,
        proxyActive: false,
      },
      { status: 500 }
    );
  }
}
