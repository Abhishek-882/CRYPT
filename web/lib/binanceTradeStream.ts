import WebSocket from "ws";
import crypto from "crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getActiveHealthyRoute } from "./proxyPoolManager";
import { getCachedBinanceOffsetMs, syncBinanceClock } from "./clockSynchronizer";

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
  endpoint?: string;
  proxyUrl?: string;
}

export interface BinanceOrderParams {
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

export interface BinanceOrderResult {
  success: boolean;
  orderId: string;
  clientOrderId?: string;
  avgPrice?: number;
  symbol: string;
  side: string;
  quantity: number;
  executionLatencyMs: number;
  venue: "Binance";
  transport: "WEBSOCKET" | "REST" | "REST_FALLBACK";
  error?: string;
  data?: any;
}

export interface WatchdogTripRecord {
  id: string;
  timestamp: number;
  reason: string;
  action: string;
}

export interface WebSocketOrderRecord {
  id: string;
  timestamp: number;
  symbol: string;
  side: string;
  qty: number;
  transport: "WEBSOCKET" | "REST" | "REST_FALLBACK";
  latencyMs: number;
  status: "FILLED" | "TRIPPED_TO_REST" | "FAILED";
  orderId?: string;
  error?: string;
}

export interface BinanceTradeSocketStatus {
  status: "DISCONNECTED" | "CONNECTING" | "HEALTHY" | "PAUSED_FAILED" | "RECONNECTING";
  activeRoute: "WEBSOCKET" | "REST";
  lastPingLatencyMs: number;
  avgAckLatencyMs: number;
  totalOrdersWs: number;
  totalOrdersRestFallback: number;
  watchdogTripsCount: number;
  lastTripReason?: string;
  lastTripTime?: number;
  lastRestoredTime?: number;
  tripHistory: WatchdogTripRecord[];
  recentOrders: WebSocketOrderRecord[];
  proxyUrl?: string;
  consecutivePingsPassed: number;
}

class BinanceTradeStreamManager {
  private ws: WebSocket | null = null;
  private status: "DISCONNECTED" | "CONNECTING" | "HEALTHY" | "PAUSED_FAILED" | "RECONNECTING" = "DISCONNECTED";
  private activeRoute: "WEBSOCKET" | "REST" = "WEBSOCKET";
  private currentCreds: BinanceCredentials | null = null;
  private pendingOrders = new Map<
    string,
    {
      resolve: (value: BinanceOrderResult) => void;
      reject: (reason?: any) => void;
      timer: NodeJS.Timeout;
      startTime: number;
      params: BinanceOrderParams;
    }
  >();
  private pingInterval: NodeJS.Timeout | null = null;
  private autoHealInterval: NodeJS.Timeout | null = null;
  private lastPingLatencyMs = 0;
  private avgAckLatencyMs = 0;
  private totalOrdersWs = 0;
  private totalOrdersRestFallback = 0;
  private watchdogTripsCount = 0;
  private lastTripReason?: string;
  private lastTripTime?: number;
  private lastRestoredTime?: number;
  private tripHistory: WatchdogTripRecord[] = [];
  private recentOrders: WebSocketOrderRecord[] = [];
  private consecutivePingsPassed = 0;
  private isConnecting = false;

  constructor() {
    if (typeof window === "undefined") {
      this.initAutoHealWorker();
    }
  }

