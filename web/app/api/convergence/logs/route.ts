import { NextRequest, NextResponse } from "next/server";
import {
  getStatArbLogs,
  clearStatArbLogs,
  getActiveIncidents,
  resolveIncident,
  StatArbLog,
} from "@/lib/statarb/logging/statArbLogger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const severity = searchParams.get("severity") || "ALL";
    const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 1000);
    const symbol = searchParams.get("symbol") || undefined;
    const isDownload = searchParams.get("download") === "1" || searchParams.get("download") === "true";
    const format = searchParams.get("format") || "json";

    const logs = getStatArbLogs({ severity, limit, symbol });
    const incidents = getActiveIncidents(true);

    if (isDownload) {
      if (format === "text" || format === "txt") {
        const textLines = logs
          .map((l) => `[${l.timestamp}] [${(l.level || "INFO").toUpperCase()}] ${l.message}`)
          .join("\n");
        return new NextResponse(textLines || "No logs recorded yet.", {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="statarb_convergence_logs_${Date.now()}.txt"`,
          },
        });
      }

      return new NextResponse(JSON.stringify(logs, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="statarb_convergence_logs_${Date.now()}.json"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      count: logs.length,
      logs,
      unresolvedIncidents: incidents,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to retrieve convergence logs" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "clear") {
      clearStatArbLogs();
      return NextResponse.json({ success: true, message: "Convergence logs cleared successfully" });
    }

    if (action === "resolve_incident") {
      const { incidentId, remediationAction } = body;
      if (!incidentId) {
        return NextResponse.json({ success: false, error: "incidentId required" }, { status: 400 });
      }
      const resolved = resolveIncident(incidentId, remediationAction || "Manually resolved via API");
      return NextResponse.json({ success: resolved });
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Action failed" },
      { status: 500 }
    );
  }
}
