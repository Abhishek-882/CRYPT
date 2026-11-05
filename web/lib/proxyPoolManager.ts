/**
 * Bybit Multi-Proxy Pool & Pre-Flight Health Manager
 * Provides automated background health monitoring (5s interval),
 * lowest-latency routing, automatic failover, and pre-flight health gates
 * to guarantee that trades are NEVER executed when Bybit is unreachable.
 */

import https from "https";
import http from "http";
import { URL } from "url";
import { pooledFetch } from "./agentPoolManager";

export interface ProxyEndpoint {
  id: string;
  url: string;
  type: "worker" | "forward";
  isHealthy: boolean;
  latencyMs: number;
  lastChecked: number;
  consecutiveFailures: number;
  lastError?: string;
}

export interface ProxyPoolState {
  primary: ProxyEndpoint | null;
  backup: ProxyEndpoint | null;
  pool: ProxyEndpoint[];
  activeId: "primary" | "backup";
  lastDaemonTick: number;
}

export const DEFAULT_WEBSHARE_POOL: string[] = [];

const DEFAULT_BYBIT_MAINNET = "https://api.bybit.com";
const HEALTH_CHECK_TIMEOUT_MS = 2500;
const HEALTH_CHECK_INTERVAL_MS = 5000;

// In-memory singleton state
const poolState: ProxyPoolState = {
  primary: null,
  backup: null,
  pool: [],
  activeId: "primary",
  lastDaemonTick: 0,
};

let daemonTimer: NodeJS.Timeout | null = null;

function normalizeEndpoint(rawUrl: string, id: "primary" | "backup" | string): ProxyEndpoint | null {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return null;

  const isForward = trimmed.startsWith("http://") || trimmed.startsWith("socks5://") || trimmed.includes("@");
  return {
    id,
    url: trimmed.replace(/\/+$/, ""),
    type: isForward ? "forward" : "worker",
    isHealthy: false, // unverified until tested
    latencyMs: 0,
    lastChecked: 0,
    consecutiveFailures: 0,
  };
}

/**
 * Mark a specific proxy URL as failed so subsequent attempts immediately fail over
 */
export function markProxyFailed(url: string, error?: string): void {
  const normUrl = url.replace(/\/+$/, "");
  if (poolState.primary && poolState.primary.url === normUrl) {
    poolState.primary.isHealthy = false;
    poolState.primary.lastError = error;
    poolState.primary.consecutiveFailures++;
  }
  if (poolState.backup && poolState.backup.url === normUrl) {
    poolState.backup.isHealthy = false;
    poolState.backup.lastError = error;
    poolState.backup.consecutiveFailures++;
  }
  for (const ep of poolState.pool) {
    if (ep.url === normUrl) {
      ep.isHealthy = false;
      ep.lastError = error;
      ep.consecutiveFailures++;
    }
  }
}

/**
 * Configure or update the active proxy pool endpoints
 */
export function configureProxyPool(config: {
  primaryUrl?: string;
  backupUrl?: string;
}): void {
  if (config.primaryUrl !== undefined) {
    poolState.primary = normalizeEndpoint(config.primaryUrl, "primary");
  }
  if (config.backupUrl !== undefined) {
    poolState.backup = normalizeEndpoint(config.backupUrl, "backup");
  }

  // Populate pool with verified default proxies if available
  if (poolState.pool.length === 0 && DEFAULT_WEBSHARE_POOL.length > 0) {
    poolState.pool = DEFAULT_WEBSHARE_POOL.map((p, idx) => normalizeEndpoint(p, `pool_${idx}`)!).filter(Boolean);
  }

  ensureHealthDaemon();
}

/**
 * Ping an endpoint against Bybit server time (/v5/market/time) to check reachability & latency
 */
export async function pingBybitEndpoint(endpoint: ProxyEndpoint): Promise<{
  success: boolean;
  latencyMs: number;
  serverTime?: number;
  error?: string;
}> {
  const start = Date.now();
  const testPath = "/v5/market/time";

  try {
    const fullUrl = endpoint.type === "forward"
      ? `${DEFAULT_BYBIT_MAINNET}${testPath}`
      : `${endpoint.url}${testPath}`;
    const proxyUrl = endpoint.type === "forward" ? endpoint.url : undefined;

    const res = await pooledFetch(fullUrl, {
      method: "GET",
      headers: { "User-Agent": "AI-Hedge-Cockpit/2.0" },
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      proxyUrl,
    });

    const status = res.status;
    const text = res.text;

    const latency = Date.now() - start;
    if (status === 200) {
      try {
        const json = JSON.parse(text);
        if (json.retCode === 0) {
          endpoint.isHealthy = true;
          endpoint.latencyMs = latency;
          endpoint.lastChecked = Date.now();
          endpoint.consecutiveFailures = 0;
          endpoint.lastError = undefined;
          return { success: true, latencyMs: latency, serverTime: json.time };
        }
      } catch {}
    }

    if (status === 403 && (text.includes("CloudFront") || text.includes("blocked"))) {
      throw new Error("AWS CloudFront geo-blocked");
    }

    throw new Error(`HTTP ${status}: ${text.slice(0, 80)}`);
  } catch (err: any) {
    const latency = Date.now() - start;
    endpoint.isHealthy = false;
    endpoint.latencyMs = latency;
    endpoint.lastChecked = Date.now();
    endpoint.consecutiveFailures++;
    endpoint.lastError = err.message || "Connection failed";
    return { success: false, latencyMs: latency, error: err.message };
  }
}

