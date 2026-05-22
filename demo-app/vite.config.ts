import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@chromatis/base/styles",
        replacement: fileURLToPath(new URL("../src/ui/style/app.css", import.meta.url)),
      },
      {
        find: "@chromatis/base/component",
        replacement: fileURLToPath(new URL("../src/component.ts", import.meta.url)),
      },
      {
        find: "@chromatis/base",
        replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      },
    ],
    dedupe: [
      "react",
      "react-dom",
      "react-router",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  optimizeDeps: {
    force: true,
    exclude: ["@chromatis/base"],
    esbuildOptions: {
      jsx: "automatic",
    },
  },
  plugins: [
    tailwindcss(),
    reactRouter(),
  ],
})
