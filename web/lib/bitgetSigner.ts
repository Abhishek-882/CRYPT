import crypto from "crypto";
import https from "https";
import http from "http";
import { URL } from "url";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getActiveHealthyRoute } from "./proxyPoolManager";
import { pooledFetch } from "./agentPoolManager";
import { getCachedBitgetOffsetMs, syncBitgetClock, isBitgetCalibrated, getLastBitgetSyncTime } from "./clockSynchronizer";

export interface BitgetCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  isDemo?: boolean;
}

export interface BitgetOrderParams {
  symbol: string; // e.g. "BTCUSDT"
  productType?: string; // default "USDT-FUTURES"
  marginMode?: string; // "crossed" or "isolated"
  marginCoin?: string; // "USDT"
  size: string; // contract size or quantity
  side: "buy" | "sell";
  orderType: "market" | "limit";
  price?: string;
  tradeSide?: "open" | "close";
  posSide?: "long" | "short";
  clientOid?: string;
}

let cachedBitgetTimeOffset = 0;
let lastBitgetTimeSync = 0;

/**
 * Perform an HTTP request to Bitget using persistent keep-alive connection pool,
 * automatically routing through the active healthy forward proxy if available.
 */
export async function bitgetHttpFetch(
  fullUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {}
): Promise<{ ok: boolean; status: number; text: string; json: any; durationMs: number }> {
  const timeoutMs = options.timeoutMs || 5000;
  const activeRoute = getActiveHealthyRoute();
  const proxyUrl =
    activeRoute.isHealthy && activeRoute.type === "forward" && activeRoute.url
      ? activeRoute.url
      : undefined;

  const res = await pooledFetch(fullUrl, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    timeoutMs,
    proxyUrl,
  });

  return {
    ok: res.ok,
    status: res.status,
    text: res.text,
    json: res.json,
    durationMs: res.durationMs,
  };
}

/**
 * Calibrate local clock against Bitget server time in <0.001ms from RAM background daemon.
 */
export async function calibrateBitgetTime(baseUrl = "https://api.bitget.com", forceRefresh = false): Promise<number> {
  if (!forceRefresh) {
    if (isBitgetCalibrated() || (getLastBitgetSyncTime() > 0 && Date.now() - getLastBitgetSyncTime() < 60000)) {
      return getCachedBitgetOffsetMs();
    }
    const cached = getCachedBitgetOffsetMs();
    if (cached !== 0) return cached;
  }
  return syncBitgetClock(baseUrl);
}

/**
 * Generate Bitget V2/V3 API Headers
 * Signature: Base64(HMAC-SHA256(timestamp + method + requestPath + ("?" + queryString) + body, secret))
 */
export async function getBitgetHeaders(
  creds: BitgetCredentials,
  method: "GET" | "POST",
  requestPath: string,
  body = ""
): Promise<Record<string, string>> {
  const offset = await calibrateBitgetTime();
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const timestamp = Math.floor(Date.now() + safeOffset).toString();

  // Handle URL paths that already include query parameters
  let cleanPath = requestPath;
  let queryStr = "";
  if (requestPath.includes("?")) {
    const parts = requestPath.split("?");
    cleanPath = parts[0];
    queryStr = parts[1] || "";
  }

  // Pre-hash string according to official Bitget specification:
  // timestamp + method.toUpperCase() + cleanPath + ("?" + queryStr) + body
  const message = `${timestamp}${method.toUpperCase()}${cleanPath}${queryStr ? "?" + queryStr : ""}${body}`;
  const sign = crypto
    .createHmac("sha256", creds.apiSecret)
    .update(message)
    .digest("base64");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ACCESS-KEY": creds.apiKey,
    "ACCESS-SIGN": sign,
    "ACCESS-TIMESTAMP": timestamp,
    "ACCESS-PASSPHRASE": creds.passphrase,
    "locale": "en-US",
  };

  if (creds.isDemo) {
    headers["paptrading"] = "1";
    headers["papertrading"] = "1";
  }

  return headers;
}

