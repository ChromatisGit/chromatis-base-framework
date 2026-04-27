import postgres from "postgres";
import { getDatabaseAutoInitEnabled, getDatabaseUrl } from "../runtime/env.js";
import { ensureDatabaseReady, type SetupQueryExecutor } from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type { DbAdapter, DbSql, UserCtx } from "./types.js";

let localPool: ReturnType<typeof postgres> | null = null;

function getLocalPool() {
  if (!localPool) {
    localPool = postgres(getDatabaseUrl());
  }
  return localPool;
}

type PostgresQueryable = {
  unsafe: (query: string, params?: postgres.ParameterOrJSON<never>[]) => Promise<unknown[]>;
};

async function executeNodeQuery(
  queryable: PostgresQueryable,
  statement: string,
  values: readonly unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const rows = await queryable.unsafe(statement, [...values] as postgres.ParameterOrJSON<never>[]);
  return rows as Array<Record<string, unknown>>;
}

function getNodeSetupQuery(queryable: PostgresQueryable): SetupQueryExecutor {
  return (statement, values) => executeNodeQuery(queryable, statement, values);
}

async function ensureNodeDatabaseReady(): Promise<void> {
  const connectionKey = getDatabaseUrl();
  return ensureDatabaseReady({
    autoInitEnabled: getDatabaseAutoInitEnabled(),
    connectionKey,
    context: "node",
    query: getNodeSetupQuery(getLocalPool() as unknown as PostgresQueryable),
    transaction: async <T>(fn: (query: SetupQueryExecutor) => Promise<T>): Promise<T> =>
      getLocalPool().begin((transaction) =>
        fn(getNodeSetupQuery(transaction as unknown as PostgresQueryable))
      ) as Promise<T>,
  });
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

export const nodeDbAdapter: DbAdapter = {
  async withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
    await ensureNodeDatabaseReady();
    return getLocalPool().begin(async (tx) => {
      await setRlsContext(tx, "", "", "");
      return fn(makeTxSql(tx));
    }) as Promise<T>;
  },

  async withUserTx<T>(user: UserCtx, fn: (sql: DbSql) => Promise<T>): Promise<T> {
    await ensureNodeDatabaseReady();
    return getLocalPool().begin(async (tx) => {
      await setRlsContext(tx, user.id, user.role, user.groupKey ?? "");
      return fn(makeTxSql(tx));
    }) as Promise<T>;
  },
};
