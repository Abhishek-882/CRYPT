import crypto from "crypto";
import { pooledFetch } from "./agentPoolManager";

export interface CoinDcxCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface CoinDcxOrderParams {
  symbol: string; // e.g. "BTCUSDT" or "B-BTC_USDT"
  side: "buy" | "sell";
  orderType?: "market_order" | "limit_order";
  quantity: number;
  price?: number;
  leverage?: number;
  bypassLeverage?: boolean;
  clientOrderId?: string;
}

export interface CoinDcxPosition {
  venue: "CoinDCX";
  symbol: string;
  pair: string;
  amount: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice?: number;
}

export interface CoinDcxAccountResult {
  success: boolean;
  venue: string;
  equity: number;
  available: number;
  futuresBalance?: number;
  spotBalance?: number;
  unrealizedPnL: number;
  positions: CoinDcxPosition[];
  isSimulated: boolean;
  error?: string;
  code?: number | string;
  raw?: any;
}

export interface CoinDcxOrderResult {
  success: boolean;
  orderId?: string;
  clientOrderId?: string;
  symbol: string;
  pair: string;
  side: "buy" | "sell";
  quantity: number;
  avgPrice?: number;
  executionLatencyMs: number;
  venue: string;
  isSimulated: boolean;
  error?: string;
  code?: number | string;
  data?: any;
}

const COINDCX_BASE_URL = "https://api.coindcx.com";
const COINDCX_PUBLIC_URL = "https://public.coindcx.com";

/**
 * Standardize symbols between Cockpit format (BTCUSDT) and CoinDCX format (B-BTC_USDT)
 */
export function toCoinDcxPair(symbol: string): string {
  if (!symbol) return "B-BTC_USDT";
  const upper = symbol.trim().toUpperCase();
  if (upper.startsWith("B-") && upper.includes("_")) {
    return upper;
  }
  // Remove "USDT" suffix and reformat with B- prefix
  if (upper.endsWith("USDT")) {
    const base = upper.replace(/USDT$/, "");
    return `B-${base}_USDT`;
  }
  return `B-${upper}_USDT`;
}

export function fromCoinDcxPair(pair: string): string {
  if (!pair) return "BTCUSDT";
  return pair.replace(/^B-/, "").replace(/_USDT$/, "USDT").replace(/_/g, "");
}

/**
 * Generate HMAC-SHA256 headers for CoinDCX authenticated requests
 */
export function getCoinDcxHeaders(
  creds: CoinDcxCredentials,
  bodyStr: string
): Record<string, string> {
  const signature = crypto
    .createHmac("sha256", creds.apiSecret)
    .update(bodyStr)
    .digest("hex");

  return {
    "Content-Type": "application/json",
    "X-AUTH-APIKEY": creds.apiKey,
    "X-AUTH-SIGNATURE": signature,
  };
}

/**
 * Fetch CoinDCX Derivatives Futures Account Balance and Active Positions
 */
