import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateArtifacts } from "./application.js";
import { resolveApplication } from "./instance.js";
import {
  APP_TOML,
  artifactModule,
  catalog,
  cleanupFixtures,
  createInstance,
  type FixtureModule,
} from "./instanceFixture.js";

afterEach(cleanupFixtures);

const cli = path.resolve(import.meta.dir, "chromatis.ts");

function chromatis(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["bun", cli, ...args], {
    cwd: root,
    env: { ...process.env, CATALOG_SALT: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
}

const solo: FixtureModule = {
  body: `
    config: { schema: z.object({ a: z.number().default(1) }).strict(), required: true },
    secrets: [{ name: "SOLO_KEY", description: "k", required: "always" }],
    runtime: ["room"], serverHook: "hook.ts",
  `,
  files: { "hook.ts": "export default { definitions: [] };\n" },
};

describe("chromatis CLI", () => {
  test("check reports every problem and exits non-zero, then passes after fix", async () => {
    const { root } = await createInstance({
      modules: { solo },
      config: { "app.toml": APP_TOML },
    });
    const failing = chromatis(root, "check");
    expect(failing.status).toBe(1);
    expect(failing.err).toContain("check failed: 1 problem(s)");
    expect(failing.err).toContain(
      "config/solo.toml: file is missing; run chromatis fix",
    );
    expect(existsSync(path.join(root, "config/solo.toml"))).toBe(false);

    const fixed = chromatis(root, "fix");
    expect(fixed.status).toBe(0);
    expect(fixed.out).toContain(
      "[fix] created config/solo.toml from schema defaults",
    );
    expect(chromatis(root, "check")).toMatchObject({ status: 0 });
  });

  test("fix reports what only the user can decide and exits non-zero", async () => {
    const { root } = await createInstance({ modules: { solo } });
    const result = chromatis(root, "fix");
    expect(result.status).toBe(1);
    expect(result.err).toContain(
      "config/app.toml: file is missing and has required values to decide (deployment)",
    );
    expect(existsSync(path.join(root, "config/app.toml"))).toBe(false);
  });

  test("init writes the editor schemas first, while the configuration is still incomplete", async () => {
    const { root } = await createInstance({
      modules: { catalog },
      config: {
        "app.toml": APP_TOML,
        "catalog.toml": '[default]\nroot = "content"\ncourses = []\n',
      },
      editor: false,
    });
    const result = chromatis(root, "init");
    expect(result.status).toBe(1);
    expect(result.err).toContain("courses");
    expect(
      existsSync(path.join(root, ".chromatis/schemas/catalog.schema.json")),
    ).toBe(true);
    // Nothing new in the instance root.
    expect(existsSync(path.join(root, ".taplo.toml"))).toBe(false);
  });

  test("inspect --json prints the machine-readable report", async () => {
    const { root } = await createInstance({
      modules: { solo },
      config: { "app.toml": APP_TOML, "solo.toml": "[default]\na = 2\n" },
    });
    const result = chromatis(root, "inspect", "--json", "--env", "production");
    expect(result.status).toBe(0);
    const report = JSON.parse(result.out) as {
      environment: string;
      modules: { name: string; config: { effective: unknown } }[];
      secrets: { name: string }[];
    };
    expect(report.environment).toBe("production");
    expect(report.modules[0]?.config.effective).toEqual({ a: 2 });
    expect(report.secrets.map((secret) => secret.name)).toEqual(["SOLO_KEY"]);
  });

  test("inspect prints a readable report", async () => {
    const { root } = await createInstance({
      modules: { solo },
      config: { "app.toml": APP_TOML, "solo.toml": "[default]\na = 2\n" },
    });
    const result = chromatis(root, "inspect");
    expect(result.out).toContain("Modules from @product/app@1.2.3");
    expect(result.out).toContain('config config/solo.toml, required = {"a":2}');
    expect(result.out).toContain("runtime room  hook hook.ts");
    expect(result.out).toContain("secret SOLO_KEY (solo) is not set");
  });

  test("an unknown command lists the usage", async () => {
    const { root } = await createInstance();
    const result = chromatis(root, "frobnicate");
    expect(result.status).toBe(1);
    expect(result.err).toContain("usage: chromatis <check|fix|inspect");
  });

  test("--env must be a known environment", async () => {
    const { root } = await createInstance();
    expect(chromatis(root, "inspect", "--env", "staging").err).toContain(
      "--env must be local, test or production",
    );
  });
});

describe("build context", () => {
  test("generateArtifacts records the hook, bundled package and linked roots for Vite", async () => {
    const { root, packageRoot } = await createInstance({
      modules: { solo },
      config: { "app.toml": APP_TOML, "solo.toml": "[default]\n" },
    });
    const app = await resolveApplication(root, "local");
    generateArtifacts(root, app, false);
    const context = JSON.parse(
      readFileSync(
        path.join(root, ".chromatis/build/application.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(context).toEqual({
      serverHook: path.join(packageRoot, "modules/solo/hook.ts"),
      bundledPackages: ["@product/app"],
      allowedRoots: [packageRoot],
      productPublic: null,
    });
    const worker = readFileSync(
      path.join(root, ".chromatis/build/worker.ts"),
      "utf8",
    );
    expect(worker).toContain(
      JSON.stringify(path.join(packageRoot, "modules/solo/hook.ts")),
    );
  });
});

describe("build lifecycle", () => {
  test("build stops at the failing contribution before building anything", async () => {
    const { root } = await createInstance({
      modules: { artifact: artifactModule },
      config: {
        "app.toml": APP_TOML,
        "artifact.toml": "[default]\nfail = true\n",
      },
    });
    const result = chromatis(root, "build");
    expect(result.status).toBe(1);
    expect(result.err).toContain("contribution catalog");
    expect(result.err).toContain("failed: compiler exploded");
    expect(existsSync(path.join(root, "build"))).toBe(false);
  });

  test("build stops at an invalid artifact and lists every validator error", async () => {
    const { root } = await createInstance({
      modules: { artifact: artifactModule },
      config: {
        "app.toml": APP_TOML,
        "artifact.toml": "[default]\ncorrupt = true\ncourses = []\n",
      },
    });
    const result = chromatis(root, "build");
    expect(result.status).toBe(1);
    expect(result.err).toContain("nested/data.json is missing");
    expect(result.err).toContain("no courses published");
    expect(existsSync(path.join(root, ".chromatis/build/artifacts.ts"))).toBe(
      false,
    );
  });

  test("deploy --dry-run --offline reports the preflight before building", async () => {
    const { root } = await createInstance({
      modules: { artifact: artifactModule },
      config: { "app.toml": APP_TOML },
    });
    writeFileSync(path.join(root, "eslint.config.js"), "export default [];\n");
    const result = chromatis(root, "deploy", "--dry-run", "--offline");
    expect(result.status).toBe(1);
    expect(result.err).toContain(
      "eslint.config.js differs from the framework stub",
    );
    expect(existsSync(path.join(root, "build"))).toBe(false);
  });

  test("check --no-scripts skips the instance scripts", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
      scripts: { lint: 'bun -e "process.exit(1)"' },
    });
    expect(chromatis(root, "check", "--no-scripts").status).toBe(0);
    expect(chromatis(root, "check").err).toContain(
      "script lint: failed (exit 1)",
    );
  });
});
