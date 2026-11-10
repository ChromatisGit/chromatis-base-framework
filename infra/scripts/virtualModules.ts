import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BunPlugin } from "bun";
import type { ResolvedApplication } from "./resolvedApplication.js";
import { loadMigrationFiles } from "./dbMigrations.js";

/**
 * Chromatis' virtual modules, written under `.chromatis/build/`:
 *
 * - `chromatis-config`: `config[moduleName]` (validated module configuration
 *   for the build environment) and `app` (`name`, `domain`, `publicUrl`,
 *   `environment`). Plain, non-secret data available at module load time.
 * - `chromatis-artifacts`: the embedded artifacts (see embedArtifacts).
 *
 * Vite aliases them for dev and builds; `virtualModulePlugin` resolves them for
 * plain Bun (importing the server hook, `Bun.build`).
 */
export const VIRTUAL_MODULES = [
  "chromatis-artifacts",
  "chromatis-config",
  "chromatis-migrations",
];

const virtualFile = (root: string, specifier: string): string =>
  path.join(
    root,
    ".chromatis/build",
    `${specifier.slice("chromatis-".length)}.ts`,
  );

/** Throws on anything JSON cannot carry unchanged (dates, maps, functions, ...). */
export function assertPlainData(value: unknown, where: string): void {
  if (
    value === null ||
    ["string", "number", "boolean"].includes(typeof value)
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlainData(item, `${where}[${index}]`));
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        assertPlainData(child, `${where}.${key}`);
      }
    }
    return;
  }
  throw new Error(`${where} is not plain JSON data`);
}

const mountedImport = JSON.stringify(
  path.resolve(import.meta.dir, "../../src/mounted.ts"),
);

/** `chromatis-config` of a mounted image: read and validated at startup. */
function mountedConfigText(app: ResolvedApplication): string {
  return [
    `import { loadMountedConfig, mountedOrExit } from ${mountedImport};`,
    ...app.configModules.map(
      (module, index) =>
        `import module${index} from ${JSON.stringify(module.entryFile)};`,
    ),
    `export const { config, app } = mountedOrExit(() => loadMountedConfig(${JSON.stringify(app.name)}, [`,
    ...app.configModules.map(
      (module, index) =>
        `  { name: ${JSON.stringify(module.name)}, declaration: module${index}, required: ${module.required} },`,
    ),
    "]));",
    "",
  ].join("\n");
}

/** `chromatis-artifacts` of a mounted image: read and validated at startup. */
export function mountedArtifactsText(app: ResolvedApplication): string {
  const validators = app.artifacts.map((artifact) => artifact.validator);
  for (const validator of validators) {
    if (validator && !validator.file) {
      throw new Error(
        `cannot resolve ${validator.specifier}: ${validator.error ?? "unknown"}`,
      );
    }
  }
  return [
    `import { loadMountedArtifacts, mountedOrExit } from ${mountedImport};`,
    ...validators.flatMap((validator, index) =>
      validator
        ? [
            `import { ${validator.export} as validate${index} } from ${JSON.stringify(validator.file)};`,
          ]
        : [],
    ),
    "export const artifacts = await mountedOrExit(() => loadMountedArtifacts([",
    ...app.artifacts.map(
      (artifact, index) =>
        `  { id: ${JSON.stringify(artifact.id)}, path: ${JSON.stringify(artifact.path)}${artifact.validator ? `, validate: validate${index}` : ""} },`,
    ),
    "]));",
    "",
  ].join("\n");
}

export function configModuleText(app: ResolvedApplication): string {
  if (app.mounted) {
    return mountedConfigText(app);
  }
  const publicUrl = new URL(app.publicUrl);
  assertPlainData(app.moduleConfigs, "config");
  return [
    `export const config: Readonly<Record<string, unknown>> = ${JSON.stringify(app.moduleConfigs)};`,
    `export const app: Readonly<{ name: string; domain: string; publicUrl: string; environment: string }> = ${JSON.stringify(
      {
        name: app.name,
        domain: publicUrl.hostname,
        publicUrl: app.publicUrl,
        environment: app.environment,
      },
    )};`,
    "",
  ].join("\n");
}

export function writeConfigModule(
  root: string,
  app: ResolvedApplication,
): void {
  const file = virtualFile(root, "chromatis-config");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, configModuleText(app));
  const migrations = app.postgresql
    ? loadMigrationFiles(path.join(app.packageRoot, "src/modules")).map(
        ({ module, version, description, sql }) => ({
          module,
          version,
          description,
          sql,
        }),
      )
    : [];
  writeFileSync(
    virtualFile(root, "chromatis-migrations"),
    `export const migrations = ${JSON.stringify(migrations)};\n`,
  );
  if (app.mounted) {
    writeFileSync(
      virtualFile(root, "chromatis-artifacts"),
      mountedArtifactsText(app),
    );
  }
}

const EMPTY_ARTIFACTS = "export const artifacts = {};";

/**
 * Bundler plugin (`Bun.build`): resolves the virtual modules to
 * `<root>/.chromatis/build/*.ts`. A missing artifacts module resolves to an
 * empty one (callers validate artifacts separately); a missing config module
 * is an error.
 */
export function virtualModulePlugin(root: string): BunPlugin {
  return {
    name: "chromatis-virtual-modules",
    setup(builder) {
      builder.onResolve(
        { filter: /^chromatis-(artifacts|config|migrations)$/ },
        (args) => {
          const file = virtualFile(root, args.path);
          if (existsSync(file)) {
            return { path: file };
          }
          if (args.path === "chromatis-artifacts") {
            return { path: args.path, namespace: "chromatis-empty" };
          }
          throw new Error(
            `${args.path} is not generated (${file}); run chromatis init`,
          );
        },
      );
      builder.onLoad({ filter: /.*/, namespace: "chromatis-empty" }, () => ({
        contents: EMPTY_ARTIFACTS,
        loader: "js",
      }));
    },
  };
}

let current: string | undefined;
let registered = false;

/**
 * Makes the virtual modules importable in this Bun process, for `root` (the
 * runtime plugin API only supports `module()`; the files are read at import).
 */
export function registerVirtualModules(root: string): void {
  current = root;
  if (registered) {
    return;
  }
  registered = true;
  Bun.plugin({
    name: "chromatis-virtual-modules",
    setup(builder) {
      for (const specifier of VIRTUAL_MODULES) {
        builder.module(specifier, () => {
          const file = virtualFile(current ?? root, specifier);
          if (existsSync(file)) {
            return { contents: readFileSync(file, "utf8"), loader: "ts" };
          }
          if (specifier === "chromatis-artifacts") {
            return { contents: EMPTY_ARTIFACTS, loader: "js" };
          }
          throw new Error(
            `${specifier} is not generated (${file}); run chromatis init`,
          );
        });
      }
    },
  });
}

/**
 * `bun build` with the virtual modules resolved (the CLI cannot take a plugin).
 * Only the JavaScript entry is written: styles and fonts that shared UI code
 * imports end up as extra outputs the server never reads.
 */
export async function bundleForBun(
  root: string,
  entry: string,
  outfile: string,
): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    plugins: [virtualModulePlugin(root)],
    throw: false,
  });
  const output = result.outputs.find(({ kind }) => kind === "entry-point");
  if (!result.success || !output) {
    throw new Error(
      `bundling ${path.basename(entry)} failed:\n${result.logs.map(String).join("\n")}`,
    );
  }
  mkdirSync(path.dirname(outfile), { recursive: true });
  await Bun.write(outfile, output);
}
