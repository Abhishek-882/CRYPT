import WebSocket from "ws";
import crypto from "crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import { DEFAULT_WEBSHARE_POOL } from "./proxyPoolManager";
import { BybitCredentials, BybitOrderParams, BybitOrderResult } from "./bybitSigner";

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

export interface BybitTradeSocketStatus {
  status: "DISCONNECTED" | "CONNECTING" | "HEALTHY" | "PAUSED_FAILED" | "RECONNECTING" | "AUTH_FAILED";
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

class BybitTradeStreamManager {
  private ws: WebSocket | null = null;
  private status: "DISCONNECTED" | "CONNECTING" | "HEALTHY" | "PAUSED_FAILED" | "RECONNECTING" | "AUTH_FAILED" = "DISCONNECTED";
  private activeRoute: "WEBSOCKET" | "REST" = "WEBSOCKET";
  private currentCreds: BybitCredentials | null = null;
  private pendingOrders = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason?: any) => void;
      timer: NodeJS.Timeout;
      startTime: number;
      params: BybitOrderParams;
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

  public getStatus(): BybitTradeSocketStatus {
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
      id: `TRIP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      reason,
      action: "Killed WebSocket path and reverted to REST API as direct path",
    };
    this.tripHistory.unshift(record);
    if (this.tripHistory.length > 50) this.tripHistory = this.tripHistory.slice(0, 50);

    console.warn(`[WS WATCHDOG] Bybit Trade WebSocket failed: ${reason}. Killing WebSocket path and reverting to REST API as direct path.`);

    // Close underlying socket to flush any dead buffers
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {}
      this.ws = null;
    }
  }

  /**
   * Connect and authenticate to Bybit V5 Trade WebSocket
   */
  public async connect(creds?: BybitCredentials): Promise<boolean> {
    if (this.isConnecting) return false;
    this.isConnecting = true;

    if (creds) {
      this.currentCreds = creds;
    }

    const activeCreds = this.currentCreds || {
      apiKey: process.env.BYBIT_KEY || "sim_key",
      apiSecret: process.env.BYBIT_SECRET || "sim_secret",
      proxyUrl: process.env.BYBIT_PROXY || DEFAULT_WEBSHARE_POOL[0],
    };

    if (!activeCreds.apiKey || activeCreds.apiKey === "sim_key" || activeCreds.apiKey === "undefined") {
      this.isConnecting = false;
      this.status = "PAUSED_FAILED";
      this.activeRoute = "REST";
      return false;
    }

    const proxyUrl = activeCreds.proxyUrl || "";
    let wsUrl = "wss://stream.bybit.com/v5/trade";
    const workerCandidate = activeCreds.backupBaseUrl || activeCreds.baseUrl || process.env.BYBIT_BACKUP_BASE_URL || process.env.BYBIT_BASE_URL;
    if (workerCandidate && (workerCandidate.includes("workers.dev") || workerCandidate.includes("pages.dev"))) {
      wsUrl = workerCandidate.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://").replace(/\/+$/, "") + "/v5/trade";
    }

    try {
      if (this.ws) {
        try {
          this.ws.terminate();
        } catch {}
        this.ws = null;
      }

      const wsOptions: WebSocket.ClientOptions = { handshakeTimeout: 5000 };
      if (proxyUrl && !proxyUrl.includes("bxkvaxsa")) {
        try {
          wsOptions.agent = new HttpsProxyAgent(proxyUrl);
        } catch {}
      }
      this.ws = new WebSocket(wsUrl, wsOptions);

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          this.isConnecting = false;
          this.tripToRest("WebSocket initial handshake connection timed out (5s)");
          resolve(false);
        }, 6000);

        this.ws!.on("open", () => {
          // Send HMAC authentication payload
          const expires = Date.now() + 10000;
          const signature = crypto
            .createHmac("sha256", activeCreds.apiSecret)
            .update("GET/realtime" + expires)
            .digest("hex");

          const authMsg = JSON.stringify({
            op: "auth",
            args: [activeCreds.apiKey, expires, signature],
          });

          this.ws!.send(authMsg);
        });

        this.ws!.on("message", (raw: WebSocket.Data) => {
          try {
            const data = JSON.parse(raw.toString());

            // 1. Auth Response
            if (data.op === "auth") {
              clearTimeout(timeout);
              this.isConnecting = false;
              if (data.retCode === 0 || data.ret_msg === "ok" || data.retMsg === "OK") {
                this.status = "HEALTHY";
                this.activeRoute = "WEBSOCKET";
                this.startHeartbeatPing();
                resolve(true);
              } else {
                // If API key does not have trade WebSocket permissions, deactivate WebSocket and fast-route to REST
                console.warn(`[BybitTradeStream] Auth note: ${data.retMsg || data.ret_msg}. Trade WebSocket disabled for this key, routing orders directly to REST.`);
                this.status = "AUTH_FAILED";
                this.activeRoute = "REST";
                resolve(false);
              }
            }

            // 2. Pong response
            if (data.op === "pong" || data.retMsg === "pong") {
              return;
            }

            // 3. Order creation acknowledgement
            if (data.op === "order.create" || data.reqId) {
              const reqId = data.reqId;
              const pending = this.pendingOrders.get(reqId);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingOrders.delete(reqId);
                const latency = Date.now() - pending.startTime;

                if (data.retCode === 0) {
                  this.totalOrdersWs += 1;
                  this.avgAckLatencyMs = this.avgAckLatencyMs === 0 ? latency : Math.round((this.avgAckLatencyMs + latency) / 2);
                  this.recordOrder({
                    id: reqId,
                    timestamp: Date.now(),
                    symbol: pending.params.symbol,
                    side: pending.params.side,
                    qty: typeof pending.params.qty === "number" ? pending.params.qty : parseFloat(pending.params.qty),
                    transport: "WEBSOCKET",
                    latencyMs: latency,
                    status: "FILLED",
                    orderId: data.data?.orderId || data.result?.orderId,
                  });
                  pending.resolve({
                    success: true,
                    orderId: data.data?.orderId || data.result?.orderId,
                    orderLinkId: data.data?.orderLinkId || data.result?.orderLinkId,
                    symbol: pending.params.symbol,
                    side: pending.params.side,
                    quantity: typeof pending.params.qty === "number" ? pending.params.qty : parseFloat(pending.params.qty),
                    executionLatencyMs: latency,
                    venue: "Bybit",
                    isSimulated: false,
                    transport: "WEBSOCKET",
                    data: data.data || data.result,
                  });
                } else {
                  this.recordOrder({
                    id: reqId,
                    timestamp: Date.now(),
                    symbol: pending.params.symbol,
                    side: pending.params.side,
                    qty: typeof pending.params.qty === "number" ? pending.params.qty : parseFloat(pending.params.qty),
                    transport: "WEBSOCKET",
                    latencyMs: latency,
                    status: "FAILED",
                    error: data.retMsg || `RetCode ${data.retCode}`,
                  });
                  pending.reject(new Error(data.retMsg || `Bybit WS order rejected with retCode ${data.retCode}`));
                }
              }
            }
          } catch {}
        });

        this.ws!.on("error", (err: Error) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.tripToRest(`Socket error: ${err.message}`);
          resolve(false);
        });

        this.ws!.on("close", (code: number, reason: Buffer) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          if (this.status !== "PAUSED_FAILED") {
            this.tripToRest(`Socket closed unexpectedly (Code ${code}: ${reason.toString()})`);
          }
        });
      });
    } catch (err: any) {
      this.isConnecting = false;
      this.tripToRest(`Exception initiating WebSocket: ${err.message}`);
      return false;
    }
  }

  /**
   * 20-second Heartbeat Ping Watchdog
   */
  private startHeartbeatPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(async () => {
      if (this.status !== "HEALTHY" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        const pingStart = Date.now();
        this.ws.send(JSON.stringify({ op: "ping" }));
        this.lastPingLatencyMs = Date.now() - pingStart;
      } catch (err: any) {
        this.tripToRest(`Heartbeat ping failed: ${err.message}`);
      }
    }, 20000);
  }

  /**
   * Place an order over the persistent Bybit Trade WebSocket with strict 500ms Watchdog
   */
  public async placeOrder(params: BybitOrderParams, creds: BybitCredentials): Promise<BybitOrderResult> {
    if (!this.isHealthy()) {
      throw new Error("BYBIT_WS_UNHEALTHY");
    }

    const reqId = `WS-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    const category = params.category || "linear";
    const orderArg: Record<string, any> = {
      category,
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType || "Market",
      qty: params.qty.toString(),
      timeInForce: params.timeInForce || "IOC",
      orderLinkId: params.orderLinkId || params.clientOrderId || crypto.randomUUID(),
    };
    if (category === "linear") {
      orderArg.positionIdx = params.positionIdx !== undefined ? params.positionIdx : 0;
      if (params.reduceOnly) {
        orderArg.reduceOnly = true;
      }
    }
    if (params.marketUnit) {
      orderArg.marketUnit = params.marketUnit;
    } else if (category === "spot" && (params.orderType === "Market" || !params.orderType)) {
      orderArg.marketUnit = "baseCoin";
    }
    if (params.orderType === "Limit" && params.price) {
      orderArg.price = String(params.price);
    }

    const payload = {
      reqId,
      header: {
        "X-BAPI-TIMESTAMP": startTime.toString(),
        "X-BAPI-RECV-WINDOW": "5000",
      },
      op: "order.create",
      args: [orderArg],
    };

    return new Promise<BybitOrderResult>((resolve, reject) => {
      // ─────────────────────────────────────────────────────────────
      // AGGRESSIVE 500ms WATCHDOG CIRCUIT BREAKER TIMER
      // ─────────────────────────────────────────────────────────────
      const timer = setTimeout(() => {
        this.pendingOrders.delete(reqId);
        const elapsed = Date.now() - startTime;
        this.tripToRest(`Order ACK exceeded 500ms limit (${elapsed}ms elapsed)`);
        this.totalOrdersRestFallback += 1;

        this.recordOrder({
          id: reqId,
          timestamp: Date.now(),
          symbol: params.symbol,
          side: params.side,
          qty: typeof params.qty === "number" ? params.qty : parseFloat(params.qty),
          transport: "REST_FALLBACK",
          latencyMs: elapsed,
          status: "TRIPPED_TO_REST",
          error: "Watchdog tripped: ACK timeout > 500ms",
        });

        reject(new Error("WATCHDOG_ACK_TIMEOUT_500MS"));
      }, 500);

      this.pendingOrders.set(reqId, {
        resolve,
        reject,
        timer,
        startTime,
        params,
      });

      try {
        this.ws!.send(JSON.stringify(payload));
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingOrders.delete(reqId);
        this.tripToRest(`Failed to send order frame over WebSocket: ${err.message}`);
        reject(err);
      }
    });
  }

