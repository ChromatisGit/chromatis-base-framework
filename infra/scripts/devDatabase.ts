import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { frameworkRoot } from "./application.js";

const password = "chromatis-local";

export function devDatabaseName(instanceRoot: string): string {
  const id = createHash("sha256")
    .update(path.resolve(instanceRoot))
    .digest("hex")
    .slice(0, 12);
  return `chromatis-dev-${id}`;
}

/** Start an instance-specific, persistent PostgreSQL container for local dev. */
export async function devDatabase(
  instanceRoot: string,
): Promise<Record<string, string>> {
  const name = devDatabaseName(instanceRoot);
  const docker = (args: string[], allowFailure = false): string => {
    const result = spawnSync("docker", args, { encoding: "utf8" });
    if (result.status !== 0 && !allowFailure) {
      throw new Error(
        `Local PostgreSQL requires a running Docker daemon: ${result.error?.message ?? result.stderr.trim()}`,
      );
    }
    return result.status === 0 ? result.stdout.trim() : "";
  };
  const exists = docker(["container", "inspect", name], true);
  if (!exists) {
    const init = path.join(
      frameworkRoot,
      "infra/deploy/postgres/init-roles.sh",
    );
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "dev.chromatis.database=1",
      "-p",
      "127.0.0.1::5432",
      "-v",
      `${name}:/var/lib/postgresql/data`,
      "-v",
      `${init}:/docker-entrypoint-initdb.d/10-roles.sh:ro`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      `DATABASE_OWNER_PASSWORD=${password}`,
      "-e",
      `DATABASE_AUTH_PASSWORD=${password}`,
      "-e",
      `DATABASE_RUNTIME_PASSWORD=${password}`,
      "postgres:17-alpine",
    ]);
  } else {
    docker(["start", name]);
  }
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        name,
        "psql",
        "-U",
        "postgres",
        "-d",
        "app",
        "-tAc",
        "SELECT 1 FROM pg_roles WHERE rolname = 'chromatis_auth'",
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0 && result.stdout.trim() === "1") {
      ready = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!ready) {
    throw new Error(
      `Local PostgreSQL did not become ready; inspect it with docker logs ${name}`,
    );
  }
  const port = docker(["port", name, "5432/tcp"]).match(/:(\d+)$/)?.[1];
  if (!port) {
    throw new Error(
      `Could not determine the port of local PostgreSQL container ${name}`,
    );
  }
  const url = (role: string) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/app`;
  console.info(`[chromatis] local PostgreSQL ready (${name}, port ${port})`);
  return {
    DATABASE_URL: url("chromatis_runtime"),
    DATABASE_AUTH_URL: url("chromatis_auth"),
    DATABASE_MIGRATION_URL: url("chromatis_owner"),
  };
}
