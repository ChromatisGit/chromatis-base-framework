import { hashPin } from "./hash.server.js";
import type { AuthDatabase } from "./database.server.js";
import type { User } from "./types.js";

/**
 * Accounts an administrator creates by hand: the User gets a username and its
 * roles, then sets its own password through a one-time link. These functions
 * check no role themselves; callers (an admin page, a command-line bootstrap)
 * decide who may use them, as for `registerUser`.
 */

export const DEFAULT_SETUP_LINK_SECONDS = 60 * 60 * 24 * 7;

export type Account = Readonly<{
  id: string;
  username: string;
  enabled: boolean;
  roles: readonly string[];
  createdAt: Date;
  /** When the password was last set; null until the setup link is used. */
  passwordSetAt: Date | null;
  lastLoginAt: Date | null;
  /** Expiry of the open setup link, or null when there is none. */
  setupLinkExpiresAt: Date | null;
}>;

export type CreateAccountResult =
  | Readonly<{ status: "created"; user: User }>
  | Readonly<{ status: "username_taken" }>;

export type SetupLink = Readonly<{ token: string; expiresAt: Date }>;

export type RedeemSetupLinkResult =
  Readonly<{ status: "ok"; user: User }> | Readonly<{ status: "invalid" }>;

type Clock = Readonly<{ now?: () => Date }>;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Creates an enabled User without a password and assigns `roles`, which must
 * already exist (an application migration seeds them).
 */
