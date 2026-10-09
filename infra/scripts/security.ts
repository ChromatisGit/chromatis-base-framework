import postgres from "postgres";
import { describeTableAccess } from "./accessRender.ts";
import { checkApplicationSecurity } from "./accessMigrations.ts";
import { auditDatabase, makeExecutor, makeProbe } from "./securityAudit.ts";

const USAGE = "Usage: bun run security [check|describe|audit]";
const [operation = "check"] = process.argv.slice(2);
const { modules, problems } = checkApplicationSecurity();

function reportAndExit(messages: readonly string[]): never {
  for (const message of messages) {
    console.error(`[security] ${message}`);
  }
  process.exit(1);
}

if (operation === "check") {
  if (problems.length > 0) {
    reportAndExit(problems);
  }
  console.info("[security] Access rules and SQL invariants are in sync.");
} else if (operation === "describe") {
  if (problems.length > 0) {
    reportAndExit(problems);
  }
  for (const module of modules) {
    console.info(`# ${module.name}\n`);
    for (const table of module.tables) {
      console.info(`${describeTableAccess(table)}\n`);
    }
  }
} else if (operation === "audit") {
  if (problems.length > 0) {
    reportAndExit(problems);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const sql = postgres(databaseUrl, { max: 1 });
  const ownerUrl = process.env.DATABASE_MIGRATION_URL;
  const owner = ownerUrl ? postgres(ownerUrl, { max: 1 }) : null;
  try {
    const violations = await auditDatabase(
      makeExecutor(sql),
      modules,
      owner ? makeProbe(owner) : null,
    );
    if (violations.length > 0) {
      reportAndExit(violations);
    }
    console.info("[security] Database matches the declared access rules.");
  } finally {
    await sql.end();
    await owner?.end();
  }
} else {
  throw new Error(USAGE);
}
