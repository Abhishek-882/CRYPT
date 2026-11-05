export interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  service: "BINANCE" | "BITGET" | "COINDCX" | "BYBIT" | "SYSTEM";
  message: string;
  details?: any;
}

const MAX_LOGS = 200;

export function redactSensitiveData(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    return val
      .replace(/(RkqI|bg_2|dpMS|c77d|enc:v1:)[a-zA-Z0-9_-]+/g, (match) => match.slice(0, 4) + "••••••••")
      .replace(/("password"|"secret"|"apiKey"|"apiSecret"|"passphrase")\s*:\s*"[^"]+"/gi, '$1:"••••••••"')
      .replace(/(99129838aA@|ArbitrageBot2027)/g, "••••••••");
  }
  if (typeof val === "object") {
    try {
      const cloned = JSON.parse(JSON.stringify(val));
      for (const k of Object.keys(cloned)) {
        const lower = k.toLowerCase();
        if (
          lower.includes("secret") ||
          lower.includes("password") ||
          lower.includes("passphrase") ||
          lower.includes("apikey")
        ) {
          if (typeof cloned[k] === "string" && cloned[k].length > 4) {
            cloned[k] = cloned[k].slice(0, 4) + "••••••••";
          }
        } else if (typeof cloned[k] === "object") {
          cloned[k] = redactSensitiveData(cloned[k]);
        }
      }
      return cloned;
    } catch {
      return "[Redacted Object]";
    }
  }
  return val;
}

// Global log storage across serverless invocations in Node runtime
const globalLogs: ServerLogEntry[] = (global as any).__APP_LOGS__ || [];
(global as any).__APP_LOGS__ = globalLogs;

export function logServerEvent(
  level: "INFO" | "WARN" | "ERROR",
  service: "BINANCE" | "BITGET" | "COINDCX" | "BYBIT" | "SYSTEM",
  message: string,
  details?: any
) {
  const safeMessage = typeof message === "string" ? redactSensitiveData(message) : message;
  const safeDetails = details !== undefined ? redactSensitiveData(details) : undefined;

  const entry: ServerLogEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    service,
    message: safeMessage,
    details: safeDetails,
  };

  globalLogs.push(entry);
  if (globalLogs.length > MAX_LOGS) {
    globalLogs.shift();
  }

  // Also print to standard out with redaction protection (FINDING-A7-01)
  const line = `[${entry.timestamp}] [${level}] [${service}] ${safeMessage}`;
  const detailsStr = safeDetails ? (typeof safeDetails === "string" ? safeDetails : JSON.stringify(safeDetails)) : "";

  if (level === "ERROR") {
    console.error(line, detailsStr);
  } else if (level === "WARN") {
    console.warn(line, detailsStr);
  } else {
    console.log(line, detailsStr);
  }
}

export function getServerLogs(): ServerLogEntry[] {
  return [...globalLogs];
}
