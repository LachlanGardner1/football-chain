import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../backend/services/auth/session.service";
import type { ChainNodeInput } from "../../../backend/domain/types";

type HintBody =
  | { action: "reveal-anchor-club"; puzzleId: number; anchorPlayerId: number; chain: ChainNodeInput[] }
  | { action: "reveal-next-steps"; puzzleId: number; chain: ChainNodeInput[] };

// Read-only: hydrates already-revealed hints on page load (e.g. after a refresh) without
// spending a new one.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puzzleId = Number(searchParams.get("puzzleId"));
  const session = resolveSession(request);

  const state = await services.hints.getRevealedState(session.userId, puzzleId);

  const response = NextResponse.json(state, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HintBody;
  const session = resolveSession(request);

  const anchorPlayers = await services.dailyPuzzle.getAnchorPlayers(body.puzzleId);
  const chain = body.chain ?? [];

  const result =
    body.action === "reveal-anchor-club"
      ? await services.hints.revealAnchorClub({
          userId: session.userId,
          puzzleId: body.puzzleId,
          anchorPlayerId: body.anchorPlayerId,
          anchorPlayers,
          chain,
        })
      : await services.hints.revealNextSteps({
          userId: session.userId,
          puzzleId: body.puzzleId,
          anchorPlayers,
          chain,
        });

  const response = NextResponse.json(result, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}
