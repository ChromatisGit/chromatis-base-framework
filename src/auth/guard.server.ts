import { getSessionCookie } from "./cookie.server.js";
import type { UserDTO } from "./types.js";

export function requireSessionCookie(
  request: Request,
  cookieName: string,
  redirectTo = "/login",
): string {
  const value = getSessionCookie(request, { name: cookieName });
  if (!value) throw new Response(null, { status: 302, headers: { Location: redirectTo } });
  return value;
}

export function isAdmin(user: UserDTO): boolean {
  return user.role === "admin";
}

export function assertLoggedIn<T extends { user: UserDTO }>(
  session: T | null,
  redirectTo = "/login",
): asserts session is T {
  if (!session) throw new Response(null, { status: 302, headers: { Location: redirectTo } });
}

export function assertAdminAccess<T extends { user: UserDTO }>(
  session: T | null,
): asserts session is T {
  if (!session || !isAdmin(session.user)) throw new Response("Not found", { status: 404 });
}
