import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { authMigrations } from "../../src/auth/migrations.ts";
import {
  createDatabase,
  runDatabaseStartup,
  type Database,
  type DatabaseEnvironment,
  type DatabaseRuntime,
} from "../../src/db/client.ts";
import { closeNodeDatabasePools } from "../../src/db/client.node.ts";
import {
  assertSafeRuntimeRole,
  runMigrationEngine,
  type SetupQueryExecutor,
} from "../../src/db/setup.ts";
import { checkGeneratedMigrationStates } from "./dbGeneratedMigrations.ts";

const MIGRATION_PATTERN = /^(\d+\.\d+\.\d+)__([a-z0-9][a-z0-9_-]*)\.sql$/i;

export interface MigrationFile {
  readonly module: string;
  readonly version: string;
  readonly description: string;
  readonly filename: string;
  readonly sql: string;
}

function loadModuleMigrations(
  moduleName: string,
  directory: string,
): MigrationFile[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    )
    .map((filename) => {
      const match = MIGRATION_PATTERN.exec(filename);
      if (!match) {
        throw new Error(`[db] Invalid migration filename: ${filename}`);
      }
      return {
        module: moduleName,
        version: match[1]!,
        description: match[2]!.replaceAll("-", " ").replaceAll("_", " "),
        filename,
        sql: readFileSync(path.join(directory, filename), "utf8"),
      };
    });
}

export function loadMigrationFiles(
  modulesDirectory = path.resolve(process.cwd(), "src/modules"),
): MigrationFile[] {
  const framework = authMigrations.map((migration) => ({
    ...migration,
    filename: `${migration.version}__${migration.description.replaceAll(" ", "_")}.sql`,
  }));
  if (!existsSync(modulesDirectory)) {
    return framework;
  }
  const application = readdirSync(modulesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) =>
      loadModuleMigrations(
        entry.name,
        path.join(modulesDirectory, entry.name, "migrations"),
      ),
    );
  const migrations = [...framework, ...application];
  const keys = new Set<string>();
  for (const migration of migrations) {
    const key = `${migration.module}:${migration.version}`;
    if (keys.has(key)) {
      throw new Error(`Duplicate migration: ${key}`);
    }
    keys.add(key);
  }
  return migrations;
}

function makeQueryExecutor(sql: postgres.Sql): SetupQueryExecutor {
  return async (statement, values = []) => {
    const rows = await sql.unsafe(
      statement,
      values as postgres.ParameterOrJSON<never>[],
    );
    return rows as Array<Record<string, unknown>>;
  };
}

export interface DatabaseStartupOptions {
  readonly databaseUrl: string;
  readonly migrationDatabaseUrl?: string;
  readonly runtime: DatabaseRuntime;
  readonly environment: DatabaseEnvironment;
  readonly applicationRoot?: string;
}

function discoverApplicationMigrations(
  applicationRoot: string,
): MigrationFile[] {
  checkGeneratedMigrationStates(applicationRoot);
  return loadMigrationFiles(path.join(applicationRoot, "src/modules"));
}

export async function startDatabase(
  options: DatabaseStartupOptions,
): Promise<Database> {
  const applicationRoot = options.applicationRoot ?? process.cwd();
  const migrations = discoverApplicationMigrations(applicationRoot);
  const database = createDatabase(options.databaseUrl, {
    runtime: options.runtime,
    environment: options.environment,
    ...(options.migrationDatabaseUrl
      ? { migrationConnectionString: options.migrationDatabaseUrl }
      : {}),
  });
  await runDatabaseStartup(database, migrations);
  return database;
}

export async function getPendingMigrations(
  databaseUrl: string,
  applicationRoot = process.cwd(),
): Promise<readonly MigrationFile[]> {
  const migrations = discoverApplicationMigrations(applicationRoot);
  const sql = postgres(databaseUrl, { max: 1 });
  const query = makeQueryExecutor(sql);
  try {
    await assertSafeRuntimeRole(query);
    const result = await runMigrationEngine({
      mode: "check",
      connectionKey: databaseUrl,
      context: "cli-status",
      migrations,
      query,
      transaction: async (operation) => operation(query),
    });
    return result.pending;
  } finally {
    await sql.end();
  }
}

export async function runDbMigrations(
  databaseUrl: string,
  migrationDatabaseUrl: string,
  options?: Readonly<{ applicationRoot?: string }>,
): Promise<void> {
  try {
    await startDatabase({
      databaseUrl,
      migrationDatabaseUrl,
      runtime: "bun",
      environment: "local",
      applicationRoot: options?.applicationRoot ?? process.cwd(),
    });
  } finally {
    await closeNodeDatabasePools();
  }
}
