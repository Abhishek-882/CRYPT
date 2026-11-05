import crypto from "crypto";
import https from "https";
import http from "http";
import { URL } from "url";
import { pooledFetch } from "./agentPoolManager";
import {
  getActiveHealthyRoute,
  pingBybitEndpoint,
  ensureHealthDaemon,
  configureProxyPool,
  markProxyFailed,
} from "./proxyPoolManager";

export interface BybitCredentials {
  apiKey: string;
  apiSecret: string;
  proxyUrl?: string; // Optional forward proxy e.g. http://user:pass@host:port or socks5://host:port
  baseUrl?: string;  // Optional reverse proxy base URL e.g. https://bybit-proxy.workers.dev
  backupProxyUrl?: string; // Optional backup forward proxy
  backupBaseUrl?: string;  // Optional backup reverse proxy base URL
  isPaper?: boolean;
  isDemo?: boolean;
}

export interface BybitOrderParams {
  category?: "spot" | "linear";
  symbol: string; // e.g. "BTCUSDT"
  side: "Buy" | "Sell";
  orderType?: "Market" | "Limit";
  qty: number | string;
  price?: number | string;
  marketUnit?: "baseCoin" | "quoteCoin";
  positionIdx?: 0 | 1 | 2; // 0=one-way, 1=hedge buy, 2=hedge sell
  timeInForce?: "GTC" | "IOC" | "FOK";
  reduceOnly?: boolean;
  orderLinkId?: string;
  clientOrderId?: string;
}

export interface BybitPosition {
  venue: "Bybit";
  symbol: string;
  size: number;
  amount?: number;
  side: "Buy" | "Sell" | "None";
  entryPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  unrealizedPnl?: number;
  leverage: number;
  positionIdx: number;
  liquidationPrice?: number;
}

export interface BybitAccountResult {
  success: boolean;
  venue: string;
  equity: number;
  available: number;
  walletBalance: number;
  unrealizedPnL: number;
  positions: BybitPosition[];
  isSimulated: boolean;
  error?: string;
  retCode?: number;
  raw?: any;
}

export interface BybitOrderResult {
  success: boolean;
  orderId?: string;
  orderLinkId?: string;
  clientOrderId?: string;
  symbol: string;
  side: "Buy" | "Sell";
  quantity: number;
  avgPrice?: number;
  executionLatencyMs: number;
  venue: string;
  isSimulated: boolean;
  transport?: "WEBSOCKET" | "REST" | "REST_FALLBACK";
  error?: string;
  retCode?: number;
  data?: any;
}

const DEFAULT_BYBIT_BASE_URL = "https://api.bybit.com";
const RECV_WINDOW = 20000;

let bybitServerTimeOffset = 0;
let lastBybitSyncTime = 0;

export async function syncBybitClock(baseUrl = DEFAULT_BYBIT_BASE_URL): Promise<number> {
  try {
    const t0 = Date.now();
    const res = await pooledFetch(`${baseUrl}/v5/market/time`, { timeoutMs: 3000 });
    if (res.ok && res.json?.time) {
      const serverTime = parseInt(res.json.time, 10);
      const rtt = Date.now() - t0;
      bybitServerTimeOffset = serverTime - (t0 + Math.round(rtt / 2));
      lastBybitSyncTime = Date.now();
      return bybitServerTimeOffset;
    }
  } catch {}
  return bybitServerTimeOffset;
}

export function getBybitServerTime(): number {
  if (lastBybitSyncTime === 0 || Date.now() - lastBybitSyncTime > 60000) {
    syncBybitClock().catch(() => {});
  }
  return Date.now() + bybitServerTimeOffset;
}

