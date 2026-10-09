import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { createDatabase } from "../../src/db/client.js";
import { closeNodeDatabasePools } from "../../src/db/client.node.js";
import {
  generateAccessMigration,
  loadApplicationAccess,
} from "./accessMigrations.ts";
import { startDatabase } from "./dbMigrations.ts";
import {
  auditDatabase,
  makeProbe,
  loadSchemaCatalog,
  makeExecutor,
} from "./securityAudit.ts";

const adminPassword = "admin-test-password";
const runtimePassword = "runtime-test-password";
const ownerPassword = "owner-test-password";
const databaseName = "chromatis_security_test";
const teacherId = "00000000-0000-4000-8000-0000000000a1";
const studentId = "00000000-0000-4000-8000-0000000000a2";
const strangerId = "00000000-0000-4000-8000-0000000000a3";
const courseId = "10000000-0000-4000-8000-000000000001";

let containerName = "";
let applicationRoot = "";
let adminUrl = "";
let runtimeUrl = "";
let ownerUrl = "";

function docker(args: string[], allowFailure = false): string {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker ${args.join(" ")}\n${result.stderr}`);
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
  throw new Error("Ephemeral PostgreSQL did not become ready.");
}

function moduleRoot(): string {
  return path.join(applicationRoot, "src/modules/courses");
}

async function start(): Promise<void> {
  await startDatabase({
    databaseUrl: runtimeUrl,
    migrationDatabaseUrl: ownerUrl,
    runtime: "bun",
    environment: "local",
    applicationRoot,
  });
}

beforeAll(async () => {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  containerName = `chromatis-security-test-${crypto.randomUUID()}`;
  applicationRoot = mkdtempSync(path.join(tmpdir(), "chromatis-security-app-"));
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
  const port = /:(\d+)$/.exec(docker(["port", containerName, "5432/tcp"]))?.[1];
  adminUrl = `postgres://postgres:${adminPassword}@127.0.0.1:${port}/${databaseName}`;
  runtimeUrl = `postgres://chromatis_runtime:${runtimePassword}@127.0.0.1:${port}/${databaseName}`;
  ownerUrl = `postgres://chromatis_owner:${ownerPassword}@127.0.0.1:${port}/${databaseName}`;

  const admin = postgres(adminUrl, { max: 1 });
  try {
    await admin.unsafe(`
      CREATE ROLE chromatis_owner LOGIN PASSWORD '${ownerPassword}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      CREATE ROLE chromatis_runtime LOGIN PASSWORD '${runtimePassword}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      CREATE ROLE chromatis_auth LOGIN PASSWORD 'auth-test-password'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      ALTER DATABASE ${databaseName} OWNER TO chromatis_owner;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      ALTER SCHEMA public OWNER TO chromatis_owner;
      GRANT CONNECT ON DATABASE ${databaseName} TO chromatis_runtime, chromatis_auth;
      GRANT USAGE ON SCHEMA public TO chromatis_runtime;
    `);
  } finally {
    await admin.end();
  }

  mkdirSync(path.join(moduleRoot(), "migrations"), { recursive: true });
  writeFileSync(
    path.join(moduleRoot(), "migrations/0.0.1__create_courses.sql"),
    `
      CREATE TABLE courses (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES users(id),
        title text NOT NULL
      );
      CREATE TABLE course_enrollments (
        user_id uuid NOT NULL REFERENCES users(id),
        course_id uuid NOT NULL REFERENCES courses(id),
        PRIMARY KEY (user_id, course_id)
      );
      REVOKE ALL ON TABLE courses, course_enrollments FROM PUBLIC;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE courses, course_enrollments TO chromatis_runtime;
    `,
  );
  writeFileSync(
    path.join(moduleRoot(), "access.toml"),
    `
[[access.courses.select]]
role = "teacher"

[[access.courses.select]]
role = "student"
through = "course_enrollments"

[[access.courses.insert]]
role = "teacher"
user_column = "owner_id"

[[access.courses.update]]
user_column = "owner_id"

[[access.course_enrollments.select]]
user_column = "user_id"
`,
  );

  await start();
  const owner = postgres(ownerUrl, { max: 1 });
  try {
    await owner`INSERT INTO roles (key, description) VALUES ('teacher', 't'), ('student', 's')`;
    generateAccessMigration(
      "access rules",
      moduleRoot(),
      await loadSchemaCatalog(makeExecutor(owner)),
    );
    for (const id of [teacherId, studentId, strangerId]) {
      await owner`INSERT INTO users (id, enabled) VALUES (${id}, true)`;
    }
    await owner`INSERT INTO user_roles (user_id, role_key) VALUES (${teacherId}, 'teacher'), (${studentId}, 'student')`;
  } finally {
    await owner.end();
  }
  await start();
}, 90_000);

afterAll(async () => {
  await closeNodeDatabasePools();
  if (containerName) {
    docker(["rm", "--force", containerName], true);
  }
  if (applicationRoot) {
    rmSync(applicationRoot, { recursive: true, force: true });
  }
}, 30_000);

