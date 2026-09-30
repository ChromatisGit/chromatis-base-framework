import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { createDatabaseOidcAuthorizationAttemptStore } from "../../src/auth/oidc.js";
import { createSessionManager } from "../../src/auth/session.server.js";
import { resolveExternalIdentity } from "../../src/auth/sso.server.js";
import { createDatabase } from "../../src/db/client.js";
import { closeNodeDatabasePools } from "../../src/db/client.node.js";
import { startDatabase } from "./dbMigrations.ts";

const adminPassword = "admin-auth-test-password";
const runtimePassword = "runtime-auth-test-password";
const migrationPassword = "migration-auth-test-password";
const databaseName = "chromatis_auth_test";

let containerName = "";
let applicationRoot = "";
let runtimeUrl = "";
let migrationUrl = "";

function docker(args: string[], allowFailure = false): string {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `Docker command failed: docker ${args.join(" ")}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ready = spawnSync(
      "docker",
      [
        "exec",
        containerName,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-d",
        databaseName,
      ],
      { encoding: "utf8" },
    );
    if (ready.status === 0) {
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    "Ephemeral PostgreSQL did not become ready within 60 seconds.",
  );
}

async function cleanup(): Promise<void> {
  await closeNodeDatabasePools();
  if (containerName) {
    docker(["rm", "--force", containerName], true);
  }
  if (applicationRoot) {
    rmSync(applicationRoot, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  applicationRoot = mkdtempSync(path.join(tmpdir(), "chromatis-auth-app-"));
  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
    containerName = `chromatis-auth-test-${crypto.randomUUID()}`;
    docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      `POSTGRES_PASSWORD=${adminPassword}`,
      "--env",
      `POSTGRES_DB=${databaseName}`,
      "postgres:16-alpine",
    ]);
    await waitForPostgres();
    const portOutput = docker(["port", containerName, "5432/tcp"]);
    const port = /:(\d+)$/.exec(portOutput)?.[1];
    if (!port) {
      throw new Error(
        `Could not determine PostgreSQL port from: ${portOutput}`,
      );
    }
    const adminUrl = `postgres://postgres:${adminPassword}@127.0.0.1:${port}/${databaseName}`;
    runtimeUrl = `postgres://chromatis_app:${runtimePassword}@127.0.0.1:${port}/${databaseName}`;
    migrationUrl = `postgres://chromatis_migrator:${migrationPassword}@127.0.0.1:${port}/${databaseName}`;
    const admin = postgres(adminUrl, { max: 1 });
    try {
      await admin.unsafe(`
        CREATE ROLE chromatis_migrator LOGIN PASSWORD '${migrationPassword}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        CREATE ROLE chromatis_app LOGIN PASSWORD '${runtimePassword}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        ALTER DATABASE ${databaseName} OWNER TO chromatis_migrator;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        ALTER SCHEMA public OWNER TO chromatis_migrator;
        GRANT CONNECT ON DATABASE ${databaseName} TO chromatis_app;
        GRANT USAGE ON SCHEMA public TO chromatis_app;
      `);
    } finally {
      await admin.end();
    }
    await startDatabase({
      databaseUrl: runtimeUrl,
      migrationDatabaseUrl: migrationUrl,
      runtime: "bun",
      environment: "test",
      applicationRoot,
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
}, 30_000);

afterAll(cleanup, 30_000);

test("expired and revoked opaque sessions resolve as unauthenticated", async () => {
  const database = createDatabase(runtimeUrl, {
    runtime: "bun",
    environment: "test",
    migrationConnectionString: migrationUrl,
  });
  const now = new Date("2026-01-01T00:00:00.000Z");
  const users = await database.anonSQL<Array<{ id: string }>>`
    INSERT INTO users (enabled) VALUES (true) RETURNING id
  `;
  const user = users[0];
  if (!user) {
    throw new Error("Expected a session test user.");
  }
  const activeSessionId = "30000000-0000-4000-8000-000000000001";
  const expiredSessionId = "30000000-0000-4000-8000-000000000002";
  const manager = createSessionManager({
    database,
    cookieName: "sid",
    now: () => now,
    createId: () => activeSessionId,
  });
  const active = await manager.create({ id: user.id });
  const activeRequest = new Request("https://app.test", {
    headers: { cookie: `sid=${active.session.id}` },
  });
  expect((await manager.resolve(activeRequest))?.user).toEqual({ id: user.id });

  await database.anonSQL`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${expiredSessionId}, ${user.id}, ${new Date(now.getTime() - 1_000)})
  `;
  const expiredRequest = new Request("https://app.test", {
    headers: { cookie: `sid=${expiredSessionId}` },
  });
  expect(await manager.resolve(expiredRequest)).toBeNull();

  const clearCookie = await manager.logout(active.session);
  expect(clearCookie).toContain("Max-Age=0");
  expect(await manager.resolve(activeRequest)).toBeNull();
});

test("OIDC correlation grants allow one-time framework operations only", async () => {
  const database = createDatabase(runtimeUrl, {
    runtime: "bun",
    environment: "test",
    migrationConnectionString: migrationUrl,
  });
  const attempts = createDatabaseOidcAuthorizationAttemptStore(database);
  const attempt = {
    providerId: "integration-provider",
    stateHash: "state-hash",
    nonce: "nonce",
    codeVerifier: "verifier",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  };
  await attempts.save(attempt);
  expect(await attempts.consume(attempt.providerId, attempt.stateHash)).toEqual(
    attempt,
  );
  expect(
    await attempts.consume(attempt.providerId, attempt.stateHash),
  ).toBeNull();

  let directReadError: unknown;
  try {
    await database.anonSQL`SELECT code_verifier FROM oidc_authorization_attempts`;
  } catch (error) {
    directReadError = error;
  }
  expect(directReadError).toMatchObject({ code: "42501" });
});

test("concurrent first-time SSO callbacks resolve one user without orphans", async () => {
  const database = createDatabase(runtimeUrl, {
    runtime: "bun",
    environment: "test",
    migrationConnectionString: migrationUrl,
  });
  const identity = {
    providerId: "integration-provider",
    externalId: `external-${crypto.randomUUID()}`,
    email: "concurrent@example.test",
    displayName: "Concurrent User",
    raw: { sub: "provider-subject", private_provider_value: "server-only" },
  };
  const orphanCountBefore = await database.anonSQL<Array<{ count: number }>>`
    SELECT count(*)::integer AS count
    FROM users u
    LEFT JOIN external_identities identity ON identity.user_id = u.id
    WHERE u.username IS NULL AND identity.user_id IS NULL
  `;
  const users = await Promise.all(
    Array.from({ length: 8 }, () =>
      resolveExternalIdentity(database, identity),
    ),
  );

  expect(new Set(users.map((user) => user.id)).size).toBe(1);
  const linked = await database.anonSQL<Array<{ user_id: string }>>`
    SELECT user_id FROM external_identities
    WHERE provider = ${identity.providerId} AND external_id = ${identity.externalId}
  `;
  expect(linked).toEqual([{ user_id: users[0]?.id }]);
  const orphanCountAfter = await database.anonSQL<Array<{ count: number }>>`
    SELECT count(*)::integer AS count
    FROM users u
    LEFT JOIN external_identities identity ON identity.user_id = u.id
    WHERE u.username IS NULL AND identity.user_id IS NULL
  `;
  expect(orphanCountAfter).toEqual(orphanCountBefore);
});
