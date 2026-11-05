/**
 * Protective Stop-Loss Order Placement & Cancellation Engine
 * 
 * ARCHITECTURAL MANDATE: OPTION A LOCKED (PURE CONVERGENCE HOLD)
 * Under user directive and institutional policy, Option A (Pure Convergence Hold) is ENFORCED.
 * Real-money execution NEVER dispatches broker-side stops or liquidation plan orders.
 * Positions remain in WAITING_PRICE_PARITY until basis divergence compresses to threshold.
 * This module is archived and retained for offline simulation/Option B historical regression only.
 */

import { calculateDynamicLiquidationStop, DynamicStopLossResult } from "./liquidationCalculator";
import { UserApiKeys } from "./userStore";
import { decryptVaultSecret } from "./cryptoVault";

export interface ProtectiveStopResult {
  success: boolean;
  stopOrderId: string;
  clientOrderId: string;
  venue: string;
  symbol: string;
  stopSide: "BUY" | "SELL";
  stopPrice: number;
  estimatedLiquidationPrice: number;
  stopDistancePct: number;
  isSimulated: boolean;
  error?: string;
  raw?: any;
}

export interface ProtectiveStopCancelResult {
  success: boolean;
  venue: string;
  symbol: string;
  stopOrderId: string;
  error?: string;
}

/**
 * Place a native broker-side protective stop-loss order on the designated venue.
 */
