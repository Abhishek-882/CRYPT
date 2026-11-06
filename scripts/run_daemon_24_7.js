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

  // 1. Primary Fleet Daemon Heartbeat
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
          console.log(`[${new Date().toLocaleTimeString()}] Fleet Heartbeat OK | Running: ${json.isRunning} | ${users}Active Bots: ${json.activeBotsCount} | Uptime: ${uptime}`);
        } catch {
          console.log(`[${new Date().toLocaleTimeString()}] Fleet Heartbeat OK (raw response)`);
        }
      });
    }
  );

  req.on("error", (err) => {
    console.warn(`[${new Date().toLocaleTimeString()}] Fleet daemon not responding yet: ${err.message}`);
  });

  req.setTimeout(20000, () => {
    req.destroy(new Error("Request timed out after 20000ms"));
  });

  // 2. Statistical Arbitrage Convergence Sweeper Heartbeat
  const convPayload = JSON.stringify({ action: "cron_tick" });
  const reqConv = http.request(
    {
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/convergence/daemon",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(convPayload),
      },
    },
    (resConv) => {
      let convData = "";
      resConv.on("data", (chunk) => (convData += chunk));
      resConv.on("end", () => {
        try {
          const convJson = JSON.parse(convData);
          if (convJson.isRunning) {
            console.log(`[${new Date().toLocaleTimeString()}] Convergence Sweeper OK | FSM: ${convJson.fsmState} | Active Positions: ${convJson.state?.positions?.length || 0}`);
          }
        } catch {}
        scheduleNext(INTERVAL_MS);
      });
    }
  );

  reqConv.on("error", () => {
    scheduleNext(INTERVAL_MS);
  });

  reqConv.setTimeout(15000, () => {
    reqConv.destroy();
  });

  reqConv.write(convPayload);
  reqConv.end();
}

// Initial tick
pingDaemon();
