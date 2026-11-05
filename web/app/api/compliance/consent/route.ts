import { NextRequest, NextResponse } from "next/server";
import {
  recordConsent,
  recordBatchConsents,
  getUserActiveConsents,
  getUserConsentHistory,
  DPDP_NOTICE_VERSION,
  ConsentPurpose,
} from "@/lib/complianceStore";
import { findUserByEmail, findUserById, getAuthenticatedUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  const searchParams = req.nextUrl.searchParams;
  const emailParam = searchParams.get("email");

  if (!user) {
    return NextResponse.json({
      success: true,
      noticeVersion: DPDP_NOTICE_VERSION,
      activeConsents: {
        PURPOSE_AUTH_AND_EXECUTION: false,
        PURPOSE_EXCHANGE_DISPATCH: false,
        PURPOSE_DIAGNOSTICS_TELEMETRY: false,
        PURPOSE_MARKET_CACHE: false,
      },
      history: [],
      consentHistory: [],
    });
  }

  // IDOR Protection: Non-admins may only view their own consent history
  const targetEmail = (user.role === "admin" && emailParam) ? emailParam.trim().toLowerCase() : user.email;

  const activeConsents = getUserActiveConsents(targetEmail);
  const history = getUserConsentHistory(targetEmail);

  return NextResponse.json({
    success: true,
    noticeVersion: DPDP_NOTICE_VERSION,
    userEmail: targetEmail,
    activeConsents,
    history,
    consentHistory: history,
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Authentication required to modify statutory consent preferences." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    // Secure identity binding: Always use the verified session email
    const email = user.email;

    const ipAddress = getClientIp(req);
    const userAgent = req.headers.get("user-agent") || "Browser Client";

    // Batch update
    if (Array.isArray(body.consents)) {
      const records = recordBatchConsents(email, body.consents, {
        userId: user?.id,
        ipAddress,
        userAgent,
      });

      return NextResponse.json({
        success: true,
        message: "Consent decisions recorded in compliance audit log.",
        records,
        activeConsents: getUserActiveConsents(email),
      });
    }

    // Single purpose update
    const { purpose, status } = body;
    if (!purpose || !status || (status !== "GRANTED" && status !== "WITHDRAWN")) {
      return NextResponse.json(
        { success: false, error: "Invalid purpose or status ('GRANTED' or 'WITHDRAWN' required)" },
        { status: 400 }
      );
    }

    const record = recordConsent(email, purpose as ConsentPurpose, status, {
      userId: user?.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      message: `Consent for ${purpose} set to ${status}.`,
      record,
      activeConsents: getUserActiveConsents(email),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
