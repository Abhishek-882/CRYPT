import { NextRequest, NextResponse } from "next/server";
import { placeCoinDcxOrder, cancelCoinDcxOrder } from "@/lib/coindcxSigner";
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
        : activeConsents.PURPOSE_EXCHANGE_DISPATCH === false && getUserConsentHistory(credsResolved.user.email).some((c) => c.purpose === "PURPOSE_EXCHANGE_DISPATCH" && c.status === "WITHDRAWN");

      if (isConsentRevoked) {
        return NextResponse.json(
          {
            success: false,
            error: "Statutory Consent Denied: Under Section 6 of the DPDP Act 2023, dispatching orders to CoinDCX requires explicit consent for PURPOSE_EXCHANGE_DISPATCH.",
            complianceCode: "DPDP_CONSENT_REQUIRED",
          },
          { status: 403 }
        );
      }
    }

    const apiKey = credsResolved.coindcxKey;
    const apiSecret = credsResolved.coindcxSecret;

    const body = await req.json();

    // Cancellation support
    if (body.action === "cancel" && body.orderId) {
      const creds = apiKey && apiSecret ? { apiKey, apiSecret } : undefined;
      const cancelRes = await cancelCoinDcxOrder(body.orderId, creds);
      return NextResponse.json(cancelRes);
    }

    const {
      symbol = "BTCUSDT",
      side = "buy",
      quantity = 0.001,
      orderType = "market_order",
      price,
      leverage = 10,
    } = body;

    const numQty = typeof quantity === "string" ? parseFloat(quantity) : quantity;
    const numPrice = price ? (typeof price === "string" ? parseFloat(price) : price) : undefined;
    const notionalUsdt = body.notionalUsdt
      ? parseFloat(body.notionalUsdt)
      : numQty * (numPrice || 100);

    const clientOrderId = body.clientOrderId || crypto.randomUUID();

    const riskCheck = RiskGate.validatePreOrder({
      userId: credsResolved.user?.id,
      symbol: symbol.toUpperCase(),
      side: side as any,
      quantity: numQty,
      price: numPrice,
      notionalUsdt,
      venue: "coindcx",
      clientOrderId,
      isEmergencyClose: Boolean(body.isEmergencyClose || body.reduceOnly),
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

    const creds = apiKey && apiSecret
      ? { apiKey, apiSecret }
      : undefined;

    const receipt = await placeCoinDcxOrder(
      {
        symbol,
        side,
        quantity: typeof quantity === "string" ? parseFloat(quantity) : quantity,
        orderType,
        price,
        leverage,
      },
      creds
    );

    return NextResponse.json(receipt);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to place CoinDCX order" },
      { status: 500 }
    );
  }
}
