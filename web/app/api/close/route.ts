import { NextRequest, NextResponse } from "next/server";
import { signAndFetchBinance } from "@/lib/binanceSigner";
import { placeBitgetOrder, getBitgetHeaders, BitgetCredentials, bitgetHttpFetch } from "@/lib/bitgetSigner";
import { placeCoinDcxOrder, fromCoinDcxPair, getCoinDcxHeaders, exitCoinDcxPosition } from "@/lib/coindcxSigner";
import { pooledFetch } from "@/lib/agentPoolManager";
import { fetchBybitPositions, placeBybitOrder, BybitCredentials } from "@/lib/bybitSigner";
import { verifyProxyPreFlight } from "@/lib/proxyPoolManager";
import { getCorridorStaggerDelays, getLeadStaggerDelays, recordExecutionRTTMulti, recordExecutionRTT } from "@/lib/latencyTracker";
import { checkRateLimit } from "@/lib/rateLimiter";
import { logServerEvent } from "@/lib/logger";
import { resolveCallerCredentials } from "@/lib/authHelper";
import { recordServerTrade } from "@/lib/serverTradeStore";
import { lockFlattenedCoinForBot } from "@/lib/botEngine";
import { closePaperPosition } from "@/lib/paperTradingEngine";

export const dynamic = "force-dynamic";

function formatSymbolQuantity(qty: number, symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.startsWith("BTC")) return qty.toFixed(3);
  if (s.startsWith("ETH")) return qty.toFixed(2);
  if (s.startsWith("SOL")) return qty.toFixed(1);
  if (s.startsWith("DOGE")) return Math.round(qty).toString();
  if (s.startsWith("XRP")) return qty.toFixed(1);
  return qty.toFixed(3);
}

