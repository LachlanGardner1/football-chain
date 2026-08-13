import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../../backend/services/auth/session.service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId: matchIdParam } = await params;
  const matchId = Number(matchIdParam);
  const session = resolveSession(request);

  if (!Number.isInteger(matchId)) {
    return NextResponse.json({ error: "Invalid match id." }, { status: 400 });
  }

  await services.speedRound.markReady(matchId, session.userId);

  const response = NextResponse.json({ ok: true }, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}
