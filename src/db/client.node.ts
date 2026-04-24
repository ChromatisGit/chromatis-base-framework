import postgres from "postgres";
import { getDatabaseAutoInitEnabled, getDatabaseUrl } from "../runtime/env.js";
import { ensureDatabaseReady, type SetupQueryExecutor } from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type { DbAdapter } from "./types.js";

let localPool: ReturnType<typeof postgres> | null = null;

function getLocalPool() {
  if (!localPool) {
    localPool = postgres(getDatabaseUrl());
  }

  return localPool;
}

type PostgresQueryable = {
  unsafe: (query: string, params?: any[]) => Promise<unknown[]>;
};

async function executeNodeQuery(
  queryable: PostgresQueryable,
  statement: string,
  values: readonly unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const rows = await queryable.unsafe(statement, [...values]);
  return rows as Array<Record<string, unknown>>;
}

function getNodeSetupQuery(queryable: PostgresQueryable): SetupQueryExecutor {
  return (statement, values) => executeNodeQuery(queryable, statement, values);
}

function ensureNodeDatabaseReady(): Promise<void> {
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

const localSql = createSqlTag(async (query) => {
  await ensureNodeDatabaseReady();
  const rows = await getLocalPool().unsafe(query.text, query.values as any[]);
  return rows as unknown[];
});

export const nodeDbAdapter: DbAdapter = {
  getDb() {
    return localSql;
  },
  async withUserContext<T>(_userId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
};
