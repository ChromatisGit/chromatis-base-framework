import { getSessionCookie } from "./cookie.server.js";

export function requireSessionCookie(
  request: Request,
  cookieName: string,
  redirectTo = "/login",
): string {
  const value = getSessionCookie(request, { name: cookieName });
  if (!value) throw new Response(null, { status: 302, headers: { Location: redirectTo } });
  return value;
}
