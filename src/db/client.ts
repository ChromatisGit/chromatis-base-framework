import { getDbDriver } from "../runtime/env.js";
import { nodeDbAdapter } from "./client.node.js";
import { workerDbAdapter } from "./client.worker.js";
import type { DbSql, UserCtx } from "./types.js";
export type { DbSql, UserCtx } from "./types.js";

function getAdapter() {
  return getDbDriver() === "worker" ? workerDbAdapter : nodeDbAdapter;
}

export async function withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T> {
  return getAdapter().withAnonTx(fn);
}

export async function withUserTx<T>(user: UserCtx, fn: (sql: DbSql) => Promise<T>): Promise<T> {
  return getAdapter().withUserTx(user, fn);
}

/**
 * Tagged template for anonymous queries — no RLS user context.
 * Use for: public reads, SECURITY DEFINER calls, login, registration.
 */
export const anonSQL: DbSql = ((template: TemplateStringsArray, ...params: unknown[]) =>
  withAnonTx((sql) => {
    const execute = sql as (template: TemplateStringsArray, ...params: unknown[]) => Promise<unknown[]>;
    return execute(template, ...params);
  })) as unknown as DbSql;

/**
 * Returns a tagged template with full RLS context set (user_id, role, group_key).
 * Use for: all authenticated reads and writes.
 *
 * @example
 * const rows = await userSQL(user)<Row[]>`SELECT * FROM my_table WHERE ...`;
 */
export function userSQL(user: UserCtx): DbSql {
  return ((template: TemplateStringsArray, ...params: unknown[]) =>
    withUserTx(user, (sql) => {
      const execute = sql as (template: TemplateStringsArray, ...params: unknown[]) => Promise<unknown[]>;
      return execute(template, ...params);
    })) as unknown as DbSql;
}
