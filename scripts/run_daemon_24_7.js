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

  // Dedicated Statistical Arbitrage Convergence Sweeper Heartbeat (100% Rate Limit Isolation)
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

  reqConv.on("error", (err) => {
    console.warn(`[${new Date().toLocaleTimeString()}] Convergence daemon not responding: ${err.message}`);
    scheduleNext(INTERVAL_MS);
  });

  reqConv.setTimeout(15000, () => {
    reqConv.destroy();
    scheduleNext(INTERVAL_MS);
  });

  reqConv.write(convPayload);
  reqConv.end();
}

// Initial tick
pingDaemon();
