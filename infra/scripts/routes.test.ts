import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateArtifacts } from "./application.js";
import { checkInstance } from "./instanceCheck.js";
import { renderReport } from "./instanceCommands.js";
import { inspectInstance } from "./instanceInspect.js";
import { flattenRoutes } from "./routes.js";
import { loadInstance, resolveApplication } from "./instance.js";
import { formatProblem } from "./problems.js";
import {
  APP_TOML,
  cleanupFixtures,
  createInstance,
  type FixtureOptions,
} from "./instanceFixture.js";

afterEach(cleanupFixtures);

const component = "export default function Page() { return null; }\n";
const loader = "export function loader() { return null; }\n";
const endpoint = "export function GET() { return new Response('ok'); }\n";

/**
 * A product package: its own root and document, an index with a server file,
 * an API endpoint, a shell layout, and a "live" module.
 */
export const productPackage: FixtureOptions = {
  app: {
    root: "../app/root.tsx",
    server: "../app/root.server.ts",
    document: { lang: "de", title: "Product & <Co>", icon: "/favicon.svg" },
    routes: [
      {
        index: true,
        file: "../app/routes/home.tsx",
        server: "../app/routes/home.server.ts",
      },
      { path: "api/health", api: true, file: "../app/routes/health.ts" },
      {
        layout: true,
        file: "../app/routes/shell.tsx",
        children: [
          { path: "courses", file: "../app/routes/courses.tsx" },
          { path: "login", file: "../app/routes/login.tsx" },
        ],
      },
    ],
  },
  packageFiles: {
    "app/root.tsx": `export function ErrorBoundary() { return null; }\n${component}`,
    "app/root.server.ts": loader,
    "app/routes/home.tsx": component,
    "app/routes/home.server.ts": loader,
    "app/routes/health.ts": endpoint,
    "app/routes/shell.tsx": component,
    "app/routes/courses.tsx": component,
    "app/routes/login.tsx": component,
  },
  modules: {
    live: {
      body: `routes: [{ path: "join", file: "./routes/join.tsx", id: "join-form" }, { path: ":code", file: "./routes/join.tsx", server: "./routes/join.server.ts" }]`,
      files: { "routes/join.tsx": component, "routes/join.server.ts": loader },
    },
  },
  config: { "app.toml": APP_TOML },
};

async function problemsOf(root: string) {
  return (await checkInstance(root, { scripts: false })).map(formatProblem);
}

describe("product routes", () => {
  test("package-level and module routes resolve in order with full URL paths", async () => {
    const { root } = await createInstance(productPackage);
    const instance = await loadInstance(root, "local");
    expect(instance.problems).toEqual([]);
    expect(
      flattenRoutes(instance.shell.routes).map((r) => [
        r.id,
        r.kind,
        r.url,
        r.owner,
        r.server !== undefined,
      ]),
    ).toEqual([
      ["routes/home", "index", "/", "app", true],
      ["routes/health", "api", "/api/health", "app", false],
      ["routes/shell", "layout", undefined, "app", false],
      ["routes/courses", "route", "/courses", "app", false],
      ["routes/login", "route", "/login", "app", false],
      ["join-form", "route", "/join", "live", false],
      ["routes/join", "route", "/:code", "live", true],
    ]);
    expect(instance.shell.root?.from).toEndWith("app/root");
    expect(instance.shell.rootServer?.from).toEndWith("app/root.server");
    expect(instance.shell.rootSource).toBe("product");
  });

  test("a disabled module drops its routes", async () => {
    const { root } = await createInstance({
      ...productPackage,
      config: { "app.toml": `${APP_TOML}\n[modules]\ndisabled = ["live"]\n` },
    });
    const instance = await loadInstance(root, "local");
    expect(flattenRoutes(instance.shell.routes).map((r) => r.id)).not.toContain(
      "join-form",
    );
    expect(instance.problems).toEqual([]);
  });

  test("the generated app directory holds the document and the browser entry", async () => {
    const { root } = await createInstance(productPackage);
    generateArtifacts(root, await resolveApplication(root, "local"));
    const read = (file: string) => readFileSync(path.join(root, file), "utf8");
    const html = read(".chromatis/app/index.html");
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("<title>Product &amp; &lt;Co&gt;</title>");
    expect(html).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    );
    expect(html).toContain(
      '<script type="module" src="/.chromatis/app/main.tsx">',
    );

    const entry = read(".chromatis/app/main.tsx");
    expect(entry).toMatch(/^import \{ startApp \} from ".*src\/client\.tsx";/);
    expect(entry).toMatch(/import \* as root from ".*app\/root";/);
    expect(entry).toContain("rootServer: true,");
    expect(entry).toContain(
      'id: "routes/home",\n      index: true,\n      server: true,',
    );
    expect(entry).toContain('path: ":code",');
    // API endpoints have no page.
    expect(entry).not.toContain("routes/health");

    const tables = read(".chromatis/build/routes.ts");
    expect(tables).toContain('{ path: "/api/health", module: module');
    expect(tables).toContain('{ id: "root", path: undefined, module: module');
    expect(tables).toContain(
      '{ id: "routes/shell", path: undefined, module: undefined }',
    );
    expect(tables).toContain(
      '{ id: "routes/join", path: "/:code", module: module',
    );
    expect(existsSync(path.join(root, "react-router.config.ts"))).toBe(false);
  });

  test("the product's static directory resolves next to the manifest", async () => {
    const { root } = await createInstance({
      ...productPackage,
      app: { ...productPackage.app, public: "../public" },
      packageFiles: { ...productPackage.packageFiles, "public/robots.txt": "" },
    });
    const instance = await loadInstance(root, "local");
    expect(instance.problems).toEqual([]);
    expect(instance.shell.publicDirectory).toEndWith(`${path.sep}public`);
    const missing = await createInstance({
      ...productPackage,
      app: { ...productPackage.app, public: "../static" },
    });
    expect(await problemsOf(missing.root)).toEqual([
      "public: app: ../static is not a directory next to the manifest",
    ]);
  });

  test("pages need a document", async () => {
    const { root } = await createInstance({
      ...productPackage,
      app: {
        root: "../app/root.tsx",
        routes: productPackage.app?.routes ?? [],
      },
    });
    expect(await problemsOf(root)).toEqual([
      "root: the product declares pages but no document; declare app.document in the manifest",
    ]);
  });
});

