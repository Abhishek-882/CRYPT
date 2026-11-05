import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Automated 2-Hour Fleet Reporting System", () => {
  const artifactDir = "C:/Users/Administrator/.gemini/antigravity/brain/1d2bf9be-31cc-4a00-bea0-9564b0cbc34b";
  const latestPath = path.join(artifactDir, "fleet_status_report_latest.md");
  const archiveDir = "C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/reports";

  it("should have generated latest 2-hour report with valid Markdown content", () => {
    expect(fs.existsSync(latestPath)).toBe(true);
    const content = fs.readFileSync(latestPath, "utf8");
    expect(content).toContain("# Automated 2-Hour Fleet Status Report");
    expect(content).toContain("Combined Portfolio NAV");
    expect(content).toContain("Binance USD-M Futures");
    expect(content).toContain("Bybit Linear Unified");
  });

  it("should contain head-to-head A/B performance metrics for Bot 1 vs Bot 2", () => {
    const content = fs.readFileSync(latestPath, "utf8");
    expect(content).toContain("A/B Bot Fleet Performance Benchmark");
    expect(content).toContain("Bot 1: Profit Maximizer");
    expect(content).toContain("Bot 2: Innovation Lab");
    expect(content).toContain("Operational Role");
    expect(content).toContain("Spread Hurdle");
    expect(content).toContain("Net Real Yield Hurdle");
    expect(content).toContain("Zero-Loss Gate Holds");
  });

  it("should strictly verify Zero Orphan Exposure invariant in the report", () => {
    const content = fs.readFileSync(latestPath, "utf8");
    expect(content).toContain("Zero Orphan Exposure");
    expect(content).toContain("Risk / Capital Integrity");
  });

  it("should archive timestamped historical reports into web/data/reports", () => {
    expect(fs.existsSync(archiveDir)).toBe(true);
    const files = fs.readdirSync(archiveDir).filter((f) => f.startsWith("fleet_report_") && f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);

    // Verify format: fleet_report_YYYY-MM-DD_HH-mm.md
    const firstArchive = files[0];
    expect(firstArchive).toMatch(/^fleet_report_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.md$/);
  });
});
