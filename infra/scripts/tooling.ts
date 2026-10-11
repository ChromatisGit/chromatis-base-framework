import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
    "rootDirs": ["..", "../.react-router/types"]
  },
  "include": [
    "../app",
    "../src",
    "../server",
    "../.react-router/types/**/*",
    "types.d.ts"
  ]
}
`;
export const generatedEslint = `import base from "@chromatis/base/infra/eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      ".react-router/**",
      ".chromatis/**",
      "react-router.config.ts",
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

/** Where Chromatis generates React Router's app directory (git-ignored). */
export const APP_DIRECTORY = ".chromatis/app";

export const generatedRouterConfig = `export default { ssr: true, appDirectory: ${JSON.stringify(APP_DIRECTORY)} };\n`;
export const generatedCloudflareEntry = `import { ServerRouter, type EntryContext } from "react-router";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(request: Request, status: number, headers: Headers, context: EntryContext) {
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url} />);
  headers.set("Content-Type", "text/html");
  return new Response(body, { status, headers });
}
`;

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

export function checkTooling(root = process.cwd()): string[] {
  const problems: string[] = [];
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
  for (const [file, expected] of Object.entries(expectedTooling())) {
    writeFileSync(path.join(root, file), expected);
  }
  writeGeneratedTooling(root);
  const ignorePath = path.join(root, ".gitignore");
  const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  const additions = [
    "/react-router.config.ts",
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

export function writeRouterConfig(root = process.cwd()): void {
  writeFileSync(
    path.join(root, "react-router.config.ts"),
    generatedRouterConfig,
  );
}
