import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const artifactDir = "C:/Users/Administrator/.gemini/antigravity/brain/1d2bf9be-31cc-4a00-bea0-9564b0cbc34b";
    const latestPath = path.join(artifactDir, "fleet_status_report_latest.md");

    let markdown = "";
    let generatedAt = new Date().toISOString();
    let stats: fs.Stats | null = null;

    if (fs.existsSync(latestPath)) {
      markdown = fs.readFileSync(latestPath, "utf8");
      stats = fs.statSync(latestPath);
      generatedAt = stats.mtime.toISOString();
    }

    const archiveDir = "C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/reports";
    let archiveFiles: string[] = [];
    if (fs.existsSync(archiveDir)) {
      archiveFiles = fs
        .readdirSync(archiveDir)
        .filter((f) => f.startsWith("fleet_report_") && f.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, 12); // Last 12 reports (24 hours history)
    }

    // Parse key summary metrics from markdown if available
    const navMatch = markdown.match(/Combined Portfolio NAV\*\*:\s+\*\*\$([0-9.]+)/);
    const bnMatch = markdown.match(/Binance USD-M Futures\*\*.*?\$([0-9.]+)/);
    const byMatch = markdown.match(/Bybit Linear Unified\*\*.*?\$([0-9.]+)/);
    const posMatch = markdown.match(/(\d+)\s+OPEN POSITIONS/);

    const summary = {
      totalNav: navMatch ? parseFloat(navMatch[1]) : 0,
      binanceUsdt: bnMatch ? parseFloat(bnMatch[1]) : 0,
      bybitEquity: byMatch ? parseFloat(byMatch[1]) : 0,
      openPositions: posMatch ? parseInt(posMatch[1], 10) : 0,
      fileSizeBytes: stats ? stats.size : 0,
    };

    return NextResponse.json(
      {
        success: true,
        generatedAt,
        summary,
        archiveFiles,
        markdown,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to retrieve latest 2-hour fleet report",
      },
      { status: 500 }
    );
  }
}
