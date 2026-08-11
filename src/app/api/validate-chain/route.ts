import { NextResponse } from "next/server";
import { services } from "../../../backend/wiring/container";
import type { ChainNodeInput } from "../../../backend/domain/types";

interface ValidateChainBody {
  anchorPlayerIds: number[];
  chain: ChainNodeInput[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as ValidateChainBody;

  console.info('[football-chain] validate-chain request', {
    chainLength: body.chain.length,
    anchorPlayerIds: body.anchorPlayerIds,
    chain: body.chain,
  });

  const result = await services.chainValidation.validateChain({
    chain: body.chain,
    anchorPlayerIds: body.anchorPlayerIds,
  });

  console.info('[football-chain] validate-chain response', {
    valid: result.valid,
    solved: result.solved,
    reason: result.reason,
    chainLength: result.chainLength,
  });

  return NextResponse.json(result, { status: 200 });
}