/**
 * Fetch Bitget USDT-Futures Account Balance (Supports Classic V2 & UTA V3)
 */
export async function getBitgetAccount(creds?: BitgetCredentials) {
  // If no credentials or simulation credentials, return realistic mock balance
  if (!creds?.apiKey || !creds?.apiSecret || !creds?.passphrase) {
    return {
      success: true,
      venue: "Bitget-Simulation",
      equity: 5000.0,
      available: 5000.0,
      unrealizedPnL: 0.0,
      positions: [],
      isSimulated: true,
    };
  }

  // Pre-open the trade WebSocket so the first order skips connect + login
  try {
    getBitgetTradeSocket(creds);
  } catch {
    // non-fatal: placeBitgetOrder opens it on demand
  }

  const baseUrl = "https://api.bitget.com";
  // Primary endpoint: V2 Classic Mix Futures Account
  const v2Path = "/api/v2/mix/account/accounts?productType=USDT-FUTURES";

  try {
    let headers = await getBitgetHeaders(creds, "GET", v2Path);
    let res = await bitgetHttpFetch(`${baseUrl}${v2Path}`, {
      method: "GET",
      headers,
    });
    let data = res.json || {};

    // If timestamp expired (code 40008), force immediate re-calibration and retry once
    if (data.code === "40008") {
      await calibrateBitgetTime(baseUrl, true);
      headers = await getBitgetHeaders(creds, "GET", v2Path);
      res = await bitgetHttpFetch(`${baseUrl}${v2Path}`, {
        method: "GET",
        headers,
      });
      data = res.json || {};
    }

    // If account is in Unified Trading Account (UTA) mode or V2 Mix returns permissions error, auto-fallback to V3 assets
    if (data.code === "40084" || data.code === "40014" || data.code !== "00000") {
      const v3Path = "/api/v3/account/assets";
      const v3Headers = await getBitgetHeaders(creds, "GET", v3Path);
      const v3Res = await bitgetHttpFetch(`${baseUrl}${v3Path}`, { method: "GET", headers: v3Headers });
      const v3Data = v3Res.json || {};
      if (v3Data.code === "00000" && v3Data.data) {
        const raw = v3Data.data;
        const assetsList = Array.isArray(raw) ? raw : (raw.assets || []);
        const usdt = assetsList.find((a: any) => a.coin === "USDT") || assetsList[0] || {};
        const usdtEquity = parseFloat(usdt.equity || usdt.balance || raw.usdtEquity || "0");
        const available = parseFloat(usdt.available || raw.effEquity || "0");
        const unrealizedPnL = parseFloat(raw.unrealisedPnl || usdt.unrealizedPnL || "0");

        // Query active positions for Bitget UTA across all symbols
        let positions: any[] = [];
        try {
          const posPath = "/api/v3/position/current-position?category=USDT-FUTURES";
          const posHeaders = await getBitgetHeaders(creds, "GET", posPath);
          const posRes = await bitgetHttpFetch(`${baseUrl}${posPath}`, { method: "GET", headers: posHeaders });
          const posData = posRes.json || {};
          const list = posData?.data?.list || (Array.isArray(posData?.data) ? posData.data : []);
          positions = (list || [])
            .filter((p: any) => parseFloat(p?.total || p?.available || p?.pos || "0") > 0)
            .map((p: any) => {
              const posSide = p.posSide || "long";
              const rawTotal = parseFloat(p.total || p.available || p.pos || "0");
              const amt = posSide === "short" ? -rawTotal : rawTotal;
              const entryPrice = parseFloat(p.avgPrice || p.openPriceAvg || "0");
              const markPrice = parseFloat(p.markPrice || "0") || entryPrice;
              const uPnl = parseFloat(p.unrealisedPnl || "0");
              const leverage = parseInt(p.leverage || "20", 10);
              return {
                venue: "Bitget",
                symbol: p.symbol || "BTCUSDT",
                amount: amt,
                entryPrice,
                markPrice,
                unrealizedPnl: uPnl,
                leverage,
              };
            });
        } catch {
          // non-fatal fallback
        }

        return {
          success: true,
          venue: creds.isDemo ? "Bitget-UTA-Demo" : "Bitget-Unified-UTA",
          equity: usdtEquity > 0 ? usdtEquity : parseFloat(raw.accountEquity || "0"),
          available,
          unrealizedPnL,
          positions,
          isSimulated: false,
        };
      }
    }

    if (data.code !== "00000") {
      let friendlyError = data.msg || "Authentication failed";
      if (data.code === "40012") {
        friendlyError = "Passphrase incorrect. Please check the passphrase entered during API key creation on Bitget.";
      } else if (data.code === "40014") {
        friendlyError = "IP restriction enabled on key. Ensure your egress IP address is whitelisted in Bitget.";
      } else if (data.code === "40017") {
        friendlyError = "Missing or invalid ACCESS-PASSPHRASE header.";
      }

      return {
        success: false,
        error: `Bitget API Error [${data.code}]: ${friendlyError}`,
        code: data.code,
      };
    }

    const accounts = data.data || [];
    const usdtAccount = accounts.find((a: any) => a.marginCoin === "USDT") || accounts[0] || {};

    const equity = parseFloat(usdtAccount.accountEquity || usdtAccount.usdtEquity || usdtAccount.equity || "0.0");
    const available = parseFloat(usdtAccount.available || usdtAccount.maxTransferOut || "0.0");
    const unrealizedPnL = parseFloat(usdtAccount.unrealizedPL || "0.0");

    let positions: any[] = [];
    try {
      const posPath = "/api/v2/mix/position/all-position?productType=USDT-FUTURES";
      const posHeaders = await getBitgetHeaders(creds, "GET", posPath);
      const posRes = await fetch(`${baseUrl}${posPath}`, { headers: posHeaders, cache: "no-store" });
      const posData = await posRes.json();
      if (posData.code === "00000" && Array.isArray(posData.data)) {
        positions = posData.data
          .filter((p: any) => parseFloat(p.total || p.available || p.pos || "0") > 0)
          .map((p: any) => {
            const rawTotal = parseFloat(p.total || p.available || p.pos || "0");
            const amt = (p.holdSide || p.posSide) === "short" ? -rawTotal : rawTotal;
            return {
              venue: "Bitget",
              symbol: p.symbol || "BTCUSDT",
              amount: amt,
              entryPrice: parseFloat(p.openPriceAvg || p.averageOpenPrice || p.avgPrice || "0"),
              markPrice: parseFloat(p.markPrice || "0"),
              unrealizedPnl: parseFloat(p.unrealizedPL || p.unrealisedPnl || "0"),
              leverage: parseInt(p.leverage || "20", 10),
            };
          });
      }
    } catch {}

    return {
      success: true,
      venue: "Bitget-Classic-Futures",
      equity,
      available,
      unrealizedPnL,
      positions,
      raw: data.data,
      isSimulated: false,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Network error connecting to Bitget: ${err.message}`,
    };
  }
}

const BITGET_WS_PRIVATE_URL = "wss://ws.bitget.com/v3/ws/private";
const BITGET_WS_PRIVATE_DEMO_URL = "wss://wspap.bitget.com/v3/ws/private";
// Bitget disconnects a socket sending more than 10 messages/second (login, ping and trade all count).
// Allow 9 per 1.25s: the extra 250ms keeps network jitter from bunching two batches into one Bitget second.
const BITGET_WS_MAX_SENDS_PER_WINDOW = 9;
const BITGET_WS_SEND_WINDOW_MS = 1250;
const BITGET_WS_PONG_TIMEOUT_MS = 10000;
// After a failed connect/login, use REST for this long before retrying (Bitget allows 300 new connections/IP/5min)
const BITGET_WS_RETRY_COOLDOWN_MS = 60000;

interface BitgetTradeSocket {
  ws: WebSocket;
  ready: Promise<void>;
  pending: Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timer: NodeJS.Timeout }>;
  pingTimer?: NodeJS.Timeout;
  pongTimer?: NodeJS.Timeout;
  sendTimes: number[];
  sendChain: Promise<void>;
}

const globalForBitgetWs = globalThis as unknown as {
  bitgetTradeSockets?: Map<string, BitgetTradeSocket>;
  bitgetWsCooldownUntil?: Map<string, number>;
};
const bitgetTradeSockets = globalForBitgetWs.bitgetTradeSockets ?? new Map<string, BitgetTradeSocket>();
globalForBitgetWs.bitgetTradeSockets = bitgetTradeSockets;
const bitgetWsCooldownUntil = globalForBitgetWs.bitgetWsCooldownUntil ?? new Map<string, number>();
globalForBitgetWs.bitgetWsCooldownUntil = bitgetWsCooldownUntil;

/**
 * Wait for a send slot so the socket stays under Bitget's per-connection message limit.
 * Slots are handed out in order over a rolling window.
 */
function reserveBitgetSendSlot(socket: BitgetTradeSocket): Promise<void> {
  const slot = socket.sendChain.then(async () => {
    let now = Date.now();
    socket.sendTimes = socket.sendTimes.filter((t) => now - t < BITGET_WS_SEND_WINDOW_MS);
    if (socket.sendTimes.length >= BITGET_WS_MAX_SENDS_PER_WINDOW) {
      await new Promise((r) => setTimeout(r, BITGET_WS_SEND_WINDOW_MS - (now - socket.sendTimes[0]) + 1));
      now = Date.now();
      socket.sendTimes = socket.sendTimes.filter((t) => now - t < BITGET_WS_SEND_WINDOW_MS);
    }
    socket.sendTimes.push(now);
  });
  socket.sendChain = slot;
  return slot;
}

/**
 * Open (or reuse) a persistent, logged-in Bitget UTA V3 private WebSocket for the given credentials.
 * Login signature: Base64(HMAC-SHA256(timestampSeconds + "GET" + "/user/verify", secret))
 */
function getBitgetTradeSocket(creds: BitgetCredentials): BitgetTradeSocket {
  const key = `${creds.isDemo ? "demo" : "live"}:${creds.apiKey}`;
  const existing = bitgetTradeSockets.get(key);
  if (existing && (existing.ws.readyState === WebSocket.CONNECTING || existing.ws.readyState === WebSocket.OPEN)) {
    return existing;
  }

  const cooldownUntil = bitgetWsCooldownUntil.get(key) || 0;
  if (Date.now() < cooldownUntil) {
    throw new Error(`Bitget WebSocket retry paused after failed login (${Math.ceil((cooldownUntil - Date.now()) / 1000)}s left)`);
  }

  const activeRoute = getActiveHealthyRoute();
  const proxyUrl =
    activeRoute.isHealthy && activeRoute.type === "forward" && activeRoute.url
      ? activeRoute.url
      : undefined;

  const wsOptions: WebSocket.ClientOptions = { handshakeTimeout: 5000 };
  if (proxyUrl) {
    wsOptions.agent = new HttpsProxyAgent(proxyUrl);
  }

  const ws = new WebSocket(creds.isDemo ? BITGET_WS_PRIVATE_DEMO_URL : BITGET_WS_PRIVATE_URL, wsOptions);
  const socket: BitgetTradeSocket = {
    ws,
    pending: new Map(),
    ready: Promise.resolve(),
    sendTimes: [],
    sendChain: Promise.resolve(),
  };

  socket.ready = new Promise<void>((resolve, reject) => {
    let loggedIn = false;
    const loginTimer = setTimeout(() => {
      reject(new Error("Bitget WebSocket login timed out (5000ms)"));
      ws.terminate();
    }, 5000);

    ws.on("open", async () => {
      try {
        const offset = await calibrateBitgetTime();
        const safeOffset = Number.isFinite(offset) ? offset : 0;
        const timestamp = Math.floor((Date.now() + safeOffset) / 1000).toString();
        const sign = crypto
          .createHmac("sha256", creds.apiSecret)
          .update(`${timestamp}GET/user/verify`)
          .digest("base64");

        await reserveBitgetSendSlot(socket);
        ws.send(JSON.stringify({
          op: "login",
          args: [{ apiKey: creds.apiKey, passphrase: creds.passphrase, timestamp, sign }],
        }));
      } catch (err) {
        clearTimeout(loginTimer);
        reject(err);
        ws.terminate();
      }
    });

    ws.on("message", (raw: WebSocket.Data) => {
      const text = raw.toString();
      if (text === "pong") {
        clearTimeout(socket.pongTimer);
        socket.pongTimer = undefined;
        return;
      }

      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (!loggedIn && (msg.event === "login" || msg.event === "error")) {
        clearTimeout(loginTimer);
        if (msg.event === "login" && String(msg.code) === "0") {
          loggedIn = true;
          resolve();
        } else {
          reject(new Error(`Bitget WebSocket login rejected [${msg.code}]: ${msg.msg}`));
          ws.terminate();
        }
        return;
      }

      const reqId = msg.id !== undefined ? String(msg.id) : "";
      const req = socket.pending.get(reqId);
      if (req) {
        clearTimeout(req.timer);
        socket.pending.delete(reqId);
        req.resolve(msg);
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(loginTimer);
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(loginTimer);
      if (socket.pingTimer) clearInterval(socket.pingTimer);
      clearTimeout(socket.pongTimer);
      if (bitgetTradeSockets.get(key) === socket) bitgetTradeSockets.delete(key);
      reject(new Error("Bitget WebSocket closed before login"));
      socket.pending.forEach((req) => {
        clearTimeout(req.timer);
        req.reject(new Error("Bitget WebSocket closed before order ACK"));
      });
      socket.pending.clear();
    });
  });

  // Bitget drops private sockets that stay silent for 2 minutes
  socket.ready
    .then(() => {
      bitgetWsCooldownUntil.delete(key);
      socket.pingTimer = setInterval(async () => {
        if (ws.readyState !== WebSocket.OPEN || socket.pongTimer) return;
        await reserveBitgetSendSlot(socket);
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send("ping");
        // No pong back means the connection is dead: drop it so the next order reconnects
        socket.pongTimer = setTimeout(() => ws.terminate(), BITGET_WS_PONG_TIMEOUT_MS);
      }, 25000);
    })
    .catch(() => {
      bitgetWsCooldownUntil.set(key, Date.now() + BITGET_WS_RETRY_COOLDOWN_MS);
    });

  bitgetTradeSockets.set(key, socket);
  return socket;
}

/**
 * Look up an order by clientOid after its WebSocket ACK was lost.
 * Returns the order if Bitget has it (anything except cancelled/rejected with nothing filled), otherwise null.
 */
async function findBitgetOrderByClientOid(creds: BitgetCredentials, clientOid: string): Promise<any | null> {
  const baseUrl = "https://api.bitget.com";
  const path = `/api/v3/trade/order-info?clientOid=${clientOid}`;
  // Give an order still in flight a moment to register
  await new Promise((r) => setTimeout(r, 300));
  try {
    const headers = await getBitgetHeaders(creds, "GET", path);
    const res = await bitgetHttpFetch(`${baseUrl}${path}`, { method: "GET", headers, timeoutMs: 3000 });
    const raw = res.json?.code === "00000" ? res.json.data : null;
    const order = Array.isArray(raw) ? raw[0] : raw;
    if (!order?.orderId) return null;
    const status = String(order.orderStatus || "").toLowerCase();
    const filledQty = parseFloat(order.cumExecQty || "0");
    if (filledQty > 0 || !["cancelled", "canceled", "rejected"].includes(status)) return order;
  } catch {
    // lookup failed: caller reports the original error
  }
  return null;
}

export const BITGET_CLIENT_OID_REGEX = /^[a-zA-Z0-9-_]{1,40}$/;

export function validateOrGenerateBitgetClientOid(override?: string): string {
  if (override && typeof override === "string" && BITGET_CLIENT_OID_REGEX.test(override)) {
    return override;
  }
  return crypto.randomUUID();
}

/**
 * Send a place-order request over the Bitget private WebSocket.
 * Resolves with a REST-shaped { code, msg, data } reply ("00000" on success).
 * Errors raised before the order frame leaves are tagged `bitgetWsNotSent`.
 */
async function sendBitgetWsOrder(creds: BitgetCredentials, args: Record<string, any>): Promise<any> {
  let socket: BitgetTradeSocket;
  try {
    socket = getBitgetTradeSocket(creds);
    await socket.ready;
  } catch (err: any) {
    throw Object.assign(new Error(err?.message || "Bitget WebSocket unavailable"), { bitgetWsNotSent: true });
  }
  await reserveBitgetSendSlot(socket);
  if (socket.ws.readyState !== WebSocket.OPEN) {
    throw Object.assign(new Error("Bitget WebSocket not open"), { bitgetWsNotSent: true });
  }

  const id = `${Date.now()}${Math.random().toString(36).substring(2, 8)}`;
  // clientOid lets an order whose ACK never arrived be looked up instead of blindly resent
  const clientOid = validateOrGenerateBitgetClientOid(args.clientOid);
  let reply: any;
  try {
    reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.pending.delete(id);
        reject(new Error("Bitget WebSocket order ACK timed out (5000ms)"));
        // A socket that stops answering is treated as dead so the next order reconnects
        socket.ws.terminate();
      }, 5000);
      socket.pending.set(id, { resolve, reject, timer });

      socket.ws.send(
        JSON.stringify({ op: "trade", id, category: "usdt-futures", topic: "place-order", args: [{ ...args, clientOid }] }),
        (err?: Error) => {
          if (!err) return;
          clearTimeout(timer);
          socket.pending.delete(id);
          reject(err);
        }
      );
    });
  } catch (err: any) {
    // The frame may still have reached Bitget: confirm by clientOid before reporting failure
    const placed = await findBitgetOrderByClientOid(creds, clientOid);
    if (placed) {
      return { code: "00000", msg: "confirmed via order-info", data: { orderId: placed.orderId, clientOid: placed.clientOid || clientOid } };
    }
    throw err;
  }

  if (reply.event === "trade" && String(reply.code) === "0") {
    return { code: "00000", msg: reply.msg, data: reply.args?.[0] || {} };
  }
  return { code: String(reply.code), msg: reply.msg };
}

/**
 * Dispatch Bitget Market Order with optional Aggressive Fill Chase
 */
export async function placeBitgetOrder(
  params: BitgetOrderParams,
  creds?: BitgetCredentials
) {
  const startTime = Date.now();
  const clientOid = validateOrGenerateBitgetClientOid(params.clientOid);

  // If no live keys, simulate instant local fill with live mark price
  if (!creds?.apiKey || !creds?.apiSecret || !creds?.passphrase) {
    // Fetch live Bitget ticker for realistic simulation
    let fillPrice = 86450.0;
    try {
      const tickerRes = await fetch("https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES");
      const tickerData = await tickerRes.json();
      if (tickerData?.data?.[0]?.lastPr) {
        fillPrice = parseFloat(tickerData.data[0].lastPr);
      }
    } catch {
      // fallback default price
    }

    return {
      success: true,
      orderId: `sim_bitget_${Date.now()}`,
      clientOid,
      symbol: params.symbol,
      side: params.side,
      tradeSide: params.tradeSide || "open",
      size: parseFloat(params.size),
      avgPrice: fillPrice,
      executionLatencyMs: Date.now() - startTime,
      venue: "Bitget-Simulation",
      isSimulated: true,
    };
  }

  const baseUrl = "https://api.bitget.com";
  const path = "/api/v3/trade/place-order";

  const tradeSide = params.tradeSide || "open";
  const posSide = params.posSide || (tradeSide === "open"
    ? (params.side === "buy" ? "long" : "short")
    : (params.side === "sell" ? "long" : "short"));

  const payload: Record<string, any> = {
    category: "USDT-FUTURES",
    symbol: params.symbol,
    side: params.side,
    orderType: params.orderType || "market",
    tradeSide,
    posSide,
    qty: params.size,
    clientOid,
  };

  if (params.price) {
    payload.price = params.price;
  }

  const bodyStr = JSON.stringify(payload);

  // UTA V3 WebSocket carries category at request level (lowercase) and has no tradeSide arg
  const wsArgs: Record<string, any> = {
    symbol: payload.symbol,
    side: payload.side,
    orderType: payload.orderType,
    posSide: payload.posSide,
    qty: payload.qty,
    clientOid,
  };
  if (payload.price) {
    wsArgs.price = payload.price;
  }

  try {
    let data: any;
    try {
      data = await sendBitgetWsOrder(creds, wsArgs);
    } catch (wsErr: any) {
      // Only fall back when the order frame never left, so an order is never sent twice
      if (!wsErr?.bitgetWsNotSent) throw wsErr;
      console.warn(`[BitgetSigner] Trade WebSocket unavailable (${wsErr.message}). Falling back to REST place-order...`);

      let headers = await getBitgetHeaders(creds, "POST", path, bodyStr);
      let res = await bitgetHttpFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: bodyStr,
        timeoutMs: 5000,
      });
      data = res.json || {};

      if (data.code === "40008") {
        await calibrateBitgetTime(baseUrl, true);
        headers = await getBitgetHeaders(creds, "POST", path, bodyStr);
        res = await bitgetHttpFetch(`${baseUrl}${path}`, {
          method: "POST",
          headers,
          body: bodyStr,
          timeoutMs: 5000,
        });
        data = res.json || {};
      }
    }

    const ackDurationMs = Date.now() - startTime;

    if (data.code !== "00000") {
      return {
        success: false,
        error: `Bitget Order Rejected [${data.code}]: ${data.msg}`,
        code: data.code,
        latencyMs: ackDurationMs,
      };
    }

    let fillPrice = parseFloat(data.data?.fillPrice || data.data?.price || "0") || undefined;
    if (!fillPrice) {
      try {
        const tickerRes = await bitgetHttpFetch(`${baseUrl}/api/v2/mix/market/ticker?symbol=${params.symbol}&productType=USDT-FUTURES`, { method: "GET", timeoutMs: 4000 });
        const tickerData = tickerRes.json;
        if (tickerData?.data?.[0]?.lastPr) {
          fillPrice = parseFloat(tickerData.data[0].lastPr);
        }
      } catch {
        // fallback
      }
    }

    return {
      success: true,
      orderId: data.data?.orderId,
      clientOid: data.data?.clientOid || clientOid,
      symbol: params.symbol,
      side: params.side,
      tradeSide,
      posSide,
      size: parseFloat(params.size),
      avgPrice: fillPrice,
      executionLatencyMs: ackDurationMs,
      venue: creds.isDemo ? "Bitget-UTA-Demo" : "Bitget-Perpetuals",
      isSimulated: false,
      data: data.data,
    };
  } catch (err: any) {
    return {
      success: false,
      clientOid,
      error: `Bitget execution error: ${err.message}`,
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Configure leverage on Bitget UTA Futures for a specific trading pair.
 */
export async function setBitgetLeverage(
  creds: BitgetCredentials,
  symbol: string,
  leverage: number
): Promise<{ success: boolean; leverage: number; error?: string }> {
  try {
    const baseUrl = "https://api.bitget.com";
    const clamped = Math.max(1, Math.min(100, Math.round(leverage)));
    const path = "/api/v2/mix/account/set-leverage";
    const bodyStr = JSON.stringify({
      symbol: symbol.toUpperCase(),
      productType: "USDT-FUTURES",
      marginCoin: "USDT",
      leverage: clamped.toString(),
    });

    const headers = await getBitgetHeaders(creds, "POST", path, bodyStr);
    const res = await bitgetHttpFetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: bodyStr,
      timeoutMs: 4000,
    });
    const data = res.json || {};
    if (data.code === "00000") {
      return { success: true, leverage: clamped };
    }
    return { success: false, leverage: clamped, error: data.msg || `Code ${data.code}` };
  } catch (err: any) {
    return { success: false, leverage: Math.round(leverage), error: err.message };
  }
}

