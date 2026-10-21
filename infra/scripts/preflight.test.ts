import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareArtifacts } from "./artifacts.js";
import { checkInstance } from "./instanceCheck.js";
import { resolveApplication } from "./instance.js";
import { preflight } from "./preflight.js";
import { formatProblem } from "./problems.js";
import {
  APP_TOML,
  artifactModule,
  cleanupFixtures,
  createInstance,
  type FixtureModule,
} from "./instanceFixture.js";
import {
  checkTooling,
  expectedTooling,
  generatedTooling,
  repairTooling,
} from "./tooling.js";

afterEach(cleanupFixtures);

const nothing = async () => undefined;
const EXAMPLE_TOML = APP_TOML.replace("example.org", "example.com");

async function deployable(config = "") {
  const fixture = await createInstance({
    modules: { artifact: artifactModule },
    config: {
      "app.toml": EXAMPLE_TOML,
      ...(config ? { "artifact.toml": config } : {}),
    },
  });
  const app = await resolveApplication(fixture.root, "production");
  await prepareArtifacts(fixture.root, app);
  return { ...fixture, app };
}

describe("deployment preflight", () => {
  test("static level passes for a prepared instance before the build", async () => {
    const { root, app } = await deployable();
    expect(
      await preflight({
        root,
        app,
        target: "cloudflare",
        phase: "pre",
        level: "static",
      }),
    ).toEqual([]);
  });

  test("the post phase wants the build output and an up-to-date embedding", async () => {
    const { root, app } = await deployable();
    const found = await preflight({
      root,
      app,
      target: "docker",
      phase: "post",
      level: "static",
    });
    expect(found).toContain("build/client missing; run chromatis build");
    expect(found).toContain(
      "artifact catalog: catalog: the build does not embed the current artifact; run chromatis build",
    );
  });
});

describe("deployment preflight at the full level", () => {
  test("full level lists every unmet prerequisite at once", async () => {
    const { root, app } = await deployable();
    const found = await preflight({
      root,
      app,
      target: "cloudflare",
      phase: "pre",
      level: "full",
      lookup: nothing,
    });
    expect(found).toContain(
      "https://example.com is an example domain; set the real [deployment] domain before deploying to Cloudflare",
    );
    expect(found).toContain(
      "CLOUDFLARE_API_TOKEN missing; run chromatis secret",
    );
  });
});

describe("deployment preflight secrets", () => {
  test("missing declared secrets are named, with database ones when a module uses PostgreSQL", async () => {
    const database: FixtureModule = {
      body: `secrets: [{ name: "SESSION_KEY", description: "k", required: "always" }], database: true`,
    };
    const { root } = await createInstance({
      modules: { database },
      config: { "app.toml": APP_TOML },
    });
    const app = await resolveApplication(root, "production");
    const found = await preflight({
      root,
      app,
      target: "cloudflare",
      phase: "pre",
      level: "full",
      lookup: nothing,
    });
    expect(found).toContain(
      "missing secrets for production: DATABASE_MIGRATION_URL, DATABASE_URL, SESSION_KEY; run chromatis secret (or set them in the environment)",
    );
  });

  test("secrets present in the environment or store satisfy the preflight", async () => {
    const database: FixtureModule = {
      body: `secrets: [{ name: "SESSION_KEY", description: "k", required: "always" }]`,
    };
    const { root } = await createInstance({
      modules: { database },
      config: {
        "app.toml": '[deployment]\ntarget = "bun"\ndomain = "localhost"\n',
      },
    });
    const app = await resolveApplication(root, "production");
    const found = await preflight({
      root,
      app,
      target: "cloudflare",
      phase: "pre",
      level: "full",
      lookup: async (_service, name) =>
        name === "SESSION_KEY" ? "value" : undefined,
    });
    expect(found.some((line) => line.includes("missing secrets"))).toBe(false);
    expect(found).toContain(
      "[deployment] domain is localhost; Cloudflare needs the public domain",
    );
  });

  test("invalid artifacts and a missing hook fail the preflight", async () => {
    const { root, app } = await deployable();
    rmSync(path.join(root, ".chromatis/artifacts/catalog/nested"), {
      recursive: true,
    });
    const found = await preflight({
      root,
      app,
      target: "docker",
      phase: "pre",
      level: "static",
    });
    expect(found).toEqual([
      "artifact catalog: catalog: nested/data.json is missing",
    ]);
  });

  test("a module that uses PostgreSQL passes the static database checks without modules to scan", async () => {
    const database: FixtureModule = { body: `database: true` };
    const { root } = await createInstance({
      modules: { database },
      config: { "app.toml": APP_TOML },
    });
    const app = await resolveApplication(root, "production");
    expect(
      await preflight({
        root,
        app,
        target: "docker",
        phase: "pre",
        level: "static",
      }),
    ).toEqual([]);
  });
});

