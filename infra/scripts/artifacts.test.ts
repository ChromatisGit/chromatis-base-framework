import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  embedArtifacts,
  prepareArtifacts,
  staleArtifacts,
} from "./artifacts.js";
import { checkInstance } from "./instanceCheck.js";
import { resolveApplication } from "./instance.js";
import { formatProblem, InstanceProblemsError } from "./problems.js";
import {
  APP_TOML,
  artifactModule,
  cleanupFixtures,
  createInstance,
} from "./instanceFixture.js";

afterEach(cleanupFixtures);

async function instance(config = "") {
  const fixture = await createInstance({
    modules: { artifact: artifactModule },
    config: {
      "app.toml": APP_TOML,
      ...(config ? { "artifact.toml": config } : {}),
    },
  });
  return fixture;
}

async function failure(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(InstanceProblemsError);
    return (error as Error).message;
  }
  throw new Error("expected a failure");
}

describe("build contributions and artifacts", () => {
  test("a contribution gets the validated module config and writes into its own directory", async () => {
    const { root } = await instance(
      '[default]\ncourses = ["algebra", "geometry"]\n',
    );
    const app = await resolveApplication(root, "production");
    expect(app.contributions.map((c) => [c.id, c.owner])).toEqual([
      ["catalog", "artifact"],
    ]);
    await prepareArtifacts(root, app);
    const meta = JSON.parse(
      readFileSync(
        path.join(root, ".chromatis/artifacts/catalog/catalog.meta.json"),
        "utf8",
      ),
    );
    expect(meta).toEqual({
      environment: "production",
      courses: ["algebra", "geometry"],
    });
  });

  test("contributions run in id order", async () => {
    const second = {
      body: `contributions: [{ id: "aaa", module: "../modules/second/contribute.ts" }]`,
      files: {
        "contribute.ts": `import { appendFileSync } from "node:fs"; import path from "node:path"; export default async (c: { instanceRoot: string }) => { appendFileSync(path.join(c.instanceRoot, "contribution.log"), "aaa\\n"); };`,
      },
    };
    const { root } = await createInstance({
      modules: { artifact: artifactModule, second },
      config: { "app.toml": APP_TOML },
    });
    await prepareArtifacts(root, await resolveApplication(root, "local"));
    expect(readFileSync(path.join(root, "contribution.log"), "utf8")).toBe(
      "aaa\ncatalog\n",
    );
  });

  test("a failing contribution aborts with its id and message", async () => {
    const { root } = await instance("[default]\nfail = true\n");
    const app = await resolveApplication(root, "local");
    const message = await failure(prepareArtifacts(root, app));
    expect(message).toContain("contribution catalog");
    expect(message).toContain("failed: compiler exploded");
  });

  test("validator errors from every artifact are aggregated", async () => {
    const { root } = await instance(
      "[default]\ncorrupt = true\ncourses = []\n",
    );
    const message = await failure(
      prepareArtifacts(root, await resolveApplication(root, "local")),
    );
    expect(message).toContain(
      "artifact catalog: catalog: nested/data.json is missing",
    );
    expect(message).toContain(
      "artifact catalog: catalog: no courses published",
    );
  });

  test("an unresolvable contribution module is reported with its specifier", async () => {
    const broken = {
      body: `contributions: [{ id: "nope", module: "@missing/compiler/contribution" }]`,
    };
    const { root } = await createInstance({
      modules: { broken },
      config: { "app.toml": APP_TOML },
    });
    const message = await failure(
      prepareArtifacts(root, await resolveApplication(root, "local")),
    );
    expect(message).toContain("contribution nope");
    expect(message).toContain("cannot resolve @missing/compiler/contribution");
  });

  test("a validator with the wrong result shape is an error", async () => {
    const odd = {
      body: `contributions: [{ id: "odd", module: "../modules/odd/contribute.ts" }], artifacts: [{ id: "odd", path: "odd", validator: { module: "../modules/odd/validate.ts" } }]`,
      files: {
        "contribute.ts": "export default async () => {};",
        "validate.ts": "export default () => true;",
      },
    };
    const { root } = await createInstance({
      modules: { odd },
      config: { "app.toml": APP_TOML },
    });
    expect(
      await failure(
        prepareArtifacts(root, await resolveApplication(root, "local")),
      ),
    ).toContain(
      "validator must return { ok: true } or { ok: false, errors: string[] }",
    );
  });
});

