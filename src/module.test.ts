import { describe, expect, test } from "bun:test";
import { ValidationError } from "./errors.js";
import {
  createManifest,
  defineModule,
  lenientObjectPaths,
  manifestSchema,
  parseModuleDeclaration,
  serializeManifest,
  z,
} from "./module.js";

const schema = z.object({ size: z.number().default(1) }).strict();

function details(action: () => unknown): Record<string, readonly string[]> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.details;
    }
    throw error;
  }
  throw new Error("expected a ValidationError");
}

describe("defineModule", () => {
  test("applies defaults and freezes the declaration", () => {
    const declaration = defineModule({ name: "catalog" });
    expect(declaration).toEqual({
      name: "catalog",
      secrets: [],
      runtime: [],
      database: false,
      contributions: [],
      artifacts: [],
      authoredFiles: [],
      routes: [],
    });
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration.secrets)).toBe(true);
  });

  test("normalizes config, contributions and artifacts", () => {
    const declaration = defineModule({
      name: "catalog",
      config: { schema },
      contributions: [
        { id: "catalog", module: "@product/compiler/contribution" },
      ],
      artifacts: [
        {
          id: "catalog",
          path: "catalog",
          validator: { module: "@product/contract" },
        },
      ],
    });
    expect(declaration.config?.required).toBe(false);
    expect(declaration.contributions[0]?.export).toBe("default");
    expect(declaration.artifacts[0]?.validator).toEqual({
      module: "@product/contract",
      export: "default",
    });
  });
});

describe("defineModule validation", () => {
  test.each([
    ["Name", { name: "Catalog" }, "name"],
    ["reserved name", { name: "app" }, "name"],
    ["unknown key", { name: "x", extra: 1 }, "declaration"],
    [
      "secret name",
      {
        name: "x",
        secrets: [{ name: "lower", description: "d", required: "always" }],
      },
      "secrets.0.name",
    ],
    [
      "reserved secret",
      {
        name: "x",
        secrets: [
          { name: "DATABASE_URL", description: "d", required: "always" },
        ],
      },
      "secrets.0.name",
    ],
    [
      "secret requirement",
      {
        name: "x",
        secrets: [{ name: "A", description: "d", required: "never" }],
      },
      "secrets.0.required",
    ],
    [
      "duplicate secret",
      {
        name: "x",
        secrets: [
          { name: "A", description: "d", required: "always" },
          { name: "A", description: "d", required: "production" },
        ],
      },
      "secrets.1",
    ],
    ["runtime without hook", { name: "x", runtime: ["room"] }, "serverHook"],
    ["hook escapes", { name: "x", serverHook: "../hook.ts" }, "serverHook"],
    ["absolute hook", { name: "x", serverHook: "/hook.ts" }, "serverHook"],
    [
      "artifact path escapes",
      { name: "x", artifacts: [{ id: "a", path: "../outside" }] },
      "artifacts.0.path",
    ],
    [
      "duplicate contribution",
      {
        name: "x",
        contributions: [
          { id: "a", module: "m" },
          { id: "a", module: "m" },
        ],
      },
      "contributions.1",
    ],
    [
      "config not a schema",
      { name: "x", config: { schema: {} } },
      "config.schema",
    ],
  ])("rejects %s", (_label, input, key) => {
    expect(Object.keys(details(() => defineModule(input as never)))).toContain(
      key,
    );
  });
});

describe("defineModule config schemas", () => {
  test("requires strict config schemas, including nested ones", () => {
    expect(
      details(() =>
        defineModule({
          name: "x",
          config: { schema: z.object({ a: z.string() }) },
        }),
      )["config.schema"],
    ).toEqual([
      "object schema at (root) must be .strict() so unknown keys are rejected",
    ]);
    expect(
      lenientObjectPaths(
        z
          .object({ inner: z.object({ a: z.string() }).optional() })
          .strict()
          .superRefine(() => {}),
      ),
    ).toEqual(["inner"]);
    expect(lenientObjectPaths(z.object({ a: z.string() }).strict())).toEqual(
      [],
    );
    expect(lenientObjectPaths(z.record(z.string(), z.string()))).toEqual([]);
  });

  test("a declaration round-trips through parseModuleDeclaration", () => {
    const declaration = defineModule({
      name: "classroom",
      runtime: ["room"],
      serverHook: "hook.ts",
      database: true,
    });
    const parsed = parseModuleDeclaration(declaration);
    expect(parsed.ok && parsed.declaration).toEqual(declaration);
    expect(parseModuleDeclaration(42).ok).toBe(false);
  });
});