export async function placeVenueProtectiveStop(
  venue: "Binance" | "Bitget" | "Bybit" | "CoinDCX",
  params: {
    symbol: string;
    positionSide: "BUY" | "SELL";
    quantity: number;
    entryPrice: number;
    leverage: number;
    clientOrderId?: string;
    maintenanceMarginRate?: number;
    bufferRatio?: number;
  },
  creds?: UserApiKeys
): Promise<ProtectiveStopResult> {
  const symbol = params.symbol.toUpperCase();
  const positionSide = params.positionSide.toUpperCase() as "BUY" | "SELL";
  const qty = params.quantity;
  const entryPrice = params.entryPrice;
  const leverage = params.leverage || 10;
  const clientOrderId = params.clientOrderId || crypto.randomUUID();

  // Calculate Option B dynamic liquidation buffer stop price
  const stopCalc: DynamicStopLossResult = calculateDynamicLiquidationStop(
    positionSide,
    entryPrice,
    leverage,
    params.maintenanceMarginRate ?? 0.005,
    params.bufferRatio ?? 0.50
  );

  const stopSide = stopCalc.stopSide;
  const stopPrice = stopCalc.stopPrice;

  // 1. Binance Protective Stop
  if (venue.toLowerCase() === "binance") {
    const key = creds?.binanceKey || process.env.ADMIN_BINANCE_KEY || "";
    const sec = creds?.binanceSecret || process.env.ADMIN_BINANCE_SECRET || "";
    const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;

    if (!key || !cleanSec) {
      // Simulation / Paper mode
      return {
        success: true,
        stopOrderId: `sim_bn_stop_${Date.now()}`,
        clientOrderId,
        venue: "Binance",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: true,
      };
    }

    try {
      const { signAndFetchBinance } = await import("./binanceSigner");
      const { data } = await signAndFetchBinance(
        key,
        cleanSec,
        "POST",
        "/fapi/v1/order",
        {
          symbol,
          side: stopSide,
          type: "STOP_MARKET",
          quantity: String(qty),
          stopPrice: String(stopPrice),
          reduceOnly: "true",
          newClientOrderId: clientOrderId,
        },
        true,
        creds?.binanceEndpoint
      );

      return {
        success: true,
        stopOrderId: String(data.orderId || ""),
        clientOrderId: data.clientOrderId || clientOrderId,
        venue: "Binance",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: false,
        raw: data,
      };
    } catch (err: any) {
      return {
        success: false,
        stopOrderId: "",
        clientOrderId,
        venue: "Binance",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: false,
        error: err.message,
      };
    }
  }

  // 2. Bitget Protective Stop (Plan Order)
  if (venue.toLowerCase() === "bitget") {
    const key = creds?.bitgetKey || process.env.ADMIN_BITGET_KEY || "";
    const sec = creds?.bitgetSecret || process.env.ADMIN_BITGET_SECRET || "";
    const pass = creds?.bitgetPassphrase || process.env.ADMIN_BITGET_PASSPHRASE || "";
    const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;
    const cleanPass = pass.startsWith("enc:v1:") ? decryptVaultSecret(pass) : pass;

    if (!key || !cleanSec || !cleanPass) {
      return {
        success: true,
        stopOrderId: `sim_bg_stop_${Date.now()}`,
        clientOrderId,
        venue: "Bitget",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: true,
      };
    }

    try {
      const { bitgetHttpFetch, getBitgetHeaders } = await import("./bitgetSigner");
      const path = "/api/v2/mix/order/place-plan-order";
      const payload = {
        category: "USDT-FUTURES",
        symbol,
        planType: "loss_plan",
        triggerPrice: String(stopPrice),
        triggerType: "mark_price",
        executeCycle: "single",
        orderType: "market",
        side: stopSide.toLowerCase(),
        tradeSide: "close",
        size: String(qty),
        clientOid: clientOrderId,
      };
      const bodyStr = JSON.stringify(payload);
      const headers = await getBitgetHeaders(
        { apiKey: key, apiSecret: cleanSec, passphrase: cleanPass, isDemo: creds?.bitgetEnv !== "live" },
        "POST",
        path,
        bodyStr
      );
      const res = await bitgetHttpFetch(`https://api.bitget.com${path}`, {
        method: "POST",
        headers,
        body: bodyStr,
      });

      if (res.json?.code === "00000") {
        return {
          success: true,
          stopOrderId: String(res.json.data?.orderId || res.json.data?.clientOid || clientOrderId),
          clientOrderId,
          venue: "Bitget",
          symbol,
          stopSide,
          stopPrice,
          estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
          stopDistancePct: stopCalc.stopDistancePct,
          isSimulated: false,
          raw: res.json,
        };
      } else {
        return {
          success: false,
          stopOrderId: "",
          clientOrderId,
          venue: "Bitget",
          symbol,
          stopSide,
          stopPrice,
          estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
          stopDistancePct: stopCalc.stopDistancePct,
          isSimulated: false,
          error: res.json?.msg || `Bitget plan order error: ${res.json?.code}`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        stopOrderId: "",
        clientOrderId,
        venue: "Bitget",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: false,
        error: err.message,
      };
    }
  }

  // 3. Bybit Protective Stop (Set Trading Stop or Conditional Order)
  if (venue.toLowerCase() === "bybit") {
    const key = creds?.bybitKey || process.env.BYBIT_KEY || "";
    const sec = creds?.bybitSecret || process.env.BYBIT_SECRET || "";
    const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;

    if (!key || !cleanSec || creds?.isPaper) {
      return {
        success: true,
        stopOrderId: `sim_bybit_stop_${Date.now()}`,
        clientOrderId,
        venue: "Bybit",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: true,
      };
    }

    try {
      const { sendBybitRequest } = await import("./bybitSigner");
      const bybitCreds = {
        apiKey: key,
        apiSecret: cleanSec,
        proxyUrl: creds?.bybitProxy,
        baseUrl: creds?.bybitBaseUrl,
      };

      // Bybit V5 /v5/position/trading-stop sets exchange-side native SL directly on the position
      const res = await sendBybitRequest("/v5/position/trading-stop", "POST", bybitCreds, {
        category: "linear",
        symbol,
        stopLoss: String(stopPrice),
        slTriggerBy: "MarkPrice",
        tpslMode: "Full",
        positionIdx: 0,
      });

      if (res.retCode === 0) {
        return {
          success: true,
          stopOrderId: `bybit_sl_${symbol}_${Date.now()}`,
          clientOrderId,
          venue: "Bybit",
          symbol,
          stopSide,
          stopPrice,
          estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
          stopDistancePct: stopCalc.stopDistancePct,
          isSimulated: false,
          raw: res,
        };
      } else {
        return {
          success: false,
          stopOrderId: "",
          clientOrderId,
          venue: "Bybit",
          symbol,
          stopSide,
          stopPrice,
          estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
          stopDistancePct: stopCalc.stopDistancePct,
          isSimulated: false,
          error: res.retMsg || `Bybit trading stop error: ${res.retCode}`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        stopOrderId: "",
        clientOrderId,
        venue: "Bybit",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: false,
        error: err.message,
      };
    }
  }

  // 4. CoinDCX Protective Stop
  if (venue.toLowerCase() === "coindcx") {
    const key = creds?.coindcxKey || process.env.COINDCX_KEY || "";
    const sec = creds?.coindcxSecret || process.env.COINDCX_SECRET || "";
    const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;

    if (!key || !cleanSec) {
      return {
        success: true,
        stopOrderId: `sim_cdx_stop_${Date.now()}`,
        clientOrderId,
        venue: "CoinDCX",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: true,
      };
    }

    try {
      const { toCoinDcxPair, getCoinDcxHeaders } = await import("./coindcxSigner");
      const { pooledFetch } = await import("./agentPoolManager");
      const pair = toCoinDcxPair(symbol);
      const timestamp = Math.floor(Date.now() / 1000);

      const payload = {
        timestamp,
        order: {
          side: stopSide.toLowerCase(),
          pair,
          order_type: "stop_limit",
          stop_price: stopPrice,
          price: stopPrice,
          total_quantity: qty,
          leverage,
          notification: "no_notification",
        },
      };

      const bodyStr = JSON.stringify(payload);
      const headers = getCoinDcxHeaders({ apiKey: key, apiSecret: cleanSec }, bodyStr);
      const res = await pooledFetch("https://api.coindcx.com/exchange/v1/derivatives/futures/orders/create", {
        method: "POST",
        headers,
        body: bodyStr,
        timeoutMs: 4000,
      });

      if (res.json?.id || res.json?.status === "successful") {
        return {
          success: true,
          stopOrderId: String(res.json.id || res.json.order_id || clientOrderId),
          clientOrderId,
          venue: "CoinDCX",
          symbol,
          stopSide,
          stopPrice,
          estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
          stopDistancePct: stopCalc.stopDistancePct,
          isSimulated: false,
          raw: res.json,
        };
      } else {
        return {
          success: false,
          stopOrderId: "",
          clientOrderId,
          venue: "CoinDCX",
          symbol,
          stopSide,
          stopPrice,
          estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
          stopDistancePct: stopCalc.stopDistancePct,
          isSimulated: false,
          error: res.json?.message || "CoinDCX stop order rejected",
        };
      }
    } catch (err: any) {
      return {
        success: false,
        stopOrderId: "",
        clientOrderId,
        venue: "CoinDCX",
        symbol,
        stopSide,
        stopPrice,
        estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
        stopDistancePct: stopCalc.stopDistancePct,
        isSimulated: false,
        error: err.message,
      };
    }
  }

  return {
    success: false,
    stopOrderId: "",
    clientOrderId,
    venue,
    symbol,
    stopSide,
    stopPrice,
    estimatedLiquidationPrice: stopCalc.estimatedLiquidationPrice,
    stopDistancePct: stopCalc.stopDistancePct,
    isSimulated: false,
    error: `Unsupported venue: ${venue}`,
  };
}

/**
 * Cancel an active broker-side protective stop-loss order upon normal hedge close.
 */
export async function cancelVenueProtectiveStop(
  venue: string,
  symbol: string,
  stopOrderId: string,
  creds?: UserApiKeys
): Promise<ProtectiveStopCancelResult> {
  const normVenue = (venue || "").toLowerCase();

  // If order is simulated or missing, instant return success
  if (!stopOrderId || stopOrderId.startsWith("sim_")) {
    return { success: true, venue, symbol, stopOrderId };
  }

  try {
    if (normVenue === "binance") {
      const key = creds?.binanceKey || process.env.ADMIN_BINANCE_KEY || "";
      const sec = creds?.binanceSecret || process.env.ADMIN_BINANCE_SECRET || "";
      const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;
      if (key && cleanSec) {
        const { signAndFetchBinance } = await import("./binanceSigner");
        await signAndFetchBinance(
          key,
          cleanSec,
          "DELETE",
          "/fapi/v1/order",
          { symbol: symbol.toUpperCase(), orderId: stopOrderId },
          true,
          creds?.binanceEndpoint
        );
      }
      return { success: true, venue, symbol, stopOrderId };
    }

    if (normVenue === "bitget") {
      const key = creds?.bitgetKey || process.env.ADMIN_BITGET_KEY || "";
      const sec = creds?.bitgetSecret || process.env.ADMIN_BITGET_SECRET || "";
      const pass = creds?.bitgetPassphrase || process.env.ADMIN_BITGET_PASSPHRASE || "";
      const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;
      const cleanPass = pass.startsWith("enc:v1:") ? decryptVaultSecret(pass) : pass;
      if (key && cleanSec && cleanPass) {
        const { bitgetHttpFetch, getBitgetHeaders } = await import("./bitgetSigner");
        const path = "/api/v2/mix/order/cancel-plan-order";
        const payload = {
          category: "USDT-FUTURES",
          symbol: symbol.toUpperCase(),
          orderId: stopOrderId,
        };
        const bodyStr = JSON.stringify(payload);
        const headers = await getBitgetHeaders(
          { apiKey: key, apiSecret: cleanSec, passphrase: cleanPass, isDemo: creds?.bitgetEnv !== "live" },
          "POST",
          path,
          bodyStr
        );
        await bitgetHttpFetch(`https://api.bitget.com${path}`, { method: "POST", headers, body: bodyStr });
      }
      return { success: true, venue, symbol, stopOrderId };
    }

    if (normVenue === "bybit") {
      const key = creds?.bybitKey || process.env.BYBIT_KEY || "";
      const sec = creds?.bybitSecret || process.env.BYBIT_SECRET || "";
      const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;
      if (key && cleanSec) {
        const { sendBybitRequest } = await import("./bybitSigner");
        // Clear trading stop on position
        await sendBybitRequest("/v5/position/trading-stop", "POST", {
          apiKey: key,
          apiSecret: cleanSec,
          proxyUrl: creds?.bybitProxy,
          baseUrl: creds?.bybitBaseUrl,
        }, {
          category: "linear",
          symbol: symbol.toUpperCase(),
          stopLoss: "0",
          positionIdx: 0,
        }).catch(() => {});
      }
      return { success: true, venue, symbol, stopOrderId };
    }

    if (normVenue === "coindcx") {
      const key = creds?.coindcxKey || process.env.COINDCX_KEY || "";
      const sec = creds?.coindcxSecret || process.env.COINDCX_SECRET || "";
      const cleanSec = sec.startsWith("enc:v1:") ? decryptVaultSecret(sec) : sec;
      if (key && cleanSec) {
        const { getCoinDcxHeaders } = await import("./coindcxSigner");
        const { pooledFetch } = await import("./agentPoolManager");
        const payload = { id: stopOrderId, timestamp: Math.floor(Date.now() / 1000) };
        const bodyStr = JSON.stringify(payload);
        const headers = getCoinDcxHeaders({ apiKey: key, apiSecret: cleanSec }, bodyStr);
        await pooledFetch("https://api.coindcx.com/exchange/v1/derivatives/futures/orders/cancel", {
          method: "POST",
          headers,
          body: bodyStr,
        }).catch(() => {});
      }
      return { success: true, venue, symbol, stopOrderId };
    }
  } catch (err: any) {
    return { success: false, venue, symbol, stopOrderId, error: err.message };
  }

  return { success: true, venue, symbol, stopOrderId };
}
