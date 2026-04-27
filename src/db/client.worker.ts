import { Client, neon } from "@neondatabase/serverless";
import { getDatabaseAutoInitEnabled, getDatabaseUrl } from "../runtime/env.js";
import { ensureDatabaseReady, type SetupQueryExecutor } from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type { DbAdapter, DbSql, UserCtx } from "./types.js";

type NeonQueryClient = {
  query: (query: string, params?: unknown[]) => Promise<unknown>;
};

const neonClients = new Map<string, NeonQueryClient>();

function getNeonClient(): NeonQueryClient {
  const connectionString = getDatabaseUrl();
  const cached = neonClients.get(connectionString);
  if (cached) return cached;
  const created = neon(connectionString) as unknown as NeonQueryClient;
  neonClients.set(connectionString, created);
  return created;
}

type QueryResultWithRows = { rows?: unknown[] };

function normalizeQueryRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (
    typeof result === "object"
    && result !== null
    && "rows" in result
    && Array.isArray((result as QueryResultWithRows).rows)
  ) {
    return (result as QueryResultWithRows).rows as Array<Record<string, unknown>>;
  }
  return [];
}

function getWorkerSetupQuery(queryable: NeonQueryClient): SetupQueryExecutor {
  return async (statement, values) => {
    const result = await queryable.query(statement, values ? [...values] : undefined);
    return normalizeQueryRows(result);
  };
}

async function ensureWorkerDatabaseReady(): Promise<void> {
  const connectionKey = getDatabaseUrl();
  return ensureDatabaseReady({
    autoInitEnabled: getDatabaseAutoInitEnabled(),
    connectionKey,
    context: "cloudflare-worker",
    query: getWorkerSetupQuery(getNeonClient()),
    transaction: async (fn) => {
      const client = new Client({ connectionString: connectionKey });
      let connected = false;
      try {
        await client.connect();
        connected = true;
        await client.query("BEGIN");
        try {
          const result = await fn(getWorkerSetupQuery(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        if (connected) await client.end();
      }
    },
  });
}

async function runInNeonTransaction<T>(
  userId: string,
  role: string,
  groupKey: string,
  fn: (sql: DbSql) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN");
    try {
      await client.query(
        `SELECT set_config('app.user_id', $1, true),
                set_config('app.user_role', $2, true),
                set_config('app.group_key', $3, true)`,
        [userId, role, groupKey],
      );
      const txSql = createSqlTag(async (query) => {
        const result = await client.query(query.text, query.values);
        return normalizeQueryRows(result) as unknown[];
      });
      const result = await fn(txSql);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    if (connected) await client.end();
  }
}

export const workerDbAdapter: DbAdapter = {
  async withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
    await ensureWorkerDatabaseReady();
    return runInNeonTransaction("", "", "", fn);
  },

  async withUserTx<T>(user: UserCtx, fn: (sql: DbSql) => Promise<T>): Promise<T> {
    await ensureWorkerDatabaseReady();
    return runInNeonTransaction(user.id, user.role, user.groupKey ?? "", fn);
  },
};
