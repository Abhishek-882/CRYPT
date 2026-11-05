/**
 * Background Clock Synchronization Daemon
 * Periodically calibrates local clock against Binance and Bitget server times in RAM.
 * Order signers read cached integer offsets in <0.001ms with zero in-band network stalls.
 */

import { pooledFetch } from "./agentPoolManager";

let cachedBinanceOffsetMs = 0;
let lastBinanceSync = 0;
let binanceCalibrated = false;
let cachedBitgetOffsetMs = 0;
let lastBitgetSync = 0;
let bitgetCalibrated = false;
let clockSyncTimer: NodeJS.Timeout | null = null;

export function getCachedBinanceOffsetMs(): number {
  return cachedBinanceOffsetMs;
}

export function isBinanceCalibrated(): boolean {
  return binanceCalibrated;
}

export function getLastBinanceSyncTime(): number {
  return lastBinanceSync;
}

export function getCachedBitgetOffsetMs(): number {
  return cachedBitgetOffsetMs;
}

export function isBitgetCalibrated(): boolean {
  return bitgetCalibrated;
}

export function getLastBitgetSyncTime(): number {
  return lastBitgetSync;
}

export async function syncBinanceClock(baseUrl = "https://fapi.binance.com"): Promise<number> {
  const t0 = Date.now();
  const urlsToTry = [baseUrl];
  if (!baseUrl.includes("testnet.binancefuture.com")) {
    urlsToTry.push("https://testnet.binancefuture.com");
  }

  for (const url of urlsToTry) {
    try {
      const res = await pooledFetch(`${url}/fapi/v1/time`, {
        method: "GET",
        headers: { "User-Agent": "FundingRateBot-NextJS/1.0" },
        timeoutMs: 3500,
      });
      if (res.ok && res.json?.serverTime) {
        cachedBinanceOffsetMs = Number(res.json.serverTime) - t0;
        lastBinanceSync = t0;
        binanceCalibrated = true;
        return cachedBinanceOffsetMs;
      }
    } catch {
      // Continue to next candidate
    }
  }

  // Mark sync attempted even if network is restricted so in-band calls don't stall
  lastBinanceSync = t0;
  return cachedBinanceOffsetMs;
}

export async function syncBitgetClock(baseUrl = "https://api.bitget.com"): Promise<number> {
  const t0 = Date.now();
  try {
    const res = await pooledFetch(`${baseUrl}/api/v2/public/time`, {
      method: "GET",
      timeoutMs: 3500,
    });
    const data = res.json;
    const serverTimeRaw =
      data?.data?.serverTime || data?.requestTime || (typeof data?.data === "string" ? data.data : undefined);
    if (serverTimeRaw) {
      const serverTime = Number(serverTimeRaw);
      if (Number.isFinite(serverTime) && serverTime > 0) {
        cachedBitgetOffsetMs = serverTime - t0;
        lastBitgetSync = t0;
        bitgetCalibrated = true;
      }
    }
  } catch {
    // Retain previous offset on transient network error
  }
  lastBitgetSync = t0;
  return cachedBitgetOffsetMs;
}

export async function runClockSyncCycle(): Promise<void> {
  await Promise.allSettled([
    syncBinanceClock(),
    syncBitgetClock(),
  ]);
}

export function ensureClockSyncDaemon(): void {
  if (clockSyncTimer) return;
  // Initial asynchronous calibration
  runClockSyncCycle().catch(() => {});
  // Recurring 5-second background sweep
  clockSyncTimer = setInterval(() => {
    runClockSyncCycle().catch(() => {});
  }, 5000);

  if (typeof clockSyncTimer.unref === "function") {
    clockSyncTimer.unref();
  }
}

// Auto-start in server environment
if (typeof window === "undefined") {
  ensureClockSyncDaemon();
}

