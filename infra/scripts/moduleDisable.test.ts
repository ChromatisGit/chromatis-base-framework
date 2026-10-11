import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateArtifacts } from "./application.js";
import { renderReport } from "./instanceCommands.js";
import { inspectInstance } from "./instanceInspect.js";
import { loadInstance, resolveApplication } from "./instance.js";
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

const DISABLED = `${APP_TOML}\n[modules]\ndisabled = ["classroom"]\n`;

async function problemsOf(root: string) {
  return (await loadInstance(root, "local")).problems.map(formatProblem);
}

describe("disabling a module", () => {
  test("a disabled module contributes no runtime, hook, database, secrets or config", async () => {
    const { root } = await createInstance({
      modules: { classroom, catalog },
      config: { "app.toml": DISABLED, "catalog.toml": CATALOG_TOML },
    });
    expect(await problemsOf(root)).toEqual([]);
    const app = await resolveApplication(root, "production");
    expect(app.runtime).toEqual([]);
    expect(app.serverHook).toBeUndefined();
    expect(app.postgresql).toBe(false);
    expect(app.secrets).toEqual(["CATALOG_SALT"]);
    expect(app.contributions.map((c) => c.id)).toEqual(["catalog"]);
    expect(Object.keys(app.moduleConfigs)).toEqual(["catalog"]);
    generateArtifacts(root, app);
    const config = readFileSync(
      path.join(root, ".chromatis/build/config.ts"),
      "utf8",
    );
    expect(config).toContain('"catalog"');
    expect(config).not.toContain("classroom");
  });

  test("the same instance without [modules] uses everything", async () => {
    const { root } = await createInstance({
      modules: { classroom, catalog },
      config: { "app.toml": APP_TOML, "catalog.toml": CATALOG_TOML },
    });
    const app = await resolveApplication(root, "production");
    expect(app.runtime).toEqual(["classroom"]);
    expect(app.postgresql).toBe(true);
  });

  test("a config file for a disabled module is an orphan", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: { "app.toml": DISABLED, "classroom.toml": "[default]\n" },
    });
    expect(await problemsOf(root)).toEqual([
      'config/classroom.toml: module "classroom" is disabled in config/app.toml; remove the file',
    ]);
  });

  test("a required config of a disabled module is not demanded", async () => {
    const { root } = await createInstance({
      modules: { catalog },
      config: {
        "app.toml": `${APP_TOML}\n[modules]\ndisabled = ["catalog"]\n`,
      },
    });
    expect(await problemsOf(root)).toEqual([]);
  });
});

describe("disabling a module: validation and diagnostics", () => {
  test("unknown module names are errors", async () => {
    const { root } = await createInstance({
      modules: { classroom },
      config: {
        "app.toml": `${APP_TOML}\n[modules]\ndisabled = ["clasroom"]\n`,
      },
    });
    expect(await problemsOf(root)).toEqual([
      'config/app.toml: modules.disabled: unknown module "clasroom" (@product/app provides: classroom)',
    ]);
  });

  test("conflicts with a disabled module do not count", async () => {
    const other: FixtureModule = {
      body: `runtime: ["classroom"], serverHook: "hook.ts"`,
      files: { "hook.ts": "export default { definitions: [] };\n" },
    };
    const { root } = await createInstance({
      modules: { classroom, other },
      config: { "app.toml": APP_TOML },
    });
    expect((await problemsOf(root)).join("\n")).toContain(
      'runtime kind "classroom" is declared by classroom and other',
    );
    const disabled = await createInstance({
      modules: { classroom, other },
      config: { "app.toml": DISABLED },
    });
    expect(await problemsOf(disabled.root)).toEqual([]);
  });

  test("inspect lists disabled modules and why they are not in effect", async () => {
    const { root } = await createInstance({
      modules: { classroom, catalog },
      config: { "app.toml": DISABLED, "catalog.toml": CATALOG_TOML },
    });
    const report = await inspectInstance(
      root,
      "production",
      async () => undefined,
    );
    expect(report.modules.map((m) => m.name)).toEqual(["catalog"]);
    expect(report.disabledModules).toEqual([
      {
        name: "classroom",
        entry: "../modules/classroom/module.ts",
        reason: "disabled in config/app.toml ([modules] disabled)",
        runtime: ["classroom"],
        database: true,
        secrets: ["CLASSROOM_KEY"],
        contributions: [],
        artifacts: [],
      },
    ]);
    expect(report.secrets.map((s) => s.name)).toEqual(["CATALOG_SALT"]);
    const text = renderReport(report);
    expect(text).toContain("Disabled modules (not in effect)");
    expect(text).toContain(
      "classroom  disabled in config/app.toml ([modules] disabled); contributes nothing (would add: runtime classroom; database; secrets CLASSROOM_KEY)",
    );
  });
});
