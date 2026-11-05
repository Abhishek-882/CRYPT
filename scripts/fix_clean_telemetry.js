const fs = require("fs");

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
        // If closeLatencyMs is identical to entry legLatencyMs, it was copied by the backfill script
        if (h.closeLeg1LatencyMs !== undefined && h.closeLeg1LatencyMs === h.leg1LatencyMs) {
          delete h.closeLeg1LatencyMs;
          delete h.closeLeg2LatencyMs;
          delete h.closeInterLegDeltaMs;
          h.unwindReason = "MANUAL_FORCE_EXIT";
          modified = true;
          console.log(`Cleaned copied latency for ${h.symbol} in bot ${b.name}`);
        }
      }
    }

    if (modified) {
      fs.writeFileSync(f, JSON.stringify(data, null, 2), "utf8");
      console.log(`Saved clean ${f}`);
    }
  } catch (err) {
    console.error(`Error processing ${f}:`, err.message);
  }
}
