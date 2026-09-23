import { DatabaseSetupError, toDatabaseSetupError } from "./errors.js";
import type { MigrationAsset, MigrationMode } from "./types.js";

type QueryRow = Record<string, unknown>;

export type SetupQueryExecutor = (
  statement: string,
  values?: readonly unknown[],
) => Promise<QueryRow[]>;

export type SetupTransactionExecutor = <T>(
  fn: (query: SetupQueryExecutor) => Promise<T>,
) => Promise<T>;

export type MigrationEngineOptions = {
  mode: MigrationMode;
  connectionKey: string;
  context: string;
  migrations: readonly MigrationAsset[];
  query: SetupQueryExecutor;
  transaction: SetupTransactionExecutor;
};

type ProbeState = {
  state: "uninitialized" | "ready" | "outdated";
  appliedMigrations: Set<string>;
  pendingMigrations: readonly MigrationAsset[];
};

const READY = Symbol("ready");
const readinessCache = new Map<string, Promise<void> | typeof READY>();
const MIGRATION_LOCK_NAMESPACE = 23117;
const MIGRATION_LOCK_KEY = 40873;
export const DATABASE_RUNTIME_ROLE = "chromatis_app";

type RoleInspection = Readonly<{
  role_name?: unknown;
  is_superuser?: unknown;
  can_create_database?: unknown;
  can_create_role?: unknown;
  bypasses_rls?: unknown;
  owns_application_tables?: unknown;
}>;

export async function inspectDatabaseRole(
  query: SetupQueryExecutor,
): Promise<RoleInspection> {
  const rows = await query(`
    SELECT
      current_user AS role_name,
      role.rolsuper AS is_superuser,
      role.rolcreatedb AS can_create_database,
      role.rolcreaterole AS can_create_role,
      role.rolbypassrls AS bypasses_rls,
      EXISTS (
        SELECT 1
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE relation.relowner = role.oid
          AND relation.relkind IN ('r', 'p')
          AND namespace.nspname <> 'information_schema'
          AND namespace.nspname NOT LIKE 'pg_%'
      ) AS owns_application_tables
    FROM pg_roles role
    WHERE role.rolname = current_user
  `);
  return rows[0] ?? {};
}

export async function assertSafeRuntimeRole(
  query: SetupQueryExecutor,
): Promise<void> {
  const role = await inspectDatabaseRole(query);
  if (role.role_name !== DATABASE_RUNTIME_ROLE) {
    throw new Error(
      `[db] DATABASE_URL must connect as ${DATABASE_RUNTIME_ROLE}; connected as ${String(role.role_name)}.`,
    );
  }
  if (
    role.is_superuser === true ||
    role.can_create_database === true ||
    role.can_create_role === true ||
    role.bypasses_rls === true ||
    role.owns_application_tables === true
  ) {
    throw new Error(
      `[db] Runtime role ${DATABASE_RUNTIME_ROLE} must be non-privileged, must not bypass RLS, and must not own application tables.`,
    );
  }
}

function getCacheKey(options: MigrationEngineOptions): string {
  const migrationSet = options.migrations.map(migrationKey).join("|");
  return `${options.connectionKey}::${options.mode}::${migrationSet}`;
}

function migrationKey(
  migration: Pick<MigrationAsset, "module" | "version">,
): string {
  return `${migration.module}:${migration.version}`;
}

function getPending(
  migrations: readonly MigrationAsset[],
  applied: Set<string>,
): MigrationAsset[] {
  return migrations.filter(
    (migration) => !applied.has(migrationKey(migration)),
  );
}

function log(
  context: string,
  phase: "probe" | "lock" | "migrate" | "ready" | "failed",
  details?: Record<string, unknown>,
): void {
  console.warn("[db/setup]", phase, { context, ...(details ?? {}) });
}

async function probeDatabaseState(
  query: SetupQueryExecutor,
  migrations: readonly MigrationAsset[],
): Promise<ProbeState> {
  const tableRows = await query(
    "SELECT to_regclass('public.chromatis_schema_migrations')::text AS table_name",
  );
  const tableName = tableRows[0]?.table_name;

  if (typeof tableName !== "string" || tableName.length === 0) {
    return {
      state: "uninitialized",
      appliedMigrations: new Set(),
      pendingMigrations: [...migrations],
    };
  }

  const rows = await query(
    "SELECT module, version FROM chromatis_schema_migrations ORDER BY applied_at ASC, module ASC, version ASC",
  );
  const appliedMigrations = new Set(
    rows
      .filter(
        (row): row is QueryRow & { module: string; version: string } =>
          typeof row.module === "string" && typeof row.version === "string",
      )
      .map((row) => migrationKey(row)),
  );

  const pending = getPending(migrations, appliedMigrations);

  return {
    state:
      appliedMigrations.size === 0
        ? "uninitialized"
        : pending.length === 0
          ? "ready"
          : "outdated",
    appliedMigrations,
    pendingMigrations: pending,
  };
}

