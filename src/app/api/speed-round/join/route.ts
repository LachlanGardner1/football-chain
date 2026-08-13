import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../backend/services/auth/session.service";

interface JoinBody {
  inviteCode: string;
}

const JOIN_ERROR_STATUS: Record<"NOT_FOUND" | "FULL", number> = {
  NOT_FOUND: 404,
  FULL: 409,
};

const JOIN_ERROR_MESSAGE: Record<"NOT_FOUND" | "FULL", string> = {
  NOT_FOUND: "No race found for that invite code.",
  FULL: "That race already has two players.",
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as JoinBody;
  const session = resolveSession(request);

  const result = await services.speedRound.joinMatch(body.inviteCode, session.userId);

  const response =
    result.kind === "JOINED"
      ? NextResponse.json({ matchId: result.matchId }, { status: 200 })
      : NextResponse.json({ error: JOIN_ERROR_MESSAGE[result.kind] }, { status: JOIN_ERROR_STATUS[result.kind] });

  attachSessionCookie(response, session.userId);
  return response;
}
