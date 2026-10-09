import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

export const canonicalTsconfig = `{
  "extends": "@chromatis/base/infra/tsconfig",
  "compilerOptions": {
    "types": ["node", "bun", "vite/client"],
    "paths": { "chromatis-content": ["./.chromatis/build/content.ts"] },
    "rootDirs": [".", "./.react-router/types"]
  },
  "include": ["app", "src", "server", ".react-router/types/**/*"]
}
`;
export const canonicalEslint = `import base from "@chromatis/base/infra/eslint";

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
export const generatedRouterConfig = "export default { ssr: true };\n";
export const generatedCloudflareEntry = `import { ServerRouter, type EntryContext } from "react-router";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(request: Request, status: number, headers: Headers, context: EntryContext) {
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url} />);
  headers.set("Content-Type", "text/html");
  return new Response(body, { status, headers });
}
`;

export function expectedTooling(): Readonly<Record<string, string>> {
  return {
    "tsconfig.json": canonicalTsconfig,
    "eslint.config.js": canonicalEslint,
  };
}

export function checkTooling(root = process.cwd()): string[] {
  const problems: string[] = [];
  for (const [file, expected] of Object.entries(expectedTooling())) {
    if (
      !existsSync(path.join(root, file)) ||
      readFileSync(path.join(root, file), "utf8") !== expected
    ) {
      problems.push(
        `${file} differs from the framework stub; run bun run init`,
      );
    }
  }
  return problems;
}

export function repairTooling(root = process.cwd()): void {
  for (const [file, expected] of Object.entries(expectedTooling())) {
    writeFileSync(path.join(root, file), expected);
  }
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