  public isHealthy(): boolean {
    return (
      this.status === "HEALTHY" &&
      this.activeRoute === "WEBSOCKET" &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  public getStatus(): BinanceTradeSocketStatus {
    return {
      status: this.status,
      activeRoute: this.activeRoute,
      lastPingLatencyMs: this.lastPingLatencyMs,
      avgAckLatencyMs: this.avgAckLatencyMs,
      totalOrdersWs: this.totalOrdersWs,
      totalOrdersRestFallback: this.totalOrdersRestFallback,
      watchdogTripsCount: this.watchdogTripsCount,
      lastTripReason: this.lastTripReason,
      lastTripTime: this.lastTripTime,
      lastRestoredTime: this.lastRestoredTime,
      tripHistory: [...this.tripHistory].slice(-25),
      recentOrders: [...this.recentOrders].slice(-30),
      consecutivePingsPassed: this.consecutivePingsPassed,
    };
  }

  /**
   * Aggressive Watchdog Trip: Kills WebSocket route, trips state, and reverts route to REST
   */
  public tripToRest(reason: string) {
    this.status = "PAUSED_FAILED";
    this.activeRoute = "REST";
    this.watchdogTripsCount += 1;
    this.lastTripReason = reason;
    this.lastTripTime = Date.now();
    this.consecutivePingsPassed = 0;

    const record: WatchdogTripRecord = {
      id: `BN-TRIP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      reason,
      action: "Killed Binance WebSocket path and reverted to REST API as direct fallback",
    };
    this.tripHistory.unshift(record);
    if (this.tripHistory.length > 50) this.tripHistory = this.tripHistory.slice(0, 50);

    console.warn(`[BINANCE WS WATCHDOG] ${reason}. Killing WebSocket path and reverting to REST API fallback.`);

    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {}
      this.ws = null;
    }
  }

  /**
   * Connect and initialize Binance USD-M Futures WebSocket API
   */
  public async connect(creds?: BinanceCredentials): Promise<boolean> {
    if (this.isConnecting) return false;
    this.isConnecting = true;

    if (creds) {
      this.currentCreds = creds;
    }

    const isTestnet = this.currentCreds?.endpoint?.includes("testnet.binancefuture.com");
    const wsUrl = isTestnet
      ? "wss://testnet.binancefuture.com/ws-fapi/v1"
      : "wss://ws-fapi.binance.com/ws-fapi/v1";

    const explicitProxy = this.currentCreds?.proxyUrl || process.env.BINANCE_PROXY_URL;
    const activeRoute = getActiveHealthyRoute();
    const proxyUrl =
      explicitProxy ||
      (!isTestnet && activeRoute.isHealthy && activeRoute.type === "forward" && activeRoute.url
        ? activeRoute.url
        : undefined);

    try {
      if (this.ws) {
        try {
          this.ws.terminate();
        } catch {}
        this.ws = null;
      }

      const wsOptions: WebSocket.ClientOptions = { handshakeTimeout: 5000 };
      if (proxyUrl) {
        try {
          wsOptions.agent = new HttpsProxyAgent(proxyUrl);
        } catch {}
      }

      this.ws = new WebSocket(wsUrl, wsOptions);

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          this.isConnecting = false;
          this.tripToRest("Binance WebSocket initial handshake connection timed out (5s)");
          resolve(false);
        }, 6000);

        this.ws!.on("open", async () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.status = "HEALTHY";
          this.activeRoute = "WEBSOCKET";
          this.consecutivePingsPassed = 1;
          this.startHeartbeatPing();
          console.log(`[BinanceTradeStream] Successfully connected to Binance WebSocket API (${wsUrl})`);
          resolve(true);
        });

        this.ws!.on("message", (raw: WebSocket.Data) => {
          try {
            const data = JSON.parse(raw.toString());

            // Handle server.time or ping response
            if (data.id && String(data.id).startsWith("BN-PING-")) {
              if (data.status === 200 && data.result?.serverTime) {
                this.consecutivePingsPassed += 1;
              }
              return;
            }

            // Handle order response
            if (data.id && this.pendingOrders.has(data.id)) {
              const reqId = data.id;
              const pending = this.pendingOrders.get(reqId);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingOrders.delete(reqId);
                const latency = Date.now() - pending.startTime;

                if (data.status === 200 && data.result?.orderId) {
                  this.totalOrdersWs += 1;
                  this.avgAckLatencyMs =
                    this.avgAckLatencyMs === 0 ? latency : Math.round((this.avgAckLatencyMs + latency) / 2);

                  const fillPrice =
                    parseFloat(data.result.avgPrice || "0") ||
                    parseFloat(data.result.price || "0") ||
                    0;

                  this.recordOrder({
                    id: reqId,
                    timestamp: Date.now(),
                    symbol: pending.params.symbol,
                    side: pending.params.side,
                    qty: typeof pending.params.quantity === "number" ? pending.params.quantity : parseFloat(pending.params.quantity),
                    transport: "WEBSOCKET",
                    latencyMs: latency,
                    status: "FILLED",
                    orderId: String(data.result.orderId),
                  });

                  pending.resolve({
                    success: true,
                    orderId: String(data.result.orderId),
                    clientOrderId: data.result.clientOrderId || pending.params.clientOrderId || pending.params.newClientOrderId,
                    avgPrice: fillPrice,
                    symbol: pending.params.symbol,
                    side: pending.params.side,
                    quantity: typeof pending.params.quantity === "number" ? pending.params.quantity : parseFloat(pending.params.quantity),
                    executionLatencyMs: latency,
                    venue: "Binance",
                    transport: "WEBSOCKET",
                    data: data.result,
                  });
                } else {
                  const errorMsg = data.error?.msg || `Binance WS error code ${data.error?.code || data.status}`;
                  this.recordOrder({
                    id: reqId,
                    timestamp: Date.now(),
                    symbol: pending.params.symbol,
                    side: pending.params.side,
                    qty: typeof pending.params.quantity === "number" ? pending.params.quantity : parseFloat(pending.params.quantity),
                    transport: "WEBSOCKET",
                    latencyMs: latency,
                    status: "FAILED",
                    error: errorMsg,
                  });
                  pending.reject(new Error(errorMsg));
                }
              }
            }
          } catch {}
        });

        this.ws!.on("error", (err: Error) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.tripToRest(`Binance socket error: ${err.message}`);
          resolve(false);
        });

        this.ws!.on("close", (code: number, reason: Buffer) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          if (this.status !== "PAUSED_FAILED") {
            this.tripToRest(`Binance socket closed unexpectedly (Code ${code}: ${reason.toString()})`);
          }
        });
      });
    } catch (err: any) {
      this.isConnecting = false;
      this.tripToRest(`Exception initiating Binance WebSocket: ${err.message}`);
      return false;
    }
  }

  /**
   * Heartbeat Ping using server.time every 15 seconds
   */
  private startHeartbeatPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(async () => {
      if (this.status !== "HEALTHY" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        const pingStart = Date.now();
        const pingId = `BN-PING-${pingStart}`;
        this.ws.send(
          JSON.stringify({
            id: pingId,
            method: "server.time",
          })
        );
        this.lastPingLatencyMs = Date.now() - pingStart;
      } catch (err: any) {
        this.tripToRest(`Heartbeat ping failed: ${err.message}`);
      }
    }, 15000);
  }

  /**
   * Place an order over persistent Binance WebSocket with strict 800ms Watchdog
   */
  public async placeOrder(
    params: BinanceOrderParams,
    creds: BinanceCredentials
  ): Promise<BinanceOrderResult> {
    if (!this.isHealthy()) {
      throw new Error("BINANCE_WS_UNHEALTHY");
    }

    const reqId = `WS-BN-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const startTime = Date.now();
    const offset = getCachedBinanceOffsetMs();

    const clientOrderId = params.clientOrderId || params.newClientOrderId || crypto.randomUUID();

    const orderParams: Record<string, any> = {
      apiKey: creds.apiKey,
      symbol: params.symbol.toUpperCase(),
      side: params.side.toUpperCase(),
      type: params.type || "MARKET",
      quantity: String(params.quantity),
      newClientOrderId: clientOrderId,
      timestamp: Date.now() + offset,
      recvWindow: 10000,
    };

    if (params.price) {
      orderParams.price = String(params.price);
    }
    if (params.reduceOnly === true || params.reduceOnly === "true") {
      orderParams.reduceOnly = "true";
    }
    if (params.timeInForce) {
      orderParams.timeInForce = params.timeInForce;
    }

    // Sign payload
    const sortedKeys = Object.keys(orderParams).sort();
    const queryString = sortedKeys.map((k) => `${k}=${encodeURIComponent(orderParams[k])}`).join("&");
    const signature = crypto.createHmac("sha256", creds.apiSecret).update(queryString).digest("hex");
    orderParams.signature = signature;

    const frame = JSON.stringify({
      id: reqId,
      method: "order.place",
      params: orderParams,
    });

    return new Promise<BinanceOrderResult>((resolve, reject) => {
      // 800ms Watchdog Circuit Breaker
      const timer = setTimeout(() => {
        this.pendingOrders.delete(reqId);
        const elapsed = Date.now() - startTime;
        this.tripToRest(`Order ACK exceeded 800ms limit (${elapsed}ms elapsed)`);
        this.totalOrdersRestFallback += 1;

        this.recordOrder({
          id: reqId,
          timestamp: Date.now(),
          symbol: params.symbol,
          side: params.side,
          qty: typeof params.quantity === "number" ? params.quantity : parseFloat(params.quantity),
          transport: "REST_FALLBACK",
          latencyMs: elapsed,
          status: "TRIPPED_TO_REST",
          error: "Watchdog tripped: ACK timeout > 800ms",
        });

        reject(new Error("WATCHDOG_ACK_TIMEOUT_800MS"));
      }, 800);

      this.pendingOrders.set(reqId, {
        resolve,
        reject,
        timer,
        startTime,
        params,
      });

      try {
        this.ws!.send(frame);
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingOrders.delete(reqId);
        this.tripToRest(`Failed to send order frame over WebSocket: ${err.message}`);
        reject(err);
      }
    });
  }

  /**
   * Background Auto-Heal Worker
   */
  private initAutoHealWorker() {
    if (this.autoHealInterval) clearInterval(this.autoHealInterval);
    this.autoHealInterval = setInterval(async () => {
      if (this.status === "PAUSED_FAILED" || this.status === "DISCONNECTED") {
        await this.attemptAutoHealRecovery();
      }
    }, 25000);
  }

  private async attemptAutoHealRecovery(): Promise<void> {
    console.log("[BINANCE WS AUTO-HEAL] Attempting WebSocket reconnection & ping verification...");
    this.status = "RECONNECTING";

    const connected = await this.connect();
    if (!connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[BINANCE WS AUTO-HEAL] Reconnection failed. Keeping REST fallback active.");
      this.status = "PAUSED_FAILED";
      return;
    }

    let passed = 0;
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const res = await this.sendTestPing();
      if (res.success && res.latencyMs < 250) {
        passed += 1;
        this.consecutivePingsPassed = passed;
      } else {
        break;
      }
    }

    if (passed === 3) {
      this.status = "HEALTHY";
      this.activeRoute = "WEBSOCKET";
      this.lastRestoredTime = Date.now();
      console.log("[BINANCE WS AUTO-HEAL] SUCCESS: 3/3 health pings passed (<250ms). Restored Binance WebSocket route!");
    } else {
      console.warn(`[BINANCE WS AUTO-HEAL] Only ${passed}/3 pings passed. Keeping REST fallback.`);
      this.tripToRest(`Auto-heal health gate failed (${passed}/3 pings verified)`);
    }
  }

  public async sendTestPing(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return { success: false, latencyMs: 0, error: "Socket not open" };
    }

    return new Promise((resolve) => {
      const pingStart = Date.now();
      const pingId = `BN-TEST-${pingStart}`;

      const timer = setTimeout(() => {
        socket.removeListener("message", handler);
        resolve({ success: false, latencyMs: 0, error: "Ping timeout" });
      }, 2000);

      const handler = (raw: WebSocket.Data) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.id === pingId) {
            clearTimeout(timer);
            socket.removeListener("message", handler);
            const latency = Date.now() - pingStart;
            this.lastPingLatencyMs = latency;
            resolve({ success: true, latencyMs: latency });
          }
        } catch {}
      };

      socket.on("message", handler);

      try {
        socket.send(JSON.stringify({ id: pingId, method: "server.time" }));
      } catch (err: any) {
        clearTimeout(timer);
        socket.removeListener("message", handler);
        resolve({ success: false, latencyMs: 0, error: err.message });
      }
    });
  }

  public recordOrder(rec: WebSocketOrderRecord) {
    this.recentOrders.unshift(rec);
    if (this.recentOrders.length > 50) this.recentOrders = this.recentOrders.slice(0, 50);
  }
}

export const binanceTradeStream = new BinanceTradeStreamManager();
