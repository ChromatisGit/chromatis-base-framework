import { PermissionDeniedError } from "../errors.js";
import type { Database } from "../db/client.js";
import type { User } from "./types.js";

export async function hasRole(
  database: Database,
  user: User,
  role: string,
): Promise<boolean> {
  const rows = await database.userSQL(user)<Array<{ allowed: boolean }>>`
    SELECT chromatis.has_role(${role}) AS allowed
  `;
  return rows[0]?.allowed ?? false;
}

export async function requireRole(
  database: Database,
  user: User,
  role: string,
): Promise<void> {
  if (!(await hasRole(database, user, role))) {
    throw new PermissionDeniedError(`Role required: ${role}`);
  }
}
