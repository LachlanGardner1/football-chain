import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../backend/services/auth/session.service";

export async function GET(request: NextRequest) {
  const session = resolveSession(request);

  const stats = session.isNew
    ? { solvedCount: 0, currentStreak: 0, maxStreak: 0, bestChainLength: null }
    : await services.results.getUserStats(session.userId);

  const response = NextResponse.json(stats, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}
