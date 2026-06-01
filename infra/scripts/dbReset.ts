import { loadConfig, configToEnv, getDbUrl, isLocalUrl } from "./config.ts";
import { ensureDockerDb } from "./dbDocker.ts";
import { runDbMigrations } from "./dbMigrations.ts";

Object.assign(process.env, configToEnv(loadConfig("local")));

const url = getDbUrl("local");

if (!isLocalUrl(url)) {
  console.error(
    "[db] ERROR: db:reset refused — the local profile database URL is not a local host.\n" +
    "     Check CONFIG.yaml. Production databases must be reset manually with SQL.",
  );
  process.exit(1);
}

ensureDockerDb(url, "reset");
await runDbMigrations(url, { seeds: true });
