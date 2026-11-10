import fs from "fs";
import path from "path";
import http from "http";
import { findUserById, getDecryptedUserApiKeys } from "../lib/userStore";
import { loadBotState, saveBotState, fetchAvailableBalances } from "../lib/botEngine";
import { isDaemonLockHeldByCurrentProcess, acquireDaemonLock, getDaemonLockInfo } from "../lib/daemonLockManager";

const AUDIT_LOG_FILE = path.join(process.cwd(), "data", "reports", "hourly_sentinel_audit.jsonl");

// Ensure audit log dir exists
const dir = path.dirname(AUDIT_LOG_FILE);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

function logAudit(entry: Record<string, any>) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
  fs.appendFileSync(AUDIT_LOG_FILE, line, "utf8");
  console.log(`[HOURLY SENTINEL ${new Date().toISOString()}] ${entry.summary}`);
}

async function checkServerHealth(): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const req = http.get("http://localhost:3000/history", (res) => {
      resolve({ ok: res.statusCode === 200, status: res.statusCode || 0, latencyMs: Math.round(performance.now() - t0) });
    });
    req.on("error", () => {
      resolve({ ok: false, status: 0, latencyMs: Math.round(performance.now() - t0) });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ok: false, status: 408, latencyMs: 5000 });
    });
  });
}

