import { createNodeAdapter } from "./client.node.js";
import { createWorkerAdapter } from "./client.worker.js";
import type { AdapterSetupOptions, DbAdapter, DbSql, MigrationAsset, SeedAsset, UserCtx } from "./types.js";
export type { DbSql, UserCtx, MigrationAsset, SeedAsset } from "./types.js";

export type DbRuntime = "node" | "worker";

export interface DbClient {
  /** Anonymous transaction — no RLS user context. Use for public reads, login, registration. */
  anonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T>;
  /** Authenticated transaction — sets full RLS context. Use for all user-facing reads/writes. */
  userTx<T>(user: UserCtx, fn: (sql: DbSql) => Promise<T>): Promise<T>;
  /**
   * Apply pending migrations at startup. Call once before serving requests.
   * Set autoApply=false to skip (use separate migration script instead).
   */
  ensureReady(options: EnsureReadyOptions): Promise<void>;
}

export interface EnsureReadyOptions {
  migrations: readonly MigrationAsset[];
  seeds?: readonly SeedAsset[];
  /** Apply pending migrations automatically. Default: true. */
  autoApply?: boolean;
}

export function createDb(connectionString: string, runtime: DbRuntime): DbClient {
  const adapter: DbAdapter =
    runtime === "worker"
      ? createWorkerAdapter(connectionString)
      : createNodeAdapter(connectionString);

  return {
    anonTx: (fn) => adapter.withAnonTx(fn),
    userTx: (user, fn) => adapter.withUserTx(user, fn),
    ensureReady({ migrations, seeds = [], autoApply = true }: EnsureReadyOptions) {
      const opts: AdapterSetupOptions = {
        autoApply,
        connectionKey: connectionString,
        migrations,
        seeds,
      };
      return adapter.runSetup(opts);
    },
  };
}

/**
 * Convenience tagged-template functions for single-query use.
 * Each call opens and commits its own transaction.
 * Use createDb().anonTx / createDb().userTx when you need atomicity across queries.
 */
export function makeAnonSql(db: DbClient): DbSql {
  return ((template: TemplateStringsArray, ...params: unknown[]) =>
    db.anonTx((sql) => (sql as unknown as (t: TemplateStringsArray, ...p: unknown[]) => Promise<unknown[]>)(template, ...params))
  ) as unknown as DbSql;
}

export function makeUserSql(db: DbClient, user: UserCtx): DbSql {
  return ((template: TemplateStringsArray, ...params: unknown[]) =>
    db.userTx(user, (sql) => (sql as unknown as (t: TemplateStringsArray, ...p: unknown[]) => Promise<unknown[]>)(template, ...params))
  ) as unknown as DbSql;
}
