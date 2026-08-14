import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../backend/services/auth/session.service";

// date is optional - omitted means "today". Today's entries are withheld (locked: true,
// entries: []) until the viewer has locked in their own first attempt of the day; any
// historical date is always returned freely.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedDate = searchParams.get("date");
  const session = resolveSession(request);

  const result = await services.leaderboard.getDailyLeaderboard(requestedDate, session.userId);

  const response = NextResponse.json(result, { status: 200 });
  attachSessionCookie(response, session.userId);
  return response;
}
