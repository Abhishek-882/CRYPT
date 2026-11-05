import { NextRequest, NextResponse } from "next/server";
import { RiskGate } from "@/lib/riskGate";
import { resolveCallerCredentials } from "@/lib/authHelper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const creds = resolveCallerCredentials(req);
  if (!creds.authorized) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_REQUIRED", success: false },
      { status: 401 }
    );
  }

  const userId = creds.user?.id || (creds.isAdmin ? "usr_admin_varsha" : "global_default");
  const status = RiskGate.getRiskStatus(userId);

  return NextResponse.json({
    success: true,
    risk: status,
  });
}

export async function POST(req: NextRequest) {
  const creds = resolveCallerCredentials(req);
  if (!creds.authorized) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_REQUIRED", success: false },
      { status: 401 }
    );
  }

  // Admin authorization strictly required for trip / reset operations
  if (!creds.isAdmin) {
    return NextResponse.json(
      { error: "Forbidden: Admin privileges required to trip or reset risk kill-switch", code: "ADMIN_REQUIRED", success: false },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const action = body.action;

    if (action === "trip") {
      const reason = body.reason || "Manual operator emergency halt";
      RiskGate.tripKillSwitch(reason, creds.user?.email || "Operator");
      return NextResponse.json({
        success: true,
        action: "trip",
        message: `Kill-switch activated: ${reason}`,
        risk: RiskGate.getRiskStatus(creds.user?.id),
      });
    }

    if (action === "reset") {
      RiskGate.resetKillSwitch(creds.user?.id || "Admin");
      return NextResponse.json({
        success: true,
        action: "reset",
        message: "Kill-switch successfully reset by admin.",
        risk: RiskGate.getRiskStatus(creds.user?.id),
      });
    }

    return NextResponse.json(
      { success: false, error: "Invalid action. Supported actions: 'trip', 'reset'" },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to process risk action" },
      { status: 500 }
    );
  }
}
