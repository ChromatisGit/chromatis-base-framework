import { generateRoutineMigration } from "./dbGeneratedMigrations.ts";

const description = process.argv.slice(2).join(" ");

if (!description.trim()) {
  console.error("Usage: bun run node_modules/@chromatis/base/infra/scripts/dbGenerate.ts <description>");
  process.exit(1);
}

generateRoutineMigration(description);