export function getBybitHeaders(
  creds: BybitCredentials,
  method: "GET" | "POST",
  paramsOrBody: Record<string, any> = {},
  recvWindow: number = RECV_WINDOW
): { headers: Record<string, string>; body?: string; queryString?: string } {
  const timestamp = getBybitServerTime().toString();
  let paramStr = "";
  let bodyStr: string | undefined = undefined;
  let queryString = "";

  if (method === "GET") {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(paramsOrBody)) {
      if (v !== undefined && v !== null) {
        searchParams.append(k, String(v));
      }
    }
    queryString = searchParams.toString();
    paramStr = timestamp + creds.apiKey + recvWindow.toString() + queryString;
  } else {
    bodyStr = JSON.stringify(paramsOrBody);
    paramStr = timestamp + creds.apiKey + recvWindow.toString() + bodyStr;
  }

  const signature = crypto
    .createHmac("sha256", creds.apiSecret)
    .update(paramStr)
    .digest("hex");

  const headers: Record<string, string> = {
    "X-BAPI-API-KEY": creds.apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-SIGN": signature,
    "X-BAPI-RECV-WINDOW": recvWindow.toString(),
    "X-BAPI-SIGN-TYPE": "1",
    "Content-Type": "application/json",
    "User-Agent": "AI-Hedge-Cockpit/2.0",
  };

  return { headers, body: bodyStr, queryString };
}

/**
 * Execute request against Bybit API with resilient multi-proxy failover pool and micro-retry
 */
export async function sendBybitRequest(
  endpoint: string,
  method: "GET" | "POST",
  creds: BybitCredentials,
  paramsOrBody: Record<string, any> = {}
): Promise<any> {
  const primaryCandidate = creds.proxyUrl || creds.baseUrl || process.env.BYBIT_PROXY_URL || process.env.BYBIT_BASE_URL;
  const backupCandidate = creds.backupProxyUrl || creds.backupBaseUrl || process.env.BYBIT_BACKUP_PROXY_URL || process.env.BYBIT_BACKUP_BASE_URL;

  if (primaryCandidate || backupCandidate) {
    configureProxyPool({
      primaryUrl: primaryCandidate,
      backupUrl: backupCandidate,
    });
  }

  const MAX_RETRIES = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Generate fresh timestamped headers on each attempt
    const { headers, body, queryString } = getBybitHeaders(creds, method, paramsOrBody);

    // Resolve active healthy route dynamically for this attempt
    const activeRoute = getActiveHealthyRoute({
      proxyUrl: creds.proxyUrl,
      baseUrl: creds.baseUrl,
      backupProxyUrl: creds.backupProxyUrl,
      backupBaseUrl: creds.backupBaseUrl,
    });

    let baseUrl = DEFAULT_BYBIT_BASE_URL;
    let proxyAgentUrl: string | undefined = undefined;

    if (activeRoute.type === "worker" && activeRoute.url) {
      baseUrl = activeRoute.url.replace(/\/+$/, "");
    } else if (activeRoute.type === "forward" && activeRoute.url) {
      baseUrl = DEFAULT_BYBIT_BASE_URL;
      proxyAgentUrl = activeRoute.url;
    } else if (creds.baseUrl) {
      baseUrl = creds.baseUrl.replace(/\/+$/, "");
    } else if (creds.proxyUrl) {
      proxyAgentUrl = creds.proxyUrl;
    }

    const fullUrl = method === "GET" && queryString
      ? `${baseUrl}${endpoint}?${queryString}`
      : `${baseUrl}${endpoint}`;

    try {
      const res = await pooledFetch(fullUrl, {
        method,
        headers,
        body,
        timeoutMs: 4000,
        proxyUrl: proxyAgentUrl,
      });

      const status = res.status;
      const text = res.text;

      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        if (status === 403 && (text.includes("CloudFront") || text.includes("blocked"))) {
          throw new Error(
            "Bybit REST API is geo-blocked by CloudFront on this server. Configure Bybit Proxy / Worker URL in Cockpit Settings."
          );
        }
        throw new Error(`Bybit returned HTTP ${status}: ${text.slice(0, 160)}`);
      }

      if (json?.retCode === 10002 && attempt < MAX_RETRIES) {
        console.warn(`[Bybit Time Sync Skew] RetCode 10002 on attempt ${attempt}. Force resyncing clock with Bybit...`);
        await syncBybitClock(baseUrl);
        continue;
      }

      return json;
    } catch (err: any) {
      lastError = err;
      if (proxyAgentUrl) {
        markProxyFailed(proxyAgentUrl, err.message);
      }
      // Do not retry fatal auth, geo-block, or proxy quota exhaustion
      if (
        err.message?.includes("Invalid API Key") ||
        err.message?.includes("Error Sign") ||
        err.message?.includes("Bandwidth limit reached") ||
        err.message?.includes("CloudFront") ||
        err.message?.includes("geo-blocked")
      ) {
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        // Fast micro-backoff for low latency failover
        const backoffMs = attempt === 1 ? 50 : 150;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw lastError;
}

/**
 * Test live connectivity to Bybit and measure latency across active proxy routes
 */
export async function testBybitConnectivity(creds: BybitCredentials): Promise<{
  success: boolean;
  latencyMs: number;
  reachable: boolean;
  proxyActive: boolean;
  activeRoute?: "primary" | "backup" | "pool" | "direct";
  equity?: number;
  available?: number;
  error?: string;
  retCode?: number;
}> {
  const start = Date.now();
  const primaryCandidate = creds.proxyUrl || creds.baseUrl || process.env.BYBIT_PROXY_URL || process.env.BYBIT_BASE_URL;
  const backupCandidate = creds.backupProxyUrl || creds.backupBaseUrl || process.env.BYBIT_BACKUP_PROXY_URL || process.env.BYBIT_BACKUP_BASE_URL;
  const proxyActive = Boolean(primaryCandidate || backupCandidate);

  const route = getActiveHealthyRoute({
    proxyUrl: creds.proxyUrl,
    baseUrl: creds.baseUrl,
    backupProxyUrl: creds.backupProxyUrl,
    backupBaseUrl: creds.backupBaseUrl,
  });

  try {
    const account = await fetchBybitAccount(creds);
    const latency = Date.now() - start;

    if (!account.success) {
      return {
        success: false,
        latencyMs: latency,
        reachable: true,
        proxyActive,
        activeRoute: route.activeEndpointId,
        error: account.error,
        retCode: account.retCode,
      };
    }

    return {
      success: true,
      latencyMs: latency,
      reachable: true,
      proxyActive,
      activeRoute: route.activeEndpointId,
      equity: account.equity,
      available: account.available,
    };
  } catch (err: any) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      reachable: false,
      proxyActive,
      activeRoute: route.activeEndpointId,
      error: err.message || "Failed to reach Bybit",
    };
  }
}