export async function createAccount(
  auth: AuthDatabase,
  account: Readonly<{ username: string; roles: readonly string[] }>,
): Promise<CreateAccountResult> {
  return auth.transaction(async (sql) => {
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO users (username, enabled) VALUES (${account.username}, true)
      ON CONFLICT (username) DO NOTHING
      RETURNING id
    `;
    const row = rows[0];
    if (!row) {
      return { status: "username_taken" };
    }
    for (const role of account.roles) {
      await sql`INSERT INTO user_roles (user_id, role_key) VALUES (${row.id}, ${role})`;
    }
    return { status: "created", user: { id: row.id } };
  });
}

/**
 * Issues the one-time link with which a User sets its password. A new link
 * replaces the previous one; only the hash of the token is stored.
 */
export async function issueSetupLink(
  auth: AuthDatabase,
  user: User,
  options: Clock & Readonly<{ lifetimeSeconds?: number }> = {},
): Promise<SetupLink> {
  const now = options.now?.() ?? new Date();
  const lifetime = options.lifetimeSeconds ?? DEFAULT_SETUP_LINK_SECONDS;
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(now.getTime() + lifetime * 1_000);
  const hash = await tokenHash(token);
  await auth.transaction(async (sql) => {
    await sql`DELETE FROM password_setup_tokens WHERE user_id = ${user.id}`;
    await sql`
      INSERT INTO password_setup_tokens (token_hash, user_id, expires_at)
      VALUES (${hash}, ${user.id}, ${expiresAt})
    `;
  });
  return { token, expiresAt };
}

/**
 * Sets the password of the link's User and uses the link up. It also ends
 * every Auth Session of that User: whoever had the old password is signed
 * out. A disabled User's link does not work.
 */
export async function redeemSetupLink(
  auth: AuthDatabase,
  token: string,
  password: string,
  options: Clock = {},
): Promise<RedeemSetupLinkResult> {
  const now = options.now?.() ?? new Date();
  const [hash, pinHash] = await Promise.all([
    tokenHash(token),
    hashPin(password),
  ]);
  return auth.transaction(async (sql) => {
    const rows = await sql<Array<{ user_id: string; expires_at: Date }>>`
      DELETE FROM password_setup_tokens WHERE token_hash = ${hash}
      RETURNING user_id, expires_at
    `;
    const row = rows[0];
    if (!row || row.expires_at <= now) {
      return { status: "invalid" };
    }
    const updated = await sql<Array<{ id: string }>>`
      UPDATE users SET pin_hash = ${pinHash}, password_set_at = ${now}
      WHERE id = ${row.user_id} AND enabled = true
      RETURNING id
    `;
    if (!updated[0]) {
      return { status: "invalid" };
    }
    await sql`DELETE FROM auth_sessions WHERE user_id = ${row.user_id}`;
    return { status: "ok", user: { id: row.user_id } };
  });
}

/** Whether the link is still open, for showing the form before it is used. */
export async function setupLinkValid(
  auth: AuthDatabase,
  token: string,
  options: Clock = {},
): Promise<boolean> {
  const now = options.now?.() ?? new Date();
  const hash = await tokenHash(token);
  const rows = await auth.transaction(
    (sql) =>
      sql<Array<{ valid: boolean }>>`
        SELECT true AS valid
        FROM password_setup_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ${hash} AND t.expires_at > ${now} AND u.enabled
        LIMIT 1
      `,
  );
  return rows.length > 0;
}

type AccountRow = Readonly<{
  id: string;
  username: string;
  enabled: boolean;
  roles: string[];
  created_at: Date;
  password_set_at: Date | null;
  last_login_at: Date | null;
  setup_expires_at: Date | null;
}>;

/** Users with a username: all of them, or the one with `id`. */
async function accountRows(
  auth: AuthDatabase,
  now: Date,
  id: string | null,
): Promise<Account[]> {
  const rows = await auth.transaction(
    (sql) =>
      sql<AccountRow[]>`
        SELECT u.id, u.username, u.enabled, u.created_at, u.password_set_at,
          u.last_login_at,
          coalesce(
            (SELECT array_agg(r.role_key ORDER BY r.role_key)
             FROM user_roles r WHERE r.user_id = u.id),
            '{}'
          ) AS roles,
          (SELECT t.expires_at FROM password_setup_tokens t
           WHERE t.user_id = u.id AND t.expires_at > ${now}) AS setup_expires_at
        FROM users u
        WHERE u.username IS NOT NULL
          AND (${id}::uuid IS NULL OR u.id = ${id}::uuid)
        ORDER BY u.created_at, u.username
      `,
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    enabled: row.enabled,
    roles: row.roles,
    createdAt: row.created_at,
    passwordSetAt: row.password_set_at,
    lastLoginAt: row.last_login_at,
    setupLinkExpiresAt: row.setup_expires_at,
  }));
}

/** Every User with a username, oldest first. */
export function listAccounts(
  auth: AuthDatabase,
  options: Clock = {},
): Promise<Account[]> {
  return accountRows(auth, options.now?.() ?? new Date(), null);
}

/** The account of a User, or null when it has no username. */
export async function getAccount(
  auth: AuthDatabase,
  user: User,
  options: Clock = {},
): Promise<Account | null> {
  const [account] = await accountRows(
    auth,
    options.now?.() ?? new Date(),
    user.id,
  );
  return account ?? null;
}

export type ApiToken = Readonly<{
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}>;

/**
 * Issues an API token with which a command-line tool acts as `user`. The
 * token is returned once; only its hash is stored. A User may hold several.
 */
export async function issueApiToken(
  auth: AuthDatabase,
  user: User,
  label: string,
): Promise<Readonly<{ id: string; token: string }>> {
  const token = `chr_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const hash = await tokenHash(token);
  const rows = await auth.transaction(
    (sql) =>
      sql<Array<{ id: string }>>`
        INSERT INTO api_tokens (token_hash, user_id, label)
        VALUES (${hash}, ${user.id}, ${label})
        RETURNING id
      `,
  );
  const row = rows[0];
  if (!row) {
    throw new Error("The API token was not stored");
  }
  return { id: row.id, token };
}

/**
 * The User an API token belongs to, or null: unknown, revoked, or the User
 * is disabled. Records when the token was last used.
 */
export async function resolveApiToken(
  auth: AuthDatabase,
  token: string,
  options: Clock = {},
): Promise<User | null> {
  if (!token.startsWith("chr_")) {
    return null;
  }
  const now = options.now?.() ?? new Date();
  const hash = await tokenHash(token);
  const rows = await auth.transaction(
    (sql) =>
      sql<Array<{ user_id: string }>>`
        UPDATE api_tokens t SET last_used_at = ${now}
        FROM users u
        WHERE t.token_hash = ${hash} AND u.id = t.user_id AND u.enabled
        RETURNING t.user_id
      `,
  );
  const row = rows[0];
  return row ? { id: row.user_id } : null;
}

/** The API tokens of a User, newest first; never the tokens themselves. */
export async function listApiTokens(
  auth: AuthDatabase,
  user: User,
): Promise<ApiToken[]> {
  const rows = await auth.transaction(
    (sql) =>
      sql<
        Array<{
          id: string;
          label: string;
          created_at: Date;
          last_used_at: Date | null;
        }>
      >`
        SELECT id, label, created_at, last_used_at FROM api_tokens
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC, id
      `,
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

/** Revokes one of a User's API tokens; false when it has no such token. */
export async function revokeApiToken(
  auth: AuthDatabase,
  user: User,
  tokenId: string,
): Promise<boolean> {
  const rows = await auth.transaction(
    (sql) =>
      sql<Array<{ id: string }>>`
        DELETE FROM api_tokens WHERE id = ${tokenId} AND user_id = ${user.id}
        RETURNING id
      `,
  );
  return rows.length > 0;
}
