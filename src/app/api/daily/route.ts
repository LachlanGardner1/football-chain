import { NextResponse } from "next/server";
import { services } from "../../../backend/wiring/container";
import { resolveDailyPuzzleDate } from "./date";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedDate = searchParams.get("date");
  const puzzleDate = resolveDailyPuzzleDate(requestedDate);
  // An explicitly-requested date must match exactly, or the caller gets a clear
  // "not found" instead of silently being served a different puzzle.
  const puzzle = await services.dailyPuzzle.getTodayPublishedPuzzle(puzzleDate, { strict: requestedDate !== null });

  if (!puzzle) {
    return NextResponse.json(
      { error: requestedDate ? "No puzzle published for this date." : "No puzzle published yet." },
      { status: 404 },
    );
  }

  return NextResponse.json(puzzle, { status: 200 });
}