/**
 * Fetch Bybit Unified Trading Account wallet balance & equity
 */
export async function fetchBybitAccount(creds: BybitCredentials): Promise<BybitAccountResult> {
  if (creds?.isPaper || creds?.isDemo) {
    return {
      success: true,
      venue: "Bybit-Paper",
      equity: 5000.0,
      available: 5000.0,
      walletBalance: 5000.0,
      unrealizedPnL: 0,
      positions: [],
      isSimulated: true,
    };
  }

  try {
    const [data, positions] = await Promise.all([
      sendBybitRequest("/v5/account/wallet-balance", "GET", creds, {
        accountType: "UNIFIED",
      }),
      fetchBybitPositions(creds),
    ]);

    if (data.retCode !== 0) {
      return {
        success: false,
        venue: "Bybit",
        equity: 0,
        available: 0,
        walletBalance: 0,
        unrealizedPnL: 0,
        positions: [],
        isSimulated: false,
        error: data.retMsg || `Bybit Error code ${data.retCode}`,
        retCode: data.retCode,
      };
    }

    const account = data.result?.list?.[0];
    const totalEquity = parseFloat(account?.totalEquity || "0");
    const totalAvailable = parseFloat(account?.totalAvailableBalance || "0");
    const totalWalletBalance = parseFloat(account?.totalWalletBalance || "0");
    const totalUnrealizedPnl = parseFloat(account?.totalPerpUPL || account?.totalUnrealisedPnl || "0");

    // USDT specific coin balance
    const usdtCoin = (account?.coin || []).find((c: any) => c.coin === "USDT");
    const usdtAvailable = usdtCoin ? parseFloat(usdtCoin.availableToWithdraw || usdtCoin.walletBalance || "0") : totalAvailable;

    return {
      success: true,
      venue: "Bybit",
      equity: totalEquity,
      available: usdtAvailable > 0 ? usdtAvailable : totalAvailable,
      walletBalance: totalWalletBalance,
      unrealizedPnL: totalUnrealizedPnl,
      positions: positions || [],
      isSimulated: false,
      raw: account,
    };
  } catch (err: any) {
    return {
      success: false,
      venue: "Bybit",
      equity: 0,
      available: 0,
      walletBalance: 0,
      unrealizedPnL: 0,
      positions: [],
      isSimulated: false,
      error: err.message || "Failed to fetch Bybit balance",
    };
  }
}

