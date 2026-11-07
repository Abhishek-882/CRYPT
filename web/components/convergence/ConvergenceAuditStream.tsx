"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

export interface ConvergenceLogItem {
  timestamp: string;
  message: string;
  level: "info" | "success" | "warn" | "error";
  count?: number;
  symbol?: string;
}

export interface ActiveIncidentItem {
  id: string;
  timestamp: string;
  errorType: string;
  symbol?: string;
  details: string;
  urgency: "HIGH" | "CRITICAL";
  resolved: boolean;
}

function formatMillisecondTime(ts: number): string {
  if (!ts || isNaN(ts)) return "--:--:--.---";
  const d = new Date(ts);
  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export default function ConvergenceAuditStream() {
  const [isOpen, setIsOpen] = useState(true);
  const [logs, setLogs] = useState<ConvergenceLogItem[]>([]);
  const [incidents, setIncidents] = useState<ActiveIncidentItem[]>([]);
  const [severityFilter, setSeverityFilter] = useState<"ALL" | "ERRORS" | "WARNS" | "SUCCESS">("ALL");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/convergence/logs?limit=300", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
        if (Array.isArray(data.unresolvedIncidents)) {
          setIncidents(data.unresolvedIncidents);
        }
      }
    } catch {
      // Silent error handling for smooth polling
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 2500);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  const handleClearLogs = async () => {
    setIsClearing(true);
    try {
      await fetch("/api/convergence/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      setLogs([]);
    } catch {}
    setIsClearing(false);
  };

  const errorCount = logs.filter(
    (l) => l.level === "error" || /error|failed|rejected|critical|alert|orphan/i.test(l.message)
  ).length;
  const warnCount = logs.filter((l) => l.level === "warn").length;
  const successCount = logs.filter((l) => l.level === "success").length;

  const filteredLogs = logs.filter((l) => {
    if (severityFilter === "ALL") return true;
    if (severityFilter === "ERRORS") {
      return l.level === "error" || /error|failed|rejected|critical|alert|orphan/i.test(l.message);
    }
    if (severityFilter === "WARNS") return l.level === "warn";
    if (severityFilter === "SUCCESS") return l.level === "success";
    return true;
  });

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 shadow-xl mb-6">
      {/* Incident Alert Banner if active unhandled error exists */}
      {incidents.length > 0 && (
        <div className="mb-3 bg-rose-950/60 border border-rose-700/80 rounded-lg p-3 text-xs flex items-center justify-between text-rose-200">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
            <div>
              <span className="font-bold uppercase tracking-wider text-rose-300">
                Autonomous Incident Sentinel Triggered ({incidents[0].errorType}):
              </span>{" "}
              <span>{incidents[0].details}</span>
            </div>
          </div>
          <span className="shrink-0 bg-rose-900 border border-rose-600 px-2 py-0.5 rounded text-[10px] font-mono font-bold text-rose-100">
            AUTO-REMEDIATION ACTIVE
          </span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center space-x-2.5 text-zinc-200 hover:text-white transition-colors"
        >
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="font-bold uppercase tracking-wider text-sm">
            24/7 Convergence Audit Stream: STATARB-OU-PERP
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">({filteredLogs.length} events)</span>
          {isOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>

        {/* Action Controls & Filters */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {/* Severity Filter Pills */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5">
            <button
              onClick={() => setSeverityFilter("ALL")}
              className={`px-2.5 py-1 rounded font-semibold transition-all ${
                severityFilter === "ALL" ? "bg-zinc-800 text-zinc-100 font-bold shadow" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              ALL
            </button>
            <button
              onClick={() => setSeverityFilter("ERRORS")}
              className={`px-2.5 py-1 rounded font-semibold transition-all flex items-center gap-1 ${
                severityFilter === "ERRORS"
                  ? "bg-rose-950 text-rose-300 border border-rose-800 font-bold shadow"
                  : errorCount > 0
                  ? "text-rose-400 hover:text-rose-300 font-bold"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              🚨 ERRORS ({errorCount})
            </button>
            <button
              onClick={() => setSeverityFilter("WARNS")}
              className={`px-2.5 py-1 rounded font-semibold transition-all ${
                severityFilter === "WARNS"
                  ? "bg-amber-950 text-amber-300 border border-amber-800 font-bold"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              WARNS ({warnCount})
            </button>
            <button
              onClick={() => setSeverityFilter("SUCCESS")}
              className={`px-2.5 py-1 rounded font-semibold transition-all ${
                severityFilter === "SUCCESS"
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              SUCCESS ({successCount})
            </button>
          </div>

          {/* Auto-Saved Badge */}
          <span className="px-2 py-1 rounded bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 font-mono hidden sm:flex items-center gap-1 font-semibold text-[10px]">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            AUTO-SAVED
          </span>

          {/* Download Buttons */}
          <a
            href="/api/convergence/logs?download=1&format=text"
            download
            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 font-semibold transition-colors flex items-center gap-1 text-[10px]"
            title="Download persistent audit stream as text"
          >
            <Download className="w-3 h-3 text-cyan-400" />
            <span>TXT</span>
          </a>

          <a
            href="/api/convergence/logs?download=1&format=json"
            download
            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 font-semibold transition-colors flex items-center gap-1 text-[10px]"
            title="Download audit log in JSON format"
          >
            <Download className="w-3 h-3 text-amber-400" />
            <span>JSON</span>
          </a>

          {/* Clear Logs Button */}
          <button
            onClick={handleClearLogs}
            disabled={isClearing}
            className="px-2.5 py-1 rounded bg-zinc-850 hover:bg-rose-950 hover:text-rose-300 border border-zinc-700 text-zinc-400 transition-colors flex items-center gap-1 text-[10px]"
            title="Clear all convergence logs"
          >
            <Trash2 className="w-3 h-3" />
            <span>CLEAR</span>
          </button>
        </div>
      </div>

      {/* Expandable Log Viewer */}
      {isOpen && (
        <div className="mt-3 bg-zinc-950 p-3.5 rounded-xl border border-zinc-800/90 font-mono text-[11px] max-h-64 overflow-y-auto space-y-1.5 scrollbar-thin shadow-inner">
          {filteredLogs.length === 0 ? (
            <div className="text-zinc-600 text-center py-6 space-y-1">
              <div>No {severityFilter !== "ALL" ? severityFilter.toLowerCase() : ""} log entries recorded.</div>
              {errorCount === 0 && (
                <div className="text-emerald-500 text-[10px]">✓ Zero execution errors or orphan incidents!</div>
              )}
            </div>
          ) : (
            filteredLogs.map((log, i) => {
              const isErr = log.level === "error" || /error|failed|rejected|critical|alert|orphan/i.test(log.message);
              const isWarn = log.level === "warn";
              const isSuccess = log.level === "success";

              let rowClass = "flex items-start space-x-2.5 py-1 px-2 rounded transition-colors";
              let textClass = "text-zinc-300";

              if (isErr) {
                rowClass += " bg-rose-950/30 border border-rose-800/50";
                textClass = "text-rose-300 font-bold";
              } else if (isWarn) {
                rowClass += " bg-amber-950/20";
                textClass = "text-amber-300 font-medium";
              } else if (isSuccess) {
                rowClass += " bg-emerald-950/20";
                textClass = "text-emerald-300 font-semibold";
              }

              return (
                <div key={i} className={rowClass}>
                  <span className="text-zinc-500 shrink-0 text-[10px] font-mono">
                    {formatMillisecondTime(new Date(log.timestamp).getTime())}
                  </span>
                  {log.symbol && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-cyan-400 shrink-0 font-bold font-mono">
                      {log.symbol}
                    </span>
                  )}
                  <span className={`break-all ${textClass}`}>{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
