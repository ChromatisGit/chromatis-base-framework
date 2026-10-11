import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BunPlugin } from "bun";
import type { ResolvedApplication } from "./resolvedApplication.js";

/**
 * Chromatis' two virtual modules, written under `.chromatis/build/`:
 *
 * - `chromatis-config`: `config[moduleName]` (validated module configuration
 *   for the build environment) and `app` (`name`, `domain`, `publicUrl`,
 *   `environment`). Plain, non-secret data available at module load time.
 * - `chromatis-artifacts`: the embedded artifacts (see embedArtifacts).
 *
 * Vite aliases them for dev and builds; `virtualModulePlugin` resolves them for
 * plain Bun (importing the server hook, `Bun.build`).
 */
export const VIRTUAL_MODULES = ["chromatis-artifacts", "chromatis-config"];

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

export function configModuleText(app: ResolvedApplication): string {
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
        { filter: /^chromatis-(artifacts|config)$/ },
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

/** `bun build` with the virtual modules resolved (the CLI cannot take a plugin). */
export async function bundleForBun(
  root: string,
  entry: string,
  outfile: string,
): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    outdir: path.dirname(outfile),
    naming: path.basename(outfile),
    plugins: [virtualModulePlugin(root)],
  });
  if (!result.success) {
    throw new Error(
      `bundling ${path.basename(entry)} failed:\n${result.logs.map(String).join("\n")}`,
    );
  }
}
