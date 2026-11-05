/**
 * Bybit V5 Public Linear WebSocket Stream Manager
 *
 * Maintains a persistent, ultra-low-latency real-time stream to Bybit V5 Public Linear WebSocket:
 * wss://stream.bybit.com/v5/public/linear
 *
 * Direct WebSocket connections bypass CloudFront geo-IP blocks and provide sub-millisecond
 * funding rate and mark price ingestion across all Bybit perpetual contracts.
 */

import { ContractIdentityResolver } from "./contractIdentityResolver";

let NodeWebSocket: any = null;
try {
  NodeWebSocket = require("ws");
} catch {}

export interface BybitTickerData {
  symbol: string;
  fundingRate: number;      // raw decimal, e.g. 0.0001
  fundingRatePct: number;   // % format, e.g. 0.01000
  markPrice: number;
  lastPrice: number;
  volume24h: number;
  turnover24h: number;
  nextFundingTime: number;
  fundingIntervalHours: number;
  updatedAt: number;
}

class BybitStreamManager {
  private ws: any = null;
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;
  private reconnectAttempts: number = 0;
  private subscribedTopics: Set<string> = new Set();
  private pendingSubscriptions: Set<string> = new Set();
  private tickerCache: Map<string, BybitTickerData> = new Map();
  private normalizedIndex: Map<string, string> = new Map(); // e.g. "PEPEUSDT" -> "1000PEPEUSDT"
  private lastMessageTime: number = 0;

  constructor() {
    if (typeof window === "undefined") {
      this.init();
    }
  }

  public init() {
    if (this.isConnected || this.isConnecting) return;
    this.connect();
  }

  private connect() {
    const WsClass = NodeWebSocket || (typeof WebSocket !== "undefined" ? WebSocket : (globalThis as any).WebSocket);
    if (!WsClass) {
      console.warn("[BybitStreamManager] WebSocket library not available in environment");
      return;
    }

    this.isConnecting = true;
    try {
      const url = "wss://stream.bybit.com/v5/public/linear";
      this.ws = new WsClass(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();

        // Start 20-second heartbeat ping
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.isConnected) {
            try {
              this.ws.send(JSON.stringify({ op: "ping" }));
            } catch {}
          }
        }, 20000);

        // Resubscribe existing topics
        const topicsToResubscribe = Array.from(this.subscribedTopics).concat(
          Array.from(this.pendingSubscriptions)
        );
        this.subscribedTopics.clear();
        this.pendingSubscriptions.clear();

