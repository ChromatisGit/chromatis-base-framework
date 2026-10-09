import { createNodeAdapter } from "../db/client.node.js";
import { createWorkerAdapter } from "../db/client.worker.js";
import type { DatabaseRuntime } from "../db/client.js";
import { DATABASE_AUTH_ROLE, DATABASE_RUNTIME_ROLE } from "../db/setup.js";
import type { DbSql } from "../db/types.js";

/**
 * Connection of the separate `chromatis_auth` principal. Only framework auth
 * code (sessions, registration/login, SSO, OIDC) receives it. Application
 * modules get `Database`, whose runtime role has no privileges on framework
 * state, so application SQL can never reach these operations.
 */
export interface AuthDatabase {
  transaction<T>(operation: (sql: DbSql) => Promise<T>): Promise<T>;
}

export interface AuthDatabaseOptions {
  readonly runtime: DatabaseRuntime;
  /** The runtime connection string; the two must use different roles. */
  readonly runtimeConnectionString?: string;
}

function username(connectionString: string, label: string): string {
  try {
    return decodeURIComponent(new URL(connectionString).username);
  } catch (error) {
    throw new Error(`[db] ${label} must be a valid PostgreSQL URL.`, {
      cause: error,
    });
  }
}

export function createAuthDatabase(
  connectionString: string,
  options: AuthDatabaseOptions,
): AuthDatabase {
  if (username(connectionString, "DATABASE_AUTH_URL") !== DATABASE_AUTH_ROLE) {
    throw new Error(
      `[db] DATABASE_AUTH_URL must use the ${DATABASE_AUTH_ROLE} PostgreSQL role.`,
    );
  }
  if (
    options.runtimeConnectionString &&
    username(options.runtimeConnectionString, "DATABASE_URL") ===
      DATABASE_RUNTIME_ROLE &&
    options.runtimeConnectionString === connectionString
  ) {
    throw new Error("[db] DATABASE_AUTH_URL must differ from DATABASE_URL.");
  }
  const adapter =
    options.runtime === "cloudflare"
      ? createWorkerAdapter(connectionString, undefined, DATABASE_AUTH_ROLE)
      : createNodeAdapter(connectionString, undefined, DATABASE_AUTH_ROLE);
  return { transaction: (operation) => adapter.withPublicTx(operation) };
}