/**
 * Fetch open linear positions
 */
export async function fetchBybitPositions(
  creds: BybitCredentials,
  symbol?: string
): Promise<BybitPosition[]> {
  try {
    const params: Record<string, any> = { category: "linear" };
    if (symbol) params.symbol = symbol;
    else params.settleCoin = "USDT";

    const data = await sendBybitRequest("/v5/position/list", "GET", creds, params);
    if (data.retCode !== 0 || !Array.isArray(data.result?.list)) {
      return [];
    }

    return data.result.list
      .filter((p: any) => parseFloat(p.size || "0") > 0)
      .map((p: any) => {
        const sizeNum = parseFloat(p.size || "0");
        const isSell = p.side === "Sell";
        const pnl = parseFloat(p.unrealisedPnl || "0");
        return {
          venue: "Bybit" as const,
          symbol: p.symbol,
          size: sizeNum,
          amount: isSell ? -sizeNum : sizeNum,
          side: p.side === "Buy" ? "Buy" : isSell ? "Sell" : "None",
          entryPrice: parseFloat(p.avgPrice || "0"),
          markPrice: parseFloat(p.markPrice || "0"),
          unrealisedPnl: pnl,
          unrealizedPnl: pnl,
          leverage: parseFloat(p.leverage || "1"),
          positionIdx: parseInt(p.positionIdx || "0", 10),
          liquidationPrice: parseFloat(p.liqPrice || "0") || undefined,
        };
      });
  } catch {
    return [];
  }
}

export const BYBIT_ORDER_LINK_ID_REGEX = /^[a-zA-Z0-9-_]{1,36}$/;

export function validateOrGenerateBybitOrderLinkId(override?: string): string {
  if (override && typeof override === "string" && BYBIT_ORDER_LINK_ID_REGEX.test(override)) {
    return override;
  }
  return crypto.randomUUID();
}

/**
 * Place order on Bybit Linear Futures
 */
export async function placeBybitOrder(
  creds: BybitCredentials,
  params: BybitOrderParams
): Promise<BybitOrderResult> {
  const { bybitTradeStream } = await import("./bybitTradeStream");

  const orderLinkId = validateOrGenerateBybitOrderLinkId(params.orderLinkId || params.clientOrderId);

  // Attempt Trade WebSocket path if healthy
  if (bybitTradeStream.isHealthy()) {
    try {
      const wsResult = await bybitTradeStream.placeOrder({ ...params, orderLinkId }, creds);
      return wsResult;
    } catch (wsErr: any) {
      console.warn(`[BybitSigner] Trade WebSocket failed (${wsErr.message}). Instantly executing REST API fallback...`);
      // Watchdog already tripped in bybitTradeStream.placeOrder, fall through to REST fallback
    }
  }

  // HTTP REST Execution Path (Primary when WS paused, or instant fallback on timeout)
  const start = Date.now();
  try {
    const category = params.category || "linear";
    const payload: Record<string, any> = {
      category,
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType || "Market",
      qty: String(params.qty),
      timeInForce: params.timeInForce || "IOC",
      orderLinkId,
    };

    if (category === "linear") {
      payload.positionIdx = params.positionIdx !== undefined ? params.positionIdx : 0;
      if (params.reduceOnly) {
        payload.reduceOnly = true;
      }
    }
    if (params.marketUnit) {
      payload.marketUnit = params.marketUnit;
    } else if (category === "spot" && (params.orderType === "Market" || !params.orderType)) {
      payload.marketUnit = "baseCoin";
    }

    if (params.orderType === "Limit" && params.price) {
      payload.price = String(params.price);
    }

    const data = await sendBybitRequest("/v5/order/create", "POST", creds, payload);
    const latency = Date.now() - start;
    const transportMode = bybitTradeStream.getStatus().watchdogTripsCount > 0 ? "REST_FALLBACK" : "REST";

    if (data.retCode !== 0) {
      bybitTradeStream.recordOrder({
        id: `REST-${Date.now()}`,
        timestamp: Date.now(),
        symbol: params.symbol,
        side: params.side,
        qty: typeof params.qty === "number" ? params.qty : parseFloat(params.qty),
        transport: transportMode,
        latencyMs: latency,
        status: "FAILED",
        error: data.retMsg,
      });

      return {
        success: false,
        symbol: params.symbol,
        side: params.side,
        quantity: typeof params.qty === "number" ? params.qty : parseFloat(params.qty),
        orderLinkId,
        clientOrderId: orderLinkId,
        executionLatencyMs: latency,
        venue: "Bybit",
        isSimulated: false,
        transport: transportMode,
        error: data.retMsg || `Bybit error code ${data.retCode}`,
        retCode: data.retCode,
      };
    }

    bybitTradeStream.recordOrder({
      id: data.result?.orderId || `REST-${Date.now()}`,
      timestamp: Date.now(),
      symbol: params.symbol,
      side: params.side,
      qty: typeof params.qty === "number" ? params.qty : parseFloat(params.qty),
      transport: transportMode,
      latencyMs: latency,
      status: "FILLED",
      orderId: data.result?.orderId,
    });

    return {
      success: true,
      orderId: data.result?.orderId,
      orderLinkId: data.result?.orderLinkId || orderLinkId,
      clientOrderId: data.result?.orderLinkId || orderLinkId,
      symbol: params.symbol,
      side: params.side,
      quantity: typeof params.qty === "number" ? params.qty : parseFloat(params.qty),
      executionLatencyMs: latency,
      venue: "Bybit",
      isSimulated: false,
      transport: transportMode,
      data: data.result,
    };
  } catch (err: any) {
    return {
      success: false,
      orderLinkId,
      clientOrderId: orderLinkId,
      symbol: params.symbol,
      side: params.side,
      quantity: typeof params.qty === "number" ? params.qty : parseFloat(params.qty),
      executionLatencyMs: Date.now() - start,
      venue: "Bybit",
      isSimulated: false,
      transport: "REST_FALLBACK",
      error: err.message || "Bybit order placement failed",
    };
  }
}

