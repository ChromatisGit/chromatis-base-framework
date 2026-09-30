import path from "node:path";
import { generateRoutineMigration } from "./dbGeneratedMigrations.ts";

const [moduleName, ...descriptionParts] = process.argv.slice(2);
const description = descriptionParts.join(" ");

if (!moduleName || !description.trim()) {
  console.error("Usage: bun run db generate <module> <description>");
  process.exit(1);
}

generateRoutineMigration(
  description,
  path.resolve(process.cwd(), "src/modules", moduleName),
);
