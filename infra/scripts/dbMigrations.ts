import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

const MIGRATION_LOCK_NAMESPACE = 23117;
const MIGRATION_LOCK_KEY = 40873;

type DbCommand = "init" | "update";

interface MigrationFile {
  version: string;
  description: string;
  sql: string;
}

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
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
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL. Set it in the environment, .env, or DB_ENV_FILE.");
  return url;
}

const MIGRATION_FILE_RE = /^(\d+\.\d+\.\d+)__([a-z0-9][a-z0-9_-]*)\.sql$/i;

function loadMigrations(migrationsDir: string): MigrationFile[] {
  if (!existsSync(migrationsDir)) return [];

  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && MIGRATION_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const match = MIGRATION_FILE_RE.exec(name)!;
      return {
        version: match[1]!,
        description: match[2]!.replace(/-/g, " "),
        sql: readFileSync(path.join(migrationsDir, name), "utf8"),
      };
    });
}

function loadSeeds(seedsDir: string): { name: string; sql: string }[] {
  if (!existsSync(seedsDir)) return [];

  return readdirSync(seedsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      sql: readFileSync(path.join(seedsDir, name), "utf8"),
    }));
}

async function ensureMigrationTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version     text        PRIMARY KEY,
      description text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedVersions(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ version: string }[]>`
    SELECT version FROM app_schema_migrations ORDER BY applied_at ASC, version ASC
  `;
  return new Set(rows.map((r) => r.version));
}

export async function runDbMigrations(
  command: DbCommand,
  migrationsDir = path.resolve(process.cwd(), "sql/migrations"),
  seedsDir = path.resolve(process.cwd(), "sql/seeds"),
): Promise<void> {
  const sql = postgres(getDatabaseUrl(), { max: 1 });
  const migrations = loadMigrations(migrationsDir);
  const seeds = loadSeeds(seedsDir);

  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`;
      await ensureMigrationTable(tx);

      const applied = await getAppliedVersions(tx);
      if (command === "init" && applied.size > 0) {
        console.info("[db] Already initialized. Run dbUpdate to apply pending migrations.");
        return;
      }

      if (migrations.length === 0) {
        console.info("[db] No migration files found.");
        return;
      }

      let count = 0;
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;

        console.info(`[db] Applying ${migration.version}: ${migration.description}`);
        const trimmed = migration.sql.trim();
        if (trimmed) await tx.unsafe(trimmed);
        await tx`
          INSERT INTO app_schema_migrations (version, description)
          VALUES (${migration.version}, ${migration.description})
          ON CONFLICT (version) DO NOTHING
        `;
        applied.add(migration.version);
        count += 1;

        // Seeds run once, after the baseline migration
        if (command === "init" && count === 1) {
          for (const seed of seeds) {
            console.info(`[db] Applying seed ${seed.name}`);
            const seedSql = seed.sql.trim();
            if (seedSql) await tx.unsafe(seedSql);
          }
        }
      }

      if (count === 0) {
        console.info("[db] Schema is up to date.");
      } else {
        console.info(`[db] Applied ${count} migration${count === 1 ? "" : "s"}.`);
      }
    });
  } finally {
    await sql.end();
  }
}
