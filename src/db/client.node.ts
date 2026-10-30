import { validCapability } from "./capability.js";
import postgres from "postgres";
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

/**
 * Connections per pool unless the application chooses. The app and Postgres
 * share a small server (2 vCPUs at the start), where more connections than
 * about twice the cores only queue inside Postgres; postgres.js would open
 * 10. Connections open lazily, so this is an upper bound. The load test
 * decides the final value.
 */
export const DEFAULT_POOL_SIZE = 5;

/** `DATABASE_POOL_SIZE` from the deployment, else the default. */
export const configuredPoolSize = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): number =>
  env.DATABASE_POOL_SIZE ? Number(env.DATABASE_POOL_SIZE) : DEFAULT_POOL_SIZE;

const localPools = new Map<string, ReturnType<typeof postgres>>();

export async function closeNodeDatabasePools(): Promise<void> {
  const pools = [...localPools.values()];
  localPools.clear();
  await Promise.all(pools.map((pool) => pool.end()));
}

function getPool(
  connectionString: string,
  size: number,
): ReturnType<typeof postgres> {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("[db] The pool size must be a positive integer.");
  }
  const key = `${size}:${connectionString}`;
  const existing = localPools.get(key);
  if (existing) {
    return existing;
  }
  const pool = postgres(connectionString, { max: size });
  localPools.set(key, pool);
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
  await tx.unsafe("SELECT set_config('app.user_id', $1, true)", [userId], {
    prepare: true,
  });
}

/**
 * The SQL tag produces fixed query texts with bound parameters, so they are
 * prepared once per connection and reused (postgres.js leaves `unsafe`
 * unprepared unless asked). Setup and migration SQL stays unprepared.
 */
function makeTxSql(tx: postgres.TransactionSql): DbSql {
  return createSqlTag(async (query) => {
    const rows = await tx.unsafe(
      query.text,
      query.values as postgres.ParameterOrJSON<never>[],
      { prepare: true },
    );
    return rows as unknown[];
  });
}

export function createNodeAdapter(
  connectionString: string,
  migrationConnectionString?: string,
  role: string = DATABASE_RUNTIME_ROLE,
  poolSize: number = configuredPoolSize(),
): DbAdapter {
  const pool = getPool(connectionString, poolSize);
  let runtimeRoleCheck: Promise<void> | undefined;
  const ensureSafeRuntimeRole = (): Promise<void> => {
    runtimeRoleCheck ??= assertSafeRole(
      makeSetupExecutor(pool as unknown as PostgresQueryable),
      role,
      "connection",
    ).catch((error: unknown) => {
      runtimeRoleCheck = undefined;
      throw error;
    });
    return runtimeRoleCheck;
  };

  return {
    async withPublicTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
      await ensureSafeRuntimeRole();
      return pool.begin(async (tx) => fn(makeTxSql(tx))) as Promise<T>;
    },

    async withCapabilityTx<T>(
      key: "share_token" | "classroom_code",
      value: string,
      fn: (sql: DbSql) => Promise<T>,
    ): Promise<T> {
      await ensureSafeRuntimeRole();
      if (!validCapability(key, value)) {
        throw new Error("[db] Invalid capability value.");
      }
      return pool.begin(async (tx) => {
        await tx.unsafe(
          "SELECT set_config($1, $2, true)",
          [`app.${key}`, value],
          { prepare: true },
        );
        return fn(makeTxSql(tx));
      }) as Promise<T>;
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
              poolSize,
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
