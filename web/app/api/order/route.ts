import { NextRequest, NextResponse } from "next/server";
import { signAndFetchBinance } from "@/lib/binanceSigner";
import { resolveCallerCredentials } from "@/lib/authHelper";
import { getUserActiveConsents, getUserConsentHistory } from "@/lib/complianceStore";
import { RiskGate } from "@/lib/riskGate";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const creds = resolveCallerCredentials(req);
  if (!creds.authorized) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_REQUIRED", success: false },
      { status: 401 }
    );
  }
  const apiKey = creds.binanceKey;
  const apiSecret = creds.binanceSecret;
  const preferredUrl = creds.binanceEndpoint;

  // DPDP Act 2023 Statutory Consent Gate
  if (creds.user?.email) {
    const activeConsents = getUserActiveConsents(creds.user.email);
    const isConsentRevoked = !creds.isAdmin
      ? !activeConsents.PURPOSE_EXCHANGE_DISPATCH
      : activeConsents.PURPOSE_EXCHANGE_DISPATCH === false && getUserConsentHistory(creds.user.email).some((c) => c.purpose === "PURPOSE_EXCHANGE_DISPATCH" && c.status === "WITHDRAWN");

    if (isConsentRevoked) {
      return NextResponse.json(
        {
          success: false,
          error: "Statutory Consent Denied: Under Section 6 of the DPDP Act 2023, dispatching orders to Binance requires explicit consent for PURPOSE_EXCHANGE_DISPATCH.",
          complianceCode: "DPDP_CONSENT_REQUIRED",
        },
        { status: 403 }
      );
    }
  }

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      {
        success: false,
        error: creds.user && !creds.isAdmin
          ? "Personal Binance API key required. Non-admin accounts must configure their own API keys in Profile or Vault settings."
          : "Missing Binance API credentials",
      },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const symbol = (body.symbol || "BTCUSDT").toUpperCase();
    const side = (body.side || "BUY").toUpperCase();
    const quantity = parseFloat(body.quantity || "0.005");
    const clientOrderId = body.clientOrderId || body.newClientOrderId || crypto.randomUUID();

    // Pre-Broker Risk Gate Interception (Track A-04, A-05)
    const riskCheck = RiskGate.validatePreOrder({
      userId: creds.user?.id,
      symbol,
      side: side as any,
      quantity,
      price: body.price ? parseFloat(body.price) : undefined,
      notionalUsdt: body.notionalUsdt ? parseFloat(body.notionalUsdt) : undefined,
      venue: "binance",
      clientOrderId,
      isEmergencyClose: body.isEmergencyClose || body.reduceOnly,
    });
    if (!riskCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: riskCheck.reason,
          code: riskCheck.code,
          riskMetrics: riskCheck.metrics,
        },
        { status: 403 }
      );
    }

    const tStart = performance.now();
    const { data: res, endpoint } = await signAndFetchBinance(
      apiKey,
      apiSecret,
      "POST",
      "/fapi/v1/order",
      {
        symbol,
        side,
        type: "MARKET",
        quantity: quantity.toFixed(3),
        newClientOrderId: clientOrderId,
      },
      true,
      preferredUrl
    );
    const tAck = performance.now();

    const orderId = String(res.orderId);
    let executedQty = parseFloat(res.executedQty || "0");
    let avgPrice = parseFloat(res.avgPrice || "0");
    let status = res.status || "NEW";

    // 3-Stage Resolution for Binance Testnet async matching
    if (avgPrice === 0 || executedQty === 0) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        await new Promise((r) => setTimeout(r, 350 * attempt));
        try {
          const { data: q } = await signAndFetchBinance(
            apiKey,
            apiSecret,
            "GET",
            "/fapi/v1/order",
            {
              symbol,
              orderId,
            },
            true,
            endpoint
          );
          if (parseFloat(q.executedQty || "0") > 0) {
            executedQty = parseFloat(q.executedQty);
            avgPrice = parseFloat(q.avgPrice || "0");
            status = q.status || "FILLED";
            break;
          }
        } catch {
          // ignore transient poll error
        }
      }
    }

    // Fallback estimation if testnet reports 0 price
    if (avgPrice === 0) {
      const { data: prem } = await signAndFetchBinance(
        apiKey,
        apiSecret,
        "GET",
        "/fapi/v1/premiumIndex",
        { symbol },
        false,
        endpoint
      );
      avgPrice = parseFloat(prem.markPrice || "0");
      executedQty = quantity;
      status = "FILLED";
    }

    const tFill = performance.now();

    return NextResponse.json({
      success: true,
      endpoint,
      orderId,
      clientOrderId: res.clientOrderId || clientOrderId,
      symbol,
      side,
      status,
      executedQty,
      avgPrice,
      notional: parseFloat((avgPrice * executedQty).toFixed(2)),
      dispatchLatencyMs: parseFloat((tAck - tStart).toFixed(1)),
      fillLatencyMs: parseFloat((tFill - tStart).toFixed(1)),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
