import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateArtifacts, loadHook } from "./application.js";
import { embedArtifacts, prepareArtifacts } from "./artifacts.js";
import { resolveApplication } from "./instance.js";
import {
  APP_TOML,
  cleanupFixtures,
  createInstance,
  hookedModule,
} from "./instanceFixture.js";
import { assertPlainData, bundleForBun } from "./virtualModules.js";

afterEach(cleanupFixtures);

async function prepared(config = "") {
  const { root } = await createInstance({
    modules: { artifact: hookedModule },
    config: {
      "app.toml": APP_TOML,
      ...(config ? { "artifact.toml": config } : {}),
    },
  });
  const app = await resolveApplication(root, "production");
  await prepareArtifacts(root, app);
  generateArtifacts(root, app);
  embedArtifacts(root, app);
  return { root, app };
}

describe("virtual modules", () => {
  test("the generated config module holds module configs and the app facts", async () => {
    const { root } = await prepared('[default]\ncourses = ["a", "b"]\n');
    const text = readFileSync(
      path.join(root, ".chromatis/build/config.ts"),
      "utf8",
    );
    expect(text).toContain(
      '"artifact":{"courses":["a","b"],"fail":false,"corrupt":false}',
    );
    expect(text).toContain(
      '{"name":"demo-instance","domain":"example.org","publicUrl":"https://example.org","environment":"production"}',
    );
  });

  test("the hook loads in plain Bun and reads both modules at import time", async () => {
    const { app } = await prepared('[default]\ncourses = ["a", "b"]\n');
    const hook = await loadHook(app);
    const service = hook?.createService({} as never, { PUBLIC_URL: "x" }) as {
      courses: string[];
      publicUrl: string;
      domain: string;
      environment: string;
      files: string[];
      envKeys: string[];
    };
    expect(service).toEqual({
      courses: ["a", "b"],
      publicUrl: "https://example.org",
      domain: "example.org",
      environment: "production",
      files: ["catalog.meta.json", "nested/data.json"],
      envKeys: ["PUBLIC_URL"],
    });
  });

  test("the hook can be bundled with bun build and the bundle runs without aliases", async () => {
    const { root, app } = await prepared();
    const entry = path.join(root, ".chromatis/build/entry.ts");
    await Bun.write(
      entry,
      `import hook from ${JSON.stringify(app.serverHook)};\nconsole.log(JSON.stringify((hook as any).createService({}, {})));\n`,
    );
    const outfile = path.join(root, ".chromatis/image/server.js");
    await bundleForBun(root, entry, outfile);
    const output = Bun.spawnSync(["bun", outfile], {
      stdout: "pipe",
    }).stdout.toString();
    expect(JSON.parse(output)).toMatchObject({
      courses: ["algebra"],
      publicUrl: "https://example.org",
    });
  });

  test("config that JSON cannot carry unchanged is rejected", () => {
    expect(() =>
      assertPlainData({ a: { b: [1, "x", null, true] } }, "c"),
    ).not.toThrow();
    expect(() => assertPlainData({ at: new Date() }, "config")).toThrow(
      "config.at is not plain JSON data",
    );
    expect(() => assertPlainData({ m: new Map() }, "config")).toThrow();
  });
});