describe("manifest", () => {
  const classroom = defineModule({
    name: "classroom",
    config: {
      schema: z
        .object({ b: z.number().default(1), a: z.string().default("x") })
        .strict(),
    },
    secrets: [
      { name: "ZED", description: "z", required: "production" },
      { name: "ALPHA", description: "a", required: "always" },
    ],
    runtime: ["room", "board"],
    serverHook: "hook.ts",
    database: true,
  });
  const catalog = defineModule({
    name: "catalog",
    config: {
      schema: z.object({ courses: z.array(z.string()) }).strict(),
      required: true,
    },
    contributions: [{ id: "catalog", module: "@p/compiler/contribution" }],
    artifacts: [{ id: "catalog", path: "catalog" }],
  });

  test("is sorted and independent of declaration order", () => {
    const first = createManifest([
      { entry: "./classroom.js", declaration: classroom },
      { entry: "./catalog.js", declaration: catalog },
    ]);
    const second = createManifest([
      { entry: "./catalog.js", declaration: catalog },
      { entry: "./classroom.js", declaration: classroom },
    ]);
    expect(serializeManifest(first)).toBe(serializeManifest(second));
    expect(first.modules.map((module) => module.name)).toEqual([
      "catalog",
      "classroom",
    ]);
    const summary = first.modules[1];
    expect(summary?.config).toEqual({ required: false, keys: ["a", "b"] });
    expect(summary?.secrets.map((secret) => secret.name)).toEqual([
      "ALPHA",
      "ZED",
    ]);
    expect(summary?.runtime).toEqual(["board", "room"]);
    expect(first.modules[0]?.config).toEqual({
      required: true,
      keys: ["courses"],
    });
    expect(
      manifestSchema.safeParse(JSON.parse(serializeManifest(first))).success,
    ).toBe(true);
  });

  test("rejects unsorted and unknown content", () => {
    const manifest = createManifest([
      { entry: "./catalog.js", declaration: catalog },
      { entry: "./classroom.js", declaration: classroom },
    ]);
    expect(
      manifestSchema.safeParse({
        ...manifest,
        modules: [...manifest.modules].reverse(),
      }).success,
    ).toBe(false);
    expect(manifestSchema.safeParse({ ...manifest, extra: 1 }).success).toBe(
      false,
    );
    expect(
      manifestSchema.safeParse({ ...manifest, formatVersion: 2 }).success,
    ).toBe(false);
  });
});

describe("route declarations", () => {
  const declare = (routes: unknown) =>
    defineModule({ name: "live", routes: routes as never });

  test("routes, index routes and layouts nest like React Router's config", () => {
    const declaration = declare([
      { index: true, file: "./routes/home.tsx" },
      {
        layout: true,
        file: "./routes/shell.tsx",
        children: [{ path: "login", file: "./routes/login.tsx", id: "login" }],
      },
    ]);
    expect(declaration.routes).toHaveLength(2);
    expect(declaration.routes[1]?.children?.[0]).toEqual({
      path: "login",
      file: "./routes/login.tsx",
      id: "login",
    });
  });

  test.each([
    ["no kind", [{ file: "./a.tsx" }]],
    ["two kinds", [{ path: "a", index: true, file: "./a.tsx" }]],
    ["index with children", [{ index: true, file: "./a.tsx", children: [] }]],
    ["unknown key", [{ path: "a", file: "./a.tsx", loader: "x" }]],
    ["bad id", [{ path: "a", file: "./a.tsx", id: "../x" }]],
    [
      "nested error",
      [{ path: "a", file: "./a.tsx", children: [{ file: "./b.tsx" }] }],
    ],
  ])("rejects %s", (_label, routes) => {
    expect(() => declare(routes)).toThrow(ValidationError);
  });

  test("the manifest carries module routes and the package's own root and routes", () => {
    const module = declare([{ path: "join", file: "./routes/join.tsx" }]);
    const manifest = createManifest(
      [{ entry: "./live.js", declaration: module }],
      {
        root: "./app/root.tsx",
        routes: [{ index: true, file: "./app/home.tsx" }],
      },
    );
    expect(manifest.app).toEqual({
      root: "./app/root.tsx",
      routes: [{ index: true, file: "./app/home.tsx" }],
    });
    expect(manifest.modules[0]?.routes).toEqual([
      { path: "join", file: "./routes/join.tsx" },
    ]);
    expect(
      manifestSchema.safeParse(JSON.parse(serializeManifest(manifest))).success,
    ).toBe(true);
    expect(
      createManifest([{ entry: "./live.js", declaration: module }]).app,
    ).toBeUndefined();
  });
});
