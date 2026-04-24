import {
  latestRuntimeMigrationVersion,
  runtimeMigrations,
  runtimeSeedAssets,
  type RuntimeMigrationAsset,
} from "./runtime-sql.js";
import { DatabaseSetupError, toDatabaseSetupError } from "./errors.js";

type QueryRow = Record<string, unknown>;

export type SetupQueryExecutor = (
  statement: string,
  values?: readonly unknown[],
) => Promise<QueryRow[]>;

export type SetupTransactionExecutor = <T>(
  fn: (query: SetupQueryExecutor) => Promise<T>,
) => Promise<T>;

type EnsureDatabaseReadyOptions = {
  autoInitEnabled: boolean;
  connectionKey: string;
  context: string;
  query: SetupQueryExecutor;
  transaction: SetupTransactionExecutor;
};

type ProbeState = {
  state: "uninitialized" | "ready" | "outdated";
  appliedVersions: Set<string>;
  latestAppliedVersion: string | null;
  pendingMigrations: RuntimeMigrationAsset[];
};

const READY = Symbol("ready");
const readinessCache = new Map<string, Promise<void> | typeof READY>();
const MIGRATION_LOCK_NAMESPACE = 23117;
const MIGRATION_LOCK_KEY = 40873;
const baselineMigration = runtimeMigrations[0];

if (!baselineMigration) {
  throw new Error("Missing runtime baseline migration.");
}

function logSetupPhase(
  context: string,
  phase: "probe" | "lock" | "migrate" | "seed" | "ready" | "failed",
  details?: Record<string, unknown>,
): void {
  console.info("[db/setup]", phase, {
    context,
    ...(details ?? {}),
  });
}

function getPendingMigrations(appliedVersions: Set<string>): RuntimeMigrationAsset[] {
  return runtimeMigrations.filter((migration) => !appliedVersions.has(migration.version));
}

function getCacheKey(connectionKey: string): string {
  return `${connectionKey}::${latestRuntimeMigrationVersion}`;
}

async function probeDatabaseState(query: SetupQueryExecutor): Promise<ProbeState> {
  const markerTableRows = await query(
    "SELECT to_regclass('public.app_schema_migrations')::text AS table_name",
  );

  const markerTableName = markerTableRows[0]?.table_name;
  if (typeof markerTableName !== "string" || markerTableName.length === 0) {
    return {
      state: "uninitialized",
      appliedVersions: new Set(),
      latestAppliedVersion: null,
      pendingMigrations: [...runtimeMigrations],
    };
  }

  const rows = await query(
    "SELECT version FROM app_schema_migrations ORDER BY applied_at ASC, version ASC",
  );

  const appliedVersions = new Set(
    rows
      .map((row) => row.version)
      .filter((version): version is string => typeof version === "string" && version.length > 0),
  );

  if (!appliedVersions.has(baselineMigration.version)) {
    return {
      state: "uninitialized",
      appliedVersions,
      latestAppliedVersion: null,
      pendingMigrations: [...runtimeMigrations],
    };
  }

  const pendingMigrations = getPendingMigrations(appliedVersions);
  const appliedList = runtimeMigrations.filter((migration) => appliedVersions.has(migration.version));
  const latestAppliedVersion = appliedList[appliedList.length - 1]?.version ?? null;

  return {
    state: pendingMigrations.length === 0 ? "ready" : "outdated",
    appliedVersions,
    latestAppliedVersion,
    pendingMigrations,
  };
}

async function executeSqlBatch(
  query: SetupQueryExecutor,
  sql: string,
): Promise<void> {
  const trimmed = sql.trim();
  if (!trimmed) {
    return;
  }

  await query(trimmed);
}

async function insertMigrationMarker(
  query: SetupQueryExecutor,
  migration: RuntimeMigrationAsset,
): Promise<void> {
  await query(
    [
      "INSERT INTO app_schema_migrations (version, description)",
      "VALUES ($1, $2)",
      "ON CONFLICT (version) DO NOTHING",
    ].join(" "),
    [migration.version, migration.description],
  );
}

