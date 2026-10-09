/* global process */
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "smol-toml";

function developmentRuntime(root) {
  return {
    name: "chromatis:development-runtime",
    configureServer(server) {
      return async () => {
        const manifest = path.join(root, "chromatis.toml");
        if (!existsSync(manifest)) {
          return;
        }
        const declaration = parse(readFileSync(manifest, "utf8"));
        if (typeof declaration.serverHook !== "string") {
          return;
        }
        const hook = (
          await server.ssrLoadModule(path.resolve(root, declaration.serverHook))
        ).default;
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
  const plugins = [
    reactRouter(),
    tsconfigPaths({ projects: [path.join(root, "tsconfig.json")] }),
  ];
  if (!process.env.CHROMATIS_BUILD_TARGET) {
    plugins.push(developmentRuntime(root));
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
        ],
      },
    },
    environments: {
      client: { build: { outDir: path.join(root, "build/client") } },
      ssr: { build: { outDir: path.join(root, "build/server") } },
    },
    resolve: {
      alias: {
        "chromatis-content": path.join(root, ".chromatis/build/content.ts"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react-router",
        "lucide-react",
        "@chromatis/base",
      ],
    },
    ssr: { noExternal: ["studyluma", "@chromatis/base"] },
    optimizeDeps: {
      exclude: ["studyluma"],
      esbuildOptions: { jsx: "automatic" },
    },
    plugins,
  });
}

export default createViteConfig();
