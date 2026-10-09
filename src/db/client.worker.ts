import { Client } from "@neondatabase/serverless";
import {
  assertSafeRole,
  assertSafeRuntimeRole,
  DATABASE_RUNTIME_ROLE,
  ensureDatabaseReady,
  inspectDatabaseRole,
  type SetupQueryExecutor,
} from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type {
  AdapterSetupOptions,
  DatabaseUser,
  DbAdapter,
  DbSql,
} from "./types.js";

type NeonClient = {
  query: (query: string, params?: unknown[]) => Promise<unknown>;
};

type QueryResultWithRows = { rows?: unknown[] };

function normalizeRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as QueryResultWithRows).rows)
  ) {
    return (result as QueryResultWithRows).rows as Array<
      Record<string, unknown>
    >;
  }
  return [];
}

async function runNeonTx<T>(
  connectionString: string,
  userId: string | null,
  fn: (sql: DbSql) => Promise<T>,
  role: string,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await assertSafeRole(makeSetupExecutor(client), role, "connection");
    await client.query("BEGIN");
    if (userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userId,
      ]);
    }
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
    const result = await client.query(
      statement,
      values ? [...values] : undefined,
    );
    return normalizeRows(result);
  };
}

export function createWorkerAdapter(
  connectionString: string,
  migrationConnectionString?: string,
  role: string = DATABASE_RUNTIME_ROLE,
): DbAdapter {
  return {
    async withPublicTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
      return runNeonTx(connectionString, null, fn, role);
    },

    async withUserTx<T>(
      user: DatabaseUser,
      fn: (sql: DbSql) => Promise<T>,
    ): Promise<T> {
      return runNeonTx(connectionString, user.id, fn, role);
    },

    async runSetup(options: AdapterSetupOptions): Promise<void> {
      const runtimeClient = new Client({ connectionString });
      await runtimeClient.connect();
      try {
        const runtimeQuery = makeSetupExecutor(runtimeClient);
        await assertSafeRuntimeRole(runtimeQuery);
        const setupConnectionString =
          options.mode === "apply"
            ? (migrationConnectionString ??
              (() => {
                throw new Error(
                  "[db] DATABASE_MIGRATION_URL is required to apply migrations.",
                );
              })())
            : connectionString;
        const setupClient =
          setupConnectionString === connectionString
            ? runtimeClient
            : new Client({ connectionString: setupConnectionString });
        if (setupClient !== runtimeClient) {
          await setupClient.connect();
        }
        try {
          const setupQuery = makeSetupExecutor(setupClient);
          if (options.mode === "apply") {
            const runtimeRole = await inspectDatabaseRole(runtimeQuery);
            const migrationRole = await inspectDatabaseRole(setupQuery);
            if (runtimeRole.role_name === migrationRole.role_name) {
              throw new Error(
                "[db] Runtime queries and migrations must use distinct PostgreSQL roles.",
              );
            }
          }
          await ensureDatabaseReady({
            ...options,
            context: "cloudflare-worker",
            query: setupQuery,
            transaction: async (fn) => {
              await setupClient.query("BEGIN");
              try {
                const result = await fn(makeSetupExecutor(setupClient));
                await setupClient.query("COMMIT");
                return result;
              } catch (error) {
                await setupClient.query("ROLLBACK");
                throw error;
              }
            },
          });
          await assertSafeRuntimeRole(runtimeQuery);
        } finally {
          if (setupClient !== runtimeClient) {
            await setupClient.end();
          }
        }
      } finally {
        await runtimeClient.end();
      }
    },
  };
}
