/* global process */
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { inlinePackageReexport } from "./inline-route.js";

/**
 * Facts derived by `chromatis` before Vite starts (see writeBuildContext in
 * infra/scripts/application.ts); Vite does not re-read instance configuration.
 */
function buildContext(root) {
  const file = path.join(root, ".chromatis/build/application.json");
  if (!existsSync(file)) {
    return { serverHook: null, bundledPackages: [], allowedRoots: [] };
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

/**
 * Serve the generated one-line route wrappers with the package route inlined, as
 * `materializeExternalRoutes` does on disk for builds. Without it React Router
 * strips `loader` from the wrapper only, and the client imports the package
 * module with its `.server` imports.
 */
function inlinePackageRoutes(root) {
  const appDirectory = path.join(root, ".chromatis/app") + path.sep;
  const instanceRequire = createRequire(path.join(root, "package.json"));
  // Vite resolves extensionless specifiers, `require.resolve` does not.
  const require = {
    resolve(specifier) {
      try {
        return instanceRequire.resolve(specifier);
      } catch (error) {
        for (const extension of [".tsx", ".ts", ".jsx", ".js"]) {
          try {
            return instanceRequire.resolve(specifier + extension);
          } catch {
            // Try the next extension.
          }
        }
        throw error;
      }
    },
  };
  return {
    name: "chromatis:inline-package-routes",
    enforce: "pre",
    load(id) {
      const file = id.split("?")[0];
      if (!file.startsWith(appDirectory) || !/\.[cm]?[jt]sx?$/.test(file)) {
        return;
      }
      const inlined = inlinePackageReexport(
        readFileSync(file, "utf8"),
        require,
      );
      if (!inlined) {
        return;
      }
      this.addWatchFile(inlined.source);
      return { code: inlined.code, map: null };
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
    reactRouter(),
    tsconfigPaths({ projects: [path.join(root, "tsconfig.json")] }),
  ];
  if (!process.env.CHROMATIS_BUILD_TARGET) {
    plugins.push(inlinePackageRoutes(root), developmentRuntime(context));
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
    server: {
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
      client: { build: { outDir: path.join(root, "build/client") } },
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
      exclude: context.bundledPackages,
      esbuildOptions: { jsx: "automatic" },
    },
    plugins,
  });
}

export default createViteConfig();
