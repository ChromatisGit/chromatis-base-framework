import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadMigrationFiles, startDatabase } from "./dbMigrations.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("migration discovery", () => {
  test("rejects SQL files whose names do not follow the migration convention", () => {
    const modules = mkdtempSync(path.join(tmpdir(), "chromatis-migrations-"));
    temporaryDirectories.push(modules);
    const migrations = path.join(modules, "courses/migrations");
    mkdirSync(migrations, { recursive: true });
    writeFileSync(path.join(migrations, "create_courses.sql"), "SELECT 1;\n");

    expect(() => loadMigrationFiles(modules)).toThrow(
      "Invalid migration filename: create_courses.sql",
    );
  });

  test("startup blocks routine-manifest drift before connecting", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "chromatis-startup-"));
    temporaryDirectories.push(root);
    const functions = path.join(root, "src/modules/courses/sql/functions");
    mkdirSync(functions, { recursive: true });
    writeFileSync(
      path.join(functions, "course_count.sql"),
      "CREATE FUNCTION course_count() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );

    let startupError: unknown;
    try {
      await startDatabase({
        databaseUrl: "postgres://chromatis_app:runtime@127.0.0.1:1/unreachable",
        runtime: "bun",
        environment: "production",
        applicationRoot: root,
      });
    } catch (error) {
      startupError = error;
    }
    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toContain(
      "SQL routine sources are not tracked",
    );
  });
});