export async function runHourlyAuditPass(): Promise<{
  healthy: boolean;
  adminStatus: any;
  userStatus: any;
  suspiciousFindings: string[];
  autoRemediations: string[];
}> {
  const suspiciousFindings: string[] = [];
  const autoRemediations: string[] = [];

  // 1. Web Server & Daemon Health Check
  const server = await checkServerHealth();
  if (!server.ok) {
    suspiciousFindings.push(`Next.js server endpoint unhealthy (status: ${server.status}, latency: ${server.latencyMs}ms)`);
  }

  // 2. Daemon Lock Check
  const lockInfo = getDaemonLockInfo();
  if (!lockInfo || !lockInfo.pid) {
    suspiciousFindings.push(`Daemon lock is inactive or missing`);
  }

  // 3. User Account Audit: rada7788@gmail.com (usr_1794314482670_kyff8)
  const user = findUserById("usr_1794314482670_kyff8");
  let userBotState: any = null;
  let userBal: any = null;

  if (!user) {
    suspiciousFindings.push("User rada7788@gmail.com not found in user accounts store!");
  } else {
    userBotState = loadBotState(user.id);
    if (!userBotState.isRunning) {
      suspiciousFindings.push(`User bot daemon was STOPPED. Auto-remediating: restarting daemon...`);
      userBotState.isRunning = true;
      saveBotState(userBotState, user.id);
      autoRemediations.push("Auto-restarted user bot daemon");
    }

    const bot2 = userBotState.bots.find((b: any) => b.id === "bot-120328");
    if (!bot2) {
      suspiciousFindings.push("User Bot 2 (Innovation Lab) missing in bot list!");
    } else {
      if (!bot2.enabled) {
        suspiciousFindings.push("User Bot 2 was DISABLED. Auto-remediating: re-enabling...");
        bot2.enabled = true;
        saveBotState(userBotState, user.id);
        autoRemediations.push("Re-enabled user Bot 2");
      }
      if (bot2.config?.fastExitIntervalMs !== 250) {
        suspiciousFindings.push(`User Bot 2 fastExitIntervalMs was ${bot2.config?.fastExitIntervalMs}. Upgrading to 250ms...`);
        bot2.config.fastExitIntervalMs = 250;
        saveBotState(userBotState, user.id);
        autoRemediations.push("Upgraded user Bot 2 fastExitIntervalMs to 250ms");
      }

      // Check active hedges health
      if (bot2.activeHedges && bot2.activeHedges.length > 0) {
        for (const hedge of bot2.activeHedges) {
          if (hedge.status === "ORPHAN_RECOVERY" || hedge.status === "FROZEN_PROXY_DOWN") {
            suspiciousFindings.push(`Active hedge ${hedge.id} (${hedge.symbol}) in abnormal state: ${hedge.status}`);
          }
        }
      }
    }

    // Verify User Balances
    const userCreds = getDecryptedUserApiKeys(user);
    if (userCreds) {
      try {
        userBal = await fetchAvailableBalances(userCreds, user.id);
      } catch (balErr: any) {
        suspiciousFindings.push(`User exchange balance query failed: ${balErr.message}`);
      }
    }
  }

  // 4. Admin Account Audit: usr_admin_varsha
  const admin = findUserById("usr_admin_varsha");
  let adminBotState: any = null;
  let adminBal: any = null;

  if (!admin) {
    suspiciousFindings.push("Admin usr_admin_varsha not found in user store!");
  } else {
    adminBotState = loadBotState(admin.id);
    if (!adminBotState.isRunning) {
      suspiciousFindings.push("Admin bot daemon was STOPPED. Auto-remediating: restarting daemon...");
      adminBotState.isRunning = true;
      saveBotState(adminBotState, admin.id);
      autoRemediations.push("Auto-restarted admin bot daemon");
    }

    const adminBot = adminBotState.bots.find((b: any) => b.id === "bot-120328") || adminBotState.bots[0];
    if (adminBot && adminBot.config?.fastExitIntervalMs !== 250) {
      adminBot.config.fastExitIntervalMs = 250;
      saveBotState(adminBotState, admin.id);
      autoRemediations.push("Upgraded admin bot fastExitIntervalMs to 250ms");
    }

    const adminCreds = getDecryptedUserApiKeys(admin);
    if (adminCreds) {
      try {
        adminBal = await fetchAvailableBalances(adminCreds, admin.id);
      } catch (adminBalErr: any) {
        suspiciousFindings.push(`Admin exchange balance query failed: ${adminBalErr.message}`);
      }
    }
  }

  // 5. Inspect Log Health for Critical Errors
  const userLogPath = path.join(process.cwd(), "data", "users", "usr_1794314482670_kyff8", "bot_audit_log.json");
  if (fs.existsSync(userLogPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(userLogPath, "utf8"));
      const recentLogs = Array.isArray(logs) ? logs.slice(-20) : [];
      for (const log of recentLogs) {
        const msg = typeof log === "string" ? log : log.message || "";
        if (msg.includes("IP_BANNED") || msg.includes("API_KEY_INVALID") || msg.includes("RATE_LIMIT_EXCEEDED")) {
          suspiciousFindings.push(`Suspicious error in user audit log: ${msg}`);
        }
      }
    } catch {}
  }

  const healthy = suspiciousFindings.length === 0;
  const summary = healthy
    ? `ALL CHECKS PASSED: Server healthy (${server.latencyMs}ms), Admin running (Binance: $${adminBal?.binanceBal?.toFixed(2)}, Bybit: $${adminBal?.bybitBal?.toFixed(2)}), User running (Active: ${userBotState?.bots[0]?.activeHedges?.length || 0}, 250ms fast-loop confirmed).`
    : `ANOMALIES DETECTED: ${suspiciousFindings.join(" | ")}. Remediations applied: ${autoRemediations.length > 0 ? autoRemediations.join(", ") : "None"}`;

  logAudit({
    healthy,
    summary,
    suspiciousFindings,
    autoRemediations,
    serverLatencyMs: server.latencyMs,
    adminBalance: { binance: adminBal?.binanceBal, bybit: adminBal?.bybitBal },
    userBalance: { binance: userBal?.binanceBal, bybit: userBal?.bybitBal }
  });

  return {
    healthy,
    adminStatus: { isRunning: adminBotState?.isRunning, balances: adminBal },
    userStatus: { isRunning: userBotState?.isRunning, activeHedges: userBotState?.bots[0]?.activeHedges?.length || 0, balances: userBal },
    suspiciousFindings,
    autoRemediations
  };
}

// If executed directly, run immediately and set 1-hour interval
if (require.main === module || process.argv[1]?.includes("hourly_sentinel")) {
  console.log("=== STARTING AUTONOMOUS HOURLY SENTINEL MONITOR (1-HOUR CADENCE) ===");
  runHourlyAuditPass().then((res) => {
    console.log("Initial Hourly Pass Result:", res.healthy ? "HEALTHY" : "NEEDS ATTENTION");
    setInterval(() => {
      runHourlyAuditPass().catch((err) => console.error("[HOURLY SENTINEL CRASH PREVENTED]:", err));
    }, 60 * 60 * 1000); // 1 hour = 3,600,000ms
  });
}
