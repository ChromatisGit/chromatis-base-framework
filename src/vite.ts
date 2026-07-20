import { type UserConfig, defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export interface ViteConfigOptions {
  tailwind?: boolean;
  cloudflare?: boolean;
  plugins?: UserConfig["plugins"];
}

export async function createViteConfig(options: ViteConfigOptions = {}): Promise<UserConfig> {
  const { tailwind = true, cloudflare = true, plugins = [] } = options;
  const isCloudflare = Boolean(process.env.WRANGLER) && cloudflare;

  const corePlugins: UserConfig["plugins"] = [];

  if (tailwind) {
    const { default: tailwindcss } = await import("@tailwindcss/vite");
    corePlugins.push(tailwindcss());
  }

  corePlugins.push(reactRouter(), tsconfigPaths({ projects: ["./tsconfig.json"] }));

  if (isCloudflare) {
    const { cloudflare: cfPlugin } = await import("@cloudflare/vite-plugin");
    corePlugins.push(cfPlugin({ viteEnvironment: { name: "ssr" } }));
  }

  return defineConfig({
    resolve: {
      dedupe: ["react", "react-dom", "react-router", "lucide-react"],
    },
    plugins: [...corePlugins, ...plugins],

    // The SQLite Worker dynamically imports @sqlite.org/sqlite-wasm, which forces
    // code-splitting for the worker bundle. Rollup's default worker.format ("iife")
    // doesn't support code-splitting, so it must be "es".
    worker: {
      format: "es",
    },

    // Prevent Vite from trying to pre-bundle the SQLite WASM package.
    // It ships its own ES module that must be loaded as-is by the browser.
    optimizeDeps: {
      exclude: ["@sqlite.org/sqlite-wasm"],
    },

    // SharedWorker scripts need the correct MIME type headers.
    // OPFS SAH pool does not require COOP/COEP, but the standard OPFS VFS
    // does. Add these headers to support both fallback paths in dev.
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
  });
}
