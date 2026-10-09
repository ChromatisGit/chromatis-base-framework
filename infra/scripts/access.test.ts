import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compileAccess,
  parseAccessToml,
  sha256,
  type SchemaCatalog,
} from "./access.ts";
import { describeTableAccess, renderAccessMigration } from "./accessRender.ts";
import {
  checkApplicationSecurity,
  checkSqlInvariants,
  generateAccessMigration,
} from "./accessMigrations.ts";

const catalog: SchemaCatalog = {
  tables: new Map([
    ["courses", new Set(["id", "owner_id"])],
    ["course_enrollments", new Set(["user_id", "course_id"])],
    ["users", new Set(["id"])],
  ]),
  foreignKeys: [
    {
      table: "courses",
      columns: ["owner_id"],
      referencedTable: "users",
      referencedColumns: ["id"],
    },
    {
      table: "course_enrollments",
      columns: ["user_id"],
      referencedTable: "users",
      referencedColumns: ["id"],
    },
    {
      table: "course_enrollments",
      columns: ["course_id"],
      referencedTable: "courses",
      referencedColumns: ["id"],
    },
  ],
};

const example = `
[[access.courses.select]]
role = "teacher"

[[access.courses.select]]
role = "student"
through = "course_enrollments"

[[access.courses.update]]
role = "teacher"
user_column = "owner_id"

[[access.course_enrollments.select]]
user_column = "user_id"
`;

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("access.toml schema", () => {
  test("parses rules and defaults missing operations to deny", () => {
    const [courses] = parseAccessToml(example, "test");
    expect(courses?.rules.select).toHaveLength(2);
    expect(courses?.rules.insert).toEqual([]);
    expect(courses?.force).toBe(false);
  });

  test.each([
    ["[[access.courses.select]]\n", "empty rule"],
    ['[[access.courses.select]]\nrole = "a"\nbogus = 1\n', "unknown rule key"],
    ["[[access.courses.select]]\npublic = false\n", "public = true"],
    ['[[access.courses.select]]\npublic = true\nrole = "a"\n', "only key"],
    ['[[access.courses.select]]\nthrough_column = "x"\n', "requires `through`"],
    ['[[access.courses.merge]]\nrole = "a"\n', "unknown key"],
    ['[[access."Courses".select]]\nrole = "a"\n', "invalid identifier"],
    ['[[access.courses.select]]\nrole = "a\'; DROP"\n', "invalid identifier"],
    ["[other]\nx = 1\n", "only the top-level"],
  ])("rejects %j", (text, message) => {
    expect(() => parseAccessToml(text, "test")).toThrow(message);
  });
});

