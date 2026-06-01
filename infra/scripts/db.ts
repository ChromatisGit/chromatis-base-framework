import { loadConfig, configToEnv, getDbUrl } from "./config.ts";
import { ensureDockerDb } from "./dbDocker.ts";
import { runDbMigrations } from "./dbMigrations.ts";

// Inject all local config into process.env so docker compose picks up every var
const config = loadConfig("local");
Object.assign(process.env, configToEnv(config));

const url = getDbUrl("local");
ensureDockerDb(url, "start");
await runDbMigrations(url, { seeds: true });
