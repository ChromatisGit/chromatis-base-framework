import { hashPin, verifyPin } from "./hash.server.js";
import { hasRole } from "./roles.server.js";
import type { AuthDatabase } from "./database.server.js";
import type { Database } from "../db/client.js";
import type { DbSql } from "../db/types.js";
import { PermissionDeniedError } from "../errors.js";
import type { LoginResult, RegisterResult, User } from "./types.js";

type CredentialRow = Readonly<{
  id: string;
  pin_hash: string;
  enabled: boolean;
}>;

const REGISTRATION_LOCK = "chromatis.register_user";

/**
 * Registers a PIN User. The first User is enabled and becomes administrator;
 * later Users wait for approval. Registrations are serialised by an advisory
 * transaction lock, so two simultaneous first registrations cannot both become
 * administrators.
 */
export async function registerUser(
  auth: AuthDatabase,
  credentials: Readonly<{ username: string; pin: string }>,
): Promise<RegisterResult> {
  const pinHash = await hashPin(credentials.pin);
  return auth.transaction(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${REGISTRATION_LOCK}, 0))`;
    const [{ exists = false } = {}] = await sql<Array<{ exists: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM users LIMIT 1) AS exists
    `;
    const rows = await sql<Array<{ id: string; enabled: boolean }>>`
      INSERT INTO users (username, pin_hash, enabled)
      VALUES (${credentials.username}, ${pinHash}, ${!exists})
      ON CONFLICT (username) DO NOTHING
      RETURNING id, enabled
    `;
    const row = rows[0];
    if (!row) {
      return { status: "username_taken" };
    }
    if (!exists) {
      await sql`
        INSERT INTO roles (key, description)
        VALUES ('admin', 'Application administrator') ON CONFLICT DO NOTHING
      `;
      await sql`INSERT INTO user_roles (user_id, role_key) VALUES (${row.id}, 'admin')`;
    }
    return row.enabled
      ? { status: "registered", user: { id: row.id } }
      : { status: "pending_approval" };
  });
}

export async function loginUser(
  auth: AuthDatabase,
  username: string,
  pin: string,
): Promise<LoginResult> {
  const rows = await auth.transaction(
    (sql: DbSql) =>
      sql<CredentialRow[]>`
        SELECT id, pin_hash, enabled FROM users WHERE username = ${username} LIMIT 1
      `,
  );
  const row = rows[0];
  if (!row || !(await verifyPin(pin, row.pin_hash))) {
    return { status: "invalid_credentials" };
  }
  return row.enabled
    ? { status: "ok", user: { id: row.id } }
    : { status: "disabled" };
}

export async function getUserById(
  auth: AuthDatabase,
  id: string,
): Promise<User | null> {
  const rows = await auth.transaction(
    (sql) =>
      sql<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${id} AND enabled = true LIMIT 1
      `,
  );
  return rows[0] ? { id: rows[0].id } : null;
}

/** Enables or disables a User. Only administrators may do this. */
export async function setUserEnabled(
  dependencies: Readonly<{ auth: AuthDatabase; database: Database }>,
  actor: User,
  userId: string,
  enabled: boolean,
): Promise<void> {
  if (!(await hasRole(dependencies.database, actor, "admin"))) {
    throw new PermissionDeniedError("Role required: admin");
  }
  await dependencies.auth.transaction(async (sql) => {
    await sql`UPDATE users SET enabled = ${enabled} WHERE id = ${userId}`;
  });
}
