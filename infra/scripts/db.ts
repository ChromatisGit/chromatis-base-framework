import path from "node:path";
import { generateRoutineMigration } from "./dbGeneratedMigrations.ts";
import { getPendingMigrations, runDbMigrations } from "./dbMigrations.ts";

const [operation = "status", moduleName, ...descriptionParts] =
  process.argv.slice(2);

if (operation === "generate") {
  const description = descriptionParts.join(" ");
  if (!moduleName || !description) {
    throw new Error("Usage: bun run db generate <module> <description>");
  }
  generateRoutineMigration(
    description,
    path.resolve(process.cwd(), "src/modules", moduleName),
  );
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
