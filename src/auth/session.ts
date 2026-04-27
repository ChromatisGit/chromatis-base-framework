import { getUserById } from "./userStore.js";
import type { UserDTO } from "./userStore.js";

export const SESSION_COOKIE_NAME = "app-session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function cookieAttributes(maxAge: number): string {
  const parts = [
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

export function getSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match ? match.slice(SESSION_COOKIE_NAME.length + 1) : null;
}

export function buildSessionCookie(userId: string): string {
  return `${SESSION_COOKIE_NAME}=${userId}; ${cookieAttributes(SESSION_MAX_AGE)}`;
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

/**
 * Reads the session cookie from the request and returns the authenticated user,
 * or null if the cookie is missing or the user no longer exists.
 */
export async function getSession(request: Request): Promise<UserDTO | null> {
  const userId = getSessionCookie(request);
  if (!userId) return null;
  return getUserById(userId);
}
