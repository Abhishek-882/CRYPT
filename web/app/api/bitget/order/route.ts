import { NextRequest, NextResponse } from "next/server";
import { placeBitgetOrder } from "@/lib/bitgetSigner";
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
            error: "Statutory Consent Denied: Under Section 6 of the DPDP Act 2023, dispatching orders to Bitget requires explicit consent for PURPOSE_EXCHANGE_DISPATCH.",
            complianceCode: "DPDP_CONSENT_REQUIRED",
          },
          { status: 403 }
        );
      }
    }

    const apiKey = credsResolved.bitgetKey;
    const apiSecret = credsResolved.bitgetSecret;
    const passphrase = credsResolved.bitgetPassphrase;
    const isDemo = credsResolved.bitgetEnv === "demo";

    const body = await req.json();
    const {
      symbol = "BTCUSDT",
      side = "buy",
      size = "0.005",
      orderType = "market",
      tradeSide = "open",
      clientOid = body.clientOrderId,
    } = body;

    // Pre-Broker Risk Gate Interception (Track A-04, A-05)
    const notionalUsdt = body.notionalUsdt
      ? parseFloat(body.notionalUsdt)
      : parseFloat(size.toString()) * (body.price ? parseFloat(body.price) : 100);

    const riskCheck = RiskGate.validatePreOrder({
      userId: credsResolved.user?.id,
      symbol,
      side: side as any,
      quantity: size.toString(),
      price: body.price ? parseFloat(body.price) : undefined,
      notionalUsdt,
      venue: "bitget",
      clientOrderId: clientOid,
      isEmergencyClose: Boolean(body.isEmergencyClose || body.reduceOnly || tradeSide === "close"),
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

    const creds = apiKey && apiSecret && passphrase
      ? { apiKey, apiSecret, passphrase, isDemo }
      : undefined;

    const receipt = await placeBitgetOrder(
      {
        symbol,
        side,
        size: size.toString(),
        orderType,
        tradeSide,
        clientOid,
      },
      creds
    );

    return NextResponse.json(receipt);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to place Bitget order" },
      { status: 500 }
    );
  }
}
