import { realpathSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { loadInstance } from "./instance.js";
import { formatProblem } from "./problems.js";
import {
  APP_TOML,
  CATALOG_TOML,
  catalog,
  classroom,
  cleanupFixtures,
  createInstance,
  type FixtureModule,
} from "./instanceFixture.js";

afterEach(cleanupFixtures);

async function problemsOf(root: string, environment = "local" as const) {
  return (await loadInstance(root, environment)).problems.map(formatProblem);
}

describe("instance configuration", () => {
  test("a complete instance has no problems and resolves effective config", async () => {
    const { root } = await createInstance({
      modules: { classroom, catalog },
      config: {
        "app.toml": APP_TOML,
        "catalog.toml": CATALOG_TOML,
        "classroom.toml":
          "[default]\nmaxStudents = 12\n[production]\nmaxStudents = 40\n",
      },
    });
    expect(await problemsOf(root)).toEqual([]);
    const local = await loadInstance(root, "local");
    const production = await loadInstance(root, "production");
    expect(local.modules[1]?.config?.effective).toEqual({
      maxStudents: 12,
      mode: "quiet",
    });
    expect(production.modules[1]?.config?.effective).toEqual({
      maxStudents: 40,
      mode: "quiet",
    });
    expect(local.appConfig?.deployment).toEqual({
      target: "cloudflare",
      domain: "example.org",
      port: 3000,
    });
    expect(local.name).toBe("demo-instance");
  });

  test("reports unknown keys, invalid values and missing required values with file and key", async () => {
    const { root } = await createInstance({
      modules: { classroom, catalog },
      config: {
        "app.toml":
          '[deployment]\ntarget = "azure"\ndomain = "https://x"\nextra = 1\n',
        "catalog.toml": "[default]\nroot = 1\nunknown = true\n",
        "classroom.toml": "[default]\nmaxStudents = -4\n",
      },
    });
    const found = await problemsOf(root);
    expect(found).toContain(
      'config/app.toml: deployment.target: Invalid option: expected one of "cloudflare"|"bun"',
    );
    expect(
      found.some((line) =>
        line.startsWith(
          "config/app.toml: deployment.domain: must be a lowercase host name",
        ),
      ),
    ).toBe(true);
    expect(found).toContain(
      'config/app.toml: deployment: Unrecognized key: "extra"',
    );
    expect(found).toContain(
      "config/catalog.toml: root: Invalid input: expected string, received number",
    );
    expect(found).toContain("config/catalog.toml: courses: Required");
    expect(found).toContain(
      'config/catalog.toml: configuration: Unrecognized key: "unknown"',
    );
    expect(found).toContain(
      "config/classroom.toml: maxStudents: Too small: expected number to be >0",
    );
  });

  test("validates every environment and names the ones that fail", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: {
        "app.toml": APP_TOML,
        "classroom.toml":
          "[default]\nmaxStudents = 5\n[production]\nmaxStudents = 0\n",
      },
    });
    expect(await problemsOf(root)).toEqual([
      "config/classroom.toml: maxStudents: Too small: expected number to be >0 (production)",
    ]);
  });
});

describe("instance configuration files", () => {
  test("missing files: required decisions are errors, defaults need no file", async () => {
    const { root } = await createInstance({ modules: { classroom, catalog } });
    const found = await problemsOf(root);
    expect(found).toContain(
      "config/app.toml: file is missing and has required values to decide (deployment)",
    );
    expect(found).toContain(
      "config/catalog.toml: file is missing and has required values to decide (root, courses)",
    );
    expect(found.some((line) => line.startsWith("config/classroom.toml"))).toBe(
      false,
    );
  });

  test("a required module whose values all have defaults still needs its file", async () => {
    const strictDefaults: FixtureModule = {
      body: `config: { schema: z.object({ a: z.number().default(1) }).strict(), required: true }`,
    };
    const { root } = await createInstance({
      modules: { solo: strictDefaults },
      config: { "app.toml": APP_TOML },
    });
    expect(await problemsOf(root)).toEqual([
      "config/solo.toml: file is missing; run chromatis fix to create it from the defaults",
    ]);
  });

  test("config files without a module are errors", async () => {
    const { root } = await createInstance({
      modules: { classroom, plain: {} },
      config: {
        "app.toml": APP_TOML,
        "ghost.toml": "[default]\n",
        "plain.toml": "[default]\n",
        "notes.txt": "ignored",
      },
    });
    expect(await problemsOf(root)).toEqual([
      'config/ghost.toml: no module "ghost" in @product/app; remove or rename the file',
      'config/plain.toml: module "plain" declares no config; remove the file',
    ]);
  });
});