describe("generated tooling", () => {
  test("root files are one-line stubs; the substance is generated under .chromatis", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
    });
    expect(
      Object.values(expectedTooling()).every(
        (text) => text.split("\n").length <= 4,
      ),
    ).toBe(true);
    expect(Object.keys(generatedTooling())).toEqual([
      ".chromatis/tsconfig.json",
      ".chromatis/eslint.config.js",
      ".chromatis/types.d.ts",
    ]);
    expect(checkTooling(root)).toEqual([]);
    rmSync(path.join(root, ".chromatis/tsconfig.json"));
    expect(checkTooling(root)).toEqual([
      ".chromatis/tsconfig.json differs from the framework output; run chromatis init",
    ]);
    repairTooling(root);
    expect(checkTooling(root)).toEqual([]);
  });
});

describe("check runs the instance scripts without recursion", () => {
  const scripts = {
    typecheck:
      "bun -e \"require('fs').appendFileSync('ran.log', 'typecheck\\\\n')\"",
    lint: "bun -e \"console.error('lint exploded'); process.exit(3)\"",
    check: "bun -e \"require('fs').appendFileSync('ran.log', 'check\\\\n')\"",
  };

  test("runs typecheck/lint/format/test when defined, never check, and reports failures", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
      scripts,
    });
    const found = (await checkInstance(root)).map(formatProblem);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("script lint: failed (exit 3)");
    expect(found[0]).toContain("lint exploded");
    expect(await Bun.file(path.join(root, "ran.log")).text()).toBe(
      "typecheck\n",
    );
  });

  test("scripts are skipped with scripts:false and while another check is running", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
      scripts,
    });
    expect(await checkInstance(root, { scripts: false })).toEqual([]);
    process.env.CHROMATIS_CHECK_ACTIVE = "1";
    try {
      expect(await checkInstance(root)).toEqual([]);
    } finally {
      delete process.env.CHROMATIS_CHECK_ACTIVE;
    }
  });
});

describe("check gates without instance scripts", () => {
  function tool(root: string, name: string, exitCode: number) {
    const bin = path.join(root, "node_modules/.bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      path.join(bin, name),
      `#!/bin/sh\necho "${name} $@" >> "${root}/tools.log"\necho ${name} output >&2\nexit ${exitCode}\n`,
      { mode: 0o755 },
    );
  }

  test("typecheck, lint and format run with Chromatis' defaults when installed", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
    });
    tool(root, "tsc", 0);
    tool(root, "eslint", 3);
    tool(root, "prettier", 0);
    const found = (await checkInstance(root)).map(formatProblem);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("check lint: failed (exit 3)");
    expect(found[0]).toContain("eslint output");
    const log = readFileSync(path.join(root, "tools.log"), "utf8")
      .trim()
      .split("\n");
    expect(log).toEqual([
      "tsc --noEmit",
      "eslint . --max-warnings 0",
      "prettier package.json --check",
    ]);
  });

  test("an instance script replaces the default for its gate", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
      scripts: { lint: 'bun -e "process.exit(0)"' },
    });
    tool(root, "eslint", 3);
    expect(await checkInstance(root)).toEqual([]);
  });

  test("tools that are not installed are skipped", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
    });
    expect(await checkInstance(root)).toEqual([]);
  });
});
