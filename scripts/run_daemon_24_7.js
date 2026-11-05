/**
 * Standalone 24/7 Keep-Alive Background Heartbeat Runner
 * Continuously triggers the bot daemon cycle and keeps the event loop active.
 */

const http = require("http");

const PORT = process.env.PORT || 3000;
const INTERVAL_MS = 5000;

console.log("=================================================");
console.log(` AI-Hedge 24/7 Background Daemon Heartbeat Runner`);
console.log(` Target Cockpit: http://localhost:${PORT}`);
console.log(` Ping Interval: ${INTERVAL_MS / 1000}s`);
console.log("=================================================");

let inFlight = false;

function scheduleNext(delayMs = INTERVAL_MS) {
  setTimeout(() => {
    inFlight = false;
    pingDaemon();
  }, delayMs);
}

function pingDaemon() {
  if (inFlight) return;
  inFlight = true;

  const req = http.get(
    {
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/bot/daemon?action=cron_tick",
      headers: {
        "x-cron-secret": process.env.CRON_SECRET || "internal_daemon_cron_secret_2026",
      },
    },
    (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const uptime = json.uptimeSeconds ? `${Math.floor(json.uptimeSeconds / 60)}m` : "0m";
          const users = json.activeUsersCount !== undefined ? `Active Users: ${json.activeUsersCount} | ` : "";
          console.log(`[${new Date().toLocaleTimeString()}] Heartbeat OK | Running: ${json.isRunning} | ${users}Active Bots: ${json.activeBotsCount} | Uptime: ${uptime}`);
        } catch {
          console.log(`[${new Date().toLocaleTimeString()}] Heartbeat OK (raw response)`);
        }
        scheduleNext(INTERVAL_MS);
      });
    }
  );

  req.on("error", (err) => {
    console.warn(`[${new Date().toLocaleTimeString()}] Cockpit not responding yet: ${err.message}`);
    scheduleNext(INTERVAL_MS);
  });

  // Give up to 20 seconds for multi-exchange network scanning to complete cleanly
  req.setTimeout(20000, () => {
    req.destroy(new Error("Request timed out after 20000ms"));
  });
}

// Initial tick
pingDaemon();