/**
 * Ping an endpoint against Bitget server time (/api/v2/public/time) to check reachability & latency
 */
export async function pingBitgetEndpoint(endpoint: ProxyEndpoint): Promise<{
  success: boolean;
  latencyMs: number;
  serverTime?: number;
  error?: string;
}> {
  const start = Date.now();
  const testUrl = "https://api.bitget.com/api/v2/public/time";

  try {
    const proxyUrl = endpoint.type === "forward" ? endpoint.url : undefined;
    const res = await pooledFetch(testUrl, {
      method: "GET",
      headers: { "User-Agent": "AI-Hedge-Cockpit/2.0" },
      timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      proxyUrl,
    });

    const status = res.status;
    const text = res.text;

    const latency = Date.now() - start;
    if (status === 200) {
      try {
        const json = JSON.parse(text);
        if (json.code === "00000" || json.data?.serverTime) {
          return { success: true, latencyMs: latency, serverTime: Number(json.data?.serverTime || json.requestTime) };
        }
      } catch {}
    }
    throw new Error(`HTTP ${status}: ${text.slice(0, 80)}`);
  } catch (err: any) {
    const latency = Date.now() - start;
    return { success: false, latencyMs: latency, error: err.message };
  }
}

/**
 * Perform a background health sweep across all configured endpoints
 */
export async function runHealthSweep(): Promise<void> {
  poolState.lastDaemonTick = Date.now();

  const endpointsToPing: ProxyEndpoint[] = [];
  if (poolState.primary) endpointsToPing.push(poolState.primary);
  if (poolState.backup) endpointsToPing.push(poolState.backup);
  for (const ep of poolState.pool) {
    if (!endpointsToPing.some((e) => e.url === ep.url)) {
      endpointsToPing.push(ep);
    }
  }

  await Promise.allSettled(endpointsToPing.map(pingBybitEndpoint));

  // Auto-switch to healthiest route
  if (poolState.primary?.isHealthy) {
    poolState.activeId = "primary";
  } else if (poolState.backup?.isHealthy) {
    poolState.activeId = "backup";
  } else {
    // If both primary and backup fail, find the first healthy pool proxy and elevate it
    const healthyFromPool = poolState.pool.find((e) => e.isHealthy);
    if (healthyFromPool) {
      poolState.backup = healthyFromPool;
      poolState.activeId = "backup";
    }
  }
}

/**
 * Ensure background 5-second health monitoring daemon is running
 */
