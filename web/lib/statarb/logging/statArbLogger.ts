import fs from "fs";
import path from "path";
import { readDataFile, saveDataFile, resolveDataFilePath } from "@/lib/storagePath";

export interface StatArbLog {
  timestamp: string;
  message: string;
  level: "info" | "success" | "warn" | "error";
  count?: number;
  symbol?: string;
  details?: any;
}

export interface ActiveIncident {
  id: string;
  timestamp: string;
  errorType: string;
  symbol?: string;
  details: string;
  urgency: "HIGH" | "CRITICAL";
  resolved: boolean;
  resolvedAt?: string;
  remediationAction?: string;
}

const AUDIT_LOG_FILE = "statarb_audit_log.json";
const INCIDENTS_FILE = "statarb_active_incidents.json";
const PERMANENT_LOG_FILE = "trade_audit_permanent.jsonl";

const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// In-memory ring buffer (last 1,000 logs)
let memoryLogs: StatArbLog[] = [];

/**
 * Normalizes log message for deduplication (strips trailing counts and transient numbers)
 */
function normalizeLogKey(msg: string): string {
  return msg
    .replace(/\s*\[\d+\]$/, "")
    .replace(/\b\d+(\.\d+)?(ms|s|%|usdt)?\b/gi, "")
    .trim();
}

/**
 * Appends a structured log for STATARB-OU-PERP with 60s deduplication,
 * persistent storage, and error incident registration.
 */
