import { DatabaseSetupError, toDatabaseSetupError } from "./errors.js";
import type { MigrationAsset, SeedAsset } from "./types.js";

type QueryRow = Record<string, unknown>;

export type SetupQueryExecutor = (
  statement: string,
  values?: readonly unknown[],
) => Promise<QueryRow[]>;

export type SetupTransactionExecutor = <T>(
  fn: (query: SetupQueryExecutor) => Promise<T>,
) => Promise<T>;

type InternalOptions = {
  autoApply: boolean;
  connectionKey: string;
  context: string;
  migrations: readonly MigrationAsset[];
  seeds: readonly SeedAsset[];
  query: SetupQueryExecutor;
  transaction: SetupTransactionExecutor;
};

type ProbeState = {
  state: "uninitialized" | "ready" | "outdated";
  appliedVersions: Set<string>;
  latestAppliedVersion: string | null;
  pendingMigrations: readonly MigrationAsset[];
};

const READY = Symbol("ready");
const readinessCache = new Map<string, Promise<void> | typeof READY>();
const MIGRATION_LOCK_NAMESPACE = 23117;
const MIGRATION_LOCK_KEY = 40873;

function getCacheKey(connectionKey: string, latestVersion: string): string {
  return `${connectionKey}::${latestVersion}`;
}

function getLatestVersion(migrations: readonly MigrationAsset[]): string {
  return migrations[migrations.length - 1]?.version ?? "none";
}

function getPending(
  migrations: readonly MigrationAsset[],
  applied: Set<string>,
): MigrationAsset[] {
  return migrations.filter((m) => !applied.has(m.version));
}

function log(
  context: string,
  phase: "probe" | "lock" | "migrate" | "seed" | "ready" | "failed",
  details?: Record<string, unknown>,
): void {
  console.info("[db/setup]", phase, { context, ...(details ?? {}) });
}

async function probeDatabaseState(
  query: SetupQueryExecutor,
  migrations: readonly MigrationAsset[],
): Promise<ProbeState> {
  const tableRows = await query(
    "SELECT to_regclass('public.app_schema_migrations')::text AS table_name",
  );
  const tableName = tableRows[0]?.table_name;

  if (typeof tableName !== "string" || tableName.length === 0) {
    return {
      state: "uninitialized",
      appliedVersions: new Set(),
      latestAppliedVersion: null,
      pendingMigrations: [...migrations],
    };
  }

  const rows = await query(
    "SELECT version FROM app_schema_migrations ORDER BY applied_at ASC, version ASC",
  );
  const appliedVersions = new Set(
    rows
      .map((r) => r.version)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );

  const baseline = migrations[0];
  if (!baseline || !appliedVersions.has(baseline.version)) {
    return {
      state: "uninitialized",
      appliedVersions,
      latestAppliedVersion: null,
      pendingMigrations: [...migrations],
    };
  }

  const pending = getPending(migrations, appliedVersions);
  const applied = migrations.filter((m) => appliedVersions.has(m.version));

  return {
    state: pending.length === 0 ? "ready" : "outdated",
    appliedVersions,
    latestAppliedVersion: applied[applied.length - 1]?.version ?? null,
    pendingMigrations: pending,
  };
}

async function insertMigrationMarker(
  query: SetupQueryExecutor,
  migration: MigrationAsset,
): Promise<void> {
  await query(
    "INSERT INTO app_schema_migrations (version, description) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
    [migration.version, migration.description],
  );
}

async function applyMigrations(
  context: string,
  query: SetupQueryExecutor,
  migrations: readonly MigrationAsset[],
  seeds: readonly SeedAsset[],
  applied: Set<string>,
  isFirstRun: boolean,
): Promise<void> {
  for (const migration of getPending(migrations, applied)) {
    log(context, "migrate", { version: migration.version, description: migration.description });
    const trimmed = migration.sql.trim();
    try {
      if (trimmed) await query(trimmed);
      await insertMigrationMarker(query, migration);
    } catch (error) {
      throw toDatabaseSetupError(error, { context, phase: "migrate" });
    }
    applied.add(migration.version);

    // Apply seeds only after the very first migration (baseline init)
    if (isFirstRun && applied.size === 1) {
      for (const seed of seeds) {
        log(context, "seed", { name: seed.name });
        const seedSql = seed.sql.trim();
        try {
          if (seedSql) await query(seedSql);
        } catch (error) {
          throw toDatabaseSetupError(error, { context, phase: "seed" });
        }
      }
    }
  }
}

async function run(options: InternalOptions): Promise<void> {
  const { context, migrations, seeds, query, transaction } = options;

  log(context, "probe");

  let initial: ProbeState;
  try {
    initial = await probeDatabaseState(query, migrations);
  } catch (error) {
    throw toDatabaseSetupError(error, { context, phase: "probe" });
  }

  if (initial.state === "ready") {
    log(context, "ready", { version: initial.latestAppliedVersion });
    return;
  }

  try {
    await transaction(async (txQuery) => {
      log(context, "lock", {
        state: initial.state,
        pending: initial.pendingMigrations.map((m) => m.version),
      });
      try {
        await txQuery("SELECT pg_advisory_xact_lock($1, $2)", [
          MIGRATION_LOCK_NAMESPACE,
          MIGRATION_LOCK_KEY,
        ]);
      } catch (error) {
        throw toDatabaseSetupError(error, { context, phase: "lock" });
      }

      const locked = await probeDatabaseState(txQuery, migrations);
      const isFirstRun = locked.state === "uninitialized";
      const applied = new Set(locked.appliedVersions);

      await applyMigrations(context, txQuery, migrations, seeds, applied, isFirstRun);
    });
  } catch (error) {
    if (error instanceof DatabaseSetupError) throw error;
    throw toDatabaseSetupError(error, { context, phase: "failed" });
  }

  log(context, "ready", { version: getLatestVersion(migrations) });
}

export async function ensureDatabaseReady(options: InternalOptions): Promise<void> {
  if (!options.autoApply) return;
  if (options.migrations.length === 0) return;

  const cacheKey = getCacheKey(options.connectionKey, getLatestVersion(options.migrations));
  const cached = readinessCache.get(cacheKey);

  if (cached === READY) return;
  if (cached) return cached;

  const promise = run(options)
    .then(() => { readinessCache.set(cacheKey, READY); })
    .catch((error: unknown) => {
      readinessCache.delete(cacheKey);
      const setupError = error instanceof DatabaseSetupError
        ? error
        : toDatabaseSetupError(error, { context: options.context, phase: "failed" });
      log(options.context, "failed", { phase: setupError.phase, message: setupError.message });
      throw setupError;
    });

  readinessCache.set(cacheKey, promise);
  return promise;
}
