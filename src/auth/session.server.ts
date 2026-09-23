import {
  buildClearSessionCookie,
  buildSetSessionCookie,
  getSessionCookie,
} from "./cookie.server.js";
import type { SessionCookieConfig } from "./cookie.server.js";
import type { Database } from "../db/client.js";
import type { Session, User } from "./types.js";

const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionManager {
  create(user: User): Promise<{ session: Session; cookie: string }>;
  resolve(request: Request): Promise<Session | null>;
  revoke(sessionId: string): Promise<void>;
  revokeAll(user: User): Promise<void>;
  logout(session: Session | null): Promise<string>;
  clearCookie(): string;
}

export interface SessionManagerOptions {
  readonly database: Database;
  readonly cookieName: string;
  readonly maxAgeSeconds?: number;
  readonly secure?: boolean;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export function createSessionManager(
  options: SessionManagerOptions,
): SessionManager {
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => crypto.randomUUID());
  const cookieConfig: SessionCookieConfig = {
    name: options.cookieName,
    maxAge,
    secure: options.secure ?? true,
    sameSite: "lax",
    path: "/",
  };
  const revoke = async (sessionId: string): Promise<void> => {
    await options.database.anonTransaction(async (sql) => {
      await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
    });
  };

  return {
    async create(user) {
      const id = createId();
      const expiresAt = new Date(now().getTime() + maxAge * 1_000);
      await options.database.anonTransaction(async (sql) => {
        await sql`
          INSERT INTO sessions (id, user_id, expires_at)
          VALUES (${id}, ${user.id}, ${expiresAt})
        `;
      });
      return {
        session: { id, user, expiresAt },
        cookie: buildSetSessionCookie(id, cookieConfig),
      };
    },
    async resolve(request) {
      const id = getSessionCookie(request, { name: options.cookieName });
      if (!id || !UUID_PATTERN.test(id)) {
        return null;
      }
      const rows = await options.database.anonTransaction(
        (sql) =>
          sql<Array<{ id: string; user_id: string; expires_at: Date }>>`
          SELECT s.id, s.user_id, s.expires_at
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.id = ${id} AND s.expires_at > ${now()} AND u.enabled = true
          LIMIT 1
        `,
      );
      const row = rows[0];
      return row
        ? { id: row.id, user: { id: row.user_id }, expiresAt: row.expires_at }
        : null;
    },
    revoke,
    async revokeAll(user) {
      await options.database.anonTransaction(async (sql) => {
        await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
      });
    },
    async logout(session) {
      if (session) {
        await revoke(session.id);
      }
      return buildClearSessionCookie(cookieConfig);
    },
    clearCookie: () => buildClearSessionCookie(cookieConfig),
  };
}
