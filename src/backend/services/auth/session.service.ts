import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "fc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }

  return "dev-only-insecure-session-secret";
}

function sign(userId: string): string {
  return createHmac("sha256", getSecret()).update(userId).digest("hex");
}

export function createSignedSessionValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

// Cookie value is "<userId>.<hmac>" so a tampered or forged userId fails verification
// instead of silently being trusted, which is what let /api/complete and /api/me/stats
// be spoofed for arbitrary users before this existed.
export function verifySessionCookieValue(cookieValue: string): string | null {
  const separatorIndex = cookieValue.lastIndexOf(".");
  if (separatorIndex === -1) return null;

  const userId = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);
  const expected = sign(userId);

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== providedBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) return null;

  return userId;
}

export interface ResolvedSession {
  userId: string;
  isNew: boolean;
}

export function resolveSession(request: NextRequest): ResolvedSession {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const userId = cookieValue ? verifySessionCookieValue(cookieValue) : null;

  if (userId) {
    return { userId, isNew: false };
  }

  return { userId: randomUUID(), isNew: true };
}

export function attachSessionCookie(response: NextResponse, userId: string): void {
  response.cookies.set(SESSION_COOKIE_NAME, createSignedSessionValue(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}
