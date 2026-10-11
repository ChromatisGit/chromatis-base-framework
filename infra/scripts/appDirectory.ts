import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { APP_DIRECTORY } from "./tooling.js";
import {
  EXTRA_ROUTES_FILE,
  INSTANCE_ROOT_FILE,
  withoutExtension,
} from "./routes.js";
import type {
  ResolvedApplication,
  ResolvedRoute,
} from "./resolvedApplication.js";

/** The names a module exports, as `export { ... } from` needs them. */
export function exportNames(file: string): string[] {
  const scanned = new Bun.Transpiler({ loader: "tsx" }).scan(
    readFileSync(file, "utf8"),
  ).exports;
  return [
    ...scanned.filter((name) => name === "default"),
    ...scanned.filter((name) => name !== "default").sort(),
  ];
}

const reexport = (file: string, from: string): string =>
  `export { ${exportNames(file).join(", ")} } from ${JSON.stringify(from)};\n`;

function routeEntries(
  routes: readonly ResolvedRoute[],
  directory: string,
  used: Set<string>,
): unknown[] {
  return routes.map((route) => {
    let name = `${route.id.replace(/[^\w.-]+/g, "_")}`;
    while (used.has(name)) {
      name += "_";
    }
    used.add(name);
    const file = `routes/${name}.tsx`;
    writeFileSync(path.join(directory, file), reexport(route.file, route.from));
    return {
      id: route.id,
      ...(route.kind === "index" ? { index: true } : {}),
      ...(route.path === undefined ? {} : { path: route.path }),
      file,
      ...(route.children.length
        ? { children: routeEntries(route.children, directory, used) }
        : {}),
    };
  });
}

const EXTRA_IMPORT = `import extra from "../../app/routes";

type Entry = { id?: string; file: string; children?: Entry[] };
// The instance's own routes: files are relative to its app/ directory.
const rebase = (entries: readonly Entry[]): Entry[] =>
  entries.map((entry) => ({
    ...entry,
    id: entry.id ?? entry.file.replace(/\\.[cm]?[jt]sx?$/, ""),
    file: \`../../app/\${entry.file}\`,
    ...(entry.children ? { children: rebase(entry.children) } : {}),
  }));
`;

/**
 * Writes `.chromatis/app/`: `root.tsx`, `routes.ts` and one re-export file per
 * product route. The product's root is replaced by the instance's
 * `app/root.tsx`, and the instance's `app/routes.ts` is appended to the
 * product's routes.
 */
export function writeAppDirectory(
  root: string,
  app: ResolvedApplication,
): void {
  const directory = path.join(root, APP_DIRECTORY);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(path.join(directory, "routes"), { recursive: true });

  const own = path.join(root, INSTANCE_ROOT_FILE);
  const shellRoot = existsSync(own)
    ? { from: withoutExtension(own), file: own }
    : app.shell.root;
  if (shellRoot) {
    writeFileSync(
      path.join(directory, "root.tsx"),
      reexport(shellRoot.file, shellRoot.from),
    );
  }
  const extra = existsSync(path.join(root, EXTRA_ROUTES_FILE));
  const product = routeEntries(app.shell.routes, directory, new Set());
  writeFileSync(
    path.join(directory, "routes.ts"),
    [
      extra ? EXTRA_IMPORT : "",
      `const product = ${JSON.stringify(product, null, 2)};`,
      extra
        ? "export default [...product, ...rebase(await extra)];"
        : "export default product;",
      "",
    ].join("\n"),
  );
}
