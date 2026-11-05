import { NextRequest, NextResponse } from "next/server";
import {
  createDataRightsRequest,
  getUserDataRightsRequests,
  exportUserDataSummary,
  GRIEVANCE_OFFICER_INFO,
  DataRightType,
} from "@/lib/complianceStore";
import { findUserByEmail, findUserById, verifySessionToken } from "@/lib/userStore";

export const dynamic = "force-dynamic";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

function getSessionUser(req: NextRequest) {
  const cookieHeader = req.headers.get("cookie") || "";
  const authCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("auth_session="));

  if (authCookie) {
    const rawVal = decodeURIComponent(authCookie.replace("auth_session=", "").trim());
    if (rawVal) {
      const verifiedUserId = verifySessionToken(rawVal);
      if (verifiedUserId) {
        return findUserById(verifiedUserId) || null;
      }
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  const user = getSessionUser(req);
  if (!user) {
    return NextResponse.json({
      success: false,
      error: "Authentication required to view or export personal data records under DPDP Act.",
    }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const emailParam = searchParams.get("email");

  // Prevent IDOR: Standard users may only view their own data
  if (emailParam && emailParam.toLowerCase() !== user.email.toLowerCase() && user.role !== "admin") {
    return NextResponse.json({
      success: false,
      error: "Access denied: You may only view or export your own personal data records.",
    }, { status: 403 });
  }

  const targetEmail = user.role === "admin" && emailParam ? emailParam.toLowerCase() : user.email;
  const summary = exportUserDataSummary(targetEmail);
  const requests = getUserDataRightsRequests(targetEmail);

  return NextResponse.json({
    success: true,
    userEmail: targetEmail,
    export: summary,
    exportPackage: summary,
    requests,
    grievanceOfficer: GRIEVANCE_OFFICER_INFO,
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Authentication required to submit data rights request under DPDP Act." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = user.email.toLowerCase().trim();

    const { requestType, details, nomineeName, nomineeContact } = body;
    const validTypes: DataRightType[] = [
      "ACCESS_SUMMARY",
      "CORRECTION",
      "ERASURE",
      "WITHDRAW_ALL_CONSENT",
      "NOMINATION",
      "GRIEVANCE",
    ];

    if (!requestType || !validTypes.includes(requestType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid requestType. Allowed values: ${validTypes.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (!details || details.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: "Please provide specific details explaining your request." },
        { status: 400 }
      );
    }

    const ipAddress = getClientIp(req);
    const request = createDataRightsRequest({
      userEmail: email,
      userId: user?.id,
      requestType,
      details,
      nomineeName,
      nomineeContact,
      ipAddress,
    });

    return NextResponse.json({
      success: true,
      message: `Your Data Rights request has been registered under Section 11-14 of the DPDP Act 2023. Reference: ${request.requestId}. You will receive a response within ${GRIEVANCE_OFFICER_INFO.responseWindowDays} calendar days.`,
      request,
      grievanceOfficer: GRIEVANCE_OFFICER_INFO,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