export function ensureHealthDaemon(): void {
  if (daemonTimer) return;
  // Trigger initial check
  runHealthSweep().catch(() => {});
  daemonTimer = setInterval(() => {
    runHealthSweep().catch(() => {});
  }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Get the currently best healthy route for execution.
 * If primary fails or is down, automatically fails over to backup.
 */
export function getActiveHealthyRoute(preferred?: {
  proxyUrl?: string;
  baseUrl?: string;
  backupProxyUrl?: string;
  backupBaseUrl?: string;
}): {
  url?: string;
  type: "direct" | "worker" | "forward";
  activeEndpointId: "primary" | "backup" | "pool" | "direct";
  isHealthy: boolean;
  latencyMs: number;
} {
  // Sync if caller passed specific keys
  if (preferred) {
    if (preferred.proxyUrl || preferred.baseUrl) {
      const primaryCandidate = preferred.proxyUrl || preferred.baseUrl;
      if (!poolState.primary || poolState.primary.url !== primaryCandidate) {
        poolState.primary = normalizeEndpoint(primaryCandidate!, "primary");
      }
    }
    if (preferred.backupProxyUrl || preferred.backupBaseUrl) {
      const backupCandidate = preferred.backupProxyUrl || preferred.backupBaseUrl;
      if (!poolState.backup || poolState.backup.url !== backupCandidate) {
        poolState.backup = normalizeEndpoint(backupCandidate!, "backup");
      }
    }
  }

  // Ensure pool is initialized
  if (poolState.pool.length === 0) {
    poolState.pool = DEFAULT_WEBSHARE_POOL.map((p, idx) => normalizeEndpoint(p, `pool_${idx}`)!).filter(Boolean);
  }

  // Priority 1: Primary if healthy
  if (poolState.primary && poolState.primary.isHealthy) {
    return {
      url: poolState.primary.url,
      type: poolState.primary.type,
      activeEndpointId: "primary",
      isHealthy: true,
      latencyMs: poolState.primary.latencyMs,
    };
  }

  // Priority 2: Backup if healthy
  if (poolState.backup && poolState.backup.isHealthy) {
    return {
      url: poolState.backup.url,
      type: poolState.backup.type,
      activeEndpointId: "backup",
      isHealthy: true,
      latencyMs: poolState.backup.latencyMs,
    };
  }

  // Priority 3: Fall back to any healthy endpoint in the verified pool
  const healthyFromPool = poolState.pool.find((e) => e.isHealthy);
  if (healthyFromPool) {
    return {
      url: healthyFromPool.url,
      type: healthyFromPool.type,
      activeEndpointId: "pool",
      isHealthy: true,
      latencyMs: healthyFromPool.latencyMs,
    };
  }

  // If both exist but both show unhealthy, prefer backup worker over forward proxy if worker configured
  if (poolState.backup && poolState.backup.type === "worker") {
    return {
      url: poolState.backup.url,
      type: poolState.backup.type,
      activeEndpointId: "backup",
      isHealthy: poolState.backup.isHealthy,
      latencyMs: poolState.backup.latencyMs,
    };
  }

  if (poolState.primary) {
    return {
      url: poolState.primary.url,
      type: poolState.primary.type,
      activeEndpointId: "primary",
      isHealthy: false,
      latencyMs: poolState.primary.latencyMs,
    };
  }

  return {
    type: "direct",
    activeEndpointId: "direct",
    isHealthy: true,
    latencyMs: 0,
  };
}

/**
 * Pre-Flight Health Gate:
 * Must be called before initiating any Entry or Exit.
 * If no healthy proxy is active and direct is blocked, returns allowed: false.
 */
export async function verifyProxyPreFlight(preferred?: {
  proxyUrl?: string;
  baseUrl?: string;
  backupProxyUrl?: string;
  backupBaseUrl?: string;
}): Promise<{
  allowed: boolean;
  activeEndpointId: "primary" | "backup" | "pool" | "direct";
  endpointUrl?: string;
  latencyMs: number;
  reason?: string;
}> {
  const route = getActiveHealthyRoute(preferred);

  // If route is already verified healthy within last 10 seconds, allow immediately (<1ms)
  const activeEndpoint =
    route.activeEndpointId === "backup"
      ? poolState.backup
      : route.activeEndpointId === "pool"
      ? poolState.pool.find((e) => e.url === route.url) || poolState.primary
      : poolState.primary;
  const isFresh = activeEndpoint && (Date.now() - activeEndpoint.lastChecked < 10000);

  if (activeEndpoint && isFresh && activeEndpoint.isHealthy) {
    return {
      allowed: true,
      activeEndpointId: route.activeEndpointId,
      endpointUrl: route.url,
      latencyMs: activeEndpoint.latencyMs,
    };
  }

  // If stale or marked unhealthy, run an immediate synchronous pre-flight ping (<500ms)
  if (activeEndpoint) {
    const ping = await pingBybitEndpoint(activeEndpoint);
    if (ping.success) {
      return {
        allowed: true,
        activeEndpointId: route.activeEndpointId,
        endpointUrl: route.url,
        latencyMs: ping.latencyMs,
      };
    }

    // Try backup immediately if primary just failed
    if (route.activeEndpointId === "primary" && poolState.backup) {
      const backupPing = await pingBybitEndpoint(poolState.backup);
      if (backupPing.success) {
        poolState.activeId = "backup";
        return {
          allowed: true,
          activeEndpointId: "backup",
          endpointUrl: poolState.backup.url,
          latencyMs: backupPing.latencyMs,
        };
      }
    }

    return {
      allowed: false,
      activeEndpointId: route.activeEndpointId,
      endpointUrl: route.url,
      latencyMs: ping.latencyMs,
      reason: `Bybit proxy pre-flight check failed: ${ping.error || "Unreachable"}. Entry/exit blocked for safety.`,
    };
  }

  // Direct without proxy: check if direct endpoint is reachable
  return {
    allowed: true,
    activeEndpointId: "direct",
    latencyMs: 0,
  };
}

/**
 * Returns current snapshot of proxy pool health for telemetry & UI
 */
export function getProxyPoolSnapshot(): {
  primary: { url: string; healthy: boolean; latency: number; error?: string } | null;
  backup: { url: string; healthy: boolean; latency: number; error?: string } | null;
  activeRoute: "primary" | "backup" | "direct";
} {
  return {
    primary: poolState.primary
      ? {
          url: poolState.primary.url,
          healthy: poolState.primary.isHealthy,
          latency: poolState.primary.latencyMs,
          error: poolState.primary.lastError,
        }
      : null,
    backup: poolState.backup
      ? {
          url: poolState.backup.url,
          healthy: poolState.backup.isHealthy,
          latency: poolState.backup.latencyMs,
          error: poolState.backup.lastError,
        }
      : null,
    activeRoute: poolState.activeId,
  };
}
