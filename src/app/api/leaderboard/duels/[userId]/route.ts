import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../../backend/services/auth/session.service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const session = resolveSession(request);

  const detail = await services.leaderboard.getDuelPlayerDetail(userId);

  const response = detail
    ? NextResponse.json(detail, { status: 200 })
    : NextResponse.json({ error: "Player not found." }, { status: 404 });
  attachSessionCookie(response, session.userId);
  return response;
}
