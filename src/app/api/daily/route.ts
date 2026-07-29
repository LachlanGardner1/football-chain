import { NextResponse } from "next/server";
import { ensureServicesReady, services } from "../../../backend/wiring/container";

function todayUtcDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  await ensureServicesReady();
  const puzzle = await services.dailyPuzzle.getTodayPublishedPuzzle(todayUtcDateIso());

  if (!puzzle) {
    return NextResponse.json({ error: "No puzzle published yet." }, { status: 404 });
  }

  return NextResponse.json(puzzle, { status: 200 });
}
