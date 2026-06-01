import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export type ConfigProfile = Record<string, string>;

const CONFIG_FILE = "CONFIG.yaml";
const TEMPLATE_FILE = "CONFIG.template.yaml";

// Maps friendly CONFIG.yaml keys to environment variable names.
// Keys not listed here are converted by uppercasing (session_secret → SESSION_SECRET).
const KEY_TO_ENV: Record<string, string> = {
  database: "DATABASE_URL",
};

export function loadConfig(profile: "local" | "production"): ConfigProfile {
  const configPath = path.resolve(process.cwd(), CONFIG_FILE);

  if (!existsSync(configPath)) {
    const hint = existsSync(path.resolve(process.cwd(), TEMPLATE_FILE))
      ? `Copy ${TEMPLATE_FILE} to ${CONFIG_FILE} and fill in your values.`
      : `Create ${CONFIG_FILE} with "local" and "production" sections.`;
    throw new Error(`${CONFIG_FILE} not found. ${hint}`);
  }

  const raw = readFileSync(configPath, "utf8");
  const config = parse(raw) as Record<string, ConfigProfile> | null;

  if (!config || typeof config !== "object") {
    throw new Error(`${CONFIG_FILE} is empty or invalid YAML.`);
  }

  const profileData = config[profile];
  if (!profileData || typeof profileData !== "object") {
    throw new Error(`Profile "${profile}" not found in ${CONFIG_FILE}.`);
  }

  return profileData;
}

export function configToEnv(profile: ConfigProfile): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (value === undefined || value === null || value === "") continue;
    const envKey = KEY_TO_ENV[key] ?? key.toUpperCase().replace(/-/g, "_");
    env[envKey] = String(value);
  }
  return env;
}

export function getDbUrl(profile: "local" | "production"): string {
  const config = loadConfig(profile);
  const url = config["database"];
  if (!url) {
    throw new Error(`"database" is not set in ${CONFIG_FILE} under "${profile}".`);
  }
  return url;
}

export function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}
