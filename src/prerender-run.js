/* global process, console */
/**
 * Renders the prerendered pages in Vite's server environment, so page files,
 * CSS imports and the virtual modules resolve as in the dev server, and writes
 * each page's markup, meta and state as JSON. `chromatis build` runs it with
 * Node in the instance root (see infra/scripts/prerender.ts):
 *
 *   node prerender-run.js <output.json> <url>...
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const [output, ...urls] = process.argv.slice(2);
const root = process.cwd();
const server = await createServer({
  configFile: path.join(import.meta.dirname, "vite.js"),
  appType: "custom",
  logLevel: "warn",
  server: { middlewareMode: true, hmr: false, ws: false },
});
let failed = false;
try {
  const { prerenderPage } = await server.ssrLoadModule(
    path.join(import.meta.dirname, "prerender.tsx"),
  );
  const { app } = await server.ssrLoadModule(
    path.join(root, ".chromatis/app/app.ts"),
  );
  const tables = await server.ssrLoadModule(
    path.join(root, ".chromatis/build/routes.ts"),
  );
  const pages = [];
  for (const url of urls) {
    pages.push(await prerenderPage(app, tables, url));
  }
  writeFileSync(output, JSON.stringify(pages));
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
