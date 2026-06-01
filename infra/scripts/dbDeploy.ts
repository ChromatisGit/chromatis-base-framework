import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { getDbUrl, isLocalUrl } from "./config.ts";
import { getPendingMigrations, applyMigrations } from "./dbMigrations.ts";

const url = getDbUrl("production");

if (isLocalUrl(url)) {
  console.error(
    "[db] ERROR: Production profile points to a local database. Check CONFIG.yaml.\n" +
    "     Use `bun run db` for local database management.",
  );
  process.exit(1);
}

const { pending, sql } = await getPendingMigrations(url);

if (pending.length === 0) {
  console.info("[db] Database is up to date.");
  await sql.end();
  process.exit(0);
}

console.info("\nPending migrations:");
for (const m of pending) {
  console.info(`  ${m.filename}`);
}

const skipConfirm = process.argv.includes("--yes") || process.argv.includes("-y");

if (!skipConfirm) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question("\nApply to production database? [y/N]: ");
  rl.close();

  if (answer.trim().toLowerCase() !== "y") {
    console.info("Aborted.");
    await sql.end();
    process.exit(0);
  }
}

await applyMigrations(sql, pending);
console.info(`[db] Applied ${pending.length} migration${pending.length === 1 ? "" : "s"}.`);
await sql.end();
