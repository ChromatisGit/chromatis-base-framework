import { Client } from "@neondatabase/serverless";
import { ensureDatabaseReady, type SetupQueryExecutor } from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type { AdapterSetupOptions, DbAdapter, DbSql, UserCtx } from "./types.js";

type NeonClient = {
  query: (query: string, params?: unknown[]) => Promise<unknown>;
};

type QueryResultWithRows = { rows?: unknown[] };

function normalizeRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as QueryResultWithRows).rows)
  ) {
    return (result as QueryResultWithRows).rows as Array<Record<string, unknown>>;
  }
  return [];
}

async function runNeonTx<T>(
  connectionString: string,
  userId: string,
  role: string,
  groupKey: string,
  fn: (sql: DbSql) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.user_role', $2, true),
              set_config('app.group_key', $3, true)`,
      [userId, role, groupKey],
    );
    const sql = createSqlTag(async (query) => {
      const result = await client.query(query.text, query.values);
      return normalizeRows(result) as unknown[];
    });
    const result = await fn(sql);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function makeSetupExecutor(client: NeonClient): SetupQueryExecutor {
  return async (statement, values) => {
    const result = await client.query(statement, values ? [...values] : undefined);
    return normalizeRows(result);
  };
}

export function createWorkerAdapter(connectionString: string): DbAdapter {
  return {
    async withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
      return runNeonTx(connectionString, "", "", "", fn);
    },

    async withUserTx<T>(user: UserCtx, fn: (sql: DbSql) => Promise<T>): Promise<T> {
      return runNeonTx(connectionString, user.id, user.role ?? "", user.groupKey ?? "", fn);
    },

    async runSetup(options: AdapterSetupOptions): Promise<void> {
      const client = new Client({ connectionString });
      await client.connect();
      try {
        return await ensureDatabaseReady({
          ...options,
          context: "cloudflare-worker",
          query: makeSetupExecutor(client),
          transaction: async (fn) => {
            await client.query("BEGIN");
            try {
              const result = await fn(makeSetupExecutor(client));
              await client.query("COMMIT");
              return result;
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            }
          },
        });
      } finally {
        await client.end();
      }
    },
  };
}
