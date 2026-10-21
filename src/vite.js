/* global process, Headers, Request, URL */
import { defineConfig, searchForWorkspaceRoot } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";

const APP_DIRECTORY = ".chromatis/app";
const SERVER_ROUTES = ".chromatis/build/routes.ts";

/**
 * Facts derived by `chromatis` before Vite starts (see writeBuildContext in
 * infra/scripts/application.ts); Vite does not re-read instance configuration.
 */
function buildContext(root) {
  const file = path.join(root, ".chromatis/build/application.json");
  if (!existsSync(file)) {
    return {
      serverHook: null,
      bundledPackages: [],
      allowedRoots: [],
      productPublic: null,
    };
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

function developmentRuntime(context) {
  return {
    name: "chromatis:development-runtime",
    configureServer(server) {
      return async () => {
        if (typeof context.serverHook !== "string") {
          return;
        }
        const hook = (await server.ssrLoadModule(context.serverHook)).default;
        const { createBunRuntimeHost } = await server.ssrLoadModule(
          path.join(import.meta.dirname, "stateful/bun.ts"),
        );
        hook.createService(createBunRuntimeHost(hook.definitions), process.env);
      };
    },
  };
}

/** A Node request of the dev server as a Fetch `Request`. */
function fetchRequest(request) {
  const origin = `http://${request.headers.host ?? "localhost"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name.startsWith(":")) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }
  const body = request.method === "GET" || request.method === "HEAD";
  return new Request(new URL(request.originalUrl ?? request.url, origin), {
    method: request.method,
    headers,
    ...(body ? {} : { body: Readable.toWeb(request), duplex: "half" }),
  });
}

/** Writes a Fetch `Response` to a Node response of the dev server. */
async function sendResponse(response, target) {
  target.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") {
      continue;
    }
    target.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) {
    target.setHeader("set-cookie", cookies);
  }
  if (!response.body) {
    target.end();
    return;
  }
  for await (const chunk of response.body) {
    target.write(chunk);
  }
  target.end();
}

/**
 * The server side in the dev server: data and API requests are answered from
 * the generated route tables, inside a request scope as in production, before
 * Vite serves files; every other page request gets the app's `index.html`.
 */
function developmentServer(root) {
  const tables = path.join(root, SERVER_ROUTES);
  const html = path.join(root, APP_DIRECTORY, "index.html");
  return {
    name: "chromatis:development-server",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          if (!existsSync(tables)) {
            next();
            return;
          }
          const routes = await server.ssrLoadModule(tables);
          const { serveRoutes } = await server.ssrLoadModule(
            path.join(import.meta.dirname, "server.ts"),
          );
          const answer = await serveRoutes(routes, fetchRequest(request));
          if (!answer) {
            next();
            return;
          }
          await sendResponse(answer, response);
        } catch (error) {
          next(error);
        }
      });
      return () => {
        server.middlewares.use(async (request, response, next) => {
          const accept = request.headers.accept ?? "";
          if (
            (request.method !== "GET" && request.method !== "HEAD") ||
            !accept.includes("text/html")
          ) {
            next();
            return;
          }
          try {
            const page = await server.transformIndexHtml(
              request.originalUrl ?? request.url ?? "/",
              readFileSync(html, "utf8"),
            );
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(page);
          } catch (error) {
            next(error);
          }
        });
      };
    },
  };
}

const STATIC_TYPES = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".json": "application/json",
};

/** Every file below `directory`, as paths relative to it with `/`. */
function filesBelow(directory, prefix = "") {
  return readdirSync(path.join(directory, prefix), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesBelow(directory, relative) : [relative];
  });
}

/**
 * The product's static files (manifest `app.public`) beside the instance's own
 * `public/`, which Vite serves and copies itself and which wins per file: in
 * the dev server they are served as they are, in the client build they land at
 * its root.
 */
function productPublic(directory, root) {
  if (typeof directory !== "string" || !existsSync(directory)) {
    return [];
  }
  const own = path.join(root, "public");
  const shadowed = (file) => existsSync(path.join(own, file));
  return [
    {
      name: "chromatis:product-public",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          let file;
          try {
            file = decodeURIComponent(
              new URL(request.url ?? "/", "http://local").pathname,
            ).slice(1);
          } catch {
            next();
            return;
          }
          const target = path.join(directory, file);
          if (
            !file ||
            !target.startsWith(`${directory}${path.sep}`) ||
            shadowed(file) ||
            !statSync(target, { throwIfNoEntry: false })?.isFile()
          ) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader(
            "Content-Type",
            STATIC_TYPES[path.extname(target)] ?? "application/octet-stream",
          );
          response.end(readFileSync(target));
        });
      },
    },
    {
      name: "chromatis:product-public-build",
      apply: "build",
      applyToEnvironment: (environment) => environment.name === "client",
      generateBundle() {
        for (const file of filesBelow(directory)) {
          if (!shadowed(file)) {
            this.emitFile({
              type: "asset",
              fileName: file,
              source: readFileSync(path.join(directory, file)),
            });
          }
        }
      },
    },
  ];
}

/** The generated `index.html` lands at the root of the client build. */
function documentAtRoot() {
  const generated = `${APP_DIRECTORY}/index.html`;
  return {
    name: "chromatis:document-at-root",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const asset = bundle[generated];
      if (asset) {
        delete bundle[generated];
        asset.fileName = "index.html";
        bundle["index.html"] = asset;
      }
    },
  };
}

function localDependencyRoots(root) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  return Object.values(manifest.dependencies ?? {})
    .filter((value) => typeof value === "string" && value.startsWith("file:"))
    .map((value) => path.resolve(root, value.slice(5)));
}

export async function createViteConfig() {
  const root = process.cwd();
  const context = buildContext(root);
  const plugins = [
    tsconfigPaths({ projects: [path.join(root, "tsconfig.json")] }),
    documentAtRoot(),
    ...productPublic(context.productPublic, root),
  ];
  if (!process.env.CHROMATIS_BUILD_TARGET) {
    plugins.push(developmentServer(root), developmentRuntime(context));
  }
  if (process.env.CHROMATIS_BUILD_TARGET === "cloudflare") {
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(
      cloudflare({
        configPath: path.join(root, ".chromatis/build/wrangler.json"),
        viteEnvironment: { name: "ssr" },
      }),
    );
  }
  return defineConfig({
    root,
    appType: "custom",
    esbuild: { jsx: "automatic" },
    server: {
      ...(process.env.PORT ? { port: Number(process.env.PORT) } : {}),
      fs: {
        allow: [
          searchForWorkspaceRoot(root),
          root,
          path.resolve(import.meta.dirname, ".."),
          ...localDependencyRoots(root),
          ...context.allowedRoots,
        ],
      },
    },
    build: {
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          // Zod's explanatory comments quote `@__PURE__`, which Rollup tries to
          // read as an annotation. The real annotations are unaffected and the
          // comments are dropped either way, so the warning carries no signal.
          if (
            warning.code === "INVALID_ANNOTATION" &&
            /[\\/]node_modules[\\/]zod[\\/]/.test(warning.id ?? "")
          ) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
    environments: {
      client: {
        build: {
          outDir: path.join(root, "build/client"),
          emptyOutDir: true,
          rollupOptions: {
            input: path.join(root, APP_DIRECTORY, "index.html"),
          },
        },
      },
      ssr: { build: { outDir: path.join(root, "build/server") } },
    },
    resolve: {
      alias: {
        "chromatis-artifacts": path.join(root, ".chromatis/build/artifacts.ts"),
        "chromatis-config": path.join(root, ".chromatis/build/config.ts"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react-router",
        "lucide-react",
        "@chromatis/base",
      ],
    },
    ssr: { noExternal: [...context.bundledPackages, "@chromatis/base"] },
    optimizeDeps: {
      entries: [path.join(root, APP_DIRECTORY, "index.html")],
      exclude: context.bundledPackages,
      esbuildOptions: { jsx: "automatic" },
    },
    plugins,
  });
}

export default createViteConfig();