describe("generated RLS", () => {
  test("enforces roles, ownership and link tables with default deny", async () => {
    const database = createDatabase(runtimeUrl, {
      runtime: "bun",
      environment: "local",
      migrationConnectionString: ownerUrl,
    });
    const teacher = { id: teacherId };
    await database.userSQL(teacher)`
      INSERT INTO courses (id, owner_id, title) VALUES (${courseId}, ${teacherId}, 'Algebra')
    `;
    await expect(
      database.userSQL({ id: studentId })`
        INSERT INTO courses (id, owner_id, title)
        VALUES (${crypto.randomUUID()}, ${studentId}, 'nope')
      `,
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      await database.userSQL(teacher)`SELECT id FROM courses`,
    ).toHaveLength(1);
    expect(
      await database.userSQL({ id: studentId })`SELECT id FROM courses`,
    ).toEqual([]);

    await database.userSQL(teacher)`
      INSERT INTO course_enrollments (user_id, course_id) VALUES (${studentId}, ${courseId})
    `.catch(() => undefined);
    const owner = postgres(ownerUrl, { max: 1 });
    try {
      await owner`INSERT INTO course_enrollments (user_id, course_id) VALUES (${studentId}, ${courseId}) ON CONFLICT DO NOTHING`;
    } finally {
      await owner.end();
    }
    expect(
      await database.userSQL({ id: studentId })`SELECT id FROM courses`,
    ).toHaveLength(1);
    expect(
      await database.userSQL({ id: strangerId })`SELECT id FROM courses`,
    ).toEqual([]);
    expect(await database.publicSQL`SELECT id FROM courses`).toEqual([]);

    // update: owner only; the student cannot change the row
    expect(
      await database.userSQL({
        id: studentId,
      })`UPDATE courses SET title = 'x' RETURNING id`,
    ).toEqual([]);
    expect(
      await database.userSQL(
        teacher,
      )`UPDATE courses SET title = 'Algebra II' RETURNING id`,
    ).toHaveLength(1);
    // no delete rule => deny
    expect(
      await database.userSQL(teacher)`DELETE FROM courses RETURNING id`,
    ).toEqual([]);
    // course_enrollments: users see only their own enrollments
    expect(
      await database.userSQL(teacher)`SELECT * FROM course_enrollments`,
    ).toEqual([]);
    expect(
      await database.userSQL({
        id: studentId,
      })`SELECT * FROM course_enrollments`,
    ).toHaveLength(1);
  });
});

describe("security audit", () => {
  test("passes on a correctly generated database, then detects drift", async () => {
    const modules = loadApplicationAccess(applicationRoot);
    const runtime = postgres(runtimeUrl, { max: 1 });
    const owner = postgres(ownerUrl, { max: 1 });
    try {
      const audit = () =>
        auditDatabase(makeExecutor(runtime), modules, makeProbe(owner));
      expect(await audit()).toEqual([]);

      // broadened policy that keeps its generated comment must be caught
      await owner.unsafe("ALTER POLICY courses_select ON courses USING (true)");
      expect((await audit()).join("\n")).toContain(
        "policy courses_select does not match its declared definition",
      );
      await owner.unsafe(
        "UPDATE user_roles SET role_key = 'teacher' WHERE role_key = 'student'",
      );
      await owner.unsafe("DELETE FROM roles WHERE key = 'student'");
      expect((await audit()).join("\n")).toContain(
        'role "student" does not exist in the roles table',
      );

      await owner.unsafe("GRANT SELECT ON auth_sessions TO chromatis_runtime");
      await owner.unsafe(
        "GRANT EXECUTE ON FUNCTION chromatis.has_role(text) TO PUBLIC",
      );
      await owner.unsafe("ALTER TABLE courses DISABLE ROW LEVEL SECURITY");
      await owner.unsafe(`
        CREATE POLICY courses_extra ON courses FOR DELETE USING (true);
        CREATE VIEW unsafe_courses AS SELECT id FROM courses;
        CREATE TABLE loose (id int);
        GRANT SELECT ON loose TO chromatis_runtime;
        CREATE FUNCTION public.sneaky() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      `);
      const problems = (
        await auditDatabase(makeExecutor(runtime), modules)
      ).join("\n");
      expect(problems).toContain(
        "direct privileges on framework table auth_sessions",
      );
      expect(problems).toContain(
        "function chromatis.has_role is executable by PUBLIC",
      );
      expect(problems).toContain("table courses: RLS is not enabled");
      expect(problems).toContain("unexpected policy courses_extra");
      expect(problems).toContain("view unsafe_courses is not security_invoker");
      expect(problems).toContain("table loose is accessible");
      expect(problems).toContain("function public.sneaky is SECURITY DEFINER");
    } finally {
      await runtime.end();
      await owner.end();
    }
  });
});
