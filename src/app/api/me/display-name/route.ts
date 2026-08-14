import { NextResponse, type NextRequest } from "next/server";
import { services } from "../../../../backend/wiring/container";
import { attachSessionCookie, resolveSession } from "../../../../backend/services/auth/session.service";

interface SetDisplayNameBody {
  displayName: string;
}

export async function POST(request: NextRequest) {
  const session = resolveSession(request);
  const body = (await request.json()) as SetDisplayNameBody;

  try {
    const displayName = await services.userProfile.setDisplayName(session.userId, body.displayName ?? "");
    const response = NextResponse.json({ ok: true, displayName }, { status: 200 });
    attachSessionCookie(response, session.userId);
    return response;
  } catch {
    const response = NextResponse.json({ error: "Display name must be 1-24 characters." }, { status: 400 });
    attachSessionCookie(response, session.userId);
    return response;
  }
}
