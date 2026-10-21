import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createManifest,
  serializeManifest,
  type ChromatisManifest,
  type ModuleDeclaration,
} from "../../src/module.js";
import {
  applyDirectives,
  planEditorSchemas,
  writeEditorSchemas,
} from "./editorSchemas.js";
import { loadInstance } from "./instance.js";
import { repairTooling } from "./tooling.js";

const moduleSource = path.resolve(import.meta.dir, "../../src/module.ts");

export type FixtureModule = Readonly<{
  /** Properties of the `defineModule` argument after `name`. */
  body?: string;
  /** Extra files next to module.ts. */
  files?: Readonly<Record<string, string>>;
}>;

export type FixtureOptions = Readonly<{
  modules?: Readonly<Record<string, FixtureModule>>;
  /** Files below `config/`. */
  config?: Readonly<Record<string, string>>;
  packageName?: string;
  instanceName?: string;
  /** Write a manifest; false leaves the dependency without one. */
  manifest?: boolean;
  /** Edit the generated manifest before it is written. */
  editManifest?: (manifest: ChromatisManifest) => unknown;
  /** Install the package as a symlink, as `bun link` does. */
  linked?: boolean;
  /**
   * Monorepo layout: the instance is `<repo>/dev`, the product package is
   * `<repo>/packages/app`, linked from the repo's `node_modules` as a
   * `workspace:*` dependency.
   */
  workspace?: boolean;
  extraDependencies?: Readonly<Record<string, string>>;
  /** Place the instance below this directory so it resolves this repo's dependencies. */
  inside?: string;
  /** Link `@chromatis/base` to this checkout (needed to run a real build). */
  linkChromatis?: boolean;
  /** Application-level root and routes of the product package (manifest `app`). */
  app?: Parameters<typeof createManifest>[1];
  /** Extra files in the product package, relative to its root. */
  packageFiles?: Readonly<Record<string, string>>;
  /** Extra instance files, relative to the instance root. */
  files?: Readonly<Record<string, string>>;
  /** `scripts` of the instance package.json. */
  scripts?: Readonly<Record<string, string>>;
  /** `exports` of the product package (written before any module is loaded). */
  packageExports?: Readonly<Record<string, string>>;
  /**
   * Leave the instance as `chromatis init` and `chromatis fix` leave it: editor
   * schemas generated and every hand-written TOML file naming its schema.
   * Default true; `false` gives a hand-made, never initialized instance.
   */
  editor?: boolean;
}>;

export type Fixture = Readonly<{
  root: string;
  packageRoot: string;
  cleanup: () => void;
}>;

const directories: string[] = [];

export function cleanupFixtures(): void {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function layout(options: FixtureOptions) {
  const repo = mkdtempSync(
    path.join(options.inside ?? tmpdir(), "chromatis-instance-"),
  );
  directories.push(repo);
  const root = options.workspace === true ? path.join(repo, "dev") : repo;
  mkdirSync(root, { recursive: true });
  const packageName = options.packageName ?? "@product/app";
  let store = path.join(root, "node_modules", packageName);
  if (options.workspace === true || options.linked === true) {
    store =
      options.workspace === true
        ? path.join(repo, "packages/app")
        : mkdtempSync(path.join(tmpdir(), "chromatis-linked-"));
    mkdirSync(store, { recursive: true });
    directories.push(store);
    const modules = options.workspace === true ? repo : root;
    mkdirSync(path.join(modules, "node_modules", path.dirname(packageName)), {
      recursive: true,
    });
    symlinkSync(store, path.join(modules, "node_modules", packageName), "dir");
  }
  const packageRoot = store;
  if (options.workspace === true) {
    write(
      path.join(repo, "package.json"),
      JSON.stringify({
        name: "monorepo",
        private: true,
        workspaces: ["dev", "packages/*"],
      }),
    );
  }
  return { repo, root, packageName, packageRoot };
}

/**
 * Builds an instance in a temp directory with one installed product package
 * that carries a generated manifest, the way a real product build does.
 */
export async function createInstance(
  options: FixtureOptions = {},
): Promise<Fixture> {
  const { repo, root, packageName, packageRoot } = layout(options);

  write(
    path.join(root, "package.json"),
    JSON.stringify({
      name: options.instanceName ?? "demo-instance",
      private: true,
      scripts: options.scripts,
      dependencies: {
        [packageName]: options.workspace === true ? "workspace:*" : "1.0.0",
        ...options.extraDependencies,
      },
    }),
  );
  repairTooling(root);
  if (options.linkChromatis === true) {
    mkdirSync(path.join(root, "node_modules/@chromatis"), { recursive: true });
    symlinkSync(
      path.resolve(import.meta.dir, "../.."),
      path.join(root, "node_modules/@chromatis/base"),
      "dir",
    );
  }
  for (const [name, text] of Object.entries(options.files ?? {})) {
    write(path.join(root, name), text);
  }

  write(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version: "1.2.3",
      exports: options.packageExports,
      chromatis:
        options.manifest === false
          ? undefined
          : { manifest: "./dist/chromatis.manifest.json" },
    }),
  );
  const declarations: { entry: string; declaration: ModuleDeclaration }[] = [];
  for (const [name, definition] of Object.entries(options.modules ?? {})) {
    const directory = path.join(packageRoot, "modules", name);
    const file = path.join(directory, "module.ts");
    write(
      file,
      `import { defineModule, z } from ${JSON.stringify(moduleSource)};\nvoid z;\nexport default defineModule({ name: ${JSON.stringify(name)}, ${definition.body ?? ""} });\n`,
    );
    for (const [relative, text] of Object.entries(definition.files ?? {})) {
      write(path.join(directory, relative), text);
    }
    const declaration = (
      (await import(pathToFileURL(file).href)) as { default: ModuleDeclaration }
    ).default;
    declarations.push({ entry: `../modules/${name}/module.ts`, declaration });
  }

  if (options.manifest !== false) {
    const manifest = createManifest(declarations, options.app);
    write(
      path.join(packageRoot, "dist/chromatis.manifest.json"),
      options.editManifest
        ? `${JSON.stringify(options.editManifest(manifest), null, 2)}\n`
        : serializeManifest(manifest),
    );
  }
  for (const [name, text] of Object.entries(options.packageFiles ?? {})) {
    write(path.join(packageRoot, name), text);
  }
  for (const [name, text] of Object.entries(options.config ?? {})) {
    write(path.join(root, "config", name), text);
  }
  if (options.editor !== false) {
    const plan = await planEditorSchemas(await loadInstance(root, "local"));
    writeEditorSchemas(root, plan);
    applyDirectives(root, plan);
  }
  return {
    root,
    packageRoot,
    cleanup: () => rmSync(repo, { recursive: true, force: true }),
  };
}

