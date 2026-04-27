import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import {
  runtimeMigrations,
  runtimeSeedAssets,
  type RuntimeMigrationAsset,
} from "../../src/db/runtime-sql.ts";

const MIGRATION_LOCK_NAMESPACE = 23117;
const MIGRATION_LOCK_KEY = 40873;

type DbCommand = "init" | "update";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

function loadLocalEnv(): void {
  const explicitEnvFile = process.env.DB_ENV_FILE;
  if (explicitEnvFile) {
    loadEnvFile(path.resolve(process.cwd(), explicitEnvFile));
    return;
  }

  loadEnvFile(path.resolve(process.cwd(), ".env"));
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
}

function getDatabaseUrl(): string {
  loadLocalEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL. Set it in the environment, .env, or DB_ENV_FILE.");
  }
  return databaseUrl;
}

async function ensureMigrationTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version text PRIMARY KEY,
      description text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedVersions(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ version: string }[]>`
    SELECT version
    FROM app_schema_migrations
    ORDER BY applied_at ASC, version ASC
  `;

  return new Set(rows.map((row) => row.version));
}

async function applyMigration(
  sql: postgres.Sql,
  migration: RuntimeMigrationAsset,
): Promise<void> {
  const trimmedSql = migration.sql.trim();
  if (trimmedSql) {
    await sql.unsafe(trimmedSql);
  }

  await sql`
    INSERT INTO app_schema_migrations (version, description)
    VALUES (${migration.version}, ${migration.description})
    ON CONFLICT (version) DO NOTHING
  `;
}

async function applySeed(sql: postgres.Sql, name: string, seedSql: string): Promise<void> {
  const trimmedSql = seedSql.trim();
  if (!trimmedSql) return;

  console.info(`[db] Applying seed ${name}`);
  await sql.unsafe(trimmedSql);
}

export async function runDbMigrations(command: DbCommand): Promise<void> {
  const sql = postgres(getDatabaseUrl(), { max: 1 });

  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`;
      await ensureMigrationTable(tx);

      const appliedVersions = await getAppliedVersions(tx);
      if (command === "init" && appliedVersions.size > 0) {
        console.info("[db] Database is already initialized. Run dbUpdate to apply pending migrations.");
        return;
      }

      if (runtimeMigrations.length === 0) {
        console.info("[db] Migration table is ready. No embedded runtime migrations found.");
        return;
      }

      let appliedCount = 0;
      for (const migration of runtimeMigrations) {
        if (appliedVersions.has(migration.version)) continue;

        console.info(`[db] Applying migration ${migration.version}: ${migration.description}`);
        await applyMigration(tx, migration);
        appliedVersions.add(migration.version);
        appliedCount += 1;

        if (command === "init" && appliedCount === 1) {
          for (const seed of runtimeSeedAssets) {
            await applySeed(tx, seed.name, seed.sql);
          }
        }
      }

      if (appliedCount === 0) {
        console.info("[db] Database schema is up to date.");
      } else {
        console.info(`[db] Applied ${appliedCount} migration${appliedCount === 1 ? "" : "s"}.`);
      }
    });
  } finally {
    await sql.end();
  }
}
