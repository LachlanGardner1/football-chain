import { NextResponse } from "next/server";
import { ensureServicesReady, services } from "../../../../backend/wiring/container";

function resolveUserId(req: Request): string | null {
  const userId = req.headers.get("x-user-id");
  return userId && userId.length > 0 ? userId : null;
}

export async function GET(request: Request) {
  await ensureServicesReady();
  const userId = resolveUserId(request);

  if (!userId) {
    return NextResponse.json({ error: "Missing x-user-id header." }, { status: 400 });
  }

  const stats = await services.results.getUserStats(userId);
  return NextResponse.json(stats, { status: 200 });
}
