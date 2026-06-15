import { spawnSync } from "node:child_process";
import path from "node:path";

type DockerCommand = "start" | "reset";

function assertLocalUrl(url: URL): void {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to manage a non-local database (${url.hostname}). Docker commands are for local development only.`,
    );
  }
}

function getComposeEnv(url: URL): NodeJS.ProcessEnv {
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const dbUser = decodeURIComponent(url.username);
  const dbPassword = decodeURIComponent(url.password);
  const dbPort = url.port || "5432";

  if (!dbName || !dbUser || !dbPassword) {
    throw new Error("database URL must include database name, username, and password.");
  }

  const dockerUrl = `${url.protocol}//${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@db:5432/${encodeURIComponent(dbName)}`;

  return {
    ...process.env,
    APP_NAME: process.env.APP_NAME ?? dbName,
    DB_NAME: dbName,
    DB_USER: dbUser,
    DB_PASSWORD: dbPassword,
    DB_PORT: dbPort,
    DOCKER_DATABASE_URL: dockerUrl,
  };
}

function runDockerCompose(args: string[], env: NodeJS.ProcessEnv): void {
  const composeFile = path.resolve(import.meta.dirname, "../docker/docker-compose.yml");
  const result = spawnSync("docker", ["compose", "-f", composeFile, ...args], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function ensureDockerDb(databaseUrl: string, command: DockerCommand): void {
  const url = new URL(databaseUrl);
  assertLocalUrl(url);
  const env = getComposeEnv(url);

  if (command === "reset") {
    console.info("[db] Stopping and removing existing database container...");
    runDockerCompose(["down", "-v"], env);
  }

  runDockerCompose(["up", "-d", "--wait", "db"], env);
}