describe("embedding artifacts", () => {
  test("embedding records the exact validated directory and detects later changes", async () => {
    const { root } = await instance();
    const app = await resolveApplication(root, "local");
    await prepareArtifacts(root, app);
    embedArtifacts(root, app);
    const embedded = (await import(
      `${path.join(root, ".chromatis/build/artifacts.ts")}?${Date.now()}`
    )) as {
      artifacts: Record<
        string,
        { basename: string; files: Record<string, string> }
      >;
    };
    expect(Object.keys(embedded.artifacts)).toEqual(["catalog"]);
    expect(embedded.artifacts.catalog?.basename).toBe("catalog");
    expect(Object.keys(embedded.artifacts.catalog?.files ?? {})).toEqual([
      "catalog.meta.json",
      "nested/data.json",
    ]);
    expect(staleArtifacts(root, app)).toEqual([]);
    writeFileSync(
      path.join(root, ".chromatis/artifacts/catalog/nested/data.json"),
      '{"changed":1}',
    );
    expect(staleArtifacts(root, app).map(formatProblem)).toEqual([
      "artifact catalog: catalog: the build does not embed the current artifact; run chromatis build",
    ]);
  });

  test("an instance without artifacts embeds an empty module", async () => {
    const { root } = await createInstance({
      modules: {},
      config: { "app.toml": APP_TOML },
    });
    embedArtifacts(root, await resolveApplication(root, "local"));
    expect(
      readFileSync(path.join(root, ".chromatis/build/artifacts.ts"), "utf8"),
    ).toContain("= {}");
  });
});

describe("check validates artifacts without mutating the instance", () => {
  test("passes for a valid catalog and leaves no artifacts behind", async () => {
    const { root } = await instance();
    expect(
      (await checkInstance(root, { scripts: false })).map(formatProblem),
    ).toEqual([]);
    expect(existsSync(path.join(root, ".chromatis/artifacts"))).toBe(false);
    expect(existsSync(path.join(root, ".chromatis/build"))).toBe(false);
  });

  test("fails when the contribution fails, an artifact is invalid, or configuration is invalid", async () => {
    const failing = await instance("[default]\nfail = true\n");
    expect(
      (await checkInstance(failing.root, { scripts: false })).map(
        formatProblem,
      ),
    ).toEqual([
      "contribution catalog: artifact (../modules/artifact/contribute.ts): failed: compiler exploded",
    ]);
    const corrupt = await instance("[default]\ncorrupt = true\n");
    expect(
      (await checkInstance(corrupt.root, { scripts: false })).map(
        formatProblem,
      ),
    ).toEqual(["artifact catalog: catalog: nested/data.json is missing"]);
    const invalid = await instance("[default]\ncourses = 3\n");
    const found = (await checkInstance(invalid.root, { scripts: false })).map(
      formatProblem,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("config/artifact.toml: courses");
  });

  test("uses the requested environment for the contribution", async () => {
    const { root } = await instance(
      '[default]\ncourses = []\n[production]\ncourses = ["algebra"]\n',
    );
    expect(
      (await checkInstance(root, { scripts: false })).map(formatProblem),
    ).toEqual(["artifact catalog: catalog: no courses published"]);
    expect(
      await checkInstance(root, { scripts: false, environment: "production" }),
    ).toEqual([]);
  });

  test("artifacts nothing produces are validated where they are", async () => {
    const supplied = {
      body: `artifacts: [{ id: "static", path: "static", validator: { module: "../modules/supplied/validate.ts" } }]`,
      files: {
        "validate.ts": `import { existsSync } from "node:fs"; import path from "node:path"; export default (directory: string) => existsSync(path.join(directory, "ok")) ? { ok: true } : { ok: false, errors: ["ok marker missing"] };`,
      },
    };
    const { root } = await createInstance({
      modules: { supplied },
      config: { "app.toml": APP_TOML },
    });
    const run = async () =>
      (await checkInstance(root, { scripts: false })).map(formatProblem);
    expect(await run()).toEqual([
      "module supplied: artifacts.static: no contribution produces static and it is not present in .chromatis/artifacts/",
    ]);
    mkdirSync(path.join(root, ".chromatis/artifacts/static"), {
      recursive: true,
    });
    expect(await run()).toEqual(["artifact static: static: ok marker missing"]);
    writeFileSync(path.join(root, ".chromatis/artifacts/static/ok"), "");
    expect(await run()).toEqual([]);
  });
});
