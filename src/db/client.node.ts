import postgres from "postgres";
import { ensureDatabaseReady, type SetupQueryExecutor } from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type { AdapterSetupOptions, DbAdapter, DbSql, UserCtx } from "./types.js";

let localPool: ReturnType<typeof postgres> | null = null;

function getPool(connectionString: string): ReturnType<typeof postgres> {
  if (!localPool) {
    localPool = postgres(connectionString);
  }
  return localPool;
}

type PostgresQueryable = {
  unsafe: (query: string, params?: postgres.ParameterOrJSON<never>[]) => Promise<unknown[]>;
};

function makeSetupExecutor(queryable: PostgresQueryable): SetupQueryExecutor {
  return async (statement, values = []) => {
    const rows = await queryable.unsafe(statement, values as postgres.ParameterOrJSON<never>[]);
    return rows as Array<Record<string, unknown>>;
  };
}

async function setRlsContext(
  tx: postgres.TransactionSql,
  userId: string,
  role: string,
  groupKey: string,
): Promise<void> {
  await tx.unsafe(
    `SELECT set_config('app.user_id', $1, true),
            set_config('app.user_role', $2, true),
            set_config('app.group_key', $3, true)`,
    [userId, role, groupKey],
  );
}

function makeTxSql(tx: postgres.TransactionSql): DbSql {
  return createSqlTag(async (query) => {
    const rows = await tx.unsafe(query.text, query.values as postgres.ParameterOrJSON<never>[]);
    return rows as unknown[];
  });
}

export function createNodeAdapter(connectionString: string): DbAdapter {
  const pool = getPool(connectionString);

  return {
    async withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
      return pool.begin(async (tx) => {
        await setRlsContext(tx, "", "", "");
        return fn(makeTxSql(tx));
      }) as Promise<T>;
    },

    async withUserTx<T>(user: UserCtx, fn: (sql: DbSql) => Promise<T>): Promise<T> {
      return pool.begin(async (tx) => {
        await setRlsContext(tx, user.id, user.role ?? "", user.groupKey ?? "");
        return fn(makeTxSql(tx));
      }) as Promise<T>;
    },

    async runSetup(options: AdapterSetupOptions): Promise<void> {
      return ensureDatabaseReady({
        ...options,
        context: "node",
        query: makeSetupExecutor(pool as unknown as PostgresQueryable),
        transaction: async <T>(fn: (query: SetupQueryExecutor) => Promise<T>): Promise<T> =>
          pool.begin((tx) =>
            fn(makeSetupExecutor(tx as unknown as PostgresQueryable)),
          ) as Promise<T>,
      });
    },
  };
}
