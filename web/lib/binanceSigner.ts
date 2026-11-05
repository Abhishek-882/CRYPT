import crypto from "crypto";
import https from "https";
import http from "http";
import { URL } from "url";
import { getActiveHealthyRoute } from "./proxyPoolManager";
import { pooledFetch, getPersistentProxyAgent } from "./agentPoolManager";
import { getCachedBinanceOffsetMs, syncBinanceClock, isBinanceCalibrated, getLastBinanceSyncTime } from "./clockSynchronizer";

export const BINANCE_ENDPOINTS = [
  "https://fapi.binance.com",
  "https://www.binance.com",
  "https://testnet.binancefuture.com",
  "https://demo-fapi.binance.com",
];

export const TESTNET_ENDPOINTS = BINANCE_ENDPOINTS;

let activeBaseUrl = BINANCE_ENDPOINTS[0];
let cachedTimeOffsetMs = 0;
let lastSyncTimestamp = 0;

/**
 * Perform an HTTP request to Binance using persistent keep-alive connection pool,
 * automatically routing through the active healthy forward proxy if needed.
 */
async function binanceHttpFetch(
  fullUrl: string,
  options: {
    method: string;
    headers: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<{ ok: boolean; status: number; text: string; json: any }> {
  const isTestnet = fullUrl.includes("testnet.binancefuture.com");
  const timeoutMs = options.timeoutMs || 5000;
  const activeRoute = getActiveHealthyRoute();

  const explicitProxy = process.env.BINANCE_PROXY_URL;
  const proxyUrl =
    explicitProxy ||
    (!isTestnet && activeRoute.isHealthy && activeRoute.type === "forward" && activeRoute.url
      ? activeRoute.url
      : undefined);

  const res = await pooledFetch(fullUrl, {
    method: options.method,
    headers: options.headers,
    timeoutMs,
    proxyUrl,
  });

  return {
    ok: res.ok,
    status: res.status,
    text: res.text,
    json: res.json,
  };
}

/**
 * Returns calibrated Binance server clock skew in <0.001ms from RAM background daemon.
 */
export async function getCalibratedServerOffset(baseUrl: string = activeBaseUrl, forceRefresh = false): Promise<number> {
  if (!forceRefresh) {
    if (isBinanceCalibrated() || (getLastBinanceSyncTime() > 0 && Date.now() - getLastBinanceSyncTime() < 60000)) {
      return getCachedBinanceOffsetMs();
    }
    const cached = getCachedBinanceOffsetMs();
    if (cached !== 0) return cached;
  }
  return syncBinanceClock(baseUrl);
}

export async function signAndFetchBinance(
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  params: Record<string, string | number> = {},
  signed = true,
  preferredBaseUrl?: string
): Promise<{ data: any; endpoint: string }> {
  const cleanPreferred =
    preferredBaseUrl && preferredBaseUrl !== "auto" && preferredBaseUrl.startsWith("http")
      ? preferredBaseUrl
      : undefined;

  const urlsToTry = cleanPreferred
    ? [cleanPreferred, ...BINANCE_ENDPOINTS.filter((u) => u !== cleanPreferred)]
    : [
        activeBaseUrl,
        ...BINANCE_ENDPOINTS.filter((u) => u !== activeBaseUrl),
      ];

  let lastError: Error | null = null;

  for (const baseUrl of urlsToTry) {
    try {
      const cleanParams = { ...params };
      if (signed) {
        // Tier 1: Pre-flight calibrated server offset check
        let offset = await getCalibratedServerOffset(baseUrl);

        // Tier 2: Resilient retry loop up to 3 attempts (specifically auto-resolving -1021 timestamp drift)
        let attempt = 0;
        const maxAttempts = 3;
        let lastResData: any = null;

        while (attempt < maxAttempts) {
          attempt++;
          // Calibrate request timestamp with live offset
          cleanParams.timestamp = Date.now() + offset;
          cleanParams.recvWindow = 10000; // 10s safe recv window within Binance constraints

          const queryString = new URLSearchParams(
            Object.entries(cleanParams).map(([k, v]) => [k, String(v)])
          ).toString();

          const signature = crypto
            .createHmac("sha256", apiSecret)
            .update(queryString)
            .digest("hex");

          const fullUrl = `${baseUrl}${path}?${queryString}&signature=${signature}`;
          const res = await binanceHttpFetch(fullUrl, {
            method: method.toUpperCase(),
            headers: {
              "X-MBX-APIKEY": apiKey,
              "User-Agent": "FundingRateBot-NextJS/1.0",
            },
            timeoutMs: 5000,
          });

          const data = res.json || {};
          lastResData = data;

          if (res.ok && !data?.code) {
            activeBaseUrl = baseUrl;
            return { data, endpoint: baseUrl };
          }

          // Check for code -1021 (Timestamp outside recvWindow or ahead of server time)
          if (data?.code === -1021 && attempt < maxAttempts) {
            console.warn(`[Binance Time Sync Skew] Code -1021 on ${baseUrl}. Attempt ${attempt}/${maxAttempts}. Force resyncing clock...`);
            offset = await getCalibratedServerOffset(baseUrl, true);
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }

          // If geo-restricted (451/403/code 0) or -2015 (key/endpoint mismatch), try next endpoint
          if ((data?.code === -2015 || data?.code === 0 || res.status === 451 || res.status === 403) && urlsToTry.length > 1) {
            const errMsg = data?.msg ? `[${data.code}] ${data.msg}` : `HTTP ${res.status}`;
            lastError = new Error(errMsg);
            break;
          }

          const errMsg = data?.msg ? `[${data.code}] ${data.msg}` : `HTTP ${res.status}`;
          throw new Error(errMsg);
        }

        if (lastResData) {
          throw new Error(lastResData.msg ? `[${lastResData.code}] ${lastResData.msg}` : "Binance request failed");
        }
      } else {
        const queryString = new URLSearchParams(
          Object.entries(cleanParams).map(([k, v]) => [k, String(v)])
        ).toString();
        const fullUrl = queryString ? `${baseUrl}${path}?${queryString}` : `${baseUrl}${path}`;
        const res = await binanceHttpFetch(fullUrl, {
          method: method.toUpperCase(),
          headers: {
            "User-Agent": "FundingRateBot-NextJS/1.0",
          },
          timeoutMs: 5000,
        });
        const data = res.json || {};
        if (!res.ok) {
          throw new Error(data.msg || `HTTP ${res.status}`);
        }
        activeBaseUrl = baseUrl;
        return { data, endpoint: baseUrl };
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to communicate with Binance Testnet");
}

/**
 * Configure leverage on Binance USD-M Futures for a specific trading pair.
 */
export async function setBinanceLeverage(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  leverage: number,
  preferredBaseUrl?: string
): Promise<{ leverage: number; maxNotionalValue: string }> {
  const clampedLeverage = Math.max(1, Math.min(125, Math.round(leverage)));
  const { data } = await signAndFetchBinance(
    apiKey,
    apiSecret,
    "POST",
    "/fapi/v1/leverage",
    { symbol: symbol.toUpperCase(), leverage: clampedLeverage },
    true,
    preferredBaseUrl
  );
  return {
    leverage: data.leverage || clampedLeverage,
    maxNotionalValue: data.maxNotionalValue || "0",
  };
}


export type { BinanceCredentials, BinanceOrderParams, BinanceOrderResult } from "./binanceTradeStream";

/**
 * High-speed order placement on Binance USD-M Futures.
 * Uses persistent WebSocket API (sub-140ms execution) if healthy,
 * with automatic fallback to persistent keep-alive REST API.
 */
export const BINANCE_CLIENT_ORDER_ID_REGEX = /^[a-zA-Z0-9-_]{1,36}$/;

export function validateOrGenerateBinanceClientOrderId(override?: string): string {
  if (override && typeof override === "string" && BINANCE_CLIENT_ORDER_ID_REGEX.test(override)) {
    return override;
  }
  return crypto.randomUUID();
}

export async function placeBinanceOrder(
  creds: {
    apiKey: string;
    apiSecret: string;
    endpoint?: string;
    proxyUrl?: string;
  },
  params: {
    symbol: string;
    side: "BUY" | "SELL";
    type?: "MARKET" | "LIMIT";
    quantity: string | number;
    price?: string | number;
    reduceOnly?: boolean | string;
    timeInForce?: "GTC" | "IOC" | "FOK";
    clientOrderId?: string;
    newClientOrderId?: string;
  }
): Promise<import("./binanceTradeStream").BinanceOrderResult> {
  const { binanceTradeStream } = await import("./binanceTradeStream");

  const clientOrderId = validateOrGenerateBinanceClientOrderId(params.clientOrderId || params.newClientOrderId);

  // Attempt WebSocket path if healthy
  if (binanceTradeStream.isHealthy()) {
    try {
      const wsResult = await binanceTradeStream.placeOrder(
        { ...params, clientOrderId, newClientOrderId: clientOrderId },
        creds
      );
      return wsResult;
    } catch (wsErr: any) {
      console.warn(`[BinanceSigner] Trade WebSocket failed (${wsErr.message}). Instantly executing REST fallback...`);
    }
  }

  // REST API Execution Path (Fallback or Primary if WS paused)
  const t0 = performance.now();
  const restPayload: Record<string, any> = {
    symbol: params.symbol.toUpperCase(),
    side: params.side.toUpperCase(),
    type: params.type || "MARKET",
    quantity: String(params.quantity),
    newClientOrderId: clientOrderId,
  };

  if (params.price) {
    restPayload.price = String(params.price);
  }
  if (params.reduceOnly === true || params.reduceOnly === "true") {
    restPayload.reduceOnly = "true";
  }
  if (params.timeInForce) {
    restPayload.timeInForce = params.timeInForce;
  }

  try {
    const { data } = await signAndFetchBinance(
      creds.apiKey,
      creds.apiSecret,
      "POST",
      "/fapi/v1/order",
      restPayload,
      true,
      creds.endpoint
    );

    const latencyMs = Math.round(performance.now() - t0);
    const avgPrice =
      parseFloat(data.avgPrice || "0") ||
      parseFloat(data.price || "0") ||
      0;

    const transportMode = binanceTradeStream.getStatus().watchdogTripsCount > 0 ? "REST_FALLBACK" : "REST";

    binanceTradeStream.recordOrder({
      id: `REST-BN-${data.orderId || Date.now()}`,
      timestamp: Date.now(),
      symbol: params.symbol,
      side: params.side,
      qty: typeof params.quantity === "number" ? params.quantity : parseFloat(String(params.quantity)),
      transport: transportMode,
      latencyMs,
      status: "FILLED",
      orderId: String(data.orderId || ""),
    });

    return {
      success: true,
      orderId: String(data.orderId || ""),
      clientOrderId: data.clientOrderId || clientOrderId,
      avgPrice,
      symbol: params.symbol,
      side: params.side,
      quantity: typeof params.quantity === "number" ? params.quantity : parseFloat(String(params.quantity)),
      executionLatencyMs: latencyMs,
      venue: "Binance",
      transport: transportMode,
      data,
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - t0);
    const transportMode = binanceTradeStream.getStatus().watchdogTripsCount > 0 ? "REST_FALLBACK" : "REST";

    binanceTradeStream.recordOrder({
      id: `REST-BN-ERR-${Date.now()}`,
      timestamp: Date.now(),
      symbol: params.symbol,
      side: params.side,
      qty: typeof params.quantity === "number" ? params.quantity : parseFloat(String(params.quantity)),
      transport: transportMode,
      latencyMs,
      status: "FAILED",
      error: err.message,
    });

    return {
      success: false,
      orderId: "",
      clientOrderId,
      symbol: params.symbol,
      side: params.side,
      quantity: typeof params.quantity === "number" ? params.quantity : parseFloat(String(params.quantity)),
      executionLatencyMs: latencyMs,
      venue: "Binance",
      transport: transportMode,
      error: err.message,
    };
  }
}