/**
 * Cancel an order on Bybit Linear Futures
 */
export async function cancelBybitOrder(
  creds: BybitCredentials,
  symbol: string,
  orderId?: string,
  orderLinkId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: Record<string, any> = {
      category: "linear",
      symbol,
    };
    if (orderId) payload.orderId = orderId;
    if (orderLinkId) payload.orderLinkId = orderLinkId;

    const data = await sendBybitRequest("/v5/order/cancel", "POST", creds, payload);
    return {
      success: data.retCode === 0,
      error: data.retCode === 0 ? undefined : data.retMsg,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Set leverage on Bybit V5 Linear Perpetual
 */
export async function setBybitLeverage(
  creds: BybitCredentials,
  symbol: string,
  leverage: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const levStr = leverage.toString();
    const data = await sendBybitRequest(
      "/v5/position/set-leverage",
      "POST",
      creds,
      {
        category: "linear",
        symbol,
        buyLeverage: levStr,
        sellLeverage: levStr,
      }
    );
    // retCode 0 = success, 110043 = leverage not modified (already at target leverage)
    if (data.retCode === 0 || data.retCode === 110043) {
      return { success: true };
    }
    return { success: false, error: data.retMsg || `Bybit retCode ${data.retCode}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Upgrade 2 Pre-Flight Helper: Fetch unified account wallet balance
 */
export async function getBybitWalletBalance(creds: BybitCredentials): Promise<{
  totalEquity: number;
  availableBalance: number;
  success: boolean;
  error?: string;
}> {
  try {
    const res = await sendBybitRequest("/v5/account/wallet-balance", "GET", creds, { accountType: "UNIFIED" });
    if (res?.retCode === 0 && res.result?.list?.[0]) {
      const acct = res.result.list[0];
      const totalEquity = parseFloat(acct.totalEquity || "0");
      const availableBalance = parseFloat(acct.totalAvailableBalance || acct.totalMarginBalance || "0");
      return { totalEquity, availableBalance, success: true };
    }
    return { totalEquity: 0, availableBalance: 0, success: false, error: res?.retMsg || "Failed to parse wallet balance" };
  } catch (err: any) {
    return { totalEquity: 0, availableBalance: 0, success: false, error: err?.message || "Wallet balance error" };
  }
}
