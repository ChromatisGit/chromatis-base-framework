import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { discoverManifest, loadModules } from "./manifestDiscovery.js";
import { InstanceProblemsError } from "./problems.js";
import {
  cleanupFixtures,
  createInstance,
  type FixtureModule,
} from "./instanceFixture.js";

afterEach(cleanupFixtures);

const alpha: FixtureModule = {
  body: `secrets: [{ name: "ALPHA_KEY", description: "a", required: "always" }]`,
};
const beta: FixtureModule = { body: `database: true` };

function problems(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof InstanceProblemsError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected InstanceProblemsError");
}

describe("manifest discovery", () => {
  test("finds the dependency that declares chromatis.manifest and sorts modules", async () => {
    const { root } = await createInstance({ modules: { beta, alpha } });
    const discovery = discoverManifest(root);
    expect(discovery.packageName).toBe("@product/app");
    expect(discovery.packageVersion).toBe("1.2.3");
    expect(discovery.manifest.modules.map((m) => m.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(discovery.manifest.modules[0]?.secrets[0]?.name).toBe("ALPHA_KEY");
  });

  test("follows a linked package to its real location", async () => {
    const { root, packageRoot } = await createInstance({
      modules: { alpha },
      linked: true,
    });
    const discovery = discoverManifest(root);
    expect(discovery.packageRoot).toBe(realpathSync(packageRoot));
    const { modules, problems: found } = await loadModules(discovery, root);
    expect(found).toEqual([]);
    expect(modules.map((m) => m.name)).toEqual(["alpha"]);
  });

  test("reports no manifest dependency, naming dependencies that are not installed", async () => {
    const { root } = await createInstance({
      manifest: false,
      extraDependencies: { "left-pad-missing": "1.0.0" },
    });
    const message = problems(() => discoverManifest(root));
    expect(message).toContain("no direct dependency declares");
    expect(message).toContain("left-pad-missing");
  });

  test("rejects more than one manifest dependency", async () => {
    const { root } = await createInstance({ modules: { alpha } });
    const other = path.join(root, "node_modules/@other/app");
    mkdirSync(other, { recursive: true });
    writeFileSync(
      path.join(other, "package.json"),
      JSON.stringify({
        name: "@other/app",
        chromatis: { manifest: "./m.json" },
      }),
    );
    const instance = path.join(root, "package.json");
    const manifest = JSON.parse(readFileSync(instance, "utf8")) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies["@other/app"] = "1.0.0";
    writeFileSync(instance, JSON.stringify(manifest));
    expect(problems(() => discoverManifest(root))).toContain(
      "exactly one direct dependency may declare chromatis.manifest; found @other/app, @product/app",
    );
  });

  test("rejects a manifest path outside the package and a missing file", async () => {
    const { root, packageRoot } = await createInstance({ modules: { alpha } });
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@product/app",
        chromatis: { manifest: "../x.json" },
      }),
    );
    expect(problems(() => discoverManifest(root))).toContain(
      "must stay inside the package",
    );
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@product/app",
        chromatis: { manifest: "./nope.json" },
      }),
    );
    expect(problems(() => discoverManifest(root))).toContain(
      "manifest file is missing",
    );
  });

  test("validates manifest shape and unsorted modules", async () => {
    const { root } = await createInstance({
      modules: { alpha, beta },
      editManifest: (manifest) => ({
        ...manifest,
        extra: true,
        modules: [...manifest.modules].reverse(),
      }),
    });
    const message = problems(() => discoverManifest(root));
    expect(message).toContain("Unrecognized key");
    expect(message).toContain("sorted by name");
  });
});

describe("module loading", () => {
  test("imports each entry and keeps manifest order", async () => {
    const { root } = await createInstance({ modules: { beta, alpha } });
    const { modules, problems: found } = await loadModules(
      discoverManifest(root),
      root,
    );
    expect(found).toEqual([]);
    expect(modules.map((m) => m.declaration.name)).toEqual(["alpha", "beta"]);
  });

  test("reports a manifest that no longer matches the module", async () => {
    const { root } = await createInstance({
      modules: { alpha },
      editManifest: (manifest) => ({
        ...manifest,
        modules: manifest.modules.map((m) => ({ ...m, database: true })),
      }),
    });
    const { problems: found } = await loadModules(discoverManifest(root), root);
    expect(found.map((p) => p.message).join("\n")).toContain(
      "manifest is out of date (differs in database)",
    );
  });

  test("reports an entry that cannot be loaded and one that is not a module", async () => {
    const { root, packageRoot } = await createInstance({
      modules: { alpha, beta },
      editManifest: (manifest) => ({
        ...manifest,
        modules: manifest.modules.map((m) => ({
          ...m,
          entry: `../extra/${m.name}.ts`,
        })),
      }),
    });
    mkdirSync(path.join(packageRoot, "extra"));
    writeFileSync(
      path.join(packageRoot, "extra/alpha.ts"),
      "export default 42;\n",
    );
    writeFileSync(
      path.join(packageRoot, "extra/beta.ts"),
      "throw new Error('boom');\n",
    );
    const { modules, problems: found } = await loadModules(
      discoverManifest(root),
      root,
    );
    expect(modules).toEqual([]);
    const text = found.map((p) => p.message).join("\n");
    expect(text).toContain("must default export defineModule");
    expect(text).toContain("boom");
  });

  test("requires the server hook file next to the module", async () => {
    const { root, packageRoot } = await createInstance({
      modules: {
        live: {
          body: `runtime: ["room"], serverHook: "hook.ts"`,
          files: { "hook.ts": "export default { definitions: [] };\n" },
        },
        broken: { body: `serverHook: "missing.ts"` },
      },
    });
    const { modules, problems: found } = await loadModules(
      discoverManifest(root),
      root,
    );
    expect(found.map((p) => p.message)).toEqual([
      "missing.ts does not exist next to ../modules/broken/module.ts",
    ]);
    expect(modules.find((m) => m.name === "live")?.serverHook).toBe(
      path.join(packageRoot, "modules/live/hook.ts"),
    );
  });

  test("accepts bare package specifiers through the package's exports", async () => {
    const { root } = await createInstance({
      modules: { alpha },
      packageExports: { "./alpha": "./modules/alpha/module.ts" },
      editManifest: (manifest) => ({
        ...manifest,
        modules: manifest.modules.map((m) => ({
          ...m,
          entry: "@product/app/alpha",
        })),
      }),
    });
    const { modules, problems: found } = await loadModules(
      discoverManifest(root),
      root,
    );
    expect(found).toEqual([]);
    expect(modules).toHaveLength(1);
  });
});
