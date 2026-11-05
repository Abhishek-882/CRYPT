const fs = require("fs");
const path = require("path");

const files = [
  "C:/AI-Hedge-Cockpit/web/bot_daemon_state.json",
  "C:/AI-Hedge-Cockpit/bot_daemon_state.json"
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  try {
    const raw = fs.readFileSync(f, "utf8");
    const data = JSON.parse(raw);
    let modified = false;

    for (const b of (data.bots || [])) {
      for (const h of (b.completedHedges || [])) {
        if (!h.closeLeg1PlacedAt && h.closeTime) {
          h.closeLeg1PlacedAt = h.closeTime;
          h.closeLeg2PlacedAt = h.closeTime + (h.interLegDeltaMs || 15);
          h.closeLeg1LatencyMs = h.closeLeg1LatencyMs !== undefined ? h.closeLeg1LatencyMs : (h.leg1LatencyMs || 260);
          h.closeLeg2LatencyMs = h.closeLeg2LatencyMs !== undefined ? h.closeLeg2LatencyMs : (h.leg2LatencyMs || 75);
          h.closeInterLegDeltaMs = h.closeInterLegDeltaMs !== undefined ? h.closeInterLegDeltaMs : Math.abs(h.closeLeg1PlacedAt - h.closeLeg2PlacedAt);
          modified = true;
          console.log(`Backfilled telemetry for ${h.symbol} in bot ${b.name}`);
        }
      }
    }

    if (modified) {
      fs.writeFileSync(f, JSON.stringify(data, null, 2), "utf8");
      console.log(`Saved updated ${f}`);
    }
  } catch (err) {
    console.error(`Error processing ${f}:`, err.message);
  }
}
