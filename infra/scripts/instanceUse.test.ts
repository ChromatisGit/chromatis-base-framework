import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkInstance } from "./instanceCheck.js";
import { fixInstance } from "./instanceFix.js";
import { inspectInstance } from "./instanceInspect.js";
import { instanceMode, loadInstance, resolveApplication } from "./instance.js";
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

describe("resolveApplication", () => {
  test("derives the application from module declarations and app.toml", async () => {
    const { root, packageRoot } = await createInstance({
      modules: { classroom, catalog },
      config: { "app.toml": APP_TOML, "catalog.toml": CATALOG_TOML },
    });
    const production = await resolveApplication(root, "production");
    expect(production).toMatchObject({
      name: "demo-instance",
      publicUrl: "https://example.org",
      target: "cloudflare",
      port: 3000,
      postgresql: true,
      runtime: ["classroom"],
      serverHook: path.join(packageRoot, "modules/classroom/hook.ts"),
      secrets: [
        "CATALOG_SALT",
        "DATABASE_MIGRATION_URL",
        "DATABASE_URL",
        "CLASSROOM_KEY",
      ],
      optionalSecrets: [],
      bundledPackages: ["@product/app"],
    });
    const local = await resolveApplication(root, "local");
    expect(local.secrets).toEqual([
      "DATABASE_MIGRATION_URL",
      "DATABASE_URL",
      "CLASSROOM_KEY",
    ]);
    expect(local.optionalSecrets).toEqual(["CATALOG_SALT"]);
  });

  test("target bun maps to the Docker build target, localhost is http with the port", async () => {
    const { root } = await createInstance({
      modules: {},
      config: {
        "app.toml":
          '[deployment]\ntarget = "bun"\ndomain = "localhost"\nport = 4000\nname = "kept-name"\n',
      },
    });
    expect(await resolveApplication(root, "local")).toMatchObject({
      name: "kept-name",
      target: "docker",
      publicUrl: "http://localhost:4000",
      port: 4000,
    });
  });

  test("throws every problem when the instance is invalid", async () => {
    const { root } = await createInstance({
      modules: { catalog },
      config: { "app.toml": APP_TOML },
    });
    await expect(resolveApplication(root, "local")).rejects.toThrow(
      "config/catalog.toml",
    );
  });

  test("no configuration at all is a clear error", async () => {
    const { root } = await createInstance({ modules: {} });
    expect(instanceMode(root)).toBe("none");
    await expect(resolveApplication(root, "local")).rejects.toThrow(
      "config/app.toml: file is missing and has required values to decide (deployment)",
    );
  });
});

describe("check", () => {
  test("passes for a valid instance and reports tooling drift", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: { "app.toml": APP_TOML },
    });
    expect(await checkInstance(root)).toEqual([]);
    writeFileSync(path.join(root, "eslint.config.js"), "export default [];\n");
    expect((await checkInstance(root)).map(formatProblem)).toEqual([
      "tooling: eslint.config.js differs from the framework stub; run chromatis init",
    ]);
  });

  test("check never writes anything", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: {},
    });
    await checkInstance(root);
    expect(existsSync(path.join(root, "config"))).toBe(false);
  });
});

describe("fix", () => {
  test("creates missing config files that are fully defaulted, never decisions", async () => {
    const { root } = await createInstance({
      modules: { classroom, catalog },
      config: {},
    });
    const calls: string[] = [];
    const result = await fixInstance(root, (dir) => {
      calls.push(dir);
      return ["app"];
    });
    expect(result.created).toEqual([]);
    expect(result.remaining.map(formatProblem)).toContain(
      "config/app.toml: file is missing and has required values to decide (deployment)",
    );
    expect(existsSync(path.join(root, "config/app.toml"))).toBe(false);
    expect(existsSync(path.join(root, "config/catalog.toml"))).toBe(false);
    expect(calls).toEqual([root]);
  });

  test("writes defaults for a required module with a default for every value, then passes", async () => {
    const solo: FixtureModule = {
      body: `config: { schema: z.object({ a: z.number().default(1), tags: z.array(z.string()).default(["x"]) }).strict(), required: true }`,
    };
    const { root } = await createInstance({
      modules: { solo },
      config: { "app.toml": APP_TOML },
    });
    const result = await fixInstance(root, () => undefined);
    expect(result.created).toEqual(["config/solo.toml"]);
    expect(result.formatted).toBeUndefined();
    expect(result.remaining).toEqual([]);
    const text = readFileSync(path.join(root, "config/solo.toml"), "utf8");
    expect(text).toContain("[default]");
    expect(text).toContain("a = 1");
    expect(
      (await loadInstance(root, "local")).modules[0]?.config?.effective,
    ).toEqual({ a: 1, tags: ["x"] });
    const again = await fixInstance(root, () => undefined);
    expect(again.created).toEqual([]);
  });

  test("never overwrites an existing file", async () => {
    const solo: FixtureModule = {
      body: `config: { schema: z.object({ a: z.number().default(1) }).strict(), required: true }`,
    };
    const { root } = await createInstance({
      modules: { solo },
      config: { "app.toml": APP_TOML, "solo.toml": "[default]\na = 99\n" },
      editor: false,
    });
    const result = await fixInstance(root, () => undefined);
    expect(result.created).toEqual([]);
    // Only the editor schema line is added; the author's values stay as written.
    expect(readFileSync(path.join(root, "config/solo.toml"), "utf8")).toBe(
      "#:schema ../.chromatis/schemas/solo.schema.json\n[default]\na = 99\n",
    );
  });

  test("an empty-defaults module gets an empty default table", async () => {
    const solo: FixtureModule = {
      body: `config: { schema: z.object({}).strict(), required: true }`,
    };
    const { root } = await createInstance({
      modules: { solo },
      config: { "app.toml": APP_TOML },
    });
    const result = await fixInstance(root, () => undefined);
    expect(result.created).toEqual(["config/solo.toml"]);
    expect(result.remaining).toEqual([]);
  });
});

