import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Inline package route re-exports while React Router splits their server exports. */
export function materializeExternalRoutes(root: string): () => void {
  const routes = path.join(root, "app/routes");
  if (!existsSync(routes)) {
    return () => {};
  }
  const require = createRequire(path.join(root, "package.json"));
  const originals = new Map<string, string>();
  function materialize(file: string): void {
    const original = readFileSync(file, "utf8");
    const match = original
      .trim()
      .match(/^export\s*\{[^}]+\}\s*from\s*["']([^"']+)["'];?$/s);
    if (!match?.[1] || match[1].startsWith(".")) {
      return;
    }
    const source = require.resolve(match[1]);
    const code = readFileSync(source, "utf8").replace(
      /(\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g,
      (_all, prefix: string, relative: string) =>
        `${prefix}${JSON.stringify(path.resolve(path.dirname(source), relative))}`,
    );
    originals.set(file, original);
    writeFileSync(file, code);
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
    const appRoot = path.join(root, "app/root.tsx");
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
