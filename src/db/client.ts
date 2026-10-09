import { createNodeAdapter } from "./client.node.js";
import { createWorkerAdapter } from "./client.worker.js";
import { DATABASE_RUNTIME_ROLE } from "./setup.js";
import { createSqlTag } from "./sql-tag.js";
import type {
  AdapterSetupOptions,
  DatabaseUser,
  DbAdapter,
  DbSql,
  MigrationAsset,
} from "./types.js";

export type DatabaseRuntime = "bun" | "cloudflare";
export type DatabaseEnvironment = "local" | "test" | "production";
export type Transaction<T> = (sql: DbSql) => Promise<T>;

export interface Database {
  readonly publicSQL: DbSql;
  userSQL(user: DatabaseUser): DbSql;
  publicTransaction<T>(operation: Transaction<T>): Promise<T>;
  userTransaction<T>(user: DatabaseUser, operation: Transaction<T>): Promise<T>;
}

export interface DatabaseOptions {
  readonly runtime: DatabaseRuntime;
  readonly environment: DatabaseEnvironment;
  readonly migrationConnectionString?: string;
}

type DatabaseSetup = (migrations: readonly MigrationAsset[]) => Promise<void>;

const databaseSetups = new WeakMap<Database, DatabaseSetup>();

function connectionUsername(connectionString: string, label: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch (error) {
    throw new Error(`[db] ${label} must be a valid PostgreSQL URL.`, {
      cause: error,
    });
  }
  const username = decodeURIComponent(url.username);
  if (!username) {
    throw new Error(`[db] ${label} must include a PostgreSQL role.`);
  }
  return username;
}

function validateCredentials(
  connectionString: string,
  options: DatabaseOptions,
): void {
  const runtimeRole = connectionUsername(connectionString, "DATABASE_URL");
  if (runtimeRole !== DATABASE_RUNTIME_ROLE) {
    throw new Error(
      `[db] DATABASE_URL must use the ${DATABASE_RUNTIME_ROLE} PostgreSQL role.`,
    );
  }
  const migrationUrl = options.migrationConnectionString;
  if (!migrationUrl) {
    if (options.environment !== "production") {
      throw new Error(
        "[db] DATABASE_MIGRATION_URL is required for automatic local/test migrations.",
      );
    }
    return;
  }
  const migrationRole = connectionUsername(
    migrationUrl,
    "DATABASE_MIGRATION_URL",
  );
  if (runtimeRole === migrationRole) {
    throw new Error(
      "[db] DATABASE_URL and DATABASE_MIGRATION_URL must use distinct PostgreSQL roles.",
    );
  }
}

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUser(user: DatabaseUser): DatabaseUser {
  if (typeof user?.id !== "string" || !USER_ID_PATTERN.test(user.id)) {
    throw new Error(
      "[db] userSQL requires an authenticated User with a UUID id.",
    );
  }
  return user;
}

function createSingleQuerySql(
  run: <T>(operation: Transaction<T>) => Promise<T>,
): DbSql {
  const fragments = createSqlTag(async () => []);
  const sql = ((first: TemplateStringsArray, ...values: unknown[]) =>
    run((transaction) => transaction(first, ...values))) as DbSql;
  sql.identifier = fragments.identifier;
  return sql;
}

export function createDatabase(
  connectionString: string,
  options: DatabaseOptions,
): Database {
  validateCredentials(connectionString, options);
  const adapter: DbAdapter =
    options.runtime === "cloudflare"
      ? createWorkerAdapter(connectionString, options.migrationConnectionString)
      : createNodeAdapter(connectionString, options.migrationConnectionString);

  const publicSQL = createSingleQuerySql((operation) =>
    adapter.withPublicTx(operation),
  );

  const database: Database = {
    publicSQL,
    userSQL: (user) =>
      createSingleQuerySql((operation) =>
        adapter.withUserTx(assertUser(user), operation),
      ),
    publicTransaction: (operation) => adapter.withPublicTx(operation),
    userTransaction: (user, operation) =>
      adapter.withUserTx(assertUser(user), operation),
  };
  databaseSetups.set(database, (migrations) => {
    const setupOptions: AdapterSetupOptions = {
      mode: options.environment === "production" ? "check" : "apply",
      connectionKey: connectionString,
      migrations,
    };
    return adapter.runSetup(setupOptions);
  });
  return database;
}

export function runDatabaseStartup(
  database: Database,
  migrations: readonly MigrationAsset[],
): Promise<void> {
  const setup = databaseSetups.get(database);
  if (!setup) {
    throw new Error("[db] Database was not created by createDatabase().");
  }
  return setup(migrations);
}