describe("instance routes and root", () => {
  const own = {
    "app/root.tsx": component,
    "app/root.server.ts": loader,
    "app/routes.ts": `export default [{ path: "landing", file: "./routes/landing.tsx", server: "./routes/landing.server.ts" }, { path: "api/demo", api: true, file: "./routes/demo.ts" }];\n`,
    "app/routes/landing.tsx": component,
    "app/routes/landing.server.ts": loader,
    "app/routes/demo.ts": endpoint,
  };

  test("the instance root replaces the product root; its routes are appended", async () => {
    const { root } = await createInstance({ ...productPackage, files: own });
    const instance = await loadInstance(root, "local");
    expect(instance.problems).toEqual([]);
    expect(instance.shell.rootSource).toBe("instance");
    expect(instance.shell.root?.from).toBe(path.join(root, "app/root"));
    expect(instance.shell.rootServer?.from).toBe(
      path.join(root, "app/root.server"),
    );
    expect(
      flattenRoutes(instance.shell.routes)
        .filter((r) => r.owner === "instance")
        .map((r) => [r.id, r.url, r.file, r.server]),
    ).toEqual([
      [
        "routes/landing",
        "/landing",
        path.join(root, "app/routes/landing"),
        path.join(root, "app/routes/landing.server"),
      ],
      [
        "routes/demo",
        "/api/demo",
        path.join(root, "app/routes/demo"),
        undefined,
      ],
    ]);
  });

  test("an instance root without a server file has no root loader", async () => {
    const { root } = await createInstance({
      ...productPackage,
      files: { "app/root.tsx": component },
    });
    const instance = await loadInstance(root, "local");
    expect(instance.shell.rootSource).toBe("instance");
    expect(instance.shell.rootServer).toBeUndefined();
  });

  test("app/routes.ts must default export route declarations", async () => {
    const { root } = await createInstance({
      ...productPackage,
      files: {
        "app/routes.ts": `export default [{ file: "./routes/landing.tsx" }];\n`,
        "app/routes/landing.tsx": component,
      },
    });
    const found = await problemsOf(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith(
      "app/routes.ts: must default export a list of route declarations",
    );
  });
});

describe("route checks", () => {
  test("a route file that does not exist is reported with the route id", async () => {
    const { root } = await createInstance({
      ...productPackage,
      app: {
        ...productPackage.app,
        routes: [{ path: "gone", file: "../app/routes/gone.tsx" }],
      },
    });
    const found = await problemsOf(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(
      "route routes/gone: app: cannot resolve ../app/routes/gone.tsx",
    );
  });

  test("duplicate ids and paths across the package and modules are errors", async () => {
    const { root } = await createInstance({
      ...productPackage,
      modules: {
        live: {
          body: `routes: [{ path: "login", file: "./routes/login.tsx" }, { path: "other", file: "./routes/login.tsx" }]`,
          files: { "routes/login.tsx": component },
        },
      },
    });
    const found = (await problemsOf(root)).join("\n");
    expect(found).toContain('route id "routes/login" is declared by app');
    expect(found).toContain("set an explicit id");
    expect(found).toContain('route path "/login" is declared by app');
  });
});

describe("route checks against the instance", () => {
  test("a product that has pages needs a root", async () => {
    const app = {
      document: { lang: "de", title: "Product" },
      routes: [{ index: true as const, file: "../app/routes/home.tsx" }],
    };
    const { root } = await createInstance({ ...productPackage, app });
    expect(await problemsOf(root)).toEqual([
      "root: the product declares pages but no root; add app/root.tsx or declare app.root in the manifest",
    ]);
    const own = await createInstance({
      ...productPackage,
      app,
      files: { "app/root.tsx": component },
    });
    expect(await problemsOf(own.root)).toEqual([]);
  });

  test("instance routes may not reuse a product path or id unless the path is omitted", async () => {
    const clash = {
      "app/routes.ts": `export default [{ index: true, file: "./routes/home.tsx" }];\n`,
      "app/routes/home.tsx": component,
    };
    const { root } = await createInstance({ ...productPackage, files: clash });
    const found = await problemsOf(root);
    expect(
      found.some(
        (line) =>
          line.startsWith(
            'routes: route id "routes/home" is declared by app (',
          ) &&
          line.includes(") and instance (") &&
          line.endsWith("; set an explicit id"),
      ),
    ).toBe(true);
    expect(
      found.some(
        (line) =>
          line.startsWith('routes: route path "/" is declared by app (') &&
          line.includes("[routes] omit"),
      ),
    ).toBe(true);

    const replaced = await createInstance({
      ...productPackage,
      config: { "app.toml": `${APP_TOML}\n[routes]\nomit = ["/"]\n` },
      files: {
        "app/routes.ts": `export default [{ index: true, id: "landing", file: "./routes/landing.tsx" }];\n`,
        "app/routes/landing.tsx": component,
      },
    });
    expect(await problemsOf(replaced.root)).toEqual([]);
    const instance = await loadInstance(replaced.root, "local");
    const home = flattenRoutes(instance.shell.routes).filter(
      (r) => r.url === "/",
    );
    expect(home.map((r) => [r.id, r.owner])).toEqual([["landing", "instance"]]);
    expect(instance.shell.omitted).toEqual(["/"]);
  });

  test("omitting a path no product route has is an error", async () => {
    const { root } = await createInstance({
      ...productPackage,
      config: { "app.toml": `${APP_TOML}\n[routes]\nomit = ["/nope"]\n` },
    });
    expect(await problemsOf(root)).toEqual([
      'config/app.toml: routes.omit: no product route has the path "/nope"',
    ]);
  });

  test("a route declaration needs exactly one of path, index or layout", async () => {
    const { root } = await createInstance({
      ...productPackage,
      app: {
        root: "../app/root.tsx",
        routes: [{ file: "../app/routes/home.tsx" }],
      },
    }).catch((error: Error) => ({ root: error.message }));
    expect(root).toContain(
      "set exactly one of path, index: true or layout: true",
    );
  });

  test("a project with nothing in .chromatis/app yet is not touched by check", async () => {
    const { root } = await createInstance(productPackage);
    await problemsOf(root);
    expect(existsSync(path.join(root, ".chromatis/app"))).toBe(false);
  });
});

describe("inspect lists routes", () => {
  test("root, product routes, omitted paths and instance routes", async () => {
    const { root } = await createInstance({
      ...productPackage,
      config: { "app.toml": `${APP_TOML}\n[routes]\nomit = ["/login"]\n` },
      files: {
        "app/routes.ts": `export default [{ path: "landing", file: "./routes/landing.tsx" }];\n`,
        "app/routes/landing.tsx": component,
      },
    });
    const report = await inspectInstance(root, "local", async () => undefined);
    expect(report.shell?.root.source).toBe("product");
    expect(report.shell?.routes.map((r) => r.url)).toEqual([
      "/",
      "/api/health",
      undefined,
      "/courses",
      "/join",
      "/:code",
    ]);
    expect(report.shell?.omitted).toEqual(["/login"]);
    expect(report.shell?.extraRoutes.map((r) => [r.id, r.url])).toEqual([
      ["routes/landing", "/landing"],
    ]);
    const text = renderReport(report);
    expect(text).toContain("Routes");
    expect(text).toContain("/courses");
    expect(text).toContain("Instance routes (app/routes.ts)");
    expect(text).toContain("Replaced product paths: /login");
  });
});
