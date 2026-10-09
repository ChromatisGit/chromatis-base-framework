import { describe, expect, test } from "bun:test";
import { Linter } from "eslint";
import architecture from "../eslint.architecture.js";

function lint(code: string): string[] {
  const linter = new Linter({ configType: "flat" });
  return linter
    .verify(code, [
      {
        plugins: { chromatis: architecture },
        rules: { "chromatis/no-raw-sql": "error" },
      },
    ])
    .map((message) => message.message);
}

describe("chromatis/no-raw-sql", () => {
  test.each([
    "await sql.unsafe(input);",
    "await db.unsafe(`SELECT ${x}`);",
    "await sql`SELECT set_config('app.user_id', ${id}, true)`;",
    "const q = \"SET LOCAL app.user_id = 'x'\";",
    "await sql`SET ROLE chromatis_owner`;",
    "const q = 'RESET ROLE';",
    "const q = 'set session authorization postgres';",
  ])("flags %s", (code) => {
    expect(lint(code).length).toBeGreaterThan(0);
  });

  test("allows parameterized application SQL", () => {
    expect(
      lint(
        "await sql`SELECT id FROM ${sql.identifier('courses')} WHERE title = ${title}`;",
      ),
    ).toEqual([]);
  });
});
