import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const base = path.resolve(import.meta.dir, "../..");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : sources(file);
    }
    return /\.(ts|tsx|js)$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
      ? [file]
      : [];
  });
}

const files = [
  ...sources(path.join(base, "src")),
  ...sources(path.join(base, "infra")),
].map((file) => ({
  name: path.relative(base, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

describe("Chromatis stays generic and current", () => {
  test("contains no product names", () => {
    const product = new RegExp(["studyl", "uma"].join(""), "i");
    expect(
      files.filter(({ text }) => product.test(text)).map(({ name }) => name),
    ).toEqual([]);
  });

  test("keeps no pre-manifest compatibility paths", () => {
    const obsolete = new RegExp(
      [
        ["TRANSITIONAL", "\\("].join(""),
        ["chromatis", "\\.toml"].join(""),
        ["chromatis", "-content"].join(""),
        ["content", "Mounts"].join(""),
      ].join("|"),
    );
    expect(
      files.filter(({ text }) => obsolete.test(text)).map(({ name }) => name),
    ).toEqual([]);
  });
});

describe("@chromatis/base/module", () => {
  test("is declaration-only: it imports zod and its own pure declaration files, nothing else", () => {
    const text =
      files.find((file) => file.name === "src/module.ts")?.text ?? "";
    const imports = [
      ...text.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gms),
    ].map((match) => match[1]);
    expect(imports.sort()).toEqual([
      "./errors.js",
      "./route-declaration.js",
      "./schema-introspection.js",
      "zod",
    ]);
  });

  test("route declarations are pure data: only zod", () => {
    const text =
      files.find((file) => file.name === "src/route-declaration.ts")?.text ??
      "";
    const imports = [
      ...text.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gms),
    ].map((match) => match[1]);
    expect(imports).toEqual(["zod"]);
  });
});
