import { NextResponse } from "next/server";
import { ensureServicesReady, services } from "../../../backend/wiring/container";

interface CompleteBody {
  userId: string;
  puzzleId: number;
  solved: boolean;
  chainLength?: number;
}

export async function POST(request: Request) {
  await ensureServicesReady();
  const body = (await request.json()) as CompleteBody;

  await services.results.recordAttempt({
    userId: body.userId,
    puzzleId: body.puzzleId,
    solved: body.solved,
    chainLength: body.chainLength,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
