import path from "node:path";
import {
  generateAccessMigration,
  loadApplicationAccess,
} from "./accessMigrations.ts";
import { generateRoutineMigration } from "./dbGeneratedMigrations.ts";
import { loadSchemaCatalog, makeExecutor } from "./securityAudit.ts";
import postgres from "postgres";
import { getPendingMigrations, runDbMigrations } from "./dbMigrations.ts";

const [operation = "status", moduleName, ...descriptionParts] =
  process.argv.slice(2);

if (operation === "generate") {
  const description = descriptionParts.join(" ");
  if (!moduleName || !description) {
    throw new Error("Usage: bun run db generate <module> <description>");
  }
  const moduleRoot = path.resolve(process.cwd(), "src/modules", moduleName);
  generateRoutineMigration(description, moduleRoot);
  // access.toml relationships are derived from (and verified against) the
  // foreign keys of the migrated schema when a database URL is available.
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  const sql = url ? postgres(url, { max: 1 }) : null;
  try {
    const catalog = sql ? await loadSchemaCatalog(makeExecutor(sql)) : null;
    generateAccessMigration(
      description,
      moduleRoot,
      catalog,
      loadApplicationAccess(process.cwd()).flatMap((module) => module.tables),
    );
  } finally {
    await sql?.end();
  }
  process.exit(0);
}

if (operation !== "status" && operation !== "apply") {
  throw new Error(
    "Usage: bun run db [status|apply|generate <module> <description>]",
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured");
}

const pending = await getPendingMigrations(databaseUrl);
if (pending.length === 0) {
  console.info("[db] Schema is up to date.");
} else {
  for (const migration of pending) {
    console.info(`[db] pending ${migration.module}:${migration.version}`);
  }
  if (operation === "apply") {
    const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
    if (!migrationDatabaseUrl) {
      throw new Error("DATABASE_MIGRATION_URL is not configured");
    }
    await runDbMigrations(databaseUrl, migrationDatabaseUrl);
    console.info(`[db] Applied ${pending.length} migration(s).`);
  }
}

if (operation === "status" && pending.length > 0) {
  process.exitCode = 2;
}
