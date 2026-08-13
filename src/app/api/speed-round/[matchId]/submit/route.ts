import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../../backend/services/auth/session.service";
import type { ChainNodeInput } from "../../../../../backend/domain/types";

interface SubmitBody {
  chain: ChainNodeInput[];
}

// The server-receipt time of a *validated* solve here is what decides who won the race - see
// SpeedRoundService.submit / SpeedRoundRepository.recordFinish. Not client-reported elapsed
// time, deliberately - see the plan's "known trade-offs" for why.
export async function POST(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId: matchIdParam } = await params;
  const matchId = Number(matchIdParam);
  const session = resolveSession(request);

  if (!Number.isInteger(matchId)) {
    return NextResponse.json({ error: "Invalid match id." }, { status: 400 });
  }

  const body = (await request.json()) as SubmitBody;

  try {
    const result = await services.speedRound.submit(matchId, session.userId, body.chain ?? []);
    const response = NextResponse.json(result, { status: 200 });
    attachSessionCookie(response, session.userId);
    return response;
  } catch {
    const response = NextResponse.json({ error: "Match not found." }, { status: 404 });
    attachSessionCookie(response, session.userId);
    return response;
  }
}
