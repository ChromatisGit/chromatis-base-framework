import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Inline a generated one-line package re-export
 * (`export { default, loader } from "<package>/route"`) with the source of the
 * module it points at, relative imports made absolute.
 *
 * React Router only splits server exports out of the client bundle in the route
 * module itself. A wrapper that merely re-exports `loader` has it stripped, but
 * the client still imports the package module, which holds the `loader` and its
 * `.server` imports.
 *
 * @param {string} code Source of the generated wrapper.
 * @param {{ resolve(specifier: string): string }} require Resolver for package
 *   specifiers, anchored at the instance.
 * @returns {{ code: string, source: string } | null} The inlined code and the
 *   package file it came from, or null when `code` is not such a re-export.
 */
export function inlinePackageReexport(code, require) {
  const match = code
    .trim()
    .match(/^export\s*\{[^}]+\}\s*from\s*["']([^"']+)["'];?$/s);
  if (!match?.[1] || match[1].startsWith(".")) {
    return null;
  }
  const source = require.resolve(match[1]);
  return {
    code: readFileSync(source, "utf8").replace(
      /(\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g,
      (_all, prefix, relative) =>
        `${prefix}${JSON.stringify(path.resolve(path.dirname(source), relative))}`,
    ),
    source,
  };
}
