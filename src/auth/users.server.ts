import { hashPin, verifyPin } from "./hash.server.js";
import type { DbSql } from "../db/types.js";
import type { UserDTO, UserRole, LoginResult, RegisterResult } from "./types.js";

type UserRow = {
  id: string;
  role: UserRole;
  pin_hash: string;
  enabled: boolean;
};

export async function hasAnyUsers(sql: DbSql): Promise<boolean> {
  const rows = await sql<[{ exists: boolean }]>`
    SELECT EXISTS (SELECT 1 FROM users LIMIT 1) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function registerUser(
  sql: DbSql,
  { username, pin, role }: { username: string; pin: string; role?: UserRole },
): Promise<RegisterResult> {
  const isFirst = !(await hasAnyUsers(sql));
  const pinHash = await hashPin(pin);
  const resolvedRole: UserRole = role ?? "user";

  const rows = await sql<[{ id: string; role: UserRole; enabled: boolean }]>`
    INSERT INTO users (username, pin_hash, role, enabled)
    VALUES (${username}, ${pinHash}, ${resolvedRole}, ${isFirst})
    ON CONFLICT (username) DO NOTHING
    RETURNING id, role, enabled
  `;

  const row = rows[0];
  if (!row) return { status: "username_taken" };

  const user: UserDTO = { id: row.id, role: row.role };
  return row.enabled ? { status: "registered", user } : { status: "pending_approval" };
}

export async function loginUser(
  sql: DbSql,
  username: string,
  pin: string,
): Promise<LoginResult> {
  const rows = await sql<UserRow[]>`
    SELECT id, role, pin_hash, enabled FROM users WHERE username = ${username} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { status: "invalid_credentials" };
  if (!row.enabled) return { status: "disabled" };

  const ok = await verifyPin(pin, row.pin_hash);
  if (!ok) return { status: "invalid_credentials" };

  return { status: "ok", user: { id: row.id, role: row.role } };
}

export async function getUserById(sql: DbSql, id: string): Promise<UserDTO | null> {
  const rows = await sql<[{ id: string; role: UserRole; enabled: boolean }]>`
    SELECT id, role, enabled FROM users WHERE id = ${id} LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.enabled) return null;
  return { id: row.id, role: row.role };
}

export async function getUserByUsername(
  sql: DbSql,
  username: string,
): Promise<(UserDTO & { enabled: boolean }) | null> {
  const rows = await sql<[{ id: string; role: UserRole; enabled: boolean }]>`
    SELECT id, role, enabled FROM users WHERE username = ${username} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, role: row.role, enabled: row.enabled };
}

export async function enableUser(sql: DbSql, userId: string): Promise<void> {
  await sql`UPDATE users SET enabled = TRUE WHERE id = ${userId}`;
}

export async function disableUser(sql: DbSql, userId: string): Promise<void> {
  await sql`UPDATE users SET enabled = FALSE WHERE id = ${userId}`;
}

export async function setUserRole(sql: DbSql, userId: string, role: UserRole): Promise<void> {
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`;
}

export async function listUsers(
  sql: DbSql,
): Promise<Array<UserDTO & { username: string; enabled: boolean; createdAt: Date }>> {
  const rows = await sql<
    Array<{ id: string; role: UserRole; username: string; enabled: boolean; created_at: Date }>
  >`SELECT id, role, username, enabled, created_at FROM users ORDER BY created_at ASC`;
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    username: r.username,
    enabled: r.enabled,
    createdAt: r.created_at,
  }));
}
