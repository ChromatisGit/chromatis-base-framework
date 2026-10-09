/*
 * Test helper: runs an application's Worker entry inside workerd (through
 * Miniflare) with real Durable Objects and WebSockets. Only for tests; it
 * needs `miniflare` (a dev dependency) and Bun's bundler.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface WorkerdWorker {
  readonly baseUrl?: string;
  dispatchFetch(
    url: string,
    init?: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    },
  ): Promise<{
    status: number;
    ok: boolean;
    text(): Promise<string>;
    json(): Promise<unknown>;
    webSocket?: {
      accept(): void;
      send(data: string): void;
      close(): void;
      addEventListener(
        type: "message" | "close",
        listener: (event: { data?: unknown }) => void,
      ): void;
    } | null;
  }>;
  dispose(): Promise<void>;
}

export interface WorkerdOptions {
  /** Path of the Worker entry module; it exports the Durable Object class. */
  entrypoint: string;
  /** Binding name → exported Durable Object class name. */
  durableObjects: Record<string, string>;
  assetsDirectory?: string;
}

export async function startWorkerd(
  options: WorkerdOptions,
): Promise<WorkerdWorker> {
  const built = await Bun.build({
    entrypoints: [options.entrypoint],
    target: "browser",
    format: "esm",
    minify: false,
  });
  if (!built.success) {
    throw new Error(built.logs.join("\n"));
  }
  const script = await (built.outputs[0] as { text(): Promise<string> }).text();
  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2025-01-01",
    durableObjects: options.durableObjects,
    ...(options.assetsDirectory
      ? { assets: { directory: options.assetsDirectory } }
      : {}),
  });
  const url = await mf.ready;
  return Object.assign(mf, {
    baseUrl: url.toString(),
  }) as unknown as WorkerdWorker;
}

/** Boots the exact Worker module emitted by the framework Cloudflare build. */
export async function startBuiltWorkerd(
  options: WorkerdOptions,
): Promise<WorkerdWorker> {
  const { Miniflare } = await import("miniflare");
  const directory = path.dirname(options.entrypoint);
  const modules: { type: "ESModule"; path: string; contents: string }[] = [];
  function add(file: string): void {
    if (statSync(file).isDirectory()) {
      for (const entry of readdirSync(file).sort()) {
        add(path.join(file, entry));
      }
    } else if (/\.[cm]?js$/.test(file)) {
      modules.push({
        type: "ESModule",
        path: path.relative(directory, file),
        contents: readFileSync(file, "utf8"),
      });
    }
  }
  add(directory);
  modules.sort((left, right) =>
    left.path === "index.js"
      ? -1
      : right.path === "index.js"
        ? 1
        : left.path.localeCompare(right.path),
  );
  const mf = new Miniflare({
    modules,
    compatibilityDate: "2025-09-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: options.durableObjects,
    ...(options.assetsDirectory
      ? { assets: { directory: options.assetsDirectory } }
      : {}),
  });
  const url = await mf.ready;
  return Object.assign(mf, {
    baseUrl: url.toString(),
  }) as unknown as WorkerdWorker;
}
