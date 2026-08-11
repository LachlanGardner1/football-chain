import { NextResponse } from "next/server";
import { services } from "../../../../backend/wiring/container";

export async function GET() {
  const result = await services.dailyPuzzle.getPublishedDates();
  return NextResponse.json(result, { status: 200 });
}