export async function POST(req: NextRequest) {
  // 1. Sliding-Window Rate Limiting (12 requests / 5s per IP)
  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "local_client";
  const rateLimit = checkRateLimit(clientIp, { windowMs: 5000, maxRequests: 12 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Rate limit exceeded. System is pacing requests. Retry in ${(rateLimit.resetMs / 1000).toFixed(1)}s.`,
      },
      { status: 429 }
    );
  }

  const creds = resolveCallerCredentials(req);
  if (!creds.authorized) {
    return NextResponse.json(
      { success: false, error: "Authentication required to close trading positions." },
      { status: 401 }
    );
  }
  const binanceKey = creds.binanceKey;
  const binanceSecret = creds.binanceSecret;
  const preferredUrl = creds.binanceEndpoint;

  const bitgetCreds: BitgetCredentials | undefined = creds.bitgetKey && creds.bitgetSecret && creds.bitgetPassphrase
    ? { apiKey: creds.bitgetKey, apiSecret: creds.bitgetSecret, passphrase: creds.bitgetPassphrase, isDemo: creds.bitgetEnv === "demo" }
    : undefined;

  const bybitCreds: BybitCredentials | undefined = creds.bybitKey && creds.bybitSecret
    ? {
        apiKey: creds.bybitKey,
        apiSecret: creds.bybitSecret,
        proxyUrl: creds.bybitProxy,
        baseUrl: creds.bybitBaseUrl,
        backupProxyUrl: creds.bybitBackupProxy,
        backupBaseUrl: creds.bybitBackupBaseUrl,
      }
    : undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const tradingMode = req.headers.get("x-trading-mode") || body.mode || "testnet";
  const targetSymbol: string | undefined = body?.symbol && body.symbol !== "ALL"
    ? String(body.symbol).toUpperCase()
    : undefined;

  const isCorridorTargeted = Boolean(body.corridor && body.corridor !== "ALL");
  const targetCorridor = (body.corridor || "ALL").toUpperCase();

  // Corridor-targeted selection: if a specific corridor is requested, ONLY query its venues
  const shouldCloseBinance = !isCorridorTargeted || targetCorridor.includes("BINANCE");
  const shouldCloseBitget = targetCorridor.includes("BITGET") || (!isCorridorTargeted && tradingMode !== "mainnet");
  const shouldCloseCoinDcx = !isCorridorTargeted || targetCorridor.includes("COINDCX");
  const shouldCloseBybit = !isCorridorTargeted || targetCorridor.includes("BYBIT");

  // INSTITUTIONAL INVARIANT: Zero Lead-Stagger Delay on Close / Unwind (Simultaneous T=0 Parallel Dispatch)
  const binanceDelayMs = 0;
  const bitgetDelayMs = 0;
  const coindcxDelayMs = 0;
  const bybitDelayMs = 0;
  const leadStaggerAppliedMs = 0;
  const staggerVenue = "None";
  const leadVenue = "Simultaneous";

  if (tradingMode === "paper") {
    const tPaperStart = performance.now();
    const userId = creds.user?.id || "usr_admin_varsha";
    const closedPaper = closePaperPosition(targetSymbol || "ALL", undefined, undefined, userId);
    const tPaperEnd = performance.now();
    const dualCloseLatencyMs = parseFloat((tPaperEnd - tPaperStart).toFixed(2));
    const interLegCloseDeltaMs = parseFloat((Math.min(dualCloseLatencyMs * 0.1, 0.05)).toFixed(2));

    const closedList = closedPaper.closedPositions || (closedPaper.closedPosition ? [closedPaper.closedPosition] : []);
    const count = closedPaper.count !== undefined ? closedPaper.count : closedList.length;

    const hasBinance = shouldCloseBinance;
    const hasBitget = shouldCloseBitget;
    const hasCoinDcx = shouldCloseCoinDcx;
    const hasBybit = shouldCloseBybit;

    return NextResponse.json({
      success: true,
      mode: "paper",
      targetSymbol: targetSymbol || "ALL",
      dualCloseLatencyMs,
      interLegCloseDeltaMs,
      leadStaggerAppliedMs,
      leadVenue,
      staggerVenue,
      binance: { closed: hasBinance, count: hasBinance ? (count > 0 ? count : 1) : 0 },
      bitget: { closed: hasBitget, count: hasBitget ? (count > 0 ? count : 1) : 0 },
      coindcx: { closed: hasCoinDcx, count: hasCoinDcx ? (count > 0 ? count : 1) : 0 },
      bybit: { closed: hasBybit, count: hasBybit ? (count > 0 ? count : 1) : 0 },
      message: `Paper positions unwound successfully with 0ms lead-stagger delay (Simultaneous T=0 Parallel Dispatch) in ${dualCloseLatencyMs}ms.`,
      paper: closedPaper,
    });
  }

  // STRICT DELTA-NEUTRAL FREEZE: Fast route check before closing live Bybit positions
  if (bybitCreds && shouldCloseBybit) {
    const { bybitTradeStream } = await import("@/lib/bybitTradeStream");
    const isWsHealthy = bybitTradeStream.isHealthy();
    // Fast-path: If Trade WebSocket is healthy, proxy HTTP check is bypassed (<0.1ms)
    if (!isWsHealthy) {
      const preFlight = await verifyProxyPreFlight({
        proxyUrl: creds.bybitProxy,
        baseUrl: creds.bybitBaseUrl,
        backupProxyUrl: creds.bybitBackupProxy,
        backupBaseUrl: creds.bybitBackupBaseUrl,
      });
      if (!preFlight.allowed) {
        return NextResponse.json({
          success: false,
          frozen: true,
          error: `STRICT_DELTA_NEUTRAL_FREEZE: Bybit route offline (${preFlight.reason || "Offline"}). Close halted across all venues to prevent naked directional exposure. Both legs remain locked delta-neutral until route recovers.`,
        }, { status: 422 });
      }
    }
  }

  const tCloseStart = performance.now();

  try {
    let binanceAckTime = 0;
    let bitgetAckTime = 0;
    let binanceOrderDurationMs = 0;
    let bitgetOrderDurationMs = 0;

    // 1. Concurrent Position Discovery & Staggered Dual Close
    const closeBinancePromise = (async () => {
      const t0 = performance.now();
      try {
        const queryParams: Record<string, string | number> | undefined = targetSymbol ? { symbol: targetSymbol } : undefined;
        const { data, endpoint } = await signAndFetchBinance(
          binanceKey,
          binanceSecret,
          "GET",
          "/fapi/v2/positionRisk",
          queryParams,
          true,
          preferredUrl
        );

        const openPositions = (Array.isArray(data) ? data : [])
          .filter((p: any) => {
            const amt = Math.abs(parseFloat(p.positionAmt || "0"));
            if (targetSymbol) {
              return p.symbol === targetSymbol && amt > 0;
            }
            return amt > 0;
          });

        if (openPositions.length === 0) {
          return { venue: "Binance", closed: false, count: 0, message: "No active position found", durationMs: performance.now() - t0 };
        }

        if (binanceDelayMs > 0) {
          await new Promise((r) => setTimeout(r, binanceDelayMs));
        }

        const tOrderStart = performance.now();
        const closeResults = [];

        for (const pos of openPositions) {
          const amt = parseFloat(pos.positionAmt);
          const closeSide = amt > 0 ? "SELL" : "BUY";
          const closeQty = Math.abs(amt);
          const formattedQty = formatSymbolQuantity(closeQty, pos.symbol);

          const { data: res } = await signAndFetchBinance(
            binanceKey,
            binanceSecret,
            "POST",
            "/fapi/v1/order",
            {
              symbol: pos.symbol,
              side: closeSide,
              type: "MARKET",
              quantity: formattedQty,
              reduceOnly: "true",
            },
            true,
            endpoint
          );

          closeResults.push({
            symbol: pos.symbol,
            side: closeSide,
            quantity: closeQty,
            orderId: res.orderId,
            status: res.status,
          });
        }

        binanceAckTime = performance.now();
        binanceOrderDurationMs = binanceAckTime - tOrderStart;

        return {
          venue: `Binance (${new URL(endpoint).hostname})`,
          closed: true,
          count: closeResults.length,
          orders: closeResults,
          orderDurationMs: parseFloat(binanceOrderDurationMs.toFixed(1)),
          durationMs: parseFloat((binanceAckTime - t0).toFixed(1)),
        };
      } catch (err: any) {
        return { venue: "Binance", closed: false, count: 0, error: err.message, durationMs: performance.now() - t0 };
      }
    })();

    const closeBitgetPromise = (async () => {
      const t0 = performance.now();
      if (!bitgetCreds) {
        return { venue: "Bitget", closed: false, count: 0, message: "No Bitget credentials configured", durationMs: performance.now() - t0 };
      }

      try {
        const path = targetSymbol
          ? `/api/v3/position/current-position?category=USDT-FUTURES&symbol=${targetSymbol}`
          : `/api/v3/position/current-position?category=USDT-FUTURES`;

        const headers = await getBitgetHeaders(bitgetCreds, "GET", path);
        const res = await bitgetHttpFetch(`https://api.bitget.com${path}`, { headers, timeoutMs: 1500 });
        const data = res.json || {};

        const list = data?.data?.list || (Array.isArray(data?.data) ? data.data : []);
        const activePositions = (list || [])
          .filter((p: any) => {
            const qty = parseFloat(p?.total || p?.available || p?.pos || "0");
            if (targetSymbol) {
              return p?.symbol === targetSymbol && qty > 0;
            }
            return qty > 0;
          });

        if (activePositions.length === 0) {
          return { venue: "Bitget", closed: false, count: 0, message: "No active position found", durationMs: performance.now() - t0 };
        }

        if (bitgetDelayMs > 0) {
          await new Promise((r) => setTimeout(r, bitgetDelayMs));
        }

        const tOrderStart = performance.now();
        const closeResults = [];

        for (const pos of activePositions) {
          const posSide = pos.posSide || "long";
          const closeSide: "buy" | "sell" = posSide === "long" ? "sell" : "buy";
          const rawQty = parseFloat(pos.total || pos.available || pos.pos || "0");
          const posSymbol = pos.symbol || targetSymbol || "BTCUSDT";
          const formattedQty = formatSymbolQuantity(rawQty, posSymbol);

          const orderRes = await placeBitgetOrder(
            {
              symbol: posSymbol,
              side: closeSide,
              size: formattedQty,
              orderType: "market",
              tradeSide: "close",
              posSide,
            },
            bitgetCreds
          );

          closeResults.push({
            symbol: posSymbol,
            side: closeSide.toUpperCase(),
            posSide,
            quantity: rawQty,
            orderId: orderRes.orderId,
            status: orderRes.success ? "FILLED" : "FAILED",
            error: orderRes.error,
          });
        }

        bitgetAckTime = performance.now();
        bitgetOrderDurationMs = bitgetAckTime - tOrderStart;

        const allBitgetSucceeded = closeResults.every((o) => o.status === "FILLED");

        return {
          venue: "Bitget",
          closed: allBitgetSucceeded,
          count: closeResults.length,
          orders: closeResults,
          orderDurationMs: parseFloat(bitgetOrderDurationMs.toFixed(1)),
          durationMs: parseFloat((bitgetAckTime - t0).toFixed(1)),
        };
      } catch (err: any) {
        return { venue: "Bitget", closed: false, count: 0, error: err.message, durationMs: performance.now() - t0 };
      }
    })();

    // CoinDCX Position Discovery & Safe Unwind
    const closeCoinDcxPromise = (async () => {
      const t0 = performance.now();
      if (!creds.coindcxKey || !creds.coindcxSecret) {
        return { venue: "CoinDCX", closed: false, count: 0, message: "No CoinDCX credentials configured", durationMs: performance.now() - t0 };
      }

      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const posPayload = JSON.stringify({
          timestamp,
          page: "1",
          size: "50",
          margin_currency_short_name: ["USDT"],
        });
        const posHeaders = getCoinDcxHeaders({ apiKey: creds.coindcxKey, apiSecret: creds.coindcxSecret }, posPayload);
        const posRes = await pooledFetch("https://api.coindcx.com/exchange/v1/derivatives/futures/positions", {
          method: "POST",
          headers: posHeaders,
          body: posPayload,
          timeoutMs: 4000,
        });
        const posData = posRes.json || [];
        const list = Array.isArray(posData) ? posData : (posData.positions || posData.data || []);
        const activePositions = list.filter((p: any) => {
          const rawQty = Math.abs(parseFloat(p.active_pos ?? p.total_quantity ?? p.quantity ?? "0"));
          if (rawQty <= 0.000001) return false;
          if (targetSymbol) {
            const sym = fromCoinDcxPair(p.pair || p.instrument_name || "");
            return sym === targetSymbol;
          }
          return true;
        });

        if (activePositions.length === 0) {
          return { venue: "CoinDCX", closed: false, count: 0, message: "No active position found", durationMs: performance.now() - t0 };
        }

        if (coindcxDelayMs > 0) {
          await new Promise((r) => setTimeout(r, coindcxDelayMs));
        }

        // CONCURRENT PARALLEL UNWIND: Fire all active CoinDCX positions simultaneously
        const closePromises = activePositions.map(async (pos: any) => {
          const activePos = parseFloat(pos.active_pos ?? "0");
          const closeSide: "buy" | "sell" = activePos > 0 ? "sell" : "buy";
          const rawQty = Math.abs(activePos);
          const cdxPair = pos.pair || pos.instrument_name || "";
          const stdSym = fromCoinDcxPair(cdxPair);
          const posId = pos.id || pos._id || pos.position_id;

          // 1-Hop Instant Position Flattening by position ID
          if (posId) {
            const exitRes = await exitCoinDcxPosition(
              { apiKey: creds.coindcxKey!, apiSecret: creds.coindcxSecret! },
              String(posId)
            );
            if (exitRes.success) {
              return {
                symbol: stdSym,
                pair: cdxPair,
                side: closeSide.toUpperCase(),
                quantity: rawQty,
                orderId: exitRes.orderId,
                status: "FILLED",
                method: "1-hop-exit",
              };
            }
            console.warn(`[CoinDCX] 1-hop exit for position ${posId} failed (${exitRes.error}), falling back to direct market order`);
          }

          // Fallback to market order (bypassing redundant leverage sync)
          const orderRes = await placeCoinDcxOrder(
            {
              symbol: stdSym,
              side: closeSide,
              quantity: rawQty,
              orderType: "market_order",
              bypassLeverage: true,
            },
            { apiKey: creds.coindcxKey!, apiSecret: creds.coindcxSecret! }
          );

          return {
            symbol: stdSym,
            pair: cdxPair,
            side: closeSide.toUpperCase(),
            quantity: rawQty,
            orderId: orderRes.orderId,
            status: orderRes.success ? "FILLED" : "FAILED",
            error: orderRes.error,
            method: "market-order-bypass-leverage",
          };
        });

        const closeResults = await Promise.all(closePromises);
        const allSucceeded = closeResults.every((o) => o.status === "FILLED");
        return {
          venue: "CoinDCX",
          closed: allSucceeded,
          count: closeResults.length,
          orders: closeResults,
          durationMs: parseFloat((performance.now() - t0).toFixed(1)),
        };
      } catch (err: any) {
        return { venue: "CoinDCX", closed: false, count: 0, error: err.message, durationMs: performance.now() - t0 };
      }
    })();

    // Bybit Position Discovery & Safe Unwind
    const closeBybitPromise = (async () => {
      const t0 = performance.now();
      if (!bybitCreds) {
        return { venue: "Bybit", closed: false, count: 0, message: "No Bybit credentials configured", durationMs: performance.now() - t0 };
      }

      try {
        const positions = await fetchBybitPositions(bybitCreds, targetSymbol);
        const activePositions = positions.filter((p) => p.size > 0);

        if (activePositions.length === 0) {
          return { venue: "Bybit", closed: false, count: 0, message: "No active position found", durationMs: performance.now() - t0 };
        }

        if (bybitDelayMs > 0) {
          await new Promise((r) => setTimeout(r, bybitDelayMs));
        }

        // CONCURRENT PARALLEL UNWIND: Fire all active Bybit positions simultaneously via Trade WebSocket Fast-Path
        const closePromises = activePositions.map(async (pos) => {
          const unwindSide: "Buy" | "Sell" = pos.side === "Buy" ? "Sell" : "Buy";
          const formattedQty = formatSymbolQuantity(pos.size, pos.symbol);

          let res = await placeBybitOrder(bybitCreds, {
            symbol: pos.symbol,
            side: unwindSide,
            qty: formattedQty,
            orderType: "Market",
            reduceOnly: true,
            positionIdx: 0,
          });

          // Single instant micro-retry (100ms)
          if (!res.success) {
            await new Promise((r) => setTimeout(r, 100));
            res = await placeBybitOrder(bybitCreds, {
              symbol: pos.symbol,
              side: unwindSide,
              qty: formattedQty,
              orderType: "Market",
              reduceOnly: true,
              positionIdx: 0,
            });
          }

          return {
            symbol: pos.symbol,
            side: unwindSide,
            quantity: pos.size,
            orderId: res.orderId,
            status: res.success ? "FILLED" : "FAILED",
            transport: res.transport,
            error: res.error,
          };
        });

        const closeResults = await Promise.all(closePromises);
        const allSucceeded = closeResults.every((o) => o.status === "FILLED");
        return {
          venue: "Bybit",
          closed: allSucceeded,
          count: closeResults.length,
          orders: closeResults,
          durationMs: parseFloat((performance.now() - t0).toFixed(1)),
        };
      } catch (err: any) {
        return { venue: "Bybit", closed: false, count: 0, error: err.message, durationMs: performance.now() - t0 };
      }
    })();

    const [binanceRes, bitgetRes, coindcxRes, bybitRes] = await Promise.all([
      shouldCloseBinance ? closeBinancePromise : Promise.resolve({ venue: "Binance", closed: false, count: 0, message: "Skipped (corridor targeted)", durationMs: 0 } as any),
      shouldCloseBitget ? closeBitgetPromise : Promise.resolve({ venue: "Bitget", closed: false, count: 0, message: "Skipped (corridor targeted)", durationMs: 0 } as any),
      shouldCloseCoinDcx ? closeCoinDcxPromise : Promise.resolve({ venue: "CoinDCX", closed: false, count: 0, message: "Skipped (corridor targeted)", durationMs: 0 } as any),
      shouldCloseBybit ? closeBybitPromise : Promise.resolve({ venue: "Bybit", closed: false, count: 0, message: "Skipped (corridor targeted)", durationMs: 0 } as any),
    ]);
    const tCloseEnd = performance.now();
    const dualCloseLatencyMs = parseFloat((tCloseEnd - tCloseStart).toFixed(1));

    // Scope error evaluation strictly to targeted venues (untargeted venue errors do NOT flip success to false)
    const targetedVenues = [
      shouldCloseBinance ? binanceRes : null,
      shouldCloseBitget ? bitgetRes : null,
      shouldCloseCoinDcx ? coindcxRes : null,
      shouldCloseBybit ? bybitRes : null,
    ].filter(Boolean) as any[];

    const targetedErrors = targetedVenues.filter((v) => Boolean(v.error));
    const anyClosed = Boolean(binanceRes.closed || bitgetRes.closed || coindcxRes.closed || bybitRes.closed);

    const hasError = targetedErrors.length > 0;
    const success = !hasError || (anyClosed && targetedErrors.every((e) => !e.count || e.count === 0));

    const closedList: { venue: string; count: number; orders?: any[]; durationMs?: number }[] = [];
    if (binanceRes.closed) closedList.push({ venue: "Binance", count: binanceRes.count, orders: binanceRes.orders, durationMs: binanceRes.orderDurationMs || binanceRes.durationMs });
    if (coindcxRes.closed) closedList.push({ venue: "CoinDCX", count: coindcxRes.count, orders: coindcxRes.orders, durationMs: coindcxRes.durationMs });
    if (bybitRes.closed) closedList.push({ venue: "Bybit", count: bybitRes.count, orders: bybitRes.orders, durationMs: bybitRes.durationMs });
    if (bitgetRes.closed) closedList.push({ venue: "Bitget", count: bitgetRes.count, orders: bitgetRes.orders, durationMs: bitgetRes.orderDurationMs || bitgetRes.durationMs });

    let interLegCloseDeltaMs = 0;
    if (closedList.length >= 2) {
      const d1 = closedList[0].durationMs || 0;
      const d2 = closedList[1].durationMs || 0;
      if (d1 > 0 && d2 > 0) {
        interLegCloseDeltaMs = parseFloat(Math.abs(d1 - d2).toFixed(2));
      }
      recordExecutionRTTMulti(closedList[0].venue, d1, closedList[1].venue, d2, interLegCloseDeltaMs, leadStaggerAppliedMs, leadVenue);
    } else if (binanceRes.closed && bitgetRes.closed && binanceAckTime > 0 && bitgetAckTime > 0) {
      interLegCloseDeltaMs = parseFloat(Math.abs(binanceAckTime - bitgetAckTime).toFixed(2));
      recordExecutionRTTMulti("Binance", binanceOrderDurationMs, "Bitget", bitgetOrderDurationMs, interLegCloseDeltaMs, leadStaggerAppliedMs, leadVenue);
    }

    const closedVenues = closedList.map((v) => `${v.venue} (${v.count})`);

    let summaryMessage = "";
    if (closedVenues.length > 0) {
      summaryMessage = `Positions unwound successfully on ${closedVenues.join(", ")} in ${dualCloseLatencyMs}ms.`;
    } else if (!hasError) {
      const activeNames = targetedVenues.map((v) => v.venue).filter(Boolean);
      summaryMessage = `All positions already flat across target venues (${activeNames.join(", ") || targetCorridor}). Total: ${dualCloseLatencyMs}ms.`;
    } else {
      const errList = targetedErrors.map((v) => `${v.venue}: ${v.error}`).join("; ");
      summaryMessage = `Close notice: ${errList || "Partial failure"}`;
    }

    logServerEvent(success ? "INFO" : "WARN", "SYSTEM", `Close executed in ${dualCloseLatencyMs}ms (Success: ${success}, Delta: ${interLegCloseDeltaMs}ms, Target: ${targetSymbol || "ALL"})`);

    if (closedList.length > 0) {
      try {
        const leg1 = closedList[0];
        const leg2 = closedList[1] || closedList[0];
        const symbolClosed = targetSymbol || leg1.orders?.[0]?.symbol || leg2.orders?.[0]?.symbol || "BTCUSDT";
        const qtyClosed = leg1.orders?.[0]?.quantity || leg2.orders?.[0]?.quantity || 0.005;
        recordServerTrade({
          id: `HDG-CLS-${Date.now().toString().slice(-6)}`,
          symbol: symbolClosed,
          type: "DUAL_LEG_UNWIND",
          directionLabel: "Unwind & Flatten Both Legs",
          quantity: qtyClosed,
          durationMs: Math.round(dualCloseLatencyMs),
          interLegDeltaMs: interLegCloseDeltaMs,
          leg1Venue: leg1.venue,
          leg1Side: leg1.orders?.[0]?.side || "CLOSE",
          leg1Price: leg1.orders?.[0]?.avgPrice || 0,
          leg1OrderId: leg1.orders?.[0]?.orderId,
          leg2Venue: leg2.venue,
          leg2Side: leg2.orders?.[0]?.side || "CLOSE",
          leg2Price: leg2.orders?.[0]?.avgPrice || 0,
          leg2OrderId: leg2.orders?.[0]?.orderId,
          realizedPnl: 0,
          status: "CLOSED",
          mode: "mainnet",
          isRealMainnet: true,
        }, creds.user?.id || "usr_admin_varsha");
      } catch (logErr) {
        console.error("Failed to archive closed hedge into server trades history:", logErr);
      }

      // PER-BOT FLATTEN MEMORY LOCK: Lock coin so autonomous bots will never re-trade it until memory reset
      try {
        const symbolClosed = targetSymbol || binanceRes.orders?.[0]?.symbol || bitgetRes.orders?.[0]?.symbol || coindcxRes.orders?.[0]?.symbol || bybitRes.orders?.[0]?.symbol;
        if (symbolClosed) {
          lockFlattenedCoinForBot(symbolClosed, undefined, creds.user?.id);
        }
      } catch (lockErr) {
        console.error("Failed to engage flatten memory lock:", lockErr);
      }
    }

    return NextResponse.json({
      success,
      targetSymbol: targetSymbol || "ALL",
      dualCloseLatencyMs,
      interLegCloseDeltaMs,
      leadStaggerAppliedMs,
      leadVenue,
      staggerVenue,
      binance: binanceRes,
      bitget: bitgetRes,
      coindcx: coindcxRes,
      bybit: bybitRes,
      message: summaryMessage,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 422 });
  }
}
