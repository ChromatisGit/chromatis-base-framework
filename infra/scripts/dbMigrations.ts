import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import { checkGeneratedMigrationState } from "./dbGeneratedMigrations";

const MIGRATION_LOCK_NAMESPACE = 23117;
const MIGRATION_LOCK_KEY = 40873;

export interface MigrationFile {
  version: string;
  description: string;
  filename: string;
  sql: string;
}

type MigrationSql = {
  <TRows extends readonly (object | undefined)[] = postgres.Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly unknown[]
  ): PromiseLike<TRows>;
  unsafe<TRows extends readonly unknown[] = postgres.Row[]>(
    query: string,
    parameters?: readonly unknown[],
    queryOptions?: postgres.UnsafeQueryOptions,
  ): PromiseLike<TRows>;
};

const MIGRATION_FILE_RE = /^(\d+\.\d+\.\d+)__([a-z0-9][a-z0-9_-]*)\.sql$/i;

export function loadMigrationFiles(
  migrationsDir = path.resolve(process.cwd(), "sql/migrations"),
): MigrationFile[] {
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
        filename: name,
        sql: readFileSync(path.join(migrationsDir, name), "utf8"),
      };
    });
}

function loadSeedFiles(seedsDir: string): { name: string; sql: string }[] {
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

function asMigrationSql(sql: unknown): MigrationSql {
  return sql as MigrationSql;
}

async function ensureMigrationTable(tx: MigrationSql): Promise<void> {
  await tx`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version     text        PRIMARY KEY,
      description text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedVersions(tx: MigrationSql): Promise<Set<string>> {
  const rows = await tx<{ version: string }[]>`
    SELECT version FROM app_schema_migrations ORDER BY applied_at ASC, version ASC
  `;
  return new Set(rows.map((r) => r.version));
}

// Returns pending migrations without opening a persistent connection.
// Caller is responsible for closing the sql instance.
export async function getPendingMigrations(
  databaseUrl: string,
  migrationsDir?: string,
): Promise<{ pending: MigrationFile[]; sql: postgres.Sql }> {
  checkGeneratedMigrationState();

  const sql = postgres(databaseUrl, { max: 1 });
  const all = loadMigrationFiles(migrationsDir);

  const applied = await sql.begin(async (rawTx) => {
    const tx = asMigrationSql(rawTx);
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`;
    await ensureMigrationTable(tx);
    return getAppliedVersions(tx);
  });

  const pending = all.filter((m) => !applied.has(m.version));
  return { pending, sql };
}

export async function applyMigrations(
  sql: postgres.Sql,
  migrations: MigrationFile[],
): Promise<void> {
  await sql.begin(async (rawTx) => {
    const tx = asMigrationSql(rawTx);
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`;
    await tx`SET LOCAL client_min_messages = warning`;
    await ensureMigrationTable(tx);
    const applied = await getAppliedVersions(tx);

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
    }
  });
}

export async function runDbMigrations(
  databaseUrl: string,
  options?: {
    seeds?: boolean;
    migrationsDir?: string;
    seedsDir?: string;
    checkGeneratedMigrations?: boolean;
  },
): Promise<void> {
  if (options?.checkGeneratedMigrations ?? true) {
    checkGeneratedMigrationState();
  }

  const migrationsDir = options?.migrationsDir ?? path.resolve(process.cwd(), "sql/migrations");
  const seedsDir = options?.seedsDir ?? path.resolve(process.cwd(), "sql/seeds");
  const migrations = loadMigrationFiles(migrationsDir);
  const seeds = options?.seeds ? loadSeedFiles(seedsDir) : [];

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql.begin(async (rawTx) => {
      const tx = asMigrationSql(rawTx);
      await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`;
      await tx`SET LOCAL client_min_messages = warning`;
      await ensureMigrationTable(tx);

      const applied = await getAppliedVersions(tx);
      const wasEmpty = applied.size === 0;

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
      }

      if (count === 0) {
        console.info("[db] Schema is up to date.");
      } else {
        console.info(`[db] Applied ${count} migration${count === 1 ? "" : "s"}.`);
      }

      if (wasEmpty && seeds.length > 0) {
        for (const seed of seeds) {
          console.info(`[db] Applying seed ${seed.name}`);
          const seedSql = seed.sql.trim();
          if (seedSql) await tx.unsafe(seedSql);
        }
      }

    });
  } finally {
    await sql.end();
  }
}
