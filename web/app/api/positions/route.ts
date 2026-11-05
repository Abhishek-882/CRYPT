import { NextRequest, NextResponse } from "next/server";
import { signAndFetchBinance } from "@/lib/binanceSigner";
import { getBitgetAccount, BitgetCredentials } from "@/lib/bitgetSigner";
import { getCoinDcxAccount } from "@/lib/coindcxSigner";
import { fetchBybitPositions } from "@/lib/bybitSigner";
import { resolveCallerCredentials } from "@/lib/authHelper";
import { loadPaperPositions } from "@/lib/paperTradingEngine";

export const dynamic = "force-dynamic";

const noCacheHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

export async function GET(req: NextRequest) {
  const creds = resolveCallerCredentials(req);
  if (!creds.authorized) {
    return NextResponse.json(
      { success: false, error: "Authentication required to view open positions." },
      { status: 401, headers: noCacheHeaders }
    );
  }

  const tradingMode = (
    req.headers.get("x-trading-mode") ||
    req.nextUrl.searchParams.get("mode") ||
    "live"
  ).toLowerCase();

  // Paper Mode Positions
  if (tradingMode === "paper") {
    const userId = creds.user?.id || (creds.isAdmin ? "usr_admin_varsha" : "global_default");
    const paperPositions = loadPaperPositions(userId, "OPEN");
    const formatted = paperPositions.map((p) => ({
      venue: "Paper",
      symbol: p.symbol,
      pair: p.symbol,
      amount: p.quantity,
      size: p.quantity,
      entryPrice: p.leg1?.entryPrice || 0,
      markPrice: p.leg1?.currentPrice || p.leg1?.entryPrice || 0,
      unrealizedPnl: p.netUnrealizedPnl || 0,
      leverage: p.leverage,
      side: p.leg1?.side || "BUY",
      status: p.status,
      rawPaper: p,
    }));
    return NextResponse.json(
      {
        success: true,
        count: formatted.length,
        positions: formatted,
        mode: "paper",
      },
      { headers: noCacheHeaders }
    );
  }

  const binanceKey = creds.binanceKey;
  const binanceSecret = creds.binanceSecret;
  const binanceEndpoint = creds.binanceEndpoint || undefined;

  const bitgetKey = creds.bitgetKey;
  const bitgetSecret = creds.bitgetSecret;
  const bitgetPassphrase = creds.bitgetPassphrase;
  const bitgetEnv = creds.bitgetEnv || "demo";

  let binancePositions: any[] = [];
  let bitgetPositions: any[] = [];
  let coindcxPositions: any[] = [];
  let bybitPositions: any[] = [];

  // Concurrent Position Discovery across all 4 venues
  const tasks: Promise<any>[] = [];

  // 1. Binance
  if (binanceKey && binanceSecret) {
    tasks.push(
      (async () => {
        try {
          const { data } = await signAndFetchBinance(
            binanceKey,
            binanceSecret,
            "GET",
            "/fapi/v2/positionRisk",
            {},
            true,
            binanceEndpoint
          );
          binancePositions = (Array.isArray(data) ? data : [])
            .filter((p: any) => parseFloat(p.positionAmt || "0") !== 0)
            .map((p: any) => ({
              venue: "Binance",
              symbol: p.symbol,
              amount: parseFloat(p.positionAmt),
              entryPrice: parseFloat(p.entryPrice),
              markPrice: parseFloat(p.markPrice),
              unrealizedPnl: parseFloat(p.unRealizedProfit || p.unrealizedProfit || "0"),
              liquidationPrice: parseFloat(p.liquidationPrice || "0"),
              leverage: parseInt(p.leverage, 10),
            }));
        } catch (err: any) {
          console.error("Error fetching Binance positions:", err.message);
        }
      })()
    );
  }

  // 2. Bitget
  if (bitgetKey && bitgetSecret && bitgetPassphrase) {
    tasks.push(
      (async () => {
        try {
          const bCreds: BitgetCredentials = {
            apiKey: bitgetKey,
            apiSecret: bitgetSecret,
            passphrase: bitgetPassphrase,
            isDemo: bitgetEnv === "demo",
          };
          const bitgetAcc = await getBitgetAccount(bCreds);
          if (bitgetAcc.success && Array.isArray(bitgetAcc.positions)) {
            bitgetPositions = bitgetAcc.positions.map((p: any) => ({
              ...p,
              venue: "Bitget",
            }));
          }
        } catch (err: any) {
          console.error("Error fetching Bitget positions:", err.message);
        }
      })()
    );
  }

  // 3. CoinDCX
  if (creds.coindcxKey && creds.coindcxSecret) {
    tasks.push(
      (async () => {
        try {
          const cdxAcc = await getCoinDcxAccount({
            apiKey: creds.coindcxKey,
            apiSecret: creds.coindcxSecret,
          });
          if (cdxAcc.success && Array.isArray(cdxAcc.positions)) {
            coindcxPositions = cdxAcc.positions.map((p: any) => ({
              ...p,
              venue: "CoinDCX",
            }));
          }
        } catch (err: any) {
          console.error("Error fetching CoinDCX positions:", err.message);
        }
      })()
    );
  }

  // 4. Bybit (with fast 2500ms safety timeout)
  if (creds.bybitKey && creds.bybitSecret) {
    tasks.push(
      (async () => {
        try {
          const timeoutPromise = new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error("Bybit positions request timeout (2.5s)")), 2500)
          );
          const fetchPromise = fetchBybitPositions({
            apiKey: creds.bybitKey,
            apiSecret: creds.bybitSecret,
            proxyUrl: creds.bybitProxy,
            baseUrl: creds.bybitBaseUrl,
            backupProxyUrl: creds.bybitBackupProxy,
            backupBaseUrl: creds.bybitBackupBaseUrl,
          });

          const bybitPositionsRaw = await Promise.race([fetchPromise, timeoutPromise]);
          bybitPositions = (bybitPositionsRaw || []).map((p) => ({
            venue: "Bybit",
            symbol: p.symbol,
            amount: p.side === "Sell" ? -Math.abs(p.size) : Math.abs(p.size),
            entryPrice: p.entryPrice,
            markPrice: p.markPrice,
            unrealizedPnl: p.unrealisedPnl,
            liquidationPrice: p.liquidationPrice || 0,
            leverage: p.leverage,
          }));
        } catch (err: any) {
          console.error("Error fetching Bybit positions:", err.message);
        }
      })()
    );
  }

  await Promise.allSettled(tasks);

  const positions = [...binancePositions, ...bitgetPositions, ...coindcxPositions, ...bybitPositions];

  return NextResponse.json(
    {
      success: true,
      count: positions.length,
      positions,
    },
    { headers: noCacheHeaders }
  );
}
