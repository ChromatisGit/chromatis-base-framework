import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { inlinePackageReexport } from "./inline-route.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(): { require: NodeJS.Require; routes: string } {
  const root = mkdtempSync(path.join(tmpdir(), "chromatis-inline-"));
  directories.push(root);
  const routes = path.join(root, "node_modules/pkg/app/routes");
  mkdirSync(routes, { recursive: true });
  writeFileSync(
    path.join(root, "node_modules/pkg/package.json"),
    JSON.stringify({ name: "pkg", exports: { "./*": "./app/*.tsx" } }),
  );
  writeFileSync(path.join(root, "package.json"), "{}");
  writeFileSync(
    path.join(routes, "chapter.tsx"),
    [
      'import { site } from "../site.server";',
      'import type { Props } from "./props";',
      'import "@scope/pkg";',
      'export { shared } from "../shared";',
      "export async function loader() { return site; }",
      "",
    ].join("\n"),
  );
  return {
    require: createRequire(path.join(root, "package.json")),
    routes,
  };
}

describe("inlinePackageReexport", () => {
  test("inlines the package module and makes relative imports absolute", () => {
    const { require, routes } = project();
    const inlined = inlinePackageReexport(
      'export { default, loader } from "pkg/routes/chapter";\n',
      require,
    );
    expect(inlined?.source).toBe(path.join(routes, "chapter.tsx"));
    expect(inlined?.code).toContain(
      `from ${JSON.stringify(path.resolve(routes, "../site.server"))}`,
    );
    expect(inlined?.code).toContain(
      `from ${JSON.stringify(path.resolve(routes, "props"))}`,
    );
    expect(inlined?.code).toContain(
      `from ${JSON.stringify(path.resolve(routes, "../shared"))}`,
    );
    expect(inlined?.code).toContain('import "@scope/pkg"');
    expect(inlined?.code).toContain("export async function loader()");
  });

  test("leaves code that is not a package re-export alone", () => {
    const { require } = project();
    expect(inlinePackageReexport("export const a = 1;", require)).toBeNull();
    expect(
      inlinePackageReexport('export { a } from "./local";', require),
    ).toBeNull();
    expect(
      inlinePackageReexport(
        'export { a } from "pkg/routes/chapter";\nexport const b = 1;',
        require,
      ),
    ).toBeNull();
  });
});
