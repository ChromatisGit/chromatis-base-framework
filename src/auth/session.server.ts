import { getSessionCookie, buildSetSessionCookie, buildClearSessionCookie } from "./cookie.server.js";
import type { SessionCookieConfig } from "./cookie.server.js";

export interface SessionServiceOptions<TUser> {
  getUserById: (id: string) => Promise<TUser | null>;
  cookieName: string;
  maxAge?: number;
  secure?: boolean;
}

export interface SessionService<TUser> {
  getSession(request: Request): Promise<{ user: TUser } | null>;
  buildSessionCookie(userId: string): string;
  buildLogoutCookie(): string;
}

export function createSessionService<TUser>(
  options: SessionServiceOptions<TUser>,
): SessionService<TUser> {
  const { getUserById, cookieName, maxAge = 60 * 60 * 24 * 30 } = options;

  const cookieConfig: SessionCookieConfig = {
    name: cookieName,
    maxAge,
    secure: options.secure ?? process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };

  return {
    async getSession(request) {
      const userId = getSessionCookie(request, { name: cookieName });
      if (!userId) return null;
      const user = await getUserById(userId);
      return user ? { user } : null;
    },
    buildSessionCookie(userId) {
      return buildSetSessionCookie(userId, cookieConfig);
    },
    buildLogoutCookie() {
      return buildClearSessionCookie(cookieConfig);
    },
  };
}
