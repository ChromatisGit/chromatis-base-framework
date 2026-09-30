import { PermissionDeniedError } from "../errors.js";
import type { Database } from "../db/client.js";
import type { User } from "./types.js";

export async function hasPermission(
  database: Database,
  user: User,
  permission: string,
): Promise<boolean> {
  const rows = await database.userSQL(user)<Array<{ allowed: boolean }>>`
    SELECT chromatis.has_permission(${user.id}::uuid, ${permission}) AS allowed
  `;
  return rows[0]?.allowed ?? false;
}

export async function requirePermission(
  database: Database,
  user: User,
  permission: string,
): Promise<void> {
  if (!(await hasPermission(database, user, permission))) {
    throw new PermissionDeniedError(`Permission required: ${permission}`);
  }
}
