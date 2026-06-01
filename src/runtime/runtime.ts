import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type RuntimeEnv = Record<string, unknown>;

const runtimeEnvStorage = new AsyncLocalStorage<RuntimeEnv>();
const envFileCache = new Map<string, Record<string, string>>();

function parseEnvFile(filePath: string): Record<string, string> {
  const cached = envFileCache.get(filePath);
  if (cached) {
    return cached;
  }

  const parsed: Record<string, string> = {};
  const content = readFileSync(filePath, "utf-8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const envKey = normalized.slice(0, separatorIndex).trim();
    let envValue = normalized.slice(separatorIndex + 1).trim();

    if (
      (envValue.startsWith("\"") && envValue.endsWith("\""))
      || (envValue.startsWith("'") && envValue.endsWith("'"))
    ) {
      envValue = envValue.slice(1, -1);
    }

    parsed[envKey] = envValue;
  }

  envFileCache.set(filePath, parsed);
  return parsed;
}

function getEnvFileValue(key: string): string | undefined {
  const envFile = process.env.DB_ENV_FILE;
  if (!envFile) {
    return undefined;
  }

  const resolvedPath = path.resolve(process.cwd(), envFile);
  if (!existsSync(resolvedPath)) {
    return undefined;
  }

  const parsed = parseEnvFile(resolvedPath);
  const envProfile = process.env.DB_ENV_PROFILE;

  const envValue = parsed[key] ?? getProfileEnvValue(parsed, envProfile, key);
  return typeof envValue === "string" && envValue.length > 0 ? envValue : undefined;
}

function getProfileEnvValue(
  parsed: Record<string, string>,
  profile: string | undefined,
  key: string,
): string | undefined {
  if (profile === "docker") {
    if (key === "DATABASE_URL") {
      return parsed.DOCKER_DATABASE_URL ?? parsed.DATABASE_URL;
    }
    if (key === "OPENAI_API_KEY") {
      return parsed.DOCKER_OPENAI_API_KEY ?? parsed.OPENAI_API_KEY;
    }
    if (key === "DB_DRIVER") {
      return parsed.DOCKER_DB_DRIVER ?? parsed.DB_DRIVER ?? "node";
    }
  }

  if (profile === "cloudflare") {
    if (key === "DATABASE_URL") {
      return parsed.CLOUDFLARE_DATABASE_URL ?? parsed.DATABASE_URL;
    }
    if (key === "OPENAI_API_KEY") {
      return parsed.CLOUDFLARE_OPENAI_API_KEY ?? parsed.OPENAI_API_KEY;
    }
    if (key === "DB_DRIVER") {
      return parsed.CLOUDFLARE_DB_DRIVER ?? parsed.DB_DRIVER ?? "worker";
    }
  }

  return undefined;
}

export function runWithRuntimeEnv<T>(env: RuntimeEnv, fn: () => T): T {
  return runtimeEnvStorage.run(env, fn);
}

export function isCloudflareRuntime(): boolean {
  return runtimeEnvStorage.getStore() !== undefined;
}

export function getRuntimeEnvVar(key: string): string | undefined {
  // Cloudflare Workers env is injected via AsyncLocalStorage — check first
  // so Worker bindings take precedence over process.env (which may be stale
  // from the Node.js build host when running on Cloudflare).
  const runtimeValue = runtimeEnvStorage.getStore()?.[key];
  if (typeof runtimeValue === "string" && runtimeValue.length > 0) {
    return runtimeValue;
  }

  const processValue = process.env[key];
  if (typeof processValue === "string" && processValue.length > 0) {
    return processValue;
  }

  const fileValue = getEnvFileValue(key);
  if (typeof fileValue === "string" && fileValue.length > 0) {
    return fileValue;
  }

  return undefined;
}
