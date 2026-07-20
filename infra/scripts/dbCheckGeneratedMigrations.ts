import { checkGeneratedMigrationState } from "./dbGeneratedMigrations.ts";

try {
  checkGeneratedMigrationState();
  console.info("[db] Generated migration state is in sync.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
