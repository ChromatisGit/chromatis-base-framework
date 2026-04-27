/**
 * Embedded SQL assets for the auto-init mechanism (DB_AUTO_INIT=1).
 *
 * The framework exports empty arrays — there is no app-level schema here.
 * Each consuming project provides its own SQL migrations via its db:init
 * and db:migrate scripts. Auto-init only creates the app_schema_migrations
 * tracking table; all other schema is managed by project-level scripts.
 *
 * To add project-specific embedded migrations, create src/db/runtime-sql.ts
 * in the consuming project and re-export this file extended with your SQL:
 *
 *   import baselineSql from "../../sql/migrations/0.0.0__baseline.sql?raw";
 *   export { RuntimeMigrationAsset, RuntimeSeedAsset } from "@platform/db/runtime-sql";
 *   export const runtimeMigrations = [{ version: "0.0.0", description: "baseline", sql: baselineSql }];
 *   export const runtimeSeedAssets = [];
 *   export const latestRuntimeMigrationVersion = "0.0.0";
 */

export interface RuntimeMigrationAsset {
  version: string;
  description: string;
  sql: string;
}

export interface RuntimeSeedAsset {
  name: string;
  sql: string;
}

export const runtimeMigrations: RuntimeMigrationAsset[] = [];

export const runtimeSeedAssets: RuntimeSeedAsset[] = [];

export const latestRuntimeMigrationVersion = "0.0.0";
