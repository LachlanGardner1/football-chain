import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../backend/services/auth/session.service";

interface CompleteBody {
  puzzleId: number;
  solved: boolean;
  chainLength?: number;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CompleteBody;
  const session = resolveSession(request);

  await services.results.recordAttempt({
    userId: session.userId,
    puzzleId: body.puzzleId,
    solved: body.solved,
    chainLength: body.chainLength,
  });

  const response = NextResponse.json({ ok: true }, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}
