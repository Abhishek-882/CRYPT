import { NextRequest, NextResponse } from "next/server";
import { signAndFetchBinance } from "@/lib/binanceSigner";
import { logServerEvent } from "@/lib/logger";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const creds = resolveCallerCredentials(req);

  const noCacheHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
  };

  if (!creds.binanceKey || !creds.binanceSecret) {
    const errorMsg = creds.user && !creds.isAdmin
      ? "Personal Binance API key required. Non-admin accounts must configure their own API keys in Profile or Vault settings."
      : "Missing Binance API credentials. Please sign in or configure API keys.";

    logServerEvent("WARN", "BINANCE", errorMsg);
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        requiresKeys: true,
        isAdmin: creds.isAdmin,
      },
      { status: 401, headers: noCacheHeaders }
    );
  }

  const apiKey = creds.binanceKey;
  const apiSecret = creds.binanceSecret;
  const preferredUrl = creds.binanceEndpoint;
  const keyMask = apiKey.length >= 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "INVALID";

  try {
    const { data, endpoint } = await signAndFetchBinance(
      apiKey,
      apiSecret,
      "GET",
      "/fapi/v2/account",
      {},
      true,
      preferredUrl
    );

    const totalWalletBalance = parseFloat(data.totalWalletBalance || "0");
    const availableBalance = parseFloat(data.availableBalance || "0");
    const totalUnrealizedProfit = parseFloat(data.totalUnrealizedProfit || "0");

    let refMarkPrice = 0;
    try {
      const { data: prem } = await signAndFetchBinance(
        apiKey,
        apiSecret,
        "GET",
        "/fapi/v1/premiumIndex",
        { symbol: "BTCUSDT" },
        false,
        endpoint
      );
      refMarkPrice = parseFloat(prem?.markPrice || "0");
    } catch {
      // non-fatal fallback
    }

    const positions = (data.positions || [])
      .filter((p: any) => parseFloat(p.positionAmt || "0") !== 0)
      .map((p: any) => {
        const amt = parseFloat(p.positionAmt);
        const entryPrice = parseFloat(p.entryPrice);
        const unrealizedPnl = parseFloat(p.unrealizedProfit);
        const rawMark = parseFloat(p.markPrice || "0");
        const derivedMark = (amt !== 0 && entryPrice > 0) ? entryPrice + (unrealizedPnl / amt) : 0;
        const markPrice = rawMark > 0
          ? rawMark
          : (derivedMark > 0 ? derivedMark : (p.symbol === "BTCUSDT" ? refMarkPrice : entryPrice));
        return {
          venue: "Binance",
          symbol: p.symbol,
          amount: amt,
          entryPrice,
          markPrice: parseFloat(markPrice.toFixed(2)),
          unrealizedPnl,
          leverage: parseInt(p.leverage, 10),
        };
      });

    logServerEvent("INFO", "BINANCE", `Account synced [${keyMask}] on ${endpoint}. Balance: $${totalWalletBalance}`);

    return NextResponse.json(
      {
        success: true,
        endpoint,
        totalWalletBalance,
        availableBalance,
        totalUnrealizedProfit,
        positionsCount: positions.length,
        positions,
        keyMask,
        isCustomKey: !creds.isAdmin,
        isAdmin: creds.isAdmin,
      },
      { headers: noCacheHeaders }
    );
  } catch (err: any) {
    const isRestrictedOrStandby =
      err.message?.includes("restricted location") ||
      err.message?.includes("451") ||
      err.message?.includes("403") ||
      err.message?.includes("-2015") ||
      err.message?.includes("-1022") ||
      err.message?.includes("ETIMEDOUT") ||
      err.message?.includes("ECONNRESET");

    if (isRestrictedOrStandby) {
      logServerEvent("WARN", "BINANCE", `Binance in standby for [${keyMask}] (${preferredUrl || "auto"}): ${err.message}`);
      return NextResponse.json(
        {
          success: true,
          endpoint: preferredUrl || "https://fapi.binance.com",
          totalWalletBalance: 0,
          availableBalance: 0,
          totalUnrealizedProfit: 0,
          positionsCount: 0,
          positions: [],
          keyMask,
          isStandby: true,
          statusNotice: "Binance Standby (US Host Restricted - CoinDCX ⇄ Bitget Active)",
          isCustomKey: !creds.isAdmin,
          isAdmin: creds.isAdmin,
        },
        { headers: noCacheHeaders }
      );
    }

    logServerEvent("ERROR", "BINANCE", `Authentication failed for [${keyMask}] (${preferredUrl || "auto"}): ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message, keyMask, isCustomKey: !creds.isAdmin, isAdmin: creds.isAdmin },
      { status: 500, headers: noCacheHeaders }
    );
  }
}
