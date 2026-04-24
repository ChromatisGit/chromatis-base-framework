import baselineSql from "../../../sql/migrations/0.0.0__baseline.sql?raw";
import initialDataSeedSql from "../../../sql/seeds/001_initial_data.sql?raw";

export interface RuntimeMigrationAsset {
  version: string;
  description: string;
  sql: string;
}

export interface RuntimeSeedAsset {
  name: string;
  sql: string;
}

export const runtimeMigrations: RuntimeMigrationAsset[] = [
  {
    version: "0.0.0",
    description: "baseline",
    sql: baselineSql,
  },
];

export const runtimeSeedAssets: RuntimeSeedAsset[] = [
  {
    name: "001_initial_data.sql",
    sql: initialDataSeedSql,
  },
];

export const latestRuntimeMigrationVersion =
  runtimeMigrations[runtimeMigrations.length - 1]?.version ?? "0.0.0";
