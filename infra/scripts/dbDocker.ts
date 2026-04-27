import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Command = "start" | "reset";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

function loadLocalEnv(): void {
  const explicitEnvFile = process.env.DB_ENV_FILE;
  if (explicitEnvFile) {
    loadEnvFile(path.resolve(process.cwd(), explicitEnvFile));
    return;
  }

  loadEnvFile(path.resolve(process.cwd(), ".env"));
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
}

function getDatabaseUrl(): URL {
  loadLocalEnv();
  const rawUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!rawUrl) {
    throw new Error("Missing DATABASE_URL or POSTGRES_URL.");
  }
  return new URL(rawUrl);
}

function assertLocalDatabase(url: URL): void {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (process.env.FORCE_RESET === "1") return;

  if (process.env.NODE_ENV === "production" || !localHosts.has(url.hostname)) {
    throw new Error("Refusing to manage a non-local database. Set FORCE_RESET=1 to override.");
  }
}

function getComposeEnv(url: URL): NodeJS.ProcessEnv {
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const dbUser = decodeURIComponent(url.username);
  const dbPassword = decodeURIComponent(url.password);
  const dbPort = url.port || "5432";

  if (!dbName || !dbUser || !dbPassword) {
    throw new Error("DATABASE_URL must include database, username, and password.");
  }

  const dockerUrl = `${url.protocol}//${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@db:5432/${encodeURIComponent(dbName)}`;

  return {
    ...process.env,
    APP_NAME: process.env.APP_NAME ?? dbName,
    DB_NAME: process.env.DB_NAME ?? dbName,
    DB_USER: process.env.DB_USER ?? dbUser,
    DB_PASSWORD: process.env.DB_PASSWORD ?? dbPassword,
    DB_PORT: process.env.DB_PORT ?? dbPort,
    DOCKER_DATABASE_URL: process.env.DOCKER_DATABASE_URL ?? dockerUrl,
  };
}

function runDockerCompose(args: string[], env: NodeJS.ProcessEnv): void {
  const composeFile = path.resolve(process.cwd(), "infra/docker/docker-compose.yml");
  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, ...args],
    {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main(): void {
  const command = process.argv[2] as Command | undefined;
  if (command !== "start" && command !== "reset") {
    throw new Error("Usage: bun run infra/scripts/dbDocker.ts <start|reset>");
  }

  const url = getDatabaseUrl();
  assertLocalDatabase(url);
  const env = getComposeEnv(url);

  if (command === "reset") {
    runDockerCompose(["down", "-v"], env);
  }

  runDockerCompose(["up", "-d", "--wait", "db"], env);
}

main();