describe("RLS compilation", () => {
  test("combines rules with OR and conditions with AND", () => {
    const [courses] = compileAccess(
      parseAccessToml(example, "test"),
      "test",
      catalog,
    );
    const select = courses!.policies.find((p) => p.operation === "select")!;
    expect(select.expression).toBe(
      `(chromatis.has_role('teacher')) OR (chromatis.has_role('student') AND EXISTS (SELECT 1 FROM "course_enrollments" AS "link" WHERE "link"."user_id" = chromatis.current_user_id() AND "link"."course_id" = "courses"."id"))`,
    );
    const update = courses!.policies.find((p) => p.operation === "update")!;
    expect(update.expression).toBe(
      `chromatis.has_role('teacher') AND "courses"."owner_id" = chromatis.current_user_id()`,
    );
    expect(courses!.policies.map((p) => p.operation)).toEqual([
      "select",
      "update",
    ]);
  });

  test("renders enable, force and policies, and denies removed tables", () => {
    const compiled = compileAccess(
      parseAccessToml(`[access.courses]\nforce = true\n${example}`, "t"),
      "t",
      catalog,
    );
    const sql = renderAccessMigration(compiled, ["old_table"]);
    expect(sql).toContain('ALTER TABLE "courses" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'CREATE POLICY "courses_select" ON "courses" FOR SELECT',
    );
    expect(sql).toContain("WITH CHECK");
    expect(sql).toContain('DROP POLICY IF EXISTS "old_table_select"');
    expect(sql).not.toContain('courses_insert" ON "courses" FOR');
  });

  test("emits a true policy only for explicit public rules", () => {
    const [events] = compileAccess(
      parseAccessToml("[[access.events.insert]]\npublic = true\n", "t"),
      "t",
      null,
    );
    expect(events!.policies[0]).toMatchObject({
      expression: "true",
      public: true,
    });
  });

  test("derives and verifies relationships, rejecting ambiguity", () => {
    const ambiguous: SchemaCatalog = {
      ...catalog,
      foreignKeys: [
        ...catalog.foreignKeys,
        {
          table: "course_enrollments",
          columns: ["invited_by"],
          referencedTable: "users",
          referencedColumns: ["id"],
        },
      ],
    };
    const tables = parseAccessToml(example, "t");
    expect(() => compileAccess(tables, "t", ambiguous)).toThrow(
      "several foreign keys to users",
    );
    const explicit = parseAccessToml(
      example.replace(
        'through = "course_enrollments"',
        'through = "course_enrollments"\nthrough_user_column = "user_id"',
      ),
      "t",
    );
    expect(() => compileAccess(explicit, "t", ambiguous)).not.toThrow();
    expect(() => compileAccess(tables, "t", null)).toThrow(
      "needs foreign keys",
    );
    expect(() =>
      compileAccess(
        parseAccessToml('[[access.courses.select]]\nuser_column = "id"\n', "t"),
        "t",
        catalog,
      ),
    ).toThrow("foreign key to users");
  });

  test("describes access centrally", () => {
    const [courses] = parseAccessToml(example, "t");
    expect(describeTableAccess(courses!)).toContain("DENY (no rule)");
    expect(describeTableAccess(courses!)).toContain(
      "student AND through course_enrollments",
    );
  });
});

describe("link tables", () => {
  const link = (rules: string) =>
    `[[access.courses.select]]\nthrough = "course_enrollments"\n${rules}`;

  test("rejects a through table the User cannot read", () => {
    const run = (text: string) =>
      compileAccess(parseAccessToml(text, "t"), "t", catalog);
    expect(() => run(link(""))).toThrow(
      'link table "course_enrollments" has no access rules',
    );
    expect(() =>
      run(
        link(
          '\n[[access.course_enrollments.select]]\nrole = "teacher"\nuser_column = "user_id"\n',
        ),
      ),
    ).toThrow("do not let a User read their own rows");
    expect(() => run(link("\n[access.course_enrollments]\n"))).toThrow(
      "do not let a User read their own rows",
    );
    expect(() =>
      run(
        link(
          '\n[[access.course_enrollments.select]]\nuser_column = "user_id"\n',
        ),
      ),
    ).not.toThrow();
  });

  test("security:check re-validates link tables from the manifest", () => {
    const root = mkdtempSync(path.join(tmpdir(), "chromatis-link-"));
    directories.push(root);
    const module = path.join(root, "src/modules/courses");
    mkdirSync(module, { recursive: true });
    writeFileSync(path.join(module, "access.toml"), example);
    generateAccessMigration("rules", module, catalog);
    expect(checkApplicationSecurity(root).problems).toEqual([]);
    writeFileSync(
      path.join(module, "access.toml"),
      example.replace('user_column = "user_id"', 'role = "x"'),
    );
    writeFileSync(
      path.join(module, "sql/access.manifest.json"),
      readFileSync(
        path.join(module, "sql/access.manifest.json"),
        "utf8",
      ).replace(
        /"sourceHash": "[0-9a-f]+"/,
        `"sourceHash": "${sha256(readFileSync(path.join(module, "access.toml"), "utf8"))}"`,
      ),
    );
    expect(checkApplicationSecurity(root).problems.join()).toContain(
      "do not let a User read their own rows",
    );
  });
});

