import { NextResponse } from "next/server";
import { ensureServicesReady, services } from "../../../backend/wiring/container";
import type { ChainNodeInput } from "../../../backend/domain/types";

interface ValidateChainBody {
  startPlayerId: number;
  targetPlayerId: number;
  chain: ChainNodeInput[];
}

export async function POST(request: Request) {
  await ensureServicesReady();
  const body = (await request.json()) as ValidateChainBody;

  const result = await services.chainValidation.validateChain({
    chain: body.chain,
    startPlayerId: body.startPlayerId,
    targetPlayerId: body.targetPlayerId,
  });

  return NextResponse.json(result, { status: 200 });
}
