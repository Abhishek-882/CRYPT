/**
 * In-Memory Sliding-Window Rate Limiter & Anti-Burst Protection
 * Protects serverless API routes from rapid double-clicks, burst order flooding,
 * and exchange API key IP bans.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const clientRequestStore = new Map<string, RateLimitRecord>();

// Clean up stale client records every 60 seconds
setInterval(() => {
  const now = Date.now();
  clientRequestStore.forEach((record, key) => {
    record.timestamps = record.timestamps.filter((ts) => now - ts < 60000);
    if (record.timestamps.length === 0) {
      clientRequestStore.delete(key);
    }
  });
}, 60000);

export interface RateLimitOptions {
  windowMs?: number;    // e.g. 5000ms window
  maxRequests?: number; // e.g. 8 requests per window
}

export function checkRateLimit(
  clientId: string,
  options: RateLimitOptions = {}
): { allowed: boolean; remaining: number; resetMs: number } {
  const windowMs = options.windowMs || 5000;
  const maxRequests = options.maxRequests || 8;
  const now = Date.now();

  let record = clientRequestStore.get(clientId);
  if (!record) {
    record = { timestamps: [] };
    clientRequestStore.set(clientId, record);
  }

  // Keep only timestamps within the sliding window
  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - record.timestamps.length,
    resetMs: windowMs,
  };
}
