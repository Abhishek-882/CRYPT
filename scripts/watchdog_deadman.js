/**
 * AI-Hedge Cockpit - Zero-Dependency External Watchdog & Dead-Man's Switch
 * File: C:\AI-Hedge-Cockpit\scripts\watchdog_deadman.js
 * 
 * Standards:
 * - Pure Node.js Standard Library (https, crypto, fs, child_process, path)
 * - Zero external npm dependencies
 * - Independent process supervision (runs outside Next.js)
 * - Audits daemon heartbeat (<= 25s) & Direct Ground-Truth Exchange Positions
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { execSync, spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const STATE_FILE = path.join(ROOT_DIR, "web", "bot_daemon_state.json");
const ROOT_STATE_FILE = path.join(ROOT_DIR, "bot_daemon_state.json");
const USER_STORE_FILE = path.join(ROOT_DIR, "web", "user_accounts_store.json");
const VAULT_KEY_FILE = path.join(ROOT_DIR, ".vault_master_key");

const HEARTBEAT_TIMEOUT_MS = 25000; // 25s without heartbeat triggers Dead-Man strike
const POLL_INTERVAL_MS = 5000;      // 5-second polling frequency

let consecutiveFailures = 0;

// AES-256-GCM Decryption (Zero dependencies)
function decryptVaultSecret(encryptedStr) {
  if (!encryptedStr || !encryptedStr.startsWith("enc:v1:")) {
    return encryptedStr || "";
  }
  try {
    if (!fs.existsSync(VAULT_KEY_FILE)) return encryptedStr;
    const rawKey = fs.readFileSync(VAULT_KEY_FILE, "utf-8").trim();
    const masterKey = crypto.createHash("sha256").update(rawKey).digest();

    const parts = encryptedStr.replace("enc:v1:", "").split(":");
    if (parts.length !== 3) return encryptedStr;

    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const ciphertext = Buffer.from(parts[2], "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, undefined, "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } catch (err) {
    return encryptedStr;
  }
}

// Native HTTPS helper (Zero dependencies)
function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("Watchdog HTTPS request timeout"));
    });
    if (postData) req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
    req.end();
  });
}

// Restart Cockpit Service
function restartCockpit() {
  console.warn("\x1b[33m[WATCHDOG RESTART] Force-killing hung processes and restarting services...\x1b[0m");
  try {
    execSync("taskkill /F /IM node.exe /FI \"WINDOWTITLE eq AiHedge*\"", { stdio: "ignore" });
  } catch {}

  const batPath = path.join(ROOT_DIR, "start_services.bat");
  if (fs.existsSync(batPath)) {
    spawn("cmd.exe", ["/c", batPath], { detached: true, stdio: "ignore" }).unref();
    console.log("[WATCHDOG] Spawned start_services.bat successfully.");
  }
}

// Direct Binance Ground-Truth Position Risk Query
async function fetchBinancePositions(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) return [];
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex");
  const res = await httpsRequest({
    hostname: "fapi.binance.com",
    path: `/fapi/v2/positionRisk?${query}&signature=${signature}`,
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey }
  });
  if (Array.isArray(res.data)) {
    return res.data
      .map(p => ({
        symbol: p.symbol,
        amount: parseFloat(p.positionAmt || "0"),
        entryPrice: parseFloat(p.entryPrice || "0"),
        markPrice: parseFloat(p.markPrice || "0"),
        unrealizedProfit: parseFloat(p.unRealizedProfit || "0")
      }))
      .filter(p => Math.abs(p.amount) > 0.00001);
  }
  return [];
}

function loadState() {
  const fileToUse = fs.existsSync(STATE_FILE) ? STATE_FILE : (fs.existsSync(ROOT_STATE_FILE) ? ROOT_STATE_FILE : null);
  if (!fileToUse) return null;
  try {
    return JSON.parse(fs.readFileSync(fileToUse, "utf-8"));
  } catch {
    return null;
  }
}

function loadAdminCreds() {
  if (fs.existsSync(USER_STORE_FILE)) {
    try {
      const store = JSON.parse(fs.readFileSync(USER_STORE_FILE, "utf-8"));
      const admin = (store.users || []).find(u => u.role === "admin") || (store.users || [])[0];
      if (admin && admin.apiKeys) {
        return {
          binanceKey: admin.apiKeys.binanceKey || "",
          binanceSecret: decryptVaultSecret(admin.apiKeys.binanceSecret || ""),
          bybitKey: admin.apiKeys.bybitKey || "",
          bybitSecret: decryptVaultSecret(admin.apiKeys.bybitSecret || "")
        };
      }
    } catch {}
  }
  return {
    binanceKey: process.env.ADMIN_BINANCE_KEY || "",
    binanceSecret: process.env.ADMIN_BINANCE_SECRET || "",
    bybitKey: process.env.ADMIN_BYBIT_KEY || "",
    bybitSecret: process.env.ADMIN_BYBIT_SECRET || ""
  };
}

async function watchdogTick() {
  const now = Date.now();
  const state = loadState();

  // 1. Audit Liveness via Heartbeat File
  if (state) {
    const timeSinceLastCycle = now - (state.lastCycleAt || 0);

    if (state.isRunning && timeSinceLastCycle > HEARTBEAT_TIMEOUT_MS) {
      consecutiveFailures++;
      console.error(
        `\x1b[31m[WATCHDOG DEAD-MAN STRIKE ${consecutiveFailures}/2] No cycle heartbeat for ${Math.round(timeSinceLastCycle / 1000)}s (Threshold: ${HEARTBEAT_TIMEOUT_MS/1000}s)\x1b[0m`
      );

      if (consecutiveFailures >= 2) {
        console.error("\x1b[41m\x1b[37m[DEAD-MAN TRIPPED] Node.js daemon is hung. Initiating supervisor restart...\x1b[0m");
        restartCockpit();
        consecutiveFailures = 0;
        return;
      }
    } else {
      if (consecutiveFailures > 0) {
        console.log("\x1b[32m[WATCHDOG RECOVERED] Heartbeat restored cleanly.\x1b[0m");
      }
      consecutiveFailures = 0;
    }

    // 2. Audit Active Hedges for prolonged orphan status
    (state.bots || []).forEach(b => {
      (b.activeHedges || []).forEach(h => {
        if (h.status === "ORPHAN_RECOVERY" && (now - (h.orphanSince || now)) > 30000) {
          console.warn(
            `\x1b[33m[WATCHDOG ALERT] Prolonged orphan leg on ${h.symbol} (${h.orphanLeg}) for ${Math.round((now - h.orphanSince)/1000)}s! Remediation in progress.\x1b[0m`
          );
        } else if (h.status === "SYNTHETIC_DELTA_LOCKED") {
          console.log(
            `\x1b[36m[WATCHDOG MONITORED] Synthetic Delta Lock active on ${h.symbol}. Net delta frozen at 0.00.\x1b[0m`
          );
        }
      });
    });
  }

  // 3. Audit Direct Ground-Truth Positions on Binance
  try {
    const creds = loadAdminCreds();
    if (creds.binanceKey && creds.binanceSecret) {
      const positions = await fetchBinancePositions(creds.binanceKey, creds.binanceSecret);
      if (positions.length > 0) {
        const trackedSymbols = new Set();
        if (state) {
          (state.bots || []).forEach(b => {
            (b.activeHedges || []).forEach(h => trackedSymbols.add(h.symbol.toUpperCase()));
          });
        }

        for (const p of positions) {
          if (!trackedSymbols.has(p.symbol.toUpperCase())) {
            console.warn(
              `\x1b[33m[WATCHDOG NOTICE] On-Exchange Position: ${p.amount > 0 ? "LONG" : "SHORT"} ${Math.abs(p.amount)} ${p.symbol} @ $${p.entryPrice} (Mark: $${p.markPrice})\x1b[0m`
            );
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal, retry next tick
  }
}

console.log("==================================================================");
console.log("   AI-Hedge Independent Zero-Dependency Watchdog Daemon Started   ");
console.log(`   Heartbeat Threshold: ${HEARTBEAT_TIMEOUT_MS / 1000}s | Poll Frequency: ${POLL_INTERVAL_MS / 1000}s`);
console.log("==================================================================");

setInterval(watchdogTick, POLL_INTERVAL_MS);
watchdogTick();