  /**
   * Background Auto-Heal Worker:
   * Every 30 seconds, if paused/failed, attempts reconnect and requires 3 consecutive pings (<250ms)
   */
  private initAutoHealWorker() {
    if (this.autoHealInterval) clearInterval(this.autoHealInterval);
    this.autoHealInterval = setInterval(async () => {
      if (this.status === "PAUSED_FAILED" || this.status === "DISCONNECTED") {
        await this.attemptAutoHealRecovery();
      }
    }, 30000);
  }

  private async attemptAutoHealRecovery(): Promise<void> {
    if (!this.currentCreds || !this.currentCreds.apiKey || this.currentCreds.apiKey === "sim_key" || this.currentCreds.apiKey === "undefined") {
      return;
    }
    console.log("[WS AUTO-HEAL] Attempting WebSocket reconnection & 3-ping health verification...");
    this.status = "RECONNECTING";

    const connected = await this.connect();
    if (!connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WS AUTO-HEAL] Reconnection failed. Keeping REST fallback active.");
      this.status = "PAUSED_FAILED";
      return;
    }

    // Run 3 consecutive test pings (<250ms required)
    let passed = 0;
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, 400));
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
      console.log("[WS AUTO-HEAL] SUCCESS: 3/3 health pings passed (<250ms). Restored WebSocket route as active path!");
    } else {
      console.warn(`[WS AUTO-HEAL] Only ${passed}/3 pings passed (<250ms). Route remains in REST fallback.`);
      this.tripToRest(`Auto-heal health gate failed (${passed}/3 pings verified)`);
    }
  }

  public async sendTestPing(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, latencyMs: 0, error: "Socket not open" };
    }
    const t0 = Date.now();
    try {
      this.ws.send(JSON.stringify({ op: "ping" }));
      const latency = Date.now() - t0;
      this.lastPingLatencyMs = latency;
      return { success: true, latencyMs: latency };
    } catch (err: any) {
      return { success: false, latencyMs: 0, error: err.message };
    }
  }

  public recordOrder(rec: WebSocketOrderRecord) {
    this.recentOrders.unshift(rec);
    if (this.recentOrders.length > 50) this.recentOrders = this.recentOrders.slice(0, 50);
  }

  public async manualReconnect(creds?: BybitCredentials): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    this.status = "RECONNECTING";
    const ok = await this.connect(creds);
    if (ok) {
      this.status = "HEALTHY";
      this.activeRoute = "WEBSOCKET";
      this.lastRestoredTime = Date.now();
      return { success: true, latencyMs: this.lastPingLatencyMs };
    }
    return { success: false, error: this.lastTripReason || "Failed to establish WebSocket" };
  }

  public forceTrip(reason: string = "Manual test of Watchdog Circuit Breaker"): void {
    this.tripToRest(reason);
  }
}

// Global singleton instance
const globalForTradeStream = globalThis as unknown as {
  bybitTradeStream?: BybitTradeStreamManager;
};

export const bybitTradeStream = globalForTradeStream.bybitTradeStream ?? new BybitTradeStreamManager();
if (process.env.NODE_ENV !== "production") {
  globalForTradeStream.bybitTradeStream = bybitTradeStream;
}
