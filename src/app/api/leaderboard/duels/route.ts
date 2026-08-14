import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../backend/services/auth/session.service";

export async function GET(request: NextRequest) {
  const session = resolveSession(request);

  const rankings = await services.leaderboard.getDuelRankings();

  const response = NextResponse.json({ viewerUserId: session.userId, rankings }, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}
