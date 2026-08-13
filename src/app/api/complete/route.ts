import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../backend/services/auth/session.service";

interface CompleteBody {
  puzzleId: number;
  outcome: "SOLVED" | "FAILED";
  chainLength?: number;
  score: number;
}

// Read-only: hydrates whatever outcome is already locked in for this puzzle (e.g. after a
// refresh, or returning to a puzzle already played earlier today).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puzzleId = Number(searchParams.get("puzzleId"));
  const session = resolveSession(request);

  const outcome = await services.results.getOutcome(session.userId, puzzleId);

  const response = NextResponse.json(outcome, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CompleteBody;
  const session = resolveSession(request);

  await services.results.recordAttempt({
    userId: session.userId,
    puzzleId: body.puzzleId,
    outcome: body.outcome,
    chainLength: body.chainLength,
    score: body.score,
  });

  const response = NextResponse.json({ ok: true }, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}
