import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { SHELL_ATTRIBUTE, type Prerendered } from "../../src/data-protocol.js";
import type { PrerenderedPage } from "../../src/prerender.js";
import { flattenRoutes } from "./routes.js";
import type { ResolvedApplication } from "./resolvedApplication.js";

const CLIENT = "build/client";
/** Vite's client manifest; read here, then removed so it is not deployed. */
const MANIFEST = `${CLIENT}/.vite/manifest.json`;

/** Where a page's HTML lands in the client build: `/` is `index.html`. */
export const pageFile = (url: string): string =>
  url === "/" ? "index.html" : `${url.slice(1)}.html`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** JSON that cannot end the `<script>` it sits in. */
const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");

type ManifestEntry = Readonly<{
  file: string;
  css?: readonly string[];
  imports?: readonly string[];
}>;

/** The JS and CSS files a set of manifest entries loads, imports included. */
export function chunkFiles(
  manifest: Readonly<Record<string, ManifestEntry>>,
  keys: readonly string[],
): { js: string[]; css: string[] } {
  const js = new Set<string>();
  const css = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string) => {
    const entry = manifest[key];
    if (!entry || seen.has(key)) {
      return;
    }
    seen.add(key);
    js.add(`/${entry.file}`);
    for (const file of entry.css ?? []) {
      css.add(`/${file}`);
    }
    for (const imported of entry.imports ?? []) {
      visit(imported);
    }
  };
  keys.forEach(visit);
  return { js: [...js], css: [...css] };
}

/**
 * The client build's `index.html` with a prerendered page in it: its markup in
 * `#root`, its title and description, its chunks and styles, and the state the
 * browser hydrates from. As `index.html` it is also every other page's static
 * fallback, so it then hides its markup on any other path until the app runs.
 */
export function composePage(
  template: string,
  page: Pick<PrerenderedPage, "html" | "title" | "description"> & {
    state: Prerendered;
  },
  chunks: { js: readonly string[]; css: readonly string[] },
): string {
  let html = template;
  if (page.title !== undefined) {
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHtml(page.title)}</title>`,
    );
  }
  if (page.description !== undefined) {
    const tag = `<meta name="description" content="${escapeHtml(page.description)}" />`;
    html = /<meta name="description"[^>]*>/.test(html)
      ? html.replace(/<meta name="description"[^>]*>/, tag)
      : html.replace("</head>", `  ${tag}\n  </head>`);
  }
  const head = [
    ...chunks.css
      .filter((href) => !html.includes(`href="${href}"`))
      .map((href) => `<link rel="stylesheet" crossorigin href="${href}">`),
    ...chunks.js
      .filter((href) => !html.includes(`"${href}"`))
      .map((href) => `<link rel="modulepreload" crossorigin href="${href}">`),
    ...(page.state.path === "/"
      ? [
          `<style>html[${SHELL_ATTRIBUTE}] #root{display:none}</style>`,
          `<script>if(location.pathname!=="/")document.documentElement.setAttribute(${JSON.stringify(SHELL_ATTRIBUTE)},"")</script>`,
        ]
      : []),
  ];
  html = html.replace(
    "</head>",
    `${head.map((line) => `  ${line}\n`).join("")}  </head>`,
  );
  return html.replace(
    '<div id="root"></div>',
    `<div id="root">${page.html}</div>\n    <script>window.__chromatisPrerender=${scriptJson(page.state)}</script>`,
  );
}

/**
 * Renders the routes declared with `prerender: true` into the client build.
 * Runs after `vite build`; the pages are rendered by Node in Vite's server
 * environment (src/prerender-run.js), as for a visitor without cookies.
 */
export function prerenderPages(
  root: string,
  app: ResolvedApplication,
  frameworkRoot: string,
): string[] {
  const flat = flattenRoutes(app.shell.routes);
  const urls = flat.flatMap((route) =>
    route.prerender && route.url !== undefined ? [route.url] : [],
  );
  const manifestFile = path.join(root, MANIFEST);
  try {
    if (urls.length === 0) {
      return [];
    }
    const output = path.join(root, ".chromatis/build/prerendered.json");
    mkdirSync(path.dirname(output), { recursive: true });
    const origin = new URL(app.publicUrl).origin;
    const child = spawnSync(
      "node",
      [
        path.join(frameworkRoot, "src/prerender-run.js"),
        output,
        ...urls.map((url) => `${origin}${url}`),
      ],
      { cwd: root, stdio: "inherit", env: withoutBuildTarget() },
    );
    if (child.status !== 0) {
      throw new Error(`prerendering failed (${child.status ?? "signal"})`);
    }
    const pages = JSON.parse(readFileSync(output, "utf8")) as PrerenderedPage[];
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<
      string,
      ManifestEntry
    >;
    const sources = new Map<string, string>(
      flat.map((route) => [route.id, route.source]),
    );
    if (app.shell.root) {
      sources.set("root", app.shell.root.file);
    }
    const template = readFileSync(
      path.join(root, CLIENT, "index.html"),
      "utf8",
    );
    return pages.map((page) => {
      const keys = page.routes.flatMap((id) => {
        const source = sources.get(id);
        return source
          ? [
              path
                .relative(root, realpathSync(source))
                .split(path.sep)
                .join("/"),
            ]
          : [];
      });
      const file = pageFile(page.state.path);
      const target = path.join(root, CLIENT, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(
        target,
        composePage(template, page, chunkFiles(manifest, keys)),
      );
      return file;
    });
  } finally {
    rmSync(path.dirname(manifestFile), { recursive: true, force: true });
  }
}

/** The environment without the build target: the renderer is not a build. */
function withoutBuildTarget(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CHROMATIS_BUILD_TARGET;
  return env;
}
