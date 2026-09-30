import { hashPin, verifyPin } from "./hash.server.js";
import type { DbSql } from "../db/types.js";
import type { LoginResult, RegisterResult, User } from "./types.js";

type CredentialRow = Readonly<{
  id: string;
  pin_hash: string;
  enabled: boolean;
}>;

export async function registerUser(
  sql: DbSql,
  credentials: Readonly<{ username: string; pin: string }>,
): Promise<RegisterResult> {
  const [{ exists = false } = {}] = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM users LIMIT 1) AS exists
  `;
  const pinHash = await hashPin(credentials.pin);
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
    await sql`INSERT INTO roles (key, description) VALUES ('admin', 'Application administrator') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO user_roles (user_id, role_key) VALUES (${row.id}, 'admin') ON CONFLICT DO NOTHING`;
  }

  return row.enabled
    ? { status: "registered", user: { id: row.id } }
    : { status: "pending_approval" };
}

export async function loginUser(
  sql: DbSql,
  username: string,
  pin: string,
): Promise<LoginResult> {
  const rows = await sql<CredentialRow[]>`
    SELECT id, pin_hash, enabled FROM users WHERE username = ${username} LIMIT 1
  `;
  const row = rows[0];
  if (!row || !(await verifyPin(pin, row.pin_hash))) {
    return { status: "invalid_credentials" };
  }
  return row.enabled
    ? { status: "ok", user: { id: row.id } }
    : { status: "disabled" };
}

export async function getUserById(
  sql: DbSql,
  id: string,
): Promise<User | null> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM users WHERE id = ${id} AND enabled = true LIMIT 1
  `;
  return rows[0] ? { id: rows[0].id } : null;
}

export async function setUserEnabled(
  sql: DbSql,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await sql`UPDATE users SET enabled = ${enabled} WHERE id = ${userId}`;
}
