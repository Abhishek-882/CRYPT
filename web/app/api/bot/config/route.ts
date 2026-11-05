import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/userStore";
import { loadBotState, saveBotState } from "@/lib/botEngine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_REQUIRED", success: false },
      { status: 401 }
    );
  }

  const state = loadBotState(user.id);
  return NextResponse.json({
    success: true,
    bots: state.bots,
    activeBotId: state.activeBotId,
    isRunning: state.isRunning,
  });
}

export async function POST(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_REQUIRED", success: false },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const state = loadBotState(user.id);

  if (body.bots && Array.isArray(body.bots)) {
    state.bots = body.bots;
  }
  if (body.activeBotId) {
    state.activeBotId = body.activeBotId;
  }
  saveBotState(state, user.id);

  return NextResponse.json({
    success: true,
    bots: state.bots,
    activeBotId: state.activeBotId,
  });
}
