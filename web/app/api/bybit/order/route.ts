import { NextRequest, NextResponse } from "next/server";
import { placeBybitOrder, cancelBybitOrder, BybitCredentials } from "@/lib/bybitSigner";
import { resolveCallerCredentials } from "@/lib/authHelper";
import { getUserActiveConsents, getUserConsentHistory } from "@/lib/complianceStore";
import { RiskGate } from "@/lib/riskGate";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const credsResolved = resolveCallerCredentials(req);
    if (!credsResolved.authorized) {
      return NextResponse.json(
        { error: "Unauthorized", code: "AUTH_REQUIRED", success: false },
        { status: 401 }
      );
    }

    // DPDP Act 2023 Statutory Consent Gate
    if (credsResolved.user?.email) {
      const activeConsents = getUserActiveConsents(credsResolved.user.email);
      const isConsentRevoked = !credsResolved.isAdmin
        ? !activeConsents.PURPOSE_EXCHANGE_DISPATCH
        : activeConsents.PURPOSE_EXCHANGE_DISPATCH === false &&
          getUserConsentHistory(credsResolved.user.email).some(
            (c) => c.purpose === "PURPOSE_EXCHANGE_DISPATCH" && c.status === "WITHDRAWN"
          );

      if (isConsentRevoked) {
        return NextResponse.json(
          {
            success: false,
            error: "Statutory Consent Denied: Under Section 6 of the DPDP Act 2023, dispatching orders to Bybit requires explicit consent for PURPOSE_EXCHANGE_DISPATCH.",
            complianceCode: "DPDP_CONSENT_REQUIRED",
          },
          { status: 403 }
        );
      }
    }

    const apiKey = credsResolved.bybitKey;
    const apiSecret = credsResolved.bybitSecret;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { success: false, error: "Missing Bybit API credentials. Please configure keys in settings." },
        { status: 401 }
      );
    }

    const creds: BybitCredentials = {
      apiKey,
      apiSecret,
      proxyUrl: credsResolved.bybitProxy,
      baseUrl: credsResolved.bybitBaseUrl,
    };
    const body = await req.json();

    // Cancellation support
    if (body.action === "cancel") {
      const cancelRes = await cancelBybitOrder(creds, body.symbol, body.orderId, body.orderLinkId);
      return NextResponse.json(cancelRes);
    }

    const {
      symbol = "BTCUSDT",
      side = "Buy",
      quantity = 0.001,
      orderType = "Market",
      price,
      positionIdx = 0,
      reduceOnly = false,
      orderLinkId = body.clientOrderId,
    } = body;

    const formattedSide: "Buy" | "Sell" =
      side.toUpperCase() === "BUY" ? "Buy" : "Sell";

    // Pre-Broker Risk Gate Interception (Track A-04, A-05)
    const numericQty = typeof quantity === "string" ? parseFloat(quantity) : quantity;
    const notionalUsdt = body.notionalUsdt
      ? parseFloat(body.notionalUsdt)
      : numericQty * (price ? parseFloat(price.toString()) : 100);

    const riskCheck = RiskGate.validatePreOrder({
      userId: credsResolved.user?.id,
      symbol: symbol.toUpperCase(),
      side: formattedSide,
      quantity: numericQty,
      price: price ? parseFloat(price.toString()) : undefined,
      notionalUsdt,
      venue: "bybit",
      clientOrderId: orderLinkId,
      isEmergencyClose: Boolean(body.isEmergencyClose || reduceOnly),
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

    const orderResult = await placeBybitOrder(creds, {
      symbol: symbol.toUpperCase(),
      side: formattedSide,
      qty: quantity,
      orderType: orderType === "Limit" ? "Limit" : "Market",
      price,
      positionIdx: positionIdx !== undefined ? positionIdx : 0,
      reduceOnly,
      orderLinkId,
      clientOrderId: orderLinkId,
    });

    return NextResponse.json(orderResult);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to process Bybit order" },
      { status: 500 }
    );
  }
}