export async function getCoinDcxAccount(
  creds?: CoinDcxCredentials
): Promise<CoinDcxAccountResult> {
  // If no credentials or simulation keys, return realistic simulation balance
  if (!creds?.apiKey || !creds?.apiSecret) {
    return {
      success: true,
      venue: "CoinDCX-Simulation",
      equity: 5000.0,
      available: 5000.0,
      unrealizedPnL: 0.0,
      positions: [],
      isSimulated: true,
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);

  try {
    // 1. Fetch Futures Wallets (Primary margin wallet for Derivatives trading)
    const futHeaders = getCoinDcxHeaders(creds, "");
    const futPromise = pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/wallets?timestamp=${timestamp}`, {
      method: "GET",
      headers: futHeaders,
      timeoutMs: 4000,
    }).then((r) => ({ ok: r.ok, status: r.status, data: r.json || [] }))
      .catch((err) => ({ ok: false, status: 500, data: null, error: err.message }));

    // 2. Fetch Spot Balances
    const spotPayload = JSON.stringify({ timestamp });
    const spotHeaders = getCoinDcxHeaders(creds, spotPayload);
    const spotPromise = pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/users/balances`, {
      method: "POST",
      headers: spotHeaders,
      body: spotPayload,
      timeoutMs: 4000,
    }).then((r) => ({ ok: r.ok, status: r.status, data: r.json || [] }))
      .catch((err) => ({ ok: false, status: 500, data: null, error: err.message }));

    // 3. Fetch Active Positions
    const posPayload = JSON.stringify({
      timestamp,
      page: "1",
      size: "50",
      margin_currency_short_name: ["USDT"],
    });
    const posHeaders = getCoinDcxHeaders(creds, posPayload);
    const posPromise = pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/positions`, {
      method: "POST",
      headers: posHeaders,
      body: posPayload,
      timeoutMs: 4000,
    }).then((r) => ({ ok: r.ok, status: r.status, data: r.json || [] }))
      .catch((err) => ({ ok: false, status: 500, data: null, error: err.message }));

    const [futRes, spotRes, posRes] = await Promise.all([futPromise, spotPromise, posPromise]);

    const futData = futRes.data;
    const spotData = spotRes.data;
    const posData = posRes.data;

    // Check credentials error
    if (
      futRes.status === 401 ||
      spotRes.status === 401 ||
      futData?.code === 401 ||
      spotData?.code === 401
    ) {
      const errMsg = futData?.message || spotData?.message || "Invalid CoinDCX credentials";
      return {
        success: false,
        venue: "CoinDCX-Mainnet",
        equity: 0,
        available: 0,
        unrealizedPnL: 0,
        positions: [],
        isSimulated: false,
        error: `CoinDCX API Error: ${errMsg}`,
        code: 401,
      };
    }

    // Parse Futures Wallet (Derivatives collateral)
    const futList = Array.isArray(futData) ? futData : (futData?.wallets || []);
    const usdtFut = futList.find(
      (w: any) => (w.currency_short_name || w.currency || "").toUpperCase() === "USDT"
    ) || {};
    const futBal = parseFloat(usdtFut.balance || "0");
    const futLocked = parseFloat(usdtFut.locked_balance || usdtFut.cross_order_margin || "0");

    // Parse Spot Wallet
    const spotList = Array.isArray(spotData) ? spotData : (spotData?.wallets || spotData?.balances || []);
    const usdtSpot = spotList.find(
      (w: any) => (w.currency || w.currency_short_name || "").toUpperCase() === "USDT"
    ) || {};
    const spotBal = parseFloat(usdtSpot.balance || "0");

    // Parse Active Positions with dynamic orderbook mark price & unrealized PnL enrichment
    let positions: CoinDcxPosition[] = [];
    let netUnrealizedPnL = 0;
    const list = Array.isArray(posData) ? posData : (posData?.positions || posData?.data || []);
    const rawActive = list.filter((p: any) => Math.abs(parseFloat(p.active_pos ?? p.total_quantity ?? p.quantity ?? "0")) > 0.000001);

    positions = await Promise.all(
      rawActive.map(async (p: any) => {
        const rawQty = Math.abs(parseFloat(p.active_pos ?? p.total_quantity ?? p.quantity ?? "0"));
        const activePos = parseFloat(p.active_pos ?? "0");
        const side = (p.side || "").toLowerCase();
        const amt = activePos !== 0 ? activePos : (side === "sell" || side === "short" ? -rawQty : rawQty);
        const entryPrice = parseFloat(p.avg_price || p.entry_price || p.price || "0");
        let markPrice = parseFloat(p.mark_price || "0") || entryPrice;
        let uPnl = parseFloat(p.unrealized_pnl || p.pnl || "0");
        const normSym = fromCoinDcxPair(p.pair || p.instrument_name || "");
        const cdxPair = toCoinDcxPair(normSym);

        // CoinDCX /positions API leaves uPnl null/0 and freezes mark_price at entry.
        // Dynamically enrich using live orderbook mid price.
        try {
          const obRes = await pooledFetch(`${COINDCX_PUBLIC_URL}/market_data/v3/orderbook/${cdxPair}-futures/10`, {
            timeoutMs: 1500,
          });
          const obData = obRes.json;
          if (obData?.bids && obData?.asks) {
            const bidPrices = Object.keys(obData.bids).map(Number).sort((a, b) => b - a);
            const askPrices = Object.keys(obData.asks).map(Number).sort((a, b) => a - b);
            const bestBid = bidPrices[0] || 0;
            const bestAsk = askPrices[0] || 0;
            if (bestBid > 0 && bestAsk > 0) {
              markPrice = (bestBid + bestAsk) / 2;
            } else if (bestBid > 0) {
              markPrice = bestBid;
            } else if (bestAsk > 0) {
              markPrice = bestAsk;
            }
          }
        } catch {
          // Keep baseline markPrice if orderbook fetch times out
        }

        // True delta-neutral unrealized PnL:
        // Long (amt > 0): (markPrice - entryPrice) * amt
        // Short (amt < 0): (entryPrice - markPrice) * |amt| = (markPrice - entryPrice) * amt
        if (entryPrice > 0 && markPrice > 0) {
          uPnl = parseFloat(((markPrice - entryPrice) * amt).toFixed(4));
        }

        return {
          venue: "CoinDCX",
          symbol: normSym,
          pair: p.pair || p.instrument_name || "",
          amount: amt,
          entryPrice,
          markPrice,
          unrealizedPnl: uPnl,
          leverage: parseInt(p.leverage || "10", 10),
          liquidationPrice: parseFloat(p.liquidation_price || "0") || undefined,
        };
      })
    );

    netUnrealizedPnL = positions.reduce((sum, pos) => sum + (pos.unrealizedPnl || 0), 0);

    // For futures trading, the available margin is the Futures Wallet balance.
    // If futures balance is 0 but spot has funds, fallback to spot balance.
    const available = futBal > 0 ? futBal : spotBal;
    const equity = parseFloat(((futBal > 0 ? futBal : spotBal) + futLocked + netUnrealizedPnL).toFixed(4));

    return {
      success: true,
      venue: "CoinDCX-Mainnet",
      equity,
      available,
      futuresBalance: futBal,
      spotBalance: spotBal,
      unrealizedPnL: netUnrealizedPnL,
      positions,
      isSimulated: false,
      raw: {
        futures: futList,
        spot: spotList,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      venue: "CoinDCX-Mainnet",
      equity: 0,
      available: 0,
      unrealizedPnL: 0,
      positions: [],
      isSimulated: false,
      error: `Network error connecting to CoinDCX: ${err.message}`,
    };
  }
}

/**
 * Update CoinDCX Derivatives Futures position leverage
 */
// In-memory cache for pair leverage to eliminate redundant 200ms REST round-trips
const coindcxLeverageCache = new Map<string, number>();

export async function setCoinDcxLeverage(
  creds: CoinDcxCredentials,
  pair: string,
  leverage: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const levKey = `${creds.apiKey || "default"}:${pair}`;
    if (coindcxLeverageCache.get(levKey) === leverage) {
      return { success: true };
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      timestamp,
      pair,
      leverage: leverage.toString(),
      margin_currency_short_name: "USDT",
    });
    const headers = getCoinDcxHeaders(creds, payload);
    const res = await pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/positions/update_leverage`, {
      method: "POST",
      headers,
      body: payload,
      timeoutMs: 4000,
    });
    const data = res.json || {};
    if (!res.ok && data.code !== 200) {
      return { success: false, error: data.message || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * 1-Hop Instant Position Flattening on CoinDCX Derivatives Futures
 * Endpoint: POST /exchange/v1/derivatives/futures/positions/exit
 * Payload: { timestamp: <seconds>, id: "position_id" }
 */
export async function exitCoinDcxPosition(
  creds: CoinDcxCredentials,
  positionId: string
): Promise<{
  success: boolean;
  orderId?: string;
  executionLatencyMs: number;
  error?: string;
  code?: number | string;
  data?: any;
}> {
  const t0 = performance.now();
  if (!creds?.apiKey || !creds?.apiSecret) {
    return {
      success: true,
      orderId: `sim_exit_${Date.now()}`,
      executionLatencyMs: parseFloat((performance.now() - t0).toFixed(2)),
      data: { id: positionId, status: "closed" },
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    timestamp,
    id: positionId,
  });

  try {
    const headers = getCoinDcxHeaders(creds, payload);
    const res = await pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/positions/exit`, {
      method: "POST",
      headers,
      body: payload,
      timeoutMs: 4000,
    });

    const executionLatencyMs = parseFloat((performance.now() - t0).toFixed(2));
    const data = res.json || {};

    if (!res.ok || data.code || data.status === "error") {
      const errMsg = data.message || data.msg || `HTTP ${res.status}`;
      return {
        success: false,
        executionLatencyMs,
        error: `CoinDCX Quick Exit Failed: ${errMsg}`,
        code: data.code || res.status,
        data,
      };
    }

    const orderObj = Array.isArray(data) ? data[0] : (data.data || data);
    const orderId = orderObj?.id || orderObj?.order_id || positionId;

    return {
      success: true,
      orderId,
      executionLatencyMs,
      data,
    };
  } catch (err: any) {
    return {
      success: false,
      executionLatencyMs: parseFloat((performance.now() - t0).toFixed(2)),
      error: `CoinDCX Quick Exit Network Error: ${err.message}`,
    };
  }
}

/**
 * Dispatch an order to CoinDCX Derivatives Futures Mainnet
 */
export async function placeCoinDcxOrder(
  params: CoinDcxOrderParams,
  creds?: CoinDcxCredentials
): Promise<CoinDcxOrderResult> {
  const startTime = Date.now();
  const pair = toCoinDcxPair(params.symbol);
  const stdSymbol = fromCoinDcxPair(pair);

  // If no credentials or simulation keys, simulate instant fill with live orderbook price
  if (!creds?.apiKey || !creds?.apiSecret) {
    let fillPrice = 82800.0;
    try {
      const obRes = await pooledFetch(`${COINDCX_PUBLIC_URL}/market_data/v3/orderbook/${pair}-futures/10`, {
        timeoutMs: 3000,
      });
      const obData = obRes.json;
      if (params.side === "buy" && obData.asks) {
        const bestAsk = Object.keys(obData.asks)[0];
        if (bestAsk) fillPrice = parseFloat(bestAsk);
      } else if (params.side === "sell" && obData.bids) {
        const bestBid = Object.keys(obData.bids)[0];
        if (bestBid) fillPrice = parseFloat(bestBid);
      }
    } catch {
      // fallback fillPrice
    }

    return {
      success: true,
      orderId: `sim_coindcx_${Date.now()}`,
      symbol: stdSymbol,
      pair,
      side: params.side,
      quantity: params.quantity,
      avgPrice: fillPrice,
      executionLatencyMs: Date.now() - startTime,
      venue: "CoinDCX-Simulation",
      isSimulated: true,
    };
  }

  // Ensure position leverage matches requested leverage on CoinDCX (cached to avoid redundant 200ms REST calls)
  if (params.leverage && !params.bypassLeverage && creds?.apiKey && creds?.apiSecret) {
    const levKey = `${creds.apiKey || "default"}:${pair}`;
    if (coindcxLeverageCache.get(levKey) !== params.leverage) {
      await setCoinDcxLeverage(creds, pair, params.leverage).catch(() => {});
      coindcxLeverageCache.set(levKey, params.leverage);
    }
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const orderType = params.orderType || "market_order";

  const orderPayload: Record<string, any> = {
    side: params.side,
    pair,
    order_type: orderType,
    total_quantity: params.quantity,
    leverage: params.leverage || 10,
    notification: "no_notification",
  };

  // Time in force must NOT be passed for market orders per CoinDCX specification
  if (orderType !== "market_order") {
    orderPayload.time_in_force = "good_till_cancel";
    if (params.price) {
      orderPayload.price = params.price;
    }
  }

  const payload = {
    timestamp,
    order: orderPayload,
  };

  const bodyStr = JSON.stringify(payload);

  try {
    const headers = getCoinDcxHeaders(creds, bodyStr);
    const res = await pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/orders/create`, {
      method: "POST",
      headers,
      body: bodyStr,
      timeoutMs: 4000,
    });

    const ackDurationMs = Math.round(res.durationMs || (Date.now() - startTime));
    const data = res.json || {};

    if (!res.ok || data.code || data.status === "error") {
      const errMsg = data.message || data.msg || `HTTP ${res.status}`;
      return {
        success: false,
        symbol: stdSymbol,
        pair,
        side: params.side,
        quantity: params.quantity,
        executionLatencyMs: ackDurationMs,
        venue: "CoinDCX-Mainnet",
        isSimulated: false,
        error: `CoinDCX Order Rejected: ${errMsg}`,
        code: data.code || res.status,
      };
    }

    const orderObj = Array.isArray(data) ? data[0] : (data.data || data);
    const orderId = orderObj?.id || orderObj?.order_id;
    let avgPrice = parseFloat(orderObj?.avg_price || orderObj?.price || "0") || undefined;

    // If market fill price is not returned immediately, retrieve from live WebSocket stream (0ms) instead of blocking REST
    if (!avgPrice) {
      try {
        const { coindcxTradeStream } = await import("./coindcxTradeStream");
        const live = coindcxTradeStream.getCoinDcxLivePrice(stdSymbol);
        if (live && live.midPrice > 0) {
          avgPrice = params.side === "buy" ? (live.bestAsk || live.midPrice) : (live.bestBid || live.midPrice);
        }
      } catch {}
    }
    if (!avgPrice) {
      try {
        const tradeRes = await pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/data/trades?pair=${pair}`, {
          timeoutMs: 1500,
        });
        const tradeData = tradeRes.json;
        if (Array.isArray(tradeData) && tradeData[0]?.price) {
          avgPrice = parseFloat(tradeData[0].price);
        }
      } catch {
        // fallback
      }
    }

    return {
      success: true,
      orderId,
      clientOrderId: orderObj?.client_order_id,
      symbol: stdSymbol,
      pair,
      side: params.side,
      quantity: params.quantity,
      avgPrice,
      executionLatencyMs: ackDurationMs,
      venue: "CoinDCX-Mainnet",
      isSimulated: false,
      data,
    };
  } catch (err: any) {
    return {
      success: false,
      symbol: stdSymbol,
      pair,
      side: params.side,
      quantity: params.quantity,
      executionLatencyMs: Date.now() - startTime,
      venue: "CoinDCX-Mainnet",
      isSimulated: false,
      error: `Execution error on CoinDCX: ${err.message}`,
    };
  }
}

/**
 * Cancel an open order on CoinDCX
 */
export async function cancelCoinDcxOrder(
  orderId: string,
  creds?: CoinDcxCredentials
): Promise<{ success: boolean; error?: string }> {
  if (!creds?.apiKey || !creds?.apiSecret) {
    return { success: true };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ id: orderId, timestamp });

  try {
    const headers = getCoinDcxHeaders(creds, payload);
    const res = await pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/orders/cancel`, {
      method: "POST",
      headers,
      body: payload,
      timeoutMs: 4000,
    });
    const data = res.json || {};
    if (res.ok && !data.code) {
      return { success: true };
    }
    return { success: false, error: data.message || `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch all active CoinDCX Futures Instruments (505 pairs)
 */
export async function fetchCoinDcxActiveInstruments(): Promise<string[]> {
  try {
    const res = await pooledFetch(`${COINDCX_BASE_URL}/exchange/v1/derivatives/futures/data/active_instruments`, {
      timeoutMs: 4000,
    });
    const data = res.json;
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Fetch live order book depth from CoinDCX
 */
export async function fetchCoinDcxOrderbook(symbol: string, depth = 10): Promise<{
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  bids: [number, number][];
  asks: [number, number][];
} | null> {
  try {
    const { coindcxTradeStream } = await import("./coindcxTradeStream");
    const live = coindcxTradeStream.getCoinDcxLivePrice(symbol);
    if (live && live.bestBid > 0 && live.bestAsk > 0) {
      const spreadBps = live.midPrice > 0 ? ((live.bestAsk - live.bestBid) / live.midPrice) * 10000 : 0;
      return {
        bestBid: live.bestBid,
        bestAsk: live.bestAsk,
        spreadBps,
        bids: [[live.bestBid, 1.0]],
        asks: [[live.bestAsk, 1.0]],
      };
    }
  } catch {}

  const pair = toCoinDcxPair(symbol);
  try {
    const res = await pooledFetch(`${COINDCX_PUBLIC_URL}/market_data/v3/orderbook/${pair}-futures/${depth}`, {
      timeoutMs: 3000,
    });
    const data = res.json;
    if (!data?.bids || !data?.asks) return null;

    const bidPrices = Object.keys(data.bids).map(Number).sort((a, b) => b - a);
    const askPrices = Object.keys(data.asks).map(Number).sort((a, b) => a - b);

    const bestBid = bidPrices[0] || 0;
    const bestAsk = askPrices[0] || 0;

    const mid = (bestBid + bestAsk) / 2;
    const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;

    const bids: [number, number][] = bidPrices.map((p) => [p, parseFloat(data.bids[p.toString()])]);
    const asks: [number, number][] = askPrices.map((p) => [p, parseFloat(data.asks[p.toString()])]);

    return {
      bestBid,
      bestAsk,
      spreadBps,
      bids,
      asks,
    };
  } catch {
    return null;
  }
}
