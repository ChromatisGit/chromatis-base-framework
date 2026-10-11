import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  manifestSchema,
  parseModuleDeclaration,
  summarizeModule,
  type ChromatisManifest,
  type ManifestModule,
  type ModuleDeclaration,
} from "../../src/module.js";
import { InstanceProblemsError, type Problem } from "./problems.js";

export type ManifestDiscovery = Readonly<{
  packageName: string;
  packageVersion: string | undefined;
  /** Real path of the package that carries the manifest. */
  packageRoot: string;
  manifestFile: string;
  manifest: ChromatisManifest;
}>;

export type LoadedModule = Readonly<{
  name: string;
  /** Specifier exactly as written in the manifest. */
  entry: string;
  entryFile: string;
  /** Directory of the module's `module.ts`; module-relative paths start here. */
  directory: string;
  declaration: ModuleDeclaration;
  /** Absolute server hook file, when declared. */
  serverHook: string | undefined;
}>;

type PackageJson = {
  name?: unknown;
  version?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  chromatis?: unknown;
};

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Directory of an installed package, found like Node does (nearest `node_modules`). */
function installedPackage(root: string, name: string): string | undefined {
  for (let directory = root; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    if (path.dirname(directory) === directory) {
      return undefined;
    }
  }
}

function directDependencyNames(manifest: PackageJson): string[] {
  const names = new Set<string>();
  for (const field of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
  ]) {
    if (isRecord(field)) {
      Object.keys(field).forEach((name) => names.add(name));
    }
  }
  return [...names].sort();
}

function manifestField(
  packageJson: PackageJson,
): { declared: false } | { declared: true; value: unknown } {
  const field = packageJson.chromatis;
  if (isRecord(field) && "manifest" in field) {
    return { declared: true, value: field.manifest };
  }
  return { declared: false };
}

/**
 * Finds the single direct dependency of the instance whose package.json has
 * `chromatis.manifest`, then reads and validates that manifest.
 */
export function discoverManifest(root: string): ManifestDiscovery {
  const instanceFile = path.join(root, "package.json");
  if (!existsSync(instanceFile)) {
    throw new InstanceProblemsError([
      { source: "package.json", message: "missing; run in an instance root" },
    ]);
  }
  const instance = readJson(instanceFile) as PackageJson;
  const carriers: { name: string; packageRoot: string; field: unknown }[] = [];
  const notInstalled: string[] = [];
  for (const name of directDependencyNames(instance)) {
    const packageRoot = installedPackage(root, name);
    if (!packageRoot) {
      notInstalled.push(name);
      continue;
    }
    const field = manifestField(
      readJson(path.join(packageRoot, "package.json")) as PackageJson,
    );
    if (field.declared) {
      carriers.push({ name, packageRoot, field: field.value });
    }
  }

  if (carriers.length === 0) {
    const hint = notInstalled.length
      ? ` Not installed (cannot be inspected): ${notInstalled.join(", ")}; run bun install.`
      : "";
    throw new InstanceProblemsError([
      {
        source: "package.json",
        message: `no direct dependency declares "chromatis": { "manifest": ... } in its package.json.${hint}`,
      },
    ]);
  }
  const [carrier, ...others] = carriers;
  if (!carrier || others.length > 0) {
    throw new InstanceProblemsError([
      {
        source: "package.json",
        message: `exactly one direct dependency may declare chromatis.manifest; found ${carriers.map((c) => c.name).join(", ")}`,
      },
    ]);
  }
  return readManifest(carrier);
}