describe("role references", () => {
  test("rejects roles missing from the roles table", () => {
    const tables = parseAccessToml(example, "t");
    const withRoles = { ...catalog, roles: new Set(["teacher"]) };
    expect(() => compileAccess(tables, "t", withRoles)).toThrow(
      'role "student" does not exist',
    );
    expect(() =>
      compileAccess(tables, "t", {
        ...catalog,
        roles: new Set(["teacher", "student"]),
      }),
    ).not.toThrow();
  });
});

describe("SQL invariants", () => {
  test("flags security definer, materialized views and unsafe views", () => {
    expect(
      checkSqlInvariants(
        "CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;",
        "f.sql",
      ),
    ).toHaveLength(1);
    expect(
      checkSqlInvariants("CREATE VIEW v AS SELECT 1;", "v.sql"),
    ).toHaveLength(1);
    expect(
      checkSqlInvariants(
        "CREATE VIEW v WITH (security_invoker = true) AS SELECT 1;",
        "v.sql",
      ),
    ).toEqual([]);
    expect(
      checkSqlInvariants("CREATE POLICY p ON t USING (true);", "m.sql"),
    ).toHaveLength(1);
    expect(
      checkSqlInvariants(
        "-- SECURITY DEFINER in a comment\nSELECT 1;",
        "m.sql",
      ),
    ).toEqual([]);
  });
});

describe("generation and drift", () => {
  function createApp(): string {
    const root = mkdtempSync(path.join(tmpdir(), "chromatis-access-"));
    directories.push(root);
    const module = path.join(root, "src/modules/courses");
    mkdirSync(module, { recursive: true });
    writeFileSync(path.join(module, "access.toml"), example);
    return root;
  }

  test("requires generation, then detects edits to access.toml and the migration", () => {
    const root = createApp();
    const module = path.join(root, "src/modules/courses");
    expect(checkApplicationSecurity(root).problems.join()).toContain(
      "no generated RLS",
    );

    const filename = generateAccessMigration("access rules", module, catalog);
    expect(filename).toBe("0.0.1__access_rules.sql");
    expect(checkApplicationSecurity(root).problems).toEqual([]);
    expect(generateAccessMigration("again", module, catalog)).toBeNull();

    writeFileSync(
      path.join(module, "access.toml"),
      `${example}\n[[access.courses.delete]]\nrole = "admin"\n`,
    );
    expect(checkApplicationSecurity(root).problems.join()).toContain(
      "changed without regenerated RLS",
    );
    generateAccessMigration("allow delete", module, catalog);
    expect(checkApplicationSecurity(root).problems).toEqual([]);

    // edit the policy behaviour but keep the generated hash comment
    const generated = path.join(module, "migrations/0.0.2__allow_delete.sql");
    writeFileSync(
      generated,
      readFileSync(generated, "utf8").replace(
        /USING \(([^;]*)\);/,
        "USING (true);",
      ),
    );
    expect(checkApplicationSecurity(root).problems.join()).toContain(
      "was edited",
    );
  });

  test("rejects hand-written policies and invalid routine sources", () => {
    const root = createApp();
    const module = path.join(root, "src/modules/courses");
    mkdirSync(path.join(module, "migrations"), { recursive: true });
    writeFileSync(
      path.join(module, "migrations/0.0.1__manual.sql"),
      "CREATE POLICY x ON courses USING (true);",
    );
    mkdirSync(path.join(module, "sql/views"), { recursive: true });
    writeFileSync(
      path.join(module, "sql/views/v.sql"),
      "CREATE VIEW v AS SELECT 1;",
    );
    generateAccessMigration("rules", module, catalog);
    const problems = checkApplicationSecurity(root).problems.join("\n");
    expect(problems).toContain("0.0.1__manual.sql: CREATE POLICY");
    expect(problems).toContain("views must be created WITH (security_invoker");
  });
});
