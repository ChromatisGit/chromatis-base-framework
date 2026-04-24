import { Client, neon } from "@neondatabase/serverless";
import { getDatabaseAutoInitEnabled, getDatabaseUrl } from "../runtime/env.js";
import { ensureDatabaseReady, type SetupQueryExecutor } from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type { DbAdapter } from "./types.js";

type NeonQueryClient = {
  query: (query: string, params?: any[]) => Promise<unknown>;
};

const neonClients = new Map<string, NeonQueryClient>();

function getNeonClient(): NeonQueryClient {
  const connectionString = getDatabaseUrl();
  const cached = neonClients.get(connectionString);

  if (cached) {
    return cached;
  }

  const created = neon(connectionString) as unknown as NeonQueryClient;
  neonClients.set(connectionString, created);
  return created;
}

type QueryResultWithRows = {
  rows?: unknown[];
};

function normalizeQueryRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }

  if (
    typeof result === "object"
    && result !== null
    && "rows" in result
    && Array.isArray((result as QueryResultWithRows).rows)
  ) {
    return (result as QueryResultWithRows).rows as Array<Record<string, unknown>>;
  }

  return [];
}

async function executeWorkerQuery(
  queryable: NeonQueryClient,
  statement: string,
  values: readonly unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const result = await queryable.query(statement, values as any[]);
  return normalizeQueryRows(result);
}

function getWorkerSetupQuery(queryable: NeonQueryClient): SetupQueryExecutor {
  return (statement, values) => executeWorkerQuery(queryable, statement, values);
}

function ensureWorkerDatabaseReady(): Promise<void> {
  const connectionKey = getDatabaseUrl();
  return ensureDatabaseReady({
    autoInitEnabled: getDatabaseAutoInitEnabled(),
    connectionKey,
    context: "cloudflare-worker",
    query: getWorkerSetupQuery(getNeonClient()),
    transaction: async (fn) => {
      const client = new Client({ connectionString: connectionKey });
      let connected = false;

      try {
        await client.connect();
        connected = true;
        await client.query("BEGIN");

        try {
          const result = await fn(getWorkerSetupQuery(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        if (connected) {
          await client.end();
        }
      }
    },
  });
}

const workerSql = createSqlTag(async (query) => {
  await ensureWorkerDatabaseReady();
  const rows = await getNeonClient().query(query.text, query.values as any[]);
  return normalizeQueryRows(rows) as unknown[];
});

export const workerDbAdapter: DbAdapter = {
  getDb() {
    return workerSql;
  },
  async withUserContext<T>(_userId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
};
