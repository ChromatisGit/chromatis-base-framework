import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { colorModeInitScript } from "../../src/ui/theme/colorMode.js";
import type { AppDocument } from "../../src/module.js";
import { APP_DIRECTORY } from "./tooling.js";
import { flattenRoutes } from "./routes.js";
import type {
  ResolvedApplication,
  ResolvedRoute,
} from "./resolvedApplication.js";

/** Where the browser entry lives; `index.html` loads it. */
export const CLIENT_ENTRY = "main.tsx";
/** The app's definition, next to the entry. */
export const APP_MODULE = "app.ts";
/** The generated server tables the worker and the Bun server import. */
export const SERVER_ROUTES_FILE = ".chromatis/build/routes.ts";

const frameworkSource = (file: string) =>
  JSON.stringify(path.resolve(import.meta.dir, "../../src", file));

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const ICON_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** The page every browser route starts from. */
export function documentHtml(document: AppDocument | undefined): string {
  const attributes = Object.entries({
    lang: document?.lang ?? "en",
    ...document?.attributes,
  })
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
  const icon = document?.icon;
  const iconType = icon ? ICON_TYPES[path.extname(icon)] : undefined;
  const head = [
    '<meta charset="utf-8" />',
    `<meta name="viewport" content="${escapeHtml(document?.viewport ?? "width=device-width, initial-scale=1")}" />`,
    `<title>${escapeHtml(document?.title ?? "")}</title>`,
    ...(document?.description
      ? [
          `<meta name="description" content="${escapeHtml(document.description)}" />`,
        ]
      : []),
    ...(icon
      ? [
          `<link rel="icon"${iconType ? ` type="${iconType}"` : ""} href="${escapeHtml(icon)}" />`,
        ]
      : []),
    ...(document?.colorModeKey
      ? [`<script>${colorModeInitScript(document.colorModeKey)}</script>`]
      : []),
  ];
  return [
    "<!doctype html>",
    `<html${attributes}>`,
    "  <head>",
    ...head.map((line) => `    ${line}`),
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    `    <script type="module" src="/${APP_DIRECTORY}/${CLIENT_ENTRY}"></script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function clientRoutes(
  routes: readonly ResolvedRoute[],
  indent: string,
): string[] {
  return routes
    .filter((route) => route.kind !== "api")
    .flatMap((route) => {
      const children = clientRoutes(route.children, `${indent}    `);
      return [
        `${indent}{`,
        `${indent}  id: ${JSON.stringify(route.id)},`,
        ...(route.kind === "index"
          ? [`${indent}  index: true,`]
          : route.path === undefined
            ? []
            : [`${indent}  path: ${JSON.stringify(route.path)},`]),
        ...(route.server ? [`${indent}  server: true,`] : []),
        `${indent}  page: () => import(${JSON.stringify(route.from)}),`,
        ...(children.length
          ? [`${indent}  children: [`, ...children, `${indent}  ],`]
          : []),
        `${indent}},`,
      ];
    });
}

/** The app's definition: the root, then the route tree with lazy pages. */
export function appModule(app: ResolvedApplication): string {
  const { root, rootServer, routes, document } = app.shell;
  return [
    `import type { AppDefinition } from ${frameworkSource("client.tsx")};`,
    ...(root ? [`import * as root from ${JSON.stringify(root.from)};`] : []),
    "",
    "export const app: AppDefinition = {",
    root ? "  root," : "  root: {},",
    ...(rootServer ? ["  rootServer: true,"] : []),
    `  title: ${JSON.stringify(document?.title ?? "")},`,
    "  routes: [",
    ...clientRoutes(routes, "    "),
    "  ],",
    "};",
    "",
  ].join("\n");
}

/** The browser entry; prerendering imports `app.ts` without starting it. */
export const clientEntry = `import { startApp } from ${frameworkSource("client.tsx")};
import { app } from "./${APP_MODULE.replace(/\.ts$/, "")}";

void startApp(app);
`;

/**
 * The server's tables: API endpoints in declaration order, and every route
 * with its full path and server file for the data endpoint.
 */
export function serverRoutes(app: ResolvedApplication): string {
  const flat = flattenRoutes(app.shell.routes);
  const imports: string[] = [];
  const name = (specifier: string): string => {
    imports.push(specifier);
    return `module${imports.length - 1}`;
  };
  const api = flat
    .filter((route) => route.kind === "api")
    .map(
      (route) =>
        `  { path: ${JSON.stringify(route.url)}, module: ${name(route.file)} },`,
    );
  const rootServer = app.shell.rootServer;
  const data = [
    ...(rootServer
      ? [`  { id: "root", path: undefined, module: ${name(rootServer.from)} },`]
      : []),
    ...flat
      .filter((route) => route.kind !== "api")
      .map(
        (route) =>
          `  { id: ${JSON.stringify(route.id)}, path: ${route.kind === "layout" ? "undefined" : JSON.stringify(route.url)}, module: ${route.server ? name(route.server) : "undefined"} },`,
      ),
  ];
  return [
    `import { compileApi } from ${frameworkSource("api.ts")};`,
    `import { compileData } from ${frameworkSource("data.ts")};`,
    ...imports.map(
      (specifier, index) =>
        `import * as module${index} from ${JSON.stringify(specifier)};`,
    ),
    "",
    "export const api = compileApi([",
    ...api,
    "]);",
    "",
    "export const data = compileData([",
    ...data,
    "]);",
    "",
  ].join("\n");
}

/**
 * Writes `.chromatis/app/` (`index.html` and the browser entry) and the
 * server's route tables.
 */
export function writeAppDirectory(
  root: string,
  app: ResolvedApplication,
): void {
  const directory = path.join(root, APP_DIRECTORY);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "index.html"),
    documentHtml(app.shell.document),
  );
  writeFileSync(path.join(directory, APP_MODULE), appModule(app));
  writeFileSync(path.join(directory, CLIENT_ENTRY), clientEntry);
  mkdirSync(path.dirname(path.join(root, SERVER_ROUTES_FILE)), {
    recursive: true,
  });
  writeFileSync(path.join(root, SERVER_ROUTES_FILE), serverRoutes(app));
}
