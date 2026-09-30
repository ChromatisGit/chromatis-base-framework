import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  generateRoutineMigration,
  writeNewMigrationFile,
} from "./dbGeneratedMigrations.ts";

const temporaryDirectories: string[] = [];

function createModule(): string {
  const root = mkdtempSync(path.join(tmpdir(), "chromatis-routines-"));
  temporaryDirectories.push(root);
  mkdirSync(path.join(root, "sql/functions"), { recursive: true });
  mkdirSync(path.join(root, "sql/views"), { recursive: true });
  mkdirSync(path.join(root, "migrations"), { recursive: true });
  return root;
}

function writeRoutine(root: string, relativePath: string, sql: string): void {
  const filename = path.join(root, "sql", relativePath);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, sql, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("routine migration generation", () => {
  test("increments semantic patch versions numerically across 0.0.9", () => {
    const root = createModule();
    writeFileSync(
      path.join(root, "migrations/0.0.9__existing.sql"),
      "-- existing\n",
    );
    writeRoutine(
      root,
      "functions/course_count.sql",
      "CREATE OR REPLACE FUNCTION course_count() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );

    expect(generateRoutineMigration("add count", root)).toBe(
      "0.0.10__add_count.sql",
    );
    writeRoutine(
      root,
      "functions/course_count.sql",
      "CREATE OR REPLACE FUNCTION course_count() RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;\n",
    );
    expect(generateRoutineMigration("change count", root)).toBe(
      "0.0.11__change_count.sql",
    );
  });

  test("deleting the final routine generates its DROP migration", () => {
    const root = createModule();
    const routine = "functions/course_count.sql";
    writeRoutine(
      root,
      routine,
      "CREATE OR REPLACE FUNCTION course_count() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );
    generateRoutineMigration("add count", root);

    unlinkSync(path.join(root, "sql", routine));
    const filename = generateRoutineMigration("remove count", root);

    expect(filename).toBe("0.0.2__remove_count.sql");
    expect(
      readFileSync(path.join(root, "migrations", filename!), "utf8"),
    ).toContain("DROP FUNCTION IF EXISTS course_count();");
  });

  test("drops dependent views before functions and recreates functions before views", () => {
    const root = createModule();
    writeRoutine(
      root,
      "functions/course_count.sql",
      "CREATE OR REPLACE FUNCTION course_count() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );
    writeRoutine(
      root,
      "views/course_summary.sql",
      "CREATE OR REPLACE VIEW course_summary AS SELECT course_count() AS count;\n",
    );
    generateRoutineMigration("add routines", root);

    writeRoutine(
      root,
      "functions/course_count.sql",
      "CREATE OR REPLACE FUNCTION course_count() RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;\n",
    );
    const filename = generateRoutineMigration("change routines", root);
    const migration = readFileSync(
      path.join(root, "migrations", filename!),
      "utf8",
    );

    expect(migration.indexOf("DROP VIEW")).toBeLessThan(
      migration.indexOf("DROP FUNCTION"),
    );
    expect(migration.indexOf("CREATE OR REPLACE FUNCTION")).toBeLessThan(
      migration.indexOf("CREATE OR REPLACE VIEW"),
    );
  });

  test("never overwrites an existing migration file", () => {
    const root = createModule();
    const migrationPath = path.join(root, "migrations/0.0.1__change.sql");
    writeFileSync(migrationPath, "-- committed migration\n", "utf8");

    expect(() =>
      writeNewMigrationFile(migrationPath, "-- replacement\n"),
    ).toThrow();
    expect(readFileSync(migrationPath, "utf8")).toBe(
      "-- committed migration\n",
    );
  });
});
