import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../backend/services/auth/session.service";

export async function POST(request: NextRequest) {
  const session = resolveSession(request);

  const result = await services.speedRound.createMatch(session.userId);

  const response = NextResponse.json(result, { status: 201 });
  attachSessionCookie(response, session.userId);
  return response;
}
