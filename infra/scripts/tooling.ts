import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function forbiddenFiles(root = process.cwd()): string[] {
  const found = readdirSync(root).filter((name) =>
    /^wrangler\.|^Dockerfile$|^docker-compose\.|^vite\.config\./.test(name),
  );
  const tracked = spawnSync(
    "git",
    ["ls-files", "--", "react-router.config.*"],
    { cwd: root, encoding: "utf8" },
  );
  if (tracked.status === 0) {
    found.push(
      ...tracked.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((name) => `${name} (tracked)`),
    );
  }
  return found;
}

/** Root files an instance keeps; they only point at the generated ones. */
export const canonicalTsconfig = `{
  "extends": "./.chromatis/tsconfig.json"
}
`;
export const canonicalEslint = `export { default } from "./.chromatis/eslint.config.js";
`;

/** Generated under the git-ignored `.chromatis/`; rewritten by init, dev and build. */
export const generatedTsconfig = `{
  "extends": "@chromatis/base/infra/tsconfig",
  "compilerOptions": {
    "types": ["node", "bun", "vite/client"],
  },
  "include": ["../app", "../src", "../server", "types.d.ts"]
}
`;
export const generatedEslint = `import base from "@chromatis/base/infra/eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      ".chromatis/**",
    ],
  },
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parserOptions: { projectService: true } },
  },
];
`;
/** Ambient types of the virtual modules; single source: src/virtual-modules.d.ts. */
export const generatedTypes = readFileSync(
  path.resolve(import.meta.dir, "../../src/virtual-modules.d.ts"),
  "utf8",
);

/** Where Chromatis generates the browser app's `index.html` and entry (git-ignored). */
export const APP_DIRECTORY = ".chromatis/app";

/** Root files an instance keeps; they only point at the generated ones. */
export function expectedTooling(): Readonly<Record<string, string>> {
  return {
    "tsconfig.json": canonicalTsconfig,
    "eslint.config.js": canonicalEslint,
  };
}

/** Files Chromatis generates for the instance under `.chromatis/`. */
export function generatedTooling(): Readonly<Record<string, string>> {
  return {
    ".chromatis/tsconfig.json": generatedTsconfig,
    ".chromatis/eslint.config.js": generatedEslint,
    ".chromatis/types.d.ts": generatedTypes,
  };
}

/**
 * What earlier versions generated for React Router's framework mode. Left in
 * place, its stale route types break the instance's lint and typecheck.
 */
function routerLeftovers(root: string): string[] {
  const config = path.join(root, "react-router.config.ts");
  return [
    ...(existsSync(path.join(root, ".react-router")) ? [".react-router"] : []),
    ...(existsSync(config) &&
    readFileSync(config, "utf8").includes('appDirectory: ".chromatis/app"')
      ? ["react-router.config.ts"]
      : []),
  ];
}

export function checkTooling(root = process.cwd()): string[] {
  const problems: string[] = routerLeftovers(root).map(
    (file) =>
      `${file} is left over from React Router's framework mode; run chromatis init`,
  );
  for (const [file, expected] of [
    ...Object.entries(expectedTooling()),
    ...Object.entries(generatedTooling()),
  ]) {
    if (
      !existsSync(path.join(root, file)) ||
      readFileSync(path.join(root, file), "utf8") !== expected
    ) {
      problems.push(
        `${file} differs from the framework ${file.startsWith(".chromatis/") ? "output" : "stub"}; run chromatis init`,
      );
    }
  }
  return problems;
}

/** Writes the generated files only (no root stubs, no ignore rules). */
export function writeGeneratedTooling(root: string): void {
  for (const [file, content] of Object.entries(generatedTooling())) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
}

export function repairTooling(root = process.cwd()): void {
  for (const file of routerLeftovers(root)) {
    rmSync(path.join(root, file), { recursive: true, force: true });
  }
  for (const [file, expected] of Object.entries(expectedTooling())) {
    writeFileSync(path.join(root, file), expected);
  }
  writeGeneratedTooling(root);
  const ignorePath = path.join(root, ".gitignore");
  const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  const additions = [
    "/.chromatis/*",
    "!/.chromatis/runtime-migrations.json",
    "/.wrangler/",
  ].filter((line) => !ignore.split("\n").includes(line));
  if (additions.length) {
    writeFileSync(
      ignorePath,
      `${ignore.replace(/\n?$/, "\n")}${additions.join("\n")}\n`,
    );
  }
}