export function appendStatArbLog(
  message: string,
  level: "info" | "success" | "warn" | "error" = "info",
  symbol?: string,
  details?: any
): StatArbLog {
  const now = Date.now();
  const isoTime = new Date(now).toISOString();

  // Ensure prefix tag [STATARB-OU-PERP]
  let cleanMessage = message.replace(/\s*\[\d+\]$/, "").trim();
  if (!cleanMessage.includes("[STATARB-OU-PERP]")) {
    if (cleanMessage.startsWith("[")) {
      const firstBracket = cleanMessage.indexOf("]");
      cleanMessage = `${cleanMessage.slice(0, firstBracket + 1)} [STATARB-OU-PERP] ${cleanMessage.slice(firstBracket + 1).replace(/^[:\s]+/, "")}`;
    } else {
      cleanMessage = `[STATARB-OU-PERP] ${cleanMessage}`;
    }
  }

  const normalizedKey = normalizeLogKey(cleanMessage);

  // Load from disk if memory buffer is empty
  if (memoryLogs.length === 0) {
    try {
      const diskLogs = readDataFile<StatArbLog[]>(AUDIT_LOG_FILE, []);
      if (Array.isArray(diskLogs)) {
        memoryLogs = diskLogs.slice(0, 1000);
      }
    } catch {}
  }

  // 60-Second Deduplication Aggregation
  const existingLog = memoryLogs.find((l) => {
    return (
      normalizeLogKey(l.message) === normalizedKey &&
      l.level === level &&
      l.symbol === symbol
    );
  });

  let isAggregated = false;
  let logToPersist: StatArbLog = {
    timestamp: isoTime,
    message: cleanMessage,
    level,
    count: 1,
    symbol,
    details,
  };

  if (existingLog) {
    const prevTime = new Date(existingLog.timestamp).getTime();
    if (now - prevTime < ONE_MINUTE_MS) {
      const currentCount = existingLog.count || 1;
      const newCount = currentCount + 1;

      existingLog.count = newCount;
      existingLog.message = `${cleanMessage} [${newCount}]`;
      existingLog.timestamp = isoTime;
      existingLog.details = details || existingLog.details;
      logToPersist = existingLog;
      isAggregated = true;
    }
  }

  if (!isAggregated) {
    memoryLogs.unshift(logToPersist);
    if (memoryLogs.length > 1000) {
      memoryLogs = memoryLogs.slice(0, 1000);
    }
  }

  // Do not write mock incidents or mock logs to disk during Jest unit tests
  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined) {
    return logToPersist;
  }

  // Permanent JSONL Trade Audit Stream
  const isPermanentEvent =
    level === "success" ||
    level === "error" ||
    /HEDGE|ORDER|FILL|CLOSED|UNWIND|QUARANTINE|SETTLEMENT|ORPHAN/i.test(cleanMessage);

  if (isPermanentEvent) {
    try {
      const permanentEntry =
        JSON.stringify({
          timestamp: isoTime,
          level,
          engine: "STATARB-OU-PERP",
          symbol,
          message: cleanMessage,
          count: logToPersist.count || 1,
          details,
        }) + "\n";

      const permPath = resolveDataFilePath(PERMANENT_LOG_FILE);
      fs.appendFileSync(permPath, permanentEntry, "utf-8");
    } catch (err: any) {
      console.warn(`[STATARB-LOG] Could not write permanent log:`, err.message);
    }
  }

  // Auto-Save Audit Stream to Disk (max 2,500 entries)
  try {
    let auditHistory = readDataFile<StatArbLog[]>(AUDIT_LOG_FILE, []);
    if (!Array.isArray(auditHistory)) auditHistory = [];

    if (isAggregated) {
      const matchIndex = auditHistory.findIndex((l) => {
        return (
          normalizeLogKey(l.message) === normalizedKey &&
          l.level === level &&
          now - new Date(l.timestamp).getTime() < FIVE_MINUTES_MS
        );
      });
      if (matchIndex !== -1) {
        auditHistory[matchIndex] = logToPersist;
      } else {
        auditHistory.unshift(logToPersist);
      }
    } else {
      auditHistory.unshift(logToPersist);
    }

    if (auditHistory.length > 2500) {
      auditHistory = auditHistory.slice(0, 2500);
    }

    saveDataFile(AUDIT_LOG_FILE, auditHistory);
  } catch (err: any) {
    console.warn(`[STATARB-LOG] Auto-save error:`, err.message);
  }

  // Autonomous Error Incident Registration & Wakeup Alert
  if (level === "error") {
    try {
      const incident: ActiveIncident = {
        id: `inc_${now}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: isoTime,
        errorType: extractErrorType(cleanMessage),
        symbol,
        details: cleanMessage,
        urgency: "CRITICAL",
        resolved: false,
      };

      let incidents = readDataFile<ActiveIncident[]>(INCIDENTS_FILE, []);
      if (!Array.isArray(incidents)) incidents = [];
      incidents.unshift(incident);
      if (incidents.length > 100) incidents = incidents.slice(0, 100);
      saveDataFile(INCIDENTS_FILE, incidents);

      // Surface high-priority wakeup alert to system console
      console.error(
        `\n🚨 [CRITICAL ALERT: CONVERGENCE ERROR DETECTED] Wakeup Triggered: ${incident.errorType} on ${symbol || "SYSTEM"} - ${cleanMessage}\n`
      );
    } catch (incErr: any) {
      console.warn(`[STATARB-LOG] Could not register incident:`, incErr.message);
    }
  }

  return logToPersist;
}

/**
 * Extracts error category from error message
 */
function extractErrorType(msg: string): string {
  if (/EC_NoImmediateQtyToFill|zero-fill|rejected/i.test(msg)) return "LEG2_REJECTION";
  if (/orphan/i.test(msg)) return "ORPHAN_EXPOSURE";
  if (/429|rate\s*limit/i.test(msg)) return "RATE_LIMIT_BREACH";
  if (/margin|balance/i.test(msg)) return "MARGIN_DEFICIENCY";
  if (/timeout|connection|network|econnreset/i.test(msg)) return "NETWORK_TIMEOUT";
  return "EXECUTION_ERROR";
}

/**
 * Get active audit logs with filtering and limit
 */
export function getStatArbLogs(filter?: {
  severity?: string;
  limit?: number;
  symbol?: string;
}): StatArbLog[] {
  let logs: StatArbLog[] = memoryLogs;

  if (logs.length === 0) {
    logs = readDataFile<StatArbLog[]>(AUDIT_LOG_FILE, []);
    memoryLogs = logs.slice(0, 1000);
  }

  if (filter?.severity && filter.severity !== "ALL") {
    const target = filter.severity.toLowerCase();
    if (target === "errors") {
      logs = logs.filter(
        (l) => l.level === "error" || /error|failed|rejected|critical|alert|orphan/i.test(l.message)
      );
    } else if (target === "warns") {
      logs = logs.filter((l) => l.level === "warn");
    } else if (target === "success") {
      logs = logs.filter((l) => l.level === "success");
    } else if (target === "info") {
      logs = logs.filter((l) => l.level === "info");
    }
  }

  if (filter?.symbol) {
    logs = logs.filter((l) => l.symbol === filter.symbol);
  }

  const limit = filter?.limit || 200;
  return logs.slice(0, limit);
}

/**
 * Clear in-memory and persistent audit logs
 */
export function clearStatArbLogs(): void {
  memoryLogs = [];
  saveDataFile(AUDIT_LOG_FILE, []);
}

/**
 * Get active unresolved incidents
 */
export function getActiveIncidents(onlyUnresolved = true): ActiveIncident[] {
  const incidents = readDataFile<ActiveIncident[]>(INCIDENTS_FILE, []);
  if (!Array.isArray(incidents)) return [];
  if (onlyUnresolved) {
    return incidents.filter((i) => !i.resolved);
  }
  return incidents;
}

/**
 * Mark incident as resolved with autonomous remediation action
 */
export function resolveIncident(incidentId: string, remediationAction: string): boolean {
  try {
    let incidents = readDataFile<ActiveIncident[]>(INCIDENTS_FILE, []);
    if (!Array.isArray(incidents)) return false;

    const incident = incidents.find((i) => i.id === incidentId);
    if (incident) {
      incident.resolved = true;
      incident.resolvedAt = new Date().toISOString();
      incident.remediationAction = remediationAction;
      saveDataFile(INCIDENTS_FILE, incidents);
      appendStatArbLog(
        `[SUCCESS] [AUTO-REMEDIATION COMPLETE] Incident ${incidentId} resolved: ${remediationAction}`,
        "success",
        incident.symbol
      );
      return true;
    }
  } catch {}
  return false;
}
