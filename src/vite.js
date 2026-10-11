/* global process */
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

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
    plugins.push(developmentRuntime(context));
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
          root,
          path.resolve(import.meta.dirname, ".."),
          ...localDependencyRoots(root),
          ...context.allowedRoots,
        ],
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
