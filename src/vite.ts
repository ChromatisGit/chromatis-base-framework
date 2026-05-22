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

  corePlugins.push(reactRouter(), tsconfigPaths());

  if (isCloudflare) {
    const { cloudflare: cfPlugin } = await import("@cloudflare/vite-plugin");
    corePlugins.push(cfPlugin({ viteEnvironment: { name: "ssr" } }));
  }

  return defineConfig({
    resolve: {
      dedupe: ["react", "react-dom", "react-router", "lucide-react"],
    },
    plugins: [...corePlugins, ...plugins],
  });
}