        if (topicsToResubscribe.length > 0) {
          this.sendSubscriptions(topicsToResubscribe);
        }
      };

      this.ws.onmessage = (event: any) => {
        this.lastMessageTime = Date.now();
        try {
          const raw = typeof event.data === "string" ? event.data : event.data?.toString();
          if (!raw) return;
          const msg = JSON.parse(raw);

          // Heartbeat response
          if (msg.op === "pong" || msg.ret_msg === "pong") {
            return;
          }

          // Topic snapshot or delta
          if (msg.topic && msg.topic.startsWith("tickers.") && msg.data) {
            this.handleTickerMessage(msg);
          }
        } catch {}
      };

      this.ws.onerror = () => {
        // Error will trigger onclose
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        this.scheduleReconnect();
      };
    } catch {
      this.isConnected = false;
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    const backoffMs = Math.min(30000, 1000 * Math.pow(1.5, this.reconnectAttempts));
    this.reconnectAttempts++;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, backoffMs);
  }

  private handleTickerMessage(msg: any) {
    const data = msg.data;
    const sym = data.symbol;
    if (!sym) return;

    const existing = this.tickerCache.get(sym);
    const rawRate = data.fundingRate !== undefined && data.fundingRate !== ""
      ? parseFloat(data.fundingRate)
      : existing ? existing.fundingRate : 0;
    const markPrice = data.markPrice !== undefined && data.markPrice !== ""
      ? parseFloat(data.markPrice)
      : existing ? existing.markPrice : (parseFloat(data.lastPrice || "0") || 0);
    const lastPrice = data.lastPrice !== undefined && data.lastPrice !== ""
      ? parseFloat(data.lastPrice)
      : existing ? existing.lastPrice : markPrice;
    const volume24h = data.volume24h !== undefined && data.volume24h !== ""
      ? parseFloat(data.volume24h)
      : existing ? existing.volume24h : 0;
    const turnover24h = data.turnover24h !== undefined && data.turnover24h !== ""
      ? parseFloat(data.turnover24h)
      : existing ? existing.turnover24h : 0;
    const nextFundingTime = data.nextFundingTime !== undefined && data.nextFundingTime !== ""
      ? parseInt(data.nextFundingTime, 10)
      : existing ? existing.nextFundingTime : 0;
    const effInterval = data.fundingIntervalHour !== undefined && data.fundingIntervalHour !== ""
      ? parseInt(data.fundingIntervalHour, 10)
      : existing ? existing.fundingIntervalHours : 8;

    const tickerItem: BybitTickerData = {
      symbol: sym,
      fundingRate: rawRate,
      fundingRatePct: parseFloat((rawRate * 100).toFixed(5)),
      markPrice,
      lastPrice,
      volume24h,
      turnover24h,
      nextFundingTime,
      fundingIntervalHours: effInterval || 8,
      updatedAt: Date.now(),
    };

    this.tickerCache.set(sym, tickerItem);

    // Build normalized aliases (e.g. 1000PEPEUSDT -> PEPEUSDT)
    if (sym.startsWith("1000")) {
      const stripped = sym.replace(/^1000/, "");
      // Invariant: Never alias to a known TradFi asset or colliding ticker
      if (!ContractIdentityResolver.isTradFiOrEquity(stripped)) {
        this.normalizedIndex.set(stripped, sym);
        // Also store aliased view for seamless lookups
        this.tickerCache.set(stripped, {
          ...tickerItem,
          symbol: stripped,
        });
      }
    }
  }

  private sendSubscriptions(topics: string[]) {
    if (!this.ws || !this.isConnected) return;
    for (const topic of topics) {
      if (this.subscribedTopics.has(topic)) continue;
      this.subscribedTopics.add(topic);
      try {
        this.ws.send(JSON.stringify({ op: "subscribe", args: [topic] }));
      } catch {}
    }
  }

  public subscribeSymbols(symbols: string[]) {
    this.init();
    const newTopics: string[] = [];
    for (const rawSym of symbols) {
      const s = rawSym.toUpperCase();
      const topic1 = `tickers.${s}`;
      if (!this.subscribedTopics.has(topic1) && !this.pendingSubscriptions.has(topic1)) {
        this.pendingSubscriptions.add(topic1);
        newTopics.push(topic1);
      }
      // Also add 1000-multiplier variant if not already starting with 1000
      if (!s.startsWith("1000")) {
        const topic2 = `tickers.1000${s}`;
        if (!this.subscribedTopics.has(topic2) && !this.pendingSubscriptions.has(topic2)) {
          this.pendingSubscriptions.add(topic2);
          newTopics.push(topic2);
        }
      }
    }

    if (this.isConnected && newTopics.length > 0) {
      this.sendSubscriptions(newTopics);
    }
  }

  public getTicker(symbol: string): BybitTickerData | undefined {
    const s = symbol.toUpperCase();
    if (this.tickerCache.has(s)) {
      return this.tickerCache.get(s);
    }
    const alias = this.normalizedIndex.get(s);
    if (alias && this.tickerCache.has(alias)) {
      return this.tickerCache.get(alias);
    }
    const mult = `1000${s}`;
    if (this.tickerCache.has(mult)) {
      return this.tickerCache.get(mult);
    }
    return undefined;
  }

  public getAllTickers(): Map<string, BybitTickerData> {
    return this.tickerCache;
  }

  public getTickerCount(): number {
    return this.tickerCache.size;
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      tickerCount: this.tickerCache.size,
      subscribedCount: this.subscribedTopics.size,
      lastMessageAgeMs: this.lastMessageTime > 0 ? Date.now() - this.lastMessageTime : -1,
    };
  }
}

// Global singleton declaration to preserve state across Next.js API route invocations
const globalForBybit = globalThis as unknown as {
  bybitStreamManagerInstance?: BybitStreamManager;
};

export const bybitStreamManager: BybitStreamManager =
  globalForBybit.bybitStreamManagerInstance || new BybitStreamManager();

if (process.env.NODE_ENV !== "production") {
  globalForBybit.bybitStreamManagerInstance = bybitStreamManager;
}

export function getBybitTicker(symbol: string): BybitTickerData | undefined {
  return bybitStreamManager.getTicker(symbol);
}

export function getAllBybitTickers(): Map<string, BybitTickerData> {
  return bybitStreamManager.getAllTickers();
}

export function subscribeBybitSymbols(symbols: string[]) {
  bybitStreamManager.subscribeSymbols(symbols);
}

export function getBybitStreamStatus() {
  return bybitStreamManager.getStatus();
}
