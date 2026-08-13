import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../../backend/services/auth/session.service";

// Polled roughly once a second while a match is in progress - see SpeedRoundRepository.
// getMatchState for the self-healing state transitions (countdown -> in progress, forfeit)
// this drives just by being called.
export async function GET(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId: matchIdParam } = await params;
  const matchId = Number(matchIdParam);
  const session = resolveSession(request);

  if (!Number.isInteger(matchId)) {
    return NextResponse.json({ error: "Invalid match id." }, { status: 400 });
  }

  try {
    const state = await services.speedRound.getMatchState(matchId, session.userId);
    const response = NextResponse.json(state, { status: 200 });
    attachSessionCookie(response, session.userId);
    return response;
  } catch {
    // Covers both "no such match" and "you aren't one of its two players" - a 404 either way
    // avoids confirming to a non-participant that a given match id even exists.
    const response = NextResponse.json({ error: "Match not found." }, { status: 404 });
    attachSessionCookie(response, session.userId);
    return response;
  }
}
