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
const withLoader = `export function loader() { return null; }\n${component}`;

/** A product package: its own root, index, a shell layout, and a "live" module. */
export const productPackage: FixtureOptions = {
  app: {
    root: "../app/root.tsx",
    routes: [
      { index: true, file: "../app/routes/home.tsx" },
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
    "app/routes/home.tsx": withLoader,
    "app/routes/shell.tsx": component,
    "app/routes/courses.tsx": withLoader,
    "app/routes/login.tsx": component,
  },
  modules: {
    live: {
      body: `routes: [{ path: "join", file: "./routes/join.tsx", id: "join-form" }, { path: ":code", file: "./routes/join.tsx" }]`,
      files: { "routes/join.tsx": withLoader },
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
      flattenRoutes(instance.shell.routes).map((r) => [r.id, r.url, r.owner]),
    ).toEqual([
      ["routes/home", "/", "app"],
      ["routes/shell", undefined, "app"],
      ["routes/courses", "/courses", "app"],
      ["routes/login", "/login", "app"],
      ["join-form", "/join", "live"],
      ["routes/join", "/:code", "live"],
    ]);
    expect(instance.shell.root?.from).toEndWith("app/root");
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

  test("the generated app directory re-exports each route with its real export names", async () => {
    const { root } = await createInstance(productPackage);
    generateArtifacts(root, await resolveApplication(root, "local"));
    const directory = path.join(root, ".chromatis/app");
    const read = (file: string) =>
      readFileSync(path.join(directory, file), "utf8");
    expect(read("root.tsx")).toMatch(
      /^export \{ default, ErrorBoundary \} from ".*app\/root";\n$/,
    );
    expect(read("routes/routes_home.tsx")).toMatch(
      /^export \{ default, loader \} from /,
    );
    const routes = read("routes.ts");
    expect(routes).toContain('"id": "routes/home"');
    expect(routes).toContain('"index": true');
    expect(routes).toContain('"path": ":code"');
    expect(routes).toContain("export default product;");
    expect(read("../../react-router.config.ts")).toBe(
      `export default {
  ssr: true,
  appDirectory: ".chromatis/app",
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
};
`,
    );
  });
});

describe("instance routes and root", () => {
  const own = {
    "app/root.tsx": component,
    "app/routes.ts": `import { type RouteConfig, index, route } from "@react-router/dev/routes";\nexport default [route("landing", "routes/landing.tsx")] satisfies RouteConfig;\n`,
    "app/routes/landing.tsx": component,
  };

  test("the instance root replaces the product root; its routes are appended", async () => {
    const { root } = await createInstance({ ...productPackage, files: own });
    generateArtifacts(root, await resolveApplication(root, "local"));
    const directory = path.join(root, ".chromatis/app");
    expect(readFileSync(path.join(directory, "root.tsx"), "utf8")).toContain(
      path.join(root, "app/root"),
    );
    const routes = readFileSync(path.join(directory, "routes.ts"), "utf8");
    expect(routes).toContain('import extra from "../../app/routes";');
    expect(routes).toContain("rebase(await extra)");
  });

  test("the instance routes evaluate as React Router route config", async () => {
    const { root } = await createInstance({
      ...productPackage,
      files: { ...own, "app/root.tsx": component },
      linkChromatis: true,
      inside: path.resolve(import.meta.dir, "../../.e2e"),
    });
    expect(await problemsOf(root)).toEqual([]);
  });
});

describe("route checks", () => {
  test("a route file that does not exist is reported with the route id", async () => {
    const { root } = await createInstance({
      ...productPackage,
      app: {
        root: "../app/root.tsx",
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
  test("a product that has routes needs a root", async () => {
    const { root } = await createInstance({
      ...productPackage,
      app: { routes: [{ index: true, file: "../app/routes/home.tsx" }] },
    });
    expect(await problemsOf(root)).toEqual([
      "root: the product declares routes but no root; add app/root.tsx or declare app.root in the manifest",
    ]);
    const own = await createInstance({
      ...productPackage,
      app: { routes: [{ index: true, file: "../app/routes/home.tsx" }] },
      files: { "app/root.tsx": component },
    });
    expect(await problemsOf(own.root)).toEqual([]);
  });

  test("instance routes may not reuse a product path or id unless the path is omitted", async () => {
    const clash = {
      "app/routes.ts": `export default [{ index: true, file: "routes/home.tsx" }];\n`,
      "app/routes/home.tsx": component,
    };
    const { root } = await createInstance({ ...productPackage, files: clash });
    const found = await problemsOf(root);
    expect(
      found.some(
        (line) =>
          line.startsWith(
            'app/routes.ts: route id "routes/home" is already used by app (',
          ) && line.endsWith("; set an explicit id"),
      ),
    ).toBe(true);
    expect(
      found.some(
        (line) =>
          line.includes('route path "/" is already used') &&
          line.includes("[routes] omit"),
      ),
    ).toBe(true);

    const replaced = await createInstance({
      ...productPackage,
      config: { "app.toml": `${APP_TOML}\n[routes]\nomit = ["/"]\n` },
      files: {
        "app/routes.ts": `export default [{ index: true, id: "landing", file: "routes/landing.tsx" }];\n`,
        "app/routes/landing.tsx": component,
      },
    });
    expect(await problemsOf(replaced.root)).toEqual([]);
    const instance = await loadInstance(replaced.root, "local");
    expect(
      flattenRoutes(instance.shell.routes).map((r) => r.url),
    ).not.toContain("/");
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
        "app/routes.ts": `export default [{ path: "landing", file: "routes/landing.tsx" }];\n`,
        "app/routes/landing.tsx": component,
      },
    });
    const report = await inspectInstance(root, "local", async () => undefined);
    expect(report.shell?.root.source).toBe("product");
    expect(report.shell?.routes.map((r) => r.url)).toEqual([
      "/",
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