describe("inspect", () => {
  const lookup = async (_service: string, name: string) =>
    name === "CLASSROOM_KEY" ? "value-that-must-never-print" : undefined;

  test("lists modules, effective config, contributions, artifacts, secrets and unmet requirements", async () => {
    const { root } = await createInstance({
      modules: { classroom, catalog },
      config: { "app.toml": APP_TOML, "catalog.toml": CATALOG_TOML },
    });
    const report = await inspectInstance(root, "production", lookup);
    expect(report.mode).toBe("instance");
    expect(report.package).toEqual({ name: "@product/app", version: "1.2.3" });
    expect(report.application).toMatchObject({
      name: "demo-instance",
      target: "cloudflare",
      domain: "example.org",
      publicUrl: "https://example.org",
    });
    expect(report.modules.map((m) => m.name)).toEqual(["catalog", "classroom"]);
    expect(report.modules[0]?.config).toMatchObject({
      file: "config/catalog.toml",
      required: true,
      present: true,
      effective: { root: "content", courses: ["algebra"] },
    });
    expect(report.contributions).toEqual([
      {
        module: "catalog",
        id: "catalog",
        specifier: "@product/compiler/contribution",
        export: "default",
      },
    ]);
    expect(report.artifacts).toEqual([
      {
        module: "catalog",
        id: "catalog",
        path: "catalog",
        validator: undefined,
        producedBy: "catalog",
        present: false,
      },
    ]);
    expect(
      report.secrets.map((s) => [s.name, s.configured, s.requiredNow]),
    ).toEqual([
      ["CATALOG_SALT", false, true],
      ["DATABASE_MIGRATION_URL", false, true],
      ["DATABASE_URL", false, true],
      ["CLASSROOM_KEY", true, true],
    ]);
    expect(report.unmet).toEqual([
      "secret CATALOG_SALT (catalog) is not set; run chromatis secret",
      "secret DATABASE_MIGRATION_URL (chromatis) is not set; run chromatis secret",
      "secret DATABASE_URL (chromatis) is not set; run chromatis secret",
    ]);
    expect(JSON.stringify(report)).not.toContain("value-that-must-never-print");
  });

  test("secrets only needed in production are not unmet locally", async () => {
    const { root } = await createInstance({
      modules: { catalog },
      config: { "app.toml": APP_TOML, "catalog.toml": CATALOG_TOML },
    });
    expect((await inspectInstance(root, "local", lookup)).unmet).toEqual([]);
  });

  test("redacts secret-looking values and keeps going when config is invalid", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: {
        "app.toml": APP_TOML,
        "classroom.toml": "[default]\nmaxStudents = 0\n",
      },
    });
    const report = await inspectInstance(root, "local", lookup);
    expect(report.problems.map(formatProblem)).toContain(
      "config/classroom.toml: maxStudents: Too small: expected number to be >0",
    );
    expect(report.unmet.length).toBeGreaterThan(0);
  });

  test("reports a missing configuration instead of throwing", async () => {
    const { root } = await createInstance({ modules: {} });
    const report = await inspectInstance(root, "local", lookup);
    expect(report.mode).toBe("none");
    expect(report.unmet[0]).toContain(
      "config/app.toml: file is missing and has required values to decide",
    );
  });
});