async function applyBaseline(
  context: string,
  query: SetupQueryExecutor,
  appliedVersions: Set<string>,
): Promise<void> {
  logSetupPhase(context, "migrate", {
    version: baselineMigration.version,
    description: baselineMigration.description,
  });
  try {
    await executeSqlBatch(query, baselineMigration.sql);
  } catch (error) {
    throw toDatabaseSetupError(error, { context, phase: "migrate" });
  }

  for (const seed of runtimeSeedAssets) {
    logSetupPhase(context, "seed", { name: seed.name });
    try {
      await executeSqlBatch(query, seed.sql);
    } catch (error) {
      throw toDatabaseSetupError(error, { context, phase: "seed" });
    }
  }

  try {
    await insertMigrationMarker(query, baselineMigration);
  } catch (error) {
    throw toDatabaseSetupError(error, { context, phase: "migrate" });
  }

  appliedVersions.add(baselineMigration.version);
}

async function applyPendingMigrations(
  context: string,
  query: SetupQueryExecutor,
  appliedVersions: Set<string>,
): Promise<void> {
  for (const migration of getPendingMigrations(appliedVersions)) {
    logSetupPhase(context, "migrate", {
      version: migration.version,
      description: migration.description,
    });
    try {
      await executeSqlBatch(query, migration.sql);
      await insertMigrationMarker(query, migration);
    } catch (error) {
      throw toDatabaseSetupError(error, { context, phase: "migrate" });
    }

    appliedVersions.add(migration.version);
  }
}

async function runEnsureDatabaseReady(options: EnsureDatabaseReadyOptions): Promise<void> {
  logSetupPhase(options.context, "probe");

  let initialState: ProbeState;
  try {
    initialState = await probeDatabaseState(options.query);
  } catch (error) {
    throw toDatabaseSetupError(error, { context: options.context, phase: "probe" });
  }

  if (initialState.state === "ready") {
    logSetupPhase(options.context, "ready", {
      state: initialState.state,
      version: initialState.latestAppliedVersion,
    });
    return;
  }

  try {
    await options.transaction(async (query) => {
      logSetupPhase(options.context, "lock", {
        state: initialState.state,
        pendingVersions: initialState.pendingMigrations.map((migration) => migration.version),
      });
      try {
        await query("SELECT pg_advisory_xact_lock($1, $2)", [
          MIGRATION_LOCK_NAMESPACE,
          MIGRATION_LOCK_KEY,
        ]);
      } catch (error) {
        throw toDatabaseSetupError(error, { context: options.context, phase: "lock" });
      }

      const lockedState = await probeDatabaseState(query);
      let appliedVersions = new Set(lockedState.appliedVersions);

      if (!appliedVersions.has(baselineMigration.version)) {
        await applyBaseline(options.context, query, appliedVersions);
      }

      await applyPendingMigrations(options.context, query, appliedVersions);
    });
  } catch (error) {
    if (error instanceof DatabaseSetupError) {
      throw error;
    }

    throw toDatabaseSetupError(error, { context: options.context, phase: "failed" });
  }

  logSetupPhase(options.context, "ready", {
    state: "ready",
    version: latestRuntimeMigrationVersion,
  });
}

export async function ensureDatabaseReady(
  options: EnsureDatabaseReadyOptions,
): Promise<void> {
  if (!options.autoInitEnabled) {
    return;
  }

  const cacheKey = getCacheKey(options.connectionKey);
  const cached = readinessCache.get(cacheKey);

  if (cached === READY) {
    return;
  }

  if (cached) {
    return cached;
  }

  const promise = runEnsureDatabaseReady(options)
    .then(() => {
      readinessCache.set(cacheKey, READY);
    })
    .catch((error: unknown) => {
      readinessCache.delete(cacheKey);

      const setupError = error instanceof DatabaseSetupError
        ? error
        : toDatabaseSetupError(error, { context: options.context, phase: "failed" });

      logSetupPhase(options.context, "failed", {
        phase: setupError.phase,
        code: setupError.code,
        message: setupError.message,
      });

      throw setupError;
    });

  readinessCache.set(cacheKey, promise);
  return promise;
}
