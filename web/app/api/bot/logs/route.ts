import { NextRequest, NextResponse } from "next/server";
import { loadBotState } from "@/lib/botEngine";
import { readDataFile, readUserDataFile } from "@/lib/storagePath";
import { getAuthenticatedUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required to access autonomous bot logs." },
      { status: 401 }
    );
  }

  const state = loadBotState(user.id);
  let logs: any[] = user.role === "admin"
    ? readDataFile<any[]>("bot_audit_log.json", [])
    : readUserDataFile<any[]>(user.id, "bot_audit_log.json", []);

  // Fallback to state.logs if file was empty or missing
  if (!Array.isArray(logs) || logs.length === 0) {
    logs = state.logs || [];
  }

  const isDownload = req.nextUrl.searchParams.get("download") === "1" || req.nextUrl.searchParams.get("download") === "true";
  const format = req.nextUrl.searchParams.get("format") || "json";

  if (isDownload) {
    if (format === "text" || format === "txt") {
      const text = logs
        .map((l) => `[${l.timestamp}] [${(l.level || "INFO").toUpperCase()}] ${l.message}`)
        .join("\n");
      return new NextResponse(text || "No logs recorded yet.", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="bot_audit_stream_${Date.now()}.txt"`,
        },
      });
    }

    return new NextResponse(JSON.stringify(logs, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="bot_audit_stream_${Date.now()}.json"`,
      },
    });
  }

  return NextResponse.json({
    success: true,
    count: logs.length,
    logs,
  });
}
