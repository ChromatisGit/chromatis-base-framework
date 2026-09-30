import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { createDatabase } from "../../src/db/client.js";
import { closeNodeDatabasePools } from "../../src/db/client.node.js";
import {
  runMigrationEngine,
  type SetupQueryExecutor,
} from "../../src/db/setup.js";
import type { MigrationAsset } from "../../src/db/types.js";
import { startDatabase } from "./dbMigrations.ts";

const adminPassword = "admin-test-password";
const runtimePassword = "runtime-test-password";
const migrationPassword = "migration-test-password";
const databaseName = "chromatis_test";
const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";

let containerName = "";
let applicationRoot = "";
let adminUrl = "";
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
    const result = spawnSync(
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
    if (result.status === 0) {
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    "Ephemeral PostgreSQL did not become ready within 60 seconds.",
  );
}

function writeMigration(filename: string, sql: string): void {
  const directory = path.join(
    applicationRoot,
    "src/modules/courses/migrations",
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, filename), sql, "utf8");
}

function queryExecutor(
  sql: postgres.Sql | postgres.TransactionSql,
): SetupQueryExecutor {
  return async (statement, values = []) => {
    const rows = await sql.unsafe(
      statement,
      values as postgres.ParameterOrJSON<never>[],
    );
    return rows as Array<Record<string, unknown>>;
  };
}

beforeAll(async () => {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  containerName = `chromatis-db-test-${crypto.randomUUID()}`;
  applicationRoot = mkdtempSync(path.join(tmpdir(), "chromatis-db-app-"));
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
    throw new Error(`Could not determine PostgreSQL port from: ${portOutput}`);
  }

  adminUrl = `postgres://postgres:${adminPassword}@127.0.0.1:${port}/${databaseName}`;
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

  writeMigration(
    "0.0.1__create_courses.sql",
    `
      CREATE TABLE courses (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        title text NOT NULL
      );
      ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
      CREATE POLICY courses_by_user ON courses
        USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
      REVOKE ALL ON TABLE courses FROM PUBLIC;
      GRANT SELECT, INSERT ON TABLE courses TO chromatis_app;
    `,
  );

  await startDatabase({
    databaseUrl: runtimeUrl,
    migrationDatabaseUrl: migrationUrl,
    runtime: "bun",
    environment: "local",
    applicationRoot,
  });
}, 30_000);

afterAll(async () => {
  await closeNodeDatabasePools();
  if (containerName) {
    docker(["rm", "--force", containerName], true);
  }
  if (applicationRoot) {
    rmSync(applicationRoot, { recursive: true, force: true });
  }
}, 30_000);

describe("PostgreSQL database contract", () => {
  test("runtime queries and migration DDL use distinct safe roles", async () => {
    const database = createDatabase(runtimeUrl, {
      runtime: "bun",
      environment: "local",
      migrationConnectionString: migrationUrl,
    });
    const [runtimeRole] = await database.anonSQL<
      Array<{ role_name: string; superuser: boolean; bypass_rls: boolean }>
    >`
      SELECT current_user AS role_name, rolsuper AS superuser, rolbypassrls AS bypass_rls
      FROM pg_roles WHERE rolname = current_user
    `;
    const admin = postgres(adminUrl, { max: 1 });
    try {
      const owners = await admin<
        Array<{ tablename: string; tableowner: string }>
      >`
        SELECT tablename, tableowner FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'courses', 'chromatis_schema_migrations')
        ORDER BY tablename
      `;
      expect(runtimeRole).toEqual({
        role_name: "chromatis_app",
        superuser: false,
        bypass_rls: false,
      });
      expect(owners).toEqual([
        {
          tablename: "chromatis_schema_migrations",
          tableowner: "chromatis_migrator",
        },
        { tablename: "courses", tableowner: "chromatis_migrator" },
        { tablename: "users", tableowner: "chromatis_migrator" },
      ]);
    } finally {
      await admin.end();
    }
  });

  test("RLS uses only transaction-local app.user_id and rolls back failures", async () => {
    const database = createDatabase(runtimeUrl, {
      runtime: "bun",
      environment: "local",
      migrationConnectionString: migrationUrl,
    });
    await database.userSQL({ id: userA })`
      INSERT INTO courses (id, user_id, title)
      VALUES ('10000000-0000-4000-8000-000000000001', ${userA}::uuid, 'Visible')
    `;
    const context = await database.userSQL({ id: userA })<
      Array<{
        user_id: string;
        user_role: string | null;
        permission: string | null;
      }>
    >`
      SELECT
        current_setting('app.user_id', true) AS user_id,
        current_setting('app.user_role', true) AS user_role,
        current_setting('app.permission', true) AS permission
    `;
    expect(context).toEqual([
      { user_id: userA, user_role: null, permission: null },
    ]);
    expect(await database.anonSQL`SELECT id FROM courses`).toEqual([]);
    expect(
      await database.userSQL({ id: userB })`SELECT id FROM courses`,
    ).toEqual([]);
    expect(
      await database.userSQL({ id: userA })`SELECT title FROM courses`,
    ).toEqual([{ title: "Visible" }]);

    let transactionError: unknown;
    try {
      await database.userTransaction({ id: userA }, async (sql) => {
        await sql`
          INSERT INTO courses (id, user_id, title)
          VALUES ('10000000-0000-4000-8000-000000000002', ${userA}::uuid, 'Rollback')
        `;
        throw new Error("rollback");
      });
    } catch (error) {
      transactionError = error;
    }
    expect(transactionError).toBeInstanceOf(Error);
    expect((transactionError as Error).message).toBe("rollback");
    expect(
      await database.userSQL({ id: userA })`
        SELECT title FROM courses WHERE title = 'Rollback'
      `,
    ).toEqual([]);
  });
});

