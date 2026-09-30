import postgres from "postgres";
import {
  assertSafeRuntimeRole,
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

const localPools = new Map<string, ReturnType<typeof postgres>>();

export async function closeNodeDatabasePools(): Promise<void> {
  const pools = [...localPools.values()];
  localPools.clear();
  await Promise.all(pools.map((pool) => pool.end()));
}

function getPool(connectionString: string): ReturnType<typeof postgres> {
  const existing = localPools.get(connectionString);
  if (existing) {
    return existing;
  }
  const pool = postgres(connectionString);
  localPools.set(connectionString, pool);
  return pool;
}

type PostgresQueryable = {
  unsafe: (
    query: string,
    params?: postgres.ParameterOrJSON<never>[],
  ) => Promise<unknown[]>;
};

function makeSetupExecutor(queryable: PostgresQueryable): SetupQueryExecutor {
  return async (statement, values = []) => {
    const rows = await queryable.unsafe(
      statement,
      values as postgres.ParameterOrJSON<never>[],
    );
    return rows as Array<Record<string, unknown>>;
  };
}

async function setRlsContext(
  tx: postgres.TransactionSql,
  userId: string,
): Promise<void> {
  await tx.unsafe("SELECT set_config('app.user_id', $1, true)", [userId]);
}

function makeTxSql(tx: postgres.TransactionSql): DbSql {
  return createSqlTag(async (query) => {
    const rows = await tx.unsafe(
      query.text,
      query.values as postgres.ParameterOrJSON<never>[],
    );
    return rows as unknown[];
  });
}

export function createNodeAdapter(
  connectionString: string,
  migrationConnectionString?: string,
): DbAdapter {
  const pool = getPool(connectionString);
  let runtimeRoleCheck: Promise<void> | undefined;
  const ensureSafeRuntimeRole = (): Promise<void> => {
    runtimeRoleCheck ??= assertSafeRuntimeRole(
      makeSetupExecutor(pool as unknown as PostgresQueryable),
    ).catch((error: unknown) => {
      runtimeRoleCheck = undefined;
      throw error;
    });
    return runtimeRoleCheck;
  };

  return {
    async withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
      await ensureSafeRuntimeRole();
      return pool.begin(async (tx) => fn(makeTxSql(tx))) as Promise<T>;
    },

    async withUserTx<T>(
      user: DatabaseUser,
      fn: (sql: DbSql) => Promise<T>,
    ): Promise<T> {
      await ensureSafeRuntimeRole();
      return pool.begin(async (tx) => {
        await setRlsContext(tx, user.id);
        return fn(makeTxSql(tx));
      }) as Promise<T>;
    },

    async runSetup(options: AdapterSetupOptions): Promise<void> {
      const runtimeQuery = makeSetupExecutor(
        pool as unknown as PostgresQueryable,
      );
      await assertSafeRuntimeRole(runtimeQuery);
      const setupPool =
        options.mode === "apply"
          ? getPool(
              migrationConnectionString ??
                (() => {
                  throw new Error(
                    "[db] DATABASE_MIGRATION_URL is required to apply migrations.",
                  );
                })(),
            )
          : pool;
      const setupQuery = makeSetupExecutor(
        setupPool as unknown as PostgresQueryable,
      );
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
        context: "node",
        query: setupQuery,
        transaction: async <T>(
          fn: (query: SetupQueryExecutor) => Promise<T>,
        ): Promise<T> =>
          setupPool.begin((tx) =>
            fn(makeSetupExecutor(tx as unknown as PostgresQueryable)),
          ) as Promise<T>,
      });
      await assertSafeRuntimeRole(runtimeQuery);
    },
  };
}
