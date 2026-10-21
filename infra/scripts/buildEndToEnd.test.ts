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
 * A product that declares its root, document and routes as data, a module
 * with a route, and an instance with a page and an API endpoint of its own.
 * Pages render in the browser; what the server answers is their loaders' data.
 */
const page = (mark: string) =>
  `export default function Page() { return <p>${mark}</p>; }\n`;
const loader = (data: string) =>
  `export function loader() { return ${data}; }\n`;

const product = {
  app: {
    root: "../app/root.tsx",
    document: { lang: "de", title: "MARK_TITLE" },
    public: "../public",
    routes: [
      {
        index: true,
        file: "../app/routes/home.tsx",
        server: "../app/routes/home.server.ts",
      },
    ],
  },
  packageFiles: {
    "app/root.tsx":
      'import { Outlet } from "react-router";\nexport default function Root() { return <Outlet />; }\n',
    "app/routes/home.tsx": page("MARK_HOME"),
    "app/routes/home.server.ts":
      'import { artifacts } from "chromatis-artifacts";\n' +
      loader("Object.keys(artifacts.catalog?.files ?? {})"),
    "modules/live/routes/join.tsx": page("MARK_JOIN"),
    "public/robots.txt": "MARK_PRODUCT_ROBOTS",
    "public/_headers": "MARK_PRODUCT_HEADERS",
    "public/icons/icon.svg": "<svg/>",
    "modules/live/routes/join.server.ts": loader('"MARK_JOIN"'),
  },
};

const instanceFiles = {
  "app/routes.ts":
    'export default [\n  { path: "landing", file: "./routes/landing.tsx", server: "./routes/landing.server.ts" },\n  { path: "api/ping", api: true, file: "./routes/ping.ts" },\n];\n',
  "app/routes/landing.tsx": page("MARK_LANDING"),
  "app/routes/landing.server.ts": loader('"MARK_LANDING"'),
  "app/routes/ping.ts":
    'export function GET() { return new Response("MARK_PING"); }\n',
  // The instance's own static file wins over the product's.
  "public/_headers": "MARK_INSTANCE_HEADERS",
};

/** What a running server answers for the pages, their data and the endpoint. */
async function expectServed(origin: string) {
  const text = async (url: string, init?: RequestInit) => {
    const response = await fetch(`${origin}${url}`, init);
    expect(response.status).toBe(200);
    return response.text();
  };
  const html = { headers: { Accept: "text/html" } };
  expect(await text("/", html)).toContain("<title>MARK_TITLE</title>");
  expect(await text("/landing", html)).toContain('<div id="root"></div>');
  expect(await text("/_chromatis/data?_routes=routes/home")).toContain(
    "nested/data.json",
  );
  expect(await text("/_chromatis/data/join?_routes=routes/join")).toBe(
    '{"results":{"routes/join":{"data":"MARK_JOIN"}}}',
  );
  expect(await text("/_chromatis/data/landing?_routes=routes/landing")).toBe(
    '{"results":{"routes/landing":{"data":"MARK_LANDING"}}}',
  );
  expect(await text("/api/ping")).toBe("MARK_PING");
  expect(await text("/robots.txt")).toBe("MARK_PRODUCT_ROBOTS");
  expect(await text("/icons/icon.svg")).toBe("<svg/>");
}

/** Waits until `url` answers at all. */
async function waitFor(url: string, attempts: number, delay: number) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if ((await fetch(url)).ok) {
        return true;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(delay);
  }
  return false;
}

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
        body: 'routes: [{ path: "join", file: "./routes/join.tsx", server: "./routes/join.server.ts" }]',
      },
    },
    config: {
      "app.toml": `[deployment]\ntarget = "${target}"\ndomain = "app.example.org"\n`,
    },
    files: instanceFiles,
    extraDependencies: {
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
    // The Worker as Vite's Cloudflare plugin wrote it; the Bun server as
    // `chromatis build` bundled it into the image.
    const server =
      target === "cloudflare"
        ? path.join(
            root,
            "build/server",
            (
              JSON.parse(
                readFileSync(
                  path.join(root, "build/server/wrangler.json"),
                  "utf8",
                ),
              ) as { main: string }
            ).main,
          )
        : path.join(root, ".chromatis/image/server.js");
    const bundle = readFileSync(server, "utf8");
    expect(bundle).toContain("nested/data.json");
    expect(bundle).toContain(
      Buffer.from(
        JSON.stringify({ environment: "production", courses: ["algebra"] }),
      ).toString("base64"),
    );
    expect(existsSync(path.join(root, ".chromatis/build/config.ts"))).toBe(
      true,
    );
    const document = readFileSync(
      path.join(root, "build/client/index.html"),
      "utf8",
    );
    expect(document).toContain("<title>MARK_TITLE</title>");
    const client = (file: string) =>
      readFileSync(path.join(root, "build/client", file), "utf8");
    expect(client("robots.txt")).toBe("MARK_PRODUCT_ROBOTS");
    expect(client("icons/icon.svg")).toBe("<svg/>");
    expect(client("_headers")).toBe("MARK_INSTANCE_HEADERS");
    expect(document).toMatch(
      /<script type="module" crossorigin src="\/assets\/[^"]+\.js">/,
    );
    if (target === "cloudflare") {
      const worker = readFileSync(
        path.join(root, ".chromatis/build/worker.ts"),
        "utf8",
      );
      expect(worker).toContain("hook.ts");
      expect(bundle).toContain("module config is not available at import time");
      expect(bundle).toContain("https://app.example.org");
      const wrangler = JSON.parse(
        readFileSync(path.join(root, "build/server/wrangler.json"), "utf8"),
      ) as {
        assets?: { not_found_handling?: string; run_worker_first?: string[] };
      };
      expect(wrangler.assets?.not_found_handling).toBe(
        "single-page-application",
      );
      expect(wrangler.assets?.run_worker_first).toContain("/api/ping");
      return;
    }
    // The Bun/Docker image runs: hook, config and artifacts resolve at load,
    // and it serves the document for every page path.
    const image = path.join(root, ".chromatis/image");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const running = Bun.spawn(["bun", "server.js"], {
      cwd: image,
      env: { ...process.env, PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const origin = `http://localhost:${port}`;
      expect(await waitFor(`${origin}/_chromatis/health`, 50, 100)).toBe(true);
      await expectServed(origin);
    } finally {
      running.kill();
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
      "vite",
      "--config",
      path.resolve(import.meta.dir, "../../src/vite.js"),
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  try {
    const origin = `http://localhost:${port}`;
    expect(await waitFor(`${origin}/api/ping`, 100, 200)).toBe(true);
    await expectServed(origin);
    // The app definition lists the routes with their lazy pages.
    const app = await (await fetch(`${origin}/.chromatis/app/app.ts`)).text();
    expect(app).toContain('"routes/landing"');
    expect(app).toContain("server: true");
  } finally {
    server.kill();
  }
}, 90_000);