describe("instance configuration hygiene", () => {
  test("committed secrets are errors: declared names and secret-looking keys or values", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: {
        "app.toml": APP_TOML,
        "classroom.toml":
          '[default]\nmaxStudents = 5\nCLASSROOM_KEY = "abc"\napiKey = "x"\nsessionTokenTtl = 5\npassword_min_length = 8\n[production]\nmode = "postgres://u:p4ss@db/x"\n',
      },
    });
    const found = await problemsOf(root);
    expect(
      found.some((line) =>
        line.startsWith(
          "config/classroom.toml: default.CLASSROOM_KEY: CLASSROOM_KEY is a declared secret",
        ),
      ),
    ).toBe(true);
    expect(
      found.some((line) =>
        line.startsWith(
          "config/classroom.toml: default.apiKey: key looks like a secret",
        ),
      ),
    ).toBe(true);
    expect(
      found.some((line) =>
        line.includes(
          "production.mode: value contains a URL with an embedded password",
        ),
      ),
    ).toBe(true);
    expect(
      found.some(
        (line) =>
          line.startsWith("config/classroom.toml: default.sessionTokenTtl") ||
          line.startsWith("config/classroom.toml: default.password_min_length"),
      ),
    ).toBe(false);
  });

  test("syntax errors are reported once for the file", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: { "app.toml": "[deployment\n", "classroom.toml": "[default]\n" },
    });
    const found = await problemsOf(root);
    expect(
      found.filter((line) => line.startsWith("config/app.toml")),
    ).toHaveLength(1);
    expect(found[0]).toContain("Invalid TOML");
  });

  test("module-set rules: duplicate runtime kinds, several hooks, unproduced artifacts", async () => {
    const hook = { "hook.ts": "export default { definitions: [] };\n" };
    const { root } = await createInstance({
      modules: {
        one: { body: `runtime: ["room"], serverHook: "hook.ts"`, files: hook },
        two: {
          body: `runtime: ["room"], serverHook: "hook.ts", artifacts: [{ id: "data", path: "data" }]`,
          files: hook,
        },
      },
      config: { "app.toml": APP_TOML },
    });
    const found = await problemsOf(root);
    expect(found).toContain(
      'modules: runtime kind "room" is declared by one and two',
    );
    expect(
      found.some((line) =>
        line.includes("only one module may declare a serverHook"),
      ),
    ).toBe(true);
    expect(found).toContain(
      "module two: artifacts.data: no contribution produces data and it is not present in .chromatis/artifacts/",
    );
  });

  test("discovery failure still reports the app config", async () => {
    const { root } = await createInstance({
      manifest: false,
      config: { "app.toml": "[bad" },
    });
    const found = await problemsOf(root);
    expect(found[0]).toContain("no direct dependency declares");
    expect(found.some((line) => line.startsWith("config/app.toml"))).toBe(true);
  });
});

describe("module config reaches runtime code", () => {
  test("configuration that JSON cannot carry unchanged is a problem", async () => {
    const dated: FixtureModule = {
      body: `config: { schema: z.object({ since: z.string().transform((value) => new Date(value)).prefault("2020-01-01") }).strict() }`,
    };
    const { root } = await createInstance({
      modules: { dated },
      config: { "app.toml": APP_TOML },
    });
    expect(await problemsOf(root)).toEqual([
      "config/dated.toml: configuration: config.since is not plain JSON data; use strings, numbers, booleans, arrays and tables",
    ]);
  });
});

describe("instance inside a monorepo", () => {
  test("discovers workspace-linked packages from a nested instance root", async () => {
    const { root, packageRoot } = await createInstance({
      workspace: true,
      modules: { classroom },
      config: { "app.toml": APP_TOML },
    });
    expect(root.endsWith("/dev")).toBe(true);
    const instance = await loadInstance(root, "local");
    expect(instance.problems).toEqual([]);
    expect(instance.discovery?.packageRoot).toBe(realpathSync(packageRoot));
    expect(instance.modules.map((m) => m.module.name)).toEqual(["classroom"]);
  });
});
