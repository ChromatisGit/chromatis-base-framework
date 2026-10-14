import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inlinePackageReexport } from "../../src/inline-route.js";
import { APP_DIRECTORY } from "./tooling.js";

/**
 * Inline package route re-exports on disk while React Router builds, so it can
 * split their server exports. `chromatis dev` inlines in memory instead, in
 * `src/vite.js`.
 */
export function materializeExternalRoutes(root: string): () => void {
  const routes = path.join(root, APP_DIRECTORY, "routes");
  if (!existsSync(routes)) {
    return () => {};
  }
  const require = createRequire(path.join(root, "package.json"));
  const originals = new Map<string, string>();
  function materialize(file: string): void {
    const original = readFileSync(file, "utf8");
    const inlined = inlinePackageReexport(original, require);
    if (!inlined) {
      return;
    }
    originals.set(file, original);
    writeFileSync(file, inlined.code);
  }
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) {
        continue;
      }
      materialize(file);
    }
  }
  try {
    visit(routes);
    const appRoot = path.join(root, APP_DIRECTORY, "root.tsx");
    if (existsSync(appRoot)) {
      materialize(appRoot);
    }
  } catch (error) {
    for (const [file, original] of originals) {
      writeFileSync(file, original);
    }
    throw error;
  }
  return () => {
    for (const [file, original] of originals) {
      writeFileSync(file, original);
    }
  };
}
