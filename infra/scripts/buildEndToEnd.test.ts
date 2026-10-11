import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateArtifacts } from "./application.js";
import { embedArtifacts, prepareArtifacts } from "./artifacts.js";
import { resolveApplication } from "./instance.js";
import {
  cleanupFixtures,
  createInstance,
  hookedModule,
} from "./instanceFixture.js";

afterEach(cleanupFixtures);

const cli = path.resolve(import.meta.dir, "chromatis.ts");
const sandbox = path.resolve(import.meta.dir, "../../.e2e");

/**
 * A product that declares its root and routes as data, a module with a route,
 * and an instance with one extra route of its own: no app/root.tsx, and no
 * route re-export files in the instance.
 */
const page = (mark: string, data = "null") =>
  `export function loader() { return ${data}; }\nexport default function Page() { return <p>${mark}</p>; }\n`;

const product = {
  app: {
    root: "../app/root.tsx",
    routes: [{ index: true, file: "../app/routes/home.tsx" }],
  },
  packageFiles: {
    "app/root.tsx":
      'import { Outlet } from "react-router";\nexport default function Root() { return <Outlet />; }\n',
    "app/routes/home.tsx":
      'import { artifacts } from "chromatis-artifacts";\n' +
      page("MARK_HOME", "Object.keys(artifacts.catalog?.files ?? {})"),
    "modules/live/routes/join.tsx": page("MARK_JOIN"),
  },
};

const instanceFiles = {
  "app/routes.ts":
    'import { type RouteConfig, route } from "@react-router/dev/routes";\nexport default [route("landing", "routes/landing.tsx")] satisfies RouteConfig;\n',
  "app/routes/landing.tsx": page("MARK_LANDING"),
};

async function instance(target: string) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(sandbox, { recursive: true });
  return createInstance({
    inside: sandbox,
    linkChromatis: true,
    ...product,
    modules: {
      artifact: hookedModule,
      live: {
        body: 'routes: [{ path: "join", file: "./routes/join.tsx" }]',
      },
    },
    config: {
      "app.toml": `[deployment]\ntarget = "${target}"\ndomain = "app.example.org"\n`,
    },
    files: instanceFiles,
    extraDependencies: {
      "@react-router/node": "*",
      isbot: "*",
      react: "*",
      "react-dom": "*",
      "react-router": "*",
    },
  });
}

for (const target of ["bun", "cloudflare"]) {
  test(`chromatis build embeds the artifact and config for a hook that reads both at import (${target})`, async () => {
    const { root } = await instance(target);
    const result = Bun.spawnSync(["bun", cli, "build"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.stderr.toString()).not.toContain("[chromatis]");
    expect(result.exitCode).toBe(0);
    expect(
      existsSync(
        path.join(root, ".chromatis/artifacts/catalog/catalog.meta.json"),
      ),
    ).toBe(true);
    const bundle = readFileSync(
      path.join(root, "build/server/index.js"),
      "utf8",
    );
    expect(bundle).toContain("nested/data.json");
    expect(bundle).toContain(
      Buffer.from(
        JSON.stringify({ environment: "production", courses: ["algebra"] }),
      ).toString("base64"),
    );
    expect(existsSync(path.join(root, ".chromatis/build/config.ts"))).toBe(
      true,
    );
    if (target === "cloudflare") {
      const worker = readFileSync(
        path.join(root, ".chromatis/build/worker.ts"),
        "utf8",
      );
      expect(worker).toContain("hook.ts");
      expect(bundle).toContain("module config is not available at import time");
      expect(bundle).toContain("https://app.example.org");
      return;
    }
    // The Bun/Docker image runs: hook, config and artifacts resolve at load.
    const image = path.join(root, ".chromatis/image");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const server = Bun.spawn(["bun", "server.js"], {
      cwd: image,
      env: { ...process.env, PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      let healthy = false;
      for (let attempt = 0; attempt < 50 && !healthy; attempt++) {
        try {
          healthy = (await fetch(`http://localhost:${port}/_chromatis/health`))
            .ok;
        } catch {
          await Bun.sleep(100);
        }
      }
      expect(healthy).toBe(true);
    } finally {
      server.kill();
    }
  }, 60_000);
}

test("the dev server serves product, module and instance routes through the generated app directory", async () => {
  const { root } = await instance("bun");
  const app = await resolveApplication(root, "local");
  await prepareArtifacts(root, app);
  generateArtifacts(root, app);
  embedArtifacts(root, app);
  const port = 31000 + Math.floor(Math.random() * 1000);
  const server = Bun.spawn(
    [
      "bun",
      "x",
      "react-router",
      "dev",
      "--config",
      path.resolve(import.meta.dir, "../../src/vite.js"),
      "--port",
      String(port),
    ],
    {
      cwd: root,
      env: { ...process.env, REACT_ROUTER_ROOT: root },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  try {
    for (const [url, mark] of [
      ["/", "MARK_HOME"],
      ["/join", "MARK_JOIN"],
      ["/landing", "MARK_LANDING"],
    ] as const) {
      let text = "";
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const response = await fetch(`http://localhost:${port}${url}`);
          text = await response.text();
          if (response.status === 200) {
            break;
          }
        } catch {
          await Bun.sleep(200);
        }
      }
      expect(text).toContain(mark);
    }
  } finally {
    server.kill();
  }
}, 90_000);