function readManifest(carrier: {
  name: string;
  packageRoot: string;
  field: unknown;
}): ManifestDiscovery {
  const { name, packageRoot, field } = carrier;
  const source = `${name} package.json`;
  if (typeof field !== "string" || field === "") {
    throw new InstanceProblemsError([
      { source, key: "chromatis.manifest", message: "must be a relative path" },
    ]);
  }
  const manifestFile = path.resolve(packageRoot, field);
  const relative = path.relative(packageRoot, manifestFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new InstanceProblemsError([
      {
        source,
        key: "chromatis.manifest",
        message: "must stay inside the package",
      },
    ]);
  }
  const displayed = `${name}/${relative.split(path.sep).join("/")}`;
  if (!existsSync(manifestFile) || !statSync(manifestFile).isFile()) {
    throw new InstanceProblemsError([
      {
        source: displayed,
        message: `manifest file is missing; build ${name} to generate it`,
      },
    ]);
  }
  let json: unknown;
  try {
    json = readJson(manifestFile);
  } catch (error) {
    throw new InstanceProblemsError([
      {
        source: displayed,
        message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new InstanceProblemsError(
      parsed.error.issues.map((issue) => ({
        source: displayed,
        key: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  const version = (
    readJson(path.join(packageRoot, "package.json")) as PackageJson
  ).version;
  return {
    packageName: name,
    packageVersion: typeof version === "string" ? version : undefined,
    packageRoot,
    manifestFile,
    manifest: {
      ...parsed.data,
      modules: [...parsed.data.modules].sort((a, b) =>
        a.name < b.name ? -1 : 1,
      ),
    },
  };
}

/** Resolves a manifest specifier: relative to the manifest file, else a package. */
export function resolveSpecifier(
  specifier: string,
  discovery: ManifestDiscovery,
  instanceRoot: string,
): string {
  const failures: string[] = [];
  const origins = specifier.startsWith(".")
    ? [path.dirname(discovery.manifestFile)]
    : [discovery.packageRoot, instanceRoot];
  for (const from of origins) {
    try {
      return Bun.resolveSync(specifier, from);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(failures[0]);
}

function differingFields(actual: ManifestModule, listed: ManifestModule) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(listed)]);
  return [...keys]
    .filter(
      (key) =>
        JSON.stringify(actual[key as keyof ManifestModule]) !==
        JSON.stringify(listed[key as keyof ManifestModule]),
    )
    .sort();
}

async function loadModule(
  listed: ManifestModule,
  discovery: ManifestDiscovery,
  root: string,
): Promise<{ module?: LoadedModule; problems: Problem[] }> {
  const source = `${discovery.packageName} module ${listed.name}`;
  let entryFile: string;
  let exported: unknown;
  try {
    entryFile = resolveSpecifier(listed.entry, discovery, root);
    exported = (
      (await import(pathToFileURL(entryFile).href)) as {
        default?: unknown;
      }
    ).default;
  } catch (error) {
    return {
      problems: [
        {
          source,
          key: "entry",
          message: `cannot load ${listed.entry}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const parsed = parseModuleDeclaration(exported);
  if (!parsed.ok) {
    return {
      problems: parsed.issues.map((issue) => ({
        source,
        key: issue.path || "entry",
        message: `${listed.entry} must default export defineModule({...}): ${issue.message}`,
      })),
    };
  }
  const declaration = parsed.declaration;
  const problems: Problem[] = [];
  if (declaration.name !== listed.name) {
    problems.push({
      source,
      key: "name",
      message: `manifest lists "${listed.name}" but ${listed.entry} declares "${declaration.name}"`,
    });
  }
  const fields = differingFields(
    summarizeModule(declaration, listed.entry),
    listed,
  );
  if (fields.length > 0) {
    problems.push({
      source,
      message: `manifest is out of date (differs in ${fields.join(", ")}); rebuild ${discovery.packageName}`,
    });
  }
  const directory = path.dirname(entryFile);
  const serverHook = declaration.serverHook
    ? path.resolve(directory, declaration.serverHook)
    : undefined;
  if (
    serverHook &&
    !(existsSync(serverHook) && statSync(serverHook).isFile())
  ) {
    problems.push({
      source,
      key: "serverHook",
      message: `${declaration.serverHook} does not exist next to ${listed.entry}`,
    });
  }
  return {
    module: {
      name: declaration.name,
      entry: listed.entry,
      entryFile,
      directory,
      declaration,
      serverHook,
    },
    problems,
  };
}

/** Imports every listed module's `entry` for its real declaration, in manifest order. */
export async function loadModules(
  discovery: ManifestDiscovery,
  root: string,
): Promise<{ modules: LoadedModule[]; problems: Problem[] }> {
  const modules: LoadedModule[] = [];
  const problems: Problem[] = [];
  for (const listed of discovery.manifest.modules) {
    const result = await loadModule(listed, discovery, root);
    problems.push(...result.problems);
    if (result.module) {
      modules.push(result.module);
    }
  }
  return { modules, problems };
}
