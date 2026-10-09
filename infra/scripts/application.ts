import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseApplicationDeclaration,
  type ApplicationDeclaration,
} from "../../src/declaration.js";
import type { ServerHook } from "../../src/server.js";
import { writeRouterConfig } from "./tooling.js";

export const frameworkRoot = path.resolve(import.meta.dir, "../..");

export function loadApplication(root = process.cwd()): ApplicationDeclaration {
  const file = path.join(root, "chromatis.toml");
  if (!existsSync(file)) {
    throw new Error(
      "chromatis.toml is missing; add the application declaration",
    );
  }
  return parseApplicationDeclaration(readFileSync(file, "utf8"));
}

export async function loadHook(
  root: string,
  declaration: ApplicationDeclaration,
): Promise<ServerHook | undefined> {
  if (!declaration.serverHook) {
    return undefined;
  }
  const file = path.resolve(root, declaration.serverHook);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) {
    throw new Error("serverHook must name an existing application file");
  }
  const module = (await import(pathToFileURL(file).href)) as {
    default?: ServerHook;
  };
  if (!module.default || !Array.isArray(module.default.definitions)) {
    throw new Error("serverHook must default export a ServerHook");
  }
  const actual = module.default.definitions
    .map((definition) => definition.kind)
    .sort();
  if (
    JSON.stringify(actual) !== JSON.stringify([...declaration.runtime].sort())
  ) {
    throw new Error(
      "serverHook definitions must match chromatis.toml runtime kinds",
    );
  }
  return module.default;
}

type Migration = {
  tag: string;
  new_classes?: string[];
  deleted_classes?: string[];
};
type Ledger = { migrations: Migration[] };

export function migrationPlan(
  root: string,
  runtime: readonly string[],
  persist: boolean,
): Migration[] {
  const file = path.join(root, ".chromatis-runtime-migrations.json");
  const ledger: Ledger = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Ledger)
    : { migrations: [] };
  if (!Array.isArray(ledger.migrations)) {
    throw new Error(
      "Invalid runtime migration ledger; restore .chromatis-runtime-migrations.json from Git and run bun run build",
    );
  }
  const current = new Set<string>();
  for (const [index, migration] of ledger.migrations.entries()) {
    if (migration.tag !== `v${index + 1}`) {
      throw new Error(
        "Runtime migration tags are inconsistent; restore .chromatis-runtime-migrations.json from Git and run bun run build",
      );
    }
    for (const name of migration.new_classes ?? []) {
      if (current.has(name)) {
        throw new Error(
          `Runtime migration ${migration.tag} adds ${name} twice; restore the ledger from Git and run bun run build`,
        );
      }
      current.add(name);
    }
    for (const name of migration.deleted_classes ?? []) {
      if (!current.has(name)) {
        throw new Error(
          `Runtime migration ${migration.tag} deletes unknown ${name}; restore the ledger from Git and run bun run build`,
        );
      }
      current.delete(name);
    }
  }
  const wanted = new Set(runtime.map(runtimeClass));
  const added = [...wanted].filter((name) => !current.has(name)).sort();
  const deleted = [...current].filter((name) => !wanted.has(name)).sort();
  if (added.length || deleted.length) {
    ledger.migrations.push({
      tag: `v${ledger.migrations.length + 1}`,
      ...(added.length ? { new_classes: added } : {}),
      ...(deleted.length ? { deleted_classes: deleted } : {}),
    });
    if (persist) {
      writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    }
  }
  return ledger.migrations;
}

export const runtimeClass = (kind: string): string =>
  `Runtime_${kind.replaceAll("-", "_")}`;
export const runtimeBinding = (kind: string): string =>
  `RUNTIME_${kind.replaceAll("-", "_").toUpperCase()}`;

function contentFiles(directory: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory).sort()) {
    const relative = path.posix.join(prefix, entry);
    const file = path.join(directory, entry);
    if (statSync(file).isDirectory()) {
      Object.assign(files, contentFiles(file, relative));
    } else if (statSync(file).isFile()) {
      files[relative] = readFileSync(file).toString("base64");
    }
  }
  return files;
}

export function generateArtifacts(
  root: string,
  declaration: ApplicationDeclaration,
  persistMigrations = true,
) {
  const output = path.join(root, ".chromatis", "build");
  mkdirSync(output, { recursive: true });
  const content = Object.fromEntries(
    Object.entries(declaration.contentMounts).map(([name, source]) => {
      const directory = path.resolve(root, source);
      if (!existsSync(directory) || !statSync(directory).isDirectory()) {
        throw new Error(`Content mount ${name} is missing: ${directory}`);
      }
      return [
        name,
        { basename: path.basename(directory), files: contentFiles(directory) },
      ];
    }),
  );
  writeFileSync(
    path.join(output, "content.ts"),
    `export const content: Record<string, { basename: string; files: Record<string, string> }> = ${JSON.stringify(content)};\n`,
  );
  writeRouterConfig(root);
  const migrations = migrationPlan(
    root,
    declaration.runtime,
    persistMigrations,
  );
  const bindings = Object.fromEntries(
    declaration.runtime.map((kind) => [kind, runtimeBinding(kind)]),
  );
  const hookImport = declaration.serverHook
    ? JSON.stringify(path.resolve(root, declaration.serverHook))
    : undefined;
  const serverImport = JSON.stringify(
    path.join(frameworkRoot, "src/server.ts"),
  );
  const cloudflareImport = JSON.stringify(
    path.join(frameworkRoot, "src/stateful/cloudflare.ts"),
  );
  const worker = [
    'import * as build from "virtual:react-router/server-build";',
    `import { createFrameworkWorker } from ${serverImport};`,
    ...(hookImport ? [`import hook from ${hookImport};`] : []),
    ...(declaration.runtime.length
      ? [`import { createRuntimeDurableObject } from ${cloudflareImport};`]
      : []),
    ...declaration.runtime.map(
      (kind) =>
        `export const ${runtimeClass(kind)} = createRuntimeDurableObject(hook.definitions.filter((definition) => definition.kind === ${JSON.stringify(kind)}));`,
    ),
    `export default createFrameworkWorker(build, ${hookImport ? "hook" : "undefined"}, ${JSON.stringify(bindings)});`,
  ].join("\n");
  writeFileSync(path.join(output, "worker.ts"), `${worker}\n`);
  const bun = [
    `import { startFrameworkBun } from ${serverImport};`,
    ...(hookImport ? [`import hook from ${hookImport};`] : []),
    `await startFrameworkBun(${hookImport ? "hook" : ""});`,
  ].join("\n");
  writeFileSync(path.join(output, "bun.ts"), `${bun}\n`);
  const config = {
    name: declaration.name,
    main: path.join(output, "worker.ts"),
    compatibility_date: "2025-09-01",
    compatibility_flags: ["nodejs_compat"],
    ...(declaration.runtime.length
      ? {
          durable_objects: {
            bindings: declaration.runtime.map((kind) => ({
              name: runtimeBinding(kind),
              class_name: runtimeClass(kind),
            })),
          },
          migrations,
        }
      : {}),
    vars: { PUBLIC_URL: declaration.publicUrl, ...declaration.variables },
  };
  const wranglerPath = path.join(output, "wrangler.json");
  writeFileSync(wranglerPath, `${JSON.stringify(config, null, 2)}\n`);
  return {
    output,
    wranglerPath,
    deployWranglerPath: path.join(root, "build/server/wrangler.json"),
    config,
    migrations,
  };
}