async function insertMigrationMarker(
  query: SetupQueryExecutor,
  migration: MigrationAsset,
): Promise<void> {
  await query(
    "INSERT INTO chromatis_schema_migrations (module, version, description) VALUES ($1, $2, $3) ON CONFLICT (module, version) DO NOTHING",
    [migration.module, migration.version, migration.description],
  );
}

async function ensureMigrationTable(query: SetupQueryExecutor): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS chromatis_schema_migrations (
      module text NOT NULL,
      version text NOT NULL,
      description text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (module, version)
    );
    REVOKE ALL ON TABLE chromatis_schema_migrations FROM PUBLIC;
    GRANT SELECT ON TABLE chromatis_schema_migrations TO ${DATABASE_RUNTIME_ROLE}
  `);
}

async function applyMigrations(
  context: string,
  query: SetupQueryExecutor,
  migrations: readonly MigrationAsset[],
  applied: Set<string>,
): Promise<void> {
  for (const migration of getPending(migrations, applied)) {
    log(context, "migrate", {
      module: migration.module,
      version: migration.version,
      description: migration.description,
    });
    const trimmed = migration.sql.trim();
    try {
      if (trimmed) {
        await query(trimmed);
      }
      await insertMigrationMarker(query, migration);
    } catch (error) {
      throw toDatabaseSetupError(error, { context, phase: "migrate" });
    }
    applied.add(migrationKey(migration));
  }
}

export type MigrationEngineResult = Readonly<{
  pending: readonly MigrationAsset[];
  applied: readonly MigrationAsset[];
}>;

export async function runMigrationEngine(
  options: MigrationEngineOptions,
): Promise<MigrationEngineResult> {
  const { context, migrations, query, transaction } = options;

  log(context, "probe");

  let initial: ProbeState;
  try {
    initial = await probeDatabaseState(query, migrations);
  } catch (error) {
    throw toDatabaseSetupError(error, { context, phase: "probe" });
  }

  if (initial.state === "ready") {
    log(context, "ready");
    return { pending: [], applied: [] };
  }

  if (options.mode === "check") {
    return { pending: initial.pendingMigrations, applied: [] };
  }

  const appliedNow: MigrationAsset[] = [];
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

      await ensureMigrationTable(txQuery);

      const locked = await probeDatabaseState(txQuery, migrations);
      const applied = new Set(locked.appliedMigrations);

      const pending = getPending(migrations, applied);
      await applyMigrations(context, txQuery, pending, applied);
      appliedNow.push(...pending);
    });
  } catch (error) {
    if (error instanceof DatabaseSetupError) {
      throw error;
    }
    throw toDatabaseSetupError(error, { context, phase: "failed" });
  }

  log(context, "ready", {
    migration: migrations.at(-1)?.version ?? "none",
  });
  return { pending: [], applied: appliedNow };
}

export async function ensureDatabaseReady(
  options: MigrationEngineOptions,
): Promise<void> {
  if (options.migrations.length === 0) {
    return;
  }

  const cacheKey = getCacheKey(options);
  const cached = readinessCache.get(cacheKey);

  if (cached === READY) {
    return;
  }
  if (cached) {
    return cached;
  }

  const promise = runMigrationEngine(options)
    .then((result) => {
      if (result.pending.length > 0) {
        const pending = result.pending.map(migrationKey).join(", ");
        throw new DatabaseSetupError({
          message: `[db/setup] ${options.context} has pending migrations: ${pending}`,
          userMessage:
            "The database schema is out of date. Apply the pending migrations before starting the application.",
          phase: "ready",
          context: options.context,
          code: "MIGRATIONS_PENDING",
        });
      }
      readinessCache.set(cacheKey, READY);
    })
    .catch((error: unknown) => {
      readinessCache.delete(cacheKey);
      const setupError =
        error instanceof DatabaseSetupError
          ? error
          : toDatabaseSetupError(error, {
              context: options.context,
              phase: "failed",
            });
      log(options.context, "failed", {
        phase: setupError.phase,
        message: setupError.message,
      });
      throw setupError;
    });

  readinessCache.set(cacheKey, promise);
  return promise;
}