describe("PostgreSQL auth and startup", () => {
  test("auth grants support required flows without exposing unneeded columns", async () => {
    const database = createDatabase(runtimeUrl, {
      runtime: "bun",
      environment: "local",
      migrationConnectionString: migrationUrl,
    });
    const migrator = postgres(migrationUrl, { max: 1 });
    try {
      await migrator`
        INSERT INTO roles (key, description) VALUES ('admin', 'Administrator')
        ON CONFLICT DO NOTHING
      `;
      await migrator`
        INSERT INTO permissions (key, description) VALUES ('courses.read', 'Read courses')
        ON CONFLICT DO NOTHING
      `;
      await migrator`
        INSERT INTO role_permissions (role_key, permission_key)
        VALUES ('admin', 'courses.read') ON CONFLICT DO NOTHING
      `;
    } finally {
      await migrator.end();
    }
    let authUserId = "";
    await database.anonTransaction(async (sql) => {
      await sql`
        INSERT INTO users (username, pin_hash, enabled)
        VALUES ('alice', 'hash', true)
      `;
      const users = await sql<Array<{ id: string }>>`
        SELECT id FROM users WHERE username = 'alice'
      `;
      expect(users).toHaveLength(1);
      const user = users[0];
      if (!user) {
        throw new Error("Expected the inserted auth user.");
      }
      authUserId = user.id;
      await sql`
        INSERT INTO roles (key, description) VALUES ('admin', 'Administrator')
        ON CONFLICT DO NOTHING
      `;
      await sql`
        INSERT INTO user_roles (user_id, role_key) VALUES (${user.id}::uuid, 'admin')
        ON CONFLICT DO NOTHING
      `;
      await sql`
        INSERT INTO sessions (id, user_id, expires_at)
        VALUES ('20000000-0000-4000-8000-000000000001', ${user.id}::uuid, now() + interval '1 hour')
      `;
      expect(await sql`SELECT id FROM sessions`).toHaveLength(1);
      await sql`DELETE FROM sessions WHERE id = '20000000-0000-4000-8000-000000000001'`;
      await sql`
        INSERT INTO external_identities
          (provider, external_id, user_id, email, display_name, raw)
        VALUES ('test', 'alice', ${user.id}::uuid, 'a@example.test', 'Alice', '{}'::jsonb)
      `;
    });

    let deniedError: unknown;
    try {
      await database.anonSQL`SELECT raw FROM external_identities`;
    } catch (error) {
      deniedError = error;
    }
    expect(deniedError).toMatchObject({ code: "42501" });
    const permission = await database.userSQL({ id: authUserId })<
      Array<{ allowed: boolean }>
    >`SELECT chromatis.has_permission(${authUserId}::uuid, 'courses.read') AS allowed`;
    expect(permission).toEqual([{ allowed: true }]);
  });
});

describe("PostgreSQL startup policy", () => {
  test("production checks pending migrations while test startup applies them", async () => {
    writeMigration(
      "0.0.2__add_production_probe.sql",
      "CREATE TABLE production_probe (id integer PRIMARY KEY); GRANT SELECT ON production_probe TO chromatis_app;\n",
    );
    await expect(
      startDatabase({
        databaseUrl: runtimeUrl,
        runtime: "bun",
        environment: "production",
        applicationRoot,
      }),
    ).rejects.toMatchObject({ code: "MIGRATIONS_PENDING" });

    const admin = postgres(adminUrl, { max: 1 });
    try {
      const [before] = await admin<Array<{ table_name: string | null }>>`
        SELECT to_regclass('public.production_probe')::text AS table_name
      `;
      expect(before?.table_name).toBeNull();
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
    const database = createDatabase(runtimeUrl, {
      runtime: "bun",
      environment: "production",
    });
    expect(await database.anonSQL`SELECT id FROM production_probe`).toEqual([]);
  });
});

describe("PostgreSQL migration concurrency", () => {
  test("concurrent migration engines serialize with the advisory lock", async () => {
    const migration: MigrationAsset = {
      module: "lock-test",
      version: "1.0.0",
      description: "create exactly once",
      sql: "CREATE TABLE advisory_lock_probe (id integer PRIMARY KEY);",
    };
    const first = postgres(migrationUrl, { max: 1 });
    const second = postgres(migrationUrl, { max: 1 });
    const run = (sql: postgres.Sql, context: string) =>
      runMigrationEngine({
        mode: "apply",
        connectionKey: context,
        context,
        migrations: [migration],
        query: queryExecutor(sql),
        transaction: (operation) =>
          sql.begin((transaction) => operation(queryExecutor(transaction))),
      });
    try {
      await Promise.all([run(first, "lock-first"), run(second, "lock-second")]);
      const markers = await first<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM chromatis_schema_migrations
        WHERE module = 'lock-test' AND version = '1.0.0'
      `;
      expect(markers).toEqual([{ count: 1 }]);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });
});
