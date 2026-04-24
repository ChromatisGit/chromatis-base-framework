import { getDbDriver } from "../runtime/env.js";
import { nodeDbAdapter } from "./client.node.js";
import { workerDbAdapter } from "./client.worker.js";
import type { DbSql } from "./types.js";
export type { DbSql } from "./types.js";

function getAdapter() {
  return getDbDriver() === "worker" ? workerDbAdapter : nodeDbAdapter;
}

export function getDb(): DbSql {
  return getAdapter().getDb();
}

export async function withUserContext<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return getAdapter().withUserContext(userId, fn);
}
