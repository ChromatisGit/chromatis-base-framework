export { createDatabase } from "./db/client.js";
import {
  createDatabase,
  runDatabaseStartup,
  type DatabaseOptions,
} from "./db/client.js";

/** Starts a declared application database from build-embedded migrations.
 * Works without filesystem discovery in Workers and in bundled Bun apps.
 * The CLI still owns applying production migrations before deployment.
 */
export async function startApplicationDatabase(
  connectionString: string,
  options: DatabaseOptions,
) {
  const { migrations } = await import("chromatis-migrations");
  const database = createDatabase(connectionString, options);
  await runDatabaseStartup(database, migrations);
  return database;
}
export type {
  Database,
  DatabaseEnvironment,
  DatabaseOptions,
  DatabaseRuntime,
  Transaction,
} from "./db/client.js";
export type { DatabaseUser, DbSql, MigrationAsset } from "./db/types.js";
export {
  DatabaseSetupError,
  getDatabaseSetupMessage,
  isDatabaseSetupError,
} from "./db/errors.js";