export const APP_TOML = `[deployment]\ntarget = "cloudflare"\ndomain = "example.org"\n`;

export const classroom: FixtureModule = {
  body: `
    config: { schema: z.object({ maxStudents: z.number().int().positive().default(30), mode: z.enum(["quiet", "loud"]).default("quiet") }).strict() },
    secrets: [{ name: "CLASSROOM_KEY", description: "Signs join codes", required: "always" }],
    runtime: ["classroom"], serverHook: "hook.ts", database: true,
  `,
  files: { "hook.ts": "export default { definitions: [] };\n" },
};

export const catalog: FixtureModule = {
  body: `
    config: { schema: z.object({ root: z.string(), courses: z.array(z.string()).min(1) }).strict(), required: true },
    secrets: [{ name: "CATALOG_SALT", description: "Production only", required: "production" }],
    contributions: [{ id: "catalog", module: "@product/compiler/contribution" }],
    artifacts: [{ id: "catalog", path: "catalog" }],
  `,
};

export const CATALOG_TOML = `[default]\nroot = "content"\ncourses = ["algebra"]\n`;

/**
 * A module with a fake build contribution, artifact and validator. The
 * contribution writes its environment and module configs into the artifact; it
 * fails when `fail` is set, and leaves out the data file when `corrupt` is set.
 */
export const artifactModule: FixtureModule = {
  body: `
    config: { schema: z.object({ courses: z.array(z.string()).default(["algebra"]), fail: z.boolean().default(false), corrupt: z.boolean().default(false) }).strict() },
    contributions: [{ id: "catalog", module: "../modules/artifact/contribute.ts" }],
    artifacts: [{ id: "catalog", path: "catalog", validator: { module: "../modules/artifact/validate.ts" } }],
  `,
  files: {
    "contribute.ts": `
      import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
      import path from "node:path";
      export default async function (context: { instanceRoot: string; outDir: string; environment: string; config: Record<string, any> }) {
        appendFileSync(path.join(context.instanceRoot, "contribution.log"), "catalog\\n");
        const settings = context.config.artifact;
        if (settings.fail) throw new Error("compiler exploded");
        const directory = path.join(context.outDir, "catalog");
        mkdirSync(path.join(directory, "nested"), { recursive: true });
        writeFileSync(path.join(directory, "catalog.meta.json"), JSON.stringify({ environment: context.environment, courses: settings.courses }));
        if (!settings.corrupt) writeFileSync(path.join(directory, "nested/data.json"), "{}");
      }
    `,
    "validate.ts": `
      import { existsSync, readFileSync } from "node:fs";
      import path from "node:path";
      export default function (directory: string) {
        const errors: string[] = [];
        if (!existsSync(path.join(directory, "catalog.meta.json"))) return { ok: false, errors: ["catalog.meta.json is missing"] };
        if (!existsSync(path.join(directory, "nested/data.json"))) errors.push("nested/data.json is missing");
        if (JSON.parse(readFileSync(path.join(directory, "catalog.meta.json"), "utf8")).courses.length === 0) errors.push("no courses published");
        return errors.length ? { ok: false, errors } : { ok: true };
      }
    `,
  },
};

/**
 * `artifactModule` plus a server hook that imports both virtual modules and
 * reads its module configuration at import time (as Durable Object definitions
 * do).
 */
export const hookedModule: FixtureModule = {
  body: `${artifactModule.body ?? ""} serverHook: "hook.ts",`,
  files: {
    ...artifactModule.files,
    "hook.ts": `
      import { artifacts } from "chromatis-artifacts";
      import { app, config } from "chromatis-config";
      const settings = config.artifact as { courses: string[] } | undefined;
      if (!settings) throw new Error("module config is not available at import time");
      export default {
        definitions: [],
        createService(_host: unknown, env: Record<string, string | undefined>) {
          return {
            courses: settings.courses,
            publicUrl: app.publicUrl,
            domain: app.domain,
            environment: app.environment,
            files: Object.keys(artifacts.catalog?.files ?? {}),
            envKeys: Object.keys(env),
          };
        },
      };
    `,
  },
};
