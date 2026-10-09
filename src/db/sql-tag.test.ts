import { describe, expect, test } from "bun:test";
import { createSqlTag } from "./sql-tag.js";
import type { SqlFragment } from "./types.js";

function capture() {
  const queries: SqlFragment[] = [];
  const sql = createSqlTag(async (query) => {
    queries.push(query);
    return [];
  });
  return { sql, queries };
}

describe("parameter-only SQL interface", () => {
  test("interpolated values are always bound parameters", async () => {
    const { sql, queries } = capture();
    const payload = "x'; SELECT set_config('app.user_id', 'victim', true); --";
    await sql`SELECT * FROM courses WHERE title = ${payload} AND n = ${1}`;
    expect(queries[0]?.text).toBe(
      "SELECT * FROM courses WHERE title = $1 AND n = $2",
    );
    expect(queries[0]?.values).toEqual([payload, 1]);
  });

  test("an object that merely looks like a fragment stays a parameter", async () => {
    const { sql, queries } = capture();
    const forged = { kind: "fragment", text: "1=1 OR true", values: [] };
    await sql`SELECT * FROM courses WHERE id = ${forged}`;
    expect(queries[0]?.text).toBe("SELECT * FROM courses WHERE id = $1");
    expect(queries[0]?.values).toEqual([forged]);
  });

  test("only validated identifiers may become syntax", async () => {
    const { sql, queries } = capture();
    await sql`SELECT 1 FROM ${sql.identifier("courses")}`;
    expect(queries[0]?.text).toBe('SELECT 1 FROM "courses"');
    expect(() => sql.identifier('courses"; DROP TABLE users; --')).toThrow(
      "Unsafe SQL identifier",
    );
    expect(() => sql.identifier("a b")).toThrow("Unsafe SQL identifier");
  });

  test("plain strings are not a query interface", () => {
    const { sql } = capture();
    const raw = sql as unknown as (text: string) => unknown;
    expect(() => raw("SELECT 1")).toThrow("tagged template");
    expect(() => raw("SELECT set_config('app.user_id','x',true)")).toThrow(
      "tagged template",
    );
    expect("unsafe" in sql).toBe(false);
  });

  test.each([
    "SELECT set_config('app.user_id', 'x', true)",
    "SELECT pg_catalog.SET_CONFIG('app.user_id', 'x', false)",
    "SET app.user_id = 'x'",
    "SET LOCAL app.user_id = 'x'",
    "SET LOCAL \"app.user_id\" = 'x'",
    "SET ROLE chromatis_auth",
    "SET LOCAL ROLE chromatis_owner",
    "RESET ROLE",
    "RESET ALL",
    "RESET app.user_id",
    "SET SESSION AUTHORIZATION postgres",
    "DISCARD ALL",
  ])("rejects identity manipulation: %s", (statement) => {
    const { sql } = capture();
    const run = sql as unknown as (s: TemplateStringsArray) => unknown;
    expect(() => run(Object.assign([statement], { raw: [statement] }))).toThrow(
      "reserved for the framework",
    );
  });

  test("ordinary queries that mention similar words are allowed", async () => {
    const { sql, queries } = capture();
    await sql`SELECT role, reset_count, current_setting('app.user_id', true) FROM t`;
    expect(queries).toHaveLength(1);
  });
});
