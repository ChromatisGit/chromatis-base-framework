import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
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

  test("a server bundle whose code imports styles is one file", async () => {
    const { root } = await prepared();
    const entry = path.join(root, ".chromatis/build/styled.ts");
    await Bun.write(path.join(root, ".chromatis/build/look.css"), "a{}");
    await Bun.write(entry, 'import "./look.css";\nconsole.log("styled");\n');
    const outfile = path.join(root, ".chromatis/image/server.js");
    await bundleForBun(root, entry, outfile);
    expect(readdirSync(path.dirname(outfile))).toEqual(["server.js"]);
    expect(
      Bun.spawnSync(["bun", outfile], { stdout: "pipe" }).stdout.toString(),
    ).toBe("styled\n");
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

describe("mounted image", () => {
  test("a mounted image reads configuration and artifacts when it starts", async () => {
    const { root } = await createInstance({
      modules: { artifact: hookedModule },
      config: {
        "app.toml": `[deployment]\ntarget = "bun"\ndomain = "localhost"\ninstance = "mounted"\n`,
      },
    });
    const app = await resolveApplication(root, "production");
    expect(app.contributions).toEqual([]);
    generateArtifacts(root, app);
    const entry = path.join(root, ".chromatis/build/entry.ts");
    await Bun.write(
      entry,
      `import hook from ${JSON.stringify(app.serverHook)};\nconsole.log(JSON.stringify((hook as any).createService({}, {})));\n`,
    );
    const outfile = path.join(root, ".chromatis/image/server.js");
    await bundleForBun(root, entry, outfile);
    const mount = path.join(root, "mount");
    await Bun.write(
      path.join(mount, "config/artifact.toml"),
      'courses = ["geometry"]\n',
    );
    await Bun.write(
      path.join(mount, "artifacts/catalog/catalog.meta.json"),
      '{"courses":["geometry"]}',
    );
    await Bun.write(
      path.join(mount, "artifacts/catalog/nested/data.json"),
      "{}",
    );
    const start = (instance: string) =>
      Bun.spawnSync(["bun", outfile], {
        env: {
          ...process.env,
          CHROMATIS_INSTANCE: instance,
          PUBLIC_URL: "https://school.example",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    expect(JSON.parse(start(mount).stdout.toString())).toMatchObject({
      courses: ["geometry"],
      publicUrl: "https://school.example",
      files: ["catalog.meta.json", "nested/data.json"],
    });
    const empty = start(path.join(root, "nothing"));
    expect(empty.exitCode).toBe(1);
    expect(empty.stderr.toString()).toContain(
      "artifacts/catalog is missing (artifact catalog)",
    );
  });

  test("a mounted image refuses module configuration of its own", async () => {
    const { root } = await createInstance({
      modules: { artifact: hookedModule },
      config: {
        "app.toml": `[deployment]\ntarget = "bun"\ndomain = "localhost"\ninstance = "mounted"\n`,
        "artifact.toml": "",
      },
    });
    await expect(resolveApplication(root, "production")).rejects.toThrow(
      "a mounted image reads module configuration from the mount",
    );
  });
});
