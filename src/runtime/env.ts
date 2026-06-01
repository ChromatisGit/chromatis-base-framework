import { getRuntimeEnvVar } from "./runtime.js";

function require(key: string): string {
  const val = getRuntimeEnvVar(key);
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function getOptional(key: string): string | undefined {
  return getRuntimeEnvVar(key);
}

export type DbDriver = "node" | "worker";

export function getDatabaseUrl(): string {
  return require("DATABASE_URL");
}

export function getDbDriver(): DbDriver {
  const driver = getOptional("DB_DRIVER") ?? "node";
  if (driver !== "node" && driver !== "worker") {
    throw new Error(`Invalid DB_DRIVER: "${driver}". Must be "node" or "worker".`);
  }
  return driver;
}
