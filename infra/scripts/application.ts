import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ServerHook } from "../../src/server.js";
import type { ResolvedApplication } from "./resolvedApplication.js";
import { writeAppDirectory } from "./appDirectory.js";
import { registerVirtualModules, writeConfigModule } from "./virtualModules.js";
import { writeGeneratedTooling, writeRouterConfig } from "./tooling.js";

export const frameworkRoot = path.resolve(import.meta.dir, "../..");

export async function loadHook(
  app: ResolvedApplication,
): Promise<ServerHook | undefined> {
  if (!app.serverHook) {
    return undefined;
  }
  if (!existsSync(app.serverHook)) {
    throw new Error("serverHook must name an existing application file");
  }
  registerVirtualModules(app.instanceRoot);
  const module = (await import(pathToFileURL(app.serverHook).href)) as {
    default?: ServerHook;
  };
  if (!module.default || !Array.isArray(module.default.definitions)) {
    throw new Error("serverHook must default export a ServerHook");
  }
  const actual = module.default.definitions
    .map((definition) => definition.kind)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify([...app.runtime].sort())) {
    throw new Error(
      "serverHook definitions must match the declared runtime kinds",
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

const LEDGER_FILE = ".chromatis/runtime-migrations.json";

export function migrationPlan(
  root: string,
  runtime: readonly string[],
  persist: boolean,
): Migration[] {
  const file = path.join(root, LEDGER_FILE);
  const ledger: Ledger = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Ledger)
    : { migrations: [] };
  if (!Array.isArray(ledger.migrations)) {
    throw new Error(
      `Invalid runtime migration ledger; restore ${LEDGER_FILE} from Git and run chromatis build`,
    );
  }
  const current = new Set<string>();
  for (const [index, migration] of ledger.migrations.entries()) {
    if (migration.tag !== `v${index + 1}`) {
      throw new Error(
        `Runtime migration tags are inconsistent; restore ${LEDGER_FILE} from Git and run chromatis build`,
      );
    }
    for (const name of migration.new_classes ?? []) {
      if (current.has(name)) {
        throw new Error(
          `Runtime migration ${migration.tag} adds ${name} twice; restore the ledger from Git and run chromatis build`,
        );
      }
      current.add(name);
    }
    for (const name of migration.deleted_classes ?? []) {
      if (!current.has(name)) {
        throw new Error(
          `Runtime migration ${migration.tag} deletes unknown ${name}; restore the ledger from Git and run chromatis build`,
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
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    }
  }
  return ledger.migrations;
}

export const runtimeClass = (kind: string): string =>
  `Runtime_${kind.replaceAll("-", "_")}`;
export const runtimeBinding = (kind: string): string =>
  `RUNTIME_${kind.replaceAll("-", "_").toUpperCase()}`;

/**
 * Facts the Vite config needs. `src/vite.js` runs inside React Router's CLI and
 * reads this file instead of re-deriving them from the instance.
 */
export function writeBuildContext(
  output: string,
  app: ResolvedApplication,
): void {
  writeFileSync(
    path.join(output, "application.json"),
    `${JSON.stringify(
      {
        serverHook: app.serverHook ?? null,
        bundledPackages: app.bundledPackages,
        allowedRoots: app.allowedRoots,
      },
      null,
      2,
    )}\n`,
  );
}

export function generateArtifacts(
  root: string,
  declaration: ResolvedApplication,
  persistMigrations = true,
) {
  const output = path.join(root, ".chromatis", "build");
  mkdirSync(output, { recursive: true });
  writeRouterConfig(root);
  writeAppDirectory(root, declaration);
  writeGeneratedTooling(root);
  writeConfigModule(root, declaration);
  writeBuildContext(output, declaration);
  const migrations = migrationPlan(
    root,
    declaration.runtime,
    persistMigrations,
  );
  const bindings = Object.fromEntries(
    declaration.runtime.map((kind) => [kind, runtimeBinding(kind)]),
  );
  const hookImport = declaration.serverHook
    ? JSON.stringify(declaration.serverHook)
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
    vars: { PUBLIC_URL: declaration.publicUrl },
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
